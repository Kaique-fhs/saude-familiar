import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarBancoPglite } from '../src/banco.js';
import { executarTarefa } from '../src/tarefas.js';
import { configTeste } from './ajuda.js';

const DIA = 24 * 3600 * 1000;
const agora = new Date('2026-12-10T12:00:00Z');
const antes = (ms) => new Date(agora.getTime() - ms);
const depois = (ms) => new Date(agora.getTime() + ms);

async function preparar() {
  const banco = await criarBancoPglite();
  await executarTarefa('migrar', { banco, config: configTeste() });
  const usuario = async (email, criado, confirmado = null) => {
    const r = await banco.consulta(
      'insert into usuarios (email, senha_hash, criado_em, confirmado_em) values ($1, $2, $3, $4) returning id',
      [email, 'hash', criado, confirmado],
    );
    const id = r.rows[0].id;
    for (const tipo of ['saude', 'transferencia']) {
      await banco.consulta('insert into aceites (user_id, tipo, versao, em) values ($1, $2, $3, $4)', [id, tipo, '1', criado]);
    }
    return id;
  };
  const token = (hash, userId, tipo, expira, usado = null) =>
    banco.consulta('insert into tokens (hash, user_id, tipo, expira_em, usado_em) values ($1, $2, $3, $4, $5)', [
      hash, userId, tipo, expira, usado,
    ]);
  const sessao = (hash, userId, ultimoUso) =>
    banco.consulta('insert into sessoes (hash, user_id, criada_em, ultimo_uso) values ($1, $2, $3, $3)', [hash, userId, ultimoUso]);
  return { banco, usuario, token, sessao };
}

const limpar = (banco) => executarTarefa('limpar-contas', { banco, config: configTeste(), relogio: () => agora });
const emails = async (banco) => (await banco.consulta('select email from usuarios order by email')).rows.map((r) => r.email);
const contar = async (banco, tabela) => (await banco.consulta(`select count(*)::int as n from ${tabela}`)).rows[0].n;

test('cadastro não confirmado há mais de 7 dias, sem link válido, é apagado com aceites e tokens', async () => {
  const { banco, usuario, token } = await preparar();
  const velho = await usuario('velho@x.com', antes(8 * DIA));
  await token('t-velho', velho, 'confirmar', antes(7 * DIA));
  const r = await limpar(banco);
  assert.deepEqual(await emails(banco), []);
  assert.equal(await contar(banco, 'aceites'), 0);
  assert.equal(await contar(banco, 'tokens'), 0);
  assert.equal(r.cadastros, 1);
  await banco.fechar();
});

test('mantém não confirmado recente, não confirmado com link ainda válido e conta confirmada antiga', async () => {
  const { banco, usuario, token } = await preparar();
  await usuario('recente@x.com', antes(6 * DIA));
  const refez = await usuario('refez@x.com', antes(8 * DIA));
  await token('t-refez', refez, 'confirmar', depois(3600 * 1000));
  await usuario('confirmada@x.com', antes(400 * DIA), antes(399 * DIA));
  const r = await limpar(banco);
  assert.deepEqual(await emails(banco), ['confirmada@x.com', 'recente@x.com', 'refez@x.com']);
  assert.equal(r.cadastros, 0);
  await banco.fechar();
});

test('apaga sessões sem uso há mais de 60 dias e mantém as mais novas', async () => {
  const { banco, usuario, sessao } = await preparar();
  const id = await usuario('a@x.com', antes(100 * DIA), antes(100 * DIA));
  await sessao('s-vencida', id, antes(61 * DIA));
  await sessao('s-ativa', id, antes(59 * DIA));
  const r = await limpar(banco);
  assert.deepEqual((await banco.consulta('select hash from sessoes')).rows.map((l) => l.hash), ['s-ativa']);
  assert.equal(r.sessoes, 1);
  await banco.fechar();
});

test('apaga links usados ou vencidos e mantém o link válido não usado', async () => {
  const { banco, usuario, token } = await preparar();
  const id = await usuario('a@x.com', antes(100 * DIA), antes(100 * DIA));
  await token('t-usado', id, 'senha', depois(3600 * 1000), antes(60 * 1000));
  await token('t-vencido', id, 'senha', antes(60 * 1000));
  await token('t-valido', id, 'senha', depois(3600 * 1000));
  const r = await limpar(banco);
  assert.deepEqual((await banco.consulta('select hash from tokens')).rows.map((l) => l.hash), ['t-valido']);
  assert.equal(r.tokens, 2);
  await banco.fechar();
});

test('limpar-contas é repetível', async () => {
  const { banco } = await preparar();
  assert.deepEqual(await limpar(banco), { cadastros: 0, sessoes: 0, tokens: 0 });
  assert.deepEqual(await limpar(banco), { cadastros: 0, sessoes: 0, tokens: 0 });
  await banco.fechar();
});
