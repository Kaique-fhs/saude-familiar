// Versão do aviso de privacidade (privacidade.html). Mudou o sentido do aviso: aumente aqui,
// em VERSAO_AVISO do js/sf-conta.js e na página. O servidor é implantado antes do site.
export const VERSAO_AVISO = '1';

const TIPOS = ['saude', 'transferencia'];

export function aceiteValido(aceite) {
  return !!aceite && aceite.versao === VERSAO_AVISO && TIPOS.every((t) => aceite[t] === true);
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
