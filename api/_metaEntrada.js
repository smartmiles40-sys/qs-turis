// api/_metaEntrada.js
// -----------------------------------------------------------------------------
// MENSAGENS QUE A META ENTREGA DIRETO NO QS (0084, 21/09/2026).
//
// A Meta chama o /api/wa-calls com TODA mensagem do número oficial (o app
// `qs_call` assina o campo `messages` desde 01/09). Até hoje a rota jogava fora
// — o Chatwoot era quem gravava, e o Chatwoot→QS morreu em 02/09. Aqui é a
// gravação direta. Três campos do webhook:
//
//   messages            → o que o CLIENTE mandou + recibos (sent/delivered/read)
//   smb_message_echoes  → o que o SDR mandou pelo app WhatsApp Business
//                         (só existe com Coexistence)
//   history             → o histórico do celular, uma vez, ao conectar
//                         (só existe com Coexistence)
//
// De quem é o número decide quem vê: `qs_wa_numeros_meta`. Número compartilhado
// (o oficial) = regra de sempre; número de SDR = só o dono (+ gestão/closer).
//
// A Glória (IA) é avisada daqui SÓ com a chave `qs_settings.gloria_ouve_meta`
// ligada (23/09/2026, ver gravarUma). Ela ficou parada desde 02/09 porque não
// entrava mensagem; religar a IA respondendo cliente é decisão de alguém.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { completeWhatsAppTask } from './_wa.js';
import { credenciaisDaMeta } from './_meta.js';
import { registrarDescarte, nascerDoWhatsApp } from './_waNascimento.js';
import { ehPedidoDeParada, registrarOptout } from './_waOptout.js';
import { transcrever, transcricaoConfigurada } from './_transcrever.js';
import { guardarMidia, rotuloDaMidia, leadDoTelefone } from './_waMidia.js';
import { avisarGloria } from './_gloria.js';
import { processarRelacionamento } from './_relEntrada.js';
import { motivoDaFalha, ehMidiaDoClienteQueNaoChegou } from './_waFalhas.js';

const GRAPH = 'https://graph.facebook.com/v23.0';

// ── De quem é o número ──────────────────────────────────────────────────────

const cacheNumeros = new Map();
// 30/10: banco lento NÃO pode virar "número desconhecido". Em 29/10 13:56 UTC o
// erro foi guardado como null por 5 min e 6 mensagens do RELACIONAMENTO caíram
// no Comercial (qs_wa_messages sem caixa). Agora: tenta 2x e, se não der, LANÇA —
// quem chama não grava em lugar errado e pede à Meta que reenvie.
async function numeroDaMeta(phoneNumberId) {
  const k = String(phoneNumberId || '');
  const hit = cacheNumeros.get(k);
  if (hit && Date.now() - hit.em < 5 * 60_000) return hit.v;
  let ultimoErro = null;
  for (let t = 1; t <= 2; t++) {
    try {
      const r = await rest(`qs_wa_numeros_meta?select=phone_number_id,user_id,rotulo,cw_inbox_id,setor&phone_number_id=eq.${encodeURIComponent(k)}&limit=1`, { timeoutMs: t === 1 ? 8000 : 15000 });
      const v = r?.[0] || null;
      cacheNumeros.set(k, { v, em: Date.now() });
      return v;
    } catch (e) {
      ultimoErro = e;
      console.warn(`[meta-entrada] não li qs_wa_numeros_meta (tentativa ${t}):`, e?.message);
    }
  }
  // cache velho vale mais que nada (o setor de um número não muda de uma hora pra outra)
  if (hit) return hit.v;
  const err = new Error(`número ${k} indefinido: ${ultimoErro?.message}`);
  err.code = 'NUMERO_INDEFINIDO';
  throw err;
}

const cacheNomes = new Map();
async function nomeDoUsuario(id) {
  if (!id) return null;
  if (cacheNomes.has(id)) return cacheNomes.get(id);
  const r = await rest(`qs_users?select=name&id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => null);
  const n = r?.[0]?.name || null;
  cacheNomes.set(id, n);
  return n;
}

// ── Lendo a mensagem no formato da Meta ─────────────────────────────────────

const TIPO_ANEXO = { image: 'image', video: 'video', audio: 'audio', document: 'file', sticker: 'image' };

/**
 * Traduz uma mensagem da Cloud API pro que o QS grava. null = não vira bolha
 * (reação e mensagem de sistema são tratadas à parte).
 */
export function lerMensagemMeta(m) {
  const tipo = String(m?.type || '');
  let texto = null;
  let midia = null;

  if (tipo === 'text') texto = m.text?.body ?? null;
  else if (TIPO_ANEXO[tipo]) {
    const d = m[tipo] || {};
    midia = { id: d.id, mime: d.mime_type || null, tipo: TIPO_ANEXO[tipo], nomeArquivo: d.filename || null };
    texto = d.caption ?? null;
  } else if (tipo === 'button') texto = m.button?.text ?? null;
  else if (tipo === 'interactive') {
    const i = m.interactive || {};
    texto = i.button_reply?.title ?? i.list_reply?.title ?? i.nfm_reply?.body ?? null;
  } else if (tipo === 'location') {
    const l = m.location || {};
    texto = `📍 Localização: https://maps.google.com/?q=${l.latitude},${l.longitude}`;
  } else if (tipo === 'contacts') {
    texto = (m.contacts || []).map((c) => {
      const fone = c?.phones?.[0]?.phone || c?.phones?.[0]?.wa_id || '';
      return `👤 Contato: ${c?.name?.formatted_name || ''}${fone ? ` (${fone})` : ''}`.trim();
    }).join('\n') || '👤 Contato';
  } else if (tipo === 'template') {
    // Eco de um modelo mandado pelo app/API — o corpo nem sempre vem.
    texto = m.template?.name ? `📨 Modelo: ${m.template.name}` : null;
  }

  // NADA SOME (05/11, Bruno: "absolutamente tudo tem que subir pro QS"). Até
  // aqui, editar/apagar/tipo novo da Meta voltava null e a mensagem era jogada
  // fora sem ninguém saber (4 "unsupported" de clientes em 05/11). Agora todo
  // tipo vira bolha — no pior caso, um aviso pra abrir no celular.
  let respondendoA = m.context?.id ? String(m.context.id) : null;
  if (!texto && !midia) {
    const especial = textoDoTipoEspecial(m);
    if (especial === IGNORAR) return null;
    texto = especial.texto;
    if (especial.original) respondendoA = especial.original;
  }

  const ts = Number(m.timestamp);
  return {
    id: String(m.id || ''),
    texto: texto ? String(texto) : '',
    midia,
    enviadaEm: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    respondendoA,
  };
}

const IGNORAR = Symbol('ignorar');

/**
 * Os tipos que não são texto/mídia. Reação é tratada antes (fica na bolha
 * reagida); `request_welcome` é só "a pessoa abriu a conversa", sem conteúdo.
 * Qualquer outro tipo — inclusive um que a Meta invente amanhã — vira aviso.
 */
export function textoDoTipoEspecial(m) {
  const tipo = String(m?.type || '');
  if (tipo === 'reaction' || tipo === 'request_welcome') return IGNORAR;
  if (tipo === 'edit') {
    const e = m.edit || {};
    const novo = e.message?.text?.body ?? e.text?.body ?? e.body ?? e.message?.caption ?? null;
    const original = e.original_message_id || e.message_id || e.id || null;
    return { texto: novo ? `✏️ Editou a mensagem: ${novo}` : '✏️ Editou uma mensagem (abra no celular para ver)', original: original ? String(original) : null };
  }
  if (tipo === 'revoke' || tipo === 'delete') {
    const original = m.revoke?.original_message_id || m.delete?.original_message_id || null;
    return { texto: '🗑️ Apagou uma mensagem', original: original ? String(original) : null };
  }
  if (tipo === 'system') {
    return { texto: `ℹ️ ${m.system?.body || 'Aviso do WhatsApp'}`, original: null };
  }
  if (tipo === 'order') {
    const itens = (m.order?.product_items || []).length;
    return { texto: `🛒 Pedido pelo catálogo${itens ? ` (${itens} ${itens === 1 ? 'item' : 'itens'})` : ''}${m.order?.text ? `: ${m.order.text}` : ''}`, original: null };
  }
  if (tipo === 'interactive' || tipo === 'button') {
    return { texto: '↩️ Respondeu a uma mensagem interativa', original: null };
  }
  const qual = m?.unsupported?.type || (tipo && tipo !== 'unsupported' ? tipo : '') || '';
  return {
    texto: `⚠️ ${qual ? `Mensagem do tipo "${qual}"` : 'Mensagem'} que o WhatsApp não repassa ao sistema — abra no celular para ver.`,
    original: null,
  };
}

/** Baixa a mídia da Meta (id → URL assinada → bytes) e guarda no QS. */
export async function baixarMidiaMeta(midia, leadId, phoneId = null) {
  if (!midia?.id) return [];
  try {
    const cred = await credenciaisDaMeta(phoneId);
    const token = cred?.token || String(process.env.META_CALLS_TOKEN || '').trim();
    if (!token) return [];
    const info = await fetch(`${GRAPH}/${encodeURIComponent(midia.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (!info?.url) return [];
    const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!bin.ok) return [];
    const bytes = Buffer.from(await bin.arrayBuffer());
    const mime = String(info.mime_type || midia.mime || '').split(';')[0].trim();
    const url = await guardarMidia(bytes, mime, { leadId, nomeArquivo: midia.nomeArquivo });
    // nome e tamanho: o Atendimento do Relacionamento mostra no cartão do documento (13/10)
    return url ? [{ type: midia.tipo, url, ...(midia.nomeArquivo ? { nome: midia.nomeArquivo } : {}), tamanho: bytes.length }] : [];
  } catch (e) {
    console.warn('[meta-entrada] mídia não baixada:', e?.message);
    return [];
  }
}

// ── Gravar ──────────────────────────────────────────────────────────────────

/**
 * Uma mensagem. `direcao` 'in' = cliente → empresa; 'out' = empresa → cliente
 * (eco do app ou histórico). `aoVivo` false = histórico: não nasce lead, não
 * fecha atividade, não transcreve.
 */
async function gravarUma({ numero, m, direcao, telefoneCliente, nomeCliente, aoVivo, baixar = true }) {
  const lida = lerMensagemMeta(m);
  if (!lida?.id || !telefoneCliente) return { ignorada: 'sem-conteudo' };

  const donoDoNumero = numero?.user_id || null;
  let lead = await leadDoTelefone(telefoneCliente, donoDoNumero);

  if (!lead && aoVivo && direcao === 'in') {
    const nomeSdr = await nomeDoUsuario(donoDoNumero);
    try {
      lead = await nascerDoWhatsApp({
        phone: telefoneCliente, nome: nomeCliente, direcao: 'in', inboxId: numero?.cw_inbox_id ?? null,
        ownerId: donoDoNumero,
        canal: donoDoNumero ? `número ${nomeSdr ? 'de ' + nomeSdr.split(' ')[0] : 'do SDR'}` : 'API oficial',
      });
    } catch (e) {
      // Falha passageira (Bitrix/banco fora): a Meta reenvia e a mensagem não se perde.
      if (ehTransitorio(e)) throw e;
      console.warn('[meta-entrada] nascimento falhou (vai pra triagem):', e?.message);
    }
  }
  if (!lead) {
    if (aoVivo) {
      await registrarDescarte('sem-lead-correspondente', {
        phone: telefoneCliente, nome: nomeCliente, inboxId: numero?.cw_inbox_id ?? null,
        linhaUserId: donoDoNumero, sourceId: lida.id,
      });
    }
    return { ignorada: 'sem-lead' };
  }

  const anexos = baixar ? await baixarMidiaMeta(lida.midia, lead.id, numero?.phone_number_id) : [];
  const texto = lida.texto || (lida.midia && !anexos.length ? rotuloDaMidia(lida.midia.tipo) : '');
  const remetente = direcao === 'in'
    ? (nomeCliente || lead.first_name || lead.full_name || null)
    : (await nomeDoUsuario(donoDoNumero)) || 'Se Tu For, Eu Vou';

  const novo = await rest('rpc/qs_wa_ingest_meta', {
    method: 'POST',
    body: {
      p_lead: lead.id,
      p_linha: donoDoNumero,
      p_source: lida.id,
      p_direction: direcao,
      p_content: texto,
      p_attachments: anexos,
      p_sender: remetente,
      p_sent_at: lida.enviadaEm,
      p_status: direcao === 'out' ? 'sent' : null,
      p_reply_to: lida.respondendoA,
      p_reply_prev: null,
      p_inbox: numero?.cw_inbox_id ?? null,
    },
  });
  if (novo !== true || !aoVivo) return { leadId: lead.id, novo: novo === true };

  // CLIENTE DO REL NO CHIP DO COMERCIAL (05/11): 37 mensagens de 9 clientes em
  // 7 dias ficaram só na caixa do SDR. Agora vai também uma cópia pra conversa
  // do cliente no Relacionamento (como histórico: sem SLA, sem resposta
  // automática), dizendo por qual número ele escreveu.
  if (direcao === 'in') {
    await copiarProRelacionamento({ telefoneCliente, nomeCliente, lida, texto, anexos, donoDoNumero })
      .catch((e) => console.warn('[meta-entrada] cópia pro Rel falhou:', e?.message));
  }

  // ── "PARAR" ──────────────────────────────────────────────────────────────
  // Antes de qualquer outra coisa que aconteça com uma mensagem que ENTRA: se a
  // pessoa pediu para sair, isso precisa valer a partir de agora, não a partir
  // da próxima vez que alguém olhar. Quem pede para parar e continua recebendo é
  // quem denuncia — e denúncia derruba a qualidade do número, que derruba o teto
  // diário de todo o resto. Ver a 0087.
  if (direcao === 'in' && texto && ehPedidoDeParada(texto)) {
    const primeiraVez = await registrarOptout(lead.id, texto);
    if (primeiraVez) {
      console.log(`[meta-entrada] lead ${lead.id} pediu para parar: "${String(texto).slice(0, 60)}"`);
    }
  }

  if (direcao === 'out') {
    await completeWhatsAppTask(lead.id, lead.owner_id ?? null)
      .catch((e) => console.warn('[meta-entrada] atividade não concluída:', e?.message));
  }
  let transcrito = null;
  if (direcao === 'in' && lida.midia?.tipo === 'audio' && !lida.texto && anexos[0]?.url && transcricaoConfigurada()) {
    const t = await transcrever(anexos[0].url);
    if (!t?.texto) console.warn(`[meta-entrada] áudio ${lida.id} sem transcrição: ${t?.erro || 'sem resposta'}`);
    if (t?.texto) {
      transcrito = t.texto;
      await rest(`qs_wa_messages?source_id=eq.${encodeURIComponent(lida.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { transcricao: t.texto },
      }).catch(() => {});
    }
  }

  // ── A GLÓRIA (IA) FICA SABENDO ─────────────────────────────────────────
  // Só de mensagem NOVA do cliente, e só com a chave `gloria_ouve_meta` ligada
  // (23/09/2026). A chave existe porque em 23/09 havia 11 sessões "ativas"
  // paradas desde 29/08: ligar a escuta sem aviso faria a IA voltar a falar
  // com esses clientes no mesmo minuto. Quem decide se ela responde continua
  // sendo o banco (sessão ativa) — aqui é só o aviso.
  if (direcao === 'in' && (lida.texto || transcrito) && await gloriaOuveMeta()) {
    await avisarGloria({
      lead,
      telefone: telefoneCliente,
      message: { id: lida.id, content: lida.texto || transcrito, created_at: lida.enviadaEm },
    }).catch((e) => console.warn('[meta-entrada] Glória não avisada:', e?.message));
  }
  return { leadId: lead.id, novo: true };
}

/**
 * Um recibo (✓ ✓✓ azul, falhou) do Comercial. 05/11: o "falhou" agora leva o
 * MOTIVO (coluna erro, 0313) e, se chegar antes da bolha ter sido gravada
 * (corrida com o envio), tenta de novo depois de 2 s em vez de se perder.
 */
async function reciboComercial(st, numero) {
  const s = String(st?.status || '').toLowerCase();
  if (!STATUS_OK.has(s) || !st?.id) return false;
  const aplicar = () => rest('rpc/qs_wa_status_meta', { method: 'POST', body: { p_source: String(st.id), p_status: s } }).catch(() => false);
  let mudou = await aplicar();
  if (s !== 'failed') return mudou === true;

  if (ehMidiaDoClienteQueNaoChegou(st) && mudou !== true) {
    // Arquivo que o CLIENTE tentou mandar e a Meta não entregou (ex.: vídeo de 150 MB).
    await avisoDeArquivoQueNaoChegou(st, numero).catch((e) => console.warn('[meta-entrada] aviso de arquivo:', e?.message));
    return false;
  }
  if (mudou !== true) { await new Promise((r) => setTimeout(r, 2000)); mudou = await aplicar(); }
  const erro = motivoDaFalha(st.errors);
  console.warn(`[meta-entrada] Meta recusou ${st.id}: ${erro}`);
  await rest('rpc/qs_wa_status_erro', { method: 'POST', body: { p_source: String(st.id), p_erro: erro } })
    .catch((e) => console.warn('[meta-entrada] motivo da falha não gravado (0313?):', e?.message));
  return mudou === true;
}

async function avisoDeArquivoQueNaoChegou(st, numero) {
  const fone = String(st.recipient_id || '');
  if (!fone) return;
  const lead = await leadDoTelefone(fone, numero?.user_id || null);
  if (!lead) return;
  await rest('rpc/qs_wa_ingest_meta', {
    method: 'POST',
    body: {
      p_lead: lead.id, p_linha: numero?.user_id || null, p_source: `falha-arquivo:${st.id}`,
      p_direction: 'in', p_content: '⚠️ O cliente tentou mandar um arquivo que não chegou (grande demais, acima de 100 MB, ou expirou). Peça para mandar de novo, menor ou por link.',
      p_attachments: [], p_sender: lead.first_name || lead.full_name || null,
      p_sent_at: Number(st.timestamp) > 0 ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString(),
      p_status: null, p_reply_to: null, p_reply_prev: null, p_inbox: numero?.cw_inbox_id ?? null,
    },
  });
}

let cacheNumeroRel = { em: 0, v: null };
async function numeroDoRelacionamento() {
  if (Date.now() - cacheNumeroRel.em < 10 * 60_000) return cacheNumeroRel.v;
  const r = await rest('qs_wa_numeros_meta?select=phone_number_id&setor=eq.relacionamento&order=conectado_em.desc.nullslast&limit=1');
  cacheNumeroRel = { em: Date.now(), v: r?.[0]?.phone_number_id ? String(r[0].phone_number_id) : null };
  return cacheNumeroRel.v;
}

async function copiarProRelacionamento({ telefoneCliente, nomeCliente, lida, texto, anexos, donoDoNumero }) {
  const cliente = await rest('rpc/rel_cliente_do_telefone', { method: 'POST', body: { p_telefone: String(telefoneCliente) } });
  if (!cliente) return false;
  const phoneRel = await numeroDoRelacionamento();
  if (!phoneRel) return false;
  const quem = donoDoNumero ? `número de ${String((await nomeDoUsuario(donoDoNumero)) || 'um SDR').split(' ')[0]}` : 'número do Comercial';
  const r = await rest('rpc/rel_wa_ingest', {
    method: 'POST',
    body: {
      p_phone_id: phoneRel,
      p_telefone: String(telefoneCliente),
      p_nome: nomeCliente,
      p_wamid: `copia-comercial:${lida.id}`,
      p_direcao: 'in',
      p_origem: 'historico',
      p_texto: `📲 Escreveu no ${quem} (Comercial): ${texto || ''}`.trim(),
      p_anexos: anexos || [],
      p_enviada_em: lida.enviadaEm,
      p_autor: null, p_autor_nome: null, p_status: null, p_resp: null,
    },
  });
  if (r?.nova) console.log(`[meta-entrada] cliente do Rel …${String(telefoneCliente).slice(-4)} escreveu no Comercial — cópia na conversa do Rel`);
  return r?.nova === true;
}

let cacheGloria = { em: 0, v: false };
async function gloriaOuveMeta() {
  if (Date.now() - cacheGloria.em < 60_000) return cacheGloria.v;
  let v = false;
  try {
    const r = await rest('qs_settings?select=value&key=eq.gloria_ouve_meta&limit=1');
    v = r?.[0]?.value === true || r?.[0]?.value === 'true';
  } catch { /* na dúvida, calada */ }
  cacheGloria = { em: Date.now(), v };
  return v;
}

/**
 * Reação que o SDR fez NO CELULAR (eco, 29/09/2026). Mesma gravação da reação
 * pelo QS: autor = o dono do número, uma reação por autor (trocar o emoji
 * substitui, emoji vazio tira). Antes o eco de reação era descartado.
 */
async function reacaoDoSdr(m, numero) {
  const alvo = m?.reaction?.message_id;
  if (!alvo || !numero?.user_id) return false;
  const rows = await rest(
    `qs_wa_messages?select=id&or=${encodeURIComponent(`(source_id.eq."${alvo}",source_id.eq."WAID:${alvo}")`)}&limit=1`
  ).catch(() => null);
  if (!rows?.[0]?.id) return false;
  const nome = String((await nomeDoUsuario(numero.user_id)) || 'SDR').split(' ')[0];
  await rest('rpc/qs_wa_react', {
    method: 'POST',
    body: { p_msg: rows[0].id, p_autor: numero.user_id, p_nome: nome, p_emoji: String(m.reaction.emoji ?? '') },
  }).catch((e) => console.warn('[meta-entrada] reação do SDR:', e?.message));
  return true;
}

async function reacaoDoCliente(m, nomeCliente) {
  const alvo = m?.reaction?.message_id;
  if (!alvo) return false;
  const rows = await rest(
    `qs_wa_messages?select=id&or=${encodeURIComponent(`(source_id.eq."${alvo}",source_id.eq."WAID:${alvo}")`)}&limit=1`
  ).catch(() => null);
  if (!rows?.[0]?.id) return false;
  await rest('rpc/qs_wa_react', {
    method: 'POST',
    body: { p_msg: rows[0].id, p_autor: 'lead', p_nome: (nomeCliente || 'Cliente').split(' ')[0], p_emoji: String(m.reaction.emoji ?? '') },
  }).catch((e) => console.warn('[meta-entrada] reação:', e?.message));
  return true;
}

const STATUS_OK = new Set(['sent', 'delivered', 'read', 'failed']);

/** Banco lento/fora (some com o tempo) → vale pedir à Meta que reenvie. */
export const ehTransitorio = (e) => e?.code === 'TIMEOUT' || e?.code === 'BITRIX_INDISPONIVEL' || e?.status >= 500 || e?.status === 429
  || /fetch failed|ECONNRESET|socket|timeout|não respondeu/i.test(String(e?.message || ''));

/**
 * Pra onde vai a mudança de um número (30/10/2026, 0244). Só o setor
 * 'marketing' muda alguma coisa: QUALQUER outro valor (comercial,
 * relacionamento, nulo, número desconhecido) segue exatamente o caminho de
 * antes. Pura — tests/mkt/roteamento.test.ts prova isso.
 */
export function destinoDoNumero(numero) {
  return numero?.setor === 'marketing' ? 'marketing' : 'antigo';
}

/**
 * Processa as `changes` do webhook que são de mensagem. Nunca lança: o webhook
 * tem que responder 200 pra Meta não entrar em retentativa.
 */
export async function processarMensagensDaMeta(changes) {
  const conta = { recebidas: 0, ecos: 0, historico: 0, recibos: 0, reacoes: 0, semLead: 0, erros: 0, pendentes: 0 };

  for (const ch of changes) {
    const value = ch?.value || {};
    let numero;
    try { numero = await numeroDaMeta(value?.metadata?.phone_number_id); }
    catch (e) {
      // sem saber de quem é o número, não grava em lugar nenhum: a Meta reenvia
      conta.erros++; conta.pendentes++;
      console.error(`[meta-entrada] ${ch.field}: ${e?.message} — fica pra Meta reenviar`);
      continue;
    }
    const nomes = new Map((value.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || null]));

    // Número do MARKETING (0242 + 0244): NUNCA vira lead nem conversa do Rel.
    // Duas peças, cada uma com o seu catch: o funil dos disparos (recibo,
    // "respondeu", PARAR) e o motor das automações. Import dinâmico de
    // propósito: só carrega quando chega mensagem desse número — um erro aqui
    // não tem como derrubar o caminho do Comercial/Rel logo abaixo.
    if (destinoDoNumero(numero) === 'marketing') {
      try {
        const { processarMarketing: funilDosDisparos } = await import('./_mktEntrada.js');
        await funilDosDisparos(ch);
      } catch (e) {
        conta.erros++;
        console.error(`[meta-entrada] marketing/disparos ${ch.field}:`, e?.message);
      }
      try {
        const { processarMarketing } = await import('./_mktAutoEntrada.js');
        const r = await processarMarketing(ch, numero, nomes);
        conta.recebidas += r.recebidas; conta.ecos += r.ecos; conta.recibos += r.recibos; conta.pendentes += r.pendentes || 0;
      } catch (e) {
        conta.erros++;
        console.error(`[meta-entrada] marketing ${ch.field}:`, e?.message);
      }
      continue;
    }

    // Número do RELACIONAMENTO (0101): o pós-venda tem caixa própria. Desvia
    // aqui, antes de qualquer coisa do Comercial — mensagem de cliente que já
    // comprou nunca pode nascer como lead.
    if (numero?.setor === 'relacionamento') {
      try {
        const r = await processarRelacionamento(ch, numero, nomes);
        conta.recebidas += r.recebidas; conta.ecos += r.ecos; conta.historico += r.historico; conta.recibos += r.recibos; conta.pendentes += r.pendentes || 0;
      } catch (e) {
        conta.erros++;
        console.error(`[meta-entrada] relacionamento ${ch.field}:`, e?.message);
      }
      continue;
    }

    try {
      if (ch.field === 'messages') {
        for (const m of value.messages || []) {
          // Uma mensagem ruim não derruba as outras do mesmo lote (05/11).
          try {
            if (m.type === 'reaction') { if (await reacaoDoCliente(m, nomes.get(String(m.from)))) conta.reacoes++; continue; }
            const r = await gravarUma({
              numero, m, direcao: 'in', telefoneCliente: String(m.from || ''), nomeCliente: nomes.get(String(m.from)) || null, aoVivo: true,
            });
            if (r.novo) conta.recebidas++;
            if (r.ignorada === 'sem-lead') conta.semLead++;
            if (r.ignorada === 'sem-conteudo' && m.type !== 'request_welcome') console.warn(`[meta-entrada] mensagem sem conteúdo, tipo=${m.type} id=${m.id}`);
          } catch (e) {
            conta.erros++;
            if (ehTransitorio(e)) conta.pendentes++;
            console.error(`[meta-entrada] mensagem ${m?.id} (${m?.type}) não gravada:`, e?.message);
          }
        }
        for (const st of value.statuses || []) {
          try {
            if (await reciboComercial(st, numero)) conta.recibos++;
          } catch (e) {
            console.warn('[meta-entrada] recibo:', st?.id, e?.message);
          }
        }
      }

      if (ch.field === 'smb_message_echoes') {
        for (const m of value.message_echoes || []) {
          try {
            if (m.type === 'reaction') { if (await reacaoDoSdr(m, numero)) conta.reacoes++; continue; }
            const r = await gravarUma({ numero, m, direcao: 'out', telefoneCliente: String(m.to || ''), nomeCliente: null, aoVivo: true });
            if (r.novo) conta.ecos++;
            if (r.ignorada === 'sem-conteudo') console.warn(`[meta-entrada] eco sem conteúdo, tipo=${m.type} id=${m.id}`);
          } catch (e) {
            conta.erros++;
            if (ehTransitorio(e)) conta.pendentes++;
            console.error(`[meta-entrada] eco ${m?.id} (${m?.type}) não gravado:`, e?.message);
          }
        }
      }

      if (ch.field === 'history') {
        for (const bloco of value.history || []) {
          for (const th of bloco.threads || []) {
            const cliente = String(th.id || '');
            for (const m of th.messages || []) {
              // No histórico, quem mandou é a empresa quando `from` é o próprio número.
              const daEmpresa = String(m.from || '') !== cliente;
              const r = await gravarUma({
                numero, m, direcao: daEmpresa ? 'out' : 'in', telefoneCliente: cliente, nomeCliente: null,
                aoVivo: false, baixar: false,
              });
              if (r.novo) conta.historico++;
            }
          }
        }
      }
    } catch (e) {
      conta.erros++;
      // banco lento/fora: pede reenvio à Meta (o wamid garante que nada duplica)
      if (ehTransitorio(e)) conta.pendentes++;
      console.error(`[meta-entrada] ${ch.field}:`, e?.message);
    }
  }
  return conta;
}
