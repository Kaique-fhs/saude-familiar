# AWS e lançamento 1 (servidor na nuvem) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar a API do plano 1 no ar na AWS (us-east-2) com Postgres real, fotos e backups no S3, HTTPS pelo CloudFront, alertas de custo e de saúde da máquina — ambientes **teste** e **produção** — e provar tudo com teste de fumaça e restauração de backup.

**Architecture:** Um template **CloudFormation** (`server/infra/saude-familiar.yaml`) cria EC2 **t4g.micro** (Ubuntu 24.04 ARM), Elastic IP, security group, papel IAM, dois buckets S3, tópico SNS, orçamento, alarme de recuperação e duas distribuições CloudFront (teste e produção). Na máquina, scripts idempotentes em `server/infra/maquina/` criam swap de 2 GB e instalam Postgres 16 (ajustado para pouca memória), Node 24, AWS CLI v2, Caddy (TLS da origem com Let's Encrypt no nome `<ip>.sslip.io`), dois serviços systemd da API, backup diário, varredura de fotos e alerta de disco. Segredos ficam no SSM Parameter Store (SecureString) e viram arquivos de ambiente só na máquina. **Sem WAF** (decisão do Kaique: o rate-limit da API basta).

**Tech Stack:** AWS CloudFormation, EC2 (Graviton t4g), EIP, S3, CloudFront, SNS, AWS Budgets, CloudWatch (alarme de recuperação), SSM (Session Manager, Run Command, Parameter Store), Ubuntu 24.04 ARM, PostgreSQL 16 (apt do Ubuntu), Node 24, AWS CLI v2, Caddy 2, systemd, cfn-lint, shellcheck (cfn-guard opcional).

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` (§5, §9) · ADRs `docs/ams/adr/ADR-001…`, `ADR-002…`, `ADR-003…` · Regras AWS no `CLAUDE.md` do projeto (nova experiência, região única, help_level HIGH) · Roteiro `docs/superpowers/plans/2026-11-21-contas-roteiro.md` (checklist do plano 5).

## O que a conta AWS permite (conferido em 21/11/2026, só leitura, perfil `saude-familiar`)

```
$ aws freetier get-account-plan-state
"accountPlanType": "FREE", "accountPlanStatus": "ACTIVE",
"accountPlanRemainingCredits": { "amount": 119.999969, "unit": "USD" },
"accountPlanExpirationDate": "2027-03-23T18:35:47.780000+00:00"

$ aws ec2 describe-instance-type-offerings (us-east-2)      → t4g.small  t4g.micro  t3.micro
$ aws ec2 describe-instance-types t4g.small t4g.micro       → t4g.small 2048 MiB 2 vCPU FreeTierEligible=True
                                                              t4g.micro 1024 MiB 2 vCPU FreeTierEligible=True
$ aws ssm get-parameter /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id
                                                            → ami-09c4af6de8b9844f6
$ aws ec2 describe-managed-prefix-lists (cloudfront.origin-facing) → pl-b6a144df (52 entradas, IPv4)
$ aws ec2 describe-account-attributes                       → max-instances 20, vpc-max-elastic-ips 5
$ aws ec2 describe-vpcs (default)                           → vpc-0105efcad56903b98
$ aws s3api list-buckets → 0 · aws cloudfront list-distributions → null (nenhuma)
$ aws budgets describe-budgets → null (nenhum) · aws cloudformation list-stacks → 0 · EC2 → 0
```

Leitura de EC2, S3, CloudFront, Budgets e CloudFormation funciona no plano FREE. A **criação** de cada serviço só se confirma na Task 6; se algum for recusado, seguir a regra do `CLAUDE.md` (lista de serviços do plano FREE) antes de qualquer outra coisa.

**Custo estimado (us-east-2, sob demanda):** t4g.micro ~US$ 6,15 + EBS gp3 20 GB ~US$ 1,60 + IPv4 público ~US$ 3,65 + S3 < US$ 0,50 + CloudFront, SNS, SSM, alarme e 1º orçamento ~US$ 0 → **~US$ 12/mês** (~US$ 0,40/dia), pago pelos créditos (US$ 120, até 23/03/2027). Acabando créditos ou prazo, o projeto precisa passar para o plano pago para continuar. Se faltar memória, trocar para t4g.small (parada de ~5 min, +~US$ 6/mês).

## Global Constraints

- **Nenhum recurso na AWS é criado antes do OK explícito do Kaique** naquela sessão — isso inclui parâmetros SSM, a stack e o change set. O OK é dado sobre a **lista exata de recursos** (saída de `aws cloudformation validate-template` + resumo do template: cada recurso lógico, tipo e custo) e o custo mensal. help_level HIGH: explicar cada passo antes de executar. Decisão do Kaique: ligar cedo para testar o Postgres real, logo após o OK.
- Recursos regionais **só em us-east-2**. CloudFront e Budgets são globais (API em us-east-1) e são permitidos. Nada de Lambda@Edge, StackSets, WAF ou ação entre regiões.
- Infraestrutura como código: **um template CloudFormation YAML** (`server/infra/saude-familiar.yaml`), stack `saude-familiar`. Escolha: CloudFormation e não CDK — um único arquivo legível pelo irmão do Kaique, sem toolchain extra nem bootstrap (bucket e papéis do CDK).
- Validação local obrigatória antes de qualquer deploy: `cfn-lint` (via `uvx cfn-lint`) e `aws cloudformation validate-template`. `cfn-guard` é **opcional**: se não houver binário para Windows, registrar no relatório e seguir com cfn-lint + validate-template. `shellcheck` via `uvx shellcheck-py`. Sem admin.
- **AWS CLI no Windows (subagentes, Git Bash):** chamar pelo caminho completo `"$LOCALAPPDATA/Programs/Amazon/AWSCLIV2/aws.exe"` (não está no PATH) sempre com `--profile saude-familiar --region us-east-2` (CloudFront/Budgets: `--region us-east-1`).
- Antes de cada task com AWS, o executor carrega as skills AWS correspondentes (via MCP `aws___retrieve_skill` numa sessão nova, ou a skill local `aws-*`): Task 3 → aws-cloudformation, aws-networking (cloudfront), aws-iam, aws-storage, aws-compute; Task 6 → aws-cloudformation; Task 7 → aws-compute (SSM); Task 8 → aws-billing-and-cost-management.
- **Segredos nunca no repositório, em log, em saída de comando ou no chat**: senha dos bancos, segredo do cabeçalho `x-saude-origem`, senha de app do Gmail, segredo do Turnstile. Moram no SSM Parameter Store em `/saude-familiar/<ambiente>/<NOME>` (SecureString, chave padrão `aws/ssm`). Os que a sessão gera usam **`openssl rand -hex 32`** (hex: sem `+ / =`, que quebrariam a `DATABASE_URL`) direto no `put-parameter`, sem eco. Os do Kaique ele mesmo grava no terminal dele (`! aws ssm put-parameter ...`).
- Ambientes: `teste` e `producao`. Bancos `saude_teste` e `saude_producao`; donos `saude_dono_teste` e `saude_dono_producao` (LOGIN, **não** superusuário, sem CREATEROLE); papel `saude_app` (NOLOGIN) criado pelo provisionamento. API de produção em `127.0.0.1:3000`, de teste em `127.0.0.1:3001`.
- Máquina **t4g.micro (1 GB)**: swap de **2 GB** (`/swapfile`, `vm.swappiness=10`) criado pelo provisionamento; Postgres com `shared_buffers=128MB`, `max_connections=20`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `effective_cache_size=384MB`.
- Origem HTTPS: Caddy em `:443` com certificado Let's Encrypt para `<EIP>.sslip.io`; `:80` aberta ao mundo **só** para o desafio ACME (qualquer outro caminho → 404). `:443` só da prefix list `pl-b6a144df` (CloudFront). Sem SSH: acesso por SSM Session Manager.
- Com o Caddy na frente, a API tem **dois saltos confiáveis** (Caddy + CloudFront): `TRUST_PROXY_SALTOS=2` nos dois ambientes, e o Caddy **precisa** de `trusted_proxies static 0.0.0.0/0` no bloco global `servers` (só o CloudFront alcança a 443 pelo security group); sem isso o Caddy descarta o `X-Forwarded-For` e `request.ip` vira o IP do CloudFront (todos dividiriam o mesmo limite).
- CloudFront: cache desligado (política gerenciada **CachingDisabled**), repassa todos os cabeçalhos do visitante menos `Host` (política **AllViewerExceptHostHeader**), métodos GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE, visitante só HTTPS, origem só HTTPS TLS 1.2, cabeçalho `x-saude-origem` com o segredo do ambiente. Distribuição de teste usa `OriginPath: /teste`.
- Scripts `.sh`: `.gitattributes` com `*.sh text eol=lf`; bit executável gravado no git com `git update-index --chmod=+x <arquivo>`.
- Branch de trabalho `feat/aws-infra` (worktree `../saude-familiar-aws`). Empurrar esse branch ao GitHub é permitido (o repositório já recebe os branches do projeto; nada de segredo nos arquivos); a máquina baixa o código dele (`REF=feat/aws-infra`).
- Mensagens de commit em português terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; commits por caminho explícito.

## Review Focus

1. **O `Authorization` chega à API pelo CloudFront** (sem ele, todo login "funciona" mas toda rota com sessão dá 401) — teste de fumaça na Task 8.
2. **Acesso direto à origem sem o CloudFront** (`https://<EIP>.sslip.io/...` de fora): a porta 443 recusa (security group) e, se passar, a API devolve 403 numa rota que não seja `/saude` — teste na Task 8.
3. **IP do cliente atrás de CloudFront + Caddy**: `request.ip` é o IP do visitante, não do CloudFront; dois clientes diferentes não dividem o limite — teste na Task 8.
4. **Restauração traz de volta conta apagada** (LGPD): backup feito **antes** de apagar a conta; a restauração reaplica `contas_apagadas` atuais — teste na Task 8.
5. **Usuário não superusuário no Postgres real**: RLS, `SET ROLE saude_app`, advisory lock, rollback e cascade com `FORCE ROW LEVEL SECURITY` funcionam igual ao PGlite — suíte `test:pg` na Task 7.

---

### Task 1: Ajustes do servidor para produção (código, sem AWS)

**Files:**
- Modify: `server/src/config.js`, `server/src/app.js`, `server/src/contas.js`, `server/migrations/002_dados.sql`, `server/test/app.test.js`, `server/test/banco.test.js`
- Create: `server/src/tarefas.js`, `server/test/tarefas.test.js`

**Interfaces:**
- Produces:
  - `lerConfig`: novo campo `trustProxySaltos:number` de `TRUST_PROXY_SALTOS` (padrão `1`); `criarApp` usa `trustProxy: (_, salto) => salto < config.trustProxySaltos`.
  - `lerConfig` lança `Error("config: <NOME> inválido")` quando `PORT`, `SMTP_PORT`, `TETO_EMAILS_DIA` ou `TRUST_PROXY_SALTOS` não forem inteiros positivos (hoje `Number("abc")` vira `NaN` e desliga o teto).
  - `002_dados.sql`: troca `grant saude_app to current_user;` por bloco `DO` que só concede se `current_user` ainda não é membro (`pg_has_role(current_user, 'saude_app', 'MEMBER')`), e só cria o papel se não existir. (A migração ainda não foi aplicada em nenhum banco real; editar é seguro.)
  - `contas.js`: função exportada para **revarrer** fotos de contas apagadas numa janela (usada pela CLI).
  - `server/src/tarefas.js` (CLI): `node src/tarefas.js migrar` e `node src/tarefas.js apagar-fotos` — o segundo roda `apagarFotosPendentes` e **revarre** o prefixo das contas apagadas nas últimas **48 h** (cobre foto enviada por URL assinada ainda válida logo após a exclusão; 48 h com timer diário não deixa buraco). Lê config do ambiente; código de saída ≠ 0 em falha.
- [ ] **Step 1: Testes que falham:** `TETO_EMAILS_DIA=abc → lança "config: TETO_EMAILS_DIA inválido"`; `TRUST_PROXY_SALTOS=2: XFF "9.9.9.9, 1.1.1.1, 2.2.2.2" com par TCP local → request.ip "1.1.1.1"`; `migrar duas vezes com o papel já concedido não falha` (PGlite); `apagar-fotos revarre conta apagada há 30 h mesmo com fotos_apagadas_em preenchido e ignora a de 3 dias`.
- [ ] **Step 2:** `npm test` em `server/` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS (suíte inteira, 87 + novos).
- [ ] **Step 5: Commit** — "Servidor: saltos de proxy configuráveis, config validada, migração idempotente e tarefas de linha de comando".

---

### Task 2: Suíte contra Postgres real (`test:pg`)

**Files:**
- Modify: `server/test/ajuda.js`, `server/test/banco.test.js`, `server/package.json`
- Create: `server/test/pg-real.test.js`

**Interfaces:**
- `novoBancoTeste()`: se `TEST_DATABASE_URL` existir, a execução cria, **como dono**, um schema próprio `t_<aleatório>`, aplica as migrações nele, dá `USAGE` (e os grants de `itens`/`itens_seq`) desse schema ao `saude_app`, e usa `criarBancoPg` com **`options=-c search_path=t_<aleatório>`** na URL de conexão (vale para todas as conexões do pool; nada de `set search_path` numa conexão só); o schema é apagado no fim. Sem `TEST_DATABASE_URL`, PGlite como hoje.
- Inserts de teste em `itens` sempre via `comoUsuario` (nunca como dono: sob `FORCE ROW LEVEL SECURITY` o dono é negado). Corrigir o teste de `banco.test.js` que hoje insere como dono.
- Script `"test:pg": "node --test test/pg-real.test.js test/banco.test.js test/sincronia.test.js test/contas.test.js"` (exige `TEST_DATABASE_URL`).
- `pg-real.test.js` (pula com `skip` sem `TEST_DATABASE_URL`): `usuário da conexão não é superusuário`; `RLS isola A de B via comoUsuario com FORCE`; `dois POST /sync concorrentes do mesmo usuário em conexões diferentes não pulam seq` (dois clients reais em paralelo); `apagar usuário em cascata com FORCE RLS ligado`; `erro dentro de transacao faz rollback (nada gravado)`; `depois de comoUsuario a conexão devolvida ao pool não continua como saude_app nem com app.user_id`.
- [ ] **Step 1:** Escrever os testes (rodam e pulam localmente).
- [ ] **Step 2:** `npm test` → PASS com os de `pg-real` marcados como skip.
- [ ] **Step 3: Commit** — "Servidor: suíte de testes contra Postgres real". (A execução de verdade acontece na Task 7, na máquina, numa cópia com devDependencies.)

---

### Task 3: Template CloudFormation (sem criar nada)

**Files:**
- Create: `server/infra/saude-familiar.yaml`, `server/infra/validar.sh`, `.gitattributes`

**Interfaces:**
- Parâmetros: `EmailAlerta` (String), `TipoInstancia` (padrão **`t4g.micro`**, permitidos `t4g.micro`,`t4g.small`), `AmiId` (`AWS::EC2::Image::Id`, padrão **fixo `ami-09c4af6de8b9844f6`** — nunca o parâmetro SSM `current`, para um deploy futuro não trocar a instância com o Postgres no disco raiz), `SegredoOrigemTeste` e `SegredoOrigemProducao` (`NoEcho: true`), `LimiteOrcamentoUSD` (padrão `20`).
- Recursos (nomes lógicos exatos): `GrupoSeguranca` (443 de `pl-b6a144df` via `SourcePrefixListId`; 80 de `0.0.0.0/0`; sem 22; saída liberada), `PapelMaquina` (`AmazonSSMManagedInstanceCore` + política própria: `s3:PutObject/GetObject/ListBucket/ListBucketVersions/DeleteObject/DeleteObjectVersion` só nos dois buckets; `ssm:GetParameter(s)ByPath`/`GetParameter` só em `/saude-familiar/*`; `sns:Publish` só no tópico), `PerfilMaquina`, `Maquina` (IMDSv2 obrigatório `HttpTokens: required`, EBS raiz gp3 20 GB criptografado, `DisableApiTermination: true`, tag `Name=saude-familiar`), `IpFixo` + `AssociacaoIp`, `BucketFotos` (bloqueio público total, `BucketOwnerEnforced`, criptografia SSE-S3, versionamento ligado, lifecycle: versões não atuais expiram em 30 dias, delete markers expirados são removidos, multipart incompleto aborta em 1 dia; CORS: métodos **`POST` e `GET`** de `https://kaique-fhs.github.io` e `http://localhost:*`), `BucketBackups` (bloqueio público, SSE-S3, lifecycle: objetos expiram em 30 dias), `TopicoAlertas` + assinatura e-mail `EmailAlerta`, `Orcamento` (`AWS::Budgets::Budget` mensal de custo, alerta 80% real e 100% previsto para `EmailAlerta`), `AlarmeRecuperacao` (`StatusCheckFailed_System` ≥ 1 por 2 min → ação `arn:aws:automate:us-east-2:ec2:recover`), `CloudFrontTeste` e `CloudFrontProducao` (origem `!Sub "${IpFixo}.sslip.io"`, `CustomOriginConfig` HTTPS-only TLSv1.2, cabeçalho `x-saude-origem` = segredo do ambiente, teste com `OriginPath: /teste`, cache `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` CachingDisabled, origin request `b689b0a8-53d0-40ab-baf2-68738e2966ac` AllViewerExceptHostHeader, `PriceClass_100`). **Sem WAF.**
- Saídas: `IpPublico`, `NomeOrigem` (`<ip>.sslip.io`), `UrlTeste`, `UrlProducao` (domínios `*.cloudfront.net`), `BucketFotos`, `BucketBackups`, `IdMaquina`, `TopicoAlertas`.
- `validar.sh`: roda `uvx cfn-lint`, `cfn-guard validate` **se o binário existir** (senão avisa e segue) e `aws cloudformation validate-template --template-body file://...` (só leitura, AWS CLI pelo caminho completo no Windows); sai ≠ 0 em qualquer falha.
- `.gitattributes`: `*.sh text eol=lf`.
- [ ] **Step 1:** Escrever o template, `validar.sh` e `.gitattributes`; `git update-index --chmod=+x server/infra/validar.sh`.
- [ ] **Step 2:** `bash server/infra/validar.sh` → sem erro (avisos justificados em comentário no template).
- [ ] **Step 3: Commit** — "Infra: template CloudFormation da EC2, S3, CloudFront, alertas e orçamento".

---

### Task 4: Provisionamento da máquina (scripts idempotentes)

**Files:**
- Create: `server/infra/maquina/provisionar.sh`, `server/infra/maquina/Caddyfile`, `server/infra/maquina/saude-api@.service`, `server/infra/maquina/carregar-segredos.sh`, `server/infra/maquina/postgres.sql`, `server/infra/maquina/postgres-memoria.conf`, `server/infra/maquina/disco.sh`, `server/infra/maquina/saude-disco.service`, `server/infra/maquina/saude-disco.timer`, `server/infra/maquina/saude-fotos@.service`, `server/infra/maquina/saude-fotos@.timer`, `server/infra/maquina/journald.conf`

**Interfaces:**
- `provisionar.sh <nome-origem> <bucket-fotos> <bucket-backups> <topico-alertas>` (root, Ubuntu 24.04 ARM, pode rodar de novo sem estragar): cria **swap de 2 GB** (`/swapfile`, `fstab`, `vm.swappiness=10`) antes de qualquer instalação; `apt` de `postgresql-16`, `unattended-upgrades` (ligado), `caddy` (repositório oficial), **AWS CLI v2** (instalador oficial `awscli-exe-linux-aarch64.zip`); Node 24 (tarball oficial `linux-arm64` com SHA256 conferido, em `/opt/node`); usuário de sistema `saude`; clona o repositório (`https://github.com/Kaique-fhs/saude-familiar`, branch na variável `REF`, padrão `feat/aws-infra`) em `/opt/saude-familiar` e roda `npm ci --omit=dev` em `server/`; instala `postgres-memoria.conf` em `conf.d` do Postgres; aplica `postgres.sql`; instala units, timers, `Caddyfile` e `journald.conf`; `systemctl enable --now`.
- `postgres-memoria.conf`: `shared_buffers=128MB`, `max_connections=20`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `effective_cache_size=384MB`, `listen_addresses='localhost'`.
- `postgres.sql` (rodado como `postgres`): cria `saude_app NOLOGIN`, `saude_dono_teste` e `saude_dono_producao` (LOGIN, senha lida do SSM por `carregar-segredos.sh` e passada por variável psql, nunca gravada em arquivo), bancos com esses donos, `grant saude_app to saude_dono_<amb>`; `pg_hba` só `scram-sha-256` local.
- `carregar-segredos.sh <ambiente>`: lê `/saude-familiar/<amb>/*` do SSM com `--with-decryption` e escreve `/etc/saude/<amb>.env` (dono root, `0600`) com **todas** as variáveis de `server/src/config.js`: `AMBIENTE`, `PORT` (3000 produção, 3001 teste), `DATABASE_URL` (senha hex), `ORIGEM_SITE=https://kaique-fhs.github.io`, `SEGREDO_ORIGEM`, `TURNSTILE_SECRET`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE`, `TETO_EMAILS_DIA=300`, `S3_REGIAO=us-east-2`, `S3_BUCKET_FOTOS`, `TRUST_PROXY_SALTOS=2` (o executor confere a lista contra `server/src/config.js` e inclui qualquer outra que exista lá).
- `saude-api@.service`: `User=saude`, `EnvironmentFile=/etc/saude/%i.env`, `ExecStartPre=/opt/node/bin/node src/tarefas.js migrar`, `ExecStart=/opt/node/bin/node src/principal.js`, `Restart=always`, `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`.
- `Caddyfile`: bloco global `{ servers { trusted_proxies static 0.0.0.0/0 } }` (só o CloudFront alcança a 443); site `{$NOME_ORIGEM}` → `handle_path /teste/*` → `reverse_proxy 127.0.0.1:3001`; demais → `127.0.0.1:3000`; site `http://` responde 404 a tudo (o Caddy atende o ACME sozinho).
- `saude-fotos@.timer`: diário, roda `tarefas.js apagar-fotos` do ambiente (janela de 48 h). `saude-disco.timer`: de hora em hora, `disco.sh` publica no SNS (AWS CLI v2) se `/` passar de **80%** (no máximo um aviso a cada 24 h).
- `journald.conf`: `SystemMaxUse=500M`, `MaxRetentionSec=30day` (os erros serializados podem ter e-mail ou host; retenção curta).
- [ ] **Step 1:** Escrever os arquivos; `git update-index --chmod=+x` em cada `.sh`.
- [ ] **Step 2:** `bash -n` em todos os `.sh` e `uvx shellcheck-py` → sem erro.
- [ ] **Step 3: Commit** — "Infra: provisionamento idempotente da máquina (swap, Postgres, Node, AWS CLI, Caddy, serviços)".

---

### Task 5: Backup e restauração com contas apagadas

**Files:**
- Create: `server/infra/maquina/backup.sh`, `server/infra/maquina/restaurar.sh`, `server/infra/maquina/saude-backup.service`, `server/infra/maquina/saude-backup.timer`

**Interfaces:**
- `backup.sh`: para cada ambiente, `pg_dump -Fc` → `s3://<bucket-backups>/<amb>/<AAAA-MM-DD>.dump` (sem arquivo local permanente; AWS CLI v2); falha publica no SNS. Timer diário às 03:30 UTC.
- `restaurar.sh <ambiente> <AAAA-MM-DD> [banco-destino]`: baixa o dump; **antes** exporta `contas_apagadas` atual do banco do ambiente; restaura em `banco-destino` (padrão `saude_restauro_<amb>`, nunca sobrescreve o banco vivo sem `--substituir`); depois reinsere `contas_apagadas` e roda `delete from usuarios where id in (select user_id from contas_apagadas)`; imprime contagens de `usuarios`, `itens` e `contas_apagadas`.
- [ ] **Step 1:** Escrever, `git update-index --chmod=+x`, `bash -n` + `shellcheck` sem erro.
- [ ] **Step 2: Commit** — "Infra: backup diário no S3 e restauração que reaplica contas apagadas".

---

### Task 6: Contas externas, segredos e criação da stack — **exige ação e OK do Kaique**

**Files:**
- Create: `server/infra/README.md` (roteiro para o irmão do Kaique: o que existe, como refazer do zero, como restaurar, custos)

- [ ] **Step 1 (Kaique):** criar a conta Gmail do app, ligar a verificação em 2 etapas e gerar a **senha de app**.
- [ ] **Step 2 (Kaique):** criar conta na Cloudflare, criar um widget **Turnstile** com o domínio `kaique-fhs.github.io` (e `localhost`), guardar a *site key* (vai para o app no plano 2) e o *secret*.
- [ ] **Step 3 (sessão, só leitura):** `bash server/infra/validar.sh` e montar a **lista exata de recursos** (cada recurso lógico do template, tipo e custo mensal; total ~US$ 12/mês) a partir do template e da saída de `validate-template`. Mostrar ao Kaique. Nada é criado neste passo.
- [ ] **Step 4 (Kaique):** **OK explícito** sobre essa lista. Sem OK, parar aqui.
- [ ] **Step 5 (Kaique, no terminal dele com `!`):** gravar no SSM `/saude-familiar/{teste,producao}/{SMTP_USER,SMTP_PASS,EMAIL_REMETENTE,TURNSTILE_SECRET}` com `aws ssm put-parameter --type SecureString --profile saude-familiar --region us-east-2`. No ambiente `teste`, `TURNSTILE_SECRET` pode ser o segredo de teste da Cloudflare que sempre aprova.
- [ ] **Step 6 (sessão):** gerar e gravar sem eco `SENHA_BANCO` e `SEGREDO_ORIGEM` dos dois ambientes (`openssl rand -hex 32`). Conferir com `aws ssm get-parameters-by-path --path /saude-familiar --recursive --query "Parameters[].Name"` (só nomes).
- [ ] **Step 7 (sessão):** `aws cloudformation deploy --no-execute-changeset` da stack `saude-familiar` com `--capabilities CAPABILITY_IAM` e os segredos de origem lidos do SSM na própria linha de comando; conferir que o change set bate com a lista aprovada no Step 4 (se diferir, voltar ao Kaique); executar o change set; aguardar `CREATE_COMPLETE`; registrar as saídas no `server/infra/README.md` (sem segredos). Se algum serviço for recusado pelo plano FREE: parar, rodar `aws freetier get-account-plan-state`, consultar a lista de serviços do plano e trazer as opções ao Kaique.
- [ ] **Step 8 (Kaique):** confirmar a assinatura de e-mail do SNS (link na caixa de entrada).
- [ ] **Step 9: Commit** — "Infra: roteiro e saídas da stack saude-familiar".

---

### Task 7: Provisionar, migrar e provar o Postgres real

- [ ] **Step 1:** empurrar `feat/aws-infra` ao GitHub; `aws ssm send-command` (documento `AWS-RunShellScript`) na `IdMaquina`: baixar `provisionar.sh` da branch `feat/aws-infra` (raw do GitHub, conferindo o commit) e rodar com as saídas da stack, `REF=feat/aws-infra`. Esperado: `Status: Success`.
- [ ] **Step 2:** conferir `systemctl is-active saude-api@teste saude-api@producao caddy postgresql` → `active` ×4; `swapon --show` mostra 2 GB; dentro da máquina, `curl -s --resolve <NomeOrigem>:443:127.0.0.1 https://<NomeOrigem>/saude` → `{"ok":true}` (com SNI; a máquina nunca chama o próprio IP público, que o security group barra).
- [ ] **Step 3:** `test:pg` numa **cópia com devDependencies**: `cp -r /opt/saude-familiar/server /tmp/saude-test && cd /tmp/saude-test && npm ci` (completo, inclui PGlite), depois `TEST_DATABASE_URL=<saude_teste com dono saude_dono_teste> npm run test:pg` → todos passam, nenhum `skip`; apagar `/tmp/saude-test`. A produção continua com `--omit=dev`. Registrar a saída no `server/infra/README.md`.
- [ ] **Step 4:** certificado: `curl -sI --resolve <NomeOrigem>:443:127.0.0.1 https://<NomeOrigem>` de dentro da máquina mostra emissor Let's Encrypt; `curl -s -o /dev/null -w "%{http_code}" http://<NomeOrigem>/qualquer` (de fora) → `404`.
- [ ] **Step 5: Commit** dos ajustes que os passos exigirem (nenhum segredo).

---

### Task 8: Teste de fumaça de ponta a ponta, restauração e encerramento

**Files:**
- Create: `server/infra/fumaca.sh`

**Interfaces:**
- `fumaca.sh <url-cloudfront> <email-de-teste>` (contra o ambiente **teste**; Turnstile com o **segredo de teste** da Cloudflare que sempre aprova — o Turnstile real fica para o roteiro manual do plano 2): `GET /saude` → 200; `OPTIONS /conta` (preflight de DELETE vindo de `https://kaique-fhs.github.io`) → `access-control-allow-methods` contém `DELETE`; `POST /conta/cadastro` com o token de teste do Turnstile → 202; pausa para o Kaique abrir o e-mail e colar o token do link; `POST /conta/confirmar` → 200; `POST /conta/entrar` → 200 com token; `GET /conta` com `Authorization` → 200 (prova que o CloudFront repassa o cabeçalho); `POST /sync` + `GET /sync` → item volta; `POST /fotos/<id>/envio` → **upload real** de um JPEG pequeno ao bucket pelo POST assinado → 204; `GET /fotos/<id>` → **leitura real** pela URL assinada devolve o mesmo arquivo. Para no ponto antes do `DELETE /conta` (o Step 3 continua).
- [ ] **Step 1:** rodar `fumaca.sh` → tudo verde (o Kaique participa do passo do e-mail).
- [ ] **Step 2 (IP do cliente):** de duas origens diferentes (o computador do Kaique e a sessão via `aws ssm send-command` usando a URL do CloudFront) fazer tentativas de `POST /conta/entrar` erradas: o log da API (`journalctl -u saude-api@teste`) mostra os **IPs dos visitantes**, nenhum da faixa do CloudFront; esgotar o limite numa origem não bloqueia a outra.
- [ ] **Step 3 (backup antes de apagar):** `systemctl start saude-backup` → dumps de hoje nos dois prefixos do bucket de backups; **depois** `DELETE /conta` da conta de teste → 204; conferir no bucket de fotos (`list-object-versions --prefix teste/<id>/`) que **não restam versões nem delete markers**; `restaurar.sh teste <hoje>` → banco `saude_restauro_teste` criado a partir do dump que **ainda tinha** a conta, e a conta apagada **não** volta (prova que a restauração reaplica `contas_apagadas`); apagar o banco de restauro.
- [ ] **Step 4 (origem barrada):** de fora, `curl --connect-timeout 5 https://<NomeOrigem>/conta` → falha de conexão (security group); de dentro da máquina, `curl --resolve <NomeOrigem>:443:127.0.0.1 https://<NomeOrigem>/conta` **sem** o cabeçalho secreto → 403 (rota diferente de `/saude`, que é isenta).
- [ ] **Step 5:** perguntar ao Kaique se mantém tudo ligado (~US$ 12/mês nos créditos) ou desliga a máquina até o plano 2 (regra do `CLAUDE.md`); registrar a resposta no `server/infra/README.md`.
- [ ] **Step 6: Commit** — "Infra: teste de fumaça e restauração conferidos".
