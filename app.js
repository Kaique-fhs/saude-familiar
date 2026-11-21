(function () {
  "use strict";

  var PLANO = window.PLANO;
  var RECEITAS = window.RECEITAS;
  var main = document.getElementById("conteudo");

  // ---------- conta e sincronização (só com SF_CONFIG.apiUrl preenchido) ----------
  // Sem apiUrl nada disto é montado: o app fica como sempre foi, tudo só no aparelho (chaves mp-*).
  var CONFIG = window.SF_CONFIG || {};
  var SF = window.SF || {};
  var armazem = null, apiSF = null, contaUI = null, sincronia = null, sincroniaLigada = null, fotosSF = null;
  var modo = "antigo"; // "antigo": mp-* sem prefixo | "conta": sf:<id>:* | "entrar": só a tela de conta
  var userId = null;
  if (CONFIG.apiUrl && SF.api && SF.local && SF.dados && SF.fotos && SF.sincronia && SF.conta) {
    try { armazem = SF.local.criar({ storage: window.localStorage }); } catch (e) { armazem = null; }
  }
  if (armazem) iniciarConta();

  // ---------- armazenamento local (no modo conta, no prefixo do usuário) ----------
  function ler(chave, padrao) {
    if (userId) return armazem.ler(userId, chave, padrao);
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; }
    catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    if (userId) return armazem.gravar(userId, chave, valor);
    try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; }
  }
  var favs = ler("mp-favs", []);
  var sel = ler("mp-sel", []);
  var checks = ler("mp-checks", {});
  var checksPlano = ler("mp-checks-plano", {});
  var despensa = ler("mp-quero", []);
  var termoDesp = "";
  var diario = ler("mp-diario", {});
  var ultimoBackup = ler("mp-ultimo-backup", null);
  var treinos = ler("mp-treinos", {}); // { "2026-11-24": ["academia", "pilates"] }
  var registros = ler("mp-registros", {});
  var backupsMes = ler("mp-backups-mes", {}); // { "2026-11": "2026-11-30" } dia em que a cópia de cada mês foi salva

  // Pede ao navegador para não apagar os dados do app quando faltar espaço (fotos, dias marcados).
  function pedirPersistencia() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(function (ja) { if (!ja) return navigator.storage.persist(); }).catch(function () {});
      }
    } catch (e) { /* navegador sem suporte */ }
  }
  pedirPersistencia();

  // Relê tudo do armazenamento (outra janela do app pode ter gravado algo).
  function recarregarEstado() {
    favs = ler("mp-favs", []); sel = ler("mp-sel", []); checks = ler("mp-checks", {});
    checksPlano = ler("mp-checks-plano", {}); despensa = ler("mp-quero", []); diario = ler("mp-diario", {});
    ultimoBackup = ler("mp-ultimo-backup", null); treinos = ler("mp-treinos", {}); registros = ler("mp-registros", {});
    backupsMes = ler("mp-backups-mes", {});
    // modo conta: o que foi relido vira a referência da fila (senão a próxima gravação reenviaria o que outra aba mandou)
    if (sincronia) { ultimoEstado = copiaEstado(); sincronia.rebase(ultimoEstado); }
  } // { "2026-11-20": { almoco: { escolhas, receita, foto, hora } } }
  var diaSel = hojeChave(); // dia que está sendo marcado
  var mesVisto = new Date(); mesVisto.setDate(1);
  var filtro = "todas";
  var termo = "";

  function salvarTudo() {
    if (!gravarDados()) avisarFalhaGravacao();
    atualizarContador();
    registrarMudancas();
  }
  function gravarDados() {
    var ok = true;
    ok = gravar("mp-favs", favs) && ok;
    ok = gravar("mp-sel", sel) && ok;
    ok = gravar("mp-checks", checks) && ok;
    ok = gravar("mp-checks-plano", checksPlano) && ok;
    ok = gravar("mp-quero", despensa) && ok;
    ok = gravar("mp-diario", diario) && ok;
    ok = gravar("mp-registros", registros) && ok;
    ok = gravar("mp-treinos", treinos) && ok;
    return ok;
  }
  var ultimoAvisoFalha = 0;
  function avisarFalhaGravacao() {
    if (Date.now() - ultimoAvisoFalha < 10000) return;
    ultimoAvisoFalha = Date.now();
    setTimeout(function () { toast("Não consegui salvar: o armazenamento do celular está cheio. Libere espaço e tente de novo."); }, 50);
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
  function toastAcao(msg, rotulo, acao) {
    clearTimeout(toastT);
    desfazerAtual = null;
    toastEl.innerHTML = "";
    toastEl.appendChild(document.createTextNode(msg));
    var bt = document.createElement("button");
    bt.type = "button"; bt.className = "desfazer"; bt.textContent = rotulo;
    bt.addEventListener("click", function () { toastEl.classList.remove("show", "com-acao"); acao(); });
    toastEl.appendChild(bt);
    toastEl.classList.add("com-acao", "show");
    toastT = setTimeout(function () { toastEl.classList.remove("show", "com-acao"); }, 8000);
  }

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
    prato: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18a9 9 0 0 1-18 0zM12 9V4M8 9l-1-3M16 9l1-3"/></svg>',
    whats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.5 9.5c.3 1.8 1.7 3.6 3.6 4.4l1.2-1 1.7.8c-.2 1-1 1.6-2 1.5-2.9-.3-5.5-3-5.8-5.8-.1-1 .5-1.8 1.5-2l.8 1.7z"/></svg>',
    peso: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
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
  // Exercícios programados para o dia da semana daquela data.
  var DIAS_LONGOS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  function exerciciosDoDia(k) {
    var ds = dataDaChave(k).getDay();
    // "desde"/"ate" (AAAA-MM-DD, opcionais): mudar a agenda não muda os dias que já passaram
    return (PLANO.exercicios || []).filter(function (e) {
      return e.dias.indexOf(ds) >= 0 && (!e.desde || k >= e.desde) && (!e.ate || k <= e.ate);
    });
  }
  function treinosFeitos(k) {
    var prog = exerciciosDoDia(k).map(function (e) { return e.id; });
    return (treinos[k] || []).filter(function (id) { return prog.indexOf(id) >= 0; });
  }
  function totalDoDia(k) { return TOTAL_REF + exerciciosDoDia(k).length; }
  function feitosDoDia(k) { return feitasNoDia(k).length + treinosFeitos(k).length; }
  // Dia cumprido = as 5 refeições + os exercícios programados para aquele dia.
  function diaCompleto(k) { return feitosDoDia(k) >= totalDoDia(k); }
  function juntarNomes(l) { return l.length <= 1 ? l.join("") : l.slice(0, -1).join(", ") + " e " + l[l.length - 1]; }

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

  function nomeCurto(texto) { return texto.split(" - ")[0].split(" (")[0]; }
  function resumoRegistro(reg) {
    var partes = [];
    if (reg.hora) partes.push(reg.hora);
    var comidas = (reg.escolhas || []).map(nomeCurto).filter(function (n) { return !/^Salada de folhas|^Verduras cozidas|^Feijão/.test(n); });
    if (comidas.length) partes.push(comidas.join(", "));
    var rec = reg.receita && porId(reg.receita);
    if (rec) partes.push("Receita: " + rec.nome);
    if (!reg.foto) partes.push("sem foto");
    return partes.join(" · ");
  }

  function blocoDia() {
    var feitas = feitasNoDia(diaSel), seq = sequencia(), regsDia = registros[diaSel] || {};
    return '<section class="dia" aria-labelledby="titulo-dia">' +
      '<div class="dia-topo"><h3 id="titulo-dia">' + rotuloDia(diaSel) + ': ' + feitas.length + ' de ' + TOTAL_REF + ' refeições' +
      (exerciciosDoDia(diaSel).length ? ' · ' + treinosFeitos(diaSel).length + ' de ' + exerciciosDoDia(diaSel).length + ' exercício' + (exerciciosDoDia(diaSel).length === 1 ? '' : 's') : '') + '</h3>' +
      (seq ? '<span class="sequencia">' + seq + ' dia' + (seq === 1 ? '' : 's') + ' seguido' + (seq === 1 ? '' : 's') + '</span>' : '') + '</div>' +
      '<div class="barra" aria-hidden="true"><span style="width:' + Math.round(feitosDoDia(diaSel) / totalDoDia(diaSel) * 100) + '%"></span></div>' +
      '<p class="dica-dia">Registre cada refeição e cada exercício com uma foto tirada na hora. O dia só fica completo com as duas partes. Os registros só podem ser feitos no próprio dia; os dias passados ficam para consulta no calendário.</p>' +
      '<h4 class="titulo-secao-dia">' + ICON.prato + 'Refeições <span class="contagem">' + feitas.length + ' de ' + TOTAL_REF + '</span></h4>' +
      '<ul class="lista refeicoes-dia">' +
      PLANO.refeicoes.map(function (r) {
        var ok = feitas.indexOf(r.id) >= 0, reg = regsDia[r.id];
        var icone = reg && reg.foto
          ? '<img class="mini-foto" data-foto="' + esc(reg.foto) + '" alt="">'
          : '<span class="' + (ok ? 'ok' : 'pendente') + '" aria-hidden="true">' + (ok ? ICON.check : ICON.camera) + '</span>';
        var passado = diaSel !== hojeChave();
        var detalhe = reg ? resumoRegistro(reg) : ok ? (passado ? "Marcada sem foto" : "Marcada sem foto · toque para completar") : passado ? "Não registrada" : (r.hora ? r.hora + " · " : "") + "Toque para registrar";
        return '<li><button class="linha-ref" data-registrar="' + r.id + '" aria-label="' + esc(r.nome) + ': ' + (ok ? "registrada" : "não registrada") + '. ' + esc(detalhe) + '">' + icone +
          '<span class="flex1"><span class="nome">' + esc(r.nome) + '</span><span class="detalhes">' + esc(detalhe) + '</span></span>' +
          '<span class="seta-linha" aria-hidden="true">›</span></button></li>';
      }).join("") +
      '</ul>' + blocoExercicios(diaSel) +
      '<button class="btn whats compartilhar-dia" id="compartilhar-dia">' + ICON.whats + 'Compartilhar resultado ' + (diaSel === hojeChave() ? 'de hoje' : 'do dia') + '</button>' +
      (diaSel !== hojeChave() ? '<button class="btn mini voltar-hoje" id="voltar-hoje">Voltar para hoje</button>' : '') +
      '</section>';
  }

  function blocoExercicios(k) {
    var ex = exerciciosDoDia(k), feitos = treinosFeitos(k), regsDia = registros[k] || {};
    var titulo = '<h4 class="titulo-secao-dia">' + ICON.peso + 'Exercícios' +
      (ex.length ? ' <span class="contagem">' + feitos.length + ' de ' + ex.length + '</span>' : '') + '</h4>';
    if (!ex.length) return '<div class="exercicios">' + titulo + '<p class="sem-exercicio">Sem exercício programado ' + (k === hojeChave() ? 'hoje' : 'nesse dia') + '. Descanso!</p></div>';
    return '<div class="exercicios">' + titulo + '<ul class="lista refeicoes-dia">' + ex.map(function (e) {
      var ok = feitos.indexOf(e.id) >= 0, reg = regsDia[e.id];
      var icone = reg && reg.foto
        ? '<img class="mini-foto" data-foto="' + esc(reg.foto) + '" alt="">'
        : '<span class="' + (ok ? 'ok' : 'pendente') + '" aria-hidden="true">' + (ok ? ICON.check : ICON.camera) + '</span>';
      var passado = k !== hojeChave();
      var detalhe = reg ? (reg.hora ? reg.hora + " · " : "") + (reg.foto ? "Treino registrado" : "sem foto") : ok ? "Marcado sem foto" : passado ? "Não registrado" : "Toque para registrar com foto";
      return '<li><button class="linha-ref" data-registrar="' + e.id + '" aria-label="' + esc(e.nome) + ': ' + (ok ? "registrado" : "não registrado") + '. ' + esc(detalhe) + '">' + icone +
        '<span class="flex1"><span class="nome">' + esc(e.nome) + '</span><span class="detalhes">' + esc(detalhe) + '</span></span>' +
        '<span class="seta-linha" aria-hidden="true">›</span></button></li>';
    }).join("") + '</ul></div>';
  }

  function blocoAgenda() {
    var hojeDs = new Date().getDay(), linhas = [];
    for (var ds = 1; ds <= 7; ds++) {
      var d = ds % 7;
      var ex = (PLANO.exercicios || []).filter(function (e) { return e.dias.indexOf(d) >= 0; }).map(function (e) { return e.nome; });
      if (ex.length) linhas.push('<li' + (d === hojeDs ? ' class="hoje"' : '') + '><b>' + DIAS_LONGOS[d] + (d === hojeDs ? ' (hoje)' : '') + '</b><span>' + juntarNomes(ex) + '</span></li>');
    }
    return linhas.length ? '<section class="agenda" aria-labelledby="titulo-agenda"><h3 id="titulo-agenda">' + ICON.peso + 'Exercícios da semana</h3><ul>' + linhas.join("") + '</ul></section>' : '';
  }

  // ---------- fotos das refeições (IndexedDB, só neste aparelho) ----------
  // Modo antigo: banco "meu-prato" de sempre. Modo conta: um banco por usuário (saude-familiar-<id>).
  var banco = null, bancoAberto = null, nomeBancoAberto = null, bancoTravado = false;
  function nomeBancoAtual() { return userId ? SF.fotos.nomeBanco(userId) : "meu-prato"; }
  function abrirBanco() {
    if (bancoTravado) return Promise.reject(new Error("banco sendo apagado"));
    if (!banco) {
      var nome = nomeBancoAtual();
      banco = new Promise(function (ok, erro) {
        if (!window.indexedDB) { erro(new Error("sem IndexedDB")); return; }
        var r = indexedDB.open(nome, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("fotos"); };
        r.onsuccess = function () {
          var db = r.result;
          // a conta mudou (ou o banco está sendo apagado) enquanto abria: não fica com a conexão
          if (bancoTravado || nome !== nomeBancoAtual()) { db.close(); erro(new Error("conta trocada")); return; }
          bancoAberto = db; nomeBancoAberto = nome;
          // outra aba quer apagar o banco: solta a conexão para não travar o deleteDatabase
          db.onversionchange = function () { db.close(); if (bancoAberto === db) { bancoAberto = null; nomeBancoAberto = null; banco = null; } };
          ok(db);
        };
        r.onerror = function () { erro(r.error); };
      });
    }
    return banco;
  }
  function fecharBanco() {
    try { if (bancoAberto) bancoAberto.close(); } catch (e) { /* já fechado */ }
    bancoAberto = null; nomeBancoAberto = null; banco = null;
  }
  // Troca de conta: fecha o banco e solta as imagens da conta anterior.
  function trocarBanco() {
    fecharBanco();
    bancoTravado = false;
    Object.keys(urlsFotos).forEach(function (id) { URL.revokeObjectURL(urlsFotos[id]); });
    urlsFotos = {};
  }
  function noBanco(modo, fn) {
    return abrirBanco().then(function (db) {
      return new Promise(function (ok, erro) {
        var tx = db.transaction("fotos", modo), req = fn(tx.objectStore("fotos"));
        tx.oncomplete = function () { ok(req ? req.result : undefined); };
        tx.onerror = tx.onabort = function () { erro(tx.error || new Error("transação")); };
      });
    });
  }
  function salvarFoto(id, blob) { return noBanco("readwrite", function (s) { return s.put(blob, id); }); }
  function lerFoto(id) { return noBanco("readonly", function (s) { return s.get(id); }); }
  function apagarFoto(id) { return noBanco("readwrite", function (s) { return s.delete(id); }); }
  function chavesFotos() { return noBanco("readonly", function (s) { return s.getAllKeys(); }); }

  var urlsFotos = {};
  // No modo conta a foto que não está no aparelho é baixada da conta (sob demanda).
  function obterFoto(id) { return fotosSF ? fotosSF.garantir(id) : lerFoto(id); }
  function urlFoto(id) {
    if (urlsFotos[id]) return Promise.resolve(urlsFotos[id]);
    return obterFoto(id).then(function (blob) {
      if (!blob) return null;
      urlsFotos[id] = URL.createObjectURL(blob);
      return urlsFotos[id];
    });
  }
  function preencherFotos(raiz) {
    (raiz || document).querySelectorAll("img[data-foto]").forEach(function (img) {
      urlFoto(img.dataset.foto).then(function (u) { if (u) img.src = u; else img.classList.add("sem-foto"); }).catch(function () {});
    });
  }
  function fotoEmUso(id) {
    return Object.keys(registros).some(function (k) {
      return Object.keys(registros[k]).some(function (ref) { return registros[k][ref].foto === id; });
    });
  }
  function apagarSeOrfa(id) {
    if (id && !fotoEmUso(id)) {
      apagarFoto(id).catch(function () {});
      if (urlsFotos[id]) { URL.revokeObjectURL(urlsFotos[id]); delete urlsFotos[id]; }
    }
  }

  // Reduz a foto para no máximo 1024 px e salva em JPEG (cerca de 60 a 120 KB): basta para comprovar.
  function comprimirFoto(arquivo) {
    return new Promise(function (ok, erro) {
      var img = new Image(), u = URL.createObjectURL(arquivo);
      img.onload = function () {
        var max = 1024, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { if (b) ok(b); else erro(new Error("foto")); }, "image/jpeg", 0.65);
      };
      img.onerror = function () { URL.revokeObjectURL(u); erro(new Error("foto")); };
      img.src = u;
    });
  }

  // ---------- compartilhar a entrega (foto + texto) no WhatsApp ----------
  function textoEntrega(dia, ref, reg) {
    var ex = exPorId(ref), r = ex || refPorId(ref);
    var quando = rotuloDia(dia).toLowerCase() + (reg.hora ? " às " + reg.hora : "");
    var linhas = [(ex ? "💪 " + ex.nome + " feito" : "✅ " + r.nome + " registrado") + " (" + quando + ")"];
    if (!ex) {
      var comidas = (reg.escolhas || []).map(nomeCurto);
      if (comidas.length) linhas.push("Comi: " + comidas.join(", "));
      var rec = reg.receita && porId(reg.receita);
      if (rec) linhas.push("Receita: " + rec.nome);
    }
    var nEx = exerciciosDoDia(dia).length;
    linhas.push("No dia: " + feitasNoDia(dia).length + " de " + TOTAL_REF + " refeições" +
      (nEx ? " · " + treinosFeitos(dia).length + " de " + nEx + " exercício" + (nEx === 1 ? "" : "s") : ""));
    if (diaCompleto(dia)) linhas.push("🎉 Dia completo!");
    return linhas.join("\n");
  }

  function textoResultadoDia(k) {
    var regs = registros[k] || {}, feitas = feitasNoDia(k), ex = exerciciosDoDia(k), feitosEx = treinosFeitos(k);
    var dataCompleta = k.split("-").reverse().join("/");
    var linhas = ["📋 Resultado do dia: " + (k === hojeChave() ? "hoje, " : SEMANA[dataDaChave(k).getDay()] + ", ") + dataCompleta, ""];
    linhas.push("Refeições: " + feitas.length + " de " + TOTAL_REF);
    PLANO.refeicoes.forEach(function (r) {
      var ok = feitas.indexOf(r.id) >= 0, reg = regs[r.id];
      var comidas = reg ? (reg.escolhas || []).map(nomeCurto).filter(function (n) { return !/^Salada de folhas|^Verduras cozidas|^Feijão/.test(n); }) : [];
      linhas.push((ok ? "✅ " : "❌ ") + r.nome + (reg && reg.hora ? " (" + reg.hora + ")" : "") +
        (comidas.length ? ": " + comidas.join(", ") : "") + (ok && reg && !reg.foto && r.id !== "acordar" ? " · sem foto" : ""));
    });
    if (ex.length) {
      linhas.push("", "Exercícios: " + feitosEx.length + " de " + ex.length);
      ex.forEach(function (e) {
        var ok = feitosEx.indexOf(e.id) >= 0, reg = regs[e.id];
        linhas.push((ok ? "✅ " : "❌ ") + e.nome + (reg && reg.hora ? " (" + reg.hora + ")" : ""));
      });
    }
    linhas.push("", diaCompleto(k) ? "🎉 Dia completo!" : k === hojeChave() ? "⏳ Dia em andamento" : "Dia incompleto");
    return linhas.join("\n");
  }

  function compartilharResultadoDia(k) {
    var texto = textoResultadoDia(k);
    if (navigator.share && window.matchMedia && matchMedia("(pointer: coarse)").matches) {
      navigator.share({ text: texto }).catch(function (err) {
        if (!err || err.name !== "AbortError") abrirWhatsSoTexto(texto);
      });
      return;
    }
    abrirWhatsSoTexto(texto);
  }

  function abrirWhatsSoTexto(texto) {
    window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank", "noopener");
  }

  // Precisa ser chamada direto no toque (o celular só abre o menu de compartilhar logo após um toque),
  // por isso a foto já chega pronta em "blob".
  function compartilharEntrega(dia, ref, blob) {
    var reg = (registros[dia] || {})[ref];
    if (!reg) return;
    if (dia !== hojeChave()) { toast("De dias passados, só dá para compartilhar o resultado do dia."); return; }
    var texto = textoEntrega(dia, ref, reg), arquivo = null;
    if (blob) { try { arquivo = new File([blob], "saude-familiar-" + dia + "-" + ref + ".jpg", { type: "image/jpeg" }); } catch (e) { arquivo = null; } }
    if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      navigator.share({ files: [arquivo], text: texto }).catch(function (err) {
        if (!err || err.name !== "AbortError") abrirWhatsSoTexto(texto);
      });
      return;
    }
    if (navigator.share && window.matchMedia && matchMedia("(pointer: coarse)").matches) {
      navigator.share({ text: texto }).catch(function (err) {
        if (!err || err.name !== "AbortError") abrirWhatsSoTexto(texto);
      });
      return;
    }
    abrirWhatsSoTexto(texto);
  }

  // ---------- registro de uma refeição: o que comeu + foto ----------
  var FOTO_OPCIONAL = ["acordar"]; // "Ao acordar" é só água com limão
  var dlg = null, regAtual = null;
  function exPorId(id) { var l = PLANO.exercicios || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  // Onde fica marcado: refeições no diário, exercícios nos treinos.
  function marcadosDe(id) { return exPorId(id) ? treinos : diario; }
  function refPorId(id) { for (var i = 0; i < PLANO.refeicoes.length; i++) if (PLANO.refeicoes[i].id === id) return PLANO.refeicoes[i]; return null; }
  function horaAgora() { var d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

  function abrirRegistro(refId) {
    var ex = exPorId(refId);
    var r = ex ? { id: ex.id, nome: ex.nome, itens: [] } : refPorId(refId);
    if (!r) return;
    var ant = (registros[diaSel] || {})[refId] || null;
    var leitura = diaSel !== hojeChave();
    if (leitura && !ant) { toast("Só dá para registrar no próprio dia."); return; }
    var escolhidas = ant ? ant.escolhas || [] : null;
    regAtual = { ref: refId, dia: diaSel, blob: null, fotoAntiga: ant ? ant.foto : null, previa: null, blobSalvo: null };
    if (ant && ant.foto) {
      var esperando = regAtual;
      obterFoto(ant.foto).then(function (b) { if (regAtual === esperando) regAtual.blobSalvo = b || null; }).catch(function () {});
    }
    var fotoObrig = FOTO_OPCIONAL.indexOf(refId) < 0;

    var h = '<form class="reg" novalidate>' +
      '<div class="reg-topo"><h2 id="reg-titulo">' + esc(r.nome) + '</h2><span class="chip">' + rotuloDia(diaSel) + '</span>' +
      '<button type="button" class="btn-fav" id="reg-fechar" aria-label="Fechar">✕</button></div>' +
      '<p class="descricao">' + (ex ? 'Tire uma foto para registrar o treino (no aparelho, na aula, no espelho da academia...).'
        : 'Marque o que você comeu' + (fotoObrig ? ' e tire uma foto do prato.' : '. A foto é opcional nesta refeição.')) + '</p>';
    r.itens.forEach(function (it, i) {
      var opcoes = [it.principal].concat(it.opcoes);
      if (opcoes.length === 1) {
        var marcado = escolhidas ? escolhidas.indexOf(it.principal) >= 0 : true;
        h += '<label class="reg-op reg-fixo"><input type="checkbox" name="g' + i + '" value="0"' + (marcado ? ' checked' : '') + '><span>' + esc(it.principal) + '</span></label>';
      } else {
        var sel0 = 0;
        if (escolhidas) opcoes.forEach(function (o, j) { if (escolhidas.indexOf(o) >= 0) sel0 = j; });
        h += '<fieldset class="reg-grupo"><legend>Escolha uma opção</legend>' + opcoes.map(function (o, j) {
          return '<label class="reg-op"><input type="radio" name="g' + i + '" value="' + j + '"' + (j === sel0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
        }).join("") + '</fieldset>';
      }
    });
    var recSel = ant ? ant.receita : null;
    if (!ex) h += '<label class="reg-receita">Fez alguma receita do caderno? <span class="detalhes">(opcional)</span>' +
      '<select id="reg-receita"><option value="">Não</option>' + RECEITAS.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === recSel ? ' selected' : '') + '>' + esc(x.nome) + '</option>';
      }).join("") + '</select></label>';
    h += '<div class="reg-foto"><img id="reg-previa" alt="' + (ex ? 'Foto do treino' : 'Foto do prato') + '"' + (regAtual.fotoAntiga ? ' data-foto="' + esc(regAtual.fotoAntiga) + '"' : ' hidden') + '>' +
      '<p class="reg-sem-foto" id="reg-sem-foto"' + (regAtual.fotoAntiga ? ' hidden' : '') + '>' + ICON.camera + (fotoObrig ? (ex ? 'Falta a foto do treino' : 'Falta a foto do prato') : 'Sem foto') + '</p>' +
      '<div class="linha-acoes"><button type="button" class="btn primario" id="reg-camera">' + ICON.camera + (regAtual.fotoAntiga ? 'Tirar outra foto' : 'Tirar foto') + '</button>' +
      '</div>' +
      '<input type="file" id="reg-arq-camera" accept="image/*" capture="environment" class="sr" tabindex="-1" aria-hidden="true">' +
      '<p class="detalhes reg-regra">A foto precisa ser tirada agora, pela câmera.</p></div>' +
      '<div class="reg-rodape">' + (ant || marcadosDe(refId)[diaSel] && marcadosDe(refId)[diaSel].indexOf(refId) >= 0 ? '<button type="button" class="btn" id="reg-apagar">Apagar registro</button>' : '') +
      '<button type="submit" class="btn primario" id="reg-salvar">Salvar registro</button></div>' +
      (ant && !leitura ? '<button type="button" class="btn whats" id="reg-compartilhar">' + ICON.whats + 'Compartilhar no WhatsApp</button>' : '') +
      '</form>';

    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "registro"; dlg.setAttribute("aria-labelledby", "reg-titulo");
      document.body.appendChild(dlg);
      ligarDialogo();
    }
    dlg.innerHTML = h;
    preencherFotos(dlg);
    if (!leitura && regAtual.fotoAntiga) {
      // foto já registrada: não pode ser trocada nem apagada (dá para ajustar o que comeu)
      dlg.querySelectorAll("#reg-camera, #reg-apagar, .reg-regra, #reg-arq-camera").forEach(function (el) { el.hidden = true; });
      var trava = document.createElement("p");
      trava.className = "reg-travada";
      trava.textContent = "A foto registrada não pode ser trocada nem apagada.";
      dlg.querySelector(".reg-foto").appendChild(trava);
    }
    if (leitura) {
      // dia passado: só consulta
      dlg.querySelectorAll("input, select").forEach(function (el) { el.disabled = true; });
      dlg.querySelectorAll("#reg-camera, #reg-apagar, #reg-salvar, #reg-sem-foto, .reg-regra").forEach(function (el) { el.hidden = true; });
      var aviso = document.createElement("p");
      aviso.className = "reg-leitura";
      aviso.textContent = "Registro de " + rotuloDia(diaSel).toLowerCase() + ". Dias passados ficam só para consulta.";
      dlg.querySelector(".reg-topo").after(aviso);
    } else {
      atualizarBotaoSalvar();
    }
    dlg.showModal();
    dlg.scrollTop = 0;
  }

  function atualizarBotaoSalvar() {
    var precisa = FOTO_OPCIONAL.indexOf(regAtual.ref) < 0;
    var tem = !!(regAtual.blob || regAtual.fotoAntiga);
    var b = dlg.querySelector("#reg-salvar");
    b.disabled = precisa && !tem;
    b.textContent = precisa && !tem ? "Tire a foto para salvar" : "Salvar registro";
  }

  function fecharRegistro() {
    if (regAtual && regAtual.previa) URL.revokeObjectURL(regAtual.previa);
    regAtual = null;
    if (dlg && dlg.open) dlg.close();
  }

  var FOTO_MAX_MINUTOS = 15; // foto mais antiga que isso não vale (veio da galeria)
  function receberFoto(arquivo) {
    if (!arquivo || !regAtual || regAtual.fotoAntiga) return; // foto registrada não pode ser trocada
    var aviso = dlg.querySelector("#reg-sem-foto");
    if (arquivo.lastModified && Date.now() - arquivo.lastModified > FOTO_MAX_MINUTOS * 60000) {
      aviso.hidden = false;
      aviso.textContent = "Essa foto é antiga. Tire uma foto agora, pela câmera.";
      return;
    }
    aviso.hidden = false; aviso.textContent = "Preparando a foto...";
    comprimirFoto(arquivo).then(function (blob) {
      if (!regAtual) return;
      if (regAtual.previa) URL.revokeObjectURL(regAtual.previa);
      regAtual.blob = blob;
      regAtual.previa = URL.createObjectURL(blob);
      var img = dlg.querySelector("#reg-previa");
      img.src = regAtual.previa; img.hidden = false;
      aviso.hidden = true;
      dlg.querySelector("#reg-camera").lastChild.textContent = "Tirar outra foto";
      atualizarBotaoSalvar();
    }).catch(function () {
      aviso.textContent = "Não consegui abrir essa foto. Tente de novo.";
    });
  }

  function salvarRegistro() {
    var ex = exPorId(regAtual.ref);
    var r = ex ? { itens: [] } : refPorId(regAtual.ref), form = dlg.querySelector("form"), escolhas = [];
    r.itens.forEach(function (it, i) {
      var opcoes = [it.principal].concat(it.opcoes);
      var marcado = form.querySelector('input[name="g' + i + '"]:checked');
      if (marcado) escolhas.push(opcoes[+marcado.value]);
    });
    var campoReceita = dlg.querySelector("#reg-receita");
    var receita = campoReceita ? campoReceita.value || null : null;
    var dia = regAtual.dia, ref = regAtual.ref, fotoAntiga = regAtual.fotoAntiga, blob = regAtual.blob;
    if (dia !== hojeChave()) { fecharRegistro(); toast("O dia virou. Abra o registro de novo para marcar hoje."); rerenderMantendoScroll(); return; }
    var botao = dlg.querySelector("#reg-salvar");
    botao.disabled = true; botao.textContent = "Salvando...";
    if (fotoAntiga) blob = null; // nunca troca uma foto já registrada
    var passo = Promise.resolve(fotoAntiga);
    if (blob) {
      var novoId = "f-" + dia + "-" + ref + "-" + Date.now();
      passo = salvarFoto(novoId, blob).then(function () { pedirPersistencia(); return novoId; });
    }
    passo.then(function (fotoId) {
      var antes = (registros[dia] || {})[ref];
      registros[dia] = registros[dia] || {};
      registros[dia][ref] = { escolhas: escolhas, receita: receita, foto: fotoId || null, hora: (antes && antes.hora) || horaAgora() };
      var marcados = marcadosDe(ref);
      var l = (marcados[dia] || []).slice();
      var novo = l.indexOf(ref) < 0;
      if (novo) l.push(ref);
      marcados[dia] = l;
      salvarTudo();
      if (blob && fotoAntiga) apagarSeOrfa(fotoAntiga);
      fecharRegistro();
      rerenderMantendoScroll();
      var msg = novo && diaCompleto(dia) ? rotuloDia(dia) + " cumprido! Parabéns" : "Registro salvo";
      var fotoParaEnviar = blob ? Promise.resolve(blob) : fotoId ? lerFoto(fotoId).catch(function () { return null; }) : Promise.resolve(null);
      fotoParaEnviar.then(function (b) {
        toastAcao(msg, "Compartilhar", function () { compartilharEntrega(dia, ref, b); });
      });
    }).catch(function () {
      botao.disabled = false; botao.textContent = "Salvar registro";
      toast("Não consegui guardar a foto. Veja se o celular tem espaço livre.");
    });
  }

  function apagarRegistro() {
    var dia = regAtual.dia, ref = regAtual.ref;
    if (regAtual.fotoAntiga) { toast("Registro com foto não pode ser apagado."); return; }
    if (dia !== hojeChave()) { fecharRegistro(); toast("Dias passados ficam só para consulta."); rerenderMantendoScroll(); return; }
    var antesReg = (registros[dia] || {})[ref] || null;
    var marcados = marcadosDe(ref);
    var antesDia = (marcados[dia] || []).slice();
    if (registros[dia]) { delete registros[dia][ref]; if (!Object.keys(registros[dia]).length) delete registros[dia]; }
    var l = antesDia.filter(function (x) { return x !== ref; });
    if (l.length) marcados[dia] = l; else delete marcados[dia];
    salvarTudo();
    fecharRegistro();
    rerenderMantendoScroll();
    toast("Registro apagado", function () {
      if (antesReg) { registros[dia] = registros[dia] || {}; registros[dia][ref] = antesReg; }
      if (antesDia.length) marcadosDe(ref)[dia] = antesDia;
    });
    // a foto só é apagada de vez depois que o "Desfazer" some
    if (antesReg && antesReg.foto) setTimeout(function () { apagarSeOrfa(antesReg.foto); }, 7000);
  }

  function ligarDialogo() {
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) { fecharRegistro(); return; } // toque fora do quadro
      var b = e.target.closest("button");
      if (!b) return;
      if (b.id === "reg-fechar") fecharRegistro();
      else if (b.id === "reg-camera") dlg.querySelector("#reg-arq-camera").click();
      else if (b.id === "reg-apagar") apagarRegistro();
      else if (b.id === "reg-compartilhar" && regAtual) compartilharEntrega(regAtual.dia, regAtual.ref, regAtual.blobSalvo);
    });
    dlg.addEventListener("change", function (e) {
      if (e.target.type === "file") { receberFoto(e.target.files && e.target.files[0]); e.target.value = ""; }
    });
    dlg.addEventListener("submit", function (e) { e.preventDefault(); if (!dlg.querySelector("#reg-salvar").disabled) salvarRegistro(); });
    dlg.addEventListener("close", function () { if (regAtual) fecharRegistro(); });
  }

  // Visões do calendário: tudo junto, só alimentação ou só exercício físico.
  var MODOS_CAL = [
    ["completo", "Completo"],
    ["alimentacao", "Alimentação"],
    ["exercicio", "Exercício físico"]
  ];
  var modoCal = ler("mp-modo-cal", "completo");
  if (!MODOS_CAL.some(function (m) { return m[0] === modoCal; })) modoCal = "completo";

  // Quanto foi feito e quanto era para fazer no dia, conforme a visão escolhida.
  function contagemDia(k, modo) {
    if (modo === "alimentacao") return { n: feitasNoDia(k).length, tot: TOTAL_REF };
    if (modo === "exercicio") return { n: treinosFeitos(k).length, tot: exerciciosDoDia(k).length };
    return { n: feitosDoDia(k), tot: totalDoDia(k) };
  }

  function blocoCalendario() {
    var ano = mesVisto.getFullYear(), mes = mesVisto.getMonth();
    var primeiro = new Date(ano, mes, 1), dias = new Date(ano, mes + 1, 0).getDate();
    var hoje = hojeChave(), cumpridos = 0, comMeta = 0;
    var h = '<section class="calendario" aria-labelledby="titulo-cal">' +
      '<div class="cal-modos" role="group" aria-label="O que mostrar no calendário">' + MODOS_CAL.map(function (m) {
        return '<button data-modocal="' + m[0] + '" aria-pressed="' + (modoCal === m[0]) + '">' + m[1] + '</button>';
      }).join("") + '</div>' +
      '<div class="cal-topo"><button class="btn-fav" id="mes-ant" aria-label="Mês anterior">' + ICON.back + '</button>' +
      '<h3 id="titulo-cal">' + MESES[mes].charAt(0).toUpperCase() + MESES[mes].slice(1) + ' de ' + ano + '</h3>' +
      '<button class="btn-fav seta-dir" id="mes-prox" aria-label="Próximo mês"' + (ano * 12 + mes >= new Date().getFullYear() * 12 + new Date().getMonth() ? ' disabled' : '') + '>' + ICON.back + '</button></div>' +
      '<div class="cal-grade">' + SEMANA.map(function (s) { return '<span class="cal-sem" aria-hidden="true">' + s.charAt(0).toUpperCase() + '</span>'; }).join("");
    for (var i = 0; i < primeiro.getDay(); i++) h += '<span></span>';
    for (var dia = 1; dia <= dias; dia++) {
      var k = chaveData(new Date(ano, mes, dia)), c = contagemDia(k, modoCal), n = c.n, tot = c.tot, futuro = k > hoje;
      var classe, desc = dia + " de " + MESES[mes] + ": ";
      if (!tot) {
        // visão de exercício num dia sem treino programado
        classe = "descanso"; desc += "sem treino programado";
      } else {
        if (!futuro) comMeta++;
        if (n >= tot) cumpridos++;
        classe = n >= tot ? "completo" : (n ? "parcial" : "");
        var oque = modoCal === "alimentacao" ? "refeições" : modoCal === "exercicio" ? "exercícios" : "itens (refeições e exercícios)";
        desc += n >= tot ? "cumprido" : n ? n + " de " + tot + " " + oque : "nada marcado";
      }
      h += '<button class="cal-dia ' + classe + (k === hoje ? ' hoje' : '') + (k === diaSel ? ' sel' : '') + '" data-dia="' + k + '"' +
        (futuro ? ' disabled' : '') + ' aria-pressed="' + (k === diaSel) + '" aria-label="' + desc + '">' + dia +
        (n && n < tot ? '<small>' + n + '/' + tot + '</small>' : '') + '</button>';
    }
    var legenda, resumo, nomeMes = MESES[mes];
    if (modoCal === "alimentacao") {
      legenda = '<span class="ponto completo"></span>5 de 5 refeições <span class="ponto parcial"></span>Em parte';
      resumo = '<b>' + cumpridos + '</b> dia' + (cumpridos === 1 ? '' : 's') + ' com alimentação completa em ' + nomeMes + '.';
    } else if (modoCal === "exercicio") {
      legenda = '<span class="ponto completo"></span>Treino feito <span class="ponto parcial"></span>Em parte <span class="ponto descanso"></span>Sem treino';
      resumo = '<b>' + cumpridos + '</b> de ' + comMeta + ' dia' + (comMeta === 1 ? '' : 's') + ' de treino cumprido' + (cumpridos === 1 ? '' : 's') + ' em ' + nomeMes + '.';
    } else {
      legenda = '<span class="ponto completo"></span>Dia cumprido (refeições e exercícios) <span class="ponto parcial"></span>Em parte';
      resumo = '<b>' + cumpridos + '</b> dia' + (cumpridos === 1 ? '' : 's') + ' cumprido' + (cumpridos === 1 ? '' : 's') + ' em ' + nomeMes + '.';
    }
    h += '</div><p class="cal-legenda">' + legenda + '<br>' + resumo + '</p></section>';
    return h;
  }


  function rotuloHora(r) { return r.hora || (r.id === "acordar" ? "Acordar" : "Manhã"); }

  // Situação de cada refeição de hoje em relação ao horário atual:
  // "feita", "agora" (horário atual), "proxima" (a seguinte, quando a atual já foi feita),
  // "atrasada" (horário já passou e não foi marcada) ou "depois".
  function situacoesHoje() {
    var atual = refeicaoAtual(), feitas = feitasNoDia(hojeChave()), idxAtual = 0, out = {};
    PLANO.refeicoes.forEach(function (r, i) { if (r.id === atual) idxAtual = i; });
    var proximaMarcada = feitas.indexOf(atual) < 0;
    PLANO.refeicoes.forEach(function (r, i) {
      var s;
      if (feitas.indexOf(r.id) >= 0) s = "feita";
      else if (i < idxAtual) s = "atrasada";
      else if (i === idxAtual) s = "agora";
      else if (!proximaMarcada) { s = "proxima"; proximaMarcada = true; }
      else s = "depois";
      out[r.id] = s;
    });
    return out;
  }

  var TEXTO_SITUACAO = { feita: "Feita", agora: "Agora", proxima: "Próxima", atrasada: "Não marcada", depois: "Mais tarde" };

  function telaPlano() {
    var atual = refPorId(refeicaoAtual()), t = PLANO.nutrientes.total, hoje = hojeChave();
    var sit = situacoesHoje(), regsHoje = registros[hoje] || {}, n = feitasNoDia(hoje).length, seq = sequencia();
    var atrasadas = PLANO.refeicoes.filter(function (r) { return sit[r.id] === "atrasada"; });
    var ex = exerciciosDoDia(hoje), feitosEx = treinosFeitos(hoje);
    var h = '<h2 class="titulo-secao">Meu plano do dia</h2>' +
      '<section class="agora-topo" aria-label="Agora">' +
      '<p class="agora-hora"><b>' + horaAgora() + '</b> · hora ' + (atual.id === "acordar" ? 'de acordar' : 'do ' + esc(atual.nome.toLowerCase())) + '</p>' +
      '<p class="agora-progresso">' + n + ' de ' + TOTAL_REF + ' refeições feitas hoje' +
      (seq ? ' · ' + seq + ' dia' + (seq === 1 ? '' : 's') + ' seguido' + (seq === 1 ? '' : 's') : '') + '</p>' +
      '<div class="barra" aria-hidden="true"><span style="width:' + Math.round(n / TOTAL_REF * 100) + '%"></span></div>' +
      (atrasadas.length ? '<p class="agora-aviso">' + (atrasadas.length === 1 ? esc(atrasadas[0].nome) + ' ainda não foi marcada.' : atrasadas.length + ' refeições anteriores ainda não foram marcadas.') + '</p>' : '') +
      (ex.length ? '<a class="agora-ex" href="#frequencia">' + ICON.peso + 'Hoje tem ' + esc(juntarNomes(ex.map(function (e) { return e.nome; }))) +
        ' · ' + feitosEx.length + ' de ' + ex.length + ' feito' + (ex.length === 1 ? '' : 's') + ' →</a>' : '') +
      '</section>' +
      '<p class="descricao">Toque numa refeição para ver o que comer e as opções de troca.</p>' +
      '<ul class="plano-lista">';
    PLANO.refeicoes.forEach(function (r) {
      var s = sit[r.id], reg = regsHoje[r.id];
      var detalhe = s === "feita" ? (reg ? resumoRegistro(reg) : "Marcada") : r.kcal + " kcal";
      h += '<li class="ref-item s-' + s + '">' +
        '<a class="ref-linha" href="#refeicao/' + r.id + '">' +
        '<span class="hora">' + rotuloHora(r) + '</span>' +
        '<span class="flex1"><span class="nome">' + esc(r.nome) +
        ' <span class="tag-sit">' + (s === "feita" ? ICON.check : '') + TEXTO_SITUACAO[s] + '</span></span>' +
        '<span class="detalhes">' + esc(detalhe) + '</span></span>' +
        '<span class="seta-linha" aria-hidden="true">›</span></a>' +
        (s === "atrasada" || s === "agora" ? '<button class="btn mini marcar" data-registrar="' + r.id + '" data-hoje aria-label="Marcar ' + esc(r.nome) + '">' + ICON.camera + 'Marcar</button>' : '') +
        '</li>';
    });
    h += '</ul>' +
      '<div class="resumo" aria-label="Total do dia">' +
      '<div><b>' + t.kcal + '</b><span>kcal</span></div>' +
      '<div><b>' + t.proteinas + '</b><span>proteínas</span></div>' +
      '<div><b>' + t.carboidratos + '</b><span>carboidratos</span></div>' +
      '<div><b>' + t.lipidios + '</b><span>gorduras</span></div></div>' +
      blocoAgenda() +
      '<h3 class="subtitulo">Nutrientes por refeição</h3><div class="tabela-wrap"><table class="nutri">' +
      '<thead><tr><th>Refeição</th><th>Prot.</th><th>Gord.</th><th>Carb.</th><th>Calorias</th></tr></thead><tbody>' +
      PLANO.nutrientes.linhas.map(function (l) { return '<tr>' + l.map(function (c) { return '<td>' + c + '</td>'; }).join("") + '</tr>'; }).join("") +
      '<tr><td><b>Total</b></td><td><b>' + t.proteinas + '</b></td><td><b>' + t.lipidios + '</b></td><td><b>' + t.carboidratos + '</b></td><td><b>' + t.kcal + ' kcal</b></td></tr>' +
      '</tbody></table></div>' +
      '<p class="rodape">Plano prescrito em ' + PLANO.prescritoEm + '. Siga sempre a orientação da sua nutricionista.</p>';
    return h;
  }

  function telaRefeicao(id) {
    var r = refPorId(id);
    if (!r) return '<div class="vazio">Refeição não encontrada. <a href="#plano">Voltar</a></div>';
    var s = situacoesHoje()[r.id], reg = (registros[hojeChave()] || {})[r.id];
    var i = PLANO.refeicoes.indexOf(r), ant = PLANO.refeicoes[i - 1], prox = PLANO.refeicoes[i + 1];
    var h = '<a class="btn voltar" href="#plano">' + ICON.back + 'Plano do dia</a>' +
      '<article class="detalhe refeicao-detalhe s-' + s + '">' +
      '<div class="ref-cabeca"><span class="hora">' + rotuloHora(r) + '</span><h2>' + esc(r.nome) + '</h2></div>' +
      '<div class="meta"><span class="chip">' + r.kcal + ' kcal</span><span class="tag-sit">' + (s === "feita" ? ICON.check : '') + TEXTO_SITUACAO[s] + '</span></div>' +
      (s === "feita" && reg ? '<p class="descricao">' + esc(resumoRegistro(reg)) + '</p>' : '') +
      '<div class="acoes"><button class="btn' + (s === "feita" ? '' : ' primario') + '" data-registrar="' + r.id + '" data-hoje>' + ICON.camera +
      (s === "feita" ? 'Ver o registro' : 'Marcar o que comi') + '</button></div>' +
      '<h3>O que comer</h3>';
    r.itens.forEach(function (it) {
      h += '<div class="item"><div class="principal">' + esc(it.principal) + '</div>';
      if (it.opcoes.length) h += '<ul>' + it.opcoes.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join("") + '</ul>';
      h += '</div>';
    });
    if (r.observacoes.length || (r.receitas || []).length) {
      h += '<div class="obs"><strong>Observações</strong>' + (r.observacoes.length ? '<ul>' +
        r.observacoes.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join("") + '</ul>' : '');
      (r.receitas || []).forEach(function (rid) {
        var rec = porId(rid);
        if (rec) h += '<a class="link-receita" href="#receita/' + rec.id + '">Ver receita: ' + esc(rec.nome) + ' →</a>';
      });
      h += '</div>';
    }
    h += '</article><nav class="ref-nav" aria-label="Outras refeições">' +
      (ant ? '<a class="btn" href="#refeicao/' + ant.id + '">' + ICON.back + esc(ant.nome) + '</a>' : '<span></span>') +
      (prox ? '<a class="btn seta-dir" href="#refeicao/' + prox.id + '">' + esc(prox.nome) + ICON.back + '</a>' : '') +
      '</nav>';
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

  // Lembra de salvar cópia: nunca salvou e já tem 7+ dias marcados, ou a última cópia tem 30+ dias.
  // Lembra de salvar cópia: mês passado com fotos sem cópia completa; ou, no mês atual,
  // nunca salvou e já tem 7+ dias marcados, ou a última cópia tem 30+ dias.
  function lembreteBackup() {
    var atual = chaveMes(hojeChave()), motivo = "", mesAlvo = atual;
    var pendentes = mesesComDados().filter(function (m) {
      if (m >= atual || !mesTemFotos(m)) return false;
      var p = m.split("-"), fimDoMes = chaveData(new Date(+p[0], +p[1], 0));
      return !backupsMes[m] || backupsMes[m] <= fimDoMes; // cópia salva antes do mês acabar não tem todas as fotos
    });
    if (pendentes.length) {
      mesAlvo = pendentes[pendentes.length - 1];
      motivo = "As fotos de " + nomeMes(mesAlvo).toLowerCase() + " ainda não têm cópia completa.";
    } else {
      var dias = Object.keys(diario).length;
      if (!dias) return "";
      if (!ultimoBackup) {
        if (dias >= 7) motivo = "Você já marcou " + dias + " dias e ainda não salvou nenhuma cópia.";
      } else {
        var passaram = Math.floor((dataDaChave(hojeChave()) - dataDaChave(ultimoBackup)) / 864e5);
        if (passaram >= 30) motivo = "Sua última cópia foi há " + passaram + " dias.";
      }
    }
    if (!motivo) return "";
    return '<div class="lembrete" role="note"><p><b>Salve uma cópia de segurança.</b> ' + motivo +
      ' Os dias marcados e as fotos ficam só neste celular: se ele for trocado ou formatado, eles se perdem.</p>' +
      '<button class="btn primario" id="baixar-backup" data-mes="' + mesAlvo + '">' + ICON.share + 'Salvar cópia de ' + nomeMes(mesAlvo).toLowerCase() + '</button></div>';
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
    var atual = chaveMes(hojeChave());
    return '<section class="backup"><h3 class="subtitulo">Cópia de segurança</h3>' +
      '<p class="descricao">Os dias marcados, as fotos, as favoritas e as listas ficam só neste aparelho. Cada cópia leva <b>todos os dados</b> e as <b>fotos do mês escolhido</b>. Salve uma cópia por mês.</p>' +
      '<label class="campo-mes" for="mes-backup">Mês das fotos</label>' +
      '<select id="mes-backup" class="busca">' + mesesComDados().map(function (m) {
        var salvo = backupsMes[m] ? " · cópia salva em " + backupsMes[m].split("-").reverse().slice(0, 2).join("/") : "";
        return '<option value="' + m + '"' + (m === atual ? ' selected' : '') + '>' + nomeMes(m) + (m === atual ? " (atual)" : "") + salvo + '</option>';
      }).join("") + '</select>' +
      '<div class="linha-acoes"><button class="btn" id="baixar-backup">' + ICON.share + 'Salvar cópia</button>' +
      '<button class="btn" id="restaurar-backup">Restaurar cópia</button>' +
      '<input class="sr" type="file" id="arquivo-backup" accept="application/json,.json" tabindex="-1" aria-hidden="true"></div></section>';
  }


  function blobParaTexto(blob) {
    return new Promise(function (ok, erro) {
      var fr = new FileReader();
      fr.onload = function () { ok(fr.result); };
      fr.onerror = function () { erro(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  // Junta as fotos usadas nos registros, em texto, para irem dentro da cópia.
  function chaveMes(k) { return k.slice(0, 7); }
  function nomeMes(m) { var p = m.split("-"); var n = MESES[+p[1] - 1]; return n.charAt(0).toUpperCase() + n.slice(1) + " de " + p[0]; }
  function mesesComDados() {
    var ms = {};
    ms[chaveMes(hojeChave())] = true;
    [diario, registros, treinos].forEach(function (o) { Object.keys(o).forEach(function (k) { ms[chaveMes(k)] = true; }); });
    return Object.keys(ms).sort().reverse();
  }
  function mesTemFotos(m) {
    return Object.keys(registros).some(function (k) {
      return chaveMes(k) === m && Object.keys(registros[k]).some(function (ref) { return !!registros[k][ref].foto; });
    });
  }

  // Junta as fotos do mês escolhido, em texto, para irem dentro da cópia.
  function fotosParaCopia(mes) {
    var ids = [];
    Object.keys(registros).forEach(function (k) {
      if (chaveMes(k) !== mes) return;
      Object.keys(registros[k]).forEach(function (ref) { var f = registros[k][ref].foto; if (f && ids.indexOf(f) < 0) ids.push(f); });
    });
    var fotos = {}, faltando = 0;
    // cada foto separada: se uma falhar, as outras continuam
    return ids.reduce(function (p, id) {
      return p.then(function () {
        return obterFoto(id).then(function (blob) {
          if (!blob) { faltando++; return null; }
          return blobParaTexto(blob).then(function (t) { fotos[id] = t; });
        }).catch(function () { faltando++; });
      });
    }, Promise.resolve()).then(function () { return { fotos: fotos, faltando: faltando, total: ids.length }; });
  }



  // A cópia é montada primeiro (lê as fotos, leva um instante). No celular, o menu de
  // compartilhar só abre logo após um toque, então lá são dois toques: preparar e salvar.
  var copiaPronta = null;
  function podeCompartilhar(arquivo) {
    var celular = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    return celular && arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] });
  }
  function concluirBackup(msg, mes, faltando) {
    if (faltando) {
      // não marca o mês como salvo: a cópia não tem todas as fotos
      msg = "Atenção: " + faltando + " foto" + (faltando === 1 ? "" : "s") + " de " + nomeMes(mes).toLowerCase() +
        " não está" + (faltando === 1 ? "" : "ão") + " neste celular e ficou" + (faltando === 1 ? "" : "aram") + " fora. Guarde também a cópia antiga.";
      mes = null;
    }
    if (mes) { backupsMes[mes] = hojeChave(); gravar("mp-backups-mes", backupsMes); }
    copiaPronta = null;
    ultimoBackup = hojeChave(); gravar("mp-ultimo-backup", ultimoBackup);
    toast(msg);
    if (location.hash === "#frequencia") rerenderMantendoScroll();
  }
  function baixarArquivo(c) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([c.texto], { type: "application/json" }));
    a.download = c.nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    concluirBackup("Cópia salva em Downloads", c.mes, c.faltando);
  }
  function compartilharCopia(c) {
    navigator.share({ files: [c.arquivo], title: "Cópia do Saúde Familiar" })
      .then(function () { concluirBackup("Cópia salva", c.mes, c.faltando); })
      .catch(function (err) {
        if (err && err.name === "AbortError") { toast("Cópia não salva"); return; }
        baixarArquivo(c);
      });
  }

  function baixarBackup(mes) {
    mes = mes || chaveMes(hojeChave());
    if (copiaPronta && copiaPronta.mes === mes && Date.now() - copiaPronta.feitaEm < 120000) { compartilharCopia(copiaPronta); return; }
    toast("Preparando a cópia de " + nomeMes(mes).toLowerCase() + "...");
    fotosParaCopia(mes).then(function (res) {
      var fotos = res.fotos;
      // todos os dados (sem fotos) vão em toda cópia; as fotos, só as do mês escolhido
      var dados = { app: "meu-prato", versao: 4, salvoEm: new Date().toISOString(), mesFotos: mes, favs: favs, sel: sel, checks: checks, checksPlano: checksPlano, quero: despensa, diario: diario, registros: registros, treinos: treinos, fotos: fotos };
      var c = { mes: mes, faltando: res.faltando, texto: JSON.stringify(dados), nome: "saude-familiar-" + mes + "-salvo-em-" + hojeChave() + ".json", feitaEm: Date.now(), arquivo: null };
      try { c.arquivo = new File([c.texto], c.nome, { type: "application/json" }); } catch (e) { c.arquivo = null; }
      if (podeCompartilhar(c.arquivo)) {
        copiaPronta = c;
        main.querySelectorAll("#baixar-backup").forEach(function (b) { b.lastChild.textContent = "Cópia pronta: toque para salvar"; });
        toast("Cópia pronta. Toque de novo em Salvar.");
      } else {
        baixarArquivo(c);
      }
    });
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
        var hojeK = hojeChave();
        function unir(a, b) { var u = (a || []).slice(); (b || []).forEach(function (x) { if (u.indexOf(x) < 0) u.push(x); }); return u; }
        // soma com o que já está no aparelho: uma cópia antiga nunca desmarca o que foi feito depois
        Object.keys(novoDiario).forEach(function (k) { if (k <= hojeK) diario[k] = unir(diario[k], novoDiario[k]); });
        // registros e fotos (cópias da versão 3 em diante)
        var novosReg = {}, fotosCopia = d.fotos && typeof d.fotos === "object" ? d.fotos : {};
        if (d.registros && typeof d.registros === "object") {
          Object.keys(d.registros).forEach(function (k) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof d.registros[k] !== "object") return;
            Object.keys(d.registros[k]).forEach(function (ref) {
              var x = d.registros[k][ref];
              if ((idsRef.indexOf(ref) < 0 && !exPorId(ref)) || !x || typeof x !== "object") return;
              // mantém a referência da foto mesmo se a imagem não veio nesta cópia (vem na cópia do mês dela)
              var foto = typeof x.foto === "string" && /^f-[\w-]+$/.test(x.foto) ? x.foto : null;
              novosReg[k] = novosReg[k] || {};
              novosReg[k][ref] = {
                escolhas: Array.isArray(x.escolhas) ? x.escolhas.filter(function (t) { return typeof t === "string"; }) : [],
                receita: ids.indexOf(x.receita) >= 0 ? x.receita : null,
                foto: foto,
                hora: typeof x.hora === "string" && /^\d{2}:\d{2}$/.test(x.hora) ? x.hora : ""
              };
            });
          });
        }
        Object.keys(novosReg).forEach(function (k) {
          if (k > hojeK) return;
          registros[k] = registros[k] || {};
          Object.keys(novosReg[k]).forEach(function (ref) {
            var local = registros[k][ref];
            if (local && local.foto) return; // registro com foto no aparelho não é trocado pela cópia
            registros[k][ref] = novosReg[k][ref];
          });
        });
        var idsEx = (PLANO.exercicios || []).map(function (e) { return e.id; }), novosTreinos = {};
        if (d.treinos && typeof d.treinos === "object") {
          Object.keys(d.treinos).forEach(function (k) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(d.treinos[k])) return;
            var l = d.treinos[k].filter(function (id, i, arr) { return idsEx.indexOf(id) >= 0 && arr.indexOf(id) === i; });
            if (l.length) novosTreinos[k] = l;
          });
        }
        Object.keys(novosTreinos).forEach(function (k) { if (k <= hojeK) treinos[k] = unir(treinos[k], novosTreinos[k]); });
        var gravarFotos = Object.keys(fotosCopia).filter(function (id) { return fotoEmUso(id) && /^data:image\//.test(fotosCopia[id]); })
          .reduce(function (p, id) {
            return p.then(function () { return fetch(fotosCopia[id]).then(function (r) { return r.blob(); }).then(function (b) { return salvarFoto(id, b); }); });
          }, Promise.resolve());
        gravarFotos.then(function () { salvarTudo(); render(); toast("Cópia restaurada"); },
          function () { salvarTudo(); render(); toast("Cópia restaurada, mas algumas fotos não couberam no celular"); });
        return;
      } catch (e) { toast("Esse arquivo não é uma cópia do Saúde Familiar"); }
    };
    leitor.readAsText(arquivo);
  }

  // Por enquanto o app é só site: não convida a instalar e segura a faixa de instalação do navegador.
  // O service worker continua (abre sem internet). Quem quiser ainda instala pelo menu do navegador.
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); });

  // ---------- roteamento ----------
  function render() {
    if (modo === "entrar") return; // só a tela de conta: nada do app por baixo
    var hash = location.hash.replace(/^#/, "") || "plano";
    var partes = hash.split("/"), aba = partes[0];
    var html;
    if (aba === "receita") { html = telaReceita(partes[1]); aba = "receitas"; }
    else if (aba === "refeicao") { html = telaRefeicao(partes[1]); aba = "plano"; }
    else if (aba === "receitas") html = telaReceitas();
    else if (aba === "favoritas") { filtro = "favoritas"; html = telaReceitas(); aba = "receitas"; }
    else if (aba === "frequencia") html = telaFrequencia();
    else if (aba === "compras") html = telaCompras();
    else if (aba === "quero" || aba === "despensa") { html = telaDespensa(); aba = "quero"; }
    else { html = telaPlano(); aba = "plano"; }
    main.innerHTML = html;
    preencherFotos(main);
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
      else ["fav", "sel", "filtro", "desp", "registrar", "treino", "dia", "modocal"].some(function (k) {
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
    } else if (b.dataset.registrar) {
      if (b.dataset.hoje !== undefined) diaSel = hojeChave(); // no plano, registra sempre o dia de hoje
      abrirRegistro(b.dataset.registrar);
    } else if (b.dataset.dia) {
      diaSel = b.dataset.dia; rerenderMantendoScroll();
      var bloco = document.querySelector(".dia");
      if (bloco && bloco.getBoundingClientRect().top < 0) bloco.scrollIntoView({ block: "start" });
    } else if (b.dataset.modocal) {
      modoCal = b.dataset.modocal; gravar("mp-modo-cal", modoCal); rerenderMantendoScroll();
    } else if (b.id === "compartilhar-dia") {
      compartilharResultadoDia(diaSel);
    } else if (b.id === "voltar-hoje") {
      diaSel = hojeChave(); mesVisto = new Date(); mesVisto.setDate(1); rerenderMantendoScroll();
    } else if (b.id === "mes-ant" || b.id === "mes-prox") {
      mesVisto = new Date(mesVisto.getFullYear(), mesVisto.getMonth() + (b.id === "mes-ant" ? -1 : 1), 1); rerenderMantendoScroll();
    } else if (b.dataset.desp) {
      alternar(despensa, b.dataset.desp); salvarTudo();
      atualizarQueroComer(b.dataset.desp);
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
      var campoMes = document.getElementById("mes-backup");
      baixarBackup(b.dataset.mes || (campoMes && campoMes.value));
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

  window.addEventListener("hashchange", function () {
    // link de confirmar e-mail ou de nova senha aberto com o app já aberto nesta aba
    if (armazem && SF.conta.lerHash(location.hash).acao) { contaUI.iniciar(); return; }
    render(); window.scrollTo(0, 0);
  });

  // Se o app ficou aberto de um dia para o outro, "Hoje" passa para o dia novo.
  var ultimoHoje = hojeChave();
  function checarVirada() {
    var agora = hojeChave();
    if (agora === ultimoHoje) return false;
    if (diaSel === ultimoHoje) diaSel = agora;
    ultimoHoje = agora;
    mesVisto = new Date(); mesVisto.setDate(1);
    if (dlg && dlg.open) fecharRegistro();
    rerenderMantendoScroll();
    return true;
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    if (!(dlg && dlg.open)) { recarregarEstado(); }
    if (!checarVirada() && !(dlg && dlg.open)) rerenderMantendoScroll();
    rodarSync();
  });
  // outra janela do app gravou algo: relê para não apagar o que ela fez
  window.addEventListener("storage", function (e) {
    if (armazem && e.key === "sf:sessao") { sessaoMudouEmOutraAba(); return; }
    // modo conta: só as chaves da conta (sf:<id>:); modo antigo: só mp-*; tela de entrar: nada
    var prefixo = modo === "conta" ? "sf:" + userId + ":" : modo === "antigo" ? "mp-" : null;
    if (!prefixo || (e.key && e.key.indexOf(prefixo) !== 0)) return;
    // fila e cursor da outra aba só mudam o indicador
    if (modo === "conta" && e.key && e.key.indexOf(prefixo + "mp-") !== 0) { if (sincronia) mostrarStatus(sincronia.status(), true); return; }
    recarregarEstado();
    if (!(dlg && dlg.open)) rerenderMantendoScroll();
  });
  setInterval(function () { if (!document.hidden) checarVirada(); }, 30000);


  // No plano, a refeição "Agora" e o relógio acompanham a hora enquanto o app fica aberto.
  setInterval(function () {
    if (document.hidden || (dlg && dlg.open)) return;
    var aba = (location.hash.replace(/^#/, "") || "plano").split("/")[0];
    // qualquer rota que não seja de outra aba cai no plano (ver render)
    if (!/^(receita|receitas|favoritas|frequencia|compras|quero|despensa)$/.test(aba)) rerenderMantendoScroll();
  }, 60000);

  // ---------- conta: telas, sincronização e indicador ----------
  // Tudo aqui só roda com armazem (apiUrl preenchido).
  var ultimoEstado = null; // cópia do estado como foi gravado ou lido por último (o "antes" da fila)
  var timerSync = null, timerRetry = null;
  var statusEl = null, caixaContaEl = null, faixaEl = null;
  var MSG_SESSAO = "Sua sessão terminou. Entre de novo: o que você marcou continua guardado neste aparelho.";

  function estadoApp() {
    return { favs: favs, sel: sel, checks: checks, checksPlano: checksPlano, despensa: despensa, diario: diario, treinos: treinos, registros: registros };
  }
  function copiaEstado() { return SF.dados.aplicar(estadoApp(), []); }
  function buscar(u, i) { return window.fetch(u, i); }

  function iniciarConta() {
    apiSF = SF.api.criar({ config: CONFIG, fetch: buscar, sessao: function () { var s = armazem.sessao(); return s && s.token; } });
    contaUI = SF.conta.montar({
      raiz: document.getElementById("conta"), api: apiSF, local: armazem, config: CONFIG,
      aoEntrar: aoEntrar, aoSair: aoSair, aoApagar: apagarFotosDaConta,
      pendentes: function (id) {
        if (sincronia && id === userId) return sincronia.pendentes();
        var f = armazem.ler(id, "fila", []);
        return Array.isArray(f) ? f.length : 0;
      },
      podeVoltar: function () { return modo !== "entrar"; },
      aoVoltar: function () {}
    });
    modo = "entrar"; // até decidir, a tela que iniciar() desenhar não oferece "Voltar ao app"
    var inicio = contaUI.iniciar();
    var s = armazem.sessao();
    if (s && s.usuario && s.usuario.id) { modo = "conta"; userId = s.usuario.id; return; }
    if (s) armazem.apagarSessao(); // sessão sem usuário: não serve
    modo = armazem.temDadosAntigos() ? "antigo" : "entrar";
    if (modo === "entrar" && (inicio === "conta" || inicio === "antigo")) contaUI.mostrar("entrar");
  }

  function ligarConta() {
    var topo = document.querySelector(".topo");
    caixaContaEl = document.createElement("div");
    caixaContaEl.className = "topo-conta";
    statusEl = document.createElement("p");
    statusEl.className = "sf-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    var botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn btn-conta";
    botao.textContent = "Conta";
    botao.addEventListener("click", function () { contaUI.mostrar("conta"); });
    caixaContaEl.appendChild(statusEl);
    caixaContaEl.appendChild(botao);
    topo.appendChild(caixaContaEl);

    faixaEl = document.createElement("div");
    faixaEl.className = "faixa-conta";
    var texto = document.createElement("p");
    texto.textContent = "Crie sua conta para guardar seus dados";
    var criar = document.createElement("button");
    criar.type = "button";
    criar.className = "btn primario";
    criar.textContent = "Criar conta";
    criar.addEventListener("click", function () { contaUI.mostrar("cadastro"); });
    faixaEl.appendChild(texto);
    faixaEl.appendChild(criar);
    main.parentNode.insertBefore(faixaEl, main);

    window.addEventListener("online", rodarSync);
    setInterval(function () { if (sincronia && sincronia.pendentes() > 0) rodarSync(); }, 60000);
    if (modo === "conta") comecarSincronia();
    atualizarCabecalhoConta();
  }

  // Sob a tela de entrar o <main> não guarda dados da conta (Tab, leitor de tela e Ctrl+F não os alcançam).
  function esconderDadosDaConta() { main.textContent = ""; main.inert = true; }
  function liberarMain() { main.inert = false; }

  function atualizarCabecalhoConta() {
    if (!faixaEl) return;
    faixaEl.hidden = modo !== "antigo";
    caixaContaEl.hidden = modo !== "conta";
    if (modo === "conta" && sincronia) mostrarStatus(sincronia.status(), true);
  }

  // semAviso: só atualiza o texto (o aviso de conflito aparece uma vez, quando o status muda para ele)
  function mostrarStatus(s, semAviso) {
    if (!statusEl) return;
    statusEl.textContent = SF.conta.textoStatus(s);
    statusEl.setAttribute("data-status", s);
    if (s === "conflito" && !semAviso) toast(SF.conta.MSG_CONFLITO);
  }

  function comecarSincronia() {
    if (sincronia) { rodarSync(); return; }
    var ligada = { sim: true };
    // Depois de sair (sessão apagada) ou trocar de conta, a sincronia antiga não grava mais nada.
    var localSinc = {
      ler: function (u, n, padrao) { return armazem.ler(u, n, padrao); },
      gravar: function (u, n, v) { return ligada.sim && !!armazem.sessao() && armazem.gravar(u, n, v); }
    };
    // Esta sincronia tem a sua api: só tem token (e só envia) enquanto estiver ligada E a sessão atual for da
    // mesma conta. Se A sair com um envio lento em voo e B entrar, a fila de A não vai com o token de B.
    var idSinc = userId;
    function sessaoDaSincronia() {
      if (!ligada.sim) return null;
      var s = armazem.sessao();
      return s && s.usuario && s.usuario.id === idSinc && s.token ? s.token : null;
    }
    function buscarDaSincronia(u, i) {
      if (!sessaoDaSincronia()) return Promise.reject(new TypeError("sincronia parada"));
      return buscar(u, i);
    }
    var apiSinc = SF.api.criar({ config: CONFIG, fetch: buscarDaSincronia, sessao: sessaoDaSincronia });
    fotosSF = SF.fotos.criar({ api: apiSinc, fetch: buscarDaSincronia, banco: { ler: lerFoto, gravar: salvarFoto } });
    sincroniaLigada = ligada;
    sincronia = SF.sincronia.criar({
      api: apiSinc, local: localSinc, fotos: fotosSF, userId: userId, estado: estadoApp,
      aoMudarEstado: function (novo) { if (ligada.sim) aplicarEstadoRemoto(novo); },
      aoMudarStatus: function (s) { if (ligada.sim) mostrarStatus(s); },
      aoSessaoVencida: function () { if (ligada.sim) sessaoVencida(); }
    });
    ultimoEstado = copiaEstado();
    rodarSync();
  }

  function pararSincronia() {
    if (sincroniaLigada) sincroniaLigada.sim = false;
    sincronia = null; sincroniaLigada = null; fotosSF = null; ultimoEstado = null;
    clearTimeout(timerSync); clearTimeout(timerRetry);
    timerSync = null; timerRetry = null;
  }

  // Chamado por salvarTudo: põe na fila o que mudou e agenda o envio (2 s, uma vez para várias gravações).
  function registrarMudancas() {
    if (!sincronia || modo !== "conta") return;
    var depois = copiaEstado();
    sincronia.registrar(ultimoEstado || depois, depois);
    ultimoEstado = depois;
    if (!timerSync) timerSync = setTimeout(function () { timerSync = null; rodarSync(); }, 2000);
  }

  function rodarSync() {
    if (modo !== "conta" || !sincronia) return;
    var s = sincronia;
    s.sincronizar().then(function () {
      if (s !== sincronia) return;
      var st = s.status();
      if (st === "offline" || st === "erro") {
        clearTimeout(timerRetry);
        timerRetry = setTimeout(function () { timerRetry = null; rodarSync(); }, Math.max(s.esperaMs(), 2000));
      }
    }).catch(function () {});
  }

  // O que veio do servidor: grava na hora (síncrono) e redesenha mantendo a rolagem.
  function aplicarEstadoRemoto(novo) {
    favs = novo.favs; sel = novo.sel; checks = novo.checks; checksPlano = novo.checksPlano;
    despensa = novo.despensa; diario = novo.diario; treinos = novo.treinos; registros = novo.registros;
    if (!gravarDados()) avisarFalhaGravacao();
    ultimoEstado = copiaEstado();
    atualizarContador();
    if (modo === "conta" && !(dlg && dlg.open)) rerenderMantendoScroll();
  }

  function aoEntrar(s) {
    var id = s && s.usuario && s.usuario.id;
    if (!id) return;
    if (id !== userId) {
      // outra conta (ou vindo do modo antigo): começa do que está guardado para ela; os mp-* ficam intactos
      pararSincronia();
      userId = id;
      trocarBanco();
      recarregarEstado();
    }
    modo = "conta";
    liberarMain();
    comecarSincronia();
    atualizarCabecalhoConta();
    render();
    window.scrollTo(0, 0);
  }

  // Sessão vencida (401): mostra Entrar mantendo dados e fila; com o mesmo usuário continua de onde parou.
  function sessaoVencida() {
    armazem.apagarSessao();
    modo = "entrar";
    clearTimeout(timerSync); clearTimeout(timerRetry);
    timerSync = null; timerRetry = null;
    if (dlg && dlg.open) fecharRegistro();
    esconderDadosDaConta();
    atualizarCabecalhoConta();
    contaUI.mostrar("entrar", MSG_SESSAO);
  }

  // Depois de sair ou apagar a conta (sf-conta já limpou o que tinha de limpar).
  function aoSair() {
    pararSincronia();
    userId = null;
    trocarBanco();
    recarregarEstado();
    if (dlg && dlg.open) fecharRegistro();
    if (armazem.temDadosAntigos()) { modo = "antigo"; liberarMain(); render(); }
    else { modo = "entrar"; esconderDadosDaConta(); contaUI.mostrar("entrar"); }
    atualizarCabecalhoConta();
  }

  // Apaga o IndexedDB de fotos da conta: fecha a conexão aberta antes do deleteDatabase.
  function apagarFotosDaConta(id) {
    var nome = SF.fotos.nomeBanco(id);
    if (id === userId) { pararSincronia(); bancoTravado = true; }
    return SF.fotos.apagarBancoFotos({
      indexedDB: window.indexedDB, nome: nome,
      fecharConexao: function () { if (nomeBancoAberto === nome) fecharBanco(); }
    });
  }

  // Outra aba entrou, saiu ou perdeu a sessão.
  function sessaoMudouEmOutraAba() {
    var s = armazem.sessao();
    var id = s && s.usuario && s.usuario.id;
    if (id) {
      if (id !== userId || modo !== "conta") { contaUI.esconder(); aoEntrar(s); }
      return;
    }
    if (modo === "conta") aoSair();
  }

  if (armazem) ligarConta();
  render();
})();
