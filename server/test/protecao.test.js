import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAppTeste, cabecalhos, captchaFalso, ACEITE } from './ajuda.js';

const SENHA = 'senha-de-teste-123';
const semToken = { 'x-saude-origem': 'segredo-teste' };
const comIp = (ip, extra = {}) => cabecalhos({ 'x-forwarded-for': ip, ...extra });

const post = (app, url, payload, headers = cabecalhos()) =>
  app.inject({ method: 'POST', url, headers, payload });

test('cadastro sem x-turnstile-token → 400 captcha e nenhum e-mail', async () => {
  const { app, email, banco } = await criarAppTeste();
  const r = await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA, aceite: ACEITE }, semToken);
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'captcha' });
  assert.equal(email.enviados.length, 0);
  const n = await banco.consulta('select count(*)::int as n from usuarios');
  assert.equal(n.rows[0].n, 0);
  await app.close();
});

test('captcha recusado → 400 captcha (cadastro e esqueci), sem e-mail', async () => {
  const { app, email } = await criarAppTeste({ deps: { captcha: captchaFalso(false) } });
  const c = await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA, aceite: ACEITE });
  assert.equal(c.statusCode, 400);
  assert.deepEqual(c.json(), { erro: 'captcha' });
  const e = await post(app, '/conta/esqueci', { email: 'a@b.com' });
  assert.equal(e.statusCode, 400);
  assert.deepEqual(e.json(), { erro: 'captcha' });
  assert.equal(email.enviados.length, 0);
  await app.close();
});

test('captcha recebe o token e o IP da requisição', async () => {
  const captcha = captchaFalso(true);
  const { app } = await criarAppTeste({ deps: { captcha } });
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA, aceite: ACEITE }, comIp('7.7.7.7', { 'x-turnstile-token': 'abc' }));
  assert.deepEqual(captcha.chamadas, [{ token: 'abc', ip: '7.7.7.7' }]);
  await app.close();
});

test('6º cadastro do mesmo IP na hora → 429 limite', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 0; i < 5; i++) {
    const r = await post(app, '/conta/cadastro', { email: `u${i}@b.com`, senha: SENHA, aceite: ACEITE }, comIp('1.1.1.1'));
    assert.equal(r.statusCode, 202);
  }
  const r = await post(app, '/conta/cadastro', { email: 'u6@b.com', senha: SENHA, aceite: ACEITE }, comIp('1.1.1.1'));
  assert.equal(r.statusCode, 429);
  assert.deepEqual(r.json(), { erro: 'limite' });
  await app.close();
});

test('11ª tentativa de entrar com o mesmo e-mail de IPs diferentes → 429', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 1; i <= 10; i++) {
    const r = await post(app, '/conta/entrar', { email: 'a@b.com', senha: 'errada-123' }, comIp(`2.2.2.${i}`));
    assert.equal(r.statusCode, 401);
  }
  const r = await post(app, '/conta/entrar', { email: ' A@B.com ', senha: 'errada-123' }, comIp('2.2.2.99'));
  assert.equal(r.statusCode, 429);
  assert.deepEqual(r.json(), { erro: 'limite' });
  await app.close();
});

test('4º esqueci do mesmo e-mail de IPs diferentes → 429', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 1; i <= 3; i++) {
    const r = await post(app, '/conta/esqueci', { email: 'a@b.com' }, comIp(`3.3.3.${i}`));
    assert.equal(r.statusCode, 202);
  }
  const r = await post(app, '/conta/esqueci', { email: 'a@b.com' }, comIp('3.3.3.99'));
  assert.equal(r.statusCode, 429);
  assert.deepEqual(r.json(), { erro: 'limite' });
  await app.close();
});

test('X-Forwarded-For forjado pelo cliente não escapa do limite (IP = último da lista)', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 0; i < 5; i++) {
    const r = await post(app, '/conta/cadastro', { email: `u${i}@b.com`, senha: SENHA, aceite: ACEITE }, comIp(`10.0.0.${i}, 5.5.5.5`));
    assert.equal(r.statusCode, 202);
  }
  const r = await post(app, '/conta/cadastro', { email: 'u6@b.com', senha: SENHA, aceite: ACEITE }, comIp('10.0.0.200, 5.5.5.5'));
  assert.equal(r.statusCode, 429);
  await app.close();
});

test('demais rotas: 301ª chamada por minuto do mesmo IP → 429', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 0; i < 300; i++) {
    const r = await app.inject({ method: 'GET', url: '/conta', headers: comIp('4.4.4.4') });
    assert.equal(r.statusCode, 401);
  }
  const r = await app.inject({ method: 'GET', url: '/conta', headers: comIp('4.4.4.4') });
  assert.equal(r.statusCode, 429);
  assert.deepEqual(r.json(), { erro: 'limite' });
  await app.close();
});

test('com teto 2, o 3º e-mail não é enviado e a rota responde 202', async () => {
  const { app, email, banco } = await criarAppTeste({ tetoEmails: 2 });
  for (let i = 0; i < 3; i++) {
    const r = await post(app, '/conta/cadastro', { email: `u${i}@b.com`, senha: SENHA, aceite: ACEITE });
    assert.equal(r.statusCode, 202);
    assert.deepEqual(r.json(), { ok: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(email.enviados.length, 2);
  const t = await banco.consulta('select dia::text as dia, total from envios_email');
  assert.deepEqual(t.rows, [{ dia: '2026-11-21', total: 3 }]);
  await app.close();
});

test('teto diário zera no dia seguinte (data de relogio())', async () => {
  const { app, email, relogio } = await criarAppTeste({ tetoEmails: 1 });
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA, aceite: ACEITE });
  await post(app, '/conta/cadastro', { email: 'b@b.com', senha: SENHA, aceite: ACEITE });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(email.enviados.length, 1);
  relogio.avancar(24 * 3600 * 1000);
  await post(app, '/conta/cadastro', { email: 'c@b.com', senha: SENHA, aceite: ACEITE });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(email.enviados.length, 2);
  await app.close();
});

test('IPs diferentes (último do X-Forwarded-For) têm limites separados', async () => {
  const { app } = await criarAppTeste({ limites: true });
  for (let i = 1; i <= 7; i++) {
    const r = await post(app, '/conta/cadastro', { email: `u${i}@b.com`, senha: SENHA, aceite: ACEITE }, comIp(`8.8.8.${i}`));
    assert.equal(r.statusCode, 202);
  }
  await app.close();
});

test('criarCaptchaTurnstile envia secret, response e remoteip e usa success', async () => {
  const { criarCaptchaTurnstile } = await import('../src/protecao.js');
  const pedidos = [];
  const resposta = (success) => async (url, init) => {
    pedidos.push({ url, corpo: init.body.toString() });
    return { ok: true, json: async () => ({ success }) };
  };
  assert.equal(await criarCaptchaTurnstile('seg', resposta(true)).verificar('tok', '9.9.9.9'), true);
  assert.equal(await criarCaptchaTurnstile('seg', resposta(false)).verificar('tok', '9.9.9.9'), false);
  assert.equal(pedidos[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(pedidos[0].corpo, 'secret=seg&response=tok&remoteip=9.9.9.9');
  const falha = async () => {
    throw new Error('rede');
  };
  assert.equal(await criarCaptchaTurnstile('seg', falha).verificar('tok', '9.9.9.9'), false);
});
