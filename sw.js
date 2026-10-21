/* =============================================================
   MUNGIBERRI TXOKO — Service Worker
   Sarea lehenetsi (network-first): beti edukirik berriena saiatu,
   eta lineaz kanpo bakarrik erabili cachea. Horrela ez da bertsio
   zaharrik geratzen. Supabase eskaerak ez dira eteten (jatorri ezberdina).
   ============================================================= */
const CACHE = "txoko-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./img/logoa.png",
  "./img/estiloa.png",
  "./img/icon-192.png",
  "./img/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase eta kanpoko eskaerak ukitu gabe

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
