// App shell is cached for offline use; the news file is always fetched fresh when online.
const CACHE = "jg-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "questions.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network first for everything (so updates land immediately), cache as offline fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        const key = url.pathname.endsWith("news.json") ? new Request("data/news.json") : e.request;
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(() => caches.match(url.pathname.endsWith("news.json") ? "data/news.json" : e.request)
      .then((r) => r || caches.match("index.html")))
  );
});
