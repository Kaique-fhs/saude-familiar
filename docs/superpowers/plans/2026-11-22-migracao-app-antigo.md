# Migração do app antigo (plano 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No primeiro login num aparelho com dados do app antigo, o app oferece levar tudo (marcações, registros, fotos, plano e exercícios) para a conta, envia com progresso e retomada, e só apaga os dados antigos depois que o servidor confirmou tudo.

**Architecture:** Um módulo puro novo, `js/sf-migracao.js`, lê os `mp-*` antigos, junta com o estado da conta, decide quem pode receber a oferta e quando a migração terminou; a cópia das fotos usa funções injetadas (testável sem IndexedDB). O envio reaproveita a fila do plano 2: o estado juntado é gravado na conta e `registrar` gera as mudanças. A trava 2 do ADR-005 sai: aparelho antigo sem sessão volta ao comportamento da spec (modo antigo com convite para criar conta).

**Tech Stack:** igual ao plano 3 (JS sem build, `node:test`).

**Spec:** `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` §8.5. Depende do plano 3 (`docs/superpowers/plans/2026-11-22-plano-e-metas.md`): formatos de `plano`/`meta`, `SF.plano.deDataJs`, `modeloAtual()`.

## Global Constraints

- A oferta vai só à primeira conta que entrar no aparelho com dados antigos; outra conta nunca a vê. Recusada, só essa conta pode retomá-la ou apagar os dados antigos pelo item "Conta". Sair não apaga dados antigos não migrados.
- Nada antigo é apagado antes de o servidor confirmar: `mp-*` e o IndexedDB `meu-prato` só somem quando a fila e as fotos pendentes da conta estiverem vazias depois de uma sincronização sem erro.
- Plano e exercícios do `data.js` entram como `planos.inicio` e metas com `desde = 2026-11-01` e os ids atuais, só se a conta ainda não tiver plano (para o plano) e não tiver metas (para as metas).
- Marcações se somam; registro que a conta já tem não é trocado pelo antigo.
- Se cair no meio, retoma ao abrir de novo, sem duplicar.
- Mensagens em português do Brasil. Oferta: "Levar o que está salvo neste aparelho para a sua conta?". Faixa do modo antigo: "Crie sua conta para guardar seus dados".

## Formatos

Marcador global `sf:migracao` (fora do prefixo de usuário): `{ dono: userId, estado: "oferecida"|"recusada"|"migrando"|"concluida", fotos: [fotoId], em: ISO }`.

## Review Focus

1. Migração interrompida (aba fechada no meio das fotos): ao abrir de novo, continua de onde parou e termina com todas as fotos no servidor.
2. Segunda conta entra no mesmo aparelho antes de a primeira migrar: não vê oferta, não recebe nada antigo, e os `mp-*` continuam lá.
3. Foto citada em registro antigo mas ausente do IndexedDB: o registro sobe com `foto: null` e um aviso, sem travar a migração.
4. Armazenamento cheio ao gravar o estado juntado: nada antigo é apagado e a tela diz que não coube.
5. A Rejane troca de celular depois de migrar: aparelho novo, sem `mp-*`, entra e baixa tudo da conta (sem oferta).

---

### Task 1: `js/sf-migracao.js` — ler, juntar e decidir

**Files:**
- Create: `js/sf-migracao.js`
- Test: `tests/sf-migracao.test.js`

**Interfaces:**
- Consumes: `SF.dados.NOMES`, `SF.dados.estadoVazio`, `SF.plano.deDataJs`.
- Produces (`SF.migracao`, puro):
  - `lerAntigos(lerChave) -> estado` — `lerChave(nome)` devolve o JSON de `mp-<x>` cru (ou `null`); monta os 8 campos de `SF.dados.NOMES` (sem `planos`/`metas`).
  - `juntar(conta, antigo, PLANO) -> estado` — união sem repetir em `favs`, `sel`, `despensa`; `checks`/`checksPlano` com `true` de qualquer lado; `diario`/`treinos` união por dia; `registros`: o da conta fica, o antigo entra só onde a conta não tem; `planos` = `deDataJs(PLANO).planos` se `conta.planos` estiver vazio, senão os da conta; `metas` idem.
  - `fotosDe(estado) -> string[]` — ids de foto citados em `registros`.
  - `podeOferecer(marcador, userId, temDadosAntigos) -> boolean` — `temDadosAntigos` e (`!marcador` ou (`marcador.dono === userId` e `marcador.estado !== "concluida"`)).
  - `terminou(sincronia) -> boolean` — `sincronia.status() === "ok"` e `sincronia.pendentes() === 0`.
- [ ] **Step 1: Write the failing tests**: `'juntar soma marcações e não troca registro da conta'` (valores exatos); `'juntar traz plano e metas do data.js só se a conta não tiver'` (conta vazia → `planos.inicio` com os 5 ids e metas `pilates`/`academia` com `desde "2026-11-01"`; conta com plano → plano da conta intacto e metas do data.js entram); `'juntar é idempotente'` (`juntar(juntar(c,a,P),a,P)` igual a `juntar(c,a,P)`); `'podeOferecer'` (sem marcador; dono igual; dono diferente → false; concluída → false; sem dados → false); `'fotosDe'`; `'lerAntigos com JSON quebrado vira vazio'`.
- [ ] **Step 2: Run** `node --test tests/sf-migracao.test.js` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `js/sf-migracao.js` (nenhuma função muda o que recebe).
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"Migração: ler, juntar e decidir a oferta"`.

### Task 2: Copiar fotos e apagar os dados antigos

**Files:**
- Modify: `js/sf-migracao.js`
- Test: `tests/sf-migracao.test.js`

**Interfaces:**
- Produces:
  - `copiarFotos(ids, {lerAntiga, existeNaConta, gravarNaConta, aoProgresso}) -> Promise<{copiadas, faltando: string[]}>` — para cada id, pula se `existeNaConta(id)`; senão `lerAntiga(id)` → `gravarNaConta(id, blob)`; `null` vai para `faltando`; `aoProgresso(feitas, total)` a cada foto; erro de gravação rejeita a promessa (nada é apagado depois).
  - `semFotosFaltando(estado, faltando) -> estado` — registros com foto em `faltando` ficam com `foto: null`.
  - `chavesAntigas(storage) -> string[]` — todas as chaves que começam com `mp-`.
- [ ] **Step 1: Write the failing tests**: `'copiarFotos pula as que já estão na conta'`, `'copiarFotos relata as que faltam'`, `'copiarFotos rejeita se gravar falhar'`, `'progresso chega a total'`, `'semFotosFaltando'`, `'chavesAntigas não pega sf:'`.
- [ ] **Step 2: Run** `node --test tests/sf-migracao.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"Migração: cópia das fotos e lista de chaves antigas"`.

### Task 3: Poda de `fotos-enviadas` e avisos

**Files:**
- Modify: `js/sf-sincronia.js`
- Test: `tests/sf-sincronia.test.js`

**Interfaces:**
- Produces: depois de cada sincronização sem erro, `fotos-enviadas` guarda só ids citados em `registros` do estado atual, e `avisos` guarda no máximo os 50 mais recentes (roteiro, pendências do plano 2: "`fotos-enviadas` e avisos sem poda... tratar no plano 4").
- [ ] **Step 1: Write the failing tests**: `'fotos-enviadas sem registro somem após sincronizar'`, `'avisos ficam nos 50 mais recentes'`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"Sync: poda de fotos enviadas e avisos"`.

### Task 4: App oferece, migra, retoma e conclui; trava 2 sai

**Files:**
- Modify: `app.js` (abertura 16-41, `iniciarConta` 1659-1678, `aoEntrar` 1793-1811, `sessaoVencida` 1814-1825, `aoSair` 1828-1839, `comecarSincronia` 1721-1752, `avisarContaIndisponivel` 1862-1867), `js/sf-conta.js` (`contaDisponivel` 13-17, `mostrarConta` 383-471), `index.html`, `sw.js` (versão 38, `js/sf-migracao.js` antes de `app.js`), `styles.css`
- Test: `tests/sf-conta.test.js`, `tests/publicacao.test.js`, `node --check app.js`

**Interfaces:**
- Consumes: Tasks 1-3; `modeloAtual()`/estado `planos`/`metas` do plano 3.
- Comportamento:
  - Trava 2 sai: `SF.conta.contaDisponivel` passa a devolver `true` sempre que há `armazem` (manter a função, com teste novo). Aparelho com `mp-*` e sem sessão abre no modo antigo (`SF.conta.modoInicial`) com a faixa "Crie sua conta para guardar seus dados" e botões "Criar conta" / "Entrar". Os `location.reload()` por `usouAppAntigo()` em `aoEntrar` (1797-1798) saem; os de `sessaoVencida`/`aoSair` ficam (voltam ao modo antigo). `avisarContaIndisponivel` sai.
  - Em `aoEntrar` (e na abertura com sessão já salva), se `SF.migracao.podeOferecer(marcador, userId, armazem.temDadosAntigos())`: grava o marcador com `dono = userId` e `estado: "oferecida"` (se não havia) e abre um `<dialog>` com a pergunta da oferta e os botões "Levar para a conta" e "Agora não". "Agora não" → `estado: "recusada"`.
  - "Levar para a conta": marcador `migrando`; `copiarFotos(fotosDe(antigo), …)` do banco `meu-prato` para `saude-familiar-<id>`; `estado = semFotosFaltando(juntar(estado, lerAntigos(...), window.PLANO), faltando)`; `salvarTudo()` (a fila recebe tudo); se `gravarDados` falhar, marcador volta a `oferecida` e a tela diz "Não coube no aparelho. Libere espaço e tente de novo pela Conta.". Progresso das fotos no status da conta: "Levando fotos: 3 de 40". Faltando > 0: aviso "N fotos antigas não estavam no aparelho".
  - Retomada: abrir com marcador `migrando` e `dono === userId` repete o passo anterior (idempotente).
  - Conclusão: após cada `sincronizar()` com marcador `migrando`, se `SF.migracao.terminou(sincronia)`: copiar `mp-ultimo-backup`, `mp-backups-mes` e `mp-modo-cal` para a conta (se a conta não tiver), apagar `chavesAntigas`, apagar o banco `meu-prato` (`SF.fotos.apagarBancoFotos` ou o helper equivalente do app), marcador `concluida`, toast "Pronto: tudo o que estava neste aparelho está na sua conta."
  - Tela Conta (`mostrarConta`): com dados antigos e `podeOferecer` verdadeiro, seção "Dados antigos deste aparelho" com "Levar para a conta" e "Apagar dados antigos" (segundo toque para confirmar; apaga `chavesAntigas` e `meu-prato`, marcador `concluida`). Recebe pelos callbacks novos `oferta: () => boolean`, `migrar()`, `apagarAntigos()` passados em `iniciarConta`.
- [ ] **Step 1: Write the failing tests**: `tests/sf-conta.test.js` `'contaDisponivel com armazem libera o aparelho antigo'`; teste que a seção "Dados antigos" só existe quando `oferta()` é verdadeiro (se `mostrarConta` não for testável no Node, extrair `secoesConta(o) -> string[]` puro e testá-lo); `tests/publicacao.test.js` com `js/sf-migracao.js` no `index.html` e no `sw.js` (versão 38).
- [ ] **Step 2: Run** `node --test "tests/*.test.js"` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement** o comportamento acima.
- [ ] **Step 4: Run** `node --check app.js && node --test "tests/*.test.js"` — Expected: verde.
- [ ] **Step 5: Commit**: `"App: migração do app antigo para a conta, sem a trava 2 do ADR-005"`.

### Task 5: Documentação

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-11-21-contas-roteiro.md` (plano 4 concluído), `handoff.md` (próximo passo: a Rejane migra no celular dela; a sessão confere no banco de produção, só contagens, que a conta dela tem plano, registros e fotos; depois, plano 6)

- [ ] **Step 1:** Atualizar os três arquivos.
- [ ] **Step 2: Run** `node --test "tests/*.test.js" && (cd server && npm test)` — Expected: verde.
- [ ] **Step 3: Commit**: `"Docs: plano 4 concluído"`.
