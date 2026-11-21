import { exigirSessao } from './contas.js';

const FOTO_ID = /^f-\d{4}-\d{2}-\d{2}-[a-z0-9_-]{1,60}-\d{10,16}$/;

export function chaveFoto(ambiente, userId, fotoId) {
  if (typeof fotoId !== 'string' || !FOTO_ID.test(fotoId)) throw new Error('foto-id');
  return `${ambiente}/${userId}/${fotoId}.jpg`;
}

export function registrarFotos(app, { armazenamento }) {
  // A chave usa sempre o id da sessão, nunca um valor vindo do cliente.
  const chaveDaSessao = (req, reply) => {
    try {
      return chaveFoto(app.config.ambiente, req.usuario.id, req.params.fotoId);
    } catch {
      reply.code(400).send({ erro: 'foto-id' });
      return null;
    }
  };

  app.post('/fotos/:fotoId/envio', { preHandler: exigirSessao }, async (req, reply) => {
    const chave = chaveDaSessao(req, reply);
    if (!chave) return reply;
    return armazenamento.urlEnvio(chave);
  });

  app.get('/fotos/:fotoId', { preHandler: exigirSessao }, async (req, reply) => {
    const chave = chaveDaSessao(req, reply);
    if (!chave) return reply;
    return { url: await armazenamento.urlLeitura(chave) };
  });
}
