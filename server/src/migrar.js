import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_PADRAO = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrar(banco, pasta = PASTA_PADRAO) {
  await banco.consulta(
    'create table if not exists migracoes (nome text primary key, aplicada_em timestamptz default now())',
  );
  const feitas = new Set((await banco.consulta('select nome from migracoes')).rows.map((r) => r.nome));
  const arquivos = (await readdir(pasta)).filter((a) => a.endsWith('.sql')).sort();
  const aplicadas = [];
  for (const nome of arquivos) {
    if (feitas.has(nome)) continue;
    const sql = await readFile(join(pasta, nome), 'utf8');
    await banco.transacao(async (tx) => {
      await tx.consulta(sql);
      await tx.consulta('insert into migracoes (nome) values ($1)', [nome]);
    });
    aplicadas.push(nome);
  }
  return aplicadas;
}
