const CACHE = "ledger-shell-v1";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// App shell: cache-first. Everything else (Supabase API calls, fonts): network only,
// so data is never served stale from cache.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShell = url.origin === self.location.origin && SHELL.includes("." + url.pathname.replace(self.registration.scope.replace(self.location.origin, ""), "/"));
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return; // let Supabase/font requests hit the network directly
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
