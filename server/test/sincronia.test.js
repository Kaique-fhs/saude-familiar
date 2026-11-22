import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAppTeste, cabecalhos, contaLogada } from './ajuda.js';
import { decidir } from '../src/sincronia.js';

const bearer = (token) => cabecalhos({ authorization: `Bearer ${token}` });
const enviar = (app, token, mudancas) =>
  app.inject({ method: 'POST', url: '/sync', headers: bearer(token), payload: { mudancas } });
const ler = (app, token, qs = '') => app.inject({ method: 'GET', url: `/sync${qs}`, headers: bearer(token) });
const m = (extra) => ({ tipo: 'fav', chave: 'x', valor: null, ativo: true, em: '2026-11-21T10:00:00Z', ...extra });
const item = (extra) => ({ ...m(), seq: 1, ...extra });

test('decidir: sem atual aplica', () => {
  assert.equal(decidir(null, m()), 'aplicar');
});
test('decidir: mais nova aplica, mais velha e empate ignoram', () => {
  const atual = item();
  assert.equal(decidir(atual, m({ em: '2026-11-21T10:00:01Z' })), 'aplicar');
  assert.equal(decidir(atual, m({ em: '2026-11-21T09:59:59Z' })), 'ignorar');
  assert.equal(decidir(atual, m({ em: '2026-11-21T10:00:00.000Z' })), 'ignorar');
});
test('decidir: compara por instante, não por texto', () => {
  const atual = item({ em: '2026-11-21T10:00:00Z' });
  assert.equal(decidir(atual, m({ em: '2026-11-21T07:30:00-03:00' })), 'aplicar');
});
test('decidir: registro com foto', () => {
  const atual = item({ tipo: 'registro', valor: { foto: 'a' } });
  assert.equal(decidir(atual, m({ tipo: 'registro', valor: { foto: 'b' }, em: '2027-01-01T00:00:00Z' })), 'conflito');
  assert.equal(decidir(atual, m({ tipo: 'registro', valor: { foto: 'a' }, em: '2027-01-01T00:00:00Z' })), 'ignorar');
});
test('decidir: registro sem foto e mais novo aplica', () => {
  const atual = item({ tipo: 'registro', valor: { nota: 1 } });
  assert.equal(decidir(atual, m({ tipo: 'registro', valor: { nota: 2 }, em: '2026-11-21T11:00:00Z' })), 'aplicar');
});

test('marcação velha chegando depois não desfaz a nova', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  const chave = '2026-11-21|receita_1';
  await enviar(app, token, [m({ tipo: 'feito', chave, ativo: false, em: '2026-11-21T10:00:00Z' })]);
  await enviar(app, token, [m({ tipo: 'feito', chave, ativo: true, em: '2026-11-21T09:00:00Z' })]);
  const r = (await ler(app, token)).json();
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].ativo, false);
  await app.close();
});

test('marcações de aparelhos diferentes em chaves diferentes se somam', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  await enviar(app, token, [m({ tipo: 'fav', chave: 'a' })]);
  await enviar(app, token, [m({ tipo: 'fav', chave: 'b' })]);
  const r = (await ler(app, token)).json();
  assert.deepEqual(r.itens.map((i) => i.chave), ['a', 'b']);
  assert.ok(r.itens.every((i) => typeof i.seq === 'number'));
  await app.close();
});

test('registro com foto: segundo envio com outra foto devolve a versão do servidor em conflitos', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  const chave = '2026-11-21|prato';
  await enviar(app, token, [m({ tipo: 'registro', chave, valor: { foto: 'f1' } })]);
  const r = await enviar(app, token, [m({ tipo: 'registro', chave, valor: { foto: 'f2' }, em: '2026-11-21T11:00:00Z' })]);
  assert.equal(r.statusCode, 200);
  const { conflitos } = r.json();
  assert.equal(conflitos.length, 1);
  assert.deepEqual(conflitos[0].valor, { foto: 'f1' });
  assert.equal(conflitos[0].chave, chave);
  assert.equal(typeof conflitos[0].seq, 'number');
  const itens = (await ler(app, token)).json().itens;
  assert.deepEqual(itens[0].valor, { foto: 'f1' });
  await app.close();
});

test('em no futuro distante é limitado a agora+5min', async () => {
  const { app, relogio } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  await enviar(app, token, [m({ em: '2099-01-01T00:00:00Z' })]);
  const it = (await ler(app, token)).json().itens[0];
  assert.equal(new Date(it.em).getTime(), relogio().getTime() + 5 * 60 * 1000);
  await app.close();
});

test('GET /sync pagina com cursor', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  await enviar(app, token, [m({ chave: 'a' }), m({ chave: 'b' }), m({ chave: 'c' })]);
  const p1 = (await ler(app, token, '?limite=2')).json();
  assert.equal(p1.itens.length, 2);
  assert.equal(p1.mais, true);
  assert.equal(p1.cursor, p1.itens[1].seq);
  const p2 = (await ler(app, token, `?depois=${p1.cursor}&limite=2`)).json();
  assert.deepEqual(p2.itens.map((i) => i.chave), ['c']);
  assert.equal(p2.mais, false);
  const p3 = (await ler(app, token, `?depois=${p2.cursor}`)).json();
  assert.deepEqual(p3, { itens: [], cursor: p2.cursor, mais: false });
  await app.close();
});

test('usuário A não recebe itens de B no GET /sync', async () => {
  const { app } = await criarAppTeste();
  const a = await contaLogada(app, 'a@b.com');
  const b = await contaLogada(app, 'b@b.com');
  await enviar(app, a.token, [m({ chave: 'so-a' })]);
  await enviar(app, b.token, [m({ chave: 'so-b' })]);
  assert.deepEqual((await ler(app, a.token)).json().itens.map((i) => i.chave), ['so-a']);
  assert.deepEqual((await ler(app, b.token)).json().itens.map((i) => i.chave), ['so-b']);
  await app.close();
});

test('validação: 400 sync', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  const ruins = [
    [m({ tipo: 'feito', chave: 'sem-data' })],
    [m({ tipo: 'treino', chave: '2026-11-21|Maiuscula' })],
    [m({ tipo: 'outro' })],
    [m({ chave: '' })],
    [m({ chave: 'x'.repeat(201) })],
    [m({ valor: 'x'.repeat(65 * 1024) })],
    [m({ em: 'ontem' })],
    [m({ ativo: 'sim' })],
    [],
    Array.from({ length: 501 }, (_, i) => m({ chave: `k${i}` })),
  ];
  for (const mudancas of ruins) {
    const r = await enviar(app, token, mudancas);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.json(), { erro: 'sync' });
  }
  const sem = await app.inject({ method: 'POST', url: '/sync', headers: bearer(token), payload: {} });
  assert.equal(sem.statusCode, 400);
  const ok = await enviar(app, token, [m({ tipo: 'feito', chave: '2026-11-21|r_1-a' })]);
  assert.equal(ok.statusCode, 200);
  await app.close();
});

test('sem sessão: 401', async () => {
  const { app } = await criarAppTeste();
  const r = await app.inject({ method: 'GET', url: '/sync', headers: cabecalhos() });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('envios simultâneos do mesmo usuário não pulam nem duplicam', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  await Promise.all(Array.from({ length: 5 }, (_, i) => enviar(app, token, [m({ chave: `k${i}` })])));
  const r = (await ler(app, token)).json();
  assert.equal(r.itens.length, 5);
  await app.close();
});

test('plano e meta: chave e valor validados', async () => {
  const { app } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  const bons = [
    m({ tipo: 'plano', chave: '2026-11-22', valor: { refeicoes: [] } }),
    m({ tipo: 'meta', chave: 'm-abc', valor: { id: 'm-abc' } }),
    m({ tipo: 'meta', chave: 'm-x', valor: null, ativo: false }),
  ];
  for (const b of bons) {
    const r = await enviar(app, token, [b]);
    assert.equal(r.statusCode, 200);
  }
  const ruins = [
    m({ tipo: 'plano', chave: 'ontem', valor: { refeicoes: [] } }),
    m({ tipo: 'meta', chave: 'M A', valor: { id: 'x' } }),
    m({ tipo: 'plano', chave: 'inicio', valor: 'texto' }),
    m({ tipo: 'plano', chave: 'inicio', valor: [] }),
  ];
  for (const r0 of ruins) {
    const r = await enviar(app, token, [r0]);
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.json(), { erro: 'sync' });
  }
  await app.close();
});
