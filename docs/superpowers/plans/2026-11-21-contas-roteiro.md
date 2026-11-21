# Contas no Saúde Familiar — sequência de planos

Spec: `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` · ADR: `docs/ams/adr/ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md`

Cada plano entrega algo que funciona e se testa sozinho. Ordem:

| # | Plano | Entrega | Depende de |
|---|---|---|---|
| 1 | `2026-11-21-servidor-local.md` | API Node + Postgres rodando no computador: login, proteção, sincronização, fotos, apagar conta | — |
| 2 | (a escrever) App: conta e sincronização | Telas de conta, armazenamento por usuário, fila de envio, baixar no login, modo antigo até o primeiro login | 1 |
| 3 | (a escrever) App: plano e metas por pessoa | Formulário do plano com versões, metas de exercício, novo "dia cumprido" e calendário | 2 |
| 4 | (a escrever) App: migração do app antigo | Oferta à primeira conta, envio com fotos, retomada, mover dados locais | 2, 3 |
| 5 | (a escrever) AWS e lançamento 1 | EC2, Postgres, CloudFront, S3, backup com restauração, alertas, roteiro para o irmão | 1–4; conta AWS do Kaique |
| 6 | (a escrever) Lançamento 2 | Checklist da Rejane, tirar `PLANO` do `data.js`, remover modo antigo | 5 + confirmação |

Domínio: quando o Kaique comprar, entra como ajuste no plano 5 (ou depois dele).
