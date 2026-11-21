// Fila de envio persistente e sincronização com a conta. Tudo entra por parâmetro (api, local, fotos, relógio, callbacks).
// Contrato para a Task 7:
//  - deps.estado() é obrigatório e devolve o estado ATUAL do app (criar lança erro sem ele);
//  - deps.aoMudarEstado(novo) deve gravar o novo estado de forma SÍNCRONA antes de retornar
//    (o cursor do /sync é gravado logo depois);
//  - o app chama registrar(antes, depois) a cada salvarTudo e agenda sincronizar() usando esperaMs().
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

  function copia(v) { return JSON.parse(JSON.stringify(v)); }

  function criar(deps) {
    if (!deps || typeof deps.estado !== "function") throw new Error("SF.sincronia.criar exige deps.estado (função que devolve o estado atual)");
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

    var ref = null;            // cópia do último estado conhecido (depois de aplicar o remoto)
    var emAndamento = null;
    var ultimoProblema = null; // "offline" | "erro" | "conflito"
    var erroBranda = false;    // falha que não para a rodada, mas deixa o status em "erro"
    var avisosMem = [];        // avisos que não couberam no armazenamento
    var falhas = 0;
    var ultimoStatus = null;

    // Várias abas dividem o mesmo armazenamento: toda leitura-modificação-escrita relê antes.
    function lerFila() { return local.ler(userId, "fila", []); }
    function lerPend() { return local.ler(userId, "fotos-pendentes", []); }
    function lerEnv() { return local.ler(userId, "fotos-enviadas", []); }
    function lerRejeitados() { return local.ler(userId, "rejeitados", []); }
    function lerAvisos() { return local.ler(userId, "avisos", []); }

    function iso() { var a = agora(); return typeof a === "string" ? a : new Date(a).toISOString(); }

    function pendentes() { return lerFila().length + lerPend().length; }
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

    function falhaArmazenamento(nome) {
      erroBranda = true;
      ultimoProblema = "erro";
      if (!avisosMem.some(function (a) { return a.nome === nome; })) avisosMem.push({ codigo: "armazenamento", nome: nome });
    }
    function salvar(nome, valor) {
      var ok = local.gravar(userId, nome, valor) !== false;
      if (!ok) falhaArmazenamento(nome);
      return ok;
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
      var f = lerFila().filter(function (x) { return !enviados.some(function (e) { return igual(x, e); }); });
      salvar("fila", f);
    }
    function rejeitar(m, codigo) {
      var lista = lerRejeitados();
      var ja = lista.some(function (r) { return r.tipo === m.tipo && r.chave === m.chave; });
      if (!ja) { lista.push({ tipo: m.tipo, chave: m.chave, codigo: codigo }); salvar("rejeitados", lista); }
      removerDaFila([m]);
    }

    function registrar(antes, depois) {
      var base = ref || antes;
      var mudancas = dados.diferencas(base, depois, iso());
      if (!mudancas.length) { ref = copia(depois); notificar(); return; }
      var f = lerFila(), pf = lerPend(), env = lerEnv();
      mudancas.forEach(function (m) {
        f = f.filter(function (x) { return !(x.tipo === m.tipo && x.chave === m.chave); });
        f.push(m);
        var foto = idFoto(m);
        if (foto && env.indexOf(foto) < 0 && pf.indexOf(foto) < 0) pf.push(foto);
      });
      var ok = salvar("fila", f);
      ok = salvar("fotos-pendentes", pf) && ok;
      if (ok) ref = copia(depois); // se não coube, a mudança é recalculada no próximo registrar
      notificar();
    }

    // ---- fotos ----
    function tirarFoto(id) {
      salvar("fotos-pendentes", lerPend().filter(function (x) { return x !== id; }));
    }
    function marcarEnviada(id) {
      var env = lerEnv();
      if (env.indexOf(id) < 0) { env.push(id); salvar("fotos-enviadas", env); }
      tirarFoto(id);
    }
    // Permanente: 400 foto-id da API, ou erro 4xx do S3 (codigo "foto-envio"). Outros 4xx/5xx tentam de novo.
    function fotoPermanente(e) {
      if (e.status === 400 && e.codigo === "foto-id") return true;
      return e.codigo === "foto-envio" && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429;
    }
    function enviarFotos() {
      return lerPend().reduce(function (p, id) {
        return p.then(function () {
          if (lerEnv().indexOf(id) >= 0 || (fotos.foiEnviada && fotos.foiEnviada(id))) { marcarEnviada(id); return; }
          return chamar(function () { return fotos.enviar(id); }, timeoutFotoMs, "sem-foto").then(function () {
            marcarEnviada(id);
          }, function (e) {
            if (e && e.message === "sem-foto") {
              var avisos = lerAvisos();
              var f = lerFila().map(function (x) {
                if (idFoto(x) !== id) return x;
                avisos.push({ tipo: x.tipo, chave: x.chave, codigo: "foto-sumida", foto: id });
                return Object.assign({}, x, { valor: Object.assign({}, x.valor, { foto: null }) });
              });
              salvar("fila", f);
              salvar("avisos", avisos);
              tirarFoto(id);
              return;
            }
            if (e.status === 0 || e.status === 401) throw e;
            if (fotoPermanente(e)) {
              lerFila().filter(function (x) { return idFoto(x) === id; }).forEach(function (x) { rejeitar(x, e.codigo || "foto"); });
              tirarFoto(id);
              return;
            }
            erroBranda = true; // mantém a foto pendente e segue com o resto da fila
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
      var pf = lerPend();
      var candidatos = lerFila().filter(function (f) { var id = idFoto(f); return !(id && pf.indexOf(id) >= 0); });
      if (!candidatos.length) return Promise.resolve();
      return enviarLote(candidatos.slice(0, tamanhoLote)).then(enviarFila);
    }

    // ---- download ----
    function aplicarRemotos(itens) {
      var validos = [];
      var fila = lerFila();
      var mexeu = false;
      itens.forEach(function (it) {
        if (!it || typeof it !== "object" || TIPOS.indexOf(it.tipo) < 0) { avisar("Item remoto de tipo desconhecido ignorado:", it && it.tipo); return; }
        if (!dados.chaveValida(it.tipo, it.chave)) { avisar("Item remoto com chave inválida ignorado:", it.tipo); return; }
        if (it.ativo && it.tipo === "registro" && !ehObjeto(it.valor)) { avisar("Registro remoto sem valor ignorado:", it.chave); return; }
        var pend = fila.filter(function (f) { return f.tipo === it.tipo && f.chave === it.chave; })[0];
        if (pend) {
          if (ms(pend.em) > ms(it.em)) return; // a mudança local é mais nova: fica
          fila = fila.filter(function (f) { return f !== pend; });
          mexeu = true;
        }
        validos.push(it);
      });
      if (mexeu) salvar("fila", fila);
      if (!validos.length) return;
      var novo = dados.aplicar(deps.estado(), validos);
      ref = copia(novo);
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
      erroBranda = false;
      var p = Promise.resolve().then(function () {
        return enviarFotos().then(enviarFila).then(baixarTudo);
      }).then(function () {
        if (erroBranda) { falhas++; ultimoProblema = "erro"; } else falhas = 0;
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
      rejeitados: function () { return lerRejeitados(); },
      avisos: function () { return lerAvisos().concat(avisosMem); },
      status: status,
      pendentes: pendentes,
      esperaMs: esperaMs
    };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.sincronia = { criar: criar };
  if (typeof module !== "undefined") module.exports = raiz.SF.sincronia;
})(typeof window !== "undefined" ? window : globalThis);
