#!/usr/bin/env bash
# Apaga as copias rotacionadas do syslog e do Postgres com mais de 22 dias. A rotacao e
# semanal, entao nenhum registro (IP, e-mail em erro) passa de ~30 dias, como diz o aviso
# de privacidade. Nao edita os arquivos do logrotate dos pacotes (o Ubuntu deixaria de
# atualiza-los sozinho) e nunca toca no arquivo em uso.
# Variavel de teste: DIR_LOG.
set -euo pipefail

DIR_LOG="${DIR_LOG:-/var/log}"
DIAS=22

find "$DIR_LOG" -maxdepth 1 -type f -name 'syslog.*' -mtime "+$((DIAS - 1))" -delete
if [ -d "$DIR_LOG/postgresql" ]; then
  find "$DIR_LOG/postgresql" -maxdepth 1 -type f -name 'postgresql-*.log.*' -mtime "+$((DIAS - 1))" -delete
fi
