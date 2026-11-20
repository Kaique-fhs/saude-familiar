// Guarda o site no aparelho para abrir sem internet.
// Ao publicar mudanças, aumente VERSAO (e o ?v= no index.html).
var VERSAO = "meu-prato-v7";
var ARQUIVOS = [
  "./",
  "./index.html",
  "./styles.css?v=7",
  "./data.js?v=7",
  "./app.js?v=7",
  "./logo.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== VERSAO; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Página: tenta a rede (para pegar atualizações) e cai no cache sem internet.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copia = res.clone();
        caches.open(VERSAO).then(function (c) { c.put("./index.html", copia); });
        return res;
      }).catch(function () { return caches.match("./index.html"); })
    );
    return;
  }

  // Arquivos do site e fontes: cache primeiro, rede como reserva.
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(function (achou) {
        return achou || fetch(req).then(function (res) {
          if (res.ok || res.type === "opaque") {
            var copia = res.clone();
            caches.open(VERSAO).then(function (c) { c.put(req, copia); });
          }
          return res;
        });
      })
    );
  }
});
