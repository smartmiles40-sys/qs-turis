// SEXTA rodada nos formularios publicados. Duas coisas:
//
//  1. CAMPO-ARMADILHA (honeypot). Os formularios nao tinham trava nenhuma contra
//     robo — a pagina de agendamento tem desde o primeiro dia, o formulario nao.
//     Robo de formulario preenche todo campo que encontra; o servidor descarta o
//     envio que vier com ele preenchido e responde como se tivesse dado certo.
//
//  2. O CRACHA do agendamento (`reuniao_vinculo`). E com ele que o /api/save-lead
//     conta ao QS qual e o numero do card criado no Bitrix. Sem isso
//     `qs_leads.bitrix_id` fica nulo e desfecho, no-show, SAL e movimento de
//     coluna nunca voltam pro card — medido em 09/09: 17 das 18 reunioes vindas
//     do formulario estavam assim.
//
// Espelha stfv-forms/src/generators/htmlPuro.ts. Conferido: o bloco que este
// script escreve e IDENTICO ao que o gerador emite hoje.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const TROCAS = [
  ['o campo-armadilha, fora do raiz',
   `  var raiz = document.getElementById('stfv-form');
`,
   `  var raiz = document.getElementById('stfv-form');

  // CAMPO-ARMADILHA. Gente nao ve (fora da tela, fora da ordem de tabulacao,
  // escondido de leitor de tela); robo de formulario preenche tudo o que
  // encontra. O servidor descarta o envio que vier com ele preenchido, e
  // responde como se tivesse dado certo — dizer "peguei voce" so ensina qual
  // campo entregou o robo.
  //
  // Vive FORA do raiz de proposito: o render() reescreve o raiz a cada etapa,
  // e o campo tem que sobreviver as tres.
  var armadilha = document.createElement('input');
  armadilha.type = 'text';
  armadilha.name = 'site';
  armadilha.tabIndex = -1;
  armadilha.autocomplete = 'off';
  armadilha.setAttribute('aria-hidden', 'true');
  armadilha.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;opacity:0';
  document.body.appendChild(armadilha);
`],

  ['a armadilha vai no payload',
   `    payload.formulario_completo = true;
`,
   `    payload.formulario_completo = true;
    payload.site = armadilha.value || '';
`],

  ['a fase 2 leva o cracha do agendamento',
   `              reuniao_link: e.data.link || ''`,
   `              reuniao_link: e.data.link || '',
              // Cracha assinado pelo servidor do QS. Passa por aqui sem ser
              // lido: e com ele que o backend diz ao QS qual e o numero do
              // card, sem o navegador nunca ter na mao um id de lead.
              reuniao_vinculo: e.data.vinculo || ''`],
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
  fs.writeFileSync(process.argv[2].replace(/\.html$/, '.p6.html'), html);
  console.log('md5:', crypto.createHash('md5').update(html).digest('hex'));
}
