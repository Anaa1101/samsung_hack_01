// Minimal service worker — required for "install to home screen" on Android Chrome.
// We don't cache aggressively because the daemon is on a laptop and the data is live.

const CACHE = "aura-shell-v1";
const SHELL = ["/simple", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Always go to the network for API calls — they must be live.
  if (url.pathname.startsWith("/api/")) return;
  // Network-first for everything else, fall back to the cached shell offline.
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("/simple"))),
  );
});
