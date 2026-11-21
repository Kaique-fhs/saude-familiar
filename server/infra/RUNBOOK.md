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
sudo REF=feat/aws-infra bash /opt/saude-familiar/server/infra/maquina/provisionar.sh <ip>.sslip.io <bucket-fotos> <bucket-backups> <arn-topico-alertas>
```
Primeira vez: `sudo git clone --branch feat/aws-infra https://github.com/Kaique-fhs/saude-familiar /opt/saude-familiar` e rodar o script a partir dai (ele reaproveita o clone). Pode rodar de novo: cada passo confere o estado antes de agir. Para atualizar a API, rode de novo (faz `git fetch`, `npm ci` e reinicia os servicos).

## Operacao

- Logs: `journalctl -u saude-api@producao -f`.
- Rotacionar segredo: troque o parametro no SSM, rode `sudo server/infra/maquina/carregar-segredos.sh <ambiente>` e `sudo systemctl restart saude-api@<ambiente>`. Trocar `DB_SENHA` exige rodar o provisionamento de novo (reaplica a senha no Postgres).
- Testes locais dos scripts: `bash server/infra/maquina/testar_maquina.sh`.

## Custo e remocao (importante)

- Apagar a stack `saude-familiar` **nao apaga a maquina nem o volume**: ficam **retidos** (protege os dados) e continuam cobrando. A remocao e **manual**, depois de confirmar que nao ha dado a guardar: terminar a instancia e apagar o volume EBS.
- Apagar a stack **solta o IP fixo**: o `<ip>.sslip.io` muda, o certificado e as distribuicoes do CloudFront precisam ser refeitos. Um IP fixo solto e sem uso tambem gera cobranca ate ser liberado.
