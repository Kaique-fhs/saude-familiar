# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique; o ADR-004 ainda não está commitado em nenhum branch.
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- 22/11/2026: `REF` do provisionamento é obrigatório, sem padrão (substitui o M1 "padrão main"): o `main` não tem `server/`.
- Rulings e pendências dos planos 1, 2 e 5: `docs/superpowers/plans/2026-11-21-contas-roteiro.md`.

## Estado atual (22/11/2026, conferido na AWS)
- Planos 1, 2 e 5 juntados em `feat/contas-ec2`. Sem PR. O site no ar é o `main` (sem login).
- Stack atualizada em 21/11 20:33 (backups versionados, `AlarmeTravada`) e em 22/11 14:27 UTC (orçamento de US$ 20 mede gasto bruto, `IncludeCredit: false`); template vivo igual ao de `fix/infra-ref-loopback`, drift não verificado.
- Até o push, NÃO fazer deploy da stack com o template de outro branch: desfaria a correção do orçamento. Para atualizar, usar change set com `UsePreviousValue` nos parâmetros (não precisa ler segredo).
- Máquina roda `368f31b` (`feat/aws-infra`), provisionada em 21/11 20:34. Reinício de prova em 22/11 10:56 UTC: ~25 s fora, tudo voltou sem falha.
- Backup automático de 22/11 03:30 UTC gravado nos dois ambientes. Inscrição de e-mail do SNS confirmada (entrega não testada).
- `/teste/conta` pela URL de produção dá 403 (segredo cruzado).
- Correção do `REF` e do `127.0.0.1` está no branch local `fix/infra-ref-loopback`: testada, SEM push e NÃO implantada. O commit do orçamento está no mesmo branch, sem push, já aplicado na stack.
- Plano AWS FREE: expira em 2027-03-23 18:35 UTC; US$ 139,92 de crédito em 22/11.

## Próximos passos
1. Push, pela conta `Kaique-fhs` (a ativa no gh é `triokids`, sem escrita aqui): `git push origin fix/infra-ref-loopback:feat/contas-ec2`.
2. Na máquina, via SSM: baixar o `provisionar.sh` do SHA enviado e rodar com `REF=feat/contas-ec2` e as saídas de `server/infra/README.md`. Conferir: HEAD igual ao SHA, 3000/3001 só em 127.0.0.1, `/saude` 200 e `/conta` 401 nas duas URLs. Volta: script e REF de `368f31b` (`feat/aws-infra`).
3. Até lá, não atualizar a máquina com o script de `origin/feat/contas-ec2` sem REF: o padrão dele é `main` e apagaria o servidor do disco.
4. Planos 3 (metas por pessoa), 4 (migração) e 6 (lançamento 2); ligar `config.js` à API no lançamento (site key pública do Turnstile: `0x4AAAAAAGMIsSAsmJojK__Y`).

## Dúvidas em aberto
- Passar ao plano pago antes de 2027-03-23.
- Gravar o ADR-004 e alinhar a spec §8.1.
- Kaique limpar os dados `mp-*` de teste no Chrome (`localhost:5500`).
