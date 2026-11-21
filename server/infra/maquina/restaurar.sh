#!/usr/bin/env bash
# Restaura um backup e reaplica as exclusoes de contas.
# Uso (root): restaurar.sh <teste|producao> <AAAA-MM-DD> [banco-destino] [--substituir]
#   banco-destino: padrao saude_restauro_<ambiente>. Nunca sobrescreve o banco vivo
#   (saude_<ambiente>) sem --substituir; destino ja existente tambem e recusado.
# Ordem: baixa o dump -> exporta contas_apagadas do banco vivo (se existir) -> baixa
# a lista guardada no S3 -> restaura -> reinsere as duas listas -> apaga de usuarios
# quem esta em contas_apagadas -> imprime contagens.
# De onde vem a lista se o banco foi perdido: do objeto s3://<bucket>/<amb>/contas_apagadas.csv,
# regravado a cada backup diario. Exclusoes feitas depois do ultimo backup e antes da perda
# do banco nao tem copia (ate 24 h); reaplique-as a mao se souber quais sao.
# Variaveis de teste: MAQUINA_ENV, AWS_BIN.
set -euo pipefail
umask 077

MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"
REGIAO="us-east-2"
COMO_POSTGRES=(runuser -u postgres --)

uso() { echo "uso: $0 <teste|producao> <AAAA-MM-DD> [banco-destino] [--substituir]" >&2; exit 2; }

substituir=0
pos=()
for a in "$@"; do
  if [ "$a" = "--substituir" ]; then substituir=1; else pos+=("$a"); fi
done
{ [ "${#pos[@]}" -ge 2 ] && [ "${#pos[@]}" -le 3 ]; } || uso
ambiente="${pos[0]}"; data="${pos[1]}"
case "$ambiente" in teste|producao) ;; *) uso ;; esac
[[ "$data" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || uso
vivo="saude_$ambiente"
destino="${pos[2]:-saude_restauro_$ambiente}"
[[ "$destino" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "nome de banco invalido: $destino" >&2; exit 2; }
dono="saude_dono_$ambiente"

psql_() { "${COMO_POSTGRES[@]}" psql -X -v ON_ERROR_STOP=1 "$@"; }
existe_banco() { [ -n "$(psql_ -At -d postgres -c "select 1 from pg_database where datname='$1'")" ]; }

if [ "$destino" = "$vivo" ] && [ "$substituir" -ne 1 ]; then
  echo "recusado: $vivo e o banco vivo; use --substituir para sobrescrever" >&2; exit 1
fi
if [ "$substituir" -eq 1 ] && [ "$destino" != "$vivo" ]; then
  echo "--substituir so vale com o banco vivo ($vivo) como destino" >&2; exit 2
fi
if [ "$substituir" -ne 1 ] && existe_banco "$destino"; then
  echo "recusado: o banco $destino ja existe" >&2; exit 1
fi

bucket="$(grep -m1 '^S3_BUCKET_BACKUPS=' "$MAQUINA_ENV" | cut -d= -f2-)"
[ -n "$bucket" ] || { echo "S3_BUCKET_BACKUPS ausente em $MAQUINA_ENV" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"

echo "baixando s3://$bucket/$ambiente/$data.dump"
"$AWS_BIN" s3 cp "s3://$bucket/$ambiente/$data.dump" "$tmp/backup.dump" --only-show-errors --region "$REGIAO" \
  || { echo "nao foi possivel baixar o dump de $data" >&2; exit 1; }

# Lista de contas apagadas do banco vivo, ANTES de qualquer mudanca.
: > "$tmp/vivo.csv"
if existe_banco "$vivo"; then
  if ! psql_ -d "$vivo" -c "copy (select user_id, apagada_em, fotos_apagadas_em from contas_apagadas order by user_id) to stdout with csv" > "$tmp/vivo.csv"; then
    if [ "$substituir" -eq 1 ]; then
      echo "nao consegui exportar contas_apagadas de $vivo; abortando para nao perder exclusoes" >&2; exit 1
    fi
    echo "AVISO: nao consegui exportar contas_apagadas de $vivo; seguindo sem essa lista" >&2
    : > "$tmp/vivo.csv"
  fi
else
  echo "AVISO: banco $vivo nao existe; a lista do banco vivo nao esta disponivel" >&2
fi

# Lista guardada fora do banco (atualizada a cada backup).
if ! "$AWS_BIN" s3 cp "s3://$bucket/$ambiente/contas_apagadas.csv" "$tmp/s3.csv" --only-show-errors --region "$REGIAO"; then
  echo "AVISO: lista s3://$bucket/$ambiente/contas_apagadas.csv indisponivel; so valem as contas do dump e do banco vivo" >&2
  : > "$tmp/s3.csv"
fi

if [ "$substituir" -eq 1 ]; then
  systemctl stop "saude-api@$ambiente.service"
  psql_ -d postgres -c "drop database if exists \"$destino\" with (force)"
fi
psql_ -d postgres -c "create database \"$destino\" owner \"$dono\""
"${COMO_POSTGRES[@]}" pg_restore --no-owner --role="$dono" --exit-on-error -d "$destino" < "$tmp/backup.dump"

# Reinsere as exclusoes e reaplica. O awk 1 garante quebra de linha final em cada lista.
{
  echo "create temp table _ca (like contas_apagadas);"
  echo "copy _ca from stdin with csv;"
  sed -e '$a\' "$tmp/vivo.csv"
  sed -e '$a\' "$tmp/s3.csv"
  echo '\.'
  echo "insert into contas_apagadas select distinct on (user_id) * from _ca order by user_id, apagada_em on conflict (user_id) do nothing;"
  echo "delete from usuarios where id in (select user_id from contas_apagadas);"
} | psql_ -d "$destino"

if [ "$substituir" -eq 1 ]; then
  systemctl start "saude-api@$ambiente.service"
fi

echo "restaurado em $destino. Contagens:"
psql_ -At -d "$destino" -c "select 'usuarios', count(*) from usuarios union all select 'itens', count(*) from itens union all select 'contas_apagadas', count(*) from contas_apagadas"
