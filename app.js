import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// ---------- configuración local ----------
const CFG_KEY = "plantdex.cfg";
// Cada persona conecta su propio Supabase desde el asistente de primeros pasos.
const defaults = { sbUrl: "", sbKey: "", engrave: true, illustrations: true, theme: "auto" };
const loadCfg = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; } catch { return { ...defaults }; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
let cfg = loadCfg();

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
// Aviso breve; con `action` = [texto, fn] suma un botón (por ejemplo «Deshacer») y dura un poco más.
const toast = (msg, action) => {
  const t = document.getElementById("toast");
  t.textContent = msg;
  if (action) { const b = document.createElement("button"); b.className = "toast-act"; b.textContent = action[0]; b.onclick = () => { t.classList.remove("show"); action[1](); }; t.append(b); }
  t.classList.toggle("has-act", !!action); t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), action ? 6000 : 3000);
};
const nowMonth = () => new Date().getMonth() + 1;

function roman(n) {
  const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = ""; for (const [k, s] of map) while (n >= k) { out += s; n -= k; } return out;
}

// ---------- arranque ----------
// ---------- tema claro / oscuro ----------
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = cfg.theme === "light" || cfg.theme === "dark" ? cfg.theme : darkQuery.matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#121a14" : "#f7f2e3");
}
darkQuery.addEventListener?.("change", () => cfg.theme === "auto" && applyTheme());

// ---------- enlace de configuración ----------
// ?c=<base64url de {u, k}>: la URL del proyecto y su clave publishable (pública por diseño, protegida por RLS).
const b64u = { enc: (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (t) => JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, "+").replace(/_/g, "/"))))) };
const shareLink = () => SITE_URL() + "?c=" + b64u.enc({ u: cfg.sbUrl, k: cfg.sbKey });
function readConfigLink() {
  const c = new URLSearchParams(location.search).get("c");
  if (!c) return;
  history.replaceState(null, "", SITE_URL() + location.hash);
  try {
    const { u, k } = b64u.dec(c);
    if (!/^https:\/\/.+\.supabase\.co$/.test(u) || !k) throw 0;
    if (cfg.sbUrl === u && cfg.sbKey === k) return;
    if (cfg.sbUrl && !confirm("Este enlace conecta la app a otro herbario. ¿Cambiar?")) return;
    cfg = { ...cfg, sbUrl: u, sbKey: k }; saveCfg(cfg);
    setTimeout(() => toast("Herbario configurado. Entrá con tu email."), 300);
  } catch { setTimeout(() => toast("El enlace de configuración no es válido"), 300); }
}

async function boot() {
  applyTheme();
  readConfigLink();
  document.body.classList.toggle("engrave", !!cfg.engrave);
  document.getElementById("btn-settings").onclick = () => go("settings");
  document.getElementById("btn-home").onclick = () => go("list");
  $nav.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (b.dataset.go === "new" ? openSheet() : go(b.dataset.go))));
  window.addEventListener("hashchange", route);

  if (!cfg.sbUrl || !cfg.sbKey) return renderSetup();
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
  if (!sb) return renderSetup();
  if (view === "settings") return renderSettings();
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
const byName = new Intl.Collator("es", { sensitivity: "base" });
const sortPlants = (list) => list.sort((a, b) => byName.compare(a.common_name || "", b.common_name || ""));
async function loadPlants() {
  const { data, error } = await sb.from("plants").select("*").order("number", { ascending: false });
  if (error) { toast("Error cargando: " + error.message); return; }
  plants = sortPlants(data);
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

// ---------- completar estado de conservación en lote ----------
const missingIucn = () => plants.filter((p) => !p.iucn && p.scientific_name);
let iucnAll = false; // true: volver a consultar todas, no solo las que faltan
const iucnTargets = () => (iucnAll ? plants.filter((p) => p.scientific_name) : missingIucn());
const iucnBatchPrompt = () => `Para cada especie, decime su estado de conservación GLOBAL en la Lista Roja de la UICN (LC, NT, VU, EN, CR, EW, EX, DD o NE si no fue evaluada; no inventes).
Respondé SOLO con un JSON así: {"Género especie": "LC", ...}
${iucnTargets().map((p) => "- " + p.scientific_name).join("\n")}`;
function iucnBatchBox() {
  if (!plants.length) return "";
  const n = missingIucn().length;
  const status = n ? `<b>${n === 1 ? "1 lámina" : n + " láminas"}</b> sin estado de conservación.` : "Todas tus láminas tienen estado de conservación.";
  const open = n > 0 || iucnAll;
  return `<div class="iucn-box" id="iucnbox">
    <h3>Estado de conservación</h3>
    <p class="muted" style="margin-top:0">${status} ${open ? "Copiá el prompt, pegalo en ChatGPT o Claude, y pegá acá la respuesta." : ""}</p>
    ${open ? `
      <div class="row"><button class="btn" id="iucncopy">Copiar prompt</button></div>
      <details><summary>Ver prompt</summary><div class="prompt-box">${esc(iucnBatchPrompt())}</div></details>
      <label>Respuesta</label><textarea id="iucnpaste" placeholder='{ "Ilex aquifolium": "LC" }'></textarea>
      <button class="btn primary" id="iucnapply" style="width:100%;margin-top:12px">Actualizar láminas</button>`
    : `<button class="btn ghost" id="iucnall">Volver a consultar todas</button>`}
  </div>`;
}
function bindIucnBatch() {
  $app.querySelector("#iucnall")?.addEventListener("click", () => { iucnAll = true; renderSettings(); });
  if (location.hash.includes("iucn")) setTimeout(() => document.getElementById("iucnbox")?.scrollIntoView({ block: "start" }), 50);
  $app.querySelector("#iucncopy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(iucnBatchPrompt()); toast("Prompt copiado"); } catch { toast("No pude copiar: abrí «Ver prompt»"); }
  });
  $app.querySelector("#iucnapply")?.addEventListener("click", async (ev) => {
    let map;
    try { map = JSON.parse(String(v("iucnpaste")).match(/\{[\s\S]*\}/)[0]); } catch { return toast("No entendí la respuesta"); }
    const norm = Object.fromEntries(Object.entries(map).map(([k, c]) => [illuKey(k), normIucn(c)]));
    const todo = iucnTargets().map((p) => [p, norm[illuKey(p.scientific_name)]]).filter(([, c]) => c);
    if (!todo.length) return toast("No encontré ninguna de tus especies en la respuesta");
    ev.currentTarget.disabled = true;
    for (const [p, c] of todo) {
      const { error } = await sb.from("plants").update({ iucn: c }).eq("id", p.id);
      if (error) { toast(/iucn/i.test(error.message) ? "Falta actualizar la base: corré en Supabase la línea SQL de «iucn»" : error.message); ev.currentTarget.disabled = false; return; }
      p.iucn = c;
    }
    iucnAll = false;
    toast(todo.length === 1 ? "1 lámina actualizada" : `${todo.length} láminas actualizadas`);
    renderSettings();
  });
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

// ---------- IA ----------
const buildPrompt = (hint = "", place = "") => `Sos un botánico divulgador, de esos que hacen que cualquiera se interese por las plantas. Identificá la planta, hongo o fruto de las fotos.
Lugar del hallazgo: ${place || "desconocido"}. Usalo SOLO para ayudarte a identificarla y para saber en qué hemisferio está (meses de flor y fruto). Los textos NO deben mencionar las fotos, el ejemplar fotografiado ni el lugar del hallazgo: hablá de la especie en general.

TONO: cercano, claro y con ganas de contar. Frases cortas, vocabulario de todos los días, nada de jerga técnica (si usás un término botánico, explicalo en tres palabras). Ni solemne ni chistoso: como un buen documental o un amigo que sabe mucho. Español neutro.

Respondé SOLO con un bloque JSON válido, con esta forma exacta:
{
 "common_name": "nombre común en español de España",
 "other_names": "solo en este formato: 'España: … · Latinoamérica: … · Inglés: …'. Poné Latinoamérica únicamente si el nombre cambia (y aclará el país si varía, ej. 'Argentina: …'). NO incluyas euskera, catalán, gallego ni otras lenguas cooficiales o regionales",
 "scientific_name": "Género especie",
 "family": "Familia",
 "kind": "árbol | arbusto | hierba | trepadora | hongo | otro",
 "types": [elegí de: ${TYPES.join(", ")}],
 "edible_human": "si | parcial | no | desconocido",
 "parts": {usos de la planta. Incluí SOLO los que apliquen, con estas claves: comer, medicina, toxica, otro (madera, aceite, tintes, aroma, jardín…). Cada uno: {"partes": [de: hoja, flor, fruto, semilla, raiz, tallo], "nota": "qué parte se usa y cómo, o por qué es peligrosa; 1-2 frases claras"}},
 "description": "2-3 frases para alguien que no sabe nada de botánica. Empezá por lo que la hace conocida o cercana (dónde la vio todo el mundo, para qué se usa, por qué es famosa) y terminá con cómo reconocerla de un vistazo. Ej.: 'Es la decoración navideña por excelencia…'",
 "origin": "región de origen en 1-4 palabras, ej. 'Mediterráneo', 'Norteamérica', 'Asia oriental'",
 "native_range": "de dónde es originaria y por dónde se extendió por el mundo; si es invasora en alguna región, decilo",
 "edibility_notes": "qué partes se comen y cómo, o por qué no; con qué se puede confundir y qué riesgos hay. Claro y directo",
 "uses": "para qué la usamos: cocina, remedios tradicionales, oficios, jardín",
 "history": "historia, mitos o etimología contados como una buena anécdota, 2-4 frases",
 "curiosity": "un fun fact de verdad, de esos que hacen decir '¡no lo sabía!': su aparición en la cultura popular (películas, libros, refranes, expresiones del idioma, marcas, deportes), una leyenda, una anécdota histórica rara o un uso inesperado. NO repitas datos de botánica básica (machos y hembras, cómo se reproduce, cuántas semillas da) ni lo que ya contaste en history. 1-3 frases",
 "flower_months": [meses 1-12 en que suele florecer en su zona habitual, en el hemisferio del hallazgo],
 "fruit_months": [meses 1-12 en que suele dar fruto o cosecharse, mismo criterio],
 "iucn": "estado de conservación GLOBAL de la especie en la Lista Roja de la UICN: LC | NT | VU | EN | CR | EW | EX | DD | NE (NE si no fue evaluada; no inventes)"
}
Ante la duda sé conservador con la comestibilidad: usá "desconocido".
En description, native_range, edibility_notes, uses, history y curiosity marcá con **doble asterisco** entre 2 y 4 palabras o frases clave por campo (partes que se comen, advertencias, usos principales, fechas, personajes o lugares históricos). No marques frases enteras.${hint ? `\nPista del usuario para identificarla: ${hint}` : ""}`;

function normalizeAI(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No encontré un JSON en la respuesta");
  const out = JSON.parse(m[0]);
  const months = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 12) : []);
  out.types = (out.types || []).map((t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter((t) => TYPES.includes(t));
  out.flower_months = months(out.flower_months);
  out.fruit_months = months(out.fruit_months);
  delete out.confidence;
  out.iucn = normIucn(out.iucn);
  out.parts = normParts(out.parts);
  delete out.rarity;
  return out;
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
    ${user ? iucnBatchBox() : ""}
    <p class="muted">Las claves se guardan solo en este dispositivo. En el README está cómo sacar cada una, todas gratis.</p>
    <h3>Supabase · tu nube</h3>
    <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.sbUrl)}">
    <label>Anon / publishable key</label><input id="sbKey" placeholder="eyJ… o sb_publishable_…" value="${esc(cfg.sbKey)}">
    <h3>Apariencia</h3>
    <label>Tema</label>
    <div class="theme-pick">${[["light", "Claro"], ["dark", "Oscuro"], ["auto", "Automático"]].map(([k, l]) => `<button data-theme-pick="${k}" class="${(cfg.theme || "auto") === k ? "on" : ""}"><i class="sw-${k}"></i>${l}</button>`).join("")}</div>
    <label class="toggle"><input type="checkbox" id="engrave" ${cfg.engrave ? "checked" : ""}> Fotos con filtro de grabado antiguo</label>
    <label class="toggle"><input type="checkbox" id="illustrations" ${cfg.illustrations ? "checked" : ""}> Usar láminas antiguas de Wikimedia Commons como imagen principal</label>
    <div class="row" style="margin-top:22px"><button class="btn primary" id="save">Guardar</button></div>
    ${user ? `<hr><p class="muted" style="text-align:center">Sesión: ${esc(user.email)}</p>
      <div class="share-box"><h3>Enlace de configuración</h3>
        <p class="muted" style="margin-top:0">Abrilo en otro celular o navegador y la app queda conectada a este herbario: solo te pide el email. Contiene la dirección de tu nube y su clave pública, no tu contraseña.</p>
        <button class="btn" id="sharecfg" style="width:100%">Compartir enlace</button></div>
      <div class="row"><button class="btn" id="export">Exportar backup</button><button class="btn ghost" id="logout">Cerrar sesión</button></div>
` : ""}
  `;
  $app.querySelectorAll("[data-theme-pick]").forEach((b) => (b.onclick = () => {
    cfg.theme = b.dataset.themePick; saveCfg(cfg); applyTheme();
    $app.querySelectorAll("[data-theme-pick]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $app.querySelector("#sharecfg")?.addEventListener("click", async () => {
    const url = shareLink();
    try { if (navigator.share) return await navigator.share({ title: "Herbalorium", text: "Mi herbario en Herbalorium", url }); } catch { return; }
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch { prompt("Copiá este enlace:", url); }
  });
  $app.querySelector("#save").onclick = () => {
    const prevSb = cfg.sbUrl + cfg.sbKey;
    cfg = { ...cfg, sbUrl: v("sbUrl").replace(/\/(rest\/v1\/?)?$/, ""), sbKey: v("sbKey"), engrave: document.getElementById("engrave").checked, illustrations: document.getElementById("illustrations").checked };
    saveCfg(cfg);
    document.body.classList.toggle("engrave", cfg.engrave);
    toast("Guardado");
    if (prevSb !== cfg.sbUrl + cfg.sbKey) location.replace(location.pathname);
    else go("list");
  };
  $app.querySelector("#logout")?.addEventListener("click", async () => { await sb.auth.signOut(); go("list"); });
  bindIucnBatch();
  $app.querySelector("#export")?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(plants, null, 2)], { type: "application/json" }));
    a.download = `herbalorium-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
}

// ---------- primeros pasos: cada persona crea y conecta su propio Supabase ----------
const SITE_URL = () => location.origin + location.pathname;
function renderSetup() {
  $nav.hidden = true;
  const copyBtn = (id, label) => `<button class="btn" id="${id}" style="flex:none">${label}</button>`;
  $app.innerHTML = `
    <div class="empty" style="padding-bottom:6px"><div class="big">${PLANT_ART}</div>
      <h2>Primeros pasos</h2>
      <p class="lead">Tu herbario se guarda en tu propia nube gratuita. Se configura una sola vez y lleva unos 10 minutos.</p></div>
    <ol class="setup">
      <li><b>Creá tu nube.</b> Entrá a <a href="https://supabase.com/dashboard" target="_blank">supabase.com</a>, creá una cuenta y un proyecto nuevo (plan gratis, región Europa). No hace falta conectar GitHub.</li>
      <li><b>Prepará la base.</b> En tu proyecto andá a <i>SQL Editor → New query</i>, pegá el código y tocá <i>Run</i>.
        <div class="row" style="margin-top:8px">${copyBtn("cpsql", "Copiar código SQL")}</div></li>
      <li><b>Autorizá esta web.</b> En <i>Authentication → URL Configuration</i> pegá esta dirección en <i>Site URL</i> y también en <i>Redirect URLs</i>:
        <div class="prompt-box" style="margin-top:8px">${esc(SITE_URL())}</div><div class="row" style="margin-top:8px">${copyBtn("cpurl", "Copiar dirección")}</div></li>
      <li><b>Conectá la app.</b> En <i>Project Settings → API Keys</i> (o el botón <i>Connect</i>) copiá la <i>Project URL</i> y la <i>publishable key</i>:
        <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co">
        <label>Publishable key</label><input id="sbKey" placeholder="sb_publishable_…"></li>

    </ol>
    <button class="btn primary" id="connect" style="width:100%;margin-top:6px">Conectar mi herbario</button>
    <p class="muted" id="setupmsg" style="text-align:center"></p>
    <p class="muted" style="font-size:15px;text-align:center"><i>Cuando ya hayas entrado con tu email, conviene desactivar en Supabase «Allow new users to sign up» (Authentication → Sign In / Providers → Email) para que nadie más pueda usar tu nube.</i></p>`;
  const copy = async (txt, ok) => { try { await navigator.clipboard.writeText(txt); toast(ok); } catch { toast("No pude copiar automáticamente"); } };
  $app.querySelector("#cpurl").onclick = () => copy(SITE_URL(), "Dirección copiada");
  $app.querySelector("#cpsql").onclick = async () => {
    try { const r = await fetch("supabase/schema.sql", { cache: "no-store" }); copy(await r.text(), "Código SQL copiado"); }
    catch { toast("No pude bajar el código SQL"); }
  };
  $app.querySelector("#connect").onclick = async (ev) => {
    const url = v("sbUrl").replace(/\/(rest\/v1\/?)?$/, ""), key = v("sbKey"), msg = $app.querySelector("#setupmsg");
    if (!/^https:\/\/.+\.supabase\.co$/.test(url) || !key) return (msg.textContent = "Revisá la Project URL y la key.");
    ev.currentTarget.disabled = true; msg.textContent = "Probando la conexión…";
    try {
      const test = createClient(url, key);
      const { error } = await test.from("plants").select("id").limit(1);
      if (error && /relation|does not exist|schema cache/i.test(error.message)) throw new Error("La conexión anda, pero falta el paso 2: correr el código SQL.");
      if (error && !/permission|JWT|row-level/i.test(error.message)) throw new Error(error.message);
      cfg = { ...cfg, sbUrl: url, sbKey: key };
      saveCfg(cfg);
      location.replace(SITE_URL());
    } catch (e) { msg.textContent = e.message; ev.currentTarget.disabled = false; }
  };
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
      <button class="btn red" id="start">Comenzar el herbario</button></div>` :
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

const markOf = (p) => p.types?.includes("toxica") ? ["f-skull", "Tóxica", "tox"] : { si: ["f-edible", "Comestible", "ok"], parcial: ["f-bowl-half", "En parte comestible", "half"], no: ["f-bowl-no", "No se come", "no"] }[p.edible_human] || ["f-question", "Sin datos", "unk"];
const edibleBadge = (p, cls = "dog") => { const m = markOf(p); return `<span class="${cls} eb-${m[2]}" title="${m[1]}"><svg><use href="#${m[0]}"/></svg></span>`; };

// Medallón de conservación: hoja + anillo de 5 segmentos que se llena según la categoría UICN.
const RING = (() => {
  const seg = [], r = 17, c = 20, gap = 9;
  for (let i = 0; i < 5; i++) {
    const a0 = (-90 + i * 72 + gap / 2) * Math.PI / 180, a1 = (-90 + (i + 1) * 72 - gap / 2) * Math.PI / 180;
    seg.push(`M${(c + r * Math.cos(a0)).toFixed(2)} ${(c + r * Math.sin(a0)).toFixed(2)} A${r} ${r} 0 0 1 ${(c + r * Math.cos(a1)).toFixed(2)} ${(c + r * Math.sin(a1)).toFixed(2)}`);
  }
  return seg;
})();
function consBadge(code, cls = "cons") {
  const [label, n] = IUCN[code] || ["Sin dato de conservación", 0];
  const tier = n >= 4 ? 4 : n;
  return `<span class="${cls} ct-${tier}" title="${code && n ? code + " · " : ""}${label} (Lista Roja UICN)"><svg viewBox="0 0 40 40">
    ${RING.map((d, i) => `<path d="${d}" class="${i < n ? "on" : ""}"/>`).join("")}
    <use href="#${n ? "f-leaf" : "f-question"}" x="11" y="11" width="18" height="18"/></svg></span>`;
}

// Fila del modo índice: número romano, miniatura, nombres e indicador de comestibilidad.
function row(p) {
  const img = coverOf(p), ill = !!illuOf(p), mark = markOf(p);
  return `<li data-id="${p.id}">
    <span class="ix-ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></span>
    <span class="ix-txt"><b>${esc(p.common_name)}</b><i>${esc(p.scientific_name || "")}${p.family ? " · " + esc(p.family) : ""}</i></span>
    ${consBadge(p.iucn, "cons ix-cons")}${edibleBadge(p, "dog ix-mark")}
  </li>`;
}

function card(p) {
  const img = coverOf(p), ill = !!illuOf(p);
  const mark = markOf(p);
  return `<div class="card" data-id="${p.id}">
    <div class="ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></div>
    ${consBadge(p.iucn)}
    ${edibleBadge(p)}
    <div class="name">${esc(p.common_name)}</div><div class="sci">${esc(p.scientific_name || "")}</div>
    ${partsStrip(p)}
  </div>`;
}

// Texto con énfasis: **clave** → negrita, y las advertencias se resaltan solas.
const WARN_WORDS = /\b(t[óo]xic[oa]s?|toxicidad|venenos[oa]s?|mortal(es)?|letal(es)?|no (se )?(debe|deben)? ?(consumir|comer|ingerir)|no comestibles?|nunca [a-záéíóú]+|precauci[óo]n|peligros[oa]s?|irritante|cianog[ée]nic[oa]s?|alucin[óo]gen[oa]s?)\b/gi;
function rich(txt) {
  return esc(txt)
    .replace(WARN_WORDS, (m) => `<mark class="warn-t">${m}</mark>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*\*/g, "");
}

// Estado de conservación (Lista Roja UICN). Las estrellas miden lo difícil de encontrar en el mundo.
const IUCN = {
  LC: ["Preocupación menor", 1], NT: ["Casi amenazada", 2], VU: ["Vulnerable", 3], EN: ["En peligro", 4],
  CR: ["En peligro crítico", 5], EW: ["Extinta en estado silvestre", 5], EX: ["Extinta", 5],
  DD: ["Datos insuficientes", 0], NE: ["No evaluada", 0],
};
function normIucn(x) { const c = String(x || "").toUpperCase().match(/\b(LC|NT|VU|EN|CR|EW|EX|DD|NE)\b/); return c ? c[1] : null; }
// Ventana explicativa del estado de conservación, con todas las categorías de la UICN.
const IUCN_INFO = {
  LC: "Abundante y extendida. No enfrenta riesgos importantes.",
  NT: "Cerca de calificar como amenazada; podría estarlo pronto.",
  VU: "Riesgo alto de extinción en estado silvestre. Poco frecuente o en retroceso.",
  EN: "Riesgo muy alto de extinción. Escasa: encontrarla es excepcional.",
  CR: "Riesgo extremadamente alto. Quedan muy pocos ejemplares en la naturaleza.",
  EW: "Solo sobrevive en cultivo o en jardines botánicos, fuera de su hábitat.",
  EX: "No queda ningún ejemplar vivo conocido.",
  DD: "Fue estudiada, pero no hay datos suficientes para clasificarla.",
  NE: "La UICN todavía no la evaluó. Es lo más habitual en plantas comunes.",
};
function openIucnInfo(current) {
  const rows = ["LC", "NT", "VU", "EN", "CR", "EW", "EX", "DD", "NE"].map((c) => `<tr class="${c === current ? "cur" : ""}">
    <td>${consBadge(c, "cons tb-cons")}</td><td><b>${c}</b><span>${IUCN[c][0]}</span></td><td>${IUCN_INFO[c]}</td></tr>`).join("");
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-label="Estado de conservación">
    <button class="modal-x" aria-label="Cerrar">×</button>
    <h3>Estado de conservación</h3>
    <p>Es la clasificación de la <b>Lista Roja de la UICN</b> (Unión Internacional para la Conservación de la Naturaleza), la referencia mundial para saber cuán amenazada está una especie <i>en todo el planeta</i>. Cuantos más segmentos tiene el medallón, más difícil es encontrarla.</p>
    <table class="iucn-table"><tbody>${rows}</tbody></table>
    <p class="muted" style="font-size:15px">Es un dato global: una especie común en el mundo puede ser rara en una zona concreta, y al revés.</p>
  </div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => e.key === "Escape" && close();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  document.addEventListener("keydown", esc_);
  document.body.appendChild(m);
}

function iucnPill(code) {
  const [label, n] = IUCN[code] || ["Sin dato de conservación", 0];
  return `<div class="rarity ${n ? "" : "none"}" title="Estado de conservación global (Lista Roja UICN)">
    ${consBadge(code, "cons pill-cons")}
    <span>${code && code !== "NE" && code !== "DD" ? code + " · " : ""}${label}</span></div>`;
}
const KIND_ICON = { "árbol": "f-tree", arbol: "f-tree", arbusto: "f-shrub", hierba: "f-herb", trepadora: "f-vine", hongo: "f-mushroom" };

// ---------- usos de la planta (se guardan en la columna "parts") ----------
// Forma: { comer|medicina|toxica|otro: { partes: [hoja|flor|fruto|semilla|raiz|tallo], nota } }
const PARTS = [["hoja", "Hojas"], ["flor", "Flores"], ["fruto", "Frutos"], ["semilla", "Semillas"], ["raiz", "Raíz"], ["tallo", "Tallo y madera"]];
const USES = { comer: "Se come", medicina: "Medicinal", toxica: "Tóxica", otro: "Otros usos" };
const USE_ORDER = ["comer", "medicina", "toxica", "otro"];
const useIcon = (u) => (u === "toxica" ? "f-skull" : "u-" + u);
const plain = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function normParts(raw) {
  const out = {};
  for (const u of USE_ORDER) {
    const v = raw?.[u] || (u === "toxica" ? raw?.toxico : null);
    if (!v || !(v.nota || v.partes?.length)) continue;
    out[u] = { partes: (Array.isArray(v.partes) ? v.partes : []).map(plain).filter((k) => PARTS.some(([x]) => x === k)), nota: String(v.nota || "").slice(0, 400) };
  }
  return out;
}
const firstSentence = (t) => (String(t || "").match(/^.*?[.!?](\s|$)/) || [t || ""])[0].trim();
function ensureUses(p) {
  if (p.parts && Object.keys(p.parts).length) return p.parts;
  const u = {};
  if (["si", "parcial"].includes(p.edible_human)) u.comer = { partes: [], nota: firstSentence(p.edibility_notes) || "Comestible." };
  if (p.types?.includes("medicinal")) u.medicina = { partes: [], nota: firstSentence(p.uses) || "Tiene usos medicinales tradicionales." };
  if (p.types?.includes("toxica")) u.toxica = { partes: [], nota: firstSentence(p.edibility_notes) || "Es tóxica: no consumir." };
  return (p.parts = u);
}
const usesOf = (p) => (ensureUses(p), USE_ORDER.filter((u) => p.parts?.[u]));
// Tira compacta para la carta: los usos que tiene la planta.
const partsStrip = (p) => {
  const list = usesOf(p);
  return list.length ? `<div class="pstrip">${list.map((u) => `<span class="pchip u-${u}" title="${USES[u]}"><svg><use href="#${useIcon(u)}"/></svg></span>`).join("")}</div>` : "";
};
// Panel de la ficha: 4 botones de uso; al tocar uno, explica qué parte se usa y cómo.
function partsPanel(p) {
  if (!usesOf(p).length) return "";
  return `<div class="parts-box"><h3>Para qué sirve</h3>
    <div class="uses">${USE_ORDER.map((u) => { const on = !!p.parts[u];
      return `<button class="use ${on ? "on" : "off"} u-${u}" data-use="${u}" ${on ? "" : "disabled"}>
        <span class="use-ic"><svg><use href="#${useIcon(u)}"/></svg></span><span class="use-l">${USES[u]}</span></button>`; }).join("")}</div>
    <div class="part-note" id="partnote"></div></div>`;
}

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
// Ficha técnica compacta: datos de referencia en dos columnas, como el pie de una lámina antigua.
function factSheet(p) {
  const kind = (p.kind || "").toLowerCase();
  const kindIcon = KIND_ICON[kind] || (p.types?.includes("arbol") ? "f-tree" : p.types?.includes("arbusto") ? "f-shrub" : p.types?.includes("hongo") ? "f-mushroom" : "f-herb");
  const found = [p.location_name?.split(",")[0], p.found_at && new Date(p.found_at + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ");
  const row = (icon, k, v, extra = "") => v ? `<div class="fx"><svg><use href="#${icon}"/></svg><dt>${k}</dt><dd>${esc(v)}${extra}</dd></div>` : "";
  const rows = [
    row(kindIcon, "Porte", kind ? kind[0].toUpperCase() + kind.slice(1) : ""),
    row("f-family", "Familia", p.family),
    row("f-globe", "Origen", p.origin),
    row("f-flower", "Florece", monthRanges(p.flower_months)),
    row("f-fruit", "Fruto", monthRanges(p.fruit_months)),
    row("f-pin", "Hallada", found, p.lat ? ` <a class="maplink" href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank">mapa</a>` : ""),
  ].join("");
  return rows ? `<h3>Ficha</h3><dl class="facts2">${rows}</dl>` : "";
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
  const note = (txt) => (txt ? `<div class="field-note">${rich(txt)}</div>` : "");
  const hasMonths = p.flower_months?.length || p.fruit_months?.length;
  const idx = plants.findIndex((x) => x.id === id);
  const prev = plants[idx - 1], next = plants[idx + 1];
  $app.innerHTML = `
    <button class="back" onclick="location.hash='list'">← Herbarium</button>
    <div class="plate-head">
      <h2>${esc(p.common_name)}</h2>
      <div class="sci">${esc(p.scientific_name || "species ignota")}</div>
      ${p.other_names ? `<div class="muted" style="font-size:15px">${esc(p.other_names)}</div>` : ""}
      <div class="cons-row">${iucnPill(p.iucn)}<button class="info-btn" id="iucninfo" aria-label="Qué es el estado de conservación"><svg><use href="#f-info"/></svg></button></div>
      ${p.iucn ? "" : `<a class="fill-link" href="#settings/iucn">Completar</a>`}
    </div>
    ${figs[0] ? `<figure class="hero" style="margin:0"><img id="hero" class="${figs[0].illu ? "illu" : ""}" src="${figs[0].src}" alt="">
      <figcaption><span id="figcap">Fig. I · ${figs[0].cap}</span></figcaption></figure>` : ""}
    ${figs.length > 1 ? `<div class="thumbs">${figs.map((f, i) => `<img src="${f.src}" data-i="${i}" class="${f.illu ? "illu" : ""} ${i === 0 ? "on" : ""}">`).join("")}</div>` : ""}
    <div class="row fig-actions" id="figact"></div>
    ${!ill && cfg.illustrations && p.scientific_name ? `<div class="row fig-actions"><button class="btn ghost" id="reillu">Restaurar lámina antigua</button></div>` : ""}
    ${partsPanel(p)}
    ${p.description ? `<div class="field-note dropcap lead-desc">${rich(p.description)}</div>` : ""}
    ${factSheet(p)}
    <div class="folds">
      ${fold("Patria · origen", note(p.native_range))}
      ${fold("Kalendarium", hasMonths ? monthsBar(p.flower_months, p.fruit_months) + legend : "")}
      ${fold("Esculenta · comestibilidad", note(p.edibility_notes))}
      ${fold("Usus · usos", note(p.uses))}
      ${fold("Historia", note(p.history))}
      ${fold("Curiosa", p.curiosity ? `<div class="curio">“${rich(p.curiosity)}”</div>` : "")}
      ${fold("Notae · mis notas", note(p.notes))}
    </div>
    <div class="disclaimer">Una foto puede engañar. Antes de comer algo silvestre, confirmalo con alguien que sepa.</div>
    <div class="row" style="margin-top:18px">
      <button class="btn" onclick="location.hash='edit/${p.id}'">Editar</button>
      <button class="btn ghost" id="del">Arrancar la lámina</button>
    </div>
    <div class="row" style="margin-top:14px">
      ${prev ? `<button class="btn ghost" onclick="location.hash='plant/${prev.id}'">← ${esc(prev.common_name)}</button>` : "<span></span>"}
      ${next ? `<button class="btn ghost" onclick="location.hash='plant/${next.id}'">${esc(next.common_name)} →</button>` : "<span></span>"}
    </div>`;
  $app.querySelector("#iucninfo").onclick = () => openIucnInfo(p.iucn);
  const showUse = (u) => {
    const it = p.parts?.[u], note = $app.querySelector("#partnote"); if (!it || !note) return;
    $app.querySelectorAll(".use").forEach((b) => b.classList.toggle("sel", b.dataset.use === u));
    const parts = PARTS.filter(([k]) => it.partes.includes(k));
    note.className = "part-note u-" + u;
    note.innerHTML = `<div class="note-head"><b>${USES[u]}</b>${parts.map(([k, l]) => `<span class="ptag"><svg><use href="#p-${k}"/></svg>${l}</span>`).join("")}</div>${rich(it.nota)}`;
  };
  $app.querySelectorAll(".use.on").forEach((b) => (b.onclick = () => showUse(b.dataset.use)));
  if (usesOf(p).length) showUse(usesOf(p)[0]);
  $app.querySelector("#reillu")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true; ev.currentTarget.textContent = "Buscando…";
    delete illuCache[illuKey(p.scientific_name)]; saveIllu();
    const found = await findIllustration(p.scientific_name);
    if (!found) toast("No encontré una lámina antigua para esta especie");
    renderDetail(p.id);
  });
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
      const key = illuKey(p.scientific_name), prev = illuCache[key];
      illuCache[key] = false; saveIllu(); renderDetail(p.id);
      toast("Lámina quitada", ["Deshacer", () => { illuCache[key] = prev; saveIllu(); renderDetail(p.id); }]);
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
  draft = { files: (sd.blobs || []).map((b) => ({ blob: b, url: URL.createObjectURL(b) })), data: sd.data || {}, hint: sd.hint, mode: sd.mode === "manual" ? "manual" : "chat" };
}

// ---------- alta ----------
// Abre cámara o galería; al elegir, suma las fotos al borrador y muestra la lámina nueva.
function pickPhotos(source) {
  const input = document.getElementById(source === "camera" ? "file-input" : "file-input-gallery");
  input.value = "";
  input.onchange = async () => {
    if (!input.files.length) return;
    if (draft?.editing) draft = null;
    if (!draft) draft = { files: [], data: {}, mode: "chat" };
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
  if (!draft) draft = { files: [], data: {}, mode: "chat" };
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
  if (m === "chat") {
    box.innerHTML = `
      <ol class="steps">
        <li>Tocá <b>Enviar a la IA</b> y elegí ChatGPT o Claude: se abre con las fotos adjuntas y el prompt ya copiado.</li>
        <li>Pegá el prompt en el chat y enviá.</li>
        <li>Copiá la respuesta entera y pegala acá abajo.</li>
      </ol>
      <button class="btn primary" id="sendai" style="width:100%" ${has ? "" : "disabled"}>Enviar a la IA (fotos + prompt)</button>
      <div class="row" style="margin-top:10px"><button class="btn" id="copy">Solo copiar prompt</button>
        <a class="btn" href="https://chatgpt.com/" target="_blank">ChatGPT</a><a class="btn" href="https://claude.ai/new" target="_blank">Claude</a></div>
      <details><summary>Ver prompt</summary><div class="prompt-box">${esc(buildPrompt(draft.hint, placeCtx()))}</div></details>
      <label>Respuesta del chat</label><textarea id="paste" placeholder='{ "common_name": … }'></textarea>
      <button class="btn primary" id="useit" style="width:100%;margin-top:12px">Completar la ficha</button>`;
    // Comparte las fotos al chat de IA por el menú de Android y deja el prompt en el portapapeles.
    box.querySelector("#sendai").onclick = async () => {
      const prompt = buildPrompt(draft.hint, placeCtx());
      let copied = false;
      try { await navigator.clipboard.writeText(prompt); copied = true; } catch {}
      const files = draft.files.map((f, i) => new File([f.blob], `planta-${i + 1}.jpg`, { type: "image/jpeg" }));
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files, text: prompt }); toast(copied ? "Pegá el prompt en el chat y enviá" : "Fotos enviadas: copiá el prompt con «Solo copiar prompt»"); }
        catch (e) { if (e.name !== "AbortError") toast("No pude compartir las fotos"); }
      } else toast(copied ? "Este navegador no comparte fotos: prompt copiado, adjuntá las fotos a mano" : "Este navegador no permite compartir fotos");
    };
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
    <h2>${existing ? "Corregir lámina" : "Redactar la lámina"}</h2>
    ${existing ? `<label>Fotos</label><div class="preview" id="edphotos">${(existing.photos || []).map((ph) => `<div><img src="${urlCache.get(ph) || ""}"></div>`).join("")}</div>
      <div class="row"><button class="btn" id="addcam">Sacar foto</button><button class="btn" id="addgal">Agregar de la galería</button></div>` : ""}
    <label>Nombre común *</label><input id="common_name" value="${esc(d.common_name || "")}">
    <label>Otros nombres</label><input id="other_names" placeholder="España: … · Latinoamérica: … · Inglés: …" value="${esc(d.other_names || "")}">
    <label>Origen (corto)</label><input id="origin" placeholder="ej: Mediterráneo" value="${esc(d.origin || "")}">
    <label>Origen y distribución</label><input id="native_range" value="${esc(d.native_range || "")}">
    <div class="row"><div><label>Nombre científico</label><input id="scientific_name" value="${esc(d.scientific_name || "")}"></div>
    <div><label>Familia</label><input id="family" value="${esc(d.family || "")}"></div></div>
    <label>Tipos</label>
    <div class="chips" id="types">${TYPES.map((t) => `<span class="chip ${d.types?.includes(t) ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>
    <div class="row"><div><label>¿Es comestible?</label><select id="edible_human">${opt(HUMAN, d.edible_human, 0)}</select></div>
</div>
    <label>Floración: tocá los meses</label>${monthsBar(d.flower_months, [], "flm")}
    <label>Fruto o cosecha</label>${monthsBar([], d.fruit_months, "frm")}
    <label>Estado de conservación (UICN)</label>
    ${d.iucn
      ? `<div style="margin-top:6px">${iucnPill(d.iucn)}</div>`
      : `<select id="iucn"><option value="">Sin dato</option>${Object.entries(IUCN).map(([k, [l]]) => `<option value="${k}">${k} · ${l}</option>`).join("")}</select>`}
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
  [["flm", "flower_months", "fl"], ["frm", "fruit_months", "fr"]].forEach(([id, key, cls]) =>
    $app.querySelectorAll(`#${id} span`).forEach((s) => (s.onclick = () => {
      const n = +s.dataset.m, arr = d[key];
      d[key] = arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n].sort((a, b) => a - b);
      s.classList.toggle(cls);
    })));
  $app.querySelector("#save").onclick = async (ev) => {
    const btn = ev.currentTarget;
    const row = { parts: normParts(d.parts), kind: d.kind || null, lat: d.lat ?? null, lng: d.lng ?? null, flower_months: d.flower_months, fruit_months: d.fruit_months };
    for (const k of ["common_name", "other_names", "origin", "native_range", "scientific_name", "family", "edible_human", "description", "edibility_notes", "uses", "history", "curiosity", "notes", "location_name", "found_at"]) row[k] = v(k) || null;
    row.iucn = d.iucn || (document.getElementById("iucn") ? v("iucn") || null : null);
    row.types = [...$app.querySelectorAll("#types .chip.on")].map((c) => c.dataset.t);
    if (!row.common_name) return toast("Ponele al menos un nombre");
    if (!existing && !draft.files.length && !confirm("Esta lámina no tiene fotos. ¿La guardo igual? (Después podés agregarlas al editarla.)")) return;
    btn.disabled = true; btn.textContent = "Entintando…";
    try {
      if (existing) {
        const { data, error } = await sb.from("plants").update(row).eq("id", existing.id).select().single();
        if (error) throw error;
        plants = sortPlants(plants.map((x) => (x.id === data.id ? data : x)));
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
        plants = sortPlants([...plants, data]);
        clearDraft(); toast(`${data.common_name} asentada en el herbario`);
        location.hash = "plant/" + data.id;
      }
    } catch (e) {
      toast(/iucn/i.test(e.message) ? "Falta actualizar la base: corré en Supabase la línea SQL de «iucn»" : "Error: " + e.message);
      btn.disabled = false; btn.textContent = "Reintentar";
    }
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
  const notable = count((p) => ["VU", "EN", "CR", "EW"].includes(p.iucn));
  const badges = [
    ["f-herb", "Primer brote", "Asentá tu primera lámina", n >= 1],
    ["i-book", "Herborista", "10 láminas", n >= 10],
    ["f-tree", "Hortus conclusus", "50 láminas", n >= 50],
    ["f-fruit", "Recolector", "5 comestibles", edible >= 5],
    ["f-skull", "Prudente", "3 plantas tóxicas identificadas", toxic >= 3],
    ["f-leaf", "Hallazgo notable", "Una especie vulnerable o más amenazada", notable >= 1],
    ["f-family", "Taxónomo", "10 familias distintas", families >= 10],
    ["f-mushroom", "Micólogo", "Un hongo", count((p) => p.types?.includes("hongo")) >= 1],
    ["i-moon", "Cuatro estaciones", "Hallazgos en 4 meses distintos", new Set(plants.map((p) => (p.found_at || "").slice(5, 7)).filter(Boolean)).size >= 4],
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
    <div class="badge-list">${badges.map(([e, t, d, ok]) => `<div class="badge ${ok ? "" : "locked"}"><div class="e"><svg><use href="#${e}"/></svg></div><b>${t}</b><div class="muted" style="font-size:14px">${d}</div></div>`).join("")}</div>`;
}

Object.defineProperty(window, "draft", { get: () => draft, set: (x) => (x ? (draft = x) : clearDraft()) });
boot();
