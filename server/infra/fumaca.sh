#!/usr/bin/env bash
# Teste de fumaca de ponta a ponta contra o ambiente TESTE (via CloudFront).
# Exige o segredo de teste da Cloudflare no SSM de teste (sempre aprova o Turnstile).
#
# Em duas etapas, porque o e-mail com o link e lido por uma pessoa:
#   fumaca.sh inicio    <url-cloudfront> <email-de-teste>
#       GET /saude, preflight de DELETE /conta, POST /conta/cadastro (202).
#       Gera a senha da conta de teste e guarda em $ESTADO (modo 600). Para e pede o token do link.
#   fumaca.sh continuar <url-cloudfront> <email-de-teste> <token-do-link>
#       POST /conta/confirmar, /conta/entrar, GET /conta, POST+GET /sync,
#       foto: POST /fotos/<id>/envio (upload real, 204) e GET /fotos/<id> (leitura real, mesmo arquivo).
#       Para antes do DELETE /conta.
#   fumaca.sh apos-confirmar <url> <email>
#       Repete tudo de "continuar" depois da confirmacao (entrar com a senha do estado ate a foto),
#       sem token novo. Guarda ID e FOTO no estado.
#   fumaca.sh apagar <url> <email>      entra com a senha do estado e faz DELETE /conta (204); confere que sumiu.
#   fumaca.sh entrar-errado <url> <email-inexistente> <n>   n tentativas erradas de /conta/entrar (so status).
# Estado: ${ESTADO:-$HOME/.saude-fumaca} (fora do repo). Nada secreto vai para a saida;
# o token de sessao so aparece truncado.
set -euo pipefail

ESTADO="${ESTADO:-$HOME/.saude-fumaca}"
TOKEN_TURNSTILE_TESTE="XXXX.DUMMY.TOKEN.XXXX"
ORIGEM_SITE="https://kaique-fhs.github.io"

uso() { echo "uso: $0 inicio <url> <email> | $0 continuar <url> <email> <token-do-link>" >&2; exit 2; }
[ $# -ge 3 ] || uso
etapa="$1"; URL="${2%/}"; EMAIL="$3"
case "$URL" in https://*) ;; *) echo "a url deve ser https://..." >&2; exit 2 ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CORPO="$TMP/corpo"

ok() { echo "OK   $*"; }
falha() { echo "FALHA $*" >&2; [ -s "$CORPO" ] && { echo "corpo: $(head -c 300 "$CORPO")" >&2; }; exit 1; }

# req <metodo> <caminho> <status-esperado> [corpo-json] [curl-args...]
# Corpo da resposta em $CORPO; falha se o status nao for o esperado.
req() {
  local metodo="$1" caminho="$2" esperado="$3" json="${4:-}"
  shift 3; [ $# -gt 0 ] && shift
  local args=(-sS --max-time 30 -o "$CORPO" -w '%{http_code}' -X "$metodo")
  [ -n "$json" ] && args+=(-H 'content-type: application/json' --data-binary "$json")
  STATUS="$(curl "${args[@]}" "$@" "$URL$caminho")"
  [ "$STATUS" = "$esperado" ] || falha "$metodo $caminho: esperado $esperado, veio $STATUS"
}

# json_get <campo> : le campo de primeiro nivel (ou a.b) do $CORPO
json_get() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    let v=o; for (const k of process.argv[2].split(".")) v=v?.[k]; process.stdout.write(v===undefined?"":String(v));' "$CORPO" "$1"
}

lerestado() { grep -m1 "^$1=" "$ESTADO" | cut -d= -f2-; }

case "$etapa" in
inicio)
  req GET /saude 200
  ok "GET /saude -> 200"

  cab="$(curl -sS --max-time 30 -D - -o /dev/null -X OPTIONS \
    -H "Origin: $ORIGEM_SITE" -H 'Access-Control-Request-Method: DELETE' \
    -H 'Access-Control-Request-Headers: authorization,content-type' "$URL/conta" | tr -d '\r')"
  metodos="$(printf '%s\n' "$cab" | grep -i '^access-control-allow-methods:' || true)"
  case "$metodos" in *DELETE*) ok "OPTIONS /conta -> allow-methods contem DELETE" ;;
    *) echo "$cab" | head -20 >&2; falha "preflight sem DELETE em access-control-allow-methods" ;; esac

  umask 077
  senha="$(openssl rand -hex 12)"
  printf 'EMAIL=%s\nSENHA=%s\n' "$EMAIL" "$senha" > "$ESTADO"
  chmod 600 "$ESTADO" 2>/dev/null || true
  corpo="$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],senha:process.argv[2],aceite:{versao:"1",saude:true,transferencia:true}}))' "$EMAIL" "$senha")"
  req POST /conta/cadastro 202 "$corpo" -H "x-turnstile-token: $TOKEN_TURNSTILE_TESTE"
  ok "POST /conta/cadastro -> 202 (estado em $ESTADO)"
  echo
  echo "PAUSA: abra o e-mail em $EMAIL e copie o token do link (parte depois de #confirmar=)."
  echo "Depois: $0 continuar $URL $EMAIL <token-do-link>"
  ;;

continuar|apos-confirmar|apagar)
  [ -f "$ESTADO" ] || { echo "sem estado em $ESTADO: rode 'inicio' antes" >&2; exit 1; }
  [ "$(lerestado EMAIL)" = "$EMAIL" ] || { echo "o e-mail difere do estado; rode 'inicio' de novo" >&2; exit 1; }
  senha="$(lerestado SENHA)"
  if [ "$etapa" = continuar ]; then
    [ $# -ge 4 ] || uso
    tokenlink="$4"
    corpo="$(node -e 'process.stdout.write(JSON.stringify({token:process.argv[1]}))' "$tokenlink")"
    req POST /conta/confirmar 200 "$corpo"
    ok "POST /conta/confirmar -> 200"
  fi

  corpo="$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],senha:process.argv[2]}))' "$EMAIL" "$senha")"
  req POST /conta/entrar 200 "$corpo"
  sessao="$(json_get token)"
  [ -n "$sessao" ] || falha "entrar sem token na resposta"
  ok "POST /conta/entrar -> 200 (sessao ${sessao:0:6}...)"
  aut=(-H "Authorization: Bearer $sessao")

  req GET /conta 200 "" "${aut[@]}"
  [ "$(json_get email)" = "$EMAIL" ] || falha "GET /conta devolveu outro e-mail"
  ok "GET /conta -> 200 (Authorization chegou a API pelo CloudFront)"
  idconta="$(json_get id)"

  if [ "$etapa" = apagar ]; then
    corpo="$(node -e 'process.stdout.write(JSON.stringify({senha:process.argv[1]}))' "$senha")"
    req DELETE /conta 204 "$corpo" "${aut[@]}"
    ok "DELETE /conta -> 204 (id $idconta)"
    req GET /conta 401 "" "${aut[@]}"
    ok "GET /conta depois de apagar -> 401"
    exit 0
  fi
  printf 'ID=%s
' "$idconta" >> "$ESTADO"

  agora="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  corpo="{\"mudancas\":[{\"tipo\":\"fav\",\"chave\":\"fumaca-receita\",\"valor\":{\"nota\":\"fumaca\"},\"ativo\":true,\"em\":\"$agora\"}]}"
  req POST /sync 200 "$corpo" "${aut[@]}"
  ok "POST /sync -> 200"
  req GET /sync 200 "" "${aut[@]}"
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    process.exit(o.itens.some(i=>i.tipo==="fav"&&i.chave==="fumaca-receita"&&i.ativo&&i.valor?.nota==="fumaca")?0:1)' "$CORPO" \
    || falha "GET /sync nao devolveu o item enviado"
  ok "GET /sync -> 200 (item volta)"

  # JPEG minimo (1x1). O S3 so confere tipo e tamanho, nao o conteudo.
  foto="$TMP/foto.jpg"
  # curl nativo do Windows nao entende /tmp dentro de -F "file=@...": usa caminho no formato C:/...
  fotocurl="$foto"; volta="$TMP/volta.jpg"
  if command -v cygpath >/dev/null 2>&1; then fotocurl="$(cygpath -m "$foto")"; fi
  printf '%s' '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=' | base64 -d > "$foto"
  fotoid="f-$(date -u +%Y-%m-%d)-fumaca-$(date -u +%s)000"
  printf 'FOTO=%s
' "$fotoid" >> "$ESTADO"
  req POST "/fotos/$fotoid/envio" 200 "" "${aut[@]}"
  url_envio="$(json_get url)"
  [ -n "$url_envio" ] || falha "envio sem url"
  campos=()
  while IFS=$'\t' read -r k v; do campos+=(--form-string "$k=$v"); done < <(
    node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      for (const [k,v] of Object.entries(o.campos)) console.log(k+"\t"+v);' "$CORPO")
  [ "${#campos[@]}" -gt 0 ] || falha "envio sem campos"
  st="$(curl -sS --max-time 60 -o "$CORPO" -w '%{http_code}' "${campos[@]}" -F "file=@$fotocurl;type=image/jpeg" "$url_envio")"
  [ "$st" = "204" ] || falha "upload ao S3: esperado 204, veio $st"
  ok "upload real ao S3 pelo POST assinado -> 204"

  req GET "/fotos/$fotoid" 200 "" "${aut[@]}"
  url_leitura="$(json_get url)"
  [ -n "$url_leitura" ] || falha "leitura sem url"
  st="$(curl -sS --max-time 60 -o "$volta" -w '%{http_code}' "$url_leitura")"
  [ "$st" = "200" ] || falha "leitura do S3: esperado 200, veio $st"
  cmp -s "$foto" "$volta" || falha "arquivo lido difere do enviado"
  ok "leitura real pela URL assinada -> 200, mesmo arquivo"

  echo
  echo "Tudo verde ate aqui. Parou antes do DELETE /conta (Step 3). Foto: $fotoid"
  ;;
entrar-errado)
  [ $# -ge 4 ] || uso
  corpo="$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],senha:"senha-errada-fumaca"}))' "$EMAIL")"
  for i in $(seq 1 "$4"); do
    st="$(curl -sS --max-time 30 -o "$CORPO" -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary "$corpo" "$URL/conta/entrar")"
    echo "tentativa $i: $st"
  done
  ;;
*) uso ;;
esac
