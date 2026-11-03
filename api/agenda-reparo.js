// api/agenda-reparo.js
// -----------------------------------------------------------------------------
// REUNIÃO SEM MEET / SEM BITRIX SE CONSERTA SOZINHA (27/10/2026).
//
// Quando o Google (antes, o n8n) falha na hora de agendar, a reunião ficava assim pra sempre: sem
// link do Meet (`calendar_error` preenchido) ou sem o card do Bitrix atualizado
// (`bitrix_synced` falso). Ninguém tentava de novo. Em 30 dias: 1 futura sem
// Meet e 4 agendadas que nunca chegaram no Bitrix.
//
// Vercel Cron a cada 10 min (GET com Bearer CRON_SECRET, igual aos outros):
//
//   1. MEET — reuniões FUTURAS agendadas/confirmadas, sem link, sem evento no
//      Google e com `calendar_error`. Chama `criarSalaDoMeet` (api/_agenda.js),
//      a mesma do agendamento. Deu certo: grava link/evento, limpa o erro e
//      avisa o Bitrix de novo, agora com o link (igual ao avisarBitrixDaSala).
//
//   2. BITRIX — reuniões agendadas/confirmadas criadas nos últimos 30 dias com
//      `bitrix_synced` falso, cujo lead tem bitrix_id e que são a reunião MAIS
//      RECENTE do lead. Reenvia por `enviarReuniaoAoBitrix` (api/_agenda.js),
//      o mesmo webhook `qs-reuniao` do agendamento.
//
// POR QUE NÃO DUPLICA:
//   • Meet: o evento nasce com um id DERIVADO do meeting_id (idEvento em
//     api/_googleAgenda.js, o mesmo algoritmo do n8n de antes de 03/11).
//     Reenviar a mesma reunião faz o Google responder 409 e devolver a
//     MESMA sala — não nasce segundo evento nem segundo convite. E aqui só
//     entra reunião SEM `calendar_event_id` (evento que já existe não é
//     recriado; o PATCH de erro também só grava se continuar sem evento).
//   • Bitrix: o `qs-reuniao` é um crm.deal.update no negócio que o lead JÁ
//     aponta — nunca cria card. Repetir só reescreve os mesmos campos. O único
//     efeito repetível é o comentário na timeline, e por isso: só entra quem
//     está com bitrix_synced falso; sucesso marca bitrix_synced=true aqui mesmo
//     (sem depender do n8n escrever de volta); o erro só é gravado se a linha
//     continuar não sincronizada (não apaga um sucesso que o n8n gravou).
//   • Ficam de FORA de propósito: realizada/no-show/reagendada/desistência
//     (reenviar "Reunião agendada" num card que já andou puxaria a etapa pra
//     trás e mentiria na timeline) e reunião que não é a mais nova do lead (a
//     data velha sobrescreveria a nova). Também ficam de fora os "gravado, mas
//     sem: …" — esses chegaram; o que falta é cadastro no Bitrix, e reenviar
//     não muda nada.
//
// TENTATIVAS: no máximo 5 por reunião, com espera crescente (0, 10, 30, 60 e
// 120 min depois da anterior). O contador mora no PRÓPRIO texto do erro —
// "[reparo 2/5 2026-10-27T13:00:00Z] n8n HTTP 502" —, então funciona sem
// coluna nova. Esgotou: o texto vira "[reparo 5/5 … desisti]" e a reunião
// continua contando no Painel de Gestão ("sem Meet" / "sem Bitrix"), que é
// onde alguém resolve à mão.
//
// Env: CRON_SECRET, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN
// (Meet), N8N_SYNC_BASE (Bitrix). Sem a env de um lado, aquele lado é pulado
// com recado, sem erro.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { criarSalaDoMeet, enviarReuniaoAoBitrix } from './_agenda.js';
import { googleConfigurado, motivoNaoConfigurado } from './_google.js';

const MAX_TENTATIVAS = 5;
/** Espera (min) antes da tentativa n+1, onde n = tentativas já feitas. */
const ESPERA_MIN = [0, 10, 30, 60, 120];
/** Reunião recém-criada ainda pode estar no meio do fluxo da tela. */
const CARENCIA_MS = 5 * 60_000;
/** maxDuration da rota é 60 s; para de começar tentativa nova antes disso. */
const ORCAMENTO_MS = 45_000;
const MAX_MEET_POR_RODADA = 4;
const MAX_BITRIX_POR_RODADA = 6;

const RE_MARCA = /^\[reparo (\d+)\/\d+ ([0-9T:.\-Z]+)[^\]]*\]\s*/;

/** Lê "[reparo n/5 quando]" do texto do erro. */
function lerMarca(texto) {
  const m = String(texto || '').match(RE_MARCA);
  if (!m) return { n: 0, ultima: 0, resto: String(texto || '') };
  const ultima = new Date(m[2]).getTime();
  return { n: Number(m[1]) || 0, ultima: Number.isNaN(ultima) ? 0 : ultima, resto: String(texto).slice(m[0].length) };
}

function podeTentar(marca, agora) {
  if (marca.n >= MAX_TENTATIVAS) return false;
  const espera = (ESPERA_MIN[marca.n] ?? ESPERA_MIN[ESPERA_MIN.length - 1]) * 60_000;
  return agora - marca.ultima >= espera;
}

function marcar(n, motivo) {
  const desisti = n >= MAX_TENTATIVAS ? ' desisti' : '';
  return `[reparo ${n}/${MAX_TENTATIVAS} ${new Date().toISOString()}${desisti}] ${String(motivo || 'falhou')}`.slice(0, 300);
}

const enc = encodeURIComponent;

// ─── 1. Meet ─────────────────────────────────────────────────────────────────

async function repararMeet(prazo) {
  if (!googleConfigurado()) return { pulado: motivoNaoConfigurado() };
  const agora = Date.now();
  const rows = await rest(
    'qs_meetings?select=*,lead:qs_leads(id,email,bitrix_id),closer:qs_users!qs_meetings_closer_id_fkey(email)' +
    `&status=in.(agendada,confirmada)&scheduled_at=gt.${enc(new Date(agora).toISOString())}` +
    '&calendar_event_id=is.null&calendar_error=not.is.null&or=(meeting_link.is.null,meeting_link.eq.)' +
    `&created_at=lt.${enc(new Date(agora - CARENCIA_MS).toISOString())}` +
    '&order=scheduled_at.asc&limit=25'
  );
  const feitos = [];
  let tentados = 0;
  for (const m of Array.isArray(rows) ? rows : []) {
    if (tentados >= MAX_MEET_POR_RODADA || Date.now() > prazo) break;
    const marca = lerMarca(m.calendar_error);
    if (!podeTentar(marca, agora)) continue;
    tentados++;
    const n = marca.n + 1;

    const frase = [
      m.lead?.bitrix_id ? `Negócio #${m.lead.bitrix_id}` : null,
      m.scheduled_by ? `Agendado por: ${m.scheduled_by}` : null,
      'Sala criada pelo reparo automático do QS (a primeira tentativa falhou)',
    ].filter(Boolean).join('\n');
    const convidados = [m.closer?.email, m.client_email || m.lead?.email];
    const sala = await criarSalaDoMeet(m, convidados, { frase });

    if (sala.ok) {
      const patch = { updated_at: new Date().toISOString() };
      if (sala.eventId) patch.calendar_event_id = sala.eventId;
      if (sala.htmlLink) patch.calendar_html_link = sala.htmlLink;
      if (sala.link) {
        patch.meeting_link = sala.link;
        patch.location = 'Google Meet';
        patch.calendar_error = null;
      } else {
        // Evento existe, mas o Google não deu sala: não adianta insistir.
        patch.calendar_error = marcar(n, 'evento criado no Google, mas sem sala do Meet');
      }
      await rest(`qs_meetings?id=eq.${enc(m.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
      // O card do Bitrix recebe o link (mesmo papel do avisarBitrixDaSala da tela).
      if (sala.link && m.lead?.bitrix_id) {
        const bx = await enviarReuniaoAoBitrix({ ...m, meeting_link: sala.link, location: 'Google Meet' }, m.lead, { timeoutMs: 12_000 });
        if (bx.ok) {
          await rest(`qs_meetings?id=eq.${enc(m.id)}&bitrix_synced=not.is.true`, {
            method: 'PATCH', prefer: 'return=minimal',
            body: { bitrix_synced: true, bitrix_synced_at: new Date().toISOString() },
          }).catch(() => null);
        }
      }
      feitos.push({ id: m.id, ok: true, link: !!sala.link, tentativa: n });
    } else {
      // Só grava se continuar sem evento: não atropela um sucesso concorrente.
      await rest(`qs_meetings?id=eq.${enc(m.id)}&calendar_event_id=is.null`, {
        method: 'PATCH', prefer: 'return=minimal', body: { calendar_error: marcar(n, sala.erro) },
      }).catch(() => null);
      feitos.push({ id: m.id, ok: false, tentativa: n, erro: String(sala.erro || '').slice(0, 120) });
    }
  }
  return { candidatas: Array.isArray(rows) ? rows.length : 0, feitos };
}

// ─── 2. Bitrix ───────────────────────────────────────────────────────────────

async function repararBitrix(prazo) {
  if (!(process.env.N8N_SYNC_BASE || '').trim()) return { pulado: 'N8N_SYNC_BASE ausente' };
  const agora = Date.now();
  const rows = await rest(
    'qs_meetings?select=*,lead:qs_leads(id,bitrix_id)' +
    '&status=in.(agendada,confirmada)&bitrix_synced=not.is.true' +
    `&created_at=gte.${enc(new Date(agora - 30 * 86_400_000).toISOString())}` +
    `&created_at=lt.${enc(new Date(agora - CARENCIA_MS).toISOString())}` +
    '&order=created_at.asc&limit=60'
  );
  const lista = (Array.isArray(rows) ? rows : []).filter((m) => m.lead?.bitrix_id);
  if (!lista.length) return { candidatas: 0, feitos: [] };

  // Só a reunião mais nova de cada lead: mandar uma antiga sobrescreveria a
  // data da nova no card.
  const leads = [...new Set(lista.map((m) => m.lead_id))];
  const outras = await rest(
    `qs_meetings?select=id,lead_id,scheduled_at&lead_id=in.(${leads.map(enc).join(',')})` +
    '&status=in.(agendada,confirmada,realizada,no_show)'
  ).catch(() => null);
  if (!Array.isArray(outras)) return { erro: 'não deu pra conferir as reuniões mais novas; nada reenviado' };
  const maisNova = new Map();
  for (const o of outras) {
    const t = new Date(o.scheduled_at).getTime();
    const atual = maisNova.get(o.lead_id);
    if (!atual || t > atual.t) maisNova.set(o.lead_id, { id: o.id, t });
  }

  const feitos = [];
  let tentados = 0;
  for (const m of lista) {
    if (tentados >= MAX_BITRIX_POR_RODADA || Date.now() > prazo) break;
    if (maisNova.get(m.lead_id)?.id !== m.id) continue;
    const marca = lerMarca(m.bitrix_error);
    if (!podeTentar(marca, agora)) continue;
    tentados++;
    const n = marca.n + 1;

    const r = await enviarReuniaoAoBitrix(m, m.lead, { timeoutMs: 12_000 });
    if (r.ok) {
      // O n8n já grava isto; gravar aqui também cobre workflow que não grava de
      // volta — sem isso o próximo ciclo reenviaria (e comentaria) de novo.
      await rest(`qs_meetings?id=eq.${enc(m.id)}&bitrix_synced=not.is.true`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { bitrix_synced: true, bitrix_synced_at: new Date().toISOString(), bitrix_error: null },
      }).catch(() => null);
      feitos.push({ id: m.id, ok: true, tentativa: n });
    } else {
      await rest(`qs_meetings?id=eq.${enc(m.id)}&bitrix_synced=not.is.true`, {
        method: 'PATCH', prefer: 'return=minimal', body: { bitrix_error: marcar(n, r.erro) },
      }).catch(() => null);
      feitos.push({ id: m.id, ok: false, tentativa: n, erro: String(r.erro || '').slice(0, 120) });
    }
  }
  return { candidatas: lista.length, feitos };
}

// ─── Rota ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  const prazo = Date.now() + ORCAMENTO_MS;
  const saida = {};
  try {
    saida.meet = await repararMeet(prazo);
  } catch (e) {
    saida.meet = { erro: String(e?.message || 'falhou').slice(0, 200) };
  }
  try {
    saida.bitrix = await repararBitrix(prazo);
  } catch (e) {
    saida.bitrix = { erro: String(e?.message || 'falhou').slice(0, 200) };
  }
  console.log(`[agenda-reparo] ${JSON.stringify(saida)}`);
  const quebrou = saida.meet?.erro && saida.bitrix?.erro;
  return res.status(quebrou ? 500 : 200).json(saida);
}
