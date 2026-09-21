// api/oportunidade-futura.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): OPORTUNIDADE FUTURA (0083, 21/09/2026).
//
//   POST { acao: 'registrar', leadId, retomarEm: 'AAAA-MM-DD', quem: 'sdr'|'closer',
//          responsavelId?, motivo, meetingId? }      → closer / gestão
//   POST { acao: 'cancelar', id }                     → quem registrou / gestão
//   POST { acao: 'devolver-agora', id }               → closer / gestão (antecipa)
//   POST { acao: 'processar' }                        → qualquer usuário logado ("carona")
//   GET  (Vercel Cron, Authorization: Bearer CRON_SECRET) → processa as vencidas
//
// O QUE ACONTECE
//   Registrar  → atividades abertas do lead encerradas, nota na ficha, card do
//                Bitrix na coluna "Oportunidade futura" (Comercial 1) + comentário.
//   No dia     → quem=sdr:    lead volta a ser do SDR (QS e Bitrix), card em
//                             Pré-Vendas › Follow-up 1
//                quem=closer: card em Comercial 1 › Em Negociação
//                e nos dois: atividade na fila de quem retoma, com o motivo.
//
// Tudo que fala com o Bitrix é best-effort: Bitrix fora do ar não impede o QS
// de registrar nem de devolver o lead — o resultado fica gravado em
// bitrix_ida/bitrix_volta pra quem for conferir.
// -----------------------------------------------------------------------------

import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';
import { bx, bitrixConfigurado, comentarNoNegocio, passarNegocioPara } from './_bitrixLead.js';

// Colunas lidas do portal em 21/09/2026 (crm.dealcategory.stage.list).
// Se alguém recriar a coluna no Bitrix, o id muda: atualizar AQUI.
export const COLUNA = {
  oportunidade: { categoria: 0,  etapa: 'UC_PV9OAM',     nome: 'Comercial 1 › Oportunidade futura' },
  closer:       { categoria: 0,  etapa: 'UC_YGG9JY',     nome: 'Comercial 1 › Em Negociação' },
  sdr:          { categoria: 25, etapa: 'C25:UC_271QUB', nome: 'Pré-Vendas › Follow-up 1' },
};

const PODE_REGISTRAR = new Set(['admin', 'gestor', 'closer']);

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Hoje em Brasília, AAAA-MM-DD. (Nada de `date AT TIME ZONE` — erra 6h.) */
export function hojeEmBrasilia(agora = Date.now()) {
  return new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
}

function dataBr(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

async function usuario(id) {
  if (!id) return null;
  const r = await rest(`qs_users?select=id,name,role,is_active&id=eq.${encodeURIComponent(id)}&limit=1`);
  return (Array.isArray(r) && r[0]) || null;
}

/** O SDR que trouxe este lead: o dono, se for SDR; senão o último que passou o lead adiante. */
async function sdrDoLead(lead) {
  const dono = await usuario(lead.owner_id);
  if (dono?.role === 'sdr' && dono.is_active !== false) return dono;
  const hist = await rest(
    `qs_handovers?select=from_user_id&lead_id=eq.${encodeURIComponent(lead.id)}&order=created_at.desc&limit=20`
  );
  for (const h of hist || []) {
    const u = await usuario(h.from_user_id);
    if (u?.role === 'sdr' && u.is_active !== false) return u;
  }
  return null;
}

/** Muda funil + coluna juntos (mudar só um deixa o card num estado que a tela do Bitrix não mostra). */
async function moverCard(dealId, destino) {
  if (!bitrixConfigurado()) return 'sem Bitrix configurado';
  if (!dealId) return 'lead sem card no Bitrix';
  try {
    await bx('crm.deal.update', {
      id: Number(dealId),
      fields: { CATEGORY_ID: destino.categoria, STAGE_ID: destino.etapa },
      params: { REGISTER_SONET_EVENT: 'Y' },
    });
    return `movido para ${destino.nome}`;
  } catch (e) {
    return `Bitrix recusou: ${String(e?.message || e).slice(0, 160)}`;
  }
}

async function comentar(dealId, texto) {
  if (!bitrixConfigurado() || !dealId) return;
  try { await comentarNoNegocio(dealId, texto); } catch { /* comentário é enfeite */ }
}

async function nota(leadId, autorId, texto) {
  try {
    await insert('qs_notes', { lead_id: leadId, author_id: autorId ?? null, body: texto, tags: ['oportunidade-futura'] }, { returning: false });
  } catch (e) {
    console.warn('[of] nota não gravada:', e?.message);
  }
}

// ── Registrar ────────────────────────────────────────────────────────────────

export async function registrar(eu, body) {
  const leadId = String(body.leadId || '').trim();
  const retomarEm = String(body.retomarEm || '').trim();
  const quem = body.quem === 'closer' ? 'closer' : body.quem === 'sdr' ? 'sdr' : null;
  const motivo = String(body.motivo || '').trim();

  if (!leadId) return [400, { error: 'leadId obrigatório' }];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retomarEm) || Number.isNaN(Date.parse(retomarEm))) {
    return [400, { error: 'Escolha a data da retomada.' }];
  }
  if (retomarEm <= hojeEmBrasilia()) return [400, { error: 'A data da retomada tem que ser depois de hoje.' }];
  if (!quem) return [400, { error: 'Escolha quem retoma: SDR ou closer.' }];
  if (motivo.length < 10) return [400, { error: 'Conte em uma frase o que o cliente disse (mínimo 10 letras).' }];

  const acesso = await assertCanAccessLead(eu.id, leadId);
  if (!acesso.ok) return [403, { error: 'Sem acesso a este lead.' }];
  const lead = (await rest(`qs_leads?select=id,owner_id,full_name,bitrix_id&id=eq.${encodeURIComponent(leadId)}&limit=1`))?.[0];
  if (!lead) return [404, { error: 'Lead não encontrado.' }];

  // Quem retoma.
  let responsavel = null;
  if (body.responsavelId) {
    responsavel = await usuario(String(body.responsavelId));
    const papelOk = quem === 'sdr' ? responsavel?.role === 'sdr' : ['closer', 'admin', 'gestor'].includes(responsavel?.role);
    if (!responsavel || responsavel.is_active === false || !papelOk) {
      return [400, { error: quem === 'sdr' ? 'Escolha um SDR ativo.' : 'Escolha um closer ativo.' }];
    }
  } else if (quem === 'sdr') {
    responsavel = await sdrDoLead(lead);
    if (!responsavel) return [400, { error: 'Não achei o SDR que trouxe este lead — escolha o SDR na lista.', motivo: 'sem-sdr' }];
  } else {
    responsavel = eu.role === 'closer' ? eu : await usuario(lead.owner_id);
    if (!responsavel) return [400, { error: 'Escolha o closer que vai retomar.' }];
  }

  // Uma aberta por lead: a nova substitui a anterior.
  await rest(`qs_oportunidades_futuras?lead_id=eq.${lead.id}&status=eq.aguardando`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelada', updated_at: new Date().toISOString() },
  });

  const [of] = await rest('qs_oportunidades_futuras', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      lead_id: lead.id,
      meeting_id: body.meetingId || null,
      criado_por: eu.id,
      retomar_em: retomarEm,
      quem,
      responsavel_id: responsavel.id,
      motivo,
    },
  });

  // Atividades abertas saem da fila: o cliente pediu pra esperar, e cobrança
  // até lá seria o time ligando pra quem disse "agora não".
  await rest(`qs_tasks?lead_id=eq.${lead.id}&status=in.(pendente,atrasada)`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { status: 'ignorada', skip_reason: `Oportunidade futura — retomar em ${dataBr(retomarEm)}` },
  }).catch((e) => console.warn('[of] atividades não encerradas:', e?.message));

  const quemTexto = `${responsavel.name} (${quem === 'sdr' ? 'SDR' : 'closer'})`;
  await nota(lead.id, eu.id,
    `🔁 Oportunidade futura registrada por ${eu.name}.\nRetomar em ${dataBr(retomarEm)} com ${quemTexto}.\nMotivo: ${motivo}`);

  const ida = await moverCard(lead.bitrix_id, COLUNA.oportunidade);
  await comentar(lead.bitrix_id,
    `🔁 OPORTUNIDADE FUTURA (pelo QS, ${eu.name})\nRetomar em ${dataBr(retomarEm)} com ${quemTexto}.\nMotivo: ${motivo}`);
  await rest(`qs_oportunidades_futuras?id=eq.${of.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { bitrix_ida: ida },
  }).catch(() => {});

  return [200, { ok: true, id: of.id, retomarEm, responsavel: { id: responsavel.id, name: responsavel.name }, bitrix: ida }];
}

// ── Devolver (no dia, ou antecipado) ─────────────────────────────────────────

/**
 * Devolve UMA oportunidade. A trava é o PATCH condicional
 * (status=aguardando → devolvendo): o cron e a carona podem rodar juntos, e só
 * um deles ganha a linha — sem isso o SDR receberia duas atividades.
 */
export async function devolver(ofId) {
  const travada = await rest(`qs_oportunidades_futuras?id=eq.${ofId}&status=eq.aguardando`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'devolvendo', updated_at: new Date().toISOString() },
  });
  const of = Array.isArray(travada) && travada[0];
  if (!of) return { id: ofId, pulada: 'ja-processada' };

  try {
    const lead = (await rest(`qs_leads?select=id,owner_id,full_name,bitrix_id&id=eq.${of.lead_id}&limit=1`))?.[0];
    const resp = await usuario(of.responsavel_id);
    if (!lead || !resp) throw new Error('lead ou responsável sumiu');

    // 1) O lead volta pro SDR (dono de novo = vê lead, conversa e fila).
    if (of.quem === 'sdr' && lead.owner_id !== resp.id) {
      await rest(`qs_leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { owner_id: resp.id } });
      await insert('qs_handovers', {
        lead_id: lead.id, from_user_id: lead.owner_id, to_user_id: resp.id,
        briefing: `Oportunidade futura: ${of.motivo}`,
      }, { returning: false }).catch((e) => console.warn('[of] handover não registrado:', e?.message));
    }

    // 2) A atividade na fila de quem retoma. `re_contato` é a marca que faz a
    //    fila mostrar a atividade mesmo com o lead "ganho"/"perdido" — sem ela,
    //    a tarefa existiria e ninguém veria.
    const [task] = await rest('qs_tasks', {
      method: 'POST', prefer: 'return=representation',
      body: {
        lead_id: lead.id,
        owner_id: resp.id,
        channel_type: 'whatsapp',
        status: 'pendente',
        priority: 'alta',
        scheduled_at: `${of.retomar_em}T09:00:00-03:00`,
        is_extra: true,
        tags: ['re_contato', 'oportunidade-futura'],
        notes: `🔁 Oportunidade futura — ${of.quem === 'sdr' ? 'rechamar' : 'retomar a negociação'}.\nO que o cliente disse: ${of.motivo}`,
      },
    });

    // 3) O card no Bitrix.
    let volta = await moverCard(lead.bitrix_id, of.quem === 'sdr' ? COLUNA.sdr : COLUNA.closer);
    if (of.quem === 'sdr' && lead.bitrix_id) {
      const p = await passarNegocioPara(lead.bitrix_id, resp.id);
      if (!p.passado) volta += ` · responsável não trocado (${p.motivo})`;
    }
    await comentar(lead.bitrix_id,
      `🔁 OPORTUNIDADE FUTURA chegou no dia (${dataBr(of.retomar_em)}) — volta para ${resp.name}.\nMotivo: ${of.motivo}`);
    await nota(lead.id, null, `🔁 Oportunidade futura devolvida para ${resp.name} (${of.quem === 'sdr' ? 'SDR' : 'closer'}). Atividade criada na fila.`);

    await rest(`qs_oportunidades_futuras?id=eq.${of.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'devolvida', devolvida_em: new Date().toISOString(), task_id: task?.id ?? null, bitrix_volta: volta, updated_at: new Date().toISOString() },
    });
    return { id: of.id, devolvida: true, bitrix: volta };
  } catch (e) {
    // Solta a trava: a próxima rodada tenta de novo, em vez de a oportunidade
    // ficar presa em "devolvendo" pra sempre.
    console.error('[of] devolução falhou:', of.id, e?.message);
    await rest(`qs_oportunidades_futuras?id=eq.${of.id}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'aguardando', bitrix_volta: `falhou: ${String(e?.message).slice(0, 160)}` },
    }).catch(() => {});
    return { id: of.id, erro: e?.message };
  }
}

/** Todas as que venceram (retomar_em <= hoje em Brasília). Teto por rodada. */
export async function processarVencidas(teto = 20) {
  const vencidas = await rest(
    `qs_oportunidades_futuras?select=id&status=eq.aguardando&retomar_em=lte.${hojeEmBrasilia()}&order=retomar_em.asc&limit=${teto}`
  );
  const resultado = [];
  for (const v of vencidas || []) resultado.push(await devolver(v.id));
  return resultado;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Vercel Cron: GET com o Bearer do CRON_SECRET.
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });
    try {
      const r = await processarVencidas();
      return res.status(200).json({ ok: true, processadas: r.length, resultado: r });
    } catch (e) {
      console.error('[of] cron:', e?.message);
      return res.status(500).json({ error: e?.message });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });
  const eu = await usuario(userId).catch(() => null);
  if (!eu || eu.is_active === false) return res.status(403).json({ error: 'Usuário inativo.' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  try {
    if (acao === 'processar') {
      const r = await processarVencidas(10);
      return res.status(200).json({ ok: true, processadas: r.length });
    }

    if (!PODE_REGISTRAR.has(eu.role)) {
      return res.status(403).json({ error: 'Só closer, gestor ou admin registra oportunidade futura.' });
    }

    if (acao === 'registrar') {
      const [status, out] = await registrar(eu, body);
      return res.status(status).json(out);
    }

    const id = String(body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id obrigatório' });

    if (acao === 'cancelar') {
      const r = await rest(`qs_oportunidades_futuras?id=eq.${encodeURIComponent(id)}&status=eq.aguardando`, {
        method: 'PATCH', prefer: 'return=representation', body: { status: 'cancelada', updated_at: new Date().toISOString() },
      });
      const of = Array.isArray(r) && r[0];
      if (!of) return res.status(409).json({ error: 'Esta oportunidade já foi devolvida ou cancelada.' });
      await nota(of.lead_id, eu.id, `🔁 Oportunidade futura de ${dataBr(of.retomar_em)} cancelada por ${eu.name}.`);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'devolver-agora') {
      const r = await devolver(id);
      if (r.pulada) return res.status(409).json({ error: 'Esta oportunidade já foi devolvida ou cancelada.' });
      if (r.erro) return res.status(502).json({ error: `Não consegui devolver: ${r.erro}` });
      return res.status(200).json({ ok: true, bitrix: r.bitrix });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[of]', acao, e?.message);
    if (/qs_oportunidades_futuras|PGRST205|42P01/i.test(String(e?.message))) {
      return res.status(503).json({ error: 'Falta aplicar a migration 0083 no banco.' });
    }
    return res.status(500).json({ error: 'Não consegui salvar. Tente de novo.' });
  }
}
