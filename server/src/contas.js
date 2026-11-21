import { hashSenha, conferirSenha, novoToken, hashToken, HASH_FALSO } from './seguranca.js';

import { exigirCaptcha, limitePorEmail, limitePorIp, MINUTO } from './protecao.js';

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
const VALIDADE_CONFIRMAR = 24 * HORA;
const VALIDADE_SENHA = 1 * HORA;
const SESSAO_MAX_OCIOSA = 60 * DIA;
const RENOVAR_USO_APOS = 1 * HORA;

const normalizarEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const senhaValida = (s) => typeof s === 'string' && s.length >= 8 && s.length <= 128;
const tokenTexto = (t) => (typeof t === 'string' && t.length > 0 && t.length <= 256 ? t : null);

function lerBearer(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

// Hook Fastify: exige sessão válida e coloca request.usuario = { id, email }.
export async function exigirSessao(req, reply) {
  const { banco } = req.server;
  const agora = req.server.relogio();
  const token = lerBearer(req);
  if (!token) return reply.code(401).send({ erro: 'sessao' });
  const hash = hashToken(token);
  const r = await banco.consulta(
    'select s.ultimo_uso, u.id, u.email from sessoes s join usuarios u on u.id = s.user_id where s.hash = $1',
    [hash],
  );
  const linha = r.rows[0];
  if (!linha) return reply.code(401).send({ erro: 'sessao' });
  const ultimoUso = new Date(linha.ultimo_uso).getTime();
  if (agora.getTime() - ultimoUso > SESSAO_MAX_OCIOSA) {
    await banco.consulta('delete from sessoes where hash = $1', [hash]);
    return reply.code(401).send({ erro: 'sessao' });
  }
  if (agora.getTime() - ultimoUso > RENOVAR_USO_APOS) {
    await banco.consulta('update sessoes set ultimo_uso = $1 where hash = $2', [agora, hash]);
  }
  req.sessaoHash = hash;
  req.usuario = { id: linha.id, email: linha.email };
}

export function registrarContas(app, { banco, email, captcha, armazenamento, limites }) {
  const { config } = app;

  // Cada rota sensível: limite por IP (config da rota) + captcha + limite por e-mail (preHandler).
  // O captcha vem antes do limite por e-mail: quem não passa nele não gasta a cota de um e-mail alheio.
  function protecao(nome, limite, { comCaptcha }) {
    const preHandler = [];
    if (comCaptcha) preHandler.push(exigirCaptcha(captcha));
    const porEmail = limitePorEmail(app, limites, nome, limite);
    if (porEmail) preHandler.push(porEmail);
    return { ...limitePorIp(limites, nome, limite), preHandler };
  }
  const link = (marcador, token) => `${config.origemSite}${config.caminhoSite ?? '/saude-familiar/'}#${marcador}=${token}`;

  // Sem await: o tempo de resposta não pode revelar se a conta existe.
  function enviarEmail(msg) {
    try {
      Promise.resolve(email.enviar(msg)).catch((e) => app.log.error({ err: e }, 'falha ao enviar e-mail'));
    } catch (e) {
      app.log.error({ err: e }, 'falha ao enviar e-mail');
    }
  }

  async function criarToken(consulta, userId, tipo, validadeMs, agora) {
    const { token, hash } = novoToken();
    await consulta('insert into tokens (hash, user_id, tipo, expira_em) values ($1, $2, $3, $4)', [
      hash,
      userId,
      tipo,
      new Date(agora.getTime() + validadeMs),
    ]);
    return token;
  }

  app.post('/conta/cadastro', protecao('cadastro', { max: 5, timeWindow: HORA }, { comCaptcha: true }), async (req, reply) => {
    const corpo = req.body ?? {};
    const endereco = normalizarEmail(corpo.email);
    if (!senhaValida(corpo.senha)) return reply.code(400).send({ erro: 'senha' });
    if (!endereco.includes('@')) return reply.code(400).send({ erro: 'email' });
    const agora = app.relogio();
    const hash = await hashSenha(corpo.senha); // sempre, para gastar o mesmo tempo

    const token = await banco.transacao(async (tx) => {
      let r = await tx.consulta(
        'insert into usuarios (email, senha_hash, criado_em) values ($1, $2, $3) on conflict (email) do nothing returning id',
        [endereco, hash, agora],
      );
      let userId = r.rows[0]?.id;
      if (!userId) {
        r = await tx.consulta('select id, confirmado_em from usuarios where email = $1 for update', [endereco]);
        const existente = r.rows[0];
        if (existente.confirmado_em) return null;
        userId = existente.id;
        await tx.consulta('update usuarios set senha_hash = $1 where id = $2', [hash, userId]);
        await tx.consulta(
          "update tokens set usado_em = $1 where user_id = $2 and tipo = 'confirmar' and usado_em is null",
          [agora, userId],
        );
      }
      return criarToken(tx.consulta, userId, 'confirmar', VALIDADE_CONFIRMAR, agora);
    });

    if (token) {
      enviarEmail({
        para: endereco,
        assunto: 'Confirme seu e-mail no Saúde Familiar',
        texto: `Para confirmar seu e-mail, abra o link (vale por 24 horas):\n${link('confirmar', token)}`,
      });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/conta/confirmar', async (req, reply) => {
    const token = tokenTexto((req.body ?? {}).token);
    if (!token) return reply.code(400).send({ erro: 'token' });
    const agora = app.relogio();
    const ok = await banco.transacao(async (tx) => {
      const r = await tx.consulta(
        `update tokens set usado_em = $1
          where hash = $2 and tipo = 'confirmar' and usado_em is null and expira_em > $1
          returning user_id`,
        [agora, hashToken(token)],
      );
      if (!r.rows[0]) return false;
      const userId = r.rows[0].user_id;
      await tx.consulta('update usuarios set confirmado_em = $1 where id = $2', [agora, userId]);
      await tx.consulta('delete from sessoes where user_id = $1', [userId]);
      return true;
    });
    if (!ok) return reply.code(400).send({ erro: 'token' });
    return { ok: true };
  });

  app.post('/conta/entrar', protecao('entrar', { max: 10, timeWindow: 15 * MINUTO }, { comCaptcha: false }), async (req, reply) => {
    const corpo = req.body ?? {};
    const endereco = normalizarEmail(corpo.email);
    const senha = typeof corpo.senha === 'string' ? corpo.senha : '';
    const r = await banco.consulta('select id, email, senha_hash, confirmado_em from usuarios where email = $1', [
      endereco,
    ]);
    const usuario = r.rows[0];
    const certa = await conferirSenha(senha, usuario ? usuario.senha_hash : HASH_FALSO);
    if (!usuario || !certa) return reply.code(401).send({ erro: 'credenciais' });
    if (!usuario.confirmado_em) return reply.code(403).send({ erro: 'nao-confirmado' });
    const agora = app.relogio();
    const { token, hash } = novoToken();
    // Trava a linha do usuário: se a senha mudou durante a conferência (nova-senha
    // já apagou as sessões), a sessão nova não pode entrar depois do delete.
    const entrou = await banco.transacao(async (tx) => {
      const atual = await tx.consulta('select senha_hash from usuarios where id = $1 for share', [usuario.id]);
      if (!atual.rows[0] || atual.rows[0].senha_hash !== usuario.senha_hash) return false;
      await tx.consulta('insert into sessoes (hash, user_id, criada_em, ultimo_uso) values ($1, $2, $3, $3)', [
        hash,
        usuario.id,
        agora,
      ]);
      return true;
    });
    if (!entrou) return reply.code(401).send({ erro: 'credenciais' });
    return { token, usuario: { id: usuario.id, email: usuario.email } };
  });

  app.post('/conta/sair', { preHandler: exigirSessao }, async (req, reply) => {
    await banco.consulta('delete from sessoes where hash = $1', [req.sessaoHash]);
    return reply.code(204).send();
  });

  app.get('/conta', { preHandler: exigirSessao }, async (req) => ({
    id: req.usuario.id,
    email: req.usuario.email,
  }));

  app.post('/conta/esqueci', protecao('esqueci', { max: 3, timeWindow: HORA }, { comCaptcha: true }), async (req, reply) => {
    const endereco = normalizarEmail((req.body ?? {}).email);
    const agora = app.relogio();
    const r = await banco.consulta('select id from usuarios where email = $1', [endereco]);
    if (r.rows[0]) {
      const token = await criarToken(banco.consulta, r.rows[0].id, 'senha', VALIDADE_SENHA, agora);
      enviarEmail({
        para: endereco,
        assunto: 'Troca de senha no Saúde Familiar',
        texto: `Para escolher uma nova senha, abra o link (vale por 1 hora):\n${link('nova-senha', token)}\nSe não foi você, ignore este e-mail.`,
      });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/conta/nova-senha', async (req, reply) => {
    const corpo = req.body ?? {};
    const token = tokenTexto(corpo.token);
    if (!senhaValida(corpo.senha)) return reply.code(400).send({ erro: 'senha' });
    if (!token) return reply.code(400).send({ erro: 'token' });
    const agora = app.relogio();
    const hash = await hashSenha(corpo.senha);
    const ok = await banco.transacao(async (tx) => {
      const r = await tx.consulta(
        `update tokens set usado_em = $1
          where hash = $2 and tipo = 'senha' and usado_em is null and expira_em > $1
          returning user_id`,
        [agora, hashToken(token)],
      );
      if (!r.rows[0]) return false;
      const userId = r.rows[0].user_id;
      await tx.consulta('select id from usuarios where id = $1 for update', [userId]);
      await tx.consulta('update usuarios set senha_hash = $1 where id = $2', [hash, userId]);
      await tx.consulta('delete from sessoes where user_id = $1', [userId]);
      await tx.consulta(
        "update tokens set usado_em = $1 where user_id = $2 and tipo = 'senha' and usado_em is null",
        [agora, userId],
      );
      return true;
    });
    if (!ok) return reply.code(400).send({ erro: 'token' });
    return { ok: true };
  });

  app.delete('/conta', { preHandler: exigirSessao }, async (req, reply) => {
    const senha = typeof (req.body ?? {}).senha === 'string' ? req.body.senha : '';
    const r = await banco.consulta('select senha_hash from usuarios where id = $1', [req.usuario.id]);
    if (!r.rows[0] || !(await conferirSenha(senha, r.rows[0].senha_hash))) {
      return reply.code(401).send({ erro: 'credenciais' });
    }
    const agora = app.relogio();
    await banco.transacao(async (tx) => {
      await tx.consulta('insert into contas_apagadas (user_id, apagada_em) values ($1, $2) on conflict (user_id) do nothing', [req.usuario.id, agora]);
      await tx.consulta('delete from usuarios where id = $1', [req.usuario.id]);
    });
    // A conta já sumiu: se as fotos falharem, ficam pendentes e são tentadas de novo.
    try {
      await apagarFotosPendentes({ banco, armazenamento, ambiente: config.ambiente, relogio: app.relogio, log: app.log });
    } catch (e) {
      app.log.error({ err: e }, 'falha ao apagar fotos pendentes');
    }
    return reply.code(204).send();
  });
}

// Apaga as fotos das contas já removidas e ainda pendentes. Falha de uma não
// impede as outras; devolve quantas concluiu.
export async function apagarFotosPendentes({ banco, armazenamento, ambiente, relogio, log = { error() {} } }) {
  const r = await banco.consulta('select user_id from contas_apagadas where fotos_apagadas_em is null');
  let concluidas = 0;
  for (const { user_id: userId } of r.rows) {
    try {
      await armazenamento.apagarPrefixo(`${ambiente}/${userId}/`);
      await banco.consulta('update contas_apagadas set fotos_apagadas_em = $1 where user_id = $2', [
        relogio(),
        userId,
      ]);
      concluidas++;
    } catch (e) {
      log.error({ err: e, userId }, 'falha ao apagar fotos da conta');
    }
  }
  return concluidas;
}
