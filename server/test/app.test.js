import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';
import { lerConfig } from '../src/config.js';
import { configTeste, cabecalhos } from './ajuda.js';

async function app() {
  return criarApp({ config: configTeste() });
}

test('GET /saude sem cabeçalho secreto responde 200 {ok:true}', async () => {
  const a = await app();
  const r = await a.inject({ method: 'GET', url: '/saude' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  await a.close();
});

test('rota qualquer sem x-saude-origem responde 403, e com valor errado também', async () => {
  const a = await app();
  const sem = await a.inject({ method: 'GET', url: '/nao-existe' });
  assert.equal(sem.statusCode, 403);
  assert.deepEqual(sem.json(), { erro: 'origem' });
  for (const valor of ['errado', 'segredo-teste-mais-longo', '']) {
    const r = await a.inject({ method: 'GET', url: '/nao-existe', headers: { 'x-saude-origem': valor } });
    assert.equal(r.statusCode, 403);
  }
  await a.close();
});

test('GET /nao-existe com o cabeçalho → 404 {erro:"nao-encontrado"}', async () => {
  const a = await app();
  const r = await a.inject({ method: 'GET', url: '/nao-existe', headers: cabecalhos() });
  assert.equal(r.statusCode, 404);
  assert.deepEqual(r.json(), { erro: 'nao-encontrado' });
  await a.close();
});

test('POST com JSON malformado → 400 {erro:"requisicao"}', async () => {
  const a = await app();
  const r = await a.inject({
    method: 'POST', url: '/qualquer',
    headers: cabecalhos({ 'content-type': 'application/json' }),
    payload: '{malformado',
  });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'requisicao' });
  await a.close();
});

test('POST com corpo vazio é aceito como {} (chega ao 404, não ao 400)', async () => {
  const a = await app();
  const r = await a.inject({
    method: 'POST', url: '/nao-existe',
    headers: cabecalhos({ 'content-type': 'application/json' }),
  });
  assert.equal(r.statusCode, 404);
  await a.close();
});

test('CORS: origem do site recebe o cabeçalho; outro site não; localhost só em teste', async () => {
  const a = await app();
  const site = 'https://kaique-fhs.github.io';
  const ok = await a.inject({ method: 'GET', url: '/saude', headers: { origin: site } });
  assert.equal(ok.headers['access-control-allow-origin'], site);
  const outro = await a.inject({ method: 'GET', url: '/saude', headers: { origin: 'https://outro.site' } });
  assert.equal(outro.headers['access-control-allow-origin'], undefined);
  const local = await a.inject({ method: 'GET', url: '/saude', headers: { origin: 'http://localhost:5500' } });
  assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:5500');
  await a.close();

  const prod = await criarApp({ config: configTeste({ ambiente: 'producao' }) });
  const l2 = await prod.inject({ method: 'GET', url: '/saude', headers: { origin: 'http://localhost:5500' } });
  assert.equal(l2.headers['access-control-allow-origin'], undefined);
  await prod.close();
});

test('preflight OPTIONS de DELETE da origem do site permite DELETE', async () => {
  const a = await app();
  const r = await a.inject({
    method: 'OPTIONS', url: '/fotos/1',
    headers: {
      origin: 'https://kaique-fhs.github.io',
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'authorization,x-turnstile-token',
    },
  });
  assert.match(r.headers['access-control-allow-methods'], /DELETE/);
  await a.close();
});

test('lerConfig sem SEGREDO_ORIGEM lança "config: SEGREDO_ORIGEM ausente"', () => {
  assert.throws(
    () => lerConfig({ ORIGEM_SITE: 'https://x' }),
    { message: 'config: SEGREDO_ORIGEM ausente' },
  );
  assert.throws(
    () => lerConfig({ SEGREDO_ORIGEM: 's' }),
    { message: 'config: ORIGEM_SITE ausente' },
  );
});

test('lerConfig aplica os padrões', () => {
  const c = lerConfig({ ORIGEM_SITE: 'https://x', SEGREDO_ORIGEM: 's' });
  assert.equal(c.porta, 3000);
  assert.equal(c.smtp.porta, 465);
  assert.equal(c.tetoEmailsDia, 300);
  assert.equal(c.s3.regiao, 'us-east-2');
});

test('TETO_EMAILS_DIA inválido lança config: TETO_EMAILS_DIA inválido', () => {
  const base = { ORIGEM_SITE: 'https://x', SEGREDO_ORIGEM: 's' };
  assert.throws(() => lerConfig({ ...base, TETO_EMAILS_DIA: 'abc' }), /config: TETO_EMAILS_DIA inválido/);
  for (const nome of ['PORT', 'SMTP_PORT', 'TRUST_PROXY_SALTOS']) {
    for (const ruim of ['abc', '0', '-1', '1.5']) {
      assert.throws(() => lerConfig({ ...base, [nome]: ruim }), new RegExp(`config: ${nome} inválido`));
    }
  }
  assert.equal(lerConfig(base).trustProxySaltos, 1);
});

test('DB_POOL_MAX: padrão 5, valor do env e inválido lança config: DB_POOL_MAX inválido', () => {
  const base = { ORIGEM_SITE: 'https://x', SEGREDO_ORIGEM: 's' };
  assert.equal(lerConfig(base).dbPoolMax, 5);
  assert.equal(lerConfig({ ...base, DB_POOL_MAX: '3' }).dbPoolMax, 3);
  for (const ruim of ['abc', '0', '-1', '1.5']) {
    assert.throws(() => lerConfig({ ...base, DB_POOL_MAX: ruim }), /config: DB_POOL_MAX inválido/);
  }
});

test('TRUST_PROXY_SALTOS=2: request.ip é o 2º endereço a partir da direita do X-Forwarded-For', async () => {
  const a = await criarApp({
    config: configTeste({ trustProxySaltos: 2 }),
    banco: {},
    email: {},
    captcha: {},
    armazenamento: {},
    limites: false,
  });
  a.get('/ip', async (req) => ({ ip: req.ip }));
  const r = await a.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '127.0.0.1',
    headers: cabecalhos({ 'x-forwarded-for': '9.9.9.9, 1.1.1.1, 2.2.2.2' }),
  });
  assert.equal(r.json().ip, '1.1.1.1');
  await a.close();
});
