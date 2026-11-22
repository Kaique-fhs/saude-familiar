import { lerConfig } from './config.js';
import { criarBancoPg } from './banco.js';
import { migrar } from './migrar.js';
import { criarApp } from './app.js';
import { criarEmailSmtp } from './email.js';
import { comTetoDiario, criarCaptchaTurnstile } from './protecao.js';
import { criarArmazenamentoS3 } from './armazenamento.js';
import { apagarFotosPendentes } from './contas.js';

const config = lerConfig(process.env);
const relogio = () => new Date();

const banco = criarBancoPg(config.databaseUrl, { max: config.dbPoolMax });
await migrar(banco);

const armazenamento = criarArmazenamentoS3({ regiao: config.s3.regiao, bucket: config.s3.bucketFotos });
const app = await criarApp({
  config,
  banco,
  email: comTetoDiario(criarEmailSmtp(config.smtp), banco, config.tetoEmailsDia, relogio),
  captcha: criarCaptchaTurnstile(config.turnstileSegredo),
  armazenamento,
  relogio,
  logger: true,
});

// Fotos de contas apagadas que ficaram pendentes; falha aqui não derruba o servidor.
try {
  const n = await apagarFotosPendentes({ banco, armazenamento, ambiente: config.ambiente, relogio, log: app.log });
  if (n) app.log.info(`fotos apagadas de ${n} conta(s) pendente(s)`);
} catch (e) {
  app.log.error({ err: e }, 'falha ao apagar fotos pendentes na partida');
}

await app.listen({ host: '127.0.0.1', port: config.porta });
