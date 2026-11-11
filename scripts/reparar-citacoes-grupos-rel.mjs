// scripts/reparar-citacoes-grupos-rel.mjs
// -----------------------------------------------------------------------------
// Devolve a CITAÇÃO às respostas em texto dos grupos do Relacionamento que
// entraram sem ela (11/11 — a Evolution põe o contextInfo de um texto só no topo
// do evento e a entrada procurava dentro da mensagem; ver api/_relGruposLer.js).
//
// Lê na Evolution (SÓ LEITURA, nada é enviado) as mensagens de grupo dos últimos
// N dias e, pra cada uma que TEM citação lá e está com responde_a vazio no banco,
// preenche responde_a / citado_texto / citado_autor. Não mexe em mais nada e
// pode rodar de novo (só toca linha com responde_a vazio).
//
// Uso: node scripts/reparar-citacoes-grupos-rel.mjs [--dias=30] [--seco]
// Precisa: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env) e
//          EVOLUTION_URL + EVOLUTION_APIKEY (+ REL_GRUPOS_INSTANCIA) no ambiente.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import { citacaoDoGrupo } from '../api/_relGruposLer.js';

try {
  for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch { /* sem .env: usa o ambiente */ }

const SECO = process.argv.includes('--seco');
const DIAS = Number((process.argv.find((a) => a.startsWith('--dias=')) || '--dias=30').split('=')[1]) || 30;
const SB = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVO = String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const EK = process.env.EVOLUTION_APIKEY;
const INST = process.env.REL_GRUPOS_INSTANCIA || 'relacionamento-grupos-4183';
if (!SB || !SK || !EVO || !EK) throw new Error('Faltam variáveis (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_URL, EVOLUTION_APIKEY).');

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function evo(path, body) {
  const r = await fetch(`${EVO}${path}`, {
    method: 'POST',
    headers: { apikey: EK, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Evolution ${path}: ${r.status}`);
  return r.json();
}

const desde = Date.now() / 1000 - DIAS * 86400;
const conta = { lidas: 0, grupo: 0, comCitacao: 0, semLinha: 0, jaTinha: 0, reparadas: 0, erros: 0 };

for (let page = 1; page <= 400; page++) {
  const r = (await evo(`/chat/findMessages/${encodeURIComponent(INST)}`, { where: {}, page, offset: 200 }))?.messages || {};
  const recs = r.records || [];
  if (!recs.length) break;
  for (const d of recs) {
    conta.lidas++;
    const jid = String(d?.key?.remoteJid || '');
    if (!jid.endsWith('@g.us') || !d?.key?.id || !(Number(d.messageTimestamp) >= desde)) continue;
    conta.grupo++;
    const cit = citacaoDoGrupo(d);
    if (!cit.responde_a) continue;
    conta.comCitacao++;
    const linha = (await rest(`rel_wa_grupo_mensagens?select=id,responde_a&msg_id=eq.${encodeURIComponent(d.key.id)}&limit=1`))?.[0];
    if (!linha) { conta.semLinha++; continue; }
    if (linha.responde_a) { conta.jaTinha++; continue; }
    if (SECO) { conta.reparadas++; continue; }
    try {
      await rest(`rel_wa_grupo_mensagens?id=eq.${linha.id}&responde_a=is.null`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { responde_a: cit.responde_a, citado_texto: cit.citado_texto, citado_autor: cit.citado_autor },
      });
      conta.reparadas++;
    } catch (e) {
      conta.erros++;
      console.warn('erro', d.key.id, e.message);
    }
  }
  const minTs = Math.min(...recs.map((x) => Number(x.messageTimestamp) || Infinity));
  if (minTs < desde || page >= (r.pages || page)) break;
}

console.log(SECO ? '[seco] nada gravado.' : 'Feito.', conta);
