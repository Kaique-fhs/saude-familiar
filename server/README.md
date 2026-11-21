# Servidor do Saúde Familiar

API Node (Fastify, ESM, sem build) para contas, sincronização de dados e fotos.
Login só com `node:crypto` (scrypt + sessão por token).

## Testes

```
cd server
npm install
npm test
```

Não precisa instalar Postgres: os testes usam PGlite (Postgres em memória) e
armazenamento/e-mail/captcha falsos. A suíte leva cerca de 30 s (o scrypt é lento de propósito).

## Rodar o servidor local

Precisa de um Postgres acessível, um bucket S3 (credenciais pela cadeia padrão da AWS) e SMTP.

```
cp .env.example .env     # preencha os valores
node --env-file=.env src/principal.js     # ou: npm start com as variáveis exportadas
```

Ao iniciar, o servidor aplica as migrações, tenta apagar as fotos de contas já
apagadas que ficaram pendentes e escuta em `0.0.0.0:PORT`.
`AMBIENTE=teste` também libera CORS para `http://localhost:*`.

Toda rota, exceto `GET /saude`, exige o cabeçalho `x-saude-origem` com o valor de
`SEGREDO_ORIGEM` (o CloudFront o injeta); sem ele ou errado → `403 {"erro":"origem"}`.
Rotas com sessão usam `Authorization: Bearer <token>`; sem sessão válida → `401 {"erro":"sessao"}`.
Erros têm sempre o formato `{"erro": "<codigo>"}`.

## Rotas

| Rota | Corpo / consulta | Respostas |
| --- | --- | --- |
| `GET /saude` | - | `200 {ok:true}` |
| `POST /conta/cadastro` | `{email, senha}` (senha 8 a 128); cabeçalho `x-turnstile-token` | `202 {ok:true}` sempre (exista ou não o e-mail); `400 senha` / `400 email`; `403 captcha`; `429 limite` |
| `POST /conta/confirmar` | `{token}` | `200 {ok:true}`; `400 token` |
| `POST /conta/entrar` | `{email, senha}` | `200 {token, usuario:{id,email}}`; `401 credenciais`; `403 nao-confirmado`; `429 limite` |
| `POST /conta/sair` (sessão) | - | `204` |
| `GET /conta` (sessão) | - | `200 {id, email}` |
| `POST /conta/esqueci` | `{email}`; cabeçalho `x-turnstile-token` | `202 {ok:true}` sempre; `403 captcha`; `429 limite` |
| `POST /conta/nova-senha` | `{token, senha}` | `200 {ok:true}` (apaga todas as sessões); `400 senha` / `400 token` |
| `DELETE /conta` (sessão) | `{senha}` | `204` (apaga conta, dados e fotos); `401 credenciais` |
| `POST /sync` (sessão) | `{mudancas:[{tipo, chave, valor, ativo, em}]}` (1 a N itens) | `200 {conflitos:[item]}`; `400 sync` |
| `GET /sync` (sessão) | `?depois=<seq>&limite=<n>` (padrão 0 e 500; máx. 1000) | `200 {itens, cursor, mais}`; `400 sync` |
| `POST /fotos/:fotoId/envio` (sessão) | - | `200 {url, campos}` (POST assinado, até 5 MB, `image/jpeg`, 5 min); `400 foto-id` |
| `GET /fotos/:fotoId` (sessão) | - | `200 {url}` (leitura assinada, 5 min); `400 foto-id` |

`fotoId` tem o formato `f-AAAA-MM-DD-<nome>-<timestamp>`. A foto fica em
`<AMBIENTE>/<user_id>/<fotoId>.jpg` no bucket.

## Variáveis de ambiente

Veja `.env.example`. Obrigatórias: `SEGREDO_ORIGEM` e `ORIGEM_SITE`.
