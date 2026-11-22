// Cliente da API de contas e sincronização. Tudo entra por parâmetro (config, fetch, sessao).
(function (raiz) {
  function ErroApi(status, codigo) {
    var e = new Error("Erro da API: " + status + " " + codigo);
    Object.setPrototypeOf(e, ErroApi.prototype);
    e.name = "ErroApi";
    e.status = status;
    e.codigo = codigo;
    return e;
  }
  ErroApi.prototype = Object.create(Error.prototype);
  ErroApi.prototype.constructor = ErroApi;

  function criar(deps) {
    var config = deps.config || {};
    var f = deps.fetch;
    var sessao = deps.sessao || function () { return null; };
    var base = String(config.apiUrl || "").replace(/\/+$/, "");

    function pedir(metodo, caminho, opcoes) {
      opcoes = opcoes || {};
      var headers = {};
      var init = { method: metodo, headers: headers };
      if (opcoes.corpo !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(opcoes.corpo);
      }
      var token = sessao();
      if (token) headers.Authorization = "Bearer " + token;
      if (opcoes.turnstile !== undefined) headers["x-turnstile-token"] = opcoes.turnstile;
      if (config.cabecalhoOrigemDev) headers["x-saude-origem"] = config.cabecalhoOrigemDev;

      return Promise.resolve().then(function () {
        return f(base + caminho, init);
      }).catch(function () {
        throw new ErroApi(0, "rede");
      }).then(function (res) {
        return Promise.resolve(res.text()).then(function (texto) {
          var corpo = null;
          if (texto) { try { corpo = JSON.parse(texto); } catch (e) { corpo = null; } }
          if (!res.ok) throw new ErroApi(res.status, (corpo && corpo.erro) || "");
          return corpo;
        });
      });
    }

    return {
      cadastro: function (email, senha, turnstile, aceite) {
        return pedir("POST", "/conta/cadastro", { corpo: { email: email, senha: senha, aceite: aceite }, turnstile: turnstile || "" });
      },
      confirmar: function (token) { return pedir("POST", "/conta/confirmar", { corpo: { token: token } }); },
      entrar: function (email, senha) { return pedir("POST", "/conta/entrar", { corpo: { email: email, senha: senha } }); },
      sair: function () { return pedir("POST", "/conta/sair"); },
      conta: function () { return pedir("GET", "/conta"); },
      esqueci: function (email, turnstile) {
        return pedir("POST", "/conta/esqueci", { corpo: { email: email }, turnstile: turnstile || "" });
      },
      novaSenha: function (token, senha) { return pedir("POST", "/conta/nova-senha", { corpo: { token: token, senha: senha } }); },
      apagarConta: function (senha) { return pedir("DELETE", "/conta", { corpo: { senha: senha } }); },
      enviarMudancas: function (mudancas) { return pedir("POST", "/sync", { corpo: { mudancas: mudancas } }); },
      baixar: function (depois, limite) {
        return pedir("GET", "/sync?depois=" + encodeURIComponent(depois) + "&limite=" + encodeURIComponent(limite));
      },
      urlEnvioFoto: function (fotoId) { return pedir("POST", "/fotos/" + encodeURIComponent(fotoId) + "/envio"); },
      urlFoto: function (fotoId) { return pedir("GET", "/fotos/" + encodeURIComponent(fotoId)); }
    };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.api = { criar: criar, ErroApi: ErroApi };
  if (typeof module !== "undefined") module.exports = raiz.SF.api;
})(typeof window !== "undefined" ? window : globalThis);
