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

// ---- Correções da Task 4 ----
test("salvarMeta com id inexistente sobrescreve com desde = hoje", () => {
  const r = P.salvarMeta({}, meta({ id: "m-9", origem: "m-9", desde: "2026-01-01" }), "2026-11-22", 5);
  assert.deepEqual(Object.keys(r), ["m-9"]);
  assert.equal(r["m-9"].desde, "2026-11-22");
});

test("salvarMeta com desde no futuro sobrescreve com desde = hoje", () => {
  const r = P.salvarMeta({ "m-1": meta({ desde: "2026-12-01" }) }, meta({ desde: "2026-12-01", dias: [4] }), "2026-11-22", 5);
  assert.deepEqual(Object.keys(r), ["m-1"]);
  assert.equal(r["m-1"].desde, "2026-11-22");
  assert.deepEqual(r["m-1"].dias, [4]);
});

test("salvarMeta na sobrescrita nunca deixa origem undefined", () => {
  const m = meta({ desde: "2026-11-22" });
  delete m.origem;
  const r = P.salvarMeta({ "m-1": m }, { id: "m-1", nome: "Z", modo: "dias", dias: [2] }, "2026-11-22", 5);
  assert.equal(r["m-1"].origem, "m-1");
  const r2 = P.salvarMeta({ "m-1": meta({ id: "m-1", origem: "o-1", desde: "2026-11-22" }) }, { id: "m-1", nome: "Z", modo: "dias", dias: [2] }, "2026-11-22", 5);
  assert.equal(r2["m-1"].origem, "o-1");
  const r3 = P.salvarMeta({}, { id: "m-7", nome: "Z", modo: "dias", dias: [2] }, "2026-11-22", 5);
  assert.equal(r3["m-7"].origem, "m-7");
});

test("editar meta já encerrada não reabre a cadeia", () => {
  const m0 = { "m-1": meta({ ate: "2026-11-10" }) };
  const r = P.salvarMeta(m0, meta({ dias: [3], ate: undefined }), "2026-11-22", 1000);
  const nova = Object.values(r).find((m) => m.id !== "m-1");
  assert.equal(nova.ate, "2026-11-10");
  assert.equal(r["m-1"].ate, "2026-11-10");
  const r2 = P.salvarMeta(m0, meta({ dias: [3], ate: "2026-12-31" }), "2026-11-22", 1000);
  assert.equal(Object.values(r2).find((m) => m.id !== "m-1").ate, "2026-12-31");
});

test("deDataJs copia em profundidade", () => {
  const antes = JSON.stringify(PLANO);
  const r = P.deDataJs(PLANO);
  const p = r.planos.inicio;
  p.refeicoes[0].itens.push("x");
  p.refeicoes[0].observacoes.push("x");
  p.refeicoes[0].receitas.push("x");
  p.compras.push("x");
  if (Array.isArray(p.compras[0])) p.compras[0].push("x");
  else if (p.compras[0] && typeof p.compras[0] === "object") p.compras[0].zz = 1;
  p.nutrientes.total = "x";
  p.nutrientes.zz = 1;
  p.refeicoes[1].itens[0] = "y";
  r.metas.pilates.dias.push(6);
  assert.equal(JSON.stringify(PLANO), antes);
});

// ---- Task 5 ----
const rejane = () => P.deDataJs(PLANO);
const ctxR = (extra) => Object.assign({ planos: rejane().planos, metas: rejane().metas, diario: {}, treinos: {} }, extra);
const todasRefeicoes = ["acordar", "cafe", "almoco", "lanche", "jantar"];

test("dia cumprido com plano e metas fixas", () => {
  const dia = "2026-11-24";
  const ctx = ctxR({ diario: { [dia]: todasRefeicoes.slice() }, treinos: { [dia]: ["pilates"] } });
  assert.equal(P.totalDoDia(ctx, dia), 7);
  assert.equal(P.feitosDoDia(ctx, dia), 6);
  assert.equal(P.diaCompleto(ctx, dia), false);
  ctx.treinos[dia].push("academia", "inexistente");
  ctx.diario[dia].push("fantasma");
  assert.equal(P.feitosDoDia(ctx, dia), 7);
  assert.equal(P.diaCompleto(ctx, dia), true);
});

test("sem plano conta só metas fixas", () => {
  const ctx = { planos: {}, metas: rejane().metas, diario: { "2026-11-24": ["acordar"] }, treinos: { "2026-11-24": ["pilates", "academia"] } };
  assert.equal(P.totalDoDia(ctx, "2026-11-24"), 2);
  assert.equal(P.feitosDoDia(ctx, "2026-11-24"), 2);
  assert.equal(P.diaCompleto(ctx, "2026-11-24"), true);
  assert.equal(P.totalDoDia(ctx, "2026-11-26"), 0);
  assert.equal(P.diaCompleto(ctx, "2026-11-26"), false);
});

test("dia sem nada programado não quebra nem soma a sequência", () => {
  const ctx = { planos: {}, metas: { "m-1": meta({ dias: [1, 3] }) }, diario: {}, treinos: { "2026-11-23": ["m-1"], "2026-11-25": ["m-1"] } };
  assert.equal(P.sequencia(ctx, "2026-11-26"), 2);
  assert.equal(P.sequencia(ctx, "2026-11-25"), 2);
  assert.equal(P.sequencia({ planos: {}, metas: {}, diario: {}, treinos: {} }, "2026-11-26"), 0);
});

test("sequencia para no primeiro dia incompleto e tem teto de 400 dias", () => {
  const ctx = { planos: { inicio: plano(["a"]) }, metas: {}, diario: { "2026-11-22": ["a"], "2026-11-20": ["a"] }, treinos: {} };
  assert.equal(P.sequencia(ctx, "2026-11-22"), 1);
  const diario = {};
  for (let i = 0; i < 500; i++) diario[new Date(Date.UTC(2026, 10, 22) - i * 86400000).toISOString().slice(0, 10)] = ["a"];
  assert.equal(P.sequencia({ planos: { inicio: plano(["a"]) }, metas: {}, diario, treinos: {} }, "2026-11-22"), 400);
});

test("editar o plano hoje não muda ontem", () => {
  const planos = { inicio: plano(["a", "b"]) };
  const diario = { "2026-11-21": ["a", "b"] };
  assert.equal(P.diaCompleto({ planos, metas: {}, diario, treinos: {} }, "2026-11-21"), true);
  const novos = P.salvarPlano(planos, plano(["a", "b", "c"]), "2026-11-22");
  const ctx = { planos: novos, metas: {}, diario, treinos: {} };
  assert.equal(P.diaCompleto(ctx, "2026-11-21"), true);
  assert.equal(P.totalDoDia(ctx, "2026-11-22"), 3);
});

test("treinosDoDia inclui meta semanal", () => {
  const metas = { "m-1": meta({ dias: [1] }), "m-2": meta({ id: "m-2", origem: "m-2", modo: "semana", dias: [], vezes: 3 }), "m-3": meta({ id: "m-3", origem: "m-3", dias: [5] }) };
  const ctx = { planos: {}, metas, diario: {}, treinos: { "2026-11-23": ["m-1", "m-2", "m-3", "zz"] } };
  assert.deepEqual(P.treinosDoDia(ctx, "2026-11-23").sort(), ["m-1", "m-2"]);
  assert.deepEqual(P.treinosDoDia(ctx, "2026-11-24"), []);
});

const semanal = (o) => meta(Object.assign({ id: "s-1", origem: "s-1", modo: "semana", dias: [], vezes: 3 }, o));

test("progresso semanal de segunda a domingo", () => {
  const metas = { "s-1": semanal({}) };
  const ctx = { planos: {}, metas, diario: {}, treinos: { "2026-11-22": ["s-1"], "2026-11-23": ["s-1"], "2026-11-25": ["s-1"] } };
  let p = P.progressoSemanal(ctx, "2026-11-25");
  assert.equal(p.length, 1);
  assert.equal(p[0].feitos, 2);
  assert.equal(p[0].vezes, 3);
  assert.equal(p[0].cumprida, false);
  assert.equal(p[0].meta.id, "s-1");
  assert.equal(P.semanaCumprida(ctx, "2026-11-25"), false);
  ctx.treinos["2026-11-27"] = ["s-1"];
  p = P.progressoSemanal(ctx, "2026-11-25");
  assert.equal(p[0].feitos, 3);
  assert.equal(p[0].cumprida, true);
  assert.equal(P.semanaCumprida(ctx, "2026-11-25"), true);
});

test("progresso semanal soma a meta antes e depois de editada", () => {
  const m0 = { "s-1": semanal({ desde: "2026-11-01" }) };
  const metas = P.salvarMeta(m0, semanal({ vezes: 4 }), "2026-11-25", 1000);
  const nova = Object.values(metas).find((m) => m.id !== "s-1");
  const ctx = { planos: {}, metas, diario: {}, treinos: { "2026-11-23": ["s-1"], "2026-11-25": [nova.id] } };
  const p = P.progressoSemanal(ctx, "2026-11-26");
  assert.equal(p.length, 1);
  assert.equal(p[0].meta.id, nova.id);
  assert.equal(p[0].vezes, 4);
  assert.equal(p[0].feitos, 2);
});

test("semanaCumprida null sem meta semanal", () => {
  const ctx = { planos: {}, metas: { "m-1": meta({}) }, diario: {}, treinos: {} };
  assert.deepEqual(P.progressoSemanal(ctx, "2026-11-25"), []);
  assert.equal(P.semanaCumprida(ctx, "2026-11-25"), null);
});

test("situacoes e refeicaoAtual ao longo do dia", () => {
  const pl = rejane().planos.inicio;
  assert.deepEqual(P.situacoes(pl, [], "09:00"), { acordar: "agora", cafe: "proxima", almoco: "depois", lanche: "depois", jantar: "depois" });
  assert.equal(P.refeicaoAtual(pl, [], "09:00").id, "acordar");
  const s13 = P.situacoes(pl, ["acordar"], "13:00");
  assert.equal(s13.acordar, "feita");
  assert.equal(s13.cafe, "pendente");
  assert.equal(s13.almoco, "agora");
  assert.equal(s13.lanche, "proxima");
  assert.equal(s13.jantar, "depois");
  const s17 = P.situacoes(pl, ["acordar", "cafe"], "17:00");
  assert.equal(s17.almoco, "atrasada");
  assert.equal(s17.lanche, "agora");
  assert.equal(s17.jantar, "proxima");
  assert.equal(P.refeicaoAtual(pl, ["acordar", "cafe"], "17:00").id, "lanche");
  const tudo = P.situacoes(pl, todasRefeicoes, "17:00");
  assert.ok(todasRefeicoes.every((id) => tudo[id] === "feita"));
  assert.equal(P.refeicaoAtual(pl, todasRefeicoes, "17:00"), null);
});

test("sem plano, situacoes vazio e refeicaoAtual null", () => {
  assert.deepEqual(P.situacoes(null, [], "10:00"), {});
  assert.equal(P.refeicaoAtual(null, [], "10:00"), null);
});

// ---- Task 10, correção 1: treino vale pela origem da meta ----
test("treinoFeito casa por origem; id desconhecido vale por ele mesmo", () => {
  const metas = { a: meta({ id: "a", origem: "o1", dias: [2] }), b: meta({ id: "b", origem: "o1", dias: [2] }), c: meta({ id: "c", origem: "o2", dias: [2] }) };
  const ctx = { planos: {}, metas, diario: {}, treinos: { "2026-11-24": ["a", "zz"] } };
  assert.equal(P.treinoFeito(ctx, "2026-11-24", "b"), true);
  assert.equal(P.treinoFeito(ctx, "2026-11-24", "c"), false);
  assert.equal(P.treinoFeito(ctx, "2026-11-24", "zz"), true);
  assert.equal(P.treinoFeito(ctx, "2026-11-24", "yy"), false);
  assert.equal(P.treinoFeito(ctx, "2026-11-25", "a"), false);
});

test("meta fixa marcada hoje e editada hoje: dia continua completo", () => {
  const hoje = "2026-11-24"; // terça
  let metas = { "m-1": meta({ id: "m-1", origem: "m-1", desde: "2026-11-01", dias: [2] }) };
  const treinos = { [hoje]: ["m-1"] };
  const antes = { planos: {}, metas, diario: {}, treinos };
  assert.equal(P.diaCompleto(antes, hoje), true);
  metas = P.salvarMeta(metas, Object.assign({}, metas["m-1"], { nome: "Outra" }), hoje, 5000);
  const ctx = { planos: {}, metas, diario: {}, treinos };
  const ativa = P.metasFixasDoDia(metas, hoje)[0];
  assert.notEqual(ativa.id, "m-1");
  assert.equal(P.totalDoDia(ctx, hoje), 1);
  assert.equal(P.feitosDoDia(ctx, hoje), 1);
  assert.equal(P.diaCompleto(ctx, hoje), true);
  assert.deepEqual(P.treinosDoDia(ctx, hoje), [ativa.id]);
});
