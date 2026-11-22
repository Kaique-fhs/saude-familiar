const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.window = globalThis.window || {};
require("../data.js");
const M = require("../js/sf-migracao.js");
const D = require("../js/sf-dados.js");
const PLANO = window.PLANO;

function conta(extra) { return Object.assign(D.estadoVazio(), { planos: {}, metas: {} }, extra); }
const reg = (foto) => ({ escolhas: {}, receita: null, foto: foto, hora: "12:00" });

test("juntar soma marcações e não troca registro da conta", () => {
  const c = conta({
    favs: ["a", "b"], sel: ["s1"], despensa: ["ovo"],
    checks: { k1: true }, checksPlano: { p1: true },
    diario: { "2026-11-01": ["x"] }, treinos: { "2026-11-01": ["t1"] },
    registros: { "2026-11-01": { cafe: reg("da-conta") } }
  });
  const a = {
    favs: ["b", "c"], sel: ["s1", "s2"], despensa: ["ovo", "leite"],
    checks: { k1: false, k2: true }, checksPlano: { p2: true },
    diario: { "2026-11-01": ["x", "y"], "2026-11-02": ["z"] }, treinos: { "2026-11-02": ["t2"] },
    registros: { "2026-11-01": { cafe: reg("antiga"), almoco: reg("a2") }, "2026-11-02": { jantar: reg("a3") } }
  };
  const r = M.juntar(c, a, undefined);
  assert.deepEqual(r.favs, ["a", "b", "c"]);
  assert.deepEqual(r.sel, ["s1", "s2"]);
  assert.deepEqual(r.despensa, ["ovo", "leite"]);
  assert.deepEqual(r.checks, { k1: true, k2: true });
  assert.deepEqual(r.checksPlano, { p1: true, p2: true });
  assert.deepEqual(r.diario, { "2026-11-01": ["x", "y"], "2026-11-02": ["z"] });
  assert.deepEqual(r.treinos, { "2026-11-01": ["t1"], "2026-11-02": ["t2"] });
  assert.equal(r.registros["2026-11-01"].cafe.foto, "da-conta");
  assert.equal(r.registros["2026-11-01"].almoco.foto, "a2");
  assert.equal(r.registros["2026-11-02"].jantar.foto, "a3");
});

test("juntar traz plano e metas do data.js só se a conta não tiver nenhum dos dois", () => {
  const vazio = M.juntar(conta(), D.estadoVazio(), PLANO);
  assert.deepEqual(vazio.planos.inicio.refeicoes.map((x) => x.id), ["acordar", "cafe", "almoco", "lanche", "jantar"]);
  assert.ok(vazio.metas.pilates && vazio.metas.academia);
  assert.equal(vazio.metas.pilates.desde, "2026-11-01");
  const m = { x: { id: "x", origem: "x", nome: "X", modo: "dias", dias: [1], vezes: null, minutos: null, desde: "2026-11-01", ate: null } };
  const soMetas = M.juntar(conta({ metas: m }), D.estadoVazio(), PLANO);
  assert.deepEqual(soMetas.planos, {});
  assert.deepEqual(soMetas.metas, m);
  const soPlano = M.juntar(conta({ planos: { "2026-11-10": { refeicoes: [] } } }), D.estadoVazio(), PLANO);
  assert.deepEqual(soPlano.metas, {});
  assert.deepEqual(Object.keys(soPlano.planos), ["2026-11-10"]);
});

test("juntar sem PLANO", () => {
  const r = M.juntar(conta(), D.estadoVazio(), undefined);
  assert.deepEqual(r.planos, {});
  assert.deepEqual(r.metas, {});
});

test("juntar é idempotente e não muda o que recebe", () => {
  const c = conta({ favs: ["a"], diario: { "2026-11-01": ["x"] } });
  const a = Object.assign(D.estadoVazio(), { favs: ["a", "b"], diario: { "2026-11-01": ["y"] }, registros: { "2026-11-01": { c: reg("f") } } });
  const cc = JSON.parse(JSON.stringify(c)), aa = JSON.parse(JSON.stringify(a));
  const r1 = M.juntar(c, a, PLANO);
  assert.deepEqual(c, cc);
  assert.deepEqual(a, aa);
  const r2 = M.juntar(r1, a, PLANO);
  assert.deepEqual(r2, r1);
});

test("podeOferecer", () => {
  assert.equal(M.podeOferecer(null, "u1", true), true);
  assert.equal(M.podeOferecer({ dono: "u1", estado: "em_andamento" }, "u1", true), true);
  assert.equal(M.podeOferecer({ dono: "u2", estado: "em_andamento" }, "u1", true), false);
  assert.equal(M.podeOferecer({ dono: "u1", estado: "concluida" }, "u1", true), false);
  assert.equal(M.podeOferecer(null, "u1", false), false);
});

test("fotosDe", () => {
  const e = Object.assign(D.estadoVazio(), {
    registros: { "2026-11-01": { a: reg("f1"), b: reg(null), c: reg("f2") }, "2026-11-02": { d: reg("f1") } }
  });
  assert.deepEqual(M.fotosDe(e).sort(), ["f1", "f2"]);
  assert.deepEqual(M.fotosDe(D.estadoVazio()), []);
});

test("lerAntigos com JSON quebrado vira vazio", () => {
  const dados = { "mp-favs": "{quebrado", "mp-sel": '["s1"]', "mp-checks": "[1,2]", "mp-diario": '{"2026-11-01":["x"]}' };
  const r = M.lerAntigos((n) => (n in dados ? dados[n] : null));
  assert.deepEqual(r.estado.favs, []);
  assert.deepEqual(r.estado.sel, ["s1"]);
  assert.deepEqual(r.estado.checks, {});
  assert.deepEqual(r.estado.diario, { "2026-11-01": ["x"] });
  assert.deepEqual(r.estado.registros, {});
  assert.equal(r.puladas, 2);
  assert.equal(M.conferir({ antigo: r.estado, conta: r.estado, puladas: r.puladas, rejeitados: [], status: "ok", pendentes: 0, houveConflito: false }).motivo, "puladas");
  assert.deepEqual(Object.keys(r.estado).sort(), Object.keys(D.estadoVazio()).sort());
});

test("lerAntigos conta chaves puladas", () => {
  const dados = {
    "mp-favs": '["ok", ""]',
    "mp-diario": '{"2026-11-01":["x"],"dia-ruim":["y"]}',
    "mp-registros": '{"2026-11-01":{"cafe":{"foto":null}},"ruim":{"cafe":{}}}'
  };
  const r = M.lerAntigos((n) => dados[n] || null);
  assert.equal(r.puladas, 3);
});

test("lerAntigos conta tudo que descarta", () => {
  const dados = {
    "mp-favs": '["a", 5, null]',
    "mp-sel": '{"x":1}',
    "mp-diario": '{"2026-11-01":"x","2026-11-02":["ok",7]}',
    "mp-treinos": '{"2026-11-01":{"a":1}}',
    "mp-registros": '{"2026-11-01":["a"]}'
  };
  const r = M.lerAntigos((n) => dados[n] || null);
  assert.deepEqual(r.estado.favs, ["a"]);
  assert.deepEqual(r.estado.diario, { "2026-11-02": ["ok"] });
  // favs 2 + sel 1 + diario 1 dia + 1 item + treinos 1 + registros 1
  assert.equal(r.puladas, 7);
  const r2 = M.lerAntigos((n) => { if (n === "mp-quero") throw new Error("x"); return null; });
  assert.equal(r2.puladas, 1);
});

test("juntar não compartilha registros com as entradas", () => {
  const c = conta({ registros: { "2026-11-01": { a: reg("c") } } });
  const a = Object.assign(D.estadoVazio(), { registros: { "2026-11-02": { b: reg("a") } } });
  const r = M.juntar(c, a, undefined);
  assert.notEqual(r.registros["2026-11-01"].a, c.registros["2026-11-01"].a);
  assert.notEqual(r.registros["2026-11-02"].b, a.registros["2026-11-02"].b);
});

test("conferir", () => {
  const antigo = Object.assign(D.estadoVazio(), { favs: ["a"], registros: { "2026-11-01": { c: reg("f") } } });
  const contaOk = Object.assign(D.estadoVazio(), { favs: ["a", "z"], registros: { "2026-11-01": { c: reg("outra") } } });
  const base = { antigo, conta: contaOk, puladas: 0, rejeitados: [], status: "ok", pendentes: 0, houveConflito: false };
  const com = (x) => M.conferir(Object.assign({}, base, x));
  assert.deepEqual(com({}), { pronto: true, motivo: null });
  assert.equal(com({ puladas: 1 }).motivo, "puladas");
  assert.equal(com({ rejeitados: [{}] }).motivo, "rejeitados");
  assert.equal(com({ houveConflito: true }).motivo, "conflito");
  assert.equal(com({ status: "offline" }).motivo, "enviando");
  assert.equal(com({ pendentes: 2 }).motivo, "enviando");
  const f = com({ conta: D.estadoVazio() });
  assert.equal(f.pronto, false);
  assert.equal(f.motivo, "faltando");
  assert.equal(com({ puladas: 1 }).pronto, false);
  const antD = Object.assign(D.estadoVazio(), { diario: { "2026-11-01": ["x"] }, checks: { k: true } });
  assert.equal(com({ antigo: antD, conta: D.estadoVazio() }).motivo, "faltando");
  assert.equal(com({ antigo: Object.assign(D.estadoVazio(), { diario: { "2026-11-01": ["x"] } }), conta: Object.assign(D.estadoVazio(), { diario: { "2026-11-01": ["x"] } }) }).pronto, true);
  assert.equal(com({ antigo: Object.assign(D.estadoVazio(), { checks: { k: true } }), conta: D.estadoVazio() }).motivo, "faltando");
  assert.equal(com({ rejeitados: undefined }).pronto, false);
  assert.equal(com({ houveConflito: undefined }).pronto, false);
  assert.equal(com({ houveConflito: 0 }).pronto, false);
});

// ---- fotos, execução, retomada e conclusão ----
function fakeStorage(obj) {
  const ks = Object.keys(obj);
  return { length: ks.length, key: (i) => ks[i] };
}
function estadoComFotos() {
  return Object.assign(D.estadoVazio(), {
    diario: { "2026-11-01": ["x"] },
    registros: { "2026-11-01": { cafe: reg("f1"), almoco: reg("f2") } }
  });
}
function depsExec(extra) {
  const gravados = [];
  let marc = null;
  const d = {
    userId: "u1",
    marcador: () => marc,
    gravarMarcador: (m) => { marc = m; gravados.push(m); },
    lerAntigo: () => estadoComFotos(),
    estadoConta: () => conta({}),
    PLANO: PLANO,
    copiarFotos: async (ids) => ({ copiadas: ids.slice(), faltando: [] }),
    gravarEstado: () => true,
    aoProgresso: () => {}
  };
  Object.assign(d, extra || {});
  d.__marc = () => marc;
  d.__gravados = gravados;
  return d;
}

test("copiarFotos pula as que já estão na conta", async () => {
  const gravadas = [];
  const r = await M.copiarFotos(["a", "b"], {
    lerAntiga: async (id) => "dados-" + id,
    existeNaConta: async (id) => id === "a",
    gravarNaConta: async (id, v) => { gravadas.push([id, v]); },
    aoProgresso: () => {}
  });
  assert.deepEqual(gravadas, [["b", "dados-b"]]);
  assert.deepEqual(r.copiadas.slice().sort(), ["a", "b"]);
  assert.deepEqual(r.faltando, []);
});

test("copiarFotos relata as que faltam", async () => {
  const prog = [];
  const r = await M.copiarFotos(["a", "b"], {
    lerAntiga: async (id) => (id === "a" ? null : "x"),
    existeNaConta: async () => false,
    gravarNaConta: async () => {},
    aoProgresso: (f, t) => prog.push([f, t])
  });
  assert.deepEqual(r.faltando, ["a"]);
  assert.deepEqual(r.copiadas, ["b"]);
  assert.deepEqual(prog, [[1, 2], [2, 2]]);
});

test("copiarFotos rejeita se gravar falhar", async () => {
  await assert.rejects(M.copiarFotos(["a"], {
    lerAntiga: async () => "x",
    existeNaConta: async () => false,
    gravarNaConta: async () => { throw new Error("cheio"); },
    aoProgresso: () => {}
  }), /cheio/);
});

test("semFotosFaltando zera só a foto que faltou e não muda o original", () => {
  const e = estadoComFotos();
  const r = M.semFotosFaltando(e, ["f1"]);
  assert.equal(r.registros["2026-11-01"].cafe.foto, null);
  assert.equal(r.registros["2026-11-01"].almoco.foto, "f2");
  assert.equal(e.registros["2026-11-01"].cafe.foto, "f1");
});

test("chavesAntigas não pega sf:", () => {
  const ch = M.chavesAntigas(fakeStorage({ "mp-fav": 1, "sf:migracao": 1, "mp-diario": 1, outra: 1 }));
  assert.deepEqual(ch, ["mp-fav", "mp-diario"]);
});

test("executar: interrompido nas fotos, retoma sem juntar de novo", async () => {
  let gravarEstadoChamadas = 0;
  let falha = true;
  const d = depsExec({
    gravarEstado: () => { gravarEstadoChamadas++; return true; },
    copiarFotos: async (ids) => {
      if (falha) throw new Error("caiu");
      return { copiadas: ids.slice(), faltando: [] };
    }
  });
  // primeira: cópia falha antes de juntar
  assert.equal(await M.executar(d), "erro-fotos");
  assert.equal(gravarEstadoChamadas, 0);
  assert.notEqual(d.__marc().estado, "concluida");
  // segunda: copia ok, junta
  falha = false;
  assert.equal(await M.executar(d), "migrando");
  assert.equal(gravarEstadoChamadas, 1);
  assert.equal(d.__marc().juntado, true);
  // terceira (retomada): a pessoa apagou item da conta; não junta de novo
  d.estadoConta = () => conta({});
  assert.equal(await M.executar(d), "migrando");
  assert.equal(gravarEstadoChamadas, 1);
  assert.equal(d.__marc().juntado, true);
  assert.deepEqual(d.__marc().fotos.slice().sort(), ["f1", "f2"]);
});

test("executar: sem espaço volta à oferta", async () => {
  const d = depsExec({ gravarEstado: () => false });
  assert.equal(await M.executar(d), "sem-espaco");
  assert.equal(d.__marc().estado, "oferecida");
  assert.notEqual(d.__marc().juntado, true);
});

test("executar: foto faltando vira foto null", async () => {
  let gravado = null;
  const d = depsExec({
    copiarFotos: async () => ({ copiadas: ["f2"], faltando: ["f1"] }),
    gravarEstado: (e) => { gravado = e; return true; }
  });
  assert.equal(await M.executar(d), "migrando");
  assert.equal(gravado.registros["2026-11-01"].cafe.foto, null);
  assert.equal(gravado.registros["2026-11-01"].almoco.foto, "f2");
  assert.deepEqual(d.__marc().faltando, ["f1"]);
  assert.equal(d.__marc().juntado, true);
});

function depsConcluir(extra) {
  const log = { copiados: null, apagadas: null, banco: 0, marcadores: [] };
  const ant = Object.assign(D.estadoVazio(), { diario: { "2026-11-01": ["x"] } });
  const d = {
    antigo: ant, conta: Object.assign(D.estadoVazio(), { diario: { "2026-11-01": ["x"] } }),
    puladas: 0, rejeitados: [], status: "ok", pendentes: 0, houveConflito: false,
    storage: fakeStorage({ "mp-fav": 1, "mp-ultimo-backup": 1, "sf:migracao": 1 }),
    copiarParaConta: async (n) => { log.copiados = n; },
    apagarChaves: async (c) => { log.apagadas = c; },
    apagarBancoAntigo: async () => { log.banco++; return {}; },
    gravarMarcador: (m) => log.marcadores.push(m)
  };
  Object.assign(d, extra || {});
  d.__log = log;
  return d;
}

test("concluir só apaga com conferir pronto", async () => {
  const d = depsConcluir({ rejeitados: ["algo"] });
  const r = await M.concluir(d);
  assert.equal(r.pronto, false);
  assert.equal(r.motivo, "rejeitados");
  assert.equal(d.__log.apagadas, null);
  assert.equal(d.__log.banco, 0);
  assert.equal(d.__log.copiados, null);
  assert.equal(d.__log.marcadores.length, 0);
  const d2 = depsConcluir({ houveConflito: undefined });
  assert.equal((await M.concluir(d2)).pronto, false);
  assert.equal(d2.__log.banco, 0);
});

test("concluir: pronto apaga chaves mp-, banco e marca concluída", async () => {
  const d = depsConcluir();
  const r = await M.concluir(d);
  assert.equal(r.pronto, true);
  assert.deepEqual(d.__log.apagadas, ["mp-fav", "mp-ultimo-backup"]);
  assert.equal(d.__log.banco, 1);
  assert.equal(d.__log.marcadores.at(-1).estado, "concluida");
});

test("concluir: banco bloqueado não conclui", async () => {
  const d = depsConcluir({ apagarBancoAntigo: async () => ({ bloqueado: true }) });
  const r = await M.concluir(d);
  assert.equal(r.pronto, true);
  assert.equal(d.__log.marcadores.length, 0);
});

test("concluir copia o histórico de cópias para a conta", async () => {
  const d = depsConcluir();
  await M.concluir(d);
  assert.deepEqual(d.__log.copiados, ["mp-ultimo-backup", "mp-backups-mes", "mp-modo-cal"]);
});

test("concluir: não apaga nada se copiar o histórico falhar", async () => {
  const d = depsConcluir({ copiarParaConta: async () => { throw new Error("x"); } });
  await assert.rejects(M.concluir(d));
  assert.equal(d.__log.apagadas, null);
  assert.equal(d.__log.banco, 0);
});
