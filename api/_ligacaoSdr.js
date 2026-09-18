// api/_ligacaoSdr.js
// -----------------------------------------------------------------------------
// A LIGAÇÃO COM O SDR — o cliente marca 5 minutos com o SDR, não com o closer
// (Bruno, 16/09/2026).
//
// O CENÁRIO. O formulário principal vai no chat do Meet quando a live acaba:
// quem estava lá marca direto com o especialista (`api/_agenda.js`). DEPOIS da
// live, quem não assistiu ou viu só metade recebe a gravação junto com um
// SEGUNDO formulário — e é esse que chega aqui. A pessoa escolhe um horário e o
// SDR dono do lead liga pra ela, qualifica, e só então marca com o closer.
// Motivo medido: das 63 reuniões marcadas pelo próprio cliente desde 08/09, 30
// eram de quem não assistiu ou viu metade.
//
// POR QUE NÃO É O MESMO MOTOR DA REUNIÃO. O `_agenda.js` é inteiro sobre o
// closer: rodízio de especialista, Google Meet, Bitrix no funil comercial,
// transferência do lead, SAL. Aqui não acontece nada disso — o lead FICA com o
// SDR e a ligação vira uma atividade extra na fila dele. O que é igual (o fuso)
// é importado de lá, não copiado.
//
// A TRAVA É DO BANCO, como na reunião: a constraint EXCLUDE da 0081 recusa duas
// ligações na mesma meia hora do mesmo SDR. Tudo o que este arquivo confere
// antes é pra dar uma mensagem boa, não pra garantir.
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { emSP, instanteEmSP, comoOTimeFala, porExtenso } from './_agenda.js';

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const UUID_LIKE = /^[0-9a-f-]{36}$/i;
const CACHE_MS = 60_000;

/**
 * O padrão (e a rede de segurança se `qs_settings.agendamento_sdr` sumir).
 * Horário comercial pedido pelo Bruno: 10h às 19h — a última ligação COMEÇA às
 * 18h30. De 30 em 30 minutos, mesmo a ligação durando 5: a folga é pra atraso
 * de quem atende e pra fila normal do SDR não parar.
 */
export const CFG_SDR_PADRAO = {
  ativo: true,
  janela: { primeira: '10:00', ultima: '18:30' },
  passoMin: 30,
  duracaoMin: 5,
  dias: [1, 2, 3, 4, 5],
  antecedenciaMin: 60,
  diasAFrente: 7,
  titulo: 'Agende uma ligação rápida',
  subtitulo: 'Escolha o melhor horário. É uma ligação de 5 minutos: nosso time te liga no WhatsApp.',
  encerrado: 'No momento não temos horário disponível. Fale com a gente pelo WhatsApp que a gente te liga.',
};

let cache = { em: 0, cfg: null };

/** "10:00" -> 600. Aceita número de hora cheia também (10 -> 600). */
function emMinutos(v, padrao) {
  if (typeof v === 'number' && Number.isFinite(v)) return v * 60;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : padrao;
}

export async function lerConfigSdr() {
  if (cache.cfg && Date.now() - cache.em < CACHE_MS) return cache.cfg;
  let bruto = {};
  try {
    const rows = await rest('qs_settings?select=value&key=eq.agendamento_sdr&limit=1', { timeoutMs: 2500 });
    if (rows?.[0]?.value && typeof rows[0].value === 'object') bruto = rows[0].value;
  } catch { /* banco fora: segue com o padrão */ }

  const c = { ...CFG_SDR_PADRAO, ...bruto };
  const j = { ...CFG_SDR_PADRAO.janela, ...(bruto.janela || {}) };
  const num = (v, p) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : p);
  const cfg = {
    ativo: c.ativo !== false,
    primeiraMin: emMinutos(j.primeira, 600),
    ultimaMin: emMinutos(j.ultima, 1110),
    passoMin: Math.max(5, num(c.passoMin, 30)),
    duracaoMin: Math.max(1, num(c.duracaoMin, 5)),
    dias: Array.isArray(c.dias) && c.dias.length ? c.dias.map(Number).filter((d) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
    antecedenciaMin: num(c.antecedenciaMin, 60),
    diasAFrente: num(c.diasAFrente, 7),
    titulo: c.titulo,
    subtitulo: c.subtitulo,
    encerrado: c.encerrado,
  };
  cache = { em: Date.now(), cfg };
  return cfg;
}

// ─── Quem ────────────────────────────────────────────────────────────────────

export async function sdrsAtivos() {
  const rows = await rest('qs_users?select=id,name,email&role=eq.sdr&is_active=is.true&order=name');
  return Array.isArray(rows) ? rows : [];
}

/**
 * O SDR dono deste telefone — a CARTEIRA (0073), a mesma regra que decide o
 * dono de todo lead que entra no QS. Só vale se ele for SDR ativo: carteira de
 * quem saiu do time, ou de closer, não prende ninguém.
 */
async function donoDoTelefone(telefone, sdrs) {
  if (!telefone) return null;
  try {
    const r = await rest('rpc/qs_carteira_do_telefone', { method: 'POST', body: { p_telefone: telefone }, timeoutMs: 3000 });
    const id = typeof r === 'string' ? r : (Array.isArray(r) ? r[0] : null);
    if (id && UUID_LIKE.test(String(id))) return sdrs.find((s) => s.id === String(id)) || null;
  } catch (e) {
    console.warn('[ligacao-sdr] carteira indisponível (segue sem dono):', e?.message);
  }
  return null;
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

async function reservas(de, ate) {
  const rows = await rest(
    'qs_ligacoes_sdr?select=sdr_id,inicio,fim&status=eq.marcada' +
    `&inicio=lt.${ate.toISOString()}&fim=gt.${de.toISOString()}`
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    sdr_id: r.sdr_id, inicio: new Date(r.inicio).getTime(), fim: new Date(r.fim).getTime(),
  }));
}

function livre(ocupado, sdrId, inicio, fim) {
  return !ocupado.some((o) => o.sdr_id === sdrId && inicio < o.fim && o.inicio < fim);
}

/** Todos os começos possíveis (sem olhar ocupação), dia a dia, em São Paulo. */
function horariosDaJanela(cfg, agora, desdeAmanha = false) {
  const hoje = emSP(agora);
  const cedo = agora.getTime() + cfg.antecedenciaMin * 60_000;
  const dias = [];
  for (let salto = desdeAmanha ? 1 : 0; salto <= cfg.diasAFrente; salto++) {
    const base = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia) + salto * 86_400_000);
    const ano = base.getUTCFullYear(), mes = base.getUTCMonth() + 1, d = base.getUTCDate();
    const dow = base.getUTCDay();
    if (!cfg.dias.includes(dow)) continue;
    const inicios = [];
    for (let m = cfg.primeiraMin; m <= cfg.ultimaMin; m += cfg.passoMin) {
      const inicio = instanteEmSP(ano, mes, d, Math.floor(m / 60), m % 60);
      if (inicio.getTime() < cedo) continue;
      inicios.push(inicio);
    }
    dias.push({ ano, mes, d, dow, salto, inicios });
  }
  return dias;
}

/**
 * A grade que o cliente vê.
 *
 * Com telefone (vem do formulário, que já tem o WhatsApp da pessoa): só os
 * horários do SDR DONO dela — foi a escolha do Bruno, quem conversa é quem vai
 * seguir o lead. Se o dono não tem horário nenhum na semana, abre pra todos os
 * SDRs: agenda vazia faria a pessoa fechar a aba, e o lead vale mais que a
 * carteira.
 *
 * O SDR nunca sai na resposta: a página é pública.
 */
export async function gradeSdr({ telefone = null, agora = new Date(), maxDias = null } = {}) {
  const cfg = await lerConfigSdr();
  const sdrs = await sdrsAtivos();
  if (!sdrs.length) return { ok: false, motivo: 'sem_sdr', dias: [], cfg };

  const ate = new Date(agora.getTime() + (cfg.diasAFrente + 1) * 86_400_000);
  const [ocupado, dono] = await Promise.all([reservas(agora, ate), donoDoTelefone(telefone, sdrs)]);

  const montar = (quem) => {
    const dias = [];
    // `maxDias` (formulário do tráfego, 18/09): N dias com horário, a partir
    // de amanhã — a mesma regra da agenda do closer no orgânico.
    for (const dia of horariosDaJanela(cfg, agora, !!maxDias)) {
      if (maxDias && dias.length >= maxDias) break;
      const horarios = dia.inicios
        .filter((ini) => quem.some((s) => livre(ocupado, s.id, ini.getTime(), ini.getTime() + cfg.passoMin * 60_000)))
        .map((ini) => {
          const p = emSP(ini);
          return { inicio: ini.toISOString(), hora: `${String(p.hora).padStart(2, '0')}:${String(p.min).padStart(2, '0')}` };
        });
      if (!horarios.length) continue;
      dias.push({
        dia: `${dia.ano}-${String(dia.mes).padStart(2, '0')}-${String(dia.d).padStart(2, '0')}`,
        rotulo: DIAS_SEMANA[dia.dow],
        curto: DIAS_SEMANA[dia.dow].slice(0, 3),
        data: `${String(dia.d).padStart(2, '0')}/${String(dia.mes).padStart(2, '0')}`,
        hoje: dia.salto === 0,
        horarios,
      });
    }
    return dias;
  };

  let dias = dono ? montar([dono]) : [];
  if (!dias.length) dias = montar(sdrs);
  return { ok: dias.length > 0, motivo: dias.length ? null : 'sem_horario', dias, cfg };
}

/** O horário que veio do navegador é um dos que a grade oferece? */
export function horarioValidoSdr(inicio, cfg, agora = new Date()) {
  if (Number.isNaN(inicio.getTime())) return 'Data e hora inválidas.';
  const p = emSP(inicio);
  const minutos = p.hora * 60 + p.min;
  if (!cfg.dias.includes(p.diaSemana)) return 'Esse dia não está disponível.';
  if (minutos < cfg.primeiraMin || minutos > cfg.ultimaMin || (minutos - cfg.primeiraMin) % cfg.passoMin !== 0) {
    return 'Esse horário está fora do nosso atendimento.';
  }
  // Reconstruir o instante pelas partes em SP tem que dar o mesmo timestamp —
  // pega ISO com segundos ou offset torto (mesma prova do /api/agendar).
  if (instanteEmSP(p.ano, p.mes, p.dia, p.hora, p.min).getTime() !== inicio.getTime()) return 'Data e hora inválidas.';
  if (inicio.getTime() < agora.getTime() + cfg.antecedenciaMin * 60_000) return 'Esse horário está perto demais. Escolha outro, por favor.';
  if (inicio.getTime() > agora.getTime() + (cfg.diasAFrente + 1) * 86_400_000) return 'Esse horário está longe demais.';
  return null;
}

/**
 * Qual SDR liga, neste horário.
 *
 *   • tem dono e ele está livre            -> o dono;
 *   • tem dono, ocupado, mas com horário na semana -> null (a grade dele foi a
 *     que a pessoa viu; o horário foi tomado no meio do caminho = 409);
 *   • sem dono, ou dono sem horário nenhum -> o SDR livre com MENOS ligações
 *     marcadas daqui pra frente (rodízio por carga, empate pelo nome).
 */
export async function escolherSdr({ inicio, telefone, agora = new Date() }) {
  const cfg = await lerConfigSdr();
  const sdrs = await sdrsAtivos();
  if (!sdrs.length) return null;

  const ate = new Date(agora.getTime() + (cfg.diasAFrente + 1) * 86_400_000);
  const [ocupado, dono] = await Promise.all([reservas(agora, ate), donoDoTelefone(telefone, sdrs)]);
  const ini = inicio.getTime(), fim = ini + cfg.passoMin * 60_000;

  if (dono) {
    if (livre(ocupado, dono.id, ini, fim)) return dono;
    const donoTemHorario = horariosDaJanela(cfg, agora).some((d) =>
      d.inicios.some((i) => livre(ocupado, dono.id, i.getTime(), i.getTime() + cfg.passoMin * 60_000)));
    if (donoTemHorario) return null;
  }

  const carga = (id) => ocupado.filter((o) => o.sdr_id === id).length;
  return sdrs
    .filter((s) => livre(ocupado, s.id, ini, fim))
    .sort((a, b) => carga(a.id) - carga(b.id))[0] || null;
}

/** A pessoa já tem ligação marcada daqui pra frente? */
export async function ligacaoQueJaExiste(leadId, agora = new Date()) {
  try {
    const rows = await rest(
      `qs_ligacoes_sdr?select=id,inicio,sdr:qs_users!qs_ligacoes_sdr_sdr_id_fkey(name)&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&status=eq.marcada&inicio=gte.${agora.toISOString()}&order=inicio&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    console.warn('[ligacao-sdr] não deu pra conferir ligação existente:', e?.message);
    return null;
  }
}

// ─── Marcar ──────────────────────────────────────────────────────────────────

/**
 * Reserva o horário e põe a ligação na fila do SDR.
 *
 * A ORDEM IMPORTA:
 *   1. o lead passa a ser do SDR (só muda quando não era — lead sem carteira
 *      já nasce com ele);
 *   2. a RESERVA, primeiro de tudo que ocupa agenda — é o INSERT que a trava
 *      do banco confere;
 *   3. a atividade extra na fila. Falhou? A reserva é solta na hora: horário
 *      preso sem atividade é o horário-fantasma;
 *   4. as outras atividades abertas do lead são encerradas — a MESMA regra da
 *      atividade extra criada pela tela ("ele fica só com a extra"). Sem isso
 *      o SDR ligaria pela cadência na véspera do horário que o cliente marcou.
 */
export async function marcarLigacao({ lead, sdr, inicio, expedicao = null, origemLp = null, observacao = null, email = null, telefone = null }) {
  const cfg = await lerConfigSdr();
  const fim = new Date(inicio.getTime() + cfg.passoMin * 60_000);

  // 1) Dono
  if (lead.owner_id !== sdr.id) {
    try {
      await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { owner_id: sdr.id },
      });
      await rest(`qs_tasks?lead_id=eq.${encodeURIComponent(lead.id)}&status=in.(pendente,atrasada)`, {
        method: 'PATCH', prefer: 'return=minimal', body: { owner_id: sdr.id },
      });
    } catch (e) {
      console.warn('[ligacao-sdr] não consegui passar o lead pro SDR:', e?.message);
    }
  }

  // 2) Reserva
  let ligacao;
  try {
    const r = await insert('qs_ligacoes_sdr', {
      lead_id: lead.id, sdr_id: sdr.id, inicio: inicio.toISOString(), fim: fim.toISOString(),
      expedicao, origem_lp: origemLp, observacao,
    });
    ligacao = Array.isArray(r) ? r[0] : r;
  } catch (e) {
    const msg = `${e?.message || ''} ${e?.details?.code || ''}`;
    if (e?.status === 409 || /23P01|exclusion|no_overlap/i.test(msg)) return { ok: false, motivo: 'horario_ocupado' };
    throw e;
  }

  // 3) A atividade na fila
  const quando = porExtenso(inicio);
  let tarefa;
  try {
    const r = await insert('qs_tasks', {
      lead_id: lead.id,
      cadence_id: lead.cadence_id || null,
      owner_id: sdr.id,
      channel_type: 'ligacao_whatsapp',
      priority: 'alta',
      scheduled_at: inicio.toISOString(),
      status: 'pendente',
      is_extra: true,
      notes:
        `📞 LIGAÇÃO MARCADA PELO CLIENTE — ${quando}\n` +
        // O contexto depende de onde veio: o formulário pós-live (não assistiu)
        // ou o formulário das LPs de tráfego (acabou de preencher a LP).
        (/live/i.test(origemLp || '')
          ? 'Ligação rápida (5 min) pelo WhatsApp. Não assistiu a live (ou viu só parte): qualifique antes de marcar com o especialista.'
          : 'Ligação rápida (5 min) pelo WhatsApp. Acabou de preencher o formulário da LP e pediu a ligação: qualifique antes de marcar com o especialista.') +
        (expedicao ? `\nInteresse: ${expedicao}` : '') +
        (observacao ? `\nRecado do cliente: ${observacao}` : ''),
      tags: ['ligacao-agendada', `ligacao:${ligacao.id}`, 'autoagendamento'],
    });
    tarefa = Array.isArray(r) ? r[0] : r;
  } catch (e) {
    await rest(`qs_ligacoes_sdr?id=eq.${ligacao.id}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'liberada' },
    }).catch(() => {});
    console.error('[ligacao-sdr] atividade não criada, reserva solta:', e?.message);
    return { ok: false, motivo: 'falha' };
  }

  await rest(`qs_ligacoes_sdr?id=eq.${ligacao.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { task_id: tarefa.id },
  }).catch((e) => console.warn('[ligacao-sdr] reserva sem task_id (não solta sozinha):', e?.message));

  // 4) O resto da fila deste lead sai da frente
  await rest(
    `qs_tasks?lead_id=eq.${encodeURIComponent(lead.id)}&status=in.(pendente,atrasada)&id=neq.${tarefa.id}`,
    { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ignorada', skip_reason: 'Substituída pela ligação marcada pelo cliente' } }
  ).catch((e) => console.warn('[ligacao-sdr] atividades antigas seguem abertas:', e?.message));

  // Lead parado ou perdido volta a ser trabalhado: ele pediu pra ser atendido.
  if (['nao_iniciado', 'perdido'].includes(lead.status)) {
    await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'em_prospeccao' },
    }).catch(() => {});
  }

  // O rastro no lead — best-effort, a ligação já está marcada.
  await insert('qs_notes', {
    lead_id: lead.id,
    author_id: null,
    body:
      '📞 O cliente marcou uma ligação com o SDR, pela página de agendamento\n' +
      `${quando} · SDR: ${sdr.name}\n` +
      `Contato: ${telefone || '-'}${email ? ' · ' + email : ''}` +
      (expedicao ? `\nInteresse: ${expedicao}` : '') +
      (origemLp ? `\nOrigem: ${origemLp}` : '') +
      (observacao ? `\n\nRecado do cliente: ${observacao}` : ''),
    tags: ['autoagendamento', 'ligacao-agendada'],
  }, { returning: false }).catch((e) => console.warn('[ligacao-sdr] nota não gravada:', e?.message));

  return {
    ok: true,
    ligacao_id: ligacao.id,
    quando: comoOTimeFala(inicio),
    quando_extenso: quando,
    quando_iso: inicio.toISOString(),
    sdr: sdr.name,
  };
}
