// Avisa al dueño del herbario cuando alguien pide entrar: notificación en sus celulares y un mail.
// La llama la app de quien pidió entrar (una sola vez por pedido) o el dueño para probar los avisos.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  const { data: who } = await db.auth.getUser(token);
  const me = who?.user;
  if (!me) return json({ error: "sin sesión" }, 401);
  const { kind = "request", site = "" } = await req.json().catch(() => ({}));

  // El dueño es la primera cuenta de esta nube.
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const owner = (list?.users || []).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!owner) return json({ error: "sin dueño" }, 500);

  let title = "", body = "";
  if (kind === "test") {
    if (me.id !== owner.id) return json({ error: "solo el dueño" }, 403);
    title = "Avisos activados"; body = "Así te va a llegar cada pedido para entrar al herbario.";
  } else {
    const { data: m } = await db.from("members").select("name,email,invited_by,status,notified_at").eq("user_id", me.id).maybeSingle();
    if (!m || m.status !== "pending" || m.notified_at) return json({ ok: true, skipped: true });
    await db.from("members").update({ notified_at: new Date().toISOString() }).eq("user_id", me.id);
    const who = m.name || m.email || "Alguien";
    title = `${who} quiere entrar al herbario`;
    body = `${m.email || ""}${m.invited_by ? ` · invitado por ${m.invited_by}` : ""}. Aceptalo desde Ajustes.`;
  }
  const url = (site || "https://herbalorium.pages.dev/") + "#settings";
  const out = { push: 0, mail: false };

  // Notificación a cada celular del dueño que la activó.
  const { data: keys } = await db.from("app_secrets").select("key,value").in("key", ["vapid_public", "vapid_private"]);
  const k = Object.fromEntries((keys || []).map((x) => [x.key, x.value]));
  if (k.vapid_public && k.vapid_private) {
    webpush.setVapidDetails(`mailto:${owner.email}`, k.vapid_public, k.vapid_private);
    const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", owner.id);
    for (const s of subs || []) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url })); out.push++; }
      catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode || 0)) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }

  // Mail por Brevo (si está la clave). El remitente es BREVO_SENDER o, si no está, el mismo mail del dueño.
  const brevo = Deno.env.get("BREVO_API_KEY");
  if (brevo && owner.email) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": brevo, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Herbalorium", email: Deno.env.get("BREVO_SENDER") || owner.email }, to: [{ email: owner.email }],
        subject: title, htmlContent: `<p style="font-family:Georgia,serif;font-size:17px">${body}</p><p><a href="${url}">Abrir Ajustes en Herbalorium</a></p>`,
      }),
    });
    out.mail = r.ok;
  }
  return json({ ok: true, ...out });
});
