const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.window = globalThis.window || {};
require("../data.js");
const P = require("../js/sf-plano.js");
const E = require("../js/sf-editor.js");
const PLANO = P.deDataJs(window.PLANO).planos.inicio;
const RECEITAS = window.RECEITAS;

// Simula o que o navegador envia: lê os campos do HTML gerado.
function paresDoHtml(html) {
  const pares = [];
  const re = /<(?:(input)\b([^>]*)>|(textarea)\b([^>]*)>([\s\S]*?)<\/textarea>)/g;
  const des = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const attr = (a, n) => { const r = a.match(new RegExp("\\b" + n + '="([^"]*)"')); return r ? des(r[1]) : null; };
  let m;
  while ((m = re.exec(html))) {
    const area = !!m[3];
    const a = area ? m[4] : m[2];
    const nome = attr(a, "name");
    if (!nome) continue;
    if (!area && attr(a, "type") === "checkbox") { if (/\bchecked\b/.test(a)) pares.push([nome, attr(a, "value")]); continue; }
    pares.push([nome, area ? des(m[5]) : (attr(a, "value") || "")]);
  }
  return pares;
}
function base(extra) {
  return [["r0-id", ""], ["r0-nome", "Café"], ["r0-hora", ""], ["r0-kcal", ""], ["r0-obs", ""], ["prescrito", ""], ["compras", ""],
    ["nut-proteinas", ""], ["nut-lipidios", ""], ["nut-carboidratos", ""], ["nut-kcal", ""], ["nut-fibras", ""]].concat(extra || []);
}

test("htmlPlano escapa o texto", () => {
  const p = { refeicoes: [{ id: "a", nome: '<b>"x"</b> & \'y\'', hora: null, kcal: null, itens: [{ principal: "<script>1</script>", opcoes: ["<i>"] }], observacoes: ["<u>"], receitas: [] }], nutrientes: null, compras: ["<img>"], prescritoEm: null };
  const h = E.htmlPlano(p, [{ id: "r1", nome: "<em>R</em>" }]);
  assert.ok(h.includes('<form id="form-plano"'));
  for (const cru of ["<b>", "<script>", "<i>", "<u>", "<img>", "<em>"]) assert.ok(!h.includes(cru), cru);
  assert.ok(h.includes("&lt;script&gt;"));
});

test("ida e volta do plano da Rejane", () => {
  const h = E.htmlPlano(PLANO, RECEITAS);
  const { plano, erros } = E.planoDosCampos(paresDoHtml(h), PLANO, 1000);
  assert.deepEqual(erros, []);
  assert.deepEqual(plano, PLANO);
  assert.equal(plano.prescritoEm, "17/11/2026");
  assert.deepEqual(plano.refeicoes.map((r) => r.id), PLANO.refeicoes.map((r) => r.id));
});

test("refeição nova recebe id estável e válido", () => {
  const a = E.planoDosCampos(base(), null, 5000).plano.refeicoes[0].id;
  const b = E.planoDosCampos(base(), null, 5000).plano.refeicoes[0].id;
  assert.equal(a, b);
  assert.equal(a, P.novoId("r", 5000));
  assert.match(a, /^r-[a-z0-9]+$/);
});

test("erros de nome, hora e kcal", () => {
  const pares = base().map(([k, v]) => k === "r0-nome" ? [k, "  "] : k === "r0-hora" ? [k, "25:00"] : k === "r0-kcal" ? [k, "-3"] : [k, v]);
  const { erros } = E.planoDosCampos(pares, null, 1);
  assert.deepEqual(erros, [
    { campo: "r0-nome", msg: "Dê um nome à refeição" },
    { campo: "r0-hora", msg: "Horário no formato HH:MM" },
    { campo: "r0-kcal", msg: "Use um número igual ou maior que zero" }
  ]);
  const r = E.planoDosCampos(base([["r0-it0-principal", " "], ["r0-it0-opcoes", "x"]]), null, 1);
  assert.deepEqual(r.erros, [{ campo: "r0-it0-principal", msg: "Cada item precisa de um nome" }]);
});

test("plano grande demais", () => {
  const r = E.planoDosCampos(base([["compras", "ã".repeat(40000)]]), null, 1);
  assert.deepEqual(r.erros, [{ campo: "form-plano", msg: "O plano ficou grande demais para guardar" }]);
});

test("nutrientes vazios viram null", () => {
  assert.equal(E.planoDosCampos(base(), PLANO, 1).plano.nutrientes, null);
  const pares = base().map(([k, v]) => k === "nut-kcal" ? [k, "1200"] : k === "nut-fibras" ? [k, "20g"] : [k, v]);
  const n = E.planoDosCampos(pares, PLANO, 1).plano.nutrientes;
  assert.deepEqual(n.total, { proteinas: "", lipidios: "", carboidratos: "", kcal: 1200, fibras: "20g" });
  assert.deepEqual(n.linhas, PLANO.nutrientes.linhas);
});

test("linhas vazias de opções e observações somem", () => {
  const pares = base([["r0-it0-principal", "Ovo"], ["r0-it0-opcoes", "A\n\n  \nB\r\n"], ["r0-it1-principal", ""], ["r0-it1-opcoes", ""], ["r0-obs", "\numa\n \n"], ["compras", "x\n\ny"]]);
  const { plano, erros } = E.planoDosCampos(pares, null, 1);
  assert.deepEqual(erros, []);
  const r = plano.refeicoes[0];
  assert.deepEqual(r.itens, [{ principal: "Ovo", opcoes: ["A", "B"] }]);
  assert.deepEqual(r.observacoes, ["uma"]);
  assert.deepEqual(plano.compras, ["x", "y"]);
});

test("aplicarAcao: subir, descer, remover e adicionar preservam o digitado", () => {
  const dois = [["r0-id", "a"], ["r0-nome", "A"], ["r0-it0-principal", "p0"], ["r0-it0-opcoes", "o0"], ["r0-it1-principal", "p1"], ["r0-it1-opcoes", ""], ["r0-obs", "digitado"], ["r0-rec", "sorvete-manga"],
    ["r1-id", "b"], ["r1-nome", "B"], ["compras", "pão"]];
  const nomes = (pares) => E.planoDosCampos(pares, null, 1).plano.refeicoes.map((r) => r.nome);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "subir", 1)), ["B", "A"]);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "descer", 0)), ["B", "A"]);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "subir", 0)), ["A", "B"]);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "del-refeicao", 0)), ["B"]);
  const mais = E.planoDosCampos(E.aplicarAcao(dois, "add-refeicao"), null, 1);
  assert.equal(mais.plano.refeicoes.length, 3);
  assert.ok(mais.erros.some((e) => e.campo === "r2-nome"));
  const sem = E.planoDosCampos(E.aplicarAcao(dois, "del-item", 0, 0), null, 1).plano.refeicoes[0];
  assert.deepEqual(sem.itens, [{ principal: "p1", opcoes: [] }]);
  assert.equal(sem.observacoes[0], "digitado");
  assert.deepEqual(sem.receitas, ["sorvete-manga"]);
  const novo = E.aplicarAcao(dois, "add-item", 0);
  assert.ok(novo.some(([k]) => k === "r0-it2-principal"));
  const tro = E.planoDosCampos(E.aplicarAcao(dois, "subir", 0, 1), null, 1).plano.refeicoes[0].itens.map((i) => i.principal);
  assert.deepEqual(tro, ["p1", "p0"]);
  assert.equal(E.planoDosCampos(E.aplicarAcao(dois, "subir", 1), null, 1).plano.compras[0], "pão");
});

test("htmlPlano marca o campo com erro", () => {
  const h = E.htmlPlano(PLANO, RECEITAS, [{ campo: "r1-nome", msg: "Dê um nome à refeição" }]);
  const i = h.indexOf('name="r1-nome"');
  assert.ok(i > 0);
  const tag = h.slice(h.lastIndexOf("<", i), h.indexOf(">", i));
  assert.ok(tag.includes('aria-invalid="true"'));
  assert.ok(h.slice(i, i + 400).includes("Dê um nome à refeição"));
  assert.equal((h.match(/aria-invalid="true"/g) || []).length, 1);
});

test("aplicarAcao aceita índices em string e ignora fora do intervalo", () => {
  const dois = [["r0-id", "a"], ["r0-nome", "A"], ["r0-it0-principal", "p0"], ["r0-it0-opcoes", ""], ["r0-it1-principal", "p1"], ["r0-it1-opcoes", ""],
    ["r1-id", "b"], ["r1-nome", "B"]];
  const nomes = (pares) => E.planoDosCampos(pares, null, 1).plano.refeicoes.map((r) => r.nome);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "subir", "1")), ["B", "A"]);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "descer", "0")), ["B", "A"]);
  const it = E.planoDosCampos(E.aplicarAcao(dois, "descer", "0", "0"), null, 1).plano.refeicoes[0].itens.map((x) => x.principal);
  assert.deepEqual(it, ["p1", "p0"]);
  assert.deepEqual(E.aplicarAcao(dois, "subir", "0"), E.aplicarAcao(dois, "subir", 5));
  assert.deepEqual(nomes(E.aplicarAcao(dois, "subir", "0")), ["A", "B"]);
  assert.deepEqual(nomes(E.aplicarAcao(dois, "descer", "1")), ["A", "B"]);
  assert.deepEqual(E.aplicarAcao(dois, "descer", "0", "1"), E.aplicarAcao(dois, "descer", 0, 1).map((p) => p));
  const igual = E.aplicarAcao(dois, "descer", "0", "9");
  assert.deepEqual(igual, E.aplicarAcao(dois, "subir", "7"));
});

test("planoBrutoDosPares mantém vazios e alimenta htmlPlano depois de adicionar", () => {
  const pares = base([["r0-it0-principal", ""], ["r0-it0-opcoes", "a\n\nb"], ["r0-obs", "x\n\ny"]]);
  const bruto = E.planoBrutoDosPares(pares);
  assert.equal(bruto.refeicoes[0].id, "");
  assert.deepEqual(bruto.refeicoes[0].itens, [{ principal: "", opcoes: ["a", "", "b"] }]);
  assert.deepEqual(bruto.refeicoes[0].observacoes, ["x", "", "y"]);
  const conta = (h, re) => (h.match(re) || []).length;
  const reItem = /name="r0-it\d+-principal"/g;
  const antes = conta(E.htmlPlano(bruto, RECEITAS), reItem);
  const comItem = E.htmlPlano(E.planoBrutoDosPares(E.aplicarAcao(pares, "add-item", 0)), RECEITAS);
  assert.equal(conta(comItem, reItem), antes + 1);
  const reRef = /name="r\d+-nome"/g;
  const comRef = E.htmlPlano(E.planoBrutoDosPares(E.aplicarAcao(pares, "add-refeicao")), RECEITAS);
  assert.equal(conta(comRef, reRef), conta(E.htmlPlano(bruto, RECEITAS), reRef) + 1);
  assert.ok(comRef.includes('name="r1-id" value=""'));
});

test("htmlPlano escapa id oculto e value de receita", () => {
  const p = { refeicoes: [{ id: 'a"><x>', nome: "n", hora: null, kcal: null, itens: [], observacoes: [], receitas: ['q"><y>'] }], nutrientes: null, compras: [], prescritoEm: null };
  const h = E.htmlPlano(p, [{ id: 'q"><y>', nome: "R" }]);
  assert.ok(!h.includes("<x>") && !h.includes("<y>"));
  assert.ok(h.includes("a&quot;&gt;&lt;x&gt;"));
  assert.ok(h.includes('value="q&quot;&gt;&lt;y&gt;" checked'));
});
