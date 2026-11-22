#!/usr/bin/env bash
# Provisiona a maquina (Ubuntu 24.04 ARM, t4g.micro). Idempotente: pode rodar de novo.
# Uso (root): provisionar.sh <nome-origem> <bucket-fotos> <bucket-backups> <topico-alertas>
#   nome-origem:     <ip>.sslip.io (certificado Let's Encrypt pelo Caddy)
#   topico-alertas:  ARN do topico SNS (alerta de disco)
# Variavel obrigatoria: REF (branch do repositorio que contem server/; sem padrao,
# porque um branch sem server/ apagaria a API do disco).
# Pre-requisito: os parametros /saude-familiar/{teste,producao}/* ja existem no SSM
# (ver server/infra/RUNBOOK.md) e a instancia tem o papel que os le.
set -euo pipefail

REPO_URL="https://github.com/Kaique-fhs/saude-familiar"
REF="${REF:-}"
DESTINO="/opt/saude-familiar"
NODE_VERSAO="v24.22.3"
NODE_SHA256="6e51a2ada00f0011cc266f65d98922b403d7ad88f809ca2aa615a5fe1ce6e86c"
PG_CONF_D="/etc/postgresql/16/main/conf.d"
PG_HBA="/etc/postgresql/16/main/pg_hba.conf"
MAQ="$DESTINO/server/infra/maquina"

log() { echo "[provisionar] $*"; }

criar_swap() {
  log "swap de 2 GB"
  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    if [ ! -f /swapfile ]; then
      fallocate -l 2G /swapfile
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
    fi
    swapon /swapfile
  fi
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-saude.conf
  sysctl -q -p /etc/sysctl.d/99-saude.conf
}

instalar_pacotes() {
  log "pacotes (apt)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git unzip debian-keyring debian-archive-keyring apt-transport-https
  # Caddy: repositorio oficial
  if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
  fi
  apt-get install -y -qq postgresql-16 unattended-upgrades caddy
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
  systemctl enable --now unattended-upgrades
}

instalar_aws_cli() {
  if command -v aws >/dev/null 2>&1 && aws --version 2>&1 | grep -q '^aws-cli/2'; then
    log "AWS CLI v2 ja instalada"
    return
  fi
  log "AWS CLI v2"
  local d
  d="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "$d/awscliv2.zip"
  unzip -q "$d/awscliv2.zip" -d "$d"
  "$d/aws/install" --update
  rm -rf "$d"
}

instalar_node() {
  if [ -x /opt/node/bin/node ] && [ "$(/opt/node/bin/node --version)" = "$NODE_VERSAO" ]; then
    log "Node $NODE_VERSAO ja instalado"
    return
  fi
  log "Node $NODE_VERSAO (tarball oficial, sha256 conferido)"
  local d arq="node-$NODE_VERSAO-linux-arm64.tar.xz"
  d="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSAO/$arq" -o "$d/$arq"
  (cd "$d" && echo "$NODE_SHA256  $arq" | sha256sum -c -)
  mkdir -p /opt/node
  tar -xJf "$d/$arq" -C /opt/node --strip-components=1
  rm -rf "$d"
}

criar_usuario() {
  id saude >/dev/null 2>&1 || useradd --system --home-dir "$DESTINO" --no-create-home --shell /usr/sbin/nologin saude
}

# Confere no branch remoto, antes de qualquer checkout.
exigir_server() {
  local arq
  for arq in server/package.json server/infra/maquina/provisionar.sh; do
    if ! git -C "$DESTINO" cat-file -e "origin/$REF:$arq" 2>/dev/null; then
      echo "o branch $REF nao tem server/ ($arq): nada foi trocado" >&2
      exit 1
    fi
  done
}

baixar_codigo() {
  log "codigo ($REF)"
  if [ -d "$DESTINO/.git" ]; then
    git -C "$DESTINO" fetch --quiet origin "$REF"
    exigir_server
    git -C "$DESTINO" checkout --quiet -B "$REF" "origin/$REF"
  else
    git clone --quiet --branch "$REF" "$REPO_URL" "$DESTINO"
    exigir_server
  fi
  (cd "$DESTINO/server" && PATH="/opt/node/bin:$PATH" npm ci --omit=dev --no-audit --no-fund)
  chmod +x "$MAQ"/*.sh
}

configurar_postgres() {
  log "Postgres: memoria e pg_hba"
  install -m 0644 "$MAQ/postgres-memoria.conf" "$PG_CONF_D/saude-memoria.conf"
  install -o postgres -g postgres -m 0640 "$MAQ/pg_hba.conf" "$PG_HBA"
  systemctl restart postgresql
  systemctl enable postgresql
}

gravar_dados_maquina() {
  # Dados nao secretos usados pelos timers e pelo carregar-segredos.sh.
  mkdir -p /etc/saude
  install -m 0644 /dev/null /etc/saude/maquina.env
  {
    printf 'NOME_ORIGEM=%s\n' "$NOME_ORIGEM"
    printf 'S3_BUCKET_FOTOS=%s\n' "$BUCKET_FOTOS"
    printf 'S3_BUCKET_BACKUPS=%s\n' "$BUCKET_BACKUPS"
    printf 'TOPICO_ALERTAS=%s\n' "$TOPICO"
  } > /etc/saude/maquina.env
}

# Le o parametro DB_SENHA de um ambiente sem eco.
senha_do_banco() {
  aws ssm get-parameter --name "/saude-familiar/$1/DB_SENHA" --with-decryption \
    --query Parameter.Value --output text --region us-east-2
}

aplicar_postgres_sql() {
  log "Postgres: papeis e bancos"
  local st sp
  st="$(senha_do_banco teste)"
  sp="$(senha_do_banco producao)"
  # As senhas passam pelo ambiente do processo (nunca pela linha de comando, visivel em /proc).
  (cd / && SENHA_DONO_TESTE="$st" SENHA_DONO_PRODUCAO="$sp" \
    runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -f "$MAQ/postgres.sql" >/dev/null)
  unset st sp
}

instalar_units() {
  log "systemd, Caddy e journald"
  "$MAQ/carregar-segredos.sh" teste
  "$MAQ/carregar-segredos.sh" producao

  install -m 0644 "$MAQ"/saude-api@.service "$MAQ"/saude-fotos@.service "$MAQ"/saude-fotos@.timer \
    "$MAQ"/saude-disco.service "$MAQ"/saude-disco.timer "$MAQ"/saude-alerta@.service \
    "$MAQ"/saude-backup.service "$MAQ"/saude-backup.timer \
    "$MAQ"/saude-logs.service "$MAQ"/saude-logs.timer /etc/systemd/system/

  install -m 0644 "$MAQ/Caddyfile" /etc/caddy/Caddyfile
  mkdir -p /etc/systemd/system/caddy.service.d
  printf '[Service]\nEnvironment=NOME_ORIGEM=%s\n' "$NOME_ORIGEM" > /etc/systemd/system/caddy.service.d/origem.conf

  mkdir -p /etc/systemd/journald.conf.d
  install -m 0644 "$MAQ/journald.conf" /etc/systemd/journald.conf.d/saude.conf
  systemctl restart systemd-journald

  systemctl daemon-reload
  systemctl enable --now caddy
  systemctl restart caddy
  local amb
  for amb in teste producao; do
    systemctl enable --now "saude-api@$amb.service"
    systemctl restart "saude-api@$amb.service"
    systemctl enable --now "saude-fotos@$amb.timer"
  done
  systemctl enable --now saude-disco.timer
  systemctl enable --now saude-backup.timer
  systemctl enable --now saude-logs.timer
}

principal() {
  if [ "$#" -ne 4 ]; then
    echo "uso: $0 <nome-origem> <bucket-fotos> <bucket-backups> <topico-alertas>" >&2
    exit 2
  fi
  [ -n "$REF" ] || { echo "REF obrigatorio: branch que contem server/ (ex.: REF=feat/contas-ec2)" >&2; exit 2; }
  [ "$(id -u)" -eq 0 ] || { echo "rode como root" >&2; exit 1; }
  NOME_ORIGEM="$1"; BUCKET_FOTOS="$2"; BUCKET_BACKUPS="$3"; TOPICO="$4"

  criar_swap
  instalar_pacotes
  instalar_aws_cli
  instalar_node
  criar_usuario
  baixar_codigo
  gravar_dados_maquina
  configurar_postgres
  aplicar_postgres_sql
  instalar_units
  log "pronto"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  principal "$@"
fi
