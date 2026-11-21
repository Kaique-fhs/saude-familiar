import { pathToFileURL } from 'node:url';
import { lerConfig } from './config.js';
import { criarBancoPg } from './banco.js';
import { migrar } from './migrar.js';
import { criarArmazenamentoS3 } from './armazenamento.js';
import { apagarFotosPendentes, revarrerFotosRecentes } from './contas.js';

const JANELA_REVARREDURA_MS = 48 * 3600 * 1000;

// Executa uma tarefa de linha de comando. Dependências injetáveis para teste.
export async function executarTarefa(nome, { banco, config, armazenamento, relogio = () => new Date(), log = console } = {}) {
  if (nome === 'migrar') return migrar(banco);
  if (nome === 'apagar-fotos') {
    const base = { banco, armazenamento, ambiente: config.ambiente, relogio, log: { error: (o, m) => log.error(m, o?.err?.message ?? '') } };
    const pendentes = await apagarFotosPendentes(base);
    const revarridas = await revarrerFotosRecentes({ ...base, janelaMs: JANELA_REVARREDURA_MS });
    return { pendentes, revarridas };
  }
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
