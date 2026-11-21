#!/usr/bin/env bash
# Restaura um backup e reaplica as exclusoes de contas.
# Uso (root): restaurar.sh <teste|producao> <AAAA-MM-DD> [banco-destino] [--substituir]
#   banco-destino: padrao saude_restauro_<ambiente>. Nunca sobrescreve o banco vivo
#   (saude_<ambiente>) sem --substituir; destino ja existente tambem e recusado.
# Ordem: baixa o dump -> (--substituir: para a API) -> exporta contas_apagadas do banco
# vivo (se existir) -> baixa TODAS as listas datadas do S3 e une tudo (dedup por user_id)
# -> restaura -> reinsere a uniao -> apaga de usuarios quem esta em contas_apagadas
# -> imprime contagens.
# --substituir: restaura num banco temporario, reaplica as exclusoes nele e so entao
# troca (vivo -> saude_<amb>_reserva_<data-hora>, temporario -> saude_<amb>) e religa a API.
# A reserva NAO e apagada: confira e remova a mao (drop database). Em qualquer falha o banco
# vivo fica intacto, a API e religada e a lista de exclusoes fica num arquivo 600 em
# DIR_PRESERVA (o caminho e impresso).
# De onde vem a lista se o banco foi perdido: dos objetos s3://<bucket>/<amb>/contas_apagadas-<data>.csv,
# um por backup diario (o lifecycle de 30 dias limpa). Exclusoes feitas depois do ultimo backup e
# antes da perda do banco nao tem copia (ate 24 h); reaplique-as a mao se souber quais sao.
# Variaveis de teste: MAQUINA_ENV, AWS_BIN, DIR_PRESERVA.
set -euo pipefail
umask 077

MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"
DIR_PRESERVA="${DIR_PRESERVA:-/var/lib/saude/restauro}"
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
temporario="saude_restauro_tmp_$ambiente"

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
chmod 700 "$tmp"
api_parada=0
banco_criado=""
preservada=""

# Limpeza em qualquer saida. Em falha: religa a API, apaga so o banco que esta
# funcao criou e mantem a lista de exclusoes preservada (avisando o caminho).
sair() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    if [ -n "$banco_criado" ]; then
      psql_ -d postgres -c "drop database if exists \"$banco_criado\" with (force)" >/dev/null 2>&1 || true
    fi
    if [ "$api_parada" -eq 1 ]; then
      systemctl start "saude-api@$ambiente.service" || echo "ATENCAO: religue a API: systemctl start saude-api@$ambiente" >&2
    fi
    if [ -n "$preservada" ] && [ -s "$preservada" ]; then
      echo "FALHOU. Lista de contas apagadas preservada em: $preservada" >&2
    fi
  else
    [ -n "$preservada" ] && rm -f "$preservada"
  fi
  rm -rf "$tmp"
  exit "$rc"
}
trap sair EXIT

echo "baixando s3://$bucket/$ambiente/$data.dump"
"$AWS_BIN" s3 cp "s3://$bucket/$ambiente/$data.dump" "$tmp/backup.dump" --only-show-errors --region "$REGIAO" \
  || { echo "nao foi possivel baixar o dump de $data" >&2; exit 1; }

# Com --substituir a API para ANTES de exportar, para nao perder exclusao feita no intervalo.
if [ "$substituir" -eq 1 ]; then
  api_parada=1
  systemctl stop "saude-api@$ambiente.service"
fi

# Lista de contas apagadas do banco vivo, antes de qualquer mudanca.
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

# Listas guardadas fora do banco: uma por dia de backup; une todas as disponiveis.
n=0
# "listagem falhou" (permissao, rede) e diferente de "lista vazia": o aws s3 ls sem
# resultado sai com 1 e sem nenhuma mensagem; qualquer outra coisa aborta.
if saida_ls="$("$AWS_BIN" s3 ls "s3://$bucket/$ambiente/contas_apagadas-" --region "$REGIAO" 2>"$tmp/ls.err")"; then
  :
else
  rc_ls=$?
  if [ "$rc_ls" -eq 1 ] && [ -z "$saida_ls" ] && [ ! -s "$tmp/ls.err" ]; then
    saida_ls=""
  else
    echo "nao consegui listar as listas de contas apagadas no S3 (codigo $rc_ls); abortando para nao perder exclusoes" >&2
    exit 1
  fi
fi
nomes="$(printf '%s\n' "$saida_ls" | awk '{print $NF}')"
while IFS= read -r nome; do
  [ -n "$nome" ] || continue
  n=$((n + 1))
  "$AWS_BIN" s3 cp "s3://$bucket/$ambiente/$nome" "$tmp/s3-$n.csv" --only-show-errors --region "$REGIAO" \
    || { echo "nao consegui baixar $nome; abortando para nao perder exclusoes" >&2; exit 1; }
done <<< "$nomes"
[ "$n" -gt 0 ] || echo "AVISO: nenhuma lista contas_apagadas-*.csv no S3; so valem as contas do dump e do banco vivo" >&2

# Uniao preservada em arquivo 600 fora do tmp, ate o fim bem-sucedido.
mkdir -p "$DIR_PRESERVA"
chmod 700 "$DIR_PRESERVA"
preservada="$DIR_PRESERVA/contas_apagadas-$ambiente-$(date -u +%Y%m%dT%H%M%SZ).csv"
# Criado sob umask 077 (modo 600), numa unica gravacao.
for f in "$tmp/vivo.csv" "$tmp"/s3-*.csv; do
  [ -f "$f" ] && awk 1 "$f"
done > "$preservada"

# Banco onde se restaura: o destino, ou um temporario no --substituir.
alvo="$destino"
if [ "$substituir" -eq 1 ]; then
  alvo="$temporario"
  psql_ -d postgres -c "drop database if exists \"$alvo\" with (force)"
fi
banco_criado="$alvo"
psql_ -d postgres -c "create database \"$alvo\" owner \"$dono\""
"${COMO_POSTGRES[@]}" pg_restore --no-owner --role="$dono" --exit-on-error -d "$alvo" < "$tmp/backup.dump"

# Reinsere as exclusoes (dedup por user_id) e reaplica no banco restaurado.
{
  echo "create temp table _ca (like contas_apagadas);"
  echo "copy _ca from stdin with csv;"
  cat "$preservada"
  echo '\.'
  echo "insert into contas_apagadas select distinct on (user_id) * from _ca order by user_id, apagada_em on conflict (user_id) do nothing;"
  echo "delete from usuarios where id in (select user_id from contas_apagadas);"
} | psql_ -d "$alvo"

if [ "$substituir" -eq 1 ]; then
  reserva="${vivo}_reserva_$(date -u +%Y%m%d%H%M%S)"
  if existe_banco "$vivo"; then
    psql_ -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$vivo' and pid <> pg_backend_pid()" >/dev/null
    psql_ -d postgres -c "alter database \"$vivo\" rename to \"$reserva\""
  else
    reserva=""
  fi
  if ! psql_ -d postgres -c "alter database \"$alvo\" rename to \"$vivo\""; then
    [ -n "$reserva" ] && psql_ -d postgres -c "alter database \"$reserva\" rename to \"$vivo\""
    exit 1
  fi
  banco_criado=""
  systemctl start "saude-api@$ambiente.service"
  api_parada=0
  alvo="$vivo"
  if [ -n "$reserva" ]; then
    echo "O banco anterior ficou como $reserva. Depois de conferir, remova: sudo -u postgres psql -c 'drop database \"$reserva\"'"
  fi
else
  banco_criado=""
fi

echo "restaurado em $alvo. Contagens:"
psql_ -At -d "$alvo" -c "select 'usuarios', count(*) from usuarios union all select 'itens', count(*) from itens union all select 'contas_apagadas', count(*) from contas_apagadas"
