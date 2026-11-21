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


echo "== backup.sh e restaurar.sh (fakes de aws, pg_dump, psql, pg_restore, runuser) =="
FAKE_S3="$TMP/s3"; export FAKE_S3
FAKE_PG_LOG="$TMP/pg.log"; export FAKE_PG_LOG
cat > "$TMP/bin/runuser" <<'FAKE'
#!/usr/bin/env bash
# runuser -u <usuario> -- cmd...
echo "runuser $*" >> "$FAKE_PG_LOG"
shift 3
exec "$@"
FAKE
cat > "$TMP/bin/pg_dump" <<'FAKE'
#!/usr/bin/env bash
echo "pg_dump $*" >> "$FAKE_PG_LOG"
[ -n "${FAKE_PG_DUMP_FALHA:-}" ] && exit 1
echo "DUMP-${*: -1}"
FAKE
cat > "$TMP/bin/pg_restore" <<'FAKE'
#!/usr/bin/env bash
echo "pg_restore $*" >> "$FAKE_PG_LOG"
cat > /dev/null
[ -n "${FAKE_PG_RESTORE_FALHA:-}" ] && exit 1
exit 0
FAKE
cat > "$TMP/bin/systemctl" <<'FAKE'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_PG_LOG"
FAKE
cat > "$TMP/bin/psql" <<'FAKE'
#!/usr/bin/env bash
echo "psql $*" >> "$FAKE_PG_LOG"
case "$*" in
  *"to stdout with csv"*)
    [ -n "${FAKE_BANCO_VIVO_AUSENTE:-}" ] && exit 2
    cat "$FAKE_CONTAS_VIVO" 2>/dev/null; exit 0 ;;
  *"from pg_database"*)
    for b in ${FAKE_BANCOS:-}; do case "$*" in *"'$b'"*) echo 1;; esac; done; exit 0 ;;
  *"count(*)"*) printf 'usuarios|3\nitens|7\ncontas_apagadas|2\n'; exit 0 ;;
  *-c*) exit 0 ;;
esac
{ echo "STDIN-INICIO"; cat; echo "STDIN-FIM"; } >> "$FAKE_PG_LOG"
FAKE
chmod +x "$TMP/bin/"*
# aws falso ampliado: s3 cp (local <-> "s3"), sns publish (so registra).
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
if [ "$1 $2" = "s3 ls" ]; then
  if [ -n "${FAKE_S3_LS_FALHA:-}" ]; then echo "AccessDenied" >&2; exit 255; fi
  p="${3#s3://}"
  for f in "$FAKE_S3/$p"*; do [ -f "$f" ] && echo "2026-11-01 03:30:00 10 $(basename "$f")"; done
  exit 0
fi
if [ "$1 $2" = "s3 cp" ]; then
  src="$3"; dst="$4"
  case "$src" in s3://*contas_apagadas-*) [ -n "${FAKE_S3_CP_LISTA_FALHA:-}" ] && exit 1;; esac
  case "$dst" in
    s3://*)
      chave="${dst#s3://}"
      if [ -n "${FAKE_S3_FALHA_CHAVE:-}" ]; then case "$chave" in *"$FAKE_S3_FALHA_CHAVE"*) exit 1;; esac; fi
      mkdir -p "$FAKE_S3/$(dirname "$chave")"
      echo "perm $(stat -c %a "$src") $chave" >> "$FAKE_AWS_LOG"
      cp "$src" "$FAKE_S3/$chave" ;;
    *)
      chave="${src#s3://}"
      [ -f "$FAKE_S3/$chave" ] || exit 1
      cp "$FAKE_S3/$chave" "$dst" ;;
  esac
fi
exit 0
FAKE
chmod +x "$TMP/bin/aws"
printf 'S3_BUCKET_FOTOS=bucket-fotos-x\nS3_BUCKET_BACKUPS=bkt\nTOPICO_ALERTAS=arn:aws:sns:us-east-2:111:alertas\n' > "$TMP/maquina.env"

backup() { PATH="$TMP/bin:$PATH" MAQUINA_ENV="$TMP/maquina.env" BACKUP_DATA=2026-11-21 DIR_TMP="$TMP/tmp-backup" \
  bash "$AQUI/backup.sh"; }
rm -rf "$FAKE_S3"; : > "$FAKE_AWS_LOG"; : > "$FAKE_PG_LOG"; mkdir -p "$TMP/tmp-backup"
backup >/dev/null 2>&1; RC=$?
if [ "$RC" -eq 0 ]; then ok "backup: sai com 0"; else falha "backup: sai com 0 (rc=$RC)"; fi
verifica "backup: dump de producao em s3://bkt/producao/2026-11-21.dump" test -s "$FAKE_S3/bkt/producao/2026-11-21.dump"
verifica "backup: dump de teste em s3://bkt/teste/2026-11-21.dump" test -s "$FAKE_S3/bkt/teste/2026-11-21.dump"
verifica "backup: pg_dump -Fc do banco do ambiente" bash -c "grep -q 'pg_dump -Fc saude_producao' '$FAKE_PG_LOG' && grep -q 'pg_dump -Fc saude_teste' '$FAKE_PG_LOG'"
verifica "backup: pg_dump roda como o usuario postgres (peer)" grep -q "runuser -u postgres -- pg_dump" "$FAKE_PG_LOG"
verifica "backup: lista de contas_apagadas tambem vai ao S3" bash -c "test -f '$FAKE_S3/bkt/producao/contas_apagadas-2026-11-21.csv' && test -f '$FAKE_S3/bkt/teste/contas_apagadas-2026-11-21.csv'"
verifica "backup: dump enviado com permissao 600" grep -q "^perm 600 bkt/producao/2026-11-21.dump" "$FAKE_AWS_LOG"
verifica "backup: nenhum arquivo local sobra" bash -c "[ -z \"\$(ls -A '$TMP/tmp-backup')\" ]"
verifica "backup: nunca apaga nada no S3 (sem rm/delete/mv/sync)" bash -c "! grep -qE 's3 (rm|mv|sync)|delete-object|s3api' '$FAKE_AWS_LOG'"
verifica "backup: sem SNS quando tudo da certo" bash -c "! grep -q 'sns publish' '$FAKE_AWS_LOG'"
verifica "backup: nada de senha/URL de banco nos argumentos" bash -c "! grep -qiE 'postgres://|password|hexdb' '$FAKE_AWS_LOG' '$FAKE_PG_LOG'"
verifica "backup: AWS CLI na regiao us-east-2" grep -q -- "--region us-east-2" "$FAKE_AWS_LOG"
# banco recriado vazio no dia seguinte: a lista do dia anterior continua no S3
printf 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,2026-11-20 10:00:00+00,\n' > "$FAKE_S3/bkt/producao/contas_apagadas-2026-11-21.csv"
PATH="$TMP/bin:$PATH" MAQUINA_ENV="$TMP/maquina.env" BACKUP_DATA=2026-11-22 DIR_TMP="$TMP/tmp-backup" bash "$AQUI/backup.sh" >/dev/null 2>&1
verifica "backup: lista de outro dia nao sobrescreve a anterior (chave datada)" bash -c "grep -q aaaaaaaa '$FAKE_S3/bkt/producao/contas_apagadas-2026-11-21.csv' && test -f '$FAKE_S3/bkt/producao/contas_apagadas-2026-11-22.csv'"

rm -rf "$FAKE_S3"; : > "$FAKE_AWS_LOG"
FAKE_S3_FALHA_CHAVE="teste/2026-11-21.dump" backup >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "backup: falha no envio de teste sai com erro"; else falha "backup: falha no envio de teste sai com erro"; fi
verifica "backup: falha em teste nao impede producao" test -s "$FAKE_S3/bkt/producao/2026-11-21.dump"
verifica "backup: falha publica no SNS do maquina.env" grep -q -- "sns publish --topic-arn arn:aws:sns:us-east-2:111:alertas" "$FAKE_AWS_LOG"
verifica "backup: alerta cita o ambiente que falhou" grep -q "ambiente teste" "$FAKE_AWS_LOG"
verifica "backup: falha tambem nao deixa arquivo local" bash -c "[ -z \"\$(ls -A '$TMP/tmp-backup')\" ]"

rm -rf "$FAKE_S3"; : > "$FAKE_AWS_LOG"
FAKE_PG_DUMP_FALHA=1 backup >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "backup: pg_dump falho sai com erro"; else falha "backup: pg_dump falho sai com erro"; fi
verifica "backup: pg_dump falho nao envia dump vazio" bash -c "! ls '$FAKE_S3/bkt/producao/2026-11-21.dump' 2>/dev/null"
verifica "backup: pg_dump falho publica no SNS" grep -q "sns publish" "$FAKE_AWS_LOG"

# restaurar
printf '11111111-1111-1111-1111-111111111111,2026-11-20 10:00:00+00,\n' > "$TMP/contas-vivo.csv"; export FAKE_CONTAS_VIVO="$TMP/contas-vivo.csv"
mkdir -p "$FAKE_S3/bkt/producao"
echo "DUMP-saude_producao" > "$FAKE_S3/bkt/producao/2026-11-01.dump"
printf '22222222-2222-2222-2222-222222222222,2026-11-19 10:00:00+00,\n' > "$FAKE_S3/bkt/producao/contas_apagadas-2026-10-30.csv"
# lista mais recente VAZIA (banco recriado vazio): nao pode apagar as anteriores
: > "$FAKE_S3/bkt/producao/contas_apagadas-2026-11-20.csv"
restaurar() { PATH="$TMP/bin:$PATH" MAQUINA_ENV="$TMP/maquina.env" DIR_PRESERVA="$TMP/preserva" bash "$AQUI/restaurar.sh" "$@"; }
rlimpa() { : > "$FAKE_AWS_LOG"; : > "$FAKE_PG_LOG"; }

rlimpa; SAIDA_R="$(FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "restaurar: caminho feliz sai com 0"; else falha "restaurar: caminho feliz sai com 0 (rc=$RC)"; fi
verifica "restaurar: cria saude_restauro_producao (padrao)" grep -q 'create database "saude_restauro_producao"' "$FAKE_PG_LOG"
verifica "restaurar: pg_restore no banco de destino" grep -q "pg_restore .*-d saude_restauro_producao" "$FAKE_PG_LOG"
verifica "restaurar: baixa s3://bkt/producao/2026-11-01.dump" grep -q "s3 cp s3://bkt/producao/2026-11-01.dump" "$FAKE_AWS_LOG"
verifica "restaurar: nao toca no banco vivo (sem drop)" bash -c "! grep -qi 'drop database' '$FAKE_PG_LOG'"
verifica "restaurar: exporta contas_apagadas do banco vivo ANTES de criar o destino" bash -c "
  a=\$(grep -n 'to stdout with csv' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  b=\$(grep -n 'create database' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \"\$a\" -lt \"\$b\" ]"
verifica "restaurar: exporta do banco vivo saude_producao" grep -q "psql .*-d saude_producao .*to stdout with csv" "$FAKE_PG_LOG"
verifica "restaurar: reinsere conta do banco vivo" grep -q "11111111-1111-1111-1111-111111111111" "$FAKE_PG_LOG"
verifica "restaurar: lista recente vazia no S3 nao apaga a anterior (uniao das datadas)" grep -q "22222222-2222-2222-2222-222222222222" "$FAKE_PG_LOG"
verifica "restaurar: reinsere conta da lista guardada no S3" grep -q "22222222-2222-2222-2222-222222222222" "$FAKE_PG_LOG"
verifica "restaurar: reaplica a exclusao em usuarios" grep -q "delete from usuarios where id in (select user_id from contas_apagadas)" "$FAKE_PG_LOG"
verifica "restaurar: reinsercao depois do pg_restore, exclusao depois da reinsercao" bash -c "
  a=\$(grep -n '^pg_restore' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  b=\$(grep -n 'insert into contas_apagadas' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  c=\$(grep -n 'delete from usuarios' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ -n \"\$c\" ] && [ \"\$a\" -lt \"\$b\" ] && [ \"\$b\" -lt \"\$c\" ]"
verifica "restaurar: imprime contagens de usuarios, itens e contas_apagadas" bash -c "echo '$SAIDA_R' | grep -q 'usuarios' && echo '$SAIDA_R' | grep -q 'itens' && echo '$SAIDA_R' | grep -q 'contas_apagadas'"

rlimpa; FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 saude_producao >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: banco vivo como destino sem --substituir e recusado"; else falha "restaurar: banco vivo como destino sem --substituir e recusado"; fi
verifica "restaurar: recusa nao cria nem restaura nada" bash -c "! grep -qE 'create database|^pg_restore|drop database' '$FAKE_PG_LOG'"
rlimpa; FAKE_BANCOS="saude_producao saude_restauro_producao" restaurar producao 2026-11-01 >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: destino ja existente e recusado"; else falha "restaurar: destino ja existente e recusado"; fi
rlimpa; FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 'x; drop' >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: nome de banco invalido e recusado"; else falha "restaurar: nome de banco invalido e recusado"; fi
rlimpa; restaurar outro 2026-11-01 >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: ambiente invalido e recusado"; else falha "restaurar: ambiente invalido e recusado"; fi
rlimpa; restaurar producao ontem >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: data invalida e recusada"; else falha "restaurar: data invalida e recusada"; fi
rlimpa; FAKE_BANCOS="saude_producao" restaurar producao 2026-12-31 >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: dump inexistente aborta"; else falha "restaurar: dump inexistente aborta"; fi
verifica "restaurar: dump inexistente nao cria banco" bash -c "! grep -q 'create database' '$FAKE_PG_LOG'"

rlimpa; FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 saude_producao --substituir >/dev/null 2>&1; RC=$?
if [ "$RC" -eq 0 ]; then ok "restaurar: --substituir sobre o banco vivo funciona"; else falha "restaurar: --substituir sobre o banco vivo funciona (rc=$RC)"; fi
verifica "restaurar: --substituir para a API ANTES de exportar a lista do vivo" bash -c "
  a=\$(grep -n 'systemctl stop saude-api@producao' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  b=\$(grep -n 'to stdout with csv' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \"\$a\" -lt \"\$b\" ]"
verifica "restaurar: --substituir restaura num banco temporario, nao no vivo" bash -c "grep -q 'pg_restore .*-d saude_restauro_tmp_producao' '$FAKE_PG_LOG' && ! grep -q 'pg_restore .*-d saude_producao' '$FAKE_PG_LOG'"
verifica "restaurar: --substituir nunca da drop no banco vivo" bash -c "! grep -q 'drop database[^;]*\"saude_producao\"' '$FAKE_PG_LOG'"
verifica "restaurar: --substituir reaplica exclusoes no temporario ANTES da troca" bash -c "
  a=\$(grep -n 'delete from usuarios' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  b=\$(grep -n 'rename to' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \"\$a\" -lt \"\$b\" ]"
verifica "restaurar: --substituir guarda o vivo como reserva e promove o temporario" bash -c "grep -q 'alter database \"saude_producao\" rename to \"saude_producao_reserva_' '$FAKE_PG_LOG' && grep -q 'alter database \"saude_restauro_tmp_producao\" rename to \"saude_producao\"' '$FAKE_PG_LOG'"
verifica "restaurar: --substituir religa a API so depois da troca" bash -c "
  a=\$(grep -n 'alter database \"saude_restauro_tmp_producao\" rename' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  b=\$(grep -n 'systemctl start saude-api@producao' '$FAKE_PG_LOG' | head -1 | cut -d: -f1)
  [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \"\$a\" -lt \"\$b\" ]"
verifica "restaurar: --substituir bem-sucedido nao deixa lista preservada" bash -c "[ -z \"\$(ls -A '$TMP/preserva' 2>/dev/null)\" ]"

# pg_restore falhando no --substituir: vivo intacto, API religada, lista preservada em 600.
rlimpa; rm -rf "$TMP/preserva"
FAKE_PG_RESTORE_FALHA=1 FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 saude_producao --substituir >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: pg_restore falho no --substituir sai com erro"; else falha "restaurar: pg_restore falho no --substituir sai com erro"; fi
verifica "restaurar: falha nao renomeia nem apaga o banco vivo" bash -c "! grep -q 'alter database \"saude_producao\"' '$FAKE_PG_LOG' && ! grep -q 'drop database[^;]*\"saude_producao\"' '$FAKE_PG_LOG'"
verifica "restaurar: falha religa a API" grep -q "systemctl start saude-api@producao" "$FAKE_PG_LOG"
verifica "restaurar: falha apaga so o banco temporario" grep -q 'drop database if exists "saude_restauro_tmp_producao"' "$FAKE_PG_LOG"
verifica "restaurar: falha preserva a lista (vivo + S3) fora do tmp" bash -c "
  f=\$(ls '$TMP/preserva'/*.csv 2>/dev/null | head -1); [ -n \"\$f\" ] &&
  grep -q 11111111-1111 \"\$f\" && grep -q 22222222-2222 \"\$f\""
# Modo 600: o script cria sob umask 077. Em Git Bash/NTFS o stat nao e confiavel
# (o modo muda depois que o processo sai), entao so se checa o modo onde o FS o respeita.
( umask 077; : > "$TMP/sonda" ); MODO_SONDA="$(stat -c %a "$TMP/sonda")"
if [ "$MODO_SONDA" = 600 ]; then
  verifica "restaurar: lista preservada em arquivo 600" bash -c "[ \"\$(stat -c %a \"\$(ls '$TMP/preserva'/*.csv | head -1)\")\" = 600 ]"
else
  verifica "restaurar: lista preservada criada sob umask 077 (FS sem modo POSIX: stat nao checado)" grep -qx "umask 077" "$AQUI/restaurar.sh"
fi

# Falha ao listar/baixar as listas do S3 aborta (nao confunde com lista vazia).
for modo in FAKE_S3_LS_FALHA FAKE_S3_CP_LISTA_FALHA; do
  rlimpa
  ( export "$modo=1"; FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 saude_producao --substituir >/dev/null 2>&1 ); RC=$?
  if [ "$RC" -ne 0 ]; then ok "restaurar: $modo aborta o --substituir"; else falha "restaurar: $modo aborta o --substituir"; fi
  verifica "restaurar: $modo deixa o banco vivo intacto" bash -c "! grep -qE 'alter database|drop database[^;]*\"saude_producao\"|^pg_restore|create database' '$FAKE_PG_LOG'"
  verifica "restaurar: $modo religa a API" grep -q "systemctl start saude-api@producao" "$FAKE_PG_LOG"
done
rlimpa; FAKE_S3_LS_FALHA=1 FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 >/dev/null 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "restaurar: falha na listagem tambem aborta sem --substituir"; else falha "restaurar: falha na listagem tambem aborta sem --substituir"; fi

rlimpa; FAKE_BANCO_VIVO_AUSENTE=1 FAKE_BANCOS="" restaurar producao 2026-11-01 >/dev/null 2>&1; RC=$?
if [ "$RC" -eq 0 ]; then ok "restaurar: sem banco vivo segue com a lista do S3"; else falha "restaurar: sem banco vivo (rc=$RC)"; fi
verifica "restaurar: sem banco vivo ainda reaplica a lista do S3" grep -q "22222222-2222-2222-2222-222222222222" "$FAKE_PG_LOG"
rm -f "$FAKE_S3"/bkt/producao/contas_apagadas-*.csv
rlimpa; FAKE_BANCOS="saude_producao" restaurar producao 2026-11-01 >/dev/null 2>&1; RC=$?
if [ "$RC" -eq 0 ]; then ok "restaurar: lista do S3 ausente nao impede (so avisa)"; else falha "restaurar: lista do S3 ausente (rc=$RC)"; fi

echo "== backup: unit e timer =="
B="$AQUI/saude-backup.service"; BT="$AQUI/saude-backup.timer"
for k in "Type=oneshot" "ExecStart=/opt/saude-familiar/server/infra/maquina/backup.sh" "NoNewPrivileges=true" "ProtectSystem=strict" "PrivateTmp=true" "Wants=network-online.target" "After=network-online.target postgresql.service"; do
  verifica "saude-backup.service: $k" grep -qx "$k" "$B"
done
verifica "saude-backup.timer: 03:30 UTC" grep -qxF "OnCalendar=*-*-* 03:30:00 UTC" "$BT"
verifica "saude-backup.timer: Persistent=true" grep -qx "Persistent=true" "$BT"
verifica "provisionar.sh instala e habilita o timer do backup" bash -c "grep -q 'saude-backup.service' '$AQUI/provisionar.sh' && grep -q 'enable --now saude-backup.timer' '$AQUI/provisionar.sh'"
verifica "backup.sh e restaurar.sh: bash -n" bash -c "bash -n '$AQUI/backup.sh' && bash -n '$AQUI/restaurar.sh'"
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
