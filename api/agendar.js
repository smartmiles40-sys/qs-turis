// api/agendar.js
// -----------------------------------------------------------------------------
// AUTOAGENDAMENTO — o cliente escolhe o próprio horário (Bruno, 08/09/2026).
//
//   GET  /api/agendar           -> a grade: dias e horas com especialista livre
//   POST /api/agendar           -> marca a reunião
//
// A página que consome isto é `public/agendar/index.html`, servida em /agendar/
// e feita pra ser embutida num <iframe> dentro do STFV Forms. Ver
// docs/AUTOAGENDAMENTO.md.
//
// ── POR QUE ESTA ROTA NÃO REESCREVE O AGENDAMENTO ───────────────────────────
// Tudo o que marca reunião no QS já existia em `api/_agenda.js`, escrito pra
// Glória: rodízio de especialista, trava anti-choque no banco (constraint
// EXCLUDE da 0027), sala do Meet pelo n8n, aviso ao Bitrix, transferência do
// lead pro closer e as tarefas de confirmar presença e registrar desfecho.
// Aqui só se acrescenta a PORTA e a assinatura de quem marcou. Um segundo motor
// de agenda divergiria do primeiro no primeiro ajuste, e o sintoma seria dois
// clientes na mesma hora do mesmo especialista.
//
// ── ESTA ROTA É PÚBLICA, E ISSO É DE PROPÓSITO ──────────────────────────────
// Ela roda no navegador de um desconhecido, então não carrega segredo nenhum
// (o `x-lead-secret` do lead-inbound não caberia aqui). As contenções são as
// mesmas do /api/lead, que já rodam em produção desde 04/09:
//   • CORS por allowlist (qs_settings.lp_origins) + o próprio domínio do QS;
//   • campo-armadilha (honeypot) `site`;
//   • teto por IP por hora (qs_lp_rate_bump, a mesma função da 0076);
//   • a agenda nunca sai inteira: o GET devolve HORAS, nunca o especialista —
//     ninguém de fora consegue mapear a agenda de uma pessoa do time;
//   • quem já tem reunião marcada no futuro não marca outra;
//   • toda regra de horário é reconferida no POST. O que o navegador manda é
//     um palpite; quem decide é o servidor.
// O pior estrago possível é reunião falsa na agenda — nada destrutivo, nada
// que apague dado. E reunião falsa aparece na Agenda pro time cancelar.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { createInboundLead, normPhone } from './_leads.js';
import {
  gradePublica,
  escolherCloserLivre,
  marcarReuniao,
  comRegras,
  emailValido,
  emSP,
  instanteEmSP,
  comoOTimeFala,
  ORIGEM_AUTOAGENDAMENTO,
} from './_agenda.js';

// Mesma última linha de defesa do /api/lead: se qs_settings sumir ou vier
// corrompido, a página não para de funcionar.
const ORIGENS_PADRAO = [
  'https://setuforeuvouviagens.com.br',
  'https://live.setuforeuvouviagens.com.br',
  'https://forms.setuforeuvouviagens.com.br',
];

const TETO_PADRAO = 20;          // chamadas por IP por hora
const CACHE_MS = 60_000;

/**
 * O padrão do autoagendamento — as regras da Glória, que já rodaram em produção
 * e foram desenhadas contra no-show (11h–18h, seg a sex, nada com menos de 3h
 * de antecedência). `qs_settings.autoagendamento` sobrescreve sem deploy.
 */
const CFG_PADRAO = {
  ativo: true,
  janela: { primeira: 11, ultima: 17 },   // 17h é o último começo (termina 18h)
  dias: [1, 2, 3, 4, 5],
  duracaoMin: 60,
  antecedenciaMin: 180,
  diasAFrente: 14,
  titulo: 'Fale com um especialista',
  subtitulo: 'Escolha o melhor dia e horário. A conversa dura 1 hora, por Google Meet.',
  encerrado: 'No momento não temos horário disponível. Fale com a gente pelo WhatsApp que a gente encaixa você.',
};

let cacheCfg = { em: 0, cfg: null, origens: null, teto: null };

async function lerConfig() {
  if (cacheCfg.cfg && Date.now() - cacheCfg.em < CACHE_MS) return cacheCfg;
  let cfg = CFG_PADRAO, origens = ORIGENS_PADRAO, teto = TETO_PADRAO;
  try {
    const rows = await rest(
      'qs_settings?select=key,value&key=in.(autoagendamento,lp_origins,lp_rate_limit)',
      { timeoutMs: 2500 }
    );
    const mapa = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    if (mapa.autoagendamento && typeof mapa.autoagendamento === 'object') {
      cfg = { ...CFG_PADRAO, ...mapa.autoagendamento };
      // A janela é objeto: espalhar por cima perderia metade dela se o Bruno
      // salvar só `{ "primeira": 9 }`.
      cfg.janela = { ...CFG_PADRAO.janela, ...(mapa.autoagendamento.janela || {}) };
    }
    if (Array.isArray(mapa.lp_origins) && mapa.lp_origins.length) {
      origens = mapa.lp_origins.filter((o) => typeof o === 'string');
    }
    if (Number.isFinite(Number(mapa.lp_rate_limit))) teto = Number(mapa.lp_rate_limit);
  } catch {
    // Banco fora: segue com o padrão em vez de derrubar a página inteira.
  }
  cacheCfg = { em: Date.now(), cfg, origens, teto };
  return cacheCfg;
}

// ─── Portaria (idêntica em espírito à do /api/lead) ──────────────────────────

/**
 * O Origin bate com a allowlist?
 *
 * Comparação EXATA de esquema+host, nunca `endsWith` — que deixaria passar
 * `https://setuforeuvouviagens.com.br.evil.com`.
 *
 * O próprio domínio do QS entra sempre: a página /agendar/ está hospedada aqui,
 * e o `fetch` dela — mesmo dentro de um iframe de outro site — sai com o Origin
 * do QS. Sem isso, o embed não funcionaria em lugar nenhum.
 */
function origemPermitida(origin, permitidas, proprio) {
  if (!origin) return false;
  let o;
  try { o = new URL(origin); } catch { return false; }
  const normal = `${o.protocol}//${o.host}`;
  if (proprio && normal === proprio) return true;
  return permitidas.some((p) => {
    try { const u = new URL(p); return `${u.protocol}//${u.host}` === normal; } catch { return false; }
  });
}

function proprioOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (!host) return null;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

function aplicarCors(res, origin, permitido) {
  if (permitido) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Hash do IP — contar chamadas não exige guardar dado pessoal (LGPD). */
function chaveIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.socket?.remoteAddress || '';
  if (!ip) return '';
  const sal = process.env.LEAD_INBOUND_SECRET || 'qs-agendar';
  return createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32);
}

function texto(v, max) {
  if (v == null) return null;
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// ─── A conferência do horário, no servidor ───────────────────────────────────

/**
 * O horário que veio do navegador é um dos que a grade oferece?
 *
 * Reconferir aqui não é paranoia: o corpo do POST é escrito por quem quiser.
 * Sem isto, um POST à mão marcaria 3h da manhã de um domingo, ou daqui a 5
 * minutos (que vira no-show), ou daqui a um ano. As mesmas regras da grade,
 * aplicadas de novo do lado de cá.
 */
function horarioValido(inicio, regras, agora) {
  if (Number.isNaN(inicio.getTime())) return 'Data e hora inválidas.';

  const p = emSP(inicio);
  if (p.min !== 0) return 'Escolha um horário cheio.';
  if (!regras.dias.includes(p.diaSemana)) return 'Esse dia não está disponível.';
  if (p.hora < regras.janela.primeira || p.hora > regras.janela.ultima) {
    return 'Esse horário está fora do nosso atendimento.';
  }
  // Prova de que a hora "bate" no fuso: reconstruir o instante a partir das
  // partes em São Paulo tem que devolver exatamente o mesmo timestamp. Sem
  // isso, um ISO com segundos ou com offset esquisito passaria pelas checagens
  // acima com a hora certa e cairia fora do lugar na agenda.
  if (instanteEmSP(p.ano, p.mes, p.dia, p.hora, 0).getTime() !== inicio.getTime()) {
    return 'Data e hora inválidas.';
  }

  const minimo = agora.getTime() + regras.antecedenciaMin * 60_000;
  if (inicio.getTime() < minimo) {
    return 'Esse horário está perto demais. Escolha outro, por favor.';
  }
  const maximo = agora.getTime() + (regras.diasAFrente + 1) * 86_400_000;
  if (inicio.getTime() > maximo) return 'Esse horário está longe demais.';

  return null;
}

/**
 * A pessoa já tem reunião marcada?
 *
 * Marcar a segunda seria queimar duas horas da agenda do time com o mesmo
 * cliente — e é o que acontece quando alguém agenda, não vê o e-mail e agenda
 * de novo. Em vez de recusar seco, a resposta devolve QUANDO é a reunião que já
 * existe, que é a informação que a pessoa está procurando.
 */
async function reuniaoQueJaExiste(leadId, agora) {
  try {
    const rows = await rest(
      `qs_meetings?select=id,scheduled_at,meeting_owner,meeting_link&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&status=in.(agendada,confirmada)&scheduled_at=gte.${agora.toISOString()}` +
      '&order=scheduled_at&limit=1'
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    // Falha aberta: não dá pra recusar um agendamento porque a CONFERÊNCIA
    // caiu. A trava que importa (dois no mesmo horário) é a do banco.
    console.warn('[agendar] não deu pra conferir reunião existente:', e?.message);
    return null;
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const { cfg, origens, teto } = await lerConfig();
  const permitido = origemPermitida(origin, origens, proprioOrigin(req));

  // Nunca cacheia: a grade muda a cada reunião marcada, e servir grade velha
  // faz a pessoa clicar num horário que já não existe.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  aplicarCors(res, origin, permitido);

  if (req.method === 'OPTIONS') return res.status(permitido ? 204 : 403).end();

  // Origin ausente (curl, o próprio iframe em GET) passa; Origin PRESENTE e de
  // fora, não. Quem sempre manda Origin é o navegador de terceiro — é ele que
  // está sendo barrado.
  if (origin && !permitido) {
    return res.status(403).json({ ok: false, error: 'Origem não autorizada' });
  }

  if (cfg.ativo === false) {
    return res.status(200).json({ ok: false, motivo: 'desligado', recado: cfg.encerrado, dias: [] });
  }

  const regras = comRegras(cfg);

  if (req.method === 'GET') return await mostrarGrade(res, { cfg, regras });
  if (req.method === 'POST') return await marcar(req, res, { cfg, regras, teto });

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ ok: false, error: 'Use GET ou POST' });
}

// ─── GET: a grade ────────────────────────────────────────────────────────────

async function mostrarGrade(res, { cfg, regras }) {
  try {
    const grade = await gradePublica({ regras });
    return res.status(200).json({
      ok: grade.ok,
      motivo: grade.motivo,
      recado: grade.ok ? null : cfg.encerrado,
      titulo: cfg.titulo,
      subtitulo: cfg.subtitulo,
      duracao_min: regras.duracaoMin,
      dias: grade.dias,
    });
  } catch (e) {
    console.error('[agendar] grade:', e?.message);
    return res.status(200).json({ ok: false, motivo: 'falha', recado: cfg.encerrado, dias: [] });
  }
}

// ─── POST: marcar ────────────────────────────────────────────────────────────

async function marcar(req, res, { cfg, regras, teto }) {
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};

  // CAMPO-ARMADILHA. A página tem um input escondido chamado `site`; gente não
  // vê, robô de formulário preenche. Responde como se tivesse dado certo pra
  // não ensinar o robô qual campo o entregou — e não grava nada.
  if (texto(body.site, 200)) {
    return res.status(200).json({ ok: true, quando: 'em breve', especialista: null, link: null });
  }

  const nome = texto(body.nome, 120);
  const telefone = normPhone(body.telefone || body.whatsapp);
  const email = texto(body.email, 160);
  const expedicao = texto(body.expedicao, 80);
  const origemLp = texto(body.origem, 80);
  const observacao = texto(body.observacao, 400);
  const agora = new Date();

  if (!nome || nome.length < 2) {
    return res.status(400).json({ ok: false, campo: 'nome', error: 'Diga o seu nome, por favor.' });
  }
  if (!telefone || telefone.length < 10) {
    return res.status(400).json({ ok: false, campo: 'telefone', error: 'Confira o número do WhatsApp com o DDD.' });
  }
  if (!emailValido(email)) {
    // O e-mail é OBRIGATÓRIO aqui, diferente da Glória: sem ele o convite do
    // Google não chega em ninguém, e reunião que a pessoa não tem no calendário
    // é reunião que ela não vai.
    return res.status(400).json({ ok: false, campo: 'email', error: 'Precisamos do seu e-mail para enviar o convite.' });
  }

  const inicio = new Date(String(body.inicio || ''));
  const problema = horarioValido(inicio, regras, agora);
  if (problema) return res.status(400).json({ ok: false, campo: 'inicio', error: problema });

  // ── TETO POR IP ───────────────────────────────────────────────────────────
  // Falha aberta de propósito: se o banco não responde, o limite não se aplica
  // e o agendamento segue. Perder cliente por causa do contador de abuso seria
  // trocar um problema hipotético por um prejuízo real.
  try {
    const chave = chaveIp(req);
    if (chave) {
      const ok = await rest('rpc/qs_lp_rate_bump', {
        method: 'POST',
        body: { p_chave: `agendar:${chave}`, p_teto: teto },
        timeoutMs: 2000,
      });
      if (ok === false) {
        return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
      }
    }
  } catch (e) {
    console.warn('[agendar] limite por IP indisponível:', e?.message || e);
  }

  try {
    // ── 1) O especialista ───────────────────────────────────────────────────
    // ANTES de criar lead: se ninguém está livre nesse horário, não faz sentido
    // ter criado um lead pra depois dizer "não deu". O horário pode ter sido
    // preenchido entre o carregamento da página e o clique.
    const closer = await escolherCloserLivre({ inicio, duracaoMin: regras.duracaoMin, agora });
    if (!closer) {
      return res.status(409).json({
        ok: false,
        motivo: 'horario_ocupado',
        error: 'Esse horário acabou de ser preenchido. Escolha outro, por favor.',
      });
    }

    // ── 2) O lead ───────────────────────────────────────────────────────────
    // Mesmo caminho de todo lead que entra no QS (`createInboundLead`): dedupe
    // por telefone, dono pelo rodízio, tarefas da cadência e negócio no Bitrix.
    // Quem já existe é REAPROVEITADO, não duplicado.
    //
    // De propósito NÃO passa pela Glória nem pelo primeiro contato automático
    // (que moram no /api/lead-inbound, não aqui): abordar por WhatsApp quem
    // acabou de marcar reunião é o robô atropelando o próprio resultado.
    // `source` é ENUM no banco ('manual'|'api'|'integracao'|'importacao') e
    // qualquer outra coisa vira 'integracao' EM SILÊNCIO — medido na marra em
    // 08/09, mandando "Autoagendamento" e recebendo "integracao" de volta.
    // A fonte de verdade (a que o dashboard agrupa) mora em `segment`, que é
    // texto livre; é o mesmo lugar onde o Bitrix guarda "[Japão] - Live".
    const { lead } = await createInboundLead({
      full_name: nome,
      email,
      phone: telefone,
      source: 'integracao',
      segment: origemLp || 'Autoagendamento',
      lead_score: 'quente',   // quem escolhe horário e dá o e-mail não é frio
    });
    if (!lead?.id) {
      return res.status(500).json({ ok: false, error: 'Não consegui registrar seus dados. Tente de novo.' });
    }

    // ── 3) Já tem reunião? ──────────────────────────────────────────────────
    const jaTem = await reuniaoQueJaExiste(lead.id, agora);
    if (jaTem) {
      return res.status(200).json({
        ok: true,
        ja_existia: true,
        quando: comoOTimeFala(new Date(jaTem.scheduled_at), agora),
        especialista: jaTem.meeting_owner || null,
        link: jaTem.meeting_link || null,
      });
    }

    // ── 4) Marcar ───────────────────────────────────────────────────────────
    // Daqui pra baixo é a MESMA máquina da Glória: reserva no banco (com a
    // trava anti-choque), sala do Meet pelo n8n, Bitrix avisado, lead
    // transferido pro especialista, tarefas de confirmar e de desfecho.
    const r = await marcarReuniao({
      lead,
      opcao: { closerId: closer.id, quando: inicio },
      email,
      titulo: expedicao ? `Expedição ${expedicao}` : null,
      resumo: [
        origemLp ? `Origem: ${origemLp}` : null,
        expedicao ? `Interesse: ${expedicao}` : null,
        observacao ? `Recado do cliente: ${observacao}` : null,
      ].filter(Boolean).join(' · ') || null,
      origem: ORIGEM_AUTOAGENDAMENTO,
      regras: cfg,
    });

    if (!r.ok) {
      const recados = {
        horario_ocupado: 'Esse horário acabou de ser preenchido. Escolha outro, por favor.',
        cedo_demais: 'Esse horário está perto demais. Escolha outro, por favor.',
        sem_closer: 'Nenhum especialista disponível agora. Fale com a gente pelo WhatsApp.',
        closer_desconhecido: 'Recarregue a página e escolha o horário de novo.',
      };
      const status = r.motivo === 'horario_ocupado' ? 409 : 400;
      return res.status(status).json({
        ok: false,
        motivo: r.motivo,
        error: recados[r.motivo] || 'Não consegui marcar agora. Fale com a gente pelo WhatsApp.',
      });
    }

    return res.status(200).json({
      ok: true,
      quando: r.quando,
      quando_extenso: r.quando_extenso,
      especialista: r.especialista,
      link: r.link,
      // `avisos` não vai pro cliente: "sem link do Meet" é recado pro time (e já
      // está na nota do lead e em calendar_error), não pra quem acabou de
      // marcar. Do lado de cá, a reunião está marcada — que é o que importa.
    });
  } catch (e) {
    console.error('[agendar] falha:', e?.message);
    return res.status(500).json({ ok: false, error: 'Não consegui marcar agora. Tente de novo em instantes.' });
  }
}
