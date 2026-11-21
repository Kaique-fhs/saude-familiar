import rateLimit from '@fastify/rate-limit';

const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Interface Captcha: verificar(token, ip) -> Promise<boolean>
export function criarCaptchaTurnstile(segredo, buscar = fetch) {
  return {
    async verificar(token, ip) {
      if (typeof token !== 'string' || token === '') return false;
      try {
        const corpo = new URLSearchParams({ secret: segredo, response: token, remoteip: ip });
        const r = await buscar(URL_TURNSTILE, { method: 'POST', body: corpo });
        if (!r.ok) return false;
        const json = await r.json();
        return json.success === true;
      } catch {
        return false;
      }
    },
  };
}

// Envolve um Email: acima do teto diário não envia e lança Error('teto-email').
// O dia vem de relogio() (data UTC, AAAA-MM-DD), nunca do banco.
export function comTetoDiario(email, banco, teto, relogio) {
  return {
    async enviar(msg) {
      const dia = relogio().toISOString().slice(0, 10);
      const r = await banco.consulta(
        `insert into envios_email (dia, total) values ($1, 1)
           on conflict (dia) do update set total = envios_email.total + 1
         returning total`,
        [dia],
      );
      if (r.rows[0].total > teto) throw new Error('teto-email');
      return email.enviar(msg);
    },
  };
}

export const MINUTO = 60 * 1000;
export const HORA = 60 * MINUTO;

export const LIMITE_GERAL = { max: 300, timeWindow: MINUTO };

// Registra o plugin: 300/min por IP em todas as rotas, e 429 {erro:"limite"}.
export async function registrarLimites(app) {
  await app.register(rateLimit, {
    global: true,
    ...LIMITE_GERAL,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, erro: 'limite' }),
  });
}

// Config de rota para o limite por IP (onRequest, feito pelo plugin).
export function limitePorIp(limites, nome, { max, timeWindow }) {
  if (!limites) return {};
  return { config: { rateLimit: { max, timeWindow, groupId: nome, keyGenerator: (req) => req.ip } } };
}

// preHandler do limite por e-mail normalizado (o corpo só existe depois do parse).
export function limitePorEmail(app, limites, nome, { max, timeWindow }) {
  if (!limites) return null;
  const conferir = app.createRateLimit({
    max,
    timeWindow,
    groupId: nome,
    keyGenerator: (req) => `email:${nome}:${chaveEmail(req)}`,
  });
  return async (req, reply) => {
    if (!chaveEmail(req)) return; // sem e-mail válido a rota rejeita; o limite por IP já vale
    const r = await conferir(req);
    if (r.isExceeded) return reply.code(429).send({ erro: 'limite' });
  };
}

const chaveEmail = (req) => {
  const e = req.body?.email;
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
};

// preHandler do captcha: sem token ou recusado → 400 captcha.
export function exigirCaptcha(captcha) {
  return async (req, reply) => {
    const token = req.headers['x-turnstile-token'];
    const ok = typeof token === 'string' && token !== '' && (await captcha.verificar(token, req.ip));
    if (!ok) return reply.code(400).send({ erro: 'captcha' });
  };
}
