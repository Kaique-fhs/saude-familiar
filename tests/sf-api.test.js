const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criar, ErroApi } = require("../js/sf-api.js");

function resposta(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (corpo === undefined ? "" : JSON.stringify(corpo)),
    json: async () => corpo
  };
}

function montar(opts) {
  opts = opts || {};
  const chamadas = [];
  const fetchFalso = async (url, init) => {
    chamadas.push({ url, init });
    if (opts.lanca) throw new TypeError("Failed to fetch");
    return opts.resposta || resposta(200, {});
  };
  const api = criar({
    config: opts.config || { apiUrl: "http://api.teste", turnstileChave: "", cabecalhoOrigemDev: "" },
    fetch: fetchFalso,
    sessao: opts.sessao || (() => null)
  });
  return { api, chamadas };
}

test("entrar manda POST /conta/entrar com corpo JSON e devolve {token, usuario}", async () => {
  const { api, chamadas } = montar({ resposta: resposta(200, { token: "t1", usuario: { id: "u", email: "a@b.c" } }) });
  const r = await api.entrar("a@b.c", "senha1234");
  assert.deepEqual(r, { token: "t1", usuario: { id: "u", email: "a@b.c" } });
  assert.equal(chamadas[0].url, "http://api.teste/conta/entrar");
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal(chamadas[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { email: "a@b.c", senha: "senha1234" });
});

test("401 vira ErroApi {status:401, codigo:\"sessao\"}", async () => {
  const { api } = montar({ resposta: resposta(401, { erro: "sessao" }), sessao: () => "tok" });
  await assert.rejects(api.conta(), (e) => {
    assert.ok(e instanceof ErroApi);
    assert.equal(e.status, 401);
    assert.equal(e.codigo, "sessao");
    return true;
  });
});

test("fetch que lança vira codigo \"rede\"", async () => {
  const { api } = montar({ lanca: true });
  await assert.rejects(api.entrar("a@b.c", "x"), (e) => e instanceof ErroApi && e.codigo === "rede" && e.status === 0);
});

test("sem cabecalhoOrigemDev não manda x-saude-origem; com ele manda", async () => {
  let m = montar();
  await m.api.entrar("a@b.c", "x");
  assert.equal("x-saude-origem" in m.chamadas[0].init.headers, false);
  m = montar({ config: { apiUrl: "http://api.teste", cabecalhoOrigemDev: "dev" } });
  await m.api.entrar("a@b.c", "x");
  assert.equal(m.chamadas[0].init.headers["x-saude-origem"], "dev");
});

test("sair não manda content-type e manda Authorization quando há token", async () => {
  const { api, chamadas } = montar({ resposta: resposta(204), sessao: () => "tok" });
  await api.sair();
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal("content-type" in chamadas[0].init.headers, false);
  assert.equal(chamadas[0].init.body, undefined);
  assert.equal(chamadas[0].init.headers.Authorization, "Bearer tok");
});

test("sem token não manda Authorization", async () => {
  const { api, chamadas } = montar();
  await api.entrar("a@b.c", "x");
  assert.equal("Authorization" in chamadas[0].init.headers, false);
});

test("baixar monta ?depois=&limite=", async () => {
  const { api, chamadas } = montar({ resposta: resposta(200, { itens: [], cursor: 7, mais: false }), sessao: () => "t" });
  const r = await api.baixar(5, 100);
  assert.deepEqual(r, { itens: [], cursor: 7, mais: false });
  assert.equal(chamadas[0].url, "http://api.teste/sync?depois=5&limite=100");
  assert.equal(chamadas[0].init.method, "GET");
});

test("cadastro e esqueci mandam x-turnstile-token", async () => {
  const m = montar({ resposta: resposta(202, { ok: true }) });
  const aceite = { versao: "1", saude: true, transferencia: true };
  await m.api.cadastro("a@b.c", "senha1234", "tk", aceite);
  await m.api.esqueci("a@b.c", "tk2");
  assert.equal(m.chamadas[0].url, "http://api.teste/conta/cadastro");
  assert.equal(m.chamadas[0].init.headers["x-turnstile-token"], "tk");
  assert.equal(m.chamadas[1].url, "http://api.teste/conta/esqueci");
  assert.equal(m.chamadas[1].init.headers["x-turnstile-token"], "tk2");
  assert.deepEqual(JSON.parse(m.chamadas[0].init.body), { email: "a@b.c", senha: "senha1234", aceite });
});

test("rotas restantes: método, caminho e corpo", async () => {
  const m = montar({ resposta: resposta(200, {}), sessao: () => "t" });
  await m.api.confirmar("c1");
  await m.api.novaSenha("n1", "novasenha1");
  await m.api.apagarConta("senha1234");
  await m.api.enviarMudancas([{ tipo: "fav", chave: "1", valor: null, ativo: true, em: "2026-01-01T00:00:00.000Z" }]);
  await m.api.urlEnvioFoto("f-2026-01-01-a-1");
  await m.api.urlFoto("f-2026-01-01-a-1");
  const c = m.chamadas.map((x) => x.init.method + " " + x.url.replace("http://api.teste", ""));
  assert.deepEqual(c, [
    "POST /conta/confirmar",
    "POST /conta/nova-senha",
    "DELETE /conta",
    "POST /sync",
    "POST /fotos/f-2026-01-01-a-1/envio",
    "GET /fotos/f-2026-01-01-a-1"
  ]);
  assert.deepEqual(JSON.parse(m.chamadas[1].init.body), { token: "n1", senha: "novasenha1" });
  assert.deepEqual(JSON.parse(m.chamadas[2].init.body), { senha: "senha1234" });
  assert.equal(JSON.parse(m.chamadas[3].init.body).mudancas.length, 1);
  assert.equal("content-type" in m.chamadas[4].init.headers, false);
});

test("erro sem corpo JSON usa codigo vazio mas mantém status", async () => {
  const m = montar({ resposta: { ok: false, status: 500, text: async () => "<html>" } });
  await assert.rejects(m.api.conta(), (e) => e.status === 500 && e.codigo === "");
});

test("config.js versionado aponta para producao, sem cabecalho de desenvolvimento", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
  const janela = {};
  new Function("window", src)(janela);
  assert.equal(janela.SF_CONFIG.apiUrl, "https://d24j5hln30wud.cloudfront.net");
  assert.equal(janela.SF_CONFIG.turnstileChave, "0x4AAAAAAGMIsSAsmJojK__Y");
  assert.equal(janela.SF_CONFIG.cabecalhoOrigemDev, "");
});
