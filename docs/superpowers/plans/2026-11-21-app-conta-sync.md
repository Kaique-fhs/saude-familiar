# Site: conta e sincronização Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O site passa a ter conta (entrar, criar, confirmar, esqueci, nova senha, sair, apagar) e guarda tudo por usuário no aparelho, enviando e baixando da API do plano 1 (fila persistente, funciona offline), com fotos no S3 e o modo antigo para aparelhos que ainda não entraram.

**Architecture:** Sem build. A lógica nova vai em arquivos `js/sf-*.js` carregados por `<script>` antes do `app.js`, cada um pendurado em `window.SF` e escrito para rodar também no Node (sem tocar no DOM ao carregar), para ser testado com `node --test`. O `app.js` continua dono das telas atuais; ele passa a ler/gravar pelo `SF.local` (chaves com prefixo do usuário) e, a cada `salvarTudo()`, entrega o estado ao `SF.sincronia`, que calcula as mudanças, enfileira e envia. Um servidor de desenvolvimento (`server/src/dev.js`, PGlite + e-mail no console + fotos em disco) permite testar o site de ponta a ponta sem AWS.

**Tech Stack:** HTML/CSS/JS do site atual (ES5 no estilo do `app.js`: `var`, `function`), `fetch`, `localStorage`, IndexedDB, Cloudflare Turnstile (chave de teste), `node --test` (Node 24) para a lógica, `@fastify/multipart` só no servidor de desenvolvimento.

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` (§8.1, §8.4; do §8.5 só o "modo antigo até o primeiro login") · contrato da API: `server/README.md` · ADR-001/002.

## Global Constraints

- Site continua sem build: `index.html`, `app.js`, `data.js`, `styles.css`, `sw.js` e os novos `config.js` e `js/sf-*.js`. Ordem dos scripts no `index.html`: `config.js`, `data.js`, `js/sf-api.js`, `js/sf-local.js`, `js/sf-dados.js`, `js/sf-fotos.js`, `js/sf-sincronia.js`, `js/sf-conta.js`, `app.js`. Todos com `?v=<VERSAO>`; `sw.js` lista todos em `ARQUIVOS`, e cada task que muda o site sobe `VERSAO` e o `?v=` (hoje 28).
- Cada `js/sf-*.js` é um IIFE `(function (raiz) { … raiz.SF = raiz.SF || {}; raiz.SF.<nome> = {…}; })(typeof window !== "undefined" ? window : globalThis);`, sem acessar `document`/`localStorage`/`fetch` no carregamento (tudo entra por parâmetro), e termina com `if (typeof module !== "undefined") module.exports = raiz.SF.<nome>;` para `require()` no Node.
- Testes do site: `tests/*.test.js` na raiz do repositório, rodados com `node --test "tests/*.test.js"` (o Node 24 recusa pasta como argumento; sem `package.json` na raiz). O servidor continua com `cd server && npm test`.
- `config.js` **versionado**: `window.SF_CONFIG = { apiUrl: "", turnstileChave: "", cabecalhoOrigemDev: "" }`. **Com `apiUrl` vazio o app funciona exatamente como hoje** (sem tela de entrar, sem fila, sem sincronizar): é a trava contra ir ao ar cedo se isto chegar à `main` antes do plano 5. O servidor de desenvolvimento intercepta `/config.js` e serve os valores de dev: `{ apiUrl: "http://localhost:3000", turnstileChave: "1x00000000000000000000AA", cabecalhoOrigemDev: "dev" }`. `cabecalhoOrigemDev` só é enviado (como `x-saude-origem`) quando não vazio; em produção fica `""` (o CloudFront injeta o cabeçalho). `1x00000000000000000000AA` é a chave pública de teste do Turnstile que sempre passa.
- Antes de enfileirar, o cliente valida a chave por tipo com a mesma regra do servidor (1–200 caracteres; `feito`, `treino`, `registro` casam `^\d{4}-\d{2}-\d{2}\|[a-z0-9_-]{1,60}$`); chave inválida fica só local (`console.warn`).
- **Mapeamento local → servidor (exato).** `tipo`, `chave`, `valor`:
  - `mp-favs` (array de ids de receita) → `fav`, `<id>`, `null`
  - `mp-sel` (array de ids de receita) → `sel`, `<id>`, `null`
  - `mp-checks` (`{k:true}`, `k` como `"r:<nome>"`) → `check`, `<k>`, `null`
  - `mp-checks-plano` (`{nome:true}`) → `checkplano`, `<nome>`, `null`
  - `mp-quero` (array de nomes) → `quero`, `<nome>`, `null`
  - `mp-diario` (`{dia:[refId]}`) → `feito`, `"<dia>|<refId>"`, `null`
  - `mp-treinos` (`{dia:[exId]}`) → `treino`, `"<dia>|<exId>"`, `null`
  - `mp-registros` (`{dia:{ref:{escolhas,receita,foto,hora}}}`) → `registro`, `"<dia>|<ref>"`, o objeto `{escolhas,receita,foto,hora}`
  - Presente = `ativo:true`; deixou de existir = `ativo:false` com `valor:null`. Chave com mais de 200 caracteres não sincroniza (fica só local; `console.warn`).
  - Ficam **só no aparelho**: `mp-ultimo-backup`, `mp-backups-mes`, `mp-instalar-dispensado`.
- Armazenamento por usuário: chaves `sf:<userId>:<nome>` (os nomes acima mais `fila`, `cursor`, `fotos-pendentes`); sessão em `sf:sessao` = `{token, usuario:{id,email}}`; fotos no IndexedDB `saude-familiar-<userId>` (store `fotos`). As chaves `mp-*` sem prefixo e o IndexedDB `meu-prato` **nunca** são apagados neste plano (a migração é o plano 4).
- Fila: coalescida por `tipo|chave` (fica a mudança mais nova), enviada em lotes de até **200**; `em` = instante ISO do aparelho no momento do `salvarTudo()`.
- Registro com foto só sobe depois que a foto foi confirmada (spec §8.4). Se o arquivo da foto sumiu do aparelho (`sem-foto`), o registro sobe com `foto: null` e fica um aviso local.
- Erro permanente do servidor (`400 sync`, `400 foto-id`) tira o item da fila e o guarda em `sf:<id>:rejeitados` (mostrados na tela Conta); `413` divide o lote ao meio e tenta de novo (lote de 1 com `413` vai para rejeitados).
- O "antes" de cada comparação é o estado **depois** de aplicar o que veio do servidor: aplicar itens remotos atualiza a referência e nunca gera mudança nova. A fila remove só a entrada **exatamente igual** à enviada (mesmo `tipo`, `chave` e `em`); uma mudança nova da mesma chave feita durante o envio permanece.
- Erros da API chegam como `{erro}`; `401 sessao` → apaga `sf:sessao` (não os dados nem a fila) e mostra a tela de entrar; erro de rede → tenta de novo depois (no `online`, ao voltar a aba, e a cada 60 s enquanto houver fila).
- Neste plano o plano alimentar e os exercícios ainda vêm do `data.js` para todo mundo (os planos 3 e 4 trocam isso). **Nada deste plano vai ao ar sozinho**: o lançamento é o plano 5.
- Commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, só com caminhos explícitos. Branch `feat/app-conta-sync` (worktree `../saude-familiar-app`).
- Nota: o CORS do bucket S3 (para o POST assinado vindo do site) é do plano 5.

## Review Focus

1. **Marcar sem internet e fechar o app:** a mudança fica na fila persistida e sobe na próxima abertura com internet — teste na Task 5.
2. **Sessão vencida (401) no meio do envio:** a fila e os dados ficam intactos, o site pede login e, depois de entrar, envia — teste na Task 5.
3. **Dois aparelhos:** ao baixar, um item do servidor mais antigo que uma mudança ainda na fila não desfaz a mudança local; um mais novo substitui e tira a mudança da fila — teste na Task 5.
4. **Registro com foto feito offline:** o registro nunca sobe sem a foto; se a foto falhar, os dois esperam e tentam de novo — teste na Task 5.
5. **Outra pessoa entra no mesmo aparelho:** não vê nada da primeira conta (prefixo) e os dados `mp-*` antigos continuam onde estavam — teste na Task 3.

---

### Task 1: Servidor de desenvolvimento

**Files:**
- Create: `server/src/dev.js`, `server/src/armazenamento-dev.js`
- Modify: `server/package.json` (script `"dev": "node src/dev.js"`, devDependency `@fastify/multipart` fixada), `server/README.md` (seção "Servidor de desenvolvimento"), `server/.gitignore` (`.pg-dev/`, `.fotos-dev/`), `server/src/banco.js` (`criarBancoPglite(pasta?)`), `server/src/app.js` (CORS e opção `rotasLivres`), `server/src/config.js` (`CAMINHO_SITE`), `server/src/contas.js` (links com `caminhoSite`)
- Test: `server/test/dev.test.js`, `server/test/banco.test.js`, `server/test/app.test.js`, `server/test/contas.test.js`

**Interfaces:**
- Consumes: `criarApp`, `criarBancoPglite`, `migrar`, `configTeste` do plano 1.
- Produces:
  - `criarArmazenamentoDev({ pasta, baseUrl }) -> Armazenamento`: `urlEnvio(chave)` → `{ url: baseUrl + "/dev-fotos", campos: { key: chave } }`; `urlLeitura(chave)` → `baseUrl + "/dev-fotos/" + encodeURIComponent(chave)`; `apagarPrefixo` apaga a subpasta (mesma guarda de `/` final).
  - Rotas só do dev: `POST /dev-fotos` (multipart com `key` e `file`, grava em `pasta/<key>`; resposta `204`) e `GET /dev-fotos/*` (devolve o arquivo, `image/jpeg`). Isentas do `x-saude-origem`.
  - `dev.js`: PGlite persistido em `server/.pg-dev`, `AMBIENTE=teste`, `SEGREDO_ORIGEM="dev"`, `ORIGEM_SITE="http://localhost:5500"`, `CAMINHO_SITE="/"`, `limites:false`, e-mail que **imprime o link no console**, captcha que aceita, porta 3000, `logger: true`, e `GET /config.js` que devolve o `window.SF_CONFIG` de dev (regra global).
  - Mudanças mínimas no servidor do plano 1, cada uma com teste: `criarBancoPglite(pasta?)` aceita pasta opcional (sem pasta = em memória, como hoje); com `AMBIENTE=teste` o CORS aceita também o cabeçalho `x-saude-origem` (em produção não); novo config `CAMINHO_SITE` (padrão `/saude-familiar/`) usado nos links `#confirmar=` e `#nova-senha=` de `contas.js`; `criarApp` aceita `rotasLivres` (lista de prefixos isentos da portaria), usada **só** pelo `dev.js` para `/dev-fotos` e `/config.js`.
- [ ] **Step 1: Testes que falham:** `urlEnvio devolve /dev-fotos com campo key`; `POST /dev-fotos grava e GET /dev-fotos/<key> devolve os mesmos bytes`; `apagarPrefixo sem / final lança`; `criarBancoPglite(pasta) mantém os dados ao reabrir`; `em AMBIENTE=teste o preflight aceita x-saude-origem; em producao não`; `CAMINHO_SITE="/" gera link ${origemSite}/#confirmar=`; `sem CAMINHO_SITE o link continua /saude-familiar/`; `rotasLivres isenta só os prefixos dados; sem a opção nada é isento`.
- [ ] **Step 2:** `cd server && npm test` → FAIL.
- [ ] **Step 3: Implementar** (as rotas dev são registradas por `dev.js` depois de criar o app, com `rotasLivres: ["/dev-fotos", "/config.js"]`).
- [ ] **Step 4:** `npm test` → PASS; `node --check src/dev.js`.
- [ ] **Step 5: Commit** — "Servidor de desenvolvimento com PGlite, e-mail no console e fotos em disco".

---

### Task 2: Configuração, cliente da API e base de testes do site

**Files:**
- Create: `config.js`, `js/sf-api.js`, `tests/sf-api.test.js`
- Modify: `index.html` (ordem de scripts da regra global, por enquanto só `config.js` e `js/sf-api.js` antes do `app.js`), `sw.js` (`ARQUIVOS`, `VERSAO`, e requisições de outra origem passam direto, sem cache)

**Interfaces:**
- Produces: `SF.api.criar({ config, fetch, sessao }) -> Api`, onde `sessao()` devolve o token atual ou `null`. Métodos (todos `Promise`): `cadastro(email, senha, turnstile)`, `confirmar(token)`, `entrar(email, senha) -> {token, usuario}`, `sair()`, `conta()`, `esqueci(email, turnstile)`, `novaSenha(token, senha)`, `apagarConta(senha)`, `enviarMudancas(mudancas) -> {conflitos}`, `baixar(depois, limite) -> {itens, cursor, mais}`, `urlEnvioFoto(fotoId) -> {url, campos}`, `urlFoto(fotoId) -> {url}`.
  - Resposta fora de 2xx rejeita com `ErroApi` (`{ status, codigo }`, `codigo` = `corpo.erro` ou `"rede"` quando o `fetch` falha). Envia `content-type: application/json` só quando há corpo, `Authorization: Bearer` quando há token, `x-turnstile-token` em cadastro/esqueci e `x-saude-origem` só se `config.cabecalhoOrigemDev`.
- [ ] **Step 1: Testes que falham** (`fetch` falso que registra chamadas): `entrar manda POST /conta/entrar com corpo JSON e devolve {token, usuario}`; `401 vira ErroApi {status:401, codigo:"sessao"}`; `fetch que lança vira codigo "rede"`; `sem cabecalhoOrigemDev não manda x-saude-origem`; `sair não manda content-type`; `baixar monta ?depois=&limite=`; `config.js versionado tem apiUrl vazio`.
- [ ] **Step 2:** `node --test "tests/*.test.js"` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS; abrir `index.html` pelo servidor estático local e conferir no console que não há erro de carga.
- [ ] **Step 5: Commit** — "Site: configuração e cliente da API".

---

### Task 3: Armazenamento por usuário e mapeamento estado ↔ itens

**Files:**
- Create: `js/sf-local.js`, `js/sf-dados.js`, `tests/sf-local.test.js`, `tests/sf-dados.test.js`
- Modify: `index.html`, `sw.js` (novos arquivos, versão)

**Interfaces:**
- Produces:
  - `SF.local.criar({ storage }) -> Local` (`storage` com `getItem/setItem/removeItem/key/length`): `sessao()`, `gravarSessao(s)`, `apagarSessao()`, `ler(userId, nome, padrao)`, `gravar(userId, nome, valor) -> boolean`, `apagarUsuario(userId)` (remove só `sf:<userId>:*`), `temDadosAntigos() -> boolean` (existe alguma das 8 chaves `mp-*` sincronizáveis com conteúdo).
  - `SF.dados`: `NOMES` (as 8 chaves `mp-*` sincronizáveis e o campo do estado de cada uma: `favs, sel, checks, checksPlano, despensa, diario, treinos, registros`); `estadoVazio()`; `paraItens(estado) -> { "<tipo>|<chave>": {tipo, chave, valor} }`; `diferencas(antes, depois, emISO) -> Mudanca[]` (novos e alterados com `ativo:true`, sumidos com `ativo:false, valor:null`; `valor` comparado por `JSON.stringify`); `aplicar(estado, itens) -> estado` (novo objeto; `ativo:false` remove; mantém a forma de cada campo: arrays sem repetição, objetos de dia sem listas vazias).
- [ ] **Step 1: Testes que falham:** um teste por linha do mapeamento da regra global (ida e volta: `aplicar(estadoVazio(), itensDe(paraItens(e)))` reproduz `e`); `diferencas detecta desmarcar como ativo:false`; `registro alterado gera mudança com o objeto novo`; `chave com 201 caracteres não entra`; `chave de feito/treino/registro fora do formato não entra`; `apagarUsuario("A") não toca em sf:B:* nem em mp-*`; `ler de A não enxerga gravado em B`; `temDadosAntigos falso com mp-ultimo-backup só`.
- [ ] **Step 2:** `node --test "tests/*.test.js"` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS.
- [ ] **Step 5: Commit** — "Site: armazenamento por usuário e mapeamento para a API".

---

### Task 4: Fotos — enviar e baixar

**Files:**
- Create: `js/sf-fotos.js`, `tests/sf-fotos.test.js`
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: `Api.urlEnvioFoto`, `Api.urlFoto` (Task 2).
- Produces: `SF.fotos.criar({ api, fetch, banco }) -> Fotos`, com `banco = { ler(id) -> Promise<Blob|undefined>, gravar(id, blob) -> Promise }` (o `app.js` passa o IndexedDB do usuário):
  - `enviar(fotoId) -> Promise<void>`: lê o blob do banco (sem blob → rejeita `Error("sem-foto")`), pede `urlEnvioFoto`, faz `POST` `multipart/form-data` com todos os `campos` **antes** do campo `file` (exigência do S3), `file` como `image/jpeg`; resposta fora de 2xx rejeita.
  - `garantir(fotoId) -> Promise<Blob|null>`: devolve do banco; se não tem, pede `urlFoto`, baixa, grava no banco e devolve; falha → `null`.
- [ ] **Step 1: Testes que falham** (`fetch`, `api` e `banco` falsos; `FormData`/`Blob` do Node 24): `enviar manda os campos na ordem e file por último`; `enviar sem blob rejeita sem-foto`; `garantir usa o banco sem rede quando já tem`; `garantir baixa, grava e devolve quando não tem`; `garantir devolve null se a rede falha`.
- [ ] **Step 2:** `node --test "tests/*.test.js"` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS.
- [ ] **Step 5: Commit** — "Site: envio e download de fotos pela API".

---

### Task 5: Fila e sincronização

**Files:**
- Create: `js/sf-sincronia.js`, `tests/sf-sincronia.test.js`
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: `Api` (Task 2), `Local` e `SF.dados` (Task 3), `Fotos` (Task 4).
- Produces: `SF.sincronia.criar({ api, local, fotos, userId, agora, aoMudarEstado, aoMudarStatus, aoSessaoVencida }) -> Sincronia`:
  - `registrar(antes, depois)`: calcula `SF.dados.diferencas`, junta na fila (`sf:<id>:fila`, coalescida por `tipo|chave`), e para cada `registro` novo com `valor.foto` acrescenta o id em `sf:<id>:fotos-pendentes`.
  - `sincronizar() -> Promise<void>` (uma por vez; chamada concorrente devolve a mesma promessa): 1) envia cada foto pendente (`fotos.enviar`; sucesso tira da lista; `sem-foto` tira da lista, troca `foto` por `null` na mudança do registro na fila e registra aviso local; `400 foto-id` tira da lista e põe o registro em rejeitados; outro erro mantém); 2) envia a fila em lotes de 200, **pulando** registros cuja foto ainda está pendente; ao aceitar, remove da fila só as entradas exatamente iguais às enviadas (`tipo`, `chave`, `em`); `400 sync` no lote: reenvia item a item para achar o inválido e põe só ele em `sf:<id>:rejeitados`; `413` divide o lote ao meio; `conflitos` são aplicados no estado (via `aoMudarEstado`) e geram status `"conflito"`; 3) baixa com `baixar(cursor, 500)` em laço enquanto `mais`, aplica os itens, **exceto** os que têm na fila uma mudança com `em` maior (esses ficam); item mais novo que a mudança na fila tira a mudança da fila; grava o `cursor`. Aplicar itens remotos atualiza também a referência "antes" usada por `registrar` (nunca gera mudança nova).
  - `rejeitados() -> Array<{tipo, chave, codigo}>`.
  - Erros: `401` → chama `aoSessaoVencida()` e para (fila intacta); `codigo "rede"` → status `"offline"` e para; outros → status `"erro"` e para.
  - `status()` → `"ok"` (fila e fotos vazias), `"enviando"`, `"pendente"` (há fila e o último envio falhou), `"offline"`, `"erro"`, `"conflito"`.
  - `pendentes() -> number` (fila + fotos).
- [ ] **Step 1: Testes que falham** (api, local, fotos falsos; relógio fixo): os 4 primeiros itens do Review Focus, cada um num teste; `coalescência: marcar e desmarcar a mesma receita antes de enviar gera uma mudança só (ativo:false)`; `lote de 450 mudanças vira 200+200+50`; `baixar segue mais:true até o fim e grava o cursor`; `conflito de registro aplica a versão do servidor e status conflito`; `sincronizar chamado duas vezes ao mesmo tempo faz um envio só`; `item remoto aplicado não volta para a fila no próximo registrar`; `mudança da mesma chave feita durante o envio continua na fila depois do lote aceito`; `400 sync isola o item inválido em rejeitados e envia os outros`; `413 divide o lote`; `foto sumida: registro sobe com foto null e aviso`.
- [ ] **Step 2:** `node --test "tests/*.test.js"` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS.
- [ ] **Step 5: Commit** — "Site: fila de envio e sincronização com a conta".

---

### Task 6: Telas de conta

**Files:**
- Create: `js/sf-conta.js`, `tests/sf-conta.test.js`
- Modify: `index.html` (container `#conta` fora do `<main>`), `styles.css` (telas de conta no estilo atual), `sw.js`

**Interfaces:**
- Consumes: `Api` (Task 2), `Local` (Task 3).
- Produces:
  - Funções puras: `SF.conta.modoInicial({ sessao, temDadosAntigos }) -> "conta" | "antigo" | "entrar"`; `SF.conta.lerHash(hash) -> { acao: "confirmar"|"nova-senha"|null, token }`; `SF.conta.mensagemErro(codigo) -> string` em português para `credenciais`, `nao-confirmado`, `captcha`, `limite`, `senha`, `email`, `token`, `rede`, outro.
  - `SF.conta.montar({ raiz, api, local, config, aoEntrar(sessao), aoSair() })`: desenha e controla as telas **Entrar**, **Criar conta**, **Esqueci minha senha**, **Nova senha** (ao abrir com `#nova-senha=`), **Confirmar e-mail** (ao abrir com `#confirmar=`: chama a API, mostra o resultado, limpa o hash e leva para Entrar) e **Conta** (e-mail, "Sair", "Apagar minha conta" pedindo a senha e uma confirmação escrita, e a lista de itens rejeitados pelo servidor, se houver). Cadastro e esqueci carregam o Turnstile (`https://challenges.cloudflare.com/turnstile/v0/api.js`) só quando a tela abre, com `config.turnstileChave`. Depois do cadastro e do esqueci mostra sempre a mesma mensagem ("Se o e-mail puder ser usado, você vai receber um link"), sem revelar se a conta existe.
- [ ] **Step 1: Testes que falham** (só das funções puras): `modoInicial` para as 4 combinações; `lerHash("#confirmar=abc")`, `lerHash("#nova-senha=x")`, `lerHash("#plano")`; `mensagemErro` cobre os códigos listados e tem texto padrão.
- [ ] **Step 2:** `node --test "tests/*.test.js"` → FAIL.
- [ ] **Step 3: Implementar** as funções e as telas.
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS; com `cd server && npm run dev` e o site servido em `http://localhost:5500`: criar conta, copiar o link do console, confirmar, entrar, sair, esqueci + nova senha, apagar conta — tudo funciona e erros aparecem em português.
- [ ] **Step 5: Commit** — "Site: telas de conta".

---

### Task 7: Ligar o app ao armazenamento por usuário e à sincronização

**Files:**
- Modify: `app.js`, `index.html`, `styles.css`, `sw.js`, `README.md`

**Interfaces:**
- Consumes: tudo acima.
- Produces (comportamento):
  - Com `SF_CONFIG.apiUrl` vazio: nada muda em relação a hoje (não monta conta nem sincronia).
  - Ao carregar: `modoInicial`. `"entrar"` → só a tela de conta; enquanto ela está aberta, `render()`, `hashchange` e timers do app não desenham o `<main>`. `"antigo"` → o app como hoje (chaves `mp-*` sem prefixo, IndexedDB `meu-prato`), sem sincronizar, com a faixa "Crie sua conta para guardar seus dados" que abre a tela de criar conta. `"conta"` → o app com `ler/gravar` de `SF.local` no prefixo do usuário, IndexedDB `saude-familiar-<id>`, `SF.sincronia` criada e `sincronizar()` na abertura.
  - Ao entrar a partir do modo antigo: o app passa ao modo conta **com estado vazio** (a cópia dos dados antigos é o plano 4); os `mp-*` continuam intocados.
  - `salvarTudo()` (e o `recarregarEstado()`) passam pelo `SF.local`; depois de gravar, chama `sincronia.registrar(antes, depois)` e agenda `sincronizar()` com 2 s de espera (uma vez só para várias gravações seguidas). Também sincroniza no evento `online`, quando a aba volta a ficar visível e a cada 60 s enquanto `pendentes() > 0`.
  - `aoMudarEstado` atualiza as variáveis do `app.js` e redesenha mantendo a rolagem.
  - Indicador no cabeçalho com o `status()`: "Tudo salvo na conta" / "Salvo no aparelho, enviando…" / "Sem internet, envio pendente" / "Não consegui enviar, vou tentar de novo" / aviso único de conflito ("Esta refeição já foi registrada em outro aparelho").
  - `preencherFotos` usa `fotos.garantir(id)` no modo conta.
  - O listener `storage` (outra janela gravou) filtra pelo prefixo da conta (`sf:<id>:`) no modo conta e por `mp-` só no modo antigo.
  - Botão **"Conta"** no cabeçalho do app (modo conta) abre a tela Conta (sair, apagar conta, rejeitados).
  - `aoSessaoVencida` → mostra Entrar mantendo dados e fila; ao entrar de novo com **o mesmo** usuário, continua de onde parou.
  - Sair: se `pendentes() > 0`, pede confirmação ("Há N itens ainda não enviados…"); depois `api.sair()` (ignora erro de rede), `local.apagarUsuario(id)`, **fecha a conexão aberta** e apaga o IndexedDB do usuário (`deleteDatabase`), e `local.apagarSessao()`.
  - Apagar conta: depois do `204`, mesma limpeza local do sair.
  - `README.md` do site: como rodar com o servidor de desenvolvimento e os testes (`node --test "tests/*.test.js"`).
- [ ] **Step 1: Testes:** a lógica nova já está coberta nas Tasks 2–6; aqui, acrescente em `tests/sf-sincronia.test.js` um teste de integração com `SF.local` sobre um `storage` em memória e `SF.dados` reais: marca favorita + diário + registro com foto, sincroniza com api falsa, "outro aparelho" (outro storage, mesmo usuário) baixa e chega ao mesmo estado.
- [ ] **Step 2: Roteiro manual** (sem RED: o teste de integração exercita módulos já prontos e pode passar direto; registre no relatório se passou de primeira).
- [ ] **Step 3: Implementar** no `app.js` (mudanças só nos pontos de leitura/gravação, `salvarTudo`, `recarregarEstado`, fotos, carga inicial e cabeçalho; sem reescrever telas).
- [ ] **Step 4:** `node --test "tests/*.test.js"` → PASS e `cd server && npm test` → PASS. Roteiro manual com `npm run dev` + site local, registrado no relatório: (a) aparelho com `mp-*` abre no modo antigo com a faixa; (b) criar conta e entrar → app vazio, `mp-*` intactos; (c) marcar refeição, favoritar, registrar com foto; no DevTools ficar offline, marcar mais uma, recarregar, voltar online → tudo sobe; (d) segunda janela anônima com a mesma conta → mesmos dados e a foto aparece; (e) sair com fila vazia limpa `sf:<id>:*`; (f) outra conta no mesmo navegador não vê nada da primeira; (g) com o `config.js` versionado (`apiUrl` vazio) o site abre exatamente como hoje.
- [ ] **Step 5: Commit** — "Site: dados por conta com sincronização e modo antigo".
