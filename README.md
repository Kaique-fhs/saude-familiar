# Saúde Familiar

Site estático (HTML/CSS/JS, sem build) para consultar o plano alimentar, ver as receitas,
favoritar e gerar a lista de compras das receitas escolhidas.

- Favoritas, receitas escolhidas e itens marcados ficam salvos só no navegador do aparelho (localStorage).
- Conteúdo em `data.js`. Para atualizar o plano, edite esse arquivo.
- Publicado pelo GitHub Pages a partir da branch `main`.
- Funciona offline (service worker em `sw.js`). Para atualizar o plano, basta editar o `data.js`: o app instalado pega a versão nova na abertura seguinte (abre uma vez com a cópia guardada e baixa a nova por trás). Para valer na hora, aumente `VERSAO` em `sw.js` e o `?v=` no `index.html`.

## Conta e sincronização (em desenvolvimento)

- `config.js` versionado aponta para a API de produção (só valores públicos; `cabecalhoOrigemDev` fica sempre vazio). Com `apiUrl: ""` o site funciona só no aparelho, sem tela de entrar nem fila.
- Com `apiUrl` preenchido, quem entra numa conta tem os dados guardados no aparelho em chaves `sf:<id>:*` (fotos no IndexedDB `saude-familiar-<id>`) e enviados para a conta. Um aparelho que já usou o app antigo (qualquer chave `mp-*`) e não tem sessão abre no modo antigo: grava em `mp-*`, sem chamada à API, com a faixa "Crie sua conta para guardar seus dados". Ao criar a conta, nada é copiado sozinho (ver "Migração do app antigo").

### Plano alimentar e metas por pessoa (plano 3)

- Com conta, o `PLANO` do `data.js` não aparece. Cada conta vê o próprio plano. Sem plano cadastrado, a tela Plano mostra o convite "Cadastrar meu plano".
- Cadastrar ou editar o plano: rota `#plano/editar` (botão "Cadastrar meu plano" ou "Editar plano"). Só existe com conta. Cada edição gera uma versão nova; o dia antigo continua pelo plano que valia nele.
- Metas de exercício: rota `#metas` (botão "Metas de exercício"). Só com conta. O treino marcado vale pela origem da meta: editar uma meta não perde a marca do dia nem o progresso da semana.
- Mudança no modo antigo (aparelho com `mp-*`, sem conta): refeição sem horário não aparece mais como "atrasada". Aparece como "a fazer". Só refeição com horário vence.
- O cliente guarda `plano` e `meta` e os sincroniza pelo `/sync`. O cursor do `/sync` zera uma vez (versão `cursor-versao`) para os aparelhos receberem esses tipos.
- Cache do service worker na versão 38 (`meu-prato-v38`, subiu no plano 4).
- Estado: implementado no branch `feat/aceite-site`, sem push. Não está implantado nem publicado.

### Migração do app antigo (plano 4)

- Remove a trava 2 do ADR-005. Aparelho com dados antigos e sem sessão abre no modo antigo, gravando em `mp-*`, com a faixa "Crie sua conta para guardar seus dados".
- Só a primeira conta do aparelho, depois da primeira sincronização, recebe a oferta "Levar o que está salvo neste aparelho para a sua conta?". Outra conta no mesmo aparelho nunca vê a oferta.
- A migração envia registros e fotos, retoma se for interrompida e guarda o andamento num marcador.
- Os dados antigos só são apagados depois de o servidor confirmar tudo. Se a conferência não fechar, a limpeza automática para e a tela Conta explica o motivo. Dá para apagar à mão em "Apagar dados antigos" (pede um segundo toque).
- Estado: implementado no branch `feat/aceite-site`, sem push e sem deploy. Site 209 testes ok; servidor 125 ok e 6 pulados (só rodam em Postgres real).

Servidor e infraestrutura (planos 3 e 4): limpeza diária de cadastros não confirmados (commit f7e68f2) e segundo e-mail opcional de alerta (commit b9b2b8e, ainda não aplicado na stack).

### Rodar com o servidor de desenvolvimento

```
cd server
npm install
npm run dev
```

O site abre em http://localhost:5500 e a API em http://127.0.0.1:3000. O servidor de desenvolvimento troca o `config.js` pelos valores de dev, imprime no console os e-mails (com o link de confirmar a conta) e guarda fotos em `server/.fotos-dev` e o banco em `server/.pg-dev`.

### Testes

- Site (na raiz do repositório): `node --test "tests/*.test.js"`
- Servidor: `cd server && npm test`
