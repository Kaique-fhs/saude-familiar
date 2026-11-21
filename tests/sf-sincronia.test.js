const test = require("node:test");
const assert = require("node:assert/strict");
const { ErroApi } = require("../js/sf-api.js");
const Dados = require("../js/sf-dados.js");
const Sincronia = require("../js/sf-sincronia.js");

const VAZIO = Dados.estadoVazio();
const T0 = "2026-11-21T10:00:00.000Z";

function localFalso(inicial) {
  const m = new Map(Object.entries(inicial || {}));
  return {
    m,
    ler: (u, n, padrao) => (m.has(u + ":" + n) ? JSON.parse(m.get(u + ":" + n)) : padrao),
    gravar: (u, n, v) => { m.set(u + ":" + n, JSON.stringify(v)); return true; }
  };
}

// o.enviar(mudancas, n) e o.baixar(depois, limite, n) podem sobrescrever o comportamento.
function montar(o) {
  o = o || {};
  const reg = { envios: [], baixadas: [], fotosEnviadas: [], status: [], sessao: 0, estados: [] };
  let relogio = T0;
  let estado = o.estado || VAZIO;
  const api = {
    enviarMudancas: async (mudancas) => {
      reg.envios.push(mudancas);
      if (o.enviar) return o.enviar(mudancas, reg.envios.length);
      return { conflitos: [] };
    },
    baixar: async (depois, limite) => {
      reg.baixadas.push([depois, limite]);
      if (o.baixar) return o.baixar(depois, limite, reg.baixadas.length);
      return { itens: [], cursor: depois, mais: false };
    }
  };
  const fotos = {
    foiEnviada: () => false,
    enviar: async (id) => {
      reg.fotosEnviadas.push(id);
      if (o.foto) return o.foto(id);
    }
  };
  const local = o.local || localFalso();
  const deps = {
    api, local, fotos, userId: "u1",
    agora: () => relogio,
    estado: () => estado,
    aoMudarEstado: (e) => { estado = e; reg.estados.push(e); },
    aoMudarStatus: (s) => reg.status.push(s),
    aoSessaoVencida: () => { reg.sessao++; },
    timeoutMs: o.timeoutMs || 1000,
    esperaBaseMs: 1000
  };
  const sinc = Sincronia.criar(Object.assign(deps, o.deps || {}));
  return {
    sinc, reg, local, api, fotos,
    relogio: (t) => { relogio = t; },
    estado: () => estado,
    mudar: (depois) => { const antes = estado; estado = depois; sinc.registrar(antes, depois); }
  };
}

function com(campos) { return Object.assign({}, VAZIO, campos); }
function fila(h) { return h.local.ler("u1", "fila", []); }
const ID_FOTO = "f-2026-11-21-jantar-1700000000000";
const REG_FOTO = { escolhas: [], receita: "x", foto: ID_FOTO, hora: "19:00" };
function comFoto() { return com({ registros: { "2026-11-21": { jantar: REG_FOTO } } }); }

test("coalescência: marcar e desmarcar a mesma receita antes de enviar gera uma mudança só (ativo:false)", () => {
  const h = montar();
  h.mudar(com({ favs: ["a"] }));
  h.relogio("2026-11-21T10:00:05.000Z");
  h.mudar(VAZIO);
  const f = fila(h);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { tipo: "fav", chave: "a", valor: null, ativo: false, em: "2026-11-21T10:00:05.000Z" });
  assert.equal(h.sinc.pendentes(), 1);
});

test("lote de 450 mudanças vira 200+200+50", async () => {
  const h = montar();
  const ids = Array.from({ length: 450 }, (_, i) => "r" + i);
  h.mudar(com({ favs: ids }));
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.envios.map((l) => l.length), [200, 200, 50]);
  assert.equal(fila(h).length, 0);
  assert.equal(h.sinc.status(), "ok");
});

test("baixar segue mais:true até o fim e grava o cursor (sempre com depois e limite 500)", async () => {
  const h = montar({
    baixar: (depois, limite, n) => n === 1
      ? { itens: [{ tipo: "fav", chave: "a", valor: null, ativo: true, em: T0, seq: 3 }], cursor: 3, mais: true }
      : { itens: [{ tipo: "fav", chave: "b", valor: null, ativo: true, em: T0, seq: 7 }], cursor: 7, mais: false }
  });
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.baixadas, [[0, 500], [3, 500]]);
  assert.equal(h.local.ler("u1", "cursor", 0), 7);
  assert.deepEqual(h.estado().favs, ["a", "b"]);
});

test("conflito de registro aplica a versão do servidor e status conflito", async () => {
  const servidor = { tipo: "registro", chave: "2026-11-21|jantar", valor: { escolhas: [], receita: "y", foto: "f-outro", hora: "20:00" }, ativo: true, em: "2026-11-21T09:00:00.000Z", seq: 5 };
  const h = montar({ enviar: () => ({ conflitos: [servidor] }), foto: undefined });
  h.mudar(com({ registros: { "2026-11-21": { jantar: { escolhas: [], receita: "x", hora: "19:00" } } } }));
  await h.sinc.sincronizar();
  assert.equal(h.estado().registros["2026-11-21"].jantar.receita, "y");
  assert.equal(h.sinc.status(), "conflito");
  assert.equal(fila(h).length, 0);
});

test("sincronizar chamado duas vezes ao mesmo tempo faz um envio só", async () => {
  const h = montar();
  h.mudar(com({ favs: ["a"] }));
  const p1 = h.sinc.sincronizar();
  const p2 = h.sinc.sincronizar();
  assert.equal(p1, p2);
  await p1;
  assert.equal(h.reg.envios.length, 1);
});

test("item remoto aplicado não volta para a fila no próximo registrar", async () => {
  const h = montar({
    baixar: () => ({ itens: [{ tipo: "fav", chave: "remoto", valor: null, ativo: true, em: T0, seq: 1 }], cursor: 1, mais: false })
  });
  await h.sinc.sincronizar();
  assert.deepEqual(h.estado().favs, ["remoto"]);
  // o app ainda passa um "antes" velho (sem o item remoto)
  h.sinc.registrar(VAZIO, com({ favs: ["remoto", "local"] }));
  assert.deepEqual(fila(h).map((m) => m.chave), ["local"]);
});

test("mudança da mesma chave feita durante o envio continua na fila depois do lote aceito", async () => {
  let h;
  h = montar({
    enviar: () => {
      h.relogio("2026-11-21T10:00:09.000Z");
      h.mudar(VAZIO); // desmarca enquanto o envio está no ar
      return { conflitos: [] };
    }
  });
  h.mudar(com({ favs: ["a"] }));
  await h.sinc.sincronizar();
  // o laço seguinte já enviou a mudança nova; confirme o que foi enviado em cada rodada
  assert.equal(h.reg.envios[0][0].ativo, true);
  assert.equal(h.reg.envios[1][0].ativo, false);
  assert.equal(fila(h).length, 0);
});

test("mudança nova durante o envio permanece na fila se o envio seguinte falha", async () => {
  let h;
  h = montar({
    enviar: (m, n) => {
      if (n === 1) { h.relogio("2026-11-21T10:00:09.000Z"); h.mudar(VAZIO); return { conflitos: [] }; }
      throw new ErroApi(0, "rede");
    }
  });
  h.mudar(com({ favs: ["a"] }));
  await h.sinc.sincronizar();
  const f = fila(h);
  assert.equal(f.length, 1);
  assert.equal(f[0].ativo, false);
  assert.equal(h.sinc.status(), "offline");
});

test("400 sync isola o item inválido em rejeitados e envia os outros", async () => {
  const h = montar({
    enviar: (m) => {
      if (m.some((x) => x.chave === "ruim")) throw new ErroApi(400, "sync");
      return { conflitos: [] };
    }
  });
  h.mudar(com({ favs: ["a", "ruim", "b"] }));
  await h.sinc.sincronizar();
  assert.deepEqual(h.sinc.rejeitados(), [{ tipo: "fav", chave: "ruim", codigo: "sync" }]);
  assert.equal(fila(h).length, 0);
  const aceitos = h.reg.envios.filter((m) => m.length === 1 && m[0].chave !== "ruim").map((m) => m[0].chave);
  assert.deepEqual(aceitos.sort(), ["a", "b"]);
  assert.equal(h.sinc.status(), "ok");
});

test("413 divide o lote ao meio; lote de 1 com 413 vai para rejeitados", async () => {
  const h = montar({
    enviar: (m) => {
      if (m.length > 2 || m.some((x) => x.chave === "gigante")) throw new ErroApi(413, "requisicao");
      return { conflitos: [] };
    }
  });
  h.mudar(com({ favs: ["a", "b", "c", "d", "gigante"] }));
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.envios.slice(0, 3).map((m) => m.length), [5, 2, 3]);
  assert.deepEqual(h.sinc.rejeitados(), [{ tipo: "fav", chave: "gigante", codigo: "requisicao" }]);
  assert.equal(fila(h).length, 0);
});

test("foto sumida: registro sobe com foto null e aviso", async () => {
  const h = montar({ foto: () => { throw new Error("sem-foto"); } });
  h.mudar(comFoto());
  await h.sinc.sincronizar();
  assert.equal(h.reg.envios.length, 1);
  assert.equal(h.reg.envios[0][0].valor.foto, null);
  assert.equal(h.reg.envios[0][0].valor.receita, "x");
  assert.equal(h.sinc.avisos().length, 1);
  assert.equal(h.sinc.avisos()[0].codigo, "foto-sumida");
  assert.equal(h.local.ler("u1", "fotos-pendentes", []).length, 0);
});

test("registro com foto só sobe depois da foto confirmada", async () => {
  let falha = true;
  const h = montar({ foto: () => { if (falha) throw new ErroApi(0, "rede"); } });
  h.mudar(comFoto());
  h.mudar(Object.assign(comFoto(), { favs: ["a"] }));
  await h.sinc.sincronizar();
  assert.equal(h.sinc.status(), "offline");
  assert.equal(h.reg.envios.length, 0);
  assert.equal(fila(h).length, 2);
  falha = false;
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.fotosEnviadas, [ID_FOTO, ID_FOTO]);
  assert.equal(h.reg.envios[0].length, 2);
  assert.equal(fila(h).length, 0);
});

test("erro de foto que não é rede mantém a foto pendente e não para a fila (status erro)", async () => {
  const h = montar({ foto: () => { throw new ErroApi(500, "foto-envio"); } });
  h.mudar(Object.assign(comFoto(), { favs: ["a"] }));
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.envios.map((m) => m.map((x) => x.chave)), [["a"]]);
  assert.deepEqual(fila(h).map((m) => m.tipo), ["registro"]);
  assert.deepEqual(h.local.ler("u1", "fotos-pendentes", []), [ID_FOTO]);
  assert.equal(h.sinc.status(), "erro");
  assert.ok(h.sinc.esperaMs() > 0);
});

test("403 da API que não é do S3 (ex.: origem) não manda o registro para rejeitados", async () => {
  const h = montar({ foto: () => { throw new ErroApi(403, "origem"); } });
  h.mudar(comFoto());
  await h.sinc.sincronizar();
  assert.deepEqual(h.sinc.rejeitados(), []);
  assert.equal(fila(h).length, 1);
  assert.deepEqual(h.local.ler("u1", "fotos-pendentes", []), [ID_FOTO]);
  assert.equal(h.sinc.status(), "erro");
});

test("lista mutada no lugar entre dois registrar: a mudança não se perde", () => {
  const h = montar();
  const est = com({ favs: ["a"] });
  h.sinc.registrar(VAZIO, est);
  est.favs.push("b"); // o app muta a lista no lugar
  h.sinc.registrar(est, est);
  assert.deepEqual(fila(h).map((m) => m.chave).sort(), ["a", "b"]);
});

test("duas instâncias sobre o mesmo armazenamento não apagam a fila uma da outra", () => {
  const local = localFalso();
  const h1 = montar({ local });
  const h2 = montar({ local });
  h1.mudar(com({ favs: ["a"] }));
  h2.mudar(com({ favs: ["b"] }));
  assert.deepEqual(fila(h1).map((m) => m.chave).sort(), ["a", "b"]);
  assert.equal(h1.sinc.pendentes(), 2);
});

test("armazenamento cheio: status erro, aviso local e a mudança é recalculada no próximo registrar", () => {
  const local = localFalso();
  const gravar = local.gravar;
  let cheio = true;
  local.gravar = (u, n, v) => (cheio ? false : gravar(u, n, v));
  const h = montar({ local });
  h.sinc.registrar(VAZIO, com({ favs: ["a"] }));
  assert.equal(h.sinc.status(), "erro");
  assert.ok(h.sinc.avisos().length >= 1);
  cheio = false;
  h.sinc.registrar(VAZIO, com({ favs: ["a", "b"] }));
  assert.deepEqual(fila(h).map((m) => m.chave).sort(), ["a", "b"]);
});

test("criar exige deps.estado", () => {
  assert.throws(() => Sincronia.criar({ api: {}, local: localFalso(), fotos: {}, userId: "u1" }), /estado/);
});

test("foto enviada fica gravada: nova instância e novo registro não reenviam a foto", async () => {
  const local = localFalso();
  let rede = false;
  const h = montar({ local, enviar: () => { if (!rede) throw new ErroApi(0, "rede"); return { conflitos: [] }; } });
  h.mudar(comFoto());
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.fotosEnviadas, [ID_FOTO]);
  assert.equal(h.sinc.status(), "offline");
  rede = true;
  // "reabre o app": instância nova, fotos novas (foiEnviada só em memória, false)
  const h2 = montar({ local, estado: h.estado() });
  await h2.sinc.sincronizar();
  assert.deepEqual(h2.reg.fotosEnviadas, []);
  assert.equal(h2.reg.envios.length, 1);
  // editar o registro com a mesma foto não recoloca a foto na lista
  h2.mudar(com({ registros: { "2026-11-21": { jantar: Object.assign({}, REG_FOTO, { hora: "20:00" }) } } }));
  assert.deepEqual(local.ler("u1", "fotos-pendentes", []), []);
});

test("foto com 400 foto-id ou 403 do S3 é permanente: registro vai para rejeitados", async () => {
  for (const [st, cod] of [[400, "foto-id"], [403, "foto-envio"]]) {
    const h = montar({ foto: () => { throw new ErroApi(st, cod); } });
    h.mudar(Object.assign(comFoto(), { favs: ["a"] }));
    await h.sinc.sincronizar();
    assert.deepEqual(h.sinc.rejeitados(), [{ tipo: "registro", chave: "2026-11-21|jantar", codigo: cod }]);
    assert.deepEqual(h.reg.envios.map((m) => m.map((x) => x.chave)), [["a"]]);
    assert.equal(fila(h).length, 0);
    assert.equal(h.local.ler("u1", "fotos-pendentes", []).length, 0);
  }
});

test("401 chama aoSessaoVencida e para com a fila intacta", async () => {
  const h = montar({ enviar: () => { throw new ErroApi(401, "sessao"); } });
  h.mudar(com({ favs: ["a"] }));
  await h.sinc.sincronizar();
  assert.equal(h.reg.sessao, 1);
  assert.equal(h.reg.baixadas.length, 0);
  assert.equal(fila(h).length, 1);
});

test("falta de rede: status offline, fila intacta, espera cresce e zera no sucesso", async () => {
  let rede = false;
  const h = montar({ enviar: () => { if (!rede) throw new ErroApi(0, "rede"); return { conflitos: [] }; } });
  h.mudar(com({ favs: ["a"] }));
  await h.sinc.sincronizar();
  assert.equal(h.sinc.status(), "offline");
  const e1 = h.sinc.esperaMs();
  await h.sinc.sincronizar();
  const e2 = h.sinc.esperaMs();
  assert.ok(e1 > 0 && e2 > e1, `espera deveria crescer: ${e1} -> ${e2}`);
  assert.equal(fila(h).length, 1);
  rede = true;
  await h.sinc.sincronizar();
  assert.equal(h.sinc.esperaMs(), 0);
  assert.equal(h.sinc.status(), "ok");
});

test("5xx e 429 tentam de novo depois (status erro, fila intacta)", async () => {
  for (const st of [500, 503, 429]) {
    const h = montar({ enviar: () => { throw new ErroApi(st, "x"); } });
    h.mudar(com({ favs: ["a"] }));
    await h.sinc.sincronizar();
    assert.equal(h.sinc.status(), "erro");
    assert.equal(fila(h).length, 1);
    assert.ok(h.sinc.esperaMs() > 0);
  }
});

test("2xx com corpo não-JSON (null) e erro ao ler o corpo viram retentativa, sem derrubar a fila", async () => {
  for (const comportamento of [() => null, () => "texto", () => ({}), () => { throw new TypeError("body stream"); }]) {
    const h = montar({ enviar: comportamento });
    h.mudar(com({ favs: ["a"] }));
    await h.sinc.sincronizar();
    assert.equal(h.sinc.status(), "offline");
    assert.equal(fila(h).length, 1);
    assert.equal(h.reg.baixadas.length, 0);
  }
  const h2 = montar({ baixar: () => null });
  await h2.sinc.sincronizar();
  assert.equal(h2.sinc.status(), "offline");
  assert.equal(h2.local.ler("u1", "cursor", 0), 0);
});

test("rede pendurada: o timeout solta a fila", async () => {
  const h = montar({ timeoutMs: 30, enviar: () => new Promise(() => {}) });
  h.mudar(com({ favs: ["a"] }));
  await h.sinc.sincronizar();
  assert.equal(h.sinc.status(), "offline");
  assert.equal(fila(h).length, 1);
});

test("remoto: tipo desconhecido, chave inválida e registro sem objeto são ignorados com aviso", async () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (...a) => avisos.push(a.join(" "));
  try {
    const h = montar({
      baixar: () => ({
        itens: [
          { tipo: "plano", chave: "x", valor: {}, ativo: true, em: T0, seq: 1 },
          { tipo: "feito", chave: "ruim", valor: null, ativo: true, em: T0, seq: 2 },
          { tipo: "registro", chave: "2026-11-21|jantar", valor: null, ativo: true, em: T0, seq: 3 },
          { tipo: "registro", chave: "2026-11-21|almoco", valor: [1], ativo: true, em: T0, seq: 4 },
          { tipo: "fav", chave: "ok", valor: null, ativo: true, em: T0, seq: 5 }
        ],
        cursor: 5, mais: false
      })
    });
    await h.sinc.sincronizar();
    assert.deepEqual(h.estado().favs, ["ok"]);
    assert.deepEqual(h.estado().registros, {});
    assert.equal(avisos.length, 4);
    assert.equal(h.local.ler("u1", "cursor", 0), 5);
    assert.equal(h.sinc.status(), "ok");
  } finally { console.warn = original; }
});

// O usuário desmarca "b" (em 10:30) enquanto o download está no ar; o remoto traz "b" ativo com o "em" dado.
async function remotoContraFila(emRemoto) {
  let h;
  h = montar({
    estado: com({ favs: ["b"] }),
    baixar: () => {
      h.relogio("2026-11-21T10:30:00.000Z");
      h.mudar(VAZIO);
      return { itens: [{ tipo: "fav", chave: "b", valor: null, ativo: true, em: emRemoto, seq: 9 }], cursor: 9, mais: false };
    }
  });
  await h.sinc.sincronizar();
  return h;
}

test("remoto: mudança local mais nova na fila fica e o item remoto não é aplicado", async () => {
  const h = await remotoContraFila("2026-11-21T10:15:00.000Z");
  assert.deepEqual(h.estado().favs, []);
  assert.equal(fila(h).length, 1);
  assert.equal(fila(h)[0].ativo, false);
  assert.equal(h.local.ler("u1", "cursor", 0), 9);
});

test("remoto: item mais novo que a mudança na fila tira a mudança da fila e é aplicado", async () => {
  const h = await remotoContraFila("2026-11-21T11:00:00.000Z");
  assert.deepEqual(h.estado().favs, ["b"]);
  assert.equal(fila(h).length, 0);
});
