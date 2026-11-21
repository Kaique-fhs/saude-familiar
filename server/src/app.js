import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registrarContas } from './contas.js';
import { registrarLimites } from './protecao.js';

function segredoConfere(recebido, esperado) {
  if (typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// banco, email, captcha, armazenamento, relogio e limites são aceitos aqui e
// usados pelas tasks seguintes.
export async function criarApp({
  config,
  banco,
  email,
  captcha,
  armazenamento,
  relogio = () => new Date(),
  limites = true,
}) {
  // Só 1 salto de proxy (o CloudFront) é confiável; nunca true (aceitaria X-Forwarded-For forjado).
  // Com trustProxy numérico o Fastify 5.12 não confia em ninguém (request.ip seria sempre o
  // endereço do CloudFront), por isso a função: confia no 1º salto (o par TCP) e request.ip
  // passa a ser o ÚLTIMO endereço do X-Forwarded-For, o que o CloudFront acrescentou.
  const app = Fastify({ trustProxy: (_endereco, salto) => salto < 1 });
  app.decorate('config', config);
  app.decorate('relogio', relogio);
  app.decorate('banco', banco);

  const origensLocais = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  await app.register(cors, {
    origin: (origem, cb) => {
      if (!origem) return cb(null, false);
      const permitida =
        origem === config.origemSite ||
        (config.ambiente === 'teste' && origensLocais.test(origem));
      cb(null, permitida);
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-turnstile-token'],
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, corpo, done) => {
    if (corpo === '' || corpo === undefined) return done(null, {});
    try {
      done(null, JSON.parse(corpo));
    } catch {
      const erro = new Error('json malformado');
      erro.statusCode = 400;
      done(erro);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return; // preflight é tratado pelo CORS
    if (req.method === 'GET' && req.url.split('?')[0] === '/saude') return;
    if (!segredoConfere(req.headers['x-saude-origem'], config.segredoOrigem)) {
      return reply.code(403).send({ erro: 'origem' });
    }
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ erro: 'nao-encontrado' }));

  app.setErrorHandler((erro, req, reply) => {
    const status = erro.statusCode;
    if (status >= 400 && status < 500) {
      const codigos = { 404: 'nao-encontrado', 429: 'limite' };
      return reply.code(status).send({ erro: codigos[status] ?? 'requisicao' });
    }
    req.log.error(erro);
    return reply.code(500).send({ erro: 'interno' });
  });

  // Limites em memória (uma instância só). Antes das rotas: o plugin usa o hook onRoute.
  if (limites) await registrarLimites(app);

  // Verificação de saúde fica fora do limite por IP.
  app.get('/saude', { config: { rateLimit: false } }, async () => ({ ok: true }));

  registrarContas(app, { banco, email, captcha, limites });

  return app;
}
