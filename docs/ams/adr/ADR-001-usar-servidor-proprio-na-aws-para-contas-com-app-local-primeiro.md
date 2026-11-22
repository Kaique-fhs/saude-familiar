# ADR-001 - Usar servidor proprio na AWS para contas com app local primeiro

**Emendada por:** ADR-002, ADR-003, ADR-005
**Status:** Aceito
**Data:** 21/11/2026

## Contexto
O Meu Prato atendia uma pessoa só: o plano da Rejane estava no `data.js` e todos os dados ficavam só no aparelho. Agora outras pessoas vão criar conta, cada uma com o próprio plano e as próprias metas de exercício.

- dados de saúde (LGPD), inclusive fotos
- o app precisa continuar funcionando offline
- o histórico e as fotos da Rejane não podem se perder na troca

---

## Decisao
Contas por pessoa num servidor próprio na AWS, com o app gravando primeiro no aparelho e sincronizando.

- EC2 na região us-east-1 com Postgres local (bancos de teste e produção) e API Node.js com Better Auth
- CloudFront na frente da EC2 para HTTPS sem domínio; trecho até a EC2 também em HTTPS, com cabeçalho secreto
- fotos e backups diários do banco no S3 privado
- login obrigatório; cadastro aberto com limites de tentativas e captcha Cloudflare Turnstile
- e-mail por Gmail SMTP até haver domínio; depois, SES
- app local primeiro: fila de envio, marcações de aparelhos diferentes se somam
- migração da Rejane em dois lançamentos; o plano sai do `data.js` só depois de ela migrar

Detalhes: `docs/superpowers/specs/2026-11-21-contas-ec2-design.md`.

---

## Consequencias
- controle total do servidor, sem pausa por inatividade nem limites de plano grátis
- o app continua funcionando offline
- custo de cerca de US$ 10–17/mês depois dos créditos iniciais da AWS
- API, login e manutenção da máquina (atualizações, backup) ficam por nossa conta
- sem domínio, o e-mail depende do limite diário do Gmail

---

## Alternativas consideradas
- Supabase (plano grátis) - substituído por indicação do irmão do Kaique (consultor), que prefere EC2 com Postgres
- Supabase auto-hospedado na EC2 - exige máquina de 4 GB+, cerca de US$ 25–30/mês
- App só na nuvem - perde o funcionamento offline
- DuckDNS + Let's Encrypt para HTTPS - depende de um serviço gratuito pequeno; CloudFront fica dentro da AWS

---

## Referencias
- docs/superpowers/specs/2026-11-21-contas-ec2-design.md
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
