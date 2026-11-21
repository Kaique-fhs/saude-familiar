import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarBancoPg, criarBancoPglite } from '../src/banco.js';
import { migrar } from '../src/migrar.js';
import { novoBancoTeste } from './ajuda.js';

async function novoUsuario(banco, email) {
  const r = await banco.consulta(
    'insert into usuarios (email, senha_hash) values ($1, $2) returning id',
    [email, 'x'],
  );
  return r.rows[0].id;
}

const inserirItem = (tx, userId, chave) =>
  tx.consulta(
    "insert into itens (user_id, tipo, chave, valor, em) values ($1, 'fav', $2, '{}', now())",
    [userId, chave],
  );

test('migrar aplica 001 e 002 e na segunda vez não aplica nada', async () => {
  const banco = await criarBancoPglite();
  const primeira = await migrar(banco);
  assert.deepEqual(primeira, ['001_contas.sql', '002_dados.sql', '003_politica_itens.sql']);
  assert.deepEqual(await migrar(banco), []);
  await banco.fechar();
});

test('comoUsuario(A) não enxerga itens de B', async () => {
  const banco = await novoBancoTeste();
  const a = await novoUsuario(banco, 'a@x.com');
  const b = await novoUsuario(banco, 'b@x.com');
  await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
  await banco.comoUsuario(b, (tx) => inserirItem(tx, b, 'ib'));
  const rows = await banco.comoUsuario(a, async (tx) => (await tx.consulta('select * from itens')).rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, a);
  await banco.fechar();
});

test('comoUsuario(A) não consegue inserir item com user_id de B', async () => {
  const banco = await novoBancoTeste();
  const a = await novoUsuario(banco, 'a@x.com');
  const b = await novoUsuario(banco, 'b@x.com');
  await assert.rejects(banco.comoUsuario(a, (tx) => inserirItem(tx, b, 'x')), /row-level security/);
  await banco.fechar();
});

test('apagar usuário apaga sessões, tokens e itens (cascade)', async () => {
  const banco = await novoBancoTeste();
  const a = await novoUsuario(banco, 'a@x.com');
  await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
  assert.equal((await banco.comoUsuario(a, (tx) => tx.consulta('select 1 from itens'))).rows.length, 1);
  await banco.consulta('insert into sessoes (hash, user_id) values ($1, $2)', ['h1', a]);
  await banco.consulta(
    "insert into tokens (hash, user_id, tipo, expira_em) values ($1, $2, 'confirmar', now())",
    ['t1', a],
  );
  await banco.consulta('delete from usuarios where id = $1', [a]);
  for (const t of ['sessoes', 'tokens']) {
    const r = await banco.consulta(`select count(*)::int as n from ${t}`);
    assert.equal(r.rows[0].n, 0, t);
  }
  // Itens não se contam como dono (a RLS força): recria o mesmo id e confere que nada órfão reaparece.
  await banco.consulta("insert into usuarios (id, email, senha_hash) values ($1, 'a2@x.com', 'x')", [a]);
  const itens = await banco.comoUsuario(a, (tx) => tx.consulta('select 1 from itens'));
  assert.equal(itens.rows.length, 0, 'itens');
  await banco.fechar();
});

test('criarBancoPg registra listener de erro no Pool e um erro ocioso não derruba o processo', async () => {
  const banco = criarBancoPg('postgres://usuario:senha@127.0.0.1:1/nada');
  assert.ok(banco.pool.listenerCount('error') >= 1);
  const original = console.error;
  const chamadas = [];
  console.error = (...a) => chamadas.push(a);
  try {
    banco.pool.emit('error', new Error('queda simulada'));
  } finally {
    console.error = original;
  }
  assert.equal(chamadas.length, 1);
  await banco.fechar();
});

test('criarBancoPglite(pasta) mantém os dados ao reabrir', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const pasta = await mkdtemp(join(tmpdir(), 'sf-pg-'));
  const a = await criarBancoPglite(pasta);
  await migrar(a);
  await a.consulta("insert into usuarios (email, senha_hash) values ('p@x.com', 'x')");
  await a.fechar();
  const b = await criarBancoPglite(pasta);
  assert.deepEqual(await migrar(b), []);
  const r = await b.consulta('select email from usuarios');
  assert.deepEqual(r.rows.map((l) => l.email), ['p@x.com']);
  await b.fechar();
  await rm(pasta, { recursive: true, force: true });
});

test('criarBancoPglite() sem pasta continua em memória (não guarda nada entre aberturas)', async () => {
  const a = await criarBancoPglite();
  await migrar(a);
  await a.consulta("insert into usuarios (email, senha_hash) values ('m@x.com', 'x')");
  await a.fechar();
  const b = await criarBancoPglite();
  assert.deepEqual(await migrar(b), ['001_contas.sql', '002_dados.sql', '003_politica_itens.sql']);
  await b.fechar();
});
test('criarBancoPg limita o Pool ao max informado (padrão do pg, 10, sem max)', async () => {
  const a = criarBancoPg('postgres://usuario:senha@127.0.0.1:1/nada', { max: 3 });
  assert.equal(a.pool.options.max, 3);
  await a.fechar();
  const b = criarBancoPg('postgres://usuario:senha@127.0.0.1:1/nada');
  assert.equal(b.pool.options.max, 10);
  await b.fechar();
});

test('migrar com o papel saude_app já concedido ao dono (sem admin) não falha', async () => {
  const banco = await criarBancoPglite();
  await banco.consulta('create role saude_app nologin');
  await banco.consulta('create role dono_teste login');
  await banco.consulta('grant saude_app to dono_teste');
  await banco.consulta('grant all on schema public to dono_teste');
  await banco.consulta('set role dono_teste');
  assert.deepEqual(await migrar(banco), ['001_contas.sql', '002_dados.sql', '003_politica_itens.sql']);
  assert.deepEqual(await migrar(banco), []);
  await banco.fechar();
});

test('com app.user_id vazio o saude_app vê 0 itens e não insere (RLS, não erro de cast)', async () => {
  const banco = await novoBancoTeste();
  const a = await novoUsuario(banco, 'a@x.com');
  await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
  const vazio = (fn) =>
    banco.transacao(async (tx) => {
      await tx.consulta('set local role saude_app');
      await tx.consulta("select set_config('app.user_id', '', true)");
      return fn(tx);
    });
  assert.equal((await vazio((tx) => tx.consulta('select * from itens'))).rows.length, 0);
  await assert.rejects(vazio((tx) => inserirItem(tx, a, 'x')), /row-level security/);
  await banco.fechar();
});
