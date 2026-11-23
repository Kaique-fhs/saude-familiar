// Mapeamento puro entre o estado do app e os itens da API. Sem acesso a armazenamento nem rede.
(function (raiz) {
  var NOMES = {
    "mp-favs": "favs", "mp-sel": "sel", "mp-checks": "checks", "mp-checks-plano": "checksPlano",
    "mp-quero": "despensa", "mp-diario": "diario", "mp-treinos": "treinos", "mp-registros": "registros",
    "mp-planos": "planos", "mp-metas": "metas"
  };
  var FORMATO_DATA = /^\d{4}-\d{2}-\d{2}\|[a-z0-9_-]{1,60}$/;
  var CHAVE_PLANO = /^(inicio|\d{4}-\d{2}-\d{2})$/;
  var CHAVE_META = /^[a-z0-9_-]{1,60}$/;
  var COM_DATA = { feito: true, treino: true, registro: true };
  // Ids que, como chave de um objeto comum (metas, planos, registros do dia), mexeriam no protótipo.
  var RESERVADOS = ["__proto__", "constructor", "prototype"];
  function nomeReservado(id) { return RESERVADOS.indexOf(id) >= 0; }

  function estadoVazio() {
    return { favs: [], sel: [], checks: {}, checksPlano: {}, despensa: [], diario: {}, treinos: {}, registros: {}, planos: {}, metas: {} };
  }

  function chaveValida(tipo, chave) {
    if (typeof chave !== "string" || chave.length < 1 || chave.length > 200) return false;
    if (COM_DATA[tipo] && (!FORMATO_DATA.test(chave) || nomeReservado(chave.slice(chave.indexOf("|") + 1)))) return false;
    if (tipo === "plano") return CHAVE_PLANO.test(chave) && !nomeReservado(chave);
    if (tipo === "meta") return CHAVE_META.test(chave) && !nomeReservado(chave);
    return true;
  }

  // Restaurar cópia: o id de um dia entra? Com conta vale só o formato da chave (o plano da conta pode ter outros
  // ids, ou ainda nem existir; id sem plano não conta no dia e não faz mal). Sem conta, só os ids do plano (o data.js).
  // ctx: { conta: bool, ids: [ids aceitos sem conta] }.
  function idDaCopia(tipo, dia, id, ctx) {
    if (typeof id !== "string") return false;
    if (ctx && ctx.conta) return chaveValida(tipo, dia + "|" + id);
    return ((ctx && ctx.ids) || []).indexOf(id) >= 0;
  }

  function avisar(tipo, chave) {
    if (typeof console !== "undefined" && console.warn) console.warn("Chave não sincroniza (fica só local):", tipo, String(chave).slice(0, 40));
  }

  // Enumera todos os itens do estado, válidos ou não: [{tipo, chave, valor}]. Fonte única da enumeração.
  function enumerar(estado) {
    var lista = [];
    function por(tipo, chave, valor) { lista.push({ tipo: tipo, chave: chave, valor: valor }); }
    (estado.favs || []).forEach(function (id) { por("fav", id, null); });
    (estado.sel || []).forEach(function (id) { por("sel", id, null); });
    Object.keys(estado.checks || {}).forEach(function (k) { if (estado.checks[k]) por("check", k, null); });
    Object.keys(estado.checksPlano || {}).forEach(function (k) { if (estado.checksPlano[k]) por("checkplano", k, null); });
    (estado.despensa || []).forEach(function (n) { por("quero", n, null); });
    Object.keys(estado.diario || {}).forEach(function (dia) {
      (estado.diario[dia] || []).forEach(function (ref) { por("feito", dia + "|" + ref, null); });
    });
    Object.keys(estado.treinos || {}).forEach(function (dia) {
      (estado.treinos[dia] || []).forEach(function (ex) { por("treino", dia + "|" + ex, null); });
    });
    Object.keys(estado.registros || {}).forEach(function (dia) {
      var d = estado.registros[dia] || {};
      Object.keys(d).forEach(function (ref) { por("registro", dia + "|" + ref, d[ref]); });
    });
    Object.keys(estado.planos || {}).forEach(function (k) { por("plano", k, estado.planos[k]); });
    Object.keys(estado.metas || {}).forEach(function (k) { por("meta", k, estado.metas[k]); });
    return lista;
  }

  function paraItens(estado) {
    var itens = {};
    enumerar(estado).forEach(function (it) {
      if (!chaveValida(it.tipo, it.chave)) { avisar(it.tipo, it.chave); return; }
      itens[it.tipo + "|" + it.chave] = it;
    });
    return itens;
  }

  function diferencas(antes, depois, emISO) {
    var a = paraItens(antes), d = paraItens(depois), saida = [];
    Object.keys(d).forEach(function (k) {
      if (!a[k] || JSON.stringify(a[k].valor) !== JSON.stringify(d[k].valor)) {
        saida.push({ tipo: d[k].tipo, chave: d[k].chave, valor: d[k].valor, ativo: true, em: emISO });
      }
    });
    Object.keys(a).forEach(function (k) {
      if (!d[k]) saida.push({ tipo: a[k].tipo, chave: a[k].chave, valor: null, ativo: false, em: emISO });
    });
    return saida;
  }

  function copiar(estado) {
    var e = estadoVazio();
    ["favs", "sel", "despensa"].forEach(function (c) { e[c] = (estado[c] || []).slice(); });
    ["checks", "checksPlano"].forEach(function (c) { e[c] = Object.assign({}, estado[c]); });
    ["diario", "treinos"].forEach(function (c) {
      Object.keys(estado[c] || {}).forEach(function (dia) { e[c][dia] = estado[c][dia].slice(); });
    });
    Object.keys(estado.registros || {}).forEach(function (dia) { e.registros[dia] = Object.assign({}, estado.registros[dia]); });
    ["planos", "metas"].forEach(function (c) {
      Object.keys(estado[c] || {}).forEach(function (k) { e[c][k] = JSON.parse(JSON.stringify(estado[c][k])); });
    });
    return e;
  }

  function dividir(chave) {
    var i = chave.indexOf("|");
    return [chave.slice(0, i), chave.slice(i + 1)];
  }

  function aplicar(estado, itens) {
    var e = copiar(estado);
    function lista(campo, valor, ativo) {
      var i = e[campo].indexOf(valor);
      if (ativo) { if (i < 0) e[campo].push(valor); } else if (i >= 0) e[campo].splice(i, 1);
    }
    function mapa(campo, chave, ativo) {
      if (ativo) e[campo][chave] = true; else delete e[campo][chave];
    }
    function porDia(campo, chave, ativo) {
      var p = dividir(chave), dia = p[0], ref = p[1];
      var l = e[campo][dia] || [];
      var i = l.indexOf(ref);
      if (ativo) { if (i < 0) l.push(ref); e[campo][dia] = l; }
      else {
        if (i >= 0) l.splice(i, 1);
        if (l.length) e[campo][dia] = l; else delete e[campo][dia];
      }
    }
    (itens || []).forEach(function (it) {
      if (!it || !chaveValida(it.tipo, it.chave)) return;
      var ativo = !!it.ativo;
      switch (it.tipo) {
        case "fav": lista("favs", it.chave, ativo); break;
        case "sel": lista("sel", it.chave, ativo); break;
        case "quero": lista("despensa", it.chave, ativo); break;
        case "check": mapa("checks", it.chave, ativo); break;
        case "checkplano": mapa("checksPlano", it.chave, ativo); break;
        case "feito": porDia("diario", it.chave, ativo); break;
        case "treino": porDia("treinos", it.chave, ativo); break;
        case "plano": case "meta": {
          var campo = it.tipo === "plano" ? "planos" : "metas";
          if (ativo) {
            if (it.valor === null || typeof it.valor !== "object" || Array.isArray(it.valor)) break;
            e[campo][it.chave] = JSON.parse(JSON.stringify(it.valor));
          } else delete e[campo][it.chave];
          break;
        }
        case "registro": {
          var p = dividir(it.chave), dia = p[0], ref = p[1];
          if (ativo) {
            e.registros[dia] = e.registros[dia] || {};
            e.registros[dia][ref] = it.valor;
          } else if (e.registros[dia]) {
            delete e.registros[dia][ref];
            if (!Object.keys(e.registros[dia]).length) delete e.registros[dia];
          }
          break;
        }
      }
    });
    return e;
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.dados = { NOMES: NOMES, chaveValida: chaveValida, nomeReservado: nomeReservado, idDaCopia: idDaCopia, estadoVazio: estadoVazio, enumerar: enumerar, paraItens: paraItens, diferencas: diferencas, aplicar: aplicar };
  if (typeof module !== "undefined") module.exports = raiz.SF.dados;
})(typeof window !== "undefined" ? window : globalThis);
