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

const GRAPH = 'https://graph.facebook.com/v20.0';

// ── De quem é o número ──────────────────────────────────────────────────────

const cacheNumeros = new Map();
async function numeroDaMeta(phoneNumberId) {
  const k = String(phoneNumberId || '');
  const hit = cacheNumeros.get(k);
  if (hit && Date.now() - hit.em < 5 * 60_000) return hit.v;
  let v = null;
  try {
    const r = await rest(`qs_wa_numeros_meta?select=phone_number_id,user_id,rotulo,cw_inbox_id&phone_number_id=eq.${encodeURIComponent(k)}&limit=1`);
    v = r?.[0] || null;
  } catch (e) {
    console.warn('[meta-entrada] não li qs_wa_numeros_meta:', e?.message);
  }
  cacheNumeros.set(k, { v, em: Date.now() });
  return v;
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
    texto = `👤 Contato: ${m.contacts?.[0]?.name?.formatted_name || ''}`.trim();
  } else if (tipo === 'template') {
    // Eco de um modelo mandado pelo app/API — o corpo nem sempre vem.
    texto = m.template?.name ? `📨 Modelo: ${m.template.name}` : null;
  }
  if (!texto && !midia) return null;

  const ts = Number(m.timestamp);
  return {
    id: String(m.id || ''),
    texto: texto ? String(texto) : '',
    midia,
    enviadaEm: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    respondendoA: m.context?.id ? String(m.context.id) : null,
  };
}

/** Baixa a mídia da Meta (id → URL assinada → bytes) e guarda no QS. */
async function baixarMidiaMeta(midia, leadId, phoneId = null) {
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
    return url ? [{ type: midia.tipo, url }] : [];
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

/**
 * Processa as `changes` do webhook que são de mensagem. Nunca lança: o webhook
 * tem que responder 200 pra Meta não entrar em retentativa.
 */
export async function processarMensagensDaMeta(changes) {
  const conta = { recebidas: 0, ecos: 0, historico: 0, recibos: 0, reacoes: 0, semLead: 0, erros: 0 };

  for (const ch of changes) {
    const value = ch?.value || {};
    const numero = await numeroDaMeta(value?.metadata?.phone_number_id);
    const nomes = new Map((value.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || null]));

    try {
      if (ch.field === 'messages') {
        for (const m of value.messages || []) {
          if (m.type === 'reaction') { if (await reacaoDoCliente(m, nomes.get(String(m.from)))) conta.reacoes++; continue; }
          const r = await gravarUma({
            numero, m, direcao: 'in', telefoneCliente: String(m.from || ''), nomeCliente: nomes.get(String(m.from)) || null, aoVivo: true,
          });
          if (r.novo) conta.recebidas++;
          if (r.ignorada === 'sem-lead') conta.semLead++;
        }
        for (const st of value.statuses || []) {
          const s = String(st.status || '').toLowerCase();
          if (!STATUS_OK.has(s) || !st.id) continue;
          const mudou = await rest('rpc/qs_wa_status_meta', { method: 'POST', body: { p_source: String(st.id), p_status: s } }).catch(() => false);
          if (mudou === true) conta.recibos++;
        }
      }

      if (ch.field === 'smb_message_echoes') {
        for (const m of value.message_echoes || []) {
          const r = await gravarUma({ numero, m, direcao: 'out', telefoneCliente: String(m.to || ''), nomeCliente: null, aoVivo: true });
          if (r.novo) conta.ecos++;
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
      console.error(`[meta-entrada] ${ch.field}:`, e?.message);
    }
  }
  return conta;
}
