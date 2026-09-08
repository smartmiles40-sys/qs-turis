// Transforma os formulários de live: em vez de despejar a pessoa no WhatsApp,
// mostra o autoagendamento do QS logo abaixo da confirmação.
//
// As substituições são as MESMAS pros 7 slugs (o código gerado é idêntico; só
// as strings da live mudam), então elas viram um UPDATE com replace() encadeado
// no Supabase — a receita que já foi usada pra republicar sem senha.
//
// Uso:  node patch.mjs <arquivo.html>   -> escreve <arquivo>.novo.html
import fs from 'node:fs';
import crypto from 'node:crypto';

// ── (1) O texto da confirmação. O antigo prometia WhatsApp. ────────────────
export const DE_TEXTO = 'var MSG_TEXTO = "Nosso time entra em contato em breve pelo WhatsApp.";';
export const PARA_TEXTO = 'var MSG_TEXTO = "Falta um passo: escolha o melhor dia e horário para conversar com um especialista.";';

// ── (2) A função nova, enfiada logo antes do concluir() ────────────────────
export const DE_FUNCAO = '  function concluir(respostas) {';
export const PARA_FUNCAO = `  // ==== AUTOAGENDAMENTO (QS) ============================================
  // Antes daqui a pessoa era jogada no wa.me. Trocado em 08/09/2026: o numero
  // unico do time estava sendo derrubado pelo volume, e mandar todo mundo pra
  // uma conversa que ninguem responde perde a reuniao que ja estava ganha.
  // Agora ela escolhe o horario na hora, e a reuniao nasce no QS com
  // especialista, sala do Meet e o card do Bitrix atualizado.
  var QS_ORIGEM = 'https://qs-turis.vercel.app';

  function renderAgendamento(respostas) {
    var url = QS_ORIGEM + '/agendar/?embed=1&expedicao=' +
      encodeURIComponent(CAMPOS_FIXOS.expedicao || '');

    raiz.innerHTML =
      '<div class="stfv-form">' +
        '<div class="stfv-sucesso" style="padding:1.25rem 0 0.75rem">' +
          '<h3>' + esc(MSG_TITULO) + '</h3>' +
          '<p>' + esc(MSG_TEXTO) + '</p>' +
        '</div>' +
        '<iframe id="stfv-agenda" title="Escolha o dia e o horario" loading="eager" ' +
          'style="width:100%;border:0;display:block;min-height:520px"></iframe>' +
      '</div>';

    var quadro = document.getElementById('stfv-agenda');

    window.addEventListener('message', function (e) {
      if (e.origin !== QS_ORIGEM || !e.data || typeof e.data !== 'object') return;

      // O iframe avisa quando esta pronto; so entao os dados vao. Sem esse
      // aperto de mao, a mensagem sai antes de existir quem a escute.
      if (e.data.tipo === 'qs-agendar:pronto') {
        quadro.contentWindow.postMessage({
          tipo: 'qs-agendar:preencher',
          nome: respostas.nome || '',
          email: respostas.email || '',
          telefone: respostas.whatsapp || '',
          expedicao: CAMPOS_FIXOS.expedicao || '',
          origem: CAMPOS_FIXOS.fonte || '',
          // O negocio no Bitrix JA foi criado pelo /api/save-lead acima. Sem
          // este aviso o QS abriria um segundo card da mesma pessoa.
          ja_no_bitrix: true
        }, QS_ORIGEM);
      }

      // O iframe nao sabe a propria altura pra quem esta de fora.
      if (e.data.tipo === 'qs-agendar:altura' && e.data.altura) {
        quadro.style.height = e.data.altura + 'px';
      }

      if (e.data.tipo === 'qs-agendar:concluido') {
        pushDataLayer('reuniao_agendada', { form_name: FORM_NAME, destino: SLUG });
      }
    });

    // src depois do listener: iframe em cache dispara o 'pronto' rapido demais.
    quadro.src = url;
  }

  function concluir(respostas) {`;

// ── (3) O corpo do concluir: sai o redirect, entra a agenda ────────────────
export const DE_CORPO = `    sessionStorage.removeItem(LEAD_ID_KEY);
    var saida = destinoDoLead(respostas);
    var url = saida.url;
    if (saida.whatsapp) {
      var msg = WHATSAPP_MSG.replace(/\\{(\\w+)\\}/g, function (_m, chave) {
        return String(respostas[chave] == null ? '' : respostas[chave]).trim();
      });
      try {
        sessionStorage.setItem('stfv_wa_msg', msg);
        sessionStorage.removeItem('stfv_wa_redirecionado');
      } catch (e) {}
      // Indo direto pro WhatsApp a mensagem tem que ir na URL: o sessionStorage
      // so e lido quando existe uma pagina de obrigado nossa no meio.
      if (/wa\\.me|api\\.whatsapp\\.com/.test(url))
        url += (url.indexOf('?') === -1 ? '?' : '&') + 'text=' + encodeURIComponent(msg);
    }
    if (APOS_ENVIO === 'redirect') window.location.href = url;
    else renderSucesso();`;

export const PARA_CORPO = `    sessionStorage.removeItem(LEAD_ID_KEY);
    renderAgendamento(respostas);`;

export const TROCAS = [
  ['texto da confirmacao', DE_TEXTO, PARA_TEXTO],
  ['funcao renderAgendamento', DE_FUNCAO, PARA_FUNCAO],
  ['corpo do concluir', DE_CORPO, PARA_CORPO],
];

export function aplicar(html) {
  let saida = html;
  const relatorio = [];
  for (const [nome, de, para] of TROCAS) {
    const ocorrencias = saida.split(de).length - 1;
    if (ocorrencias !== 1) {
      throw new Error(`"${nome}": esperava 1 ocorrencia, achei ${ocorrencias} — NAO aplicado`);
    }
    saida = saida.replace(de, para);
    relatorio.push(nome);
  }
  if (/wa\.me/.test(saida)) {
    // REDIRECT_URL fica declarada mas nao e mais usada; o que nao pode sobrar e
    // um caminho que ainda LEVE pro WhatsApp.
    const usos = saida.split('wa.me').length - 1;
    relatorio.push(`atencao: ainda ha ${usos} mencao(oes) a wa.me (esperado: 1, so a constante morta)`);
  }
  return { html: saida, relatorio };
}

if (process.argv[2]) {
  const arq = process.argv[2];
  const original = fs.readFileSync(arq, 'utf8');
  const { html, relatorio } = aplicar(original);
  const destino = arq.replace(/\.html$/, '.novo.html');
  fs.writeFileSync(destino, html);
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  console.log('trocas aplicadas:', relatorio.join(' | '));
  console.log('md5 antes:', md5(original), `(${original.length} bytes)`);
  console.log('md5 depois:', md5(html), `(${html.length} bytes)`);
  console.log('escrito em:', destino);
}
