// Trabajador en segundo plano de Herbalorium: solo recibe avisos (no guarda nada en caché).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Herbalorium", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Herbalorium", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/badge-96.png", data: { url: d.url || "./#settings" },
    // Cada aviso con su propia etiqueta: si no, el siguiente reemplaza al anterior y solo queda uno (por ejemplo, varias láminas seguidas).
    tag: `${d.tag || "aviso"}-${Date.now()}`,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./#settings";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    // Si la app ya está abierta, se trae al frente y se le pide que vaya a la lámina (o a donde diga el aviso).
    const w = ws.find((x) => x.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ go: new URL(url, self.registration.scope).hash }); return w.focus().catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});
