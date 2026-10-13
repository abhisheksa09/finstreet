// Service worker: network-first for everything (so a deploy shows up on the next load),
// falling back to the cached copy when offline.
const SHELL_CACHE = "shell-v2";
const API_CACHE = "api-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./config.js",
  "./manifest.webmanifest", "./icons/icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== API_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(API_CACHE).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || Response.error())),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error())),
    );
  }
});
