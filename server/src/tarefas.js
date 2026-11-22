import { pathToFileURL } from 'node:url';
import { lerConfig } from './config.js';
import { criarBancoPg } from './banco.js';
import { migrar } from './migrar.js';
import { criarArmazenamentoS3 } from './armazenamento.js';
import { apagarFotosPendentes, revarrerFotosRecentes } from './contas.js';

const JANELA_REVARREDURA_MS = 48 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;
const CADASTRO_NAO_CONFIRMADO_MS = 7 * DIA_MS; // aviso de privacidade: apagado 7 dias após o cadastro
const SESSAO_OCIOSA_MS = 60 * DIA_MS; // igual a SESSAO_MAX_OCIOSA em contas.js

// Cadastro não confirmado com link ainda válido fica: quem refez o cadastro no 6º dia não perde o link.
// Aceites e tokens saem em cascata. Contas confirmadas nunca são tocadas aqui.
async function limparContas(banco, agora) {
  const cadastros = await banco.consulta(
    `delete from usuarios u
      where u.confirmado_em is null and u.criado_em < $1
        and not exists (select 1 from tokens t
                         where t.user_id = u.id and t.tipo = 'confirmar' and t.usado_em is null and t.expira_em > $2)`,
    [new Date(agora.getTime() - CADASTRO_NAO_CONFIRMADO_MS), agora],
  );
  const sessoes = await banco.consulta('delete from sessoes where ultimo_uso < $1', [
    new Date(agora.getTime() - SESSAO_OCIOSA_MS),
  ]);
  const tokens = await banco.consulta('delete from tokens where usado_em is not null or expira_em <= $1', [agora]);
  return { cadastros: cadastros.rowCount ?? 0, sessoes: sessoes.rowCount ?? 0, tokens: tokens.rowCount ?? 0 };
}

// Executa uma tarefa de linha de comando. Dependências injetáveis para teste.
export async function executarTarefa(nome, { banco, config, armazenamento, relogio = () => new Date(), log = console } = {}) {
  if (nome === 'migrar') return migrar(banco);
  if (nome === 'apagar-fotos') {
    const base = { banco, armazenamento, ambiente: config.ambiente, relogio, log: { error: (o, m) => log.error(m, o?.err?.message ?? '') } };
    const pendentes = await apagarFotosPendentes(base);
    const revarridas = await revarrerFotosRecentes({ ...base, janelaMs: JANELA_REVARREDURA_MS });
    return { pendentes, revarridas };
  }
  if (nome === 'limpar-contas') return limparContas(banco, relogio());
  throw new Error(`tarefa desconhecida: ${nome}`);
}

async function principal() {
  const nome = process.argv[2];
  const config = lerConfig(process.env);
  const banco = criarBancoPg(config.databaseUrl, { max: config.dbPoolMax });
  try {
    const armazenamento = nome === 'apagar-fotos'
      ? criarArmazenamentoS3({ regiao: config.s3.regiao, bucket: config.s3.bucketFotos })
      : undefined;
    const resultado = await executarTarefa(nome, { banco, config, armazenamento });
    console.log(JSON.stringify({ tarefa: nome, resultado }));
  } finally {
    await banco.fechar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    console.error(`tarefa falhou: ${e.message}`);
    process.exit(1);
  });
}
