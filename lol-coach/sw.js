// Bump VERSION whenever any shell asset changes; publish the shell atomically.
const VERSION = "v2";
const BASE = new URL("./", self.location.href);
const PREFIX = `nexus-shell:${BASE.href}:`;
const CACHE = PREFIX + VERSION;
const FILES = [
  "index.html", "styles.css", "app.js", "data.js", "model.js", "pwa.js",
  "favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "icon-maskable-512.png",
];
const SHELL = FILES.map(file => new URL(file, BASE).href);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      for (const url of SHELL) {
        const response = await fetch(new Request(url, { cache: "reload", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) }));
        if (!response.ok || response.type === "opaque" || response.redirected) throw new Error("Shell unavailable");
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // No skipWaiting: existing tabs keep their version and unsaved forms.
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    // No clients.claim: an online page must reload before mixing in this shell.
  })());
});

function shellURL(request) {
  const url = new URL(request.url);
  url.hash = "";
  if (request.method !== "GET" || url.origin !== BASE.origin || url.search) return null;
  if (request.mode === "navigate" && (url.href === BASE.href || url.href === new URL("index.html", BASE).href)) return SHELL[0];
  return SHELL.includes(url.href) ? url.href : null;
}

self.addEventListener("fetch", event => {
  const url = shellURL(event.request);
  if (!url) return; // API, private paths, unknown pages and external links are network-only.
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url);
      if (cached) return cached;
    } catch { /* Storage refusal must not prevent online use. */ }
    return fetch(event.request);
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "SHELL_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE);
      ready = (await Promise.all(SHELL.map(url => cache.match(url)))).every(Boolean);
    } catch { /* Do not promise offline access when storage is unavailable. */ }
    event.ports[0].postMessage({ ready });
  })());
});
