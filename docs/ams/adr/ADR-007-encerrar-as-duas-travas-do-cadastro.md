# ADR-007 - Encerrar as duas travas do cadastro

**Status:** Aceito
**Data:** 22/11/2026

## Contexto
O ADR-005 abriu o cadastro com duas travas temporárias, até os planos 3 e 4. Os dois planos foram implementados.

---

## Decisao
As duas travas saem.

- cada conta vê o próprio plano e as próprias metas; sem plano, o app convida a cadastrar
- aparelho com dados antigos e sem sessão abre no modo antigo, gravando como antes, com convite para criar conta
- a primeira conta que entra no aparelho recebe a oferta de levar os dados antigos; outra conta não recebe
- os dados antigos só são apagados depois de o servidor confirmar cada item, ou pela pessoa, com segundo toque

---

## Consequencias
- a Rejane leva plano, histórico e fotos para a conta sem perder nada
- dado antigo que não pode ser conferido fica no aparelho até a pessoa apagar
- se a dona apagar a conta, a próxima conta do aparelho pode receber a oferta

---

## Alternativas consideradas
- Nenhuma foi discutida - as travas já nasceram temporárias no ADR-005, com fim marcado nos planos 3 e 4

---

## Referencias
- ADR-005-abrir-o-cadastro-antes-da-migracao-com-duas-travas.md
- docs/superpowers/plans/2026-11-22-plano-e-metas.md
- docs/superpowers/plans/2026-11-22-migracao-app-antigo.md
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
