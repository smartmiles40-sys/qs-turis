// api/closer.js
// -----------------------------------------------------------------------------
// ÁREA DO CLOSER (0174–0176, 22/10/2026) — o que precisa de servidor.
//
//   POST { acao: 'espelhar', negocioId }
//        → a VENDA CONSOLIDADA vai pro Bitrix: crm.deal.update do negócio do
//          lead (qs_leads.bitrix_id) com o valor (OPPORTUNITY) e a etapa de
//          venda realizada do funil em que o card está. "QS manda, Bitrix
//          espelha" (Bruno, 22/10).
//
// IDEMPOTENTE: lê o card antes; se valor e etapa já batem, não regrava nada.
// O comentário na timeline só sai quando alguma coisa mudou. Pode apertar
// "reenviar" quantas vezes quiser.
//
// FALHOU? O erro fica no cartão (qs_closer_negocios.bitrix_status = 'erro' +
// bitrix_erro) e a tela mostra o botão "Reenviar ao Bitrix". A venda no QS já
// está gravada — o Bitrix é só o espelho.
//
// Env: BITRIX_WEBHOOK_BASE (a mesma do resto do QS), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Nada novo.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado, comentarNoNegocio } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICO = {
  expedicao: 'Expedição', pacote: 'Pacote', aereo: 'Aéreo', hospedagem: 'Hospedagem', passeio: 'Passeio',
  cruzeiro: 'Cruzeiro', seguro: 'Seguro', concierge: 'Concierge', conta_liminar: 'Conta liminar', outro: 'Outro',
};
const FORMA = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', link: 'Link de pagamento', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outra' };

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID_RE.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return u?.is_active ? u : null;
}

/** Mesma regra do banco (closer_pode_mexer): gestor do Comercial/admin, ou o closer dono. */
function podeMexer(u, negocio) {
  if (u.role === 'admin') return true;
  if (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('comercial')) return true;
  return u.role === 'closer' && negocio.closer_id === u.id;
}

/** A etapa de "venda realizada" do funil do card. Comercial 1 (categoria 0) = WON. */
async function etapaDeVenda(categoria) {
  const cat = String(categoria ?? '0');
  if (cat === '0') return 'WON';
  try {
    const etapas = await bx('crm.status.list', { filter: { ENTITY_ID: `DEAL_STAGE_${cat}` } }, 8_000);
    const lista = etapas || [];
    const porNome = lista.find((e) => /venda\s+realizada/i.test(String(e?.NAME || '')));
    if (porNome) return String(porNome.STATUS_ID);
    const sucesso = lista.find((e) => ['S', 'success'].includes(e?.EXTRA?.SEMANTICS || e?.SEMANTICS));
    return sucesso ? String(sucesso.STATUS_ID) : null;
  } catch {
    return null;
  }
}

function resumoDaFicha(f, parcelas) {
  const linhas = [
    '✅ VENDA CONSOLIDADA no QS (o QS é a fonte da verdade desta venda).',
    `Serviço: ${SERVICO[f?.servico] || f?.servico || '—'}${f?.destino ? ` — ${f.destino}` : ''}`,
    `Datas: ${dataBr(f?.data_ida)} → ${dataBr(f?.data_volta)} · Passageiros: ${f?.qtd_passageiros || '—'}`,
    `Valor total: ${brl(f?.valor_total)}`,
  ];
  if (parcelas.length) {
    linhas.push('Plano de pagamento:');
    for (const p of parcelas) {
      linhas.push(`• ${p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`}: ${brl(p.valor)} — vence ${dataBr(p.vencimento)} — ${FORMA[p.forma] || p.forma}${p.recorrente ? ' (recorrente)' : ''}`);
    }
  }
  return linhas.join('\n');
}

async function marcar(negocioId, campos, evento, autorId) {
  await rest(`qs_closer_negocios?id=eq.${negocioId}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
  if (evento) {
    await rest('qs_closer_negocio_eventos', {
      method: 'POST', prefer: 'return=minimal',
      body: { negocio_id: negocioId, tipo: 'bitrix', texto: evento, autor_id: autorId || null },
    }).catch(() => null);
  }
}

async function espelhar(negocioId, u) {
  const n = (await rest(`qs_closer_negocios?select=id,lead_id,closer_id,etapa,ficha,valor_previsto,bitrix_status&id=eq.${negocioId}&limit=1`))?.[0];
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.etapa !== 'consolidada') return { status: 409, body: { error: 'A venda ainda não foi consolidada.' } };

  const lead = (await rest(`qs_leads?select=id,bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '');
  if (!dealId) {
    await marcar(n.id, { bitrix_status: 'sem_card', bitrix_erro: 'O lead não tem negócio no Bitrix.' });
    return { status: 200, body: { ok: false, status: 'sem_card', mensagem: 'Este cliente não tem card no Bitrix — a venda ficou só no QS.' } };
  }

  try {
    const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000);
    if (!deal) throw new Error(`Negócio ${dealId} não encontrado no Bitrix.`);
    const valor = Number(n.ficha?.valor_total ?? n.valor_previsto ?? 0);
    const alvo = await etapaDeVenda(deal.CATEGORY_ID);
    const fields = {};
    if (valor > 0 && Math.abs(Number(deal.OPPORTUNITY || 0) - valor) > 0.009) {
      fields.OPPORTUNITY = valor;
      fields.CURRENCY_ID = 'BRL';
    }
    if (alvo && String(deal.STAGE_ID) !== alvo) fields.STAGE_ID = alvo;

    if (Object.keys(fields).length) {
      await bx('crm.deal.update', { id: Number(dealId), fields, params: { REGISTER_SONET_EVENT: 'Y' } }, 8_000);
      const parcelas = (await rest(`fin_planos?select=fin_parcelas(numero,valor,vencimento,forma,recorrente)&negocio_id=eq.${n.id}&limit=1`).catch(() => null))?.[0]?.fin_parcelas || [];
      parcelas.sort((a, b) => a.numero - b.numero);
      await comentarNoNegocio(dealId, resumoDaFicha(n.ficha, parcelas));
    }
    const nota = Object.keys(fields).length
      ? `Bitrix atualizado (negócio ${dealId}): ${fields.STAGE_ID ? 'etapa de venda realizada' : ''}${fields.STAGE_ID && fields.OPPORTUNITY ? ' + ' : ''}${fields.OPPORTUNITY ? `valor ${brl(valor)}` : ''}.`
      : `Bitrix já estava certo (negócio ${dealId}) — nada regravado.`;
    await marcar(n.id, {
      bitrix_status: 'ok',
      bitrix_erro: alvo ? null : 'Funil sem etapa de venda realizada: só o valor foi enviado.',
      bitrix_enviado_em: new Date().toISOString(),
    }, nota, u.id);
    return { status: 200, body: { ok: true, status: 'ok', mudou: Object.keys(fields), dealId } };
  } catch (e) {
    const msg = String(e?.message || 'Falhou').slice(0, 500);
    console.error('[closer] espelhar', n.id, msg);
    await marcar(n.id, { bitrix_status: 'erro', bitrix_erro: msg }, `Bitrix recusou: ${msg}`, u.id).catch(() => null);
    return { status: 200, body: { ok: false, status: 'erro', mensagem: msg } };
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Entre de novo no QS.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(req.query?.acao || body.acao || '');

  try {
    if (acao === 'espelhar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      const id = String(body.negocioId || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cartão inválido.' });
      const r = await espelhar(id, u);
      return res.status(r.status).json(r.body);
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[closer]', e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
