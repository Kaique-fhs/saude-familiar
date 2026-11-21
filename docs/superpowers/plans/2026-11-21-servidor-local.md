# Servidor local (API + banco) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API Node.js com Postgres que roda e se testa no computador: login próprio, proteção contra abuso, sincronização local-primeiro, URLs de foto e apagar conta.

**Architecture:** Pasta `server/` no repositório `saude-familiar`, sem build, ESM. `criarApp(deps)` monta um Fastify com dependências injetadas (banco, e-mail, captcha, armazenamento de fotos), para os testes usarem versões falsas. O banco é acessado por uma interface pequena (`Banco`) com duas implementações: `pg` (produção) e PGlite (testes, Postgres embutido, sem instalar nada). Dados do usuário ficam numa tabela única `itens` com RLS por usuário.

**Tech Stack:** Node ≥ 22 (o computador tem 24), Fastify 5, `@fastify/cors`, `@fastify/rate-limit`, `pg`, `@electric-sql/pglite` (só testes), `nodemailer`, `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`, testes com `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` (§8.4, §9) · ADRs `docs/ams/adr/ADR-001…`, `ADR-002…` (login próprio), `ADR-003…` (região).

## Global Constraints

- Tudo dentro de `server/`. O site (`index.html`, `app.js`, `data.js`, `sw.js`) **não muda** neste plano.
- JavaScript puro, ESM (`"type": "module"`), sem TypeScript, sem build. Fixar versões exatas no `package.json` (sem `^`).
- Login só com `node:crypto` (ADR-002): nenhuma biblioteca de autenticação.
- Senha: `scrypt`, sal aleatório de 16 bytes por usuário, N=32768, r=8, p=1, chave de 64 bytes.
- Sessão: token aleatório de 32 bytes (base64url) no cabeçalho `Authorization: Bearer <token>`; banco guarda só `sha256` hex; expira após **60 dias sem uso**; sair apaga a sessão.
- Token de confirmação de e-mail: **24 h**; token de troca de senha: **1 h**; uso único; guardados como hash.
- Comparações de segredo com `timingSafeEqual`. Cadastro e "esqueci minha senha" respondem **sempre `202 {"ok":true}`**, exista ou não o e-mail.
- Trocar a senha apaga **todas** as sessões da conta.
- E-mail normalizado: `trim()` + `toLowerCase()`. Senha: 8 a 128 caracteres.
- Cabeçalho secreto do CloudFront: `x-saude-origem`; sem ele (ou errado) → `403`. Só `GET /saude` dispensa.
- CORS: só a origem `ORIGEM_SITE` (`https://kaique-fhs.github.io`); em `AMBIENTE=teste` também `http://localhost:*` e `http://127.0.0.1:*`. Cabeçalhos aceitos: `authorization`, `content-type`, `x-turnstile-token`.
- Captcha Turnstile no cabeçalho `x-turnstile-token`, conferido em cadastro e "esqueci minha senha" antes de qualquer e-mail.
- Teto diário de e-mails: `TETO_EMAILS_DIA` (padrão **300**).
- Fotos no S3: chave `<AMBIENTE>/<user_id>/<foto_id>.jpg`; envio por POST assinado com limite de **5 MB** e `image/jpeg`; URLs válidas por **5 minutos**.
- Respostas de erro sempre `{"erro": "<código>"}` com os códigos citados nas tasks.
- Mensagens de commit em português, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commits só com caminhos explícitos (`git add server/...`), nunca `git add -A`. Branch `feat/contas-ec2`. `server/package.json` e `server/package-lock.json` podem mudar em qualquer task que instale pacote: inclua no commit da task.
- Versões exatas: `fastify` 5.12.8, `@fastify/cors` 11.4.3, `@fastify/rate-limit` 11.3.0, `pg` 8.23.1, `@electric-sql/pglite` 0.5.17 (dev). Demais pacotes: versão estável atual, fixada.
- Toda data gravada ou comparada no servidor vem de `relogio()` (passada como parâmetro SQL), nunca de `now()` do banco, para os testes controlarem o tempo.
- Erros sempre `{"erro": ...}`: `setErrorHandler` e `setNotFoundHandler` na Task 1 (`400 requisicao`, `404 nao-encontrado`, `500 interno`, mantendo o status de erros com `statusCode` 4xx).
- E-mails são disparados **sem `await`** na rota (erros só vão para o log), para o tempo de resposta não revelar se a conta existe.

## Review Focus

1. **Dois aparelhos, ordem trocada:** uma marcação mais antiga que chega depois não pode desfazer uma mais nova (vale o `em` maior) — teste na Task 6.
2. **Sessão depois de trocar a senha ou apagar a conta:** o token antigo tem de parar de funcionar na hora — testes nas Tasks 4 e 8.
3. **Mesmo e-mail escrito diferente** (`" Rejane@Gmail.com "`): é a mesma conta, não uma segunda — teste na Task 4.
4. **Relógio do celular adiantado:** `em` no futuro distante não pode "travar" um item para sempre; o servidor limita `em` a agora + 5 min — teste na Task 6.
5. **Foto de outra pessoa ou id malicioso** (`../`, id de outro usuário): nunca gera URL fora do prefixo do próprio usuário — teste na Task 7.

---

### Task 1: Esqueleto do servidor, configuração e portaria

**Files:**
- Create: `server/package.json`, `server/.env.example`, `server/.gitignore`, `server/src/config.js`, `server/src/app.js`
- Test: `server/test/app.test.js`, `server/test/ajuda.js`

**Interfaces:**
- Produces:
  - `lerConfig(env: object) -> Config` com `{ porta:number, ambiente:'teste'|'producao', databaseUrl:string, origemSite:string, segredoOrigem:string, turnstileSegredo:string, smtp:{host,porta,usuario,senha,remetente}, tetoEmailsDia:number, s3:{regiao,bucketFotos} }`. Variáveis: `PORT` (3000), `AMBIENTE`, `DATABASE_URL`, `ORIGEM_SITE`, `SEGREDO_ORIGEM`, `TURNSTILE_SECRET`, `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE`, `TETO_EMAILS_DIA` (300), `S3_REGIAO` (`us-east-2`), `S3_BUCKET_FOTOS`. Faltando `SEGREDO_ORIGEM` ou `ORIGEM_SITE` → lança `Error("config: <NOME> ausente")`.
  - `criarApp({ config, banco, email, captcha, armazenamento, relogio?, limites? }) -> Promise<FastifyInstance>`; `relogio` padrão `() => new Date()`; `limites` padrão `true` (a Task 5 usa; antes dela é ignorado).
  - Fastify com **`trustProxy: 1`** (só o CloudFront à frente; nunca `true`, que aceitaria `X-Forwarded-For` forjado).
  - `@fastify/cors` registrado **antes** da portaria, com `methods: ['GET','POST','DELETE']`.
  - Parser JSON que aceita corpo vazio como `{}` (o app chama `POST /conta/sair` sem corpo).
  - `server/test/ajuda.js`: `configTeste(extra?) -> Config` (ambiente `teste`, segredo `segredo-teste`) e `cabecalhos(extra?) -> object` com `x-saude-origem`.
- Scripts no `package.json`: `"test": "node --test test/"`, `"start": "node src/principal.js"`; `"engines": {"node": ">=22"}`.

- [ ] **Step 1: Testes que falham** em `server/test/app.test.js`:
  - `GET /saude sem cabeçalho secreto responde 200 {ok:true}`
  - `rota qualquer sem x-saude-origem responde 403 {erro:"origem"}` e com valor errado também `403`
  - `CORS: Origin https://kaique-fhs.github.io recebe access-control-allow-origin igual`; `Origin https://outro.site não recebe o cabeçalho`; em `teste`, `http://localhost:5500` recebe
  - `lerConfig sem SEGREDO_ORIGEM lança "config: SEGREDO_ORIGEM ausente"`
  - Use `app.inject(...)`; para o 403 use uma rota de teste qualquer (`GET /nao-existe` deve dar 403, não 404, sem o cabeçalho).
  - `GET /nao-existe com o cabeçalho → 404 {erro:"nao-encontrado"}`; `POST com JSON malformado → 400 {erro:"requisicao"}`
  - `preflight OPTIONS de DELETE vindo da origem do site → access-control-allow-methods inclui DELETE`
- [ ] **Step 2:** `cd server && npm install && npm test` → FAIL (módulos não existem).
- [ ] **Step 3: Implementar** `config.js` e `app.js`: Fastify com `trustProxy: true`, `@fastify/cors` com as origens da regra global, hook `onRequest` que confere `x-saude-origem` com `timingSafeEqual` (comprimentos diferentes = recusa) e libera só `GET /saude`. `.gitignore`: `node_modules/`, `.env`, `.pg*/`. `.env.example` com todas as variáveis, sem valores reais.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `git add server/package.json server/package-lock.json server/.env.example server/.gitignore server/src/config.js server/src/app.js server/test/app.test.js server/test/ajuda.js` — "Servidor: esqueleto, configuração e cabeçalho secreto".

---

### Task 2: Banco, migrações e isolamento por usuário

**Files:**
- Create: `server/src/banco.js`, `server/src/migrar.js`, `server/migrations/001_contas.sql`, `server/migrations/002_dados.sql`
- Modify: `server/test/ajuda.js`
- Test: `server/test/banco.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Interface `Banco`: `consulta(sql:string, params?:any[]) -> Promise<{rows:object[]}>`; `transacao(fn:(tx:Banco)=>Promise<T>) -> Promise<T>`; `comoUsuario(userId:string, fn:(tx:Banco)=>Promise<T>) -> Promise<T>` (abre transação, `SET LOCAL ROLE saude_app`, `select set_config('app.user_id', $1, true)`); `fechar() -> Promise<void>`.
  - `criarBancoPg(url:string) -> Banco` (Pool do `pg`) e `criarBancoPglite() -> Promise<Banco>` (em memória).
  - `migrar(banco:Banco, pasta?:string) -> Promise<string[]>` (nomes aplicados; tabela `migracoes(nome text primary key, aplicada_em timestamptz default now())`; cada arquivo numa transação; idempotente).
  - `server/test/ajuda.js`: `novoBancoTeste() -> Promise<Banco>` (PGlite + `migrar`).
  - `seq` (bigint) sai do banco como texto no `pg` e número no PGlite: quem lê converte com `Number(...)`.
- Esquema (exato):
  - `001_contas.sql` (sem extensões: `gen_random_uuid()` é nativo desde o Postgres 13): tabelas `usuarios(id uuid primary key default gen_random_uuid(), email text not null unique, senha_hash text not null, confirmado_em timestamptz, criado_em timestamptz not null default now())`; `sessoes(hash text primary key, user_id uuid not null references usuarios(id) on delete cascade, criada_em timestamptz not null default now(), ultimo_uso timestamptz not null default now())`; `tokens(hash text primary key, user_id uuid not null references usuarios(id) on delete cascade, tipo text not null check (tipo in ('confirmar','senha')), expira_em timestamptz not null, usado_em timestamptz)`.
  - `002_dados.sql`: `create sequence itens_seq`; `itens(user_id uuid not null references usuarios(id) on delete cascade, tipo text not null check (tipo in ('fav','sel','check','checkplano','quero','feito','treino','registro','plano','meta')), chave text not null check (length(chave) between 1 and 200), valor jsonb, ativo boolean not null default true, em timestamptz not null, seq bigint not null default nextval('itens_seq'), primary key (user_id, tipo, chave))`; índice `(user_id, seq)`; `contas_apagadas(user_id uuid primary key, apagada_em timestamptz not null, fotos_apagadas_em timestamptz)` (sem FK, sem dado pessoal); `envios_email(dia date primary key, total int not null)`. Papel `saude_app` (criar só se não existir, `nologin`), `grant saude_app to current_user` (para o `SET ROLE` funcionar também com usuário não-superusuário em produção), `grant select, insert, update, delete on itens to saude_app`, `grant usage, select on sequence itens_seq to saude_app`. `alter table itens enable row level security; alter table itens force row level security;` política `itens_dono` para `saude_app` com `using (user_id = current_setting('app.user_id', true)::uuid) with check (mesma condição)`.

- [ ] **Step 1: Testes que falham** em `banco.test.js`:
  - `migrar aplica 001 e 002 e na segunda vez não aplica nada` (`[]`)
  - `comoUsuario(A) não enxerga itens de B` (insere item de A e de B fora do papel, depois `select * from itens` dentro de `comoUsuario(A)` → só 1 linha, de A)
  - `comoUsuario(A) não consegue inserir item com user_id de B` → rejeita (erro de política)
  - `apagar usuário apaga sessões, tokens e itens (cascade)`
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** `banco.js`, `migrar.js` e os dois `.sql` exatamente como acima.
- [ ] **Step 4:** `npm test` → PASS (Tasks 1 e 2).
- [ ] **Step 5: Commit** dos arquivos listados — "Servidor: banco, migrações e RLS por usuário".

---

### Task 3: Senhas e tokens (funções puras)

**Files:**
- Create: `server/src/seguranca.js`
- Test: `server/test/seguranca.test.js`

**Interfaces:**
- Produces:
  - `hashSenha(senha:string) -> Promise<string>` no formato `scrypt$32768$8$1$<salB64>$<hashB64>` (64 bytes; `maxmem` 64 MiB).
  - `conferirSenha(senha:string, guardado:string) -> Promise<boolean>` (lê os parâmetros do texto guardado; `timingSafeEqual`; formato inválido → `false`, nunca lança).
  - `novoToken() -> { token:string, hash:string }` (32 bytes base64url; `hash = hashToken(token)`).
  - `hashToken(token:string) -> string` (sha256 hex).
  - `HASH_FALSO: string` (um `hashSenha` fixo, calculado na carga do módulo) para gastar o mesmo tempo quando o e-mail não existe.

- [ ] **Step 1: Testes que falham:** `hashSenha gera textos diferentes para a mesma senha` (sal); `conferirSenha aceita a certa e recusa a errada`; `conferirSenha com texto malformado devolve false`; `novoToken: token com 43 caracteres base64url e hash com 64 hex`; `hashToken é determinístico`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** com `node:crypto` (`scrypt` promisificado, `randomBytes`, `createHash`, `timingSafeEqual`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — "Servidor: senha com scrypt e tokens com hash".

---

### Task 4: Contas — cadastro, confirmação, entrar, sair, troca de senha

**Files:**
- Create: `server/src/contas.js`, `server/src/email.js`
- Modify: `server/src/app.js`, `server/test/ajuda.js`
- Test: `server/test/contas.test.js`

**Interfaces:**
- Consumes: `Banco` (Task 2), `hashSenha`, `conferirSenha`, `novoToken`, `hashToken`, `HASH_FALSO` (Task 3).
- Produces:
  - Interface `Email`: `enviar({ para, assunto, texto }) -> Promise<void>`. `criarEmailSmtp(smtp) -> Email` (nodemailer). Em `ajuda.js`: `emailFalso() -> Email & { enviados: object[] }` (registra **na chamada**, de forma síncrona, porque a rota não espera o envio).
  - Em `ajuda.js`: `criarAppTeste(opcoes?) -> Promise<{ app, banco, email, relogio }>` (PGlite, e-mail falso, captcha falso que aceita, armazenamento falso, relógio controlável `relogio.avancar(ms)`), e `contaLogada(app, email, opcoes?) -> Promise<{ token, id, email }>` (cadastra, confirma pelo link do e-mail falso, entra). Os testes das tasks seguintes usam esses dois, sem repetir o fluxo.
  - Hook Fastify `exigirSessao` (exportado de `contas.js`): lê `Authorization: Bearer <token>`, acha a sessão pelo hash; sem sessão, ou `ultimo_uso` há mais de 60 dias → `401 {erro:"sessao"}` (e apaga a vencida). Atualiza `ultimo_uso` se tiver mais de 1 h. Coloca `request.usuario = { id, email }`.
  - `registrarContas(app, deps)` com as rotas:
    - `POST /conta/cadastro {email, senha}` → sempre `202 {ok:true}`. Senha fora de 8–128 → `400 {erro:"senha"}`; e-mail sem `@` → `400 {erro:"email"}`. E-mail novo: cria usuário não confirmado e manda e-mail com link `${origemSite}/saude-familiar/#confirmar=<token>`. E-mail existente não confirmado: **troca a senha guardada pela nova**, invalida os tokens `confirmar` anteriores e manda novo link (evita alguém reservar o e-mail de outra pessoa com a própria senha). Existente confirmado: não manda nada. Sempre calcula um `hashSenha` (mesmo tempo).
    - `POST /conta/confirmar {token}` → `200 {ok:true}` e apaga sessões que existirem; token inválido, vencido ou usado → `400 {erro:"token"}`.
    - `POST /conta/entrar {email, senha}` → `200 {token, usuario:{id,email}}`; errado → `401 {erro:"credenciais"}` (usa `HASH_FALSO` quando o e-mail não existe); senha certa mas não confirmado → `403 {erro:"nao-confirmado"}`.
    - `POST /conta/sair` (sessão) → `204`, apaga só aquela sessão.
    - `GET /conta` (sessão) → `200 {id, email}`.
    - `POST /conta/esqueci {email}` → sempre `202 {ok:true}`; se existe, manda link `${origemSite}/saude-familiar/#nova-senha=<token>` (1 h).
    - `POST /conta/nova-senha {token, senha}` → `200 {ok:true}`, troca a senha, marca o token usado e apaga **todas** as sessões; token ruim → `400 {erro:"token"}`.

- [ ] **Step 1: Testes que falham** (`app.inject`, banco PGlite, e-mail falso, `relogio` controlável):
  - `cadastro responde 202 e envia e-mail com link #confirmar=`
  - `cadastro com e-mail já confirmado responde 202 e não envia e-mail`
  - `" Rejane@Gmail.com " e "rejane@gmail.com" são a mesma conta` (segundo cadastro não cria usuário novo; `select count(*) from usuarios` = 1)
  - `entrar antes de confirmar → 403 nao-confirmado; depois de confirmar → 200 com token`
  - `entrar com senha errada e com e-mail inexistente → 401 credenciais (mesmo corpo)`
  - `confirmar com token usado ou vencido (relógio +25 h) → 400 token`
  - `GET /conta com token → 200; depois de /conta/sair → 401 sessao`
  - `sessão sem uso há 61 dias → 401 sessao`
  - `nova-senha encerra todas as sessões: dois tokens de entrar param de funcionar; entrar com a senha nova funciona`
  - `token de nova-senha vencido (relógio +61 min) → 400 token`
  - `token de nova-senha usado duas vezes → a segunda dá 400 token`
  - `esqueci com e-mail existente envia link #nova-senha=; com inexistente responde 202 igual e não envia`
  - `recadastro de e-mail não confirmado troca a senha: entrar com a senha antiga falha, com a nova (após confirmar o link novo) funciona; o link antigo dá 400 token`
  - `banco guarda só hashes: a coluna hash de sessoes e de tokens nunca é igual ao token devolvido/enviado`
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** `email.js` e `contas.js`; registrar em `criarApp`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — "Servidor: contas com login próprio (cadastro, confirmação, sessão, troca de senha)".

---

### Task 5: Proteção contra abuso — captcha, limites e teto de e-mails

**Files:**
- Create: `server/src/protecao.js`
- Modify: `server/src/app.js`, `server/src/contas.js`, `server/test/ajuda.js`, `server/test/contas.test.js` (passar a mandar `x-turnstile-token` pelo helper e usar `limites:false` onde o teste repete muitas chamadas)
- Test: `server/test/protecao.test.js`

**Interfaces:**
- Consumes: rotas da Task 4, `Email`, `Banco`.
- Produces:
  - Interface `Captcha`: `verificar(token:string, ip:string) -> Promise<boolean>`. `criarCaptchaTurnstile(segredo) -> Captcha` (POST `https://challenges.cloudflare.com/turnstile/v0/siteverify` com `secret`, `response`, `remoteip`; usa `success`). Em `ajuda.js`: `captchaFalso(aceita=true)`.
  - `comTetoDiario(email:Email, banco:Banco, teto:number, relogio) -> Email`: antes de enviar, `insert … on conflict (dia) do update set total = envios_email.total + 1 returning total`; acima do teto não envia e lança `Error("teto-email")`.
  - Limites (`@fastify/rate-limit`, em memória), cada rota com limite **por IP** e **por e-mail normalizado**: `/conta/cadastro` 5 por hora; `/conta/entrar` 10 por 15 min; `/conta/esqueci` 3 por hora; demais rotas 300 por minuto por IP. O limite por e-mail roda em `preHandler` (o corpo só existe depois do parse), com `keyGenerator` pelo e-mail e `groupId` próprio. Estourou → `429 {erro:"limite"}` (via `errorResponseBuilder`). `criarApp({limites:false})` desliga tudo (usado só onde o teste não é sobre limites).
  - Captcha em `/conta/cadastro` e `/conta/esqueci`: sem `x-turnstile-token` ou recusado → `400 {erro:"captcha"}`, antes de tocar no banco ou mandar e-mail.
  - Teto estourado no cadastro/esqueci: a rota continua respondendo `202` (não revela nada) e registra o erro no log.

- [ ] **Step 1: Testes que falham:** `cadastro sem x-turnstile-token → 400 captcha e nenhum e-mail`; `captcha recusado → 400 captcha`; `6º cadastro do mesmo IP na hora → 429 limite`; `11ª tentativa de entrar com o mesmo e-mail de IPs diferentes → 429`; `4º esqueci do mesmo e-mail de IPs diferentes → 429`; `X-Forwarded-For forjado pelo cliente não escapa do limite (com trustProxy 1, IP = último da lista)`; `com teto 2, o 3º e-mail não é enviado e a rota responde 202`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** e registrar em `criarApp` (captcha e e-mail com teto entram pelas `deps`).
- [ ] **Step 4:** `npm test` → PASS (todas as anteriores também).
- [ ] **Step 5: Commit** — "Servidor: captcha Turnstile, limites de tentativas e teto diário de e-mails".

---

### Task 6: Sincronização local-primeiro

**Files:**
- Create: `server/src/sincronia.js`
- Modify: `server/src/app.js`
- Test: `server/test/sincronia.test.js`

**Interfaces:**
- Consumes: `exigirSessao` (Task 4), `Banco.comoUsuario` (Task 2).
- Produces:
  - Tipo `Mudanca`: `{ tipo:string, chave:string, valor:any|null, ativo:boolean, em:string(ISO) }`. Tipo `Item`: `Mudanca & { seq:number }`.
  - `decidir(atual: Item|null, mudanca: Mudanca) -> 'aplicar'|'ignorar'|'conflito'` (pura):
    - sem `atual` → `aplicar`;
    - `tipo === 'registro'` e `atual.ativo` e `atual.valor?.foto` → `conflito` se o `valor` for diferente, `ignorar` se igual (registro com foto nunca muda);
    - nos demais casos: `aplicar` se `mudanca.em > atual.em`, senão `ignorar` (empate = `ignorar`).
  - `POST /sync` (sessão) corpo `{ mudancas: Mudanca[] }` (1 a 500) → `200 { conflitos: Item[] }` (para cada conflito, devolve o item do servidor). Validação → `400 {erro:"sync"}`: `tipo` fora da lista da Task 2, `chave` vazia ou > 200, `valor` serializado > 64 KB, `em` inválido; para `feito`, `treino` e `registro` a chave tem de casar `^\d{4}-\d{2}-\d{2}\|[a-z0-9_-]{1,60}$`. `em` acima de `agora + 5 min` é gravado como `agora + 5 min`. Ao aplicar, `seq = nextval('itens_seq')`. Tudo numa transação `comoUsuario` que começa com `select pg_advisory_xact_lock(hashtext($userId))` (o mesmo vale para o `GET /sync`), para dois envios do mesmo usuário não correrem e o cursor nunca pular item. "Plano e metas: vale a versão gravada por último" (spec) = maior `em`, a mesma regra dos outros tipos.
  - `GET /sync?depois=<seq>&limite=<n>` (sessão; `depois` padrão 0, `limite` padrão 500, máx 1000) → `200 { itens: Item[], cursor: number, mais: boolean }`, ordenado por `seq`; `cursor` = maior `seq` devolvido (ou `depois` se vazio).

- [ ] **Step 1: Testes que falham:**
  - `decidir`: sem atual → aplicar; mais nova → aplicar; mais velha → ignorar; empate → ignorar; registro com foto e valor diferente → conflito; registro sem foto e mais novo → aplicar.
  - `marcação velha chegando depois não desfaz a nova` (aparelho A desmarca às 10:00, aparelho B marca às 09:00 e envia depois → item final `ativo:false`)
  - `marcações de aparelhos diferentes em chaves diferentes se somam`
  - `registro com foto: segundo envio com outra foto → conflitos traz a versão do servidor`
  - `em no futuro distante é limitado a agora+5min`
  - `GET /sync pagina: 3 itens, limite 2 → mais:true; com o cursor → o 3º e mais:false`
  - `usuário A não recebe itens de B no GET /sync`
  - `chave de feito sem formato de data → 400 sync`
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** `sincronia.js` e registrar as rotas.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — "Servidor: sincronização com regra de conflito por item".

---

### Task 7: Fotos — URLs assinadas de envio e leitura

**Files:**
- Create: `server/src/fotos.js`, `server/src/armazenamento.js`
- Modify: `server/src/app.js`, `server/test/ajuda.js`
- Test: `server/test/fotos.test.js`

**Interfaces:**
- Consumes: `exigirSessao`.
- Produces:
  - Interface `Armazenamento`: `urlEnvio(chave:string) -> Promise<{url:string, campos:object}>` (POST assinado, `content-length-range` 1..5 MB, `Content-Type` `image/jpeg`, 5 min); `urlLeitura(chave:string) -> Promise<string>` (GET assinado, 5 min); `apagarPrefixo(prefixo:string) -> Promise<void>` (apaga todos os objetos **e versões** sob o prefixo).
  - `criarArmazenamentoS3({ regiao, bucket, cliente? }) -> Armazenamento` (credenciais pela cadeia padrão do SDK: papel da EC2 em produção; `cliente` opcional = `S3Client` injetado nos testes). `apagarPrefixo` pagina `ListObjectVersions` (`IsTruncated`, `NextKeyMarker`, `NextVersionIdMarker`), apaga versões **e** delete markers em lotes de até 1000 com `DeleteObjects`, e lança erro se a resposta trouxer `Errors`. Em `ajuda.js`: `armazenamentoFalso()` que registra chamadas e devolve `https://falso/<chave>`.
  - `chaveFoto(ambiente, userId, fotoId) -> string` exportada; `fotoId` tem de casar `^f-\d{4}-\d{2}-\d{2}-[a-z0-9_-]{1,60}-\d{10,16}$` (formato atual do app: `"f-" + dia + "-" + ref + "-" + Date.now()`), senão lança `Error("foto-id")`.
  - `POST /fotos/:fotoId/envio` (sessão) → `200 {url, campos}`; `GET /fotos/:fotoId` (sessão) → `200 {url}`; id inválido → `400 {erro:"foto-id"}`. A chave usa sempre o `id` da sessão, nunca um valor vindo do cliente.

- [ ] **Step 1: Testes que falham:** `apagarPrefixo com cliente falso: duas páginas, versões e delete markers → tudo enviado para DeleteObjects; resposta com Errors → lança`; `envio gera chave teste/<meuId>/<fotoId>.jpg`; `fotoId com ../ → 400 foto-id`; `fotoId fora do formato → 400`; `leitura usa o id da sessão: A pedindo a foto de B gera chave com o id de A` (nunca de B); `sem sessão → 401`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** (`@aws-sdk/s3-presigned-post` para o envio, `@aws-sdk/s3-request-presigner` para a leitura, `ListObjectVersions` + `DeleteObjects` para apagar).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** — "Servidor: URLs assinadas de fotos no S3".

---

### Task 8: Apagar conta e servidor de verdade

**Files:**
- Create: `server/src/principal.js`, `server/README.md`
- Modify: `server/src/contas.js`, `server/src/app.js`
- Test: `server/test/apagar-conta.test.js`

**Interfaces:**
- Consumes: tudo acima.
- Produces:
  - `DELETE /conta` (sessão) corpo `{senha}` → `204`; senha errada → `401 {erro:"credenciais"}`. Ordem: confere senha → numa transação: `insert into contas_apagadas(user_id, apagada_em)` e `delete from usuarios where id = $1` (sessões, tokens e itens caem por cascade) → `apagarFotosPendentes()`. Responde `204` mesmo se as fotos falharem (a conta já sumiu; as fotos ficam pendentes e são tentadas de novo).
  - `apagarFotosPendentes({ banco, armazenamento, ambiente, relogio }) -> Promise<number>`: para cada linha de `contas_apagadas` com `fotos_apagadas_em is null`, chama `apagarPrefixo("<ambiente>/<user_id>/")` e grava `fotos_apagadas_em`; falha de uma não impede as outras; devolve quantas concluiu. Roda também ao iniciar o servidor (`principal.js`).
  - `principal.js`: `lerConfig(process.env)` → `criarBancoPg` → `migrar` → `criarApp` com `criarEmailSmtp` + `comTetoDiario`, `criarCaptchaTurnstile`, `criarArmazenamentoS3` → `listen({ host: '0.0.0.0', port })`.
  - `server/README.md`: como rodar os testes (`npm test`, sem instalar Postgres) e o servidor local com um `.env` (copiar de `.env.example`), lista das rotas com corpo e respostas.

- [ ] **Step 1: Testes que falham:** `apagar conta com senha errada → 401 e nada muda`; `apagar conta → 204, usuário sumiu, itens sumiram, contas_apagadas tem o id com fotos_apagadas_em preenchido, apagarPrefixo chamado com "teste/<id>/"`; `token da conta apagada → 401 sessao`; `falha ao apagar fotos → 204, usuário sumiu e fotos_apagadas_em fica nulo; apagarFotosPendentes depois conclui`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implementar** a rota, `principal.js` e o README.
- [ ] **Step 4:** `npm test` → PASS (suíte inteira) e `node --check src/principal.js` sem erro.
- [ ] **Step 5: Commit** — "Servidor: apagar conta (LGPD) e ponto de entrada".
