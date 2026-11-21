import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabecalhos, contaLogada, criarAppTeste, armazenamentoFalso } from './ajuda.js';
import { apagarFotosPendentes } from '../src/contas.js';

const SENHA = 'senha-de-teste-123';

const apagar = (app, token, senha) =>
  app.inject({
    method: 'DELETE',
    url: '/conta',
    headers: cabecalhos({ authorization: `Bearer ${token}` }),
    payload: { senha },
  });

async function criarItem(banco, userId) {
  await banco.comoUsuario(userId, (tx) =>
    tx.consulta(
      "insert into itens (user_id, tipo, chave, valor, em) values ($1, 'fav', 'r1', '1', $2)",
      [userId, new Date('2026-11-21T12:00:00Z')],
    ),
  );
}

test('apagar conta com senha errada → 401 e nada muda', async () => {
  const { app, banco } = await criarAppTeste();
  const c = await contaLogada(app, 'a@b.com');
  const r = await apagar(app, c.token, 'senha-errada-123');
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { erro: 'credenciais' });
  assert.equal((await banco.consulta('select 1 from usuarios where id = $1', [c.id])).rows.length, 1);
  assert.equal((await banco.consulta('select 1 from contas_apagadas')).rows.length, 0);
});

test('apagar conta → 204, usuário e itens somem, contas_apagadas registra e apaga o prefixo', async () => {
  const { app, banco, relogio } = await criarAppTeste();
  const c = await contaLogada(app, 'a@b.com');
  await criarItem(banco, c.id);
  const r = await apagar(app, c.token, SENHA);
  assert.equal(r.statusCode, 204);
  assert.equal((await banco.consulta('select 1 from usuarios where id = $1', [c.id])).rows.length, 0);
  assert.equal((await banco.consulta('select 1 from itens where user_id = $1', [c.id])).rows.length, 0);
  const l = (await banco.consulta('select * from contas_apagadas where user_id = $1', [c.id])).rows[0];
  assert.ok(l);
  assert.equal(new Date(l.apagada_em).getTime(), relogio().getTime());
  assert.equal(new Date(l.fotos_apagadas_em).getTime(), relogio().getTime());
});

test('apagar conta chama apagarPrefixo com "teste/<id>/"', async () => {
  const arm = armazenamentoFalso();
  const { app } = await criarAppTeste({ deps: { armazenamento: arm } });
  const c = await contaLogada(app, 'a@b.com');
  assert.equal((await apagar(app, c.token, SENHA)).statusCode, 204);
  assert.deepEqual(arm.chamadas, [{ tipo: 'apagar', prefixo: `teste/${c.id}/` }]);
});

test('token da conta apagada → 401 sessao', async () => {
  const { app } = await criarAppTeste();
  const c = await contaLogada(app, 'a@b.com');
  await apagar(app, c.token, SENHA);
  const r = await app.inject({
    method: 'GET',
    url: '/conta',
    headers: cabecalhos({ authorization: `Bearer ${c.token}` }),
  });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { erro: 'sessao' });
});

test('falha ao apagar fotos → 204, fotos_apagadas_em nulo; apagarFotosPendentes depois conclui', async () => {
  const arm = armazenamentoFalso();
  let falha = true;
  const original = arm.apagarPrefixo;
  arm.apagarPrefixo = async (p) => {
    if (falha) throw new Error('s3 fora');
    return original(p);
  };
  const { app, banco, relogio } = await criarAppTeste({ deps: { armazenamento: arm } });
  const c = await contaLogada(app, 'a@b.com');
  assert.equal((await apagar(app, c.token, SENHA)).statusCode, 204);
  assert.equal((await banco.consulta('select 1 from usuarios where id = $1', [c.id])).rows.length, 0);
  let l = (await banco.consulta('select * from contas_apagadas where user_id = $1', [c.id])).rows[0];
  assert.equal(l.fotos_apagadas_em, null);

  falha = false;
  const n = await apagarFotosPendentes({ banco, armazenamento: arm, ambiente: 'teste', relogio });
  assert.equal(n, 1);
  l = (await banco.consulta('select * from contas_apagadas where user_id = $1', [c.id])).rows[0];
  assert.ok(l.fotos_apagadas_em);
  assert.deepEqual(arm.chamadas, [{ tipo: 'apagar', prefixo: `teste/${c.id}/` }]);
});

test('apagarFotosPendentes: falha de uma conta não impede as outras', async () => {
  const { banco, relogio } = await criarAppTeste();
  const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
  for (const id of ids) {
    await banco.consulta('insert into contas_apagadas (user_id, apagada_em) values ($1, $2)', [id, relogio()]);
  }
  const arm = armazenamentoFalso();
  const original = arm.apagarPrefixo;
  arm.apagarPrefixo = async (p) => {
    if (p.includes(ids[0])) throw new Error('falhou');
    return original(p);
  };
  const n = await apagarFotosPendentes({ banco, armazenamento: arm, ambiente: 'teste', relogio });
  assert.equal(n, 1);
  const r = await banco.consulta('select user_id from contas_apagadas where fotos_apagadas_em is null');
  assert.deepEqual(r.rows.map((x) => x.user_id), [ids[0]]);
});
