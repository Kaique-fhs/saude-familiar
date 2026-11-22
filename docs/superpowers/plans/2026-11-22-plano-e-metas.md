# Plano e metas por pessoa (plano 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada conta cadastra o próprio plano alimentar (com versões "vale desde") e as próprias metas de exercício, sincronizados com a conta, e o app calcula dia cumprido, sequência, progresso semanal e calendário a partir deles.

**Architecture:** Plano e metas viram itens `plano` e `meta` do `/sync` (o servidor já aceita os tipos). Um módulo puro novo, `js/sf-plano.js`, guarda o modelo e todos os cálculos; outro, `js/sf-editor.js`, monta o HTML dos formulários e converte os campos em plano/meta. O `app.js` deixa de ler `window.PLANO` direto: no modo antigo usa `SF.plano.deDataJs(window.PLANO)`, com conta usa o estado sincronizado. A trava 1 do ADR-005 sai.

**Tech Stack:** JavaScript sem build (IIFE com `module.exports` para o Node), `node:test` no site (`node --test "tests/*.test.js"`), Node 24 + Fastify + PGlite/Postgres no servidor (`cd server && npm test`).

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` (§8.2, §8.3, §8.4 "Plano e metas: vale a versão gravada por último"). ADRs: `docs/ams/adr/ADR-001-*`, `ADR-005-*` (a trava 1 é temporária "até o plano 3"). Mapa do código: os números de linha abaixo valem em `0c18f0d`/`f7e68f2`.

## Global Constraints

- Site estático, sem build, sem dependência nova; módulos novos seguem o padrão de `js/sf-dados.js` (IIFE, `raiz.SF.<nome>`, `module.exports`).
- "Dias passados não mudam ao editar o plano": editar cria versão que vale a partir de hoje; o dia passado usa a versão que valia nele.
- Ids de refeição e de meta são estáveis, nunca reaproveitados, e casam `^[a-z0-9_-]{1,60}$` (vão dentro das chaves `dia|id` de `feito`, `treino` e `registro`).
- Editar uma meta encerra a antiga (`ate` = ontem) e cria outra (`desde` = hoje).
- Dia cumprido = todas as refeições do plano vigente no dia + todas as metas de dias fixos do dia; metas de vezes por semana não entram no dia; dia sem nada programado não conta na sequência (nem quebra, nem soma). Semana de segunda a domingo.
- "Atrasada" só existe para refeição com horário. Quadro de nutrientes só aparece se preenchido.
- Modo antigo (sem conta) continua igual para quem o usa: plano e exercícios do `data.js`, sem formulário.
- O valor de um item tem no máximo 64 KB (`server/src/sincronia.js:7`).
- Versão de cache: `index.html` `?v=36` e `sw.js` `meu-prato-v36` sobem juntos para `37` na task que acrescenta script.
- Texto da interface em português do Brasil, no tom atual.

## Formatos (decididos aqui, valem para os planos 3 e 4)

Item `plano`: chave `"inicio"` (versão sem data de início, usada na migração) ou `"AAAA-MM-DD"` (vale desde esse dia). Valor:

```
{ refeicoes: [ { id, nome, hora: "HH:MM"|null, kcal: number|null,
                 itens: [ { principal: string, opcoes: [string] } ],
                 observacoes: [string], receitas: [idReceita] } ],
  nutrientes: { linhas: [[nome, prot, lip, carb, kcal]], total: { proteinas, lipidios, carboidratos, kcal, fibras } } | null,
  compras: [string], prescritoEm: "dd/mm/aaaa"|null }
```

Plano com `refeicoes: []` = "sem plano a partir deste dia".

Item `meta`: chave = `id`. Valor:

```
{ id, nome, modo: "dias"|"semana", dias: [0..6] (só modo dias, 0 = domingo), vezes: 1..7 (só modo semana),
  minutos: number|null, desde: "AAAA-MM-DD", ate: "AAAA-MM-DD"|null }
```

Estado do app ganha `planos` (`{chave: plano}`) e `metas` (`{id: meta}`), guardados na conta como `mp-planos` e `mp-metas`. Ids novos: `SF.plano.novoId("r"|"m", agoraMs)` = prefixo + `"-"` + `agoraMs.toString(36)`.

## Review Focus

1. Plano editado hoje e dia de ontem reaberto no calendário: ontem continua com o total e as refeições da versão antiga.
2. Dois aparelhos editam o plano no mesmo dia: fica a versão gravada por último, sem misturar refeições.
3. Conta sem plano e sem metas: Plano, Frequência e Compras abrem sem erro, com o convite "Cadastrar meu plano"; receitas e lista das receitas funcionam.
4. Formulário com refeição sem nome, horário inválido ou kcal negativa: mostra o erro no campo e não grava nada.
5. Aparelho que já sincronizou antes desta versão: depois de atualizar, recebe plano e metas já gravados por outro aparelho (cursor zerado uma vez).

---

### Task 1: Servidor valida chave e valor de `plano` e `meta`

**Files:**
- Modify: `server/src/sincronia.js:22-32` (`validarMudanca`)
- Test: `server/test/sincronia.test.js`

**Interfaces:**
- Produces: `/sync` recusa (400 `sync`) `plano` com chave fora de `^(inicio|\d{4}-\d{2}-\d{2})$`, `meta` com chave fora de `^[a-z0-9_-]{1,60}$`, e `plano`/`meta` ativos cujo valor não seja objeto.

- [ ] **Step 1: Write the failing test** `'plano e meta: chave e valor validados'` em `server/test/sincronia.test.js`, no estilo dos testes de 400 que já existem: lote com `{tipo:'plano', chave:'2026-11-22', valor:{refeicoes:[]}, ativo:true}` → 200; `{tipo:'plano', chave:'ontem', ...}` → 400 `{erro:'sync'}`; `{tipo:'meta', chave:'m-abc', valor:{id:'m-abc'}, ativo:true}` → 200; `{tipo:'meta', chave:'M A', ...}` → 400; `{tipo:'plano', chave:'inicio', valor:'texto', ativo:true}` → 400; `{tipo:'meta', chave:'m-x', valor:null, ativo:false}` → 200.
- [ ] **Step 2: Run** `cd server && node --test test/sincronia.test.js` — Expected: FAIL nos casos de 400.
- [ ] **Step 3: Implement** em `validarMudanca`: constantes `CHAVE_PLANO = /^(inicio|\d{4}-\d{2}-\d{2})$/` e `CHAVE_META = /^[a-z0-9_-]{1,60}$/`; se `ativo` e tipo `plano`/`meta`, exigir valor objeto não-array.
- [ ] **Step 4: Run** `cd server && npm test` — Expected: tudo verde (124 ok, 6 skip, mais os novos).
- [ ] **Step 5: Commit** `git add server/src/sincronia.js server/test/sincronia.test.js && git commit -m "API: valida chave e valor de plano e meta no /sync"`

### Task 2: Cliente sincroniza `planos` e `metas`; corrige `naoGravado`; zera o cursor uma vez

**Files:**
- Modify: `js/sf-dados.js` (NOMES, `estadoVazio`, `chaveValida`, `paraItens`, `copiar`, `aplicar`)
- Modify: `js/sf-local.js:3` (`SINCRONIZAVEIS` ganha `"mp-planos"`, `"mp-metas"`)
- Modify: `js/sf-sincronia.js:9` (`TIPOS`), `:125-148` (`registrar`), `:232-253` (`aplicarRemotos`), `:255-267` (`baixarTudo`)
- Modify: `js/sf-conta.js:86-90` (`TIPOS` de `rotuloRejeitado`: `plano: "Plano alimentar"`, `meta: "Meta de exercício"`)
- Test: `tests/sf-dados.test.js`, `tests/sf-sincronia.test.js`, `tests/sf-conta.test.js`

**Interfaces:**
- Produces: `SF.dados.NOMES["mp-planos"] === "planos"`, `NOMES["mp-metas"] === "metas"`; `estadoVazio()` com `planos: {}`, `metas: {}`; `paraItens` gera `plano|<chave>` (valor = plano) e `meta|<id>` (valor = meta); `aplicar` grava/apaga em `planos`/`metas`; `copiar` copia `planos`/`metas` em profundidade (JSON). `chaveValida("plano", k)` e `chaveValida("meta", k)` com as mesmas regex da Task 1.
- Produces: `SF.sincronia` aceita `plano`/`meta` remotos (ignora ativo sem valor objeto, como faz com `registro`); constante `VERSAO_CURSOR = 2` guardada em `sf:<id>:cursor-versao`.

- [ ] **Step 1: Write the failing tests**
  - `tests/sf-dados.test.js`: `'plano e meta: ida e volta'` — estado com `planos: {"2026-11-22": P}` e `metas: {"m-1": M}` → `paraItens` tem `plano|2026-11-22` e `meta|m-1` com os valores; `aplicar(estadoVazio(), itens ativos)` devolve os mesmos objetos; item inativo apaga; `diferencas` de um plano com refeição renomeada gera 1 mudança `plano` ativa. `'plano e meta: chave inválida não sincroniza'` (`plano|ontem`, `meta|"M A"`). `'copiar não divide objetos de plano'` (mudar o original não muda a cópia).
  - `tests/sf-sincronia.test.js`: `'desfazer a mudança que não coube desliga o erro'` (com `localQueFalha`: registrar falha → `status()==="erro"`; desfazer e registrar de novo com o estado igual ao `ref` → `status()==="ok"`, `pendentes()===0`). `'remoto que cobre a pendência não gravada desliga o erro'`. `'aparelho com cursor antigo baixa desde o zero uma vez'` (local com `cursor: 900` e sem `cursor-versao` → primeira chamada a `api.baixar` recebe `0`; depois `cursor-versao === 2`; segunda sincronização usa o cursor novo). `'plano e meta remotos aplicados'`.
  - `tests/sf-conta.test.js`: `rotuloRejeitado({tipo:"plano", chave:"2026-11-22"})` === `"Plano alimentar: 2026-11-22"`.
- [ ] **Step 2: Run** `node --test "tests/*.test.js"` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement.** `naoGravado`: na saída cedo de `registrar` (sem mudanças) zerar `naoGravado` (e `ultimoProblema` se for `"erro"`); em `aplicarRemotos`, depois de recalcular `ref`, se `dados.diferencas(ref, deps.estado(), iso()).length === 0` zerar do mesmo jeito. Cursor: em `baixarTudo`, se `local.ler(userId, "cursor-versao", 0) < VERSAO_CURSOR`, começar em `0` e gravar `cursor-versao` depois da primeira página aplicada.
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: tudo verde.
- [ ] **Step 5: Commit** os cinco arquivos de `js/` e os três de `tests/`: `"Sync: plano e metas no cliente, cursor zerado uma vez e naoGravado corrigido"`.

### Task 3: `js/sf-plano.js` — modelo, versões e metas

**Files:**
- Create: `js/sf-plano.js`
- Test: `tests/sf-plano.test.js`

**Interfaces:**
- Produces (`SF.plano`, puro, datas como `"AAAA-MM-DD"`):
  - `novoId(prefixo, agoraMs) -> string`
  - `deDataJs(PLANO) -> {planos: {inicio: plano}, metas: {[id]: meta}}` — refeições copiadas com `id`, `nome`, `hora`, `kcal`, `itens`, `observacoes`, `receitas || []`; `nutrientes`, `compras`, `prescritoEm`; cada `PLANO.exercicios[i]` vira meta `{id, nome, modo:"dias", dias, vezes:null, minutos:null, desde, ate: ate||null}`.
  - `planoNoDia(planos, dia) -> plano|null` — versão de maior chave `<= dia` (`"inicio"` vale antes de qualquer data); `null` se não houver ou se `refeicoes` estiver vazio.
  - `idsDeRefeicao(planos) -> string[]` — união de todas as versões.
  - `salvarPlano(planos, plano, hoje) -> planos` — novo objeto com `planos[hoje] = plano`.
  - `metasNoDia(metas, dia) -> meta[]` (`desde <= dia` e (`ate` nulo ou `dia <= ate`)), `metasFixasDoDia(metas, dia)` (modo `dias` com o dia da semana), `idsDeMeta(metas) -> string[]`.
  - `salvarMeta(metas, meta, hoje, agoraMs) -> metas` — sem `id`: cria com `novoId("m", agoraMs)` e `desde = hoje`; com `id` e `desde === hoje`: sobrescreve; com `id` e `desde < hoje`: antiga recebe `ate = ontem` e entra uma nova com id novo e `desde = hoje`.
  - `encerrarMeta(metas, id, hoje) -> metas` — `desde === hoje`: remove; senão `ate = ontem`.

- [ ] **Step 1: Write the failing tests** em `tests/sf-plano.test.js` (`require("../js/sf-plano.js")` e `require("../data.js")` via `vm` ou lendo `window.PLANO` com um `globalThis.window = {}` antes do require):
  - `'deDataJs mantém ids e passado'`: ids `["acordar","cafe","almoco","lanche","jantar"]` na chave `inicio`; metas `pilates` e `academia` com `desde "2026-11-01"`, `modo "dias"`, `dias` iguais aos do `data.js`.
  - `'planoNoDia usa a versão que valia no dia'`: `{inicio: A, "2026-11-22": B}` → `"2026-11-21"` dá A, `"2026-11-22"` e `"2026-12-01"` dão B; `{"2026-11-22": B}` → `"2026-11-21"` dá `null`; versão com `refeicoes: []` dá `null`.
  - `'salvarPlano não toca nas versões antigas'` e `'salvarPlano no mesmo dia sobrescreve'`.
  - `'salvarMeta: editar meta antiga encerra ontem e cria outra hoje'` (ids diferentes, `ate` e `desde` exatos), `'salvarMeta no mesmo dia sobrescreve'`, `'encerrarMeta'` (dois casos), `'metasFixasDoDia ignora modo semana e respeita desde/ate'`.
  - `'novoId casa o formato de chave'`: `/^[a-z0-9_-]{1,60}$/`.
- [ ] **Step 2: Run** `node --test tests/sf-plano.test.js` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `js/sf-plano.js` com essas funções, sem tocar em DOM nem armazenamento; nenhuma função muda o objeto recebido.
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: tudo verde.
- [ ] **Step 5: Commit** `js/sf-plano.js tests/sf-plano.test.js`: `"Plano: modelo de versões e metas"`.

### Task 4: `js/sf-plano.js` — dia cumprido, sequência, semana e refeição atual

**Files:**
- Modify: `js/sf-plano.js`
- Test: `tests/sf-plano.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces (`ctx = {planos, metas, diario, treinos}`):
  - `totalDoDia(ctx, dia) -> number`, `feitosDoDia(ctx, dia) -> number`, `diaCompleto(ctx, dia) -> boolean` (total > 0 e feitos === total; só contam ids do plano vigente e das metas fixas do dia).
  - `sequencia(ctx, hoje) -> number` — conta para trás a partir de hoje (ou de ontem se hoje ainda não está completo), pulando dias com total 0, parando no primeiro dia com total > 0 incompleto; olha no máximo 400 dias.
  - `progressoSemanal(ctx, dia) -> [{meta, feitos, vezes, cumprida}]` — metas modo `semana` ativas em algum dia da semana (segunda a domingo) de `dia`; `feitos` = dias da semana com treino daquela meta.
  - `semanaCumprida(ctx, dia) -> boolean|null` — `null` sem meta semanal na semana; senão todas `cumprida`.
  - `situacoes(plano, feitosHoje, horaAtual) -> {[idRef]: "feita"|"agora"|"atrasada"|"proxima"|"depois"|"pendente"}` e `refeicaoAtual(plano, feitosHoje, horaAtual) -> id|null`.

Algoritmo de `situacoes` (a spec não fixa os detalhes; este é o contrato):
1. Feita: id em `feitosHoje`.
2. Atual: entre as refeições com `hora <= horaAtual` e não feitas, a de maior `hora`; se não houver, a primeira não feita na ordem do plano entre as que não têm hora ou têm `hora > horaAtual`.
3. Com hora, não feita, `hora <= horaAtual` e não é a atual: `"atrasada"`.
4. Sem hora, não feita e antes da atual na ordem: `"pendente"`.
5. Depois da atual: a primeira não feita é `"proxima"`, as demais `"depois"`.

- [ ] **Step 1: Write the failing tests** (`plano` da Rejane via `deDataJs`): `'dia cumprido com plano e metas fixas'` (2026-11-24, terça: 5 refeições + pilates + academia = 7); `'sem plano conta só metas fixas'`; `'dia sem nada programado não quebra nem soma a sequência'` (sem plano; uma meta `dias: [1, 3]` desde 2026-11-01; treinos em 2026-11-23 e 2026-11-25; `sequencia(ctx, "2026-11-26")` === 2, porque a terça 24 e a quinta 26 não têm nada programado); `'editar o plano hoje não muda ontem'` (ontem completo com a versão antiga continua completo depois de `salvarPlano` com uma refeição a mais); `'progresso semanal de segunda a domingo'` (meta `vezes: 3`, treinos seg, qua → `feitos 2, cumprida false`; mais sex → `true`; treino do domingo anterior não conta); `'semanaCumprida null sem meta semanal'`; `situacoes` às 09:00, 13:00 (café sem hora vira `"pendente"`, almoço `"agora"`), 17:00 (almoço não feito `"atrasada"`, lanche `"agora"`, jantar `"proxima"`) e com tudo feito.
- [ ] **Step 2: Run** `node --test tests/sf-plano.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** em `js/sf-plano.js`.
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"Plano: dia cumprido, sequência, semana e refeição atual"`.

### Task 5: `app.js` passa a usar o modelo; trava 1 sai

**Files:**
- Modify: `app.js` (linhas citadas abaixo), `index.html:60-68`, `sw.js:4-18`, `tests/publicacao.test.js` se ele listar os scripts
- Test: `node --check app.js`, `node --test "tests/*.test.js"`

**Interfaces:**
- Consumes: Tasks 2-4. Estado novo `planos`/`metas` lido e gravado como as outras chaves (`ler("mp-planos", {})`, `gravarDados` grava as duas só com conta; no modo antigo não grava).
- Produces: função `modeloAtual() -> {planos, metas}` em `app.js` (modo antigo: `SF.plano.deDataJs(window.PLANO)` uma vez; conta: estado) e `ctxDia() -> {planos, metas, diario, treinos}`, usadas pelas Tasks 6 e 7.

Troca, sem mudar o visual do que já existe:
- `app.js:38-39`: remover a troca de `PLANO` por plano vazio (trava 1). `app.js:4` deixa de ser a fonte: as telas leem `SF.plano.planoNoDia(modeloAtual().planos, dia)`.
- `refeicaoAtual`/`NOMES_CURTOS`/`TOTAL_REF` (392-405), `exerciciosDoDia`…`sequencia` (415-439), `situacoesHoje`/`rotuloHora` (963-982): passam a chamar `SF.plano` (`TOTAL_REF` some; `NOMES_CURTOS`, que não é usado, sai).
- `blocoDia`, `blocoExercicios`, `blocoAgenda` (460-513): plano do dia e metas do dia; a agenda lista metas ativas hoje (dias fixos pelos dias; semanais como "N vezes por semana", com minutos quando houver).
- `abrirRegistro`/`salvarRegistro`/`exPorId`/`refPorId`/`marcadosDe` (692-861): procuram a refeição no plano do dia aberto e a meta em `metasNoDia`.
- `textoResultadoDia` (631-651): plano do dia; a linha fixa do "acordar" (640) vale para qualquer refeição sem itens.
- `blocoCalendario`/`contagemDia` (902-960): legenda "N de N refeições" com o total do dia; na visão `exercicio`, cada semana com metas semanais mostra "semana cumprida" quando `semanaCumprida` for `true`, e o resumo inclui o `progressoSemanal` da semana atual ("2 de 3 nesta semana").
- `semPlano` (986-990): sem plano hoje, Plano mostra "Você ainda não cadastrou seu plano alimentar." + botão "Cadastrar meu plano" (`href="#plano/editar"`, só com conta; no modo antigo não aparece). Frequência sem plano funciona com as metas (não devolve `semPlano`).
- `telaPlano`/`telaRefeicao` (992-1072): plano de hoje; nutrientes e `prescritoEm` só se existirem; botões "Editar plano" (`#plano/editar`) e "Metas de exercício" (`#metas`) só com conta.
- `telaCompras` (1193-1198): "Lista do plano alimentar" = `compras` do plano de hoje.
- `restaurarBackup` (1405-1451): filtros usam `SF.plano.idsDeRefeicao` e `idsDeMeta` do modelo atual (a restauração volta a funcionar com conta).
- `index.html`/`sw.js`: `js/sf-plano.js` antes de `app.js`; `?v=37` e `meu-prato-v37`.

- [ ] **Step 1: Write the failing test** em `tests/publicacao.test.js` (ou no teste que confere a lista de scripts): `js/sf-plano.js` está no `index.html` antes de `app.js` e no cache do `sw.js`, com a mesma versão nos dois.
- [ ] **Step 2: Run** `node --test "tests/*.test.js"` — Expected: FAIL nesse teste.
- [ ] **Step 3: Implement** as trocas acima.
- [ ] **Step 4: Run** `node --check app.js && node --test "tests/*.test.js"`; `grep -n "PLANO\." app.js` — Expected: verde e nenhuma leitura de `PLANO.` fora de `modeloAtual`.
- [ ] **Step 5: Commit** `app.js index.html sw.js tests/publicacao.test.js`: `"App: plano e metas pelo modelo, sem a trava 1 do ADR-005"`.

### Task 6: Formulário do plano

**Files:**
- Create: `js/sf-editor.js`
- Modify: `app.js` (rota `#plano/editar` no `render`, eventos), `index.html`, `sw.js`, `styles.css` (só classes novas, no estilo de `.vazio` e do diálogo de registro)
- Test: `tests/sf-editor.test.js`

**Interfaces:**
- Consumes: `SF.plano.novoId`, `salvarPlano`, `planoNoDia`; `modeloAtual()` da Task 5.
- Produces (`SF.editor`, puro):
  - `htmlPlano(plano|null, receitas) -> string` — formulário `<form id="form-plano">` com, por refeição `i`: `r<i>-id` (hidden), `r<i>-nome`, `r<i>-hora` (`type=time`), `r<i>-kcal` (`type=number min=0`), itens `r<i>-it<j>-principal` e `r<i>-it<j>-opcoes` (textarea, uma opção por linha), `r<i>-obs` (textarea, uma por linha), `r<i>-rec` (checkbox por receita, `value` = id); plano: `prescrito` (`type=date`), `compras` (textarea), `nut-proteinas`, `nut-lipidios`, `nut-carboidratos`, `nut-kcal`, `nut-fibras`; botões com `data-acao` `add-refeicao`, `del-refeicao`, `add-item`, `del-item`, `subir`, `descer`. Todo texto do usuário passa por escape de HTML.
  - `planoDosCampos(pares, anterior|null, agoraMs) -> {plano, erros}` — `pares` = `Array.from(new FormData(form))`; ordem das refeições = ordem dos índices; `id` vazio recebe `novoId("r", agoraMs + i)`; linhas vazias descartadas; `nutrientes` = `null` se os cinco campos estiverem vazios, senão `total` com os textos e `linhas` copiadas de `anterior` (se houver); `erros` = `[{campo, msg}]` com `"Dê um nome à refeição"`, `"Horário no formato HH:MM"`, `"Use um número igual ou maior que zero"`, `"Cada item precisa de um nome"`.
- `app.js`: em `#plano/editar` (só com conta), o formulário abre com o plano de hoje (ou vazio); "Salvar" chama `planoDosCampos`; com erros, marca cada campo (`aria-invalid`, mensagem abaixo) e não grava; sem erros, `estado.planos = SF.plano.salvarPlano(...)`, `salvarTudo()`, volta para `#plano` e mostra toast "Plano salvo. Vale a partir de hoje." Os botões de adicionar/remover/reordenar reescrevem o formulário preservando o que foi digitado.

- [ ] **Step 1: Write the failing tests** em `tests/sf-editor.test.js`: `'htmlPlano escapa o texto'` (`<b>` vira `&lt;b&gt;`); `'ida e volta do plano da Rejane'` (`planoDosCampos(campos extraídos do HTML de htmlPlano(planoDaRejane))` devolve plano igual, com os mesmos ids — extrair com regex dos `name`/`value` ou montar os pares à mão); `'refeição nova recebe id estável e válido'`; `'erros de nome, hora e kcal'` (valores exatos das mensagens e `campo`); `'nutrientes vazios viram null'`; `'linhas vazias de opções e observações somem'`.
- [ ] **Step 2: Run** `node --test tests/sf-editor.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `js/sf-editor.js` e a ligação no `app.js`; scripts no `index.html`/`sw.js` (mesma versão 37).
- [ ] **Step 4: Run** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"App: formulário do plano alimentar com versões"`.

### Task 7: Metas de exercício

**Files:**
- Modify: `js/sf-editor.js`, `app.js` (rota `#metas`), `styles.css`
- Test: `tests/sf-editor.test.js`

**Interfaces:**
- Consumes: `SF.plano.salvarMeta`, `encerrarMeta`, `metasNoDia`.
- Produces: `SF.editor.htmlMetas(metas, hoje) -> string` (lista das metas ativas hoje, cada uma com "Editar" e "Encerrar", e "Nova meta"); `htmlMeta(meta|null) -> string` (`<form id="form-meta">`: `nome`, `modo` radio `dias|semana`, `dia-0`…`dia-6` checkboxes, `vezes` `type=number min=1 max=7`, `minutos` `type=number min=1`); `metaDosCampos(pares, anterior|null) -> {meta, erros}` com `"Dê um nome à atividade"`, `"Escolha ao menos um dia"`, `"De 1 a 7 vezes por semana"`, `"Use minutos maiores que zero"`.
- `app.js`: `#metas` (só com conta) lista e edita; salvar chama `SF.plano.salvarMeta(estado.metas, meta, hoje(), Date.now())`; "Encerrar" pede confirmação no próprio botão (segundo toque, como o "Sair" da Conta) e chama `encerrarMeta`. Toast "Meta salva. Vale a partir de hoje."

- [ ] **Step 1: Write the failing tests**: `'metaDosCampos modo dias'`, `'metaDosCampos modo semana'` (`dias` vazio, `vezes` número), os quatro erros com texto exato, `'htmlMetas mostra só as ativas hoje'`, `'htmlMeta escapa o nome'`.
- [ ] **Step 2: Run** `node --test tests/sf-editor.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"App: metas de exercício por pessoa"`.

### Task 8: Documentação

**Files:**
- Modify: `README.md` (trava 1 saiu; como cadastrar plano e metas), `docs/superpowers/plans/2026-11-21-contas-roteiro.md` (plano 3 concluído; itens "Para o plano 3" resolvidos), `handoff.md`

- [ ] **Step 1:** Atualizar os três arquivos com o estado real (commits, contagem de testes).
- [ ] **Step 2: Run** `node --test "tests/*.test.js" && (cd server && npm test)` — Expected: verde.
- [ ] **Step 3: Commit**: `"Docs: plano 3 concluído"`.
