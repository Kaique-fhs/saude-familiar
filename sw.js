// Guarda o site no aparelho para abrir sem internet.
// Mudanças nos arquivos chegam sozinhas na abertura seguinte do app.
// Aumentar VERSAO (e o ?v= no index.html) é opcional: faz a mudança valer já na próxima abertura.
var VERSAO = "meu-prato-v32";
var ARQUIVOS = [
  "./",
  "./index.html",
  "./styles.css?v=32",
  "./config.js?v=32",
  "./data.js?v=32",
  "./js/sf-api.js?v=32",
  "./js/sf-local.js?v=32",
  "./js/sf-dados.js?v=32",
  "./js/sf-fotos.js?v=32",
  "./js/sf-sincronia.js?v=32",
  "./app.js?v=32",
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
      // no-cache: confere com o servidor em vez de usar a cópia do cache HTTP (que o GitHub guarda por 10 min).
      fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" })).then(function (res) {
        if (res.ok) {
          var copia = res.clone();
          caches.open(VERSAO).then(function (c) { c.put("./index.html", copia); });
          return res;
        }
        // página de erro do servidor: usa a cópia boa guardada, se houver
        return caches.match("./index.html").then(function (guardada) { return guardada || res; });
      }).catch(function () { return caches.match("./index.html"); })
    );
    return;
  }

  // Arquivos do site: entrega a cópia guardada na hora e busca a versão nova por trás.
  // Assim, se o data.js for editado sem trocar a versão, o app se atualiza na abertura seguinte.
  if (url.origin === location.origin) {
    var buscar = fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" })).then(function (res) {
      if (res.ok) {
        var copia = res.clone();
        return caches.open(VERSAO).then(function (c) { return c.put(req, copia); }).then(function () { return res; });
      }
      return res;
    });
    e.respondWith(caches.match(req).then(function (achou) { return achou || buscar; }));
    e.waitUntil(buscar.catch(function () {}));
    return;
  }

  // Outra origem (a API, as fotos assinadas): passa direto, sem cache. Só as fontes do Google são guardadas.
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;

  // Fontes do Google: não mudam, então cache primeiro e rede como reserva.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
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
