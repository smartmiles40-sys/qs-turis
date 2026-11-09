// api/_mktEntrada.js
// -----------------------------------------------------------------------------
// WEBHOOK DO NÚMERO DO MARKETING (0242, 30/10/2026).
//
// O número do Marketing fica na MESMA WABA do QS, então a Meta manda os
// eventos dele pro mesmo webhook (api/_metaEntrada.js). Lá, ANTES de qualquer
// coisa do Comercial, o evento desse número é desviado pra cá — resposta a
// disparo de Marketing NUNCA pode nascer como lead nem cair no chat de um SDR.
//
// O que faz:
//   • recibo (sent/delivered/read/failed) → anda o funil do envio (por wamid);
//   • mensagem recebida → o envio vira "respondeu", vai pra linha do tempo do
//     contato e tira a pessoa das sequências que param ao responder;
//   • "PARAR" (ou o botão "Parar de receber") → opt-out do contato (cria a
//     ficha se não houver: o pedido precisa ficar guardado).
// O que NÃO faz: responder a pessoa (não há caixa de atendimento do Marketing
// ainda) nem tocar em lead, cadência ou Bitrix.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { avancarStatus, ehParadaMkt, textoDaMensagem, variantesTelefone, normalizarTelefoneMkt } from './_mktRegras.js';
import { classificarErroMeta, cobrancaDoRecibo } from './_mktOficialRegras.js';
import { patchEnvioMkt } from './_mktDisparoOficial.js';

let cache = { id: null, em: 0 };

/**
 * O phone_number_id é o do Marketing? Lê qs_settings.mkt_disparo_numero
 * (cache de 2 min). Se a leitura falhar, responde false — o evento segue o
 * caminho de hoje (igual a um número que o QS não conhece).
 */
export async function ehNumeroDoMarketing(phoneNumberId) {
  const k = String(phoneNumberId || '');
  if (!k) return false;
  if (Date.now() - cache.em > 2 * 60_000) {
    try {
      const v = (await rest('qs_settings?select=value&key=eq.mkt_disparo_numero&limit=1', { timeoutMs: 6000 }))?.[0]?.value;
      cache = { id: String(v?.phone_number_id || '') || null, em: Date.now() };
    } catch {
      // Banco lento: guarda o que já sabia por mais 30 s (não trava cada webhook).
      cache = { id: cache.id, em: Date.now() - 90_000 };
    }
  }
  return Boolean(cache.id) && cache.id === k;
}

const desde7d = () => new Date(Date.now() - 7 * 86_400_000).toISOString();

async function contatoDoTelefone(tel) {
  const r = await rest(`mkt_contatos?select=id,nome,optout_whatsapp_em&telefone=in.(${variantesTelefone(tel).join(',')})&limit=1`).catch(() => null);
  return r?.[0] || null;
}

async function evento(contatoId, tipo, dados) {
  if (!contatoId) return;
  await rest('mkt_contato_eventos', { method: 'POST', prefer: 'return=minimal', body: { contato_id: contatoId, tipo, dados } }).catch(() => null);
}

/** Envios do Marketing pra este telefone nos últimos 7 dias (com e sem o 9). */
async function enviosRecentes(tel) {
  const r = await rest(
    `qs_disparo_envios?select=id,status,contato_id,inscricao_id,campanha_id,qs_disparo_campanhas!inner(setor,nome)` +
    `&qs_disparo_campanhas.setor=eq.marketing&simulado=eq.false&telefone=in.(${variantesTelefone(tel).join(',')})` +
    `&enviado_em=gte.${encodeURIComponent(desde7d())}&order=enviado_em.desc&limit=20`
  ).catch(() => []);
  return r || [];
}

export async function processarMarketing(ch) {
  const value = ch?.value || {};
  const conta = { recibos: 0, respostas: 0, optouts: 0 };
  if (ch?.field !== 'messages') return conta;
  const agora = new Date().toISOString();

  // ── Recibos ──
  // 0341: guarda também o código do erro e a cobrança (`pricing`) — é daí que
  // saem "falhou por quê" e o custo estimado da campanha. O pricing vem no
  // sent OU no delivered/read: grava mesmo quando o status não anda.
  for (const st of value.statuses || []) {
    if (!st?.id) continue;
    const e = (await rest(`qs_disparo_envios?select=id,status,contato_id,campanha_id&wamid=eq.${encodeURIComponent(String(st.id))}&limit=1`).catch(() => null))?.[0];
    if (!e) continue;
    const cob = cobrancaDoRecibo(st);
    const novo = avancarStatus(e.status, st.status);
    if (!novo) {
      if (cob) await patchEnvioMkt(e.id, cob);
      continue;
    }
    const patch = { status: novo, ...(cob || {}) };
    if (novo === 'entregue') patch.entregue_em = agora;
    if (novo === 'lido') { patch.lido_em = agora; patch.entregue_em = patch.entregue_em || agora; }
    let k = null;
    if (novo === 'erro') {
      const er = st.errors?.[0] || {};
      k = classificarErroMeta(er.code, er.error_data?.details || er.title || er.message);
      patch.motivo = k.motivo.slice(0, 300);
      patch.erro_codigo = k.codigo;
    }
    await patchEnvioMkt(e.id, patch, `&status=eq.${e.status}`);
    await evento(e.contato_id, `disparo_${novo === 'erro' ? 'erro' : novo === 'lido' ? 'lido' : 'entregue'}`, { campanha_id: e.campanha_id, wamid: st.id, codigo: st.errors?.[0]?.code || null });
    // Falha que é da CAMPANHA (modelo pausado, número restrito) pausa a fila;
    // "desligou o marketing" (131050) tira a pessoa da base de envio.
    if (k?.acao === 'parar' && e.campanha_id) {
      await rest(`qs_disparo_campanhas?id=eq.${e.campanha_id}&status=eq.enviando`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: agora, ultimo_erro: k.motivo.slice(0, 300) },
      }).catch(() => null);
    }
    if (k?.acao === 'optout' && e.contato_id) {
      await rest(`mkt_contatos?id=eq.${e.contato_id}&optout_whatsapp_em=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { optout_whatsapp_em: agora } }).catch(() => null);
    }
    conta.recibos++;
  }

  // ── Mensagens recebidas ──
  const nomes = new Map((value.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || null]));
  for (const m of value.messages || []) {
    const tel = normalizarTelefoneMkt(m.from);
    if (!tel) continue;
    const texto = textoDaMensagem(m);
    const parar = ehParadaMkt(texto);
    let contato = await contatoDoTelefone(tel);

    if (parar) {
      if (contato && !contato.optout_whatsapp_em) {
        await rest(`mkt_contatos?id=eq.${contato.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { optout_whatsapp_em: agora } });
      } else if (!contato) {
        const novo = await rest('mkt_contatos?on_conflict=telefone', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
          body: { telefone: tel, nome: nomes.get(String(m.from)) || null, origem: 'whatsapp_parar', optout_whatsapp_em: agora },
        }).catch(() => null);
        contato = novo?.[0] || null;
      }
      conta.optouts++;
    }

    const envios = await enviosRecentes(tel);
    for (const e of envios) {
      if (['respondeu', 'erro', 'pulado', 'cancelado', 'pendente'].includes(e.status)) continue;
      await rest(`qs_disparo_envios?id=eq.${e.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'respondeu', respondeu_em: agora } }).catch(() => null);
    }
    const cid = contato?.id || envios.find((e) => e.contato_id)?.contato_id || null;
    await evento(cid, 'respondeu', { texto: texto.slice(0, 300), wamid: m.id || null, parar, campanha: envios[0]?.qs_disparo_campanhas?.nome || null });

    // Sequências: PARAR tira de todas; resposta tira das que param ao responder.
    const ativas = await rest(
      `mkt_disparo_sequencia_inscricoes?select=id,contato_id,sequencia_id,mkt_disparo_sequencias!inner(parar_se_responder)` +
      `&status=eq.ativa&telefone=in.(${variantesTelefone(tel).join(',')})`
    ).catch(() => []);
    for (const i of ativas || []) {
      if (!parar && !i.mkt_disparo_sequencias?.parar_se_responder) continue;
      await rest(`mkt_disparo_sequencia_inscricoes?id=eq.${i.id}&status=eq.ativa`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'saiu', motivo: parar ? 'pediu PARAR' : 'respondeu', atualizado_em: agora },
      }).catch(() => null);
      await evento(i.contato_id || cid, 'sequencia_saiu', { sequencia_id: i.sequencia_id, motivo: parar ? 'optout' : 'respondeu' });
    }
    conta.respostas++;
  }
  return conta;
}
