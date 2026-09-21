// api/_waLinhaEntrada.js
// -----------------------------------------------------------------------------
// O que fazer com cada evento que a Evolution manda de um NÚMERO DE SDR (0082).
// Chamado pelo /api/wa-evolution-webhook (ao vivo) e pelo /api/wa-linha
// (importação do histórico) — os dois gravam do mesmo jeito.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { waKey, completeWhatsAppTask, reabrirPorFalha } from './_wa.js';
import { registrarDescarte, nascerDoWhatsApp } from './_waNascimento.js';
import { transcrever, transcricaoConfigurada } from './_transcrever.js';
import {
  lerMensagem, ehConversaIgnorada, baixarMidia, rotuloDaMidia, gravarNaLinha, statusDaEvolution,
} from './_waLinha.js';

const LEAD_COLS = 'id,owner_id,full_name,first_name,phone';

/**
 * O lead deste telefone, olhando pelo número do SDR. Com telefone repetido em
 * dois cards (existem ~68), prefere o card DO DONO DO NÚMERO — é com ele que a
 * pessoa está falando. Sem card dele, o mais recente (regra do findLeadByPhone).
 */
export async function leadDoTelefone(phone, donoDaLinha) {
  const key = waKey(phone);
  if (!key) return null;
  const rows = await rest(
    `qs_leads?select=${LEAD_COLS}&phone=ilike.*${encodeURIComponent(key.slice(-8))}*&order=updated_at.desc&limit=20`
  );
  const mesmos = (Array.isArray(rows) ? rows : []).filter((l) => waKey(l.phone) === key);
  return mesmos.find((l) => l.owner_id === donoDaLinha) || mesmos[0] || null;
}

const cacheNomes = new Map();
async function nomeDoUsuario(userId) {
  if (cacheNomes.has(userId)) return cacheNomes.get(userId);
  let nome = null;
  try {
    const u = await rest(`qs_users?select=name&id=eq.${encodeURIComponent(userId)}&limit=1`);
    nome = u?.[0]?.name || null;
  } catch { /* segue sem nome */ }
  cacheNomes.set(userId, nome);
  return nome;
}

/**
 * Uma mensagem (nova ou do histórico) que passou pelo número do SDR.
 * `aoVivo` false = importação: não nasce lead, não mexe em atividade e não
 * transcreve (histórico de semanas não pode disparar nada disso).
 */
export async function receberDaLinha(linha, item, { aoVivo = true, baixarArquivos = true, lead: leadConhecido = null } = {}) {
  const lida = lerMensagem(item);
  if (!lida || !lida.id) return { ignorada: 'sem-conteudo' };
  if (ehConversaIgnorada(lida.remoteJid)) return { ignorada: 'grupo-ou-status' };

  if (!lida.telefone && !leadConhecido) {
    if (aoVivo) {
      await registrarDescarte('sem-telefone', {
        linhaUserId: linha.user_id, sourceId: lida.id, nome: lida.nomeContato,
        detalhe: `jid ${lida.remoteJid}`,
      });
    }
    return { ignorada: 'sem-telefone' };
  }

  let lead = leadConhecido || await leadDoTelefone(lida.telefone, linha.user_id);

  if (!lead && aoVivo && !lida.fromMe) {
    const dono = await nomeDoUsuario(linha.user_id);
    try {
      lead = await nascerDoWhatsApp({
        phone: lida.telefone, nome: lida.nomeContato, direcao: 'in', inboxId: null,
        ownerId: linha.user_id, canal: `número ${dono ? 'de ' + dono.split(' ')[0] : 'do SDR'}`,
      });
    } catch (e) {
      console.warn('[wa-linha] nascimento pelo WhatsApp falhou (vai pra triagem):', e?.message);
    }
  }
  if (!lead) {
    if (aoVivo) {
      await registrarDescarte('sem-lead-correspondente', {
        phone: lida.telefone, nome: lida.nomeContato, linhaUserId: linha.user_id, sourceId: lida.id,
      });
    }
    return { ignorada: 'sem-lead' };
  }

  const anexos = baixarArquivos ? await baixarMidia(linha.instancia, lida, lead.id) : [];
  const texto = lida.texto || (lida.midia && !anexos.length ? rotuloDaMidia(lida.midia.tipo) : '');
  const remetente = lida.fromMe
    ? await nomeDoUsuario(linha.user_id)
    : (lida.nomeContato || lead.first_name || lead.full_name || null);

  const novo = await gravarNaLinha({
    leadId: lead.id,
    linhaUserId: linha.user_id,
    sourceId: lida.id,
    direcao: lida.fromMe ? 'out' : 'in',
    texto,
    anexos,
    remetente,
    enviadaEm: lida.enviadaEm,
    status: lida.fromMe ? (statusDaEvolution(item?.status) || 'sent') : null,
    respondendoA: lida.respondendoA,
    trechoCitado: lida.trechoCitado,
  });

  if (!novo || !aoVivo) return { leadId: lead.id, novo };

  // Resposta mandada pelo CELULAR também conta como atendimento — mesma regra
  // do webhook do Chatwoot. A função só encosta em tarefa `pendente`.
  if (lida.fromMe) {
    await completeWhatsAppTask(lead.id, lead.owner_id ?? null)
      .catch((e) => console.warn('[wa-linha] atividade não concluída:', e?.message));
  }

  // Áudio do cliente vira texto, como no número oficial.
  if (!lida.fromMe && lida.midia?.tipo === 'audio' && !lida.texto && anexos[0]?.url && transcricaoConfigurada()) {
    const t = await transcrever(anexos[0].url);
    if (t?.texto) {
      await rest(
        `qs_wa_messages?linha_user_id=eq.${linha.user_id}&source_id=eq.${encodeURIComponent(lida.id)}`,
        { method: 'PATCH', prefer: 'return=minimal', body: { transcricao: t.texto } }
      ).catch((e) => console.warn('[wa-linha] transcrição não gravada:', e?.message));
    }
  }

  return { leadId: lead.id, novo };
}

/** ✓ → ✓✓ → azul. Falha reabre a atividade que a mensagem tinha fechado. */
export async function recibosDaLinha(linha, itens) {
  let n = 0;
  for (const d of itens) {
    const status = statusDaEvolution(d?.status ?? d?.update?.status);
    const source = String(d?.keyId || d?.key?.id || '').trim();
    if (!status || !source) continue;
    try {
      const mudou = await rest('rpc/qs_wa_status_linha', {
        method: 'POST', body: { p_linha: linha.user_id, p_source: source, p_status: status },
      });
      if (mudou === true) n += 1;
      if (mudou === true && status === 'failed') {
        const m = await rest(
          `qs_wa_messages?select=lead_id,sent_at,lead:qs_leads(owner_id)&linha_user_id=eq.${linha.user_id}` +
          `&source_id=eq.${encodeURIComponent(source)}&limit=1`
        );
        const msg = m?.[0];
        if (msg) {
          const lead = Array.isArray(msg.lead) ? msg.lead[0] : msg.lead;
          await reabrirPorFalha(msg.lead_id, lead?.owner_id ?? null, msg.sent_at);
        }
      }
    } catch (e) {
      console.warn('[wa-linha] recibo não gravado:', e?.message);
    }
  }
  return n;
}

/** O cliente (ou o SDR, no celular) apagou pra todos. Só carimba — o texto fica. */
export async function apagadaNaLinha(linha, item) {
  const p = item?.message?.protocolMessage;
  const alvo = p?.key?.id;
  const ehRevoke = p && (p.type === 0 || String(p.type).toUpperCase() === 'REVOKE');
  if (!ehRevoke || !alvo) return false;
  try {
    const rows = await rest(
      `qs_wa_messages?select=id&linha_user_id=eq.${linha.user_id}&source_id=eq.${encodeURIComponent(alvo)}&limit=1`
    );
    if (!rows?.[0]?.id) return false;
    await rest('rpc/qs_wa_apagar', { method: 'POST', body: { p_msg: rows[0].id, p_user: null } });
    return true;
  } catch (e) {
    console.warn('[wa-linha] marcar apagada:', e?.message);
    return false;
  }
}
