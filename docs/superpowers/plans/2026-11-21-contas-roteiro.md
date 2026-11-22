# Contas no Saúde Familiar — sequência de planos

Spec: `docs/superpowers/specs/2026-11-21-contas-ec2-design.md` · ADR: `docs/ams/adr/ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md`

Cada plano entrega algo que funciona e se testa sozinho. Ordem:

| # | Plano | Entrega | Depende de |
|---|---|---|---|
| 1 | `2026-11-21-servidor-local.md` | **Concluído** (commits f6c8c37..b01ed23, 87 testes passando, branch `feat/contas-ec2`, sem PR). API Node + Postgres rodando no computador: login, proteção, sincronização, fotos, apagar conta | — |
| 2 | `2026-11-21-app-conta-sync.md` | **Concluído** (branch `feat/app-conta-sync`, commits e285582..a93c407, 100 testes do site e 103 do servidor, roteiro de navegador headless 47/47, sem PR). Telas de conta, armazenamento por usuário, fila de envio, baixar no login, modo antigo até o primeiro login | 1 |
| 3 | (a escrever) App: plano e metas por pessoa | Formulário do plano com versões, metas de exercício, novo "dia cumprido" e calendário | 2 |
| 4 | (a escrever) App: migração do app antigo | Oferta à primeira conta, envio com fotos, retomada, mover dados locais | 2, 3 |
| 5 | `2026-11-21-aws-lancamento-1.md` | **Concluído**. Stack `saude-familiar` em us-east-2 no ar (commits do branch `feat/aws-infra` até 368f31b), fumaça de ponta a ponta OK. Máquina mantida ligada por decisão do Kaique (~US$ 11,50/mês nos créditos). EC2, Postgres, CloudFront, S3, backup com restauração, alertas, roteiro para o irmão | 1–4; conta AWS do Kaique |
| 6 | (a escrever) Lançamento 2 | Checklist da Rejane, tirar `PLANO` do `data.js`, remover modo antigo | 5 + confirmação |

Domínio: quando o Kaique comprar, entra como ajuste no plano 5 (ou depois dele).

Planos 1, 2 e 5 foram juntados em `feat/contas-ec2` (a642551): servidor 112 ok / 6 skip (pg-real sem URL), site 100 ok, `validar.sh` ok, `testar_maquina.sh` 194/194. Sem PR.

## Checklist do plano 5 (AWS)

Itens que só se provam com Postgres, S3, Turnstile e SMTP reais, e os que a revisão final do plano 1 mandou para cá. Marcados os provados no ar ou no Postgres real (`test:pg` 47/47, fumaça de ponta a ponta).

- [x] Fumaça com `criarBancoPg`, RLS, `SET ROLE`, advisory lock (push/pull de `/sync`) e cascade de `delete from usuarios` sob FORCE RLS, em Postgres real com usuário que não é superusuário.
- [x] Rollback de transação, papel que não vaza após `comoUsuario` e concorrência real no push/pull (`test:pg`).
- [x] `trustProxy`: `TRUST_PROXY_SALTOS=2` com Caddy + CloudFront; `remoteAddress` no journal é o IP real do visitante, nenhum do CloudFront.
- [x] `grant saude_app` nos dois bancos: o provisionamento de 21/11 20:34 confirma os dois donos como membros do papel.
- [x] Foto órfã (LGPD): revarredura em 48 h, maior que a validade da URL assinada.
- [x] `TETO_EMAILS_DIA` inválido: `config.js` recusa o que não for inteiro positivo.
- [x] Retenção de logs: journald com 30 dias e 500 MB (os logs não vão ao CloudWatch).
- [x] Assinatura S3 (POST e GET) na AWS real: upload 204 e leitura 200 idênticos, sem versões nem delete markers após apagar a conta.
- [x] SMTP real (link de confirmação) e Turnstile real em produção e teste. Widget Turnstile no navegador, esqueci-senha e teto diário: só no roteiro manual.
- [x] `principal.js` em execução de verdade (as duas APIs em systemd).
- [x] Fluxo completo com `limites: true` (cadastro, confirmar, entrar, sync, foto, apagar conta).

## Pendências menores que ficaram

Do plano 1, adiadas de propósito (a revisão final marcou como "pode ficar"). Corrigidos e fora da lista: tokens de senha pendentes, logger do Fastify e README.

- `app.js`: OPTIONS dispensa a portaria (inofensivo; o security group só aceita o CloudFront).
- `config.js`: `Number()` sem validação (ver item de `TETO_EMAILS_DIA` acima).
- `ajuda.js` é carregado como teste (0 testes, inofensivo).
- `banco.js`: `release(erro)` quando o rollback falha (correção de uma linha).
- `banco.js`: `migrar` sem advisory lock (hoje é uma instância por banco).
- `banco.js`: `banco.pool` exposto só para teste; evento de erro do pool usa `console.error` sem stack.
- `banco.js`: comentar a divergência de retorno de multi-comando entre pg e PGlite.
- `seguranca.js`: sem teto para N/r/p lidos do hash guardado, e sem teste de parâmetros não padrão.
- E-mail: sem limite de 254 caracteres (aceita 500 KB); `normalizarEmail` duplicado em `contas.js` e `protecao.js`. Unificar e recusar com `400 email`.
- `entrar` não limita o tamanho da senha antes do scrypt (o `bodyLimit` de 1 MB e o limite por IP contêm).
- Escrita extra no banco em um caminho de esqueci/cadastro confirmado (diferença de ~1 ms no tempo de resposta).
- `protecao.js`: `groupId` ignorado pelo plugin de rate-limit (a chave já inclui o nome da rota).
- `protecao.js`: chaves por e-mail dividem o LRU de 5000 com as por IP.
- `protecao.js`: `remoteip` fica `undefined` se o IP faltar (não ocorre com socket real).
- `sincronia.js`: `em` aceita "1" ou "2026" (vira data antiga e é ignorado).
- `sincronia.js`: `\u0000` no valor dá 500 em vez de 400; o plano 2 precisa tratar item venenoso na fila.
- `sincronia.js`: `depois` maior que bigint dá 500.
- `sincronia.js`: `bodyLimit` de 1 MB contra lote de 500 x 64 KB dá 413; decidido manter 1 MB e o app (plano 2) fatiar o lote por bytes (já no README).
- `sincronia.js`: literal do lock duplicado.
- `contas.js`: `DELETE /conta` varre todas as fotos pendentes (latência; poucas contas).
- Testes que faltam: limite por e-mail no cadastro; IP em entrar/esqueci; captcha recusado sem gastar cota; lote misto e `seq` ao reaplicar em `/sync`; rollback de transação; Content-Type e expiração do POST assinado; página S3 só com `NextKeyMarker`; senha errada no DELETE mantém a sessão; depois de 5 min uma mudança com `em` real volta a valer; `Authorization` fora do log; `setTimeout` de 50 ms em `log.test.js` é frágil.

## Pendências do plano 2

Do plano 2, adiadas de propósito (minor deferred não resolvido). Revisão final: 3 Important corrigidos (commits 235690b..a93c407); 1 residual abaixo.

- Parked: `naoGravado` não desliga quando a mudança não gravada é desfeita (`sf-sincronia.js:243`). Falso alarme (status "erro", pendentes >= 1 até a próxima gravação), nenhum dado se perde. Corrigir no início do plano 3, com teste.
- `dev.js`: baseUrl `localhost` x listen `127.0.0.1`; fallback redundante em `contas.js`; `dev.js` sem teste próprio; comentário da ordem key/file no multipart.
- `dev.js`: sem realpath (symlink) nem allowlist de extensões; teste grava `fora-sf.txt` no tmp pai; imports fora de ordem.
- `sf-api.js`: `res.text()` falhando vira TypeError cru; 2xx não-JSON devolve null; `baixar(undefined)`; Authorization enviado em entrar/cadastro com token vencido; regex duplicada no `sw.js`.
- `sf-dados.js`: `copiar` é raso (a sincronia usa cópia profunda).
- `sf-fotos.js`: `fotoId` não validado localmente; sem timeout em `garantir`/baixar (prende só a exibição daquela foto); 403 do S3 tratado como permanente (política vale 300 s, envio expira em 60 s); classificação de erro duplicada; timeout de foto de 60 s curto.
- `sf-sincronia.js`: `rejeitar` deduplica sem atualizar o código; `fotos-enviadas` e avisos sem poda (aproximam o armazenamento cheio; tratar no plano 4); aviso duplicado; status "erro" de armazenamento zera a cada sincronizar; `avisosMem` sem limpeza; timeout só solta a fila, não aborta o fetch; conflito de registro não chama `fotos.garantir`.
- `sf-conta.js`: widget Turnstile não removido e sem saída se o script falha offline; `#confirmar=` com sessão ativa vai para Entrar; "Um instante..." fora de `aria-live`; sem teste de DOM.
- `app.js`: 401 de outra aba chama `aoSair` em vez de `sessaoVencida`; foto offline sem classe `sem-foto` e cópia mensal baixa fotos pela rede (registrar no README); 8 eventos `storage` por atualização remota; pendentes de outro usuário sem fotos pendentes (inalcançável hoje); duas abas: foto baixada só quando aparece.
- `app.js` (Minor da revisão final): `aoEntrar` com o mesmo usuário não chama `recarregarEstado()`; `sessaoMudouEmOutraAba` sem sessão deveria chamar `sessaoVencida()`; "Sair" sem pendências apaga `rejeitados` e avisos sem mencionar; restauração de cópia sobe registro com foto ausente como `foto:null` (plano 4).
- `server/src/app.js`: `x-saude-origem` no CORS depende de `AMBIENTE=teste`, e o feat/aws-infra também roda `AMBIENTE=teste` na EC2 (efeito de segurança nulo, mas "só no dev" não é literal; alternativa: opção de `criarApp` passada só pelo `dev.js`).
- Testes que faltam: contrato cliente x servidor (`sf-api.js` com `app.inject` como fetch); 400 `foto-id` e 403 foto-envio permanentes; 2º teste novo da fila não confere aplicação/não-reenvio do remoto.
- Limpeza do Kaique: dados `mp-*` de teste no Chrome dele em `localhost:5500`.

## Para o plano 3

- Zerar o cursor do `/sync` ao passar a tratar `plano`/`meta`. Hoje o cliente os ignora mas o cursor anda; sem zerar, os aparelhos atuais nunca recebem esses tipos.
- Corrigir o parked `naoGravado` (acima) no início, com teste.
- "Sair com pendências": decidido pela opção A do Kaique, registrada no ADR-004 (em gravação). Alinhar a spec §8.1 ao ADR.

## Rulings do plano 5

Único registro que sobrevive ao ledger. Formato: decisão, com o custo se errado.

- t4g.micro padrão (small permitido), swap 2 GB, Postgres 128MB/20 conexões (decisão do Kaique, ~US$ 12/mês). Se errado: faltar memória; trocar para small em ~5 min.
- Sem WAF (decisão do Kaique; o rate-limit da API basta). Se errado: abuso pesado só freado pela API.
- Nada criado (SSM, stack, change set) antes do OK do Kaique sobre a lista exata de recursos; Task 6 reordenada. Custo: baixo.
- Caddy com `trusted_proxies` static 0.0.0.0/0 + `TRUST_PROXY_SALTOS=2` + teste de IP na Task 8. Se errado: limite compartilhado, ou XFF forjável se a 443 abrir além do CloudFront.
- `provisionar.sh` instala AWS CLI v2 ARM; `.env` com todas as variáveis de `config.js` (inclui SMTP_HOST); `.gitattributes` LF + chmod +x. Custo: baixo (scripts quebram com CRLF).
- Segredos gerados com `openssl rand -hex 32` (base64 quebra DATABASE_URL). Custo: baixo.
- `test:pg` com schema próprio por execução e `search_path` via options da URL; inserts via `comoUsuario`; cópia com `npm ci` completo; testes de rollback e papel que não vaza. Se errado: `set search_path` por conexão e insert como dono falham em Postgres real. Custo: médio.
- Task 8: backup antes de apagar a conta; 403 testado em `/conta`; upload e leitura reais no S3; versões e delete markers conferidos; CORS do bucket POST+GET; Turnstile com segredo de teste. Se errado: a fumaça provava pouco. Custo: médio.
- Task 7: `curl --resolve` com SNI dentro da máquina, nunca o IP público (SG barra; `-k` sem SNI falha). Custo: baixo.
- Task 1 inclui `contas.js` nos Files; revarredura de fotos em 48 h (24 h com timer diário deixa foto órfã passar). Custo: baixo.
- AMI fixada `ami-09c4af6de8b9844f6` (tipo `AWS::EC2::Image::Id`), nunca `current`. Se errado: deploy futuro trocaria a instância com o Postgres no disco raiz. Custo: atualizar a AMI à mão.
- AWS CLI pelo caminho completo no Windows; cfn-lint e shellcheck via uvx; cfn-guard opcional. Custo: baixo.
- Branch `feat/aws-infra` com `REF=feat/aws-infra`, push permitido sem segredos. Custo: baixo (M1 trocou o padrão para `main`; revogado em 22/11: `REF` obrigatório, porque o `main` não tem `server/`).
- Trailer `Co-Authored-By: Claude Opus 5.5` conforme a atribuição da sessão. Custo: baixo.
- P5 Task 1 e P2 Task 1 mexem em `config.js` e `contas.js` em worktrees paralelos; conflitos resolvidos no merge. Custo: merge manual.
- Task 2: corrigir na raiz com a migração 003 (`nullif(current_setting('app.user_id', true), '')::uuid`: sem `app.user_id`, 0 linhas em vez de erro); não editar a 002. Custo: uma migração a mais.
- Task 3 (mandado pelo plano): máquina sem Delete no bucket de backups (só Put/Get/List; expiração pelo lifecycle). Custo: limpeza manual de backup errado precisa do console. A revisão final achou a proteção inexistente sem versionamento; corrigido com versionamento.
- Task 6 Steps 7/9 (README com as saídas) juntos com a Task 7 num só despacho, mesmo arquivo `server/infra/README.md`. Custo: baixo.
- Task 8: Turnstile do teste copiado para `/saude-familiar/teste-guardado/TURNSTILE_SECRET`, trocado pelo segredo público de teste da Cloudflare durante a fumaça e restaurado depois (feito; parâmetro guardado apagado). Custo: teste aceitou qualquer captcha enquanto durou.
- Pool configurável `DB_POOL_MAX`, padrão 5; `carregar-segredos` grava 5 em produção e 3 em teste (2x5+3+backup cabem em 17 vagas úteis). Custo: fila de conexão sob carga alta.
- Task 8 Step 2 aceito: a prova central (`remoteAddress` = IP real do visitante) está no journalctl; o isolamento por origem não foi separado do limite por e-mail. Se errado: limite por IP compartilhado, visível no log.
- Onda de correção única inclui I1, I2, M3, M4 (M1 fica para o merge). Custo: onda maior.
- N1 corrigido apesar de não haver segunda onda (promessa de privacidade da spec §9.2 é load-bearing): lifecycle 23 + 7 dias e `RestartSec=10`. Custo: restauro só até 23 dias atrás.

## Pendências menores do plano 5

Sem bloqueio. A revisão final recomendou fechar antes de abrir para usuários reais: o laço de reinício e a memória (M4, corrigido no código, falta aplicar na máquina), o `test:pg` contra as conexões (M3, idem) e o `REF` (M1, feito no merge).

- `restaurar.sh` só enxerga 23 dias (objeto atual); os dias 24 a 30 existem só como versão antiga, recuperável pelo console.
- `testar_maquina.sh` passou a ignorar `CAMINHO_SITE` no merge (padrão `/saude-familiar/` está certo para o Pages).
- `fumaca.sh` põe o token de sessão em `-H` na linha de comando; `printf` com quebra literal; estado com senha em `~/.saude-fumaca` não é apagado após apagar a conta; `validar.sh` usa `shellcheck.exe`.
- `OnFailure=saude-alerta@%n.service` gera o nome `saude-alerta@saude-api@producao.service.service`; funciona por desenho do systemd, mas não foi testado disparando. Mais limpo com `%N`.
- Reinício de prova: feito em 22/11 (Postgres antes das APIs, ~25 s fora, sem falha).
- O widget Turnstile real só é provado no roteiro manual.
- Update da stack e reprovisionamento de `368f31b`: aplicados em 21/11, conferidos em 22/11.
- `principal.js` em `127.0.0.1`: corrigido com teste em 22/11; falta implantar.
- `restaurar.sh:154`: `create database` nasce com CONNECT para PUBLIC; acrescentar `revoke connect ... from public`. As duas APIs usam o mesmo usuário `saude`: isolamento teste x produção é de dados de ensaio, não fronteira de segurança.
- `postgres.sql`: acrescentar `SET log_min_error_statement = panic;` (senha em `ALTER ROLE` falho iria ao log).
- `server/.env.example` sem `TRUST_PROXY_SALTOS` e `DB_POOL_MAX`.
- Segredo cruzado (`https://<UrlProducao>/teste/conta`): 403 conferido em 22/11; falta incluir no `fumaca.sh`.
- README raiz: avisar que `cabecalhoOrigemDev` em `config.js` é só para o servidor de desenvolvimento e nunca recebe o `SEGREDO_ORIGEM` real do teste (site público).
- `CONNECTION LIMIT 8` de `saude_dono_teste` não foi exercitado na máquina; se `test:pg` falhar por limite, subir para 10. README sem aviso de que `test:pg` usa swap e conexões da máquina de produção; README sem `DB_POOL_MAX`.
- Do ledger (T1): laço de `apagarFotosPendentes` duplicado (`contas.js:147-160` x `243-260`); 48h repetido em `tarefas.js:175`; conta recém-apagada processada 2x; `trustProxySaltos` sem default em config montada à mão.
- Do ledger (T2): `libera()` fora de `finally` no teste da trava; parte 1 da trava usa lock do próprio teste; teste de órfãos quase tautológico; guarda contra `TEST_DATABASE_URL` apontar para produção.
- Do ledger (T3): `SSMManagedInstanceCore` dá GetParameter em `*`; sem Rules travando região; sem política negando acesso sem TLS nos buckets; `Compress` inútil com CachingDisabled; asserção fraca de `*`; cfn-lint sem `--regions us-east-2`; filtro do teste por nome lógico; runbook: apagar a stack deixa máquina e volume (custo) e solta o IP.
- Do ledger (T4): `saude-api@` sem `MemoryMax` nem `--max-old-space-size` (folga medida de ~450 MB); swap meio criado quebra idempotência (`provisionar.sh:331-337`); AWS CLI sem GPG nem atualização; valores do `.env` sem validação de aspas, `\` e `$`; `saude-disco` sem hardening e `saude-fotos` sem `Wants=network-online`; restart do Postgres incondicional e `/opt/node` sem limpeza; `disco.sh` falha calado se `df` falhar; CONNECT PUBLIC em postgres/template1; testes de texto em vez de comportamento.
- Do ledger (T5): lista `contas_apagadas.csv` no S3 a cada backup (janela de até 24 h sem cópia); grep sem match encerra calado (`restaurar.sh`); `distinct on` pode escolher `fotos_apagadas_em` nulo; testes do `--substituir` sem ordem start/delete nem falha do `pg_restore`; `backup.sh` não diz a etapa que falhou; sem teste de export do vivo falhando; reservas `_reserva_*` se acumulam; fake do `s3 ls` nunca exercita rc=1 vazio nem rc 1 com stderr (conferir na máquina `aws s3 ls` em prefixo vazio).
- Do ledger (T7): `ajuda.js` com `banco.fechar()` seguido de `app.close()` falharia; `maquina.env` 644 (só dados não secretos).
- Fora do plano (aceitos): segredo de origem em texto claro na config do CloudFront; limite por IP contornável por rotação de IPv6 num /64; RPO de 24 h; backups guardam dados de contas apagadas por até 30 dias (aviso na política de privacidade); a máquina roda o que estiver no branch do GitHub.
