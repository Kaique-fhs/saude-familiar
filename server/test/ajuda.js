import { lerConfig } from '../src/config.js';

export function configTeste(extra = {}) {
  return {
    ...lerConfig({
      AMBIENTE: 'teste',
      ORIGEM_SITE: 'https://kaique-fhs.github.io',
      SEGREDO_ORIGEM: 'segredo-teste',
      DATABASE_URL: 'postgres://teste',
      TURNSTILE_SECRET: 'turnstile-teste',
    }),
    ...extra,
  };
}

export function cabecalhos(extra = {}) {
  return { 'x-saude-origem': 'segredo-teste', 'x-turnstile-token': 'token-teste', ...extra };
}

// Captcha falso: aceita (ou recusa) qualquer token; registra as chamadas.
export function captchaFalso(aceita = true) {
  const chamadas = [];
  return {
    chamadas,
    async verificar(token, ip) {
      chamadas.push({ token, ip });
      return aceita;
    },
  };
}

export async function novoBancoTeste() {
  const { criarBancoPglite } = await import('../src/banco.js');
  const { migrar } = await import('../src/migrar.js');
  const banco = await criarBancoPglite();
  await migrar(banco);
  return banco;
}

// Email falso: registra na chamada (síncrono), pois a rota não espera o envio.
export function emailFalso() {
  const enviados = [];
  return {
    enviados,
    enviar(msg) {
      enviados.push(msg);
      return Promise.resolve();
    },
  };
}

// Armazenamento falso: registra as chamadas e devolve URLs https://falso/<chave>.
export function armazenamentoFalso() {
  const chamadas = [];
  return {
    chamadas,
    async urlEnvio(chave) {
      chamadas.push({ tipo: 'envio', chave });
      return { url: `https://falso/${chave}`, campos: { key: chave } };
    },
    async urlLeitura(chave) {
      chamadas.push({ tipo: 'leitura', chave });
      return `https://falso/${chave}`;
    },
    async apagarPrefixo(prefixo) {
      if (typeof prefixo !== 'string' || !prefixo.endsWith('/')) throw new Error('prefixo');
      chamadas.push({ tipo: 'apagar', prefixo });
    },
  };
}

const emailsDosApps = new WeakMap();

export async function criarAppTeste(opcoes = {}) {
  const { criarApp } = await import('../src/app.js');
  const bancoReal = await novoBancoTeste();
  const banco = opcoes.envolverBanco ? opcoes.envolverBanco(bancoReal) : bancoReal;
  const caixa = emailFalso();
  let agora = new Date('2026-11-21T12:00:00Z').getTime();
  const relogio = () => new Date(agora);
  relogio.avancar = (ms) => {
    agora += ms;
  };
  // opcoes.tetoEmails: envolve o e-mail falso com o teto diário.
  let email = caixa;
  if (opcoes.tetoEmails !== undefined) {
    const { comTetoDiario } = await import('../src/protecao.js');
    email = comTetoDiario(caixa, banco, opcoes.tetoEmails, relogio);
  }
  const app = await criarApp({
    config: configTeste(opcoes.config),
    banco,
    email,
    captcha: captchaFalso(true),
    armazenamento: armazenamentoFalso(),
    relogio,
    // Limites desligados por padrão: os testes de contas repetem muitas chamadas do mesmo IP.
    limites: opcoes.limites ?? false,
    ...opcoes.deps,
  });
  emailsDosApps.set(app, caixa);
  return { app, banco, email: caixa, relogio };
}

// Último token enviado por e-mail com o marcador (ex.: '#confirmar=').
export function tokenDoEmail(email, marcador) {
  for (let i = email.enviados.length - 1; i >= 0; i--) {
    const m = email.enviados[i].texto.match(new RegExp(`${marcador}([A-Za-z0-9_-]+)`));
    if (m) return m[1];
  }
  return null;
}

export async function contaLogada(app, email, opcoes = {}) {
  const senha = opcoes.senha ?? 'senha-de-teste-123';
  const caixa = emailsDosApps.get(app);
  const h = cabecalhos();
  await app.inject({ method: 'POST', url: '/conta/cadastro', headers: h, payload: { email, senha } });
  const token = tokenDoEmail(caixa, '#confirmar=');
  await app.inject({ method: 'POST', url: '/conta/confirmar', headers: h, payload: { token } });
  const r = await app.inject({ method: 'POST', url: '/conta/entrar', headers: h, payload: { email, senha } });
  const corpo = r.json();
  return { token: corpo.token, id: corpo.usuario.id, email: corpo.usuario.email };
}
