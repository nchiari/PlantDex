// Trabajador en segundo plano de Herbalorium: solo recibe avisos (no guarda nada en caché).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Herbalorium", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Herbalorium", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./#settings" }, tag: "pedido",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./#settings";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
