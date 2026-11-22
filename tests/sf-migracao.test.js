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
