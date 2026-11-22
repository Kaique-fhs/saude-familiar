const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ler = (f) => {
  const p = path.join(__dirname, "..", f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};
const conta = require("../js/sf-conta.js");

test("versão do aviso é a mesma no servidor, no site e na página", () => {
  const servidor = (ler("server/src/aceite.js").match(/VERSAO_AVISO = '([^']+)'/) || [])[1];
  assert.ok(servidor);
  assert.equal(conta.VERSAO_AVISO, servidor);
  assert.match(ler("privacidade.html"), new RegExp(`data-versao="${servidor}"`));
});

test("montarAceite: só com as duas caixas marcadas", () => {
  assert.equal(conta.montarAceite(false, false), null);
  assert.equal(conta.montarAceite(true, false), null);
  assert.equal(conta.montarAceite(false, true), null);
  assert.deepEqual(conta.montarAceite(true, true), { versao: conta.VERSAO_AVISO, saude: true, transferencia: true });
  assert.match(conta.mensagemErro("aceite"), /caixas/);
});

// sw.js de verdade, com caches e fetch falsos
function carregarSw() {
  const guardado = new Map();
  const chave = (x) => new URL(typeof x === "string" ? x : x.url, "https://site.teste/app/").href;
  const cache = { put: async (k, v) => { guardado.set(chave(k), v.nome); }, addAll: async () => {} };
  const ouvintes = {};
  const rede = { fora: false };
  const contexto = {
    URL, Promise,
    Request: function (url) { this.url = String(url); },
    location: { origin: "https://site.teste", href: "https://site.teste/app/sw.js" },
    self: { addEventListener: (nome, fn) => { ouvintes[nome] = fn; } },
    caches: {
      open: async () => cache,
      match: async (k) => (guardado.has(chave(k)) ? { nome: guardado.get(chave(k)) } : undefined),
    },
    fetch: async (req) => {
      if (rede.fora) throw new TypeError("sem rede");
      const r = { ok: true, nome: req.url };
      r.clone = () => r;
      return r;
    },
  };
  vm.runInNewContext(ler("sw.js"), contexto);
  return {
    guardado, rede,
    async navegar(caminho) {
      let resposta;
      const esperas = [];
      ouvintes.fetch({
        request: { method: "GET", mode: "navigate", url: "https://site.teste/app/" + caminho },
        respondWith: (p) => { resposta = p; },
        waitUntil: (p) => esperas.push(p),
      });
      const r = await resposta;
      await Promise.all(esperas);
      await new Promise((ok) => setImmediate(ok));
      return r;
    },
  };
}

test("sw: abrir o aviso não troca o app guardado para uso offline", async () => {
  const sw = carregarSw();
  await sw.navegar("");
  await sw.navegar("privacidade.html");
  assert.equal(sw.guardado.get("https://site.teste/app/index.html"), "https://site.teste/app/");
  sw.rede.fora = true;
  assert.equal((await sw.navegar("")).nome, "https://site.teste/app/");
  assert.equal((await sw.navegar("privacidade.html")).nome, "https://site.teste/app/privacidade.html");
});

test("sw: a página do aviso entra no cache da instalação", () => {
  assert.match(ler("sw.js"), /"\.\/privacidade\.html"/);
});

test("TRAVA DE PUBLICAÇÃO: aviso sem campo em aberto (não publique no main com este teste vermelho)", () => {
  const html = ler("privacidade.html");
  assert.ok(html, "privacidade.html não existe");
  assert.deepEqual(html.match(/\[(?:PREENCHER|CONFIRMAR)[^\]]*\]|RASCUNHO/g) || [], []);
});
