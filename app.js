import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// ---------- configuración local ----------
const CFG_KEY = "plantdex.cfg";
// Datos públicos del proyecto Supabase (la clave publishable es segura en el navegador gracias a RLS)
const defaults = { sbUrl: "https://ssrbytherfljgxfgvhlc.supabase.co", sbKey: "sb_publishable_tCn6CO053IFbwGBDg-mfpQ_uEjpmLbD", provider: "gemini", aiKey: "", model: "", engrave: true, illustrations: true };
const loadCfg = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; } catch { return { ...defaults }; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
let cfg = loadCfg();

const DEFAULT_MODELS = { gemini: "gemini-flash-latest", openai: "gpt-4o-mini" };
const BUCKET = "plant-photos";

const TYPES = ["comestible", "toxica", "medicinal", "aromatica", "frutal", "flor", "arbol", "arbusto", "hierba", "trepadora", "hongo", "acuatica", "invasora", "ornamental"];
const TYPE_LABEL = { comestible: "Comestible", toxica: "Tóxica", medicinal: "Medicinal", aromatica: "Aromática", frutal: "Frutal", flor: "Flor", arbol: "Árbol", arbusto: "Arbusto", hierba: "Hierba", trepadora: "Trepadora", hongo: "Hongo", acuatica: "Acuática", invasora: "Invasora", ornamental: "Ornamental" };
const HUMAN = { si: ["Comestible", "ok"], parcial: ["En parte", "warn"], no: ["No se come", "bad"], desconocido: ["Sin datos", ""] };
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// ---------- estado ----------
let sb = null;
let user = null;
let plants = [];
const urlCache = new Map();
let filter = { q: "", type: "" };
let draft = null; // { files: [{blob, url}], data: {}, mode }

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const v = (id) => document.getElementById(id).value.trim();
const toast = (msg) => { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3000); };
const nowMonth = () => new Date().getMonth() + 1;

function roman(n) {
  const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = ""; for (const [k, s] of map) while (n >= k) { out += s; n -= k; } return out;
}
const tab = (n) => "Tab. " + roman(n);

// ---------- arranque ----------
async function boot() {
  document.body.classList.toggle("engrave", !!cfg.engrave);
  document.getElementById("btn-settings").onclick = () => go("settings");
  document.getElementById("btn-home").onclick = () => go("list");
  $nav.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (b.dataset.go === "new" ? openSheet() : go(b.dataset.go))));
  window.addEventListener("hashchange", route);

  if (!cfg.sbUrl || !cfg.sbKey) return go("settings");
  sb = createClient(cfg.sbUrl, cfg.sbKey);
  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  sb.auth.onAuthStateChange((_e, s) => { const was = user; user = s?.user ?? null; if (!!was !== !!user) { if (user) loadPlants().then(route); else route(); } });
  if (user) await loadPlants();
  await restoreDraft();
  route();
}

function go(view) { if (location.hash === "#" + view) route(); else location.hash = view; }

function route() {
  const [view, arg] = location.hash.slice(1).split("/");
  window.scrollTo(0, 0);
  document.getElementById("sheet").hidden = true;
  const active = { plant: "list", edit: "list", "": "list" }[view] ?? view;
  $nav.querySelectorAll("[data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === active));
  if (view === "settings" || !sb) return renderSettings();
  if (!user) return renderLogin();
  $nav.hidden = false;
  if (view === "new") return renderNew();
  if (view === "plant" && arg) return renderDetail(arg);
  if (view === "edit" && arg) return renderEdit(arg);
  if (view === "stats") return renderStats();
  if (view === "cal") return renderCalendar();
  return renderList();
}

// ---------- datos ----------
async function loadPlants() {
  const { data, error } = await sb.from("plants").select("*").order("number", { ascending: false });
  if (error) { toast("Error cargando: " + error.message); return; }
  plants = data;
  await signUrls(plants.flatMap((p) => p.photos?.slice(0, 1) || []));
}

async function signUrls(paths) {
  const missing = [...new Set(paths.filter((p) => p && !urlCache.has(p)))];
  if (!missing.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 24);
  if (error) console.warn("signed urls", error);
  // La respuesta viene en el mismo orden que pedimos; no dependemos del campo "path".
  missing.forEach((p, i) => { const d = data?.[i]; const u = d?.signedUrl || d?.signedURL; if (u && !d.error) urlCache.set(p, u); });
  // Plan B: si no hubo link firmado, bajamos el archivo y lo mostramos local.
  await Promise.all(missing.filter((p) => !urlCache.has(p)).map(async (p) => {
    const { data: blob, error: e } = await sb.storage.from(BUCKET).download(p);
    if (blob) urlCache.set(p, URL.createObjectURL(blob)); else console.warn("download", p, e);
  }));
}

// ---------- ilustraciones antiguas (Wikimedia Commons) ----------
// Buscamos láminas de floras históricas por nombre científico. Se cachea por especie en este dispositivo.
const ILLU_KEY = "plantdex.illu2"; // v2: descarta resultados de la búsqueda anterior
const ILLU_SOURCES = /k(ö|oe|o)hler|thom[ée]|flora batava|lindman|nordens flora|sturm|sowerby|curtis|botanical magazine|jacquin|redout|hooker|illustration|plate|tafel|tab\.|lámina|drawing|engraving|medizinal|pflanzen|kräuterbuch|fuchs|blackwell|bauer/i;
let illuCache = {};
try { illuCache = JSON.parse(localStorage.getItem(ILLU_KEY) || "{}"); } catch {}
const saveIllu = () => { try { localStorage.setItem(ILLU_KEY, JSON.stringify(illuCache)); } catch {} };
const illuKey = (sci) => (sci || "").trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
const illuOf = (p) => (cfg.illustrations && p.scientific_name ? illuCache[illuKey(p.scientific_name)] || null : null);
const strip = (h) => String(h || "").replace(/<[^>]+>/g, "").trim();

// Búsquedas dirigidas a cada flora histórica, en orden de preferencia.
const ILLU_QUERIES = [
  "intitle:Köhler", "intitle:Illustration", "intitle:Batava", "intitle:Sturm", "intitle:Nordens",
  "Lindman", "intitle:Sowerby", '"English Botany"', "Curtis botanical", "drawing OR plate OR engraving OR tafel",
];
async function findIllustration(sci) {
  const key = illuKey(sci);
  if (!key || key.split(" ").length < 2) return null;
  if (key in illuCache) return illuCache[key];
  let pick = null;
  try {
    const search = async (extra) => {
      const q = new URLSearchParams({
        action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "5",
        gsrsearch: `intitle:"${key}" ${extra} filetype:bitmap`, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "700",
      });
      const res = await fetch("https://commons.wikimedia.org/w/api.php?" + q);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return Object.values((await res.json()).query?.pages || {})
        .filter((pg) => pg.imageinfo?.[0]?.thumburl && pg.title.toLowerCase().includes(key))
        .sort((x, y) => (x.index || 0) - (y.index || 0));
    };
    const results = await Promise.all(ILLU_QUERIES.map((q) => search(q).catch(() => null)));
    if (results.every((r) => r === null)) return null; // sin red: reintentar más tarde
    for (let i = 0; i < results.length && !pick; i++) {
      const list = results[i] || [];
      pick = i < ILLU_QUERIES.length - 1 ? list[0] : list.find((pg) => ILLU_SOURCES.test(pg.title));
    }
  } catch { return null; }
  const info = pick?.imageinfo[0], md = info?.extmetadata || {};
  illuCache[key] = pick ? {
    url: info.thumburl, page: info.descriptionurl,
    credit: [strip(md.Artist?.value), strip(md.ObjectName?.value) || pick.title.replace(/^File:|\.\w+$/g, "")].filter(Boolean).join(" · ").slice(0, 160),
    license: strip(md.LicenseShortName?.value) || "Dominio público",
  } : false;
  saveIllu();
  return illuCache[key];
}

// Completa las ilustraciones que falten en la vista actual sin trabar el render.
async function hydrateIllustrations() {
  if (!cfg.illustrations) return;
  for (const el of document.querySelectorAll("[data-sci]")) {
    const sci = el.dataset.sci;
    if (!sci || illuKey(sci) in illuCache) continue;
    const ill = await findIllustration(sci);
    if (ill) document.querySelectorAll(`[data-sci="${CSS.escape(sci)}"]`).forEach((n) => { n.style.backgroundImage = `url('${ill.url}')`; n.classList.add("illu"); });
  }
}

async function resizeImage(file, max = 1400) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}
const blobToBase64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); });

// ---------- IA ----------
const buildPrompt = (hint = "", place = "") => `Sos un botánico de campo y naturalista experto en la flora silvestre y cultivada de todo el mundo. Identificá la planta, hongo o fruto de las fotos.
Lugar del hallazgo: ${place || "desconocido (deducilo de las fotos si podés)"}. Usá ese lugar como referencia para la rareza, los meses y si es nativa o introducida.
Respondé SOLO con un bloque JSON válido, en español rioplatense, con esta forma exacta:
{
 "common_name": "nombre común en español de España",
 "other_names": "solo en este formato: 'España: … · Latinoamérica: … · Inglés: …'. Poné Latinoamérica únicamente si el nombre cambia (y aclará el país si varía, ej. 'Argentina: …'). NO incluyas euskera, catalán, gallego ni otras lenguas cooficiales o regionales",
 "scientific_name": "Género especie",
 "family": "Familia",
 "native_range": "de dónde es nativa y si en el lugar del hallazgo es nativa, introducida o invasora",
 "kind": "árbol | arbusto | hierba | trepadora | hongo | otro",
 "types": [elegí de: ${TYPES.join(", ")}],
 "edible_human": "si | parcial | no | desconocido",
 "edibility_notes": "qué partes se comen, cómo, en qué época, y confusiones peligrosas con especies parecidas",
 "description": "cómo reconocerla, 2-3 frases",
 "uses": "usos culinarios, medicinales tradicionales, artesanales u ornamentales",
 "history": "historia, etimología o folklore, 2-4 frases",
 "curiosity": "un dato curioso breve y sorprendente",
 "flower_months": [números de mes 1-12 en que florece en el lugar del hallazgo (ojo con el hemisferio)],
 "fruit_months": [números de mes 1-12 en que da fruto o se cosecha],
 "rarity": 1-5 (1 = muy común en esa región, 5 = rarísima allí),
 "confidence": "alta | media | baja, y si es baja, qué foto extra ayudaría"
}
Ante la duda sé conservador con la comestibilidad: usá "desconocido".${hint ? `\nPista: ${hint}` : ""}`;

function normalizeAI(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No encontré un JSON en la respuesta");
  const out = JSON.parse(m[0]);
  const months = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 12) : []);
  out.types = (out.types || []).map((t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter((t) => TYPES.includes(t));
  out.flower_months = months(out.flower_months);
  out.fruit_months = months(out.fruit_months);
  out.ai_confidence = out.confidence; delete out.confidence;
  out.rarity = Math.max(1, Math.min(5, parseInt(out.rarity) || 1));
  return out;
}

// Modelos "flash" de la cuenta que aceptan generateContent, del más nuevo al más viejo (los "lite" al final).
async function geminiCandidates() {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": cfg.aiKey } });
    const j = await res.json();
    const ver = (n) => (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] * 1 || 0;
    const names = (j.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|thinking|exp/.test(n));
    const rank = (n) => (/lite/.test(n) ? 1 : 0);
    return names.sort((x, y) => rank(x) - rank(y) || ver(y) - ver(x) || x.length - y.length);
  } catch { return []; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function geminiError(msg = "", status) {
  if (status === 429 || /quota|rate/i.test(msg)) return "Llegaste al límite gratuito de Gemini por ahora. Probá en un rato o usá «Con mi chat».";
  if (status === 503 || /high demand|overloaded|unavailable/i.test(msg)) return "Los servidores de Gemini están saturados. Probá en unos minutos o usá «Con mi chat».";
  if (/api key|permission|unauth/i.test(msg)) return "Google rechazó la API key. Revisala en Ajustes.";
  return msg;
}

async function identify(blobs, hint = "", place = "", onStatus) {
  if (!cfg.aiKey) throw new Error("Falta la API key en Ajustes. Probá la pestaña «Con mi chat».");
  const imgs = await Promise.all(blobs.map(blobToBase64));
  const prompt = buildPrompt(hint, place);
  const model = cfg.model || DEFAULT_MODELS[cfg.provider];
  let text;
  if (cfg.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.aiKey },
      body: JSON.stringify({
        model, response_format: { type: "json_object" },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...imgs.map((b) => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + b } }))] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.statusText);
    text = j.choices[0].message.content;
  } else {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...imgs.map((b) => ({ inline_data: { mime_type: "image/jpeg", data: b } }))] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
    });
    const call = async (m) => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.aiKey }, body,
      });
      return { res, j: await res.json().catch(() => ({})) };
    };
    const busy = (r) => [429, 500, 503].includes(r.res.status) || /high demand|overloaded/i.test(r.j.error?.message || "");
    const gone = (r) => /no longer available|not found|is not supported|deprecated/i.test(r.j.error?.message || "");
    // Probamos el modelo guardado; si no existe o está saturado, recorremos los Flash de la cuenta.
    let r = await call(model), used = model;
    if (!r.res.ok && busy(r)) { onStatus?.("Gemini está saturado, reintentando…"); await sleep(2000); r = await call(model); }
    if (!r.res.ok && (busy(r) || gone(r))) {
      for (const m of (await geminiCandidates()).filter((m) => m !== model).slice(0, 4)) {
        onStatus?.(`Probando con ${m}…`);
        r = await call(m); used = m;
        if (r.res.ok || !(busy(r) || gone(r))) break;
      }
    }
    if (!r.res.ok) throw new Error(geminiError(r.j.error?.message || r.res.statusText, r.res.status));
    if (used !== model) { cfg.model = used; saveCfg(cfg); }
    text = r.j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  }
  return normalizeAI(text);
}

// ---------- piezas comunes ----------
const typeBadges = (types = []) => `<div class="chips" style="justify-content:center">${types.map((t) => `<span class="type t-${t}">${TYPE_LABEL[t] || t}</span>`).join("")}</div>`;
const stars = (n) => "✦".repeat(n || 1) + "✧".repeat(5 - (n || 1));
const monthsBar = (fl = [], fr = [], pickId = "") => `<div class="months ${pickId ? "pick" : ""}" ${pickId ? `id="${pickId}"` : ""}>${MONTHS.map((m, i) => {
  const n = i + 1; return `<span data-m="${n}" class="${fl.includes(n) ? "fl" : ""} ${fr.includes(n) ? "fr" : ""} ${n === nowMonth() ? "now" : ""}">${m[0]}</span>`;
}).join("")}</div>`;
const legend = `<div class="legend"><i style="background:var(--gold-soft)"></i>flor <i style="background:var(--leaf-2)"></i>fruto <i style="box-shadow:0 0 0 2px var(--ink)"></i>mes actual</div>`;
const photoOf = (p) => urlCache.get(p.photos?.[0]);

// Ilustración de lámina grabada (tallo, hojas con nervaduras, flor y raíces)
const PLANT_ART = `<svg viewBox="0 0 200 260" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M100 236C98 190 104 150 100 70" stroke-width="2"/>
  <g stroke-width="1.3">
    <path d="M100 180C80 176 58 160 50 136c22 0 42 14 50 44z"/><path d="M100 180C84 168 68 152 56 140M78 170l-6-14M88 176l-4-12M66 160l-9-8"/>
    <path d="M101 150c18-6 40-24 46-50-22 4-40 20-46 50z"/><path d="M101 150c14-14 28-30 40-44M118 136l14-2M128 124l12-4M110 144l6-12"/>
    <path d="M100 116c-14-4-30-18-34-38 18 2 30 14 34 38z"/><path d="M100 116C90 104 80 94 70 84M84 104l-10 0M92 110l-4-10"/>
  </g>
  <g stroke-width="1.4">
    <path d="M100 70c-6-14-4-26 0-34 4 8 6 20 0 34z"/><path d="M100 70c-14-6-22-18-22-28 10 2 18 12 22 28z"/>
    <path d="M100 70c14-6 22-18 22-28-10 2-18 12-22 28z"/><path d="M100 70c-16 2-28-4-34-12 12-4 24 0 34 12z"/>
    <path d="M100 70c16 2 28-4 34-12-12-4-24 0-34 12z"/>
  </g>
  <circle cx="100" cy="64" r="5" fill="#b39a52" stroke-width="1.2"/>
  <g stroke-width=".9" opacity=".7"><path d="M100 236c-10 6-22 8-32 6M100 236c8 8 20 12 30 10M100 236c-2 8-8 14-14 16M100 236c4 8 4 14 2 20"/></g>
  <path d="M40 240h120" stroke-width=".8" opacity=".5"/>
</svg>`;
const EMBLEM = `<svg viewBox="0 0 64 64"><use href="#i-emblem"/></svg>`;

// ---------- vistas ----------
function renderSettings() {
  $nav.hidden = !user;
  $app.innerHTML = `
    <h2>Ajustes</h2>
    <p class="muted">Se guardan solo en este dispositivo. En el README está cómo sacar cada clave, todas gratis.</p>
    <h3>Supabase · tu nube</h3>
    <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.sbUrl)}">
    <label>Anon / publishable key</label><input id="sbKey" placeholder="eyJ… o sb_publishable_…" value="${esc(cfg.sbKey)}">
    <h3>Identificación automática</h3>
    <label>Proveedor</label>
    <select id="provider">
      <option value="gemini" ${cfg.provider === "gemini" ? "selected" : ""}>Google Gemini (gratis)</option>
      <option value="openai" ${cfg.provider === "openai" ? "selected" : ""}>OpenAI API (de pago)</option>
    </select>
    <label>API key (opcional: sin ella usás «Con mi chat»)</label><input id="aiKey" type="password" placeholder="AIza…" value="${esc(cfg.aiKey)}">
    <label>Modelo (opcional)</label><input id="model" placeholder="${DEFAULT_MODELS[cfg.provider]}" value="${esc(cfg.model)}">
    <h3>Apariencia</h3>
    <label class="toggle"><input type="checkbox" id="engrave" ${cfg.engrave ? "checked" : ""}> Fotos con filtro de grabado antiguo</label>
    <label class="toggle"><input type="checkbox" id="illustrations" ${cfg.illustrations ? "checked" : ""}> Usar láminas antiguas de Wikimedia Commons como imagen principal</label>
    <div class="row" style="margin-top:22px"><button class="btn primary" id="save">Guardar</button></div>
    ${user ? `<hr><p class="muted" style="text-align:center">Sesión: ${esc(user.email)}</p>
      <div class="row"><button class="btn" id="export">Exportar backup</button><button class="btn ghost" id="logout">Cerrar sesión</button></div>` : ""}
  `;
  $app.querySelector("#save").onclick = () => {
    const prevSb = cfg.sbUrl + cfg.sbKey;
    cfg = { sbUrl: v("sbUrl").replace(/\/(rest\/v1\/?)?$/, ""), sbKey: v("sbKey"), provider: v("provider"), aiKey: v("aiKey"), model: v("model"), engrave: document.getElementById("engrave").checked, illustrations: document.getElementById("illustrations").checked };
    saveCfg(cfg);
    document.body.classList.toggle("engrave", cfg.engrave);
    toast("Guardado");
    if (prevSb !== cfg.sbUrl + cfg.sbKey) location.replace(location.pathname);
    else go("list");
  };
  $app.querySelector("#logout")?.addEventListener("click", async () => { await sb.auth.signOut(); go("list"); });
  $app.querySelector("#export")?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(plants, null, 2)], { type: "application/json" }));
    a.download = `plantdex-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
}

function renderLogin() {
  $nav.hidden = true;
  $app.innerHTML = `
    <div class="empty">
      <div class="big">${PLANT_ART}</div>
      <h2>Herbarium Vivum</h2>
      <p class="lead"><i>Liber plantarum quas vidi</i>.<br>El libro de las plantas que vi.</p>
      <label>Tu email</label>
      <input id="email" type="email" placeholder="tu@email.com" style="margin:0 0 22px;text-align:center">
      <button class="btn red" id="send" style="width:100%">Enviar el link</button>
    </div>`;
  $app.querySelector("#send").onclick = async () => {
    const email = v("email"); if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    toast(error ? "Error: " + error.message : "Listo, revisá tu correo");
  };
}

function renderList() {
  const q = filter.q.toLowerCase();
  const list = plants.filter((p) =>
    (!filter.type || p.types?.includes(filter.type)) &&
    (!q || [p.common_name, p.other_names, p.scientific_name, p.family, p.location_name].join(" ").toLowerCase().includes(q)));
  const used = TYPES.filter((t) => plants.some((p) => p.types?.includes(t)));
  $app.innerHTML = `
    <div class="entry-head"><h2>Herbarium</h2><span class="sc muted">${plants.length} ${plants.length === 1 ? "lámina" : "láminas"}</span></div>
    ${plants.length ? `<div class="viewsw" role="tablist">
      <button data-v="grid" class="${cfg.view !== "list" ? "on" : ""}">Láminas</button>
      <button data-v="list" class="${cfg.view === "list" ? "on" : ""}">Índice</button>
    </div>` : ""}
    <div class="search"><input id="q" placeholder="Buscar por nombre, latín, familia, lugar…" value="${esc(filter.q)}"></div>
    ${used.length ? `<div class="chips">${used.map((t) => `<span class="chip ${filter.type === t ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>` : ""}
    ${plants.length === 0 ? `
      <div class="empty"><div class="big">${PLANT_ART}</div><h3>Las páginas están en blanco</h3>
      <p class="lead">Salí a pasear y tocá el sello verde<br>para asentar tu primera lámina.</p>
      <button class="btn red" id="start">Comenzar la Tab. I</button></div>` :
      !list.length ? `<p class="muted">Ninguna lámina coincide.</p>` :
      cfg.view === "list" ? `<ol class="index">${list.map(row).join("")}</ol>` : `<div class="grid">${list.map(card).join("")}</div>`}
  `;
  const $q = $app.querySelector("#q");
  $q.oninput = () => { filter.q = $q.value; const pos = $q.selectionStart; renderList(); const n = $app.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  $app.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { filter.type = filter.type === c.dataset.t ? "" : c.dataset.t; renderList(); }));
  $app.querySelectorAll(".card, .index li").forEach((c) => (c.onclick = () => (location.hash = "plant/" + c.dataset.id)));
  $app.querySelectorAll(".viewsw button").forEach((b) => (b.onclick = () => { cfg.view = b.dataset.v; saveCfg(cfg); renderList(); }));
  hydrateIllustrations();
  $app.querySelector("#start")?.addEventListener("click", openSheet);
}

const coverOf = (p) => illuOf(p)?.url || photoOf(p);

const markOf = (p) => p.types?.includes("toxica") ? ["☠", "Tóxica"] : { si: ["✓", "Comestible"], parcial: ["½", "En parte comestible"], no: ["✕", "No se come"] }[p.edible_human] || ["?", "Sin datos"];

// Fila del modo índice: número romano, miniatura, nombres e indicador de comestibilidad.
function row(p) {
  const img = coverOf(p), ill = !!illuOf(p), mark = markOf(p);
  return `<li data-id="${p.id}">
    <span class="ix-num">${roman(p.number)}</span>
    <span class="ix-ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></span>
    <span class="ix-txt"><b>${esc(p.common_name)}</b><i>${esc(p.scientific_name || "")}${p.family ? " · " + esc(p.family) : ""}</i></span>
    <span class="ix-mark" title="${mark[1]}">${mark[0]}</span>
  </li>`;
}

function card(p) {
  const img = coverOf(p), ill = !!illuOf(p);
  const mark = markOf(p);
  return `<div class="card" data-id="${p.id}">
    <div class="ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></div>
    <span class="dog" title="${mark[1]}">${mark[0]}</span>
    <span class="num">${tab(p.number)}</span>
    <div class="name">${esc(p.common_name)}</div><div class="sci">${esc(p.scientific_name || "")}</div>
  </div>`;
}

const RARITY = ["Muy común", "Común", "Poco común", "Rara", "Rarísima"];
const KIND_ICON = { "árbol": "f-tree", arbol: "f-tree", arbusto: "f-shrub", hierba: "f-herb", trepadora: "f-vine", hongo: "f-mushroom" };

// Meses [3,4,5,10] → "Mar–May, Oct"
function monthRanges(ms = []) {
  const a = [...new Set(ms)].sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(i === j ? MONTHS[a[i] - 1] : `${MONTHS[a[i] - 1]}\u2060–\u2060${MONTHS[a[j] - 1]}`); i = j;
  }
  return out.join(", ");
}

// Ficha técnica: lo esencial de un vistazo, con iconos.
function factSheet(p) {
  const toxic = p.types?.includes("toxica");
  const ed = { si: ["Comestible", "ok"], parcial: ["En parte", "warn"], no: ["No se come", "no"] }[p.edible_human] || ["Sin datos", ""];
  const origin = /invasora/i.test(p.native_range || "") ? "Invasora" : /introducid|exótic|naturalizad|cultivad/i.test(p.native_range || "") ? "Introducida" : /nativ|autóctona|endémic/i.test(p.native_range || "") ? "Nativa" : "";
  const kind = (p.kind || "").toLowerCase();
  const kindIcon = KIND_ICON[kind] || (p.types?.includes("arbol") ? "f-tree" : p.types?.includes("arbusto") ? "f-shrub" : p.types?.includes("hongo") ? "f-mushroom" : "f-herb");
  const tile = (icon, k, v, cls = "") => v ? `<div class="fact ${cls}"><svg><use href="#${icon}"/></svg><span class="fk">${k}</span><span class="fv">${esc(v)}</span></div>` : "";
  return `<div class="facts">
    ${tile("f-edible", "Comestible", ed[0], ed[1])}
    ${tile(toxic ? "f-skull" : "f-shield", "Toxicidad", toxic ? "Tóxica" : "Sin avisos", toxic ? "bad" : "ok")}
    ${tile(kindIcon, "Porte", kind ? kind[0].toUpperCase() + kind.slice(1) : "")}
    ${tile("f-family", "Familia", p.family)}
    ${tile("f-flower", "Florece", monthRanges(p.flower_months))}
    ${tile("f-fruit", "Fruto", monthRanges(p.fruit_months))}
    ${tile("f-globe", "Origen", origin)}
    ${tile("f-pin", "Hallada", [p.location_name?.split(",")[0], p.found_at && new Date(p.found_at + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · "))}
  </div>${p.lat ? `<div class="maplink"><a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank">Ver el lugar en el mapa</a></div>` : ""}`;
}

async function renderDetail(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  await signUrls(p.photos || []);
  const ill = cfg.illustrations && p.scientific_name ? await findIllustration(p.scientific_name) : null;
  // Figuras: primero la lámina antigua (si hay), después las fotos propias.
  const figs = [
    ...(ill ? [{ src: ill.url, cap: `Lámina antigua · ${esc(ill.credit)} · <a href="${ill.page}" target="_blank">${esc(ill.license)}</a>`, illu: true }] : []),
    ...(p.photos || []).map((x, i) => ({ src: urlCache.get(x), cap: i === 0 ? "Foto principal" : "Foto de campo", photo: i })).filter((f) => f.src),
  ];
    // Sección desplegable: se abre/cierra tocando el título.
  const fold = (title, body) => body ? `<details class="fold"><summary><span>${title}</span><svg><use href="#f-chev"/></svg></summary><div class="fold-body">${body}</div></details>` : "";
  const note = (txt) => (txt ? `<div class="field-note">${esc(txt)}</div>` : "");
  const hasMonths = p.flower_months?.length || p.fruit_months?.length;
  const idx = plants.findIndex((x) => x.id === id);
  const prev = plants[idx + 1], next = plants[idx - 1];
  $app.innerHTML = `
    <button class="back" onclick="location.hash='list'">← Herbarium</button>
    <div class="plate-head">
      <div class="tab">TABULA ${roman(p.number)}</div>
      <h2>${esc(p.common_name)}</h2>
      <div class="sci">${esc(p.scientific_name || "species ignota")}</div>
      ${p.other_names ? `<div class="muted" style="font-size:15px">${esc(p.other_names)}</div>` : ""}
      <div class="rarity" title="Rareza en la zona del hallazgo">${[1, 2, 3, 4, 5].map((i) => `<svg class="${i <= (p.rarity || 1) ? "on" : ""}"><use href="#f-star"/></svg>`).join("")}<span>${RARITY[(p.rarity || 1) - 1]}</span></div>
    </div>
    ${figs[0] ? `<figure class="hero" style="margin:0"><img id="hero" class="${figs[0].illu ? "illu" : ""}" src="${figs[0].src}" alt="">
      <figcaption><span id="figcap">Fig. I · ${figs[0].cap}</span></figcaption></figure>` : ""}
    ${figs.length > 1 ? `<div class="thumbs">${figs.map((f, i) => `<img src="${f.src}" data-i="${i}" class="${f.illu ? "illu" : ""} ${i === 0 ? "on" : ""}">`).join("")}</div>` : ""}
    <div class="row fig-actions" id="figact"></div>
    ${typeBadges(p.types)}
    ${factSheet(p)}
    ${p.description ? `<div class="field-note dropcap lead-desc">${esc(p.description)}</div>` : ""}
    <div class="folds">
      ${fold("Patria · origen", note(p.native_range))}
      ${fold("Kalendarium", hasMonths ? monthsBar(p.flower_months, p.fruit_months) + legend : "")}
      ${fold("Esculenta · comestibilidad", note(p.edibility_notes))}
      ${fold("Usus · usos", note(p.uses))}
      ${fold("Historia", note(p.history))}
      ${fold("Curiosa", p.curiosity ? `<div class="curio">“${esc(p.curiosity)}”</div>` : "")}
      ${fold("Notae · mis notas", note(p.notes))}
    </div>
    ${p.ai_confidence ? `<div class="meta">Confianza de la identificación: ${esc(p.ai_confidence)}</div>` : ""}
    <div class="disclaimer">Una foto puede engañar. Antes de comer algo silvestre, confirmalo con alguien que sepa.</div>
    <div class="row" style="margin-top:18px">
      <button class="btn" onclick="location.hash='edit/${p.id}'">Editar</button>
      <button class="btn ghost" id="del">Arrancar la lámina</button>
    </div>
    <div class="row" style="margin-top:14px">
      ${prev ? `<button class="btn ghost" onclick="location.hash='plant/${prev.id}'">← ${tab(prev.number)}</button>` : "<span></span>"}
      ${next ? `<button class="btn ghost" onclick="location.hash='plant/${next.id}'">${tab(next.number)} →</button>` : "<span></span>"}
    </div>`;
  const showFig = (i) => {
    const f = figs[i]; if (!f) return;
    const hero = $app.querySelector("#hero"); hero.src = f.src; hero.classList.toggle("illu", !!f.illu);
    $app.querySelector("#figcap").innerHTML = `Fig. ${roman(i + 1)} · ${f.cap}`;
    $app.querySelectorAll(".thumbs img").forEach((t) => t.classList.toggle("on", +t.dataset.i === i));
    const act = $app.querySelector("#figact");
    act.innerHTML = f.photo > 0 ? `<button class="btn ghost" id="mkmain">Usar como foto principal</button>`
      : f.illu ? `<button class="btn ghost" id="noillu">No es esta planta: quitar lámina</button>` : "";
    act.querySelector("#mkmain")?.addEventListener("click", async () => {
      const photos = [p.photos[f.photo], ...p.photos.filter((_, k) => k !== f.photo)];
      const { error } = await sb.from("plants").update({ photos }).eq("id", p.id);
      if (error) return toast(error.message);
      p.photos = photos; toast("Foto principal actualizada"); renderDetail(p.id);
    });
    act.querySelector("#noillu")?.addEventListener("click", () => {
      illuCache[illuKey(p.scientific_name)] = false; saveIllu(); toast("Lámina quitada"); renderDetail(p.id);
    });
  };
  $app.querySelectorAll(".thumbs img").forEach((t) => (t.onclick = () => showFig(+t.dataset.i)));
  if (figs.length) showFig(0);
  $app.querySelector("#del").onclick = async () => {
    if (!confirm(`¿Arrancar la lámina de ${p.common_name}? Se borra para siempre.`)) return;
    if (p.photos?.length) await sb.storage.from(BUCKET).remove(p.photos);
    const { error } = await sb.from("plants").delete().eq("id", p.id);
    if (error) return toast(error.message);
    plants = plants.filter((x) => x.id !== p.id); go("list");
  };
}

// ---------- borrador persistente ----------
// Android a veces recarga la página al volver de la cámara: guardamos fotos y datos del borrador en IndexedDB.
const idb = (() => {
  let dbp;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("plantdex", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction("kv", mode); const req = fn(t.objectStore("kv")); t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error); });
  };
  return {
    get: (k) => tx("readonly", (st) => st.get(k)).catch(() => null),
    set: (k, val) => tx("readwrite", (st) => st.put(val, k)).catch(() => {}),
    del: (k) => tx("readwrite", (st) => st.delete(k)).catch(() => {}),
  };
})();
const saveDraft = () => { if (draft && !draft.editing) idb.set("draft", { blobs: draft.files.map((f) => f.blob), data: draft.data, hint: draft.hint, mode: draft.mode }); };
const clearDraft = () => { draft = null; idb.del("draft"); };
async function restoreDraft() {
  const sd = await idb.get("draft");
  if (!sd || (!sd.blobs?.length && !sd.data?.common_name)) return;
  draft = { files: (sd.blobs || []).map((b) => ({ blob: b, url: URL.createObjectURL(b) })), data: sd.data || {}, hint: sd.hint, mode: sd.mode || "ai" };
}

// ---------- alta ----------
// Abre cámara o galería; al elegir, suma las fotos al borrador y muestra la lámina nueva.
function pickPhotos(source) {
  const input = document.getElementById(source === "camera" ? "file-input" : "file-input-gallery");
  input.value = "";
  input.onchange = async () => {
    if (!input.files.length) return;
    if (draft?.editing) draft = null;
    if (!draft) draft = { files: [], data: {}, mode: cfg.aiKey ? "ai" : "chat" };
    for (const f of [...input.files].slice(0, 4 - draft.files.length)) { const blob = await resizeImage(f); draft.files.push({ blob, url: URL.createObjectURL(blob) }); }
    saveDraft();
    if (location.hash === "#new") renderNew(); else location.hash = "new";
  };
  input.click();
}

function openSheet() {
  const sheet = document.getElementById("sheet");
  sheet.hidden = false;
  const close = () => (sheet.hidden = true);
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  sheet.querySelector("#sh-cam").onclick = () => { close(); pickPhotos("camera"); };
  sheet.querySelector("#sh-gal").onclick = () => { close(); pickPhotos("gallery"); };
  sheet.querySelector("#sh-cancel").onclick = close;
}

function renderNew() {
  if (draft?.editing) draft = null;
  if (!draft) draft = { files: [], data: {}, mode: cfg.aiKey ? "ai" : "chat" };
  const has = draft.files.length > 0;
  const m = draft.mode;
  $app.innerHTML = `
    <button class="back" onclick="draft=null;location.hash='list'">← Cancelar</button>
    <h2>Nueva lámina</h2>
    <p class="muted">De 1 a 4 fotos: la planta entera, una hoja de cerca, y la flor o el fruto si tiene.</p>
    <div class="drop">
      <div class="row"><button class="btn red" id="cam">Cámara</button><button class="btn" id="gal">Galería</button></div>
      <div class="preview" id="prev"></div>
    </div>
    ${draft.data.common_name ? `<div class="resume"><span>Tenés una ficha a medio hacer: <b>${esc(draft.data.common_name)}</b></span><button class="btn primary" id="resume">Seguir</button></div>` : ""}
    <label>Dónde estás</label><input id="place" placeholder="se detecta solo con el GPS, o escribilo" value="${esc(draft.data.location_name || "")}">
    <label>Pista (opcional)</label><input id="hint" placeholder="ej: a orillas de un río, huele a anís" value="${esc(draft.hint || "")}">
    <div class="tabs">
      <button data-m="ai" class="${m === "ai" ? "on" : ""}">Automático</button>
      <button data-m="chat" class="${m === "chat" ? "on" : ""}">Con mi chat</button>
      <button data-m="manual" class="${m === "manual" ? "on" : ""}">A mano</button>
    </div>
    <div id="mode"></div>`;
  const prev = $app.querySelector("#prev");
  prev.innerHTML = draft.files.map((f, i) => `<div><img src="${f.url}"><button data-i="${i}">×</button></div>`).join("");
  prev.querySelectorAll("button").forEach((b) => (b.onclick = () => { draft.files.splice(+b.dataset.i, 1); saveDraft(); renderNew(); }));
  $app.querySelector("#resume")?.addEventListener("click", () => renderForm(null));
  $app.querySelector("#cam").onclick = () => pickPhotos("camera");
  $app.querySelector("#gal").onclick = () => pickPhotos("gallery");
  $app.querySelector("#hint").oninput = (e) => (draft.hint = e.target.value);
  $app.querySelector("#place").oninput = (e) => (draft.data.location_name = e.target.value);
  $app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { draft.mode = b.dataset.m; renderNew(); }));

  const box = $app.querySelector("#mode");
  if (m === "ai") {
    box.innerHTML = `<p class="muted">Gemini mira las fotos y completa la ficha. Después la revisás.</p>
      <button class="btn primary" id="ai" style="width:100%" ${has ? "" : "disabled"}>Identificar</button><div id="status"></div>`;
    box.querySelector("#ai").onclick = async () => {
      const st = box.querySelector("#status");
      st.innerHTML = `<div class="scanning"><span class="leaf">${EMBLEM}</span><p><i>Consultando los tratados…</i></p></div>`;
      const say = (t) => { const el = st.querySelector("p i"); if (el) el.textContent = t; };
      try { draft.data = { ...draft.data, ...(await identify(draft.files.map((f) => f.blob), draft.hint, placeCtx(), say)) }; saveDraft(); renderForm(null); }
      catch (e) { st.innerHTML = `<p class="muted">No pude identificarla: ${esc(e.message)}</p>`; }
    };
  } else if (m === "chat") {
    box.innerHTML = `
      <ol class="steps">
        <li>Copiá el prompt y abrí ChatGPT o Claude.</li>
        <li>Pegalo y adjuntá las mismas fotos.</li>
        <li>Copiá la respuesta entera y pegala acá abajo.</li>
      </ol>
      <div class="row"><button class="btn" id="copy">Copiar prompt</button>
        <a class="btn" href="https://chatgpt.com/" target="_blank">ChatGPT</a><a class="btn" href="https://claude.ai/new" target="_blank">Claude</a></div>
      <details><summary>Ver prompt</summary><div class="prompt-box">${esc(buildPrompt(draft.hint, placeCtx()))}</div></details>
      <label>Respuesta del chat</label><textarea id="paste" placeholder='{ "common_name": … }'></textarea>
      <button class="btn primary" id="useit" style="width:100%;margin-top:12px">Completar la ficha</button>`;
    box.querySelector("#copy").onclick = async () => {
      try { await navigator.clipboard.writeText(buildPrompt(draft.hint, placeCtx())); toast("Prompt copiado"); } catch { toast("No pude copiar: abrí «Ver prompt» y copialo a mano"); }
    };
    box.querySelector("#useit").onclick = () => {
      try { draft.data = { ...draft.data, ...normalizeAI(v("paste")) }; saveDraft(); renderForm(null); }
      catch (e) { toast("No entendí la respuesta: " + e.message); }
    };
  } else {
    box.innerHTML = `<p class="muted">Completás vos cada campo. Ideal si ya sabés qué es.</p>
      <button class="btn" id="manual" style="width:100%">Abrir ficha en blanco</button>`;
    box.querySelector("#manual").onclick = () => renderForm(null);
  }
  getLocation();
}

function getLocation() {
  if (draft.data.lat || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const d = draft?.data; if (!d) return;
    d.lat = pos.coords.latitude; d.lng = pos.coords.longitude;
    if (d.location_name) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=es&lat=${d.lat}&lon=${d.lng}`);
      const a = (await r.json()).address || {};
      d.location_name = [a.village || a.town || a.city || a.municipality, a.state || a.region, a.country].filter(Boolean).join(", ");
      const el = document.getElementById("place"); if (el && !el.value) el.value = d.location_name;
    } catch {}
  }, () => {}, { timeout: 8000 });
}

function placeCtx() {
  const d = draft?.data || {};
  return [d.location_name, d.lat ? `(${d.lat.toFixed(3)}, ${d.lng.toFixed(3)})` : ""].filter(Boolean).join(" ");
}

// Sube fotos nuevas a una lámina ya guardada y las suma al final.
function addPhotosTo(p, source) {
  const input = document.getElementById(source === "camera" ? "file-input" : "file-input-gallery");
  input.value = "";
  input.onchange = async () => {
    if (!input.files.length) return;
    toast("Subiendo fotos…");
    try {
      const added = [];
      for (const f of [...input.files].slice(0, 6)) {
        const blob = await resizeImage(f);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        urlCache.set(path, URL.createObjectURL(blob)); added.push(path);
      }
      const photos = [...(p.photos || []), ...added];
      const { error } = await sb.from("plants").update({ photos }).eq("id", p.id);
      if (error) throw error;
      p.photos = photos; draft.data.photos = photos;
      const box = document.getElementById("edphotos");
      if (box) box.innerHTML = photos.map((ph) => `<div><img src="${urlCache.get(ph) || ""}"></div>`).join("");
      toast(added.length === 1 ? "Foto agregada" : `${added.length} fotos agregadas`);
    } catch (e) { toast("Error al subir: " + e.message); }
  };
  input.click();
}

function renderEdit(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  draft = { files: [], data: { ...p }, editing: true };
  renderForm(p);
}

function renderForm(existing) {
  const d = draft.data;
  d.flower_months ||= []; d.fruit_months ||= [];
  const opt = (map, cur, idx) => Object.keys(map).map((k) => `<option value="${k}" ${(cur || "desconocido") === k ? "selected" : ""}>${map[k][idx]}</option>`).join("");
  const ta = (id, label) => `<label>${label}</label><textarea id="${id}">${esc(d[id] || "")}</textarea>`;
  $app.innerHTML = `
    <button class="back" id="bk">← Volver</button>
    <h2>${existing ? "Corregir " + tab(existing.number) : "Redactar la lámina"}</h2>
    ${d.ai_confidence ? `<p class="muted"><i>Confianza de la identificación: ${esc(d.ai_confidence)}</i></p>` : ""}
    ${existing ? `<label>Fotos</label><div class="preview" id="edphotos">${(existing.photos || []).map((ph) => `<div><img src="${urlCache.get(ph) || ""}"></div>`).join("")}</div>
      <div class="row"><button class="btn" id="addcam">Sacar foto</button><button class="btn" id="addgal">Agregar de la galería</button></div>` : ""}
    <label>Nombre común *</label><input id="common_name" value="${esc(d.common_name || "")}">
    <label>Otros nombres</label><input id="other_names" placeholder="España: … · Latinoamérica: … · Inglés: …" value="${esc(d.other_names || "")}">
    <label>Origen y distribución</label><input id="native_range" value="${esc(d.native_range || "")}">
    <div class="row"><div><label>Nombre científico</label><input id="scientific_name" value="${esc(d.scientific_name || "")}"></div>
    <div><label>Familia</label><input id="family" value="${esc(d.family || "")}"></div></div>
    <label>Tipos</label>
    <div class="chips" id="types">${TYPES.map((t) => `<span class="chip ${d.types?.includes(t) ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>
    <div class="row"><div><label>¿Es comestible?</label><select id="edible_human">${opt(HUMAN, d.edible_human, 0)}</select></div>
</div>
    <label>Floración: tocá los meses</label>${monthsBar(d.flower_months, [], "flm")}
    <label>Fruto o cosecha</label>${monthsBar([], d.fruit_months, "frm")}
    <label>Rareza: <span id="rv" class="stars">${stars(d.rarity || 1)}</span></label><input id="rarity" type="range" min="1" max="5" value="${d.rarity || 1}">
    ${ta("description", "Descripción")}${ta("edibility_notes", "Comestibilidad")}
    ${ta("uses", "Usos")}${ta("history", "Historia")}${ta("curiosity", "Dato curioso")}${ta("notes", "Mis notas")}
    <div class="row"><div><label>Lugar</label><input id="location_name" placeholder="ej: Taconera, Pamplona, España" value="${esc(d.location_name || "")}"></div>
    <div><label>Fecha</label><input id="found_at" type="date" value="${esc(d.found_at || new Date().toISOString().slice(0, 10))}"></div></div>
    <div class="row" style="margin-top:22px"><button class="btn red" id="save">${existing ? "Guardar cambios" : "Asentar en el herbario"}</button></div>`;
  $app.querySelector("#bk").onclick = () => (existing ? (location.hash = "plant/" + existing.id) : renderNew());
  $app.querySelectorAll("#types .chip").forEach((c) => (c.onclick = () => c.classList.toggle("on")));
  if (existing) {
    $app.querySelector("#addcam").onclick = () => addPhotosTo(existing, "camera");
    $app.querySelector("#addgal").onclick = () => addPhotosTo(existing, "gallery");
  }
  $app.querySelector("#rarity").oninput = (e) => ($app.querySelector("#rv").textContent = stars(+e.target.value));
  [["flm", "flower_months", "fl"], ["frm", "fruit_months", "fr"]].forEach(([id, key, cls]) =>
    $app.querySelectorAll(`#${id} span`).forEach((s) => (s.onclick = () => {
      const n = +s.dataset.m, arr = d[key];
      d[key] = arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n].sort((a, b) => a - b);
      s.classList.toggle(cls);
    })));
  $app.querySelector("#save").onclick = async (ev) => {
    const btn = ev.currentTarget;
    const row = { kind: d.kind || null, lat: d.lat ?? null, lng: d.lng ?? null, ai_confidence: d.ai_confidence || null, flower_months: d.flower_months, fruit_months: d.fruit_months };
    for (const k of ["common_name", "other_names", "native_range", "scientific_name", "family", "edible_human", "description", "edibility_notes", "uses", "history", "curiosity", "notes", "location_name", "found_at"]) row[k] = v(k) || null;
    row.rarity = +v("rarity");
    row.types = [...$app.querySelectorAll("#types .chip.on")].map((c) => c.dataset.t);
    if (!row.common_name) return toast("Ponele al menos un nombre");
    if (!existing && !draft.files.length && !confirm("Esta lámina no tiene fotos. ¿La guardo igual? (Después podés agregarlas al editarla.)")) return;
    btn.disabled = true; btn.textContent = "Entintando…";
    try {
      if (existing) {
        const { data, error } = await sb.from("plants").update(row).eq("id", existing.id).select().single();
        if (error) throw error;
        plants = plants.map((x) => (x.id === data.id ? data : x));
        draft = null; location.hash = "plant/" + data.id;
      } else {
        const paths = [];
        for (const f of draft.files) {
          const path = `${user.id}/${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from(BUCKET).upload(path, f.blob, { contentType: "image/jpeg" });
          if (error) throw error;
          paths.push(path); urlCache.set(path, f.url);
        }
        row.photos = paths;
        row.number = Math.max(0, ...plants.map((x) => x.number)) + 1;
        const { data, error } = await sb.from("plants").insert(row).select().single();
        if (error) throw error;
        plants.unshift(data);
        clearDraft(); toast(`${data.common_name} asentada como Tabula ${roman(data.number)}`);
        location.hash = "plant/" + data.id;
      }
    } catch (e) { toast("Error: " + e.message); btn.disabled = false; btn.textContent = "Reintentar"; }
  };
}

// ---------- Kalendarium ----------
function renderCalendar() {
  const cur = nowMonth();
  const order = [...Array(12)].map((_, i) => ((cur - 1 + i) % 12) + 1);
  const item = (p, what) => `<div class="cal-item" data-id="${p.id}"><div class="ph" data-sci="${esc(p.scientific_name || "")}" style="${coverOf(p) ? `background-image:url('${coverOf(p)}')` : ""}"></div>${esc(p.common_name)}<small>${what}</small></div>`;
  const block = (m) => {
    const fl = plants.filter((p) => p.flower_months?.includes(m));
    const fr = plants.filter((p) => p.fruit_months?.includes(m));
    if (!fl.length && !fr.length) return "";
    return `<div class="cal-month"><h3>${MONTHS_LONG[m - 1]}${m === cur ? " · ahora" : ""}</h3>
      <div class="cal-list">${fr.map((p) => item(p, "da fruto")).join("")}${fl.map((p) => item(p, "en flor")).join("")}</div></div>`;
  };
  const html = order.map(block).join("");
  $app.innerHTML = `
    <h2>Kalendarium</h2>
    <p class="muted">Qué florece y qué se puede recolectar cada mes, según tus láminas. Empieza por este mes. Los meses corresponden al lugar donde encontraste cada planta.</p>
    ${html || `<div class="empty"><div class="big">${PLANT_ART}</div><p class="lead">Todavía no hay meses cargados. La identificación automática los completa sola, o los marcás vos al editar una lámina.</p></div>`}`;
  $app.querySelectorAll(".cal-item").forEach((c) => (c.onclick = () => (location.hash = "plant/" + c.dataset.id)));
  hydrateIllustrations();
}

// ---------- progreso ----------
function renderStats() {
  const n = plants.length;
  const count = (f) => plants.filter(f).length;
  const families = new Set(plants.map((p) => p.family).filter(Boolean)).size;
  const edible = count((p) => p.edible_human === "si" || p.edible_human === "parcial");
  const toxic = count((p) => p.types?.includes("toxica"));
  const rare = count((p) => p.rarity >= 4);
  const badges = [
    ["I", "Primer brote", "Asentá tu primera lámina", n >= 1],
    ["X", "Herborista", "10 láminas", n >= 10],
    ["L", "Hortus conclusus", "50 láminas", n >= 50],
    ["R", "Recolector", "5 comestibles", edible >= 5],
    ["P", "Prudente", "3 plantas tóxicas identificadas", toxic >= 3],
    ["O", "Ojo de lince", "Una rareza de 4 estrellas o más", rare >= 1],
    ["T", "Taxónomo", "10 familias distintas", families >= 10],
    ["M", "Micólogo", "Un hongo", count((p) => p.types?.includes("hongo")) >= 1],
    ["IV", "Cuatro estaciones", "Hallazgos en 4 meses distintos", new Set(plants.map((p) => (p.found_at || "").slice(5, 7)).filter(Boolean)).size >= 4],
  ];
  const fam = Object.entries(plants.reduce((a, p) => (p.family && (a[p.family] = (a[p.family] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $app.innerHTML = `
    <h2>Progressus</h2>
    <p class="muted"><i>Herbarium numquam finitur.</i> El herbario nunca se termina.</p>
    <div class="stat-grid">
      <div class="stat"><b>${n}</b>láminas</div>
      <div class="stat"><b>${families}</b>familias</div>
      <div class="stat"><b>${edible}</b>comestibles</div>
      <div class="stat"><b>${toxic}</b>tóxicas</div>
    </div>
    ${fam.length ? `<h3>Familias más vistas</h3>${fam.map(([f, c]) => `<div class="entry-head"><span class="sci">${esc(f)}</span><span class="tally">${"✦".repeat(Math.min(c, 12))} <b>${c}</b></span></div>`).join("")}` : ""}
    <h3>Insignias</h3>
    <div class="badge-list">${badges.map(([e, t, d, ok]) => `<div class="badge ${ok ? "" : "locked"}"><div class="e">${e}</div><b>${t}</b><div class="muted" style="font-size:14px">${d}</div></div>`).join("")}</div>`;
}

Object.defineProperty(window, "draft", { get: () => draft, set: (x) => (x ? (draft = x) : clearDraft()) });
boot();
