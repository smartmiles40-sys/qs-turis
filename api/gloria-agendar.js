// api/gloria-agendar.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/gloria-agendar
//   header x-gloria-secret: <GLORIA_SECRET>
//   { acao: "horarios" | "agendar", lead_id, ... }
//
// A GLÓRIA MARCA A REUNIÃO SOZINHA. Até aqui ela levava a conversa até a porta
// e chamava o time; agora ela abre a porta.
//
// SÃO DUAS FERRAMENTAS, E A SEPARAÇÃO É O QUE TORNA ISTO SEGURO:
//
//   "horarios"  → devolve DUAS opções reais da agenda, cada uma com um id.
//   "agendar"   → recebe um desses ids de volta e marca.
//
// O modelo nunca escreve um horário: ele devolve o id que acabou de receber.
// Isso mata de uma vez a classe inteira de erro que mais assusta aqui — a IA
// inventar "quinta às 15h" e marcar em cima de outra reunião, ou marcar num
// horário que já passou, ou num sábado. Se o id não existe mais na agenda, a
// rota recusa e ela pede outro horário.
//
// O QUE ESTA ROTA RECUSA (fail-closed, na mesma linha do gloria-responder):
//   • IA desligada nesta conversa (o SDR assumiu no meio) — não marca nada.
//   • Opção vencida, ocupada ou com menos de 3h de antecedência.
//   • MODO TESTE: faz todas as leituras, mostra o que faria, e não grava nada.
//
// Envs: GLORIA_SECRET + SUPABASE_* (+ N8N_AGENDA_* para a sala do Meet).
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { portaria, corpo, buscarLead, sessao, registrar, pausar, blocoQualificacao } from './_gloria.js';
import { duasOpcoes, lerOpcao, marcarReuniao, emailValido, closersAtivos, ANTECEDENCIA_MIN } from './_agenda.js';

const PERIODOS = new Set(['manha', 'tarde']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const barrado = portaria(req);
  if (barrado) return res.status(barrado.status).json({ error: barrado.error });

  const body = corpo(req);
  const acao = String(body.acao || 'horarios').toLowerCase().trim();
  const leadId = String(body.lead_id || body.leadId || '').trim();
  const teste = body.teste === true || body.teste === 'true';

  if (!leadId) return res.status(400).json({ error: 'lead_id obrigatório' });

  try {
    const lead = await buscarLead(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // A IA ainda está no comando desta conversa? Vale para as DUAS ações: se o
    // SDR assumiu enquanto o modelo pensava, nem oferecer horário faz sentido —
    // a pessoa receberia duas ofertas de agenda, uma de cada lado.
    let ses;
    try {
      ses = await sessao(leadId);
    } catch (e) {
      if (e?.code === 'SEM_0053') return res.status(503).json({ error: e.message, motivo: 'sem_0053' });
      throw e;
    }
    if (!ses || ses.ativa === false) {
      await registrar(leadId, 'evento', `agendamento descartado (${acao})`, ses?.motivo || 'sessao_inativa');
      return res.status(409).json({ ok: false, motivo: ses?.motivo || 'ia_desligada' });
    }

    if (acao === 'horarios') return await oferecerHorarios(req, res, { body, lead, teste });
    if (acao === 'agendar') return await marcar(req, res, { body, lead, ses, teste });

    return res.status(400).json({ error: 'acao inválida (horarios | agendar)' });
  } catch (e) {
    console.error('[gloria-agendar]', e?.message);
    return res.status(500).json({ error: e?.message || 'falha' });
  }
}

// ─── "horarios" ──────────────────────────────────────────────────────────────

async function oferecerHorarios(req, res, { body, lead, teste }) {
  const periodo = PERIODOS.has(String(body.periodo || '').toLowerCase()) ? String(body.periodo).toLowerCase() : null;
  // `dia` só entra se vier no formato do banco. Texto solto ("quinta") não vira
  // data aqui: quem sabe que dia é quinta é o calendário, e a resposta desta
  // rota já diz o dia por extenso pra ela repetir.
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dia || '')) ? String(body.dia) : null;

  const r = await duasOpcoes({ periodo, dia });

  if (!r.ok) {
    const closers = await closersAtivos();
    // Ler é inofensivo, então mesmo o modo teste vê a agenda de verdade — é o
    // que torna o teste útil.
    return res.status(200).json({
      ok: false,
      motivo: closers.length ? 'sem_horario' : 'sem_closer',
      recado: closers.length
        ? 'Não há horário livre nesse período. Ofereça outro período ou outro dia.'
        : 'Nenhum especialista ativo na agenda — não dá pra agendar agora, passe a conversa pro time.',
      opcoes: [],
    });
  }

  await registrar(lead.id, 'evento', r.opcoes.map((o) => o.quando).join(' | '), teste ? 'horarios_oferecidos_teste' : 'horarios_oferecidos');

  return res.status(200).json({
    ok: true,
    especialista: r.closer.nome,
    opcoes: r.opcoes,
    recado: 'Ofereça estas DUAS opções, exatamente como estão em "quando". Quando a pessoa escolher, chame agendar_reuniao com o "id" da opção escolhida.',
  });
}

// ─── "agendar" ───────────────────────────────────────────────────────────────

async function marcar(req, res, { body, lead, ses, teste }) {
  const opcao = lerOpcao(body.opcao_id || body.opcao || '');
  if (!opcao) {
    return res.status(400).json({
      ok: false, motivo: 'opcao_invalida',
      recado: 'Chame horarios_livres primeiro e use o "id" que veio de lá, sem alterar nada.',
    });
  }

  const email = String(body.email || '').trim() || null;
  const emailOk = emailValido(email);
  const titulo = String(body.expedicao || body.titulo || '').trim() || null;
  const resumo = String(body.resumo || '').trim() || null;

  if (teste) {
    const closers = await closersAtivos();
    const closer = closers.find((c) => c.id === opcao.closerId);
    const cedo = opcao.quando.getTime() < Date.now() + ANTECEDENCIA_MIN * 60_000;
    return res.status(200).json({
      ok: !cedo,
      teste: true,
      aviso: 'MODO TESTE — nenhuma reunião foi criada, nada foi gravado.',
      motivo: cedo ? 'cedo_demais' : undefined,
      marcaria: {
        quando: opcao.quando.toISOString(),
        especialista: closer?.name || '(closer desconhecido)',
        email: emailOk ? email : null,
        sem_email: !emailOk,
        titulo: titulo ? `Expedição ${titulo}` : `Reunião · ${lead.full_name || lead.first_name}`,
      },
    });
  }

  const r = await marcarReuniao({
    lead,
    opcao,
    email: emailOk ? email : null,
    titulo: titulo ? `Expedição ${titulo}` : null,
    resumo,
  });

  if (!r.ok) {
    await registrar(lead.id, 'evento', body.opcao_id || null, `agendamento_recusado: ${r.motivo}`);
    const recados = {
      horario_ocupado: 'Esse horário acabou de ser preenchido. Chame horarios_livres de novo e ofereça as duas novas opções.',
      cedo_demais: 'Esse horário já está perto demais. Chame horarios_livres de novo.',
      sem_closer: 'Nenhum especialista ativo — passe a conversa pro time.',
      closer_desconhecido: 'Chame horarios_livres de novo e use o id que vier de lá.',
      falha_ao_gravar: 'Não consegui marcar agora. Diga que o time confirma o horário em instantes e chame transferir_para_humano.',
    };
    return res.status(200).json({ ok: false, motivo: r.motivo, recado: recados[r.motivo] || recados.falha_ao_gravar });
  }

  // ── Marcada. Daqui pra frente a conversa é do especialista. ────────────────
  //
  // A ordem é a mesma da transferência: pausa PRIMEIRO. A mensagem em que ela
  // conta que marcou ainda sai — o `gloria-responder` tem uma janela de 2
  // minutos justamente pra despedida — mas nada depois dela.
  await pausar(lead.id, 'agendada', `Reunião marcada para ${r.quando_extenso} com ${r.especialista}.`, true);

  const corpoNota =
    '🤖 Glória (IA) agendou a reunião\n' +
    `${r.quando_extenso} · Especialista: ${r.especialista}\n` +
    (r.link ? `Meet: ${r.link}` : 'SEM link do Meet — crie a sala pela Agenda') +
    (emailOk ? `\nE-mail do cliente: ${email}` : '\nO cliente NÃO passou e-mail — o convite do Google não foi pra ele') +
    (r.avisos?.length ? `\n\n⚠️ ${r.avisos.join(' · ')}` : '') +
    (resumo ? `\n\n${resumo}` : '') +
    blocoQualificacao(ses);

  await insert('qs_notes', { lead_id: lead.id, author_id: null, body: corpoNota, tags: ['gloria', 'reuniao'] }, { returning: false })
    .catch((e) => console.warn('[gloria-agendar] nota:', e?.message));

  await registrar(lead.id, 'evento', `${r.quando_extenso} com ${r.especialista}`, 'reuniao_agendada', {
    meeting_id: r.meeting_id, link: r.link, avisos: r.avisos,
  });

  return res.status(200).json({
    ok: true,
    meeting_id: r.meeting_id,
    quando: r.quando,
    especialista: r.especialista,
    link: r.link,
    recado: r.link
      ? `Marcado. Confirme com a pessoa em três balões: o dia e a hora por extenso, o link ${r.link} numa linha só, e "Podemos contar com a sua presença?". Depois disso não fale mais nada.`
      : 'Marcado, mas o link da sala ainda não saiu. Confirme o dia e a hora e diga que o link chega por aqui antes da reunião. Não invente link.',
  });
}
