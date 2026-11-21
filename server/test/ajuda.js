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
  return { 'x-saude-origem': 'segredo-teste', ...extra };
}
