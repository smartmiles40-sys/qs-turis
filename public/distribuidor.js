/*
 * distribuidor.js — o botão "Falar no WhatsApp" das páginas vira FORMULÁRIO.
 *
 * (Bruno, 29/09/2026: "estamos tendo muitos problemas com separação de lead dos
 *  SDRs, então para acabar com o problema, vamos deixar tudo com as automações
 *  do QS de distribuição")
 *
 * Até aqui este script trocava o número do link pelo WhatsApp do SDR da vez —
 * a PÁGINA escolhia o SDR, e a escolha nem sempre batia com o dono do card no
 * QS. Agora nenhuma página escolhe ninguém: o clique abre um formulário curto
 * (nome, WhatsApp, e-mail), o lead entra no QS por /api/lead-site e a
 * distribuição do QS decide o dono — o mesmo que vira responsável no Bitrix.
 *
 * COMO USAR: uma linha antes do </body> (as páginas antigas já têm):
 *   <script src="https://qs-turis.vercel.app/distribuidor.js" defer></script>
 *
 * Links reconhecidos: a rota do QS (/api/whatsapp) e o número antigo (1935).
 * Grupo da comunidade, Instagram e outros WhatsApp passam intocados.
 * Sem este script, o link cai em /api/whatsapp, que mostra o mesmo formulário.
 *
 * window.stfvAbrirFormulario({ destino, canal, fixo }) abre o formulário à mão.
 */
(function () {
  if (window.__stfvDistribuidor) return;
  window.__stfvDistribuidor = true;

  var QS = 'https://qs-turis.vercel.app';
  var ROTA = QS + '/api/whatsapp';
  var API = QS + '/api/lead-site';
  var LEGADOS = ['5511951251935', '551151251935'];

  // ── De onde é esta página ────────────────────────────────────────────────
  var DESTINOS = [
    [/atacama/i, 'Atacama'],
    [/canc[uú]n|xcaret/i, 'Cancún + Xcaret'],
    [/patag[oô]nia[- ]austral|austral/i, 'Patagônia Austral'],
    [/patag[oô]nia[- ]chilena|chilena/i, 'Patagônia Chilena'],
    [/peru[- ]cl[aá]ssico/i, 'Peru Clássico'],
  ];
  function detectar(url, titulo) {
    var u;
    try { u = new URL(url); } catch (e) { u = location; }
    var host = u.hostname || '';
    // Subdomínio de campanha (lpsN/stfvN) e a LP dos influenciadores = tráfego.
    var canal = /^(lps|stfv)\d*\./i.test(host) || /influenciador/i.test(host) ? 'Tráfego' : 'Orgânico';
    var alvo = (u.pathname || '') + ' ' + (titulo || '');
    var destino = null;
    for (var i = 0; i < DESTINOS.length; i++) if (DESTINOS[i][0].test(alvo)) { destino = DESTINOS[i][1]; break; }
    if (!destino) destino = /influenciador/i.test(host) ? 'Influenciadores' : ((u.pathname || '/') === '/' ? 'Portal' : 'Site');
    return { destino: destino, canal: canal };
  }

  // ── Os links que são nossos ──────────────────────────────────────────────
  function ehNosso(href) {
    if (!href) return false;
    var h = String(href);
    if (h.indexOf(ROTA) === 0) return true;
    for (var i = 0; i < LEGADOS.length; i++) {
      var n = LEGADOS[i];
      if (h.indexOf('wa.me/' + n) !== -1) return true;
      if (h.indexOf('whatsapp.com/send') !== -1 && h.indexOf('phone=' + n) !== -1) return true;
    }
    return false;
  }
  // Botão do meio / nova aba / toque longo: o link aponta pra página de
  // formulário do QS, nunca pra um número.
  function paraRota(a) {
    var d = detectar(location.href, document.title);
    a.href = ROTA + '?d=' + encodeURIComponent(d.destino) + '&c=' + encodeURIComponent(d.canal);
  }
  function limpar(raiz) {
    var links = raiz && raiz.querySelectorAll ? raiz.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i++) if (ehNosso(links[i].href)) paraRota(links[i]);
  }

  // ── O formulário ─────────────────────────────────────────────────────────
  var CSS =
    '.stfvf-fundo{position:fixed;inset:0;z-index:2147483000;background:rgba(9,40,43,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '@media(min-width:640px){.stfvf-fundo{align-items:center}}' +
    '.stfvf-caixa{position:relative;width:100%;max-width:440px;background:#fff;color:#09282B;border-radius:24px;padding:32px 24px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25)}' +
    '.stfvf-caixa h2{margin:0 0 6px;font-size:22px;font-weight:800;letter-spacing:-.01em}' +
    '.stfvf-caixa p{margin:0 0 20px;color:rgba(9,40,43,.7);line-height:1.5;font-size:15px}' +
    '.stfvf-caixa label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}' +
    '.stfvf-caixa input{box-sizing:border-box;width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1.5px solid rgba(9,40,43,.18);border-radius:12px;margin:0 0 14px;color:#09282B;background:#fff}' +
    '.stfvf-caixa input:focus{outline:none;border-color:#09282B}' +
    '.stfvf-btn{width:100%;border:0;cursor:pointer;background:#D7F264;color:#09282B;font:inherit;font-weight:700;font-size:16px;padding:15px;border-radius:999px;margin-top:4px}' +
    '.stfvf-btn:disabled{opacity:.6;cursor:wait}' +
    '.stfvf-fechar{position:absolute;top:10px;right:12px;border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:rgba(9,40,43,.5);padding:6px}' +
    '.stfvf-caixa .stfvf-erro{color:#B42318;font-size:14px;margin:0 0 10px;min-height:1em}' +
    '.stfvf-ok{text-align:center}.stfvf-ok .stfvf-check{width:64px;height:64px;border-radius:50%;background:#D7F264;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:30px}' +
    '.stfvf-armadilha{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0}';

  function el(tag, attrs, filhos) {
    var e = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    }
    (filhos || []).forEach(function (f) { e.appendChild(f); });
    return e;
  }
  function mascara(v) {
    var d = String(v).replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function evento(nome, dados) {
    try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: nome, form_name: 'formulario-rapido' }, dados || {})); } catch (e) {}
  }

  var aberto = null;
  function abrir(opts) {
    opts = opts || {};
    if (aberto) return;
    if (!document.getElementById('stfvf-css')) {
      var st = el('style', { id: 'stfvf-css' }); st.textContent = CSS; document.head.appendChild(st);
    }
    // Na página de formulário do QS, quem diz o destino é a página de origem.
    var info = opts.origemUrl ? detectar(opts.origemUrl, '') : detectar(location.href, document.title);
    var destino = opts.destino || info.destino;
    var canal = opts.canal || info.canal;

    var nome = el('input', { id: 'stfvf-nome', name: 'nome', autocomplete: 'name', required: 'required' });
    var tel = el('input', { id: 'stfvf-tel', name: 'telefone', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', placeholder: '(11) 99999-9999', required: 'required' });
    var email = el('input', { id: 'stfvf-email', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'opcional' });
    var armadilha = el('input', { name: 'site', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'stfvf-armadilha' });
    var erro = el('p', { class: 'stfvf-erro', role: 'alert' });
    var btn = el('button', { type: 'submit', class: 'stfvf-btn', text: 'Quero ser chamado no WhatsApp' });
    tel.addEventListener('input', function () { tel.value = mascara(tel.value); erro.textContent = ''; });
    nome.addEventListener('input', function () { erro.textContent = ''; });

    var form = el('form', { novalidate: 'novalidate' }, [
      el('h2', { id: 'stfvf-titulo', text: 'Fale com nosso time' }),
      el('p', { text: 'Deixe seu nome e WhatsApp — um especialista te chama em seguida.' }),
      el('label', { for: 'stfvf-nome', text: 'Nome' }), nome,
      el('label', { for: 'stfvf-tel', text: 'WhatsApp com DDD' }), tel,
      el('label', { for: 'stfvf-email', text: 'E-mail' }), email,
      armadilha, erro, btn,
    ]);
    var caixa = el('div', { class: 'stfvf-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'stfvf-titulo' }, [form]);
    var fundo = el('div', { class: 'stfvf-fundo' }, [caixa]);

    function fechar() {
      if (!aberto) return;
      document.removeEventListener('keydown', teclas);
      fundo.parentNode && fundo.parentNode.removeChild(fundo);
      aberto = null;
    }
    function teclas(e) { if (e.key === 'Escape' && !opts.fixo) fechar(); }
    if (!opts.fixo) {
      var x = el('button', { type: 'button', class: 'stfvf-fechar', 'aria-label': 'Fechar', text: '×' });
      x.addEventListener('click', fechar);
      caixa.insertBefore(x, form);
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(); });
    }
    document.addEventListener('keydown', teclas);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      erro.textContent = '';
      var digitos = tel.value.replace(/\D/g, '');
      if (!nome.value.trim()) { erro.textContent = 'Informe seu nome.'; nome.focus(); return; }
      if (digitos.length < 10 || digitos.length > 11) { erro.textContent = 'Informe o WhatsApp com DDD.'; tel.focus(); return; }
      btn.disabled = true; btn.textContent = 'Enviando…';
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.value.trim(), telefone: '55' + digitos, email: email.value.trim(),
          destino: destino, canal: canal, site: armadilha.value,
          origem: String(opts.origemUrl || (location.hostname + location.pathname)).slice(0, 80),
        }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok, d: d }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error((r.d && r.d.error) || 'falhou');
          evento('form_submit', { destino: destino, canal: canal });
          evento('lead_conversion', { destino: destino, value: 1 });
          while (caixa.firstChild) caixa.removeChild(caixa.firstChild);
          caixa.appendChild(el('div', { class: 'stfvf-ok' }, [
            el('div', { class: 'stfvf-check', text: '✓' }),
            el('h2', { id: 'stfvf-titulo', text: 'Recebemos seus dados!' }),
            el('p', { text: 'Nosso time vai te chamar no WhatsApp em breve. Fica de olho no celular!' }),
          ]));
          if (!opts.fixo) {
            var ok = el('button', { type: 'button', class: 'stfvf-btn', text: 'Fechar' });
            ok.addEventListener('click', fechar);
            caixa.appendChild(ok);
          }
        })
        .catch(function (ex) {
          btn.disabled = false; btn.textContent = 'Quero ser chamado no WhatsApp';
          erro.textContent = ex && ex.message && ex.message !== 'falhou' && ex.message !== 'Failed to fetch'
            ? ex.message : 'Não conseguimos enviar agora. Tente de novo em instantes.';
        });
    });

    document.body.appendChild(fundo);
    aberto = fundo;
    setTimeout(function () { nome.focus(); }, 30);
  }
  window.stfvAbrirFormulario = abrir;

  // ── Ligar nas páginas ────────────────────────────────────────────────────
  limpar(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { limpar(document); });
  if (window.MutationObserver) {
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'attributes') { if (m.target.href && ehNosso(m.target.href) && m.target.href.indexOf(ROTA) !== 0) paraRota(m.target); }
        else for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'A' && ehNosso(n.href) && n.href.indexOf(ROTA) !== 0) paraRota(n);
          limpar(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !ehNosso(a.href)) return;
    ev.preventDefault();
    abrir();
  }, true);
})();
