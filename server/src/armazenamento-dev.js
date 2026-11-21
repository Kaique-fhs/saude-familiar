import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import multipart from '@fastify/multipart';

const MAX_BYTES = 5 * 1024 * 1024;

// Caminho da chave dentro da pasta; null se tentar sair dela.
function caminhoDe(pasta, chave) {
  if (typeof chave !== 'string' || chave === '' || chave.includes('\0')) return null;
  const raiz = resolve(pasta);
  const alvo = resolve(raiz, chave);
  return alvo.startsWith(raiz + sep) ? alvo : null;
}

// Armazenamento só do desenvolvimento: fotos em disco, servidas pelo próprio servidor.
export function criarArmazenamentoDev({ pasta, baseUrl }) {
  return {
    async urlEnvio(chave) {
      return { url: `${baseUrl}/dev-fotos`, campos: { key: chave } };
    },
    async urlLeitura(chave) {
      return `${baseUrl}/dev-fotos/${encodeURIComponent(chave)}`;
    },
    async apagarPrefixo(prefixo) {
      if (typeof prefixo !== 'string' || !prefixo.endsWith('/')) throw new Error('prefixo');
      const alvo = caminhoDe(pasta, prefixo);
      if (!alvo) throw new Error('prefixo');
      await rm(alvo, { recursive: true, force: true });
    },
  };
}

// Rotas só do dev: POST /dev-fotos (multipart key + file) e GET /dev-fotos/*.
// O app precisa ter sido criado com rotasLivres para /dev-fotos.
export function registrarRotasDev(app, { pasta }) {
  app.register(async (rotas) => {
    await rotas.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 5 } });

    rotas.post('/dev-fotos', async (req, reply) => {
      let chave = null;
      let gravou = false;
      for await (const parte of req.parts()) {
        if (parte.type === 'field') {
          if (parte.fieldname === 'key') chave = parte.value;
          continue;
        }
        const alvo = caminhoDe(pasta, chave);
        if (!alvo) {
          parte.file.resume();
          return reply.code(400).send({ erro: 'requisicao' });
        }
        await mkdir(dirname(alvo), { recursive: true });
        await writeFile(alvo, await parte.toBuffer());
        gravou = true;
      }
      if (!gravou) return reply.code(400).send({ erro: 'requisicao' });
      return reply.code(204).send();
    });

    rotas.get('/dev-fotos/*', async (req, reply) => {
      const alvo = caminhoDe(pasta, req.params['*']);
      if (!alvo) return reply.code(404).send({ erro: 'nao-encontrado' });
      try {
        const bytes = await readFile(alvo);
        return reply.type('image/jpeg').send(bytes);
      } catch {
        return reply.code(404).send({ erro: 'nao-encontrado' });
      }
    });
  });
}
