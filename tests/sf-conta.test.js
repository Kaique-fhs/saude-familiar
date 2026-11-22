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

function falsos(opcoes = {}) {
  const ev = [];
  const api = {
    apagarConta: async () => { ev.push("api.apagar"); if (opcoes.falha) throw new Error("401"); },
    sair: async () => { ev.push("api.sair"); if (opcoes.semRede) throw new Error("rede"); }
  };
  const local = { apagarSessao: () => ev.push("sessao"), apagarUsuario: (id) => ev.push("usuario:" + id) };
  return { ev, api, local, aoApagar: (id) => { ev.push("aoApagar:" + id); } };
}

test("apagarConta chama a limpeza só depois do sucesso", async () => {
  const f = falsos();
  await conta.apagarConta({ api: f.api, local: f.local, userId: "u1", senha: "x", aoApagar: f.aoApagar });
  assert.deepEqual(f.ev, ["api.apagar", "sessao", "usuario:u1", "aoApagar:u1"]);
});

test("apagarConta com erro da API não limpa nada", async () => {
  const f = falsos({ falha: true });
  await assert.rejects(conta.apagarConta({ api: f.api, local: f.local, userId: "u1", senha: "x", aoApagar: f.aoApagar }));
  assert.deepEqual(f.ev, ["api.apagar"]);
});

test("sairDaConta: sem pendências limpa o aparelho; com pendências mantém os dados", async () => {
  const a = falsos();
  await conta.sairDaConta({ api: a.api, local: a.local, userId: "u1", pendentes: 0, aoApagar: a.aoApagar });
  assert.deepEqual(a.ev, ["api.sair", "sessao", "usuario:u1", "aoApagar:u1"]);
  const b = falsos({ semRede: true });
  await conta.sairDaConta({ api: b.api, local: b.local, userId: "u1", pendentes: 2, aoApagar: b.aoApagar });
  assert.deepEqual(b.ev, ["api.sair", "sessao"]);
});

test("apagarConta com aoApagar rejeitando: conta encerrada e aviso de limpeza (não é erro da API)", async () => {
  const f = falsos();
  const r = await conta.apagarConta({ api: f.api, local: f.local, userId: "u1", senha: "x", aoApagar: async () => { throw new Error("onerror"); } });
  assert.deepEqual(r, { limpezaFalhou: true });
  assert.deepEqual(f.ev, ["api.apagar", "sessao", "usuario:u1"]);
  const ok = await conta.apagarConta({ api: f.api, local: f.local, userId: "u1", senha: "x", aoApagar: f.aoApagar });
  assert.deepEqual(ok, { limpezaFalhou: false });
});

test("sairDaConta com aoApagar rejeitando: sessão encerrada e aviso de limpeza", async () => {
  const f = falsos();
  const r = await conta.sairDaConta({ api: f.api, local: f.local, userId: "u1", pendentes: 0, aoApagar: () => { throw new Error("boom"); } });
  assert.deepEqual(r, { limpezaFalhou: true });
  assert.deepEqual(f.ev, ["api.sair", "sessao", "usuario:u1"]);
  const g = falsos();
  assert.deepEqual(await conta.sairDaConta({ api: g.api, local: g.local, userId: "u1", pendentes: 1, aoApagar: g.aoApagar }), { limpezaFalhou: false });
});

test("textoConfirmarSair pede confirmação dizendo quantos itens não foram enviados", () => {
  assert.equal(conta.textoConfirmarSair(0), "");
  assert.match(conta.textoConfirmarSair(1), /^Há 1 item ainda não enviado\./);
  assert.match(conta.textoConfirmarSair(3), /^Há 3 itens ainda não enviados\./);
  assert.match(conta.textoConfirmarSair(3), /Toque de novo em Sair para confirmar\.$/);
});

test("textoStatus traduz o status da sincronização para o cabeçalho", () => {
  assert.equal(conta.textoStatus("ok"), "Tudo salvo na conta");
  assert.equal(conta.textoStatus("pendente"), "Salvo no aparelho, enviando…");
  assert.equal(conta.textoStatus("enviando"), "Salvo no aparelho, enviando…");
  assert.equal(conta.textoStatus("offline"), "Sem internet, envio pendente");
  assert.equal(conta.textoStatus("erro"), "Não consegui enviar, vou tentar de novo");
  assert.equal(conta.textoStatus("conflito"), "Tudo salvo na conta");
  assert.equal(conta.MSG_CONFLITO, "Esta refeição já foi registrada em outro aparelho");
});

test("contaDisponivel: aparelho do app antigo fica sem conta até a migração", () => {
  const s = { token: "t", usuario: { id: "u" } };
  assert.equal(conta.contaDisponivel({ sessao: null, usouAppAntigo: false }), true);
  assert.equal(conta.contaDisponivel({ sessao: null, usouAppAntigo: true }), false);
  assert.equal(conta.contaDisponivel({ sessao: { token: "t" }, usouAppAntigo: true }), false);
  assert.equal(conta.contaDisponivel({ sessao: s, usouAppAntigo: true }), true);
});

test("rotuloRejeitado cobre plano e meta", () => {
  assert.equal(conta.rotuloRejeitado({ tipo: "plano", chave: "2026-11-22" }), "Plano alimentar: 2026-11-22");
  assert.equal(conta.rotuloRejeitado({ tipo: "meta", chave: "m-1" }), "Meta de exercício: m-1");
});
