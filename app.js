import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// ---------- configuración local ----------
const CFG_KEY = "plantdex.cfg";
const defaults = { sbUrl: "", sbKey: "", provider: "gemini", aiKey: "", model: "", engrave: true };
const loadCfg = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; } catch { return { ...defaults }; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
let cfg = loadCfg();

const DEFAULT_MODELS = { gemini: "gemini-2.5-flash", openai: "gpt-4o-mini" };
const BUCKET = "plant-photos";

const TYPES = ["comestible", "toxica", "medicinal", "aromatica", "frutal", "flor", "arbol", "arbusto", "hierba", "trepadora", "hongo", "acuatica", "invasora", "ornamental"];
const TYPE_LABEL = { comestible: "Comestible", toxica: "Tóxica", medicinal: "Medicinal", aromatica: "Aromática", frutal: "Frutal", flor: "Flor", arbol: "Árbol", arbusto: "Arbusto", hierba: "Hierba", trepadora: "Trepadora", hongo: "Hongo", acuatica: "Acuática", invasora: "Invasora", ornamental: "Ornamental" };
const DOG = { seguro: ["🐶", "Inocua para Rufi", "ok"], precaucion: ["⚠", "Con precaución", "warn"], toxico: ["☠", "Venenosa para Rufi", "bad"], desconocido: ["?", "Sin datos", ""] };
const HUMAN = { si: ["Comestible", "ok"], parcial: ["En parte", "warn"], no: ["No se come", "bad"], desconocido: ["Sin datos", ""] };
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTHS_LATIN = ["Ianuarius", "Februarius", "Martius", "Aprilis", "Maius", "Iunius", "Iulius", "Augustus", "September", "October", "November", "December"];

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
  $nav.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  window.addEventListener("hashchange", route);

  if (!cfg.sbUrl || !cfg.sbKey) return go("settings");
  sb = createClient(cfg.sbUrl, cfg.sbKey);
  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  sb.auth.onAuthStateChange((_e, s) => { const was = user; user = s?.user ?? null; if (!!was !== !!user) { if (user) loadPlants().then(route); else route(); } });
  if (user) await loadPlants();
  route();
}

function go(view) { if (location.hash === "#" + view) route(); else location.hash = view; }

function route() {
  const [view, arg] = location.hash.slice(1).split("/");
  window.scrollTo(0, 0);
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
  const missing = paths.filter((p) => !urlCache.has(p));
  if (!missing.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 24);
  data?.forEach((d) => d.signedUrl && urlCache.set(d.path, d.signedUrl));
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
 "common_name": "nombre común en español",
 "other_names": "otros nombres: euskera, catalán, nombres populares",
 "scientific_name": "Género especie",
 "family": "Familia",
 "native_range": "de dónde es nativa y si en el lugar del hallazgo es nativa, introducida o invasora",
 "kind": "árbol | arbusto | hierba | trepadora | hongo | otro",
 "types": [elegí de: ${TYPES.join(", ")}],
 "edible_human": "si | parcial | no | desconocido",
 "edibility_notes": "qué partes se comen, cómo, en qué época, y confusiones peligrosas con especies parecidas",
 "dog_safety": "seguro | precaucion | toxico | desconocido",
 "dog_notes": "qué le pasa a un perro si la come y qué hacer",
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

async function identify(blobs, hint = "", place = "") {
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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.aiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...imgs.map((b) => ({ inline_data: { mime_type: "image/jpeg", data: b } }))] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.statusText);
    text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  }
  return normalizeAI(text);
}

// ---------- piezas comunes ----------
const typeBadges = (types = []) => `<div class="chips" style="justify-content:center">${types.map((t) => `<span class="type t-${t}">${TYPE_LABEL[t] || t}</span>`).join("")}</div>`;
const stars = (n) => "✦".repeat(n || 1) + "✧".repeat(5 - (n || 1));
const monthsBar = (fl = [], fr = [], pickId = "") => `<div class="months ${pickId ? "pick" : ""}" ${pickId ? `id="${pickId}"` : ""}>${MONTHS.map((m, i) => {
  const n = i + 1; return `<span data-m="${n}" class="${fl.includes(n) ? "fl" : ""} ${fr.includes(n) ? "fr" : ""} ${n === nowMonth() ? "now" : ""}">${m[0]}</span>`;
}).join("")}</div>`;
const legend = `<div class="legend"><i style="background:#c9a1b2"></i>flor <i style="background:#b8c48f"></i>fruto <i style="outline:2px solid var(--rubric)"></i>mes actual</div>`;
const photoOf = (p) => urlCache.get(p.photos?.[0]);

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
    <div class="row" style="margin-top:22px"><button class="btn primary" id="save">Guardar</button></div>
    ${user ? `<hr><p class="muted" style="text-align:center">Sesión: ${esc(user.email)}</p>
      <div class="row"><button class="btn" id="export">Exportar backup</button><button class="btn ghost" id="logout">Cerrar sesión</button></div>` : ""}
  `;
  $app.querySelector("#save").onclick = () => {
    const prevSb = cfg.sbUrl + cfg.sbKey;
    cfg = { sbUrl: v("sbUrl").replace(/\/$/, ""), sbKey: v("sbKey"), provider: v("provider"), aiKey: v("aiKey"), model: v("model"), engrave: document.getElementById("engrave").checked };
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
      <div class="ornament">❧ ❦ ❧</div>
      <h2>Herbarium Vivum</h2>
      <p class="muted"><i>Liber plantarum quas vidi</i>: el libro de las plantas que vi.</p>
      <p>Dejá tu email y te llega un link para entrar.</p>
      <input id="email" type="email" placeholder="tu@email.com" style="margin:10px 0 20px;text-align:center">
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
    <div class="search"><input id="q" placeholder="Buscar por nombre, latín, familia, lugar…" value="${esc(filter.q)}"></div>
    ${used.length ? `<div class="chips">${used.map((t) => `<span class="chip ${filter.type === t ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>` : ""}
    ${plants.length === 0 ? `
      <div class="empty"><div class="big">❦</div><h3>Las páginas están en blanco</h3>
      <p class="muted">Salí a pasear con Rufi y tocá ✚ para dibujar tu primera lámina.</p>
      <button class="btn red" onclick="location.hash='new'">Comenzar la Tab. I</button></div>` :
      `<div class="grid">${list.map(card).join("") || `<p class="muted">Ninguna lámina coincide.</p>`}</div>`}
  `;
  const $q = $app.querySelector("#q");
  $q.oninput = () => { filter.q = $q.value; const pos = $q.selectionStart; renderList(); const n = $app.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  $app.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { filter.type = filter.type === c.dataset.t ? "" : c.dataset.t; renderList(); }));
  $app.querySelectorAll(".card").forEach((c) => (c.onclick = () => (location.hash = "plant/" + c.dataset.id)));
}

function card(p) {
  const img = photoOf(p), d = DOG[p.dog_safety || "desconocido"];
  return `<div class="card" data-id="${p.id}">
    <div class="ph" style="${img ? `background-image:url('${img}')` : ""}"></div>
    <span class="dog" title="${d[1]}">${d[0]}</span>
    <span class="num">${tab(p.number)}</span>
    <div class="name">${esc(p.common_name)}</div><div class="sci">${esc(p.scientific_name || "")}</div>
  </div>`;
}

async function renderDetail(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  await signUrls(p.photos || []);
  const urls = (p.photos || []).map((x) => urlCache.get(x)).filter(Boolean);
  const dog = DOG[p.dog_safety || "desconocido"], hum = HUMAN[p.edible_human || "desconocido"];
  const sec = (title, txt, cls = "") => txt ? `<h3>${title}</h3><div class="field-note ${cls}">${esc(txt)}</div>` : "";
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
    </div>
    ${urls[0] ? `<figure class="hero" style="margin:0"><img id="hero" src="${urls[0]}" alt="">
      <figcaption>Fig. I · ${esc(p.family || "")} ${p.kind ? "· " + esc(p.kind) : ""}</figcaption></figure>` : ""}
    ${urls.length > 1 ? `<div class="thumbs">${urls.map((u, i) => `<img src="${u}" data-i="${i}">`).join("")}</div>` : ""}
    ${typeBadges(p.types)}
    <div class="safety">
      <div><div class="k">PARA VOS</div><div class="v ${hum[1]}">${hum[0]}</div></div>
      <div><div class="k">PARA RUFI</div><div class="v ${dog[2]}">${dog[0]} ${dog[1]}</div></div>
    </div>
    ${sec("Descriptio", p.description, "dropcap")}
    ${sec("Patria · origen", p.native_range)}
    ${hasMonths ? `<h3>Kalendarium</h3>${monthsBar(p.flower_months, p.fruit_months)}${legend}` : ""}
    ${sec("Esculenta · comestibilidad", p.edibility_notes)}
    ${sec("De canibus · perros", p.dog_notes)}
    ${sec("Usus · usos", p.uses)}
    ${sec("Historia", p.history)}
    ${p.curiosity ? `<h3>Curiosa</h3><div class="curio">“${esc(p.curiosity)}”</div>` : ""}
    ${sec("Notae · mis notas", p.notes)}
    <div class="meta">Hallada en ${esc(p.location_name || "lugar sin nombre")}${p.lat ? ` (<a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank">mapa</a>)` : ""}, el ${esc(p.found_at || "")}.<br>
      Rareza <span class="stars">${stars(p.rarity)}</span>${p.ai_confidence ? `<br>Confianza de la identificación: ${esc(p.ai_confidence)}` : ""}</div>
    <div class="disclaimer">Una foto puede engañar. Antes de comer algo silvestre, o de dejar que Rufi lo coma, confirmalo con alguien que sepa.</div>
    <div class="row" style="margin-top:18px">
      <button class="btn" onclick="location.hash='edit/${p.id}'">Editar</button>
      <button class="btn ghost" id="del">Arrancar la lámina</button>
    </div>
    <div class="row" style="margin-top:14px">
      ${prev ? `<button class="btn ghost" onclick="location.hash='plant/${prev.id}'">← ${tab(prev.number)}</button>` : "<span></span>"}
      ${next ? `<button class="btn ghost" onclick="location.hash='plant/${next.id}'">${tab(next.number)} →</button>` : "<span></span>"}
    </div>`;
  $app.querySelectorAll(".thumbs img").forEach((t) => (t.onclick = () => {
    $app.querySelector("#hero").src = t.src;
    $app.querySelector(".hero figcaption").firstChild.textContent = `Fig. ${roman(+t.dataset.i + 1)} · `;
  }));
  $app.querySelector("#del").onclick = async () => {
    if (!confirm(`¿Arrancar la lámina de ${p.common_name}? Se borra para siempre.`)) return;
    if (p.photos?.length) await sb.storage.from(BUCKET).remove(p.photos);
    const { error } = await sb.from("plants").delete().eq("id", p.id);
    if (error) return toast(error.message);
    plants = plants.filter((x) => x.id !== p.id); go("list");
  };
}

// ---------- alta ----------
function renderNew() {
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
  prev.querySelectorAll("button").forEach((b) => (b.onclick = () => { draft.files.splice(+b.dataset.i, 1); renderNew(); }));
  const pick = (input) => { input.value = ""; input.onchange = async () => {
    for (const f of [...input.files].slice(0, 4 - draft.files.length)) { const blob = await resizeImage(f); draft.files.push({ blob, url: URL.createObjectURL(blob) }); }
    renderNew();
  }; input.click(); };
  $app.querySelector("#cam").onclick = () => pick(document.getElementById("file-input"));
  $app.querySelector("#gal").onclick = () => pick(document.getElementById("file-input-gallery"));
  $app.querySelector("#hint").oninput = (e) => (draft.hint = e.target.value);
  $app.querySelector("#place").oninput = (e) => (draft.data.location_name = e.target.value);
  $app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { draft.mode = b.dataset.m; renderNew(); }));

  const box = $app.querySelector("#mode");
  if (m === "ai") {
    box.innerHTML = `<p class="muted">Gemini mira las fotos y completa la ficha. Después la revisás.</p>
      <button class="btn primary" id="ai" style="width:100%" ${has ? "" : "disabled"}>Identificar</button><div id="status"></div>`;
    box.querySelector("#ai").onclick = async () => {
      const st = box.querySelector("#status");
      st.innerHTML = `<div class="scanning"><span class="leaf">❦</span><p><i>Consultando los tratados…</i></p></div>`;
      try { draft.data = { ...draft.data, ...(await identify(draft.files.map((f) => f.blob), draft.hint, placeCtx())) }; renderForm(null); }
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
      try { draft.data = { ...draft.data, ...normalizeAI(v("paste")) }; renderForm(null); }
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

function renderEdit(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  draft = { files: [], data: { ...p } };
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
    <label>Nombre común *</label><input id="common_name" value="${esc(d.common_name || "")}">
    <label>Otros nombres</label><input id="other_names" placeholder="euskera, populares…" value="${esc(d.other_names || "")}">
    <label>Origen y distribución</label><input id="native_range" value="${esc(d.native_range || "")}">
    <div class="row"><div><label>Nombre científico</label><input id="scientific_name" value="${esc(d.scientific_name || "")}"></div>
    <div><label>Familia</label><input id="family" value="${esc(d.family || "")}"></div></div>
    <label>Tipos</label>
    <div class="chips" id="types">${TYPES.map((t) => `<span class="chip ${d.types?.includes(t) ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>
    <div class="row"><div><label>¿Comestible para vos?</label><select id="edible_human">${opt(HUMAN, d.edible_human, 0)}</select></div>
    <div><label>¿Y para Rufi?</label><select id="dog_safety">${opt(DOG, d.dog_safety, 1)}</select></div></div>
    <label>Floración: tocá los meses</label>${monthsBar(d.flower_months, [], "flm")}
    <label>Fruto o cosecha</label>${monthsBar([], d.fruit_months, "frm")}
    <label>Rareza: <span id="rv" class="stars">${stars(d.rarity || 1)}</span></label><input id="rarity" type="range" min="1" max="5" value="${d.rarity || 1}">
    ${ta("description", "Descripción")}${ta("edibility_notes", "Comestibilidad")}${ta("dog_notes", "Perros")}
    ${ta("uses", "Usos")}${ta("history", "Historia")}${ta("curiosity", "Dato curioso")}${ta("notes", "Mis notas")}
    <div class="row"><div><label>Lugar</label><input id="location_name" placeholder="ej: Taconera, Pamplona, España" value="${esc(d.location_name || "")}"></div>
    <div><label>Fecha</label><input id="found_at" type="date" value="${esc(d.found_at || new Date().toISOString().slice(0, 10))}"></div></div>
    <div class="row" style="margin-top:22px"><button class="btn red" id="save">${existing ? "Guardar cambios" : "Asentar en el herbario"}</button></div>`;
  $app.querySelector("#bk").onclick = () => (existing ? (location.hash = "plant/" + existing.id) : renderNew());
  $app.querySelectorAll("#types .chip").forEach((c) => (c.onclick = () => c.classList.toggle("on")));
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
    for (const k of ["common_name", "other_names", "native_range", "scientific_name", "family", "edible_human", "dog_safety", "description", "edibility_notes", "dog_notes", "uses", "history", "curiosity", "notes", "location_name", "found_at"]) row[k] = v(k) || null;
    row.rarity = +v("rarity");
    row.types = [...$app.querySelectorAll("#types .chip.on")].map((c) => c.dataset.t);
    if (!row.common_name) return toast("Ponele al menos un nombre");
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
        draft = null; toast(`${data.common_name} asentada como Tabula ${roman(data.number)}`);
        location.hash = "plant/" + data.id;
      }
    } catch (e) { toast("Error: " + e.message); btn.disabled = false; btn.textContent = "Reintentar"; }
  };
}

// ---------- Kalendarium ----------
function renderCalendar() {
  const cur = nowMonth();
  const order = [...Array(12)].map((_, i) => ((cur - 1 + i) % 12) + 1);
  const item = (p, what) => `<div class="cal-item" data-id="${p.id}"><div class="ph" style="${photoOf(p) ? `background-image:url('${photoOf(p)}')` : ""}"></div>${esc(p.common_name)}<small>${what}</small></div>`;
  const block = (m) => {
    const fl = plants.filter((p) => p.flower_months?.includes(m));
    const fr = plants.filter((p) => p.fruit_months?.includes(m));
    if (!fl.length && !fr.length) return "";
    return `<div class="cal-month"><h3>${MONTHS_LATIN[m - 1]}${m === cur ? " · ahora" : ""}</h3>
      <div class="cal-list">${fr.map((p) => item(p, "da fruto")).join("")}${fl.map((p) => item(p, "en flor")).join("")}</div></div>`;
  };
  const html = order.map(block).join("");
  $app.innerHTML = `
    <h2>Kalendarium</h2>
    <p class="muted">Qué florece y qué se puede recolectar cada mes, según tus láminas. Empieza por este mes. Los meses corresponden al lugar donde encontraste cada planta.</p>
    ${html || `<div class="empty"><div class="big">☾</div><p class="muted">Todavía no hay meses cargados. La identificación automática los completa sola, o los marcás vos al editar una lámina.</p></div>`}`;
  $app.querySelectorAll(".cal-item").forEach((c) => (c.onclick = () => (location.hash = "plant/" + c.dataset.id)));
}

// ---------- progreso ----------
function renderStats() {
  const n = plants.length;
  const count = (f) => plants.filter(f).length;
  const families = new Set(plants.map((p) => p.family).filter(Boolean)).size;
  const edible = count((p) => p.edible_human === "si" || p.edible_human === "parcial");
  const toxicDog = count((p) => p.dog_safety === "toxico");
  const rare = count((p) => p.rarity >= 4);
  const badges = [
    ["❦", "Primer brote", "Asentá tu primera lámina", n >= 1],
    ["❧", "Herborista", "10 láminas", n >= 10],
    ["♣", "Hortus conclusus", "50 láminas", n >= 50],
    ["⚘", "Recolector", "5 comestibles", edible >= 5],
    ["🐕", "Custos Rufi", "3 venenosas para perros identificadas", toxicDog >= 3],
    ["✦", "Ojo de lince", "Una rareza de 4 estrellas o más", rare >= 1],
    ["⚜", "Taxónomo", "10 familias distintas", families >= 10],
    ["🍄", "Micólogo", "Un hongo", count((p) => p.types?.includes("hongo")) >= 1],
    ["☾", "Cuatro estaciones", "Hallazgos en 4 meses distintos", new Set(plants.map((p) => (p.found_at || "").slice(5, 7)).filter(Boolean)).size >= 4],
  ];
  const fam = Object.entries(plants.reduce((a, p) => (p.family && (a[p.family] = (a[p.family] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $app.innerHTML = `
    <h2>Progressus</h2>
    <p class="muted"><i>Herbarium numquam finitur.</i> El herbario nunca se termina.</p>
    <div class="stat-grid">
      <div class="stat"><b>${n}</b>láminas</div>
      <div class="stat"><b>${families}</b>familias</div>
      <div class="stat"><b>${edible}</b>comestibles</div>
      <div class="stat"><b>${toxicDog}</b>a evitar con Rufi</div>
    </div>
    ${fam.length ? `<h3>Familias más vistas</h3>${fam.map(([f, c]) => `<div class="entry-head"><span class="sci">${esc(f)}</span><span>${"❦".repeat(Math.min(c, 12))} ${c}</span></div>`).join("")}` : ""}
    <h3>Insignias</h3>
    <div class="badge-list">${badges.map(([e, t, d, ok]) => `<div class="badge ${ok ? "" : "locked"}"><div class="e">${e}</div><b>${t}</b><div class="muted" style="font-size:14px">${d}</div></div>`).join("")}</div>`;
}

Object.defineProperty(window, "draft", { get: () => draft, set: (x) => (draft = x) });
boot();
