// Formulário do plano alimentar: gera o HTML e converte os campos em plano. Funções puras, sem DOM.
(function (raiz) {
  var LIMITE_BYTES = 61440;
  var NUTRIENTES = ["proteinas", "lipidios", "carboidratos", "kcal", "fibras"];
  var MSG_NOME = "Dê um nome à refeição";
  var MSG_HORA = "Horário no formato HH:MM";
  var MSG_NUM = "Use um número igual ou maior que zero";
  var MSG_ITEM = "Cada item precisa de um nome";
  var MSG_GRANDE = "O plano ficou grande demais para guardar";

  function planoModulo() {
    if (raiz.SF && raiz.SF.plano) return raiz.SF.plano;
    return require("./sf-plano.js");
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function linhas(texto) {
    return String(texto || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
  }
  function bytes(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, "utf8");
  }

  // Modelo intermediário: tudo em texto, como está nos campos.
  function itemVazio() { return { principal: "", opcoes: "" }; }
  function refeicaoVazia() { return { id: "", nome: "", hora: "", kcal: "", itens: [itemVazio()], obs: "", rec: [] }; }
  function modeloVazio() {
    var nut = {};
    NUTRIENTES.forEach(function (n) { nut[n] = ""; });
    return { refeicoes: [refeicaoVazia()], prescrito: "", compras: "", nut: nut };
  }

  function dataParaInput(br) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || "");
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
  }
  function dataParaBr(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    return m ? m[3] + "/" + m[2] + "/" + m[1] : null;
  }

  function modeloDoPlano(plano) {
    if (!plano) return modeloVazio();
    var m = modeloVazio();
    m.refeicoes = (plano.refeicoes || []).map(function (r) {
      var itens = (r.itens || []).map(function (it) { return { principal: it.principal || "", opcoes: (it.opcoes || []).join("\n") }; });
      return {
        id: r.id || "", nome: r.nome || "", hora: r.hora || "", kcal: r.kcal == null ? "" : String(r.kcal),
        itens: itens, obs: (r.observacoes || []).join("\n"), rec: (r.receitas || []).slice()
      };
    });
    m.prescrito = dataParaInput(plano.prescritoEm);
    m.compras = (plano.compras || []).join("\n");
    if (plano.nutrientes && plano.nutrientes.total) {
      NUTRIENTES.forEach(function (n) {
        var v = plano.nutrientes.total[n];
        m.nut[n] = v == null ? "" : String(v);
      });
    }
    return m;
  }

  function indicesDe(pares, regex) {
    var vistos = {};
    pares.forEach(function (p) {
      var r = regex.exec(p[0]);
      if (r) vistos[r[1]] = true;
    });
    return Object.keys(vistos).map(Number).sort(function (a, b) { return a - b; });
  }

  function modeloDosPares(pares) {
    var mapa = {};
    var rec = {};
    pares.forEach(function (p) {
      var k = String(p[0]);
      var v = p[1] == null ? "" : String(p[1]);
      if (/^r\d+-rec$/.test(k)) { (rec[k] = rec[k] || []).push(v); } else { mapa[k] = v; }
    });
    function g(k) { return mapa[k] == null ? "" : mapa[k]; }
    var m = modeloVazio();
    m.refeicoes = indicesDe(pares, /^r(\d+)-/).map(function (i) {
      var pref = "r" + i + "-";
      var itens = indicesDe(pares, new RegExp("^r" + i + "-it(\\d+)-")).map(function (j) {
        return { principal: g(pref + "it" + j + "-principal"), opcoes: g(pref + "it" + j + "-opcoes") };
      });
      return { id: g(pref + "id"), nome: g(pref + "nome"), hora: g(pref + "hora"), kcal: g(pref + "kcal"), itens: itens, obs: g(pref + "obs"), rec: rec[pref + "rec"] || [] };
    });
    m.prescrito = g("prescrito");
    m.compras = g("compras");
    NUTRIENTES.forEach(function (n) { m.nut[n] = g("nut-" + n); });
    return m;
  }

  function paresDoModelo(m) {
    var pares = [];
    m.refeicoes.forEach(function (r, i) {
      var pref = "r" + i + "-";
      pares.push([pref + "id", r.id], [pref + "nome", r.nome], [pref + "hora", r.hora], [pref + "kcal", r.kcal]);
      r.itens.forEach(function (it, j) {
        pares.push([pref + "it" + j + "-principal", it.principal], [pref + "it" + j + "-opcoes", it.opcoes]);
      });
      pares.push([pref + "obs", r.obs]);
      r.rec.forEach(function (id) { pares.push([pref + "rec", id]); });
    });
    pares.push(["prescrito", m.prescrito], ["compras", m.compras]);
    NUTRIENTES.forEach(function (n) { pares.push(["nut-" + n, m.nut[n]]); });
    return pares;
  }

  function trocar(lista, a, b) {
    if (a < 0 || b < 0 || a >= lista.length || b >= lista.length) return;
    var t = lista[a]; lista[a] = lista[b]; lista[b] = t;
  }

  function aplicarAcao(pares, acao, i, j) {
    var m = modeloDosPares(pares);
    var r = m.refeicoes[i];
    var temJ = j !== undefined && j !== null && !isNaN(j);
    if (acao === "add-refeicao") m.refeicoes.push(refeicaoVazia());
    else if (acao === "del-refeicao") { if (r) m.refeicoes.splice(i, 1); }
    else if (acao === "add-item") { if (r) r.itens.push(itemVazio()); }
    else if (acao === "del-item") { if (r && temJ) r.itens.splice(j, 1); }
    else if (acao === "subir" || acao === "descer") {
      var d = acao === "subir" ? -1 : 1;
      if (r && temJ) trocar(r.itens, j, j + d);
      else if (r) trocar(m.refeicoes, i, i + d);
    }
    return paresDoModelo(m);
  }

  function numeroValido(texto) {
    var t = String(texto).trim().replace(",", ".");
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }

  function planoDosCampos(pares, anterior, agoraMs) {
    var novoId = planoModulo().novoId;
    var m = modeloDosPares(pares);
    var erros = [];
    var refeicoes = m.refeicoes.map(function (r, i) {
      var pref = "r" + i + "-";
      var nome = r.nome.trim();
      if (nome === "") erros.push({ campo: pref + "nome", msg: MSG_NOME });
      var hora = r.hora.trim();
      if (hora !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) erros.push({ campo: pref + "hora", msg: MSG_HORA });
      var kcal = null;
      if (r.kcal.trim() !== "") {
        kcal = numeroValido(r.kcal);
        if (kcal === null) erros.push({ campo: pref + "kcal", msg: MSG_NUM });
      }
      var itens = [];
      r.itens.forEach(function (it, j) {
        var principal = it.principal.trim();
        var opcoes = linhas(it.opcoes);
        if (principal === "" && opcoes.length === 0) return;
        if (principal === "") { erros.push({ campo: pref + "it" + j + "-principal", msg: MSG_ITEM }); return; }
        itens.push({ principal: principal, opcoes: opcoes });
      });
      return {
        id: r.id.trim() !== "" ? r.id.trim() : novoId("r", agoraMs + i),
        nome: nome, hora: hora === "" ? null : hora, kcal: kcal, itens: itens,
        observacoes: linhas(r.obs), receitas: r.rec.slice()
      };
    });

    var nutrientes = null;
    var algum = NUTRIENTES.some(function (n) { return m.nut[n].trim() !== ""; });
    if (algum) {
      var total = {};
      NUTRIENTES.forEach(function (n) {
        var t = m.nut[n].trim();
        if (n !== "kcal") { total[n] = t; return; }
        if (t === "") { total[n] = null; return; }
        var num = numeroValido(t);
        if (num === null) erros.push({ campo: "nut-kcal", msg: MSG_NUM });
        total[n] = num;
      });
      var antigas = anterior && anterior.nutrientes && anterior.nutrientes.linhas;
      nutrientes = { linhas: antigas ? antigas.slice() : [], total: total };
    }

    var plano = { refeicoes: refeicoes, nutrientes: nutrientes, compras: linhas(m.compras), prescritoEm: dataParaBr(m.prescrito) };
    if (bytes(JSON.stringify(plano)) > LIMITE_BYTES) erros.push({ campo: "form-plano", msg: MSG_GRANDE });
    return { plano: plano, erros: erros };
  }

  function htmlPlano(plano, receitas, erros) {
    var m = modeloDoPlano(plano);
    var msgs = {};
    (erros || []).forEach(function (e) { if (!msgs[e.campo]) msgs[e.campo] = e.msg; });

    function erroDe(campo) { return msgs[campo] ? '<p class="erro" role="alert">' + esc(msgs[campo]) + "</p>" : ""; }
    function inv(campo) { return msgs[campo] ? ' aria-invalid="true"' : ""; }
    function entrada(campo, rotulo, tipo, valor, extra) {
      return '<label class="campo">' + esc(rotulo) + '<input name="' + campo + '" type="' + tipo + '" value="' + esc(valor) + '"' + (extra || "") + inv(campo) + "></label>" + erroDe(campo);
    }
    function area(campo, rotulo, valor, n) {
      return '<label class="campo">' + esc(rotulo) + '<textarea name="' + campo + '" rows="' + n + '"' + inv(campo) + ">" + esc(valor) + "</textarea></label>" + erroDe(campo);
    }
    function botao(acao, rotulo, i, j) {
      return '<button type="button" data-acao="' + acao + '"' + (i != null ? ' data-i="' + i + '"' : "") + (j != null ? ' data-j="' + j + '"' : "") + ">" + esc(rotulo) + "</button>";
    }

    var h = '<form id="form-plano" novalidate>';
    if (msgs["form-plano"]) h += '<p class="erro" role="alert">' + esc(msgs["form-plano"]) + "</p>";
    m.refeicoes.forEach(function (r, i) {
      var pref = "r" + i + "-";
      h += '<fieldset class="refeicao"><legend>Refeição ' + (i + 1) + "</legend>";
      h += '<input type="hidden" name="' + pref + 'id" value="' + esc(r.id) + '">';
      h += entrada(pref + "nome", "Nome", "text", r.nome);
      h += entrada(pref + "hora", "Horário", "time", r.hora);
      h += entrada(pref + "kcal", "Calorias (kcal)", "number", r.kcal, ' min="0" step="any"');
      r.itens.forEach(function (it, j) {
        var p2 = pref + "it" + j + "-";
        h += '<div class="item">';
        h += entrada(p2 + "principal", "Item " + (j + 1), "text", it.principal);
        h += area(p2 + "opcoes", "Opções de troca (uma por linha)", it.opcoes, 2);
        h += botao("subir", "Item para cima", i, j) + botao("descer", "Item para baixo", i, j) + botao("del-item", "Remover item", i, j);
        h += "</div>";
      });
      h += botao("add-item", "Adicionar item", i);
      h += area(pref + "obs", "Observações (uma por linha)", r.obs, 2);
      var lista = receitas || [];
      if (lista.length) {
        h += '<div class="receitas"><span>Receitas desta refeição</span>';
        lista.forEach(function (rec) {
          var marcado = r.rec.indexOf(rec.id) >= 0 ? " checked" : "";
          h += '<label><input type="checkbox" name="' + pref + 'rec" value="' + esc(rec.id) + '"' + marcado + "> " + esc(rec.nome) + "</label>";
        });
        h += "</div>";
      }
      h += botao("subir", "Refeição para cima", i) + botao("descer", "Refeição para baixo", i) + botao("del-refeicao", "Remover refeição", i);
      h += "</fieldset>";
    });
    h += botao("add-refeicao", "Adicionar refeição");
    h += entrada("prescrito", "Prescrito em", "date", m.prescrito);
    h += area("compras", "Lista de compras (uma por linha)", m.compras, 5);
    h += '<fieldset class="nutrientes"><legend>Total de nutrientes</legend>';
    h += entrada("nut-proteinas", "Proteínas", "text", m.nut.proteinas);
    h += entrada("nut-lipidios", "Lipídios", "text", m.nut.lipidios);
    h += entrada("nut-carboidratos", "Carboidratos", "text", m.nut.carboidratos);
    h += entrada("nut-kcal", "Calorias (kcal)", "number", m.nut.kcal, ' min="0" step="any"');
    h += entrada("nut-fibras", "Fibras", "text", m.nut.fibras);
    h += "</fieldset></form>";
    return h;
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.editor = { htmlPlano: htmlPlano, planoDosCampos: planoDosCampos, aplicarAcao: aplicarAcao };
  if (typeof module !== "undefined") module.exports = raiz.SF.editor;
})(typeof window !== "undefined" ? window : globalThis);
