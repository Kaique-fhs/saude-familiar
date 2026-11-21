import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registrarContas } from './contas.js';

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
  // trustProxy: 1 = só o CloudFront à frente; nunca true (aceitaria X-Forwarded-For forjado).
  const app = Fastify({ trustProxy: 1 });
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
      return reply.code(status).send({ erro: status === 404 ? 'nao-encontrado' : 'requisicao' });
    }
    req.log.error(erro);
    return reply.code(500).send({ erro: 'interno' });
  });

  app.get('/saude', async () => ({ ok: true }));

  registrarContas(app, { banco, email });

  return app;
}
