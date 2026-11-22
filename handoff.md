# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão (substitui o M1 "padrão main"): o `main` não tem `server/`.
- 22/11/2026: orçamento de US$ 20 mede gasto bruto (`IncludeCredit: false`).
- Rulings e pendências dos planos 1, 2 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026, conferido na AWS)
- Planos 1, 2 e 5 juntados em `feat/contas-ec2`. Sem PR. O site no ar é o `main` (sem login).
- Máquina roda `e1cf853` de `feat/contas-ec2` (implantado em 22/11 14:29 UTC): `REF` obrigatório, 3000/3001 só em 127.0.0.1.
- Stack `saude-familiar` igual ao template de `e1cf853` (drift não verificado).
- Provado em 22/11: reinício da máquina (~25 s fora, em `368f31b`), backup automático das 03:30 UTC, `/saude` e `/conta` nas duas URLs, segredo cruzado 403.
- Não refeito depois do último deploy: fumaça completa (cadastro, e-mail, foto) e `test:pg`. Entrega de e-mail de alerta nunca testada.
- Plano AWS FREE: expira em 2027-03-23 18:35 UTC; US$ 139,92 de crédito em 22/11.

## Próximos passos
1. Planos 3 (metas por pessoa) e 4 (migração do app antigo).
2. Antes de abrir para usuários: fumaça completa, widget do Turnstile no navegador e "esqueci a senha".
3. Lançamento: ligar `config.js` à API (site key pública do Turnstile: `0x4AAAAAAGMIsSAsmJojK__Y`) e publicar no `main`.
4. Plano 6 (lançamento 2).
- Atualizar a máquina: `REF=feat/contas-ec2` (RUNBOOK). Atualizar a stack: change set com `UsePreviousValue` nos parâmetros.
- Push neste repositório é pela conta `Kaique-fhs`; a ativa no gh costuma ser `triokids`, e quem troca é o Kaique.

## Dúvidas em aberto
- Passar ao plano pago antes de 2027-03-23.
- Gravar o ADR-004 e alinhar a spec §8.1.
- Kaique limpar os dados `mp-*` de teste no Chrome (`localhost:5500`).
