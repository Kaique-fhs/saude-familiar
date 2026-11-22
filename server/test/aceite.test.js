import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAppTeste, cabecalhos, tokenDoEmail, contaLogada } from './ajuda.js';

const SENHA = 'senha-de-teste-123';
const OK = { versao: '1', saude: true, transferencia: true };
const cadastrar = (app, email, aceite) =>
  app.inject({ method: 'POST', url: '/conta/cadastro', headers: cabecalhos(), payload: { email, senha: SENHA, aceite } });
const aceites = async (banco) =>
  (await banco.consulta('select user_id, tipo, versao, em from aceites order by tipo')).rows;

test('cadastro sem os dois aceites da versão atual → 400 aceite, sem gravar nada nem enviar e-mail', async () => {
  const { app, banco, email } = await criarAppTeste();
  const ruins = [
    undefined, null, true, [], {},
    { ...OK, versao: '0' }, { ...OK, versao: 1 },
    { ...OK, saude: false }, { ...OK, saude: 'true' },
    { ...OK, transferencia: undefined }, { ...OK, transferencia: 1 },
  ];
  for (const aceite of ruins) {
    const r = await cadastrar(app, 'a@b.com', aceite);
    assert.equal(r.statusCode, 400, JSON.stringify(aceite));
    assert.deepEqual(r.json(), { erro: 'aceite' });
  }
  assert.equal((await banco.consulta('select count(*)::int as n from usuarios')).rows[0].n, 0);
  assert.equal(email.enviados.length, 0);
  await app.close();
});

test('cadastro grava um aceite por finalidade, com versão e data do servidor', async () => {
  const { app, banco, relogio } = await criarAppTeste();
  assert.equal((await cadastrar(app, 'a@b.com', { ...OK, em: '2001-01-01T00:00:00Z' })).statusCode, 202);
  const linhas = await aceites(banco);
  assert.deepEqual(linhas.map((l) => [l.tipo, l.versao]), [['saude', '1'], ['transferencia', '1']]);
  for (const l of linhas) assert.equal(new Date(l.em).getTime(), relogio().getTime());
  await app.close();
});

test('recadastro de e-mail não confirmado atualiza a data do aceite, sem duplicar', async () => {
  const { app, banco, relogio } = await criarAppTeste();
  await cadastrar(app, 'a@b.com', OK);
  relogio.avancar(3600 * 1000);
  await cadastrar(app, 'a@b.com', OK);
  const linhas = await aceites(banco);
  assert.equal(linhas.length, 2);
  for (const l of linhas) assert.equal(new Date(l.em).getTime(), relogio().getTime());
  await app.close();
});

test('e-mail já confirmado: cadastro de outra pessoa não mexe no aceite da conta e responde igual', async () => {
  const { app, banco, email, relogio } = await criarAppTeste();
  await cadastrar(app, 'a@b.com', OK);
  const token = tokenDoEmail(email, '#confirmar=');
  await app.inject({ method: 'POST', url: '/conta/confirmar', headers: cabecalhos(), payload: { token } });
  const antes = await aceites(banco);
  relogio.avancar(3600 * 1000);
  const r = await cadastrar(app, 'a@b.com', OK);
  assert.equal(r.statusCode, 202);
  assert.deepEqual(r.json(), { ok: true });
  assert.deepEqual(await aceites(banco), antes);
  await app.close();
});

test('apagar a conta apaga os aceites', async () => {
  const { app, banco } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com', { senha: SENHA });
  assert.equal((await aceites(banco)).length, 2);
  const r = await app.inject({
    method: 'DELETE', url: '/conta', headers: cabecalhos({ authorization: `Bearer ${token}` }), payload: { senha: SENHA },
  });
  assert.equal(r.statusCode, 204);
  assert.equal((await aceites(banco)).length, 0);
  await app.close();
});

test('link de confirmação de cadastro sem aceite da versão atual não vira conta', async () => {
  for (const preparo of ['delete from aceites', "update aceites set versao = '0'", "delete from aceites where tipo = 'saude'"]) {
    const { app, banco, email } = await criarAppTeste();
    await cadastrar(app, 'a@b.com', OK);
    await banco.consulta(preparo);
    const token = tokenDoEmail(email, '#confirmar=');
    const r = await app.inject({ method: 'POST', url: '/conta/confirmar', headers: cabecalhos(), payload: { token } });
    assert.equal(r.statusCode, 400, preparo);
    assert.deepEqual(r.json(), { erro: 'token' });
    assert.equal((await banco.consulta('select confirmado_em from usuarios')).rows[0].confirmado_em, null);
    await app.close();
  }
});
