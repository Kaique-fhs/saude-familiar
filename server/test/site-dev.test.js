import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarManipuladorSite } from '../src/site-dev.js';

const CONFIG = { apiUrl: 'http://127.0.0.1:3000', turnstileChave: 'k', cabecalhoOrigemDev: 'dev' };

async function subir() {
  const raiz = await mkdtemp(join(tmpdir(), 'sf-site-'));
  await writeFile(join(raiz, 'index.html'), '<h1>oi</h1>');
  await writeFile(join(raiz, 'config.js'), 'window.SF_CONFIG = { apiUrl: "" };');
  await writeFile(join(raiz, 'styles.css'), 'a{}');
  await writeFile(join(raiz, '.env'), 'segredo');
  for (const pasta of ['server', '.git', '.superpowers', 'node_modules']) {
    await mkdir(join(raiz, pasta), { recursive: true });
    await writeFile(join(raiz, pasta, 'x.txt'), 'proibido');
  }
  await writeFile(join(raiz, '..', 'fora-sf.txt'), 'fora').catch(() => {});
  const srv = http.createServer(criarManipuladorSite({ raiz, configDev: CONFIG }));
  srv.unref();
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const fim = async () => {
    srv.close();
    await rm(raiz, { recursive: true, force: true });
    await rm(join(raiz, '..', 'fora-sf.txt'), { force: true });
  };
  return { base, fim };
}

// fetch normaliza ../; o http.get cru mantém o caminho como foi escrito.
const cru = (base, caminho) =>
  new Promise((ok, falha) => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: caminho }, (r) => {
      r.resume();
      r.on('end', () => ok(r.statusCode));
    }).on('error', falha);
  });

test('/config.js devolve os valores de dev, não o arquivo versionado', async () => {
  const { base, fim } = await subir();
  const r = await fetch(`${base}/config.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(await r.text(), `window.SF_CONFIG = ${JSON.stringify(CONFIG)};\n`);
  await fim();
});

test('serve arquivos do site com o tipo certo; / abre o index.html', async () => {
  const { base, fim } = await subir();
  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  const raiz = await fetch(`${base}/`);
  assert.match(raiz.headers.get('content-type'), /^text\/html/);
  assert.equal(await raiz.text(), '<h1>oi</h1>');
  assert.equal((await fetch(`${base}/nao-existe.js`)).status, 404);
  await fim();
});

test('../, pastas proibidas e dotfiles dão 404', async () => {
  const { base, fim } = await subir();
  for (const c of ['/../fora-sf.txt', '/%2e%2e/fora-sf.txt', '/..%2Ffora-sf.txt', '/a/../../fora-sf.txt', '/..%5Cfora-sf.txt']) {
    assert.equal(await cru(base, c), 404, c);
  }
  for (const c of ['/server/x.txt', '/SERVER/x.txt', '/.git/x.txt', '/.superpowers/x.txt', '/node_modules/x.txt', '/.env', '/server']) {
    assert.equal(await cru(base, c), 404, c);
  }
  await fim();
});
