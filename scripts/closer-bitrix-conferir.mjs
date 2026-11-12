// scripts/closer-bitrix-conferir.mjs
// -----------------------------------------------------------------------------
// Pipeline do closer × Bitrix: o que está pendente e o que o QS vai mandar.
//
//   CRON_SECRET=... node scripts/closer-bitrix-conferir.mjs            (SECO: só lê)
//   CRON_SECRET=... node scripts/closer-bitrix-conferir.mjs --todos    (todo cartão aberto)
//   CRON_SECRET=... node scripts/closer-bitrix-conferir.mjs --enviar   (roda 1 rodada do cron)
//
// SECO é o padrão: chama GET /api/closer?acao=conferir-bitrix, que lê cada card
// no Bitrix (crm.deal.get) e responde de → pra onde, sem escrever nada.
// --enviar chama a MESMA rodada que o Vercel Cron faz a cada 10 min (até 25
// cartões por vez, com as travas de api/_closerBitrixPlano.js). Repita até zerar.
//
// ⚠️ --enviar ESCREVE no Bitrix e só funciona com CLOSER_CRON_BITRIX_LIGADO=1 na
// Vercel (sem ela a rota responde { pulado } e nada é enviado).
// 12/11: o SECO é paginado (60 por chamada); o script repete até o fim.
//
// --url=https://...  muda o endereço (padrão: QS_URL ou https://qs-turis.vercel.app)
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
const enviar = args.includes('--enviar');
const todos = args.includes('--todos');
const url = (args.find((a) => a.startsWith('--url='))?.slice(6) || process.env.QS_URL || 'https://qs-turis.vercel.app').replace(/\/$/, '');
const segredo = String(process.env.CRON_SECRET || '').trim();
if (!segredo) {
  console.error('Falta CRON_SECRET no ambiente (o mesmo da Vercel).');
  process.exit(1);
}

async function chamar(acao) {
  const r = await fetch(`${url}/api/closer?acao=${acao}`, { headers: { Authorization: `Bearer ${segredo}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`HTTP ${r.status}:`, j.error || j);
    process.exit(1);
  }
  return j;
}

if (enviar) {
  console.log('Rodada enviada:', await chamar('cron-bitrix'));
  process.exit(0);
}

// 12/11: paginado — repete com &pular= até a rota devolver proximo = null.
const itens = [];
let pular = 0;
let total = null;
for (let volta = 0; volta < 50 && pular !== null; volta++) {
  const j = await chamar(`conferir-bitrix${todos ? '&escopo=todos' : ''}&pular=${pular}`);
  itens.push(...(j.itens || []));
  total = j.resumo?.total ?? total;
  console.error(`  … ${itens.length}${total != null ? ` de ${total}` : ''} conferidos`);
  pular = j.proximo ?? null;
}
const resumo = {
  conferidos: itens.length,
  enviaria: itens.filter((i) => i.envia).length,
  jaIgual: itens.filter((i) => i.ok && !i.envia).length,
  bloqueados: itens.filter((i) => !i.ok).length,
};
console.log(`\nMODO SECO — nada foi enviado. ${resumo.conferidos} conferidos${total != null ? ` (fila: ${total})` : ''}.`);
console.log(`  enviaria: ${resumo.enviaria}   já igual: ${resumo.jaIgual}   não mexe: ${resumo.bloqueados}\n`);
const linha = (i) => `${String(i.dealId || '—').padEnd(6)} ${String(i.cliente || '—').slice(0, 28).padEnd(28)} ${String(i.closer || '—').slice(0, 16).padEnd(16)} ${String(i.etapaQs).padEnd(20)}`;
const grupos = [
  ['ENVIARIA', itens.filter((i) => i.envia), (i) => `${i.de?.nome || '?'} → ${i.para?.nome || '?'}${i.para?.funil !== i.de?.funil ? ` (funil ${i.de?.funil} → ${i.para?.funil})` : ''}${i.campos?.OPPORTUNITY ? ` · valor ${i.campos.OPPORTUNITY}` : ''}${i.campos?.UF_CRM_1744663824797 || i.campos?.UF_CRM_1789683835018 ? ' · motivo' : ''}${i.campos?.ASSIGNED_BY_ID ? ' · responsável' : ''}`],
  ['JÁ IGUAL', itens.filter((i) => i.ok && !i.envia), (i) => i.de?.nome || ''],
  ['NÃO MEXE', itens.filter((i) => !i.ok), (i) => i.motivo || ''],
];
for (const [titulo, lista, det] of grupos) {
  if (!lista.length) continue;
  console.log(`── ${titulo} (${lista.length})`);
  for (const i of lista) console.log(`  ${linha(i)} ${det(i)}`);
  console.log('');
}
