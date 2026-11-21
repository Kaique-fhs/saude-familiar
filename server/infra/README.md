# Infra Saude Familiar (AWS, us-east-2)

Stack CloudFormation `saude-familiar` (`server/infra/saude-familiar.yaml`), criada em 2026-11-21 (`CREATE_COMPLETE`).
Roteiro de operacao: `RUNBOOK.md`. Nenhum segredo mora aqui: ficam no SSM Parameter Store em `/saude-familiar/<teste|producao>/`.

## Saidas da stack

| Saida | Valor |
|---|---|
| IdMaquina | `i-00700f3509ab2a28a` |
| IpPublico | `52.15.253.217` |
| NomeOrigem | `52.15.253.217.sslip.io` |
| BucketFotos | `saude-familiar-bucketfotos-5penenokedtv` |
| BucketBackups | `saude-familiar-bucketbackups-dwzrcgnjlzbp` |
| TopicoAlertas | `arn:aws:sns:us-east-2:<conta>:saude-familiar-TopicoAlertas-HrV0g5BkJSBF` |
| UrlTeste | https://d14fl8kow5jdsd.cloudfront.net |
| UrlProducao | https://d24j5hln30wud.cloudfront.net |

Parametros SSM (SecureString) existentes nos dois ambientes: `DB_SENHA`, `SEGREDO_ORIGEM`, `TURNSTILE_SECRET`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE`.

## Provisionamento (Task 7, 2026-11-21)

Via SSM `AWS-RunShellScript` na `IdMaquina`: baixa `provisionar.sh` do branch `feat/aws-infra` e roda com as saidas acima (`REF=feat/aws-infra`). Rodou com sucesso duas vezes (idempotente).

Conferido na maquina: `saude-api@teste`, `saude-api@producao`, `caddy` e `postgresql` ativos; swap de 2 GB; `curl --resolve <NomeOrigem>:443:127.0.0.1 https://<NomeOrigem>/saude` responde `{"ok":true}`; certificado Let's Encrypt emitido; Postgres so em `127.0.0.1:5432`; `/etc/saude/*.env` com modo 600 root; 3 familias de timers ativas (disco, backup, fotos por ambiente). De fora: as duas URLs do CloudFront em `/saude` respondem `{"ok":true}` e `http://<NomeOrigem>/qualquer` responde 404.

## test:pg contra o Postgres real

Numa copia com devDependencies (`cp -r /opt/saude-familiar/server /tmp/saude-test && npm ci`), com `TEST_DATABASE_URL` apontando para `saude_teste` com o dono `saude_dono_teste` (montada dentro da maquina), copia apagada depois:

```
npm run test:pg
ℹ tests 47
ℹ pass 47
ℹ fail 0
ℹ skipped 0
```

Obs.: o primeiro resultado foi 44 de 47 (`remaining connection slots are reserved`): `criarAppTeste` nao fechava o pool de cada teste e o `max_connections=20` esgotava. Corrigido em `server/test/ajuda.js` (`app.close()` fecha o banco do teste).
