# Meu Prato

Site estático (HTML/CSS/JS, sem build) para consultar o plano alimentar, ver as receitas,
favoritar e gerar a lista de compras das receitas escolhidas.

- Favoritas, receitas escolhidas e itens marcados ficam salvos só no navegador do aparelho (localStorage).
- Conteúdo em `data.js`. Para atualizar o plano, edite esse arquivo.
- Publicado pelo GitHub Pages a partir da branch `main`.
- Funciona offline (service worker em `sw.js`). Para atualizar o plano, basta editar o `data.js`: o app instalado pega a versão nova na abertura seguinte (abre uma vez com a cópia guardada e baixa a nova por trás). Para valer na hora, aumente `VERSAO` em `sw.js` e o `?v=` no `index.html`.
