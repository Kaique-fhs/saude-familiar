#!/usr/bin/env bash
# Testes locais (sem AWS, sem root) dos scripts da maquina: geracao do arquivo
# de ambiente, alerta de disco e propriedades criticas dos arquivos de configuracao.
# Uso: bash server/infra/maquina/testar_maquina.sh
set -uo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
CONFIG_JS="$AQUI/../../src/config.js"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FALHAS=0
TOTAL=0

ok() { TOTAL=$((TOTAL + 1)); echo "ok   - $1"; }
falha() { TOTAL=$((TOTAL + 1)); FALHAS=$((FALHAS + 1)); echo "FALHA - $1"; }
verifica() { # descricao comando...
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$d"; else falha "$d"; fi
}

# aws falso: so responde ao get-parameters-by-path e registra todas as chamadas.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/aws" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_AWS_LOG"
if [ "$1 $2" = "ssm get-parameters-by-path" ]; then
  [ -n "${FAKE_AWS_FALHA:-}" ] && exit 255
  caminho=""
  while [ $# -gt 0 ]; do [ "$1" = "--path" ] && caminho="$2"; shift; done
  amb="$(basename "$caminho")"
  printf '%s\t%s\n' "$caminho/DB_SENHA" "hexdb$amb"
  printf '%s\t%s\n' "$caminho/SEGREDO_ORIGEM" "segredo-origem-$amb"
  printf '%s\t%s\n' "$caminho/TURNSTILE_SECRET" "turnstile-$amb"
  printf '%s\t%s\n' "$caminho/SMTP_USER" "robo@example.com"
  printf '%s\t%s\n' "$caminho/SMTP_PASS" "abcd efgh ijkl mnop"
  printf '%s\t%s\n' "$caminho/EMAIL_REMETENTE" "Saude <robo@example.com>"
fi
exit 0
FAKE
chmod +x "$TMP/bin/aws"
export FAKE_AWS_LOG="$TMP/aws.log"
: > "$FAKE_AWS_LOG"

printf 'S3_BUCKET_FOTOS=bucket-fotos-x\nTOPICO_ALERTAS=arn:aws:sns:us-east-2:111:alertas\n' > "$TMP/maquina.env"

gerar() { # ambiente
  DIR_ENV="$TMP/etc" MAQUINA_ENV="$TMP/maquina.env" AWS_BIN="$TMP/bin/aws" \
    bash "$AQUI/carregar-segredos.sh" "$1"
}

echo "== carregar-segredos.sh =="
SAIDA="$(gerar producao 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "producao: sai com 0"; else falha "producao: sai com 0 (rc=$RC)"; fi
SAIDA_T="$(gerar teste 2>&1)"
PROD="$TMP/etc/producao.env"; TESTE="$TMP/etc/teste.env"

# toda variavel lida por config.js precisa estar no arquivo de ambiente
mapfile -t VARS < <(grep -oE "env\.[A-Z_0-9]+|'[A-Z][A-Z_0-9]+'" "$CONFIG_JS" | sed -E "s/^env\.//; s/'//g" | sort -u)
if [ "${#VARS[@]}" -ge 12 ]; then ok "config.js: ${#VARS[@]} variaveis encontradas"; else falha "config.js: poucas variaveis (${#VARS[@]})"; fi
for v in "${VARS[@]}"; do
  verifica "producao.env define $v" grep -q "^$v=." "$PROD"
  verifica "teste.env define $v" grep -q "^$v=." "$TESTE"
done
verifica "producao: PORT=3000" grep -qx "PORT=3000" "$PROD"
verifica "teste: PORT=3001" grep -qx "PORT=3001" "$TESTE"
verifica "producao: AMBIENTE=producao" grep -qx "AMBIENTE=producao" "$PROD"
verifica "teste: AMBIENTE=teste" grep -qx "AMBIENTE=teste" "$TESTE"
verifica "TRUST_PROXY_SALTOS=2" grep -qx "TRUST_PROXY_SALTOS=2" "$PROD"
verifica "ORIGEM_SITE" grep -qx "ORIGEM_SITE=https://kaique-fhs.github.io" "$PROD"
verifica "SMTP_HOST" grep -qx "SMTP_HOST=smtp.gmail.com" "$PROD"
verifica "SMTP_PORT=465" grep -qx "SMTP_PORT=465" "$PROD"
verifica "TETO_EMAILS_DIA=300" grep -qx "TETO_EMAILS_DIA=300" "$PROD"
verifica "S3_REGIAO=us-east-2" grep -qx "S3_REGIAO=us-east-2" "$PROD"
verifica "bucket vem de maquina.env" grep -qx "S3_BUCKET_FOTOS=bucket-fotos-x" "$PROD"
verifica "DATABASE_URL producao usa dono e banco de producao" \
  grep -qx "DATABASE_URL=postgres://saude_dono_producao:hexdbproducao@localhost:5432/saude_producao" "$PROD"
verifica "DATABASE_URL teste usa dono e banco de teste" \
  grep -qx "DATABASE_URL=postgres://saude_dono_teste:hexdbteste@localhost:5432/saude_teste" "$TESTE"
verifica "segredo de origem proprio (producao)" grep -qx "SEGREDO_ORIGEM=segredo-origem-producao" "$PROD"
verifica "segredo de origem proprio (teste)" grep -qx "SEGREDO_ORIGEM=segredo-origem-teste" "$TESTE"
verifica "senha de app com espacos preservada" grep -qx "SMTP_PASS=abcd efgh ijkl mnop" "$PROD"
verifica "SSM lido no caminho do proprio ambiente" grep -q -- "--path /saude-familiar/teste " "$FAKE_AWS_LOG"
verifica "chamada ao SSM com --with-decryption" grep -q -- "--with-decryption" "$FAKE_AWS_LOG"
verifica "chamada ao SSM na regiao us-east-2" grep -q -- "--region us-east-2" "$FAKE_AWS_LOG"
if printf '%s\n%s' "$SAIDA" "$SAIDA_T" | grep -qE "hexdb|segredo-origem|turnstile-|abcd efgh"; then
  falha "segredo vazou na saida do script"
else ok "nenhum segredo na saida (stdout/stderr)"; fi
verifica "ambiente invalido e recusado" bash -c "! DIR_ENV='$TMP/x' MAQUINA_ENV='$TMP/maquina.env' AWS_BIN='$TMP/bin/aws' bash '$AQUI/carregar-segredos.sh' outro"
FAKE_AWS_FALHA=1 DIR_ENV="$TMP/etc2" MAQUINA_ENV="$TMP/maquina.env" AWS_BIN="$TMP/bin/aws" bash "$AQUI/carregar-segredos.sh" teste >/dev/null 2>&1
RC=$?
if [ "$RC" -ne 0 ] && [ ! -s "$TMP/etc2/teste.env" ]; then ok "falha do SSM nao deixa arquivo parcial"; else falha "falha do SSM nao deixa arquivo parcial"; fi
verifica "arquivo gravado com install -m 0600" grep -qE "install .*-m 0?600" "$AQUI/carregar-segredos.sh"

echo "== disco.sh =="
disco() { # uso
  DISCO_USO="$1" ARQUIVO_ESTADO="$TMP/estado-disco" MAQUINA_ENV="$TMP/maquina.env" AWS_BIN="$TMP/bin/aws" \
    bash "$AQUI/disco.sh"
}
: > "$FAKE_AWS_LOG"; disco 80
verifica "80% nao avisa (limite e acima de 80)" bash -c "! grep -q 'sns publish' '$FAKE_AWS_LOG'"
disco 81
verifica "81% publica no SNS" grep -q "sns publish" "$FAKE_AWS_LOG"
verifica "publica no topico de maquina.env, em us-east-2" grep -q -- "--topic-arn arn:aws:sns:us-east-2:111:alertas" "$FAKE_AWS_LOG"
verifica "publica na regiao us-east-2" grep -q -- "--region us-east-2" "$FAKE_AWS_LOG"
: > "$FAKE_AWS_LOG"; disco 95
verifica "segundo aviso em menos de 24 h e suprimido" bash -c "! grep -q 'sns publish' '$FAKE_AWS_LOG'"
echo $(( $(date +%s) - 90000 )) > "$TMP/estado-disco"
disco 95
verifica "passadas 24 h avisa de novo" grep -q "sns publish" "$FAKE_AWS_LOG"

echo "== arquivos de configuracao =="
verifica "Caddyfile: trusted_proxies static 0.0.0.0/0" grep -q "trusted_proxies static 0.0.0.0/0" "$AQUI/Caddyfile"
# shellcheck disable=SC2016
verifica "Caddyfile: site NOME_ORIGEM" grep -qF '{$NOME_ORIGEM}' "$AQUI/Caddyfile"
verifica "Caddyfile: /teste/* na 3001" grep -q "handle_path /teste/\*" "$AQUI/Caddyfile"
verifica "Caddyfile: 3001 e 3000" bash -c "grep -q 127.0.0.1:3001 '$AQUI/Caddyfile' && grep -q 127.0.0.1:3000 '$AQUI/Caddyfile'"
verifica "Caddyfile: http:// responde 404" bash -c "grep -A3 '^http://' '$AQUI/Caddyfile' | grep -q 'respond.*404'"
for k in "shared_buffers = 128MB" "max_connections = 20" "work_mem = 4MB" "maintenance_work_mem = 32MB" "effective_cache_size = 384MB" "listen_addresses = 'localhost'"; do
  verifica "postgres-memoria.conf: $k" grep -qx "$k" "$AQUI/postgres-memoria.conf"
done
verifica "pg_hba: so scram-sha-256 (nada de trust/md5/password)" bash -c "! grep -vE '^\s*(#|$)' '$AQUI/pg_hba.conf' | grep -qE '\btrust\b|\bmd5\b|\bpassword\b'"
verifica "pg_hba: sem acesso fora de localhost" bash -c "! grep -vE '^\s*(#|$)' '$AQUI/pg_hba.conf' | grep -E '^host' | grep -vE '127\.0\.0\.1/32|::1/128'"
verifica "postgres.sql: saude_app NOLOGIN" grep -qi "nologin" "$AQUI/postgres.sql"
verifica "postgres.sql: donos NOSUPERUSER NOCREATEROLE" bash -c "grep -qi nosuperuser '$AQUI/postgres.sql' && grep -qi nocreaterole '$AQUI/postgres.sql'"
verifica "postgres.sql: senha por \\getenv, nunca literal" bash -c "grep -q 'getenv' '$AQUI/postgres.sql' && ! grep -qiE \"password '\" '$AQUI/postgres.sql'"
verifica "postgres.sql: grant saude_app aos donos" grep -qi "grant saude_app" "$AQUI/postgres.sql"
verifica "journald: SystemMaxUse=500M" grep -qx "SystemMaxUse=500M" "$AQUI/journald.conf"
verifica "journald: MaxRetentionSec=30day" grep -qx "MaxRetentionSec=30day" "$AQUI/journald.conf"
S="$AQUI/saude-api@.service"
for k in "User=saude" "EnvironmentFile=/etc/saude/%i.env" "ExecStartPre=/opt/node/bin/node src/tarefas.js migrar" "ExecStart=/opt/node/bin/node src/principal.js" "Restart=always" "NoNewPrivileges=true" "ProtectSystem=strict" "PrivateTmp=true"; do
  verifica "saude-api@.service: $k" grep -qx "$k" "$S"
done
verifica "fotos@.service: apagar-fotos" grep -q "tarefas.js apagar-fotos" "$AQUI/saude-fotos@.service"
verifica "fotos@.service: EnvironmentFile do ambiente" grep -qx "EnvironmentFile=/etc/saude/%i.env" "$AQUI/saude-fotos@.service"
verifica "fotos@.timer: diario" grep -qx "OnCalendar=daily" "$AQUI/saude-fotos@.timer"
verifica "disco.timer: de hora em hora" grep -qx "OnCalendar=hourly" "$AQUI/saude-disco.timer"
verifica "disco.service chama disco.sh" grep -q "ExecStart=/opt/saude-familiar/server/infra/maquina/disco.sh" "$AQUI/saude-disco.service"

echo "== provisionar.sh =="
P="$AQUI/provisionar.sh"
verifica "bash -n" bash -n "$P"
verifica "swap antes de apt" bash -c "a=\$(grep -n '^  criar_swap\$' '$P' | tail -1 | cut -d: -f1); b=\$(grep -n '^  instalar_pacotes\$' '$P' | tail -1 | cut -d: -f1); [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \$a -lt \$b ]"
verifica "swap de 2G, swappiness 10" bash -c "grep -q '2G' '$P' && grep -q 'vm.swappiness=10' '$P'"
verifica "Node 24 com sha256 conferido" bash -c "grep -q 'sha256sum -c' '$P' && grep -q 'linux-arm64' '$P'"
verifica "AWS CLI v2 aarch64" grep -q "awscli-exe-linux-aarch64.zip" "$P"
verifica "uso sem argumentos falha" bash -c "! bash '$P' >/dev/null 2>&1"

echo
echo "$((TOTAL - FALHAS))/$TOTAL ok"
[ "$FALHAS" -eq 0 ]
