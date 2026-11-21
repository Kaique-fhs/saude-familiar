const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../js/sf-dados.js");

const EM = "2026-11-21T10:00:00.000Z";

function exemplo() {
  return {
    favs: ["r1", "r2"],
    sel: ["r3"],
    checks: { "r:Arroz": true },
    checksPlano: { Frango: true },
    despensa: ["Banana"],
    diario: { "2026-11-20": ["almoco", "jantar"] },
    treinos: { "2026-11-20": ["academia"] },
    registros: { "2026-11-20": { almoco: { escolhas: { a: 1 }, receita: "r1", foto: "f1", hora: "12:00" } } },
  };
}
function itensDe(map) { return Object.values(map).map((i) => ({ ...i, ativo: true })); }

test("NOMES mapeia as 8 chaves mp-* para os campos do estado", () => {
  assert.deepEqual(D.NOMES, {
    "mp-favs": "favs", "mp-sel": "sel", "mp-checks": "checks", "mp-checks-plano": "checksPlano",
    "mp-quero": "despensa", "mp-diario": "diario", "mp-treinos": "treinos", "mp-registros": "registros",
  });
});

test("estadoVazio tem a forma de cada campo", () => {
  assert.deepEqual(D.estadoVazio(), { favs: [], sel: [], checks: {}, checksPlano: {}, despensa: [], diario: {}, treinos: {}, registros: {} });
});

test("mp-favs vira fav|<id> com valor null", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), favs: ["r1"] }), { "fav|r1": { tipo: "fav", chave: "r1", valor: null } });
});
test("mp-sel vira sel|<id>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), sel: ["r3"] }), { "sel|r3": { tipo: "sel", chave: "r3", valor: null } });
});
test("mp-checks vira check|<k>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), checks: { "r:Arroz": true } }), { "check|r:Arroz": { tipo: "check", chave: "r:Arroz", valor: null } });
});
test("mp-checks-plano vira checkplano|<nome>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), checksPlano: { Frango: true } }), { "checkplano|Frango": { tipo: "checkplano", chave: "Frango", valor: null } });
});
test("mp-quero vira quero|<nome>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), despensa: ["Banana"] }), { "quero|Banana": { tipo: "quero", chave: "Banana", valor: null } });
});
test("mp-diario vira feito|<dia>|<refId>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), diario: { "2026-11-20": ["almoco"] } }),
    { "feito|2026-11-20|almoco": { tipo: "feito", chave: "2026-11-20|almoco", valor: null } });
});
test("mp-treinos vira treino|<dia>|<exId>", () => {
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), treinos: { "2026-11-20": ["academia"] } }),
    { "treino|2026-11-20|academia": { tipo: "treino", chave: "2026-11-20|academia", valor: null } });
});
test("mp-registros vira registro|<dia>|<ref> com o objeto", () => {
  const v = { escolhas: { a: 1 }, receita: "r1", foto: "f1", hora: "12:00" };
  assert.deepEqual(D.paraItens({ ...D.estadoVazio(), registros: { "2026-11-20": { almoco: v } } }),
    { "registro|2026-11-20|almoco": { tipo: "registro", chave: "2026-11-20|almoco", valor: v } });
});

test("ida e volta reproduz o estado", () => {
  const e = exemplo();
  assert.deepEqual(D.aplicar(D.estadoVazio(), itensDe(D.paraItens(e))), e);
});

test("chave com 201 caracteres não entra", () => {
  const longa = "x".repeat(201);
  const i = D.paraItens({ ...D.estadoVazio(), favs: [longa, "ok"], checks: { [longa]: true } });
  assert.deepEqual(Object.keys(i), ["fav|ok"]);
  const ok200 = "y".repeat(200);
  assert.deepEqual(Object.keys(D.paraItens({ ...D.estadoVazio(), favs: [ok200] })), ["fav|" + ok200]);
});

test("chave de feito/treino/registro fora do formato não entra", () => {
  const e = {
    ...D.estadoVazio(),
    diario: { "2026-11-20": ["Almoço", "ok"], "20/11/2026": ["ok"] },
    treinos: { "2026-11-20": ["a b"] },
    registros: { "2026-11-20": { MAIUSC: { escolhas: {} } } },
  };
  assert.deepEqual(Object.keys(D.paraItens(e)), ["feito|2026-11-20|ok"]);
});

test("diferencas: novos e alterados ativos, sumidos inativos com valor null", () => {
  const antes = { ...D.estadoVazio(), favs: ["a", "b"] };
  const depois = { ...D.estadoVazio(), favs: ["b", "c"] };
  assert.deepEqual(D.diferencas(antes, depois, EM), [
    { tipo: "fav", chave: "c", valor: null, ativo: true, em: EM },
    { tipo: "fav", chave: "a", valor: null, ativo: false, em: EM },
  ]);
});

test("diferencas detecta desmarcar como ativo:false", () => {
  const antes = { ...D.estadoVazio(), checks: { "r:Arroz": true } };
  assert.deepEqual(D.diferencas(antes, D.estadoVazio(), EM), [{ tipo: "check", chave: "r:Arroz", valor: null, ativo: false, em: EM }]);
});

test("registro alterado gera mudança com o objeto novo", () => {
  const v1 = { escolhas: {}, receita: "r1", foto: null, hora: "12:00" };
  const v2 = { escolhas: {}, receita: "r1", foto: "f9", hora: "12:00" };
  const antes = { ...D.estadoVazio(), registros: { "2026-11-20": { almoco: v1 } } };
  const depois = { ...D.estadoVazio(), registros: { "2026-11-20": { almoco: v2 } } };
  assert.deepEqual(D.diferencas(antes, depois, EM), [
    { tipo: "registro", chave: "2026-11-20|almoco", valor: v2, ativo: true, em: EM },
  ]);
});

test("diferencas sem mudança devolve vazio", () => {
  assert.deepEqual(D.diferencas(exemplo(), exemplo(), EM), []);
});

test("aplicar remove com ativo:false e limpa dias vazios", () => {
  const r = D.aplicar(exemplo(), [
    { tipo: "feito", chave: "2026-11-20|almoco", ativo: false, valor: null },
    { tipo: "feito", chave: "2026-11-20|jantar", ativo: false, valor: null },
    { tipo: "treino", chave: "2026-11-20|academia", ativo: false, valor: null },
    { tipo: "registro", chave: "2026-11-20|almoco", ativo: false, valor: null },
    { tipo: "fav", chave: "r1", ativo: false, valor: null },
    { tipo: "check", chave: "r:Arroz", ativo: false, valor: null },
  ]);
  assert.deepEqual(r.diario, {});
  assert.deepEqual(r.treinos, {});
  assert.deepEqual(r.registros, {});
  assert.deepEqual(r.favs, ["r2"]);
  assert.deepEqual(r.checks, {});
});

test("aplicar não repete em arrays, não altera o original e atualiza registro", () => {
  const e = exemplo();
  const copia = JSON.parse(JSON.stringify(e));
  const novo = { escolhas: {}, receita: "r2", foto: null, hora: "13:00" };
  const r = D.aplicar(e, [
    { tipo: "fav", chave: "r1", ativo: true, valor: null },
    { tipo: "fav", chave: "r9", ativo: true, valor: null },
    { tipo: "registro", chave: "2026-11-20|almoco", ativo: true, valor: novo },
  ]);
  assert.deepEqual(r.favs, ["r1", "r2", "r9"]);
  assert.deepEqual(r.registros["2026-11-20"].almoco, novo);
  assert.deepEqual(e, copia);
});

test("aplicar o que veio do servidor não gera mudança nova", () => {
  const itens = [{ tipo: "fav", chave: "n", ativo: true, valor: null }, { tipo: "feito", chave: "2026-11-21|ok", ativo: true, valor: null }];
  const depoisRemoto = D.aplicar(exemplo(), itens);
  assert.deepEqual(D.diferencas(depoisRemoto, D.aplicar(depoisRemoto, itens), EM), []);
});
