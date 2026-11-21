import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSenha, conferirSenha, novoToken, hashToken, HASH_FALSO } from '../src/seguranca.js';

test('hashSenha gera textos diferentes para a mesma senha', async () => {
  const a = await hashSenha('senha-segura-1');
  const b = await hashSenha('senha-segura-1');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
});

test('conferirSenha aceita a certa e recusa a errada', async () => {
  const h = await hashSenha('senha-segura-1');
  assert.equal(await conferirSenha('senha-segura-1', h), true);
  assert.equal(await conferirSenha('senha-errada-1', h), false);
});

test('conferirSenha com texto malformado devolve false', async () => {
  for (const ruim of ['', 'abc', 'scrypt$x$8$1$aa$bb', 'bcrypt$32768$8$1$aa$bb', 'scrypt$32768$8$1$aa', null, undefined]) {
    assert.equal(await conferirSenha('qualquer', ruim), false);
  }
});

test('HASH_FALSO é um hash válido que não confere', async () => {
  assert.match(HASH_FALSO, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await conferirSenha('qualquer-coisa', HASH_FALSO), false);
});

test('novoToken: token com 43 caracteres base64url e hash com 64 hex', () => {
  const { token, hash } = novoToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashToken(token));
});

test('hashToken é determinístico', () => {
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), hashToken('abd'));
});
