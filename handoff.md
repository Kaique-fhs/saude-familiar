# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão.
- 22/11/2026: orçamento de US$ 20 mede gasto bruto (`IncludeCredit: false`).
- 22/11/2026: abrir o cadastro antes dos planos 3 e 4, com 2 travas (ADR-005): conta não vê o `PLANO` do `data.js`; aparelho que já usou o app antigo (`mp-*`) segue local, sem conta.
- 22/11/2026: cadastro exige aceite versionado do aviso de privacidade (ADR-006); versão nova sobe no servidor antes do site.
- 22/11/2026: responsável, encarregado, contato e acesso do aviso informados pelo Kaique; pasta Enviados do Gmail limpa a cada 30 dias, à mão.
- Rulings e pendências dos planos 1, 2 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026)
- Máquina roda `d530cfb` de `feat/contas-ec2` (22/11 17:51 UTC, ~5 s de 502): 004 nos dois bancos, zero contas, sem erro nos logs, `test:pg` 58/58.
- Recusa do aceite não testada por fora: o captcha de teste recusou o token fictício antes dela (causa não verificada). A `fumaca.sh` depende desse token.
- `feat/aceite-site` (local): aviso preenchido, menos data de publicação e base da transferência. TRAVA DE PUBLICAÇÃO vermelha até lá. Rascunhos em `docs/privacidade/`, sem commit.
- `feat/aceite` nunca vai ao `main` (a tela dele não manda o aceite).
- E-mail de alerta: SNS registrou entrega às 15:32 UTC; recebimento na caixa não confirmado.
- Desligar o cadastro: reverter o commit `c2093fd` (só `config.js`, README e o teste dele).

## Ordem
1. Kaique decide a transferência aos EUA (consentimento ou esperar advogado); pôr a data e ver a trava verde.
2. Antes do push do site: conferir o celular da Rejane (sem `mp-*` cai no login) e salvar cópia; ciência de que o `main` público passa a ter docs internos.
3. Push de `feat/aceite-site` para `feat/contas-ec2` e `main`, com `--atomic`, feito pelo Kaique.
4. Conferir build do Pages, `config.js` e aviso no ar, 404 em `/docs/`, `/handoff.md`, `/server/`.
5. Kaique cria a primeira conta em janela anônima: Turnstile real, e-mail, confirmar, entrar, esqueci a senha.
6. Planos 3 (plano e metas por pessoa) e 4 (migração); o 4 remove a trava do aparelho antigo. Depois, plano 6.

## Dúvidas em aberto
- Sem "Restaurar cópia" para aparelho sem dados até o plano 4 (troca de celular da Rejane).
- Logs além de 30 dias (syslog ~5 semanas, Postgres ~11): ajuste de rotação aguarda OK.
- Limpeza de cadastros não confirmados; roteiros de incidente e de pedidos de titular.
- Passar ao plano pago antes de 2027-03-23.
- Gravar o ADR-004; alinhar a spec §8.1 e §8.5.
- Menores da revisão: "Nova senha" com sessão não tem voltar; `sair` sem timeout; `sw.js` apaga caches de outros sites da mesma origem; token em `localStorage` de origem compartilhada (domínio próprio resolve).
- Push é pela conta `Kaique-fhs`; a ativa no gh costuma ser `triokids`, e quem troca é o Kaique.
