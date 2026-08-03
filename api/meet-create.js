// api/meet-create.js
// -----------------------------------------------------------------------------
// Cria o evento no GOOGLE CALENDAR (com link do Google Meet) para uma reunião do
// QS e devolve o link, que o front grava na reunião.
//
// Por que passa pelo servidor e não vai direto do navegador pro n8n: o segredo
// do webhook (N8N_AGENDA_SECRET) não pode existir no bundle — quem abre o
// DevTools acha em dois segundos e passa a criar evento na agenda da operação.
//
// Por que o QS não fala direto com a API do Google: precisaria de OAuth de uma
// conta Google DENTRO da Vercel (refresh token, renovação, escopo). O n8n já tem
// essa infraestrutura de credencial pronta e é onde as outras integrações moram.
//
// Autorização: JWT do Supabase Auth (o mesmo do resto do app) + a checagem de
// que o usuário pode mexer NAQUELE lead — a mesma regra da RLS. Sem isso,
// qualquer usuário logado dispararia convite em nome de qualquer reunião.
//
// Body: { access_token, meeting_id }
// Resposta: { success, meet_link, event_id, html_link }
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 20_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  const base = process.env.N8N_AGENDA_URL;
  const secret = process.env.N8N_AGENDA_SECRET;
  if (!base) {
    // NÃO é erro do usuário: a integração simplesmente não foi ligada ainda. O
    // front trata 501 como "segue sem o Meet" e não estraga o fluxo do Ganho.
    return res.status(501).json({ success: false, error: 'Agenda Google não configurada', code: 'NAO_CONFIGURADO' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { access_token, meeting_id } = body;
  if (!UUID_RE.test(String(meeting_id || ''))) {
    return res.status(400).json({ success: false, error: 'meeting_id inválido' });
  }

  const userId = await getSupabaseUserId(access_token ? `Bearer ${access_token}` : req.headers.authorization);
  if (!userId) return res.status(401).json({ success: false, error: 'Sessão inválida' });

  let meeting;
  try {
    const rows = await rest(
      `qs_meetings?select=*,lead:qs_leads(id,full_name,email,phone,bitrix_id),closer:qs_users!qs_meetings_closer_id_fkey(id,name,email)` +
      `&id=eq.${encodeURIComponent(meeting_id)}&limit=1`
    );
    meeting = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error('[meet-create] leitura da reunião:', e?.message);
    return res.status(500).json({ success: false, error: 'Falha ao ler a reunião' });
  }
  if (!meeting) return res.status(404).json({ success: false, error: 'Reunião não encontrada' });

  // Mesma trava do resto do app: quem não pode mexer no lead não agenda por ele.
  const permissao = await assertCanAccessLead(userId, meeting.lead_id);
  if (!permissao.ok) {
    return res.status(403).json({ success: false, error: 'Esta reunião é de outro SDR' });
  }

  // Já tem evento: não cria outro (o botão pode ser clicado duas vezes, e o
  // Ganho pode ser refeito). Devolve o que existe — idempotente de propósito.
  if (meeting.calendar_event_id) {
    return res.status(200).json({
      success: true,
      event_id: meeting.calendar_event_id,
      meet_link: meeting.meeting_link || null,
      html_link: meeting.calendar_html_link || null,
      ja_existia: true,
    });
  }

  const inicio = new Date(meeting.scheduled_at);
  const fim = meeting.ends_at
    ? new Date(meeting.ends_at)
    : new Date(inicio.getTime() + (meeting.duration_min ?? 60) * 60_000);

  // Convidados: o closer (dono da agenda) e o cliente, quando temos o e-mail.
  // Sem e-mail do cliente o evento é criado do mesmo jeito — o Meet serve pro
  // closer, e o SDR manda o link pelo WhatsApp.
  const convidados = [];
  if (meeting.closer?.email) convidados.push(meeting.closer.email);
  const emailCliente = meeting.client_email || meeting.lead?.email || null;
  if (emailCliente) convidados.push(emailCliente);

  const payload = {
    meeting_id: meeting.id,
    titulo: meeting.title || `Reunião — ${meeting.lead_name || meeting.lead?.full_name || 'cliente'}`,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    // O Google precisa saber o fuso pra não jogar o evento 3h pra frente/trás.
    timezone: 'America/Sao_Paulo',
    convidados,
    closer_email: meeting.closer?.email || null,
    closer_nome: meeting.closer?.name || meeting.meeting_owner || null,
    cliente_nome: meeting.lead_name || meeting.lead?.full_name || null,
    cliente_email: emailCliente,
    cliente_telefone: meeting.lead?.phone || null,
    descricao: [
      meeting.lead_name || meeting.lead?.full_name ? `Cliente: ${meeting.lead_name || meeting.lead?.full_name}` : null,
      meeting.lead?.phone ? `Telefone: ${meeting.lead.phone}` : null,
      meeting.scheduled_by ? `Agendado por: ${meeting.scheduled_by}` : null,
      meeting.notes || null,
      'Criado automaticamente pelo QS.',
    ].filter(Boolean).join('\n'),
  };

  let resposta;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-qs-agenda-secret': secret } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const texto = await r.text();
      try { resposta = texto ? JSON.parse(texto) : null; } catch { resposta = { raw: texto }; }
      if (!r.ok) {
        const err = new Error(`n8n HTTP ${r.status}`);
        err.detalhe = resposta;
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const motivo = e?.name === 'AbortError' ? 'n8n não respondeu a tempo' : (e?.message || 'falha ao falar com o n8n');
    console.error('[meet-create]', motivo, e?.detalhe || '');
    // Registra a falha NA REUNIÃO: a tela precisa poder dizer "a reunião está
    // marcada, mas o convite do Google não saiu" em vez de fingir sucesso.
    await marcarErro(meeting.id, motivo);
    return res.status(502).json({ success: false, error: 'Não foi possível criar o evento no Google', code: 'N8N' });
  }

  const eventId = resposta?.event_id || resposta?.id || null;
  const meetLink = resposta?.meet_link || resposta?.hangoutLink || null;
  const htmlLink = resposta?.html_link || resposta?.htmlLink || null;

  if (!eventId) {
    await marcarErro(meeting.id, 'o n8n respondeu sem event_id');
    return res.status(502).json({ success: false, error: 'O n8n respondeu sem o evento criado', code: 'SEM_EVENTO' });
  }

  try {
    await rest(`qs_meetings?id=eq.${encodeURIComponent(meeting.id)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        calendar_event_id: eventId,
        calendar_html_link: htmlLink,
        calendar_error: null,
        // Só sobrescreve o link da reunião se o Google devolveu um Meet — link
        // colado na mão pelo SDR não pode ser apagado por uma resposta incompleta.
        ...(meetLink ? { meeting_link: meetLink, location: 'Google Meet' } : {}),
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    // O evento EXISTE no Google; só não conseguimos anotar. Melhor devolver
    // sucesso com o link do que fazer o SDR criar um segundo evento.
    console.error('[meet-create] gravação do link falhou:', e?.message);
  }

  return res.status(200).json({ success: true, event_id: eventId, meet_link: meetLink, html_link: htmlLink });
}

async function marcarErro(meetingId, motivo) {
  try {
    await rest(`qs_meetings?id=eq.${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { calendar_error: String(motivo).slice(0, 300) },
    });
  } catch (e) {
    // Coluna ainda não existe (migration 0031 não aplicada): não é motivo pra
    // derrubar o fluxo — o erro já está no log da Vercel.
    console.warn('[meet-create] não deu pra registrar o erro na reunião:', e?.message);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
