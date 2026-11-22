// Versão do aviso de privacidade (privacidade.html). Mudou o sentido do aviso: aumente aqui,
// em VERSAO_AVISO do js/sf-conta.js e na página. O servidor é implantado antes do site.
export const VERSAO_AVISO = '1';

const TIPOS = ['saude', 'transferencia'];

export function aceiteValido(aceite) {
  return !!aceite && aceite.versao === VERSAO_AVISO && TIPOS.every((t) => aceite[t] === true);
}

// Usada ao confirmar: link emitido antes da 004 (ou de uma versão nova do aviso) não vira conta.
export async function temAceites(consulta, userId) {
  const r = await consulta('select count(*)::int as n from aceites where user_id = $1 and versao = $2', [userId, VERSAO_AVISO]);
  return r.rows[0].n === TIPOS.length;
}

// A data é a do servidor, nunca a do corpo do pedido.
export async function gravarAceites(consulta, userId, agora) {
  for (const tipo of TIPOS) {
    await consulta(
      `insert into aceites (user_id, tipo, versao, em) values ($1, $2, $3, $4)
         on conflict (user_id, tipo, versao) do update set em = excluded.em`,
      [userId, tipo, VERSAO_AVISO, agora],
    );
  }
}
