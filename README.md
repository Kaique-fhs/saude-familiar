# Saúde Familiar

Site estático (HTML/CSS/JS, sem build) para consultar o plano alimentar, ver as receitas,
favoritar e gerar a lista de compras das receitas escolhidas.

- Favoritas, receitas escolhidas e itens marcados ficam salvos só no navegador do aparelho (localStorage).
- Conteúdo em `data.js`. Para atualizar o plano, edite esse arquivo.
- Publicado pelo GitHub Pages a partir da branch `main`.
- Funciona offline (service worker em `sw.js`). Para atualizar o plano, basta editar o `data.js`: o app instalado pega a versão nova na abertura seguinte (abre uma vez com a cópia guardada e baixa a nova por trás). Para valer na hora, aumente `VERSAO` em `sw.js` e o `?v=` no `index.html`.

## Conta e sincronização (em desenvolvimento)

- `config.js` versionado aponta para a API de produção (só valores públicos; `cabecalhoOrigemDev` fica sempre vazio). Com `apiUrl: ""` o site funciona só no aparelho, sem tela de entrar nem fila.
- Com `apiUrl` preenchido, quem entra numa conta tem os dados guardados no aparelho em chaves `sf:<id>:*` (fotos no IndexedDB `saude-familiar-<id>`) e enviados para a conta. Um aparelho que já usou o app antigo (qualquer chave `mp-*`) e não tem sessão continua como antes, sem conta nem chamada à API, até existir a migração (plano 4). Os dados antigos não são apagados nem copiados. Com conta, o `PLANO` do `data.js` não aparece: até o plano 3, Plano e Frequência mostram "em breve".

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
