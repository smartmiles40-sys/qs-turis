// api/_bitrixLead.js
// -----------------------------------------------------------------------------
// LEAD QUE NASCE NO QS TAMBÉM NASCE NO BITRIX.
//
// O buraco (medido em 18/08): desde que a caixa oficial passou a criar card
// sozinha, 20 leads existiam só no QS — inclusive a "Paula". Eles entravam pela
// mensagem de WhatsApp, ganhavam dono e cadência, e o comercial não via nada no
// Bitrix. O plano anterior era um workflow no n8n; isto aqui não depende dele:
// fala direto com o Bitrix, no mesmo momento da criação.
//
// Onde o negócio nasce: funil 25 ("Pré-Vendas - Comercial"), etapa
// C25:PREPAYMENT_INVOIC ("Novo Lead - Aguardando resposta") — lido do portal, é
// exatamente onde caem os leads que já vêm de fora hoje.
//
// BEST-EFFORT, SEMPRE: se o Bitrix estiver fora, o lead entra no QS do mesmo
// jeito e fica sem vínculo (o mesmo estado de antes). Perder o atendimento por
// causa do CRM seria trocar um problema por um pior.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const FUNIL_PRE_VENDAS = 25;
const ETAPA_NOVO_LEAD = 'C25:PREPAYMENT_INVOIC';   // "Novo Lead - Aguardando resposta"
const CAMPO_PRIMEIRO_CONTATO = 'UF_CRM_1767799598309';  // "Primeiro contato Lead" (date)

function base() {
  return (process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
}

export function bitrixConfigurado() {
  return !!base();
}

async function bx(metodo, params = {}, timeoutMs = 8_000) {
  const url = `${base()}/${metodo}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => null);
    if (j?.error) {
      const err = new Error(j.error_description || j.error);
      err.bitrix = j.error;
      throw err;
    }
    return j?.result;
  } finally {
    clearTimeout(timer);
  }
}

// ── Responsável: o dono do lead no QS vira o responsável no Bitrix ───────────
// O casamento é por E-MAIL (conferido em 18/08: bate para todos os SDRs,
// closers e gestor). Sem correspondente, o negócio nasce sem responsável — o
// Bitrix atribui ao dono do webhook, que é o comportamento de hoje.

let cacheUsuarios = null;   // { porEmail: Map, em: number }

async function usuariosDoBitrix() {
  if (cacheUsuarios && Date.now() - cacheUsuarios.em < 10 * 60_000) return cacheUsuarios.porEmail;
  const porEmail = new Map();
  try {
    let start = 0;
    for (let i = 0; i < 10; i++) {
      const lista = await bx('user.get', { start, FILTER: { ACTIVE: true } });
      for (const u of (lista || [])) {
        const e = String(u.EMAIL || '').toLowerCase().trim();
        if (e) porEmail.set(e, u.ID);
      }
      if (!lista || lista.length < 50) break;
      start += 50;
    }
  } catch (e) {
    console.warn('[bitrix-lead] não consegui listar usuários:', e?.message);
  }
  cacheUsuarios = { porEmail, em: Date.now() };
  return porEmail;
}

async function responsavelNoBitrix(ownerId) {
  if (!ownerId) return null;
  try {
    const rows = await rest(`qs_users?select=email&id=eq.${encodeURIComponent(ownerId)}&limit=1`);
    const email = String(rows?.[0]?.email || '').toLowerCase().trim();
    if (!email) return null;
    return (await usuariosDoBitrix()).get(email) ?? null;
  } catch {
    return null;
  }
}

// ── Contato ─────────────────────────────────────────────────────────────────

/** Acha o contato pelo telefone; cria se não existir. Devolve o ID ou null. */
async function acharOuCriarContato({ nome, telefone, email }) {
  const fone = String(telefone || '').replace(/\D/g, '');
  if (fone) {
    try {
      // Mesma busca que o Bitrix usa pra apontar duplicado no painel.
      const dup = await bx('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type: 'PHONE', values: [fone] });
      const achado = Array.isArray(dup?.CONTACT) ? dup.CONTACT[0] : null;
      if (achado) return achado;
    } catch (e) {
      console.warn('[bitrix-lead] busca de duplicado falhou (segue criando):', e?.message);
    }
  }
  try {
    return await bx('crm.contact.add', {
      fields: {
        NAME: nome || `WhatsApp ${fone.slice(-8)}`,
        ...(fone ? { PHONE: [{ VALUE: fone, VALUE_TYPE: 'WORK' }] } : {}),
        ...(email ? { EMAIL: [{ VALUE: email, VALUE_TYPE: 'WORK' }] } : {}),
        OPENED: 'Y',
      },
      params: { REGISTER_SONET_EVENT: 'N' },
    });
  } catch (e) {
    console.error('[bitrix-lead] criar contato:', e?.message);
    return null;
  }
}

// ── O negócio ───────────────────────────────────────────────────────────────

/**
 * Cria contato + negócio no Bitrix para um lead do QS e devolve o id do negócio.
 * Devolve null quando não deu — e isso NUNCA é motivo pra falhar a criação do
 * lead: quem chama trata como enfeite, não como requisito.
 */
export async function criarNegocioParaLead(lead) {
  if (!bitrixConfigurado() || !lead?.id) return null;

  const nome = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null;
  const contatoId = await acharOuCriarContato({ nome, telefone: lead.phone, email: lead.email });
  const assignedTo = await responsavelNoBitrix(lead.owner_id);

  const campos = {
    TITLE: nome ? `${nome}` : `WhatsApp ${String(lead.phone || '').slice(-8)}`,
    CATEGORY_ID: FUNIL_PRE_VENDAS,
    STAGE_ID: ETAPA_NOVO_LEAD,
    TYPE_ID: 'SALE',
    CURRENCY_ID: 'BRL',
    OPENED: 'Y',
    ...(contatoId ? { CONTACT_ID: contatoId } : {}),
    ...(assignedTo ? { ASSIGNED_BY_ID: assignedTo } : {}),
    // Quando o cliente falou com a gente pela primeira vez — o QS sabe disso e o
    // Bitrix usa esse campo pra medir tempo de resposta.
    [CAMPO_PRIMEIRO_CONTATO]: String(lead.arrived_at || lead.created_at || new Date().toISOString()).slice(0, 10),
    // De onde veio, em texto: o comercial precisa saber que este card nasceu de
    // uma mensagem no WhatsApp e não de um formulário.
    COMMENTS: `Criado pelo QS a partir de ${lead.segment || 'contato no WhatsApp'}.` +
      (lead.phone ? ` Telefone: ${lead.phone}.` : ''),
  };

  try {
    const dealId = await bx('crm.deal.add', { fields: campos, params: { REGISTER_SONET_EVENT: 'N' } });
    return dealId ? String(dealId) : null;
  } catch (e) {
    console.error('[bitrix-lead] criar negócio:', e?.message);
    return null;
  }
}

/**
 * Cria o negócio e já grava o vínculo no lead. Usada logo depois que o QS cria
 * um lead sem `bitrix_id`. Devolve o id, ou null se não rolou.
 */
export async function vincularLeadAoBitrix(lead) {
  try {
    const dealId = await criarNegocioParaLead(lead);
    if (!dealId) return null;
    await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
      method: 'PATCH',
      body: { bitrix_id: dealId },
      prefer: 'return=minimal',
    });
    console.log(`[bitrix-lead] lead ${lead.id} agora é o negócio ${dealId} no Bitrix`);
    return dealId;
  } catch (e) {
    console.warn('[bitrix-lead] vínculo falhou:', e?.message);
    return null;
  }
}
