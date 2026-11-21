function obrigatoria(env, nome) {
  const valor = env[nome];
  if (valor === undefined || valor === '') throw new Error(`config: ${nome} ausente`);
  return valor;
}

export function lerConfig(env) {
  const segredoOrigem = obrigatoria(env, 'SEGREDO_ORIGEM');
  const origemSite = obrigatoria(env, 'ORIGEM_SITE');
  return {
    porta: Number(env.PORT ?? 3000),
    ambiente: env.AMBIENTE === 'teste' ? 'teste' : 'producao',
    databaseUrl: env.DATABASE_URL ?? '',
    origemSite,
    segredoOrigem,
    turnstileSegredo: env.TURNSTILE_SECRET ?? '',
    smtp: {
      host: env.SMTP_HOST ?? '',
      porta: Number(env.SMTP_PORT ?? 465),
      usuario: env.SMTP_USER ?? '',
      senha: env.SMTP_PASS ?? '',
      remetente: env.EMAIL_REMETENTE ?? '',
    },
    tetoEmailsDia: Number(env.TETO_EMAILS_DIA ?? 300),
    s3: {
      regiao: env.S3_REGIAO ?? 'us-east-2',
      bucketFotos: env.S3_BUCKET_FOTOS ?? '',
    },
  };
}
