#!/usr/bin/env bash
# Backup diario: pg_dump -Fc de cada ambiente -> s3://<bucket-backups>/<amb>/<AAAA-MM-DD>.dump
# e a lista de contas apagadas -> s3://<bucket-backups>/<amb>/contas_apagadas.csv
# (objeto pequeno, sobrescrito a cada backup; serve para a restauracao reaplicar
# as exclusoes feitas depois do dump, mesmo que o banco tenha sido perdido).
# O dump local e temporario (pasta 700, arquivo 600) e some ao fim; o script nunca
# apaga nada no S3 (o papel da maquina nao tem Delete; a expiracao e do lifecycle).
# Falha em qualquer ambiente publica no SNS e sai com erro, sem parar os demais.
# Variaveis de teste: MAQUINA_ENV, AWS_BIN, BACKUP_DATA, DIR_TMP.
set -uo pipefail
umask 077

MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"
REGIAO="us-east-2"
BACKUP_DATA="${BACKUP_DATA:-$(date -u +%F)}"
DIR_TMP="${DIR_TMP:-${TMPDIR:-/tmp}}"
COMO_POSTGRES=(runuser -u postgres --)

valor_maquina() {
  local linha
  linha="$(grep -m1 "^$1=" "$MAQUINA_ENV" || true)"
  printf '%s' "${linha#*=}"
}

avisar() { # mensagem
  local topico
  topico="$(valor_maquina TOPICO_ALERTAS)"
  [ -n "$topico" ] || { echo "TOPICO_ALERTAS ausente em $MAQUINA_ENV" >&2; return 1; }
  "$AWS_BIN" sns publish --topic-arn "$topico" --region "$REGIAO" \
    --subject "Saude Familiar: backup falhou" --message "$1" >/dev/null
}

# Faz o backup de um ambiente; o diretorio temporario sempre some, com sucesso ou falha.
backup_ambiente() { # ambiente
  local amb="$1" banco="saude_$1" dir dump contas rc=0
  dir="$(mktemp -d "$DIR_TMP/saude-backup.XXXXXX")" || return 1
  chmod 700 "$dir"
  dump="$dir/$BACKUP_DATA.dump"
  contas="$dir/contas_apagadas.csv"
  if ! "${COMO_POSTGRES[@]}" pg_dump -Fc "$banco" > "$dump" || [ ! -s "$dump" ]; then
    rc=1
  elif ! "${COMO_POSTGRES[@]}" psql -X -v ON_ERROR_STOP=1 -d "$banco" \
      -c "copy (select user_id, apagada_em, fotos_apagadas_em from contas_apagadas order by user_id) to stdout with csv" > "$contas"; then
    rc=1
  elif ! "$AWS_BIN" s3 cp "$dump" "s3://$bucket/$amb/$BACKUP_DATA.dump" --only-show-errors --region "$REGIAO"; then
    rc=1
  elif ! "$AWS_BIN" s3 cp "$contas" "s3://$bucket/$amb/contas_apagadas.csv" --only-show-errors --region "$REGIAO"; then
    rc=1
  fi
  rm -rf "$dir"
  return "$rc"
}

bucket="$(valor_maquina S3_BUCKET_BACKUPS)"
if [ -z "$bucket" ]; then
  echo "S3_BUCKET_BACKUPS ausente em $MAQUINA_ENV" >&2
  avisar "Backup de $BACKUP_DATA nao rodou: S3_BUCKET_BACKUPS ausente na maquina." || true
  exit 1
fi

falhou=()
for amb in teste producao; do
  if backup_ambiente "$amb"; then
    echo "backup ok: $amb $BACKUP_DATA"
  else
    echo "backup FALHOU: $amb $BACKUP_DATA" >&2
    falhou+=("$amb")
  fi
done

if [ "${#falhou[@]}" -gt 0 ]; then
  avisar "Backup de $BACKUP_DATA falhou no ambiente ${falhou[*]}. Veja: journalctl -u saude-backup" || true
  exit 1
fi
