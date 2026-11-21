import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazenamentoDev, registrarRotasDev } from '../src/armazenamento-dev.js';
import { criarApp } from '../src/app.js';
import { configTeste } from './ajuda.js';

const BASE = 'http://localhost:3000';

async function pastaTemp() {
  return mkdtemp(join(tmpdir(), 'sf-fotos-dev-'));
}

function multipart(campos, arquivo) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  if (arquivo) f.append('file', new Blob([arquivo], { type: 'image/jpeg' }), 'foto.jpg');
  return f;
}

async function enviar(app, form) {
  const r = new Response(form);
  const corpo = Buffer.from(await r.arrayBuffer());
  return app.inject({
    method: 'POST',
    url: '/dev-fotos',
    headers: { 'content-type': r.headers.get('content-type') },
    payload: corpo,
  });
}

test('urlEnvio devolve /dev-fotos com campo key', async () => {
  const arm = criarArmazenamentoDev({ pasta: 'x', baseUrl: BASE });
  assert.deepEqual(await arm.urlEnvio('dev/u1/f-1.jpg'), {
    url: `${BASE}/dev-fotos`,
    campos: { key: 'dev/u1/f-1.jpg' },
  });
});

test('urlLeitura devolve /dev-fotos/<chave codificada>', async () => {
  const arm = criarArmazenamentoDev({ pasta: 'x', baseUrl: BASE });
  assert.equal(await arm.urlLeitura('dev/u1/f-1.jpg'), `${BASE}/dev-fotos/${encodeURIComponent('dev/u1/f-1.jpg')}`);
});

test('POST /dev-fotos grava e GET /dev-fotos/<key> devolve os mesmos bytes', async () => {
  const pasta = await pastaTemp();
  const app = await criarApp({ config: configTeste(), rotasLivres: ['/dev-fotos'] });
  registrarRotasDev(app, { pasta });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 250]);
  const chave = 'dev/u1/f-2026-11-21-a-1.jpg';
  const post = await enviar(app, multipart({ key: chave }, bytes));
  assert.equal(post.statusCode, 204);
  const arm = criarArmazenamentoDev({ pasta, baseUrl: BASE });
  const url = new URL(await arm.urlLeitura(chave));
  const get = await app.inject({ method: 'GET', url: url.pathname });
  assert.equal(get.statusCode, 200);
  assert.match(get.headers['content-type'], /^image\/jpeg/);
  assert.deepEqual(get.rawPayload, bytes);
  await app.close();
  await rm(pasta, { recursive: true, force: true });
});

test('POST /dev-fotos recusa chave que sai da pasta e GET de foto inexistente dá 404', async () => {
  const pasta = await pastaTemp();
  const app = await criarApp({ config: configTeste(), rotasLivres: ['/dev-fotos'] });
  registrarRotasDev(app, { pasta });
  const ruim = await enviar(app, multipart({ key: '../fora.jpg' }, Buffer.from([1])));
  assert.equal(ruim.statusCode, 400);
  const semKey = await enviar(app, multipart({}, Buffer.from([1])));
  assert.equal(semKey.statusCode, 400);
  const get = await app.inject({ method: 'GET', url: '/dev-fotos/nao%2Fexiste.jpg' });
  assert.equal(get.statusCode, 404);
  await app.close();
  await rm(pasta, { recursive: true, force: true });
});

test('apagarPrefixo apaga a subpasta e deixa as outras', async () => {
  const pasta = await pastaTemp();
  await mkdir(join(pasta, 'dev', 'u1'), { recursive: true });
  await mkdir(join(pasta, 'dev', 'u2'), { recursive: true });
  await writeFile(join(pasta, 'dev', 'u1', 'a.jpg'), 'a');
  await writeFile(join(pasta, 'dev', 'u2', 'b.jpg'), 'b');
  const arm = criarArmazenamentoDev({ pasta, baseUrl: BASE });
  await arm.apagarPrefixo('dev/u1/');
  assert.deepEqual(await readdir(join(pasta, 'dev')), ['u2']);
  await arm.apagarPrefixo('dev/inexistente/'); // não lança
  await rm(pasta, { recursive: true, force: true });
});

test('apagarPrefixo sem / final lança', async () => {
  const arm = criarArmazenamentoDev({ pasta: 'x', baseUrl: BASE });
  await assert.rejects(arm.apagarPrefixo('dev/u1'), /prefixo/);
  await assert.rejects(arm.apagarPrefixo(undefined), /prefixo/);
});
