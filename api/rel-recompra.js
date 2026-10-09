// api/rel-recompra.js
// -----------------------------------------------------------------------------
// RECOMPRA → OPORTUNIDADE NO COMERCIAL (Fase 5, 0103, 09/10/2026).
//
//   POST { clienteId, viagemId?, interesse }  → { leadId, dono }
//
// O Relacionamento percebe que o cliente quer viajar de novo e passa a bola: o
// lead nasce no Comercial pelo MESMO caminho de qualquer lead (createInboundLead)
// — carteira primeiro (quem já atendeu esse telefone recebe de volta), senão o
// rodízio; cadência padrão com as atividades do SDR. Fonte "Recompra —
// Relacionamento" pra ele aparecer separado nos filtros e no Dashboard.
//
// NÃO abre negócio no Bitrix (opts.semBitrix): decisão de 09/10 — o Comercial
// decide se e quando vira card. Sem a flag, createInboundLead criaria um
// negócio novo no funil de Pré-Vendas na hora.
//
// Trava contra repetição: o mesmo cliente não ganha duas oportunidades em 30
// dias (devolve 409 com a anterior) — clicar duas vezes não pode dar dois SDRs
// ligando pra mesma pessoa.
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { createInboundLead } from './_leads.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FONTE = 'Recompra — Relacionamento';

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/** Quem chama: precisa estar ativo e ter o setor Relacionamento (ou ser admin). */
async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const ok = u.role === 'admin' || (Array.isArray(u.setores) && u.setores.includes('relacionamento'));
  return ok ? u : null;
}

const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const clienteId = String(body.clienteId || '').trim();
  const viagemId = body.viagemId ? String(body.viagemId).trim() : null;
  const interesse = String(body.interesse || '').trim().slice(0, 1000);
  if (!UUID.test(clienteId)) return res.status(400).json({ error: 'Cliente inválido.' });
  if (viagemId && !UUID.test(viagemId)) return res.status(400).json({ error: 'Viagem inválida.' });
  if (!interesse) return res.status(400).json({ error: 'Conte o que o cliente quer (destino, época, quantas pessoas).' });

  try {
    const cli = (await rest(`rel_clientes?select=id,nome,telefone,email,mesclado_em_id&id=eq.${clienteId}&limit=1`))?.[0];
    if (!cli || cli.mesclado_em_id) return res.status(404).json({ error: 'Ficha não encontrada.' });
    if (!cli.telefone && !cli.email) {
      return res.status(409).json({ error: 'A ficha não tem telefone nem e-mail — o Comercial não teria como falar com o cliente.' });
    }

    // ── Já tem oportunidade recente? ──
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const anterior = (await rest(
      `rel_recompras?select=id,lead_id,criado_em,interesse&cliente_id=eq.${clienteId}&criado_em=gte.${encodeURIComponent(desde)}&order=criado_em.desc&limit=1`
    ))?.[0];
    if (anterior) {
      return res.status(409).json({
        error: `Já existe uma oportunidade deste cliente criada em ${dataBR(anterior.criado_em)}.`,
        anterior,
      });
    }

    // ── Histórico pro SDR saber com quem está falando ──
    const viagens = await rest(
      `rel_viagem_passageiros?select=viagem:rel_viagens(id,titulo,destino,data_embarque,status)&cliente_id=eq.${clienteId}`
    ).catch(() => []);
    const ultima = (viagens || [])
      .map((x) => x.viagem)
      .filter((v) => v && v.status === 'ativa')
      .sort((a, b) => String(b.data_embarque || '').localeCompare(String(a.data_embarque || '')))[0] || null;
    const pesquisa = (await rest(
      `rel_pesquisas?select=nota,proximo_destino,respondida_em&cliente_id=eq.${clienteId}&respondida_em=not.is.null&order=respondida_em.desc&limit=1`
    ).catch(() => null))?.[0] || null;

    // ── O lead nasce no Comercial ──
    const partes = String(cli.nome).trim().split(/\s+/);
    const r = await createInboundLead({
      first_name: partes[0] || null,
      last_name: partes.slice(1).join(' ') || null,
      full_name: cli.nome,
      phone: cli.telefone || null,
      email: cli.email || null,
      segment: FONTE,
      source: 'integracao',
      lead_score: (pesquisa?.nota ?? -1) >= 9 ? 'Quente' : undefined,
    }, { semBitrix: true });
    const lead = r?.lead;
    if (!lead?.id) return res.status(502).json({ error: 'O Comercial não recebeu a oportunidade. Tente de novo.' });

    // Nota no lead: o SDR abre o card e já sabe que é cliente da casa.
    const nota = [
      '🔁 Recompra — vinda do Relacionamento',
      `Interesse: ${interesse}`,
      ultima ? `Última viagem: ${ultima.titulo}${ultima.data_embarque ? ` (embarque ${dataBR(ultima.data_embarque)})` : ''}` : null,
      pesquisa ? `Nota na pesquisa pós-viagem: ${pesquisa.nota}/10${pesquisa.proximo_destino ? ` · quer ir para: ${pesquisa.proximo_destino}` : ''}` : null,
      `Passado por: ${u.name}`,
    ].filter(Boolean).join('\n');
    await insert('qs_notes', { lead_id: lead.id, author_id: null, body: nota, tags: ['recompra', 'relacionamento'] }, { returning: false })
      .catch((e) => console.warn('[rel-recompra] nota não gravada:', e?.message));

    await insert('rel_recompras', {
      cliente_id: clienteId, viagem_id: viagemId || ultima?.id || null, lead_id: lead.id, interesse, criado_por: u.id,
    }, { returning: false });

    const donoId = r.ownerId || lead.owner_id || null;
    const dono = donoId
      ? (await rest(`qs_users?select=name&id=eq.${donoId}&limit=1`).catch(() => null))?.[0]?.name || null
      : null;
    console.log(`[rel-recompra] cliente ${clienteId} → lead ${lead.id}${r.deduped ? ' (já existia)' : ''} dono=${dono || '-'}`);
    return res.status(200).json({ leadId: lead.id, dono, jaExistia: Boolean(r.deduped) });
  } catch (e) {
    console.error('[rel-recompra]', e?.message);
    return res.status(500).json({ error: 'Não consegui criar a oportunidade agora.' });
  }
}
