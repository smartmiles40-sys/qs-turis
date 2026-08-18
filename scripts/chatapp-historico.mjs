// scripts/chatapp-historico.mjs
// -----------------------------------------------------------------------------
// TRAZER O HISTÓRICO DO CHATAPP PRA DENTRO DA CONVERSA DO QS.
//
// A API do ChatApp foi reconstruída a partir do nosso próprio código (o cliente
// que vivia em api/_chatapp.js, hoje só no histórico do git) e da doc pública
// deles. Os endpoints de LEITURA que interessam:
//
//   POST /v1/tokens                                          autentica
//   GET  /v1/licenses/{lic}/messengers/{msg}/chats            lista conversas
//   GET  /v1/licenses/{lic}/messengers/{msg}/chats/{id}/messages   histórico
//
// Autenticação: o token vai CRU no header Authorization (sem "Bearer"), e há
// limite de 100 tokens/dia por e-mail+appId — por isso pegamos UM e reusamos.
//
// COMO USAR
//   1) preencha .env.chatapp.local com TRÊS coisas: CHATAPP_EMAIL e
//      CHATAPP_PASSWORD (o login do painel) e CHATAPP_APP_ID (o suporte do
//      ChatApp fornece). O licenseId o script descobre sozinho.
//   2) node scripts/chatapp-historico.mjs --explorar
//        conecta, lista as conversas e MOSTRA o formato real de uma mensagem.
//        Nada é gravado. É o passo que responde "dá pra migrar?" em 1 minuto.
//   3) node scripts/chatapp-historico.mjs --importar        (simulação)
//      node scripts/chatapp-historico.mjs --importar --apply (grava de verdade)
//
// SEGURANÇA: só lê do ChatApp. No QS, grava pelo mesmo caminho das mensagens
// normais (rpc/qs_wa_ingest), que é idempotente — rodar duas vezes não duplica.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const ARGS = new Set(process.argv.slice(2));
const APLICAR = ARGS.has('--apply');
/** --limite=N processa só as N primeiras conversas casadas. Serve pra provar o
 *  mapeamento com dados reais antes de soltar o lote inteiro. */
const LIMITE = (() => {
  const a = [...ARGS].find((x) => x.startsWith('--limite='));
  const n = a ? Number(a.split('=')[1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

function lerEnv(caminho) {
  try {
    const out = {};
    for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch { return {}; }
}

const ca = { ...lerEnv('.env.chatapp.local'), ...lerEnv('.env') };
const qs = lerEnv('.env');
const BASE = (ca.CHATAPP_BASE_URL || 'https://api.chatapp.online').replace(/\/$/, '');
const MESSENGER = ca.CHATAPP_MESSENGER || 'whatsapp';

function exigir(campos) {
  const faltando = campos.filter((c) => !ca[c]);
  if (faltando.length) {
    console.error(`\nFaltam credenciais em .env.chatapp.local: ${faltando.join(', ')}\n`);
    console.error('Onde pegar cada uma:');
    console.error('  CHATAPP_EMAIL / CHATAPP_PASSWORD');
    console.error('     o MESMO login que você usa em cabinet.chatapp.online.');
    console.error('  CHATAPP_APP_ID');
    console.error('     não fica visível no painel — peça ao suporte do ChatApp:');
    console.error('     "preciso do appId da nossa conta para usar a API REST"');
    console.error('     (nossa conta: company_id 56587 / businessId 108329).');
    console.error('  CHATAPP_LICENSE_ID');
    console.error('     NÃO precisa preencher — este script descobre sozinho depois de entrar.\n');
    process.exit(1);
  }
}

// ── ChatApp ─────────────────────────────────────────────────────────────────

let TOKEN = null;

async function chatapp(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = TOKEN;          // token CRU, sem "Bearer"
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  if (!r.ok) {
    const err = new Error(`ChatApp ${r.status} em ${path}: ${String(txt).slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

async function autenticar() {
  exigir(['CHATAPP_EMAIL', 'CHATAPP_PASSWORD', 'CHATAPP_APP_ID']);
  const d = await chatapp('/v1/tokens', {
    method: 'POST',
    body: { email: ca.CHATAPP_EMAIL, password: ca.CHATAPP_PASSWORD, appId: ca.CHATAPP_APP_ID },
  });
  TOKEN = d?.accessToken || d?.token || d?.data?.accessToken;
  if (!TOKEN) throw new Error(`autenticou mas não achei o token na resposta: ${JSON.stringify(d).slice(0, 200)}`);
  return TOKEN;
}

/**
 * Descobre a licença sozinho. O licenseId é o que aparece no meio das URLs da
 * API, e ninguém precisa caçar isso no painel: depois de autenticar, a própria
 * API lista o que a conta tem. Só usa o valor do .env se ele existir.
 */
async function descobrirLicenca() {
  if (ca.CHATAPP_LICENSE_ID) return ca.CHATAPP_LICENSE_ID;
  const d = await chatapp('/v1/licenses');
  const lista = extrairLista(d);
  if (!lista.length) throw new Error('a conta não tem nenhuma licença visível para este usuário');
  const escolhida = lista[0];
  const id = escolhida.licenseId ?? escolhida.id;
  console.log(`  licença descoberta automaticamente: ${id}${escolhida.name ? ` (${escolhida.name})` : ''}`);
  if (lista.length > 1) {
    console.log(`  (há ${lista.length} licenças; usando a primeira — para escolher outra, preencha CHATAPP_LICENSE_ID)`);
    for (const l of lista) console.log(`     • ${l.licenseId ?? l.id} ${l.name ?? ''} ${l.messengers ? `[${(l.messengers||[]).map(m=>m.type??m).join(', ')}]` : ''}`);
  }
  ca.CHATAPP_LICENSE_ID = String(id);
  return ca.CHATAPP_LICENSE_ID;
}

const raiz = () => `/v1/licenses/${ca.CHATAPP_LICENSE_ID}/messengers/${MESSENGER}`;

/** Lista as conversas, paginando por `lastTime` (a doc deles). */
async function listarChats({ maxPaginas = 50, limit = 100 } = {}) {
  await descobrirLicenca();
  const todos = [];
  let lastTime = null;
  for (let i = 0; i < maxPaginas; i++) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (lastTime) q.set('lastTime', String(lastTime));
    const d = await chatapp(`${raiz()}/chats?${q}`);
    const lote = extrairLista(d);
    if (!lote.length) break;
    todos.push(...lote);
    const ultimo = lote[lote.length - 1];
    const t = ultimo?.lastTime ?? ultimo?.updatedAt ?? ultimo?.time;
    if (!t || t === lastTime) break;
    lastTime = t;
    process.stdout.write(`\r  conversas lidas: ${todos.length}`);
  }
  if (todos.length) process.stdout.write('\n');
  return todos;
}

async function listarMensagens(chatId, { maxPaginas = 20 } = {}) {
  // Teto da API: 100 por página (mandar 200 devolve 422). Pagina por `lastTime`,
  // igual à lista de conversas, até esgotar ou bater o teto de segurança.
  const todas = [];
  let lastTime = null;
  for (let i = 0; i < maxPaginas; i++) {
    const q = new URLSearchParams({ limit: '100' });
    if (lastTime) q.set('lastTime', String(lastTime));
    const d = await chatapp(`${raiz()}/chats/${encodeURIComponent(chatId)}/messages?${q}`);
    const lote = extrairLista(d);
    if (!lote.length) break;
    todas.push(...lote);
    const t = lote[lote.length - 1]?.time;
    if (!t || t === lastTime) break;
    lastTime = t;
  }
  return todas;
}

/** A API responde {success, data:{items:[...]}} — mas nem todo endpoint segue. */
function extrairLista(d) {
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data?.items)) return d.data.items;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(d?.data)) return d.data;
  return [];
}

// ── QS ──────────────────────────────────────────────────────────────────────

const SB = qs.SUPABASE_URL;
const SRK = qs.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' };

async function qsGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

// ── Índices carregados UMA vez ──────────────────────────────────────────────
// São 3000 conversas. Consultar o banco por mensagem seriam dezenas de milhares
// de idas — horas de execução. Duas leituras grandes no começo resolvem tudo em
// memória: quem já está no QS (por wamid) e o telefone de cada lead.

const jaNoQs = new Set();      // wamids que o QS já tem
const leadPorFone = new Map(); // 8 últimos dígitos -> { id, full_name }

async function carregarIndices() {
  process.stdout.write('  carregando o que o QS já tem… ');
  let de = 0;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/qs_wa_messages?select=source_id&source_id=not.is.null`, {
      headers: { ...H, Range: `${de}-${de + 999}` },
    });
    const lote = await r.json().catch(() => []);
    if (!Array.isArray(lote) || !lote.length) break;
    for (const m of lote) if (m.source_id) jaNoQs.add(m.source_id);
    if (lote.length < 1000) break;
    de += 1000;
  }
  let d2 = 0;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/qs_leads?select=id,full_name,phone&phone=not.is.null&order=updated_at.desc`, {
      headers: { ...H, Range: `${d2}-${d2 + 999}` },
    });
    const lote = await r.json().catch(() => []);
    if (!Array.isArray(lote) || !lote.length) break;
    for (const l of lote) {
      const d8 = String(l.phone || '').replace(/\D/g, '').slice(-8);
      // O primeiro vence: a busca vem ordenada por atualização, igual ao servidor.
      if (d8.length === 8 && !leadPorFone.has(d8)) leadPorFone.set(d8, { id: l.id, full_name: l.full_name });
    }
    if (lote.length < 1000) break;
    d2 += 1000;
  }
  console.log(`${jaNoQs.size} mensagens já no QS · ${leadPorFone.size} leads com telefone`);
}

function acharLead(telefone) {
  const d8 = String(telefone || '').replace(/\D/g, '').slice(-8);
  return d8.length === 8 ? (leadPorFone.get(d8) || null) : null;
}

/**
 * Id da mensagem no QS. O `cw_message_id` é único e hoje guarda ids do Chatwoot;
 * usar o id do ChatApp cru poderia COLIDIR com um deles e a mensagem antiga
 * sobrescreveria uma nova. Por isso o histórico importado vive numa faixa
 * própria, bem acima do que o Chatwoot gera.
 */
const FAIXA_CHATAPP = 900_000_000_000;
function idNoQs(idOriginal) {
  const s = String(idOriginal ?? '');
  if (/^\d+$/.test(s)) return FAIXA_CHATAPP + Number(s);
  // Id textual: hash estável (djb2) pra manter a idempotência entre execuções.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return FAIXA_CHATAPP + h;
}

/** O wamid: o MESMO id que o Chatwoot guarda em source_id. É ele que evita
 *  reimportar uma mensagem que já entrou no QS pelo caminho normal. */
function wamid(msg) {
  const id = String(msg?.id ?? msg?.internalId ?? '');
  return id.startsWith('wamid.') ? id : null;
}

function jaExiste(msg) {
  const w = wamid(msg);
  return !!w && jaNoQs.has(w);
}

async function gravar({ leadId, chatId, msg }) {
  // O texto mora em message.text (ou na legenda do anexo) — `message` é objeto.
  const texto = String(msg?.message?.text || msg?.message?.caption || '').slice(0, 8000);
  if (!texto.trim()) return { pulou: 'sem-texto' };

  // `time` vem em SEGUNDOS.
  const quando = new Date(Number(msg?.time || 0) * 1000).toISOString();

  const corpo = {
    p_lead: leadId,
    p_conv: null,
    p_msg: idNoQs(msg.id ?? msg.internalId),
    // side é "in"/"out"; fromMe confirma. Mensagem nossa = out.
    p_direction: (msg?.side === 'out' || msg?.fromMe === true) ? 'out' : 'in',
    p_content: texto,
    p_attachments: [],
    p_sender: msg?.fromUser?.name ?? null,
    p_sent_at: quando,
    p_contact: null,
    p_can_reply: null,
    p_inbox: null,
    p_source: wamid(msg),      // permite casar com o que já veio do Chatwoot
    p_status: null,
    p_reply_to: null,
    p_reply_prev: null,
  };
  if (!APLICAR) return { simulado: true };
  const r = await fetch(`${SB}/rest/v1/rpc/qs_wa_ingest`, { method: 'POST', headers: H, body: JSON.stringify(corpo) });
  const t = await r.text();
  if (!r.ok) return { erro: `${r.status} ${t.slice(0, 120)}` };
  return { novo: t === 'true' };
}

// ── Rotina ──────────────────────────────────────────────────────────────────

async function explorar() {
  console.log(`Conectando em ${BASE} …`);
  await autenticar();
  console.log('✓ autenticado\n');
  const chats = await listarChats({ maxPaginas: 2 });
  console.log(`✓ ${chats.length} conversas na amostra`);
  if (!chats.length) return;
  console.log('\nFORMATO DE UMA CONVERSA (campos):');
  console.log('  ' + Object.keys(chats[0]).join(', '));
  console.log('\n' + JSON.stringify(chats[0], null, 1).slice(0, 700));
  const primeiro = chats[0];
  const chatId = primeiro.chatId ?? primeiro.id;
  const msgs = await listarMensagens(chatId, { limit: 5 });
  console.log(`\n✓ ${msgs.length} mensagens na conversa ${chatId}`);
  if (msgs.length) {
    console.log('\nFORMATO DE UMA MENSAGEM (campos):');
    console.log('  ' + Object.keys(msgs[0]).join(', '));
    console.log('\n' + JSON.stringify(msgs[0], null, 1).slice(0, 700));
  }
  console.log('\n→ Com esses dois formatos eu ajusto o mapeamento e rodo a importação.');
}

async function importar() {
  if (!SB || !SRK) { console.error('faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env'); process.exit(1); }
  await autenticar();
  await carregarIndices();
  const chats = await listarChats();
  console.log(`${chats.length} conversas no ChatApp\n`);

  let comLead = 0, semLead = 0, gravadas = 0, novas = 0, erros = 0, repetidas = 0;
  for (const c of chats) {
    const chatId = c.chatId ?? c.id;
    const telefone = c.phone ?? c.chatId ?? c.contactPhone ?? '';
    const lead = acharLead(telefone);
    if (!lead) { semLead++; continue; }
    if (LIMITE && comLead >= LIMITE) break;
    comLead++;
    let msgs = [];
    try { msgs = await listarMensagens(chatId); }
    catch (e) { erros++; console.warn(`  erro ao ler ${chatId}: ${e.message}`); continue; }
    for (const m of msgs) {
      if (jaExiste(m)) { repetidas++; continue; }
      const r = await gravar({ leadId: lead.id, chatId, msg: m });
      if (r.erro) { erros++; console.warn(`  ${r.erro}`); }
      else if (r.novo) { novas++; gravadas++; const w = wamid(m); if (w) jaNoQs.add(w); }
      else if (!r.pulou) gravadas++;
    }
    process.stdout.write(`\r  ${comLead} conversas casadas · ${gravadas} mensagens · ${novas} novas`);
  }
  console.log(`\n\n${APLICAR ? 'IMPORTADO' : 'SIMULAÇÃO (use --apply para gravar)'}`);
  console.log(`  conversas com lead no QS: ${comLead}`);
  console.log(`  conversas sem lead:       ${semLead}`);
  console.log(`  mensagens processadas:    ${gravadas} (${novas} novas)`);
  console.log(`  ja estavam no QS:         ${repetidas}`);
  console.log(`  erros:                    ${erros}`);
}

try {
  if (ARGS.has('--explorar')) await explorar();
  else if (ARGS.has('--importar')) await importar();
  else {
    console.log('uso:');
    console.log('  node scripts/chatapp-historico.mjs --explorar             vê o formato, não grava');
    console.log('  node scripts/chatapp-historico.mjs --importar             simula a importação');
    console.log('  node scripts/chatapp-historico.mjs --importar --apply     grava no QS');
  }
} catch (e) {
  console.error('\nFALHOU:', e.message);
  process.exit(1);
}
