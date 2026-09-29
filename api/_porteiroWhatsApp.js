// api/_porteiroWhatsApp.js
// -----------------------------------------------------------------------------
// PORTEIRO DO 1935: quem JÁ está em conversa não ganha negócio novo.
//
// O problema (29/09): o 1935 foi conectado ao ChatApp/WhatCRM no Bitrix. A
// linha aberta cria um negócio para CADA conversa — inclusive de quem já tem
// negócio andando. Dois motivos, os dois medidos:
//   • telefone em outro formato (sem o 9, sem o 55): o Bitrix não reconhece o
//     contato e cria outro (Lucia: 556196708984 × 5561996708984);
//   • mesmo reconhecendo o contato, a linha abre negócio novo (Marcelo).
// O negócio novo chega ao QS pelo n8n e vira card NOVO com SDR e cadência —
// até cliente GANHO com closer caiu na fila de SDR.
//
// Regra (Bruno, 29/09):
//   • "em conversa" = tem OUTRO negócio ABERTO ou GANHO no Bitrix
//     (STAGE_SEMANTIC_ID P ou S), fora dos funis que só rastreiam (33, 21). Perdido que volta a
//     escrever ganha card normalmente — é chance de reativar.
//   • o negócio novo vai pra "perdido" do funil dele com comentário
//     "Duplicado" apontando o original (nada é apagado — dá pra desfazer), e o
//     original recebe um comentário avisando que o cliente voltou a escrever.
//   • no QS, NÃO nasce card novo.
//
// Só olha negócio das fontes do 1935 (lista em qs_settings.porteiro_whatsapp,
// com padrão abaixo). Formulário de LP e live seguem como sempre.
//
// Bitrix fora do ar / erro → deixa passar (comportamento antigo). Lead pago
// perdido não tem desfazer; duplicado tem.
// -----------------------------------------------------------------------------

import { bx, bitrixConfigurado, variantesDeTelefone, comentarNoNegocio } from './_bitrixLead.js';
import { rest } from './_supabaseAdmin.js';

// "WhatsApp - Agencia Se tu for, eu vou" — a linha do 1935 no WhatCRM/ChatApp.
const FONTES_PADRAO = ['1|BITRIX_WHATCRM_NET_70680444'];

// Funis que só RASTREIAM, não são conversa: 33 "Tecnologia" (todo inscrito de
// live ganha card lá, e fica aberto) e 21 "Marketing - Agencia". Contar esses
// barraria quem assistiu uma live e depois chamou no 1935 — gente quente.
const FUNIS_IGNORADOS_PADRAO = ['33', '21'];

/** { ligado, fontes, funisIgnorados } — chave `porteiro_whatsapp` em qs_settings desliga sem deploy. */
export async function lerConfigPorteiro() {
  try {
    const rows = await rest('qs_settings?select=value&key=eq.porteiro_whatsapp&limit=1');
    const v = Array.isArray(rows) && rows[0] && typeof rows[0].value === 'object' ? rows[0].value : {};
    return {
      ligado: v.ligado !== false,
      fontes: Array.isArray(v.fontes) && v.fontes.length ? v.fontes.map(String) : FONTES_PADRAO,
      funisIgnorados: Array.isArray(v.funis_ignorados) ? v.funis_ignorados.map(String) : FUNIS_IGNORADOS_PADRAO,
    };
  } catch {
    return { ligado: true, fontes: FONTES_PADRAO, funisIgnorados: FUNIS_IGNORADOS_PADRAO };
  }
}

function etapaPerdida(categoria) {
  const c = Number(categoria || 0);
  return c > 0 ? `C${c}:LOSE` : 'LOSE';
}

/**
 * Decide se o negócio `dealId` é duplicado de alguém já em conversa.
 *
 *   { aplicavel:false, motivo }                 → não é do 1935 / desligado
 *   { duplicado:false }                         → gente nova, segue o fluxo
 *   { duplicado:true, original, novo }          → já está em conversa
 *   { indisponivel:true, motivo }               → não consegui perguntar
 *
 * Não escreve nada. Quem aplica é `marcarComoDuplicado`.
 */
export async function conferirDuplicado(dealId, { phone, cfg } = {}) {
  if (!dealId) return { aplicavel: false, motivo: 'sem-bitrix-id' };
  if (!bitrixConfigurado()) return { indisponivel: true, motivo: 'sem BITRIX_WEBHOOK_BASE' };
  cfg = cfg || await lerConfigPorteiro();
  if (!cfg.ligado) return { aplicavel: false, motivo: 'desligado' };

  try {
    const novo = await bx('crm.deal.get', { id: Number(dealId) }, 5_000);
    if (!novo) return { indisponivel: true, motivo: 'negocio-nao-encontrado' };
    if (!cfg.fontes.includes(String(novo.SOURCE_ID || ''))) {
      return { aplicavel: false, motivo: 'outra-fonte' };
    }

    // Todos os contatos com esse telefone (em qualquer formato) + o do próprio
    // negócio. Duplicado por formato gera CONTATOS diferentes — olhar só o
    // contato do negócio novo não acharia o original.
    const contatos = new Set();
    if (novo.CONTACT_ID && String(novo.CONTACT_ID) !== '0') contatos.add(String(novo.CONTACT_ID));
    let fone = phone;
    if (!fone && novo.CONTACT_ID && String(novo.CONTACT_ID) !== '0') {
      const c = await bx('crm.contact.get', { id: Number(novo.CONTACT_ID) }, 5_000);
      fone = c?.PHONE?.[0]?.VALUE;
    }
    const valores = variantesDeTelefone(fone);
    if (valores.length) {
      const dup = await bx('crm.duplicate.findbycomm', {
        entity_type: 'CONTACT', type: 'PHONE', values: valores,
      }, 5_000);
      for (const id of (Array.isArray(dup?.CONTACT) ? dup.CONTACT : [])) contatos.add(String(id));
    }
    if (!contatos.size) return { duplicado: false, novo };

    const deals = await bx('crm.deal.list', {
      filter: { CONTACT_ID: [...contatos], '!ID': Number(dealId), STAGE_SEMANTIC_ID: ['P', 'S'] },
      select: ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'SOURCE_ID'],
      order: { DATE_CREATE: 'DESC' },
    }, 5_000);
    const ignorados = new Set(cfg.funisIgnorados || FUNIS_IGNORADOS_PADRAO);
    const lista = (Array.isArray(deals) ? deals : []).filter((d) => !ignorados.has(String(d.CATEGORY_ID)));
    // Negócio criado DEPOIS deste (mesma rajada da linha aberta) não é o
    // "original": o mais antigo da rajada é que sobrevive.
    const anteriores = lista.filter((d) => Number(d.ID) < Number(dealId));
    if (!anteriores.length) return { duplicado: false, novo };
    // Prefere um ABERTO (é onde a conversa está andando); senão o ganho.
    const original = anteriores.find((d) => d.STAGE_SEMANTIC_ID === 'P') || anteriores[0];
    return { duplicado: true, original, novo };
  } catch (e) {
    console.warn(`[porteiro] negócio ${dealId}:`, e?.message);
    return { indisponivel: true, motivo: e?.message || 'erro no Bitrix' };
  }
}

/** Move o novo pra perdido + comentários nos dois. Best-effort em cada passo. */
export async function marcarComoDuplicado({ novo, original }) {
  const r = { movido: false };
  try {
    await bx('crm.deal.update', {
      id: Number(novo.ID),
      fields: { STAGE_ID: etapaPerdida(novo.CATEGORY_ID) },
      params: { REGISTER_SONET_EVENT: 'N' },
    }, 6_000);
    r.movido = true;
  } catch (e) {
    r.erro = e?.message;
    console.warn(`[porteiro] mover ${novo.ID} pra perdido:`, e?.message);
  }
  await comentarNoNegocio(novo.ID,
    `DUPLICADO — esta pessoa já está em conversa no negócio #${original.ID} ` +
    `(etapa ${original.STAGE_ID}). O WhatsApp 1935 abriu este negócio sozinho; ` +
    `o QS moveu pra perdido. Continue o atendimento no #${original.ID}.`);
  await comentarNoNegocio(original.ID,
    `O cliente voltou a escrever pelo WhatsApp 1935. A linha abriu o negócio ` +
    `#${novo.ID}, que foi marcado como DUPLICADO — a conversa segue aqui.`);
  return r;
}
