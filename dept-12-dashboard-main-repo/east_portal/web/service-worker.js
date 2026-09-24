var CACHE = "rexius-bag-orders-v1";
var SHELL = ["/", "/styles.css", "/app.js", "/manifest.webmanifest", "/rexius-logo.png",
  "/vendor/pdf.min.js", "/vendor/pdf.worker.min.js", "/vendor/pdf-lib.min.js"];
self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
  }));
  self.clients.claim();
});
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.indexOf("/api/") === 0) return;
  event.respondWith(fetch(event.request).then(function (response) {
    var copy = response.clone(); caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); }); return response;
  }).catch(function () { return caches.match(event.request); }));
});
