# Runbook da maquina (Saude Familiar)

Resumo para revisao. Nada aqui roda sozinho: cada passo com a AWS exige o OK do Kaique.

## O que existe

- 1 instancia t4g.micro (Ubuntu 24.04 ARM, 1 GB) com IP fixo (Elastic IP), sem SSH: acesso por SSM Session Manager.
- Postgres 16 local (so `localhost`), bancos `saude_teste` e `saude_producao`, cada um com dono proprio (LOGIN, nao superusuario). Papel `saude_app` (NOLOGIN). `pg_hba`: so `scram-sha-256`.
- Duas APIs Node 24 (systemd `saude-api@teste` na porta 3001, `saude-api@producao` na 3000), cada uma com o seu arquivo `/etc/saude/<ambiente>.env` (root, 0600) e o seu segredo de origem.
- Caddy na 443 com certificado Let's Encrypt para `<ip>.sslip.io`; a 80 so atende o desafio ACME (resto: 404). So o CloudFront alcanca a 443 (security group). `/teste/*` vai para a 3001, o resto para a 3000.
- Swap de 2 GB, journald com 500 MB e 30 dias, alerta de disco acima de 80% (SNS, no maximo 1 por dia), timer diario de limpeza de fotos por ambiente.

## Parametros no SSM (SecureString)

Em `/saude-familiar/<teste|producao>/`: `DB_SENHA`, `SEGREDO_ORIGEM`, `TURNSTILE_SECRET`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE`.
`DB_SENHA` e `SEGREDO_ORIGEM` sao gerados com `openssl rand -hex 32` direto no `put-parameter`, sem eco. Os demais o Kaique grava. Nada disso vai para o repositorio ou para log.

## Provisionar (na maquina, como root, via Session Manager)

```
sudo bash /opt/saude-familiar/server/infra/maquina/provisionar.sh <ip>.sslip.io <bucket-fotos> <bucket-backups> <arn-topico-alertas>
```
Primeira vez: `sudo git clone --branch main https://github.com/Kaique-fhs/saude-familiar /opt/saude-familiar` e rodar o script a partir dai (ele reaproveita o clone). Pode rodar de novo: cada passo confere o estado antes de agir. Para atualizar a API, rode de novo (faz `git fetch`, `npm ci` e reinicia os servicos).

## Operacao

- Logs: `journalctl -u saude-api@producao -f`.
- Rotacionar segredo: troque o parametro no SSM, rode `sudo server/infra/maquina/carregar-segredos.sh <ambiente>` e `sudo systemctl restart saude-api@<ambiente>`. Trocar `DB_SENHA` exige rodar o provisionamento de novo (reaplica a senha no Postgres).
- Testes locais dos scripts: `bash server/infra/maquina/testar_maquina.sh`.

## Deploy e atualizacao da stack (na maquina do Kaique, Git Bash)

Atualizar o template (ou criar do zero) usa sempre o mesmo comando. Os segredos de origem saem do SSM direto para a linha de comando, sem eco e sem variavel exportada. `EMAIL_ALERTA` e o e-mail que recebe os alarmes (defina antes, fora do repositorio). Primeiro um change set, so para ler; execute-o depois do OK:

```
AWS="$LOCALAPPDATA/Programs/Amazon/AWSCLIV2/aws.exe"
"$AWS" cloudformation deploy --profile saude-familiar --region us-east-2   --stack-name saude-familiar --template-file server/infra/saude-familiar.yaml   --capabilities CAPABILITY_IAM --no-execute-changeset   --parameter-overrides     EmailAlerta="$EMAIL_ALERTA"     SegredoOrigemTeste="$("$AWS" ssm get-parameter --profile saude-familiar --region us-east-2 --with-decryption --name /saude-familiar/teste/SEGREDO_ORIGEM --query Parameter.Value --output text)"     SegredoOrigemProducao="$("$AWS" ssm get-parameter --profile saude-familiar --region us-east-2 --with-decryption --name /saude-familiar/producao/SEGREDO_ORIGEM --query Parameter.Value --output text)"
```
Confira o change set (`aws cloudformation describe-change-set`): so deve haver o que o template mudou. Para aplicar, rode o mesmo comando sem `--no-execute-changeset`. Antes de qualquer deploy: `bash server/infra/validar.sh`.

## Restaurar um backup

Backups: `s3://<BucketBackups>/<ambiente>/<AAAA-MM-DD>.dump` (e `contas_apagadas-<data>.csv`), um por dia, somem em 30 dias (23 dias como objeto atual + 7 como versao antiga). O bucket e versionado; versoes antigas (ate 7 dias) ficam recuperaveis pelo console ou `list-object-versions` se um dump for sobrescrito. A maquina nao apaga nada nesse bucket. Rodar na maquina, como root (Session Manager):

- **Conferir sem tocar no banco vivo** (nao mexe na API): `sudo server/infra/maquina/restaurar.sh <teste|producao> <AAAA-MM-DD>`. Restaura no banco novo `saude_restauro_<ambiente>`, reaplica as exclusoes de contas (`contas_apagadas`) e imprime contagens. Confira e apague a mao: `drop database saude_restauro_<ambiente>`.
- **Trocar o banco vivo**: `sudo server/infra/maquina/restaurar.sh <ambiente> <data> saude_<ambiente> --substituir`. Para a API, restaura num banco temporario, reaplica as exclusoes, renomeia o vivo para `saude_<ambiente>_reserva_<data-hora>` e o temporario para `saude_<ambiente>`, e religa a API. A reserva **nao** e apagada (confira e remova com `drop database`); se algo falhar, o banco vivo fica intacto. Exclusoes de conta feitas depois do ultimo backup e antes da perda (ate 24 h) nao tem copia: reaplique a mao se souber quais sao.

## Refazer tudo do zero (maquina perdida)

1. Se a stack e a maquina ainda existem mas a instancia morreu: o alarme de recuperacao/reinicio cuida de falhas de hardware e travas. Se a instancia foi terminada, o volume ficou retido (ver abaixo): da para anexa-lo ou seguir os passos seguintes e restaurar do backup.
2. Parametros no SSM (`/saude-familiar/<teste|producao>/`, SecureString) **antes** de tudo: `DB_SENHA` e `SEGREDO_ORIGEM` com `openssl rand -hex 32` direto no `put-parameter` (sem eco); `TURNSTILE_SECRET`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE` o Kaique grava. Se os parametros ainda existem, nao regrave: as distribuicoes e a maquina usam os mesmos valores.
3. Stack: o comando de deploy acima (sem `--no-execute-changeset`, apos o OK). Se a stack antiga ainda existe com a maquina retida, remova a maquina e o volume antigos a mao antes, para nao pagar em dobro.
4. Anote as saidas (`IpPublico`, `NomeOrigem`, `BucketFotos`, `BucketBackups`, `TopicoAlertas`) e provisione a maquina nova (secao "Provisionar"). O provisionamento cria os bancos vazios.
5. Restaure cada ambiente: `restaurar.sh <ambiente> <data> saude_<ambiente> --substituir` (o banco vivo e o vazio criado no passo 4). Fotos ja estao no bucket de fotos (versionado), nao dependem da maquina.
6. Confira: `curl https://<UrlProducao>/saude` e o teste de fumaca (`server/infra/fumaca.sh`, ambiente teste).

## Decisao: maquina fica ligada

Task 8, Step 5: o Kaique decidiu **manter a maquina ligada**, a cerca de US$ 11,50/mes, pagos com os creditos da conta. Nao ha rotina de desligar.

## Alertas e reinicio

- `saude-api@<ambiente>`: `Restart=always` com limite de 5 partidas em 300 s; ao estourar, a unidade fica `failed` e `saude-alerta@<unidade>.service` avisa no topico SNS (e-mail). Causa tipica: migracao quebrada; veja `journalctl -u saude-api@<ambiente> -n 100`. Depois de corrigir: `systemctl reset-failed saude-api@<ambiente>` e `systemctl start ...`.
- A API depende de `postgresql@16-main.service` (o `postgresql.service` do Ubuntu e so o guarda-chuva).
- CloudWatch: `AlarmeRecuperacao` (falha de sistema: recupera a instancia) e `AlarmeTravada` (`StatusCheckFailed_Instance` por 5 min, p.ex. travada por falta de memoria: reinicia e avisa no SNS).

## Custo e remocao (importante)

- Apagar a stack `saude-familiar` **nao apaga a maquina nem o volume**: ficam **retidos** (protege os dados) e continuam cobrando. A remocao e **manual**, depois de confirmar que nao ha dado a guardar: terminar a instancia e apagar o volume EBS.
- Apagar a stack **solta o IP fixo**: o `<ip>.sslip.io` muda, o certificado e as distribuicoes do CloudFront precisam ser refeitos. Um IP fixo solto e sem uso tambem gera cobranca ate ser liberado.
