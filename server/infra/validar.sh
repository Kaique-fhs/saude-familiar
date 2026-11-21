#!/usr/bin/env bash
# Valida o template localmente e na API da AWS (so leitura; nada e criado).
set -euo pipefail

cd "$(dirname "$0")"
TEMPLATE="saude-familiar.yaml"

AWS="${AWS_BIN:-}"
if [ -z "$AWS" ]; then
  if [ -n "${LOCALAPPDATA:-}" ] && [ -x "$LOCALAPPDATA/Programs/Amazon/AWSCLIV2/aws.exe" ]; then
    AWS="$LOCALAPPDATA/Programs/Amazon/AWSCLIV2/aws.exe"
  else
    AWS="aws"
  fi
fi

echo "== testes do template =="
uvx --with pyyaml python -I testar_template.py

echo "== cfn-lint =="
uvx cfn-lint "$TEMPLATE"

echo "== cfn-guard =="
if command -v cfn-guard >/dev/null 2>&1; then
  if [ -f regras.guard ]; then
    cfn-guard validate --data "$TEMPLATE" --rules regras.guard
  else
    echo "cfn-guard instalado, mas sem regras.guard; pulando."
  fi
else
  echo "AVISO: cfn-guard nao encontrado; seguindo com cfn-lint e validate-template."
fi

echo "== aws cloudformation validate-template (so leitura) =="
"$AWS" cloudformation validate-template \
  --template-body "file://$TEMPLATE" \
  --profile saude-familiar --region us-east-2

echo "OK: template valido."
