import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

// ---------- configuración local ----------
const CFG_KEY = "plantdex.cfg";
const defaults = { sbUrl: "", sbKey: "", provider: "gemini", aiKey: "", model: "" };
const loadCfg = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; } catch { return { ...defaults }; } };
const saveCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {} };
let cfg = loadCfg();

const DEFAULT_MODELS = { gemini: "gemini-2.5-flash", openai: "gpt-4o-mini" };
const BUCKET = "plant-photos";

const TYPES = ["comestible", "toxica", "medicinal", "aromatica", "frutal", "flor", "arbol", "arbusto", "hierba", "trepadora", "hongo", "acuatica", "invasora", "ornamental"];
const TYPE_LABEL = { comestible: "Comestible", toxica: "Tóxica", medicinal: "Medicinal", aromatica: "Aromática", frutal: "Frutal", flor: "Flor", arbol: "Árbol", arbusto: "Arbusto", hierba: "Hierba", trepadora: "Trepadora", hongo: "Hongo", acuatica: "Acuática", invasora: "Invasora", ornamental: "Ornamental" };
const DOG = { seguro: ["🐶", "Segura para Rufi", "ok"], precaucion: ["⚠️", "Con precaución", "warn"], toxico: ["☠️", "Tóxica para Rufi", "bad"], desconocido: ["❔", "Sin datos", ""] };
const HUMAN = { si: ["Comestible", "ok"], parcial: ["Parcialmente", "warn"], no: ["No comestible", "bad"], desconocido: ["Sin datos", ""] };

// ---------- estado ----------
let sb = null;
let user = null;
let plants = [];
const urlCache = new Map();
let filter = { q: "", type: "" };
let draft = null; // { files: [{blob, url}], data: {} }

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => "#" + String(n).padStart(3, "0");
const toast = (msg) => { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2800); };

// ---------- arranque ----------
async function boot() {
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
  if (view === "settings") return renderSettings();
  if (!sb) return renderSettings();
  if (!user) return renderLogin();
  $nav.hidden = false;
  if (view === "new") return renderNew();
  if (view === "plant" && arg) return renderDetail(arg);
  if (view === "edit" && arg) return renderEdit(arg);
  if (view === "stats") return renderStats();
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
const AI_PROMPT = `Sos un botánico de campo y naturalista experto en flora silvestre de Europa (el usuario vive en Pamplona, Navarra, España). Identificá la planta, hongo o fruto de las fotos.
Respondé SOLO con JSON válido, en español rioplatense, con esta forma exacta:
{
 "common_name": "nombre común en español (y en euskera entre paréntesis si es conocido)",
 "scientific_name": "Género especie",
 "family": "Familia",
 "kind": "árbol | arbusto | hierba | trepadora | hongo | otro",
 "types": [elegí de: ${TYPES.join(", ")}],
 "edible_human": "si | parcial | no | desconocido",
 "edibility_notes": "qué partes se comen, cómo, en qué época, y riesgos o confusiones peligrosas con especies parecidas",
 "dog_safety": "seguro | precaucion | toxico | desconocido",
 "dog_notes": "qué le pasa a un perro si la come y qué hacer",
 "description": "cómo reconocerla en 2-3 frases",
 "uses": "usos culinarios, medicinales tradicionales, artesanales u ornamentales",
 "history": "un poco de historia, etimología o folklore, 2-4 frases",
 "curiosity": "un dato curioso breve y sorprendente",
 "rarity": 1-5 (1 = muy común en Navarra, 5 = rarísima),
 "confidence": "alta | media | baja, y si es baja qué foto extra ayudaría"
}
Si no estás seguro, decilo en confidence y sé conservador con la comestibilidad: ante la duda, "desconocido".`;

async function identify(blobs, hint = "") {
  if (!cfg.aiKey) throw new Error("Falta la API key de IA en Ajustes");
  const imgs = await Promise.all(blobs.map(blobToBase64));
  const prompt = AI_PROMPT + (hint ? `\nPista del usuario: ${hint}` : "");
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
  const out = JSON.parse(text.replace(/^```json|```$/g, "").trim());
  out.types = (out.types || []).map((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter((t) => TYPES.includes(t));
  out.ai_confidence = out.confidence; delete out.confidence;
  out.rarity = Math.max(1, Math.min(5, parseInt(out.rarity) || 1));
  return out;
}

// ---------- vistas ----------
function renderSettings() {
  $nav.hidden = !user;
  $app.innerHTML = `
    <button class="back" onclick="history.back()">← Volver</button>
    <h2>Ajustes</h2>
    <p class="muted">Se guardan solo en este dispositivo. Mirá el README para sacar cada clave (todo gratis).</p>
    <h3>☁ Supabase (tu nube)</h3>
    <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.sbUrl)}">
    <label>Anon / publishable key</label><input id="sbKey" placeholder="eyJ... o sb_publishable_..." value="${esc(cfg.sbKey)}">
    <h3>🔍 Identificación con IA</h3>
    <label>Proveedor</label>
    <select id="provider">
      <option value="gemini" ${cfg.provider === "gemini" ? "selected" : ""}>Google Gemini (gratis)</option>
      <option value="openai" ${cfg.provider === "openai" ? "selected" : ""}>OpenAI (de pago)</option>
    </select>
    <label>API key</label><input id="aiKey" type="password" placeholder="AIza..." value="${esc(cfg.aiKey)}">
    <label>Modelo (opcional)</label><input id="model" placeholder="${DEFAULT_MODELS[cfg.provider]}" value="${esc(cfg.model)}">
    <div class="row" style="margin-top:18px"><button class="btn primary" id="save">Guardar</button></div>
    ${user ? `<hr><p class="muted">Sesión: ${esc(user.email)}</p><button class="btn" id="export">⬇ Exportar backup (JSON)</button> <button class="btn ghost" id="logout">Cerrar sesión</button>` : ""}
  `;
  $app.querySelector("#save").onclick = () => {
    const prevSb = cfg.sbUrl + cfg.sbKey;
    cfg = { sbUrl: v("sbUrl").replace(/\/$/, ""), sbKey: v("sbKey"), provider: v("provider"), aiKey: v("aiKey"), model: v("model") };
    saveCfg(cfg);
    toast("Guardado ✔");
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
const v = (id) => document.getElementById(id).value.trim();

function renderLogin() {
  $nav.hidden = true;
  $app.innerHTML = `
    <div class="empty">
      <div class="big">🌿</div>
      <h2>Bienvenido, entrenador</h2>
      <p class="muted">Ingresá tu email y te mando un link mágico para entrar.</p>
      <input id="email" type="email" placeholder="tu@email.com" style="margin:14px 0">
      <button class="btn red" id="send" style="width:100%">Enviarme el link</button>
    </div>`;
  $app.querySelector("#send").onclick = async () => {
    const email = v("email"); if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    toast(error ? "Error: " + error.message : "¡Listo! Revisá tu correo 📬");
  };
}

function renderList() {
  const q = filter.q.toLowerCase();
  const list = plants.filter((p) =>
    (!filter.type || p.types?.includes(filter.type)) &&
    (!q || [p.common_name, p.scientific_name, p.family, p.location_name].join(" ").toLowerCase().includes(q)));
  const used = TYPES.filter((t) => plants.some((p) => p.types?.includes(t)));
  $app.innerHTML = `
    <div class="entry-head"><h2>Catálogo</h2><span class="pixel">${plants.length} REGISTRADAS</span></div>
    <div class="search"><input id="q" placeholder="Buscar por nombre, familia, lugar…" value="${esc(filter.q)}"></div>
    ${used.length ? `<div class="chips">${used.map((t) => `<span class="chip ${filter.type === t ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>` : ""}
    ${plants.length === 0 ? `
      <div class="empty"><div class="big">🌱</div><h3>Tu PlantDex está vacía</h3>
      <p class="muted">Salí a pasear con Rufi y tocá el botón de captura para registrar tu primera planta.</p>
      <button class="btn red" onclick="location.hash='new'">Capturar la #001</button></div>` :
      `<div class="grid">${list.map(card).join("") || `<p class="muted">Nada por acá.</p>`}</div>`}
  `;
  const $q = $app.querySelector("#q");
  $q.oninput = () => { filter.q = $q.value; const pos = $q.selectionStart; renderList(); const n = $app.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  $app.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { filter.type = filter.type === c.dataset.t ? "" : c.dataset.t; renderList(); }));
  $app.querySelectorAll(".card").forEach((c) => (c.onclick = () => (location.hash = "plant/" + c.dataset.id)));
}

function card(p) {
  const img = urlCache.get(p.photos?.[0]);
  return `<div class="card" data-id="${p.id}">
    <div class="ph" style="${img ? `background-image:url('${img}')` : ""}"></div>
    <span class="num">${pad(p.number)}</span>
    <span class="dog" title="${DOG[p.dog_safety || "desconocido"][1]}">${DOG[p.dog_safety || "desconocido"][0]}</span>
    <div class="body"><div class="name">${esc(p.common_name)}</div><div class="sci">${esc(p.scientific_name || "")}</div></div>
  </div>`;
}

const typeBadges = (types = []) => `<div class="chips">${types.map((t) => `<span class="type t-${t}">${TYPE_LABEL[t] || t}</span>`).join("")}</div>`;
const stars = (n) => "★".repeat(n || 1) + "☆".repeat(5 - (n || 1));

async function renderDetail(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  await signUrls(p.photos || []);
  const urls = (p.photos || []).map((x) => urlCache.get(x)).filter(Boolean);
  const dog = DOG[p.dog_safety || "desconocido"], hum = HUMAN[p.edible_human || "desconocido"];
  const sec = (title, txt, cls = "") => txt ? `<h3>${title}</h3><div class="field-note ${cls}">${esc(txt)}</div>` : "";
  $app.innerHTML = `
    <button class="back" onclick="location.hash='list'">← Catálogo</button>
    ${urls[0] ? `<div class="hero"><img id="hero" src="${urls[0]}" alt=""></div>` : ""}
    ${urls.length > 1 ? `<div class="thumbs">${urls.map((u) => `<img src="${u}">`).join("")}</div>` : ""}
    <div class="entry-head"><span class="pixel">${pad(p.number)}</span><span class="stars" title="Rareza">${stars(p.rarity)}</span></div>
    <h2>${esc(p.common_name)}</h2>
    <div class="sci">${esc(p.scientific_name || "")}${p.family ? " · " + esc(p.family) : ""}${p.kind ? " · " + esc(p.kind) : ""}</div>
    ${typeBadges(p.types)}
    <div class="safety">
      <div><div class="k">PARA VOS</div><div class="v ${hum[1]}">🍽 ${hum[0]}</div></div>
      <div><div class="k">PARA RUFI</div><div class="v ${dog[2]}">${dog[0]} ${dog[1]}</div></div>
    </div>
    ${sec("Cómo reconocerla", p.description)}
    ${sec("Comestibilidad", p.edibility_notes)}
    ${sec("Perros", p.dog_notes)}
    ${sec("Usos", p.uses)}
    ${sec("Historia", p.history)}
    ${sec("¿Sabías que…?", p.curiosity, "curio")}
    ${sec("Mis notas", p.notes)}
    <div class="meta">📍 ${esc(p.location_name || "Sin lugar")} ${p.lat ? `· <a href="https://maps.google.com/?q=${p.lat},${p.lng}" target="_blank">ver mapa</a>` : ""} · 📅 ${esc(p.found_at || "")}
    ${p.ai_confidence ? `<br>🔍 Confianza IA: ${esc(p.ai_confidence)}` : ""}</div>
    <div class="disclaimer">⚠ La identificación por foto puede fallar. Nunca comas ni dejes que Rufi coma algo silvestre sin confirmarlo con alguien que sepa.</div>
    <div class="row" style="margin-top:16px">
      <button class="btn" onclick="location.hash='edit/${p.id}'">✎ Editar</button>
      <button class="btn ghost" id="del">🗑 Liberar</button>
    </div>`;
  $app.querySelectorAll(".thumbs img").forEach((t) => (t.onclick = () => ($app.querySelector("#hero").src = t.src)));
  $app.querySelector("#del").onclick = async () => {
    if (!confirm(`¿Liberar a ${p.common_name}? Se borra para siempre.`)) return;
    if (p.photos?.length) await sb.storage.from(BUCKET).remove(p.photos);
    const { error } = await sb.from("plants").delete().eq("id", p.id);
    if (error) return toast(error.message);
    plants = plants.filter((x) => x.id !== p.id); go("list");
  };
}

// ---------- alta / edición ----------
function renderNew() {
  if (!draft) draft = { files: [], data: {} };
  $app.innerHTML = `
    <button class="back" onclick="draft=null;location.hash='list'">← Cancelar</button>
    <h2>Nueva captura</h2>
    <p class="muted">Sacá 1 a 4 fotos: la planta entera, una hoja de cerca, y flor o fruto si tiene.</p>
    <div class="drop">
      <div class="row"><button class="btn red" id="cam">📷 Cámara</button><button class="btn" id="gal">🖼 Galería</button></div>
      <div class="preview" id="prev"></div>
    </div>
    <label>Pista (opcional)</label><input id="hint" placeholder="ej: la encontré en el río Arga, huele a menta">
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="ai" ${draft.files.length ? "" : "disabled"}>🔍 Identificar con IA</button>
      <button class="btn" id="manual" ${draft.files.length ? "" : "disabled"}>✎ A mano</button>
    </div>
    <div id="status"></div>`;
  const prev = $app.querySelector("#prev");
  prev.innerHTML = draft.files.map((f, i) => `<div><img src="${f.url}"><button data-i="${i}">×</button></div>`).join("");
  prev.querySelectorAll("button").forEach((b) => (b.onclick = () => { draft.files.splice(+b.dataset.i, 1); renderNew(); }));
  const pick = (input) => { input.value = ""; input.onchange = async () => {
    for (const f of [...input.files].slice(0, 4 - draft.files.length)) { const blob = await resizeImage(f); draft.files.push({ blob, url: URL.createObjectURL(blob) }); }
    renderNew();
  }; input.click(); };
  $app.querySelector("#cam").onclick = () => pick(document.getElementById("file-input"));
  $app.querySelector("#gal").onclick = () => pick(document.getElementById("file-input-gallery"));
  $app.querySelector("#manual").onclick = () => renderForm(null);
  $app.querySelector("#ai").onclick = async () => {
    const st = $app.querySelector("#status");
    st.innerHTML = `<div class="scanning"><div class="pixel">ANALIZANDO ESPÉCIMEN…</div><div class="bar"><i></i></div></div>`;
    try { draft.data = await identify(draft.files.map((f) => f.blob), v("hint")); renderForm(null); }
    catch (e) { st.innerHTML = `<p class="muted">No pude identificarla: ${esc(e.message)}. Probá de nuevo o cargala a mano.</p>`; }
  };
  getLocation();
}

function getLocation() {
  if (draft.data.lat || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => { draft.data.lat = pos.coords.latitude; draft.data.lng = pos.coords.longitude; }, () => {}, { timeout: 8000 });
}

function renderEdit(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  draft = { files: [], data: { ...p } };
  renderForm(p);
}

function renderForm(existing) {
  const d = draft.data;
  const opt = (map, cur) => Object.keys(map).map((k) => `<option value="${k}" ${(cur || "desconocido") === k ? "selected" : ""}>${Array.isArray(map[k]) ? map[k][map === DOG ? 1 : 0] : k}</option>`).join("");
  const ta = (id, label) => `<label>${label}</label><textarea id="${id}">${esc(d[id] || "")}</textarea>`;
  $app.innerHTML = `
    <button class="back" id="bk">← Volver</button>
    <h2>${existing ? "Editar " + pad(existing.number) : "Completar ficha"}</h2>
    ${d.ai_confidence ? `<p class="muted">🔍 Confianza de la IA: ${esc(d.ai_confidence)}</p>` : ""}
    <label>Nombre común *</label><input id="common_name" value="${esc(d.common_name || "")}">
    <div class="row"><div><label>Nombre científico</label><input id="scientific_name" value="${esc(d.scientific_name || "")}"></div>
    <div><label>Familia</label><input id="family" value="${esc(d.family || "")}"></div></div>
    <label>Tipos</label>
    <div class="chips" id="types">${TYPES.map((t) => `<span class="chip ${d.types?.includes(t) ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`).join("")}</div>
    <div class="row"><div><label>¿Comestible para vos?</label><select id="edible_human">${opt(HUMAN, d.edible_human)}</select></div>
    <div><label>¿Y para Rufi?</label><select id="dog_safety">${opt(DOG, d.dog_safety)}</select></div></div>
    <label>Rareza (1–5)</label><input id="rarity" type="range" min="1" max="5" value="${d.rarity || 1}">
    ${ta("description", "Cómo reconocerla")}${ta("edibility_notes", "Comestibilidad")}${ta("dog_notes", "Perros")}
    ${ta("uses", "Usos")}${ta("history", "Historia")}${ta("curiosity", "Dato curioso")}${ta("notes", "Mis notas")}
    <div class="row"><div><label>Lugar</label><input id="location_name" placeholder="ej: Parque de la Taconera" value="${esc(d.location_name || "")}"></div>
    <div><label>Fecha</label><input id="found_at" type="date" value="${esc(d.found_at || new Date().toISOString().slice(0, 10))}"></div></div>
    <div class="row" style="margin-top:18px"><button class="btn red" id="save">${existing ? "Guardar cambios" : "¡Registrar en la PlantDex!"}</button></div>`;
  $app.querySelector("#bk").onclick = () => (existing ? (location.hash = "plant/" + existing.id) : renderNew());
  $app.querySelectorAll("#types .chip").forEach((c) => (c.onclick = () => c.classList.toggle("on")));
  $app.querySelector("#save").onclick = async (ev) => {
    const btn = ev.currentTarget;
    const row = { kind: d.kind || null, lat: d.lat ?? null, lng: d.lng ?? null, ai_confidence: d.ai_confidence || null };
    for (const k of ["common_name", "scientific_name", "family", "edible_human", "dog_safety", "description", "edibility_notes", "dog_notes", "uses", "history", "curiosity", "notes", "location_name", "found_at"]) row[k] = v(k) || null;
    row.rarity = +v("rarity");
    row.types = [...$app.querySelectorAll("#types .chip.on")].map((c) => c.dataset.t);
    if (!row.common_name) return toast("Ponele al menos un nombre");
    btn.disabled = true; btn.textContent = "Guardando…";
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
        draft = null; toast(`¡${data.common_name} registrada como ${pad(data.number)}! 🎉`);
        location.hash = "plant/" + data.id;
      }
    } catch (e) { toast("Error: " + e.message); btn.disabled = false; btn.textContent = "Reintentar"; }
  };
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
    ["🌱", "Primer brote", "Registrá tu primera planta", n >= 1],
    ["🌿", "Herborista", "10 plantas registradas", n >= 10],
    ["🌳", "Bosque propio", "50 plantas registradas", n >= 50],
    ["🧺", "Recolector", "5 comestibles", edible >= 5],
    ["🐕", "Guardián de Rufi", "Identificá 3 tóxicas para perros", toxicDog >= 3],
    ["💎", "Ojo de lince", "Encontrá una rareza 4★ o más", rare >= 1],
    ["🧬", "Taxónomo", "10 familias distintas", families >= 10],
    ["🍄", "Micólogo", "Registrá un hongo", count((p) => p.types?.includes("hongo")) >= 1],
    ["🌸", "Cuatro estaciones", "Capturas en 4 meses distintos", new Set(plants.map((p) => (p.found_at || "").slice(5, 7))).size >= 4],
  ];
  $app.innerHTML = `
    <h2>Progreso</h2>
    <p class="muted">La PlantDex no tiene fin: siempre hay una más.</p>
    <div class="stat-grid">
      <div class="stat"><b>${n}</b>plantas</div>
      <div class="stat"><b>${families}</b>familias</div>
      <div class="stat"><b>${edible}</b>comestibles</div>
      <div class="stat"><b>${toxicDog}</b>a evitar con Rufi</div>
    </div>
    <h3>Medallas</h3>
    <div class="badge-list">${badges.map(([e, t, d, ok]) => `<div class="badge ${ok ? "" : "locked"}"><div class="e">${e}</div><b>${t}</b><div class="muted" style="font-size:12px">${d}</div></div>`).join("")}</div>`;
}

window.draft = null;
Object.defineProperty(window, "draft", { get: () => draft, set: (x) => (draft = x) });
boot();
