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

  // Devolve {ok, valor}: ok=false se o JSON não pôde ser lido; chave ausente conta como ok com valor null.
  function lerJson(lerChave, nome) {
    var cru;
    try { cru = lerChave(nome); } catch (e) { return { ok: false }; }
    if (cru === null || cru === undefined) return { ok: true, valor: null };
    if (typeof cru !== "string") return { ok: true, valor: cru };
    try { return { ok: true, valor: JSON.parse(cru) }; } catch (e) { return { ok: false }; }
  }

  function ehString(x) { return typeof x === "string"; }

  // Dado antigo que não dá para ler não some em silêncio: cada descarte conta em `puladas`.
  function lerAntigos(lerChave) {
    var D = dadosModulo();
    var estado = D.estadoVazio();
    var puladas = 0;
    Object.keys(D.NOMES).forEach(function (nome) {
      var campo = D.NOMES[nome];
      if (!(campo in estado)) return;
      var l = lerJson(lerChave, nome);
      if (!l.ok) { puladas++; return; }
      var v = l.valor;
      if (v === null) return;
      if (Array.isArray(estado[campo])) {
        if (!Array.isArray(v)) { puladas++; return; }
        estado[campo] = v.filter(function (x) { if (ehString(x)) return true; puladas++; return false; });
      } else if (ehObjeto(v)) {
        estado[campo] = v;
      } else {
        puladas++;
      }
    });
    ["diario", "treinos"].forEach(function (c) {
      Object.keys(estado[c]).forEach(function (dia) {
        var l = estado[c][dia];
        if (!Array.isArray(l)) { puladas++; delete estado[c][dia]; return; }
        estado[c][dia] = l.filter(function (x) { if (ehString(x)) return true; puladas++; return false; });
      });
    });
    Object.keys(estado.registros).forEach(function (dia) {
      if (!ehObjeto(estado.registros[dia])) { puladas++; delete estado.registros[dia]; }
    });
    var vistas = {};
    D.enumerar(estado).forEach(function (it) {
      var id = it.tipo + "|" + it.chave;
      if (vistas[id]) return;
      vistas[id] = true;
      if (!D.chaveValida(it.tipo, it.chave)) puladas++;
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
    Object.keys(conta.registros || {}).forEach(function (d) { regs[d] = copiaProfunda(conta.registros[d]); });
    Object.keys(antigo.registros || {}).forEach(function (d) {
      regs[d] = regs[d] || {};
      Object.keys(antigo.registros[d] || {}).forEach(function (ref) {
        if (!(ref in regs[d])) regs[d][ref] = copiaProfunda(antigo.registros[d][ref]);
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
    if (!Array.isArray(p.rejeitados) || p.rejeitados.length !== 0) return nao("rejeitados");
    if (p.houveConflito !== false) return nao("conflito");
    if (p.status !== "ok" || p.pendentes !== 0) return nao("enviando");
    var D = dadosModulo();
    var daConta = D.paraItens(p.conta);
    var faltou = Object.keys(D.paraItens(p.antigo)).some(function (k) { return !daConta[k]; });
    if (faltou) return nao("faltando");
    return { pronto: true, motivo: null };
  }

  // Copia as fotos antigas para a conta. Foto já na conta é pulada; foto ilegível (null) vai para `faltando`.
  // Erro ao gravar na conta rejeita: quem chama não apaga nada.
  async function copiarFotos(ids, deps) {
    var copiadas = [], faltando = [], total = ids.length;
    for (var i = 0; i < total; i++) {
      var id = ids[i];
      if (await deps.existeNaConta(id)) {
        copiadas.push(id);
      } else {
        var dado = await deps.lerAntiga(id);
        if (dado === null || dado === undefined) {
          faltando.push(id);
        } else {
          await deps.gravarNaConta(id, dado);
          copiadas.push(id);
        }
      }
      if (deps.aoProgresso) deps.aoProgresso(i + 1, total);
    }
    return { copiadas: copiadas, faltando: faltando };
  }

  function semFotosFaltando(estado, faltando) {
    var r = copiaProfunda(estado);
    Object.keys(r.registros || {}).forEach(function (dia) {
      var d = r.registros[dia] || {};
      Object.keys(d).forEach(function (ref) {
        if (d[ref] && faltando.indexOf(d[ref].foto) >= 0) d[ref].foto = null;
      });
    });
    return r;
  }

  function chavesAntigas(storage) {
    var r = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (typeof k === "string" && k.indexOf("mp-") === 0) r.push(k);
    }
    return r;
  }

  function marcadorCom(base, userId, mudanca) {
    var m = { dono: userId, estado: "migrando", juntado: false, fotos: [], faltando: [], em: Date.now() };
    [base || {}, mudanca].forEach(function (o) {
      Object.keys(o).forEach(function (k) { m[k] = o[k]; });
    });
    m.em = Date.now();
    return m;
  }

  // Marca `migrando`, copia as fotos e (só na primeira vez) junta e grava. Com `juntado: true` só refaz as fotos,
  // para o que a pessoa apagou depois da junção não voltar.
  async function executar(deps) {
    var atual = await deps.marcador();
    var jaJuntou = !!(atual && atual.juntado === true);
    await deps.gravarMarcador(marcadorCom(atual, deps.userId, { estado: "migrando", juntado: jaJuntou }));
    var antigo = await deps.lerAntigo();
    var ids = fotosDe(antigo);
    var res;
    try {
      res = await deps.copiarFotos(ids, deps.aoProgresso);
    } catch (e) {
      if (deps.aoErro) deps.aoErro(e);
      return "erro-fotos";
    }
    if (!jaJuntou) {
      var conta = await deps.estadoConta();
      var final = semFotosFaltando(juntar(conta, antigo, deps.PLANO), res.faltando);
      var gravou = await deps.gravarEstado(final);
      if (gravou === false) {
        await deps.gravarMarcador(marcadorCom(atual, deps.userId, { estado: "oferecida", juntado: false }));
        return "sem-espaco";
      }
    }
    await deps.gravarMarcador(marcadorCom(atual, deps.userId, { estado: "migrando", juntado: true, fotos: res.copiadas, faltando: res.faltando }));
    return "migrando";
  }

  var HISTORICO = ["mp-ultimo-backup", "mp-backups-mes", "mp-modo-cal"];

  // Só apaga o que é antigo se conferir(...).pronto; banco antigo bloqueado (outra aba) não marca concluída.
  async function concluir(deps) {
    var c = conferir(deps);
    if (c.pronto !== true) return c;
    var base = deps.marcador ? await deps.marcador() : null;
    if (!base || base.juntado !== true || base.estado !== "migrando") return { pronto: false, motivo: "nao-juntado" };
    await deps.copiarParaConta(HISTORICO);
    // O banco antigo vai primeiro: se estiver bloqueado (outra aba), nada antigo é apagado e a conferência segue valendo.
    var b = await deps.apagarBancoAntigo();
    if (b && b.bloqueado) return { pronto: false, motivo: "bloqueado" };
    await deps.apagarChaves(chavesAntigas(deps.storage));
    await deps.gravarMarcador(marcadorCom(base, deps.userId, { estado: "concluida" }));
    return { pronto: true, motivo: null };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.migracao = { lerAntigos: lerAntigos, juntar: juntar, fotosDe: fotosDe, podeOferecer: podeOferecer, conferir: conferir,
    copiarFotos: copiarFotos, semFotosFaltando: semFotosFaltando, chavesAntigas: chavesAntigas, executar: executar, concluir: concluir };
  if (typeof module !== "undefined") module.exports = raiz.SF.migracao;
})(typeof window !== "undefined" ? window : globalThis);
