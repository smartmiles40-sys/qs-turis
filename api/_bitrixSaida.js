// api/_bitrixSaida.js
// -----------------------------------------------------------------------------
// SAÍDA QS → Bitrix SEM n8n (03/11/2026, dia do corte do n8n).
//
// Antes, `ganho` e `reuniao` saíam do /api/bitrix-sync para os webhooks
// `qs-ganho` / `qs-reuniao` do n8n (n8n/qs-bitrix-completo.workflow.json), e o
// catálogo de campos (bitrix_fields) era alimentado pelo robô diário
// n8n/qs-sync-catalogo-bitrix.workflow.json. Agora os três falam direto com o
// Bitrix pela env BITRIX_WEBHOOK_BASE — a mesma que primeiro-contato, nota,
// perdido e reuniao-campos já usavam desde agosto.
//
// As regras (o que vai em cada campo, o texto do comentário) estão em
// api/_bitrixSaidaRegras.js, sem rede, pra poder testar.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { bx, comentarNoNegocio, bitrixConfigurado } from './_bitrixLead.js';
import {
  ETAPA_GANHO, montarGanho, montarCatalogo, montarReuniao, marcaDeSincronizada, montarLinhasCatalogo,
} from './_bitrixSaidaRegras.js';

const enc = encodeURIComponent;

/**
 * crm.deal.update com UMA nova tentativa quando a falha foi de rede/tempo.
 * O nó do n8n tinha "Retry on fail"; recusa do Bitrix (err.bitrix) não se
 * repete — mandar de novo o mesmo campo inválido dá o mesmo erro.
 */
async function atualizarNegocio(id, fields, { timeoutMs = 8_000, sonet = false } = {}) {
  const params = { id: Number(id), fields, ...(sonet ? { params: { REGISTER_SONET_EVENT: 'Y' } } : {}) };
  try {
    return await bx('crm.deal.update', params, timeoutMs);
  } catch (err) {
    if (err?.bitrix) throw err;
    return await bx('crm.deal.update', params, timeoutMs);
  }
}

// ─── GANHO ───────────────────────────────────────────────────────────────────

/**
 * Mesmo fluxo do n8n: (se houver o que gravar) crm.deal.update → comentário.
 * O update seguia em frente mesmo com erro (continueRegularOutput), então o
 * comentário sai de qualquer jeito. Devolve { ok, code }.
 */
export async function gravarGanhoNoBitrix({ bitrixId, closedValue, fullName }, { timeoutMs = 7_000 } = {}) {
  if (!bitrixConfigurado()) return { ok: false, code: 'not_configured' };
  const g = montarGanho({ bitrixId, closedValue, fullName }, ETAPA_GANHO);
  if (!g) return { ok: false, code: 'sem-bitrix-id' };

  let gravou = !g.mexeNoCard;
  if (g.mexeNoCard) {
    try {
      await atualizarNegocio(g.id, g.fields, { timeoutMs, sonet: true });
      gravou = true;
    } catch (err) {
      console.error('[bitrix-saida] ganho: crm.deal.update recusou', g.id, ':', err?.message);
    }
  }
  const comentou = await comentarNoNegocio(g.id, g.comentario, timeoutMs);
  if (!gravou && !comentou) return { ok: false, code: 'bitrix-recusou' };
  return { ok: true, code: gravou ? (g.mexeNoCard ? 'gravado' : 'comentado') : 'so_comentario' };
}

// ─── CATÁLOGO (leitura) ──────────────────────────────────────────────────────

let cacheCatalogo = null; // { valor, em }
const CATALOGO_TTL_MS = 5 * 60_000;

/** Lê o de-para apelido → UF_CRM_* e as opções das listas (bitrix_fields). */
export async function carregarCatalogo() {
  if (cacheCatalogo && Date.now() - cacheCatalogo.em < CATALOGO_TTL_MS) return cacheCatalogo.valor;
  const [campos, opcoes] = await Promise.all([
    rest('bitrix_fields?select=alias,field_name,user_type_id&alias=not.is.null'),
    rest('v_opcoes_por_alias?select=alias,option_id,value'),
  ]);
  const valor = montarCatalogo(campos, opcoes);
  cacheCatalogo = { valor, em: Date.now() };
  return valor;
}

// ─── REUNIÃO ─────────────────────────────────────────────────────────────────

/** Grava em qs_meetings (best-effort). `leadId` amarra a linha ao lead. */
async function marcarReuniao(meetingId, leadId, body) {
  if (!meetingId) return;
  const filtro = `id=eq.${enc(meetingId)}` + (leadId ? `&lead_id=eq.${enc(leadId)}` : '');
  try {
    await rest(`qs_meetings?${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body });
  } catch (err) {
    console.warn('[bitrix-saida] não deu pra marcar a reunião', meetingId, ':', err?.message);
  }
}

/**
 * A reunião vai pro card: crm.deal.update com os campos do catálogo +
 * comentário na timeline + bitrix_synced/bitrix_error na reunião.
 *
 * Igual ao webhook `qs-reuniao` do n8n, nó por nó:
 *   Buscar de-para + Buscar opções → Montar reunião → Gravar reunião no card
 *     ├─ ok   → Comentário da reunião → Marcar reunião sincronizada → { ok: true }
 *     └─ erro → Marcar reunião com erro → { ok: false } (era o 502 do n8n)
 *
 * `body.lead_id`, quando vem, amarra o PATCH da reunião ao lead — o n8n
 * marcava por meeting_id puro, e o meeting_id vinha do navegador.
 */
export async function enviarReuniaoDireto(body, { timeoutMs = 8_000 } = {}) {
  if (!bitrixConfigurado()) return { ok: false, code: 'not_configured', erro: 'BITRIX_WEBHOOK_BASE ausente' };

  let catalogo;
  try {
    catalogo = await carregarCatalogo();
  } catch (err) {
    return { ok: false, erro: `catálogo de campos ilegível: ${err?.message || 'falhou'}`.slice(0, 200) };
  }

  const m = montarReuniao(body, catalogo);
  if (!m.ok) return { ok: false, erro: m.erro };

  const meetingId = m.meetingId;
  const leadId = body?.lead_id || null;

  try {
    await atualizarNegocio(m.dealId, m.fields, { timeoutMs });
  } catch (err) {
    const erro = `Bitrix recusou: ${err?.message || 'falhou'}`.slice(0, 900);
    console.error('[bitrix-saida] reunião: crm.deal.update', m.dealId, ':', err?.message);
    await marcarReuniao(meetingId, leadId, { bitrix_synced: false, bitrix_error: erro });
    return { ok: false, status: 502, erro: erro.slice(0, 200) };
  }

  await comentarNoNegocio(m.dealId, m.comentario, timeoutMs);
  await marcarReuniao(meetingId, leadId, marcaDeSincronizada(m.pulados));
  return { ok: true, resposta: { ok: true, deal_id: m.dealId, nao_preenchidos: m.pulados } };
}

// ─── CATÁLOGO (escrita — o robô diário) ──────────────────────────────────────

/**
 * crm.deal.userfield.list. O n8n fazia UMA chamada e o banco tem 245 campos,
 * então hoje o portal devolve tudo de uma vez. Se um dia vier paginado (de 50
 * em 50), pede a próxima página — e para quando ela não trouxer campo novo,
 * pra nunca gravar o mesmo FIELD_NAME duas vezes no upsert (o Postgres recusa
 * o lote inteiro com "cannot affect row a second time").
 */
async function listarCamposDoNegocio() {
  const porNome = new Map();
  for (let start = 0, i = 0; i < 20; i++, start += 50) {
    const pagina = await bx('crm.deal.userfield.list', { start, order: { SORT: 'ASC' } }, 15_000);
    if (!Array.isArray(pagina) || !pagina.length) break;
    let novos = 0;
    for (const f of pagina) {
      if (f?.FIELD_NAME && !porNome.has(f.FIELD_NAME)) { porNome.set(f.FIELD_NAME, f); novos++; }
    }
    if (!novos || pagina.length !== 50) break;
  }
  return [...porNome.values()];
}

/**
 * Lê os campos personalizados do negócio no Bitrix e guarda em bitrix_fields /
 * bitrix_field_options. Mesmo efeito do workflow qs-sync-catalogo-bitrix:
 * upsert dos campos (sem tocar no `alias`), upsert das opções e desativação
 * das opções que não vieram nesta rodada.
 */
export async function sincronizarCatalogo() {
  if (!bitrixConfigurado()) return { ok: false, code: 'not_configured' };

  const lista = await listarCamposDoNegocio();
  if (!lista.length) throw new Error('crm.deal.userfield.list voltou sem campos');
  let dicionario = {};
  try {
    dicionario = (await bx('crm.deal.fields', {}, 20_000)) || {};
  } catch (err) {
    // Sem rótulo ainda dá pra gravar (o rótulo cai no EDIT_FORM_LABEL).
    console.warn('[bitrix-saida] crm.deal.fields falhou (segue sem rótulos):', err?.message);
  }

  const runTs = new Date().toISOString();
  const { campos, opcoes, semRotulo } = montarLinhasCatalogo(lista, dicionario, runTs);

  await rest('bitrix_fields?on_conflict=field_name', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: campos, timeoutMs: 20_000,
  });
  if (opcoes.length) {
    await rest('bitrix_field_options?on_conflict=field_name,option_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: opcoes, timeoutMs: 20_000,
    });
  }
  // Só desativa depois que as duas gravações acima deram certo — senão uma
  // falha no meio apagava todas as opções da lista.
  await rest(`bitrix_field_options?synced_at=lt.${enc(runTs)}&active=is.true`, {
    method: 'PATCH', prefer: 'return=minimal', body: { active: false },
  });
  cacheCatalogo = null;

  return {
    ok: true,
    campos: campos.length,
    opcoes: opcoes.length,
    aviso: semRotulo ? `${semRotulo} campos ficaram sem rótulo legível` : null,
  };
}
