# ADR-006 - Exigir aceite do aviso de privacidade no cadastro

**Status:** Aceito
**Data:** 22/11/2026

## Contexto
O cadastro é aberto, guarda dados de saúde fora do Brasil e não informava nem registrava consentimento.

- a LGPD pede consentimento específico e destacado, com prova (arts. 8º e 11)
- a transferência internacional por consentimento pede aceite separado (art. 33, VIII)

---

## Decisao
Conta só nasce com o aceite da versão vigente do aviso.

- duas caixas desmarcadas e obrigatórias: saúde, com 18 anos ou mais, e transferência
- o servidor grava finalidade, versão e data, e recusa cadastro ou confirmação sem elas
- mudança de versão: servidor implantado antes do site

---

## Consequencias
- há prova do consentimento por conta
- menor de 18 anos não pode ter conta
- versão nova invalida links de confirmação pendentes
- a prova é apagada junto com a conta

---

## Alternativas consideradas
- Só publicar o aviso - não prova consentimento específico
- Publicar sem aviso nem aceite - abriria o cadastro a qualquer pessoa sem consentimento

---

## Referencias
- ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md
- ADR-005-abrir-o-cadastro-antes-da-migracao-com-duas-travas.md
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
