# Plano e metas por pessoa (plano 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada conta cadastra o próprio plano alimentar (com versões "vale desde") e as próprias metas de exercício, sincronizados com a conta, e o app calcula dia cumprido, sequência, progresso semanal e calendário a partir deles.

**Architecture:** Plano e metas viram itens `plano` e `meta` do `/sync` (o servidor já aceita os tipos). Um módulo puro novo, `js/sf-plano.js`, guarda o modelo e todos os cálculos; outro, `js/sf-editor.js`, monta o HTML dos formulários e converte os campos em plano/meta. O `app.js` deixa de ler `window.PLANO` direto: no modo antigo usa `SF.plano.deDataJs(window.PLANO)`, com conta usa o estado sincronizado. A trava 1 do ADR-005 sai.

**Tech Stack:** JavaScript sem build (IIFE com `module.exports` para o Node), `node:test` no site (`node --test "tests/*.test.js"`), Node 24 + Fastify + PGlite/Postgres no servidor (`cd server && npm test`).

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` (§8.2, §8.3, §8.4 "Plano e metas: vale a versão gravada por último"). ADRs: `docs/ams/adr/ADR-001-*`, `ADR-005-*` (a trava 1 é temporária "até o plano 3"). Números de linha valem em `d2e3728`.

## Global Constraints

- Site estático, sem build, sem dependência nova; módulos novos seguem o padrão de `js/sf-dados.js` (IIFE, `raiz.SF.<nome>`, `module.exports`).
- "Dias passados não mudam ao editar o plano": editar cria versão que vale a partir de hoje; o dia passado usa a versão que valia nele.
- Ids de refeição e de meta são estáveis, nunca reaproveitados, e casam `^[a-z0-9_-]{1,60}$` (vão dentro das chaves `dia|id` de `feito`, `treino` e `registro`).
- Editar uma meta encerra a antiga (`ate` = ontem) e cria outra (`desde` = hoje).
- Dia cumprido = todas as refeições do plano vigente no dia + todas as metas de dias fixos do dia; metas de vezes por semana não entram no dia; dia sem nada programado não conta na sequência (nem quebra, nem soma). Semana de segunda a domingo.
- "Atrasada" só existe para refeição com horário (spec §8.2). Isso também vale no modo antigo: café sem horário deixa de aparecer como atrasado. Quadro de nutrientes só aparece se preenchido.
- Modo antigo (sem conta) continua com o plano e os exercícios do `data.js` e sem formulário.
- Datas `"AAAA-MM-DD"` calculadas em UTC (`Date.UTC`), nunca com `Date` local.
- O valor de um item tem no máximo 64 KB no servidor (`server/src/sincronia.js:7`); o cliente recusa plano acima de 60 KB.
- Versão de cache: `index.html` `?v=36` e `sw.js` `meu-prato-v36` sobem uma vez para `37` (Task 7); tasks seguintes que acrescentam script mantêm `37`. Nada é publicado no meio do plano.
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
{ id, origem, nome, modo: "dias"|"semana", dias: [0..6] (só modo dias, 0 = domingo), vezes: 1..7|null (só modo semana),
  minutos: number|null, desde: "AAAA-MM-DD", ate: "AAAA-MM-DD"|null }
```

`origem` = id da primeira meta da cadeia de edições (igual ao `id` numa meta nova). Estado do app ganha `planos` (`{chave: plano}`) e `metas` (`{id: meta}`), guardados na conta como `mp-planos` e `mp-metas`. Ids novos: `SF.plano.novoId("r"|"m", agoraMs)` = prefixo + `"-"` + `agoraMs.toString(36)`.

## Review Focus

1. Plano editado hoje e dia de ontem reaberto no calendário: ontem continua com o total e as refeições da versão antiga.
2. Dois aparelhos editam o plano no mesmo dia: fica a versão gravada por último, sem misturar refeições.
3. Conta sem plano e sem metas: Plano, Frequência e Compras abrem sem erro nem "NaN", com o convite "Cadastrar meu plano"; receitas e lista das receitas funcionam.
4. Formulário com refeição sem nome, horário inválido, kcal negativa ou plano grande demais: mostra o erro no campo e não grava nada.
5. Aparelho que já sincronizou antes desta versão: depois de atualizar, recebe plano e metas já gravados por outro aparelho (cursor zerado uma vez).

---

### Task 1: Servidor valida chave e valor de `plano` e `meta`

**Files:**
- Modify: `server/src/sincronia.js:22-33` (`validarMudanca`)
- Test: `server/test/sincronia.test.js`

**Interfaces:**
- Produces: `/sync` recusa (400 `{erro:'sync'}`) `plano` com chave fora de `^(inicio|\d{4}-\d{2}-\d{2})$`, `meta` com chave fora de `^[a-z0-9_-]{1,60}$`, e `plano`/`meta` ativos cujo valor não seja objeto (não-array).

- [ ] **Step 1: Write the failing test** `'plano e meta: chave e valor validados'` em `server/test/sincronia.test.js`, no estilo dos testes de 400 existentes: `{tipo:'plano', chave:'2026-11-22', valor:{refeicoes:[]}, ativo:true}` → 200; `chave:'ontem'` → 400 `{erro:'sync'}`; `{tipo:'meta', chave:'m-abc', valor:{id:'m-abc'}, ativo:true}` → 200; `chave:'M A'` → 400; `{tipo:'plano', chave:'inicio', valor:'texto', ativo:true}` → 400; `{tipo:'plano', chave:'inicio', valor:[], ativo:true}` → 400; `{tipo:'meta', chave:'m-x', valor:null, ativo:false}` → 200.
- [ ] **Step 2: Run** `cd server && node --test test/sincronia.test.js` — Expected: FAIL nos casos de 400.
- [ ] **Step 3: Implement** em `validarMudanca` com `CHAVE_PLANO` e `CHAVE_META`.
- [ ] **Step 4: Run** `cd server && npm test` — Expected: tudo verde.
- [ ] **Step 5: Commit** `"API: valida chave e valor de plano e meta no /sync"`.

### Task 2: Sincronia — `naoGravado` desliga e cursor zera uma vez

**Files:**
- Modify: `js/sf-sincronia.js:125-148` (`registrar`), `:232-253` (`aplicarRemotos`), `:255-267` (`baixarTudo`)
- Test: `tests/sf-sincronia.test.js`

**Interfaces:**
- Produces: constante `VERSAO_CURSOR = 2` guardada em `sf:<id>:cursor-versao`.

- [ ] **Step 1: Write the failing tests** em `tests/sf-sincronia.test.js` (usar `localQueFalha` e `montar` existentes): `'desfazer a mudança que não coube desliga o erro'` (registrar falha → `status()==="erro"`, `pendentes()===1`; com o armazenamento voltando a gravar, registrar com o estado igual ao `ref` → `status()==="ok"`, `pendentes()===0`); `'remoto que cobre a pendência não gravada desliga o erro'`; `'aparelho com cursor antigo baixa desde o zero uma vez'` (local com `cursor: 900` sem `cursor-versao` → a primeira chamada a `api.baixar` recebe `0`; `cursor-versao` vale `2` só depois da primeira página aplicada; a segunda sincronização usa o cursor novo); `'queda no meio do recomeço retoma do cursor salvo'` (primeira página ok, segunda falha → próxima sincronização começa no cursor da primeira página, sem voltar a 0).
- [ ] **Step 2: Run** `node --test tests/sf-sincronia.test.js` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement.** Saída cedo de `registrar` (sem mudanças) zera `naoGravado` (e `ultimoProblema` se for `"erro"`); em `aplicarRemotos`, depois de recalcular `ref`, se `dados.diferencas(ref, deps.estado(), iso()).length === 0` zera do mesmo jeito. Em `baixarTudo`, `cursor-versao < VERSAO_CURSOR` começa em 0 e grava `cursor-versao` depois da primeira página aplicada.
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Sync: naoGravado desliga ao desfazer e cursor zera uma vez"`.

### Task 3: Cliente sincroniza `planos` e `metas`

**Files:**
- Modify: `js/sf-dados.js` (`NOMES`, `estadoVazio`, `chaveValida`, `paraItens`, `copiar`, `aplicar`), `js/sf-sincronia.js:9` (`TIPOS`) e `aplicarRemotos`, `js/sf-conta.js:86-90`
- Test: `tests/sf-dados.test.js`, `tests/sf-sincronia.test.js`, `tests/sf-conta.test.js`

**Interfaces:**
- Produces: `SF.dados.NOMES["mp-planos"] === "planos"`, `NOMES["mp-metas"] === "metas"` (não entram em `SINCRONIZAVEIS` do `sf-local.js`); `estadoVazio()` com `planos: {}`, `metas: {}`; `paraItens` gera `plano|<chave>` e `meta|<id>`; `aplicar` grava/apaga em `planos`/`metas`; `copiar` copia `planos`/`metas` em profundidade; `chaveValida` com as regex da Task 1. `SF.sincronia` aceita `plano`/`meta` remotos e ignora os ativos sem valor objeto. `rotuloRejeitado`: `plano: "Plano alimentar"`, `meta: "Meta de exercício"`.

- [ ] **Step 1: Write the failing tests**: `'plano e meta: ida e volta'` (estado com `planos: {"2026-11-22": P}` e `metas: {"m-1": M}` → itens `plano|2026-11-22` e `meta|m-1`; `aplicar(estadoVazio(), itens)` devolve os mesmos objetos; item inativo apaga; renomear uma refeição gera 1 mudança `plano`); `'plano e meta: chave inválida não sincroniza'`; `'copiar não divide objetos de plano'`; `'plano e meta remotos aplicados'` (sf-sincronia); `rotuloRejeitado({tipo:"plano", chave:"2026-11-22"}) === "Plano alimentar: 2026-11-22"`.
- [ ] **Step 2: Run** `node --test "tests/*.test.js"` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Sync: plano e metas no cliente"`.

### Task 4: `js/sf-plano.js` — modelo, versões e metas

**Files:**
- Create: `js/sf-plano.js`
- Test: `tests/sf-plano.test.js`

**Interfaces:**
- Produces (`SF.plano`, puro; nenhuma função muda o que recebe):
  - `novoId(prefixo, agoraMs) -> string`
  - `ontem(dia) -> dia`, `diaDaSemana(dia) -> 0..6`, `segundaDaSemana(dia) -> dia` (UTC)
  - `deDataJs(PLANO) -> {planos, metas}` — `PLANO` indefinido devolve `{planos: {}, metas: {}}`; senão `planos: {inicio: plano}` com refeições `{id, nome, hora, kcal, itens, observacoes, receitas: receitas||[]}`, `nutrientes`, `compras`, `prescritoEm`; cada exercício vira meta `{id, origem: id, nome, modo:"dias", dias, vezes:null, minutos:null, desde, ate: ate||null}`.
  - `planoNoDia(planos, dia) -> plano|null` — versão de maior chave `<= dia` (`"inicio"` vale antes de qualquer data); `null` sem versão ou com `refeicoes` vazio.
  - `idsDeRefeicao(planos) -> string[]` (união de todas as versões), `idsDeMeta(metas) -> string[]`.
  - `salvarPlano(planos, plano, hoje) -> planos` (`planos[hoje] = plano`).
  - `metasNoDia(metas, dia)` (`desde <= dia` e (`ate` nulo ou `dia <= ate`)), `metasFixasDoDia(metas, dia)` (modo `dias` com o dia da semana).
  - `salvarMeta(metas, meta, hoje, agoraMs) -> metas` — sem `id`: cria com `novoId("m", agoraMs)`, `origem = id`, `desde = hoje`; com `id` e `desde === hoje`: sobrescreve; com `id` e `desde < hoje`: antiga recebe `ate = ontem(hoje)` e entra nova com id novo, mesma `origem`, `desde = hoje`.
  - `encerrarMeta(metas, id, hoje) -> metas` — `desde === hoje`: remove; senão `ate = ontem(hoje)`.

- [ ] **Step 1: Write the failing tests** em `tests/sf-plano.test.js` (carregar `data.js` com `globalThis.window = {}` antes do `require("../data.js")`): `'deDataJs mantém ids e passado'` (ids `["acordar","cafe","almoco","lanche","jantar"]` em `inicio`; metas `pilates` `dias [1,2]` e `academia` `dias [2,5]`, `desde "2026-11-01"`, `origem` = id); `'deDataJs sem PLANO'`; `'planoNoDia usa a versão que valia no dia'` (`{inicio: A, "2026-11-22": B}`: 21 → A, 22 e "2026-12-01" → B; `{"2026-11-22": B}`: 21 → null; `refeicoes: []` → null); `'salvarPlano não toca nas versões antigas'`; `'salvarPlano no mesmo dia sobrescreve'`; `'salvarMeta: editar meta antiga encerra ontem e cria outra hoje'` (`ate "2026-11-21"`, `desde "2026-11-22"`, ids diferentes, mesma `origem`); `'salvarMeta no mesmo dia sobrescreve'`; `'encerrarMeta'` (dois casos); `'metasFixasDoDia ignora modo semana e respeita desde/ate'`; `'datas em UTC'` (`ontem("2026-12-01") === "2026-11-30"`, `ontem("2027-01-01") === "2026-12-31"`, `diaDaSemana("2026-11-22") === 0`, `segundaDaSemana("2026-11-22") === "2026-11-16"`); `'novoId casa o formato de chave'`.
- [ ] **Step 2: Run** `node --test tests/sf-plano.test.js` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `js/sf-plano.js`.
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Plano: modelo de versões e metas"`.

### Task 5: `js/sf-plano.js` — dia cumprido, treinos, sequência, semana e refeição atual

**Files:**
- Modify: `js/sf-plano.js`
- Test: `tests/sf-plano.test.js`

**Interfaces:**
- Consumes: Task 4.
- Produces (`ctx = {planos, metas, diario, treinos}`):
  - `totalDoDia(ctx, dia)`, `feitosDoDia(ctx, dia)`, `diaCompleto(ctx, dia)` — só contam ids do plano vigente e das metas fixas do dia; `diaCompleto` exige total > 0.
  - `treinosDoDia(ctx, dia) -> string[]` — ids de metas ativas no dia (fixas ou semanais) com treino marcado no dia.
  - `sequencia(ctx, hoje) -> number` — conta para trás a partir de hoje (ou de ontem se hoje ainda não está completo), pulando dias com total 0, parando no primeiro dia com total > 0 incompleto; no máximo 400 dias.
  - `progressoSemanal(ctx, dia) -> [{meta, feitos, vezes, cumprida}]` — metas modo `semana` ativas em algum dia da semana de `dia`, uma por `origem` (a versão ativa mais recente da semana); `feitos` = dias da semana com treino de qualquer meta dessa `origem`.
  - `semanaCumprida(ctx, dia) -> boolean|null` — `null` sem meta semanal; senão todas `cumprida`.
  - `situacoes(plano|null, feitosHoje, horaAtual) -> {[idRef]: "feita"|"agora"|"atrasada"|"proxima"|"depois"|"pendente"}` e `refeicaoAtual(plano|null, feitosHoje, horaAtual) -> refeicao|null` (`null` sem plano ou com tudo feito).

Algoritmo de `situacoes` (contrato; a spec não fixa os detalhes):
1. Feita: id em `feitosHoje`.
2. Atual: entre as refeições com `hora <= horaAtual` e não feitas, a de maior `hora`; se não houver, a primeira não feita na ordem do plano entre as que não têm hora ou têm `hora > horaAtual`.
3. Com hora, não feita, `hora <= horaAtual` e não é a atual: `"atrasada"`.
4. Sem hora, não feita e antes da atual na ordem: `"pendente"`.
5. Depois da atual: a primeira não feita é `"proxima"`, as demais `"depois"`.

- [ ] **Step 1: Write the failing tests** (plano da Rejane via `deDataJs`): `'dia cumprido com plano e metas fixas'` (`"2026-11-24"`, terça: total 7); `'sem plano conta só metas fixas'`; `'dia sem nada programado não quebra nem soma a sequência'` (sem plano; meta `dias: [1, 3]` desde 2026-11-01; treinos em 2026-11-23 e 2026-11-25; `sequencia(ctx, "2026-11-26") === 2`); `'editar o plano hoje não muda ontem'`; `'treinosDoDia inclui meta semanal'`; `'progresso semanal de segunda a domingo'` (meta `vezes: 3`; treinos seg 23 e qua 25 → `feitos 2`, `cumprida false`; mais sex 27 → `true`; treino do domingo 22 não conta na semana do dia 25); `'progresso semanal soma a meta antes e depois de editada'` (treino seg com a meta antiga, qua com a nova da mesma `origem` → `feitos 2`); `'semanaCumprida null sem meta semanal'`; `situacoes` às `"09:00"` (acordar `"agora"`), `"13:00"` (café sem hora `"pendente"`, almoço `"agora"`), `"17:00"` (almoço `"atrasada"`, lanche `"agora"`, jantar `"proxima"`) e com tudo feito (`refeicaoAtual` null); `'sem plano, situacoes vazio e refeicaoAtual null'`.
- [ ] **Step 2: Run** `node --test tests/sf-plano.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Plano: dia cumprido, treinos, sequência, semana e refeição atual"`.

### Task 6: `app.js` — modelo, cálculos, blocos e textos

**Files:**
- Modify: `app.js:4`, `392-513` (refeição atual, totais, sequência, blocos), `614-651` (textos de entrega e resultado), `692-861` (registro), `902-990` (calendário e situações), `index.html:60-68`, `sw.js:4-18`
- Test: `tests/publicacao.test.js` (criar o teste de scripts), `node --check app.js`

**Interfaces:**
- Consumes: Tasks 3-5.
- Produces em `app.js`: estado `planos`/`metas` lido como as outras chaves (`ler("mp-planos", {})`, `ler("mp-metas", {})`; `gravarDados` grava as duas só com conta); `modeloAtual() -> {planos, metas}` (modo antigo: `SF.plano.deDataJs(window.PLANO)` calculado uma vez; conta: estado); `ctxDia() -> {planos, metas, diario, treinos}`; `planoDe(dia) -> plano|null`.

Troca:
- `refeicaoAtual`, `NOMES_CURTOS` (não usado, sai), `TOTAL_REF` (sai), `exerciciosDoDia`, `treinosFeitos`, `totalDoDia`, `feitosDoDia`, `diaCompleto`, `sequencia`, `situacoesHoje`, `rotuloHora` passam a usar `SF.plano`. `TEXTO_SITUACAO` (984) ganha `pendente: "a fazer"`.
- `blocoDia`, `blocoExercicios` (metas do dia com `treinosDoDia`), `blocoAgenda` (metas ativas hoje: fixas pelos dias, semanais como "N vezes por semana", com minutos quando houver).
- Toda barra de progresso e porcentagem (466, 1003 e as demais) mostra 0% sem dividir por zero quando o total for 0.
- `textoEntrega` (614-629) e `textoResultadoDia` (631-651): plano do dia; a linha fixa do "acordar" (640) vale para refeição sem itens.
- `abrirRegistro`/`salvarRegistro`/`exPorId`/`refPorId`/`marcadosDe`: refeição do plano do dia aberto; meta em `metasNoDia`.
- `blocoCalendario`/`contagemDia`: legenda com o total do dia ("N de N refeições"); na visão `exercicio`, dia marcado com `treinosDoDia`, semana com metas semanais mostra "semana cumprida" quando `semanaCumprida` for `true`, e o resumo inclui o `progressoSemanal` da semana atual ("2 de 3 nesta semana").
- `index.html`/`sw.js`: `js/sf-plano.js` antes de `app.js`; versão continua 36 nesta task.

- [ ] **Step 1: Write the failing test** em `tests/publicacao.test.js`: `'scripts do site no index e no cache, na mesma versão'` — lê `index.html` e `sw.js`; todo `js/*.js` do `index.html` está no cache do `sw.js`; `js/sf-plano.js` vem antes de `app.js`; o `?v=` do `index.html` é igual ao número de `VERSAO` do `sw.js`.
- [ ] **Step 2: Run** `node --test tests/publicacao.test.js` — Expected: FAIL (sf-plano ausente).
- [ ] **Step 3: Implement** as trocas.
- [ ] **Step 4: Verify** `node --check app.js && node --test "tests/*.test.js"` e `grep -nE "TOTAL_REF|exerciciosDoDia|treinosFeitos|NOMES_CURTOS|PLANO\." app.js` — Expected: verde; o grep só mostra `modeloAtual` (leitura de `window.PLANO`) e as definições novas, nenhum uso antigo.
- [ ] **Step 5: Commit** `"App: cálculos e blocos pelo modelo de plano e metas"`.

### Task 7: `app.js` — telas, compras, restauração e fim da trava 1

**Files:**
- Modify: `app.js:38-41` (trava 1), `986-1072` (`semPlano`, `telaPlano`, `telaRefeicao`), `1144-1149` (`telaFrequencia`), `1166-1200` (`telaCompras`), `1392-1465` (`restaurarBackup`), `index.html`, `sw.js` (versão 37)
- Test: `node --check app.js`, `node --test "tests/*.test.js"`

**Interfaces:**
- Consumes: Task 6 (`modeloAtual`, `ctxDia`, `planoDe`).

Troca:
- `app.js:38-41`: sai a troca de `PLANO` por plano vazio.
- `semPlano`: sem plano hoje, Plano mostra "Você ainda não cadastrou seu plano alimentar." e, só com conta, o botão "Cadastrar meu plano" (`href="#plano/editar"`). Frequência sem plano funciona com as metas (não devolve `semPlano`).
- `telaPlano`/`telaRefeicao`: plano de hoje; `refeicaoAtual` nulo não quebra a tela (sem destaque de refeição atual); nutrientes e `prescritoEm` só se existirem; com conta, botões "Editar plano" (`#plano/editar`) e "Metas de exercício" (`#metas`). Até as Tasks 9 e 10, essas rotas caem em `telaPlano`.
- `telaCompras`: "Lista do plano alimentar" = `compras` do plano de hoje (some sem plano).
- `restaurarBackup`: filtros com `SF.plano.idsDeRefeicao` e `idsDeMeta` do modelo atual; se algo da cópia foi ignorado por não existir no plano/metas, o toast diz "Cópia restaurada. N dias de marcações ficaram de fora porque não há plano cadastrado para eles."
- `index.html` `?v=37` e `sw.js` `meu-prato-v37`.

- [ ] **Step 1: Write the failing test** em `tests/publicacao.test.js`: `'versão de cache 37'` (o `?v=` e o `VERSAO` valem 37).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `node --check app.js && node --test "tests/*.test.js"`; `grep -n "refeicoes: \[\], exercicios" app.js` — Expected: verde e grep vazio.
- [ ] **Step 5: Commit** `"App: telas pelo plano de cada conta, sem a trava 1 do ADR-005"`.

### Task 8: `js/sf-editor.js` — formulário do plano (módulo puro)

**Files:**
- Create: `js/sf-editor.js`
- Test: `tests/sf-editor.test.js`

**Interfaces:**
- Consumes: `SF.plano.novoId`.
- Produces (`SF.editor`, puro):
  - `htmlPlano(plano|null, receitas, erros?) -> string` — `<form id="form-plano">` com, por refeição `i`: `r<i>-id` (hidden), `r<i>-nome`, `r<i>-hora` (`type=time`), `r<i>-kcal` (`type=number min=0`), itens `r<i>-it<j>-principal` e `r<i>-it<j>-opcoes` (textarea, uma opção por linha), `r<i>-obs` (textarea), `r<i>-rec` (checkbox por receita, `value` = id); do plano: `prescrito` (`type=date`), `compras` (textarea), `nut-proteinas`, `nut-lipidios`, `nut-carboidratos`, `nut-kcal`, `nut-fibras`; botões `data-acao` `add-refeicao`, `del-refeicao`, `add-item`, `del-item`, `subir`, `descer` com `data-i`/`data-j`; `erros` (`[{campo, msg}]`) marca o campo com `aria-invalid="true"` e a mensagem logo abaixo. Todo texto do usuário passa por escape de HTML.
  - `planoDosCampos(pares, anterior|null, agoraMs) -> {plano, erros}` — `pares` = `Array.from(new FormData(form))`; ordem das refeições = ordem dos índices; `id` vazio recebe `novoId("r", agoraMs + i)`; linhas vazias descartadas; `prescrito` `AAAA-MM-DD` vira `dd/mm/aaaa`; `nutrientes` = `null` se os cinco campos estiverem vazios, senão `total` com os textos (`kcal` como número) e `linhas` copiadas de `anterior` (ou `[]`); `erros` com os textos exatos `"Dê um nome à refeição"`, `"Horário no formato HH:MM"`, `"Use um número igual ou maior que zero"`, `"Cada item precisa de um nome"`, `"O plano ficou grande demais para guardar"` (quando `JSON.stringify(plano)` passar de 61440 bytes UTF-8; `campo: "form-plano"`).
  - `aplicarAcao(pares, acao, i, j) -> pares` — devolve os pares reescritos depois de adicionar/remover/reordenar, preservando o que foi digitado.

- [ ] **Step 1: Write the failing tests** em `tests/sf-editor.test.js`: `'htmlPlano escapa o texto'`; `'ida e volta do plano da Rejane'` (pares montados a partir do plano de `deDataJs` → `planoDosCampos` devolve plano igual, com os mesmos ids; `prescritoEm "17/11/2026"`); `'refeição nova recebe id estável e válido'`; `'erros de nome, hora e kcal'` (texto e `campo` exatos); `'plano grande demais'`; `'nutrientes vazios viram null'`; `'linhas vazias de opções e observações somem'`; `'aplicarAcao: subir, descer, remover e adicionar preservam o digitado'`; `'htmlPlano marca o campo com erro'`.
- [ ] **Step 2: Run** `node --test tests/sf-editor.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Editor: formulário do plano alimentar"`.

### Task 9: `app.js` — rota `#plano/editar`

**Files:**
- Modify: `app.js` (`render`, eventos delegados em `main`), `index.html`, `sw.js` (`js/sf-editor.js` antes de `app.js`, versão 37), `styles.css` (classes novas no estilo de `.vazio` e do diálogo de registro)
- Test: `node --check app.js`, `node --test "tests/*.test.js"`

**Interfaces:**
- Consumes: Task 8; `modeloAtual`, `planoDe`, `SF.plano.salvarPlano`.
- Comportamento: só com conta (no modo antigo a rota cai em `telaPlano`). Abre com o plano de hoje (ou vazio). Botões `data-acao` chamam `SF.editor.aplicarAcao` e redesenham com `htmlPlano`. "Salvar" chama `planoDosCampos`; com erros, redesenha com `erros` e foca o primeiro campo inválido, sem gravar; sem erros, `planos = SF.plano.salvarPlano(planos, plano, hoje())`, `salvarTudo()`, `location.hash = "#plano"` e toast "Plano salvo. Vale a partir de hoje." "Cancelar" volta sem gravar.

- [ ] **Step 1:** Acrescentar ao teste de scripts (Task 6) que `js/sf-editor.js` está no `index.html` antes de `app.js` e no cache. **Run** — Expected: FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 4: Commit** `"App: cadastrar e editar o plano alimentar"`.

### Task 10: Metas de exercício

**Files:**
- Modify: `js/sf-editor.js`, `app.js` (rota `#metas`), `styles.css`
- Test: `tests/sf-editor.test.js`

**Interfaces:**
- Consumes: `SF.plano.salvarMeta`, `encerrarMeta`, `metasNoDia`.
- Produces: `SF.editor.htmlMetas(metas, hoje) -> string` (metas ativas hoje, cada uma com "Editar" `data-meta-editar=<id>` e "Encerrar" `data-meta-encerrar=<id>`, e "Nova meta"); `htmlMeta(meta|null, erros?) -> string` (`<form id="form-meta">`: `nome`, `modo` radio `dias|semana`, `dia-0`…`dia-6`, `vezes` `type=number min=1 max=7`, `minutos` `type=number min=1`); `metaDosCampos(pares, anterior|null) -> {meta, erros}` — copia `id`, `origem`, `desde` e `ate` de `anterior` (sem `anterior`, sem `id`); erros `"Dê um nome à atividade"`, `"Escolha ao menos um dia"`, `"De 1 a 7 vezes por semana"`, `"Use minutos maiores que zero"`.
- `app.js`: `#metas` (só com conta) lista, cria e edita; salvar chama `SF.plano.salvarMeta(metas, meta, hoje(), Date.now())`; "Encerrar" pede o segundo toque no próprio botão ("Toque de novo para encerrar") e chama `encerrarMeta`. Toast "Meta salva. Vale a partir de hoje."

- [ ] **Step 1: Write the failing tests**: `'metaDosCampos modo dias'`, `'metaDosCampos modo semana'` (`dias []`, `vezes` número), `'metaDosCampos preserva id e origem ao editar'`, os quatro erros com texto exato, `'htmlMetas mostra só as ativas hoje'`, `'htmlMeta escapa o nome'`.
- [ ] **Step 2: Run** `node --test tests/sf-editor.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"App: metas de exercício por pessoa"`.

### Task 11: Documentação

**Files:**
- Modify: `README.md` (trava 1 saiu; como cadastrar plano e metas; café sem horário não fica mais "atrasado"), `docs/superpowers/plans/2026-11-21-contas-roteiro.md` (plano 3 concluído; itens "Para o plano 3" resolvidos), `handoff.md`

- [ ] **Step 1:** Atualizar os três arquivos com o estado real (commits, contagem de testes). O ADR que encerra as travas do ADR-005 fica com a sessão principal (rascunho para o Kaique aprovar), não com esta task.
- [ ] **Step 2: Run** `node --test "tests/*.test.js" && (cd server && npm test)` — Expected: verde.
- [ ] **Step 3: Commit** `"Docs: plano 3 concluído"`.
