// Modelo puro do plano alimentar por versões ("vale desde") e das metas de exercício. Sem armazenamento nem rede.
// Datas são "AAAA-MM-DD" e as contas são sempre em UTC. Nenhuma função muda o objeto recebido.
(function (raiz) {
  var DIA_MS = 86400000;

  function paraMs(dia) {
    var p = String(dia).split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function deMs(ms) {
    var d = new Date(ms);
    function dois(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + dois(d.getUTCMonth() + 1) + "-" + dois(d.getUTCDate());
  }

  function ontem(dia) { return deMs(paraMs(dia) - DIA_MS); }
  function diaDaSemana(dia) { return new Date(paraMs(dia)).getUTCDay(); }
  function segundaDaSemana(dia) { return deMs(paraMs(dia) - ((diaDaSemana(dia) + 6) % 7) * DIA_MS); }

  function novoId(prefixo, agoraMs) { return prefixo + "-" + agoraMs.toString(36); }

  function copiar(obj) {
    var r = {};
    Object.keys(obj).forEach(function (k) { r[k] = obj[k]; });
    return r;
  }

  function deDataJs(PLANO) {
    if (!PLANO) return { planos: {}, metas: {} };
    var plano = {
      refeicoes: (PLANO.refeicoes || []).map(function (r) {
        return { id: r.id, nome: r.nome, hora: r.hora, kcal: r.kcal, itens: r.itens, observacoes: r.observacoes, receitas: r.receitas || [] };
      }),
      nutrientes: PLANO.nutrientes || null,
      compras: PLANO.compras || [],
      prescritoEm: PLANO.prescritoEm || null
    };
    var metas = {};
    (PLANO.exercicios || []).forEach(function (e) {
      metas[e.id] = { id: e.id, origem: e.id, nome: e.nome, modo: "dias", dias: e.dias, vezes: null, minutos: null, desde: e.desde, ate: e.ate || null };
    });
    return { planos: { inicio: plano }, metas: metas };
  }

  function planoNoDia(planos, dia) {
    var melhor = null;
    Object.keys(planos || {}).forEach(function (k) {
      if (k !== "inicio" && k > dia) return;
      if (melhor === null || (melhor === "inicio" ? true : (k !== "inicio" && k > melhor))) melhor = k;
    });
    if (melhor === null) return null;
    var p = planos[melhor];
    return p && p.refeicoes && p.refeicoes.length ? p : null;
  }

  function idsDeRefeicao(planos) {
    var vistos = {}, ids = [];
    Object.keys(planos || {}).forEach(function (k) {
      ((planos[k] || {}).refeicoes || []).forEach(function (r) {
        if (!vistos[r.id]) { vistos[r.id] = true; ids.push(r.id); }
      });
    });
    return ids;
  }

  function idsDeMeta(metas) {
    return Object.keys(metas || {}).map(function (k) { return metas[k].id; });
  }

  function salvarPlano(planos, plano, hoje) {
    var r = copiar(planos || {});
    r[hoje] = plano;
    return r;
  }

  function metasNoDia(metas, dia) {
    return Object.keys(metas || {}).map(function (k) { return metas[k]; }).filter(function (m) {
      return m.desde <= dia && (m.ate == null || dia <= m.ate);
    });
  }

  function metasFixasDoDia(metas, dia) {
    var dow = diaDaSemana(dia);
    return metasNoDia(metas, dia).filter(function (m) {
      return m.modo === "dias" && (m.dias || []).indexOf(dow) !== -1;
    });
  }

  function salvarMeta(metas, meta, hoje, agoraMs) {
    var r = copiar(metas || {});
    var nova = copiar(meta);
    if (!meta.id) {
      nova.id = novoId("m", agoraMs);
      nova.origem = nova.id;
      nova.desde = hoje;
      r[nova.id] = nova;
      return r;
    }
    var antiga = r[meta.id];
    if (!antiga || antiga.desde === hoje || antiga.desde > hoje) {
      nova.desde = hoje;
      r[meta.id] = nova;
      return r;
    }
    var encerrada = copiar(antiga);
    encerrada.ate = ontem(hoje);
    r[meta.id] = encerrada;
    nova.id = novoId("m", agoraMs);
    nova.origem = antiga.origem || antiga.id;
    nova.desde = hoje;
    nova.ate = meta.ate == null ? null : meta.ate;
    r[nova.id] = nova;
    return r;
  }

  function encerrarMeta(metas, id, hoje) {
    var r = copiar(metas || {});
    var m = r[id];
    if (!m) return r;
    if (m.desde === hoje) { delete r[id]; return r; }
    var c = copiar(m);
    c.ate = ontem(hoje);
    r[id] = c;
    return r;
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.plano = {
    novoId: novoId, ontem: ontem, diaDaSemana: diaDaSemana, segundaDaSemana: segundaDaSemana,
    deDataJs: deDataJs, planoNoDia: planoNoDia, idsDeRefeicao: idsDeRefeicao, idsDeMeta: idsDeMeta,
    salvarPlano: salvarPlano, metasNoDia: metasNoDia, metasFixasDoDia: metasFixasDoDia,
    salvarMeta: salvarMeta, encerrarMeta: encerrarMeta
  };
  if (typeof module !== "undefined") module.exports = raiz.SF.plano;
})(typeof window !== "undefined" ? window : globalThis);
