(function () {
  "use strict";

  var PLANO = window.PLANO;
  var RECEITAS = window.RECEITAS;
  var main = document.getElementById("conteudo");

  // ---------- armazenamento local (só neste aparelho) ----------
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; }
    catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }
  var favs = ler("mp-favs", []);
  var sel = ler("mp-sel", []);
  var checks = ler("mp-checks", {});
  var checksPlano = ler("mp-checks-plano", {});
  var despensa = ler("mp-despensa", []);
  var termoDesp = "";
  var filtro = "todas";
  var termo = "";

  function salvarTudo() {
    gravar("mp-favs", favs);
    gravar("mp-sel", sel);
    gravar("mp-checks", checks);
    gravar("mp-checks-plano", checksPlano);
    gravar("mp-despensa", despensa);
    atualizarContador();
  }

  function alternar(lista, id) {
    var i = lista.indexOf(id);
    if (i >= 0) { lista.splice(i, 1); return false; }
    lista.push(id); return true;
  }

  // ---------- utilidades ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function semAcento(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function porId(id) { for (var i = 0; i < RECEITAS.length; i++) if (RECEITAS[i].id === id) return RECEITAS[i]; return null; }
  var TIPOS = { doce: "Doce", salgado: "Salgada", pao: "Pão" };

  var toastEl = document.getElementById("toast"), toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  var ICON = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M20 6 9 17l-5-5"/></svg>',
    chevron: '<svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg>'
  };

  // ---------- lista de compras a partir das receitas ----------
  // Cada regra liga o texto do ingrediente a um produto do mercado. A primeira que casar vence.
  var REGRAS = [
    [/gergelim e linha/, ["Gergelim", "Linhaça (farinha ou semente)"]],
    [/leite de castanha/, "Leite de castanha de caju com coco"],
    [/leite de amendoa/, "Leite de amêndoa"],
    [/farinha de amendoa/, "Farinha de amêndoas"],
    [/amendoa torrada/, "Amêndoa torrada"],
    [/\bovos?\b|clara|gema/, "Ovos"],
    [/atum/, "Atum em lata"],
    [/frango/, "Peito / filé de frango"],
    [/carne moida/, "Carne moída"],
    [/parmesao/, "Queijo parmesão ralado"],
    [/mucarela|mussarela/, "Queijo muçarela"],
    [/iogurte/, "Iogurte natural desnatado"],
    [/banana/, "Banana"],
    [/manga/, "Manga palmer (congelada)"],
    [/limao/, "Limão tahiti"],
    [/gengibre/, "Gengibre"],
    [/\bmacas?\b/, "Maçã"],
    [/morango/, "Morango"],
    [/kiwi/, "Kiwi"],
    [/abacate/, "Abacate"],
    [/alface/, "Alface americana"],
    [/rabanete/, "Rabanete"],
    [/abobrinha/, "Abobrinha"],
    [/cenoura/, "Cenoura"],
    [/tomate/, "Tomate"],
    [/azeitona/, "Azeitonas pretas"],
    [/batata/, "Batata inglesa"],
    [/\balho\b/, "Alho"],
    [/gergelim/, "Gergelim"],
    [/linhaca/, "Linhaça (farinha ou semente)"],
    [/chia/, "Semente de chia"],
    [/aveia/, "Aveia (flocos, farelo ou farinha)"],
    [/tapioca/, "Goma de tapioca"],
    [/farinha de arroz/, "Farinha de arroz"],
    [/polvilho/, "Polvilho doce"],
    [/farinha de coco/, "Farinha de coco"],
    [/flocao de milho/, "Flocão de milho"],
    [/flocos de milho/, "Flocos de milho sem glúten"],
    [/fermento/, "Fermento químico em pó"],
    [/acucar mascavo/, "Açúcar mascavo"],
    [/chocolate/, "Chocolate 70%"],
    [/cacau/, "Cacau em pó"],
    [/uvas? passas?/, "Uva passa"],
    [/tamara/, "Tâmara seca"],
    [/castanha-do-para/, "Castanha-do-pará"],
    [/macadamia/, "Macadâmia"],
    [/semente de abobora/, "Semente de abóbora"],
    [/manteiga/, "Manteiga ghee (ou óleo)"],
    [/azeite/, "Azeite de oliva"],
    [/\bsal\b/, "Sal"],
    [/canela/, "Canela em pó"],
    [/cheiro verde/, "Cheiro verde"],
    [/oregano/, "Orégano"],
    [/\bagua\b/, null],
    [/tempero/, "Temperos naturais"]
  ];
  var CATEGORIA = {
    "Ovos": "Proteínas", "Atum em lata": "Proteínas", "Peito / filé de frango": "Proteínas", "Carne moída": "Proteínas",
    "Queijo parmesão ralado": "Laticínios", "Queijo muçarela": "Laticínios", "Iogurte natural desnatado": "Laticínios",
    "Leite de castanha de caju com coco": "Bebidas vegetais", "Leite de amêndoa": "Bebidas vegetais",
    "Sal": "Temperos", "Temperos naturais": "Temperos", "Orégano": "Temperos", "Canela em pó": "Temperos", "Cheiro verde": "Hortifrúti",
    "Gengibre": "Hortifrúti", "Alho": "Hortifrúti"
  };
  var FRUTAS = ["Banana", "Manga palmer (congelada)", "Limão tahiti", "Maçã", "Morango", "Kiwi", "Abacate", "Alface americana", "Rabanete", "Abobrinha", "Cenoura", "Tomate", "Batata inglesa"];
  FRUTAS.forEach(function (f) { CATEGORIA[f] = "Hortifrúti"; });
  var ORDEM_CAT = ["Hortifrúti", "Proteínas", "Laticínios", "Bebidas vegetais", "Mercearia", "Temperos"];

  function produtosDe(ingrediente) {
    var t = semAcento(ingrediente);
    for (var i = 0; i < REGRAS.length; i++) {
      if (REGRAS[i][0].test(t)) {
        var p = REGRAS[i][1];
        if (p === null) return [];
        return Array.isArray(p) ? p : [p];
      }
    }
    return [ingrediente.replace(/^\w+:\s*/, "")];
  }

  function montarListaReceitas() {
    var mapa = {};
    sel.forEach(function (id) {
      var r = porId(id);
      if (!r) return;
      r.ingredientes.forEach(function (ing) {
        produtosDe(ing).forEach(function (p) {
          if (!mapa[p]) mapa[p] = { nome: p, cat: CATEGORIA[p] || "Mercearia", usos: [] };
          mapa[p].usos.push({ texto: ing.replace(/^(Massa|Cobertura):\s*/, ""), receita: r.nome });
        });
      });
    });
    var porCat = {};
    Object.keys(mapa).forEach(function (k) {
      var it = mapa[k];
      (porCat[it.cat] = porCat[it.cat] || []).push(it);
    });
    return ORDEM_CAT.filter(function (c) { return porCat[c]; }).map(function (c) {
      return { cat: c, itens: porCat[c].sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); }) };
    });
  }

  // ---------- despensa: o que tenho em casa -> o que posso fazer ----------
  var BASICOS = ["Sal", "Temperos naturais"]; // sempre considerados disponíveis
  function opcional(ing) { return /a gosto|opcional|para untar|para salpicar/.test(semAcento(ing)); }

  // produtos obrigatórios de cada receita (sem básicos e sem itens "a gosto")
  var NECESSARIOS = {};
  var TODOS_PRODUTOS = {};
  RECEITAS.forEach(function (r) {
    var req = {};
    r.ingredientes.forEach(function (ing) {
      produtosDe(ing).forEach(function (p) {
        TODOS_PRODUTOS[p] = CATEGORIA[p] || "Mercearia";
        if (BASICOS.indexOf(p) < 0 && !opcional(ing)) req[p] = true;
      });
    });
    NECESSARIOS[r.id] = Object.keys(req);
  });

  function produtosPorCategoria() {
    var porCat = {};
    Object.keys(TODOS_PRODUTOS).forEach(function (p) {
      if (BASICOS.indexOf(p) >= 0) return;
      (porCat[TODOS_PRODUTOS[p]] = porCat[TODOS_PRODUTOS[p]] || []).push(p);
    });
    return ORDEM_CAT.filter(function (c) { return porCat[c]; }).map(function (c) {
      return { cat: c, itens: porCat[c].sort(function (a, b) { return a.localeCompare(b, "pt-BR"); }) };
    });
  }

  function avaliarReceitas() {
    return RECEITAS.map(function (r) {
      var falta = NECESSARIOS[r.id].filter(function (p) { return despensa.indexOf(p) < 0; });
      return { r: r, falta: falta, total: NECESSARIOS[r.id].length };
    }).sort(function (a, b) { return a.falta.length - b.falta.length || a.r.nome.localeCompare(b.r.nome, "pt-BR"); });
  }

  function listaComoTexto(grupos) {
    var linhas = ["Lista de compras - " + sel.map(function (id) { var r = porId(id); return r ? r.nome : ""; }).join(", "), ""];
    grupos.forEach(function (g) {
      linhas.push("*" + g.cat + "*");
      g.itens.forEach(function (it) {
        linhas.push("- " + it.nome + (it.usos.length ? " (" + it.usos.map(function (u) { return u.texto; }).join("; ") + ")" : ""));
      });
      linhas.push("");
    });
    return linhas.join("\n");
  }

  // ---------- telas ----------
  function refeicaoAtual() {
    var agora = new Date(), m = agora.getHours() * 60 + agora.getMinutes();
    if (m < 7 * 60) return "acordar";
    if (m < 11 * 60) return "cafe";
    if (m < 15 * 60) return "almoco";
    if (m < 18 * 60) return "lanche";
    return "jantar";
  }

  function telaPlano() {
    var atual = refeicaoAtual(), t = PLANO.nutrientes.total;
    var h = '<h2 class="titulo-secao">Meu plano do dia</h2>' +
      '<p class="descricao">Toque em cada refeição para ver as opções de troca. A refeição do horário atual já vem aberta.</p>' +
      '<div class="resumo" aria-label="Total do dia">' +
      '<div><b>' + t.kcal + '</b><span>kcal</span></div>' +
      '<div><b>' + t.proteinas + '</b><span>proteínas</span></div>' +
      '<div><b>' + t.carboidratos + '</b><span>carboidratos</span></div>' +
      '<div><b>' + t.lipidios + '</b><span>gorduras</span></div></div>' +
      '<div class="plano-grade">';
    PLANO.refeicoes.forEach(function (r) {
      var eAgora = r.id === atual;
      h += '<details class="refeicao' + (eAgora ? " agora" : "") + '"' + (eAgora ? " open" : "") + '>' +
        '<summary><span class="hora">' + (r.hora || (r.id === "acordar" ? "Acordar" : "Manhã")) + '</span>' +
        '<h3>' + esc(r.nome) + '</h3>' + (eAgora ? '<span class="tag-agora">Agora</span>' : '') +
        '<span class="kcal">' + r.kcal + ' kcal</span>' + ICON.chevron + '</summary><div class="corpo">';
      r.itens.forEach(function (it) {
        h += '<div class="item"><div class="principal">' + esc(it.principal) + '</div>';
        if (it.opcoes.length) {
          h += '<ul>' + it.opcoes.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join("") + '</ul>';
        }
        h += '</div>';
      });
      if (r.observacoes.length) {
        h += '<div class="obs"><strong>Observações</strong><ul>' +
          r.observacoes.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join("") + '</ul>';
        (r.receitas || []).forEach(function (id) {
          var rec = porId(id);
          if (rec) h += '<a class="link-receita" href="#receita/' + rec.id + '">Ver receita: ' + esc(rec.nome) + ' →</a>';
        });
        h += '</div>';
      }
      h += '</div></details>';
    });
    h += '</div><h3 class="subtitulo">Nutrientes por refeição</h3><div class="tabela-wrap"><table class="nutri">' +
      '<thead><tr><th>Refeição</th><th>Prot.</th><th>Gord.</th><th>Carb.</th><th>Calorias</th></tr></thead><tbody>' +
      PLANO.nutrientes.linhas.map(function (l) { return '<tr>' + l.map(function (c) { return '<td>' + c + '</td>'; }).join("") + '</tr>'; }).join("") +
      '<tr><td><b>Total</b></td><td><b>' + t.proteinas + '</b></td><td><b>' + t.lipidios + '</b></td><td><b>' + t.carboidratos + '</b></td><td><b>' + t.kcal + ' kcal</b></td></tr>' +
      '</tbody></table></div>' +
      '<p class="rodape">Plano prescrito em ' + PLANO.prescritoEm + '. Siga sempre a orientação da sua nutricionista.</p>';
    return h;
  }

  function cartao(r) {
    var fav = favs.indexOf(r.id) >= 0, s = sel.indexOf(r.id) >= 0;
    return '<article class="cartao' + (s ? " selecionada" : "") + '">' +
      '<div class="cartao-topo"><h3><a href="#receita/' + r.id + '">' + esc(r.nome) + '</a></h3>' +
      '<button class="btn-fav" data-fav="' + r.id + '" aria-pressed="' + fav + '" aria-label="' + (fav ? "Remover dos favoritos" : "Favoritar") + ': ' + esc(r.nome) + '">' + ICON.heart + '</button></div>' +
      '<div class="meta"><span class="chip">' + TIPOS[r.tipo] + '</span><span class="chip">' + esc(r.rendimento) + '</span>' +
      (r.destaque ? '<span class="chip destaque">' + esc(r.destaque) + '</span>' : '') + '</div>' +
      '<div class="acoes"><a class="btn flex" href="#receita/' + r.id + '">Ver receita</a>' +
      '<button class="btn flex' + (s ? " primario" : "") + '" data-sel="' + r.id + '" aria-pressed="' + s + '" aria-label="' + (s ? "Tirar da lista de compras" : "Adicionar à lista de compras") + ': ' + esc(r.nome) + '">' +
      (s ? ICON.check + "Na lista" : ICON.plus + "Adicionar") + '</button></div></article>';
  }

  function filtrar(lista) {
    var q = semAcento(termo.trim());
    return lista.filter(function (r) {
      if (filtro === "selecionadas" && sel.indexOf(r.id) < 0) return false;
      if (filtro !== "todas" && filtro !== "selecionadas" && r.tipo !== filtro) return false;
      if (!q) return true;
      return semAcento(r.nome + " " + r.ingredientes.join(" ")).indexOf(q) >= 0;
    });
  }

  function telaReceitas() {
    var botoes = [["todas", "Todas"], ["doce", "Doces"], ["salgado", "Salgadas"], ["pao", "Pães"], ["selecionadas", "Na lista (" + sel.length + ")"]];
    return '<h2 class="titulo-secao">Receitas</h2>' +
      '<p class="descricao">' + RECEITAS.length + ' receitas do caderno. Toque em <b>Adicionar</b> nas que você vai fazer e veja tudo o que comprar na aba Compras.</p>' +
      '<label for="busca" class="sr">Buscar receita ou ingrediente</label>' +
      '<input id="busca" class="busca" type="search" placeholder="Buscar receita ou ingrediente (ex.: banana)" value="' + esc(termo) + '">' +
      '<div class="filtros" role="group" aria-label="Filtrar receitas">' +
      botoes.map(function (b) { return '<button data-filtro="' + b[0] + '" aria-pressed="' + (filtro === b[0]) + '">' + b[1] + '</button>'; }).join("") +
      '</div><div class="grade" id="grade">' + gradeHtml() + '</div>';
  }
  function gradeHtml() {
    var l = filtrar(RECEITAS);
    return l.length ? l.map(cartao).join("") : '<p class="vazio">Nenhuma receita encontrada.</p>';
  }

  function telaFavoritas() {
    var l = RECEITAS.filter(function (r) { return favs.indexOf(r.id) >= 0; });
    return '<h2 class="titulo-secao">Favoritas</h2>' +
      '<p class="descricao">As receitas que você marcou com o coração ficam aqui, salvas neste aparelho.</p>' +
      (l.length ? '<div class="grade">' + l.map(cartao).join("") + '</div>'
        : '<div class="vazio">Você ainda não favoritou nenhuma receita.<br><br><a class="btn primario" href="#receitas">Ver receitas</a></div>');
  }

  function telaReceita(id) {
    var r = porId(id);
    if (!r) return '<div class="vazio">Receita não encontrada. <a href="#receitas">Voltar</a></div>';
    var fav = favs.indexOf(r.id) >= 0, s = sel.indexOf(r.id) >= 0;
    return '<a class="btn voltar" href="#receitas">' + ICON.back + 'Receitas</a>' +
      '<article class="detalhe"><h2>' + esc(r.nome) + '</h2>' +
      '<div class="meta"><span class="chip">' + TIPOS[r.tipo] + '</span><span class="chip">Rende ' + esc(r.rendimento) + '</span>' +
      (r.destaque ? '<span class="chip destaque">' + esc(r.destaque) + '</span>' : '') + '</div>' +
      '<div class="acoes"><button class="btn' + (fav ? " primario" : "") + '" data-fav="' + r.id + '" aria-pressed="' + fav + '">' + ICON.heart + (fav ? "Favorita" : "Favoritar") + '</button>' +
      '<button class="btn' + (s ? " primario" : "") + '" data-sel="' + r.id + '" aria-pressed="' + s + '">' + (s ? ICON.check + "Na lista de compras" : ICON.plus + "Adicionar à lista de compras") + '</button></div>' +
      '<h3>Ingredientes</h3><ul>' + r.ingredientes.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join("") + '</ul>' +
      '<h3>Modo de preparo</h3><ol>' + r.preparo.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join("") + '</ol>' +
      (r.dica ? '<div class="obs"><strong>Dica</strong>' + esc(r.dica) + '</div>' : '') + '</article>';
  }

  function telaCompras() {
    var h = '<h2 class="titulo-secao">Lista de compras</h2>';
    if (!sel.length) {
      h += '<div class="vazio">Escolha as receitas que você quer fazer e a lista com tudo o que precisa comprar aparece aqui.<br><br>' +
        '<a class="btn primario" href="#receitas">Escolher receitas</a></div>';
    } else {
      var grupos = montarListaReceitas();
      h += '<p class="descricao">Ingredientes das <b>' + sel.length + '</b> receita(s) escolhida(s), juntos por produto. Marque o que já pegou.</p>' +
        '<div class="selecionadas">' + sel.map(function (id) {
          var r = porId(id);
          return r ? '<span class="chip">' + esc(r.nome) + '<button data-sel="' + r.id + '" aria-label="Tirar ' + esc(r.nome) + ' da lista">×</button></span>' : '';
        }).join("") + '</div>' +
        '<div class="linha-acoes"><button class="btn primario" id="compartilhar">' + ICON.share + 'Enviar / copiar lista</button>' +
        '<button class="btn" id="desmarcar">Desmarcar itens</button>' +
        '<button class="btn" id="limpar">Limpar receitas</button></div>';
      grupos.forEach(function (g) {
        h += '<h3 class="subtitulo">' + g.cat + '</h3><ul class="lista">';
        g.itens.forEach(function (it) {
          var k = "r:" + it.nome;
          h += '<li><label><input type="checkbox" data-check="' + esc(k) + '"' + (checks[k] ? " checked" : "") + '>' +
            '<span><span class="nome">' + esc(it.nome) + '</span>' +
            it.usos.map(function (u) { return '<span class="detalhes">' + esc(u.texto) + ' · <i>' + esc(u.receita) + '</i></span>'; }).join("") +
            '</span></label></li>';
        });
        h += '</ul>';
      });
    }
    h += '<details class="refeicao"><summary><h3>Lista do plano alimentar</h3>' + ICON.chevron + '</summary><div class="corpo">' +
      '<p class="descricao">Lista de compras básica que veio com o plano.</p><ul class="lista">' +
      PLANO.compras.map(function (c) {
        return '<li><label><input type="checkbox" data-checkplano="' + esc(c) + '"' + (checksPlano[c] ? " checked" : "") + '><span><span class="nome">' + esc(c) + '</span></span></label></li>';
      }).join("") + '</ul></div></details>';
    return h;
  }

  function resultadoDespensa() {
    if (!despensa.length) {
      return '<div class="vazio">Marque abaixo os ingredientes que você tem em casa e eu mostro as receitas que dá para fazer.</div>';
    }
    var av = avaliarReceitas();
    var pode = av.filter(function (a) { return a.falta.length === 0; });
    var quase = av.filter(function (a) { return a.falta.length > 0 && a.falta.length <= 2; });
    var h = '<div class="placar"><b>' + pode.length + '</b> receita(s) você já pode fazer · <b>' + quase.length + '</b> falta pouco</div>';
    if (pode.length) {
      h += '<h3 class="subtitulo">Pode fazer agora</h3><ul class="lista">' + pode.map(function (a) {
        return '<li><a class="linha-receita" href="#receita/' + a.r.id + '"><span class="ok">' + ICON.check + '</span>' +
          '<span><span class="nome">' + esc(a.r.nome) + '</span><span class="detalhes">Você tem tudo (' + a.total + ' ingredientes)</span></span></a></li>';
      }).join("") + '</ul>';
    }
    if (quase.length) {
      h += '<h3 class="subtitulo">Falta pouco</h3><ul class="lista">' + quase.map(function (a) {
        var naLista = sel.indexOf(a.r.id) >= 0;
        return '<li><div class="linha-receita"><span class="falta">' + a.falta.length + '</span>' +
          '<span class="flex1"><a class="nome" href="#receita/' + a.r.id + '">' + esc(a.r.nome) + '</a>' +
          '<span class="detalhes">Falta: ' + a.falta.map(esc).join(", ") + '</span></span>' +
          '<button class="btn mini' + (naLista ? " primario" : "") + '" data-sel="' + a.r.id + '" aria-pressed="' + naLista + '" aria-label="' + (naLista ? "Tirar da lista de compras" : "Adicionar à lista de compras") + ': ' + esc(a.r.nome) + '">' +
          (naLista ? ICON.check + "Na lista" : ICON.plus + "Comprar") + '</button></div></li>';
      }).join("") + '</ul>';
    }
    if (!pode.length && !quase.length) {
      h += '<div class="vazio">Ainda falta bastante para qualquer receita. Marque mais ingredientes.</div>';
    }
    return h;
  }

  function chipsDespensa() {
    var q = semAcento(termoDesp.trim());
    return produtosPorCategoria().map(function (g) {
      var itens = g.itens.filter(function (p) { return !q || semAcento(p).indexOf(q) >= 0; });
      if (!itens.length) return "";
      return '<h3 class="subtitulo">' + g.cat + '</h3><div class="chips">' + itens.map(function (p) {
        var tem = despensa.indexOf(p) >= 0;
        return '<button class="chip-toggle" data-desp="' + esc(p) + '" aria-pressed="' + tem + '">' + (tem ? ICON.check : "") + esc(p) + '</button>';
      }).join("") + '</div>';
    }).join("") || '<p class="vazio">Nenhum ingrediente encontrado.</p>';
  }

  function telaDespensa() {
    return '<h2 class="titulo-secao">O que tenho em casa</h2>' +
      '<p class="descricao">Marque os ingredientes que você tem. Sal, temperos e itens "a gosto" não contam. Fica salvo neste aparelho.</p>' +
      '<div id="resultado-despensa">' + resultadoDespensa() + '</div>' +
      '<div class="cabecalho-despensa"><h3 class="subtitulo">Meus ingredientes (' + despensa.length + ')</h3>' +
      (despensa.length ? '<button class="btn mini" id="limpar-despensa">Desmarcar todos</button>' : '') + '</div>' +
      '<label for="busca-despensa" class="sr">Buscar ingrediente</label>' +
      '<input id="busca-despensa" class="busca" type="search" placeholder="Buscar ingrediente (ex.: ovo)" value="' + esc(termoDesp) + '">' +
      '<div id="chips-despensa">' + chipsDespensa() + '</div>';
  }

  // ---------- roteamento ----------
  function render() {
    var hash = location.hash.replace(/^#/, "") || "plano";
    var partes = hash.split("/"), aba = partes[0];
    var html;
    if (aba === "receita") { html = telaReceita(partes[1]); aba = "receitas"; }
    else if (aba === "receitas") html = telaReceitas();
    else if (aba === "favoritas") html = telaFavoritas();
    else if (aba === "compras") html = telaCompras();
    else if (aba === "despensa") html = telaDespensa();
    else { html = telaPlano(); aba = "plano"; }
    main.innerHTML = html;
    document.querySelectorAll(".abas a").forEach(function (a) {
      if (a.dataset.aba === aba) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    atualizarContador();
  }

  function atualizarContador() {
    var c = document.getElementById("contador");
    c.hidden = sel.length === 0;
    c.textContent = sel.length;
  }

  function rerenderMantendoScroll() {
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.id;
    render();
    window.scrollTo(0, y);
    if (foco) { var el = document.getElementById(foco); if (el) el.focus(); }
  }

  // ---------- eventos ----------
  main.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.fav) {
      var ok = alternar(favs, b.dataset.fav); salvarTudo();
      toast(ok ? "Adicionada às favoritas" : "Removida das favoritas");
      rerenderMantendoScroll();
    } else if (b.dataset.sel) {
      var add = alternar(sel, b.dataset.sel); salvarTudo();
      toast(add ? "Adicionada à lista de compras" : "Tirada da lista de compras");
      rerenderMantendoScroll();
    } else if (b.dataset.desp) {
      alternar(despensa, b.dataset.desp); salvarTudo();
      rerenderMantendoScroll();
    } else if (b.id === "limpar-despensa") {
      despensa = []; salvarTudo(); rerenderMantendoScroll();
    } else if (b.dataset.filtro) {
      filtro = b.dataset.filtro; rerenderMantendoScroll();
    } else if (b.id === "limpar") {
      sel = []; checks = {}; salvarTudo(); render(); toast("Lista limpa");
    } else if (b.id === "desmarcar") {
      checks = {}; salvarTudo(); rerenderMantendoScroll();
    } else if (b.id === "compartilhar") {
      var texto = listaComoTexto(montarListaReceitas());
      if (navigator.share) {
        navigator.share({ title: "Lista de compras", text: texto }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(texto).then(function () { toast("Lista copiada"); }, function () { toast("Não foi possível copiar"); });
      }
    }
  });

  main.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.check) { if (t.checked) checks[t.dataset.check] = true; else delete checks[t.dataset.check]; salvarTudo(); }
    if (t.dataset.checkplano) { if (t.checked) checksPlano[t.dataset.checkplano] = true; else delete checksPlano[t.dataset.checkplano]; salvarTudo(); }
  });

  main.addEventListener("input", function (e) {
    if (e.target.id === "busca") {
      termo = e.target.value;
      document.getElementById("grade").innerHTML = gradeHtml();
    } else if (e.target.id === "busca-despensa") {
      termoDesp = e.target.value;
      document.getElementById("chips-despensa").innerHTML = chipsDespensa();
    }
  });

  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  render();
})();
