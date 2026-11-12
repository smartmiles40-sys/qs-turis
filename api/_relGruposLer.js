// api/_relGruposLer.js
// -----------------------------------------------------------------------------
// LER A MENSAGEM QUE A EVOLUTION ENTREGA (grupos e 1:1 do Relacionamento) —
// funções puras, sem banco nem rede, com teste em tests/rel-grupos/.
//
// 11/11 — "quando alguém responde uma conversa no grupo não está aparecendo".
// Conferido no banco: nos 14 dias até 11/11, 0 de 2.517 TEXTOS de clientes nos
// grupos tinham a citação gravada, contra 59 de ~1.400 fotos/figurinhas/áudios.
// Motivo: a Evolution (prepareMessage) troca o extendedTextMessage — que é onde
// o WhatsApp põe a citação de um texto — por "conversation" e APAGA o
// extendedTextMessage; o contextInfo sobrevive só no TOPO do evento
// (data.contextInfo). A entrada dos grupos só procurava dentro da mensagem, então
// toda resposta em texto entrava como mensagem solta, sem o balão do que ela
// respondia. Foto/áudio guardam o contextInfo dentro do imageMessage etc., por
// isso esses apareciam.
//
// Também: mensagem temporária / visualização única chegam embrulhadas
// (ephemeralMessage, viewOnceMessage…) e a entrada dos grupos não desembrulhava —
// em grupo com mensagens temporárias ligadas NADA entrava.
// -----------------------------------------------------------------------------

const JID_GRUPO = /@g\.us$/;

/** Tira os embrulhos de mensagem temporária / visualização única / legenda de documento. */
export function desembrulhar(m) {
  let x = m && typeof m === 'object' ? m : {};
  for (let i = 0; i < 4; i++) {
    const dentro = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message
      || x.viewOnceMessageV2Extension?.message || x.documentWithCaptionMessage?.message;
    if (!dentro || typeof dentro !== 'object') break;
    x = dentro;
  }
  return x;
}

const temCitacao = (c) => !!(c && typeof c === 'object' && (c.stanzaId || c.quotedMessage || c.remoteJid));

/**
 * contextInfo (citação, @, "respondendo no privado ao grupo") do evento da
 * Evolution: primeiro o do TOPO (data.contextInfo — o único que sobra num texto),
 * depois o de dentro de qualquer tipo de mensagem (desembrulhada). Prefere o que
 * tem citação; sem citação devolve o primeiro que achar (pode ter só @).
 */
export function contextoDoEvento(d) {
  const achados = [];
  if (d?.contextInfo && typeof d.contextInfo === 'object') achados.push(d.contextInfo);
  for (const m of [d?.message, desembrulhar(d?.message)]) {
    if (!m || typeof m !== 'object') continue;
    for (const v of Object.values(m)) if (v && typeof v === 'object' && v.contextInfo && typeof v.contextInfo === 'object') achados.push(v.contextInfo);
  }
  return achados.find(temCitacao) || achados[0] || null;
}

/** Texto curto de uma mensagem citada (ou rótulo da mídia). */
export function textoDaCitada(q) {
  const m = desembrulhar(q);
  return m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || m?.documentMessage?.caption
    || (m?.imageMessage ? '📷 foto' : m?.videoMessage ? '🎬 vídeo' : m?.audioMessage ? '🎤 áudio' : m?.stickerMessage ? '🏷️ figurinha'
      : m?.documentMessage ? '📎 arquivo' : m?.locationMessage ? '📍 localização' : m?.contactMessage ? '👤 contato'
        : (m?.pollCreationMessage || m?.pollCreationMessageV3) ? '📊 enquete' : '');
}

/** Os campos de citação de uma mensagem de GRUPO (o que vai pra rel_wa_grupo_mensagens). */
export function citacaoDoGrupo(d) {
  const ctx = contextoDoEvento(d);
  const id = ctx?.stanzaId ? String(ctx.stanzaId) : null;
  const texto = ctx?.quotedMessage ? textoDaCitada(ctx.quotedMessage).slice(0, 300) : '';
  return {
    responde_a: id,
    citado_texto: id || texto ? (texto || null) : null,
    citado_autor: id ? (ctx?.participant ? String(ctx.participant) : null) : null,
    mencoes: Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid.map(String) : [],
  };
}

/** Tipo + texto + "tem arquivo?" de uma mensagem de GRUPO do Baileys. null = ignorar. */
export function lerConteudoGrupo(bruta) {
  if (!bruta || typeof bruta !== 'object') return null;
  if (bruta.reactionMessage || bruta.protocolMessage) return null;
  const m = desembrulhar(bruta);
  if (m.reactionMessage || m.protocolMessage) return null;
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { tipo: 'imagem', texto: m.imageMessage.caption || '', midia: true };
  if (m.videoMessage) return { tipo: 'video', texto: m.videoMessage.caption || '', midia: true };
  if (m.ptvMessage) return { tipo: 'video', texto: m.ptvMessage.caption || '', midia: true };
  if (m.audioMessage) return { tipo: 'audio', texto: '', midia: true };
  if (m.stickerMessage) return { tipo: 'figurinha', texto: '', midia: true };
  const doc = m.documentMessage;
  if (doc) return { tipo: 'arquivo', texto: doc.caption || '', midia: true, nome: doc.fileName || null };
  const enquete = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
  if (enquete) return { tipo: 'enquete', texto: `📊 ${enquete.name || 'Enquete'}` };
  if (m.locationMessage || m.liveLocationMessage) return { tipo: 'local', texto: '📍 localização' };
  if (m.contactMessage) return { tipo: 'contato', texto: `👤 ${m.contactMessage.displayName || 'contato'}` };
  if (m.contactsArrayMessage) return { tipo: 'contato', texto: `👤 ${(m.contactsArrayMessage.contacts || []).map((c) => c?.displayName).filter(Boolean).join(', ') || 'contatos'}` };
  if (m.eventMessage) return { tipo: 'texto', texto: `📅 Evento: ${m.eventMessage.name || ''}`.trim() };
  if (m.groupInviteMessage) return { tipo: 'texto', texto: `👥 Convite para o grupo ${m.groupInviteMessage.groupName || ''}`.trim() };
  if (m.buttonsResponseMessage || m.listResponseMessage || m.templateButtonReplyMessage || m.interactiveResponseMessage) {
    const r = m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || m.templateButtonReplyMessage?.selectedDisplayText
      || m.interactiveResponseMessage?.body?.text;
    return { tipo: 'texto', texto: r ? `↩️ ${r}` : '↩️ Respondeu a uma mensagem interativa' };
  }
  return null;
}

/**
 * Resposta NO PRIVADO a uma mensagem de grupo ("Responder em particular" do
 * WhatsApp): a mensagem é 1:1, mas o contextInfo aponta pro grupo.
 */
export function grupoCitadoDoEvento(d) {
  const ctx = contextoDoEvento(d);
  if (!ctx || !JID_GRUPO.test(String(ctx.remoteJid || ''))) return null;
  return {
    jid: String(ctx.remoteJid),
    msg_id: ctx.stanzaId ? String(ctx.stanzaId) : null,
    autor: ctx.participant ? String(ctx.participant) : null,
    texto: textoDaCitada(ctx.quotedMessage).slice(0, 300),
  };
}
