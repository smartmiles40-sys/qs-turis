// QUARTA rodada: o negocio no Bitrix so nasce quando a pessoa AGENDA.
// Espelha stfv-forms/src/generators/htmlPuro.ts (commit 68617be).
import fs from 'node:fs';
import crypto from 'node:crypto';

export const TROCAS = [
  ['renderAgendamento recebe o payload',
   '  function renderAgendamento(respostas, jaNoBitrix) {',
   '  function renderAgendamento(respostas, jaNoBitrix, payload) {'],

  ['concluir repassa o payload',
   `  function concluir(respostas, salvou) {
    sessionStorage.removeItem(LEAD_ID_KEY);
    renderAgendamento(respostas, salvou === true);
  }`,
   `  function concluir(respostas, salvou, payload) {
    sessionStorage.removeItem(LEAD_ID_KEY);
    renderAgendamento(respostas, salvou === true, payload);
  }`],

  ['o fim do funil abre o negocio',
   `      if (e.data.tipo === 'qs-agendar:concluido') {
        pushDataLayer('reuniao_agendada', { form_name: FORM_NAME, destino: SLUG });
      }`,
   `      if (e.data.tipo === 'qs-agendar:concluido') {
        pushDataLayer('reuniao_agendada', { form_name: FORM_NAME, destino: SLUG });
        // AGORA o lead vai pro Bitrix. Antes daqui ele so ficou guardado:
        // o negocio nasce quando a pessoa TERMINA o funil, nao quando ela
        // digita o nome. Nasce ja no funil comercial, na coluna de reuniao,
        // e ja dizendo o horario, o especialista e o link da sala.
        //
        // keepalive: a pessoa costuma fechar a aba assim que ve o "marcado".
        // Sem isso o navegador cancelaria o envio no meio e a reuniao
        // existiria no QS sem card no CRM.
        try {
          fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify(Object.assign({}, payload || {}, {
              agendado: true,
              reuniao_quando: e.data.quando || '',
              reuniao_especialista: e.data.especialista || '',
              reuniao_link: e.data.link || ''
            }))
          });
        } catch (err) { /* o QS ja tem a reuniao; o card entra pela lista de espera */ }
      }`],

  ['sucesso leva o payload',
   '        var fim = function () { if (navegou) return; navegou = true; concluir(montado.respostas, true); };',
   '        var fim = function () { if (navegou) return; navegou = true; concluir(montado.respostas, true, montado.payload); };'],

  ['falha leva o payload',
   '          concluir(montado.respostas, false);',
   '          concluir(montado.respostas, false, montado.payload);'],
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
  const html = aplicar(fs.readFileSync(process.argv[2], 'utf8'));
  fs.writeFileSync(process.argv[2].replace(/\.html$/, '.p4.html'), html);
  console.log('md5:', crypto.createHash('md5').update(html).digest('hex'));
}
