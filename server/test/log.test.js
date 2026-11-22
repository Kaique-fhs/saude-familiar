import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { criarAppTeste, cabecalhos, contaLogada, emailFalso, ACEITE } from './ajuda.js';

function capturaLog() {
  const linhas = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of chunk.toString().split('\n')) if (l.trim()) linhas.push(JSON.parse(l));
      cb();
    },
  });
  return { linhas, logger: { level: 'info', stream } };
}

test('erro 500 é registrado no log, sem corpo da requisição nem senha', async () => {
  const { linhas, logger } = capturaLog();
  const banco = { consulta: async () => { throw new Error('banco-caiu'); } };
  const { app } = await criarAppTeste({ deps: { logger, banco } });
  const r = await app.inject({
    method: 'POST',
    url: '/conta/entrar',
    headers: cabecalhos(),
    payload: { email: 'a@b.com', senha: 'segredo-super-123' },
  });
  assert.equal(r.statusCode, 500);
  const erros = linhas.filter((l) => l.level >= 50);
  assert.ok(erros.some((l) => JSON.stringify(l).includes('banco-caiu')));
  assert.ok(!linhas.some((l) => JSON.stringify(l).includes('segredo-super-123')));
  await app.close();
});

test('falha ao enviar e-mail é registrada no log', async () => {
  const { linhas, logger } = capturaLog();
  const email = { enviar: () => Promise.reject(new Error('smtp-caiu')) };
  const { app } = await criarAppTeste({ deps: { logger, email } });
  const r = await app.inject({
    method: 'POST',
    url: '/conta/cadastro',
    headers: cabecalhos(),
    payload: { email: 'a@b.com', senha: 'senha-de-teste-123', aceite: ACEITE },
  });
  assert.equal(r.statusCode, 202);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.ok(linhas.some((l) => l.level >= 50 && JSON.stringify(l).includes('smtp-caiu')));
  await app.close();
});

test('falha das fotos no DELETE /conta é registrada no log', async () => {
  const { linhas, logger } = capturaLog();
  const armazenamento = {
    urlEnvio: async () => ({}),
    urlLeitura: async () => '',
    apagarPrefixo: async () => { throw new Error('s3-caiu'); },
  };
  const { app, email } = await criarAppTeste({ deps: { logger, armazenamento } });
  const { token } = await contaLogada(app, 'a@b.com');
  const r = await app.inject({
    method: 'DELETE',
    url: '/conta',
    headers: cabecalhos({ authorization: `Bearer ${token}` }),
    payload: { senha: 'senha-de-teste-123' },
  });
  assert.equal(r.statusCode, 204);
  assert.ok(linhas.some((l) => l.level >= 50 && JSON.stringify(l).includes('s3-caiu')));
  await app.close();
});
