// api/lead-bitrix.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/lead-bitrix
//   header Authorization: Bearer <jwt do usuario logado>
//   { lead_id, bitrix_id }
//
// GRUDA O ID DO NEGOCIO DO BITRIX NUM CARD. Se outro card estiver com o id, o
// vinculo MUDA DE CARD.
//
// -- POR QUE ISTO SAIU DO NAVEGADOR (Bruno, 01/09) ---------------------------
//
// A primeira versao movia o vinculo pelo browser, com a sessao do proprio SDR.
// Funcionava so no caso raro: quando os DOIS cards eram dele.
//
// O caso comum e o contrario. O negocio 37639 estava no card "[V4] Claudia
// Albuquerque", da Yanca, `perdido` desde 15/07 — e quem tentava agendar era
// outra SDR. A RLS esconde o lead alheio, entao o `update` nao encontrava linha
// nenhuma e a tela dizia "esta num card que voce nao tem permissao de ver, peca
// pra gestao". Verdade tecnica, resposta inutil: manda a pessoa parar o trabalho
// e ir pedir socorro por uma regra que nao protege nada aqui.
//
// Porque nao protege: o SDR NAO PRECISA VER o card antigo pra fazer o que quer.
// Ele nao le nome, telefone nem conversa de la — so declara que o negocio passou
// a ser deste card. A RLS existe pra impedir que ele LEIA lead alheio, e essa
// garantia continua de pe: o card antigo nao volta pra tela dele em momento
// nenhum, so o nome, que ja vai na nota do proprio card dele.
//
// Aqui a operacao roda com service_role (ignora RLS) e a permissao e conferida
// EXPLICITAMENTE — sobre o card de DESTINO, que e o unico que ele esta mexendo.
//
// -- A ORDEM IMPORTA --------------------------------------------------------
//
// Solta o id do card antigo ANTES de gravar no novo: existe indice unico em
// `bitrix_id` (0006) e ele e o que garante que "qual card e o do negocio 37639"
// tenha UMA resposta. Se a gravacao falhar depois de soltar, o id VOLTA pro card
// antigo — negocio sem card nenhum e o unico estado do qual ninguem se recupera
// sozinho, porque some da tela e some da busca.
//
// Envs: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';
import { vincularLeadAoBitrix, bitrixConfigurado } from './_bitrixLead.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const userId = await getSupabaseUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const leadId = String(body.lead_id || '').trim();
  const bitrixId = String(body.bitrix_id ?? '').replace(/\D/g, '');
  // Modo CRIAR (09/09): em vez de grudar um negocio que ja existe, ABRE um novo.
  const criar = body.criar === true || body.criar === 'true' || body.criar === 1;

  if (!leadId) return res.status(400).json({ error: 'lead_id é obrigatório' });
  if (!criar && !bitrixId) return res.status(400).json({ error: 'O ID do Bitrix deve ter só números.' });

  // A permissao e conferida sobre o card de DESTINO — o unico que este usuario
  // esta declarando ser dono do negocio. Mesma regra do resto do QS.
  const acesso = await assertCanAccessLead(userId, leadId);
  if (!acesso.ok) {
    return res.status(403).json({
      error: acesso.reason === 'lead-inexistente'
        ? 'Esse lead não existe mais no QS.'
        : 'Você não pode alterar este lead.',
    });
  }

  // ── ABRIR O NEGOCIO NO BITRIX (Bruno, 09/09) ───────────────────────────────
  //
  // O lead cadastrado a mao nascia SO no QS. O lead que entra pelo WhatsApp ou
  // pelo webhook ja abria negocio sozinho (vincularLeadAoBitrix, dentro do
  // _leads.js) — o cadastro manual era o unico caminho sem essa perna, e o
  // comercial descobria o cliente pelo boca a boca.
  //
  // Aqui e o MESMO codigo daquele caminho: mesmo funil, mesma etapa, mesma
  // busca de contato duplicado, mesmo responsavel casado por e-mail. Escrever
  // uma segunda versao "so pro cadastro manual" e como o QS ja criou dois
  // comportamentos pro mesmo botao antes.
  //
  // Nao e best-effort como la: la o lead precisava entrar de qualquer jeito, e o
  // Bitrix era enfeite. Aqui a pessoa CLICOU em "criar no Bitrix" — se falhar,
  // ela tem que saber, senao vai embora achando que o card existe.
  if (criar) {
    if (!bitrixConfigurado()) {
      return res.status(503).json({
        error: 'A integração com o Bitrix está desligada no servidor (falta BITRIX_WEBHOOK_BASE).',
      });
    }
    try {
      const linhas = await rest(`qs_leads?select=*&id=eq.${encodeURIComponent(leadId)}&limit=1`);
      const lead = (Array.isArray(linhas) && linhas[0]) || null;
      if (!lead) return res.status(404).json({ error: 'Esse lead não existe mais no QS.' });

      // Ja tem card: nao abre um segundo. Duplicar negocio no funil e
      // exatamente a sujeira que a checagem por telefone existe pra evitar.
      if (lead.bitrix_id) {
        return res.status(200).json({ ok: true, ja_era: true, lead_id: leadId, bitrix_id: String(lead.bitrix_id) });
      }

      const novoId = await vincularLeadAoBitrix(lead);
      if (!novoId) {
        return res.status(502).json({
          error: 'O Bitrix não criou o negócio. O lead está salvo no QS — dá pra tentar de novo pelo perfil dele.',
        });
      }
      return res.status(200).json({ ok: true, criado: true, lead_id: leadId, bitrix_id: String(novoId) });
    } catch (err) {
      console.error('[lead-bitrix/criar]', err?.message || err);
      return res.status(502).json({
        error: 'Falha ao criar o negócio no Bitrix. O lead está salvo no QS.',
      });
    }
  }

  try {
    // Quem esta com o id hoje? Roda com service_role: enxerga o card de
    // qualquer SDR, que e exatamente o ponto desta rota existir.
    const donos = await rest(
      `qs_leads?select=id,full_name,owner_id&bitrix_id=eq.${encodeURIComponent(bitrixId)}&limit=1`
    );
    const antigo = (Array.isArray(donos) && donos[0]) || null;

    if (antigo && antigo.id === leadId) {
      return res.status(200).json({ ok: true, ja_era: true, lead_id: leadId, bitrix_id: bitrixId });
    }

    if (antigo) {
      await rest(`qs_leads?id=eq.${encodeURIComponent(antigo.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { bitrix_id: null },
      });
    }

    try {
      await rest(`qs_leads?id=eq.${encodeURIComponent(leadId)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { bitrix_id: bitrixId },
      });
    } catch (e) {
      // Devolve pro card antigo. Ver "A ORDEM IMPORTA" no cabecalho.
      if (antigo) {
        await rest(`qs_leads?id=eq.${encodeURIComponent(antigo.id)}`, {
          method: 'PATCH', prefer: 'return=minimal', body: { bitrix_id: bitrixId },
        }).catch(() => {});
      }
      console.error('[lead-bitrix] não gravei no card de destino:', e?.message || e);
      return res.status(503).json({ error: 'Não consegui gravar o ID do Bitrix neste card. Tente de novo.' });
    }

    // Rastro nas duas pontas. Best-effort: o vinculo ja mudou e falhar aqui nao
    // pode desfazer isso. Sem a nota, alguem abre o card antigo daqui a tres
    // semanas, ve que o Bitrix sumiu e nao tem como saber se foi bug, se foi
    // alguem, nem quando.
    if (antigo) {
      const quem = acesso.user?.name || 'um usuário do QS';
      const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      try {
        await insert('qs_notes', [
          {
            lead_id: antigo.id, author_id: null,
            body: `🔗 O negócio ${bitrixId} do Bitrix deixou de apontar para este card em ${quando}, `
                + `durante um agendamento feito por ${quem}. O histórico deste card não foi alterado.`,
            tags: ['bitrix', 'vinculo'],
          },
          {
            lead_id: leadId, author_id: null,
            body: `🔗 O negócio ${bitrixId} do Bitrix passou a apontar para este card em ${quando}`
                + (antigo.full_name ? ` (antes estava em "${antigo.full_name}")` : '') + '.',
            tags: ['bitrix', 'vinculo'],
          },
        ], { returning: false });
      } catch (e) {
        console.warn('[lead-bitrix] notas não criadas:', e?.message);
      }
    }

    return res.status(200).json({
      ok: true,
      lead_id: leadId,
      bitrix_id: bitrixId,
      // Preenchido so quando houve mudanca de card — a tela usa pra avisar.
      moveu_de: antigo ? { id: antigo.id, nome: antigo.full_name ?? null } : null,
    });
  } catch (err) {
    console.error('[lead-bitrix]', err?.message || err);
    return res.status(500).json({ error: 'Falha ao vincular o negócio do Bitrix' });
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
