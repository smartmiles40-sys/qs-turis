// SEGUNDA rodada de patch nos formularios de live (Bruno, 08/09/2026):
// a agenda passa a CONTAR como etapa. "Etapa 1 de 3", "2 de 3", "3 de 3" — a
// pessoa precisa saber na primeira tela que sao tres passos, senao acha que
// terminou no segundo e fecha a aba na hora de marcar.
//
// Espelha o que o gerador (stfv-forms/src/generators/htmlPuro.ts) passou a
// emitir. Se um dos dois mudar sem o outro, a proxima republicacao altera o
// comportamento sem ninguem pedir.
import fs from 'node:fs';
import crypto from 'node:crypto';

// ── (1) O total de passos e o nome do passo da agenda ──────────────────────
export const DE_TOTAL = '  var MOSTRA_ROTULO = true;';
export const PARA_TOTAL = `  var MOSTRA_ROTULO = true;
  var TOTAL_PASSOS = ETAPAS.length + 1;
  var ROTULO_AGENDA = "Escolha o horário";`;

// ── (2) As bolinhas viram funcao, pra agenda usar as MESMAS ────────────────
export const DE_HELPERS = '  function render() {';
export const PARA_HELPERS = `  /**
   * As bolinhas do topo. \`ativo\` e o passo atual (base 0).
   *
   * Vive fora do render() porque a tela do agendamento precisa das MESMAS
   * bolinhas: duplicar a marcacao faria uma divergir da outra no primeiro
   * ajuste, e o sintoma seria o indicador saltando de 2 pra 3 sem motivo.
   */
  function indicador(ativo) {
    if (!MOSTRA_INDICADOR || TOTAL_PASSOS < 2) return '';
    var h = '<div class="stfv-steps">';
    for (var i = 0; i < TOTAL_PASSOS; i++) {
      if (i > 0) h += '<span class="stfv-step-linha"></span>';
      var estado = i === ativo ? ' is-ativo' : (i < ativo ? ' is-passado' : '');
      h += '<span class="stfv-step-dot' + estado + '">' + (i + 1) + '</span>';
    }
    return h + '</div>';
  }

  /** "Etapa 2 de 3 · Confirmacao" — o total conta o agendamento. */
  function rotuloDoPasso(ativo, titulo) {
    if (!MOSTRA_ROTULO) return '';
    var prefixo = TOTAL_PASSOS > 1 ? 'Etapa ' + (ativo + 1) + ' de ' + TOTAL_PASSOS + ' · ' : '';
    return '<p class="stfv-etapa-rotulo">' + esc(prefixo + titulo) + '</p>';
  }

  function render() {`;

// ── (3) O render() passa a chamar as funcoes ───────────────────────────────
export const DE_RENDER = `    if (MOSTRA_INDICADOR && ETAPAS.length > 1) {
      h += '<div class="stfv-steps">';
      ETAPAS.forEach(function (_, i) {
        if (i > 0) h += '<span class="stfv-step-linha"></span>';
        var estado = i === indice ? ' is-ativo' : (i < indice ? ' is-passado' : '');
        h += '<span class="stfv-step-dot' + estado + '">' + (i + 1) + '</span>';
      });
      h += '</div>';
    }

    if (MOSTRA_ROTULO) {
      var prefixo = ETAPAS.length > 1 ? 'Etapa ' + (indice + 1) + ' de ' + ETAPAS.length + ' · ' : '';
      h += '<p class="stfv-etapa-rotulo">' + esc(prefixo + etapa.titulo) + '</p>';
    }`;

export const PARA_RENDER = `    h += indicador(indice);
    h += rotuloDoPasso(indice, etapa.titulo);`;

// ── (4) A tela da agenda acende o ultimo passo ─────────────────────────────
export const DE_AGENDA = `      '<div class="stfv-form">' +
        '<div class="stfv-sucesso" style="padding:1.25rem 0 0.75rem">' +`;

export const PARA_AGENDA = `      '<div class="stfv-form">' +
        // O ultimo passo, aceso. A pessoa ve desde a primeira tela que
        // sao tres — e aqui ve que esta no ultimo, nao numa tela extra.
        indicador(ETAPAS.length) +
        rotuloDoPasso(ETAPAS.length, ROTULO_AGENDA) +
        '<div class="stfv-sucesso" style="padding:1.25rem 0 0.75rem">' +`;

export const TROCAS = [
  ['total de passos', DE_TOTAL, PARA_TOTAL],
  ['funcoes indicador/rotuloDoPasso', DE_HELPERS, PARA_HELPERS],
  ['render usa as funcoes', DE_RENDER, PARA_RENDER],
  ['agenda acende o ultimo passo', DE_AGENDA, PARA_AGENDA],
];

export function aplicar(html) {
  let saida = html;
  for (const [nome, de, para] of TROCAS) {
    const n = saida.split(de).length - 1;
    if (n !== 1) throw new Error(`"${nome}": esperava 1 ocorrencia, achei ${n}`);
    saida = saida.replace(de, para);
  }
  return saida;
}

if (process.argv[2]) {
  const arq = process.argv[2];
  const html = aplicar(fs.readFileSync(arq, 'utf8'));
  fs.writeFileSync(arq.replace(/\.html$/, '.p2.html'), html);
  console.log('md5:', crypto.createHash('md5').update(html).digest('hex'), `(${html.length} bytes)`);
}
