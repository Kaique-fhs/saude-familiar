# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão.
- 22/11/2026: orçamento de US$ 20 mede gasto bruto (`IncludeCredit: false`).
- 22/11/2026: abrir o cadastro antes dos planos 3 e 4, com 2 travas (ADR-005): conta não vê o `PLANO` do `data.js`; aparelho que já usou o app antigo (`mp-*`) segue local, sem conta.
- 22/11/2026: cadastro exige aceite versionado do aviso de privacidade (ADR-006); versão nova sobe no servidor antes do site.
- 22/11/2026: responsável, encarregado, contato e acesso do aviso informados pelo Kaique; pasta Enviados do Gmail limpa a cada 30 dias, à mão.
- 22/11/2026: plano 3 implementado remove a trava 1 do ADR-005 (conta vê o próprio plano). A trava 2 continua até o plano 4. O ADR que encerra as travas fica com a sessão principal.
- Rulings e pendências dos planos 1, 2, 3 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026)
- Máquina roda `9e23f0e` (22/11 22:21 UTC, ~13 s de 502 intermitente): 4 migrações nos dois bancos, zero contas, sem erro nos logs, `saude-logs.timer` ativo (rodado à mão: sucesso, nada a apagar). `test:pg` 58/58 em `d530cfb`.
- Recusa do aceite não testada por fora: o captcha de teste recusou o token fictício antes dela (causa não verificada). A `fumaca.sh` depende desse token.
- Site no ar desde 22/11 (`main` = `feat/contas-ec2` = `9e23f0e`, Pages built): cadastro ligado à API de produção, aviso versão 1 sem campo em aberto. `/docs/`, `/server/`, `/tests/`, `handoff.md`, `CLAUDE.md`, `README.md`, `_config.yml`: 404.
- `feat/aceite` nunca vai ao `main` (a tela dele não manda o aceite).
- E-mail de alerta: SNS registrou entrega às 15:32 UTC; recebimento na caixa não confirmado.
- Desligar o cadastro: reverter o commit `c2093fd` (só `config.js`, README e o teste dele).

- Plano 3 (plano alimentar e metas por pessoa) implementado no branch `feat/aceite-site`, sem push: site 207 testes ok; servidor 125 ok e 6 pulados (só rodam em Postgres real). Não está implantado nem publicado.
- Mudanças do plano 3: conta vê o próprio plano (sem plano, convite "Cadastrar meu plano"); rotas `#plano/editar` e `#metas` só com conta; café sem horário aparece "a fazer", não "atrasado"; cache na versão 37; treino vale pela origem da meta.
- Plano 4 (migração do app antigo) em execução, com ledger próprio.
- Menor para a revisão final: apagar treino com dois registros da mesma origem (um ativo sem foto, um antigo com foto) remove os dois e o Desfazer restaura um; foto órfã; só com dado legado.

## Ordem
1. Terminar o plano 4 (migração); ele remove a trava do aparelho antigo.
2. Revisão final do branch, push e deploy (o site e o servidor juntos).
3. Kaique cria a primeira conta em janela anônima: Turnstile real, e-mail, confirmar, entrar, esqueci a senha.
4. Depois, plano 6.

## Dúvidas em aberto
- Sem "Restaurar cópia" para aparelho sem dados até o plano 4 (troca de celular da Rejane).
- ADR que encerra as travas do ADR-005: rascunho com a sessão principal, aguarda OK do Kaique.
- Limpeza de cadastros não confirmados; roteiros de incidente e de pedidos de titular.
- Passar ao plano pago antes de 2027-03-23.
- Gravar o ADR-004; alinhar a spec §8.1 e §8.5.
- Menores da revisão: "Nova senha" com sessão não tem voltar; `sair` sem timeout; `sw.js` apaga caches de outros sites da mesma origem; token em `localStorage` de origem compartilhada (domínio próprio resolve).
- Push é pela conta `Kaique-fhs`; a ativa no gh costuma ser `triokids`, e quem troca é o Kaique.
