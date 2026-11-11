// Moikas app service worker: phone notifications + a simple offline page. Pages and the API always come from the network.
const VERSION = "moikas-sw-1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The site sends an empty push ("you have something new"); we fetch the newest unread notification and show it.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let item = null;
    try {
      const r = await fetch("/api/notifications?latest=1", { credentials: "include", cache: "no-store" });
      item = (await r.json()).item;
    } catch { /* offline */ }
    const body = item?.body ? item.body.replace(/\{t:(\d{10,14})\}/g, (_, ms) => new Date(+ms).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })) : undefined;
    await self.registration.showNotification(item?.title || "Moikas", {
      body: body || (item ? undefined : "Tienes algo nuevo en Moikas"),
      icon: "/icons/icon-192.png", badge: "/icons/badge-96.png",
      tag: item ? `n${item.id}` : "moikas", renotify: !!item,
      data: { url: item?.url || "/", id: item?.id || null },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url, id } = e.notification.data || {};
  e.waitUntil((async () => {
    if (id) fetch("/api/notifications", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", id }) }).catch(() => {});
    const target = new URL(url || "/", self.location.origin).href;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (same) { await same.focus(); return same.navigate(target).catch(() => self.clients.openWindow(target)); }
    return self.clients.openWindow(target);
  })());
});

// Offline: if a page can't load, show a small "sin conexión" page instead of the browser error.
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#16161d;color:#eee;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><div style="font-size:3rem">📡</div><h2>Sin conexión</h2><p>Revisa tu internet e inténtalo otra vez.</p><button onclick="location.reload()" style="padding:10px 18px;border:0;background:#f2b33d;font-weight:bold">Reintentar</button></div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } })));
});
void VERSION;
