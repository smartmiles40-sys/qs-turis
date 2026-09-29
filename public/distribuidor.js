/*
 * distribuidor.js — o botão de WhatsApp das páginas da agência cai no SDR da vez.
 * (Bruno, 23/09/2026: "trocar o novo link de redirecionamento em todas as páginas")
 * (Bruno, 29/09/2026: "não deve de nenhuma forma passar para o 1935")
 *
 * COMO USAR: uma linha antes do </body> de qualquer página:
 *   <script src="https://qs-turis.vercel.app/distribuidor.js" defer></script>
 *
 * O LINK DAS PÁGINAS agora é a rota do QS, não um número:
 *   https://qs-turis.vercel.app/api/whatsapp?text=<mensagem>
 * Ela decide o SDR no servidor e redireciona — funciona mesmo se este script
 * não carregar. O script existe pra duas coisas a mais:
 *   • Página depois de formulário (tem o telefone no sessionStorage): vai pelo
 *     bilhete — o card no QS/Bitrix nasce com o mesmo SDR da conversa.
 *   • A mesma pessoa que clica de novo cai no MESMO SDR (guardado por 7 dias).
 *
 * LINK ANTIGO (wa.me/5511951251935) que ainda exista em alguma página é
 * reescrito pra rota do QS assim que aparece no DOM, e de novo no clique.
 * Nenhum caminho aqui termina no 1935: falhou → rota do QS → chip de um SDR.
 */
(function () {
  if (window.__stfvDistribuidor) return;
  window.__stfvDistribuidor = true;

  var LEGADOS = ['5511951251935', '551151251935'];   // o 1935: só pra reconhecer e trocar
  var ROTA = 'https://qs-turis.vercel.app/api/whatsapp';
  var API = 'https://qs-turis.vercel.app/api/lead';
  var MSG_PADRAO = 'Quero seguir os próximos passos';
  var ESPERA_MAX_MS = 2500;
  var LEAD_KEY = 'stfv_wa_lead';          // gravado pelo formulário das LPs
  var NUMERO_SESSAO = 'stfv_wa_numero';   // o SDR já decidido nesta aba
  var NUMERO_LOCAL = 'stfv_sdr_numero';   // o SDR desta pessoa, por 7 dias
  var VALIDADE_MS = 7 * 86400000;

  function ler(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function gravar(store, k, v) { try { window[store].setItem(k, v); } catch (e) {} }

  function valido(n) {
    var s = String(n || '');
    return /^[0-9]{12,13}$/.test(s) && LEGADOS.indexOf(s) === -1 ? s : null;
  }

  function numeroGuardado() {
    var s = valido(ler('sessionStorage', NUMERO_SESSAO));
    if (s) return s;
    try {
      var l = JSON.parse(ler('localStorage', NUMERO_LOCAL) || 'null');
      if (l && valido(l.n) && Date.now() - l.t < VALIDADE_MS) return l.n;
    } catch (e) {}
    return null;
  }
  function guardar(n) {
    gravar('sessionStorage', NUMERO_SESSAO, n);
    gravar('localStorage', NUMERO_LOCAL, JSON.stringify({ n: n, t: Date.now() }));
  }

  function ehRota(h) { return h.indexOf(ROTA) === 0; }
  function ehLegado(h) {
    for (var i = 0; i < LEGADOS.length; i++) {
      var n = LEGADOS[i];
      if (h.indexOf('wa.me/' + n) !== -1) return true;
      if (h.indexOf('whatsapp.com/send') !== -1 && h.indexOf('phone=' + n) !== -1) return true;
    }
    return false;
  }
  // Só mexe no link do distribuidor (rota do QS ou o 1935 antigo). Grupo da
  // comunidade, Instagram e qualquer outro WhatsApp passam intocados.
  function ehNosso(href) {
    if (!href) return false;
    var h = String(href);
    return ehRota(h) || ehLegado(h);
  }
  function mensagem(href) {
    try { return new URL(href).searchParams.get('text') || MSG_PADRAO; } catch (e) { return MSG_PADRAO; }
  }
  function paraRota(href) { return ROTA + '?text=' + encodeURIComponent(mensagem(href)); }
  function paraNumero(href, numero) {
    return 'https://wa.me/' + numero + '?text=' + encodeURIComponent(mensagem(href));
  }

  // Link do 1935 que ainda exista no HTML vira a rota do QS antes de alguém
  // clicar (cobre também botão do meio, "abrir em nova aba" e toque longo).
  function limpar(raiz) {
    var links = (raiz && raiz.querySelectorAll) ? raiz.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i++) {
      if (ehLegado(links[i].href)) links[i].href = paraRota(links[i].href);
    }
  }
  limpar(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { limpar(document); });
  }
  if (window.MutationObserver) {
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'attributes') { if (m.target.href && ehLegado(m.target.href)) m.target.href = paraRota(m.target.href); }
        else for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'A' && ehLegado(n.href)) n.href = paraRota(n.href);
          limpar(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  function perguntar(cb) {
    var feito = false;
    function fim(n) {
      if (feito) return;
      feito = true;
      cb(valido(n));
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
      // fallback=true também é chip de SDR (nunca o 1935) — serve igual.
      .then(function (d) { clearTimeout(limite); fim(d && d.numero); })
      .catch(function () { clearTimeout(limite); fim(null); });
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !ehNosso(a.href)) return;

    var original = a.href;
    var guardado = numeroGuardado();
    if (guardado) {
      a.href = paraNumero(original, guardado);   // o navegador segue com o link trocado
      setTimeout(function () { a.href = paraRota(original); }, 0);
      return;
    }

    ev.preventDefault();
    var novaAba = (a.getAttribute('target') || '').toLowerCase() === '_blank';
    // Aba aberta JÁ, dentro do clique: depois do fetch o navegador bloquearia.
    var aba = novaAba ? window.open('', '_blank') : null;
    perguntar(function (numero) {
      if (numero) guardar(numero);
      // Sem resposta do QS a tempo: a própria rota decide no servidor.
      var url = numero ? paraNumero(original, numero) : paraRota(original);
      if (aba) { try { aba.opener = null; aba.location.href = url; return; } catch (e) {} }
      window.location.href = url;
    });
  }, true);
})();
