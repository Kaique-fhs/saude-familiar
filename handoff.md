# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão.
- 22/11/2026: orçamento de US$ 20 mede gasto bruto (`IncludeCredit: false`).
- 22/11/2026: abrir o cadastro antes dos planos 3 e 4, com 2 travas (ADR-005 em rascunho, aguardando aprovação): conta não vê o `PLANO` do `data.js`; aparelho que já usou o app antigo (`mp-*`) segue local, sem conta.
- Rulings e pendências dos planos 1, 2 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026)
- Máquina roda `e1cf853` de `feat/contas-ec2`; `server/` não mudou depois, não precisa de deploy.
- E-mail de alerta disparado pelo caminho real às 15:32 UTC: SNS registrou entrega; recebimento na caixa não confirmado.
- Branch `feat/cadastro-travas` pronto localmente, com as travas, o site ligado à API e o `_config.yml` do Pages. Só vai ao ar quando o Kaique fizer o push para `main`; até lá o site segue sem login.
- Desligar o cadastro: reverter o commit `c2093fd` (só `config.js`, README e o teste dele).

## Depois do push
1. Conferir o build do Pages, `config.js` no ar e 404 em `/docs/`, `/handoff.md`, `/server/`.
2. Kaique cria a primeira conta em janela anônima: Turnstile real (não emitiu token no Chrome automatizado), e-mail, confirmar, entrar, esqueci a senha.
3. Planos 3 (plano e metas por pessoa) e 4 (migração); o 4 remove a trava do aparelho antigo. Depois, plano 6.

## Dúvidas em aberto
- Aparelho que só consultava o app (sem `mp-*`) cai no login: conferir o celular da Rejane antes do push.
- Sem "Restaurar cópia" para aparelho sem dados até o plano 4 (troca de celular da Rejane).
- Sem política de privacidade: necessária antes de divulgar a terceiros.
- Passar ao plano pago antes de 2027-03-23.
- Gravar o ADR-004 e o ADR-005; alinhar a spec §8.1 e §8.5.
- Menores da revisão: "Nova senha" com sessão não tem voltar; `sair` sem timeout; `sw.js` apaga caches de outros sites da mesma origem; token em `localStorage` de origem compartilhada (domínio próprio resolve).
- Push é pela conta `Kaique-fhs`; a ativa no gh costuma ser `triokids`, e quem troca é o Kaique.
