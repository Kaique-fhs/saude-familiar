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

  function profundo(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function deDataJs(PLANO) {
    if (!PLANO) return { planos: {}, metas: {} };
    var plano = {
      refeicoes: (PLANO.refeicoes || []).map(function (r) {
        return { id: r.id, nome: r.nome, hora: r.hora, kcal: r.kcal, itens: profundo(r.itens), observacoes: profundo(r.observacoes), receitas: profundo(r.receitas || []) };
      }),
      nutrientes: profundo(PLANO.nutrientes || null),
      compras: profundo(PLANO.compras || []),
      prescritoEm: PLANO.prescritoEm || null
    };
    var metas = {};
    (PLANO.exercicios || []).forEach(function (e) {
      metas[e.id] = { id: e.id, origem: e.id, nome: e.nome, modo: "dias", dias: profundo(e.dias), vezes: null, minutos: null, desde: e.desde, ate: e.ate || null };
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
      if (nova.origem == null) nova.origem = antiga ? (antiga.origem || antiga.id) : meta.id;
      r[meta.id] = nova;
      return r;
    }
    var encerrada = copiar(antiga);
    if (antiga.ate == null || antiga.ate > ontem(hoje)) encerrada.ate = ontem(hoje);
    r[meta.id] = encerrada;
    nova.id = novoId("m", agoraMs);
    nova.origem = antiga.origem || antiga.id;
    nova.desde = hoje;
    nova.ate = meta.ate == null ? (antiga.ate == null ? null : antiga.ate) : meta.ate;
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

  function planoEMetasDoDia(ctx, dia) {
    return { plano: planoNoDia(ctx.planos, dia), fixas: metasFixasDoDia(ctx.metas, dia) };
  }

  function totalDoDia(ctx, dia) {
    var x = planoEMetasDoDia(ctx, dia);
    return (x.plano ? x.plano.refeicoes.length : 0) + x.fixas.length;
  }

  // Origem de uma meta; id desconhecido conta como origem dele mesmo.
  function origemDe(metas, id) {
    var m = (metas || {})[id];
    return m ? (m.origem || m.id) : id;
  }
  // Editar uma meta cria id novo com a mesma origem: o treino marcado vale pela origem.
  function treinoFeito(ctx, dia, metaId) {
    var o = origemDe(ctx.metas, metaId);
    return ((ctx.treinos || {})[dia] || []).some(function (id) { return origemDe(ctx.metas, id) === o; });
  }

  function feitosDoDia(ctx, dia) {
    var x = planoEMetasDoDia(ctx, dia);
    var comidas = {}, n = 0;
    ((ctx.diario || {})[dia] || []).forEach(function (id) { comidas[id] = true; });
    if (x.plano) x.plano.refeicoes.forEach(function (r) { if (comidas[r.id]) n++; });
    x.fixas.forEach(function (m) { if (treinoFeito(ctx, dia, m.id)) n++; });
    return n;
  }

  function diaCompleto(ctx, dia) {
    var t = totalDoDia(ctx, dia);
    return t > 0 && feitosDoDia(ctx, dia) >= t;
  }

  function ativasNoDiaSemana(metas, dia) {
    var dow = diaDaSemana(dia);
    return metasNoDia(metas, dia).filter(function (m) {
      return m.modo === "semana" || (m.modo === "dias" && (m.dias || []).indexOf(dow) !== -1);
    });
  }

  function treinosDoDia(ctx, dia) {
    return ativasNoDiaSemana(ctx.metas, dia).filter(function (m) { return treinoFeito(ctx, dia, m.id); }).map(function (m) { return m.id; });
  }

  function sequencia(ctx, hoje) {
    var d = diaCompleto(ctx, hoje) ? hoje : ontem(hoje);
    var n = 0;
    for (var i = 0; i < 400; i++) {
      if (totalDoDia(ctx, d) > 0) {
        if (!diaCompleto(ctx, d)) break;
        n++;
      }
      d = ontem(d);
    }
    return n;
  }

  function progressoSemanal(ctx, dia) {
    var seg = segundaDaSemana(dia), dias = [], porOrigem = {}, ordem = [];
    for (var i = 0; i < 7; i++) dias.push(deMs(paraMs(seg) + i * DIA_MS));
    dias.forEach(function (d) {
      metasNoDia(ctx.metas, d).forEach(function (m) {
        if (m.modo !== "semana") return;
        var o = m.origem || m.id;
        if (!porOrigem[o]) ordem.push(o);
        if (!porOrigem[o] || m.desde >= porOrigem[o].desde) porOrigem[o] = m;
      });
    });
    return ordem.map(function (o) {
      var meta = porOrigem[o], feitos = 0;
      dias.forEach(function (d) {
        var ids = (ctx.treinos || {})[d] || [];
        var algum = ids.some(function (id) {
          var m = (ctx.metas || {})[id];
          return m && (m.origem || m.id) === o;
        });
        if (algum) feitos++;
      });
      return { meta: meta, feitos: feitos, vezes: meta.vezes, cumprida: feitos >= meta.vezes };
    });
  }

  function semanaCumprida(ctx, dia) {
    var p = progressoSemanal(ctx, dia);
    if (!p.length) return null;
    return p.every(function (x) { return x.cumprida; });
  }

  function situacoes(plano, feitosHoje, horaAtual) {
    var out = {};
    if (!plano || !plano.refeicoes) return out;
    var refs = plano.refeicoes, feitos = {};
    (feitosHoje || []).forEach(function (id) { feitos[id] = true; });
    var atual = -1, i;
    refs.forEach(function (r, k) {
      if (!feitos[r.id] && r.hora && r.hora <= horaAtual && (atual === -1 || r.hora >= refs[atual].hora)) atual = k;
    });
    if (atual === -1) {
      for (i = 0; i < refs.length; i++) {
        if (!feitos[refs[i].id] && (!refs[i].hora || refs[i].hora > horaAtual)) { atual = i; break; }
      }
    }
    var proximaDada = false;
    refs.forEach(function (r, k) {
      if (feitos[r.id]) out[r.id] = "feita";
      else if (k === atual) out[r.id] = "agora";
      else if (r.hora && r.hora <= horaAtual) out[r.id] = "atrasada";
      else if (atual === -1 || k < atual) out[r.id] = "pendente";
      else if (!proximaDada) { out[r.id] = "proxima"; proximaDada = true; }
      else out[r.id] = "depois";
    });
    return out;
  }

  function refeicaoAtual(plano, feitosHoje, horaAtual) {
    var s = situacoes(plano, feitosHoje, horaAtual);
    var achada = null;
    ((plano && plano.refeicoes) || []).forEach(function (r) { if (s[r.id] === "agora") achada = r; });
    return achada;
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.plano = {
    novoId: novoId, ontem: ontem, diaDaSemana: diaDaSemana, segundaDaSemana: segundaDaSemana,
    deDataJs: deDataJs, planoNoDia: planoNoDia, idsDeRefeicao: idsDeRefeicao, idsDeMeta: idsDeMeta,
    salvarPlano: salvarPlano, metasNoDia: metasNoDia, metasFixasDoDia: metasFixasDoDia,
    salvarMeta: salvarMeta, encerrarMeta: encerrarMeta,
    totalDoDia: totalDoDia, feitosDoDia: feitosDoDia, diaCompleto: diaCompleto, treinosDoDia: treinosDoDia, treinoFeito: treinoFeito, origemDe: origemDe,
    sequencia: sequencia, progressoSemanal: progressoSemanal, semanaCumprida: semanaCumprida,
    situacoes: situacoes, refeicaoAtual: refeicaoAtual
  };
  if (typeof module !== "undefined") module.exports = raiz.SF.plano;
})(typeof window !== "undefined" ? window : globalThis);
