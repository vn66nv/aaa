const V = "kunsabai-v6";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "i18n.js", "manifest.webmanifest", "icons/icon-192.png", "vendor/leaflet.js", "vendor/leaflet.css"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.hostname.endsWith("supabase.co") || u.hostname.includes("nominatim") || u.hostname.includes("photon")) return; // всегда живые данные
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || u.hostname.includes("cdnjs") || u.hostname.includes("tile.openstreetmap"))) {
      const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy));
    }
    return r;
  }).catch(() => hit)));
});
