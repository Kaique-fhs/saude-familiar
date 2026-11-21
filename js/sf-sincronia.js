// Fila de envio persistente e sincronização com a conta. Tudo entra por parâmetro (api, local, fotos, relógio, callbacks).
(function (raiz) {
  var TIPOS = ["fav", "sel", "check", "checkplano", "quero", "feito", "treino", "registro"];
  var TAMANHO_LOTE = 200;
  var LIMITE_BAIXAR = 500;
  var ESPERA_TETO_MS = 5 * 60 * 1000;

  function classeErroApi(deps) {
    if (deps.ErroApi) return deps.ErroApi;
    if (raiz.SF && raiz.SF.api) return raiz.SF.api.ErroApi;
    return require("./sf-api.js").ErroApi;
  }
  function dadosModulo(deps) {
    if (deps.dados) return deps.dados;
    if (raiz.SF && raiz.SF.dados) return raiz.SF.dados;
    return require("./sf-dados.js");
  }

  function avisar() {
    if (typeof console !== "undefined" && console.warn) console.warn.apply(console, arguments);
  }
  function ms(v) { return new Date(v).getTime(); }
  function ehObjeto(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function idFoto(m) {
    return m && m.tipo === "registro" && m.ativo && ehObjeto(m.valor) && typeof m.valor.foto === "string" && m.valor.foto ? m.valor.foto : null;
  }
  function igual(a, b) {
    return a.tipo === b.tipo && a.chave === b.chave && a.em === b.em && a.ativo === b.ativo &&
      JSON.stringify(a.valor === undefined ? null : a.valor) === JSON.stringify(b.valor === undefined ? null : b.valor);
  }

  function criar(deps) {
    var api = deps.api, local = deps.local, fotos = deps.fotos, userId = deps.userId;
    var ErroApi = classeErroApi(deps);
    var dados = dadosModulo(deps);
    var agora = deps.agora || function () { return new Date().toISOString(); };
    var timeoutMs = deps.timeoutMs || 30000;
    var timeoutFotoMs = deps.timeoutFotoMs || Math.max(timeoutMs, 60000);
    var tamanhoLote = deps.tamanhoLote || TAMANHO_LOTE;
    var esperaBaseMs = deps.esperaBaseMs || 2000;
    var avisarStatus = deps.aoMudarStatus || function () {};
    var avisarEstado = deps.aoMudarEstado || function () {};
    var avisarSessao = deps.aoSessaoVencida || function () {};

    var fila = local.ler(userId, "fila", []);
    var pendentesFoto = local.ler(userId, "fotos-pendentes", []);
    var enviadas = local.ler(userId, "fotos-enviadas", []);
    var rejeitadosLista = local.ler(userId, "rejeitados", []);
    var avisosLista = local.ler(userId, "avisos", []);
    var ref = null;            // último estado conhecido (depois de aplicar o remoto)
    var emAndamento = null;
    var ultimoProblema = null; // "offline" | "erro" | "conflito"
    var falhas = 0;
    var ultimoStatus = null;

    function salvar(nome, valor) { local.gravar(userId, nome, valor); }
    function iso() { var a = agora(); return typeof a === "string" ? a : new Date(a).toISOString(); }

    function pendentes() { return fila.length + pendentesFoto.length; }
    function status() {
      if (emAndamento) return "enviando";
      if (ultimoProblema) return ultimoProblema;
      return pendentes() > 0 ? "pendente" : "ok";
    }
    function notificar() {
      var s = status();
      if (s !== ultimoStatus) { ultimoStatus = s; avisarStatus(s); }
    }
    function esperaMs() {
      if (!falhas) return 0;
      return Math.min(esperaBaseMs * Math.pow(2, falhas - 1), ESPERA_TETO_MS);
    }

    // Toda chamada de rede: timeout e erro que não é da API (corpo quebrado etc.) viram "rede".
    function chamar(fn, limite, preservar) {
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new ErroApi(0, "rede")); }, limite);
        var p;
        try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
        p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) {
          clearTimeout(t);
          if (e && e.name === "ErroApi") reject(e);
          else if (preservar && e && e.message === preservar) reject(e);
          else reject(new ErroApi(0, "rede"));
        });
      });
    }

    function removerDaFila(enviados) {
      fila = fila.filter(function (f) { return !enviados.some(function (e) { return igual(f, e); }); });
      salvar("fila", fila);
    }
    function rejeitar(m, codigo) {
      var ja = rejeitadosLista.some(function (r) { return r.tipo === m.tipo && r.chave === m.chave; });
      if (!ja) rejeitadosLista.push({ tipo: m.tipo, chave: m.chave, codigo: codigo });
      salvar("rejeitados", rejeitadosLista);
      removerDaFila([m]);
    }

    function registrar(antes, depois) {
      var base = ref || antes;
      var mudancas = dados.diferencas(base, depois, iso());
      ref = depois;
      if (!mudancas.length) { notificar(); return; }
      mudancas.forEach(function (m) {
        fila = fila.filter(function (f) { return !(f.tipo === m.tipo && f.chave === m.chave); });
        fila.push(m);
        var foto = idFoto(m);
        if (foto && enviadas.indexOf(foto) < 0 && pendentesFoto.indexOf(foto) < 0) pendentesFoto.push(foto);
      });
      salvar("fila", fila);
      salvar("fotos-pendentes", pendentesFoto);
      notificar();
    }

    // ---- fotos ----
    function tirarFoto(id) {
      pendentesFoto = pendentesFoto.filter(function (x) { return x !== id; });
      salvar("fotos-pendentes", pendentesFoto);
    }
    function marcarEnviada(id) {
      if (enviadas.indexOf(id) < 0) { enviadas.push(id); salvar("fotos-enviadas", enviadas); }
      tirarFoto(id);
    }
    function enviarFotos() {
      return pendentesFoto.slice().reduce(function (p, id) {
        return p.then(function () {
          if (enviadas.indexOf(id) >= 0 || (fotos.foiEnviada && fotos.foiEnviada(id))) { marcarEnviada(id); return; }
          return chamar(function () { return fotos.enviar(id); }, timeoutFotoMs, "sem-foto").then(function () {
            marcarEnviada(id);
          }, function (e) {
            if (e && e.message === "sem-foto") {
              fila = fila.map(function (f) {
                if (idFoto(f) !== id) return f;
                avisosLista.push({ tipo: f.tipo, chave: f.chave, codigo: "foto-sumida", foto: id });
                return Object.assign({}, f, { valor: Object.assign({}, f.valor, { foto: null }) });
              });
              salvar("fila", fila);
              salvar("avisos", avisosLista);
              tirarFoto(id);
              return;
            }
            if (e.status === 400 || e.status === 403) {
              fila.filter(function (f) { return idFoto(f) === id; }).forEach(function (f) { rejeitar(f, e.codigo || "foto"); });
              tirarFoto(id);
              return;
            }
            throw e;
          });
        });
      }, Promise.resolve());
    }

    // ---- envio da fila ----
    function paraServidor(m) {
      return { tipo: m.tipo, chave: m.chave, valor: m.valor === undefined ? null : m.valor, ativo: m.ativo, em: m.em };
    }

    function enviarLote(lote) {
      return chamar(function () { return api.enviarMudancas(lote.map(paraServidor)); }, timeoutMs).then(function (res) {
        if (!res || !Array.isArray(res.conflitos)) throw new ErroApi(0, "rede");
        removerDaFila(lote);
        if (res.conflitos.length) { aplicarRemotos(res.conflitos); ultimoProblema = "conflito"; }
      }, function (e) {
        if (e && e.name === "ErroApi" && e.status === 413) {
          if (lote.length === 1) { rejeitar(lote[0], "requisicao"); return; }
          var meio = Math.floor(lote.length / 2);
          return enviarLote(lote.slice(0, meio)).then(function () { return enviarLote(lote.slice(meio)); });
        }
        if (e && e.name === "ErroApi" && e.status === 400 && e.codigo === "sync") {
          if (lote.length === 1) { rejeitar(lote[0], "sync"); return; }
          return lote.reduce(function (p, m) { return p.then(function () { return enviarLote([m]); }); }, Promise.resolve());
        }
        throw e;
      });
    }

    function enviarFila() {
      var candidatos = fila.filter(function (f) { var id = idFoto(f); return !(id && pendentesFoto.indexOf(id) >= 0); });
      if (!candidatos.length) return Promise.resolve();
      return enviarLote(candidatos.slice(0, tamanhoLote)).then(enviarFila);
    }

    // ---- download ----
    function aplicarRemotos(itens) {
      var validos = [];
      itens.forEach(function (it) {
        if (!it || typeof it !== "object" || TIPOS.indexOf(it.tipo) < 0) { avisar("Item remoto de tipo desconhecido ignorado:", it && it.tipo); return; }
        if (!dados.chaveValida(it.tipo, it.chave)) { avisar("Item remoto com chave inválida ignorado:", it.tipo); return; }
        if (it.ativo && it.tipo === "registro" && !ehObjeto(it.valor)) { avisar("Registro remoto sem valor ignorado:", it.chave); return; }
        var pend = fila.filter(function (f) { return f.tipo === it.tipo && f.chave === it.chave; })[0];
        if (pend) {
          if (ms(pend.em) > ms(it.em)) return; // a mudança local é mais nova: fica
          fila = fila.filter(function (f) { return f !== pend; });
        }
        validos.push(it);
      });
      salvar("fila", fila);
      if (!validos.length) return;
      var base = deps.estado ? deps.estado() : (ref || dados.estadoVazio());
      var novo = dados.aplicar(base, validos);
      ref = novo;
      avisarEstado(novo);
    }

    function baixarTudo() {
      var cursor = local.ler(userId, "cursor", 0);
      function pagina() {
        return chamar(function () { return api.baixar(cursor, LIMITE_BAIXAR); }, timeoutMs).then(function (res) {
          if (!res || !Array.isArray(res.itens) || typeof res.cursor !== "number") throw new ErroApi(0, "rede");
          aplicarRemotos(res.itens);
          if (res.cursor > cursor) { cursor = res.cursor; salvar("cursor", cursor); }
          else if (res.mais) throw new ErroApi(500, "cursor");
          if (res.mais) return pagina();
        });
      }
      return pagina();
    }

    function sincronizar() {
      if (emAndamento) return emAndamento;
      ultimoProblema = null;
      var p = Promise.resolve().then(function () {
        return enviarFotos().then(enviarFila).then(baixarTudo);
      }).then(function () {
        falhas = 0;
      }, function (e) {
        if (e && e.name === "ErroApi" && e.status === 401) { avisarSessao(); return; }
        falhas++;
        ultimoProblema = e && e.name === "ErroApi" && e.status === 0 ? "offline" : "erro";
      }).then(function () {
        emAndamento = null;
        notificar();
      });
      emAndamento = p;
      notificar();
      return p;
    }

    ultimoStatus = status();

    return {
      registrar: registrar,
      sincronizar: sincronizar,
      rejeitados: function () { return rejeitadosLista.slice(); },
      avisos: function () { return avisosLista.slice(); },
      status: status,
      pendentes: pendentes,
      esperaMs: esperaMs
    };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.sincronia = { criar: criar };
  if (typeof module !== "undefined") module.exports = raiz.SF.sincronia;
})(typeof window !== "undefined" ? window : globalThis);
