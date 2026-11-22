// Telas de conta: entrar, criar conta, confirmar e-mail, esqueci a senha, nova senha e Conta.
// Funções puras no topo (testáveis no Node); o desenho das telas só roda dentro de montar().
(function (raiz) {
  var URL_TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  var MSG_NEUTRA = "Se o e-mail puder ser usado, você vai receber um link. Olhe também a caixa de spam.";

  function modoInicial(o) {
    if (o && o.sessao) return "conta";
    if (o && o.temDadosAntigos) return "antigo";
    return "entrar";
  }

  // Trava temporária até a migração (plano 4): aparelho do app antigo, sem sessão, fica sem conta.
  function contaDisponivel(o) {
    var s = o && o.sessao;
    return !!(s && s.usuario && s.usuario.id) || !(o && o.usouAppAntigo);
  }

  // Versão do aviso de privacidade: igual à de server/src/aceite.js e à de privacidade.html.
  var VERSAO_AVISO = "1";
  var TEXTO_ACEITE_SAUDE = [
    "Tenho 18 anos ou mais e ", "concordo que o Saúde Familiar trate meus dados de saúde",
    " (alimentação, exercícios, fotos e listas) para guardar, sincronizar e me mostrar o meu acompanhamento."
  ];
  var TEXTO_ACEITE_TRANSFERENCIA = [
    "", "Concordo que meus dados sejam enviados e guardados fora do Brasil",
    ", principalmente nos Estados Unidos, para o app funcionar."
  ];

  function montarAceite(saude, transferencia) {
    return saude === true && transferencia === true ? { versao: VERSAO_AVISO, saude: true, transferencia: true } : null;
  }

  function lerHash(hash) {
    var m = /^#(confirmar|nova-senha)=(.+)$/.exec(String(hash || ""));
    if (!m) return { acao: null, token: "" };
    var token = m[2];
    try { token = decodeURIComponent(token); } catch (e) { /* mantém o texto cru */ }
    return { acao: m[1], token: token };
  }

  var MENSAGENS = {
    credenciais: "E-mail ou senha incorretos.",
    "nao-confirmado": "Você ainda não confirmou o e-mail. Abra o link que enviamos para você.",
    captcha: "Não deu para confirmar que você não é um robô. Tente de novo.",
    limite: "Muitas tentativas. Espere alguns minutos e tente de novo.",
    senha: "A senha precisa ter de 8 a 128 caracteres.",
    email: "Esse e-mail não parece certo. Confira e tente de novo.",
    token: "Esse link não vale mais. Peça um novo.",
    aceite: "Para criar a conta, marque as duas caixas. Se já marcou, recarregue a página e tente de novo.",
    armazenamento: "Não deu para guardar o acesso neste aparelho. Libere espaço ou saia do modo restrito e tente de novo.",
    rede: "Sem conexão com o servidor. Confira a internet e tente de novo."
  };
  var MSG_PADRAO = "Algo deu errado. Tente de novo daqui a pouco.";

  function mensagemErro(codigo) {
    return Object.prototype.hasOwnProperty.call(MENSAGENS, codigo) ? MENSAGENS[codigo] : MSG_PADRAO;
  }

  function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim()); }
  function validarSenha(s) { s = String(s || ""); return s.length >= 8 && s.length <= 128; }

  function textoSair(n) {
    if (!n) return "";
    return "Você tem " + n + (n === 1 ? " alteração" : " alterações") +
      " que ainda não foi enviada. Se sair agora, ela continua guardada neste aparelho e sobe quando você entrar de novo.";
  }

  // Confirmação do Sair quando ainda há itens na fila (fila + fotos pendentes).
  function textoConfirmarSair(n) {
    if (!n) return "";
    var um = n === 1;
    return "Há " + n + (um ? " item ainda não enviado. Ele fica guardado" : " itens ainda não enviados. Eles ficam guardados") +
      " neste aparelho e sobe" + (um ? "" : "m") + " quando você entrar de novo. Toque de novo em Sair para confirmar.";
  }

  // Texto do indicador do cabeçalho para cada status de SF.sincronia.
  var STATUS = {
    ok: "Tudo salvo na conta", conflito: "Tudo salvo na conta",
    pendente: "Salvo no aparelho, enviando…", enviando: "Salvo no aparelho, enviando…",
    offline: "Sem internet, envio pendente", erro: "Não consegui enviar, vou tentar de novo"
  };
  var MSG_CONFLITO = "Esta refeição já foi registrada em outro aparelho";
  function textoStatus(s) { return STATUS[s] || STATUS.pendente; }

  var TIPOS = {
    fav: "Receita favorita", sel: "Receita escolhida", check: "Item da lista de compras",
    checkplano: "Item do plano", quero: "Quero comer", feito: "Refeição feita",
    treino: "Treino feito", registro: "Registro de refeição", plano: "Plano alimentar", meta: "Meta de exercício"
  };
  function rotuloRejeitado(item) {
    var nome = TIPOS[item && item.tipo] || "Item";
    return nome + ": " + String((item && item.chave) || "");
  }

  function confirmacaoApagarOk(t) { return String(t || "").trim().toUpperCase() === "APAGAR"; }

  var MSG_LIMPEZA = "Sua conta foi apagada, mas não deu para apagar as fotos guardadas neste aparelho. Feche as outras abas do app e tente de novo.";
  var MSG_FOTOS_FICAM = "As fotos continuam guardadas neste aparelho.";
  var MSG_LIMPEZA_SAIR = "Você saiu, mas não deu para apagar as fotos guardadas neste aparelho. Feche as outras abas do app e tente de novo.";

  // Roda aoApagar sem deixar a falha dele virar erro da API: devolve true se a limpeza local falhou.
  function limpar(aoApagar, userId) {
    return Promise.resolve().then(function () { return aoApagar ? aoApagar(userId) : undefined; }).then(
      function () { return false; }, function () { return true; });
  }

  // Apaga a conta. Erro da API rejeita (nada é limpo). Depois do sucesso (204) a conta está encerrada:
  // sessão e chaves saem, e a falha de aoApagar vira {limpezaFalhou:true}, nunca rejeição.
  function apagarConta(o) {
    return o.api.apagarConta(o.senha).then(function () {
      o.local.apagarSessao();
      o.local.apagarUsuario(o.userId);
      return limpar(o.aoApagar, o.userId).then(function (falhou) { return { limpezaFalhou: falhou }; });
    });
  }

  // Sair: sempre apaga a sessão; sem pendências também limpa a conta do aparelho (aoApagar), com pendências mantém.
  // Falha de aoApagar não impede a saída: vira {limpezaFalhou:true}.
  function sairDaConta(o) {
    return Promise.resolve().then(function () { return o.api.sair(); }).catch(function () { /* sai mesmo sem rede */ }).then(function () {
      o.local.apagarSessao();
      if (o.pendentes > 0) return { limpezaFalhou: false };
      o.local.apagarUsuario(o.userId);
      return limpar(o.aoApagar, o.userId).then(function (falhou) { return { limpezaFalhou: falhou }; });
    });
  }

  function montar(o) {
    var rz = o.raiz, api = o.api, local = o.local, config = o.config || {};
    var doc = rz.ownerDocument;
    var janela = doc.defaultView;
    var turnstileToken = "";
    var turnstileId = null;
    var carregandoScript = null;

    function el(tag, attrs, filhos) {
      var e = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "texto") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
      });
      (filhos || []).forEach(function (f) { e.appendChild(f); });
      return e;
    }

    function limparHash() {
      try { janela.history.replaceState(null, "", janela.location.pathname + janela.location.search); } catch (e) { /* ignora */ }
    }

    function carregarTurnstile() {
      if (!config.turnstileChave) return Promise.resolve(false);
      if (janela.turnstile) return Promise.resolve(true);
      if (!carregandoScript) {
        carregandoScript = new Promise(function (ok) {
          var s = doc.createElement("script");
          s.src = URL_TURNSTILE; s.async = true;
          s.onload = function () { ok(true); };
          s.onerror = function () { carregandoScript = null; ok(false); };
          doc.head.appendChild(s);
        });
      }
      return carregandoScript;
    }

    function desenharCaptcha(caixa) {
      turnstileToken = ""; turnstileId = null;
      carregarTurnstile().then(function (ok) {
        if (!ok || !janela.turnstile || !caixa.isConnected) return;
        turnstileId = janela.turnstile.render(caixa, {
          sitekey: config.turnstileChave,
          callback: function (t) { turnstileToken = t; },
          "expired-callback": function () { turnstileToken = ""; },
          "error-callback": function () { turnstileToken = ""; }
        });
      });
    }
    function reiniciarCaptcha() {
      turnstileToken = "";
      try { if (janela.turnstile && turnstileId !== null) janela.turnstile.reset(turnstileId); } catch (e) { /* ignora */ }
    }

    function aoApagar(userId) { return o.aoApagar ? o.aoApagar(userId) : undefined; }

    // Tira o widget do Turnstile antes de trocar de tela (senão ele avisa no console que perdeu o elemento).
    function soltarCaptcha() {
      if (turnstileId === null) return;
      try { if (janela.turnstile) janela.turnstile.remove(turnstileId); } catch (e) { /* ignora */ }
      turnstileId = null;
    }

    function esconder() { soltarCaptcha(); rz.hidden = true; rz.textContent = ""; }

    // Esqueleto de uma tela: título, mensagem de erro anunciada, corpo.
    function tela(titulo, sub) {
      var erro = el("p", { "class": "conta-erro", role: "alert", "aria-live": "assertive" });
      var h = el("h2", { texto: titulo, tabindex: "-1" });
      var caixa = el("div", { "class": "conta-caixa" }, [h]);
      soltarCaptcha();
      if (sub) caixa.appendChild(el("p", { "class": "conta-sub", texto: sub }));
      caixa.appendChild(erro);
      rz.textContent = "";
      rz.appendChild(el("div", { "class": "conta-tela" }, [el("img", { src: "logo.svg", alt: "", width: "48", height: "48" }), caixa]));
      rz.hidden = false;
      return { caixa: caixa, erro: erro, titulo: h };
    }

    function campo(id, rotulo, tipo, extra) {
      var input = el("input", Object.assign({ id: id, type: tipo, name: id }, extra || {}));
      return { linha: el("div", { "class": "conta-campo" }, [el("label", { "for": id, texto: rotulo }), input]), input: input };
    }
    // Caixa de consentimento: nasce desmarcada; o trecho do meio vai em destaque.
    function caixaAceite(id, partes) {
      var input = el("input", { id: id, type: "checkbox", name: id, required: "required" });
      var texto = el("span", {}, [el("span", { texto: partes[0] }), el("strong", { texto: partes[1] }), el("span", { texto: partes[2] })]);
      return { linha: el("label", { "class": "conta-aceite", "for": id }, [input, texto]), input: input };
    }
    function linkAviso() {
      return el("a", { "class": "conta-link-aviso", href: "privacidade.html", target: "_blank", rel: "noopener", texto: "Aviso de privacidade" });
    }
    function botao(texto, classe, tipo) { return el("button", { type: tipo || "button", "class": "btn " + (classe || ""), texto: texto }); }
    function link(texto, aoClicar) {
      var b = el("button", { type: "button", "class": "conta-link", texto: texto });
      b.addEventListener("click", aoClicar);
      return b;
    }
    // "Voltar ao app": só quando o app embaixo da tela pode ser usado (modo antigo ou conta).
    function linksComVoltar(links) {
      if (o.podeVoltar && o.podeVoltar()) links.push(link("Voltar ao app", function () { esconder(); if (o.aoVoltar) o.aoVoltar(); }));
      return el("div", { "class": "conta-links" }, links);
    }
    function dizerErro(t, codigo) { t.erro.textContent = mensagemErro(codigo); }
    function ocupado(b, sim, texto) { b.disabled = sim; b.textContent = sim ? "Aguarde..." : texto; }
    function foco(x) { try { x.focus(); } catch (e) { /* ignora */ } }
    function codigoDe(e) { return (e && e.codigo) || (e && e.status === 0 ? "rede" : ""); }

    function formulario(t, campos, textoBotao, aoEnviar) {
      var f = el("form", { novalidate: "novalidate" });
      campos.forEach(function (c) { f.appendChild(c.linha || c); });
      var b = botao(textoBotao, "primario flex", "submit");
      f.appendChild(b);
      f.addEventListener("submit", function (ev) {
        ev.preventDefault();
        t.erro.textContent = "";
        Promise.resolve(aoEnviar(b)).catch(function () { ocupado(b, false, textoBotao); dizerErro(t, "rede"); });
      });
      t.caixa.appendChild(f);
      return f;
    }

    // ---------- telas ----------

    function mostrarEntrar(aviso) {
      var t = tela("Entrar", aviso);
      var email = campo("sf-email", "E-mail", "email", { autocomplete: "email", required: "required", inputmode: "email" });
      var senha = campo("sf-senha", "Senha", "password", { autocomplete: "current-password", required: "required" });
      formulario(t, [email, senha], "Entrar", function (b) {
        if (!validarEmail(email.input.value)) { dizerErro(t, "email"); foco(email.input); return; }
        if (!senha.input.value) { dizerErro(t, "credenciais"); foco(senha.input); return; }
        ocupado(b, true, "Entrar");
        return api.entrar(email.input.value.trim(), senha.input.value).then(function (s) {
          var sessao = { token: s.token, usuario: s.usuario };
          if (local.gravarSessao(sessao) === false) { ocupado(b, false, "Entrar"); dizerErro(t, "armazenamento"); return; }
          senha.input.value = "";
          esconder();
          if (o.aoEntrar) o.aoEntrar(sessao);
        }, function (e) {
          ocupado(b, false, "Entrar");
          dizerErro(t, codigoDe(e));
          foco(senha.input);
        });
      });
      t.caixa.appendChild(linksComVoltar([
        link("Esqueci minha senha", mostrarEsqueci),
        link("Criar conta", mostrarCadastro)
      ]));
      t.caixa.appendChild(linkAviso());
      foco(email.input);
    }

    function mostrarCadastro() {
      var t = tela("Criar conta", "Use seu e-mail e uma senha de 8 ou mais caracteres. Vamos enviar um link para confirmar o e-mail.");
      var email = campo("sf-email", "E-mail", "email", { autocomplete: "email", required: "required", inputmode: "email" });
      var senha = campo("sf-senha", "Senha (8 a 128 caracteres)", "password", { autocomplete: "new-password", required: "required", minlength: "8", maxlength: "128" });
      var caixaCaptcha = el("div", { "class": "conta-captcha" });
      var saude = caixaAceite("sf-aceite-saude", TEXTO_ACEITE_SAUDE);
      var fora = caixaAceite("sf-aceite-transferencia", TEXTO_ACEITE_TRANSFERENCIA);
      var nota = el("p", { "class": "conta-nota" }, [
        el("span", { texto: "Você pode revogar quando quiser apagando a conta. Leia o " }), linkAviso(), el("span", { texto: "." })
      ]);
      formulario(t, [email, senha, saude, fora, nota, caixaCaptcha], "Criar conta", function (b) {
        if (!validarEmail(email.input.value)) { dizerErro(t, "email"); foco(email.input); return; }
        if (!validarSenha(senha.input.value)) { dizerErro(t, "senha"); foco(senha.input); return; }
        var aceite = montarAceite(saude.input.checked, fora.input.checked);
        if (!aceite) { dizerErro(t, "aceite"); foco(saude.input.checked ? fora.input : saude.input); return; }
        if (config.turnstileChave && !turnstileToken) { dizerErro(t, "captcha"); return; }
        ocupado(b, true, "Criar conta");
        return api.cadastro(email.input.value.trim(), senha.input.value, turnstileToken, aceite).then(function () {
          mostrarNeutra("Confira seu e-mail");
        }, function (e) {
          ocupado(b, false, "Criar conta");
          reiniciarCaptcha();
          dizerErro(t, codigoDe(e));
        });
      });
      t.caixa.appendChild(linksComVoltar([link("Já tenho conta", function () { mostrarEntrar(); })]));
      desenharCaptcha(caixaCaptcha);
      foco(email.input);
    }

    function mostrarNeutra(titulo) {
      var t = tela(titulo, MSG_NEUTRA);
      var b = botao("Voltar para entrar", "primario");
      b.addEventListener("click", function () { mostrarEntrar(); });
      t.caixa.appendChild(b);
      foco(t.titulo);
    }

    function mostrarEsqueci() {
      var t = tela("Esqueci minha senha", "Digite seu e-mail. Se ele puder ser usado, enviamos um link para criar uma senha nova.");
      var email = campo("sf-email", "E-mail", "email", { autocomplete: "email", required: "required", inputmode: "email" });
      var caixaCaptcha = el("div", { "class": "conta-captcha" });
      formulario(t, [email, caixaCaptcha], "Enviar link", function (b) {
        if (!validarEmail(email.input.value)) { dizerErro(t, "email"); foco(email.input); return; }
        if (config.turnstileChave && !turnstileToken) { dizerErro(t, "captcha"); return; }
        ocupado(b, true, "Enviar link");
        return api.esqueci(email.input.value.trim(), turnstileToken).then(function () {
          mostrarNeutra("Confira seu e-mail");
        }, function (e) {
          ocupado(b, false, "Enviar link");
          reiniciarCaptcha();
          dizerErro(t, codigoDe(e));
        });
      });
      t.caixa.appendChild(linksComVoltar([link("Voltar para entrar", function () { mostrarEntrar(); })]));
      desenharCaptcha(caixaCaptcha);
      foco(email.input);
    }

    function mostrarNovaSenha(token) {
      var t = tela("Nova senha", "Escolha uma senha nova, de 8 a 128 caracteres.");
      var senha = campo("sf-senha", "Senha nova", "password", { autocomplete: "new-password", required: "required", minlength: "8", maxlength: "128" });
      formulario(t, [senha], "Salvar senha", function (b) {
        if (!validarSenha(senha.input.value)) { dizerErro(t, "senha"); foco(senha.input); return; }
        ocupado(b, true, "Salvar senha");
        return api.novaSenha(token, senha.input.value).then(function () {
          mostrarEntrar("Senha trocada. Entre com a senha nova.");
        }, function (e) {
          ocupado(b, false, "Salvar senha");
          dizerErro(t, codigoDe(e));
        });
      });
      foco(senha.input);
    }

    function mostrarConfirmar(token) {
      var t = tela("Confirmando seu e-mail", "Um instante...");
      foco(t.titulo);
      api.confirmar(token).then(function () {
        mostrarEntrar("E-mail confirmado. Agora é só entrar.");
      }, function (e) {
        mostrarEntrar(mensagemErro(codigoDe(e)));
      });
    }

    // Aviso quando a conta/sessão já acabou mas a limpeza das fotos locais falhou: dá para tentar de novo.
    function mostrarLimpeza(userId, msg) {
      var t = tela("Falta limpar o aparelho", msg);
      var tentar = botao("Tentar de novo", "primario");
      tentar.addEventListener("click", function () {
        ocupado(tentar, true, "Tentar de novo");
        limpar(aoApagar, userId).then(function (falhou) {
          if (falhou) { ocupado(tentar, false, "Tentar de novo"); t.erro.textContent = "Ainda não deu. Feche as outras abas do app e tente de novo."; }
          else mostrarEntrar("Fotos apagadas deste aparelho.");
        });
      });
      var seguir = botao("Continuar sem apagar", "");
      seguir.addEventListener("click", function () { mostrarEntrar(MSG_FOTOS_FICAM); });
      t.caixa.appendChild(tentar);
      t.caixa.appendChild(seguir);
      foco(tentar);
    }

    function mostrarConta() {
      var s = local.sessao();
      if (!s) { mostrarEntrar(); return; }
      var t = tela("Conta", null);
      t.caixa.appendChild(el("p", { "class": "conta-email", texto: s.usuario.email }));
      t.caixa.appendChild(linkAviso());

      function pendentes() {
        if (o.pendentes) return o.pendentes(s.usuario.id);
        var fila = local.ler(s.usuario.id, "fila", []);
        return Array.isArray(fila) ? fila.length : 0;
      }
      var aviso = el("p", { "class": "conta-aviso", texto: textoSair(pendentes()) });
      aviso.hidden = !aviso.textContent;
      t.caixa.appendChild(aviso);

      var sair = botao("Sair", "flex");
      var confirmouSair = false;
      sair.addEventListener("click", function () {
        var n = pendentes();
        if (n > 0 && !confirmouSair) {
          confirmouSair = true;
          aviso.textContent = textoConfirmarSair(n);
          aviso.hidden = false;
          sair.textContent = "Sair mesmo assim";
          return;
        }
        ocupado(sair, true, "Sair");
        function saiu() { esconder(); if (o.aoSair) o.aoSair(); }
        sairDaConta({ api: api, local: local, userId: s.usuario.id, pendentes: n, aoApagar: aoApagar }).then(function (r) {
          saiu();
          if (r.limpezaFalhou) mostrarLimpeza(s.usuario.id, MSG_LIMPEZA_SAIR);
        }, saiu); // erro do armazenamento não pode deixar a tela presa em "Aguarde..."
      });
      t.caixa.appendChild(sair);

      var rej = local.ler(s.usuario.id, "rejeitados", []);
      if (Array.isArray(rej) && rej.length) {
        var ul = el("ul", { "class": "conta-rejeitados" });
        rej.forEach(function (r) { ul.appendChild(el("li", { texto: rotuloRejeitado(r) })); });
        t.caixa.appendChild(el("section", { "class": "conta-bloco", "aria-labelledby": "sf-rej-t" }, [
          el("h3", { id: "sf-rej-t", texto: "Não foi possível enviar" }),
          el("p", { "class": "conta-sub", texto: "O servidor não aceitou estes itens. Eles continuam só neste aparelho." }),
          ul
        ]));
      }

      var perigo = el("section", { "class": "conta-bloco conta-perigo", "aria-labelledby": "sf-ap-t" }, [
        el("h3", { id: "sf-ap-t", texto: "Apagar minha conta" }),
        el("p", { "class": "conta-sub", texto: "Isso apaga sua conta, seus dados e suas fotos no servidor. Não dá para desfazer." })
      ]);
      var abrir = botao("Apagar minha conta", "perigo");
      perigo.appendChild(abrir);
      abrir.addEventListener("click", function () {
        abrir.hidden = true;
        var senha = campo("sf-ap-senha", "Sua senha", "password", { autocomplete: "current-password", required: "required" });
        var conf = campo("sf-ap-conf", "Para confirmar, escreva APAGAR", "text", { autocomplete: "off", autocapitalize: "characters" });
        var erro = el("p", { "class": "conta-erro", role: "alert", "aria-live": "assertive" });
        var f = el("form", { novalidate: "novalidate" }, [senha.linha, conf.linha, erro]);
        var b = botao("Apagar para sempre", "perigo", "submit");
        var cancelar = botao("Cancelar", "");
        f.appendChild(el("div", { "class": "acoes" }, [b, cancelar]));
        cancelar.addEventListener("click", function () { perigo.removeChild(f); abrir.hidden = false; foco(abrir); });
        f.addEventListener("submit", function (ev) {
          ev.preventDefault();
          erro.textContent = "";
          if (!senha.input.value) { erro.textContent = mensagemErro("credenciais"); foco(senha.input); return; }
          if (!confirmacaoApagarOk(conf.input.value)) { erro.textContent = "Escreva a palavra APAGAR para confirmar."; foco(conf.input); return; }
          ocupado(b, true, "Apagar para sempre");
          apagarConta({ api: api, local: local, userId: s.usuario.id, senha: senha.input.value, aoApagar: aoApagar }).then(function (r) {
            esconder();
            if (o.aoSair) o.aoSair();
            if (r.limpezaFalhou) mostrarLimpeza(s.usuario.id, MSG_LIMPEZA);
          }, function (e) {
            ocupado(b, false, "Apagar para sempre");
            erro.textContent = mensagemErro(codigoDe(e));
            foco(senha.input);
          });
        });
        perigo.appendChild(f);
        foco(senha.input);
      });
      t.caixa.appendChild(perigo);

      var fechar = botao("Voltar ao app", "");
      fechar.addEventListener("click", esconder);
      t.caixa.appendChild(fechar);
      foco(t.titulo);
    }

    // Decide a tela de abertura. Devolve o modo ("conta", "antigo", "entrar") ou a ação do hash.
    // Em "conta" e "antigo" nada é desenhado: o app segue e chama mostrar("conta") ou mostrar("entrar") quando quiser.
    function iniciar() {
      var h = lerHash(janela.location.hash);
      if (h.acao) {
        limparHash();
        if (h.acao === "confirmar") mostrarConfirmar(h.token); else mostrarNovaSenha(h.token);
        return h.acao;
      }
      var modo = modoInicial({ sessao: local.sessao(), temDadosAntigos: local.temDadosAntigos() });
      if (modo === "entrar") mostrarEntrar(); else esconder();
      return modo;
    }

    return {
      iniciar: iniciar,
      mostrar: function (nome, aviso) {
        if (nome === "conta") mostrarConta();
        else if (nome === "cadastro") mostrarCadastro();
        else mostrarEntrar(aviso);
      },
      esconder: esconder
    };
  }

  raiz.SF = raiz.SF || {};
  raiz.SF.conta = {
    modoInicial: modoInicial, contaDisponivel: contaDisponivel, montarAceite: montarAceite, VERSAO_AVISO: VERSAO_AVISO, lerHash: lerHash, mensagemErro: mensagemErro,
    validarEmail: validarEmail, validarSenha: validarSenha, textoSair: textoSair, apagarConta: apagarConta, sairDaConta: sairDaConta,
    rotuloRejeitado: rotuloRejeitado, confirmacaoApagarOk: confirmacaoApagarOk, montar: montar,
    textoConfirmarSair: textoConfirmarSair, textoStatus: textoStatus, MSG_CONFLITO: MSG_CONFLITO
  };
  if (typeof module !== "undefined") module.exports = raiz.SF.conta;
})(typeof window !== "undefined" ? window : globalThis);
