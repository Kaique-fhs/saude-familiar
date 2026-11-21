// Servidor de desenvolvimento: roda o site contra a API sem AWS (PGlite em disco,
// e-mail no console, fotos em disco). Nunca use em produção.
import { fileURLToPath } from 'node:url';
import { lerConfig } from './config.js';
import { criarBancoPglite } from './banco.js';
import { migrar } from './migrar.js';
import { criarApp } from './app.js';
import http from 'node:http';
import { criarManipuladorSite } from './site-dev.js';
import { criarArmazenamentoDev, registrarRotasDev } from './armazenamento-dev.js';

const aqui = (relativo) => fileURLToPath(new URL(relativo, import.meta.url));

const porta = Number(process.env.PORT ?? 3000);
const baseUrl = `http://127.0.0.1:${porta}`;
const portaSite = Number(process.env.PORT_SITE ?? 5500);
const config = lerConfig({
  AMBIENTE: 'teste',
  SEGREDO_ORIGEM: 'dev',
  ORIGEM_SITE: 'http://localhost:5500',
  CAMINHO_SITE: '/',
  PORT: String(porta),
});

const banco = await criarBancoPglite(aqui('../.pg-dev'));
await migrar(banco);

const pastaFotos = aqui('../.fotos-dev');

// E-mail de desenvolvimento: imprime a mensagem (com o link) no console.
const email = {
  async enviar({ para, assunto, texto }) {
    console.log(`\n--- e-mail para ${para} ---\n${assunto}\n${texto}\n---\n`);
  },
};

const app = await criarApp({
  config,
  banco,
  email,
  captcha: { verificar: async () => true },
  armazenamento: criarArmazenamentoDev({ pasta: pastaFotos, baseUrl }),
  limites: false,
  logger: true,
  rotasLivres: ['/dev-fotos', '/config.js'],
});

registrarRotasDev(app, { pasta: pastaFotos });

// Mesmo window.SF_CONFIG do config.js do site, com os valores de desenvolvimento.
const configDev = {
  apiUrl: baseUrl,
  turnstileChave: '1x00000000000000000000AA',
  cabecalhoOrigemDev: 'dev',
};
app.get('/config.js', async (req, reply) =>
  reply.type('application/javascript; charset=utf-8').send(`window.SF_CONFIG = ${JSON.stringify(configDev)};\n`),
);

await app.listen({ host: '127.0.0.1', port: porta });

// O site (raiz do repositório) é servido aqui mesmo, com /config.js de desenvolvimento.
const site = http.createServer(criarManipuladorSite({ raiz: aqui('../../'), configDev }));
await new Promise((ok, falha) => {
  site.once('error', falha);
  site.listen(portaSite, '127.0.0.1', ok);
});
console.log(`API em ${baseUrl}\nSite em http://localhost:${portaSite} (abra este endereço)`);
