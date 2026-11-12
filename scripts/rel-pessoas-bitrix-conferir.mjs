// scripts/rel-pessoas-bitrix-conferir.mjs
// -----------------------------------------------------------------------------
// Pessoas do QS (rel_clientes) × contato no Bitrix — revisão 12/11/2026 (0366).
//
//   CRON_SECRET=... node scripts/rel-pessoas-bitrix-conferir.mjs            (SIMULAÇÃO: só lê)
//   CRON_SECRET=... node scripts/rel-pessoas-bitrix-conferir.mjs --enviar   (1 rodada real, até 10 pessoas)
//
// SIMULAÇÃO é o padrão: GET /api/rel-bitrix-comentarios?acao=pessoas-conferir,
// paginado (30 por chamada) até o fim da fila. Pra cada pessoa diz o que faria:
// VINCULARIA a um contato que já existe (por CPF, ou telefone/e-mail com o
// mesmo nome), CRIARIA um contato novo, SEM DADOS (só o nome) ou AMBÍGUO.
// Nada é escrito no Bitrix nem no QS.
//
// ⚠️ --enviar ESCREVE no Bitrix (cria/liga contatos) e só funciona com
// REL_PESSOA_BITRIX_LIGADO=1 na Vercel. Repita até a fila zerar.
//
// --url=https://...  muda o endereço (padrão: QS_URL ou https://qs-turis.vercel.app)
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
const enviar = args.includes('--enviar');
const url = (args.find((a) => a.startsWith('--url='))?.slice(6) || process.env.QS_URL || 'https://qs-turis.vercel.app').replace(/\/$/, '');
const segredo = String(process.env.CRON_SECRET || '').trim();
if (!segredo) {
  console.error('Falta CRON_SECRET no ambiente (o mesmo da Vercel).');
  process.exit(1);
}

async function chamar(acao) {
  const r = await fetch(`${url}/api/rel-bitrix-comentarios?acao=${acao}`, { headers: { Authorization: `Bearer ${segredo}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`HTTP ${r.status}:`, j.error || j);
    process.exit(1);
  }
  return j;
}

if (enviar) {
  console.log('Rodada enviada:', JSON.stringify(await chamar('pessoas-enviar'), null, 2));
  process.exit(0);
}

const itens = [];
let pular = 0;
let total = null;
for (let volta = 0; volta < 60 && pular !== null; volta++) {
  const j = await chamar(`pessoas-conferir&pular=${pular}`);
  itens.push(...(j.itens || []));
  total = j.total ?? total;
  console.error(`  … ${itens.length}${total != null ? ` de ${total}` : ''} conferidas`);
  pular = j.proximo ?? null;
}

const grupos = [
  ['VINCULARIA a contato existente', itens.filter((i) => i.acao === 'vincular'), (i) => `contato ${i.contatoId} (por ${i.por})`],
  ['CRIARIA contato novo', itens.filter((i) => i.acao === 'criar'), () => ''],
  ['SEM DADOS (só o nome — completar o cadastro)', itens.filter((i) => i.acao === 'sem_dados'), () => ''],
  ['AMBÍGUO (escolher na ficha)', itens.filter((i) => i.acao === 'ambiguo'), (i) => i.motivo || ''],
  ['ERRO ao consultar', itens.filter((i) => i.acao === 'erro'), (i) => i.motivo || ''],
  ['JÁ OK / FORA', itens.filter((i) => i.acao === 'nada'), (i) => i.motivo || ''],
];
console.log(`\nSIMULAÇÃO — nada foi enviado. ${itens.length} pessoas conferidas${total != null ? ` (fila: ${total})` : ''}.`);
for (const [titulo, lista] of grupos) console.log(`  ${titulo}: ${lista.length}`);
console.log('');
for (const [titulo, lista, det] of grupos) {
  if (!lista.length) continue;
  console.log(`── ${titulo} (${lista.length})`);
  for (const i of lista) console.log(`  ${String(i.nome || '—').slice(0, 34).padEnd(34)} ${det(i)}`);
  console.log('');
}
