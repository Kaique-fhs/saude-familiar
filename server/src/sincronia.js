import { isDeepStrictEqual } from 'node:util';
import { exigirSessao } from './contas.js';

const TIPOS = ['fav', 'sel', 'check', 'checkplano', 'quero', 'feito', 'treino', 'registro', 'plano', 'meta'];
const TIPOS_COM_DATA = new Set(['feito', 'treino', 'registro']);
const CHAVE_COM_DATA = /^\d{4}-\d{2}-\d{2}\|[a-z0-9_-]{1,60}$/;
const CHAVE_PLANO = /^(inicio|\d{4}-\d{2}-\d{2})$/;
const CHAVE_META = /^[a-z0-9_-]{1,60}$/;
const MAX_VALOR_BYTES = 64 * 1024;
const MAX_MUDANCAS = 500;
const TOLERANCIA_FUTURO = 5 * 60 * 1000;

const instante = (v) => new Date(v).getTime();

// Regra de conflito por item (pura). atual/mudanca com `em` ISO ou Date.
export function decidir(atual, mudanca) {
  if (!atual) return 'aplicar';
  if (mudanca.tipo === 'registro' && atual.ativo && atual.valor?.foto) {
    return isDeepStrictEqual(mudanca.valor ?? null, atual.valor) ? 'ignorar' : 'conflito';
  }
  return instante(mudanca.em) > instante(atual.em) ? 'aplicar' : 'ignorar';
}

function validarMudanca(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  if (!TIPOS.includes(x.tipo)) return null;
  if (typeof x.chave !== 'string' || x.chave.length < 1 || x.chave.length > 200) return null;
  if (TIPOS_COM_DATA.has(x.tipo) && !CHAVE_COM_DATA.test(x.chave)) return null;
  if (x.tipo === 'plano' && !CHAVE_PLANO.test(x.chave)) return null;
  if (x.tipo === 'meta' && !CHAVE_META.test(x.chave)) return null;
  if (typeof x.ativo !== 'boolean') return null;
  if ((x.tipo === 'plano' || x.tipo === 'meta') && x.ativo
    && (x.valor === null || typeof x.valor !== 'object' || Array.isArray(x.valor))) return null;
  if (typeof x.em !== 'string' || Number.isNaN(instante(x.em))) return null;
  const valor = x.valor === undefined ? null : x.valor;
  if (Buffer.byteLength(JSON.stringify(valor), 'utf8') > MAX_VALOR_BYTES) return null;
  return { tipo: x.tipo, chave: x.chave, valor, ativo: x.ativo, em: new Date(x.em) };
}

function paraItem(linha) {
  return {
    tipo: linha.tipo,
    chave: linha.chave,
    valor: linha.valor ?? null,
    ativo: linha.ativo,
    em: new Date(linha.em).toISOString(),
    seq: Number(linha.seq),
  };
}

const COLUNAS = 'tipo, chave, valor, ativo, em, seq';

export function registrarSincronia(app, { banco }) {
  app.post('/sync', { preHandler: exigirSessao }, async (req, reply) => {
    const lista = (req.body ?? {}).mudancas;
    if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_MUDANCAS) {
      return reply.code(400).send({ erro: 'sync' });
    }
    const mudancas = lista.map(validarMudanca);
    if (mudancas.some((x) => x === null)) return reply.code(400).send({ erro: 'sync' });

    const agora = app.relogio();
    const teto = agora.getTime() + TOLERANCIA_FUTURO;
    for (const x of mudancas) if (x.em.getTime() > teto) x.em = new Date(teto);

    const userId = req.usuario.id;
    const conflitos = await banco.comoUsuario(userId, async (tx) => {
      await tx.consulta('select pg_advisory_xact_lock(hashtext($1))', [userId]);
      const saida = [];
      for (const x of mudancas) {
        const r = await tx.consulta(`select ${COLUNAS} from itens where user_id = $1 and tipo = $2 and chave = $3`, [
          userId,
          x.tipo,
          x.chave,
        ]);
        const atual = r.rows[0] ? paraItem(r.rows[0]) : null;
        const decisao = decidir(atual, x);
        if (decisao === 'conflito') {
          saida.push(atual);
        } else if (decisao === 'aplicar') {
          await tx.consulta(
            `insert into itens (user_id, tipo, chave, valor, ativo, em, seq)
             values ($1, $2, $3, $4::jsonb, $5, $6, nextval('itens_seq'))
             on conflict (user_id, tipo, chave) do update
               set valor = excluded.valor, ativo = excluded.ativo, em = excluded.em, seq = excluded.seq`,
            [userId, x.tipo, x.chave, JSON.stringify(x.valor), x.ativo, x.em],
          );
        }
      }
      return saida;
    });
    return { conflitos };
  });

  app.get('/sync', { preHandler: exigirSessao }, async (req, reply) => {
    const q = req.query ?? {};
    const depois = q.depois === undefined ? 0 : Number(q.depois);
    const limite = q.limite === undefined ? 500 : Number(q.limite);
    if (!Number.isInteger(depois) || depois < 0 || !Number.isInteger(limite) || limite < 1) {
      return reply.code(400).send({ erro: 'sync' });
    }
    const n = Math.min(limite, 1000);
    const userId = req.usuario.id;
    const linhas = await banco.comoUsuario(userId, async (tx) => {
      await tx.consulta('select pg_advisory_xact_lock(hashtext($1))', [userId]);
      const r = await tx.consulta(
        `select ${COLUNAS} from itens where user_id = $1 and seq > $2 order by seq limit $3`,
        [userId, depois, n + 1],
      );
      return r.rows;
    });
    const mais = linhas.length > n;
    const itens = linhas.slice(0, n).map(paraItem);
    return { itens, cursor: itens.length ? itens[itens.length - 1].seq : depois, mais };
  });
}
