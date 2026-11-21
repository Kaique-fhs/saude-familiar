import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarBancoPglite } from '../src/banco.js';
import { executarTarefa } from '../src/tarefas.js';
import { armazenamentoFalso, configTeste } from './ajuda.js';

const HORA = 3600 * 1000;
const U30H = '11111111-1111-1111-1111-111111111111';
const U3D = '22222222-2222-2222-2222-222222222222';

test('migrar aplica as migrações e é repetível', async () => {
  const banco = await criarBancoPglite();
  assert.deepEqual(await executarTarefa('migrar', { banco, config: configTeste() }), [
    '001_contas.sql',
    '002_dados.sql',
    '003_politica_itens.sql',
  ]);
  assert.deepEqual(await executarTarefa('migrar', { banco, config: configTeste() }), []);
  await banco.fechar();
});

test('apagar-fotos revarre conta apagada há 30 h mesmo com fotos_apagadas_em preenchido e ignora a de 3 dias', async () => {
  const banco = await criarBancoPglite();
  await executarTarefa('migrar', { banco, config: configTeste() });
  const agora = new Date('2026-06-10T12:00:00Z');
  const relogio = () => agora;
  const ins = (id, h, feito) =>
    banco.consulta('insert into contas_apagadas (user_id, apagada_em, fotos_apagadas_em) values ($1, $2, $3)', [
      id,
      new Date(agora.getTime() - h * HORA),
      feito ? new Date(agora.getTime() - h * HORA) : null,
    ]);
  await ins(U30H, 30, true);
  await ins(U3D, 72, true);
  const arm = armazenamentoFalso();
  await executarTarefa('apagar-fotos', { banco, config: configTeste(), armazenamento: arm, relogio });
  assert.deepEqual(arm.chamadas, [{ tipo: 'apagar', prefixo: `teste/${U30H}/` }]);
  await banco.fechar();
});

test('tarefa desconhecida lança erro', async () => {
  await assert.rejects(() => executarTarefa('xyz', {}), /tarefa desconhecida/);
});
