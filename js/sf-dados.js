// Mapeamento puro entre o estado do app e os itens da API. Sem acesso a armazenamento nem rede.
(function (raiz) {
  var NOMES = {
    "mp-favs": "favs", "mp-sel": "sel", "mp-checks": "checks", "mp-checks-plano": "checksPlano",
    "mp-quero": "despensa", "mp-diario": "diario", "mp-treinos": "treinos", "mp-registros": "registros"
  };
  var FORMATO_DATA = /^\d{4}-\d{2}-\d{2}\|[a-z0-9_-]{1,60}$/;
  var COM_DATA = { feito: true, treino: true, registro: true };

  function estadoVazio() {
    return { favs: [], sel: [], checks: {}, checksPlano: {}, despensa: [], diario: {}, treinos: {}, registros: {} };
  }

  function chaveValida(tipo, chave) {
    if (typeof chave !== "string" || chave.length < 1 || chave.length > 200) return false;
    if (COM_DATA[tipo] && !FORMATO_DATA.test(chave)) return false;
    return true;
  }

  function avisar(tipo, chave) {
    if (typeof console !== "undefined" && console.warn) console.warn("Chave não sincroniza (fica só local):", tipo, String(chave).slice(0, 40));
  }

  function paraItens(estado) {
    var itens = {};
    function por(tipo, chave, valor) {
      if (!chaveValida(tipo, chave)) { avisar(tipo, chave); return; }
      itens[tipo + "|" + chave] = { tipo: tipo, chave: chave, valor: valor };
    }
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
  raiz.SF.dados = { NOMES: NOMES, estadoVazio: estadoVazio, paraItens: paraItens, diferencas: diferencas, aplicar: aplicar };
  if (typeof module !== "undefined") module.exports = raiz.SF.dados;
})(typeof window !== "undefined" ? window : globalThis);
