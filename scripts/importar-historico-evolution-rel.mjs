// scripts/importar-historico-evolution-rel.mjs
// -----------------------------------------------------------------------------
// Importa o histórico que a Evolution recebeu do celular do Relacionamento
// (instância só de grupos, 0137) para o QS — SÓ LEITURA, nada é enviado.
//
//   • grupos  → rel_wa_grupos + rel_wa_grupo_mensagens (lista completa dos grupos)
//   • pessoas → rel_wa_mensagens via rel_wa_ingest com origem 'historico'
//               (não mexe em prazo/SLA). Só mensagens ANTERIORES à ligação do
//               número na API oficial (COEX): depois disso elas já chegam pela
//               Meta, e o id é outro — importaria repetido.
//
// Mídia antiga entra como rótulo ("📷 imagem"…), como no histórico do COEX.
// Pode rodar de novo: tudo é idempotente (msg_id / wamid "evo:<id>").
//
// Uso: node scripts/importar-historico-evolution-rel.mjs [--seco]
// Precisa: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env do qs-turis) e
//          EVOLUTION_URL + EVOLUTION_APIKEY no ambiente.
// -----------------------------------------------------------------------------
import fs from 'node:fs';

for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const SECO = process.argv.includes('--seco');
const SB = process.env.SUPABASE_URL.replace(/\/+$/, '');
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVO = String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const EK = process.env.EVOLUTION_APIKEY;
const INST = 'relacionamento-grupos-4183';
if (!SB || !SK || !EVO || !EK) throw new Error('Faltam variáveis (SUPABASE_*, EVOLUTION_*).');

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
    method: body ? 'POST' : 'GET',
    headers: { apikey: EK, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Evolution ${path}: ${r.status}`);
  return r.json();
}

const ROTULO = { imagem: '📷 imagem', video: '🎬 vídeo', audio: '🎤 áudio', figurinha: '🏷️ figurinha', arquivo: '📎 arquivo' };
function lerConteudo(m) {
  if (!m || typeof m !== 'object' || m.reactionMessage || m.protocolMessage) return null;
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { tipo: 'imagem', texto: m.imageMessage.caption || '' };
  if (m.videoMessage) return { tipo: 'video', texto: m.videoMessage.caption || '' };
  if (m.audioMessage) return { tipo: 'audio', texto: '' };
  if (m.stickerMessage) return { tipo: 'figurinha', texto: '' };
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) return { tipo: 'arquivo', texto: doc.caption || '', nome: doc.fileName || null };
  const enq = m.pollCreationMessage || m.pollCreationMessageV3;
  if (enq) return { tipo: 'enquete', texto: `📊 ${enq.name || 'Enquete'}` };
  if (m.locationMessage) return { tipo: 'local', texto: '📍 localização' };
  if (m.contactMessage) return { tipo: 'contato', texto: `👤 ${m.contactMessage.displayName || 'contato'}` };
  return null;
}
const textoFinal = (c) => {
  const rot = ROTULO[c.tipo];
  if (!rot) return c.texto;
  return c.texto ? `${rot}\n${c.texto}` : rot;
};

// ── O número do Relacionamento e o corte do COEX ──
const num = (await rest('qs_wa_numeros_meta?select=phone_number_id,conectado_em,criado_em&setor=eq.relacionamento&status=eq.conectado&order=conectado_em.desc&limit=1'))?.[0];
if (!num) throw new Error('Número do Relacionamento não encontrado.');
const CORTE = new Date(Math.min(new Date(num.criado_em).getTime(), new Date(num.conectado_em).getTime()));
console.log('Número', num.phone_number_id, '| conversas com pessoas só antes de', CORTE.toISOString());

// ── 1. Lista completa dos grupos ──
const grupos = (await evo(`/group/fetchAllGroups/${INST}?getParticipants=false`)).filter((g) => /@g\.us$/.test(g?.id || ''));
console.log('Grupos no número:', grupos.length);
if (!SECO) {
  for (let i = 0; i < grupos.length; i += 100) {
    await rest('rel_wa_grupos?on_conflict=jid', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: grupos.slice(i, i + 100).map((g) => ({ jid: g.id, nome: g.subject ?? null, descricao: g.desc ?? null, participantes: g.size ?? null, saiu_em: null, atualizado_em: new Date().toISOString() })),
    });
  }
}
const conhecidos = new Set(grupos.map((g) => g.id));

// ── 2. Todas as mensagens guardadas na Evolution ──
const todas = [];
for (let page = 1; ; page++) {
  const r = (await evo(`/chat/findMessages/${INST}`, { page, offset: 500 })).messages;
  todas.push(...(r.records || []));
  if (page >= (r.pages || 1)) break;
}
console.log('Mensagens na Evolution:', todas.length);

const conta = { grupo: 0, grupoIgnorada: 0, pessoa: 0, pessoaDepoisDoCorte: 0, pessoaSemTelefone: 0, ignorada: 0 };
const msgsGrupo = [];
const ultimas = new Map();

for (const x of todas) {
  const k = x.key || {};
  const jid = String(k.remoteJid || '');
  const c = lerConteudo(x.message);
  if (!c || !k.id) { conta.ignorada++; continue; }
  const ts = Number(x.messageTimestamp);
  const quando = new Date((Number.isFinite(ts) && ts > 0 ? ts : Date.now() / 1000) * 1000);
  const texto = textoFinal(c);

  if (jid.endsWith('@g.us')) {
    if (!conhecidos.has(jid)) { conta.grupoIgnorada++; continue; }
    msgsGrupo.push({
      grupo_jid: jid, msg_id: k.id, de_mim: Boolean(k.fromMe),
      autor_jid: k.participantAlt || k.participant || null,
      autor_nome: k.fromMe ? null : (x.pushName || null),
      tipo: c.tipo, texto, anexo_nome: c.nome || null, criado_em: quando.toISOString(),
    });
    const u = ultimas.get(jid);
    if (!u || u.quando < quando) ultimas.set(jid, { quando, previa: texto.slice(0, 140) });
    conta.grupo++;
    continue;
  }

  // Pessoa: só @s.whatsapp.net (ou @lid com o telefone ao lado). Status/canal fora.
  let fone = null;
  if (jid.endsWith('@s.whatsapp.net')) fone = jid.split('@')[0].split(':')[0];
  else if (jid.endsWith('@lid')) {
    const alt = String(k.remoteJidAlt || k.senderPn || '');
    if (alt.endsWith('@s.whatsapp.net')) fone = alt.split('@')[0].split(':')[0];
    else { conta.pessoaSemTelefone++; continue; }
  } else { conta.ignorada++; continue; }
  if (quando >= CORTE) { conta.pessoaDepoisDoCorte++; continue; }
  if (!SECO) {
    await rest('rpc/rel_wa_ingest', {
      method: 'POST',
      body: {
        p_phone_id: num.phone_number_id, p_telefone: fone,
        p_nome: k.fromMe ? null : (x.pushName || null),
        p_wamid: `evo:${k.id}`, p_direcao: k.fromMe ? 'out' : 'in', p_origem: 'historico',
        p_texto: texto, p_anexos: [], p_enviada_em: quando.toISOString(),
        p_autor_nome: k.fromMe ? 'Celular do Relacionamento' : null,
      },
    });
  }
  conta.pessoa++;
}

if (!SECO) {
  for (let i = 0; i < msgsGrupo.length; i += 200) {
    await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: msgsGrupo.slice(i, i + 200) });
  }
  for (const [jid, u] of ultimas) {
    await rest(`rel_wa_grupos?jid=eq.${encodeURIComponent(jid)}&or=(ultima_msg_em.is.null,ultima_msg_em.lt.${encodeURIComponent(u.quando.toISOString())})`, {
      method: 'PATCH', prefer: 'return=minimal', body: { ultima_msg_em: u.quando.toISOString(), ultima_msg: u.previa },
    });
  }
}
console.log(SECO ? '[SECO — nada gravado]' : 'Gravado.', conta);
