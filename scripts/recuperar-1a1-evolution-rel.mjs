// scripts/recuperar-1a1-evolution-rel.mjs
// -----------------------------------------------------------------------------
// RECUPERA as conversas 1:1 do número do Relacionamento que a Evolution recebeu
// e o QS não tem (30/10/2026). Em 29/10 a Meta entregou, o banco não respondeu e
// 4 mensagens de clientes se perderam — uma era o Rafael respondendo no privado o
// grupo "Expedição Tailândia - G1 2026".
//
// SÓ LEITURA na Evolution (findMessages + baixar mídia). Nada é enviado.
// Grava pela mesma função do webhook (api/_relGruposPrivado.js → rel_wa_ingest,
// wamid "evo:<id>"), então é idempotente: rodar de novo não duplica, e o que a
// Meta já entregou é reconhecido pelo id do WhatsApp dentro do wamid.
//
// Uso:
//   node scripts/recuperar-1a1-evolution-rel.mjs                 → seco (padrão)
//   node scripts/recuperar-1a1-evolution-rel.mjs --seco          → seco
//   node scripts/recuperar-1a1-evolution-rel.mjs --gravar        → GRAVA (precisa do ok do Bruno)
//   --desde=2026-10-29T00:00:00-03:00   (padrão: 29/10 00:00 BRT)
//   --ate=…                             (padrão: agora − 2 min)
// Precisa: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env) e EVOLUTION_URL +
// EVOLUTION_APIKEY (ou o WorkFlows/whatsapp-times/.env: EVOLUTION_DOMAIN +
// AUTHENTICATION_API_KEY).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
function lerEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const l of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
lerEnv(path.join(aqui, '..', '.env'));
lerEnv(path.join(aqui, '..', '..', 'WorkFlows', 'whatsapp-times', '.env'));
if (!process.env.EVOLUTION_URL && process.env.EVOLUTION_DOMAIN) process.env.EVOLUTION_URL = `https://${process.env.EVOLUTION_DOMAIN}`;
if (!process.env.EVOLUTION_APIKEY && process.env.AUTHENTICATION_API_KEY) process.env.EVOLUTION_APIKEY = process.env.AUTHENTICATION_API_KEY;
for (const v of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'EVOLUTION_URL', 'EVOLUTION_APIKEY']) {
  if (!process.env[v]) throw new Error(`Falta ${v} no ambiente.`);
}

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const GRAVAR = process.argv.includes('--gravar') && !process.argv.includes('--seco');
const desde = new Date(arg('desde') || '2026-10-29T00:00:00-03:00');
const ate = arg('ate') ? new Date(arg('ate')) : new Date(Date.now() - 2 * 60_000);

const { varrerPrivado } = await import(pathToFileURL(path.join(aqui, '..', 'api', '_relGruposPrivado.js')).href);

console.log(`${GRAVAR ? 'GRAVANDO' : 'SECO (nada é gravado)'} — 1:1 da Evolution de ${desde.toISOString()} a ${ate.toISOString()}`);
const { conta, achadas } = await varrerPrivado({
  desde, ate, seco: !GRAVAR, baixar: GRAVAR, prazo: Date.now() + 15 * 60_000, maxPaginas: 200,
});
const fmt = (a) => `${a.quando} ${a.deMim ? 'SAIU  ' : 'CHEGOU'} ${String(a.telefone || 'sem número').padEnd(14)} ${String(a.nome || '').padEnd(18).slice(0, 18)} [${a.r}] ${JSON.stringify(a.texto)}${a.grupo ? `  ↩ grupo ${a.grupo}` : ''}  (${a.id})`;
for (const a of achadas.sort((x, y) => String(x.quando).localeCompare(String(y.quando)))) console.log(fmt(a));
console.log('\nResumo:', JSON.stringify(conta));
console.log(GRAVAR ? 'Feito.' : `Seriam gravadas: ${(conta.gravada || 0) + (conta['sem-numero-guardada'] || 0)} · completadas (grupo citado): ${conta.enriquecida || 0} · já no QS: ${conta.repetida || 0}`);
