#!/usr/bin/env bash
# Gera /etc/saude/<ambiente>.env (root, 0600) a partir do SSM Parameter Store.
# Uso: carregar-segredos.sh <teste|producao>
# Os valores nunca vao para a saida: so para o arquivo. Ao falhar, nada e gravado.
# Variaveis de teste: DIR_ENV, MAQUINA_ENV, AWS_BIN.
set -euo pipefail
umask 077

DIR_ENV="${DIR_ENV:-/etc/saude}"
MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"
REGIAO="us-east-2"

ambiente="${1:-}"
pool=5
case "$ambiente" in
  teste) porta=3001; pool=3 ;;
  producao) porta=3000 ;;
  *) echo "uso: $0 <teste|producao>" >&2; exit 2 ;;
esac

# Valor de uma chave de maquina.env (dados da maquina, nao secretos: bucket, topico).
valor_maquina() {
  local linha
  linha="$(grep -m1 "^$1=" "$MAQUINA_ENV" || true)"
  printf '%s' "${linha#*=}"
}

declare -A P=()
bruto="$("$AWS_BIN" ssm get-parameters-by-path \
  --path "/saude-familiar/$ambiente" --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text \
  --region "$REGIAO")" || { echo "falha ao ler o SSM de $ambiente" >&2; exit 1; }
while IFS=$'\t' read -r nome valor; do
  [ -n "$nome" ] && P["${nome##*/}"]="$valor"
done <<< "$bruto"
unset bruto

for obrigatorio in DB_SENHA SEGREDO_ORIGEM TURNSTILE_SECRET SMTP_USER SMTP_PASS EMAIL_REMETENTE; do
  [ -n "${P[$obrigatorio]:-}" ] || { echo "parametro ausente no SSM: /saude-familiar/$ambiente/$obrigatorio" >&2; exit 1; }
done
bucket="$(valor_maquina S3_BUCKET_FOTOS)"
[ -n "$bucket" ] || { echo "S3_BUCKET_FOTOS ausente em $MAQUINA_ENV" >&2; exit 1; }

mkdir -p "$DIR_ENV"
tmp="$(mktemp "$DIR_ENV/.${ambiente}.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
  printf '%s=%s\n' AMBIENTE "$ambiente"
  printf '%s=%s\n' PORT "$porta"
  printf '%s=%s\n' DATABASE_URL "postgres://saude_dono_${ambiente}:${P[DB_SENHA]}@localhost:5432/saude_${ambiente}"
  printf '%s=%s\n' ORIGEM_SITE "https://kaique-fhs.github.io"
  printf '%s=%s\n' SEGREDO_ORIGEM "${P[SEGREDO_ORIGEM]}"
  printf '%s=%s\n' TURNSTILE_SECRET "${P[TURNSTILE_SECRET]}"
  printf '%s=%s\n' SMTP_HOST "smtp.gmail.com"
  printf '%s=%s\n' SMTP_PORT 465
  printf '%s=%s\n' SMTP_USER "${P[SMTP_USER]}"
  printf '%s=%s\n' SMTP_PASS "${P[SMTP_PASS]}"
  printf '%s=%s\n' EMAIL_REMETENTE "${P[EMAIL_REMETENTE]}"
  printf '%s=%s\n' TETO_EMAILS_DIA 300
  printf '%s=%s\n' S3_REGIAO "$REGIAO"
  printf '%s=%s\n' S3_BUCKET_FOTOS "$bucket"
  printf '%s=%s\n' TRUST_PROXY_SALTOS 2
  printf '%s=%s\n' DB_POOL_MAX "$pool"
} > "$tmp"
install -m 0600 "$tmp" "$DIR_ENV/$ambiente.env"
echo "gravado $DIR_ENV/$ambiente.env"
