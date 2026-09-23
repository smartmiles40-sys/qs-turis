/*
 * distribuidor.js — o botão de WhatsApp das páginas da agência cai no SDR da vez.
 * (Bruno, 23/09/2026: "trocar o novo link de redirecionamento em todas as páginas")
 *
 * COMO USAR: uma linha antes do </body> de qualquer página:
 *   <script src="https://qs-turis.vercel.app/distribuidor.js" defer></script>
 *
 * O QUE FAZ: todo link que aponta pro número de emergência (o 1935) continua
 * no HTML como está — é o plano B. No CLIQUE, este script pergunta ao QS
 * (/api/lead) qual SDR é a vez e abre o WhatsApp DELE, com a mesma mensagem.
 *   • Página depois de formulário (tem o telefone no sessionStorage): vai pelo
 *     bilhete — o card no QS/Bitrix nasce com o mesmo SDR da conversa.
 *   • Página sem formulário (pacotes, portal): entra na mesma roda como clique.
 * A mesma pessoa que clica de novo cai no MESMO SDR (guardado por 7 dias).
 *
 * NADA AQUI PODE PERDER UM LEAD: script que não carregou, QS lento (>2,5s),
 * erro, pool vazio — em todos os casos o link segue pro número original.
 */
(function () {
  if (window.__stfvDistribuidor) return;
  window.__stfvDistribuidor = true;

  var NUMERO_PADRAO = '5511951251935';
  var API = 'https://qs-turis.vercel.app/api/lead';
  var ESPERA_MAX_MS = 2500;
  var LEAD_KEY = 'stfv_wa_lead';          // gravado pelo formulário das LPs
  var NUMERO_SESSAO = 'stfv_wa_numero';   // o SDR já decidido nesta aba
  var NUMERO_LOCAL = 'stfv_sdr_numero';   // o SDR desta pessoa, por 7 dias
  var VALIDADE_MS = 7 * 86400000;

  function ler(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function gravar(store, k, v) { try { window[store].setItem(k, v); } catch (e) {} }

  function numeroGuardado() {
    var s = ler('sessionStorage', NUMERO_SESSAO);
    if (s && s !== NUMERO_PADRAO) return s;
    try {
      var l = JSON.parse(ler('localStorage', NUMERO_LOCAL) || 'null');
      if (l && l.n && Date.now() - l.t < VALIDADE_MS) return l.n;
    } catch (e) {}
    return null;
  }
  function guardar(n) {
    gravar('sessionStorage', NUMERO_SESSAO, n);
    gravar('localStorage', NUMERO_LOCAL, JSON.stringify({ n: n, t: Date.now() }));
  }

  // Só mexe em link do número de emergência. Grupo da comunidade, Instagram e
  // qualquer outro WhatsApp passam intocados.
  function ehDoPadrao(href) {
    if (!href) return false;
    var h = String(href);
    return (h.indexOf('wa.me/' + NUMERO_PADRAO) !== -1) ||
      (h.indexOf('whatsapp.com/send') !== -1 && h.indexOf('phone=' + NUMERO_PADRAO) !== -1);
  }
  function trocarNumero(href, numero) {
    return String(href).split(NUMERO_PADRAO).join(numero);
  }

  function perguntar(cb) {
    var feito = false;
    function fim(n) {
      if (feito) return;
      feito = true;
      cb(n && /^[0-9]{12,13}$/.test(String(n)) ? String(n) : null);
    }
    var lead = null;
    try { lead = JSON.parse(ler('sessionStorage', LEAD_KEY) || 'null'); } catch (e) {}
    var corpo = lead && lead.telefone
      ? lead
      : { clique: true, origem: (location.hostname + location.pathname).slice(0, 70) };
    if (!window.fetch) return fim(null);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var limite = setTimeout(function () { if (ctrl) ctrl.abort(); fim(null); }, ESPERA_MAX_MS);
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { clearTimeout(limite); fim(d && !d.fallback ? d.numero : null); })
      .catch(function () { clearTimeout(limite); fim(null); });
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !ehDoPadrao(a.href)) return;

    var original = a.href;
    var guardado = numeroGuardado();
    if (guardado) {
      a.href = trocarNumero(original, guardado);   // o navegador segue com o link trocado
      setTimeout(function () { a.href = original; }, 0);
      return;
    }

    ev.preventDefault();
    var novaAba = (a.getAttribute('target') || '').toLowerCase() === '_blank';
    // Aba aberta JÁ, dentro do clique: depois do fetch o navegador bloquearia.
    var aba = novaAba ? window.open('', '_blank') : null;
    perguntar(function (numero) {
      if (numero) guardar(numero);
      var url = numero ? trocarNumero(original, numero) : original;
      if (aba) { try { aba.opener = null; aba.location.href = url; return; } catch (e) {} }
      window.location.href = url;
    });
  }, true);
})();
