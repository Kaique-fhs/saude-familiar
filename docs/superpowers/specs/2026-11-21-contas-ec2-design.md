# Saúde Familiar com contas (AWS EC2 + Postgres) — design

Data: 2026-11-21 · Projeto: `saude-familiar` (app Saúde Familiar; antes `plano-alimentar` / Meu Prato) · Status: aprovado pelo Kaique em 2026-11-21; atualizado em 2026-11-21 com ADR-002 (login próprio), ADR-003 (região us-east-2) e o nome novo

## 1. Intenção

Hoje o Saúde Familiar (antes Meu Prato) é o app de uma pessoa só: o plano alimentar da Rejane está escrito no `data.js`
e tudo o que ela marca (diário, checks, treinos, registros com foto) fica só no aparelho dela.

O Kaique quer que **outras pessoas criem conta** e usem o mesmo app, **cada uma com o próprio
plano** (cadastrado por ela mesma, e opcional) e com **metas de exercício físico próprias**.
Os dados de cada pessoa passam a ficar na conta dela, num servidor próprio na AWS (EC2 com
Postgres, estrutura indicada pelo irmão do Kaique, que é consultor), sem perder o que o app faz
hoje, inclusive funcionar sem internet.

## 2. Objetivos

1. Cadastro, confirmação de e-mail, login, saída e "esqueci minha senha" com e-mail e senha.
2. Cada pessoa vê e mexe só nos próprios dados.
3. **Plano alimentar por pessoa, opcional**, cadastrado pela própria pessoa no app.
4. **Metas de exercício por pessoa**, cada uma com seu jeito de medir.
5. **Guarda no aparelho e sincroniza**: o app continua gravando local primeiro; envia para a
   conta quando houver internet; num aparelho novo, baixa o que está na conta.
6. **Migração sem perda**: no primeiro login num aparelho com dados do app antigo, o app oferece
   levar tudo para a conta (é assim que a Rejane leva o plano, o histórico e as fotos).
7. Fotos dos registros vão para a nuvem (S3), no tamanho atual (1024 px).

## 3. Não objetivos (fora desta onda)

- Domínio próprio (o servidor usa o endereço do CloudFront; domínio pode entrar depois).
- Login com Google ou outro provedor.
- Importar plano a partir de PDF, ou nutricionista cadastrando/acompanhando pacientes.
- Compartilhar dados entre contas.
- Mudar as receitas: `RECEITAS` continua no `data.js`, igual para todos.
- O projeto `2 - fodmap` (Prato Leve).
- Limpar o plano da Rejane do histórico do git (decisão pendente do Kaique, ver §11).
- Alta disponibilidade (uma máquina só; se ela cair, o app segue funcionando offline e sincroniza
  quando voltar).

## 4. Antiobjetivos (falha mesmo que "funcione")

- A Rejane (ou qualquer pessoa) perder diário, registros ou **fotos** na troca de versão.
- Uma conta conseguir ler dado de outra, por qualquer caminho (API, foto, URL).
- O app parar de funcionar offline para o que funciona hoje (marcar refeição, tirar foto, ver plano).
- Marcação feita em um aparelho sumir porque outro aparelho sincronizou depois.
- Mudar o plano ou as metas reescrever o resultado de dias que já passaram.
- Senha do banco, chave da AWS ou senha do Gmail aparecerem no site ou no repositório.
- Perder o banco porque a máquina quebrou (backup é obrigatório desde o primeiro dia).

## 5. Restrições

- **Site** continua estático, sem build, no GitHub Pages pela branch `main`
  (`https://kaique-fhs.github.io/saude-familiar/`; o endereço antigo `/plano-alimentar/` redireciona).
- **Só site por enquanto** (decisão do Kaique): sem convite para instalar o app; o service worker
  continua, para o site abrir sem internet.
- **Servidor** numa EC2 na região do projeto AWS, **us-east-2** (ADR-003: o projeto não permite outra
  região; mesmo preço da us-east-1). Latência maior não prejudica: o app grava primeiro no aparelho.
- Sem domínio próprio: HTTPS vem do **CloudFront** (`https://<id>.cloudfront.net`) na frente da EC2.
- Sem domínio, os serviços de e-mail profissionais (SES, Resend) não entregam para qualquer
  pessoa. E-mail sai por **Gmail SMTP** com uma conta criada só para o app e senha de app
  (limite de algumas centenas por dia). Com domínio no futuro, troca para SES por configuração.
- Custo estimado após os créditos iniciais da AWS: ~US$ 10–17/mês (máquina pequena, disco, IP
  fixo) + centavos de S3. Nada além disso sem o Kaique concordar.
- Dados de saúde (LGPD): a pessoa precisa conseguir **apagar a própria conta e todos os dados**,
  inclusive fotos.
- Contas externas (AWS, Gmail do app) são criadas pelo Kaique. A sessão acessa a AWS pela linha de
  comando com `aws login` no perfil `saude-familiar` (credencial temporária, sem chave guardada)
  e pelo MCP da AWS; projeto AWS na nova experiência, com as regras do `CLAUDE.md`.

## 6. Abordagens consideradas

### Servidor (decisão do Kaique, por indicação do irmão)

| Abordagem | Troca | Decisão |
|---|---|---|
| Supabase (pronto, grátis) | Login, banco e fotos prontos; limites do plano grátis e pausa por inatividade | Substituída pela EC2 |
| **EC2 + Postgres + API própria** | Controle total, sem pausa nem limites de plano; custa ~US$ 10–17/mês e exige construir API, login e manter a máquina | **Escolhida** |
| Supabase auto-hospedado na EC2 | Tudo pronto, mas pede máquina de 4 GB+ (~US$ 25–30/mês) | Descartada |

### Sincronização (decisão do Kaique)

| Abordagem | Troca | Decisão |
|---|---|---|
| **Local primeiro + sincronização** | Mantém offline; custa fila de envio e regra de conflito | **Escolhida** |
| Só na nuvem | Mais simples; perde o offline | Descartada |

### HTTPS sem domínio (decisão do Kaique)

| Abordagem | Troca | Decisão |
|---|---|---|
| **CloudFront na frente da EC2** | Dentro da AWS, grátis no limite permanente; endereço feio (só o app usa) | **Escolhida** |
| DuckDNS + Let's Encrypt | Simples, mas depende de serviço gratuito pequeno | Descartada |

## 7. O que foi decidido

Pelo Kaique: cadastro aberto; plano por pessoa, opcional, cadastrado pela própria pessoa; o plano
atual é da **Rejane** e vai para a conta dela; metas de exercício em que **cada meta escolhe**
entre dias fixos ou vezes por semana, com **duração opcional**; guarda no aparelho e sincroniza;
EC2 com Postgres; CloudFront; região do projeto (us-east-2); **login próprio, sem biblioteca** (ADR-002).

Propostas da sessão aceitas pelo Kaique (sem objeção): Node.js no servidor; fotos no S3; backup diário do banco para o S3; e-mail por Gmail até haver
domínio.

## 8. Como funciona — app

### 8.1 Conta e acesso

- **Login obrigatório**: sem sessão, o app mostra só a tela de entrar/criar conta.
  *(Decisão da sessão: dados de saúde e plano por pessoa.)*
- Telas: entrar, criar conta, confirmar e-mail, esqueci minha senha, definir nova senha (link do
  e-mail abre o app no GitHub Pages com o token), e no app um item "Conta" com e-mail, sair e
  **apagar minha conta**.
- Sessão fica guardada no aparelho; abrir o app offline com sessão já salva funciona.
- Ao sair, o app apaga do aparelho os dados daquela conta depois de confirmar que não há nada
  pendente de envio; se houver, avisa e pede confirmação.
- Apagar conta: o servidor apaga linhas, fotos do S3 e o usuário, numa operação só.

### 8.2 Plano alimentar (por pessoa, opcional)

- O formulário espelha o formato de `PLANO` atual: refeições (nome, horário opcional, kcal
  opcional, ordem); itens (principal + opções de troca); observações por refeição (opcional);
  quadro de nutrientes (opcional); lista de compras do plano (opcional); data de prescrição
  (opcional).
- Sem plano: as telas que dependem dele mostram um convite "Cadastrar meu plano"; receitas,
  lista de compras das receitas e exercícios funcionam normalmente.
- **Dias passados não mudam ao editar o plano.** *(Decisão da sessão.)* O plano tem versões com
  "vale desde": editar cria uma versão que vale a partir de hoje; o "dia cumprido" de um dia
  passado usa a versão que valia nele. Registros guardam o texto da escolha.
- **Ids de refeição são estáveis**: criados uma vez e nunca reaproveitados; renomear ou reordenar
  mantém o id; apagar uma refeição cria nova versão do plano sem ela.
- **Refeição atual sem horário fixo no código**: com horário cadastrado, a refeição atual é a do
  horário; sem horário, é a primeira ainda não feita na ordem do plano. "Atrasada" só existe para
  refeição com horário. Nomes curtos vêm do nome cadastrado. Quadro de nutrientes só aparece se
  foi preenchido.

### 8.3 Metas de exercício

- Cada meta: nome da atividade (texto livre), modo **dias fixos** (dias da semana) ou **vezes por
  semana** (1 a 7), duração opcional (minutos), `desde`/`ate`.
- Editar uma meta encerra a antiga (`ate` = ontem) e cria outra (`desde` = hoje).
- Marcação é "feito / não feito" no dia; a duração é só a meta mostrada.
  *(Decisão da sessão: não registrar duração real nesta onda.)*
- **Dia cumprido** = todas as refeições do plano vigente naquele dia + todas as metas de **dias
  fixos** daquele dia. Metas de **vezes por semana não entram no dia**; aparecem como progresso
  semanal ("2 de 3 nesta semana", semana de segunda a domingo). Sem plano, o dia cumprido conta
  só as metas de dias fixos; dia sem nada programado não conta na sequência (nem quebra, nem
  soma). *(Decisões da sessão.)*
- No calendário, a visão "exercício físico" marca os dias com exercício feito e mostra a semana
  como cumprida quando as metas semanais foram atingidas.

### 8.4 Sincronização (local primeiro)

- O app continua lendo e gravando o estado local. Armazenamento local com **prefixo por id de
  usuário** (chaves e IndexedDB).
- Toda gravação também entra numa **fila de envio** local, enviada quando há internet (ao abrir,
  ao voltar a conexão e logo após gravar). A fila sobrevive a fechar o app.
- Ao entrar num aparelho (ou abrir com internet), o app pede ao servidor o que mudou desde a
  última sincronização e junta com o local.
- **Regra de conflito** (unidade pequena: uma marcação por dia e item, um registro por
  dia+refeição, um favorito, um item do "quero"): marcações dos aparelhos se **somam**; desmarcar
  é gravado como marcação desfeita com hora, e para o mesmo item vale a ação mais recente. Plano e
  metas: vale a versão gravada por último. *(Decisão da sessão.)*
- **Registro com foto**: foto registrada não pode ser trocada nem apagada (regra atual). O primeiro
  registro de um dia+refeição que chega ao servidor vale; o outro aparelho recebe a versão do
  servidor, avisa ("esta refeição já foi registrada em outro aparelho") e guarda a foto descartada
  no aparelho até a próxima cópia mensal.
- Fotos: o app pede ao servidor uma **URL assinada de envio** e sobe a foto direto para o S3; o
  registro só é confirmado quando a foto subiu. Num aparelho novo, as fotos são baixadas sob
  demanda por URL assinada de leitura (curta) e guardadas no IndexedDB.
- A tela mostra o estado: "salvo no aparelho, enviando…" / "tudo salvo na conta" / "sem internet,
  envio pendente".
- O service worker não guarda em cache nenhuma chamada ao servidor.

### 8.5 Migração do app antigo

- Os dados `mp-*` antigos (e as fotos do IndexedDB `meu-prato`) são oferecidos **só à primeira
  conta que entrar naquele aparelho**: "Levar o que está salvo neste aparelho para a sua conta?".
  Recusados, ficam guardados e só essa conta pode retomar a oferta (ou apagá-los pelo item
  "Conta"). Outra conta no mesmo aparelho nunca vê a oferta. Sair não apaga dados antigos não
  migrados.
- Sim: envia favoritas, seleção, checks, checks do plano, "quero", diário, treinos, registros,
  fotos e — se a conta ainda não tiver plano nem metas — o plano e os exercícios do app antigo.
  Mostra progresso das fotos; só marca como migrado depois de tudo confirmado no servidor; se
  cair no meio, retoma.
- **Plano e metas migrados mantêm o passado**: o plano entra como versão **sem data de início**,
  com os ids atuais (`acordar`, `cafe`, `almoco`, `lanche`, `jantar`) preservados; as metas
  mantêm `desde = 2026-11-01`.
- **Dois lançamentos.** Lançamento 1: app com contas e migração, `PLANO` ainda no `data.js`.
  A Rejane migra no celular dela; o Kaique confirma com ela e a sessão confere no banco de
  produção que a conta dela tem plano, registros e fotos. Lançamento 2: remove `PLANO` do `data.js`.
- **Cópia e restauração continuam por arquivo.** Exportar segue igual. Restaurar grava no local e
  entra na fila de envio, seguindo a regra de conflito (soma marcações, não desmarca).
- **Modo antigo até o primeiro login (só no lançamento 1).** *(Decisão da sessão.)* Aparelho com
  dados `mp-*` e sem sessão continua abrindo no modo antigo: tudo local, plano do `data.js`,
  offline como hoje, com uma faixa "Crie sua conta para guardar seus dados". O login obrigatório
  vale para aparelhos sem dados antigos. Assim a Rejane nunca fica sem o app por falta de internet
  ou de e-mail confirmado. O modo antigo sai no lançamento 2.
- **Depois da migração confirmada**, os dados antigos são **movidos** para o armazenamento da conta
  no aparelho (fotos incluídas, viram a cópia local da conta) e as chaves `mp-*` antigas só são
  apagadas depois que o servidor confirmou cada item. Nada é apagado antes disso.
- **Lançamento 2 só sai com checklist**: a Rejane migrou e a sessão conferiu no banco; o Kaique
  migrou ou descartou os dados antigos do próprio navegador. Depois do lançamento 2, um aparelho
  antigo esquecido ainda migra os registros e fotos, mas não o plano (aceito: não há outro usuário
  do app antigo conhecido).

## 9. Como funciona — servidor

### 9.1 Peças

```
Celular / navegador  ──HTTPS──>  GitHub Pages  (site estático, como hoje)
        │
        └──HTTPS──>  CloudFront (https://<id>.cloudfront.net, cache desligado)
                         │  HTTPS + cabeçalho secreto (security group só com a lista de IPs do CloudFront)
                         v
                     EC2 us-east-2 (máquina pequena, Linux, IP fixo)
                       ├─ API Node.js (serviço do sistema, reinicia sozinho)
                       │    ├─ login próprio (node:crypto) ── e-mail ──> Gmail SMTP
                       │    ├─ sincronização, plano, metas, conta
                       │    └─ URLs assinadas ──> S3 (fotos, privado)
                       └─ Postgres (só escuta na própria máquina)
                             └─ backup diário (pg_dump) ──> S3 (backups, 30 dias)
```

### 9.2 Regras do servidor

- **API Node.js com login próprio** (ADR-002), só com `node:crypto`: senha com `scrypt` e sal por
  usuário; sessão por token aleatório de 32 bytes no cabeçalho `Authorization`, banco guarda só o
  hash SHA-256; sessão expira após 60 dias sem uso e sair apaga a sessão; tokens de confirmação
  (24 h) e de troca de senha (1 h) de uso único, guardados como hash; comparação em tempo
  constante; cadastro e "esqueci minha senha" respondem igual exista ou não o e-mail; trocar a
  senha encerra todas as sessões. Toda rota de dados exige sessão e filtra pelo id do usuário da sessão; além disso, o Postgres
  usa RLS por usuário como segunda trava. *(Decisão da sessão.)*
- **CORS** liberado só para `https://kaique-fhs.github.io` (e `http://localhost` no teste).
- **Sessão** entre domínios diferentes (GitHub Pages × CloudFront): token no cabeçalho
  `Authorization`, guardado no aparelho (sem cookie, que o Safari bloqueia entre domínios).
- **CloudFront**: cache desligado para a API, repassa cabeçalhos `Authorization` e de CORS.
- **Trecho CloudFront → EC2 também em HTTPS.** *(Decisão da sessão: passam senha, token e dados de
  saúde.)* Sem domínio, a EC2 usa um nome grátis baseado no IP fixo (ex.: `1-2-3-4.sslip.io`)
  com certificado Let's Encrypt renovado sozinho, e o CloudFront usa esse nome como origem.
  Além disso, o CloudFront envia um **cabeçalho secreto** que a API confere (recusa sem ele),
  porque a lista de IPs do CloudFront é pública. Alternativa para o irmão avaliar: origem VPC do
  CloudFront (EC2 sem IP público), se o custo de saída para internet couber.
- **Proteção contra abuso**: limite de requisições por IP e por e-mail em cadastro, login e
  "esqueci minha senha", e teto diário de e-mails enviados abaixo do limite do Gmail.
  Mais **captcha invisível Cloudflare Turnstile** (grátis) em criar conta e "esqueci minha senha",
  conferido pela API antes de mandar e-mail. *(Decisão do Kaique: opção B.)*
- **Postgres** na própria EC2, aceitando conexão só da máquina. Dois bancos: **teste** e
  **produção**, e duas instâncias da API (ou duas portas/rotas), para ensaiar migração e regras
  sem tocar nos dados reais. *(Decisão da sessão.)*
- **S3**: um bucket privado para fotos (caminho `<ambiente>/<user_id>/<foto_id>.jpg`) e um para
  backups, com bloqueio de acesso público. A EC2 acessa o S3 por papel IAM da máquina, sem chave
  guardada em arquivo.
- **Segredos** (senha do banco, senha de app do Gmail, segredo do cabeçalho do CloudFront, chave do Turnstile) ficam num arquivo
  de ambiente na EC2, fora do repositório; o repositório só tem um exemplo sem valores.
- **Backup**: `pg_dump` diário dos dois bancos para o S3, guardando 30 dias; teste de restauração
  antes do lançamento 1.
- **Contas apagadas não voltam com backup.** *(Decisão da sessão, LGPD.)* O servidor guarda só o
  id e a data de cada conta apagada (sem dado pessoal); o roteiro de restauração reaplica essas
  exclusões. A política de privacidade do app avisa que cópias de segurança somem em até 30 dias.
- **Fotos protegidas contra exclusão acidental**: versionamento ligado no bucket de fotos, com
  versões antigas expirando em 30 dias; apagar conta remove todas as versões.
- **Manutenção**: atualizações de segurança automáticas do sistema; alerta de custo na AWS
  (orçamento com aviso por e-mail ao Kaique) e alerta se o disco passar de 80%.
- **Código do servidor** fica no mesmo repositório, numa pasta `server/`, com migrações SQL
  versionadas; o site continua sem build.

### 9.3 Configuração externa (feita com o Kaique)

1. Feito em 21/11/2026: conta AWS criada (projeto na nova experiência, região us-east-2), AWS CLI
   e Agent Toolkit configurados, perfil `saude-familiar`.
2. Kaique cria a conta Gmail do app e a senha de app.
3. A sessão cria EC2, IP fixo, security group, papel IAM, buckets S3, CloudFront, orçamento de
   alerta; instala Postgres, a API e o backup; registra cada passo num roteiro em `server/` para
   o irmão do Kaique poder revisar e refazer.

## 10. Fica com o construtor

- Esquema exato das tabelas, da fila de envio e das rotas da API.
- Framework HTTP do Node (Fastify, Express etc.) e como rodar o serviço (systemd, Docker).
- Tipo exato da instância (a menor que aguente Node + Postgres com folga) e tamanho do disco.
- Infra por script/CLI ou por ferramenta de infraestrutura como código.
- Layout das telas de conta e dos formulários, no estilo atual (`styles.css`).
- Como dividir o `app.js` (90 KB) se ajudar, sem build.
- Estratégia de testes (o projeto hoje não tem testes automatizados).

## 11. Pendências do Kaique

- **Domínio**: o Kaique vai comprar e avisar. Quando vier, ajustar: e-mail por SES com o domínio,
  certificado da AWS (ACM) no lugar do sslip.io, `api.<domínio>` no CloudFront e, se quiser, o
  site no domínio. Nada do app muda.

- Limpar o plano da Rejane do histórico do git do repositório público: sim ou não (fora desta onda).
- Avisar a Rejane antes do lançamento 1.
- Mostrar este documento ao irmão (consultor) antes de começar.
- A decisão de arquitetura vira ADR no projeto depois da aprovação.
