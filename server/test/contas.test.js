import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAppTeste, cabecalhos, tokenDoEmail, contaLogada } from './ajuda.js';
import { hashToken } from '../src/seguranca.js';

const H = cabecalhos();
const SENHA = 'senha-de-teste-123';
const HORA = 3600 * 1000;
const DIA = 24 * HORA;

const post = (app, url, payload, headers = H) => app.inject({ method: 'POST', url, headers, payload });
const get = (app, url, headers = H) => app.inject({ method: 'GET', url, headers });
const bearer = (token) => cabecalhos({ authorization: `Bearer ${token}` });

test('cadastro responde 202 e envia e-mail com link #confirmar=', async () => {
  const { app, email } = await criarAppTeste();
  const r = await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA });
  assert.equal(r.statusCode, 202);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(email.enviados.length, 1);
  assert.equal(email.enviados[0].para, 'a@b.com');
  assert.match(email.enviados[0].texto, /https:\/\/kaique-fhs\.github\.io\/saude-familiar\/#confirmar=[A-Za-z0-9_-]+/);
  await app.close();
});

test('cadastro valida senha (8 a 128) e e-mail', async () => {
  const { app, email } = await criarAppTeste();
  for (const senha of ['curta', 'x'.repeat(129), undefined]) {
    const r = await post(app, '/conta/cadastro', { email: 'a@b.com', senha });
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.json(), { erro: 'senha' });
  }
  const r = await post(app, '/conta/cadastro', { email: 'sem-arroba', senha: SENHA });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'email' });
  assert.equal(email.enviados.length, 0);
  await app.close();
});

test('cadastro com e-mail já confirmado responde 202 e não envia e-mail', async () => {
  const { app, email } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  const antes = email.enviados.length;
  const r = await post(app, '/conta/cadastro', { email: 'a@b.com', senha: 'outra-senha-123' });
  assert.equal(r.statusCode, 202);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(email.enviados.length, antes);
  await app.close();
});

test('" Rejane@Gmail.com " e "rejane@gmail.com" são a mesma conta', async () => {
  const { app, banco } = await criarAppTeste();
  await post(app, '/conta/cadastro', { email: ' Rejane@Gmail.com ', senha: SENHA });
  await post(app, '/conta/cadastro', { email: 'rejane@gmail.com', senha: SENHA });
  const r = await banco.consulta('select count(*)::int as n, min(email) as e from usuarios');
  assert.equal(r.rows[0].n, 1);
  assert.equal(r.rows[0].e, 'rejane@gmail.com');
  await app.close();
});

test('entrar antes de confirmar → 403 nao-confirmado; depois de confirmar → 200 com token', async () => {
  const { app, email } = await criarAppTeste();
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA });
  const antes = await post(app, '/conta/entrar', { email: 'a@b.com', senha: SENHA });
  assert.equal(antes.statusCode, 403);
  assert.deepEqual(antes.json(), { erro: 'nao-confirmado' });
  const c = await post(app, '/conta/confirmar', { token: tokenDoEmail(email, '#confirmar=') });
  assert.equal(c.statusCode, 200);
  assert.deepEqual(c.json(), { ok: true });
  const depois = await post(app, '/conta/entrar', { email: ' A@B.com ', senha: SENHA });
  assert.equal(depois.statusCode, 200);
  assert.ok(depois.json().token);
  assert.equal(depois.json().usuario.email, 'a@b.com');
  assert.ok(depois.json().usuario.id);
  await app.close();
});

test('entrar com senha errada e com e-mail inexistente → 401 credenciais (mesmo corpo)', async () => {
  const { app } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  const errada = await post(app, '/conta/entrar', { email: 'a@b.com', senha: 'senha-errada-1' });
  const inexistente = await post(app, '/conta/entrar', { email: 'x@y.com', senha: 'senha-errada-1' });
  assert.equal(errada.statusCode, 401);
  assert.equal(inexistente.statusCode, 401);
  assert.deepEqual(errada.json(), { erro: 'credenciais' });
  assert.equal(errada.body, inexistente.body);
  await app.close();
});

test('confirmar com token usado ou vencido (relógio +25 h) → 400 token', async () => {
  const { app, email, relogio } = await criarAppTeste();
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA });
  const token = tokenDoEmail(email, '#confirmar=');
  assert.equal((await post(app, '/conta/confirmar', { token })).statusCode, 200);
  const usado = await post(app, '/conta/confirmar', { token });
  assert.equal(usado.statusCode, 400);
  assert.deepEqual(usado.json(), { erro: 'token' });

  await post(app, '/conta/cadastro', { email: 'c@d.com', senha: SENHA });
  const token2 = tokenDoEmail(email, '#confirmar=');
  relogio.avancar(25 * HORA);
  const vencido = await post(app, '/conta/confirmar', { token: token2 });
  assert.equal(vencido.statusCode, 400);
  assert.deepEqual(vencido.json(), { erro: 'token' });
  assert.equal((await post(app, '/conta/confirmar', {})).statusCode, 400);
  await app.close();
});

test('GET /conta com token → 200; depois de /conta/sair → 401 sessao', async () => {
  const { app } = await criarAppTeste();
  const { token, id } = await contaLogada(app, 'a@b.com');
  const ok = await get(app, '/conta', bearer(token));
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { id, email: 'a@b.com' });
  const sair = await post(app, '/conta/sair', undefined, bearer(token));
  assert.equal(sair.statusCode, 204);
  const depois = await get(app, '/conta', bearer(token));
  assert.equal(depois.statusCode, 401);
  assert.deepEqual(depois.json(), { erro: 'sessao' });
  assert.equal((await get(app, '/conta')).statusCode, 401);
  await app.close();
});

test('sair apaga só aquela sessão', async () => {
  const { app } = await criarAppTeste();
  const a = await contaLogada(app, 'a@b.com');
  const r = await post(app, '/conta/entrar', { email: 'a@b.com', senha: SENHA });
  const outro = r.json().token;
  await post(app, '/conta/sair', undefined, bearer(a.token));
  assert.equal((await get(app, '/conta', bearer(outro))).statusCode, 200);
  await app.close();
});

test('sessão sem uso há 61 dias → 401 sessao; uso renova o prazo', async () => {
  const { app, banco, relogio } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  relogio.avancar(59 * DIA);
  assert.equal((await get(app, '/conta', bearer(token))).statusCode, 200);
  relogio.avancar(59 * DIA); // 59 dias desde o último uso: ainda vale
  assert.equal((await get(app, '/conta', bearer(token))).statusCode, 200);
  relogio.avancar(61 * DIA);
  const r = await get(app, '/conta', bearer(token));
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { erro: 'sessao' });
  const n = await banco.consulta('select count(*)::int as n from sessoes');
  assert.equal(n.rows[0].n, 0);
  await app.close();
});

test('nova-senha encerra todas as sessões; entrar com a senha nova funciona', async () => {
  const { app, email } = await criarAppTeste();
  const a = await contaLogada(app, 'a@b.com');
  const b = (await post(app, '/conta/entrar', { email: 'a@b.com', senha: SENHA })).json();
  const e = await post(app, '/conta/esqueci', { email: 'a@b.com' });
  assert.equal(e.statusCode, 202);
  const token = tokenDoEmail(email, '#nova-senha=');
  const r = await post(app, '/conta/nova-senha', { token, senha: 'senha-nova-456' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal((await get(app, '/conta', bearer(a.token))).statusCode, 401);
  assert.equal((await get(app, '/conta', bearer(b.token))).statusCode, 401);
  assert.equal((await post(app, '/conta/entrar', { email: 'a@b.com', senha: SENHA })).statusCode, 401);
  assert.equal((await post(app, '/conta/entrar', { email: 'a@b.com', senha: 'senha-nova-456' })).statusCode, 200);
  await app.close();
});

test('nova-senha com senha fora de 8–128 → 400 senha', async () => {
  const { app, email } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  await post(app, '/conta/esqueci', { email: 'a@b.com' });
  const token = tokenDoEmail(email, '#nova-senha=');
  const r = await post(app, '/conta/nova-senha', { token, senha: 'curta' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'senha' });
  await app.close();
});

test('token de nova-senha vencido (relógio +61 min) → 400 token', async () => {
  const { app, email, relogio } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  await post(app, '/conta/esqueci', { email: 'a@b.com' });
  const token = tokenDoEmail(email, '#nova-senha=');
  relogio.avancar(61 * 60 * 1000);
  const r = await post(app, '/conta/nova-senha', { token, senha: 'senha-nova-456' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'token' });
  await app.close();
});

test('token de nova-senha usado duas vezes → a segunda dá 400 token', async () => {
  const { app, email } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  await post(app, '/conta/esqueci', { email: 'a@b.com' });
  const token = tokenDoEmail(email, '#nova-senha=');
  assert.equal((await post(app, '/conta/nova-senha', { token, senha: 'senha-nova-456' })).statusCode, 200);
  const r = await post(app, '/conta/nova-senha', { token, senha: 'senha-nova-789' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'token' });
  await app.close();
});

test('token de confirmação não serve em nova-senha', async () => {
  const { app, email } = await criarAppTeste();
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA });
  const token = tokenDoEmail(email, '#confirmar=');
  const r = await post(app, '/conta/nova-senha', { token, senha: 'senha-nova-456' });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('esqueci com e-mail existente envia link #nova-senha=; com inexistente responde 202 igual e não envia', async () => {
  const { app, email } = await criarAppTeste();
  await contaLogada(app, 'a@b.com');
  const antes = email.enviados.length;
  const existe = await post(app, '/conta/esqueci', { email: 'a@b.com' });
  assert.equal(email.enviados.length, antes + 1);
  assert.match(email.enviados.at(-1).texto, /https:\/\/kaique-fhs\.github\.io\/saude-familiar\/#nova-senha=[A-Za-z0-9_-]+/);
  const nao = await post(app, '/conta/esqueci', { email: 'x@y.com' });
  assert.equal(email.enviados.length, antes + 1);
  assert.equal(existe.statusCode, 202);
  assert.equal(nao.statusCode, 202);
  assert.equal(existe.body, nao.body);
  await app.close();
});

test('recadastro de e-mail não confirmado troca a senha e invalida o link antigo', async () => {
  const { app, email } = await criarAppTeste();
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: 'senha-do-invasor-1' });
  const antigo = tokenDoEmail(email, '#confirmar=');
  await post(app, '/conta/cadastro', { email: 'a@b.com', senha: SENHA });
  const novo = tokenDoEmail(email, '#confirmar=');
  assert.notEqual(antigo, novo);
  const velho = await post(app, '/conta/confirmar', { token: antigo });
  assert.equal(velho.statusCode, 400);
  assert.deepEqual(velho.json(), { erro: 'token' });
  assert.equal((await post(app, '/conta/confirmar', { token: novo })).statusCode, 200);
  assert.equal((await post(app, '/conta/entrar', { email: 'a@b.com', senha: 'senha-do-invasor-1' })).statusCode, 401);
  assert.equal((await post(app, '/conta/entrar', { email: 'a@b.com', senha: SENHA })).statusCode, 200);
  await app.close();
});

test('banco guarda só hashes: coluna hash de sessoes e tokens nunca é o token', async () => {
  const { app, banco, email } = await criarAppTeste();
  const { token } = await contaLogada(app, 'a@b.com');
  await post(app, '/conta/esqueci', { email: 'a@b.com' });
  const tConfirmar = tokenDoEmail(email, '#confirmar=');
  const tSenha = tokenDoEmail(email, '#nova-senha=');
  const sessoes = (await banco.consulta('select hash from sessoes')).rows.map((l) => l.hash);
  const tokens = (await banco.consulta('select hash from tokens')).rows.map((l) => l.hash);
  assert.ok(sessoes.includes(hashToken(token)));
  assert.ok(tokens.includes(hashToken(tConfirmar)));
  assert.ok(tokens.includes(hashToken(tSenha)));
  for (const segredo of [token, tConfirmar, tSenha]) {
    assert.ok(!sessoes.includes(segredo));
    assert.ok(!tokens.includes(segredo));
  }
  const guardada = (await banco.consulta('select senha_hash from usuarios')).rows[0].senha_hash;
  assert.ok(guardada.startsWith('scrypt$'));
  await app.close();
});
