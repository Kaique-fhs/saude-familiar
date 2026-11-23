# ADR-005 - Abrir o cadastro antes da migracao com duas travas

**Emendada por:** ADR-007
**Status:** Aceito
**Data:** 22/11/2026

## Contexto
O cadastro precisava ir ao ar antes do plano por pessoa (plano 3) e da migração (plano 4).

- conta nova recebia o plano alimentar fixo do data.js, que é de outra pessoa
- quem já usava o app deixava de ver o histórico ao entrar

---

## Decisao
O cadastro abre com duas travas temporárias.

- conta não vê o plano nem os exercícios do data.js, até o plano 3
- aparelho com chave mp-* e sem sessão segue no app antigo, sem conta, até o plano 4
- aparelho sem dados exige conta

---

## Consequencias
- o cadastro abre sem expor o plano de uma pessoa como se fosse de outra
- o histórico de quem já usa o app continua visível
- quem já usa o app ainda não guarda dados na conta
- Plano e Frequência ficam "em breve" para contas
- quem só consultava passa a precisar de conta
- aparelho sem dados não restaura cópia até o plano 4

---

## Alternativas consideradas
- Planos 3 e 4 antes do link - o link só sairia depois de duas rodadas grandes
- Publicar sem travas - iria ao ar com os dois problemas reproduzidos
- Só teste local - não cria conta real

---

## Referencias
- ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md
- docs/superpowers/specs/2026-11-21-contas-ec2-design.md (§8.1, §8.5)
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
