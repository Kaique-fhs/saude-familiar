const test = require("node:test");
const assert = require("node:assert/strict");
const conta = require("../js/sf-conta.js");

test("modoInicial: as 4 combinações", () => {
  const s = { token: "t", usuario: { id: "u", email: "a@b.c" } };
  assert.equal(conta.modoInicial({ sessao: s, temDadosAntigos: false }), "conta");
  assert.equal(conta.modoInicial({ sessao: s, temDadosAntigos: true }), "conta");
  assert.equal(conta.modoInicial({ sessao: null, temDadosAntigos: true }), "antigo");
  assert.equal(conta.modoInicial({ sessao: null, temDadosAntigos: false }), "entrar");
});

test("lerHash reconhece confirmar, nova-senha e o resto", () => {
  assert.deepEqual(conta.lerHash("#confirmar=abc"), { acao: "confirmar", token: "abc" });
  assert.deepEqual(conta.lerHash("#nova-senha=x"), { acao: "nova-senha", token: "x" });
  assert.deepEqual(conta.lerHash("#plano"), { acao: null, token: "" });
  assert.deepEqual(conta.lerHash(""), { acao: null, token: "" });
  assert.deepEqual(conta.lerHash("#confirmar="), { acao: null, token: "" });
  assert.deepEqual(conta.lerHash("#confirmar=a%2Bb"), { acao: "confirmar", token: "a+b" });
});

test("mensagemErro cobre os códigos e tem texto padrão", () => {
  for (const c of ["credenciais", "nao-confirmado", "captcha", "limite", "senha", "email", "token", "rede"]) {
    const m = conta.mensagemErro(c);
    assert.equal(typeof m, "string");
    assert.ok(m.length > 10, c);
  }
  const padrao = conta.mensagemErro("xyz");
  assert.ok(padrao.length > 10);
  assert.notEqual(padrao, conta.mensagemErro("rede"));
  assert.equal(conta.mensagemErro(undefined), padrao);
});

test("validarEmail e validarSenha", () => {
  assert.equal(conta.validarEmail("a@b.co"), true);
  assert.equal(conta.validarEmail("  a@b.co "), true);
  assert.equal(conta.validarEmail("ab.co"), false);
  assert.equal(conta.validarEmail(""), false);
  assert.equal(conta.validarSenha("1234567"), false);
  assert.equal(conta.validarSenha("12345678"), true);
  assert.equal(conta.validarSenha("x".repeat(128)), true);
  assert.equal(conta.validarSenha("x".repeat(129)), false);
});

test("textoSair avisa quantos itens não foram enviados", () => {
  assert.equal(conta.textoSair(0), "");
  assert.match(conta.textoSair(1), /1 alteração/);
  assert.match(conta.textoSair(3), /3 alterações/);
});

test("rotuloRejeitado descreve o item em português", () => {
  assert.match(conta.rotuloRejeitado({ tipo: "fav", chave: "r1", codigo: "sync" }), /r1/);
  assert.equal(typeof conta.rotuloRejeitado({ tipo: "zzz", chave: "k" }), "string");
});

test("confirmacaoApagarOk exige a palavra APAGAR", () => {
  assert.equal(conta.confirmacaoApagarOk("APAGAR"), true);
  assert.equal(conta.confirmacaoApagarOk(" apagar "), true);
  assert.equal(conta.confirmacaoApagarOk("apag"), false);
  assert.equal(conta.confirmacaoApagarOk(""), false);
});
