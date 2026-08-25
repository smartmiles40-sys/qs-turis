// scripts/gloria-corpus.mjs
// -----------------------------------------------------------------------------
// A VOZ DO TIME, MEDIDA — a régua que decide o prompt da Glória.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// "Ela está parecendo uma IA" é uma reclamação que parece subjetiva e não é.
// Dá para medir: tamanho de mensagem, quantas terminam em pergunta, quantas
// levam emoji, quais frases se repetem em toda conversa que agendou. Foi assim
// que o prompt da Glória parou de ser opinião de quem escreveu e virou cópia do
// que a Yanca, o Victor Hugo e a Mariana fazem de verdade.
//
// O corpus são as conversas COMPLETAS de cada SDR, não só as mensagens que eles
// mandaram. Faz diferença: metade do que ensina está no que veio ANTES da
// resposta — o cliente pedindo preço de cara, o cliente sumindo, o cliente
// pedindo pra remarcar. Sem a pergunta, a resposta não ensina o gatilho.
//
// E o peso vai para quem AGENDOU. Conversa que não virou reunião também entra
// (ensina o que evitar), mas as que terminaram em `qs_meetings` vêm primeiro no
// despejo, porque é delas que os rituais foram tirados.
//
// USO
//   node scripts/gloria-corpus.mjs           # números + fraseário no terminal
//   node scripts/gloria-corpus.mjs --dump    # + conversas inteiras em ./tmp/gloria-corpus/
//
// Lê `.env` (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Só leitura: nada é
// gravado no banco. O resumo do que ele disse em 24/08/2026 está em
// `n8n/GLORIA-VOZ.md`; quando o time mudar de script, rode de novo e atualize lá.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const DUMP = process.argv.includes('--dump');
const SAIDA = path.join(process.cwd(), 'tmp', 'gloria-corpus');

// Conversa só entra no corpus com ida E volta de verdade. Sem isso o corpus
// enche de disparo de template sem resposta, que é justamente o que não ensina
// nada sobre conversar.
const MIN_DE_CADA_LADO = 3;
const MIN_MENSAGENS = 8;
const POR_SDR = 50;

function env() {
  const arq = path.join(process.cwd(), '.env');
  if (!fs.existsSync(arq)) {
    console.error('Sem .env na raiz do repo. Rode de dentro do qs-turis.');
    process.exit(1);
  }
  const out = {};
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    if (!linha.includes('=') || linha.trimStart().startsWith('#')) continue;
    const i = linha.indexOf('=');
    out[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return out;
}

const E = env();
const URL_BASE = E.SUPABASE_URL;
const CHAVE = E.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !CHAVE) {
  console.error('Faltou SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.');
  process.exit(1);
}

async function q(caminho) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` },
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`resposta não-JSON: ${t.slice(0, 200)}`); }
  if (!Array.isArray(j)) throw new Error(`${j.message || t.slice(0, 200)}`);
  return j;
}

const lotes = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** A assinatura (`*Yanca*` na primeira linha) é do QS, não do jeito de escrever. */
const semAssinatura = (t) => String(t || '').replace(/^\*+[^*\n]+\*+\s*\n?/, '').trim();

const TEM_EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿❤]/u;

function percentis(ns) {
  const s = [...ns].sort((a, b) => a - b);
  const em = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { q1: em(0.25), mediana: em(0.5), p90: em(0.9) };
}

async function sdrs() {
  const us = await q('qs_users?select=id,name,role,is_active&role=eq.sdr&is_active=eq.true');
  if (!us.length) throw new Error('nenhum SDR ativo em qs_users');
  return us;
}

/** Tudo o que este SDR já mandou (para a régua de estilo). */
async function enviadas(nome) {
  // sender_name vem do Chatwoot e nem sempre bate com qs_users.name inteiro
  // (aparece "Yanca Manuella Ruivo" e "Yanca"). O primeiro nome é o que casa.
  const primeiro = nome.split(/\s+/)[0];
  const todas = [];
  for (let off = 0; off < 8000; off += 1000) {
    const r = await q(
      `qs_wa_messages?select=content&direction=eq.out` +
      `&sender_name=like.${encodeURIComponent(primeiro + '*')}` +
      `&order=sent_at.desc&limit=1000&offset=${off}`
    );
    todas.push(...r);
    if (r.length < 1000) break;
  }
  return todas.map((m) => semAssinatura(m.content)).filter((t) => t.length > 1);
}

/** As conversas completas mais recentes deste SDR, as que agendaram na frente. */
async function conversas(sdr) {
  const leads = await q(`qs_leads?select=id,full_name,first_name,source,status&owner_id=eq.${sdr.id}&limit=2000`);
  const porId = Object.fromEntries(leads.map((l) => [l.id, l]));
  const ids = leads.map((l) => l.id);

  const threads = [];
  for (const c of lotes(ids, 60)) {
    threads.push(...await q(
      `qs_wa_threads?select=lead_id,last_at&lead_id=in.(${c.join(',')})` +
      `&last_in_at=not.is.null&last_out_at=not.is.null&order=last_at.desc`
    ));
  }
  threads.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  // 160 candidatas para sobrar depois do filtro de "conversa de verdade".
  const cand = threads.slice(0, 160).map((t) => t.lead_id);
  if (!cand.length) return [];

  const msgs = [];
  for (const c of lotes(cand, 12)) {
    msgs.push(...await q(
      `qs_wa_messages?select=lead_id,direction,content,sender_name,sent_at,attachments,transcricao` +
      `&lead_id=in.(${c.join(',')})&order=sent_at.asc&limit=8000`
    ));
  }
  const porLead = {};
  for (const m of msgs) (porLead[m.lead_id] ||= []).push(m);

  const reunioes = await q(`qs_meetings?select=lead_id&lead_id=in.(${cand.join(',')})&limit=500`);
  const agendou = new Set(reunioes.map((r) => r.lead_id));

  return Object.entries(porLead)
    .map(([id, ms]) => ({
      lead: porId[id] || {},
      ms,
      entradas: ms.filter((m) => m.direction === 'in').length,
      saidas: ms.filter((m) => m.direction === 'out').length,
      agendou: agendou.has(id),
      fim: ms[ms.length - 1]?.sent_at,
    }))
    .filter((c) => c.entradas >= MIN_DE_CADA_LADO && c.saidas >= MIN_DE_CADA_LADO && c.ms.length >= MIN_MENSAGENS)
    .sort((a, b) => (b.agendou ? 1 : 0) - (a.agendou ? 1 : 0) || new Date(b.fim) - new Date(a.fim))
    .slice(0, POR_SDR);
}

function transcrever(sdr, cs) {
  let txt = `# ${sdr.name} — ${cs.length} conversas (${cs.filter((c) => c.agendou).length} agendaram)\n`;
  for (const c of cs) {
    const l = c.lead;
    txt += `\n\n===== ${l.full_name || '?'} | fonte ${l.source || '?'} | ${l.status || '?'}` +
           ` | ${c.agendou ? 'AGENDOU' : 'não agendou'} | ${c.ms.length} msgs =====\n`;
    for (const m of c.ms) {
      let t = String(m.content || '').trim();
      if (!t && m.transcricao) t = `[áudio] ${m.transcricao}`;
      if (!t && (m.attachments || []).length) t = '[anexo sem texto]';
      if (!t) continue;
      const quem = m.direction === 'in' ? (l.first_name || 'CLIENTE') : (m.sender_name || sdr.name);
      const hora = new Date(m.sent_at).toISOString().slice(5, 16).replace('T', ' ');
      txt += `[${hora}] ${m.direction === 'in' ? '▼' : '▲'} ${quem}: ${t}\n`;
    }
  }
  return txt;
}

function regua(nome, txt) {
  if (!txt.length) return console.log(`${nome} | sem mensagens`);
  const { q1, mediana, p90 } = percentis(txt.map((t) => t.length));
  const pc = (f) => `${Math.round(100 * txt.filter(f).length / txt.length)}%`;
  console.log(
    `${nome.padEnd(14)} | n=${String(txt.length).padStart(5)}` +
    ` | chars ${q1}/${mediana}/${p90}` +
    ` | emoji ${pc((t) => TEM_EMOJI.test(t)).padStart(4)}` +
    ` | termina em ? ${pc((t) => t.endsWith('?')).padStart(4)}` +
    ` | " ?" ${pc((t) => t.includes(' ?')).padStart(4)}` +
    ` | >300 ${pc((t) => t.length > 300).padStart(4)}`
  );
}

function fraseario(txt) {
  const freq = {};
  for (const t of txt) {
    const k = t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (k.length <= 130) freq[k] = (freq[k] || 0) + 1;
  }
  console.log('\n=== FRASES INTEIRAS MAIS REPETIDAS ===');
  Object.entries(freq).filter(([, v]) => v >= 4).sort((a, b) => b[1] - a[1]).slice(0, 40)
    .forEach(([k, v]) => console.log(String(v).padStart(4), k));

  const emojis = {};
  for (const t of txt) for (const e of (t.match(/[\u{1F300}-\u{1FAFF}☀-➿❤]️?/gu) || [])) {
    emojis[e] = (emojis[e] || 0) + 1;
  }
  console.log('\n=== EMOJIS DA CASA ===');
  console.log(Object.entries(emojis).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([e, v]) => `${e} ${v}`).join('   '));
}

const time = await sdrs();
console.log(`SDRs ativos: ${time.map((s) => s.name).join(', ')}\n`);
console.log('=== A RÉGUA (tamanho em caracteres: q1/mediana/p90) ===');

const tudo = [];
for (const sdr of time) {
  const txt = await enviadas(sdr.name);
  regua(sdr.name, txt);
  tudo.push(...txt);

  if (DUMP) {
    const cs = await conversas(sdr);
    fs.mkdirSync(SAIDA, { recursive: true });
    const arq = path.join(SAIDA, `${sdr.name.replace(/\s+/g, '_')}.txt`);
    fs.writeFileSync(arq, transcrever(sdr, cs), 'utf8');
    console.log(`${''.padEnd(14)} └─ ${cs.length} conversas (${cs.filter((c) => c.agendou).length} agendaram) → ${arq}`);
  }
}

fraseario(tudo);
console.log(`\nTotal medido: ${tudo.length} mensagens enviadas.`);
if (!DUMP) console.log('Para ler as conversas inteiras: node scripts/gloria-corpus.mjs --dump');
