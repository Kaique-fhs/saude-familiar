function obrigatoria(env, nome) {
  const valor = env[nome];
  if (valor === undefined || valor === '') throw new Error(`config: ${nome} ausente`);
  return valor;
}

function inteiroPositivo(env, nome, padrao) {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  if (!/^[0-9]+$/.test(String(bruto)) || Number(bruto) < 1) throw new Error(`config: ${nome} inválido`);
  return Number(bruto);
}

export function lerConfig(env) {
  const segredoOrigem = obrigatoria(env, 'SEGREDO_ORIGEM');
  const origemSite = obrigatoria(env, 'ORIGEM_SITE');
  return {
    porta: inteiroPositivo(env, 'PORT', 3000),
    ambiente: env.AMBIENTE === 'teste' ? 'teste' : 'producao',
    databaseUrl: env.DATABASE_URL ?? '',
    origemSite,
    caminhoSite: env.CAMINHO_SITE || '/saude-familiar/',
    segredoOrigem,
    turnstileSegredo: env.TURNSTILE_SECRET ?? '',
    smtp: {
      host: env.SMTP_HOST ?? '',
      porta: inteiroPositivo(env, 'SMTP_PORT', 465),
      usuario: env.SMTP_USER ?? '',
      senha: env.SMTP_PASS ?? '',
      remetente: env.EMAIL_REMETENTE ?? '',
    },
    tetoEmailsDia: inteiroPositivo(env, 'TETO_EMAILS_DIA', 300),
    trustProxySaltos: inteiroPositivo(env, 'TRUST_PROXY_SALTOS', 1),
    dbPoolMax: inteiroPositivo(env, 'DB_POOL_MAX', 5),
    s3: {
      regiao: env.S3_REGIAO ?? 'us-east-2',
      bucketFotos: env.S3_BUCKET_FOTOS ?? '',
    },
  };
}
