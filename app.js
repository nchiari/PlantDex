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
let filter = { q: "", types: [], who: [], nova: false, open: false };
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
const shareLink = () => SITE_URL() + "?c=" + b64u.enc({ u: cfg.sbUrl, k: cfg.sbKey, o: cfg.name || "" });
let pendingInvite = null; // invitación recibida por alguien que todavía no configuró la app
const parseInvite = (raw) => {
  const t = String(raw || "").trim();
  const c = t.includes("?c=") ? new URL(t, location.href).searchParams.get("c") : t;
  const { u, k, o } = b64u.dec(c);
  if (!/^https:\/\/.+\.supabase\.co$/.test(u) || !k) throw new Error("invitación inválida");
  return { u, k, o: o || "" };
};
async function readConfigLink() {
  const c = new URLSearchParams(location.search).get("c");
  if (!c) return;
  history.replaceState(null, "", SITE_URL() + location.hash);
  try {
    const { u, k, o } = parseInvite(c);
    if (!cfg.sbUrl) { pendingInvite = { u, k, o }; return; } // la bienvenida se encarga
    if (cfg.sbUrl === u && cfg.sbKey === k) return;
    if (cfg.sbUrl && !(await ask({ title: "Otro herbario", text: `Este enlace te lleva ${o ? "al herbario de " + esc(o) : "a otro herbario"}. Si te cambiás, dejás de ver el actual.`, ok: "Cambiar de herbario", cancel: "Quedarme" }))) return;
    cfg = { ...cfg, sbUrl: u, sbKey: k }; saveCfg(cfg);
    setTimeout(() => toast("Herbario configurado. Entrá con tu email."), 300);
  } catch { setTimeout(() => toast("El enlace de configuración no es válido"), 300); }
}

// ---------- lanzamientos: al volver a la app, se recarga sola solo si hay novedades nuevas ----------
// El aviso es <meta name="news" content="N"> en index.html (igual al v de la última entrada de NEWS).
// Los cambios chicos no lo tocan: llegan la próxima vez que la app arranca de cero.
const MY_NEWS = +(document.querySelector('meta[name="news"]')?.content || 0);
let updateReady = false;
async function checkUpdate() {
  if (updateReady) return;
  try {
    const html = await (await fetch(SITE_URL() + "?_=" + Date.now(), { cache: "no-store" })).text();
    const n = +(html.match(/<meta name="news" content="(\d+)"/)?.[1] || 0);
    if (n > MY_NEWS) { updateReady = true; reloadIfIdle(); }
  } catch {}
}
function reloadIfIdle() {
  const view = location.hash.slice(1).split("/")[0];
  if (updateReady && !["new", "edit"].includes(view) && !document.querySelector(".modal, .tour")) location.reload();
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkUpdate());
window.addEventListener("hashchange", reloadIfIdle);

// Lo personal (nombre, zona, misiones, novedades y láminas vistas) se guarda en la cuenta de cada persona y,
// para abrir rápido, también una copia en el navegador. Si en este dispositivo entra otra persona, se descarta
// la copia de la anterior y se usan los datos de la cuenta nueva.
function adoptUser() {
  if (!user || cfg.uid === user.id) return;
  const meta = user.user_metadata || {};
  if (cfg.uid) {
    for (const k of ["zone", "mission", "missionsDone", "missionSkip", "missionSeen", "missionCelebrated", "missionsIntro", "newsSeen", "focusZone"]) delete cfg[k];
    cfg.name = meta.name || "";
    try { localStorage.removeItem(NOVA_KEY); localStorage.removeItem(ACH_KEY); } catch {}
    novaSeen = null;
  } else if (cfg.name && !meta.name) syncMeta({ name: cfg.name }); // primera vez: la cuenta adopta el nombre de este dispositivo
  cfg.uid = user.id; saveCfg(cfg);
}

// Mientras haya una ventana abierta (las que suben desde abajo, el visor, la carta, el tutorial o un sello), el fondo no se mueve.
const OVERLAYS = ".modal, .viewer, .stamp, .tour";
new MutationObserver(() => {
  const on = !!document.querySelector(OVERLAYS);
  if (on === document.documentElement.classList.contains("locked")) return;
  if (on) { document.documentElement.style.setProperty("--lock-y", `-${scrollY}px`); document.documentElement.dataset.y = scrollY; }
  document.documentElement.classList.toggle("locked", on);
  if (!on) scrollTo(0, +(document.documentElement.dataset.y || 0));
}).observe(document.body, { childList: true });

async function boot() {
  applyTheme();
  await readConfigLink();
  document.body.classList.toggle("engrave", !!cfg.engrave);
  document.getElementById("btn-home").onclick = () => go("list");
  // El + abre la carga de una planta; si ya estás cargando una, no hace nada (no se pierden las fotos).
  $nav.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (b.dataset.go !== "new" ? go(b.dataset.go) : currentView() === "new" ? toast("Ya estás cargando una planta") : openSheet())));
  window.addEventListener("hashchange", route);

  if (!cfg.sbUrl || !cfg.sbKey) return renderSetup();
  sb = createClient(cfg.sbUrl, cfg.sbKey);
  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  adoptUser();
  sb.auth.onAuthStateChange((_e, s) => { const was = user; user = s?.user ?? null; if (!!was !== !!user) { if (user) { adoptUser(); loadPlants().then(route); } else route(); } });
  if (user) await loadPlants();
  await restoreDraft();
  route();
}

function go(view) { if (location.hash === "#" + view) route(); else location.hash = view; }

let lastView = "";
function route() {
  const [view, arg] = location.hash.slice(1).split("/");
  // Si salís de la carga de una planta sin asentarla, sus fotos se descartan.
  if (lastView === "new" && view !== "new" && draft && !draft.editing && feat("fotos")) clearDraft();
  lastView = view;
  window.scrollTo(0, 0);
  document.getElementById("sheet").hidden = true;
  const active = { plant: "list", edit: "list", "": "list" }[view] ?? view;
  $nav.querySelectorAll("[data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === active));
  $nav.querySelector(".capture")?.classList.toggle("here", view === "new");
  if (!sb) return renderSetup();
  if (user && !amMember) return renderWaiting();
  if (view === "settings") return renderSettings();
  if (!user) return renderLogin();
  $nav.hidden = false;
  document.body.classList.remove("onboarding");
  checkAchievements();
  if (cfg.tourPending) setTimeout(() => cfg.tourPending && startTour(), 700);
  else if (newsSeen() < NEWS[0].v) setTimeout(() => !document.querySelector(".tour, .modal") && openNews(), 900);
  else maybeMissionsIntro(900);
  // Con las misiones, la pestaña de logros pasa a llamarse Progreso.
  $nav.querySelector('[data-go="stats"]').lastChild.textContent = feat("misiones") ? "Progreso" : "Logros";
  navDotSettings();
  if (feat("misiones") && zoneOf() && !route.missionChecked) { route.missionChecked = true; ensureMission().then(navDot).catch(() => {}); } else navDot();
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
let amOwner = false, amMember = true, pendingRequests = 0;
// ---------- interruptores: las funciones grandes salen primero solo para la cuenta del dueño ----------
// "prueba" = solo la ve el dueño del herbario; "todos" = la ve todo el mundo. Para lanzar, se pasa a "todos".
const FEATURES = { sello: "todos", misiones: "todos", dudas: "todos", laminas: "todos", fotos: "prueba", nuevas: "prueba" };
const MAX_PHOTOS = 4; // fotos propias por lámina (la lámina antigua no cuenta)
const feat = (k) => FEATURES[k] === "todos" || (FEATURES[k] === "prueba" && !!user && amOwner);
async function loadPlants() {
  // Dueño = primer usuario de esta nube. Si la función no existe (herbario viejo), se asume dueño para no ocultarle nada.
  const own = await sb.rpc("is_owner");
  amOwner = own.error ? true : !!own.data;
  // Miembro = cuenta aceptada por el dueño. Si la función no existe (herbario viejo), se asume aceptada.
  const mem = amOwner ? { data: true } : await sb.rpc("is_member");
  amMember = mem.error ? true : !!mem.data;
  if (!amMember) { plants = []; return; }
  if (amOwner) { const { count } = await sb.from("members").select("user_id", { count: "exact", head: true }).eq("status", "pending"); pendingRequests = count || 0; }
  const { data, error } = await sb.from("plants").select("*").order("number", { ascending: false });
  if (error) { toast("Error cargando: " + error.message); return; }
  plants = sortPlants(data.map(fixNames));
  // Hallazgos de la misma especie hechos por otras personas (o por vos en otra salida). Si la tabla no existe, se ignora.
  const { data: sg } = await sb.from("sightings").select("*").order("created_at");
  plants.forEach((p) => (p.sightings = (sg || []).filter((x) => x.plant_id === p.id)));
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
Tu respuesta debe tener SOLO dos cosas: primero esta línea, tal cual: "Copiá este bloque y pegalo en Herbalorium 👇"; y debajo, el JSON dentro de un bloque de código (\`\`\`json … \`\`\`), para que se copie con un toque. Nada más antes ni después. Dentro de los textos, nada de citas, referencias, notas al pie ni marcas de fuentes. El JSON, así: {"Género especie": "LC", ...}
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
// Búsqueda ampliada: además del título, las categorías de Commons ("X - botanical illustrations") y los nombres
// antiguos de la especie (sinónimos de GBIF), porque muchas láminas del siglo XIX la nombran distinto.
// Se intenta una sola vez por especie; las que quitaste a mano ("No es esta planta") no se vuelven a buscar.
const ILLU_TRIED_KEY = "plantdex.illu-x";
// Solo se aceptan láminas de colecciones digitalizadas y limpias (fondo claro, una planta, formato vertical):
// son las que encajan en el arco de la tarjeta. Los escaneos de páginas de libros quedan afuera.
const ILLU_CLEAN = /k(ö|oe|o)hler|medizinal-?pflanzen|lindman|bilder ur nordens flora|nordens flora|thom[ée]|flora von deutschland|flora batava|sturm|deutschlands flora in abbildungen/i;
const illuGood = (pg) => {
  const ii = pg.imageinfo?.[0] || {}, md = ii.extmetadata || {};
  const who = `${pg.title} ${strip(md.Artist?.value)} ${strip(md.Credit?.value)} ${strip(md.ImageDescription?.value).slice(0, 300)}`;
  const thome = /^File:Illustration [A-Z][a-z-]+ [a-z-]+\d*\.(jpe?g|png)$/i.test(pg.title); // así se llaman las de Thomé en Commons
  return (ILLU_CLEAN.test(who) || thome) && (!ii.width || ii.height / ii.width >= 1.15);
};
let illuTried = new Set(); try { illuTried = new Set(JSON.parse(localStorage.getItem(ILLU_TRIED_KEY) || "[]")); } catch {}
const saveTried = () => { try { localStorage.setItem(ILLU_TRIED_KEY, JSON.stringify([...illuTried].slice(-500))); } catch {} };
// Las que quitaste a mano quedan anotadas aparte: ninguna búsqueda las vuelve a traer.
const ILLU_REMOVED_KEY = "plantdex.illu-off";
let illuRemoved = new Set(); try { illuRemoved = new Set(JSON.parse(localStorage.getItem(ILLU_REMOVED_KEY) || "[]")); } catch {}
const saveRemoved = () => { try { localStorage.setItem(ILLU_REMOVED_KEY, JSON.stringify([...illuRemoved])); } catch {} };
const illuRetry = (key) => feat("laminas") && illuCache[key] === false && !illuTried.has(key) && !illuRemoved.has(key);
const titleCase = (n) => n.charAt(0).toUpperCase() + n.slice(1);
async function categoryIllustration(name) {
  const q = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "categorymembers", gcmtitle: `Category:${titleCase(name)} - botanical illustrations`,
    gcmtype: "file", gcmlimit: "30", prop: "imageinfo", iiprop: "url|extmetadata|mime|size", iiurlwidth: "700",
  });
  const res = await fetch("https://commons.wikimedia.org/w/api.php?" + q);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const files = Object.values((await res.json()).query?.pages || {}).filter((pg) => pg.imageinfo?.[0]?.thumburl && /image\/(jpeg|png|tiff)/.test(pg.imageinfo[0].mime || "image/jpeg"));
  // Mejor primero: con el nombre de la planta en el título (suelen ser láminas solo de esa especie) y de floras clásicas;
  // al final, las colecciones "mejoradas" que suelen juntar varias especies en una misma lámina.
  const n = name.toLowerCase();
  const score = (pg) => (pg.title.toLowerCase().includes(n) ? 4 : 0) + (ILLU_SOURCES.test(pg.title) ? 2 : 0) - (/rawpixel|digitally enhanced/i.test(pg.title) ? 3 : 0);
  return files.filter(illuGood).sort((a, b) => score(b) - score(a))[0] || null;
}
// Búsqueda por título (la de siempre) para un nombre dado: primero las floras preferidas.
async function titleIllustration(name) {
  const q = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "8",
    gsrsearch: `intitle:"${name}" filetype:bitmap`, prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "700",
  });
  const res = await fetch("https://commons.wikimedia.org/w/api.php?" + q);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const list = Object.values((await res.json()).query?.pages || {}).filter((pg) => pg.imageinfo?.[0]?.thumburl && pg.title.toLowerCase().includes(name));
  return list.find(illuGood) || null;
}
// Nombres antiguos de la especie según GBIF (solo especies, sin la actual).
async function oldNames(sci) {
  const key = illuKey(sci);
  const m = await (await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(key)}`)).json();
  const id = m.acceptedUsageKey || m.usageKey; if (!id) return [];
  const names = [m.status === "SYNONYM" && m.species ? m.species : ""];
  const syn = await (await fetch(`https://api.gbif.org/v1/species/${id}/synonyms?limit=40`)).json();
  (syn.results || []).forEach((r) => names.push(r.canonicalName || ""));
  return [...new Set(names.map((n) => illuKey(n)).filter((n) => n && n.split(" ").length === 2 && n !== key))].slice(0, 8);
}
const illuInflight = new Map();
function findIllustration(sci) {
  const key = illuKey(sci);
  if (!illuInflight.has(key)) illuInflight.set(key, searchIllustration(sci).finally(() => illuInflight.delete(key)));
  return illuInflight.get(key);
}
async function searchIllustration(sci) {
  const key = illuKey(sci);
  if (!key || key.split(" ").length < 2) return null;
  if (key in illuCache && !illuRetry(key)) return illuCache[key];
  const firstTime = !(key in illuCache);
  let pick = null, via = "";
  if (firstTime) try {
    const search = async (extra) => {
      const q = new URLSearchParams({
        action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "5",
        gsrsearch: `intitle:"${key}" ${extra} filetype:bitmap`, prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "700",
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
      pick = feat("laminas") ? list.find(illuGood) : i < ILLU_QUERIES.length - 1 ? list[0] : list.find((pg) => ILLU_SOURCES.test(pg.title));
    }
  } catch { return null; }
  if (!pick && feat("laminas")) {
    try {
      pick = await categoryIllustration(key);
      if (!pick) {
        const names = await oldNames(sci);
        const found = await Promise.all(names.map(async (n) => (await categoryIllustration(n).catch(() => null)) || (await titleIllustration(n).catch(() => null))));
        const i = found.findIndex(Boolean);
        if (i >= 0) { pick = found[i]; via = names[i]; }
      }
    } catch { if (firstTime) return null; return illuCache[key] ?? null; } // sin conexión: se reintenta otro día
    illuTried.add(key); saveTried();
  }
  const info = pick?.imageinfo[0], md = info?.extmetadata || {};
  illuCache[key] = pick ? {
    url: info.thumburl, page: info.descriptionurl,
    credit: [strip(md.Artist?.value), strip(md.ObjectName?.value) || pick.title.replace(/^File:|\.\w+$/g, ""), via ? `como ${titleCase(via)}` : ""].filter(Boolean).join(" · ").slice(0, 180),
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
    if (!sci || (illuKey(sci) in illuCache && !illuRetry(illuKey(sci)))) continue;
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
// Mes y año del hallazgo, para que la IA sepa qué está en flor o en fruto en esa época.
const foundWhen = () => { const f = draft?.data?.found_at; return f ? new Date(f + "T12:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : ""; };
const buildPrompt = (hint = "", place = "") => `Sos un botánico divulgador, de esos que hacen que cualquiera se interese por las plantas. Identificá la planta, hongo o fruto de las fotos.
Lugar del hallazgo: ${place || "desconocido"}.${foundWhen() ? ` Fecha del hallazgo: ${foundWhen()}.` : ""} Usalo SOLO para ayudarte a identificarla (qué crece ahí y qué está en flor o en fruto en esa época) y para saber en qué hemisferio está (meses de flor y fruto). Los textos NO deben mencionar las fotos, el ejemplar fotografiado ni el lugar del hallazgo: hablá de la especie en general.

TONO: cercano, claro y con ganas de contar. Frases cortas, vocabulario de todos los días, nada de jerga técnica (si usás un término botánico, explicalo en tres palabras). Ni solemne ni chistoso: como un buen documental o un amigo que sabe mucho. Español neutro.

${feat("dudas") ? `¿PREGUNTAR O RESPONDER? Por defecto, respondé directamente con la ficha. La gran mayoría de las veces tu primera idea es la correcta: confiá en ella.
Preguntá ANTES de dar la ficha solo en estos casos, y en ningún otro:
- Dudás de verdad entre especies que se ven casi iguales en las fotos Y la diferencia importa, sobre todo si una es tóxica o peligrosa y la otra no.
- Las fotos no permiten identificar ni siquiera el género (muy borrosas, muy lejos, solo un pedazo irreconocible).
Si dudás solo entre especies parecidas sin riesgo, o entre variedades, NO preguntes: elegí la más probable y contá la duda en el campo "doubt".
Si tenés que preguntar, hacelo una sola vez y en pocas líneas, en tono cercano: las 2 candidatas y en qué se diferencian, y como máximo 2 pedidos fáciles de cumplir en el campo (una foto puntual o una pregunta simple). Terminá con: "Contestame esto y te paso la ficha para Herbalorium." Con la respuesta, das la ficha sí o sí.

` : ""}Cuando des la ficha, tu respuesta debe tener SOLO dos cosas: primero esta línea, tal cual: "Copiá este bloque y pegalo en Herbalorium 👇"; y debajo, el JSON dentro de un bloque de código (\`\`\`json … \`\`\`), para que se copie con un toque. Nada más antes ni después. Dentro de los textos, nada de citas, referencias, notas al pie ni marcas de fuentes.
El JSON tiene que ser válido y con esta forma exacta:
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
 "edibility_notes": "SOLO lo alimentario: qué partes se comen y cómo se preparan (o por qué no se come), con qué se puede confundir y qué riesgos hay al comerla. Nada de usos medicinales ni de otros usos",
 "medicinal_notes": "SOLO usos medicinales: para qué se usó o se usa, cómo se prepara, qué respaldo científico tiene y precauciones. Si no tiene usos medicinales conocidos, dejalo vacío (\"\")",
 "uses": "SOLO otros usos que no sean comida ni medicina: madera, jardín, setos, artesanía, tintes, cosmética, fauna, ganado, etc. No repitas nada de edibility_notes ni de medicinal_notes. Si no hay, dejalo vacío (\"\")",
 "history": "historia, mitos o etimología contados como una buena anécdota, 2-4 frases",
 "curiosity": "un fun fact de verdad, de esos que hacen decir '¡no lo sabía!': su aparición en la cultura popular (películas, libros, refranes, expresiones del idioma, marcas, deportes), una leyenda, una anécdota histórica rara o un uso inesperado. NO repitas datos de botánica básica (machos y hembras, cómo se reproduce, cuántas semillas da) ni lo que ya contaste en history. 1-3 frases",
 "flower_months": [meses 1-12 en que suele florecer en su zona habitual, en el hemisferio del hallazgo],
 "fruit_months": [meses 1-12 en que suele dar fruto o cosecharse, mismo criterio],
 "iucn": "estado de conservación GLOBAL de la especie en la Lista Roja de la UICN: LC | NT | VU | EN | CR | EW | EX | DD | NE (NE si no fue evaluada; no inventes)"${feat("dudas") ? `,
 "doubt": "vacío (\"\") si estás seguro. Si te quedó alguna duda: con qué otra especie se puede confundir y en qué fijarse para diferenciarlas, en 1-2 frases"` : ""}
}
Ante la duda sé conservador con la comestibilidad: usá "desconocido".
En description, native_range, edibility_notes, medicinal_notes, uses, history y curiosity marcá con **doble asterisco** entre 2 y 4 palabras o frases clave por campo (partes que se comen, advertencias, usos principales, fechas, personajes o lugares históricos). No marques frases enteras.${hint ? `\nPista del usuario para identificarla: ${hint}` : ""}`;

// Marcas de citas que algunas IA dejan pegadas al copiar: Gemini [span_0](start_span), [cite: 1], [cite_start];
// ChatGPT 【4†fuente】 o "turn0search0"; y llamadas numéricas tipo [1] o [2, 3].
const CITE_MARKS = /\[span_\d+\]\((?:start|end)_span\)|\[cite(?:_start|_end)?(?::[^\]]*)?\]|【[^】]*】|[\ue200-\ue202]|\bcite(?:turn\d+\w+?\d+)+|\bturn\d+(?:search|news|view|image)\d+|\[\d+(?:\s*[,–-]\s*\d+)*\]/gi;
const cleanCites = (t) => String(t).replace(CITE_MARKS, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim();
// Limpia todos los textos de la respuesta, también los que van dentro de los usos.
const cleanDeep = (v) => (typeof v === "string" ? cleanCites(v) : Array.isArray(v) ? v.map(cleanDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)])) : v);
// Nombres de plantas: el común siempre empieza con mayúscula (algunas IA e iNaturalist los dan en minúscula)
// y el científico va con el género en mayúscula y el resto en minúscula (Arbutus unedo).
const capName = (t) => { const x = String(t || "").trim(); return x ? x.charAt(0).toLocaleUpperCase("es") + x.slice(1) : x; };
const sciName = (t) => { const x = String(t || "").trim().replace(/\s+/g, " "); return x ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x; };
const fixNames = (p) => { if (p) { if (p.common_name) p.common_name = capName(p.common_name); if (p.scientific_name) p.scientific_name = sciName(p.scientific_name); } return p; };
function normalizeAI(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) { const e = new Error("No encontré la ficha en la respuesta"); e.noJson = true; throw e; }
  const out = cleanDeep(JSON.parse(m[0]));
  const months = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => n >= 1 && n <= 12) : []);
  out.types = (out.types || []).map((t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter((t) => TYPES.includes(t));
  out.flower_months = months(out.flower_months);
  out.fruit_months = months(out.fruit_months);
  delete out.confidence;
  out.iucn = normIucn(out.iucn);
  fixNames(out);
  if (out.doubt && String(out.doubt).trim()) out.notes = [out.notes, `Ojo, puede confundirse: ${String(out.doubt).trim()}`].filter(Boolean).join("\n\n");
  delete out.doubt;
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
// Inicial del avatar: primera letra del nombre (o del email), en mayúscula.
const initialOf = (name) => [...((name || "").trim() || user?.email || "?")][0].toUpperCase();
function renderSettings() {
  $nav.hidden = !user;
  const owner = !user || amOwner; // sin sesión (configuración inicial) se muestra todo
  const book = cfg.joinedFrom ? `el herbario de ${esc(cfg.joinedFrom)}` : "un herbario compartido";
  $app.innerHTML = `
    <h2>Ajustes</h2>
    <h3>Vos</h3>
    <label>Tu nombre (aparece en las láminas que cargás)</label>
    <div class="me-row"><span class="avatar" id="avatar" aria-hidden="true">${esc(initialOf(cfg.name))}</span><input id="myname" maxlength="30" value="${esc(cfg.name || "")}" placeholder="Tu nombre"></div>
    ${user && feat("misiones") ? `<label>Tu zona</label>
    <div class="zone-pick"><input id="zoneq" autocomplete="off" placeholder="Escribí tu barrio, pueblo o ciudad" value="${esc(zoneOf()?.name || "")}"><div class="zone-list" id="zonelist" hidden></div></div>
    <button class="linkish zone-gps" id="setzone">Usar mi ubicación actual</button>
    <p class="zone-done" id="zonedone" hidden></p>
    <p class="muted zone-note">Sirve para proponerte plantas que se vieron cerca. Se guarda aproximada, a un kilómetro.</p>
    <label class="toggle"><input type="checkbox" id="missions" ${cfg.missionsOff ? "" : "checked"}> Misiones de exploración</label>` : ""}
    <h3>Apariencia</h3>
    <label>Tema</label>
    <div class="theme-pick">${[["light", "Claro"], ["dark", "Oscuro"], ["auto", "Automático"]].map(([k, l]) => `<button data-theme-pick="${k}" class="${(cfg.theme || "auto") === k ? "on" : ""}"><i class="sw-${k}"></i>${l}</button>`).join("")}</div>
    <label class="toggle"><input type="checkbox" id="engrave" ${cfg.engrave ? "checked" : ""}> Fotos con filtro de grabado antiguo</label>
    <label class="toggle"><input type="checkbox" id="illustrations" ${cfg.illustrations ? "checked" : ""}> Usar láminas antiguas de Wikimedia Commons como imagen principal</label>
    <div class="row" style="margin-top:22px"><button class="btn primary" id="save">Guardar</button></div>
    ${user ? iucnBatchBox() : ""}
    ${user ? (owner ? `
      <div id="requests"></div>
      <div class="share-box"><h3>Invitar a mi herbario</h3>
        <ol class="setup ob-list">
          <li><b>Mandale tu enlace de invitación</b>. Al abrirlo, la app lo guía paso a paso.</li>
          <li>Cuando entre con su email, <b>te aparece su pedido acá</b>. Lo aceptás y listo.</li>
        </ol>
        <button class="btn" id="sharecfg" style="width:100%">Compartir invitación</button>
        <p class="muted" style="font-size:14px">Cada persona entra con su propio email y solo puede editar lo que carga.</p></div>` : `
      <div class="share-box"><h3>Tu herbario</h3>
        <p class="muted" style="margin-top:0">Estás en ${book}. Para sumar a alguien, pasale este enlace: cuando entre, el dueño del herbario recibe su pedido y decide. También sirve para abrirlo en otro dispositivo.</p>
        <button class="btn" id="sharecfg" style="width:100%">Compartir invitación</button></div>`) : ""}
    ${owner ? `<details class="owner-db" ${user ? "" : "open"}><summary>Conexión con la base ${user ? "· solo la ves vos" : ""}</summary>
      <p class="muted">Dirección y clave pública de tu nube en Supabase. Solo cambialas si sabés lo que hacés.</p>
      <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.sbUrl)}">
      <label>Anon / publishable key</label><input id="sbKey" placeholder="eyJ… o sb_publishable_…" value="${esc(cfg.sbKey)}"></details>` : ""}
    ${user && amOwner ? `<details class="owner-db"><summary>Pruebas · solo la ves vos</summary>
      <p class="muted">Vuelve a cero lo de las misiones en tu cuenta: la carta de presentación, la zona, la misión, las misiones cumplidas y sus logros. Sirve para ver todo como alguien que entra por primera vez.</p>
      <button class="btn ghost" id="resetmis" style="width:100%">Empezar las misiones de cero</button>
      <p class="muted" style="margin-top:18px">Olvida las láminas antiguas encontradas en este celular y las vuelve a buscar con el método actual. Las que quitaste a mano no vuelven.</p>
      <button class="btn ghost" id="reillus" style="width:100%">Volver a buscar las láminas antiguas</button></details>` : ""}
    ${user ? `<hr><p class="muted" style="text-align:center">Sesión: ${esc(user.email)}${owner ? " · dueño del herbario" : ""}<br><button class="linkish" id="news">Novedades</button></p>
      <div class="row"><button class="btn ghost" id="retour">Ver el tutorial</button>${owner ? `<button class="btn ghost" id="switchbook">Cambiar de herbario</button>` : `<button class="btn ghost" id="leavebook">Salir de este herbario</button>`}</div>
      <div class="row"><button class="btn" id="export">Exportar backup</button><button class="btn ghost" id="logout">Cerrar sesión</button></div>` : ""}
  `;
  $app.querySelector("#myname").oninput = (e) => ($app.querySelector("#avatar").textContent = initialOf(e.target.value));
  $app.querySelector("#resetmis")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (!(await ask({ title: "Empezar de cero", text: "Se borran tu zona, tu misión y la carta de presentación, como si recién entraras. Tus láminas y logros no se tocan.", ok: "Empezar de cero", cancel: "Dejarlo" }))) return;
    btn.disabled = true;
    for (const k of ["zone", "mission", "missionsIntro", "missionSkip", "focusZone", "missionSeen", "missionsDone", "missionCelebrated"]) delete cfg[k];
    saveCfg(cfg);
    try { localStorage.removeItem(NEAR_KEY); } catch {}
    await syncMeta({ zone: null, mission: null, missions_intro: null, missions_done: null });
    try { const seen = JSON.parse(localStorage.getItem(ACH_KEY) || "[]").filter((id) => !/^x\d/.test(id)); localStorage.setItem(ACH_KEY, JSON.stringify(seen)); } catch {}
    location.replace(SITE_URL());
  });
  if (amOwner && user) paintRequests();
  $app.querySelector("#reillus")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    illuCache = Object.fromEntries([...illuRemoved].map((k) => [k, false])); saveIllu();
    illuTried = new Set(illuRemoved); saveTried();
    const todo = [...new Set(plants.map((p) => illuKey(p.scientific_name)).filter((k) => k.split(" ").length === 2 && !illuRemoved.has(k)))];
    let done = 0, found = 0; const total = todo.length;
    btn.disabled = true; btn.textContent = `Buscando… 0 de ${todo.length}`;
    const worker = async () => { while (todo.length) { const k = todo.shift(); if (await findIllustration(k)) found++; done++; btn.textContent = `Buscando… ${done} de ${total}`; } };
    await Promise.all([worker(), worker(), worker()]);
    btn.textContent = `Listo: ${found} ${found === 1 ? "lámina encontrada" : "láminas encontradas"}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = "Volver a buscar las láminas antiguas"; }, 4000);
  });
  $app.querySelector("#missions")?.addEventListener("change", (e) => { cfg.missionsOff = !e.target.checked; saveCfg(cfg); });
  const $zq = $app.querySelector("#zoneq"), $zl = $app.querySelector("#zonelist");
  // Zona guardada: se busca la primera misión y se indica dónde verla.
  const zoneReady = async () => {
    const note = $app.querySelector("#zonedone"); if (!note) return;
    note.hidden = false; note.innerHTML = "Zona guardada. Buscando tu primera misión…";
    try {
      const m = await ensureMission(); navDot();
      note.innerHTML = m ? `Listo: <b>tu misión te espera en Progreso</b>. <button class="linkish" id="zd-go">Ver mi misión</button>` : "Zona guardada, pero no encontré plantas registradas cerca. Probá con un lugar más grande.";
    } catch { note.innerHTML = `Zona guardada. <button class="linkish" id="zd-go">Ver Progreso</button>`; }
    $app.querySelector("#zd-go")?.addEventListener("click", () => go("stats"));
  };
  if ($zq) {
    let tmr = null, seq = 0;
    const pickZone = (z) => { saveZone(z.lat, z.lng, z.name, z.cc); $zq.value = z.name; $zl.hidden = true; $zq.blur(); zoneReady(); };
    $zq.oninput = () => {
      clearTimeout(tmr);
      const q = $zq.value.trim(); if (q.length < 3) { $zl.hidden = true; return; }
      tmr = setTimeout(async () => {
        const my = ++seq; let list = [];
        try { list = await zoneSuggest(q); } catch { list = null; }
        if (my !== seq) return;
        $zl.innerHTML = list === null ? `<p class="muted">No pude buscar lugares. Probá con tu ubicación actual.</p>`
          : list.length ? list.map((z, i) => `<button type="button" data-i="${i}">${esc(z.name)}</button>`).join("") : `<p class="muted">No encontré ese lugar.</p>`;
        $zl.hidden = false;
        $zl.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => pickZone(list[+b.dataset.i])));
      }, 350);
    };
    $zq.onblur = () => setTimeout(() => ($zl.hidden = true), 200);
    if (cfg.focusZone) { delete cfg.focusZone; saveCfg(cfg); setTimeout(() => { $zq.scrollIntoView({ block: "center" }); $zq.focus(); }, 150); }
  }
  $app.querySelector("#setzone")?.addEventListener("click", (ev) => {
    const b = ev.currentTarget;
    if (!navigator.geolocation) return toast("Este dispositivo no da la ubicación");
    b.disabled = true; b.textContent = "Buscando…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const z = await setZone(pos.coords.latitude, pos.coords.longitude);
      if ($zq) $zq.value = z.name;
      b.disabled = false; b.textContent = "Usar mi ubicación actual"; zoneReady();
    }, () => { b.disabled = false; b.textContent = "Usar mi ubicación actual"; toast("No pude leer la ubicación: revisá el permiso"); }, { timeout: 10000 });
  });
  $app.querySelectorAll("[data-theme-pick]").forEach((b) => (b.onclick = () => {
    cfg.theme = b.dataset.themePick; saveCfg(cfg); applyTheme();
    $app.querySelectorAll("[data-theme-pick]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $app.querySelector("#sharecfg")?.addEventListener("click", async () => {
    const url = shareLink();
    try { if (navigator.share) return await navigator.share({ title: "Herbalorium", text: `${cfg.name ? cfg.name + " te invita a su" : "Te invito a mi"} herbario en Herbalorium 🌿`, url }); } catch { return; }
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch { prompt("Copiá este enlace:", url); }
  });
  $app.querySelector("#save").onclick = () => {
    const prevSb = cfg.sbUrl + cfg.sbKey;
    const sbUrlEl = document.getElementById("sbUrl");
    cfg = { ...cfg, name: v("myname").split(" ")[0] || cfg.name,
      sbUrl: sbUrlEl ? v("sbUrl").replace(/\/(rest\/v1\/?)?$/, "") : cfg.sbUrl, sbKey: sbUrlEl ? v("sbKey") : cfg.sbKey, engrave: document.getElementById("engrave").checked, illustrations: document.getElementById("illustrations").checked };
    saveCfg(cfg);
    if (user && cfg.name && user.user_metadata?.name !== cfg.name) syncMeta({ name: cfg.name });
    document.body.classList.toggle("engrave", cfg.engrave);
    toast("Guardado");
    if (prevSb !== cfg.sbUrl + cfg.sbKey) location.replace(location.pathname);
    else go("list");
  };
  $app.querySelector("#logout")?.addEventListener("click", async () => { await sb.auth.signOut(); go("list"); });
  $app.querySelector("#retour")?.addEventListener("click", () => { cfg.tourPending = true; saveCfg(cfg); go("list"); });
  $app.querySelector("#switchbook")?.addEventListener("click", async () => {
    if (!(await ask({ title: "Cambiar de herbario", text: "Vas a salir de este herbario y elegir otro. Tus láminas se quedan acá: si te cambiás, dejás de verlas.", ok: "Cambiar", cancel: "Quedarme" }))) return;
    try { await sb.auth.signOut(); } catch {}
    cfg = { ...cfg, sbUrl: "", sbKey: "", onboarded: false }; saveCfg(cfg);
    try { localStorage.removeItem(ACH_KEY); } catch {}
    location.replace(SITE_URL());
  });
  $app.querySelector("#leavebook")?.addEventListener("click", openLeave);
  $app.querySelector("#news")?.addEventListener("click", () => openNews(true));
  bindIucnBatch();
  $app.querySelector("#export")?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(plants, null, 2)], { type: "application/json" }));
    a.download = `herbalorium-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
}

// ---------- primeros pasos: cada persona crea y conecta su propio Supabase ----------
const SITE_URL = () => location.origin + location.pathname;
// Bienvenida guiada: tema, IA, nombre, unirse o crear un herbario y conexión. Cada pantalla entra con un fundido.
const OB = ["welcome", "theme", "ai", "name", "choice", "connect", "loading"];
let ob = null;
const AI_APPS = [
  ["ChatGPT", "https://play.google.com/store/apps/details?id=com.openai.chatgpt", "Ch"],
  ["Claude", "https://play.google.com/store/apps/details?id=com.anthropic.claude", "Cl"],
  ["Gemini", "https://play.google.com/store/apps/details?id=com.google.android.apps.bard", "Ge"],
];
function renderSetup() {
  $nav.hidden = true;
  document.body.classList.add("onboarding");
  if (!ob) ob = { i: 0, path: pendingInvite ? "join" : null, invite: pendingInvite, name: cfg.name || "" };
  $app.innerHTML = `<div class="ob"><div class="ob-screen" id="obs"></div><div class="ob-dots" id="obdots"></div></div>`;
  obPaint();
}
function obGo(i) {
  const scr = document.getElementById("obs"); if (!scr) return;
  scr.classList.add("out");
  setTimeout(() => { ob.i = i; obPaint(); window.scrollTo(0, 0); }, 260);
}
function obPaint() {
  const scr = document.getElementById("obs"), step = OB[ob.i];
  document.getElementById("obdots").innerHTML = OB.map((_, k) => `<i class="${k === ob.i ? "on" : k < ob.i ? "done" : ""}"></i>`).join("") + `<span>${ob.i + 1} de ${OB.length}</span>`;
  const back = ob.i > 0 && step !== "loading" ? `<button class="back ob-back" id="obback">← Atrás</button>` : "";
  scr.innerHTML = back + (OB_SCREENS[step]() || "");
  scr.classList.remove("out");
  scr.querySelector("#obback")?.addEventListener("click", () => obGo(ob.i - 1));
  OB_BIND[step]?.(scr);
}
const OB_SCREENS = {
  welcome: () => `<div class="ob-center ob-welcome">
      <svg class="ob-emblem"><use href="#i-emblem"/></svg>
      <h1 class="ob-title">Herbalorium</h1>
      <p class="ob-sub">Herbarium vivum</p>
      <p class="lead">Fotografiá plantas, descubrí qué son y armá tu propio libro de botánica: solo o con amigos.</p>
      <button class="btn primary" id="obnext">Empezar</button></div>`,
  theme: () => `<div class="ob-center"><h2>¿Cómo lo preferís?</h2>
      <p class="lead">Elegí cómo se ve tu herbario. Podés cambiarlo cuando quieras en Ajustes.</p>
      <div class="theme-pick ob-theme">${[["light", "Claro"], ["dark", "Oscuro"], ["auto", "Automático"]].map(([k, l]) => `<button data-theme-pick="${k}" class="${(cfg.theme || "auto") === k ? "on" : ""}"><i class="sw-${k}"></i>${l}</button>`).join("")}</div>
      <p class="muted ob-note">Automático sigue el tema de tu celular.</p>
      <button class="btn primary ob-cta" id="obnext">Continuar</button></div>`,
  ai: () => `<div class="ob-center"><h2>Vas a necesitar una IA</h2>
      <p class="lead">Herbalorium no tiene inteligencia artificial propia: usa la que ya tengas. Le pasás las fotos con un toque, ella identifica la planta y vos pegás la respuesta. Alcanza con la versión gratis.</p>
      <div class="ob-apps">${AI_APPS.map(([n, url, l]) => `<a class="ob-app" href="${url}" target="_blank" rel="noopener"><span>${l}</span><b>${n}</b><small>Descargar</small></a>`).join("")}</div>
      <button class="btn primary ob-cta" id="obnext">Ya tengo una app de IA</button></div>`,
  name: () => `<div class="ob-center"><h2>¿Cómo te llamás?</h2>
      <p class="lead">Tu nombre va a aparecer en las láminas que cargues, para que se sepa quién encontró cada planta.</p>
      <input id="obname" class="ob-input" placeholder="Tu nombre" maxlength="30" autocomplete="given-name" value="${esc(ob.name)}">
      <button class="btn primary ob-cta" id="obnext" ${ob.name.trim() ? "" : "disabled"}>Continuar</button></div>`,
  choice: () => `<div class="ob-center"><h2>¿Herbario propio o compartido?</h2>
      <p class="lead">Podés sumarte al herbario de otra persona o empezar el tuyo. <button class="info-btn inline" id="obinfo" aria-label="Diferencias"><svg><use href="#f-info"/></svg></button></p>
      <div class="ob-choices">
        <button class="ob-choice" data-path="join"><svg><use href="#i-book"/></svg><b>Unirme a un herbario</b><span>Alguien ya lo creó y te invitó: vas a ver sus láminas y sumar las tuyas.</span></button>
        <button class="ob-choice" data-path="new"><svg><use href="#f-herb"/></svg><b>Crear mi herbario</b><span>Empezás de cero, en tu propia nube gratuita. Lleva unos 10 minutos.</span></button>
      </div></div>`,
  connect: () => ob.path === "join" ? obJoinHTML() : obNewHTML(),
  loading: () => `<div class="ob-center ob-loading"><svg class="ob-emblem spin"><use href="#i-emblem"/></svg>
      <h2 id="obload">Preparando tu herbario…</h2><div class="ach-prog big ob-bar"><i id="obbar"></i></div></div>`,
};
function obJoinHTML() {
  const inv = ob.invite;
  if (inv) return `<div class="ob-center"><h2>Te invitaron</h2>
      <div class="ob-invite"><svg><use href="#i-book"/></svg><b>${inv.o ? "El herbario de " + esc(inv.o) : "Un herbario compartido"}</b><span>Vas a ver sus láminas y sumar las tuyas.</span></div>
      <p class="lead">Entrás con tu email y <b>el dueño del herbario recibe tu pedido</b>. Cuando lo acepte, vas a ver todas las láminas.</p>
      <p class="muted" id="obmsg"></p>
      <button class="btn primary ob-cta" id="objoin">Unirme</button>
      <button class="btn ghost" id="obnew">Prefiero crear mi herbario</button></div>`;
  return `<div class="ob-center"><h2>Unirme a un herbario</h2>
      <p class="lead">Pedile a alguien del herbario su <b>enlace de invitación</b> (está en <i>Ajustes</i>). Después entrás con tu email y el dueño del herbario acepta tu pedido.</p>
      <label>Enlace de invitación</label>
      <div class="row ob-paste"><input id="oblink" placeholder="https://herbalorium.pages.dev/?c=…"><button class="btn" id="obpaste" style="flex:none">Pegar</button></div>
      <details><summary>O cargá los datos a mano</summary>
        <label>Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co">
        <label>Publishable key</label><input id="sbKey" placeholder="sb_publishable_…"></details>
      <p class="muted" id="obmsg"></p>
      <button class="btn primary ob-cta" id="objoin">Unirme</button></div>`;
}
function obNewHTML() {
  const copyBtn = (id, label) => `<button class="btn" id="${id}" style="flex:none">${label}</button>`;
  return `<div class="ob-center"><h2>Crear mi herbario</h2>
      <p class="lead">Tu herbario vive en tu propia nube gratuita (Supabase). Se configura una sola vez.</p></div>
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
    <p class="muted" id="obmsg" style="text-align:center"></p>
    <button class="btn primary ob-cta" id="objoin" style="width:100%">Conectar mi herbario</button>
    <p class="muted" style="font-size:15px;text-align:center"><i>Dejá activado en Supabase «Allow new users to sign up» (Authentication → Sign In / Providers → Email): así quien reciba tu invitación puede pedirte entrar, y vos lo aceptás desde Ajustes.</i></p>`;
}
// Prueba que la nube responda y tenga la tabla de láminas.
async function testConnection(url, key) {
  const { error } = await createClient(url, key).from("plants").select("id").limit(1);
  if (error && /relation|does not exist|schema cache/i.test(error.message)) throw new Error("La conexión anda, pero a esa nube le falta el código SQL.");
  if (error && !/permission|JWT|row-level/i.test(error.message)) throw new Error(error.message);
}
const OB_BIND = {
  welcome: (scr) => { scr.querySelector("#obnext").onclick = () => obGo(1); },
  theme: (scr) => {
    scr.querySelectorAll("[data-theme-pick]").forEach((b) => (b.onclick = () => {
      cfg.theme = b.dataset.themePick; saveCfg(cfg); applyTheme();
      scr.querySelectorAll("[data-theme-pick]").forEach((x) => x.classList.toggle("on", x === b));
    }));
    scr.querySelector("#obnext").onclick = () => obGo(2);
  },
  ai: (scr) => { scr.querySelector("#obnext").onclick = () => obGo(3); },
  name: (scr) => {
    const inp = scr.querySelector("#obname"), btn = scr.querySelector("#obnext");
    inp.oninput = () => { ob.name = inp.value.replace(/\s+/g, " ").trimStart(); btn.disabled = !ob.name.trim(); };
    inp.onkeydown = (e) => e.key === "Enter" && !btn.disabled && btn.click();
    btn.onclick = () => { ob.name = ob.name.trim().split(" ")[0]; obGo(ob.invite ? 5 : 4); };
    setTimeout(() => inp.focus(), 300);
  },
  choice: (scr) => {
    scr.querySelector("#obinfo").onclick = openShareInfo;
    scr.querySelectorAll(".ob-choice").forEach((b) => (b.onclick = () => { ob.path = b.dataset.path; obGo(5); }));
  },
  connect: (scr) => {
    const msg = scr.querySelector("#obmsg");
    scr.querySelector("#obnew")?.addEventListener("click", () => { ob.invite = null; ob.path = "new"; obGo(5); });
    scr.querySelector("#obpaste")?.addEventListener("click", async () => { try { scr.querySelector("#oblink").value = await navigator.clipboard.readText(); } catch { toast("Mantené apretado el campo y elegí «Pegar»"); } });
    const copy = async (txt, ok) => { try { await navigator.clipboard.writeText(txt); toast(ok); } catch { toast("No pude copiar automáticamente"); } };
    scr.querySelector("#cpurl")?.addEventListener("click", () => copy(SITE_URL(), "Dirección copiada"));
    scr.querySelector("#cpsql")?.addEventListener("click", async () => {
      try { const r = await fetch("supabase/schema.sql", { cache: "no-store" }); copy(await r.text(), "Código SQL copiado"); } catch { toast("No pude bajar el código SQL"); }
    });
    scr.querySelector("#objoin").onclick = async (ev) => {
      let url, key;
      try {
        if (ob.invite) ({ u: url, k: key } = ob.invite);
        else if (scr.querySelector("#oblink")?.value.trim()) ({ u: url, k: key } = parseInvite(scr.querySelector("#oblink").value));
        else { url = v("sbUrl").replace(/\/(rest\/v1\/?)?$/, ""); key = v("sbKey"); }
      } catch { return (msg.textContent = "Ese enlace de invitación no es válido."); }
      if (!/^https:\/\/.+\.supabase\.co$/.test(url || "") || !key) return (msg.textContent = ob.path === "join" ? "Pegá el enlace de invitación." : "Revisá la Project URL y la key.");
      ev.currentTarget.disabled = true; msg.textContent = "Probando la conexión…";
      try { await testConnection(url, key); ob.conn = { url, key }; obGo(6); }
      catch (e) { msg.textContent = e.message; ev.currentTarget.disabled = false; }
    };
  },
  loading: () => {
    const words = ["Preparando tu herbario…", "Afilando la pluma…", "Ordenando las láminas…", "Listo."];
    const bar = document.getElementById("obbar"), h = document.getElementById("obload");
    requestAnimationFrame(() => (bar.style.width = "100%"));
    words.forEach((w, k) => setTimeout(() => h && (h.textContent = w), k * 900));
    setTimeout(() => {
      cfg = { ...cfg, uid: null, sbUrl: ob.conn.url, sbKey: ob.conn.key, name: ob.name.trim(), onboarded: true, tourPending: true, newsSeen: NEWS[0].v, joinedFrom: ob.path === "join" ? (ob.invite?.o || "") : null };
      saveCfg(cfg);
      location.replace(SITE_URL());
    }, 3400);
  },
};
// Por qué la identificación pasa por una IA.
function openWhyAI() {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Cerrar">×</button>
    <h3>¿Por qué usamos IA?</h3>
    <p><b>Reconocer una planta en una foto no se puede hacer con una simple búsqueda.</b> Hay unas 390.000 especies de plantas conocidas, y para identificarlas a partir de una imagen hace falta un sistema entrenado con millones de fotos: eso es, justamente, una inteligencia artificial.</p>
    <p><b>Además hay que cruzar datos.</b> La IA mira las fotos, pero también el lugar y la fecha del hallazgo, para descartar plantas que no crecen ahí o que no florecen en esa época.</p>
    <p><b>Montarlo por nuestra cuenta costaría mucho:</b> servidores, modelos y una base de datos gigante. Usar la IA que ya tenés en el celular lo resuelve rápido y gratis.</p>
    <p><b>No necesitás pagar nada.</b> Las versiones gratuitas de ChatGPT, Claude o Gemini alcanzan. Lo único: tienen un límite de imágenes por día, que para un paseo normal sobra.</p></div>`;
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  document.body.appendChild(m);
}

// ---------- novedades: lo que cambió desde la última vez que entraste ----------
// La más nueva va primero; subí "v" en cada entrada nueva. Solo cosas que la gente note, nada técnico.
// Se agregan únicamente cuando Nico lo pide. Se ven una sola vez por persona: lo leído queda en el celular y en su cuenta.
const NEWS = [
  { v: 3, date: "2026-10-22", items: [
    "<b>Misiones de exploración.</b> Te propongo una planta que se vio cerca de tu casa y que todavía no está en el herbario. Cuando la encontrás y la asentás, al día siguiente llega otra. Las vas a ver en <b>Progreso</b> (antes, Logros), junto con siete logros nuevos de exploración para ir desbloqueando.",
    "<b>Tu zona.</b> En Ajustes, escribí tu barrio o pueblo para recibir misiones de tu zona.",
    "<b>La IA pregunta si duda.</b> Si no está segura de qué planta es, te pide una foto o un dato más antes de darte la ficha.",
    "<b>Leyenda.</b> En el herbario, tocá «Leyenda» para ver qué significa cada símbolo.",
  ] },
  { v: 2, date: "2026-10-21", items: [
    "<b>Sello Nova.</b> Las láminas nuevas que suben los demás llevan un sello dorado hasta que las abrís.",
    "<b>Borrar fotos.</b> Tocá una foto tuya en la lámina y elegí «Borrar foto». También podés borrarla desde Editar, con la ✕.",
    "<b>Tarjetas más claras.</b> El estado de conservación y si se come o es tóxica ahora están debajo del nombre.",
  ] },
  { v: 1, date: "2026-10-21", items: [
    "<b>Tu perfil.</b> En Ajustes, tu nombre ahora tiene su medallón con tu inicial.",
    "<b>Hallazgos.</b> Al final de cada lámina se ve quién encontró esa planta y cuándo.",
    "<b>Sin láminas repetidas.</b> Si subís una planta que ya está en el herbario, tu hallazgo se suma a esa lámina. Y si ya la tenías, te avisa.",
    "<b>Filtros nuevos.</b> En el herbario, tocá Filtrar para combinar tipos de planta o ver lo que encontró cada persona.",
    "<b>Historia y origen juntos</b>, para que cada lámina tenga menos secciones que abrir.",
  ] },
];
// Quien creó su cuenta después de la última novedad ya conoce la app así: no se le muestra.
const newsSeen = () => Math.max(cfg.newsSeen || 0, user?.user_metadata?.news_seen || 0, (user?.created_at || "").slice(0, 10) >= NEWS[0].date ? NEWS[0].v : 0);
function openNews(all = false) {
  const seen = all ? 0 : newsSeen();
  const list = NEWS.filter((n) => n.v > seen);
  const fmt = (d) => new Date(d + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box news" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Cerrar">×</button>
    <h3>Novedades del herbario</h3>
    ${list.map((n) => `${new Set(list.map((x) => x.date)).size > 1 ? `<p class="news-date">${fmt(n.date)}</p>` : ""}<ul>${n.items.map((i) => `<li>${i}</li>`).join("")}</ul>`).join("")}
    <div class="row"><button class="btn primary" id="news-ok">A explorar</button></div></div>`;
  const close = () => {
    m.remove(); cfg.newsSeen = NEWS[0].v; saveCfg(cfg); if (!all) maybeMissionsIntro(450);
    if ((user?.user_metadata?.news_seen || 0) < NEWS[0].v) Promise.resolve().then(() => sb.auth.updateUser({ data: { news_seen: NEWS[0].v } })).then(({ data }) => data?.user && (user = data.user)).catch(() => {});
  };
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  m.querySelector("#news-ok").onclick = close;
  document.body.appendChild(m);
}

// Sello de lacre que se estampa al asentar una lámina o sumar un hallazgo: feedback de "quedó guardado".
// Celebración de misión cumplida: aparece después del sello de "asentada".
function missionCelebration(name) {
  const m = missionOf();
  const ov = document.createElement("div");
  ov.className = "stamp mission-win";
  ov.setAttribute("role", "status");
  ov.innerHTML = `<svg class="win-compass" viewBox="0 0 120 120"><use href="#i-compass"/></svg>
    <p class="stamp-l">Misión cumplida</p><p class="stamp-n">${esc(name || "")}</p>
    ${m?.done ? `<p class="win-next">Tu próxima misión llega ${untilNext(m)}. Mirala en Progreso.</p>` : ""}`;
  document.body.appendChild(ov);
  try { navigator.vibrate?.([20, 60, 20]); } catch {}
  const bye = () => { ov.classList.add("out"); setTimeout(() => ov.remove(), 400); navDot(); };
  ov.onclick = bye;
  setTimeout(bye, 2800);
}
function stampSeal(label, name, then) {
  const ov = document.createElement("div");
  ov.className = "stamp";
  ov.setAttribute("role", "status");
  ov.innerHTML = `<div class="stamp-ink"></div><div class="stamp-seal"><svg><use href="#i-seal-blank"/></svg><svg class="stamp-mark"><use href="#i-emblem"/></svg></div>
    <p class="stamp-l">${esc(label)}</p><p class="stamp-n">${esc(name || "")}</p>`;
  document.body.appendChild(ov);
  try { navigator.vibrate?.(18); } catch {}
  let gone = false;
  const bye = () => { if (gone) return; gone = true; ov.classList.add("out"); setTimeout(() => { ov.remove(); then?.(); }, 400); };
  ov.onclick = bye;
  setTimeout(bye, 1600);
}

// Visor de fotos a pantalla completa. Recibe una lista de fotos {src, small, title, sub, credit} y la que se abre primero;
// se pasa de una a otra deslizando o con las flechas. Muestra la versión chica (ya cargada) y la cambia por la grande cuando llega.
function openViewer(items, start = 0, opts = {}) {
  let i = start;
  const v = document.createElement("div");
  v.className = "viewer";
  v.innerHTML = `<button class="viewer-x" aria-label="Cerrar">×</button>
    <div class="viewer-stage">${items.length > 1 ? `<button class="viewer-nav prev" aria-label="Anterior">‹</button><button class="viewer-nav next" aria-label="Siguiente">›</button>` : ""}
      <div class="viewer-mat"><img alt=""></div></div>
    <div class="viewer-card"><div class="viewer-cap"></div>${opts.info ? `<div class="viewer-info"></div>` : ""}</div>`;
  const img = v.querySelector("img"), cap = v.querySelector(".viewer-cap"), info = v.querySelector(".viewer-info");
  // Fotos y texto que llegan después (por ejemplo, de iNaturalist y Wikipedia).
  v.addItems = (more) => { const had = items.length; items.push(...more.filter((x) => !items.some((y) => y.src === x.src))); if (had === 1 && items.length > 1) { v.querySelector(".viewer-stage").insertAdjacentHTML("afterbegin", `<button class="viewer-nav prev" aria-label="Anterior">‹</button><button class="viewer-nav next" aria-label="Siguiente">›</button>`); bindNav(); } show(); };
  v.setInfo = (html) => { if (info) info.innerHTML = html; };
  const show = () => {
    const it = items[i];
    img.src = it.small || it.src; img.alt = it.title || "";
    if (it.src && it.src !== it.small) { const big = new Image(); big.onload = () => items[i] === it && (img.src = it.src); big.src = it.src; }
    cap.innerHTML = `<b>${esc(it.title || "")}</b>${it.sub ? `<i>${esc(it.sub)}</i>` : ""}${it.credit ? `<small>${esc(it.credit)}</small>` : ""}${items.length > 1 ? `<small>${i + 1} de ${items.length}</small>` : ""}`;
  };
  const step = (d) => { i = (i + d + items.length) % items.length; show(); };
  // El botón "atrás" del celular cierra el visor en vez de salir de la pantalla.
  history.pushState({ viewer: 1 }, "");
  let closed = false;
  const close = (fromBack) => { if (closed) return; closed = true; v.classList.add("out"); setTimeout(() => v.remove(), 220); removeEventListener("popstate", onBack); document.removeEventListener("keydown", onKey); if (!fromBack) history.back(); };
  const onBack = () => close(true);
  const onKey = (e) => (e.key === "Escape" ? close() : e.key === "ArrowLeft" ? step(-1) : e.key === "ArrowRight" ? step(1) : null);
  addEventListener("popstate", onBack);
  document.addEventListener("keydown", onKey);
  const bindNav = () => {
    v.querySelector(".prev")?.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    v.querySelector(".next")?.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
  };
  bindNav();
  // La ficha de abajo se puede leer y tocar sin cerrar el visor.
  v.querySelector(".viewer-card").addEventListener("click", (e) => e.stopPropagation());
  // Deslizar para pasar de foto; un toque sin deslizar cierra.
  let x0 = null, moved = false;
  v.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; moved = false; }, { passive: true });
  v.addEventListener("touchmove", (e) => { if (x0 !== null && Math.abs(e.touches[0].clientX - x0) > 12) moved = true; }, { passive: true });
  v.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (items.length > 1 && Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
  v.onclick = () => { if (moved) { moved = false; return; } close(); };
  if (opts.info) v.setInfo(opts.info);
  show();
  document.body.appendChild(v);
  return v;
}

// Pista para reconocer una especie de misión: resumen de Wikipedia en castellano (o el de iNaturalist)
// y más fotos de la especie en iNaturalist. Se guarda en el celular para no volver a pedirla.
const HINT_KEY = "plantdex.hint";
async function missionExtras(m) {
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(HINT_KEY) || "{}"); } catch {}
  if (cache[m.id]) return cache[m.id];
  const out = { text: "", wiki: "", photos: [] };
  const firstSentences = (t) => { const parts = String(t).replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g) || [t]; let r = ""; for (const p of parts) { if ((r + p).length > 360 && r) break; r += p; } return r.trim(); };
  const [tx, wp] = await Promise.allSettled([
    fetch(`https://api.inaturalist.org/v1/taxa/${m.id}?locale=es`).then((r) => r.json()),
    fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(m.name.replace(/ /g, "_"))}`).then((r) => (r.ok ? r.json() : null)),
  ]);
  const t = tx.status === "fulfilled" ? tx.value?.results?.[0] : null;
  if (wp.status === "fulfilled" && wp.value?.extract && wp.value.type !== "disambiguation") { out.text = firstSentences(wp.value.extract); out.wiki = wp.value.content_urls?.mobile?.page || ""; }
  else if (t?.wikipedia_summary) out.text = firstSentences(t.wikipedia_summary.replace(/<[^>]+>/g, ""));
  out.photos = (t?.taxon_photos || []).slice(0, 8).map(({ photo: ph }) => ({ src: ph.large_url || ph.medium_url, small: ph.medium_url, credit: ph.attribution ? `Foto: ${ph.attribution} · iNaturalist` : "" })).filter((x) => x.src);
  cache[m.id] = out;
  try { localStorage.setItem(HINT_KEY, JSON.stringify(Object.fromEntries(Object.entries(cache).slice(-20)))); } catch {}
  return out;
}
async function openMissionViewer(m) {
  const base = { title: m.common || m.name, sub: m.common ? m.name : "" };
  const first = { ...base, src: m.photo.replace(/\/(square|small|medium)\.(\w+)(\?.*)?$/, "/large.$2"), small: m.photo, credit: m.credit ? `Foto: ${m.credit} · iNaturalist` : "" };
  const v = openViewer([first], 0, { info: `<p class="vi-h">Pista</p><p class="vi-t muted">Buscando cómo reconocerla…</p>` });
  try {
    const x = await missionExtras(m);
    v.addItems(x.photos.map((ph) => ({ ...base, ...ph })));
    v.setInfo(x.text ? `<p class="vi-h">Pista</p><p class="vi-t">${esc(x.text)}</p>${x.wiki ? `<a class="vi-more" href="${esc(x.wiki)}" target="_blank" rel="noopener">Seguir leyendo en Wikipedia</a>` : ""}`
      : `<p class="vi-h">Pista</p><p class="vi-t muted">No encontré una descripción. Mirá las fotos con atención: hojas, flores y frutos.</p>`);
  } catch { v.setInfo(`<p class="vi-h">Pista</p><p class="vi-t muted">No pude traer la descripción ahora. Probá de nuevo más tarde.</p>`); }
}

// Pregunta con la estética del herbario (en lugar del cartel del navegador). Resuelve true si acepta.
function ask({ title, text, ok = "Aceptar", cancel = "Cancelar" }) {
  return new Promise((res) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="modal-box ask" role="alertdialog" aria-modal="true"><h3>${title}</h3><p>${text}</p>
      <div class="row"><button class="btn ghost" data-a="0">${cancel}</button><button class="btn primary" data-a="1">${ok}</button></div></div>`;
    const done = (v) => { m.remove(); document.removeEventListener("keydown", key); res(v); };
    const key = (e) => e.key === "Escape" && done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
    m.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => done(b.dataset.a === "1")));
    document.addEventListener("keydown", key);
    document.body.appendChild(m);
    m.querySelector("[data-a='1']").focus();
  });
}

// Salir de un herbario ajeno: borra tu cuenta en esa nube (para volver hace falta otra invitación)
// y te deja elegir si tus láminas se quedan (pasan al dueño, con tu firma) o te las llevás (se borran).
function openLeave() {
  const who = cfg.joinedFrom ? esc(cfg.joinedFrom) : "quien lo creó";
  const mine = plants.filter((p) => p.user_id === user.id);
  const shared = mine.filter((p) => (p.sightings || []).some((s) => s.user_id !== user.id));
  const n = (k) => `${k} lámina${k === 1 ? "" : "s"}`;
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Cerrar">×</button>
    <h3>Salir de este herbario</h3>
    <p>Vas a dejar ${cfg.joinedFrom ? "el herbario de " + who : "este herbario"}. <b>Para volver a entrar vas a tener que pedirle a ${who} que te invite de nuevo.</b></p>
    ${mine.length ? `<p>¿Qué hacemos con tus ${n(mine.length)}?</p>
      <label class="toggle"><input type="radio" name="take" value="0" checked> <span><b>Dejarlas en el herbario.</b> Siguen firmadas con tu nombre y quedan al cuidado de ${who}.</span></label>
      <label class="toggle"><input type="radio" name="take" value="1"> <span><b>Llevármelas.</b> Se borran del herbario con sus fotos y no se pueden recuperar.${shared.length ? ` ${shared.length === 1 ? "La que también encontró otra persona se queda" : `Las ${shared.length} que también encontraron otras personas se quedan`}, para no borrar sus hallazgos.` : ""}</span></label>` : ""}
    <p class="muted">Lo que encontraste en láminas de otros se queda en el herbario.</p>
    <div class="row" style="margin-top:18px"><button class="btn ghost" id="lv-no">Cancelar</button><button class="btn primary" id="lv-yes">Salir</button></div></div>`;
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  m.querySelector("#lv-no").onclick = close;
  const yes = m.querySelector("#lv-yes");
  m.querySelectorAll("[name=take]").forEach((r) => (r.onchange = () => (yes.textContent = r.value === "1" && r.checked ? "Salir y borrar mis láminas" : "Salir")));
  yes.onclick = async () => {
    const take = m.querySelector("[name=take]:checked")?.value === "1";
    yes.disabled = true; yes.textContent = "Saliendo…";
    const gone = take ? mine.filter((p) => !shared.includes(p)) : [];
    const { error } = await sb.rpc("leave_herbarium", { take_mine: take });
    if (error) { yes.disabled = false; yes.textContent = "Salir"; return toast("No se pudo salir: " + error.message); }
    // Las fotos de las láminas borradas se limpian al final: si falla, solo quedan archivos sueltos.
    const files = gone.flatMap((p) => [...(p.photos || []), ...(p.sightings || []).flatMap((s) => s.photos || [])]);
    if (files.length) try { await sb.storage.from(BUCKET).remove(files); } catch {}
    try { await sb.auth.signOut(); } catch {}
    cfg = { ...cfg, sbUrl: "", sbKey: "", onboarded: false, joinedFrom: null }; saveCfg(cfg);
    try { localStorage.removeItem(ACH_KEY); } catch {}
    location.replace(SITE_URL());
  };
  document.body.appendChild(m);
}

// Explica la diferencia entre unirse y crear (y qué pasa si después te cambiás).
function openShareInfo() {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Cerrar">×</button>
    <h3>Propio o compartido</h3>
    <p><b>Unirte a un herbario</b> es entrar al libro de otra persona: ves todas sus láminas y las tuyas se suman al mismo libro, con tu nombre. Cada uno edita solo lo que cargó. Hace falta que esa persona te invite.</p>
    <p><b>Crear tu herbario</b> es empezar tu propio libro, en tu propia nube gratuita. Después podés invitar a quien quieras.</p>
    <p class="muted">Podés cambiar de herbario más adelante desde Ajustes, pero las láminas quedan en el herbario donde las publicaste: si te cambiás, dejás de verlas.</p></div>`;
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  document.body.appendChild(m);
}

// ---------- tutorial: enfoca cada sección y explica para qué sirve ----------
// Cada paso dice en qué pantalla se muestra: el tutorial va cambiando de página y al final vuelve al herbario.
// Cada paso dice en qué pantalla se muestra ("plant" = la primera lámina del herbario) y qué señala
// (con "||" se prueba el siguiente si el primero no está). El tutorial va cambiando de página y al final vuelve al herbario.
const TOUR = [
  ["list", "#app .entry-head h2", "Tu herbario", "Acá están todas las láminas, en orden alfabético. Tocá una para abrir su ficha completa."],
  ["list", ".viewsw", "Láminas o índice", "Cambiá entre la vista con imágenes y una lista compacta, más cómoda cuando tengas muchas."],
  ["list", ".search", "Buscar y filtrar", "Buscá por nombre, latín, familia o lugar. Con Filtrar elegís tipos de planta o quién la encontró, y podés sumar varios."],
  ["list", "#app .card .pstrip", "Los símbolos", "Dicen el estado de conservación de cada planta y para qué sirve. El sello dorado «Nova» marca las láminas nuevas de los demás hasta que las abrís. En «Leyenda», arriba a la derecha, está qué significa cada uno."],
  ["plant", "#app .hero||#app h2", "La ficha", "Tocá la foto para verla en grande y pasar entre fotos. Más abajo: para qué sirve, su historia y quién la encontró."],
  ["list", ".bottom .capture", "El sello: nueva lámina", "Sacá o elegí fotos de una planta. La app se las pasa a tu IA con el prompt listo; vos pegás la respuesta y la ficha se completa sola. Si la IA duda, te pide otra foto antes. Y si la planta ya está en el herbario, tu hallazgo se suma a esa lámina."],
  ["cal", "#app h2", "Calendario", "Qué florece y qué se puede recolectar cada mes, según las láminas del herbario."],
  ["stats", "#mission", "Tu misión", "Cada día, una planta que se vio cerca de tu casa para salir a buscar. Cuando la asentás, se cumple, y al día siguiente llega otra.", "misiones"],
  ["stats", "#app h2", "Logros", "Más de 60 logros que se desbloquean a medida que tu herbario crece."],
  ["settings", "#app .me-row", "Ajustes", "Tu nombre y tu medallón, el tema, invitar a otras personas y el resto de las opciones."],
];
const currentView = () => location.hash.slice(1).split("/")[0] || "list";
// Espera a que la pantalla pinte el elemento (las páginas se dibujan de forma asíncrona).
const waitFor = async (sel, ms = 2500) => {
  for (let t = 0; t < ms; t += 100) { const el = document.querySelector(sel); if (el && el.offsetParent !== null) return el; await new Promise((r) => setTimeout(r, 100)); }
  return null;
};
function startTour() {
  if (document.querySelector(".tour")) return;
  const steps = TOUR.filter((t) => !t[4] || feat(t[4])).map((t0) => {
    const t = [...t0];
    if (!feat("misiones")) return t;
    if (t[2] === "Logros") return [t[0], t[1], t[2], "Más de 60 logros que se desbloquean a medida que tu herbario crece, incluidos los de exploración."];
    if (t[0] === "settings") return [t[0], t[1], t[2], "Tu nombre y tu medallón, tu zona para las misiones, el tema e invitar a otras personas."];
    return t;
  });
  // El paso de los símbolos se apoya en las tarjetas: durante el tutorial se muestra la vista con imágenes.
  const prevView = cfg.view;
  if (prevView === "list") { cfg.view = "grid"; if (currentView() === "list") renderList(); }
  let i = 0, busy = false;
  const ov = document.createElement("div");
  ov.className = "tour";
  ov.innerHTML = `<div class="tour-hole"></div><div class="tour-card"><small></small><b></b><p></p><div class="tour-dots"></div>
    <div class="tour-btns"><button class="btn ghost" data-skip>Saltar</button><button class="btn primary" data-next>Siguiente</button></div></div>`;
  document.body.appendChild(ov);
  const hole = ov.querySelector(".tour-hole"), card = ov.querySelector(".tour-card");
  const place = () => {
    const el = document.querySelector(steps[i][1]); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
    const below = r.top < innerHeight / 2, ch = card.offsetHeight || 220, edge = 16;
    // Si lo señalado es muy alto (una foto grande), el cartel queda pegado al borde para no salirse de la pantalla.
    const top = Math.min(r.bottom + pad + 14, innerHeight - ch - edge), bottom = Math.min(innerHeight - r.top + pad + 14, innerHeight - ch - edge);
    card.style.top = below ? Math.max(edge, top) + "px" : "auto";
    card.style.bottom = below ? "auto" : Math.max(edge, bottom) + "px";
  };
  const show = async () => {
    if (busy) return; busy = true;
    card.classList.add("out");
    const [view, sels, t, d] = steps[i];
    const target = view === "plant" ? (plants[0] ? "plant/" + plants[0].id : "") : view;
    const here = view === "plant" ? location.hash.slice(1) === target : currentView() === view;
    if (target && !here) go(target);
    let el = null, sel = "";
    if (target) for (const s1 of sels.split("||")) { el = await waitFor(s1, here || sel ? 700 : 2500); sel = s1; if (el) break; } // en la misma pantalla no hace falta esperar tanto
    steps[i][1] = sel;
    if (!el) { busy = false; steps.splice(i, 1); return i < steps.length ? show() : end(); } // paso sin elemento en esta pantalla: se salta
    if (!el.closest(".bottom")) el.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 180));
    card.querySelector("small").textContent = `${i + 1} de ${steps.length}`;
    card.querySelector("b").textContent = t; card.querySelector("p").textContent = d;
    card.querySelector(".tour-dots").innerHTML = steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
    card.querySelector("[data-next]").textContent = i === steps.length - 1 ? "Empezar" : "Siguiente";
    place(); card.classList.remove("out"); busy = false;
  };
  const end = () => {
    ov.classList.add("out"); setTimeout(() => ov.remove(), 250);
    cfg.view = prevView; cfg.tourPending = false; cfg.tourDone = true; saveCfg(cfg); removeEventListener("resize", place);
    maybeMissionsIntro(700);
    if (currentView() !== "list") go("list"); else renderList();
  };
  ov.querySelector("[data-skip]").onclick = end;
  ov.querySelector("[data-next]").onclick = () => (busy ? null : i < steps.length - 1 ? (i++, show()) : end());
  addEventListener("resize", place);
  show();
}

// Pedidos para entrar (solo el dueño): aceptar o rechazar a quien llegó con una invitación.
async function paintRequests() {
  const box = $app.querySelector("#requests"); if (!box) return;
  const { data, error } = await sb.from("members").select("user_id,name,email,invited_by,created_at").eq("status", "pending").order("created_at");
  if (error || !data?.length) { box.innerHTML = ""; pendingRequests = 0; navDotSettings(); return; }
  pendingRequests = data.length; navDotSettings();
  const when = (t) => new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  box.innerHTML = `<div class="share-box requests"><h3>Pedidos para entrar</h3>
    ${data.map((r) => `<div class="req" data-u="${r.user_id}"><span class="avatar sm" aria-hidden="true">${esc([...(r.name || r.email || "?")][0].toUpperCase())}</span>
      <div class="req-txt"><b>${esc(r.name || "Sin nombre")}</b><span>${esc(r.email || "")}</span><small>${r.invited_by ? `Invitado por ${esc(r.invited_by)} · ` : ""}${when(r.created_at)}</small></div>
      <div class="req-btns"><button class="btn primary" data-ok>Aceptar</button><button class="linkish" data-no>Rechazar</button></div></div>`).join("")}</div>`;
  box.querySelectorAll(".req").forEach((row) => {
    const decide = async (status) => {
      const r = data.find((x) => x.user_id === row.dataset.u);
      if (status === "rejected" && !(await ask({ title: "Rechazar pedido", text: `${esc(r.name || r.email)} no va a poder entrar al herbario.`, ok: "Rechazar", cancel: "Volver" }))) return;
      const { error: e } = await sb.from("members").update({ status, decided_at: new Date().toISOString() }).eq("user_id", r.user_id);
      if (e) return toast("No se pudo: " + e.message);
      toast(status === "accepted" ? `Listo: ${r.name || r.email} ya puede entrar` : "Pedido rechazado");
      paintRequests();
    };
    row.querySelector("[data-ok]").onclick = () => decide("accepted");
    row.querySelector("[data-no]").onclick = () => decide("rejected");
  });
}
const navDotSettings = () => $nav.querySelector('[data-go="settings"]')?.classList.toggle("has-dot", amOwner && pendingRequests > 0);

// Cuenta creada desde una invitación pero todavía no aceptada por el dueño del herbario.
async function renderWaiting() {
  $nav.hidden = true;
  document.body.classList.remove("onboarding");
  const { data: me } = await sb.from("members").select("status,name").eq("user_id", user.id).maybeSingle();
  const no = me?.status === "rejected";
  const hi = me?.name || cfg.name;
  $app.innerHTML = `<div class="empty"><div class="big">${PLANT_ART}</div>
    <h2>${hi ? "Hola, " + esc(hi) : "Casi adentro"}</h2>
    <p class="lead">${no ? "El dueño del herbario no aceptó tu pedido para entrar. Si creés que es un error, hablalo con quien te invitó."
      : "Tu pedido para entrar ya está en camino. <b>El dueño del herbario tiene que aceptarlo</b>; cuando lo haga, vas a poder ver todas las láminas y sumar las tuyas."}</p>
    ${no ? "" : `<button class="btn primary" id="wcheck" style="width:100%">Ya me aceptaron</button>`}
    <button class="linkish" id="wout">Cerrar sesión</button></div>`;
  $app.querySelector("#wcheck")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true; await loadPlants();
    if (amMember) { toast("¡Bienvenido al herbario!"); go("list"); } else { ev.currentTarget.disabled = false; toast("Todavía no: el pedido sigue esperando"); }
  });
  $app.querySelector("#wout").onclick = async () => { await sb.auth.signOut(); go("list"); };
}

function renderLogin() {
  $nav.hidden = true;
  document.body.classList.remove("onboarding");
  $app.innerHTML = `
    <div class="empty">
      <div class="big">${PLANT_ART}</div>
      <h2>${cfg.name ? "Hola, " + esc(cfg.name) : "Herbarium Vivum"}</h2>
      <p class="lead">${cfg.onboarded && cfg.joinedFrom != null ? "Último paso: entrá con tu email. Te llega un link y el dueño del herbario recibe tu pedido para entrar." : cfg.onboarded ? "Último paso: entrá con tu email. Te llega un link para abrir la app." : "<i>Liber plantarum quas vidi</i>.<br>El libro de las plantas que vi."}</p>
      <label>Tu email</label>
      <input id="email" type="email" placeholder="tu@email.com" style="margin:0 0 22px;text-align:center">
      <button class="btn red" id="send" style="width:100%">Enviar el link</button>
      ${cfg.onboarded ? `<button class="linkish" id="restart">¿Herbario equivocado? Empezar de nuevo</button>` : ""}
    </div>`;
  $app.querySelector("#restart")?.addEventListener("click", async () => {
    if (!(await ask({ title: "Empezar de nuevo", text: "Volvés a la bienvenida para elegir o unirte a otro herbario.", ok: "Empezar de nuevo", cancel: "Quedarme" }))) return;
    cfg = { ...cfg, sbUrl: "", sbKey: "", onboarded: false, joinedFrom: null }; saveCfg(cfg);
    location.replace(SITE_URL());
  });
  $app.querySelector("#send").onclick = async () => {
    const email = v("email"); if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, data: { name: cfg.name || "", invited_by: cfg.joinedFrom || "" } } });
    if (error && /signups? not allowed|sign ?ups? (are )?disabled/i.test(error.message)) return toast("Este herbario todavía no recibe cuentas nuevas: pedile al dueño del herbario que lo habilite.");
    toast(error ? "Error: " + error.message : "Listo, revisá tu correo");
  };
}

const foundBy = (p) => [...new Set([p.author_name, ...(p.sightings || []).map((s) => s.author_name)].filter(Boolean))];
function renderList() {
  const q = filter.q.toLowerCase();
  const list = plants.filter((p) =>
    (!filter.nova || isNova(p)) &&
    filter.types.every((t) => p.types?.includes(t)) &&
    (!filter.who.length || foundBy(p).some((w) => filter.who.includes(w))) &&
    (!q || [p.common_name, p.other_names, p.scientific_name, p.family, p.location_name].join(" ").toLowerCase().includes(q)));
  const used = TYPES.filter((t) => plants.some((p) => p.types?.includes(t)));
  // Personas que encontraron algo: quien subió la lámina y quien sumó un hallazgo, con cuántas láminas tiene cada una.
  const people = Object.entries(plants.reduce((acc, p) => { foundBy(p).forEach((w) => (acc[w] = (acc[w] || 0) + 1)); return acc; }, {})).sort((a, b) => b[1] - a[1]);
  if (!feat("nuevas")) filter.nova = false;
  const novas = feat("nuevas") ? plants.filter(isNova).length : 0;
  const active = filter.types.length + filter.who.length + (filter.nova ? 1 : 0);
  const chipT = (t) => `<span class="chip ${filter.types.includes(t) ? "on" : ""}" data-t="${t}">${TYPE_LABEL[t]}</span>`;
  const chipW = ([w, n]) => `<span class="chip who ${filter.who.includes(w) ? "on" : ""}" data-w="${esc(w)}"><span class="avatar xs">${esc([...w][0].toUpperCase())}</span>${esc(w)} <small>${n}</small></span>`;
  $app.innerHTML = `
    <div class="entry-head"><h2>Herbarium</h2><span class="eh-side"><span class="sc muted">${plants.length} ${plants.length === 1 ? "lámina" : "láminas"}</span>${plants.length ? `<button class="linkish" id="legend">Leyenda</button>` : ""}</span></div>
    ${plants.length ? `<div class="viewsw" role="tablist">
      <button data-v="grid" class="${cfg.view !== "list" ? "on" : ""}">Láminas</button>
      <button data-v="list" class="${cfg.view === "list" ? "on" : ""}">Índice</button>
    </div>` : ""}
    <div class="search"><input id="q" placeholder="Buscar en el herbario…" value="${esc(filter.q)}">
      ${plants.length ? `<button class="filt ${filter.open ? "open" : ""} ${active ? "has" : ""}" id="filt" aria-expanded="${filter.open}"><svg><use href="#i-sieve"/></svg>Filtrar${active ? `<b>${active}</b>` : ""}</button>` : ""}</div>
    ${filter.open ? `<div class="filters">
        ${feat("nuevas") ? `<p class="fl-h">Novedades</p><div class="chips"><span class="chip nova-chip ${filter.nova ? "on" : ""}" data-nova>Nuevas <small>${novas}</small></span></div>` : ""}
        ${used.length ? `<p class="fl-h">Tipo</p><div class="chips">${used.map(chipT).join("")}</div>` : ""}
        ${people.length > 1 ? `<p class="fl-h">Encontrada por</p><div class="chips">${people.map(chipW).join("")}</div>` : ""}
        ${active ? `<button class="linkish" id="fclear">Quitar filtros</button>` : ""}
      </div>` : active ? `<div class="chips active-f">${filter.nova ? `<span class="chip on" data-nova>Nuevas ✕</span>` : ""}${filter.types.map((t) => `<span class="chip on" data-t="${t}">${TYPE_LABEL[t]} ✕</span>`).join("")}${filter.who.map((w) => `<span class="chip on" data-w="${esc(w)}">${esc(w)} ✕</span>`).join("")}</div>` : ""}
    ${plants.length === 0 ? `
      <div class="empty"><div class="big">${PLANT_ART}</div><h3>Las páginas están en blanco</h3>
      <p class="lead">Salí a pasear y tocá el sello verde<br>para asentar tu primera lámina.</p>
      <button class="btn red" id="start">Comenzar el herbario</button></div>` :
      !list.length ? (filter.nova && !novas ? `<div class="all-seen"><svg><use href="#i-seal-gold"/></svg><p><b>Ya viste todas las láminas del herbario.</b><br>Cuando alguien sume una nueva, va a aparecer acá con su sello.</p></div>` : `<p class="muted">Ninguna lámina coincide.</p>`) :
      cfg.view === "list" ? `<ol class="index">${list.map(row).join("")}</ol>` : `<div class="grid">${list.map(card).join("")}</div>`}
  `;
  const $q = $app.querySelector("#q");
  $q.oninput = () => { filter.q = $q.value; const pos = $q.selectionStart; renderList(); const n = $app.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  const toggle = (arr, x) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  $app.querySelectorAll(".chip[data-t]").forEach((c) => (c.onclick = () => { filter.types = toggle(filter.types, c.dataset.t); renderList(); }));
  $app.querySelectorAll(".chip[data-w]").forEach((c) => (c.onclick = () => { filter.who = toggle(filter.who, c.dataset.w); renderList(); }));
  $app.querySelector("#legend")?.addEventListener("click", openLegend);
  $app.querySelector("#filt")?.addEventListener("click", () => { filter.open = !filter.open; renderList(); });
  $app.querySelector("#fclear")?.addEventListener("click", () => { filter.types = []; filter.who = []; filter.nova = false; renderList(); });
  $app.querySelectorAll("[data-nova]").forEach((c) => (c.onclick = () => { filter.nova = !filter.nova; renderList(); }));
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
// ---------- misiones de exploración ----------
// Cada persona marca su zona; la app busca en iNaturalist qué plantas silvestres se registraron cerca en este mes
// (observaciones confirmadas por la comunidad) y propone una que nadie del herbario tenga todavía.
// La misión queda activa sin vencimiento. Se cumple sola al asentar esa especie y la siguiente llega
// al día siguiente, desde la medianoche. Se puede cambiar por otra cuando quieras.
const NEAR_KEY = "plantdex.near";
const nextMissionAt = (m) => { const d = new Date(m.done); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime(); };
const zoneOf = () => cfg.zone || user?.user_metadata?.zone || null;
const syncMeta = (data) => Promise.resolve().then(() => sb.auth.updateUser({ data })).then(({ data: d }) => d?.user && (user = d.user)).catch(() => {});
// Guarda la zona redondeada a ~1 km: alcanza para buscar y no guarda tu casa exacta.
function saveZone(lat, lng, name, cc) {
  const la = Math.round(lat * 100) / 100, ln = Math.round(lng * 100) / 100;
  const z = { lat: la, lng: ln, name: name || `${la}, ${ln}`, cc: cc || "" };
  cfg.zone = z; saveCfg(cfg); syncMeta({ zone: z });
  // Zona nueva: la misión pendiente se recalcula para el lugar nuevo.
  const m = missionOf(); if (m && !m.done) saveMission(null);
  return z;
}
// Sugerencias de lugares mientras escribís (Photon, sobre los mapas abiertos de OpenStreetMap: gratis y sin clave).
async function zoneSuggest(q) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12`);
  const places = ["city", "town", "village", "district", "locality", "suburb", "county", "neighbourhood", "hamlet"];
  return ((await r.json()).features || [])
    .filter((f) => places.includes(f.properties.type) || places.includes(f.properties.osm_value))
    .slice(0, 6).map(({ properties: p, geometry: g }) => ({
      lat: g.coordinates[1], lng: g.coordinates[0], cc: (p.countrycode || "").toLowerCase(),
      name: [...new Set([p.name, p.city !== p.name ? p.city : "", p.state, p.country].filter(Boolean))].join(", "),
    }));
}
const goZone = () => { cfg.focusZone = true; go("settings"); };
async function setZone(lat, lng) {
  const la = Math.round(lat * 100) / 100, ln = Math.round(lng * 100) / 100;
  let name = "", cc = "";
  try {
    const a = (await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${la}&lon=${ln}`)).json()).address || {};
    name = [a.suburb || a.village || a.town || a.city_district || a.city || a.municipality, a.city && (a.suburb || a.city_district) ? a.city : a.state].filter(Boolean).join(", ");
    cc = a.country_code || "";
  } catch {}
  return saveZone(la, ln, name, cc);
}
const missionOf = () => cfg.mission !== undefined ? cfg.mission : user?.user_metadata?.mission || null;
const saveMission = (m) => { cfg.mission = m; saveCfg(cfg); syncMeta({ mission: m }); };
// Especies de plantas silvestres registradas cerca (radio 8 km), de la más vista a la menos. Se guarda una semana.
async function speciesNear(z, month) {
  const key = `${z.lat},${z.lng},${month || "all"}`;
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(NEAR_KEY) || "{}"); } catch {}
  if (cache[key] && Date.now() - cache[key].t < 7 * 86400e3) return cache[key].list.map((x) => ({ ...x, common: capName(x.common) }));
  const locale = z.cc === "ar" ? "es-AR" : z.cc === "mx" ? "es-MX" : "es";
  const url = `https://api.inaturalist.org/v1/observations/species_counts?lat=${z.lat}&lng=${z.lng}&radius=8&iconic_taxa=Plantae&quality_grade=research&captive=false${month ? "&month=" + month : ""}&locale=${locale}&per_page=200`;
  const r = await fetch(url); if (!r.ok) throw new Error(`iNaturalist respondió ${r.status}`);
  const list = ((await r.json()).results || []).filter(({ taxon: t }) => t && t.rank === "species").map(({ count, taxon: t }) => ({
    id: t.id, name: t.name, common: capName(t.preferred_common_name), count,
    photo: t.default_photo?.medium_url || t.default_photo?.square_url || "", credit: t.default_photo?.attribution || "",
  }));
  cache[key] = { t: Date.now(), list };
  try { localStorage.setItem(NEAR_KEY, JSON.stringify(Object.fromEntries(Object.entries(cache).slice(-6)))); } catch {}
  return list;
}
async function newMission() {
  const z = zoneOf(); if (!z) return null;
  const month = new Date().getMonth() + 1;
  const have = new Set(plants.map((p) => illuKey(p.scientific_name)).filter(Boolean));
  const skip = new Set(cfg.missionSkip || []);
  const free = (l) => l.filter((x) => !have.has(illuKey(x.name)) && !skip.has(x.id));
  let pool = free(await speciesNear(z, month)).map((x) => ({ ...x, month }));
  if (pool.length < 3) pool = [...pool, ...free(await speciesNear(z, null)).filter((x) => !pool.some((y) => y.id === x.id))]; // si en este mes hay pocas, de todo el año
  if (!pool.length) return null;
  // Sorteo por niveles, calculados con las especies de la zona (de la más vista a la menos vista):
  // el 30 % más visto es "común" (peso 12), el 40 % del medio "habitual" (peso 4) y el 30 % menos visto "difícil" (peso 1).
  const ranked = [...pool].sort((a, b) => (b.count || 0) - (a.count || 0));
  const tierOf = (idx) => (ranked.length < 4 ? 0 : idx < ranked.length * 0.3 ? 0 : idx < ranked.length * 0.7 ? 1 : 2);
  const w = ranked.map((_, idx) => [12, 4, 1][tierOf(idx)]), total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, i = 0;
  while (i < ranked.length - 1 && (r -= w[i]) > 0) i++;
  return { ...ranked[i], hard: tierOf(i) === 2, given: Date.now() };
}
// Si la especie asentada era la de tu misión, queda cumplida. Devuelve true para festejarlo con el sello.
function missionCheck(sci) {
  const m = missionOf();
  if (!m || m.done || !sci || illuKey(sci) !== illuKey(m.name)) return false;
  finishMission(m);
  return true;
}
// Historial de misiones cumplidas (para los logros de exploración). Va en el celular y en la cuenta.
const missionsDone = () => { const a = cfg.missionsDone || user?.user_metadata?.missions_done || []; return Array.isArray(a) ? a : []; };
function finishMission(m) {
  const done = Date.now();
  saveMission({ ...m, done });
  if (!missionsDone().some((x) => x.id === m.id)) {
    cfg.missionsDone = [...missionsDone(), { id: m.id, name: m.name, common: m.common || "", given: m.given || done, done }].slice(-300);
    syncMeta({ missions_done: cfg.missionsDone });
  }
  cfg.missionCelebrated = false; // Progreso titila hasta que entres a verla
  saveCfg(cfg);
}
// "mañana" (o "hoy", si ya pasó la medianoche y todavía no se pidió), contando días de calendario.
const untilNext = (m) => {
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const n = Math.round((day(nextMissionAt(m)) - day(Date.now())) / 86400e3);
  return n <= 0 ? "hoy" : n === 1 ? "mañana" : `en ${n} días`;
};
// Decide la misión vigente: la cumple si ya la asentaste, avisa si otra persona la encontró primero,
// y pide una nueva cuando no hay o ya es el día siguiente al de la cumplida. Puede fallar si no hay conexión con iNaturalist.
async function ensureMission() {
  if (!zoneOf()) return null;
  let m = missionOf();
  if (m && !m.done) {
    const hit = plants.find((p) => illuKey(p.scientific_name) === illuKey(m.name));
    if (hit) {
      const mine = hit.user_id === user.id || (hit.sightings || []).some((x) => x.user_id === user.id);
      if (mine) { finishMission(m); m = missionOf(); }
      else m = { ...m, lostTo: hit.author_name || "Otra persona" };
    }
  }
  if (!m || (m.done && Date.now() >= nextMissionAt(m))) {
    m = await newMission();
    if (m) saveMission(m);
  }
  return m;
}
// Puntito dorado en Progreso mientras haya una misión nueva que todavía no miraste.
function navDot() {
  const m = missionOf(), b = $nav.querySelector('[data-go="stats"]');
  const fresh = !!m && !m.done && !m.lostTo && cfg.missionSeen !== m.id, celebrate = !!m?.done && cfg.missionCelebrated === false;
  b?.classList.toggle("has-dot", feat("misiones") && !cfg.missionsOff && (fresh || celebrate));
}
async function hydrateMission() {
  const box = $app.querySelector("#mission"); if (!box || cfg.missionsOff || !feat("misiones")) return;
  const z = zoneOf();
  if (!z) {
    box.innerHTML = `<div class="mission ms-empty"><div class="ms-txt"><small>Tu primera misión</small>
      <span class="ms-meta">Marcá tu zona y te propongo plantas que se vieron cerca para salir a buscar.</span>
      <span class="ms-links"><button class="linkish" id="ms-zone">Marcar mi zona</button></span></div></div>`;
    box.querySelector("#ms-zone").onclick = () => goZone();
    return;
  }
  box.innerHTML = `<p class="ms-hint">Buscando plantas cerca tuyo…</p>`;
  let m;
  try { m = await ensureMission(); }
  catch (e) {
    if (!$app.contains(box)) return;
    box.innerHTML = `<p class="ms-hint">No pude consultar las plantas de tu zona (${esc(e.message || "sin conexión")}). <button class="linkish" id="ms-retry">Reintentar</button></p>`;
    box.querySelector("#ms-retry").onclick = () => { try { localStorage.removeItem(NEAR_KEY); } catch {} hydrateMission(); };
    return;
  }
  if (!$app.contains(box)) return;
  if (!m) {
    box.innerHTML = `<p class="ms-hint">No encontré plantas registradas cerca de tu zona que falten en el herbario. Probá con otra zona en <button class="linkish" id="ms-zone">Ajustes</button>.</p>`;
    box.querySelector("#ms-zone").onclick = () => goZone();
    return;
  }
  if (m.common) m = { ...m, common: capName(m.common) };
  if (!m.done && !m.lostTo && cfg.missionSeen !== m.id) { cfg.missionSeen = m.id; saveCfg(cfg); navDot(); }
  const zoneShort = esc(z.name.split(/[,(]/)[0].trim());
  if (m.done) {
    if (cfg.missionCelebrated === false) { cfg.missionCelebrated = true; saveCfg(cfg); navDot(); }
    const n = missionsDone().length;
    box.innerHTML = `<div class="mission ms-done">
      <span class="ms-ph done">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : ""}<span class="ms-stamp"><svg><use href="#i-seal-gold"/></svg><b>Cumplida</b></span></span>
      <div class="ms-txt"><small>Misión cumplida</small>
        <b>${esc(m.common || m.name)}</b>${m.common ? `<i>${esc(m.name)}</i>` : ""}
        <span class="ms-meta">Tu próxima misión llega <b>${untilNext(m)}</b>.</span>
        <span class="ms-meta">${n === 1 ? "Es tu primera misión cumplida." : `Llevás ${n} misiones cumplidas.`}</span>
      </div></div>`;
    return;
  }
  if (m.lostTo) {
    box.innerHTML = `<p class="ms-hint"><b>${esc(m.lostTo)}</b> encontró primero ${esc(m.common || m.name)}. <button class="linkish" id="ms-next">Dame otra</button></p>`;
    box.querySelector("#ms-next").onclick = async () => { cfg.missionSkip = [...(cfg.missionSkip || []), m.id].slice(-200); saveMission(null); hydrateMission(); };
    return;
  }
  const when = m.month ? `en ${MONTHS_LONG[m.month - 1].toLowerCase()}` : "durante el año";
  box.innerHTML = `<div class="mission">
    ${m.photo ? `<button class="ms-ph" id="ms-ph" aria-label="Ver la foto más grande"><img src="${esc(m.photo)}" alt="" loading="lazy"></button>` : ""}
    <div class="ms-txt"><small>Cerca de ${zoneShort}${m.hard ? ` <span class="ms-hard" title="Poco vista en tu zona">Difícil</span>` : ""}</small>
      <button class="ms-name" id="ms-name"><b>${esc(m.common || m.name)}</b>${m.common ? `<i>${esc(m.name)}</i>` : ""}</button>
      <span class="ms-meta">${m.hard ? `Poco vista: se registró solo ${m.count} ${m.count === 1 ? "vez" : "veces"} ${when} en tu zona.` : `Se registró ${m.count} ${m.count === 1 ? "vez" : "veces"} ${when} en tu zona.`}</span>
      <span class="ms-links"><a href="https://www.inaturalist.org/taxa/${m.id}" target="_blank" rel="noopener">Cómo es</a><a href="https://es.wikipedia.org/w/index.php?search=${encodeURIComponent(m.name)}" target="_blank" rel="noopener">Wikipedia</a><button class="linkish" id="ms-skip">Otra planta</button></span>
    </div></div>`;
  box.querySelector("#ms-ph")?.addEventListener("click", () => openMissionViewer(m));
  box.querySelector("#ms-name")?.addEventListener("click", () => (m.photo ? openMissionViewer(m) : window.open(`https://www.inaturalist.org/taxa/${m.id}`, "_blank")));
  box.querySelector("#ms-skip").onclick = () => { cfg.missionSkip = [...(cfg.missionSkip || []), m.id].slice(-200); saveMission(null); hydrateMission(); };
}

// Presentación de las misiones: aparece una vez, centrada, con su propio diseño (es una función importante).
const missionsIntroSeen = () => !!(cfg.missionsIntro || user?.user_metadata?.missions_intro);
// La carta de las misiones sale sola, nunca encima de otra ventana: después del tutorial o de las Novedades.
function maybeMissionsIntro(delay = 500) {
  if (!user || !feat("misiones") || missionsIntroSeen() || zoneOf()) return;
  setTimeout(() => { if (!document.querySelector(".tour, .modal, .stamp") && !missionsIntroSeen()) openMissionsIntro(); }, delay);
}
function openMissionsIntro() {
  const m = document.createElement("div");
  m.className = "modal feature-intro";
  m.innerHTML = `<div class="fi-box" role="dialog" aria-modal="true" aria-labelledby="fi-t">
    <svg class="fi-art" viewBox="0 0 120 120" aria-hidden="true"><use href="#i-compass"/></svg>
    <p class="fi-kicker">Novum</p>
    <h3 id="fi-t">Misiones de exploración</h3>
    <div class="fi-letter">
      ${cfg.name ? `<p class="fi-to">${esc(cfg.name)}:</p>` : ""}
      <p>Todo naturalista empezó igual: con un mapa a medio dibujar y las ganas de saber qué crece a la vuelta de casa.</p>
      <p>Desde hoy, este herbario te va a encargar misiones. Cada una es <b>una planta que alguien vio cerca tuyo</b> y que todavía no tiene su lámina. Te espera todo el tiempo que haga falta: salís a buscarla, la asentás, y la misión queda cumplida. Al día siguiente, te espera otra.</p>
      <p class="fi-sign">— Herbarium vivum</p>
    </div>
    <p class="fi-small">Las misiones viven en Progreso. Para empezar, marcá desde dónde explorás.</p>
    <div class="fi-btns"><button class="btn primary" id="fi-go">Marcar mi zona</button><button class="linkish" id="fi-no">Ahora no</button></div></div>`;
  const done = () => { cfg.missionsIntro = true; saveCfg(cfg); syncMeta({ missions_intro: true }); m.classList.add("out"); setTimeout(() => m.remove(), 250); };
  m.querySelector("#fi-go").onclick = () => { done(); goZone(); };
  m.querySelector("#fi-no").onclick = done;
  document.body.appendChild(m);
}

// ---------- sello Nova: láminas de otras personas que todavía no abriste ----------
// Cuenta desde que creaste tu cuenta; lo abierto queda en el celular y en tu cuenta (no se repite entre dispositivos).
const NOVA_KEY = "plantdex.nova";
let novaSeen = null;
const novaSet = () => {
  if (!novaSeen) {
    let local = []; try { local = JSON.parse(localStorage.getItem(NOVA_KEY) || "[]"); } catch {}
    novaSeen = new Set([...local, ...(user?.user_metadata?.nova_seen || [])]);
  }
  return novaSeen;
};
const isNova = (p) => !!user && p.user_id && p.user_id !== user.id && p.created_at > (user.created_at || "") && !novaSet().has(p.id);
let novaSync = null;
function markNovaSeen(p) {
  if (!isNova(p)) return;
  novaSet().add(p.id);
  // Solo se guardan las que podrían llevar sello, así la lista no crece de más.
  const keep = plants.filter((x) => x.user_id !== user.id && x.created_at > (user.created_at || "") && novaSeen.has(x.id)).map((x) => x.id);
  try { localStorage.setItem(NOVA_KEY, JSON.stringify(keep)); } catch {}
  clearTimeout(novaSync);
  novaSync = setTimeout(() => Promise.resolve().then(() => sb.auth.updateUser({ data: { nova_seen: keep } })).then(({ data }) => data?.user && (user = data.user)).catch(() => {}), 1500);
}
const novaTag = (p) => (isNova(p) ? `<span class="nova" title="Nueva, de ${esc(p.author_name || "otra persona")}">Nova</span>` : "");

function row(p) {
  const img = coverOf(p), ill = !!illuOf(p), mark = markOf(p);
  return `<li data-id="${p.id}">
    <span class="ix-ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></span>
    <span class="ix-txt"><b>${esc(p.common_name)}${novaTag(p)}</b><i>${esc(p.scientific_name || "")}${p.family ? " · " + esc(p.family) : ""}</i></span>
    ${consBadge(p.iucn, "cons ix-cons")}${edibleBadge(p, "dog ix-mark")}
  </li>`;
}

function card(p) {
  const img = coverOf(p), ill = !!illuOf(p);
  const mark = markOf(p);
  return `<div class="card" data-id="${p.id}">
    <div class="ph ${ill ? "illu" : ""}" data-sci="${esc(p.scientific_name || "")}" style="${img ? `background-image:url('${img}')` : ""}"></div>
    ${isNova(p) ? `<span class="nova-seal" title="Nueva, de ${esc(p.author_name || "otra persona")}"><svg><use href="#i-seal-gold"/></svg><b>Nova</b></span>` : ""}
    <div class="name">${esc(p.common_name)}</div><div class="sci">${esc(p.scientific_name || "")}</div>
    ${cardStrip(p)}
  </div>`;
}

// Texto con énfasis: **clave** → negrita, y las advertencias se resaltan solas.
const WARN_WORDS = /\b(t[óo]xic[oa]s?|toxicidad|venenos[oa]s?|mortal(es)?|letal(es)?|no (se )?(debe|deben)? ?(consumir|comer|ingerir)|no comestibles?|nunca [a-záéíóú]+|precauci[óo]n|peligros[oa]s?|irritante|cianog[ée]nic[oa]s?|alucin[óo]gen[oa]s?)\b/gi;
function rich(txt) {
  return esc(cleanCites(txt))
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

// Leyenda de los símbolos de las tarjetas, agrupados por familia.
function openLegend() {
  const chip = (cls, icon, label) => `<li><span class="pchip ${cls}"><svg><use href="#${icon}"/></svg></span>${label}</li>`;
  const cons = (code, label) => `<li>${consBadge(code, "cons pc-cons")}${label}</li>`;
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box legend" role="dialog" aria-modal="true" aria-label="Leyenda"><button class="modal-x" aria-label="Cerrar">×</button>
    <h3>Leyenda</h3>
    <p class="lg-h">Estado de conservación</p>
    <p class="lg-note">Cuantos más segmentos tiene el anillo, más amenazada está la especie en el mundo.</p>
    <ul>${cons("LC", "Preocupación menor")}${cons("NT", "Casi amenazada")}${cons("VU", "Vulnerable")}${cons("EN", "En peligro o peor")}${cons(null, "Sin dato")}</ul>
    <button class="linkish" id="lg-iucn">Ver todas las categorías</button>
    <p class="lg-h">Para qué sirve</p>
    <ul>${USE_ORDER.map((u) => chip("u-" + u, useIcon(u), USES[u])).join("")}</ul>
    <p class="lg-h">Nueva</p>
    <ul><li><span class="lg-nova"><svg><use href="#i-seal-gold"/></svg><b>Nova</b></span>La subió otra persona y todavía no la abriste.</li></ul></div>`;
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector(".modal-x").onclick = close;
  m.querySelector("#lg-iucn").onclick = () => { close(); openIucnInfo(); };
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
// Fila de la tarjeta, debajo del nombre: conservación y usos. Si es tóxica, la calavera está siempre, aunque falten los usos.
const cardStrip = (p) => {
  const uses = usesOf(p);
  if (markOf(p)[2] === "tox" && !uses.includes("toxica")) uses.push("toxica");
  const list = USE_ORDER.filter((u) => uses.includes(u));
  return `<div class="pstrip">${consBadge(p.iucn, "cons pc-cons")}${list.map((u) => `<span class="pchip u-${u}" title="${USES[u]}"><svg><use href="#${useIcon(u)}"/></svg></span>`).join("")}</div>`;
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

// Quién encontró esta especie y cuándo la subió: la primera arriba y los hallazgos siguientes debajo.
function findsTable(p) {
  const fmt = (t) => (t ? new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const rows = [{ who: p.author_name, when: p.created_at }, ...(p.sightings || []).map((x) => ({ who: x.author_name, when: x.created_at }))]
    .sort((a, b) => new Date(a.when || 0) - new Date(b.when || 0));
  return `<div class="finds"><table><tbody>
    ${rows.map((r) => `<tr><td class="av"><span class="avatar sm" aria-hidden="true">${esc([...(r.who || "?").trim() || "?"][0].toUpperCase())}</span></td><td>${esc(r.who || "Sin nombre")}</td><td>${fmt(r.when)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function renderDetail(id) {
  const p = plants.find((x) => x.id === id);
  if (!p) return go("list");
  markNovaSeen(p);
  await signUrls([...(p.photos || []), ...(p.sightings || []).flatMap((x) => x.photos || [])]);
  const ill = cfg.illustrations && p.scientific_name ? await findIllustration(p.scientific_name) : null;
  // Figuras: primero la lámina antigua (si hay), después las fotos propias.
  const figs = [
    ...(ill ? [{ src: ill.url, cap: `Lámina antigua · ${esc(ill.credit)} · <a href="${ill.page}" target="_blank">${esc(ill.license)}</a>`, illu: true }] : []),
    ...(p.photos || []).map((x, i) => ({ src: urlCache.get(x), cap: i === 0 ? "Foto principal" : "Foto de campo", photo: i, path: x, own: p.user_id === user.id })).filter((f) => f.src),
    ...(p.sightings || []).flatMap((x) => (x.photos || []).map((ph) => ({ src: urlCache.get(ph), cap: `Foto de ${esc(x.author_name || "otro hallazgo")}`, path: ph, sighting: x, own: x.user_id === user.id }))).filter((f) => f.src),
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
    ${(() => {
      // Con el interruptor "fotos", la dueña o el dueño de la lámina ve sus 4 casilleros: las libres llevan un +.
      const mine = feat("fotos") && p.user_id === user.id;
      const free = mine ? Math.max(0, MAX_PHOTOS - (p.photos || []).length) : 0;
      if (figs.length <= 1 && !free) return "";
      const lastOwn = figs.reduce((k, f, i) => (f.photo != null ? i : k), figs.findIndex((f) => f.illu));
      const slots = Array.from({ length: free }, () => `<button class="slot-add" aria-label="Sumar una foto"><span>+</span></button>`).join("");
      return `<div class="thumbs">${figs.map((f, i) => `<img src="${f.src}" data-i="${i}" class="${f.illu ? "illu" : ""} ${i === 0 ? "on" : ""}">${i === lastOwn ? slots : ""}`).join("")}${lastOwn < 0 ? slots : ""}</div>`;
    })()}
    <div class="row fig-actions" id="figact"></div>
    ${partsPanel(p)}
    ${p.description ? `<div class="field-note dropcap lead-desc">${rich(p.description)}</div>` : ""}
    ${factSheet(p)}
    <div class="folds">
      ${fold("Historia · origen", (p.native_range ? `<p class="origin-line"><b>Origen.</b> ${rich(p.native_range)}</p>` : "") + note(p.history))}
      ${fold("Kalendarium", hasMonths ? monthsBar(p.flower_months, p.fruit_months) + legend : "")}
      ${fold("Esculenta · comestibilidad", note(p.edibility_notes))}
      ${fold("Medicina · usos medicinales", note(p.medicinal_notes))}
      ${fold("Usus · otros usos", note(p.uses))}
      ${fold("Curiosa", p.curiosity ? `<div class="curio">“${rich(p.curiosity)}”</div>` : "")}
      ${fold("Notae · mis notas", note(p.notes))}
      ${fold(`Hallazgos · ${1 + (p.sightings?.length || 0)}`, findsTable(p))}
    </div>
    <div class="disclaimer">Una foto puede engañar. Antes de comer algo silvestre, confirmalo con alguien que sepa.</div>
    <div class="row" style="margin-top:18px">
      ${!p.user_id || p.user_id === user.id ? `<button class="btn" onclick="location.hash='edit/${p.id}'">Editar</button>
      <button class="btn ghost" id="del">Arrancar la lámina</button>` : `<p class="muted" style="text-align:center;width:100%">Solo ${esc(p.author_name || "quien la cargó")} puede editar esta lámina.</p>`}
    </div>
    <div class="row pager">
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
  const canReillu = !ill && cfg.illustrations && p.scientific_name;
  const bindReillu = () => $app.querySelector("#reillu")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true; ev.currentTarget.textContent = "Buscando…";
    delete illuCache[illuKey(p.scientific_name)]; saveIllu(); illuTried.delete(illuKey(p.scientific_name)); saveTried(); illuRemoved.delete(illuKey(p.scientific_name)); saveRemoved();
    const found = await findIllustration(p.scientific_name);
    if (!found) toast("No encontré una lámina antigua para esta especie");
    renderDetail(p.id);
  });
  let curFig = 0;
  const plainTxt = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  $app.querySelector("#hero")?.addEventListener("click", () => openViewer(figs.map((f) => ({
    src: f.src, small: f.src, title: p.common_name, sub: f.illu ? "Lámina antigua" : plainTxt(f.cap),
    credit: f.illu && ill ? `${ill.credit} · ${ill.license} · Wikimedia Commons` : "",
  })), curFig));
  const showFig = (i) => {
    const f = figs[i]; if (!f) return;
    curFig = i;
    const hero = $app.querySelector("#hero"); hero.src = f.src; hero.classList.toggle("illu", !!f.illu);
    $app.querySelector("#figcap").innerHTML = `Fig. ${roman(i + 1)} · ${f.cap}`;
    $app.querySelectorAll(".thumbs img").forEach((t) => t.classList.toggle("on", +t.dataset.i === i));
    const act = $app.querySelector("#figact");
    // Acciones de la figura: una línea de texto, separada por puntos, como el pie de la lámina.
    const link = (id, label) => `<button class="fig-link" id="${id}">${label}</button>`;
    act.innerHTML = [
      f.illu ? link("noillu", "No es esta planta") : "",
      f.own && f.photo > 0 ? link("mkmain", "Usar como principal") : "",
      f.own ? link("delphoto", "Borrar foto") : "",
      canReillu ? link("reillu", "Restaurar lámina") : "",
    ].join("");
    bindReillu();
    act.querySelector("#delphoto")?.addEventListener("click", async () => { if (await deletePhoto(p, f.path, f.sighting)) renderDetail(p.id); });
    act.querySelector("#mkmain")?.addEventListener("click", async () => {
      const photos = [p.photos[f.photo], ...p.photos.filter((_, k) => k !== f.photo)];
      const { error } = await sb.from("plants").update({ photos }).eq("id", p.id);
      if (error) return toast(error.message);
      p.photos = photos; toast("Foto principal actualizada"); renderDetail(p.id);
    });
    act.querySelector("#noillu")?.addEventListener("click", () => {
      const key = illuKey(p.scientific_name), prev = illuCache[key];
      illuCache[key] = false; saveIllu(); illuTried.add(key); saveTried(); illuRemoved.add(key); saveRemoved(); renderDetail(p.id);
      toast("Lámina quitada", ["Deshacer", () => { illuCache[key] = prev; saveIllu(); illuRemoved.delete(key); saveRemoved(); renderDetail(p.id); }]);
    });
  };
  $app.querySelectorAll(".thumbs img").forEach((t) => (t.onclick = () => showFig(+t.dataset.i)));
  $app.querySelectorAll(".slot-add").forEach((b) => (b.onclick = async () => { const src = await choosePhotoSource(); if (src) addPhotosTo(p, src); }));
  if (figs.length) showFig(0);
  else if (canReillu) { $app.querySelector("#figact").innerHTML = `<button class="fig-link" id="reillu">Restaurar lámina</button>`; bindReillu(); }
  if ($app.querySelector("#del")) $app.querySelector("#del").onclick = async () => {
    if (!(await ask({ title: "Arrancar la lámina", text: `La lámina de <b>${esc(p.common_name)}</b> se borra para siempre, con sus fotos.`, ok: "Arrancarla", cancel: "Dejarla" }))) return;
    if (p.photos?.length) await sb.storage.from(BUCKET).remove(p.photos);
    const { error } = await sb.from("plants").delete().eq("id", p.id);
    if (error) return toast(error.message);
    plants = plants.filter((x) => x.id !== p.id); go("list");
  };
}

// ---------- fecha de las fotos ----------
const localISODate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
// Lee del EXIF de un JPEG la fecha de captura (DateTimeOriginal) y las coordenadas GPS.
// Devuelve { date: "AAAA-MM-DD" | null, lat, lng }. Sin EXIF, la fecha sale del archivo.
async function photoMeta(file) {
  const meta = { date: null, lat: null, lng: null };
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) === 0xffd8) {
      let off = 2;
      while (off + 4 < buf.byteLength) {
        const marker = buf.getUint16(off), size = buf.getUint16(off + 2);
        if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) { // "Exif"
          const t = off + 10, le = buf.getUint16(t) === 0x4949;
          const u16 = (o) => buf.getUint16(t + o, le), u32 = (o) => buf.getUint32(t + o, le);
          const ascii = (o, n) => { let x = ""; for (let i = 0; i < n - 1; i++) x += String.fromCharCode(buf.getUint8(t + o + i)); return x; };
          const scan = (ifd, want) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === want) return e; } return null; };
          const ifd0 = u32(4);
          // fecha
          let e = null; const sub = scan(ifd0, 0x8769);
          if (sub) e = scan(u32(sub + 8), 0x9003);
          if (!e) e = scan(ifd0, 0x0132);
          if (e) { const m = ascii(u32(e + 8), 20).match(/^(\d{4}):(\d{2}):(\d{2})/); if (m && m[1] !== "0000") meta.date = `${m[1]}-${m[2]}-${m[3]}`; }
          // GPS: grados, minutos y segundos como tres fracciones
          const gps = scan(ifd0, 0x8825);
          if (gps) {
            const g = u32(gps + 8);
            const ref = (tag) => { const x = scan(g, tag); return x ? String.fromCharCode(buf.getUint8(t + x + 8)) : ""; };
            const dms = (tag) => { const x = scan(g, tag); if (!x) return null; const o = u32(x + 8); const r = (k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1); return r(0) + r(1) / 60 + r(2) / 3600; };
            let la = dms(2), lo = dms(4);
            if (la != null && lo != null && (la || lo)) {
              if (ref(1) === "S") la = -la; if (ref(3) === "W") lo = -lo;
              meta.lat = +la.toFixed(6); meta.lng = +lo.toFixed(6);
            }
          }
          break;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + size;
      }
    }
  } catch {}
  if (!meta.date && file.lastModified) meta.date = localISODate(new Date(file.lastModified));
  return meta;
}
const oldestPhotoDate = () => (draft?.files || []).map((f) => f.taken).filter(Boolean).sort()[0] || null;

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
const saveDraft = () => { if (draft && !draft.editing) idb.set("draft", { ts: Date.now(), blobs: draft.files.map((f) => f.blob), takens: draft.files.map((f) => f.taken || null), gps: draft.files.map((f) => f.gps || null), data: draft.data, hint: draft.hint, mode: draft.mode }); };
const clearDraft = () => { draft = null; idb.del("draft"); };
async function restoreDraft() {
  const sd = await idb.get("draft");
  if (!sd || (!sd.blobs?.length && !sd.data?.common_name)) return;
  // Solo se recupera lo que estabas cargando si la app se cerró en esa pantalla hace poco (por ejemplo, al abrir la cámara).
  if (feat("fotos") && (location.hash !== "#new" || !sd.ts || Date.now() - sd.ts > 30 * 60e3)) { idb.del("draft"); return; }
  draft = { files: (sd.blobs || []).map((b, i) => ({ blob: b, url: URL.createObjectURL(b), taken: sd.takens?.[i] || null, gps: sd.gps?.[i] || null })), data: sd.data || {}, hint: sd.hint, mode: sd.mode === "manual" ? "manual" : "chat" };
}

// ---------- alta ----------
// Abre cámara o galería; al elegir, suma las fotos al borrador y muestra la lámina nueva.
function pickPhotos(source, fresh = false) {
  const input = document.getElementById(source === "camera" ? "file-input" : "file-input-gallery");
  input.value = "";
  input.onchange = async () => {
    if (!input.files.length) return;
    if (draft?.editing) draft = null;
    if (fresh && feat("fotos")) clearDraft(); // el + de abajo siempre arranca una planta nueva
    if (!draft) draft = { files: [], data: {}, mode: "chat" };
    const room = 4 - draft.files.length;
    if (room <= 0) return toast("Ya tenés 4 fotos: borrá alguna con la × para sumar otra");
    if (input.files.length > room) toast(`${room === 1 ? "Solo entra 1 foto más" : `Solo entran ${room} fotos más`}: se suman las primeras`);
    for (const f of [...input.files].slice(0, room)) {
      const meta = await photoMeta(f); // antes de achicar: el canvas descarta los datos EXIF
      const blob = await resizeImage(f); draft.files.push({ blob, url: URL.createObjectURL(blob), taken: meta.date, gps: meta.lat != null ? [meta.lat, meta.lng] : null });
    }
    usePhotoLocation();
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
  sheet.querySelector("#sh-cam").onclick = () => { close(); pickPhotos("camera", true); };
  sheet.querySelector("#sh-gal").onclick = () => { close(); pickPhotos("gallery", true); };
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
  // Con 4 fotos ya no se pueden sumar más: los botones lo avisan en vez de abrir la cámara.
  const full = draft.files.length >= 4;
  const pick = (src) => (full ? toast("Ya tenés 4 fotos: borrá alguna con la × para sumar otra") : pickPhotos(src));
  $app.querySelector("#cam").onclick = () => pick("camera");
  $app.querySelector("#gal").onclick = () => pick("gallery");
  if (full) {
    $app.querySelectorAll("#cam, #gal").forEach((b) => b.classList.add("is-full"));
    prev.insertAdjacentHTML("afterend", `<p class="muted photos-full">Ya tenés las 4 fotos. Para cambiar una, borrala con la ×.</p>`);
  }
  $app.querySelector("#hint").oninput = (e) => (draft.hint = e.target.value);
  $app.querySelector("#place").oninput = (e) => { draft.data.location_name = e.target.value; draft.data.locSource = "manual"; saveDraft(); };
  $app.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { draft.mode = b.dataset.m; renderNew(); }));

  const box = $app.querySelector("#mode");
  if (m === "chat") {
    box.innerHTML = `<button class="link-btn" id="whyai">¿Por qué usamos IA?</button>
      <ol class="steps">
        <li>Tocá <b>Enviar a la IA</b> y elegí ChatGPT o Claude: se abre con las fotos adjuntas y el prompt ya copiado.</li>
        <li>Pegá el prompt en el chat y enviá.</li>
        <li>Copiá la respuesta entera y pegala acá abajo.</li>
      </ol>
      <button class="btn primary" id="sendai" style="width:100%" ${has ? "" : "disabled"}>Enviar a la IA (fotos + prompt)</button>
      <button class="btn" id="copy" style="width:100%;margin-top:10px">Solo copiar prompt</button>
      <details><summary>Ver prompt</summary><div class="prompt-box">${esc(buildPrompt(draft.hint, placeCtx()))}</div></details>
      <label>Respuesta del chat</label><textarea id="paste" placeholder='{ "common_name": … }'></textarea>
      <div class="row" style="margin-top:12px"><button class="btn" id="pasteit">Pegar</button><button class="btn primary" id="useit">Completar la ficha</button></div>`;
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
    box.querySelector("#whyai").onclick = openWhyAI;
    box.querySelector("#pasteit").onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t.trim()) return toast("El portapapeles está vacío");
        box.querySelector("#paste").value = t; toast("Respuesta pegada");
      } catch { box.querySelector("#paste").focus(); toast("No pude leer el portapapeles: mantené apretado el recuadro y elegí «Pegar»"); }
    };
    box.querySelector("#useit").onclick = () => {
      try { draft.data = { ...draft.data, ...normalizeAI(v("paste")) }; saveDraft(); renderForm(null); }
      catch (e) {
        if (e.noJson && v("paste").trim()) ask({ title: "La IA todavía tiene dudas", text: "Parece que te hizo preguntas o te pidió más fotos en vez de darte la ficha. Contestale en el mismo chat (podés mandarle fotos nuevas) y, cuando te dé el bloque para Herbalorium, pegalo acá.", ok: "Entendido", cancel: "Cerrar" });
        else toast("No entendí la respuesta: " + e.message);
      }
    };
  } else {
    box.innerHTML = `<p class="muted">Completás vos cada campo. Ideal si ya sabés qué es.</p>
      <button class="btn" id="manual" style="width:100%">Abrir ficha en blanco</button>`;
    box.querySelector("#manual").onclick = () => renderForm(null);
  }
  getLocation();
}

// Nombre legible de unas coordenadas (OpenStreetMap, sin clave).
async function placeName(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=es&lat=${lat}&lon=${lng}`);
    const a = (await r.json()).address || {};
    return [a.village || a.town || a.city || a.municipality, a.state || a.region, a.country].filter(Boolean).join(", ");
  } catch { return ""; }
}
async function setPlace(lat, lng, source) {
  const d = draft?.data; if (!d || d.locSource === "manual") return;
  if (source === "device" && d.locSource === "photo") return; // la foto manda sobre la ubicación actual
  d.lat = lat; d.lng = lng; d.locSource = source;
  const name = await placeName(lat, lng);
  if (name && draft?.data === d && d.locSource === source) {
    d.location_name = name; saveDraft();
    const el = document.getElementById("place"); if (el) el.value = name;
  }
}
// Si alguna foto trae GPS, el lugar del hallazgo es el de la foto más antigua con coordenadas.
function usePhotoLocation() {
  const withGps = (draft?.files || []).filter((f) => f.gps).sort((a, b) => String(a.taken).localeCompare(String(b.taken)));
  if (withGps.length) setPlace(withGps[0].gps[0], withGps[0].gps[1], "photo");
}
function getLocation() {
  if (draft.data.lat || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => setPlace(pos.coords.latitude, pos.coords.longitude, "device"), () => {}, { timeout: 8000 });
}

function placeCtx() {
  const d = draft?.data || {};
  return [d.location_name, d.lat ? `(${d.lat.toFixed(3)}, ${d.lng.toFixed(3)})` : ""].filter(Boolean).join(" ");
}

// Sube fotos nuevas a una lámina ya guardada y las suma al final.
// Borra una foto propia: de la lámina o de un hallazgo tuyo. Primero se saca de la ficha y después el archivo.
async function deletePhoto(p, path, sighting = null) {
  const last = !sighting && (p.photos || []).length === 1;
  if (last && feat("fotos")) { toast("Cada lámina necesita al menos una foto: sumá otra antes de borrar esta"); return false; }
  if (!(await ask({ title: "Borrar foto", text: last ? "Es la única foto de esta lámina. Si la borrás, la lámina queda con la ilustración antigua o sin imagen." : "La foto se borra para siempre del herbario.", ok: "Borrarla", cancel: "Dejarla" }))) return false;
  const owner = sighting || p, table = sighting ? "sightings" : "plants";
  const photos = (owner.photos || []).filter((x) => x !== path);
  const { data, error } = await sb.from(table).update({ photos }).eq("id", owner.id).select("id");
  if (error) { toast("No se pudo borrar: " + error.message); return false; }
  if (!data?.length) { toast(sighting ? "Falta actualizar la base: corré en Supabase el SQL de «v12»" : "No se pudo borrar la foto"); return false; }
  owner.photos = photos;
  if (!sighting && draft?.data) draft.data.photos = photos;
  try { await sb.storage.from(BUCKET).remove([path]); } catch {}
  urlCache.delete(path); toast("Foto borrada");
  return true;
}
// Fotos de la lámina en el editor, cada una con su ✕.
function paintEdPhotos(p) {
  const box = document.getElementById("edphotos"); if (!box) return;
  box.innerHTML = (p.photos || []).map((ph) => `<div><img src="${urlCache.get(ph) || ""}"><button type="button" data-delph="${esc(ph)}" aria-label="Borrar foto">✕</button></div>`).join("");
  box.querySelectorAll("[data-delph]").forEach((b) => (b.onclick = async () => { if (await deletePhoto(p, b.dataset.delph)) paintEdPhotos(p); }));
}

// Para un casillero libre: elegir cámara o galería.
function choosePhotoSource() {
  return new Promise((res) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="modal-box ask" role="dialog" aria-modal="true"><h3>Sumar una foto</h3>
      <p>Una foto real de esta misma planta: así la lámina sigue siendo un registro de verdad.</p>
      <div class="row"><button class="btn" data-s="gallery">Galería</button><button class="btn primary" data-s="camera">Sacar foto</button></div></div>`;
    const done = (v) => { m.remove(); res(v); };
    m.onclick = (e) => { if (e.target === m) done(null); };
    m.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => done(b.dataset.s)));
    document.body.appendChild(m);
  });
}

function addPhotosTo(p, source) {
  const input = document.getElementById(source === "camera" ? "file-input" : "file-input-gallery");
  input.value = "";
  input.onchange = async () => {
    if (!input.files.length) return;
    const room = feat("fotos") ? MAX_PHOTOS - (p.photos || []).length : 6;
    if (room <= 0) return toast(`Ya tiene ${MAX_PHOTOS} fotos: borrá alguna para sumar otra`);
    if (input.files.length > room) toast(`${room === 1 ? "Solo entra 1 foto más" : `Solo entran ${room} fotos más`}: se suben las primeras`);
    else toast("Subiendo fotos…");
    try {
      const added = [];
      for (const f of [...input.files].slice(0, room)) {
        const blob = await resizeImage(f);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        urlCache.set(path, URL.createObjectURL(blob)); added.push(path);
      }
      const photos = [...(p.photos || []), ...added];
      const { error } = await sb.from("plants").update({ photos }).eq("id", p.id);
      if (error) throw error;
      p.photos = photos; if (draft?.data) draft.data.photos = photos;
      paintEdPhotos(p);
      if (location.hash === "#plant/" + p.id) renderDetail(p.id);
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
    ${existing ? `<label>Fotos</label><div class="preview" id="edphotos"></div>
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
    ${ta("medicinal_notes", "Usos medicinales")}${ta("uses", "Otros usos")}${ta("history", "Historia")}${ta("curiosity", "Dato curioso")}${ta("notes", "Mis notas")}
    <div class="row"><div><label>Lugar</label><input id="location_name" placeholder="ej: Taconera, Pamplona, España" value="${esc(d.location_name || "")}"></div>
    <div><label>Fecha</label><input id="found_at" type="date" value="${esc(d.found_at || oldestPhotoDate() || localISODate(new Date()))}"></div></div>
    <div class="row" style="margin-top:22px"><button class="btn red" id="save">${existing ? "Guardar cambios" : "Asentar en el herbario"}</button></div>`;
  $app.querySelector("#bk").onclick = () => (existing ? (location.hash = "plant/" + existing.id) : renderNew());
  $app.querySelectorAll("#types .chip").forEach((c) => (c.onclick = () => c.classList.toggle("on")));
  if (existing) {
    paintEdPhotos(existing);
    if (feat("fotos") && (existing.photos || []).length >= MAX_PHOTOS) $app.querySelector("#addcam")?.closest(".row")?.insertAdjacentHTML("beforebegin", `<p class="muted" style="font-size:14.5px">Ya tiene ${MAX_PHOTOS} fotos. Para sumar otra, borrá alguna con la ✕.</p>`);
    $app.querySelector("#addcam").onclick = () => addPhotosTo(existing, "camera");
    if (feat("fotos") && (existing.photos || []).length >= MAX_PHOTOS) { $app.querySelector("#addcam").disabled = true; $app.querySelector("#addgal").disabled = true; }
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
    for (const k of ["common_name", "other_names", "origin", "native_range", "scientific_name", "family", "edible_human", "description", "edibility_notes", "medicinal_notes", "uses", "history", "curiosity", "notes", "location_name", "found_at"]) row[k] = v(k) || null;
    fixNames(row);
    row.iucn = d.iucn || (document.getElementById("iucn") ? v("iucn") || null : null);
    row.types = [...$app.querySelectorAll("#types .chip.on")].map((c) => c.dataset.t);
    if (!row.common_name) return toast("Ponele al menos un nombre");
    // ¿Ya está esta especie? Si la registraste vos, no se repite; si fue otra persona, tu hallazgo se suma a su lámina.
    const dup = !existing && row.scientific_name && plants.find((x) => illuKey(x.scientific_name) === illuKey(row.scientific_name));
    if (dup && (dup.user_id === user.id || (dup.sightings || []).some((s) => s.user_id === user.id))) {
      const see = await ask({ title: "Ya la tenés", text: `Ya registraste <b>${esc(dup.common_name)}</b> en el herbario${dup.user_id === user.id ? "" : `, en la lámina de ${esc(dup.author_name || "otra persona")}`}. No hace falta asentarla de nuevo.`, ok: "Ver la lámina", cancel: "Volver" });
      if (see) { clearDraft(); location.hash = "plant/" + dup.id; }
      return;
    }
    if (dup && !(await ask({ title: "Ya está en el herbario", text: `<b>${esc(dup.common_name)}</b> ya la asentó ${esc(dup.author_name || "otra persona")}. Tu hallazgo y tus fotos se suman a esa lámina, con tu nombre, en vez de crear otra igual.`, ok: "Sumar mi hallazgo", cancel: "Volver" }))) return;
    if (!existing && !draft.files.length && feat("fotos")) return toast("Sumá al menos una foto de la planta para asentarla");
    if (!existing && !draft.files.length && !(await ask({ title: "Sin fotos", text: "Esta lámina no tiene fotos. Podés guardarla igual y agregarlas después, cuando la edites.", ok: "Guardar igual", cancel: "Volver" }))) return;
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
        if (dup) {
          const s = { plant_id: dup.id, author_name: cfg.name || null, photos: paths, found_at: row.found_at, location_name: row.location_name, lat: row.lat, lng: row.lng };
          const { data, error } = await sb.from("sightings").insert(s).select().single();
          if (error) throw error;
          (dup.sightings ||= []).push(data);
          clearDraft(); { const won = feat("misiones") && missionCheck(dup.scientific_name); const party = won ? () => missionCelebration(dup.common_name) : null;
          feat("sello") ? stampSeal("Hallazgo sumado", dup.common_name, party) : (toast(`Tu hallazgo se sumó a ${dup.common_name}`), party && setTimeout(party, 600)); }
          location.hash = "plant/" + dup.id; return;
        }
        row.photos = paths;
        row.number = Math.max(0, ...plants.filter((x) => x.user_id === user.id).map((x) => x.number)) + 1;
        row.author_name = cfg.name || null;
        const { data, error } = await sb.from("plants").insert(row).select().single();
        if (error) throw error;
        plants = sortPlants([...plants, data]);
        clearDraft(); { const won = feat("misiones") && missionCheck(data.scientific_name); const party = won ? () => missionCelebration(data.common_name) : null;
        feat("sello") ? stampSeal("Asentada", data.common_name, party) : (toast(`${data.common_name} asentada en el herbario`), party && setTimeout(party, 600)); }
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
// ---------- logros ----------
// Todo se calcula con los datos de las láminas: funciona igual en cualquier dispositivo.
function achStats() {
  const P = plants, has = (p, t) => p.types?.includes(t), uses = (p) => Object.keys(p.parts || {});
  const kind = (p) => plain(p.kind);
  const set = (f) => new Set(P.map(f).filter(Boolean));
  const byDay = {}; P.forEach((p) => p.found_at && (byDay[p.found_at] = (byDay[p.found_at] || 0) + 1));
  const months = set((p) => p.found_at?.slice(5, 7));
  const season = (m) => ({ 12: "inv", 1: "inv", 2: "inv", 3: "pri", 4: "pri", 5: "pri", 6: "ver", 7: "ver", 8: "ver", 9: "oto", 10: "oto", 11: "oto" })[+m];
  const dates = P.map((p) => p.found_at).filter(Boolean).sort();
  const span = dates.length > 1 ? (new Date(dates.at(-1)) - new Date(dates[0])) / 864e5 : 0;
  const genus = {}; P.forEach((p) => { const g = (p.scientific_name || "").split(" ")[0]; if (g) genus[g] = (genus[g] || 0) + 1; });
  const country = (p) => (p.location_name || "").split(",").map((x) => x.trim()).filter(Boolean).at(-1);
  const photos = P.reduce((a, p) => a + (p.photos?.length || 0), 0);
  const c = (f) => P.filter(f).length;
  // Misiones: cuántas, si alguna se cumplió el mismo día y en cuántas estaciones (según el hemisferio de tu zona).
  const MD = missionsDone(), south = (zoneOf()?.lat || 0) < 0;
  const sameDay = MD.some((x) => new Date(x.done).toDateString() === new Date(x.given).toDateString()) ? 1 : 0;
  const seasonOf = (t) => { const mo = new Date(t).getMonth() + 1; const s0 = mo === 12 || mo <= 2 ? 0 : mo <= 5 ? 1 : mo <= 8 ? 2 : 3; return south ? (s0 + 2) % 4 : s0; };
  return {
    missions: MD.length, missionSameDay: sameDay, missionSeasons: new Set(MD.map((x) => seasonOf(x.done))).size,
    n: P.length, families: set((p) => p.family).size, edible: c((p) => ["si", "parcial"].includes(p.edible_human) || uses(p).includes("comer")),
    medicinal: c((p) => has(p, "medicinal") || uses(p).includes("medicina")), toxic: c((p) => has(p, "toxica") || uses(p).includes("toxica")),
    other: c((p) => uses(p).includes("otro")), maxUses: Math.max(0, ...P.map((p) => uses(p).length)),
    vu: c((p) => ["VU", "EN", "CR", "EW"].includes(p.iucn)), en: c((p) => ["EN", "CR", "EW"].includes(p.iucn)), cr: c((p) => ["CR", "EW"].includes(p.iucn)),
    lc: c((p) => p.iucn === "LC"), ne: c((p) => ["NE", "DD"].includes(p.iucn)),
    tree: c((p) => kind(p) === "arbol" || has(p, "arbol")), shrub: c((p) => kind(p) === "arbusto" || has(p, "arbusto")),
    herb: c((p) => kind(p) === "hierba" || has(p, "hierba")), vine: c((p) => kind(p) === "trepadora" || has(p, "trepadora")),
    fungi: c((p) => kind(p) === "hongo" || has(p, "hongo")),
    aromatic: c((p) => has(p, "aromatica")), flower: c((p) => has(p, "flor")), fruit: c((p) => has(p, "frutal")),
    aquatic: c((p) => has(p, "acuatica")), invasive: c((p) => has(p, "invasora")), ornamental: c((p) => has(p, "ornamental")),
    seasons: new Set([...months].map(season)).size, months: months.size, winter: c((p) => ["12", "01", "02"].includes(p.found_at?.slice(5, 7))),
    sameDay: Math.max(0, ...Object.values(byDay)), span, sameGenus: Math.max(0, ...Object.values(genus)),
    places: set((p) => p.location_name?.split(",")[0]?.trim()).size, countries: set(country).size,
    hemis: set((p) => (p.lat == null ? null : p.lat >= 0 ? "N" : "S")).size, geo: c((p) => p.lat != null),
    origins: set((p) => p.origin).size, letters: set((p) => plain(p.common_name).charAt(0)).size,
    photos, maxPhotos: Math.max(0, ...P.map((p) => p.photos?.length || 0)), notes: c((p) => (p.notes || "").trim().length > 10),
  };
}
// [id, categoría, icono, nombre, descripción, nivel 1-3, valor, meta]
const ACH = [
  ["n1", "Colección", "f-herb", "Primer brote", "Asentá tu primera lámina", 1, "n", 1],
  ["n5", "Colección", "f-herb", "Semillero", "5 láminas", 1, "n", 5],
  ["n10", "Colección", "i-book", "Herborista", "10 láminas", 1, "n", 10],
  ["n25", "Colección", "i-book", "Cuaderno lleno", "25 láminas", 2, "n", 25],
  ["n50", "Colección", "f-tree", "Hortus conclusus", "50 láminas", 2, "n", 50],
  ["n100", "Colección", "f-tree", "Centuria", "100 láminas", 3, "n", 100],
  ["n200", "Colección", "i-laurel", "Linneo moderno", "200 láminas", 3, "n", 200],
  ["f3", "Taxonomía", "f-family", "Parentela", "3 familias distintas", 1, "families", 3],
  ["f5", "Taxonomía", "f-family", "Árbol genealógico", "5 familias distintas", 1, "families", 5],
  ["f10", "Taxonomía", "f-family", "Taxónomo", "10 familias distintas", 2, "families", 10],
  ["f20", "Taxonomía", "f-family", "Sistemático", "20 familias distintas", 2, "families", 20],
  ["f40", "Taxonomía", "f-family", "Gran clasificador", "40 familias distintas", 3, "families", 40],
  ["g3", "Taxonomía", "f-family", "Primos hermanos", "3 especies del mismo género", 2, "sameGenus", 3],
  ["e1", "Despensa", "u-comer", "Primer bocado", "Una planta comestible", 1, "edible", 1],
  ["e5", "Despensa", "u-comer", "Recolector", "5 comestibles", 1, "edible", 5],
  ["e15", "Despensa", "u-comer", "Despensa silvestre", "15 comestibles", 2, "edible", 15],
  ["e30", "Despensa", "u-comer", "Chef del monte", "30 comestibles", 3, "edible", 30],
  ["m1", "Botica", "u-medicina", "Remedio de la abuela", "Una planta medicinal", 1, "medicinal", 1],
  ["m5", "Botica", "u-medicina", "Boticario", "5 medicinales", 2, "medicinal", 5],
  ["m15", "Botica", "u-medicina", "Herbolario mayor", "15 medicinales", 3, "medicinal", 15],
  ["t1", "Venenos", "f-skull", "Ojo con esa", "Una planta tóxica", 1, "toxic", 1],
  ["t3", "Venenos", "f-skull", "Prudente", "3 tóxicas identificadas", 1, "toxic", 3],
  ["t10", "Venenos", "f-skull", "Envenenador retirado", "10 tóxicas identificadas", 3, "toxic", 10],
  ["o10", "Oficios", "u-otro", "Artesano", "10 plantas con otros usos", 2, "other", 10],
  ["u3", "Oficios", "u-otro", "Navaja suiza", "Una planta con 3 tipos de uso", 2, "maxUses", 3],
  ["c1", "Conservación", "f-leaf", "Hallazgo notable", "Una especie vulnerable o más", 2, "vu", 1],
  ["c2", "Conservación", "f-leaf", "Joya escondida", "Una especie en peligro", 3, "en", 1],
  ["c3", "Conservación", "f-leaf", "Leyenda viva", "Una especie en peligro crítico", 3, "cr", 1],
  ["c4", "Conservación", "f-leaf", "Lo común también cuenta", "10 especies de preocupación menor", 1, "lc", 10],
  ["c5", "Conservación", "f-question", "Terra incognita", "Una especie que la UICN no evaluó", 1, "ne", 1],
  ["k1", "Porte", "f-tree", "Bosquecillo", "5 árboles", 1, "tree", 5],
  ["k2", "Porte", "f-shrub", "Matorral", "5 arbustos", 1, "shrub", 5],
  ["k3", "Porte", "f-herb", "Pradera", "10 hierbas", 1, "herb", 10],
  ["k4", "Porte", "f-vine", "Escaladora", "Una trepadora", 1, "vine", 1],
  ["k5", "Porte", "f-mushroom", "Micólogo", "Un hongo", 2, "fungi", 1],
  ["k6", "Porte", "f-mushroom", "Reino Fungi", "5 hongos", 3, "fungi", 5],
  ["y1", "Rasgos", "f-flower", "Nariz fina", "3 aromáticas", 1, "aromatic", 3],
  ["y2", "Rasgos", "f-flower", "Ramillete", "10 plantas con flor", 2, "flower", 10],
  ["y3", "Rasgos", "f-fruit", "Huerto silvestre", "5 frutales", 1, "fruit", 5],
  ["y4", "Rasgos", "f-leaf", "Pies mojados", "Una planta acuática", 2, "aquatic", 1],
  ["y5", "Rasgos", "f-skull", "Patrulla invasora", "3 especies invasoras", 2, "invasive", 3],
  ["y6", "Rasgos", "f-flower", "Paisajista", "5 ornamentales", 1, "ornamental", 5],
  ["s1", "Estaciones", "i-moon", "Cuatro estaciones", "Hallazgos en las 4 estaciones", 2, "seasons", 4],
  ["s2", "Estaciones", "i-moon", "Kalendarium completo", "Hallazgos en los 12 meses", 3, "months", 12],
  ["s3", "Estaciones", "i-moon", "Flor de invierno", "Un hallazgo en pleno invierno", 1, "winter", 1],
  ["s4", "Estaciones", "f-pin", "Día de campo", "3 plantas el mismo día", 1, "sameDay", 3],
  ["s5", "Estaciones", "f-pin", "Gran cosecha", "5 plantas el mismo día", 2, "sameDay", 5],
  ["s6", "Estaciones", "i-moon", "Aniversario", "Un año entre tu primer y tu último hallazgo", 2, "span", 365],
  ["l1", "Viajes", "f-pin", "Explorador local", "Hallazgos en 3 lugares", 1, "places", 3],
  ["l2", "Viajes", "f-pin", "Trotamundos", "Hallazgos en 10 lugares", 2, "places", 10],
  ["l3", "Viajes", "f-globe", "Pasaporte verde", "Hallazgos en 2 países", 2, "countries", 2],
  ["l4", "Viajes", "f-globe", "Ciudadano del mundo", "Hallazgos en 5 países", 3, "countries", 5],
  ["l5", "Viajes", "f-globe", "Dos hemisferios", "Hallazgos al norte y al sur del ecuador", 3, "hemis", 2],
  ["l6", "Viajes", "f-pin", "Cartógrafo", "10 láminas con ubicación", 1, "geo", 10],
  ["r1", "Orígenes", "f-globe", "Viajeras", "Plantas de 3 regiones de origen", 1, "origins", 3],
  ["r2", "Orígenes", "f-globe", "Atlas botánico", "Plantas de 6 regiones de origen", 2, "origins", 6],
  ["a1", "Abecedario", "i-quill", "Primeras letras", "Plantas con 10 iniciales distintas", 1, "letters", 10],
  ["a2", "Abecedario", "i-quill", "Abecedario verde", "Plantas con 20 iniciales distintas", 3, "letters", 20],
  ["p1", "Fotografía", "i-camera", "Reportaje", "Una lámina con 4 fotos", 1, "maxPhotos", 4],
  ["p2", "Fotografía", "i-camera", "Fotógrafo de campo", "50 fotos en total", 2, "photos", 50],
  ["p3", "Fotografía", "i-camera", "Archivo gráfico", "200 fotos en total", 3, "photos", 200],
  ["w1", "Cuaderno", "i-quill", "Cuaderno de campo", "Notas propias en 5 láminas", 1, "notes", 5],
  ["w2", "Cuaderno", "i-quill", "Diario de naturalista", "Notas propias en 20 láminas", 2, "notes", 20],
  ["x1", "Exploración", "i-compass", "Primera expedición", "Cumplí 1 misión", 1, "missions", 1],
  ["x2", "Exploración", "i-compass", "Explorador", "Cumplí 3 misiones", 1, "missions", 3],
  ["x3", "Exploración", "i-compass", "Rastreador", "Cumplí 5 misiones", 2, "missions", 5],
  ["x4", "Exploración", "i-compass", "Naturalista de campo", "Cumplí 10 misiones", 3, "missions", 10],
  ["x5", "Exploración", "i-compass", "Cartógrafo verde", "Cumplí 25 misiones", 4, "missions", 25],
  ["x6", "Exploración", "i-compass", "A la primera", "Cumplí una misión el mismo día que te llegó", 2, "missionSameDay", 1],
  ["x7", "Exploración", "i-compass", "Cuatro estaciones", "Cumplí misiones en las 4 estaciones del año", 3, "missionSeasons", 4],
];
// Los logros de exploración existen solo si las misiones están activas para esta persona.
const achList = () => ACH.filter((a) => a[1] !== "Exploración" || feat("misiones"));
const ACH_KEY = "plantdex.ach";
const achUnlocked = (S = achStats()) => achList().filter((a) => S[a[6]] >= a[7]).map((a) => a[0]);

// Avisa los logros nuevos. La primera vez en un dispositivo los registra en silencio, sin avalancha de avisos.
function checkAchievements() {
  if (!user) return;
  const now = achUnlocked();
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(ACH_KEY)); } catch {}
  const fresh = seen ? now.filter((id) => !seen.includes(id)) : [];
  try { localStorage.setItem(ACH_KEY, JSON.stringify([...new Set([...(seen || []), ...now])])); } catch {}
  fresh.forEach((id) => achQueue.push(ACH.find((a) => a[0] === id)));
  if (fresh.length && !achShowing) showNextAch();
}
const achQueue = []; let achShowing = false;
function showNextAch() {
  // Si se está mostrando un sello (asentada o misión cumplida), el logro espera su turno.
  if (document.querySelector(".stamp")) { achShowing = true; return setTimeout(showNextAch, 500); }
  const a = achQueue.shift(); if (!a) { achShowing = false; return; }
  achShowing = true;
  const el = document.createElement("div");
  el.className = `ach-toast tier-${a[5]}`;
  el.innerHTML = `<span class="ach-medal"><svg><use href="#${a[2]}"/></svg></span>
    <span class="ach-txt"><small>Logro desbloqueado</small><b>${esc(a[3])}</b><i>${esc(a[4])}</i></span>
    <button class="ach-x" aria-label="Cerrar">×</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const close = () => { if (el._closed) return; el._closed = true; el.classList.remove("show"); setTimeout(() => { el.remove(); showNextAch(); }, 350); };
  el.querySelector(".ach-x").onclick = (e) => { e.stopPropagation(); close(); };
  el.onclick = () => { close(); go("stats"); };
  setTimeout(close, 5000);
}

function renderStats() {
  const S = achStats(), n = S.n;
  const unlocked = new Set(achUnlocked(S));
  const fam = Object.entries(plants.reduce((a, p) => (p.family && (a[p.family] = (a[p.family] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cats = [...new Set(achList().map((a) => a[1]))];
  const pct = Math.round((unlocked.size / achList().length) * 100);
  const badge = (a) => { const ok = unlocked.has(a[0]); const cur = Math.min(S[a[6]], a[7]);
    return `<div class="badge tier-${a[5]} ${ok ? "" : "locked"}"><div class="e"><svg><use href="#${a[2]}"/></svg></div><b>${a[3]}</b>
      <div class="muted" style="font-size:14px">${a[4]}</div>
      ${!ok && a[7] > 1 ? `<div class="ach-prog"><i style="width:${(cur / a[7]) * 100}%"></i></div><div class="ach-num">${Math.floor(cur)} / ${a[7]}</div>` : ""}</div>`; };
  $app.innerHTML = `
    <h2>Progressus</h2>
    <p class="muted"><i>Herbarium numquam finitur.</i> El herbario nunca se termina.</p>
    ${feat("misiones") ? `<h3>Misión</h3><div id="mission"></div><h3>Logros</h3>` : ""}
    <div class="stat-grid">
      <div class="stat"><b>${n}</b>láminas</div>
      <div class="stat"><b>${S.families}</b>familias</div>
      <div class="stat"><b>${S.edible}</b>comestibles</div>
      <div class="stat"><b>${S.toxic}</b>tóxicas</div>
    </div>
    <div class="ach-total"><div><b>${unlocked.size}</b> de ${achList().length} logros</div><div class="ach-prog big"><i style="width:${pct}%"></i></div></div>
    ${fam.length ? `<h3>Familias más vistas</h3>${fam.map(([f, c]) => `<div class="entry-head"><span class="sci">${esc(f)}</span><span class="tally">${"✦".repeat(Math.min(c, 12))} <b>${c}</b></span></div>`).join("")}` : ""}
    ${cats.map((cat) => { const list = achList().filter((a) => a[1] === cat); const got = list.filter((a) => unlocked.has(a[0])).length;
      return `<h3>${cat} <span class="cat-count">${got}/${list.length}</span></h3><div class="badge-list">${list.map(badge).join("")}</div>`; }).join("")}`;
  hydrateMission();
}

Object.defineProperty(window, "draft", { get: () => draft, set: (x) => (x ? (draft = x) : clearDraft()) });
boot();
