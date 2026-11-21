# ADR-003 - Usar a regiao us-east-2 do projeto AWS

**Status:** Aceito
**Data:** 21/11/2026

## Contexto
O ADR-001 previa a região us-east-1. O projeto AWS do Kaique, na nova experiência da AWS, tem uma região fixa, us-east-2, e não permite criar recursos regionais em outra.

---

## Decisao
- EC2, S3 e todos os recursos regionais ficam em us-east-2
- o CloudFront é global e continua permitido
- o Agent Toolkit da AWS usa us-east-1 só para a própria ferramenta, sem recursos do app

---

## Consequencias
- mesmo preço da us-east-1
- tudo numa região só, como as regras do projeto AWS exigem

---

## Alternativas consideradas
- us-east-1 - o projeto AWS não permite criar recursos fora da região dele

---

## Referencias
- ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
