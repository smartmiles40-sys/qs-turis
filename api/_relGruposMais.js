// api/_relGruposMais.js
// -----------------------------------------------------------------------------
// GRUPOS "IGUAL AO WHATSAPP NORMAL" — as ações novas (28/10/2026, 0219).
// Chamadas SÓ por api/rel-grupos.js, depois de conferir o login do
// Relacionamento (quemChama). Todo envio/mudança passa por grupoLiberado():
// só grupo já conhecido e em que o número ainda está. Nada aqui fala com pessoa
// — "adicionar participante" põe a pessoa no GRUPO; o convite é só um link
// copiado (o envio do convite no privado, /group/sendInvite, NÃO é usado).
//
//   info              { jid }                         → lê o grupo agora (nome, foto, admins…)
//   participantes     { jid, operacao, telefones[] }  → add | remove | promote | demote (admin)
//   convite           { jid, novo? }                  → link de convite (novo = revoga o antigo)
//   nome / descricao  { jid, nome | descricao }       → muda no WhatsApp
//   foto-grupo        { jid, url }                    → foto do grupo (URL já no nosso storage)
//   ajuste            { jid, ajuste }                 → announcement | not_announcement | locked | unlocked
//   encaminhar        { msgId, jids[] }               → reenvia em até 5 grupos
//   vincular          { jid, expedicaoId, viagemId }  → liga o grupo à expedição / viagem
//   fixar / lida      { jid, fixar | lida }           → só no QS
//   agendar           { jid, texto, enviarEm, url?, mimeType?, fileName?, todos? }
//   cancelar-agendada { id }
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { evo, inst, ehGrupo, grupoLiberado, assinatura, registrarSaida } from './_relGruposEvo.js';
import { lerInfoDoGrupo } from './_relGruposSync.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
const falha = (res, e, padrao) => res.status(502).json({ error: String(e?.message || padrao).slice(0, 220) });
const URL_NOSSA = /^https:\/\/[^/]+\/storage\/v1\/object\/public\/wa-midia\//;
const URL_SUBIDA = /^https:\/\/[^/]+\/storage\/v1\/object\/public\/wa-midia\/rel-envio\//;

export const agendadasLigadas = () => String(process.env.REL_GRUPOS_AGENDADAS || '').trim() === '1';

const MIME_POR_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  pdf: 'application/pdf',
};
function mimeDe(url, padrao = 'application/octet-stream') {
  const ext = String(url || '').split('?')[0].split('.').pop().toLowerCase();
  return MIME_POR_EXT[ext] || padrao;
}
const tipoDoMime = (mime) => (/^image\/(jpeg|png|webp)$/.test(mime) ? 'image' : mime === 'video/mp4' ? 'video' : /^audio\//.test(mime) ? 'audio' : 'document');
const TIPO_DA_MIDIA = { image: 'imagem', video: 'video', audio: 'audio', document: 'arquivo' };
const PREVIA = { image: '📷 foto', video: '🎬 vídeo', audio: '🎤 áudio', document: '📎 arquivo' };

/** Telefones pra adicionar/remover: só dígitos, com DDI, sem repetir (no máximo 50 por vez). */
const telefones = (l) => [...new Set((Array.isArray(l) ? l : [l]).map((x) => String(x || '').replace(/\D/g, '')).filter((x) => x.length >= 10 && x.length <= 15))].slice(0, 50);

/** Só admin mexe em participantes/convite/ajustes. Sem certeza, lê o grupo de novo antes de recusar. */
async function exigirAdmin(jid) {
  const g = await grupoLiberado(jid);
  if (g.eu_admin) return g;
  const info = await lerInfoDoGrupo(jid).catch(() => null);
  if (!info?.eu_admin) throw new Error('O número do Relacionamento não é admin deste grupo — peça pra um admin promover o número.');
  return { ...g, eu_admin: true };
}

/** O que a Evolution devolve em updateParticipant, em português. */
const STATUS_PART = {
  200: 'feito',
  403: 'a pessoa não deixa ser adicionada por quem não é contato — copie o link de convite e mande pelo número oficial',
  404: 'esse número não tem WhatsApp',
  408: 'a pessoa saiu do grupo há pouco — o WhatsApp só deixa readicionar por convite',
  409: 'já está no grupo',
  500: 'o WhatsApp recusou',
};

/** Envia texto (com @todos opcional) ou arquivo por URL num grupo já liberado. */
async function mandar(jid, { texto, url, mime, fileName, todos = false, mencoes = [] }) {
  const extra = {
    ...(todos ? { mentionsEveryOne: true, everyOne: true } : {}),
    ...(!todos && mencoes.length ? { mentioned: mencoes } : {}),
  };
  if (url) {
    const mediatype = tipoDoMime(mime);
    const r = await evo(`/message/sendMedia/${inst()}`, {
      method: 'POST', timeoutMs: 50000,
      body: { number: jid, mediatype, mimetype: mime, media: url, fileName: fileName || 'arquivo', ...(mediatype !== 'audio' && texto ? { caption: texto } : {}), ...extra },
    });
    return { r, mediatype };
  }
  const r = await evo(`/message/sendText/${inst()}`, { method: 'POST', body: { number: jid, text: texto, ...extra } });
  return { r, mediatype: null };
}

/** Manda uma agendada. Usada pelo cron. */
async function enviarAgendada(a) {
  await grupoLiberado(a.grupo_jid);
  const nome = a.assinatura || 'Relacionamento';
  const final = a.texto ? `*${nome}:*\n${a.texto}` : `*${nome}*`;
  const mime = a.anexo_url ? (a.anexo_mime || mimeDe(a.anexo_url)) : null;
  const { r, mediatype } = await mandar(a.grupo_jid, { texto: final, url: a.anexo_url, mime, fileName: a.anexo_nome, todos: a.mencionar_todos });
  const msgId = r?.key?.id || null;
  await registrarSaida({
    grupo_jid: a.grupo_jid, msg_id: msgId, tipo: mediatype ? TIPO_DA_MIDIA[mediatype] : 'texto',
    texto: mediatype === 'audio' ? '' : final, anexo_url: a.anexo_url || null,
    anexo_nome: mediatype === 'document' ? a.anexo_nome : null, enviado_por: a.criado_por || null,
    previa: mediatype ? PREVIA[mediatype] : final,
  });
  return msgId;
}

/**
 * Cron: manda as agendadas vencidas. DESLIGADO por padrão — a regra do Bruno
 * para essa ligação era "nada de aviso automático em grupo". Só roda com
 * REL_GRUPOS_AGENDADAS=1 na Vercel (cada agendada foi escrita e assinada por
 * alguém do time; o cron só aperta "enviar" na hora marcada).
 */
export async function enviarAgendadas({ prazo = Date.now() + 25_000 } = {}) {
  if (!agendadasLigadas()) return { agendadas: 'desligadas' };
  const lote = (await rest('rpc/rel_wa_grupo_agendadas_pegar', { method: 'POST', body: { p_limite: 10 } }).catch((e) => { console.error('[rel-grupos] fila:', e?.message); return []; })) || [];
  let enviadas = 0;
  let erros = 0;
  for (const a of lote) {
    if (Date.now() > prazo) {
      // sem tempo: volta pra fila (ainda não foi pra Evolution)
      await rest(`rel_wa_grupo_agendadas?id=eq.${a.id}&status=eq.enviando`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pendente' } }).catch(() => null);
      continue;
    }
    try {
      const msgId = await enviarAgendada(a);
      await rest(`rel_wa_grupo_agendadas?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'enviada', msg_id: msgId, enviada_em: new Date().toISOString(), erro: null } });
      enviadas += 1;
    } catch (e) {
      erros += 1;
      await rest(`rel_wa_grupo_agendadas?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'erro', erro: String(e?.message || 'Não enviou.').slice(0, 300) } }).catch(() => null);
    }
  }
  return { enviadas, erros };
}

/**
 * As ações novas. Devolve true quando tratou o pedido (já respondeu), false
 * quando a ação não é daqui (rel-grupos.js segue com as dele).
 */
export async function acaoMais(acao, body, u, res) {
  const jid = String(body.jid || '');

  if (acao === 'info') {
    try {
      await grupoLiberado(jid);
      const i = await lerInfoDoGrupo(jid);
      res.status(200).json({
        ok: true, nome: i.subject ?? null, descricao: i.desc ?? null, foto_url: i.pictureUrl ?? null, eu_admin: !!i.eu_admin,
        so_admins_enviam: !!i.announce, so_admins_editam: !!i.restrict, criado_em: i.creation ? new Date(Number(i.creation) * 1000).toISOString() : null,
        participantes: Array.isArray(i.participants) ? i.participants.length : i.size ?? null, comunidade: !!i.isCommunity,
      });
    } catch (e) { falha(res, e, 'Não consegui ler o grupo.'); }
    return true;
  }

  if (acao === 'participantes') {
    const operacao = String(body.operacao || '');
    if (!['add', 'remove', 'promote', 'demote'].includes(operacao)) { res.status(400).json({ error: 'Operação inválida.' }); return true; }
    const tels = telefones(body.telefones);
    if (!tels.length) { res.status(400).json({ error: 'Informe o telefone com DDD (e DDI, se não for do Brasil).' }); return true; }
    // telefone BR sem o 55 na frente: completa
    const finais = tels.map((t) => (t.length <= 11 ? `55${t}` : t));
    try {
      await exigirAdmin(jid);
      const r = await evo(`/group/updateParticipant/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', timeoutMs: 30000, body: { groupJid: jid, action: operacao, participants: finais } });
      const lista = Array.isArray(r?.updateParticipants) ? r.updateParticipants : [];
      const resultado = finais.map((t) => {
        const it = lista.find((x) => String(x?.jid || '').startsWith(t)) || lista.find((x) => String(x?.content?.attrs?.phone_number || '').startsWith(t));
        const st = Number(it?.status || (lista.length ? 0 : 200));
        return { telefone: t, ok: st === 200, msg: STATUS_PART[st] || (st ? `código ${st}` : 'sem resposta do WhatsApp') };
      });
      await lerInfoDoGrupo(jid).catch(() => null);
      res.status(200).json({ ok: true, resultado });
    } catch (e) { falha(res, e, 'Não consegui mudar os participantes.'); }
    return true;
  }

  if (acao === 'convite') {
    try {
      await exigirAdmin(jid);
      if (body.novo) await evo(`/group/revokeInviteCode/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', body: { groupJid: jid } });
      const r = await evo(`/group/inviteCode/${inst()}?groupJid=${enc(jid)}`);
      if (!r?.inviteUrl) throw new Error('O WhatsApp não devolveu o link.');
      res.status(200).json({ ok: true, url: r.inviteUrl });
    } catch (e) { falha(res, e, 'Não consegui o link de convite.'); }
    return true;
  }

  if (acao === 'nome' || acao === 'descricao') {
    const valor = String(acao === 'nome' ? body.nome || '' : body.descricao || '').trim();
    if (acao === 'nome' && (!valor || valor.length > 100)) { res.status(400).json({ error: 'O nome do grupo vai de 1 a 100 letras.' }); return true; }
    if (valor.length > 2048) { res.status(400).json({ error: 'Descrição longa demais (máx. 2048).' }); return true; }
    try {
      await grupoLiberado(jid); // se o grupo só deixa admin editar, o WhatsApp recusa e a mensagem volta
      if (acao === 'nome') await evo(`/group/updateGroupSubject/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', body: { groupJid: jid, subject: valor } });
      else await evo(`/group/updateGroupDescription/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', body: { groupJid: jid, description: valor } });
      await rest(`rel_wa_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: acao === 'nome' ? { nome: valor } : { descricao: valor } });
      res.status(200).json({ ok: true });
    } catch (e) { falha(res, e, 'O WhatsApp não deixou mudar (talvez só admin possa).'); }
    return true;
  }

  if (acao === 'foto-grupo') {
    const url = String(body.url || '');
    if (!URL_SUBIDA.test(url)) { res.status(400).json({ error: 'Foto de fora do QS.' }); return true; }
    try {
      await grupoLiberado(jid);
      await evo(`/group/updateGroupPicture/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', timeoutMs: 30000, body: { groupJid: jid, image: url } });
      await lerInfoDoGrupo(jid).catch(() => null);
      res.status(200).json({ ok: true });
    } catch (e) { falha(res, e, 'O WhatsApp não deixou trocar a foto.'); }
    return true;
  }

  if (acao === 'ajuste') {
    const ajuste = String(body.ajuste || '');
    if (!['announcement', 'not_announcement', 'locked', 'unlocked'].includes(ajuste)) { res.status(400).json({ error: 'Ajuste inválido.' }); return true; }
    try {
      await exigirAdmin(jid);
      await evo(`/group/updateSetting/${inst()}?groupJid=${enc(jid)}`, { method: 'POST', body: { groupJid: jid, action: ajuste } });
      const campo = ajuste.includes('announcement') ? { so_admins_enviam: ajuste === 'announcement' } : { so_admins_editam: ajuste === 'locked' };
      await rest(`rel_wa_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: campo });
      res.status(200).json({ ok: true });
    } catch (e) { falha(res, e, 'Não consegui mudar o ajuste.'); }
    return true;
  }

  if (acao === 'encaminhar') {
    const id = String(body.msgId || '');
    const destinos = [...new Set((Array.isArray(body.jids) ? body.jids : []).map(String))].filter(ehGrupo).slice(0, 5);
    if (!UUID.test(id) || !destinos.length) { res.status(400).json({ error: 'Escolha a mensagem e até 5 grupos.' }); return true; }
    const m = (await rest(`rel_wa_grupo_mensagens?select=*&id=eq.${id}&limit=1`))?.[0];
    if (!m || m.apagada_em) { res.status(404).json({ error: 'Mensagem não encontrada.' }); return true; }
    const ASS = /^\*[^*\n]{1,80}:\*\n/;
    const corpo = String(m.texto || '').replace(ASS, '');
    const final = `*${assinatura(u)}:*\n_↪ Encaminhada_${corpo ? `\n${corpo}` : ''}`;
    const resultado = [];
    for (const destino of destinos) {
      try {
        await grupoLiberado(destino);
        let msgId = null;
        let tipo = 'texto';
        if (m.anexo_url && m.tipo === 'figurinha') {
          const r = await evo(`/message/sendSticker/${inst()}`, { method: 'POST', timeoutMs: 30000, body: { number: destino, sticker: m.anexo_url } });
          msgId = r?.key?.id; tipo = 'figurinha';
        } else if (m.anexo_url && URL_NOSSA.test(m.anexo_url)) {
          const mime = mimeDe(m.anexo_url, { imagem: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg' }[m.tipo] || 'application/octet-stream');
          const { r, mediatype } = await mandar(destino, { texto: final, url: m.anexo_url, mime, fileName: m.anexo_nome || 'arquivo' });
          msgId = r?.key?.id; tipo = TIPO_DA_MIDIA[mediatype];
        } else {
          if (!corpo) throw new Error('Essa mensagem não tem texto nem arquivo guardado.');
          const { r } = await mandar(destino, { texto: final });
          msgId = r?.key?.id;
        }
        await registrarSaida({ grupo_jid: destino, msg_id: msgId, tipo, texto: tipo === 'audio' || tipo === 'figurinha' ? '' : final, anexo_url: m.anexo_url || null, anexo_nome: m.anexo_nome || null, enviado_por: u.id, encaminhada: true, previa: `↪ ${corpo || PREVIA[{ imagem: 'image', video: 'video', audio: 'audio' }[m.tipo] || 'document']}` });
        resultado.push({ jid: destino, ok: true });
      } catch (e) {
        resultado.push({ jid: destino, ok: false, erro: String(e?.message || 'Não enviou.').slice(0, 160) });
      }
    }
    res.status(resultado.some((x) => x.ok) ? 200 : 502).json({ ok: resultado.some((x) => x.ok), resultado, ...(resultado.some((x) => x.ok) ? {} : { error: resultado[0]?.erro || 'Não encaminhou.' }) });
    return true;
  }

  if (acao === 'vincular') {
    if (!ehGrupo(jid)) { res.status(400).json({ error: 'Grupo inválido.' }); return true; }
    const expedicaoId = body.expedicaoId ? String(body.expedicaoId) : null;
    const viagemId = body.viagemId ? String(body.viagemId) : null;
    if ((expedicaoId && !UUID.test(expedicaoId)) || (viagemId && !UUID.test(viagemId))) { res.status(400).json({ error: 'Vínculo inválido.' }); return true; }
    if (expedicaoId && !(await rest(`expedicoes?select=id&id=eq.${expedicaoId}&limit=1`))?.[0]) { res.status(404).json({ error: 'Expedição não encontrada.' }); return true; }
    if (viagemId && !(await rest(`rel_viagens?select=id&id=eq.${viagemId}&limit=1`))?.[0]) { res.status(404).json({ error: 'Viagem não encontrada.' }); return true; }
    const r = await rest(`rel_wa_grupos?jid=eq.${enc(jid)}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { expedicao_id: expedicaoId, viagem_id: viagemId, vinculo_por: u.id, vinculo_em: new Date().toISOString() },
    });
    if (!r?.length) { res.status(404).json({ error: 'Grupo não encontrado.' }); return true; }
    res.status(200).json({ ok: true });
    return true;
  }

  if (acao === 'fixar' || acao === 'lida') {
    if (!ehGrupo(jid)) { res.status(400).json({ error: 'Grupo inválido.' }); return true; }
    let campo;
    if (acao === 'fixar') campo = { fixado_em: body.fixar ? new Date().toISOString() : null };
    else if (body.lida) campo = { nao_lidas: 0, mencionado_em: null };
    else {
      const g = (await rest(`rel_wa_grupos?select=nao_lidas&jid=eq.${enc(jid)}&limit=1`))?.[0];
      campo = { nao_lidas: Math.max(1, Number(g?.nao_lidas) || 0) };
    }
    await rest(`rel_wa_grupos?jid=eq.${enc(jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: campo });
    res.status(200).json({ ok: true });
    return true;
  }

  if (acao === 'agendar') {
    const texto = String(body.texto || '').trim();
    const url = body.url ? String(body.url) : null;
    const quando = new Date(String(body.enviarEm || ''));
    if (!texto && !url) { res.status(400).json({ error: 'Escreva a mensagem ou escolha um arquivo.' }); return true; }
    if (texto.length > 4000) { res.status(400).json({ error: 'Mensagem longa demais.' }); return true; }
    if (url && !URL_SUBIDA.test(url)) { res.status(400).json({ error: 'Arquivo de fora do QS.' }); return true; }
    if (Number.isNaN(quando.getTime()) || quando.getTime() < Date.now() + 60_000) { res.status(400).json({ error: 'Escolha um horário pelo menos 1 minuto à frente.' }); return true; }
    if (quando.getTime() > Date.now() + 120 * 86_400_000) { res.status(400).json({ error: 'Dá pra agendar até 120 dias à frente.' }); return true; }
    try { await grupoLiberado(jid); } catch (e) { res.status(400).json({ error: String(e?.message || 'Grupo inválido.') }); return true; }
    const r = await rest('rel_wa_grupo_agendadas', {
      method: 'POST', prefer: 'return=representation',
      body: {
        grupo_jid: jid, texto, enviar_em: quando.toISOString(), criado_por: u.id, assinatura: assinatura(u),
        mencionar_todos: !!body.todos,
        ...(url ? { anexo_url: url, anexo_nome: String(body.fileName || 'arquivo').slice(0, 200), anexo_mime: String(body.mimeType || mimeDe(url)).split(';')[0].toLowerCase() } : {}),
      },
    });
    res.status(200).json({ ok: true, id: r?.[0]?.id ?? null, ligado: agendadasLigadas() });
    return true;
  }

  if (acao === 'cancelar-agendada') {
    const id = String(body.id || '');
    if (!UUID.test(id)) { res.status(400).json({ error: 'Agendamento inválido.' }); return true; }
    const r = await rest(`rel_wa_grupo_agendadas?id=eq.${id}&status=eq.pendente`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'cancelada', cancelada_por: u.id } });
    if (!r?.length) { res.status(409).json({ error: 'Essa mensagem já saiu (ou já foi cancelada).' }); return true; }
    res.status(200).json({ ok: true });
    return true;
  }

  return false;
}
