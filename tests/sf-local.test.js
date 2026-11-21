const test = require("node:test");
const assert = require("node:assert/strict");
const SFLocal = require("../js/sf-local.js");

function armazenamentoFalso(inicial) {
  const m = new Map(Object.entries(inicial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
    _chaves: () => Array.from(m.keys()),
  };
}

test("gravar e ler usam o prefixo sf:<userId>:", () => {
  const s = armazenamentoFalso();
  const l = SFLocal.criar({ storage: s });
  assert.equal(l.gravar("A", "mp-favs", ["x"]), true);
  assert.deepEqual(s._chaves(), ["sf:A:mp-favs"]);
  assert.deepEqual(l.ler("A", "mp-favs", []), ["x"]);
  assert.deepEqual(l.ler("A", "outro", { p: 1 }), { p: 1 });
});

test("ler de A não enxerga gravado em B", () => {
  const l = SFLocal.criar({ storage: armazenamentoFalso() });
  l.gravar("B", "mp-favs", ["b"]);
  assert.deepEqual(l.ler("A", "mp-favs", []), []);
});

test("gravar devolve false quando o armazenamento falha", () => {
  const s = armazenamentoFalso();
  s.setItem = () => { throw new Error("cheio"); };
  assert.equal(SFLocal.criar({ storage: s }).gravar("A", "x", 1), false);
});

test("ler devolve o padrão com JSON corrompido", () => {
  const s = armazenamentoFalso({ "sf:A:x": "{quebrado" });
  assert.deepEqual(SFLocal.criar({ storage: s }).ler("A", "x", 7), 7);
});

test("sessão: gravar, ler e apagar", () => {
  const s = armazenamentoFalso();
  const l = SFLocal.criar({ storage: s });
  assert.equal(l.sessao(), null);
  l.gravarSessao({ token: "t", usuario: { id: "A", email: "a@a" } });
  assert.deepEqual(l.sessao(), { token: "t", usuario: { id: "A", email: "a@a" } });
  assert.ok(s._chaves().includes("sf:sessao"));
  l.apagarSessao();
  assert.equal(l.sessao(), null);
});

test('apagarUsuario("A") não toca em sf:B:* nem em mp-*', () => {
  const s = armazenamentoFalso({
    "sf:A:mp-favs": "[]", "sf:A:fila": "[]", "sf:B:mp-favs": "[1]",
    "mp-favs": '["z"]', "sf:sessao": "{}", "sf:AA:x": "1",
  });
  SFLocal.criar({ storage: s }).apagarUsuario("A");
  assert.deepEqual(s._chaves().sort(), ["mp-favs", "sf:AA:x", "sf:B:mp-favs", "sf:sessao"]);
});

test("temDadosAntigos falso com mp-ultimo-backup só", () => {
  const s = armazenamentoFalso({ "mp-ultimo-backup": '"2026-11-01"', "mp-backups-mes": "{}", "mp-instalar-dispensado": "1" });
  assert.equal(SFLocal.criar({ storage: s }).temDadosAntigos(), false);
});

test("temDadosAntigos verdadeiro com conteúdo e falso com vazio", () => {
  assert.equal(SFLocal.criar({ storage: armazenamentoFalso({ "mp-favs": '["a"]' }) }).temDadosAntigos(), true);
  assert.equal(SFLocal.criar({ storage: armazenamentoFalso({ "mp-diario": '{"2026-11-01":["a"]}' }) }).temDadosAntigos(), true);
  assert.equal(SFLocal.criar({ storage: armazenamentoFalso({ "mp-favs": "[]", "mp-diario": "{}", "mp-checks": "null" }) }).temDadosAntigos(), false);
});
