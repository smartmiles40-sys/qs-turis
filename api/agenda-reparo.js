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
//      o mesmo caminho do agendamento (direto no Bitrix desde 03/11).
//
// POR QUE NÃO DUPLICA:
//   • Meet: o evento nasce com um id DERIVADO do meeting_id (idEvento em
//     api/_googleAgenda.js, o mesmo algoritmo do n8n de antes de 03/11).
//     Reenviar a mesma reunião faz o Google responder 409 e devolver a
//     MESMA sala — não nasce segundo evento nem segundo convite. E aqui só
//     entra reunião SEM `calendar_event_id` (evento que já existe não é
//     recriado; o PATCH de erro também só grava se continuar sem evento).
//   • Bitrix: o envio da reunião é um crm.deal.update no negócio que o lead JÁ
//     aponta — nunca cria card. Repetir só reescreve os mesmos campos. O único
//     efeito repetível é o comentário na timeline, e por isso: só entra quem
//     está com bitrix_synced falso; sucesso marca bitrix_synced=true aqui mesmo
//     (além do que o próprio envio grava); o erro só é gravado se a linha
//     continuar não sincronizada (não apaga um sucesso concorrente).
//   • Ficam de FORA de propósito: reunião que não é a mais nova do lead (a
//     data velha sobrescreveria a nova). Até 09/11 ficavam de fora também as
//     com desfecho (medo de puxar a etapa pra trás) — mas o envio da reunião
//     não manda STAGE_ID (montarReuniao sem etapaReuniao), e elas sumiam do
//     reparo pra sempre; ver "REUNIÃO COM DESFECHO" abaixo. Também ficam de fora os "gravado, mas
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
// ERRO DE CÓDIGO NÃO GASTA TENTATIVA (09/11). Entre 03 e 09/11 todas as
// reuniões pendentes queimaram as 5 tentativas em "ilegivel is not defined" —
// bug do NOSSO código, não recusa do Bitrix — e, consertado o bug, nenhuma
// seria tentada de novo. Agora ReferenceError/TypeError/"is not defined"/"is
// not a function" ficam marcados "[reparo n/5 … código]" SEM somar, e voltam a
// ser tentados a cada 30 min, pra sempre (dentro da janela da consulta). As
// que já estavam "desisti" por erro de código voltam a ser tentadas, com o
// contador zerado. Erro do Bitrix (dado inválido, recusa) segue desistindo na 5ª.
//
// REUNIÃO COM DESFECHO QUE NUNCA SINCRONIZOU (09/11). Realizada, no-show,
// desistência, cancelada e reagendada dos últimos 14 dias com bitrix_synced
// falso também entram: a reunião vai pelo MESMO enviarReuniaoAoBitrix (que só
// grava campos/comentário — não mexe na ETAPA, então não puxa o card pra
// trás) e, se o desfecho também não foi (desfecho_enviado_em nulo; só
// realizada/no-show/desistência têm desfecho no Bitrix), o desfecho vai logo
// depois, pela própria rota /api/bitrix-sync (nota + reuniao-campos, as mesmas
// chamadas do botão "Reenviar pro Bitrix"), chamada em processo com o
// INTERNAL_API_SECRET. A guarda de etapa do reuniao-campos continua valendo.
// O contador do desfecho mora em `desfecho_erro`, no mesmo formato. Desfecho que
// falhou numa rodada é tentado de novo nas seguintes (só os que o reparo começou).
// A regra "só a mais nova do lead" vale pra todas — por isso a reagendada quase
// nunca vai: a substituta é mais nova e carrega a informação.
//
// Env: CRON_SECRET, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN
// (Meet), BITRIX_WEBHOOK_BASE (Bitrix), INTERNAL_API_SECRET (desfecho). Sem a
// env de um lado, aquele lado é pulado com recado, sem erro.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { criarSalaDoMeet, enviarReuniaoAoBitrix } from './_agenda.js';
import { googleConfigurado, motivoNaoConfigurado } from './_google.js';
import { bitrixConfigurado } from './_bitrixLead.js';
import rotaBitrixSync from './bitrix-sync.js';

const MAX_TENTATIVAS = 5;
/** Espera (min) antes da tentativa n+1, onde n = tentativas já feitas. */
const ESPERA_MIN = [0, 10, 30, 60, 120];
/** Erro de código não gasta tentativa: só espera isto até tentar de novo. */
const ESPERA_CODIGO_MIN = 30;
/** Reunião recém-criada ainda pode estar no meio do fluxo da tela. */
const CARENCIA_MS = 5 * 60_000;
/** maxDuration da rota é 60 s; para de começar tentativa nova antes disso. */
const ORCAMENTO_MS = 45_000;
const MAX_MEET_POR_RODADA = 4;
/** Cada tentativa (reunião OU desfecho) conta 1. */
const MAX_BITRIX_POR_RODADA = 6;
/** Reunião com desfecho que nunca sincronizou: até quantos dias pra trás. */
const JANELA_DESFECHO_DIAS = 14;

const STATUS_ENCERRADOS = ['realizada', 'no_show', 'desistencia', 'cancelada', 'reagendada'];
/** Os que têm desfecho no Bitrix (temDesfecho em src/lib/qs/meetings.ts). */
const STATUS_COM_DESFECHO = new Set(['realizada', 'no_show', 'desistencia']);
/** Reuniões que contam pra "qual é a mais nova do lead". */
const STATUS_VIGENTES = 'agendada,confirmada,realizada,no_show,desistencia';

const RE_MARCA = /^\[reparo (\d+)\/\d+ ([0-9T:.\-Z]+)([^\]]*)\]\s*/;

/** Falha do NOSSO código (bug), não do Bitrix: não deve gastar tentativa. */
const RE_ERRO_DE_CODIGO = /\b(ReferenceError|TypeError|SyntaxError|RangeError)\b|is not defined|is not a function|is not a constructor|is not iterable|Cannot read propert|Cannot set propert|before initialization/i;

export function ehErroDeCodigo(texto) {
  return RE_ERRO_DE_CODIGO.test(String(texto || ''));
}

/**
 * Lê "[reparo n/5 quando (desisti|código)]" do texto do erro. `n` = tentativas
 * que CONTAM. Marca antiga (antes de 09/11) com erro de código no texto: todas
 * as tentativas dela foram gastas pelo bug — zera.
 */
export function lerMarca(texto) {
  const m = String(texto || '').match(RE_MARCA);
  if (!m) return { n: 0, ultima: 0, codigo: false, resto: String(texto || '') };
  const ultima = new Date(m[2]).getTime();
  const resto = String(texto).slice(m[0].length);
  const flagCodigo = /c[oó]digo/i.test(m[3]);
  const codigo = flagCodigo || ehErroDeCodigo(resto);
  const n = codigo && !flagCodigo ? 0 : (Number(m[1]) || 0);
  return { n, ultima: Number.isNaN(ultima) ? 0 : ultima, codigo, resto };
}

export function podeTentar(marca, agora) {
  if (marca.codigo) return agora - marca.ultima >= ESPERA_CODIGO_MIN * 60_000;
  if (marca.n >= MAX_TENTATIVAS) return false;
  const espera = (ESPERA_MIN[marca.n] ?? ESPERA_MIN[ESPERA_MIN.length - 1]) * 60_000;
  return agora - marca.ultima >= espera;
}

function marcar(n, motivo, flag = '') {
  const desisti = !flag && n >= MAX_TENTATIVAS ? ' desisti' : '';
  return `[reparo ${n}/${MAX_TENTATIVAS} ${new Date().toISOString()}${desisti}${flag}] ${String(motivo || 'falhou')}`.slice(0, 300);
}

/** Texto do erro depois de uma tentativa que falhou. Erro de código não soma. */
export function proximaMarca(marca, erro) {
  return ehErroDeCodigo(erro) ? marcar(marca.n, erro, ' código') : marcar(marca.n + 1, erro);
}

/**
 * Há outra reunião VIGENTE do mesmo lead marcada pra depois desta? Mandar a
 * antiga sobrescreveria a data da nova no card. Empate de horário: decide o id
 * (determinístico — só uma das duas vai).
 */
export function haReuniaoMaisNova(m, outras) {
  const t = new Date(m.scheduled_at).getTime();
  return (outras || []).some((o) => {
    if (o.lead_id !== m.lead_id || o.id === m.id) return false;
    const to = new Date(o.scheduled_at).getTime();
    return to > t || (to === t && String(o.id) > String(m.id));
  });
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
        method: 'PATCH', prefer: 'return=minimal', body: { calendar_error: proximaMarca(marca, sala.erro) },
      }).catch(() => null);
      feitos.push({ id: m.id, ok: false, tentativa: n, erro: String(sala.erro || '').slice(0, 120) });
    }
  }
  return { candidatas: Array.isArray(rows) ? rows.length : 0, feitos };
}

// ─── 2. Bitrix ───────────────────────────────────────────────────────────────

async function repararBitrix(prazo) {
  if (!bitrixConfigurado()) return { pulado: 'BITRIX_WEBHOOK_BASE ausente' };
  const agora = Date.now();
  const carencia = enc(new Date(agora - CARENCIA_MS).toISOString());
  const desde14 = enc(new Date(agora - JANELA_DESFECHO_DIAS * 86_400_000).toISOString());
  const SEL = 'qs_meetings?select=*,lead:qs_leads(id,bitrix_id)';
  const [abertas, encerradas, desfechosPendentes] = await Promise.all([
    rest(
      SEL + '&status=in.(agendada,confirmada)&bitrix_synced=not.is.true' +
      `&created_at=gte.${enc(new Date(agora - 30 * 86_400_000).toISOString())}` +
      `&created_at=lt.${carencia}&order=created_at.asc&limit=60`
    ),
    // Desfecho lançado numa reunião que nunca chegou no Bitrix (09/11).
    rest(
      SEL + `&status=in.(${STATUS_ENCERRADOS.join(',')})&bitrix_synced=not.is.true` +
      `&scheduled_at=gte.${desde14}&created_at=lt.${carencia}&order=scheduled_at.asc&limit=40`
    ).catch(() => []),
    // Reunião já sincronizada cujo desfecho o REPARO começou a mandar e ainda
    // não chegou (o contador está no desfecho_erro). Os que falharam só pela
    // tela ficam com o botão/lista do gestor, como antes.
    rest(
      SEL + '&status=in.(realizada,no_show,desistencia)&bitrix_synced=is.true&desfecho_enviado_em=is.null' +
      `&desfecho_erro=like.${enc('[reparo *')}&scheduled_at=gte.${desde14}&order=scheduled_at.asc&limit=20`
    ).catch(() => []),
  ]);
  const lista = [...(Array.isArray(abertas) ? abertas : []), ...(Array.isArray(encerradas) ? encerradas : [])]
    .filter((m) => m.lead?.bitrix_id);
  const soDesfecho = (Array.isArray(desfechosPendentes) ? desfechosPendentes : []).filter((m) => m.lead?.bitrix_id);
  if (!lista.length && !soDesfecho.length) return { candidatas: 0, feitos: [] };

  // Só a reunião mais nova de cada lead: mandar uma antiga sobrescreveria a
  // data da nova no card.
  let outras = [];
  if (lista.length) {
    const leads = [...new Set(lista.map((m) => m.lead_id))];
    outras = await rest(
      `qs_meetings?select=id,lead_id,scheduled_at&lead_id=in.(${leads.map(enc).join(',')})` +
      `&status=in.(${STATUS_VIGENTES})`
    ).catch(() => null);
    if (!Array.isArray(outras)) return { erro: 'não deu pra conferir as reuniões mais novas; nada reenviado' };
  }

  const feitos = [];
  let tentados = 0;
  const cabe = () => tentados < MAX_BITRIX_POR_RODADA && Date.now() <= prazo;

  for (const m of lista) {
    if (!cabe()) break;
    if (haReuniaoMaisNova(m, outras)) continue;
    const marca = lerMarca(m.bitrix_error);
    if (!podeTentar(marca, agora)) continue;
    tentados++;

    const r = await enviarReuniaoAoBitrix(m, m.lead, { timeoutMs: 12_000 });
    if (r.ok) {
      // O envio já grava isto; gravar aqui de novo garante — sem isso o
      // próximo ciclo reenviaria (e comentaria) de novo.
      await rest(`qs_meetings?id=eq.${enc(m.id)}&bitrix_synced=not.is.true`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { bitrix_synced: true, bitrix_synced_at: new Date().toISOString(), bitrix_error: null },
      }).catch(() => null);
      const item = { id: m.id, ok: true, status: m.status, tentativa: marca.n + 1 };
      // A reunião chegou; o desfecho vai atrás (se tiver e ainda não foi).
      if (STATUS_COM_DESFECHO.has(m.status) && !m.desfecho_enviado_em && cabe()) {
        const d = await tentarDesfecho(m, agora);
        if (d.tentou) tentados++;
        item.desfecho = d;
      }
      feitos.push(item);
    } else {
      const texto = proximaMarca(marca, r.erro);
      await rest(`qs_meetings?id=eq.${enc(m.id)}&bitrix_synced=not.is.true`, {
        method: 'PATCH', prefer: 'return=minimal', body: { bitrix_error: texto },
      }).catch(() => null);
      feitos.push({ id: m.id, ok: false, status: m.status, codigo: ehErroDeCodigo(r.erro), marca: texto.slice(0, 40), erro: String(r.erro || '').slice(0, 120) });
    }
  }

  for (const m of soDesfecho) {
    if (!cabe()) break;
    const d = await tentarDesfecho(m, agora);
    if (d.tentou) { tentados++; feitos.push({ id: m.id, so_desfecho: true, desfecho: d }); }
  }
  return { candidatas: lista.length, desfechos_pendentes: soDesfecho.length, feitos };
}

// ─── 2b. Desfecho (nota + campos), pela própria rota /api/bitrix-sync ────────

/** Data/hora em Brasília, como a tela escreve na nota. */
function quandoBR(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(iso || ''); }
}

const FRASE_DESFECHO = {
  realizada: 'foi REALIZADA',
  no_show: 'teve NO-SHOW (cliente não compareceu)',
  desistencia: 'foi encerrada por DESISTÊNCIA do cliente',
};

/**
 * Os dois eventos do enviarDesfecho da tela (src/lib/qs/meetings.ts), com os
 * mesmos valores. Exportada pros testes.
 */
export function montarDesfecho(m) {
  const ehRetomada = (m.tipo ?? 'primeira') === 'retomada';
  const sal = !ehRetomada && (m.status === 'realizada' || m.status === 'no_show') ? m.sal ?? null : null;
  const motivo = m.status === 'desistencia'
    ? (String(m.desistencia_motivo || '').trim() || 'não informado (desistência registrada no QS antes de 22/09)')
    : null;
  const nota = {
    event: 'nota',
    lead_id: m.lead_id,
    body:
      `Reunião de ${quandoBR(m.scheduled_at)}${m.title ? ` (${m.title})` : ''} ` +
      `${FRASE_DESFECHO[m.status] ?? `está como ${m.status}`} no QS.` +
      (sal ? ` SAL: ${sal === 'aceito' ? 'ACEITO' : 'RECUSADO'}${sal === 'recusado' && m.sal_motivo ? ` (${m.sal_motivo})` : ''}.` : '') +
      (motivo ? ` Motivo: ${motivo}.` : '') +
      ' (reenviado pelo reparo automático)',
  };
  const campos = {
    event: 'reuniao-campos',
    lead_id: m.lead_id,
    desfecho: m.status,
    data: String(m.realizada_em ?? m.scheduled_at).slice(0, 10),
    valor: m.venda_valor ?? undefined,
    tipo_venda: m.venda_tipo || undefined,
    sal: sal ?? undefined,
    motivo: motivo ?? undefined,
  };
  return { nota, campos };
}

/** Chama o handler do /api/bitrix-sync em processo (sem HTTP), como servidor. */
async function chamarBitrixSync(body, segredo) {
  const res = {
    statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  await rotaBitrixSync({ method: 'POST', headers: { 'x-internal-secret': segredo }, body }, res);
  return res;
}

/** Lê a resposta da rota: { ok } | { pular } | { erro }. */
function lerResposta(res) {
  const b = res?.body || {};
  if (b.code === 'not_configured') return { pular: 'integração com o Bitrix desligada' };
  if (b.code === 'skipped_no_bitrix_id') return { erro: 'lead sem negócio no Bitrix' };
  if (res?.statusCode === 401) return { pular: 'INTERNAL_API_SECRET não confere' };
  if (b.success) return { ok: true };
  return { erro: String(b.error || `HTTP ${res?.statusCode}`) };
}

async function enviarDesfecho(m) {
  const segredo = process.env.INTERNAL_API_SECRET;
  if (!String(segredo || '').trim()) return { pular: 'INTERNAL_API_SECRET ausente' };
  const { nota, campos } = montarDesfecho(m);
  const r1 = lerResposta(await chamarBitrixSync(nota, segredo));
  if (!r1.ok) return r1;
  const r2 = lerResposta(await chamarBitrixSync(campos, segredo));
  if (r2.erro) return { erro: `A nota chegou, mas os campos do card não: ${r2.erro}` };
  return r2;
}

/** Uma tentativa do desfecho, com o contador em desfecho_erro. */
async function tentarDesfecho(m, agora) {
  const marca = lerMarca(m.desfecho_erro);
  if (!podeTentar(marca, agora)) return { tentou: false, motivo: 'esperando' };
  let r;
  try {
    r = await enviarDesfecho(m);
  } catch (e) {
    r = { erro: `${e?.name || 'Error'}: ${e?.message || 'falhou'}` };
  }
  if (r.pular) return { tentou: false, motivo: r.pular };
  // Só grava se o desfecho continuar sem envio: não atropela um envio da tela.
  const filtro = `qs_meetings?id=eq.${enc(m.id)}&desfecho_enviado_em=is.null`;
  if (r.ok) {
    await rest(filtro, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { desfecho_enviado_em: new Date().toISOString(), desfecho_erro: null },
    }).catch(() => null);
    return { tentou: true, ok: true };
  }
  const texto = proximaMarca(marca, r.erro);
  await rest(filtro, { method: 'PATCH', prefer: 'return=minimal', body: { desfecho_erro: texto } }).catch(() => null);
  return { tentou: true, ok: false, codigo: ehErroDeCodigo(r.erro), erro: String(r.erro || '').slice(0, 120) };
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
