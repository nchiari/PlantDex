// Avisos de Herbalorium: notificación en el móvil y mail, según lo que cada persona eligió en Ajustes.
// La llaman las apps (pedido para entrar, persona aceptada, lámina nueva, prueba) y, cada hora, una tarea
// de la base ("cron") para la misión nueva de las 9 y el resumen diario de láminas por mail.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const DEFAULT = { requests: { push: true, mail: false }, members: { push: true, mail: false }, plants: { push: true, mail: false }, missions: { push: true, mail: false } };
type Kind = keyof typeof DEFAULT;
const esc = (t: string) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// El mail con la estética del herbario: pergamino, filete dorado, emblema y un botón verde.
// (Los mails no cargan fuentes propias: Georgia es la más parecida que tienen todos.)
const letter = (title: string, inner: string, site = "https://herbalorium.pages.dev/") => {
  const btn = (inner.match(/<a href="([^"]+)">([^<]+)<\/a>/) || []) as string[];
  const body = inner.replace(/<p><a href="[^"]+">[^<]+<\/a><\/p>/, "");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#e9e2cc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e2cc;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#f7f1e1;border:1px solid #c9a24a;outline:4px solid #f7f1e1;outline-offset:-6px">
<tr><td align="center" style="padding:30px 28px 6px">
  <img src="${site}icons/icon-192.png" width="64" height="64" alt="" style="display:block;border:0;border-radius:50%">
  <div style="margin-top:12px;font:700 22px/1.2 Georgia,'Times New Roman',serif;letter-spacing:4px;color:#1f3426;text-transform:uppercase">Herbalorium</div>
  <div style="margin-top:2px;font:italic 15px Georgia,serif;color:#5d6b4f">Herbarium vivum</div>
  <div style="margin:18px auto 0;width:60px;border-top:1px solid #c9a24a"></div>
</td></tr>
<tr><td style="padding:18px 34px 6px;font:17px/1.55 Georgia,'Times New Roman',serif;color:#1f3426">
  <div style="font:600 19px/1.35 Georgia,serif;margin-bottom:10px">${esc(title)}</div>${body}
</td></tr>
${btn[1] ? `<tr><td align="center" style="padding:16px 34px 30px">
  <a href="${btn[1]}" style="display:inline-block;background:#3e5f34;color:#f3eedb;text-decoration:none;font:600 13px Georgia,serif;letter-spacing:2px;text-transform:uppercase;padding:13px 26px;border:1px solid #2a4423">${btn[2]}</a>
</td></tr>` : `<tr><td style="padding:0 0 26px"></td></tr>`}
</table>
<div style="max-width:520px;margin:14px auto 0;font:italic 13px Georgia,serif;color:#7a7a66;text-align:center">Te llega porque lo elegiste en Ajustes → Avisos. Lo cambiás cuando quieras desde ahí.</div>
</td></tr></table></body></html>`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const kind: string = body.kind || "request";
  const site: string = body.site || "https://herbalorium.pages.dev/";

  const { data: secretRows } = await db.from("app_secrets").select("key,value");
  const sec = Object.fromEntries((secretRows || []).map((x) => [x.key, x.value]));

  // Cuentas de esta nube, el dueño (la primera) y quiénes están aceptados.
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const users = (list?.users || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const owner = users[0];
  const { data: mem } = await db.from("members").select("user_id,name,email,invited_by,status,notified_at");
  const accepted = new Set((mem || []).filter((m) => m.status === "accepted").map((m) => m.user_id));
  if (owner) accepted.add(owner.id);
  const nameOf = (id: string) => { const u = users.find((x) => x.id === id); return u?.user_metadata?.name || mem?.find((m) => m.user_id === id)?.name || u?.email || "Alguien"; };

  const { data: prefRows } = await db.from("notif_prefs").select("*");
  const prefsOf = (id: string) => ({ ...DEFAULT, ...(prefRows?.find((p) => p.user_id === id)?.prefs || {}) });
  if (sec.vapid_public && sec.vapid_private && owner?.email) webpush.setVapidDetails(`mailto:${owner.email}`, sec.vapid_public, sec.vapid_private);

  const push = async (uid: string, title: string, text: string, url: string, tag: string) => {
    if (!sec.vapid_private) return 0;
    const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", uid);
    let n = 0;
    for (const s of subs || []) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body: text, url, tag })); n++; }
      catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode || 0)) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
    return n;
  };
  const mail = async (uid: string, subject: string, html: string) => {
    const key = Deno.env.get("BREVO_API_KEY"), to = users.find((u) => u.id === uid)?.email;
    if (!key || !to) return false;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Herbalorium", email: Deno.env.get("BREVO_SENDER") || owner.email }, to: [{ email: to }], subject,
        htmlContent: letter(subject, html) }),
    });
    return r.ok;
  };
  // Manda según lo que eligió cada persona (k = tipo de aviso).
  const send = async (uids: string[], k: Kind, title: string, text: string, url: string, html = "", pushOnly = false) => {
    let p = 0, m = 0;
    for (const uid of uids) {
      const pr = prefsOf(uid)[k];
      if (pr?.push) p += await push(uid, title, text, url, k);
      if (pr?.mail && !pushOnly && await mail(uid, title, html || `<p>${esc(text)}</p><p><a href="${url}">Abrir Herbalorium</a></p>`)) m++;
    }
    return { push: p, mail: m };
  };

  // ---------- tarea de cada hora: misión nueva (9 de la mañana) y resumen diario de láminas ----------
  if (kind === "cron") {
    if (!sec.cron || req.headers.get("x-cron") !== sec.cron) return json({ error: "no autorizado" }, 401);
    let missions = 0, digests = 0;
    for (const uid of accepted) {
      const pr = prefRows?.find((p) => p.user_id === uid), tz = pr?.tz || "Europe/Madrid";
      const now = new Date(), parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
      if (+parts.hour !== 9) continue;
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      const prefs = prefsOf(uid);
      // Misión: la cumpliste antes de hoy y todavía no se te avisó hoy.
      const m = users.find((u) => u.id === uid)?.user_metadata?.mission;
      const doneDay = m?.done ? new Date(m.done).toLocaleDateString("en-CA", { timeZone: tz }) : null;
      if (m?.done && doneDay! < today && pr?.last_mission_ping !== today && (prefs.missions.push || prefs.missions.mail)) {
        await send([uid], "missions", "Tu nueva misión te espera", "Hay una planta nueva para salir a buscar cerca de tu casa.", site + "#stats");
        await db.from("notif_prefs").upsert({ user_id: uid, last_mission_ping: today });
        missions++;
      }
      // Resumen de láminas por mail: solo si alguien más sumó alguna desde el último resumen.
      if (prefs.plants.mail) {
        const since = pr?.last_digest_at || new Date(Date.now() - 86400e3).toISOString();
        const { data: news } = await db.from("plants").select("common_name,author_name,user_id").gt("created_at", since).neq("user_id", uid);
        if (news?.length) {
          const li = news.map((x) => `<li><b>${esc(x.common_name)}</b>${x.author_name ? `, de ${esc(x.author_name)}` : ""}</li>`).join("");
          const t = news.length === 1 ? "Hoy se sumó una lámina al herbario" : `Hoy se sumaron ${news.length} láminas al herbario`;
          if (await mail(uid, t, `<ul style="padding-left:22px;margin:0">${li}</ul><p><a href="${site}#list">Verlas en Herbalorium</a></p>`)) digests++;
        }
        await db.from("notif_prefs").upsert({ user_id: uid, last_digest_at: now.toISOString() });
      }
    }
    return json({ ok: true, missions, digests });
  }

  // ---------- avisos que dispara alguien desde la app ----------
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  const { data: who } = await db.auth.getUser(token);
  const me = who?.user;
  if (!me) return json({ error: "sin sesión" }, 401);

  if (kind === "test") {
    const k = (body.what as Kind) || "requests";
    return json({ ok: true, ...(await send([me.id], k, "Avisos activados", "Así te van a llegar los avisos del herbario.", site + "#settings")) });
  }
  if (kind === "request") { // pedido para entrar: al dueño
    const m = mem?.find((x) => x.user_id === me.id);
    if (!m || m.status !== "pending" || m.notified_at || !owner) return json({ ok: true, skipped: true });
    await db.from("members").update({ notified_at: new Date().toISOString() }).eq("user_id", me.id);
    const who2 = m.name || m.email || "Alguien";
    return json({ ok: true, ...(await send([owner.id], "requests", `${who2} quiere entrar al herbario`, `${m.email || ""}${m.invited_by ? ` · invitado por ${m.invited_by}` : ""}. Aceptalo desde Ajustes.`, site + "#settings")) });
  }
  if (kind === "member") { // el dueño aceptó a alguien: a los demás miembros
    if (me.id !== owner?.id || !body.user_id || !accepted.has(body.user_id)) return json({ error: "no corresponde" }, 403);
    const n = nameOf(body.user_id);
    // A la persona aceptada: siempre un mail (todavía no eligió avisos) y, si ya activó el móvil, también ahí.
    const welcome = `${nameOf(me.id)} aceptó tu pedido. Ya podés ver todas las láminas y sumar las tuyas.`;
    const welcomed = await mail(body.user_id, "Ya estás adentro del herbario", `<p>${esc(welcome)}</p><p><a href="${site}#list">Abrir el herbario</a></p>`);
    await push(body.user_id, "Ya estás adentro del herbario", welcome, site + "#list", "members");
    const to = [...accepted].filter((u) => u !== body.user_id && u !== me.id);
    return json({ ok: true, welcomed, ...(await send(to, "members", `${n} se sumó al herbario`, `Desde ahora ${n} también puede cargar láminas.`, site + "#list")) });
  }
  if (kind === "plant") { // lámina nueva: al móvil de los demás (el mail va en el resumen diario)
    const { data: p } = await db.from("plants").select("id,common_name,author_name,user_id,created_at").eq("id", body.plant_id).maybeSingle();
    if (!p || p.user_id !== me.id || Date.now() - new Date(p.created_at).getTime() > 600e3) return json({ error: "no corresponde" }, 403);
    const to = [...accepted].filter((u) => u !== me.id);
    return json({ ok: true, ...(await send(to, "plants", `Lámina nueva: ${p.common_name}`, `${p.author_name || nameOf(me.id)} la sumó al herbario.`, site + "#plant/" + p.id, "", true)) });
  }
  return json({ error: "tipo desconocido" }, 400);
});
