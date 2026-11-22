const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.window = globalThis.window || {};
require("../data.js");
const P = require("../js/sf-plano.js");
const PLANO = window.PLANO;

function plano(ids) {
  return { refeicoes: ids.map((id) => ({ id, nome: id, hora: null, kcal: null, itens: [], observacoes: [], receitas: [] })), nutrientes: null, compras: [], prescritoEm: null };
}

test("deDataJs mantém ids e passado", () => {
  const r = P.deDataJs(PLANO);
  assert.deepEqual(r.planos.inicio.refeicoes.map((x) => x.id), ["acordar", "cafe", "almoco", "lanche", "jantar"]);
  assert.deepEqual(r.planos.inicio.refeicoes[0].receitas, []);
  assert.equal(r.planos.inicio.prescritoEm, "17/11/2026");
  assert.ok(r.planos.inicio.compras.length > 0);
  assert.ok(r.planos.inicio.nutrientes.total);
  const pil = r.metas.pilates, aca = r.metas.academia;
  assert.deepEqual(pil, { id: "pilates", origem: "pilates", nome: "Pilates", modo: "dias", dias: [1, 2], vezes: null, minutos: null, desde: "2026-11-01", ate: null });
  assert.deepEqual(aca.dias, [2, 5]);
  assert.equal(aca.desde, "2026-11-01");
  assert.equal(aca.origem, aca.id);
});

test("deDataJs sem PLANO", () => {
  assert.deepEqual(P.deDataJs(undefined), { planos: {}, metas: {} });
});

test("planoNoDia usa a versão que valia no dia", () => {
  const A = plano(["a"]), B = plano(["b"]);
  const p = { inicio: A, "2026-11-22": B };
  assert.equal(P.planoNoDia(p, "2026-11-21"), A);
  assert.equal(P.planoNoDia(p, "2026-11-22"), B);
  assert.equal(P.planoNoDia(p, "2026-12-01"), B);
  assert.equal(P.planoNoDia({ "2026-11-22": B }, "2026-11-21"), null);
  assert.equal(P.planoNoDia({}, "2026-11-21"), null);
  assert.equal(P.planoNoDia({ inicio: A, "2026-11-22": plano([]) }, "2026-11-23"), null);
});

test("salvarPlano não toca nas versões antigas", () => {
  const A = plano(["a"]), B = plano(["b"]);
  const antes = { inicio: A };
  const r = P.salvarPlano(antes, B, "2026-11-22");
  assert.equal(r.inicio, A);
  assert.equal(r["2026-11-22"], B);
  assert.deepEqual(Object.keys(antes), ["inicio"]);
});

test("salvarPlano no mesmo dia sobrescreve", () => {
  const r = P.salvarPlano(P.salvarPlano({}, plano(["a"]), "2026-11-22"), plano(["b"]), "2026-11-22");
  assert.deepEqual(Object.keys(r), ["2026-11-22"]);
  assert.equal(r["2026-11-22"].refeicoes[0].id, "b");
});

test("idsDeRefeicao e idsDeMeta", () => {
  assert.deepEqual(P.idsDeRefeicao({ inicio: plano(["a", "b"]), x: plano(["b", "c"]) }).sort(), ["a", "b", "c"]);
  assert.deepEqual(P.idsDeMeta({ m1: { id: "m1" }, m2: { id: "m2" } }).sort(), ["m1", "m2"]);
});

const meta = (o) => Object.assign({ id: "m-1", origem: "m-1", nome: "X", modo: "dias", dias: [1], vezes: null, minutos: null, desde: "2026-11-01", ate: null }, o);

test("salvarMeta: editar meta antiga encerra ontem e cria outra hoje", () => {
  const m0 = { "m-1": meta({}) };
  const r = P.salvarMeta(m0, meta({ dias: [3] }), "2026-11-22", 1000);
  assert.equal(r["m-1"].ate, "2026-11-21");
  assert.equal(m0["m-1"].ate, null);
  const nova = Object.values(r).find((m) => m.id !== "m-1");
  assert.equal(nova.desde, "2026-11-22");
  assert.equal(nova.ate, null);
  assert.equal(nova.origem, "m-1");
  assert.deepEqual(nova.dias, [3]);
  assert.notEqual(nova.id, "m-1");
  assert.equal(r[nova.id], nova);
});

test("salvarMeta sem id cria", () => {
  const r = P.salvarMeta({}, { nome: "Y", modo: "semana", dias: [], vezes: 3, minutos: 30, ate: null }, "2026-11-22", 36);
  const m = r["m-" + (36).toString(36)];
  assert.equal(m.id, "m-10");
  assert.equal(m.origem, m.id);
  assert.equal(m.desde, "2026-11-22");
});

test("salvarMeta no mesmo dia sobrescreve", () => {
  const r = P.salvarMeta({ "m-1": meta({ desde: "2026-11-22" }) }, meta({ desde: "2026-11-22", dias: [4] }), "2026-11-22", 5);
  assert.deepEqual(Object.keys(r), ["m-1"]);
  assert.deepEqual(r["m-1"].dias, [4]);
});

test("encerrarMeta", () => {
  const m = { "m-1": meta({ desde: "2026-11-22" }), "m-2": meta({ id: "m-2", origem: "m-2" }) };
  const r = P.encerrarMeta(m, "m-1", "2026-11-22");
  assert.equal(r["m-1"], undefined);
  const r2 = P.encerrarMeta(m, "m-2", "2026-11-22");
  assert.equal(r2["m-2"].ate, "2026-11-21");
  assert.equal(m["m-2"].ate, null);
  assert.ok(m["m-1"]);
});

test("metasFixasDoDia ignora modo semana e respeita desde/ate", () => {
  const metas = {
    a: meta({ id: "a", dias: [0] }),
    b: meta({ id: "b", modo: "semana", dias: [], vezes: 3 }),
    c: meta({ id: "c", dias: [0], desde: "2026-11-23" }),
    d: meta({ id: "d", dias: [0], ate: "2026-11-21" }),
    e: meta({ id: "e", dias: [1] })
  };
  assert.deepEqual(P.metasFixasDoDia(metas, "2026-11-22").map((m) => m.id), ["a"]);
  assert.deepEqual(P.metasNoDia(metas, "2026-11-22").map((m) => m.id).sort(), ["a", "b", "e"]);
});

test("datas em UTC", () => {
  assert.equal(P.ontem("2026-12-01"), "2026-11-30");
  assert.equal(P.ontem("2027-01-01"), "2026-12-31");
  assert.equal(P.diaDaSemana("2026-11-22"), 0);
  assert.equal(P.diaDaSemana("2026-11-28"), 6);
  assert.equal(P.segundaDaSemana("2026-11-22"), "2026-11-16");
  assert.equal(P.segundaDaSemana("2026-11-16"), "2026-11-16");
});

test("novoId casa o formato de chave", () => {
  const id = P.novoId("m", 1790000000000);
  assert.match(id, /^[a-z0-9_-]{1,60}$/);
  assert.equal(id, "m-" + (1790000000000).toString(36));
});
