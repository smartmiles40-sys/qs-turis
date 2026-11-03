// api/agenda-meet.js
// -----------------------------------------------------------------------------
// Ponte entre o QS e o Google Calendar, nas três ações da agenda: criar,
// reagendar e cancelar.
//
// Por que passa pelo servidor: a credencial do Google não pode existir no
// bundle — quem abre o DevTools a encontra em dois segundos e passa a mexer na
// agenda da operação.
//
// 03/11/2026: SEM n8n. Até aqui esta rota chamava o webhook `qs-agenda-meet` do
// n8n, que tinha a credencial OAuth. Agora fala direto com a Calendar API
// (api/_googleAgenda.js, refresh token em env — ver docs/GOOGLE-AGENDA-SEM-N8N.md).
//
// CONTRATO, e é aqui que é fácil errar: a rota responde **HTTP 200 SEMPRE**
// (menos 400/401/403/404/501 de entrada). Quem diz se deu certo é o campo `ok`
// do corpo. `executarAcaoAgenda` devolve o MESMO corpo que o n8n devolvia — o
// front precisa dos códigos (`nao_encontrado`, `duplicado`, `sem_meet`) pra
// decidir o que fazer.
//
// A RESERVA NO SUPABASE ACONTECE ANTES, no front. Aqui não se cria nem se apaga
// reunião: só se conversa com o Google e se anota o resultado na linha que já
// existe. Ordem invertida (Google primeiro) geraria Meet órfão sem reserva.
//
// Body: { access_token, acao, meeting_id, inicio?, fim?, titulo?, descricao?, convidados?, event_id? }
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';
import { googleConfigurado, motivoNaoConfigurado } from './_google.js';
import { executarAcaoAgenda } from './_googleAgenda.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACOES = new Set(['criar', 'reagendar', 'cancelar']);
// Prazo TOTAL da conversa com o Google (token + insert + GET do 409). O
// maxDuration desta rota é 30 s (vercel.json) e antes disto vêm a sessão, a
// leitura da reunião e a permissão: 18 s deixa folga pro abort agir antes de
// a Vercel matar a função.
const PRAZO_GOOGLE_MS = 18_000;
const TIMEOUT_CHAMADA_MS = 10_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, erro: 'Use POST' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const acao = String(body.acao || 'criar').toLowerCase().trim();
  const meetingId = String(body.meeting_id || '');

  if (!ACOES.has(acao)) return res.status(400).json({ ok: false, codigo: 'acao_invalida', erro: `ação inválida: ${acao}` });
  if (!UUID_RE.test(meetingId)) {
    // Dizer QUAIS campos chegaram custa nada e teria economizado meio dia: o
    // front mandava `meetingId` (camelCase) e esta rota lê `meeting_id`, então
    // a resposta era sempre "meeting_id inválido" sem dizer que o campo nem
    // veio. Com a lista de chaves, o desencontro salta aos olhos.
    const recebidos = Object.keys(body).filter((k) => k !== 'access_token').join(', ') || '(corpo vazio)';
    return res.status(400).json({
      ok: false,
      codigo: 'meeting_id_invalido',
      erro: `meeting_id inválido ou ausente — campos recebidos: ${recebidos}`,
    });
  }

  if (!googleConfigurado()) {
    // Integração não ligada. NÃO é silêncio: em 05/08, três reuniões reais
    // nasceram sem evento no Google porque este caminho não deixava rastro — nem
    // na reunião, nem na tela. Agora fica gravado na própria reunião, e é por
    // isso que a checagem de envs desceu pra DEPOIS da validação do meeting_id:
    // sem um id válido não há onde escrever.
    await marcarErro(meetingId, motivoNaoConfigurado());
    return res.status(501).json({ ok: false, codigo: 'nao_configurado', erro: 'Agenda Google não configurada' });
  }

  const userId = await getSupabaseUserId(body.access_token ? `Bearer ${body.access_token}` : req.headers.authorization);
  if (!userId) {
    await marcarErro(meetingId, 'sessão inválida ao criar o evento');
    return res.status(401).json({ ok: false, codigo: 'sessao', erro: 'Sessão inválida' });
  }

  let meeting;
  try {
    const rows = await rest(
      `qs_meetings?select=*,lead:qs_leads(id,full_name,email,phone,bitrix_id),closer:qs_users!qs_meetings_closer_id_fkey(id,name,email)` +
      `&id=eq.${encodeURIComponent(meetingId)}&limit=1`
    );
    meeting = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error('[agenda-meet] leitura da reunião:', e?.message);
    await marcarErro(meetingId, `falha ao ler a reunião: ${e?.message ?? ''}`);
    return res.status(500).json({ ok: false, codigo: 'leitura', erro: 'Falha ao ler a reunião' });
  }
  // Sem linha no banco não há onde gravar o erro — é o único caminho que segue
  // sem rastro, e por definição não há reunião pra ficar sem sala.
  if (!meeting) return res.status(404).json({ ok: false, codigo: 'inexistente', erro: 'Reunião não encontrada' });

  // Mesma trava do resto do app: quem não pode mexer no lead não mexe na agenda dele.
  const permissao = await assertCanAccessLead(userId, meeting.lead_id);
  if (!permissao.ok) {
    await marcarErro(meeting.id, 'sem permissão sobre o lead desta reunião');
    return res.status(403).json({ ok: false, codigo: 'permissao', erro: 'Esta reunião é de outro SDR' });
  }

  // ── Monta o payload de cada ação ──────────────────────────────────────────
  const payload = { acao, meeting_id: meeting.id };

  if (acao === 'criar' || acao === 'reagendar') {
    // O horário vem de quem chamou (a reserva no banco já foi feita com ele);
    // sem isso, cai no que está gravado na reunião.
    const inicio = body.inicio || meeting.scheduled_at;
    const fim = body.fim || meeting.ends_at ||
      new Date(new Date(inicio).getTime() + (meeting.duration_min ?? 60) * 60_000).toISOString();
    payload.inicio = new Date(inicio).toISOString();
    payload.fim = new Date(fim).toISOString();
    payload.timezone = 'America/Sao_Paulo';
    payload.titulo = body.titulo || meeting.title || `Reunião · ${nomeDoLead(meeting)}`;
    payload.descricao = body.descricao || descricaoPadrao(meeting);
  }

  if (acao === 'criar') {
    // Convidados: o especialista (dono da agenda) e o cliente, quando temos o
    // e-mail. Sem e-mail do cliente o evento é criado igual — o Meet serve pro
    // closer e o SDR manda o link pelo WhatsApp.
    const convidados = Array.isArray(body.convidados) ? body.convidados.slice() : [];
    if (!convidados.length) {
      if (meeting.closer?.email) convidados.push(meeting.closer.email);
      const emailCliente = meeting.client_email || meeting.lead?.email;
      if (emailCliente) convidados.push(emailCliente);
    }
    payload.convidados = convidados;
  }

  if (acao === 'reagendar' || acao === 'cancelar') {
    const eventId = body.event_id || meeting.calendar_event_id;
    if (!eventId) {
      // Sem evento no Google não há o que mover nem apagar. Devolve o mesmo
      // código do n8n pra reaproveitar o caminho de "recrie": o front chama criar.
      return res.status(200).json({
        ok: false, acao, meeting_id: meeting.id,
        codigo: 'nao_encontrado', erro: 'esta reunião não tem evento no Google',
      });
    }
    payload.event_id = eventId;
  }

  // Atalho de idempotência: criar de novo uma reunião que já tem evento devolve
  // o que existe, sem ir ao Google. Cobre duplo clique e Ganho refeito.
  if (acao === 'criar' && meeting.calendar_event_id && !body.forcar) {
    return res.status(200).json({
      ok: true, acao, meeting_id: meeting.id,
      event_id: meeting.calendar_event_id,
      meet_link: meeting.meeting_link || null,
      html_link: meeting.calendar_html_link || null,
      duplicado: true,
    });
  }

  // ── Fala com o Google ─────────────────────────────────────────────────────
  // Nunca lança: falha (token recusado, Google fora, prazo) volta como
  // { ok: false, codigo, erro } — o mesmo formato que o webhook do n8n usava.
  const resposta = await executarAcaoAgenda(payload, { prazoMs: PRAZO_GOOGLE_MS, timeoutMs: TIMEOUT_CHAMADA_MS });
  if (resposta.ok !== true) console.error('[agenda-meet]', acao, resposta.codigo, resposta.erro);

  // ── Anota o resultado na reunião ──────────────────────────────────────────
  if (resposta.ok === true) {
    const patch = { calendar_error: null, updated_at: new Date().toISOString() };
    if (acao === 'cancelar') {
      // Sem evento no Google: zera o vínculo pra um reagendamento futuro criar
      // um novo em vez de tentar mexer no que não existe mais.
      patch.calendar_event_id = null;
      patch.calendar_html_link = null;
    } else {
      if (resposta.event_id) patch.calendar_event_id = resposta.event_id;
      if (resposta.html_link) patch.calendar_html_link = resposta.html_link;
      // O link só é sobrescrito quando o Google devolveu sala — link colado na
      // mão não pode ser apagado por uma resposta sem Meet.
      if (resposta.meet_link) { patch.meeting_link = resposta.meet_link; patch.location = 'Google Meet'; }
    }
    try {
      await rest(`qs_meetings?id=eq.${encodeURIComponent(meeting.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    } catch (e) {
      // O evento existe no Google; só não conseguimos anotar. Melhor devolver
      // sucesso com o link do que fazer o usuário criar um segundo evento.
      console.error('[agenda-meet] gravação do resultado falhou:', e?.message);
    }
  } else {
    await marcarErro(meeting.id, `${resposta.codigo ?? ''} ${resposta.erro ?? ''}`.trim() || 'falha no Google');
  }

  // Repassa o corpo do Google já traduzido: o front precisa de `codigo`, `duplicado`,
  // `sem_meet` e `convidados_descartados` pra decidir o que mostrar.
  return res.status(200).json(resposta);
}

function nomeDoLead(m) {
  return m.lead_name || m.lead?.full_name || 'cliente';
}

function descricaoPadrao(m) {
  return [
    m.lead?.bitrix_id ? `Negócio #${m.lead.bitrix_id}` : null,
    `Cliente: ${nomeDoLead(m)}`,
    m.lead?.phone ? `Telefone: ${m.lead.phone}` : null,
    m.scheduled_by ? `Agendado por: ${m.scheduled_by}` : null,
    m.notes || null,
    'Criado automaticamente pelo QS.',
  ].filter(Boolean).join('\n');
}

async function marcarErro(meetingId, motivo) {
  try {
    await rest(`qs_meetings?id=eq.${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { calendar_error: String(motivo).slice(0, 300) },
    });
  } catch (e) {
    console.warn('[agenda-meet] não deu pra registrar o erro na reunião:', e?.message);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
