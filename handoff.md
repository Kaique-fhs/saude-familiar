# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003 (todos em `docs/ams/adr/`).
- Plano 1: rulings e triagem da revisão final estão no roteiro (`docs/superpowers/plans/2026-11-21-contas-roteiro.md`), nas seções "Checklist para o plano 5" e "Pendências menores".

## Estado atual
- Plano 1 (servidor local) concluído no branch `feat/contas-ec2` (commits f6c8c37..b01ed23, 87 testes passando, `cd server && npm test`). Sem PR, sem push.
- AWS configurada com o perfil `saude-familiar`, região us-east-2. Nada implantado.
- Site renomeado para `saude-familiar` no GitHub Pages; convite de instalar removido.
- Não há deploy possível ainda: o servidor nunca rodou contra Postgres, S3, Turnstile ou SMTP reais.

## Próximos passos
- Decisão pendente do Kaique: antecipar o plano 5 (AWS: EC2, Postgres, CloudFront, S3) para provar o servidor em ambiente real, ou seguir para o plano 2 (app: conta e sincronização). O plano 5 está na ordem depois dos 1 a 4.
- Qualquer que seja o caminho, abrir PR de `feat/contas-ec2` quando o Kaique pedir.

## Dúvidas em aberto
- Ordem dos planos 2 e 5 (acima).
- Onde ficam: spec `docs/superpowers/specs/2026-11-21-contas-ec2-design.md`; plano 1 `docs/superpowers/plans/2026-11-21-servidor-local.md`; roteiro com checklist do plano 5 `docs/superpowers/plans/2026-11-21-contas-roteiro.md`; contrato da API em `server/README.md`.
