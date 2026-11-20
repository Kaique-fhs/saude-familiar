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
  var despensa = ler("mp-quero", []);
  var termoDesp = "";
  var diario = ler("mp-diario", {});
  var ultimoBackup = ler("mp-ultimo-backup", null);
  var diaSel = hojeChave(); // dia que está sendo marcado
  var mesVisto = new Date(); mesVisto.setDate(1);
  var filtro = "todas";
  var termo = "";

  function salvarTudo() {
    gravar("mp-favs", favs);
    gravar("mp-sel", sel);
    gravar("mp-checks", checks);
    gravar("mp-checks-plano", checksPlano);
    gravar("mp-quero", despensa);
    gravar("mp-diario", diario);
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
  var desfazerAtual = null;
  function toast(msg, desfazer) {
    clearTimeout(toastT);
    desfazerAtual = desfazer || null;
    toastEl.innerHTML = "";
    toastEl.appendChild(document.createTextNode(msg));
    if (desfazer) {
      var bt = document.createElement("button");
      bt.type = "button"; bt.className = "desfazer"; bt.textContent = "Desfazer";
      bt.addEventListener("click", function () {
        var f = desfazerAtual; desfazerAtual = null;
        toastEl.classList.remove("show", "com-acao");
        if (f) { f(); salvarTudo(); rerenderMantendoScroll(); toast("Desfeito"); }
      });
      toastEl.appendChild(bt);
    }
    toastEl.classList.toggle("com-acao", !!desfazer);
    toastEl.classList.add("show");
    toastT = setTimeout(function () { toastEl.classList.remove("show", "com-acao"); desfazerAtual = null; }, desfazer ? 6000 : 1800);
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
    [/atum.*ou.*frango/, "Atum em lata ou frango"],
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
    "Ovos": "Proteínas", "Atum em lata": "Proteínas", "Atum em lata ou frango": "Proteínas", "Peito / filé de frango": "Proteínas", "Carne moída": "Proteínas",
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

  // Produtos que podem ser trocados um pelo outro na receita.
  var ALTERNATIVAS = { "Atum em lata ou frango": ["Atum em lata", "Peito / filé de frango"] };
  function expandir(lista) {
    var out = [];
    lista.forEach(function (p) { out = out.concat(ALTERNATIVAS[p] || [p]); });
    return out;
  }

  // Lê a quantidade de um ingrediente: gramas, ml ou unidades (ex.: "1-2 ovos").
  var MEDIDAS = /^(e\b|colher|col\b|col\.|xicara|pitada|copo|lata|fatia|dente|prato|concha|tablete)/;
  function quantidade(texto) {
    var t = semAcento(texto).replace(/^(massa|cobertura):\s*/, "").replace(/\(ou [^)]*\)/g, "");
    var u = t.match(/-\s*(\d+)\s+unidades?\b/);
    if (u) return { un: [parseInt(u[1], 10), parseInt(u[1], 10)] };
    var m = t.match(/\((\d+(?:[.,]\d+)?)\s*(g|ml)\)/) || t.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/);
    if (m) { var q = {}; q[m[2]] = parseFloat(m[1].replace(",", ".")); return q; }
    m = t.match(/^(\d+)(?:\s*-\s*(\d+))?\s+(.*)$/);
    if (m && !MEDIDAS.test(m[3])) return { un: [parseInt(m[1], 10), parseInt(m[2] || m[1], 10)] };
    return null;
  }
  function somar(usos) {
    var s = { g: 0, ml: 0, un: [0, 0] }, alguma = 0;
    usos.forEach(function (u) {
      var q = quantidade(u.texto);
      if (!q) return;
      alguma++;
      if (q.g) s.g += q.g;
      if (q.ml) s.ml += q.ml;
      if (q.un) { s.un[0] += q.un[0]; s.un[1] += q.un[1]; }
    });
    if (alguma < 2) return "";
    var partes = [];
    if (s.g) partes.push(Math.round(s.g) + " g");
    if (s.ml) partes.push(Math.round(s.ml) + " ml");
    if (s.un[1]) partes.push((s.un[0] === s.un[1] ? s.un[0] : s.un[0] + "–" + s.un[1]) + " unid.");
    var falta = usos.length - alguma;
    return partes.join(" + ") + (falta ? " + " + falta + " sem medida" : "");
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
      it.total = somar(it.usos);
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
  var OPCIONAIS = {};
  var TODOS_PRODUTOS = {};
  RECEITAS.forEach(function (r) {
    var req = {}, opc = {};
    r.ingredientes.forEach(function (ing) {
      produtosDe(ing).forEach(function (p) {
        expandir([p]).forEach(function (q) { TODOS_PRODUTOS[q] = CATEGORIA[q] || "Mercearia"; });
        if (BASICOS.indexOf(p) >= 0) return;
        if (opcional(ing)) opc[p] = true; else req[p] = true;
      });
    });
    NECESSARIOS[r.id] = Object.keys(req);
    OPCIONAIS[r.id] = Object.keys(opc).filter(function (p) { return !req[p]; });
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

  // "Quero comer": ordena as receitas por quantos dos ingredientes escolhidos elas levam
  function receitasCombinadas() {
    return RECEITAS.map(function (r) {
      var tem = expandir(NECESSARIOS[r.id].concat(OPCIONAIS[r.id]));
      var combina = despensa.filter(function (p) { return tem.indexOf(p) >= 0; });
      return { r: r, combina: combina, cobertura: combina.length / Math.max(1, NECESSARIOS[r.id].length) };
    }).filter(function (a) { return a.combina.length > 0; })
      .sort(function (a, b) {
        return b.combina.length - a.combina.length || b.cobertura - a.cobertura || a.r.nome.localeCompare(b.r.nome, "pt-BR");
      });
  }

  function listaComoTexto(grupos) {
    var linhas = ["Lista de compras - " + sel.map(function (id) { var r = porId(id); return r ? r.nome : ""; }).join(", "), ""];
    grupos.forEach(function (g) {
      linhas.push("*" + g.cat + "*");
      g.itens.forEach(function (it) {
        linhas.push("- " + it.nome + (it.total ? " — total: " + it.total : "") + (it.usos.length ? " (" + it.usos.map(function (u) { return u.texto; }).join("; ") + ")" : ""));
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

  // ---------- acompanhamento: refeições cumpridas por dia (só neste aparelho) ----------
  var NOMES_CURTOS = { acordar: "Ao acordar", cafe: "Café", almoco: "Almoço", lanche: "Lanche", jantar: "Jantar" };
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  var TOTAL_REF = PLANO.refeicoes.length;

  function chaveData(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dataDaChave(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hojeChave() { return chaveData(new Date()); }
  function feitasNoDia(k) { return diario[k] || []; }
  function diaCompleto(k) { return feitasNoDia(k).length >= TOTAL_REF; }

  function sequencia() {
    // dias seguidos cumpridos, contando de hoje (ou de ontem, se hoje ainda não fechou)
    var d = new Date(), n = 0;
    if (!diaCompleto(chaveData(d))) d.setDate(d.getDate() - 1);
    while (diaCompleto(chaveData(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function rotuloDia(k) {
    if (k === hojeChave()) return "Hoje";
    var d = dataDaChave(k), ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
    if (k === chaveData(ontem)) return "Ontem";
    return SEMANA[d.getDay()] + ", " + d.getDate() + "/" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function blocoDia() {
    var feitas = feitasNoDia(diaSel), seq = sequencia();
    return '<section class="dia" aria-labelledby="titulo-dia">' +
      '<div class="dia-topo"><h3 id="titulo-dia">' + rotuloDia(diaSel) + ': ' + feitas.length + ' de ' + TOTAL_REF + ' refeições</h3>' +
      (seq ? '<span class="sequencia">' + seq + ' dia' + (seq === 1 ? '' : 's') + ' seguido' + (seq === 1 ? '' : 's') + '</span>' : '') + '</div>' +
      '<div class="barra" aria-hidden="true"><span style="width:' + Math.round(feitas.length / TOTAL_REF * 100) + '%"></span></div>' +
      '<p class="dica-dia">Toque nas refeições que você fez' + (diaSel === hojeChave() ? '' : ' nesse dia') + '. Esqueceu um dia? Toque nele no calendário abaixo.</p>' +
      '<div class="chips" role="group" aria-label="Refeições feitas">' +
      PLANO.refeicoes.map(function (r) {
        var ok = feitas.indexOf(r.id) >= 0;
        return '<button class="chip-toggle" data-refdia="' + r.id + '" aria-pressed="' + ok + '">' + (ok ? ICON.check : '') + NOMES_CURTOS[r.id] + '</button>';
      }).join("") +
      '</div>' + (diaSel !== hojeChave() ? '<button class="btn mini voltar-hoje" id="voltar-hoje">Voltar para hoje</button>' : '') +
      '</section>';
  }

  function blocoCalendario() {
    var ano = mesVisto.getFullYear(), mes = mesVisto.getMonth();
    var primeiro = new Date(ano, mes, 1), dias = new Date(ano, mes + 1, 0).getDate();
    var hoje = hojeChave(), cumpridos = 0;
    var h = '<section class="calendario" aria-labelledby="titulo-cal">' +
      '<div class="cal-topo"><button class="btn-fav" id="mes-ant" aria-label="Mês anterior">' + ICON.back + '</button>' +
      '<h3 id="titulo-cal">' + MESES[mes].charAt(0).toUpperCase() + MESES[mes].slice(1) + ' de ' + ano + '</h3>' +
      '<button class="btn-fav seta-dir" id="mes-prox" aria-label="Próximo mês"' + (ano * 12 + mes >= new Date().getFullYear() * 12 + new Date().getMonth() ? ' disabled' : '') + '>' + ICON.back + '</button></div>' +
      '<div class="cal-grade">' + SEMANA.map(function (s) { return '<span class="cal-sem" aria-hidden="true">' + s.charAt(0).toUpperCase() + '</span>'; }).join("");
    for (var i = 0; i < primeiro.getDay(); i++) h += '<span></span>';
    for (var dia = 1; dia <= dias; dia++) {
      var k = chaveData(new Date(ano, mes, dia)), n = feitasNoDia(k).length, futuro = k > hoje;
      if (n >= TOTAL_REF) cumpridos++;
      var classe = n >= TOTAL_REF ? "completo" : (n ? "parcial" : "");
      var desc = dia + " de " + MESES[mes] + ": " + (n >= TOTAL_REF ? "cumprido" : n ? n + " de " + TOTAL_REF + " refeições" : "nada marcado");
      h += '<button class="cal-dia ' + classe + (k === hoje ? ' hoje' : '') + (k === diaSel ? ' sel' : '') + '" data-dia="' + k + '"' +
        (futuro ? ' disabled' : '') + ' aria-pressed="' + (k === diaSel) + '" aria-label="' + desc + '">' + dia +
        (n && n < TOTAL_REF ? '<small>' + n + '/' + TOTAL_REF + '</small>' : '') + '</button>';
    }
    h += '</div><p class="cal-legenda"><span class="ponto completo"></span>Dia cumprido (5 de 5) <span class="ponto parcial"></span>Em parte' +
      '<br><b>' + cumpridos + '</b> dia' + (cumpridos === 1 ? '' : 's') + ' cumprido' + (cumpridos === 1 ? '' : 's') + ' em ' + MESES[mes] + '.</p></section>';
    return h;
  }

  function alternarRefeicao(id) {
    var l = (diario[diaSel] || []).slice();
    var i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1); else l.push(id);
    if (l.length) diario[diaSel] = l; else delete diario[diaSel];
    salvarTudo();
    if (l.length === TOTAL_REF && i < 0) toast(rotuloDia(diaSel) + " cumprido! Parabéns");
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
      statusHoje() +
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
      if (filtro === "favoritas" && favs.indexOf(r.id) < 0) return false;
      if (TIPOS[filtro] && r.tipo !== filtro) return false;
      if (!q) return true;
      return semAcento(r.nome + " " + r.ingredientes.join(" ")).indexOf(q) >= 0;
    });
  }

  function telaReceitas() {
    var botoes = [["todas", "Todas"], ["favoritas", "Favoritas (" + favs.length + ")"], ["doce", "Doces"], ["salgado", "Salgadas"], ["pao", "Pães"], ["selecionadas", "Na lista (" + sel.length + ")"]];
    return '<h2 class="titulo-secao">Receitas</h2>' +
      '<p class="descricao">' + RECEITAS.length + ' receitas do caderno. Toque no coração para favoritar e em <b>Adicionar</b> nas que você vai fazer para montar a lista de compras.</p>' +
      '<label for="busca" class="sr">Buscar receita ou ingrediente</label>' +
      '<input id="busca" class="busca" type="search" placeholder="Buscar receita ou ingrediente (ex.: banana)" value="' + esc(termo) + '">' +
      '<div class="filtros" role="group" aria-label="Filtrar receitas">' +
      botoes.map(function (b) { return '<button data-filtro="' + b[0] + '" aria-pressed="' + (filtro === b[0]) + '">' + b[1] + '</button>'; }).join("") +
      '</div><div class="grade" id="grade">' + gradeHtml() + '</div>';
  }
  function gradeHtml() {
    var l = filtrar(RECEITAS);
    if (l.length) return l.map(cartao).join("");
    if (filtro === "favoritas" && !favs.length) return '<p class="vazio">Você ainda não favoritou nenhuma receita. Toque no coração de uma receita para ela aparecer aqui.</p>';
    return '<p class="vazio">Nenhuma receita encontrada.</p>';
  }

  function statusHoje() {
    var n = feitasNoDia(hojeChave()).length, seq = sequencia();
    return '<a class="status-dia" href="#frequencia">' +
      '<span><b>Hoje: ' + n + ' de ' + TOTAL_REF + ' refeições marcadas</b>' +
      '<span class="detalhes">' + (seq ? seq + ' dia' + (seq === 1 ? '' : 's') + ' seguido' + (seq === 1 ? '' : 's') + ' · ' : '') + 'Toque para marcar e ver o calendário</span></span>' +
      '<span aria-hidden="true">→</span></a>';
  }

  // Lembra de salvar cópia: nunca salvou e já tem 7+ dias marcados, ou a última cópia tem 30+ dias.
  function lembreteBackup() {
    var dias = Object.keys(diario).length;
    if (!dias) return "";
    var motivo = "";
    if (!ultimoBackup) {
      if (dias >= 7) motivo = "Você já marcou " + dias + " dias e ainda não salvou nenhuma cópia.";
    } else {
      var passaram = Math.floor((dataDaChave(hojeChave()) - dataDaChave(ultimoBackup)) / 864e5);
      if (passaram >= 30) motivo = "Sua última cópia foi há " + passaram + " dias.";
    }
    if (!motivo) return "";
    return '<div class="lembrete" role="note"><p><b>Salve uma cópia de segurança.</b> ' + motivo +
      ' Os dias marcados ficam só neste celular: se ele for trocado ou formatado, eles se perdem.</p>' +
      '<button class="btn primario" id="baixar-backup">' + ICON.share + 'Salvar cópia agora</button></div>';
  }

  function telaFrequencia() {
    return '<h2 class="titulo-secao">Frequência</h2>' +
      '<p class="descricao">Marque as refeições que você fez e acompanhe no calendário os dias em que cumpriu o plano.</p>' +
      lembreteBackup() + blocoDia() + blocoCalendario() + telaBackup();
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
            '<span><span class="nome">' + esc(it.nome) + '</span>' + (it.total ? '<span class="total">Total: ' + esc(it.total) + '</span>' : '') +
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
      return '<div class="vazio">Escolha abaixo os ingredientes que você está com vontade de comer e eu mostro as receitas que mais combinam.</div>';
    }
    var lista = receitasCombinadas();
    if (!lista.length) {
      return '<div class="vazio">Nenhuma receita do caderno leva esses ingredientes. Tente escolher outros.</div>';
    }
    var n = despensa.length;
    var h = '<div class="placar"><b>' + lista.length + '</b> receita(s) combinam com o que você quer comer</div>' +
      '<ul class="lista resultado">';
    lista.forEach(function (a) {
      var naLista = sel.indexOf(a.r.id) >= 0;
      var todos = a.combina.length === n;
      h += '<li><div class="linha-receita"><span class="' + (todos ? "ok" : "falta") + '" aria-hidden="true">' + (todos ? ICON.check : a.combina.length) + '</span>' +
        '<span class="flex1"><a class="nome" href="#receita/' + a.r.id + '">' + esc(a.r.nome) + '</a>' +
        '<span class="detalhes">' + (n > 1 ? (todos ? "Leva tudo o que você escolheu: " : "Leva " + a.combina.length + " de " + n + ": ") : "Leva ") +
        a.combina.map(esc).join(", ") + '</span></span>' +
        '<button class="btn mini' + (naLista ? " primario" : "") + '" data-sel="' + a.r.id + '" aria-pressed="' + naLista + '" aria-label="' + (naLista ? "Tirar da lista de compras" : "Adicionar à lista de compras") + ': ' + esc(a.r.nome) + '">' +
        (naLista ? ICON.check + "Na lista" : ICON.plus + "Comprar") + '</button></div></li>';
    });
    return h + '</ul>';
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
    // Ingredientes primeiro e receitas depois: assim os botões não mudam de lugar ao tocar.
    return '<h2 class="titulo-secao">O que quero comer</h2>' +
      '<p class="descricao">Escolha os ingredientes que você está com vontade de comer. As receitas que levam mais deles aparecem logo abaixo, das mais combinadas para as menos.</p>' +
      '<div class="cabecalho-despensa"><h3 class="subtitulo" id="qtd-escolhidos">' + textoEscolhidos() + '</h3>' +
      '<button class="btn mini" id="limpar-despensa"' + (despensa.length ? '' : ' hidden') + '>Desmarcar todos</button></div>' +
      '<label for="busca-despensa" class="sr">Buscar ingrediente</label>' +
      '<input id="busca-despensa" class="busca" type="search" placeholder="Buscar ingrediente (ex.: banana)" value="' + esc(termoDesp) + '">' +
      '<div id="chips-despensa">' + chipsDespensa() + '</div>' +
      '<h3 class="subtitulo titulo-resultado" id="receitas-combinadas" tabindex="-1">Receitas que combinam</h3>' +
      '<div id="resultado-despensa">' + resultadoDespensa() + '</div>' +
      '<button class="btn primario flutuante" id="ir-receitas"' + (despensa.length ? '' : ' hidden') + '>' + textoBotaoFlutuante() + '</button>';
  }

  function textoEscolhidos() { return "Ingredientes escolhidos (" + despensa.length + ")"; }
  function textoBotaoFlutuante() {
    var n = despensa.length ? receitasCombinadas().length : 0;
    return "Ver " + n + " receita" + (n === 1 ? "" : "s") + " ↓";
  }

  // Atualiza só as partes que mudam, sem redesenhar a tela inteira.
  function atualizarQueroComer(focarDesp) {
    document.getElementById("chips-despensa").innerHTML = chipsDespensa();
    document.getElementById("resultado-despensa").innerHTML = resultadoDespensa();
    document.getElementById("qtd-escolhidos").textContent = textoEscolhidos();
    document.getElementById("limpar-despensa").hidden = !despensa.length;
    var fl = document.getElementById("ir-receitas");
    fl.hidden = !despensa.length;
    fl.textContent = textoBotaoFlutuante();
    if (focarDesp) {
      var el = main.querySelector('[data-desp="' + CSS.escape(focarDesp) + '"]');
      if (el) el.focus();
    }
  }

  // ---------- backup (favoritas, listas e escolhas) ----------
  function telaBackup() {
    return '<section class="backup"><h3 class="subtitulo">Cópia de segurança</h3>' +
      '<p class="descricao">Os dias marcados, as favoritas e as listas ficam só neste aparelho. Salve uma cópia para não perder nada ou para passar para outro aparelho.</p>' +
      '<div class="linha-acoes"><button class="btn" id="baixar-backup">' + ICON.share + 'Salvar cópia</button>' +
      '<button class="btn" id="restaurar-backup">Restaurar cópia</button>' +
      '<input class="sr" type="file" id="arquivo-backup" accept="application/json,.json" tabindex="-1" aria-hidden="true"></div></section>';
  }

  function baixarBackup() {
    var dados = { app: "meu-prato", versao: 2, salvoEm: new Date().toISOString(), favs: favs, sel: sel, checks: checks, checksPlano: checksPlano, quero: despensa, diario: diario };
    var texto = JSON.stringify(dados, null, 2);
    var nome = "meu-prato-backup-" + hojeChave() + ".json";

    function concluir(msg) {
      ultimoBackup = hojeChave(); gravar("mp-ultimo-backup", ultimoBackup);
      toast(msg);
      if (location.hash === "#frequencia") rerenderMantendoScroll();
    }
    function baixar() {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
      a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      concluir("Cópia salva em Downloads");
    }

    // No celular, usa o menu de compartilhar (Salvar em Arquivos, WhatsApp, e-mail...).
    // O iPhone com o app instalado nem sempre deixa baixar arquivos direto.
    var celular = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    var arquivo = null;
    try { arquivo = new File([texto], nome, { type: "application/json" }); } catch (e) { arquivo = null; }
    if (celular && arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      navigator.share({ files: [arquivo], title: "Cópia do Meu Prato" })
        .then(function () { concluir("Cópia salva"); })
        .catch(function (err) {
          if (err && err.name === "AbortError") { toast("Cópia não salva"); return; }
          baixar();
        });
      return;
    }
    baixar();
  }

  function restaurarBackup(arquivo) {
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        var d = JSON.parse(leitor.result);
        if (!d || d.app !== "meu-prato") throw new Error("arquivo");
        var ids = RECEITAS.map(function (r) { return r.id; });
        var soReceitas = function (l) { return Array.isArray(l) ? l.filter(function (id) { return ids.indexOf(id) >= 0; }) : []; };
        favs = soReceitas(d.favs);
        sel = soReceitas(d.sel);
        checks = d.checks && typeof d.checks === "object" ? d.checks : {};
        checksPlano = d.checksPlano && typeof d.checksPlano === "object" ? d.checksPlano : {};
        despensa = Array.isArray(d.quero) ? d.quero.filter(function (p) { return TODOS_PRODUTOS[p]; }) : [];
        var idsRef = PLANO.refeicoes.map(function (r) { return r.id; }), novoDiario = {};
        if (d.diario && typeof d.diario === "object") {
          Object.keys(d.diario).forEach(function (k) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(d.diario[k])) return;
            var l = d.diario[k].filter(function (id, i, arr) { return idsRef.indexOf(id) >= 0 && arr.indexOf(id) === i; });
            if (l.length) novoDiario[k] = l;
          });
        }
        diario = novoDiario;
        salvarTudo(); render(); toast("Cópia restaurada");
      } catch (e) { toast("Esse arquivo não é uma cópia do Meu Prato"); }
    };
    leitor.readAsText(arquivo);
  }

  // ---------- aviso para instalar o app ----------
  var pedidoInstalacao = null;
  var instalado = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); pedidoInstalacao = e; rerenderMantendoScroll();
  });
  window.addEventListener("appinstalled", function () { instalado = true; pedidoInstalacao = null; render(); toast("App instalado"); });

  function avisoInstalar() {
    if (instalado || ler("mp-instalar-dispensado", false)) return "";
    var corpo;
    if (pedidoInstalacao) {
      corpo = '<p><b>Instale o Meu Prato no celular.</b> Ele abre como um app, funciona sem internet e guarda seus dados com mais segurança.</p>' +
        '<div class="linha-acoes"><button class="btn primario" id="instalar">Instalar app</button>';
    } else if (ehIOS) {
      corpo = '<p><b>Instale o Meu Prato no iPhone.</b> Assim ele funciona sem internet e o Safari não apaga seus dias marcados.</p>' +
        '<ol class="passos-ios"><li>Toque em <b>Compartilhar</b> ' + ICON.share + ' na barra do Safari.</li>' +
        '<li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>.</li></ol>' +
        '<div class="linha-acoes">';
    } else {
      return "";
    }
    return '<section class="aviso-instalar" aria-label="Instalar o app">' + corpo +
      '<button class="btn" id="dispensar-instalar">Agora não</button></div></section>';
  }

  // ---------- roteamento ----------
  function render() {
    var hash = location.hash.replace(/^#/, "") || "plano";
    var partes = hash.split("/"), aba = partes[0];
    var html;
    if (aba === "receita") { html = telaReceita(partes[1]); aba = "receitas"; }
    else if (aba === "receitas") html = telaReceitas();
    else if (aba === "favoritas") { filtro = "favoritas"; html = telaReceitas(); aba = "receitas"; }
    else if (aba === "frequencia") html = telaFrequencia();
    else if (aba === "compras") html = telaCompras();
    else if (aba === "quero" || aba === "despensa") { html = telaDespensa(); aba = "quero"; }
    else { html = telaPlano(); aba = "plano"; }
    main.innerHTML = avisoInstalar() + html;
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
    // Lembra qual botão estava em foco para devolver o foco a ele depois de redesenhar.
    var ativo = document.activeElement, seletor = null;
    if (ativo && ativo !== document.body) {
      if (ativo.id) seletor = "#" + CSS.escape(ativo.id);
      else ["fav", "sel", "filtro", "desp", "refdia", "dia"].some(function (k) {
        if (ativo.dataset && ativo.dataset[k] !== undefined) {
          seletor = (ativo.tagName.toLowerCase()) + "[data-" + k + '="' + CSS.escape(ativo.dataset[k]) + '"]';
          return true;
        }
        return false;
      });
    }
    render();
    window.scrollTo(0, y);
    if (seletor) { var el = main.querySelector(seletor); if (el) el.focus({ preventScroll: true }); }
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
    } else if (b.dataset.refdia) {
      alternarRefeicao(b.dataset.refdia); rerenderMantendoScroll();
    } else if (b.dataset.dia) {
      diaSel = b.dataset.dia; rerenderMantendoScroll();
      var bloco = document.querySelector(".dia");
      if (bloco && bloco.getBoundingClientRect().top < 0) bloco.scrollIntoView({ block: "start" });
    } else if (b.id === "voltar-hoje") {
      diaSel = hojeChave(); mesVisto = new Date(); mesVisto.setDate(1); rerenderMantendoScroll();
    } else if (b.id === "mes-ant" || b.id === "mes-prox") {
      mesVisto = new Date(mesVisto.getFullYear(), mesVisto.getMonth() + (b.id === "mes-ant" ? -1 : 1), 1); rerenderMantendoScroll();
    } else if (b.dataset.desp) {
      alternar(despensa, b.dataset.desp); salvarTudo();
      atualizarQueroComer(b.dataset.desp);
    } else if (b.id === "instalar" && pedidoInstalacao) {
      pedidoInstalacao.prompt();
      pedidoInstalacao.userChoice.then(function () { pedidoInstalacao = null; rerenderMantendoScroll(); });
    } else if (b.id === "dispensar-instalar") {
      gravar("mp-instalar-dispensado", true); rerenderMantendoScroll();
      toast("Tudo bem. Dá para instalar depois pelo menu do navegador.");
    } else if (b.id === "limpar-despensa") {
      var antesQuero = despensa.slice();
      despensa = []; salvarTudo(); atualizarQueroComer();
      document.getElementById("busca-despensa").focus();
      toast("Ingredientes desmarcados", function () { despensa = antesQuero; });
    } else if (b.id === "ir-receitas") {
      var alvo = document.getElementById("receitas-combinadas");
      alvo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      alvo.focus({ preventScroll: true });
    } else if (b.id === "restaurar-backup") {
      document.getElementById("arquivo-backup").click();
    } else if (b.id === "baixar-backup") {
      baixarBackup();
    } else if (b.dataset.filtro) {
      filtro = b.dataset.filtro; rerenderMantendoScroll();
    } else if (b.id === "limpar") {
      var antesSel = sel.slice(), antesChecks = Object.assign({}, checks);
      sel = []; checks = {}; salvarTudo(); render();
      toast("Lista de compras limpa", function () { sel = antesSel; checks = antesChecks; });
    } else if (b.id === "desmarcar") {
      var antesMarcados = Object.assign({}, checks);
      checks = {}; salvarTudo(); rerenderMantendoScroll();
      toast("Itens desmarcados", function () { checks = antesMarcados; });
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
    if (t.id === "arquivo-backup" && t.files && t.files[0]) { restaurarBackup(t.files[0]); t.value = ""; return; }
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

  // Se o app ficou aberto de um dia para o outro, "Hoje" passa para o dia novo.
  var ultimoHoje = hojeChave();
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    var agora = hojeChave();
    if (agora === ultimoHoje) return;
    if (diaSel === ultimoHoje) diaSel = agora;
    ultimoHoje = agora;
    mesVisto = new Date(); mesVisto.setDate(1);
    rerenderMantendoScroll();
  });
  render();
})();
