// Suíte contra Postgres real. Exige TEST_DATABASE_URL (conexão do dono do banco, não superusuário,
// com o papel saude_app já criado pelo provisionamento). Sem ela, tudo é pulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAppTeste, cabecalhos, contaLogada, novoBancoTeste } from './ajuda.js';

const pular = process.env.TEST_DATABASE_URL
  ? false
  : 'defina TEST_DATABASE_URL (Postgres real) para rodar esta suíte; ela roda na máquina AWS';

const novoUsuario = async (banco, email) =>
  (await banco.consulta('insert into usuarios (email, senha_hash) values ($1, $2) returning id', [email, 'x'])).rows[0].id;
const inserirItem = (tx, userId, chave) =>
  tx.consulta("insert into itens (user_id, tipo, chave, valor, em) values ($1, 'fav', $2, '{}', now())", [userId, chave]);
const vazio = (v) => v === null || v === '';

test('usuário da conexão não é superusuário', { skip: pular }, async () => {
  const banco = await novoBancoTeste();
  try {
    const r = await banco.consulta(
      'select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as su',
    );
    assert.equal(r.rows[0].su, false); // superusuário ignora RLS e esvaziaria todos os testes de isolamento
    assert.notEqual(r.rows[0].u, 'saude_app');
  } finally {
    await banco.fechar();
  }
});

test('RLS isola A de B via comoUsuario com FORCE', { skip: pular }, async () => {
  const banco = await novoBancoTeste();
  try {
    const a = await novoUsuario(banco, 'a@x.com');
    const b = await novoUsuario(banco, 'b@x.com');
    await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
    await banco.comoUsuario(b, (tx) => inserirItem(tx, b, 'ib'));
    const doA = await banco.comoUsuario(a, async (tx) => (await tx.consulta('select * from itens')).rows);
    assert.equal(doA.length, 1);
    assert.equal(doA[0].user_id, a);
    // escrever com o user_id do outro é barrado pelo with check
    await assert.rejects(banco.comoUsuario(a, (tx) => inserirItem(tx, b, 'x')), /row-level security/);
    // FORCE: nem o dono da tabela passa sem comoUsuario (sem FORCE este insert funcionaria)
    await assert.rejects(inserirItem(banco, a, 'dono'), /row-level security/);
    // app.user_id vazio ('' em conexão reaproveitada do pool): 0 linhas no select, RLS (não erro de cast) no insert
    const semId = await banco.transacao(async (tx) => {
      await tx.consulta('set local role saude_app');
      await tx.consulta("select set_config('app.user_id', '', true)");
      return (await tx.consulta('select * from itens')).rows;
    });
    assert.equal(semId.length, 0);
    await assert.rejects(
      banco.transacao(async (tx) => {
        await tx.consulta('set local role saude_app');
        await tx.consulta("select set_config('app.user_id', '', true)");
        await inserirItem(tx, a, 'sem-id');
      }),
      /row-level security/,
    );
  } finally {
    await banco.fechar();
  }
});

test('dois POST /sync concorrentes do mesmo usuário em conexões diferentes não pulam seq', { skip: pular }, async () => {
  const { app, banco } = await criarAppTeste();
  try {
    const { token, id } = await contaLogada(app, 'a@b.com');
    // 1) a trava por usuário serializa de fato: uma segunda conexão espera a primeira terminar
    let libera;
    const segura = new Promise((r) => { libera = r; });
    let primeiraTomou;
    const tomou = new Promise((r) => { primeiraTomou = r; });
    const t1 = banco.comoUsuario(id, async (tx) => {
      await tx.consulta('select pg_advisory_xact_lock(hashtext($1))', [id]);
      await inserirItem(tx, id, 'trava1'); // consome seq dentro da transação aberta
      primeiraTomou();
      await segura;
    });
    await tomou;
    let segundaPassou = false;
    const t2 = banco.comoUsuario(id, async (tx) => {
      await tx.consulta('select pg_advisory_xact_lock(hashtext($1))', [id]);
      segundaPassou = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(segundaPassou, false, 'a segunda conexão deveria estar esperando a trava');
    libera();
    await Promise.all([t1, t2]);
    assert.equal(segundaPassou, true);

    // 2) dois POST /sync reais em paralelo: cada um grava em um bloco contíguo de seq, sem pular nem intercalar
    const lote = (p) =>
      Array.from({ length: 30 }, (_, i) => ({ tipo: 'fav', chave: `${p}${i}`, valor: null, ativo: true, em: '2026-11-21T10:00:00Z' }));
    const h = cabecalhos({ authorization: `Bearer ${token}` });
    const envia = (p) => app.inject({ method: 'POST', url: '/sync', headers: h, payload: { mudancas: lote(p) } });
    const [r1, r2] = await Promise.all([envia('a'), envia('b')]);
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const lido = await app.inject({ method: 'GET', url: '/sync?limite=500', headers: h });
    const itens = lido.json().itens.filter((i) => /^[ab]\d+$/.test(i.chave));
    assert.equal(itens.length, 60);
    const seqs = itens.map((i) => i.seq);
    assert.equal(new Set(seqs).size, 60);
    const prefixos = itens.slice().sort((x, y) => x.seq - y.seq).map((i) => i.chave[0]).join('');
    assert.match(prefixos, /^(a{30}b{30}|b{30}a{30})$/, 'blocos intercalados: a trava não serializou');
  } finally {
    await banco.fechar();
  }
});

test('apagar usuário em cascata com FORCE RLS ligado', { skip: pular }, async () => {
  const banco = await novoBancoTeste();
  try {
    const a = await novoUsuario(banco, 'a@x.com');
    await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
    await banco.consulta('insert into sessoes (hash, user_id) values ($1, $2)', ['h1', a]);
    await banco.consulta("insert into tokens (hash, user_id, tipo, expira_em) values ($1, $2, 'confirmar', now())", ['t1', a]);
    await banco.consulta('delete from usuarios where id = $1', [a]); // não pode falhar por causa da RLS
    for (const t of ['sessoes', 'tokens']) {
      assert.equal((await banco.consulta(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
    }
    // o dono não vê itens (FORCE); recriar o mesmo id mostra se sobrou item órfão
    await banco.consulta("insert into usuarios (id, email, senha_hash) values ($1, 'a2@x.com', 'x')", [a]);
    const itens = await banco.comoUsuario(a, (tx) => tx.consulta('select 1 from itens'));
    assert.equal(itens.rows.length, 0);
  } finally {
    await banco.fechar();
  }
});

test('erro dentro de transacao faz rollback (nada gravado)', { skip: pular }, async () => {
  const banco = await novoBancoTeste();
  try {
    const a = await novoUsuario(banco, 'a@x.com');
    await assert.rejects(
      banco.comoUsuario(a, async (tx) => {
        await inserirItem(tx, a, 'ia');
        throw new Error('falha no meio');
      }),
      /falha no meio/,
    );
    assert.equal((await banco.comoUsuario(a, (tx) => tx.consulta('select 1 from itens'))).rows.length, 0);
    await assert.rejects(
      banco.transacao(async (tx) => {
        await tx.consulta("insert into usuarios (email, senha_hash) values ('r@x.com', 'x')");
        throw new Error('falha 2');
      }),
      /falha 2/,
    );
    assert.equal((await banco.consulta("select 1 from usuarios where email = 'r@x.com'")).rows.length, 0);
  } finally {
    await banco.fechar();
  }
});

test('depois de comoUsuario a conexão devolvida ao pool não continua como saude_app nem com app.user_id', { skip: pular }, async () => {
  const banco = await novoBancoTeste();
  try {
    const a = await novoUsuario(banco, 'a@x.com');
    await banco.comoUsuario(a, (tx) => inserirItem(tx, a, 'ia'));
    await assert.rejects(banco.comoUsuario(a, async () => { throw new Error('x'); }), /x/); // caminho do rollback
    const dono = (await banco.consulta('select session_user as s')).rows[0].s;
    // percorre todas as conexões que o pool já abriu (e que voltaram ociosas)
    const clientes = await Promise.all(Array.from({ length: banco.pool.totalCount }, () => banco.pool.connect()));
    try {
      for (const c of clientes) {
        const r = (await c.query("select current_user as u, current_setting('app.user_id', true) as id")).rows[0];
        assert.equal(r.u, dono);
        assert.notEqual(r.u, 'saude_app');
        assert.ok(vazio(r.id), `app.user_id vazou: ${r.id}`);
      }
    } finally {
      clientes.forEach((c) => c.release());
    }
  } finally {
    await banco.fechar();
  }
});
