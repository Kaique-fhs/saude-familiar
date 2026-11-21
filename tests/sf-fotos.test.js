const test = require("node:test");
const assert = require("node:assert/strict");
const { ErroApi } = require("../js/sf-api.js");
const Fotos = require("../js/sf-fotos.js");

const ID = "f-2026-11-21-jantar-1700000000000";

function bancoFalso(inicial) {
  const m = new Map(Object.entries(inicial || {}));
  return { m, ler: async (id) => m.get(id), gravar: async (id, b) => { m.set(id, b); } };
}
function resp(status, extra) {
  return Object.assign({ ok: status >= 200 && status < 300, status, blob: async () => new Blob(["x"]) }, extra);
}
function montar(o) {
  o = o || {};
  const chamadas = [];
  const api = {
    urlEnvioFoto: async () => o.envio || { url: "http://s3/up", campos: { key: "k", policy: "p" } },
    urlFoto: async () => { if (o.urlErro) throw o.urlErro; return { url: "http://s3/ler" }; }
  };
  const fetchFalso = async (url, init) => {
    chamadas.push({ url, init });
    if (o.lanca) throw new TypeError("Failed to fetch");
    return o.resposta || resp(204);
  };
  const banco = o.banco || bancoFalso();
  return { fotos: Fotos.criar({ api, fetch: fetchFalso, banco }), chamadas, banco };
}

test("enviar manda os campos na ordem e file por último", async () => {
  const { fotos, chamadas } = montar({ banco: bancoFalso({ [ID]: new Blob(["jpg"], { type: "image/jpeg" }) }) });
  await fotos.enviar(ID);
  assert.equal(chamadas[0].url, "http://s3/up");
  assert.equal(chamadas[0].init.method, "POST");
  const chaves = [...chamadas[0].init.body.keys()];
  assert.deepEqual(chaves, ["key", "policy", "file"]);
  assert.equal(chamadas[0].init.body.get("file").type, "image/jpeg");
});

test("enviar sem blob rejeita sem-foto", async () => {
  const { fotos } = montar();
  await assert.rejects(fotos.enviar(ID), (e) => e.message === "sem-foto");
});

test("enviar com resposta fora de 2xx rejeita ErroApi permanente (4xx) ou de rede (5xx)", async () => {
  const banco = bancoFalso({ [ID]: new Blob(["j"]) });
  const a = montar({ banco, resposta: resp(403) });
  await assert.rejects(a.fotos.enviar(ID), (e) => e instanceof ErroApi && e.status === 403);
  assert.equal(a.fotos.classificar(await a.fotos.enviar(ID).catch((e) => e)), "permanente");
  const b = montar({ banco, resposta: resp(503) });
  assert.equal(b.fotos.classificar(await b.fotos.enviar(ID).catch((e) => e)), "rede");
});

test("enviar com falha de rede rejeita ErroApi 0 classificado como rede", async () => {
  const { fotos } = montar({ banco: bancoFalso({ [ID]: new Blob(["j"]) }), lanca: true });
  const e = await fotos.enviar(ID).catch((x) => x);
  assert.ok(e instanceof ErroApi);
  assert.equal(fotos.classificar(e), "rede");
});

test("classificar distingue sem-foto, sessao, rede e permanente", () => {
  const { fotos } = montar();
  assert.equal(fotos.classificar(new Error("sem-foto")), "sem-foto");
  assert.equal(fotos.classificar(new ErroApi(401, "sessao")), "sessao");
  assert.equal(fotos.classificar(new ErroApi(0, "rede")), "rede");
  assert.equal(fotos.classificar(new ErroApi(400, "foto-id")), "permanente");
});

test("enviada: depois de enviar com sucesso a foto fica marcada como enviada", async () => {
  const { fotos } = montar({ banco: bancoFalso({ [ID]: new Blob(["j"]) }) });
  assert.equal(fotos.foiEnviada(ID), false);
  await fotos.enviar(ID);
  assert.equal(fotos.foiEnviada(ID), true);
});

test("garantir usa o banco sem rede quando já tem", async () => {
  const blob = new Blob(["a"]);
  const { fotos, chamadas } = montar({ banco: bancoFalso({ [ID]: blob }) });
  assert.equal(await fotos.garantir(ID), blob);
  assert.equal(chamadas.length, 0);
});

test("garantir baixa, grava e devolve quando não tem", async () => {
  const { fotos, chamadas, banco } = montar();
  const b = await fotos.garantir(ID);
  assert.ok(b instanceof Blob);
  assert.equal(chamadas[0].url, "http://s3/ler");
  assert.equal(banco.m.get(ID), b);
});

test("garantir devolve null se a rede falha ou a resposta não é ok", async () => {
  assert.equal(await montar({ lanca: true }).fotos.garantir(ID), null);
  assert.equal(await montar({ resposta: resp(404) }).fotos.garantir(ID), null);
  assert.equal(await montar({ urlErro: new ErroApi(0, "rede") }).fotos.garantir(ID), null);
});

test("garantir simultâneo da mesma foto faz 1 download e 1 gravação, e devolve o mesmo blob", async () => {
  const { fotos, chamadas, banco } = montar();
  let gravacoes = 0;
  const gravar = banco.gravar;
  banco.gravar = async (id, b) => { gravacoes++; return gravar(id, b); };
  const [a, b] = await Promise.all([fotos.garantir(ID), fotos.garantir(ID)]);
  assert.equal(chamadas.length, 1);
  assert.equal(gravacoes, 1);
  assert.ok(a instanceof Blob);
  assert.equal(a, b);
});

test("garantir tenta de novo numa nova chamada depois de uma falha", async () => {
  let falha = true;
  const api = { urlFoto: async () => ({ url: "http://s3/ler" }) };
  const fetchFalso = async () => { if (falha) throw new TypeError("x"); return resp(200); };
  const fotos = Fotos.criar({ api, fetch: fetchFalso, banco: bancoFalso() });
  assert.equal(await fotos.garantir(ID), null);
  falha = false;
  assert.ok((await fotos.garantir(ID)) instanceof Blob);
});
