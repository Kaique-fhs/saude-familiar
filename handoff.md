# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão.
- 22/11/2026: orçamento de US$ 20 mede gasto bruto (`IncludeCredit: false`).
- 22/11/2026: cadastro aberto antes dos planos 3 e 4, com 2 travas (ADR-005). Os planos 3 e 4 implementados removem as duas: conta vê o próprio plano; aparelho com dados antigos abre no modo antigo (`mp-*`), com convite para criar conta. O ADR-007 (rascunho, aguarda o OK do Kaique) encerra as travas.
- 22/11/2026: cadastro exige aceite versionado do aviso de privacidade (ADR-006); versão nova sobe no servidor antes do site.
- 22/11/2026: responsável, encarregado, contato e acesso do aviso informados pelo Kaique; pasta Enviados do Gmail limpa a cada 30 dias, à mão.
- 22/11/2026: treino vale pela origem da meta. Uma revisão final só, cobrindo os planos 3 e 4. Cache do app fica na versão 38 (nada foi publicado depois da 36).
- Rulings e pendências dos planos 1, 2, 3 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026)
- Planos 3 e 4 concluídos e revisados (revisão final do branch e uma onda de correção, aprovada). Tudo no branch `feat/aceite-site` (HEAD 3031488), SEM push e SEM deploy. Site 217 testes ok; servidor 125 ok e 6 pulados (só rodam em Postgres real).
- No ar: site versão 36 e máquina em `9e23f0e` (`main` = `feat/contas-ec2`). Cadastro ligado, aviso versão 1, zero contas, 4 migrações nos dois bancos, `saude-logs.timer` ativo.
- Plano 3: plano alimentar e metas por pessoa (conta vê o próprio plano; `#plano/editar` e `#metas` só com conta). Plano 4: migração do app antigo (oferta "Levar o que está salvo neste aparelho para a sua conta?" só à primeira conta; dados antigos só apagados depois de o servidor confirmar tudo, ou por "Apagar dados antigos" na Conta).
- Também vão neste push: limpeza diária de cadastros não confirmados (f7e68f2, timer `saude-limpeza@`), validação de plano/meta no `/sync`, e o segundo e-mail opcional de alerta (b9b2b8e): este ainda não foi aplicado na stack; falta o Kaique dizer o endereço. Antes de aplicar, conferir o change set do Budget (`BudgetName` fixo; se aparecer `Replacement: True`, trocar por `AWS::Budgets::BudgetsAction` ou assinatura SNS).
- Recusa do aceite não testada por fora: o captcha de teste recusou o token fictício antes dela (causa não verificada). A `fumaca.sh` depende desse token.
- `feat/aceite` nunca vai ao `main`. Desligar o cadastro: reverter o commit `c2093fd`.
- E-mail de alerta: SNS registrou entrega às 15:32 UTC; recebimento na caixa não confirmado.
- Untracked no worktree: `docs/privacidade/` (não é desta rodada).

## Próximos passos
1. Kaique faz o push de `feat/aceite-site` para `feat/contas-ec2` e `main` (conta `Kaique-fhs`).
2. Deploy da máquina com `REF=feat/contas-ec2` e conferência.
3. A Rejane abre o app no celular, entra e aceita levar os dados.
4. A sessão confere no banco de produção, só por contagens, plano, registros e fotos da conta dela.
5. Depois, plano 6 (tirar `PLANO` do `data.js`).

## Dúvidas em aberto
- ADR-007 (encerra as duas travas do ADR-005): aguarda OK do Kaique. Gravar o ADR-004; alinhar a spec §8.1 e §8.5.
- Ficaram para depois (revisão final): corrida rara na limpeza (`server/src/tarefas.js:16-22`: cadastro refeito durante a limpeza pode ser apagado; usar `for update skip locked`); `mp-*` recriados por aba antiga depois de concluída ficam invisíveis; sair da conta sem pendências apaga o banco de fotos da conta e leva as fotos descartadas pela junção antes da cópia mensal; `gravarGlobal` cheio deixa o marcador em migrando+juntado; `fotosDescartadas` faz `JSON.parse` a cada `fotoEmUso` (desempenho).
- Menores do plano 3 e 4 (testes que faltam, cosméticos, aria-live no aviso "Toque de novo", minutos decimal): lista em `.superpowers/sdd/2026-11-22-plano-e-metas/progress.md` e `.superpowers/sdd/2026-11-22-migracao-app-antigo/progress.md`.
- Troca de celular da Rejane: a cópia é um arquivo exportado, então ela precisa ter salvo uma do aparelho antigo.
- Roteiros de incidente e de pedidos de titular ainda não existem.
- Passar ao plano pago antes de 2027-03-23.
- Menores antigos: "Nova senha" com sessão não tem voltar; `sair` sem timeout; `sw.js` apaga caches de outros sites da mesma origem; token em `localStorage` de origem compartilhada (domínio próprio resolve).
