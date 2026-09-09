// QUINTA rodada: o card do Bitrix nasce com os CAMPOS da reuniao preenchidos.
//
// O aviso que o Bitrix manda pro time le CAMPOS do negocio ("Data e hora do
// agendamento (Google Meet)", "Responsavel pela reuniao", "Quem fez o
// agendamento?"), nao o campo de observacoes. O formulario ja mandava a reuniao,
// mas so em texto de gente: faltava a data em ISO (a unica que entra em campo de
// data) e o NOME do SDR (o Bitrix casa "quem agendou" por nome).
//
// Espelha stfv-forms/src/generators/htmlPuro.ts. Republicar pelo painel emite
// exatamente este bloco, entao aplicar aqui NAO cria divergencia.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const TROCAS = [
  ['a fase 2 leva a data de maquina e o SDR',
   `              reuniao_quando: e.data.quando || '',
              reuniao_especialista: e.data.especialista || '',
              reuniao_link: e.data.link || ''`,
   `              reuniao_quando: e.data.quando || '',
              // O mesmo instante em ISO, que e o que entra no campo de data do
              // CRM: o aviso que o Bitrix manda pro time le CAMPOS, e "quinta-
              // feira, 11 de setembro as 18h" nao entra em campo de data.
              reuniao_quando_iso: e.data.quando_iso || '',
              reuniao_especialista: e.data.especialista || '',
              reuniao_sdr: e.data.sdr || '',
              reuniao_link: e.data.link || ''`],
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
  fs.writeFileSync(process.argv[2].replace(/\.html$/, '.p5.html'), html);
  console.log('md5:', crypto.createHash('md5').update(html).digest('hex'));
}
