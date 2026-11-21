import pg from 'pg';

// Interface Banco: consulta, transacao, comoUsuario, fechar.
function montar(executar, abrirTransacao, fechar) {
  const banco = {
    consulta: executar,
    async transacao(fn) {
      return abrirTransacao(fn);
    },
    async comoUsuario(userId, fn) {
      return abrirTransacao(async (tx) => {
        await tx.consulta('SET LOCAL ROLE saude_app');
        await tx.consulta("select set_config('app.user_id', $1, true)", [userId]);
        return fn(tx);
      });
    },
    fechar,
  };
  return banco;
}

export function criarBancoPg(url, { max } = {}) {
  const pool = new pg.Pool({ connectionString: url, ...(max ? { max } : {}) });
  // Erro em client ocioso (queda de rede, reinício do banco) não pode derrubar o processo.
  pool.on('error', (e) => console.error('erro no pool do banco:', e.message));
  const doCliente = (cliente) => ({
    consulta: (sql, params) => cliente.query(sql, params),
  });
  const banco = montar(
    (sql, params) => pool.query(sql, params),
    async (fn) => {
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        const tx = montar(doCliente(cliente).consulta, () => { throw new Error('transação aninhada'); }, async () => {});
        const r = await fn(tx);
        await cliente.query('commit');
        return r;
      } catch (e) {
        try { await cliente.query('rollback'); } catch { /* ignora */ }
        throw e;
      } finally {
        cliente.release();
      }
    },
    () => pool.end(),
  );
  banco.pool = pool; // exposto para teste
  return banco;
}

// Sem parâmetros o PGlite usa exec (aceita vários comandos, como o pg); devolve o último resultado.
async function rodar(alvo, sql, params) {
  if (params === undefined) {
    const rs = await alvo.exec(sql);
    return rs.length ? rs[rs.length - 1] : { rows: [] };
  }
  return alvo.query(sql, params);
}

// Sem pasta: em memória. Com pasta: persistido em disco (usado só pelo servidor de desenvolvimento).
export async function criarBancoPglite(pasta) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = pasta ? new PGlite(pasta) : new PGlite();
  await db.waitReady;
  return montar(
    (sql, params) => rodar(db, sql, params),
    (fn) =>
      db.transaction((t) =>
        fn(montar((sql, params) => rodar(t, sql, params), () => { throw new Error('transação aninhada'); }, async () => {})),
      ),
    () => db.close(),
  );
}
