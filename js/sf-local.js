// Armazenamento local por usuário (chaves sf:<userId>:<nome>). O storage entra por parâmetro.
(function (raiz) {
  var SINCRONIZAVEIS = ["mp-favs", "mp-sel", "mp-checks", "mp-checks-plano", "mp-quero", "mp-diario", "mp-treinos", "mp-registros"];

  function criar(deps) {
    var st = deps.storage;

    function chave(userId, nome) { return "sf:" + userId + ":" + nome; }
    function lerJson(k, padrao) {
      try { var v = st.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
    }
    function gravarJson(k, valor) {
      try { st.setItem(k, JSON.stringify(valor)); return true; } catch (e) { return false; }
    }

    function vazio(v) {
      if (v === null || v === undefined) return true;
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === "object") return Object.keys(v).length === 0;
      return false;
    }

    return {
      sessao: function () { return lerJson("sf:sessao", null); },
      gravarSessao: function (s) { return gravarJson("sf:sessao", s); },
      apagarSessao: function () { try { st.removeItem("sf:sessao"); } catch (e) { /* ignora */ } },
      // Chaves globais (fora de qualquer conta): sf:<nome>, ex.: sf:migracao.
      lerGlobal: function (nome, padrao) { return lerJson("sf:" + nome, padrao); },
      gravarGlobal: function (nome, valor) { return gravarJson("sf:" + nome, valor); },
      apagarGlobal: function (nome) { try { st.removeItem("sf:" + nome); } catch (e) { /* ignora */ } },
      ler: function (userId, nome, padrao) { return lerJson(chave(userId, nome), padrao); },
      gravar: function (userId, nome, valor) { return gravarJson(chave(userId, nome), valor); },
      apagarUsuario: function (userId) {
        // O marcador da migração é global; sai junto com a conta que o criou.
        var marcador = lerJson("sf:migracao", null);
        if (marcador && marcador.dono === userId) {
          try { st.removeItem("sf:migracao"); } catch (e) { /* ignora */ }
        }
        var prefixo = "sf:" + userId + ":";
        var apagar = [];
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i);
          if (k && k.indexOf(prefixo) === 0) apagar.push(k);
        }
        apagar.forEach(function (k) { st.removeItem(k); });
      },
      // Qualquer chave do app antigo, mesmo vazia (quem desmarcou tudo continua sendo quem já usa o app).
      usouAppAntigo: function () {
        try {
          for (var i = 0; i < st.length; i++) {
            if (String(st.key(i)).indexOf("mp-") === 0) return true;
          }
        } catch (e) { /* sem armazenamento legível */ }
        return false;
      },
      temDadosAntigos: function () {
        return SINCRONIZAVEIS.some(function (k) { return !vazio(lerJson(k, null)); });
      }
    };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.local = { criar: criar };
  if (typeof module !== "undefined") module.exports = raiz.SF.local;
})(typeof window !== "undefined" ? window : globalThis);
