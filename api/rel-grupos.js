// api/rel-grupos.js
// -----------------------------------------------------------------------------
// GRUPOS DO WHATSAPP NO RELACIONAMENTO (0137, 15/10/2026).
//
// O número do Relacionamento está na API oficial pelo COEX, e a Meta não
// entrega grupos por ali. Os grupos vêm por uma segunda ligação, pela Evolution
// (QR, instância REL_GRUPOS_INSTANCIA). REGRA DO BRUNO, sem exceção: por essa
// ligação SÓ existem grupos. Por isso:
//   • a entrada joga fora, antes de gravar qualquer coisa, tudo que não é @g.us;
//   • o envio só aceita endereço de grupo que JÁ está em rel_wa_grupos, e é a
//     única função do QS que manda mensagem pela Evolution (enviarNoGrupo).
//
//   POST /api/rel-grupos?secret=…        → webhook da Evolution (sem login)
//   GET  /api/rel-grupos?estado=1        → a ligação está de pé?
//   POST { acao: 'sincronizar' }         → puxa a lista de grupos da Evolution
//   POST { acao: 'texto', jid, texto }   → manda texto NO GRUPO (assinado)
//   30/10 (V2): conversa com PESSOA que chega por aqui não é mais jogada fora —
//   é GRAVADA (só gravada) na conversa da Cloud API como cópia de reserva
//   (api/_relGruposPrivado.js). Envio pra pessoa continua impossível por aqui.
//   28/10 (0219): o miolo (evo, travas) foi pra api/_relGruposEvo.js, a lista/
//   participantes pra api/_relGruposSync.js e as ações novas (info do grupo,
//   participantes, convite, encaminhar, vínculo com a viagem, agendadas) pra
//   api/_relGruposMais.js. Lista completa das ações: docs/REL-GRUPOS.md.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { guardarMidia } from './_waMidia.js';
import { quemChama } from './_relWa.js';
import { INSTANCIA, evo, ehGrupo, safeParse, grupoLiberado, chaveDe, meusIds, assinatura, gravarMsg } from './_relGruposEvo.js';
import { atualizarGrupos, gravarParticipantes, sincronizarGrupos, rodizioInfo } from './_relGruposSync.js';
import { acaoMais, enviarAgendadas, agendadasLigadas } from './_relGruposMais.js';
import { gravarPrivado, varrerPrivado } from './_relGruposPrivado.js';
import { lerConteudoGrupo, citacaoDoGrupo, textoDaCitada, desembrulhar } from './_relGruposLer.js';

export { sincronizarGrupos };

const MAX_TEXTO = 4000;
const MAX_MIDIA = 8 * 1024 * 1024;

/** Citação no formato da Evolution (quoted). */
const citacaoDe = (citada) => (citada ? { quoted: { key: chaveDe(citada), message: { conversation: citada.texto || '' } } } : {});

/** A mensagem citada (só do mesmo grupo). */
async function citadaDe(id, jid) {
  const limpo = String(id || '').replace(/[^0-9a-f-]/gi, '');
  if (limpo.length !== 36) return null;
  return (await rest(`rel_wa_grupo_mensagens?select=*&id=eq.${limpo}&grupo_jid=eq.${encodeURIComponent(jid)}&limit=1`).catch(() => []))?.[0] || null;
}
const camposCitacao = (citada) => (citada ? { responde_a: citada.msg_id, citado_texto: String(citada.texto || '').slice(0, 300), citado_autor: citada.de_mim ? 'eu' : citada.autor_jid } : {});

async function enviarNoGrupo(jid, texto, { citada = null, mencoes = [], todos = false } = {}) {
  await grupoLiberado(jid);
  const body = { number: jid, text: texto, ...citacaoDe(citada) };
  // @todos: a Evolution marca todo mundo do grupo (menção escondida, igual ao "@todos" do WhatsApp)
  if (todos) { body.mentionsEveryOne = true; body.everyOne = true; }
  else if (mencoes.length) body.mentioned = mencoes;
  return evo(`/message/sendText/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body });
}

// ── Entrada ──────────────────────────────────────────────────────────────────

// lerConteudo / contexto / citação: api/_relGruposLer.js (11/11 — a citação de
// TEXTO vem no topo do evento, data.contextInfo; ver o comentário de lá).

const ROTULO = { imagem: '📷 imagem', video: '🎬 vídeo', audio: '🎤 áudio', figurinha: '🏷️ figurinha', arquivo: '📎 arquivo' };

async function baixarMidia(msgId) {
  try {
    const r = await evo(`/chat/getBase64FromMediaMessage/${encodeURIComponent(INSTANCIA())}`, {
      method: 'POST', body: { message: { key: { id: msgId } }, convertToMp4: false }, timeoutMs: 20000,
    });
    if (!r?.base64) return null;
    const bytes = Buffer.from(r.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_MIDIA) return null;
    return await guardarMidia(bytes, r.mimetype, { leadId: 'rel-grupos', nomeArquivo: r.fileName });
  } catch (e) {
    console.warn('[rel-grupos] mídia:', e?.message);
    return null;
  }
}

/** Garante a linha do grupo (o webhook pode trazer mensagem de grupo novo). */
async function garantirGrupo(jid, nome) {
  const ja = (await rest(`rel_wa_grupos?select=jid,nome&jid=eq.${encodeURIComponent(jid)}&limit=1`))?.[0];
  if (ja) return;
  let info = null;
  try { info = await evo(`/group/findGroupInfos/${encodeURIComponent(INSTANCIA())}?groupJid=${encodeURIComponent(jid)}`); } catch { /* fica sem nome */ }
  await rest('rel_wa_grupos?on_conflict=jid', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: { jid, nome: info?.subject || nome || null, descricao: info?.desc || null, participantes: info?.size ?? null },
  });
}

/** Quem a mensagem marcou com @ (contextInfo.mentionedJid de qualquer tipo de mensagem). */
function mencoesDe(m) {
  const out = new Set();
  const visitar = (o, prof = 0) => {
    if (!o || typeof o !== 'object' || prof > 4) return;
    if (Array.isArray(o.mentionedJid)) o.mentionedJid.forEach((j) => out.add(String(j)));
    for (const v of Object.values(o)) if (v && typeof v === 'object') visitar(v, prof + 1);
  };
  visitar(m);
  return out;
}

const textoDe = (m) => textoDaCitada(m);

/** Reação nova/trocada/retirada na mensagem alvo (reações ficam numa lista por pessoa). */
async function aplicarReacao(alvoId, de, nome, emoji) {
  const m = (await rest(`rel_wa_grupo_mensagens?select=id,reacoes&msg_id=eq.${encodeURIComponent(alvoId)}&limit=1`))?.[0];
  if (!m) return;
  const lista = (Array.isArray(m.reacoes) ? m.reacoes : []).filter((r) => r.de !== de);
  if (emoji) lista.push({ de, nome: nome || null, emoji });
  await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { reacoes: lista } });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Conversa com pessoa (1:1). A Meta costuma entregar a mesma mensagem em 1–3 s:
 * espera um pouco pra cópia oficial chegar primeiro (aí aqui só reconhece). Se o
 * banco falhar, não derruba o webhook — a varredura do cron (5 min) pega depois,
 * porque a mensagem continua guardada na Evolution.
 */
async function gravarPessoa(d) {
  try {
    await espera(d?.key?.fromMe ? 8000 : 5000);
    return (await gravarPrivado(d)).r;
  } catch (e) {
    console.error('[rel-grupos] 1:1 não gravada agora (a varredura tenta de novo):', d?.key?.id, e?.message);
    return 'pendente';
  }
}

async function gravarMensagem(d) {
  const key = d?.key || {};
  const jid = key.remoteJid;
  if (!ehGrupo(jid)) return gravarPessoa(d); // pessoa: só GRAVA (cópia de reserva da Cloud API)
  const bruta = d.message || {};
  const msg = desembrulhar(bruta);
  // reação de alguém (ou do celular do número)
  if (msg.reactionMessage) {
    const r = msg.reactionMessage;
    const de = key.fromMe ? 'eu' : (key.participantAlt || key.participant || 'alguém');
    await aplicarReacao(r.key?.id, de, key.fromMe ? 'Você' : d.pushName, r.text || '');
    return 'reacao';
  }
  // apagou para todos / editou
  const proto = msg.protocolMessage || msg.editedMessage?.message?.protocolMessage;
  if (proto?.key?.id) {
    if (proto.type === 0 || proto.type === 'REVOKE') {
      await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(proto.key.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { apagada_em: new Date().toISOString() } });
      return 'apagada';
    }
    const novo = textoDe(proto.editedMessage);
    if (novo) {
      await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(proto.key.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { texto: novo, editada_em: new Date().toISOString() } });
      return 'editada';
    }
    return 'ignorada';
  }
  const c = lerConteudoGrupo(bruta);
  if (!c || !key.id) return 'ignorada';
  const cit = citacaoDoGrupo(d);

  await garantirGrupo(jid);
  const ja = (await rest(`rel_wa_grupo_mensagens?select=id&msg_id=eq.${encodeURIComponent(key.id)}&limit=1`))?.[0];
  if (ja) return 'repetida';

  const anexo = c.midia ? await baixarMidia(key.id) : null;
  const texto = c.texto || (c.midia && !anexo ? ROTULO[c.tipo] : '') || '';
  const ts = Number(d.messageTimestamp);
  const quando = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: {
      grupo_jid: jid, msg_id: key.id, de_mim: Boolean(key.fromMe),
      autor_jid: key.participantAlt || key.participant || null,
      autor_participante: key.participant || null,
      autor_nome: key.fromMe ? null : (d.pushName || null),
      tipo: c.tipo, texto, anexo_url: anexo, anexo_nome: c.nome || null, criado_em: quando,
      ...cit,
    },
  });
  const previa = (texto || ROTULO[c.tipo] || '').slice(0, 140);
  // não lidas + "@" (0142): mensagem nossa zera; dos outros soma e vê se marcou o número
  const meus = await meusIds(key);
  const marcados = [...new Set([...mencoesDe(d.message), ...mencoesDe(d.contextInfo ? { contextInfo: d.contextInfo } : null), ...cit.mencoes])];
  const digitos = [...meus].map((x) => x.split('@')[0]);
  const mencionou = !key.fromMe && (marcados.some((m) => meus.has(m) || digitos.includes(m.split('@')[0]))
    || digitos.some((n) => n && texto.includes(`@${n}`)));
  await rest('rpc/rel_wa_grupo_nova_msg', {
    method: 'POST',
    body: { p_jid: jid, p_quando: quando, p_previa: previa, p_de_mim: Boolean(key.fromMe), p_mencionou: mencionou },
  });
  return 'gravada';
}

// status do Baileys (como a Evolution manda) → o nosso; e de que status cada um pode vir
const STATUS_EVO = { SERVER_ACK: 'enviada', DELIVERY_ACK: 'entregue', READ: 'lida', PLAYED: 'lida', ERROR: 'erro' };
const ANTES_DE = { enviada: [], entregue: ['enviada'], lida: ['enviada', 'entregue'], erro: ['enviada'] };

async function webhook(req, res) {
  if (!segredoConfere(req.query?.secret, process.env.REL_GRUPOS_SECRET)) {
    return res.status(401).json({ error: 'segredo' });
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  // Só a instância dos grupos. Qualquer outra que aponte pra cá é ignorada.
  if (body.instance && body.instance !== INSTANCIA()) return res.status(200).json({ ok: true, ignorado: 'instancia' });
  const evento = String(body.event || '').toLowerCase().replace(/_/g, '.');
  try {
    if (evento === 'messages.upsert') {
      const itens = Array.isArray(body.data) ? body.data : [body.data];
      const r = [];
      for (const d of itens) r.push(await gravarMensagem(d));
      return res.status(200).json({ ok: true, r });
    }
    // Queda/volta da ligação: fica registrada pra medir se ela aguenta (0138).
    if (evento === 'connection.update') {
      const estado = String(body.data?.state || '');
      if (estado && estado !== 'connecting') {
        await rest('rel_wa_grupos_conexao', {
          method: 'POST', prefer: 'return=minimal',
          body: { estado, motivo: body.data?.statusReason != null ? String(body.data.statusReason) : null },
        });
      }
      return res.status(200).json({ ok: true });
    }
    if (evento === 'groups.upsert' || evento === 'groups.update') {
      await atualizarGrupos(body.data);
      return res.status(200).json({ ok: true });
    }
    // ✓ / ✓✓ / azul das mensagens do número (0219). Só sobe de nível, nunca desce.
    if (evento === 'messages.update') {
      const itens = Array.isArray(body.data) ? body.data : [body.data];
      for (const d of itens) {
        const jid = d?.remoteJid || d?.key?.remoteJid;
        const id = d?.keyId || d?.key?.id;
        const deMim = d?.fromMe ?? d?.key?.fromMe;
        const st = STATUS_EVO[String(d?.status || '').toUpperCase()];
        if (!ehGrupo(jid) || !deMim || !id || !st || !ANTES_DE[st]?.length) continue;
        await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(id)}&or=(status.is.null,status.in.(${ANTES_DE[st].join(',')}))`, { method: 'PATCH', prefer: 'return=minimal', body: { status: st } }).catch(() => null);
      }
      return res.status(200).json({ ok: true });
    }
    // alguém apagou mensagem pra todos (0144) — também chega como protocolMessage no upsert
    if (evento === "messages.delete") {
      const d = Array.isArray(body.data) ? body.data[0] : body.data;
      const id = d?.key?.id || d?.id || d?.keyId;
      if (id) await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=minimal", body: { apagada_em: new Date().toISOString() } }).catch(() => null);
      return res.status(200).json({ ok: true });
    }
    // entrou/saiu gente do grupo (0143)
    if (evento === 'group.participants.update' || evento === 'group-participants.update') {
      const d = body.data || {};
      const jid = String(d.id || d.groupJid || '');
      if (ehGrupo(jid)) {
        const lista = Array.isArray(d.participants) ? d.participants : [];
        if (d.action === 'remove') {
          for (const p of lista) await rest(`rel_wa_grupo_participantes?grupo_jid=eq.${encodeURIComponent(jid)}&participante=eq.${encodeURIComponent(String(p?.id || p))}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
        } else if (d.action === 'add' || d.action === 'promote' || d.action === 'demote') {
          await garantirGrupo(jid);
          await gravarParticipantes(jid, lista.map((p) => (typeof p === 'object' ? { ...p, admin: d.action === 'promote' ? 'admin' : d.action === 'demote' ? null : p.admin } : p)), new Date().toISOString());
        }
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ ok: true, ignorado: evento });
  } catch (e) {
    console.error('[rel-grupos] webhook:', e?.message);
    return res.status(500).json({ error: 'falhou' });
  }
}

/** Foto no grupo — também só aceita grupo já conhecido. */
async function enviarImagemNoGrupo(jid, base64, mime, caption, fileName, mediatype = 'image', citada = null) {
  await grupoLiberado(jid);
  return evo(`/message/sendMedia/${encodeURIComponent(INSTANCIA())}`, {
    // `base64` pode ser a URL do arquivo no nosso storage (a Evolution aceita os dois)
    method: 'POST', timeoutMs: /^https:/.test(base64) ? 55000 : 30000,
    body: { number: jid, mediatype, mimetype: mime, ...(caption ? { caption } : {}), media: base64, fileName, ...citacaoDe(citada) },
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query?.secret !== undefined) return webhook(req, res);

  if (req.method === 'GET' && req.query?.cron) {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    // 28/10: não chama mais fetchAllGroups (estourava os 60 s). Primeiro as agendadas
    // (têm hora marcada), depois o rodízio de poucos grupos. Tudo dentro de ~45 s.
    const prazo = Date.now() + 45_000;
    try {
      const a = await enviarAgendadas({ prazo: Date.now() + 25_000 });
      const r = await rodizioInfo({ quantos: 4, prazo });
      // Rede de segurança do 1:1 (30/10): o que a Evolution recebeu nas últimas
      // 3 h e não está no banco entra agora (Meta falhou / banco não respondeu).
      // Monitor (0138): a Evolution só avisa quando VOLTA ("open"); a queda quase
      // nunca chega pelo webhook. O cron confere o estado e anota quando muda.
      try {
        const st = await evo(`/instance/connectionState/${encodeURIComponent(INSTANCIA())}`, { timeoutMs: 8000 });
        const estado = String(st?.instance?.state || st?.state || 'desconhecido');
        const ult = (await rest('rel_wa_grupos_conexao?select=estado&order=em.desc&limit=1').catch(() => null))?.[0];
        if (estado !== 'connecting' && ult?.estado !== estado) {
          await rest('rel_wa_grupos_conexao', { method: 'POST', prefer: 'return=minimal', body: { estado, motivo: 'cron' } });
        }
      } catch (e) {
        console.warn('[rel-grupos] estado da Evolution:', e?.message);
        const ult = (await rest('rel_wa_grupos_conexao?select=estado&order=em.desc&limit=1').catch(() => null))?.[0];
        if (ult?.estado !== 'sem-resposta') await rest('rel_wa_grupos_conexao', { method: 'POST', prefer: 'return=minimal', body: { estado: 'sem-resposta', motivo: String(e?.message || '').slice(0, 120) } }).catch(() => null);
      }
      let privado = null;
      try {
        const v = await varrerPrivado({ desde: new Date(Date.now() - 3 * 3600_000), prazo: Date.now() + 40_000, maxPaginas: 5 });
        privado = v.conta;
        if (v.achadas.length) console.warn(`[rel-grupos] varredura 1:1 recuperou ${v.achadas.length}: ${JSON.stringify(v.achadas).slice(0, 800)}`);
      } catch (e) { console.error('[rel-grupos] varredura 1:1:', e?.message); }
      console.log(`[rel-grupos] cron: ${JSON.stringify({ ...a, ...r, privado })}`);
      return res.status(200).json({ ...a, ...r, privado });
    } catch (e) { console.error('[rel-grupos] cron:', e?.message); return res.status(502).json({ error: 'falhou' }); }
  }

  const u = await quemChama(req); // Relacionamento ou admin — o Financeiro não usa grupos
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });

  if (req.method === 'GET') {
    if (req.query?.estado) {
      try {
        const r = await evo(`/instance/connectionState/${encodeURIComponent(INSTANCIA())}`);
        const estado = String(r?.instance?.state || r?.state || 'desconhecido');
        return res.status(200).json({ conectado: estado === 'open', estado, agendadas: agendadasLigadas() });
      } catch (e) {
        return res.status(200).json({ conectado: false, estado: 'erro', erro: String(e?.message || '').slice(0, 160), agendadas: agendadasLigadas() });
      }
    }
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  if (acao === 'sincronizar') {
    try {
      const r = await sincronizarGrupos();
      return res.status(200).json({ ok: true, ...r });
    } catch {
      return res.status(502).json({ error: 'A Evolution não respondeu. A ligação dos grupos está de pé?' });
    }
  }

  if (acao === 'imagem' || acao === 'midia') {
    const jid = String(body.jid || '');
    if (!ehGrupo(jid)) return res.status(400).json({ error: 'Só dá pra mandar em grupo.' });
    const mime = String(body.mimeType || '').toLowerCase().split(';')[0];
    const mediatype = /^image\/(jpeg|png|webp)$/.test(mime) ? 'image' : mime === 'video/mp4' ? 'video' : /^audio\//.test(mime) ? 'audio' : 'document';
    if (acao === 'imagem' && mediatype !== 'image') return res.status(400).json({ error: 'Só foto (JPG, PNG ou WEBP).' });
    // Arquivo grande (19/10): o navegador já subiu em wa-midia/rel-envio/ e manda a URL —
    // a Evolution baixa de lá (o corpo da Vercel não passa de ~4,5 MB).
    const urlSubida = body.url ? String(body.url) : null;
    if (urlSubida && !/^https:\/\/[^/]+\/storage\/v1\/object\/public\/wa-midia\/rel-envio\//.test(urlSubida)) return res.status(400).json({ error: 'Arquivo de fora do QS.' });
    const bytes = urlSubida ? null : Buffer.from(String(body.dataBase64 || ''), 'base64');
    if (bytes && (!bytes.length || bytes.length > 3 * 1024 * 1024)) return res.status(400).json({ error: 'Arquivo vazio ou maior que 3 MB.' });
    const legenda = String(body.legenda || '').trim().slice(0, 1000);
    const nome = assinatura(u);
    const caption = legenda ? `*${nome}:*\n${legenda}` : `*${nome}*`;
    const citada = await citadaDe(body.respondendoA, jid);
    let r;
    try { r = await enviarImagemNoGrupo(jid, urlSubida || bytes.toString('base64'), mime, mediatype === 'audio' ? '' : caption, String(body.fileName || 'arquivo'), mediatype, citada); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    const url = urlSubida || await guardarMidia(bytes, mime, { leadId: 'rel-grupos', nomeArquivo: String(body.fileName || 'foto.jpg') }).catch(() => null);
    const msgId = r?.key?.id;
    if (msgId) {
      await gravarMsg({
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { grupo_jid: jid, msg_id: msgId, de_mim: true, tipo: { image: 'imagem', video: 'video', audio: 'audio', document: 'arquivo' }[mediatype], texto: mediatype === 'audio' ? '' : caption, anexo_url: url, anexo_nome: mediatype === 'document' ? String(body.fileName || '') : null, enviado_por: u.id, criado_em: new Date().toISOString(), status: 'enviada', ...camposCitacao(citada) },
      }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: { image: '📷 foto', video: '🎬 vídeo', audio: '🎤 áudio', document: '📎 arquivo' }[mediatype], p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  // as ações abaixo mexem numa mensagem já gravada do grupo
  const daMensagem = async () => {
    const id = String(body.msgId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await rest(`rel_wa_grupo_mensagens?select=*&id=eq.${id}&limit=1`))?.[0] || null;
  };

  if (acao === 'reacao') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const emoji = String(body.emoji ?? '').slice(0, 16);
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/message/sendReaction/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body: { key: chaveDe(m), reaction: emoji } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não reagiu.').slice(0, 200) }); }
    await aplicarReacao(m.msg_id, 'eu', String(u.name || '').split(' ')[0] || 'Você', emoji);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'apagar') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!m.de_mim) return res.status(403).json({ error: 'Só dá pra apagar mensagem do próprio número.' });
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/chat/deleteMessageForEveryone/${encodeURIComponent(INSTANCIA())}`, { method: 'DELETE', body: { id: m.msg_id, remoteJid: m.grupo_jid, fromMe: true } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não apagou.').slice(0, 200) }); }
    await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { apagada_em: new Date().toISOString() } });
    return res.status(200).json({ ok: true });
  }

  if (acao === 'editar') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!m.de_mim || m.tipo !== 'texto') return res.status(403).json({ error: 'Só dá pra editar texto enviado pelo número.' });
    if (Date.now() - new Date(m.criado_em).getTime() > 15 * 60_000) return res.status(400).json({ error: 'O WhatsApp só deixa editar até 15 minutos depois de enviar.' });
    const novo = String(body.texto || '').trim();
    if (!novo) return res.status(400).json({ error: 'Mensagem vazia.' });
    const nome = assinatura(u);
    const final = `*${nome}:*\n${novo}`;
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/chat/updateMessage/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body: { number: m.grupo_jid, key: { remoteJid: m.grupo_jid, fromMe: true, id: m.msg_id }, text: final } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não editou.').slice(0, 200) }); }
    await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { texto: final, editada_em: new Date().toISOString() } });
    return res.status(200).json({ ok: true });
  }

  if (acao === 'figurinha') {
    const jid = String(body.jid || '');
    const fid = String(body.figurinhaId || '');
    const f = /^[0-9a-f-]{36}$/i.test(fid) ? (await rest(`rel_wa_figurinhas?select=url&id=eq.${fid}&limit=1`))?.[0] : null;
    if (!f) return res.status(404).json({ error: 'Figurinha não encontrada.' });
    let r;
    try { await grupoLiberado(jid); r = await evo(`/message/sendSticker/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', timeoutMs: 30000, body: { number: jid, sticker: f.url } }); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    if (r?.key?.id) {
      await gravarMsg({ method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { grupo_jid: jid, msg_id: r.key.id, de_mim: true, tipo: 'figurinha', texto: '', anexo_url: f.url, enviado_por: u.id, status: 'enviada', criado_em: new Date().toISOString() } }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: '🏷️ figurinha', p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (acao === 'voz') {
    const jid = String(body.jid || '');
    const bytes = Buffer.from(String(body.dataBase64 || ''), 'base64');
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Áudio vazio ou grande demais.' });
    let r;
    try { await grupoLiberado(jid); r = await evo(`/message/sendWhatsAppAudio/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', timeoutMs: 40000, body: { number: jid, audio: bytes.toString('base64'), encoding: true } }); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    const url = await guardarMidia(bytes, String(body.mimeType || 'audio/webm').split(';')[0], { leadId: 'rel-grupos', nomeArquivo: 'voz.webm' }).catch(() => null);
    if (r?.key?.id) {
      await gravarMsg({ method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { grupo_jid: jid, msg_id: r.key.id, de_mim: true, tipo: 'audio', texto: '', anexo_url: url, enviado_por: u.id, status: 'enviada', criado_em: new Date().toISOString() } }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: '🎤 áudio', p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (acao === 'texto') {
    const jid = String(body.jid || '');
    const texto = String(body.texto || '').trim();
    if (!ehGrupo(jid)) return res.status(400).json({ error: 'Só dá pra mandar em grupo.' });
    if (!texto) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: 'Mensagem longa demais.' });
    const nome = assinatura(u);
    const final = `*${nome}:*\n${texto}`;
    const citada = await citadaDe(body.respondendoA, jid);
    const todos = body.todos === true;
    // @: só dígitos de telefone; o texto já leva "@5511…" (é assim que o WhatsApp mostra o nome)
    const mencoes = (Array.isArray(body.mencoes) ? body.mencoes : []).map((x) => String(x).replace(/\D/g, '')).filter((x) => x.length >= 10).map((x) => `${x}@s.whatsapp.net`);
    let r;
    try {
      r = await enviarNoGrupo(jid, final, { citada, mencoes, todos });
    } catch (e) {
      return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) });
    }
    const msgId = r?.key?.id;
    if (msgId) {
      await gravarMsg({
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { grupo_jid: jid, msg_id: msgId, de_mim: true, tipo: 'texto', texto: final, enviado_por: u.id, criado_em: new Date().toISOString(), status: 'enviada',
          ...camposCitacao(citada), mencoes: todos ? ['todos'] : mencoes },
      }).catch(() => null);
      // respondeu pelo QS = leu (zera não lidas e o @)
      await rest('rpc/rel_wa_grupo_nova_msg', {
        method: 'POST',
        body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: final.slice(0, 140), p_de_mim: true, p_mencionou: false },
      }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  // 0219: info do grupo, participantes, convite, encaminhar, vínculo, agendadas…
  if (await acaoMais(acao, body, u, res)) return;

  return res.status(400).json({ error: 'Ação desconhecida.' });
}
