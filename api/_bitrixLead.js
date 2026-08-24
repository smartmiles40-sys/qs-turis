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
import { waKey } from './_wa.js';

const FUNIL_PRE_VENDAS = 25;
const ETAPA_NOVO_LEAD = 'C25:PREPAYMENT_INVOIC';   // "Novo Lead - Aguardando resposta"
const CAMPO_PRIMEIRO_CONTATO = 'UF_CRM_1767799598309';  // "Primeiro contato Lead" (date)

function base() {
  return (process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
}

export function bitrixConfigurado() {
  return !!base();
}

export async function bx(metodo, params = {}, timeoutMs = 8_000) {
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

/**
 * Acha o contato pelo telefone; cria se não existir. Devolve o ID ou null.
 *
 * `contatoConhecido` é o atalho: quem já perguntou ao Bitrix (o wa-webhook,
 * pelo `procurarNegocioPorTelefone`) passa o id que achou e NÃO paga a busca de
 * novo. Antes esse id era descartado e a busca recomeçava aqui — com UM formato
 * de telefone só, enquanto a de lá tentava oito. Quando o Bitrix guardava o
 * número em outro formato (o caso listado em 18/08), o contato "não existia" e
 * nascia um DUPLICADO ao lado do original.
 */
async function acharOuCriarContato({ nome, telefone, email, contatoConhecido }) {
  if (contatoConhecido) return String(contatoConhecido);

  const fone = String(telefone || '').replace(/\D/g, '');
  if (fone) {
    try {
      // Mesma busca que o Bitrix usa pra apontar duplicado no painel — e com as
      // MESMAS variantes do procurarNegocioPorTelefone (com 55, sem 55, com e
      // sem o 9 do celular). O findbycomm aceita a lista inteira de uma vez.
      const dup = await bx('crm.duplicate.findbycomm', {
        entity_type: 'CONTACT', type: 'PHONE', values: variantesDeTelefone(telefone),
      });
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

// ── PERGUNTAR AO BITRIX ANTES DE CRIAR (Bruno, 20/08) ───────────────────────
//
// Quando um número desconhecido escreve na linha oficial, a pergunta certa não é
// "crio ou descarto?" — é "essa pessoa já existe lá?".
//
// A medição de 13/08 (docs/WHATSAPP-SEM-LEAD.md, 50 números reais) explica por
// quê: 13 deles JÁ ESTAVAM no Bitrix (cliente antigo do Comercial, pós-venda) e
// só 5 eram gente nova. Criar card pros 13 foi exatamente o que sujou o funil em
// 18/08. Achando o negócio que já existe, o lead nasce no QS AMARRADO nele:
// ninguém duplica e o cliente para de ficar invisível.
//
// O telefone é procurado em VÁRIOS formatos de propósito. "Cliente já cadastrado
// com telefone em outro formato" foi uma das causas listadas em 18/08 — o Bitrix
// guarda ora com 55, ora sem, ora com o 9 do celular, ora sem.

/** 55+DDD+9+8, 55+DDD+8, DDD+9+8 e DDD+8 — todas as formas plausíveis do mesmo número. */
export function variantesDeTelefone(raw) {
  const chave = waKey(raw);                    // DDD + 8 dígitos (ou "i:…" se for de fora)
  const cru = String(raw || '').replace(/\D/g, '');
  const fora = new Set();
  if (cru) fora.add(cru);
  if (chave && !chave.startsWith('i:')) {
    const ddd = chave.slice(0, 2);
    const oito = chave.slice(2);
    fora.add(`55${ddd}9${oito}`);
    fora.add(`55${ddd}${oito}`);
    fora.add(`${ddd}9${oito}`);
    fora.add(`${ddd}${oito}`);
  }
  return [...fora].slice(0, 8);   // o findbycomm aceita lista; 8 cobre tudo sem abusar
}

/**
 * Procura, pelo telefone, um contato e o negócio mais recente dele no Bitrix.
 *
 * Devolve SEMPRE um objeto, e a distinção importa mais do que parece:
 *
 *   { achou: true,  dealId, contatoId, deal }  → é cliente conhecido
 *   { achou: false }                           → perguntei, e não existe lá
 *   { indisponivel: true, motivo }             → NÃO CONSEGUI PERGUNTAR
 *
 * "Não existe" e "não consegui perguntar" nunca podem virar a mesma coisa. Se
 * o Bitrix cair e os dois se confundirem, o QS volta a criar card às cegas pra
 * todo mundo que escreve — exatamente a sujeira de 18/08, só que disfarçada de
 * indisponibilidade. Quem chama trata `indisponivel` como "não decide agora".
 *
 * Timeout curto de propósito: isto roda no caminho do webhook, que tem 10s no
 * total na Vercel. Bitrix lento não pode atrasar a entrada da mensagem.
 */
export async function procurarNegocioPorTelefone(phone, timeoutMs = 4_000) {
  if (!bitrixConfigurado()) return { indisponivel: true, motivo: 'sem BITRIX_WEBHOOK_BASE' };
  const valores = variantesDeTelefone(phone);
  if (!valores.length) return { achou: false };

  try {
    const dup = await bx('crm.duplicate.findbycomm', {
      entity_type: 'CONTACT', type: 'PHONE', values: valores,
    }, timeoutMs);
    const contatoId = Array.isArray(dup?.CONTACT) ? dup.CONTACT[0] : null;
    if (!contatoId) return { achou: false };

    // O negócio mais recente desse contato. Pode não ter nenhum (contato solto
    // no Bitrix): nesse caso devolvemos o contato mesmo assim, pra reaproveitar
    // no crm.deal.add em vez de criar um contato duplicado.
    let deal = null;
    try {
      const deals = await bx('crm.deal.list', {
        filter: { CONTACT_ID: contatoId },
        select: ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
        order: { DATE_CREATE: 'DESC' },
      }, timeoutMs);
      deal = (Array.isArray(deals) && deals[0]) || null;
    } catch (e) {
      console.warn('[bitrix-lead] negócios do contato:', e?.message);
    }

    return {
      achou: true,
      contatoId: String(contatoId),
      dealId: deal?.ID ? String(deal.ID) : null,
      deal,
    };
  } catch (e) {
    console.warn('[bitrix-lead] busca por telefone falhou:', e?.message);
    return { indisponivel: true, motivo: e?.message || 'erro no Bitrix' };
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
  const contatoId = await acharOuCriarContato({
    nome, telefone: lead.phone, email: lead.email, contatoConhecido: lead.bitrix_contato_id,
  });
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
 * Escreve um comentário na timeline de um negócio.
 *
 * É o que leva a conversa de WhatsApp pro card (ver api/wa-bitrix-digest.js).
 * Devolve o id do comentário, ou null — nunca estoura: o resumo é enfeite pro
 * Comercial, e falhar aqui não pode derrubar o job nem o atendimento.
 */
export async function comentarNoNegocio(dealId, texto, timeoutMs = 8_000) {
  if (!bitrixConfigurado() || !dealId || !texto) return null;
  try {
    const id = await bx('crm.timeline.comment.add', {
      fields: { ENTITY_ID: Number(dealId), ENTITY_TYPE: 'deal', COMMENT: texto },
    }, timeoutMs);
    return id ? String(id) : null;
  } catch (e) {
    console.warn(`[bitrix-lead] comentário no negócio ${dealId}:`, e?.message);
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
