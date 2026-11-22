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

test("rebase: aba B relê o estado gravado pela aba A e não reenfileira as chaves de A", () => {
  const local = localFalso();
  const hB = montar({ local });
  hB.mudar(com({ sel: ["x"] }));                       // ref de B = { sel: [x] }
  const hA = montar({ local, estado: com({ sel: ["x"] }) });
  hA.relogio("2026-11-21T10:00:05.000Z");
  hA.mudar(com({ sel: ["x"], favs: ["a"] }));           // A favorita "a"
  local.gravar("u1", "fila", []);                       // A já enviou tudo
  // B recebe o evento storage, relê o estado e faz o rebase
  const relido = com({ sel: ["x"], favs: ["a"] });
  hB.sinc.rebase(relido);
  hB.relogio("2026-11-21T10:00:09.000Z");
  hB.mudar(com({ sel: ["x"], favs: ["a"], despensa: ["b"] }));
  assert.deepEqual(fila(hB).map((m) => m.tipo + "|" + m.chave), ["quero|b"]);
});

test("rebase guarda uma cópia: mexer no estado depois não muda a referência", () => {
  const h = montar();
  const e = com({ favs: ["a"] });
  h.sinc.rebase(e);
  e.favs.push("b"); // mutação no lugar, como o app faz
  h.mudar(com({ favs: ["a", "b"] }));
  assert.deepEqual(fila(h).map((m) => m.chave), ["b"]);
});

// ---------- integração: SF.local + SF.dados + SF.fotos reais, dois aparelhos da mesma conta ----------
const Local = require("../js/sf-local.js");
const Fotos = require("../js/sf-fotos.js");

function storageMemoria() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

// Servidor em memória: fica a mudança mais nova de cada tipo|chave; /sync devolve por número de sequência.
function servidorFalso() {
  const itens = new Map();
  const fotos = new Map();
  let seq = 0;
  return {
    fotos,
    api: {
      enviarMudancas: async (mudancas) => {
        const conflitos = [];
        mudancas.forEach((m) => {
          const k = m.tipo + "|" + m.chave;
          const atual = itens.get(k);
          if (atual && new Date(atual.em) > new Date(m.em)) { conflitos.push(atual); return; }
          itens.set(k, Object.assign({}, m, { seq: ++seq }));
        });
        return { conflitos };
      },
      baixar: async (depois, limite) => {
        const lista = [...itens.values()].filter((i) => i.seq > depois).sort((a, b) => a.seq - b.seq);
        const pagina = lista.slice(0, limite);
        const cursor = pagina.length ? pagina[pagina.length - 1].seq : depois;
        return { itens: pagina.map(({ seq: _s, ...i }) => i), cursor, mais: lista.length > limite };
      },
      urlEnvioFoto: async (id) => ({ url: "http://s3/up/" + id, campos: { key: id } }),
      urlFoto: async (id) => ({ url: "http://s3/ler/" + id })
    },
    fetch: async (url, init) => {
      if (url.startsWith("http://s3/up/")) {
        fotos.set(url.slice("http://s3/up/".length), init.body.get("file"));
        return { ok: true, status: 204 };
      }
      const id = url.slice("http://s3/ler/".length);
      if (!fotos.has(id)) return { ok: false, status: 404 };
      return { ok: true, status: 200, blob: async () => fotos.get(id) };
    }
  };
}

// Um aparelho: lê e grava o estado como o app (SF.local no prefixo do usuário, nomes de SF.dados.NOMES).
function aparelho(srv, relogio, storage) {
  const local = Local.criar({ storage: storage || storageMemoria() });
  const banco = new Map();
  const bancoFotos = { ler: async (id) => banco.get(id), gravar: async (id, b) => { banco.set(id, b); } };
  const fotos = Fotos.criar({ api: srv.api, fetch: srv.fetch, banco: bancoFotos, ErroApi });
  function lerEstado() {
    const e = Dados.estadoVazio();
    Object.keys(Dados.NOMES).forEach((n) => { e[Dados.NOMES[n]] = local.ler("u1", n, e[Dados.NOMES[n]]); });
    return e;
  }
  function gravarEstado(e) { Object.keys(Dados.NOMES).forEach((n) => local.gravar("u1", n, e[Dados.NOMES[n]])); }
  const sinc = Sincronia.criar({
    api: srv.api, local, fotos, userId: "u1", ErroApi,
    agora: relogio, estado: lerEstado, aoMudarEstado: gravarEstado, timeoutMs: 1000
  });
  return {
    local, banco, fotos, sinc, lerEstado,
    // como o recarregarEstado do app ao receber o evento storage de outra aba
    releu: () => sinc.rebase(lerEstado()),
    salvar: (muda) => { const antes = lerEstado(); const depois = Dados.aplicar(antes, []); muda(depois); gravarEstado(depois); sinc.registrar(antes, depois); }
  };
}

test("integração: favorita + diário + registro com foto sobem e o outro aparelho chega ao mesmo estado com a foto", async () => {
  const srv = servidorFalso();
  let t = Date.parse(T0);
  const relogio = () => new Date(t += 1000).toISOString();
  const a = aparelho(srv, relogio);
  const b = aparelho(srv, relogio);

  a.banco.set(ID_FOTO, new Blob(["jpg"], { type: "image/jpeg" }));
  a.salvar((e) => {
    e.favs.push("bolo-banana");
    e.diario["2026-11-21"] = ["cafe", "jantar"];
    e.registros["2026-11-21"] = { jantar: REG_FOTO };
  });
  assert.equal(a.sinc.pendentes(), 5); // fav + 2 feitos + registro + 1 foto
  await a.sinc.sincronizar();
  assert.equal(a.sinc.status(), "ok");
  assert.equal(a.sinc.pendentes(), 0);
  assert.ok(srv.fotos.has(ID_FOTO));

  await b.sinc.sincronizar();
  assert.deepEqual(b.lerEstado(), a.lerEstado());
  assert.equal(b.sinc.pendentes(), 0);
  // a foto chega sob demanda (o app chama garantir ao desenhar o registro)
  const blob = await b.fotos.garantir(ID_FOTO);
  assert.equal(await blob.text(), "jpg");
  assert.ok(b.banco.has(ID_FOTO));

  // e a volta: o aparelho B desmarca a favorita, o A recebe
  b.salvar((e) => { e.favs = []; });
  await b.sinc.sincronizar();
  await a.sinc.sincronizar();
  assert.deepEqual(a.lerEstado(), b.lerEstado());
  assert.deepEqual(a.lerEstado().favs, []);
  assert.equal(a.sinc.pendentes(), 0);
});

test("integração: aba B relê (evento storage) o que a aba A gravou e não desfaz a mudança de outro aparelho", async () => {
  const srv = servidorFalso();
  let t = Date.parse(T0);
  const relogio = () => new Date(t += 1000).toISOString();
  const compartilhado = storageMemoria();
  const abaA = aparelho(srv, relogio, compartilhado);
  const abaB = aparelho(srv, relogio, compartilhado);
  const outro = aparelho(srv, relogio);

  abaB.salvar((e) => { e.sel.push("x"); });           // a aba B já tem uma referência
  abaA.salvar((e) => { e.favs.push("a"); });          // a aba A favorita "a" e envia
  await abaA.sinc.sincronizar();
  await outro.sinc.sincronizar();
  outro.salvar((e) => { e.favs = []; });               // outro aparelho desfavorita "a", depois
  await outro.sinc.sincronizar();

  abaB.releu();                                        // evento storage na aba B
  abaB.salvar((e) => { e.despensa.push("b"); });
  assert.deepEqual(abaB.local.ler("u1", "fila", []).map((m) => m.tipo + "|" + m.chave), ["quero|b"]);
  await abaB.sinc.sincronizar();
  await outro.sinc.sincronizar();
  assert.deepEqual(outro.lerEstado().favs, []);        // "a" não ressuscitou
  assert.deepEqual(outro.lerEstado().despensa, ["b"]);
});

// ---------- mudança que não coube na fila (armazenamento cheio) ----------
function localQueFalha(falha) {
  const l = localFalso();
  const gravar = l.gravar;
  l.gravar = (u, n, v) => (n === "fila" && falha.sim ? false : gravar(u, n, v));
  return l;
}

test("fila não gravou: rebase não engole a mudança, pendentes() conta e o próximo registrar enfileira", () => {
  const falha = { sim: true };
  const local = localQueFalha(falha);
  const h = montar({ local });
  h.mudar(com({ favs: ["r1"] }));                 // gravação falha
  assert.equal(fila(h).length, 0);
  h.sinc.rebase(com({ favs: ["r1"] }));           // visibilitychange / storage
  assert.ok(h.sinc.pendentes() >= 1, "mudança não gravada conta como pendente");
  assert.equal(h.sinc.status(), "erro");
  falha.sim = false;
  h.relogio("2026-11-21T10:00:05.000Z");
  h.mudar(com({ favs: ["r1"], sel: ["r2"] }));    // agora há espaço
  assert.deepEqual(fila(h).map((m) => m.tipo + "|" + m.chave).sort(), ["fav|r1", "sel|r2"]);
  assert.equal(h.sinc.pendentes(), 2);
  assert.notEqual(h.sinc.status(), "erro");
});

test("fila não gravou: aplicarRemotos não troca a referência pela memória; a diferença entra na fila depois", async () => {
  const falha = { sim: true };
  const local = localQueFalha(falha);
  const h = montar({
    local,
    baixar: async (depois) => (depois === 0
      ? { itens: [{ tipo: "sel", chave: "z", valor: null, ativo: true, em: "2026-11-21T09:00:00.000Z" }], cursor: 1, mais: false }
      : { itens: [], cursor: depois, mais: false })
  });
  h.mudar(com({ favs: ["r1"] }));                 // falha; memória à frente da referência
  await h.sinc.sincronizar();
  assert.ok(h.sinc.pendentes() >= 1);
  falha.sim = false;
  h.relogio("2026-11-21T10:00:05.000Z");
  h.mudar(com({ favs: ["r1"], sel: ["z"] }));
  assert.ok(fila(h).some((m) => m.tipo === "fav" && m.chave === "r1"), "fav|r1 foi enfileirada");
});

test("desfazer a mudança que não coube desliga o erro", () => {
  const falha = { sim: true };
  const h = montar({ local: localQueFalha(falha) });
  h.mudar(com({ favs: ["r1"] }));                 // não coube
  assert.equal(h.sinc.status(), "erro");
  assert.equal(h.sinc.pendentes(), 1);
  falha.sim = false;
  h.mudar(VAZIO);                                 // desfeita: igual ao ref
  assert.equal(h.sinc.status(), "ok");
  assert.equal(h.sinc.pendentes(), 0);
});

test("remoto que cobre a pendência não gravada desliga o erro", async () => {
  const falha = { sim: true };
  const h = montar({
    local: localQueFalha(falha),
    baixar: async (depois) => (depois === 0
      ? { itens: [{ tipo: "fav", chave: "r1", valor: null, ativo: true, em: "2026-11-21T11:00:00.000Z" }], cursor: 1, mais: false }
      : { itens: [], cursor: depois, mais: false })
  });
  h.mudar(com({ favs: ["r1"] }));                 // não coube
  assert.equal(h.sinc.status(), "erro");
  await h.sinc.sincronizar();                     // o remoto traz o mesmo favorito
  assert.equal(h.sinc.status(), "ok");
  assert.equal(h.sinc.pendentes(), 0);
});

test("aparelho com cursor antigo baixa desde o zero uma vez", async () => {
  const local = localFalso();
  local.gravar("u1", "cursor", 900);
  const h = montar({
    local,
    baixar: async (depois) => (depois === 0
      ? { itens: [], cursor: 5, mais: false }
      : { itens: [], cursor: depois, mais: false })
  });
  await h.sinc.sincronizar();
  assert.equal(h.reg.baixadas[0][0], 0);
  assert.equal(local.ler("u1", "cursor-versao", 0), 2);
  assert.equal(local.ler("u1", "cursor", 0), 5);
  await h.sinc.sincronizar();
  assert.equal(h.reg.baixadas[1][0], 5);
});

test("queda no meio do recomeço retoma do cursor salvo", async () => {
  const local = localFalso();
  local.gravar("u1", "cursor", 900);
  let falhar = true;
  const h = montar({
    local,
    baixar: async (depois) => {
      if (depois === 0) return { itens: [], cursor: 3, mais: true };
      if (depois === 3 && falhar) { falhar = false; throw new ErroApi(0, "rede"); }
      return { itens: [], cursor: 8, mais: false };
    }
  });
  await h.sinc.sincronizar();
  assert.equal(local.ler("u1", "cursor", 0), 3);
  await h.sinc.sincronizar();
  assert.deepEqual(h.reg.baixadas.map((b) => b[0]), [0, 3, 3]);
  assert.equal(local.ler("u1", "cursor", 0), 8);
});

test("cursor que não coube no recomeço não grava cursor-versao e a próxima sincronização recomeça do zero", async () => {
  const local = localFalso();
  local.gravar("u1", "cursor", 900);
  const gravar = local.gravar;
  const falha = { sim: true };
  local.gravar = (u, n, v) => (n === "cursor" && falha.sim ? false : gravar(u, n, v));
  const h = montar({
    local,
    baixar: async (depois) => (depois === 0
      ? { itens: [], cursor: 5, mais: false }
      : { itens: [], cursor: depois, mais: false })
  });
  await h.sinc.sincronizar();
  assert.ok(local.ler("u1", "cursor-versao", 0) < 2, "versão não avança sem o cursor gravado");
  falha.sim = false;
  await h.sinc.sincronizar();
  assert.equal(h.reg.baixadas[1][0], 0);
  assert.equal(local.ler("u1", "cursor-versao", 0), 2);
});

test("plano e meta remotos aplicados; ativos sem valor objeto são ignorados", async () => {
  const P = { refeicoes: [], nutrientes: null, compras: [], prescritoEm: null };
  const M = { id: "m-1", origem: "manual", nome: "Correr", modo: "dias", dias: [2], vezes: 0, minutos: 20, desde: "2026-11-01", ate: null };
  const h = montar({
    baixar: () => ({ itens: [
      { tipo: "plano", chave: "2026-11-22", valor: P, ativo: true, em: T0, seq: 1 },
      { tipo: "meta", chave: "m-1", valor: M, ativo: true, em: T0, seq: 2 },
      { tipo: "plano", chave: "inicio", valor: null, ativo: true, em: T0, seq: 3 },
      { tipo: "meta", chave: "m-2", valor: [1], ativo: true, em: T0, seq: 4 }
    ], cursor: 4, mais: false })
  });
  await h.sinc.sincronizar();
  assert.deepEqual(h.estado().planos, { "2026-11-22": P });
  assert.deepEqual(h.estado().metas, { "m-1": M });
  h.sinc.registrar(VAZIO, h.estado());
  assert.deepEqual(fila(h), []);
});
