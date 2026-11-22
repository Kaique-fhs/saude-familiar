# Migração do app antigo (plano 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No primeiro login num aparelho com dados do app antigo, o app oferece levar tudo (marcações, registros, fotos e, se a conta não tiver nada, plano e exercícios) para a conta, envia com progresso e retomada, e só apaga os dados antigos depois que o servidor confirmou cada item.

**Architecture:** Um módulo novo, `js/sf-migracao.js`, lê os `mp-*` antigos, junta com o estado da conta, decide a oferta, conduz a migração com dependências injetadas (`executar`) e confere se ela terminou (`conferir`). O envio reaproveita a fila do plano 2. A trava 2 do ADR-005 sai: aparelho antigo sem sessão volta ao comportamento da spec, modo antigo gravando em `mp-*` com convite para criar conta.

**Tech Stack:** igual ao plano 3 (JS sem build, `node:test`).

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` §8.5 (e §4, antiobjetivo "a Rejane perder diário, registros ou fotos"). Depende do plano 3 (`docs/superpowers/plans/2026-11-22-plano-e-metas.md`): formatos de `plano`/`meta`, `SF.plano.deDataJs`, `modeloAtual()`, estado `planos`/`metas`. Números de linha valem antes do plano 3; conferir no código atual.

## Global Constraints

- A oferta vai só à primeira conta que entrar no aparelho com dados antigos; outra conta nunca a vê nem recebe nada antigo. Recusada, só essa conta pode retomá-la ou apagar os dados antigos pelo item "Conta". Sair não apaga dados antigos não migrados.
- Nada antigo é apagado sem `SF.migracao.conferir(...)` devolver `pronto: true`. Sem isso, os dados antigos ficam e a pessoa pode apagá-los à mão pela Conta.
- Plano e exercícios do `data.js` entram como `planos.inicio` e metas com `desde = 2026-11-01` e os ids atuais, só se a conta ainda não tiver plano nem metas (spec §8.5, literal). `window.PLANO` pode não existir (lançamento 2): nada de plano entra e nada quebra.
- Marcações se somam; registro que a conta já tem não é trocado pelo antigo.
- A oferta só aparece depois de uma sincronização completa da conta sem erro (o estado da conta precisa estar baixado antes de juntar).
- Se cair no meio, retoma ao abrir de novo sem refazer a junção (o que a pessoa apagar depois não volta).
- No modo antigo (com ou sem módulos de conta carregados), tudo continua gravando em `mp-*` como hoje.
- Mensagens: oferta "Levar o que está salvo neste aparelho para a sua conta?" (botões "Levar para a conta" / "Agora não"); faixa do modo antigo "Crie sua conta para guardar seus dados" (botões "Criar conta" / "Entrar"); progresso "Levando fotos: N de M"; fim "Pronto: tudo o que estava neste aparelho está na sua conta."; bloqueio "Alguns itens antigos não foram aceitos pela conta. Os dados antigos continuam neste aparelho."
- Versão de cache `38` (sobe uma vez, na Task 6).

## Formatos

Marcador global `sf:migracao` (fora do prefixo de usuário): `{ dono: userId, estado: "oferecida"|"recusada"|"migrando"|"concluida", juntado: boolean, fotos: [fotoId], faltando: [fotoId], em: ISO }`.

## Review Focus

1. Migração interrompida no meio das fotos: ao abrir de novo, continua e termina com todas as fotos no servidor, sem juntar de novo.
2. Segunda conta entra no mesmo aparelho antes de a primeira migrar: não vê oferta, não recebe nada antigo, e os `mp-*` continuam.
3. Foto citada em registro antigo e ausente do IndexedDB: o registro sobe com `foto: null`, aviso "N fotos antigas não estavam no aparelho", e a migração termina.
4. Item recusado pelo servidor, conflito de registro com foto ou armazenamento cheio: nada antigo é apagado e a tela diz por quê.
5. A Rejane troca de celular depois de migrar: aparelho novo, sem `mp-*`, entra e baixa tudo da conta, sem oferta.

---

### Task 1: `SF.local` ganha leitura e gravação globais

**Files:**
- Modify: `js/sf-local.js`
- Test: `tests/sf-local.test.js`

**Interfaces:**
- Produces: `lerGlobal(nome, padrao)`, `gravarGlobal(nome, valor) -> boolean`, `apagarGlobal(nome)` sobre a chave crua `sf:<nome>` (ex.: `lerGlobal("migracao")` lê `sf:migracao`); `apagarUsuario(id)` também apaga `sf:migracao` quando `dono === id`.
- [ ] **Step 1: Write the failing tests**: `'lerGlobal/gravarGlobal usam sf:<nome>'`, `'apagarUsuario do dono apaga o marcador da migração'`, `'apagarUsuario de outra conta mantém o marcador'`.
- [ ] **Step 2: Run** `node --test tests/sf-local.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Local: chaves globais e marcador da migração"`.

### Task 2: `js/sf-migracao.js` — ler, juntar, decidir e conferir

**Files:**
- Create: `js/sf-migracao.js`
- Test: `tests/sf-migracao.test.js`

**Interfaces:**
- Consumes: `SF.dados.NOMES`, `estadoVazio`, `paraItens`, `chaveValida`; `SF.plano.deDataJs`.
- Produces (`SF.migracao`, puro):
  - `lerAntigos(lerChave) -> {estado, puladas}` — `lerChave(nome)` devolve o JSON de `mp-<x>` cru (ou `null`); `estado` com os 8 campos de sempre; `puladas` = quantos itens de `SF.dados.paraItens(estado)` teriam chave inválida (contar com `chaveValida` sobre as chaves que `paraItens` montaria).
  - `juntar(conta, antigo, PLANO) -> estado` — união sem repetir em `favs`, `sel`, `despensa`; `checks`/`checksPlano` com `true` de qualquer lado; `diario`/`treinos` união por dia; `registros`: o da conta fica, o antigo entra só onde a conta não tem; `planos`/`metas`: se a conta não tiver nenhum plano e nenhuma meta, `deDataJs(PLANO)`; senão os da conta.
  - `fotosDe(estado) -> string[]`.
  - `podeOferecer(marcador, userId, temDadosAntigos) -> boolean` — `temDadosAntigos` e (`!marcador` ou (`marcador.dono === userId` e `estado !== "concluida"`)).
  - `conferir({antigo, conta, puladas, rejeitados, status, pendentes, houveConflito}) -> {pronto, motivo}` — `pronto` só se `puladas === 0`, `rejeitados.length === 0`, `!houveConflito`, `status === "ok"`, `pendentes === 0` e todo item de `paraItens(antigo)` existe em `paraItens(conta)` (registro: mesma chave basta); `motivo` em `"puladas"|"rejeitados"|"conflito"|"enviando"|"faltando"`.
- [ ] **Step 1: Write the failing tests**: `'juntar soma marcações e não troca registro da conta'`; `'juntar traz plano e metas do data.js só se a conta não tiver nenhum dos dois'` (conta vazia → `planos.inicio` com os 5 ids e metas `pilates`/`academia`, `desde "2026-11-01"`; conta só com metas → nada do data.js); `'juntar sem PLANO'`; `'juntar é idempotente'`; `'podeOferecer'` (sem marcador; dono igual; dono diferente; concluída; sem dados); `'fotosDe'`; `'lerAntigos com JSON quebrado vira vazio'`; `'lerAntigos conta chaves puladas'`; `'conferir'` (um caso por motivo e o caso pronto).
- [ ] **Step 2: Run** `node --test tests/sf-migracao.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** (nenhuma função muda o que recebe).
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Migração: ler, juntar, decidir e conferir"`.

### Task 3: `js/sf-migracao.js` — fotos, execução e retomada

**Files:**
- Modify: `js/sf-migracao.js`
- Test: `tests/sf-migracao.test.js`

**Interfaces:**
- Produces:
  - `copiarFotos(ids, {lerAntiga, existeNaConta, gravarNaConta, aoProgresso}) -> Promise<{copiadas, faltando}>` — pula as que já estão na conta; `null` vai para `faltando`; `aoProgresso(feitas, total)` a cada foto; erro de gravação rejeita.
  - `semFotosFaltando(estado, faltando) -> estado` — registro com foto em `faltando` fica com `foto: null`.
  - `chavesAntigas(storage) -> string[]` — chaves que começam com `mp-`.
  - `executar(deps) -> Promise<"migrando"|"sem-espaco"|"erro-fotos">` — `deps = {userId, marcador(), gravarMarcador(m), lerAntigo(), estadoConta(), PLANO, copiarFotos, gravarEstado(estado) -> boolean, aoProgresso}`; marca `migrando`; copia as fotos; se `!marcador.juntado`: `gravarEstado(semFotosFaltando(juntar(...)))` — `false` devolve `"sem-espaco"` e volta o marcador a `oferecida`; senão grava `juntado: true`, `fotos`, `faltando`. Com `juntado: true` (retomada), só refaz a cópia das fotos.
  - `concluir(deps) -> Promise<{pronto, motivo}>` — `deps = {conferir args…, copiarParaConta(nomes), apagarChaves(chaves), apagarBancoAntigo() -> Promise<{bloqueado?}>, gravarMarcador}`; só com `conferir(...).pronto`: copia `mp-ultimo-backup`, `mp-backups-mes`, `mp-modo-cal` para a conta (se a conta não tiver), apaga `chavesAntigas`, apaga o banco `meu-prato`; banco `bloqueado` não marca `concluida` (tenta de novo na próxima sincronização); senão marcador `concluida`.
- [ ] **Step 1: Write the failing tests** (fakes em memória): `'copiarFotos pula as que já estão na conta'`, `'copiarFotos relata as que faltam'`, `'copiarFotos rejeita se gravar falhar'`, `'executar: interrompido nas fotos, retoma sem juntar de novo'` (a segunda chamada não chama `gravarEstado`; item apagado da conta entre as duas não volta), `'executar: sem espaço volta à oferta'`, `'executar: foto faltando vira foto null'`, `'concluir só apaga com conferir pronto'` (rejeitado → nada apagado), `'concluir: banco bloqueado não conclui'`, `'concluir copia o histórico de cópias para a conta'`, `'chavesAntigas não pega sf:'`.
- [ ] **Step 2: Run** `node --test tests/sf-migracao.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Migração: fotos, execução, retomada e conclusão"`.

### Task 4: Poda de `fotos-enviadas` e avisos

**Files:**
- Modify: `js/sf-sincronia.js`
- Test: `tests/sf-sincronia.test.js`

**Interfaces:**
- Produces: depois de cada sincronização sem erro, `fotos-enviadas` guarda só ids citados em `registros` do estado atual, e `avisos` guarda os 50 mais recentes. Também expõe `houveConflito() -> boolean` (verdadeiro se a última sincronização teve status `"conflito"`), usado pela Task 6.
- [ ] **Step 1: Write the failing tests**: `'fotos-enviadas sem registro somem após sincronizar'`, `'registro restaurado depois da poda reenvia a foto'` (a foto volta para `fotos-pendentes` e sobe), `'avisos ficam nos 50 mais recentes'`, `'houveConflito'`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"Sync: poda de fotos enviadas e avisos"`.

### Task 5: Trava 2 sai; modo antigo grava e convida a criar conta

**Files:**
- Modify: `js/sf-conta.js` (`contaDisponivel` sai com seus testes; nova `destinoGravacao`), `app.js` (abertura ~16-41, `gravar` ~51-52, toasts ~141-174, `iniciarConta` ~1659-1700, `aoEntrar`, `avisarContaIndisponivel`), `styles.css`
- Test: `tests/sf-conta.test.js`, `node --check app.js`

**Interfaces:**
- Produces: `SF.conta.destinoGravacao({modo, userId, semCarregar}) -> "conta"|"antigo"|null` — `"conta"` com `userId`; `"antigo"` com `modo === "antigo"` e sem `semCarregar`; senão `null`. `app.js` usa isso em `gravar`/`ler` e no "Desfazer" (vale em `"conta"` e `"antigo"` do mesmo dono).
- Comportamento: com `armazem` e sem sessão, aparelho com dados antigos abre em `modo = "antigo"` (`SF.conta.modoInicial`), sem cobrir o app com o login, com a faixa e os dois botões (que chamam `contaUI.mostrar("cadastro"|"entrar")`). Saem `contaDisponivel`, `contaEsperaMigracao`, `avisarContaIndisponivel` e o `location.reload()` por `usouAppAntigo()` em `aoEntrar`; ficam os de `sessaoVencida`/`aoSair` (voltam ao modo antigo).
- [ ] **Step 1: Write the failing tests**: `'destinoGravacao'` (os três resultados e `semCarregar`); remover os testes de `contaDisponivel`.
- [ ] **Step 2: Run** `node --test tests/sf-conta.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `node --check app.js && node --test "tests/*.test.js"`; `grep -nE "contaDisponivel|contaEsperaMigracao|avisarContaIndisponivel" app.js js/*.js` — Expected: verde e grep vazio.
- [ ] **Step 5: Commit** `"App: modo antigo grava e convida a criar conta, sem a trava 2 do ADR-005"`.

### Task 6: App oferece, migra, retoma e conclui

**Files:**
- Modify: `app.js` (`iniciarConta`, `aoEntrar`, `comecarSincronia`), `js/sf-conta.js` (`mostrarConta`; função pura nova `secoesConta(o) -> string[]`), `index.html`, `sw.js` (`js/sf-migracao.js` antes de `app.js`, versão 38), `styles.css`
- Test: `tests/sf-conta.test.js`, `tests/publicacao.test.js`

**Interfaces:**
- Consumes: Tasks 1-5; `SF.sincronia` (`status`, `pendentes`, `rejeitados`, `houveConflito`).
- Comportamento:
  - Depois da primeira sincronização completa sem erro da sessão (em `comecarSincronia`), se `SF.migracao.podeOferecer(armazem.lerGlobal("migracao"), userId, armazem.temDadosAntigos())`: sem marcador, grava `{dono: userId, estado: "oferecida"}`; com estado `oferecida`, abre um `<dialog>` com a oferta. "Agora não" → `recusada`. Estado `migrando` → `SF.migracao.executar` direto (retomada).
  - "Levar para a conta": `SF.migracao.executar` com fotos do banco `meu-prato` para `saude-familiar-<id>`, `gravarEstado` = trocar o estado do app pelo juntado e `gravarDados()` (devolve se gravou) seguido de `salvarTudo()`; progresso no status da conta ("Levando fotos: N de M"); `"sem-espaco"` mostra "Não coube no aparelho. Libere espaço e tente de novo pela Conta."; `faltando > 0` avisa "N fotos antigas não estavam no aparelho".
  - Após cada `sincronizar()` com marcador `migrando` e `juntado`: `SF.migracao.concluir(...)`; `pronto` → toast de fim; motivo `rejeitados`/`conflito`/`puladas` → aviso de bloqueio na Conta (uma vez por sessão).
  - Conta: `secoesConta({temAntigos, podeOferecer, migrando, motivo})` inclui `"antigos"` quando há dados antigos e `podeOferecer`; a seção "Dados antigos deste aparelho" tem "Levar para a conta" e "Apagar dados antigos" (segundo toque; apaga `chavesAntigas` e `meu-prato`, marcador `concluida`).
- [ ] **Step 1: Write the failing tests**: `'secoesConta'` (com e sem dados antigos; outra conta); teste de scripts com `js/sf-migracao.js` antes de `app.js` e versão 38.
- [ ] **Step 2: Run** `node --test "tests/*.test.js"` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit** `"App: migração do app antigo para a conta"`.

### Task 7: Documentação

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-11-21-contas-roteiro.md` (plano 4 concluído), `handoff.md` (próximo passo: a Rejane migra no celular dela; a sessão confere no banco de produção, só contagens, que a conta dela tem plano, registros e fotos; depois, plano 6)

- [ ] **Step 1:** Atualizar os três arquivos.
- [ ] **Step 2: Run** `node --test "tests/*.test.js" && (cd server && npm test)` — Expected: verde.
- [ ] **Step 3: Commit** `"Docs: plano 4 concluído"`.
