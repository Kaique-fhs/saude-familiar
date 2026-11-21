#!/usr/bin/env bash
# Avisa no SNS quando "/" passa de 80% (no maximo um aviso a cada 24 h).
# Variaveis de teste: DISCO_USO (percentual), ARQUIVO_ESTADO, MAQUINA_ENV, AWS_BIN.
set -euo pipefail

LIMITE=80
INTERVALO_S=86400
ARQUIVO_ESTADO="${ARQUIVO_ESTADO:-/var/lib/saude/disco-ultimo-aviso}"
MAQUINA_ENV="${MAQUINA_ENV:-/etc/saude/maquina.env}"
AWS_BIN="${AWS_BIN:-aws}"

uso_percentual() {
  if [ -n "${DISCO_USO:-}" ]; then
    echo "$DISCO_USO"
  else
    df --output=pcent / | tail -1 | tr -dc '0-9'
  fi
}

# Verdadeiro se nunca avisou ou se o ultimo aviso tem mais de 24 h.
pode_avisar() {
  local ultimo=0 agora
  [ -f "$ARQUIVO_ESTADO" ] && ultimo="$(tr -dc '0-9' < "$ARQUIVO_ESTADO")"
  agora="$(date +%s)"
  [ $((agora - ${ultimo:-0})) -ge "$INTERVALO_S" ]
}

principal() {
  local uso topico
  uso="$(uso_percentual)"
  [ "$uso" -gt "$LIMITE" ] || exit 0
  pode_avisar || exit 0
  topico="$(grep -m1 '^TOPICO_ALERTAS=' "$MAQUINA_ENV" | cut -d= -f2-)"
  [ -n "$topico" ] || { echo "TOPICO_ALERTAS ausente em $MAQUINA_ENV" >&2; exit 1; }
  "$AWS_BIN" sns publish --topic-arn "$topico" --region us-east-2 \
    --subject "Saude Familiar: disco em ${uso}%" \
    --message "O disco da maquina esta em ${uso}% (limite ${LIMITE}%). Verifique logs, backups locais e fotos pendentes." >/dev/null
  mkdir -p "$(dirname "$ARQUIVO_ESTADO")"
  date +%s > "$ARQUIVO_ESTADO"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  principal
fi
