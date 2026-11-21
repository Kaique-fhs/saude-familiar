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

const banco = criarBancoPg(config.databaseUrl);
await migrar(banco);

const armazenamento = criarArmazenamentoS3({ regiao: config.s3.regiao, bucket: config.s3.bucketFotos });
const app = await criarApp({
  config,
  banco,
  email: comTetoDiario(criarEmailSmtp(config.smtp), banco, config.tetoEmailsDia, relogio),
  captcha: criarCaptchaTurnstile(config.turnstileSegredo),
  armazenamento,
  relogio,
});

// Fotos de contas apagadas que ficaram pendentes; falha aqui não derruba o servidor.
try {
  const n = await apagarFotosPendentes({ banco, armazenamento, ambiente: config.ambiente, relogio });
  if (n) console.log(`fotos apagadas de ${n} conta(s) pendente(s)`);
} catch (e) {
  console.error('falha ao apagar fotos pendentes na partida:', e.message);
}

await app.listen({ host: '0.0.0.0', port: config.porta });
