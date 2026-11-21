#!/usr/bin/env bash
# Publica no SNS que uma unidade systemd falhou (chamado por OnFailure=).
# Uso: alerta-unidade.sh <unidade>
# Variaveis de teste: MAQUINA_ENV, AWS_BIN.
set -euo pipefail

MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"
unidade="${1:?uso: $0 <unidade>}"

topico="$(grep -m1 '^TOPICO_ALERTAS=' "$MAQUINA_ENV" | cut -d= -f2-)"
[ -n "$topico" ] || { echo "TOPICO_ALERTAS ausente em $MAQUINA_ENV" >&2; exit 1; }
"$AWS_BIN" sns publish --topic-arn "$topico" --region us-east-2 \
  --subject "Saude Familiar: ${unidade} falhou" \
  --message "A unidade ${unidade} entrou em falha (ex.: laco de reinicio ou migracao quebrada). Veja: journalctl -u ${unidade} -n 100" >/dev/null
