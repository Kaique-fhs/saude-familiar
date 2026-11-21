// Envio e download de fotos pela API. Tudo entra por parâmetro (api, fetch, banco).
(function (raiz) {
  function erroApiClasse(deps) {
    if (deps.ErroApi) return deps.ErroApi;
    if (raiz.SF && raiz.SF.api) return raiz.SF.api.ErroApi;
    return require("./sf-api.js").ErroApi;
  }

  function criar(deps) {
    var api = deps.api;
    var f = deps.fetch;
    var banco = deps.banco;
    var ErroApi = erroApiClasse(deps);
    var enviadas = {};

    // "sem-foto" | "sessao" | "rede" | "permanente"
    function classificar(e) {
      if (e && e.message === "sem-foto") return "sem-foto";
      if (e && e.name === "ErroApi") {
        if (e.status === 401) return "sessao";
        if (e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429) return "rede";
      }
      return "permanente";
    }

    function enviar(fotoId) {
      return Promise.resolve(banco.ler(fotoId)).then(function (blob) {
        if (!blob) throw new Error("sem-foto");
        return api.urlEnvioFoto(fotoId).then(function (assinado) {
          var form = new FormData();
          var campos = assinado.campos || {};
          Object.keys(campos).forEach(function (k) { form.append(k, campos[k]); });
          // O S3 exige o campo "file" por último.
          form.append("file", new Blob([blob], { type: "image/jpeg" }), fotoId + ".jpg");
          return Promise.resolve().then(function () {
            return f(assinado.url, { method: "POST", body: form });
          }).catch(function () {
            throw new ErroApi(0, "rede");
          });
        });
      }).then(function (res) {
        if (!res.ok) throw new ErroApi(res.status, "foto-envio");
        enviadas[fotoId] = true;
      });
    }

    function foiEnviada(fotoId) { return enviadas[fotoId] === true; }

    function garantir(fotoId) {
      return Promise.resolve(banco.ler(fotoId)).then(function (local) {
        if (local) return local;
        return api.urlFoto(fotoId).then(function (r) {
          return f(r.url);
        }).then(function (res) {
          if (!res || !res.ok) return null;
          return Promise.resolve(res.blob()).then(function (blob) {
            return Promise.resolve(banco.gravar(fotoId, blob)).then(function () { return blob; });
          });
        });
      }).catch(function () { return null; });
    }

    return { enviar: enviar, garantir: garantir, classificar: classificar, foiEnviada: foiEnviada };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.fotos = { criar: criar };
  if (typeof module !== "undefined") module.exports = raiz.SF.fotos;
})(typeof window !== "undefined" ? window : globalThis);
