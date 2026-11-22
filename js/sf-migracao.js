// Migração dos dados do app antigo: ler, juntar com a conta, decidir a oferta e conferir. Puro: sem armazenamento nem rede.
// Nenhuma função muda o que recebe.
(function (raiz) {
  function dadosModulo() {
    if (raiz.SF && raiz.SF.dados) return raiz.SF.dados;
    return require("./sf-dados.js");
  }
  function planoModulo() {
    if (raiz.SF && raiz.SF.plano) return raiz.SF.plano;
    return require("./sf-plano.js");
  }

  function ehObjeto(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

  function lerJson(lerChave, nome) {
    var cru;
    try { cru = lerChave(nome); } catch (e) { return null; }
    if (cru === null || cru === undefined) return null;
    if (typeof cru !== "string") return cru;
    try { return JSON.parse(cru); } catch (e) { return null; }
  }

  // chaves que paraItens montaria, sem avisar: [tipo, chave]
  function chavesDe(estado) {
    var r = [];
    (estado.favs || []).forEach(function (id) { r.push(["fav", id]); });
    (estado.sel || []).forEach(function (id) { r.push(["sel", id]); });
    Object.keys(estado.checks || {}).forEach(function (k) { if (estado.checks[k]) r.push(["check", k]); });
    Object.keys(estado.checksPlano || {}).forEach(function (k) { if (estado.checksPlano[k]) r.push(["checkplano", k]); });
    (estado.despensa || []).forEach(function (n) { r.push(["quero", n]); });
    Object.keys(estado.diario || {}).forEach(function (dia) {
      (estado.diario[dia] || []).forEach(function (ref) { r.push(["feito", dia + "|" + ref]); });
    });
    Object.keys(estado.treinos || {}).forEach(function (dia) {
      (estado.treinos[dia] || []).forEach(function (ex) { r.push(["treino", dia + "|" + ex]); });
    });
    Object.keys(estado.registros || {}).forEach(function (dia) {
      Object.keys(estado.registros[dia] || {}).forEach(function (ref) { r.push(["registro", dia + "|" + ref]); });
    });
    return r;
  }

  function lerAntigos(lerChave) {
    var D = dadosModulo();
    var estado = D.estadoVazio();
    Object.keys(D.NOMES).forEach(function (nome) {
      var campo = D.NOMES[nome];
      if (!(campo in estado)) return;
      var v = lerJson(lerChave, nome);
      if (Array.isArray(estado[campo])) {
        if (Array.isArray(v)) estado[campo] = v.filter(function (x) { return typeof x === "string"; });
      } else if (ehObjeto(v)) {
        estado[campo] = v;
      }
    });
    ["diario", "treinos"].forEach(function (c) {
      Object.keys(estado[c]).forEach(function (dia) {
        if (!Array.isArray(estado[c][dia])) delete estado[c][dia];
      });
    });
    Object.keys(estado.registros).forEach(function (dia) {
      if (!ehObjeto(estado.registros[dia])) delete estado.registros[dia];
    });
    var vistas = {}, puladas = 0;
    chavesDe(estado).forEach(function (p) {
      var id = p[0] + "|" + p[1];
      if (vistas[id]) return;
      vistas[id] = true;
      if (!D.chaveValida(p[0], p[1])) puladas++;
    });
    return { estado: estado, puladas: puladas };
  }

  function uniao(a, b) {
    var r = (a || []).slice();
    (b || []).forEach(function (x) { if (r.indexOf(x) < 0) r.push(x); });
    return r;
  }

  function uniaoPorDia(a, b) {
    var r = {};
    Object.keys(a || {}).forEach(function (d) { r[d] = (a[d] || []).slice(); });
    Object.keys(b || {}).forEach(function (d) { r[d] = uniao(r[d], b[d]); });
    return r;
  }

  function marcas(a, b) {
    var r = {};
    [a, b].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) { if (m[k] === true) r[k] = true; });
    });
    Object.keys(a || {}).forEach(function (k) { if (!(k in r)) r[k] = a[k]; });
    return r;
  }

  function copiaProfunda(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function juntar(conta, antigo, PLANO) {
    var D = dadosModulo(), P = planoModulo();
    var r = D.estadoVazio();
    r.favs = uniao(conta.favs, antigo.favs);
    r.sel = uniao(conta.sel, antigo.sel);
    r.despensa = uniao(conta.despensa, antigo.despensa);
    r.checks = marcas(conta.checks, antigo.checks);
    r.checksPlano = marcas(conta.checksPlano, antigo.checksPlano);
    r.diario = uniaoPorDia(conta.diario, antigo.diario);
    r.treinos = uniaoPorDia(conta.treinos, antigo.treinos);
    var regs = {};
    Object.keys(conta.registros || {}).forEach(function (d) { regs[d] = Object.assign({}, conta.registros[d]); });
    Object.keys(antigo.registros || {}).forEach(function (d) {
      regs[d] = regs[d] || {};
      Object.keys(antigo.registros[d] || {}).forEach(function (ref) {
        if (!(ref in regs[d])) regs[d][ref] = antigo.registros[d][ref];
      });
    });
    r.registros = regs;
    var planos = conta.planos || {}, metas = conta.metas || {};
    if (!Object.keys(planos).length && !Object.keys(metas).length) {
      var dj = P.deDataJs(PLANO);
      planos = dj.planos; metas = dj.metas;
    }
    r.planos = copiaProfunda(planos);
    r.metas = copiaProfunda(metas);
    return r;
  }

  function fotosDe(estado) {
    var vistas = {}, r = [];
    Object.keys(estado.registros || {}).forEach(function (dia) {
      var d = estado.registros[dia] || {};
      Object.keys(d).forEach(function (ref) {
        var f = d[ref] && d[ref].foto;
        if (typeof f === "string" && f && !vistas[f]) { vistas[f] = true; r.push(f); }
      });
    });
    return r;
  }

  function podeOferecer(marcador, userId, temDadosAntigos) {
    if (!temDadosAntigos) return false;
    if (!marcador) return true;
    return marcador.dono === userId && marcador.estado !== "concluida";
  }

  function conferir(p) {
    function nao(motivo) { return { pronto: false, motivo: motivo }; }
    if (p.puladas !== 0) return nao("puladas");
    if ((p.rejeitados || []).length !== 0) return nao("rejeitados");
    if (p.houveConflito) return nao("conflito");
    if (p.status !== "ok" || p.pendentes !== 0) return nao("enviando");
    var D = dadosModulo();
    var daConta = D.paraItens(p.conta);
    var faltou = Object.keys(D.paraItens(p.antigo)).some(function (k) { return !daConta[k]; });
    if (faltou) return nao("faltando");
    return { pronto: true, motivo: null };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.migracao = { lerAntigos: lerAntigos, juntar: juntar, fotosDe: fotosDe, podeOferecer: podeOferecer, conferir: conferir };
  if (typeof module !== "undefined") module.exports = raiz.SF.migracao;
})(typeof window !== "undefined" ? window : globalThis);
