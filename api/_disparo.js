// api/_disparo.js
// -----------------------------------------------------------------------------
// MOTOR DO DISPARO EM MASSA (0217, 28/10/2026) — Comercial e Relacionamento.
//
// Quem chama: api/disparos.js (tela + cron). Aqui mora a regra; lá, a rota.
//
//   montarPublico()   → quem a campanha atinge, com as EXCLUSÕES e o motivo
//   rodada()          → o cron: manda o próximo lote respeitando janela e teto
//   conciliar()       → lê recibos (entregue/lido/erro) e respostas
//   entrarNaCadencia()→ o disparo é o PASSO 1: o lead entra na cadência com o
//                       1º WhatsApp já feito e segue os próximos passos
//   enviarTemplate()  → o ÚNICO ponto que fala com a Meta. Hoje SÓ REGISTRA.
//
// Regras da casa (ver docs/DISPARO-EM-MASSA.md):
//   • massa SÓ pela Cloud API oficial (número do SDR por Coexistência, ou o do
//     Rel) e SÓ com modelo aprovado. Nunca Evolution/QR — bloqueio de 24 h.
//   • teto por número por hora e por dia; só na janela comercial (Brasília).
//   • modo simulação ligado por padrão (qs_settings.disparo_simulacao): grava a
//     fila e o funil, mas não manda, não cria tarefa, não mexe em lead.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { waKey, onlyDigits } from './_wa.js';
import { numerosIgnorados } from './_waNascimento.js';
import { proibidos } from './_numeroReserva.js';
import { numeroDoRelacionamento, numeroConectado } from './_relWa.js';

// O envio real ainda NÃO está plugado (ver enviarTemplate). Enquanto for
// false, desligar a simulação não manda nada: a rodada só avisa e espera.
export const ENVIO_REAL_PLUGADO = false;

const RITMO_PADRAO = { por_hora: 30, por_dia: 150, inicio: '09:30', fim: '18:30', dias: [1, 2, 3, 4, 5], intervalo_dias: 7 };
const TRAVA_MS = 5 * 60_000; // pendente "pego" há mais que isto = morreu no meio
const BRT = 3 * 3600_000;    // Brasil sem horário de verão desde 2019

const lerSetting = async (key) =>
  (await rest(`qs_settings?select=value&key=eq.${key}&limit=1`).catch(() => null))?.[0]?.value;

/** Interruptor + ritmo + modelos. Leitura falhou = simulação (o lado seguro). */
export async function lerConfig() {
  const [sim, ritmo, modelos] = await Promise.all([
    lerSetting('disparo_simulacao'), lerSetting('disparo_ritmo'), lerSetting('disparo_modelos'),
  ]);
  return {
    simulacao: sim !== false && sim !== 'false',
    ritmo: { ...RITMO_PADRAO, ...(ritmo && typeof ritmo === 'object' ? ritmo : {}) },
    modelos: Array.isArray(modelos) ? modelos : [],
  };
}

// ── Telefone ────────────────────────────────────────────────────────────────

/** Telefone no formato da Meta (só dígitos, com DDI). null = inválido. */
export function foneDestino(raw) {
  let d = onlyDigits(raw);
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith('55')) return /^55\d{10,11}$/.test(d) ? d : null;
  return d.length >= 10 && d.length <= 15 ? d : null; // cliente de fora do Brasil
}

// ── Números que enviam ──────────────────────────────────────────────────────

/** SDR → número dele conectado na Meta (Coexistência, com token guardado). */
export async function numerosDosSdrs() {
  const r = await rest(
    'qs_wa_numeros_meta?select=phone_number_id,user_id,numero,status,segredo_id' +
    '&setor=eq.comercial&status=eq.conectado&user_id=not.is.null&segredo_id=not.is.null'
  ).catch(() => []);
  return new Map((r || []).map((n) => [n.user_id, n]));
}

// ── Público ─────────────────────────────────────────────────────────────────

export const MOTIVOS = {
  invalido: 'telefone inválido',
  proibido: 'número proibido (1935 / NUMEROS_PROIBIDOS)',
  time: 'número do próprio time',
  optout: 'pediu para não receber',
  ganho: 'já é cliente (ganho) — remarketing é pelo Relacionamento',
  conversa: 'conversa aberta nas últimas 24 h — o SDR fala direto',
  recente: 'recebeu disparo há pouco tempo',
  sem_numero: 'SDR dono sem número conectado na Meta',
  sem_dono: 'lead sem SDR dono',
  repetido: 'telefone repetido na lista',
  // Marketing (0242): o número do Marketing tem a lista de PARAR dele.
  mkt_optout: 'pediu PARAR ao número do Marketing',
  mkt_recente: 'recebeu disparo do Marketing há pouco tempo',
};

/**
 * Quem a campanha atinge. Devolve { recebem, excluidos: {motivo: n}, porSdr }.
 * `recebem` já vem com o número que envia (phone_number_id) de cada um.
 */
export async function montarPublico({ setor, publico, ritmo }) {
  const p = { ...(publico || {}), intervalo_dias: ritmo?.intervalo_dias ?? RITMO_PADRAO.intervalo_dias };
  const bloq = proibidos();
  const time = await numerosIgnorados().catch(() => new Set());
  const excluidos = {};
  const recebem = [];
  const vistos = new Set();
  const fora = (m) => { excluidos[m] = (excluidos[m] || 0) + 1; };

  // Marketing (0242): base de contatos, leads ou clientes — sempre pelo número
  // do Marketing. Import dinâmico: o _mktDisparo importa daqui.
  if (setor === 'marketing') {
    const { montarPublicoMkt } = await import('./_mktDisparo.js');
    return montarPublicoMkt({ publico, ritmo });
  }

  if (setor === 'relacionamento') {
    const numero = await numeroDoRelacionamento();
    const linhas = await rest('rpc/qs_disparo_publico_rel', { method: 'POST', body: { p_publico: p }, timeoutMs: 25_000 });
    for (const a of linhas || []) {
      const tel = foneDestino(a.telefone);
      if (!tel) { fora('invalido'); continue; }
      if (bloq.has(tel)) { fora('proibido'); continue; }
      if (time.has(waKey(tel))) { fora('time'); continue; }
      if (a.optout) { fora('optout'); continue; }
      if (a.conversa_24h) { fora('conversa'); continue; }
      if (a.disparo_recente) { fora('recente'); continue; }
      if (vistos.has(tel)) { fora('repetido'); continue; }
      vistos.add(tel);
      recebem.push({
        cliente_id: a.cliente_id, viagem_id: a.viagem_id, destino: a.destino, nivel: a.nivel,
        nome: a.nome, telefone: tel, sdr_id: null, phone_number_id: numero?.phone_number_id || null,
      });
    }
    return { recebem, excluidos, porSdr: [], numeroOk: numeroConectado(numero) };
  }

  const nums = await numerosDosSdrs();
  const linhas = await rest('rpc/qs_disparo_publico', { method: 'POST', body: { p_publico: p }, timeoutMs: 25_000 });
  const porSdr = new Map();
  for (const a of linhas || []) {
    const tel = foneDestino(a.telefone);
    if (!tel) { fora('invalido'); continue; }
    if (bloq.has(tel)) { fora('proibido'); continue; }
    if (time.has(waKey(tel))) { fora('time'); continue; }
    if (a.optout) { fora('optout'); continue; }
    if (a.status === 'ganho') { fora('ganho'); continue; }
    if (a.conversa_24h) { fora('conversa'); continue; }
    if (a.disparo_recente) { fora('recente'); continue; }
    if (!a.owner_id) { fora('sem_dono'); continue; }
    const n = nums.get(a.owner_id);
    if (!n) { fora('sem_numero'); continue; }
    if (vistos.has(tel)) { fora('repetido'); continue; }
    vistos.add(tel);
    porSdr.set(a.owner_id, (porSdr.get(a.owner_id) || 0) + 1);
    recebem.push({
      lead_id: a.lead_id, nome: a.nome, telefone: tel, segment: a.segment,
      sdr_id: a.owner_id, phone_number_id: n.phone_number_id, ja_respondeu: a.ja_respondeu,
    });
  }
  return { recebem, excluidos, porSdr: [...porSdr].map(([sdr_id, n]) => ({ sdr_id, n })), numeroOk: true };
}

// ── Variáveis ───────────────────────────────────────────────────────────────

/** "[Japão] - Tráfego" → "Japão". */
const destinoDoSegmento = (s) => (String(s || '').match(/^\s*\[([^\]]+)\]/)?.[1] || '').trim();
const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || '';

/** `params` da campanha → valores pra este destinatário. */
export function valoresDasVariaveis(params, alvo, ctx) {
  const out = {};
  for (const [k, cfg] of Object.entries(params || {})) {
    const f = cfg?.fonte || 'texto';
    let v = '';
    if (f === 'nome') v = primeiroNome(alvo.nome);
    else if (f === 'sdr') v = primeiroNome(ctx.nomesSdr?.get(alvo.sdr_id));
    else if (f === 'destino') v = alvo.destino || destinoDoSegmento(alvo.segment) || String(cfg?.valor || '');
    else if (f === 'link_grupo') v = String(ctx.grupoLink || '');
    // Marketing (0242): campo livre do contato (coluna extra do CSV).
    else if (f === 'campo') v = String(alvo.campos?.[String(cfg?.valor || '')] ?? '');
    else v = String(cfg?.valor || '');
    out[k] = v;
  }
  return out;
}

/** Corpo com {{n}} preenchido. Variável vazia = não manda (a Meta recusa). */
export function preencher(corpo, valores) {
  let faltando = null;
  const texto = String(corpo || '').replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => {
    const v = String(valores[k] ?? '').trim();
    if (!v) faltando = k;
    return v;
  });
  return faltando ? { erro: `variável {{${faltando}}} ficou vazia` } : { texto };
}

// ── A fila ──────────────────────────────────────────────────────────────────

/**
 * Põe `recebem` na fila da campanha e a passa a 'enviando'. Serve ao botão
 * "Iniciar" (de: 'rascunho'), à campanha agendada (de: 'agendada') e aos passos
 * das sequências do Marketing (de: o estado em que estiver — o passo do dia
 * pode receber gente nova mais tarde e a campanha volta a andar).
 * O mesmo telefone não entra duas vezes na mesma campanha (unique).
 */
export async function montarFila({ campanha, recebem, de = 'rascunho' }) {
  const mkt = campanha.setor === 'marketing';
  const linhas = recebem.map((a) => ({
    campanha_id: campanha.id, lead_id: a.lead_id || null, cliente_id: a.cliente_id || null, viagem_id: a.viagem_id || null,
    sdr_id: a.sdr_id || null, phone_number_id: a.phone_number_id, nome: a.nome, telefone: a.telefone,
    // Colunas da 0242 só nas campanhas do Marketing: Comercial/Rel continuam
    // funcionando mesmo antes de a 0242 ser aplicada.
    ...(mkt ? { contato_id: a.contato_id || null, inscricao_id: a.inscricao_id || null } : {}),
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    await rest('qs_disparo_envios?on_conflict=campanha_id,telefone', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas.slice(i, i + 500), timeoutMs: 20_000,
    });
  }
  // Total = o que está na fila (no passo de sequência a campanha recebe gente
  // em mais de uma rodada). No "Iniciar" é igual a linhas.length.
  let total = linhas.length;
  if (mkt) {
    const contados = await rest(`qs_disparo_envios?select=id&campanha_id=eq.${campanha.id}&limit=20000`, { timeoutMs: 20_000 }).catch(() => null);
    if (Array.isArray(contados)) total = contados.length;
  }
  // Pausada continua pausada (o passo da sequência só acrescenta gente).
  const body = { status: campanha.status === 'pausada' ? 'pausada' : 'enviando', total, ultimo_erro: null };
  if (!campanha.iniciada_em) body.iniciada_em = new Date().toISOString();
  if (campanha.status === 'concluida') body.concluida_em = null;
  await rest(`qs_disparo_campanhas?id=eq.${campanha.id}&status=eq.${encodeURIComponent(de)}`, { method: 'PATCH', prefer: 'return=minimal', body });
  return { total: linhas.length };
}

// ── O envio ─────────────────────────────────────────────────────────────────

/**
 * O ÚNICO ponto do disparo que fala com a Meta.
 *
 * HOJE: só registra. Em simulação devolve um wamid de mentira ("sim:…").
 * Fora da simulação, enquanto ENVIO_REAL_PLUGADO = false, recusa.
 *
 * TODO(envio real) — quando o Bruno aprovar os modelos na Meta e mandar ligar:
 *   1. import { enviarTemplate as enviarTemplateMeta, modelosAprovados } from './_meta.js';
 *   2. conferir que o modelo está APPROVED NO NÚMERO que envia (cada SDR tem a
 *      conta dele na Coexistência): `modelosAprovados(phoneNumberId)` — se não
 *      estiver, devolver { erro: 'modelo não aprovado neste número' };
 *   3. const r = await enviarTemplateMeta({ para, nome: modelo, idioma, params, phoneId: phoneNumberId });
 *      return r.wamid ? { wamid: r.wamid } : { erro: r.detalhe || r.erro, codigo: r.codigo };
 *   4. trocar ENVIO_REAL_PLUGADO para true.
 *   A bolha no chat (registrarSaida / gravarRel) e a cadência já estão prontas
 *   em enviarUm() abaixo — só rodam quando o envio NÃO é simulado.
 */
export async function enviarTemplate({ phoneNumberId, para, modelo, idioma, params, simulacao }) {
  if (simulacao) {
    console.log('[disparo] SIMULAÇÃO', JSON.stringify({ phoneNumberId, para: `…${String(para).slice(-4)}`, modelo, idioma, params }).slice(0, 400));
    return { wamid: `sim:${randomUUID()}`, simulado: true };
  }
  if (!ENVIO_REAL_PLUGADO) return { erro: 'envio real ainda não está ligado (ver TODO em api/_disparo.js)' };
  return { erro: 'envio real não implementado' };
}

// ── Cadência: o disparo é o passo 1 ─────────────────────────────────────────
// Espelho (em horário de Brasília) de src/lib/workHours.ts + createCadenceTasks:
// mesma régua de datas, prioridade pelo horário e tag dia:N. Aqui o servidor
// roda em UTC, então as contas são feitas no "relógio de parede" de Brasília.

const HORARIO_PADRAO = {
  0: { enabled: false, start: '09:00', end: '18:00' },
  1: { enabled: true, start: '09:30', end: '19:30' },
  2: { enabled: true, start: '09:30', end: '19:30' },
  3: { enabled: true, start: '09:30', end: '19:30' },
  4: { enabled: true, start: '09:30', end: '19:30' },
  5: { enabled: true, start: '10:00', end: '19:00' },
  6: { enabled: false, start: '09:00', end: '13:00' },
};
const parede = (d) => new Date(d.getTime() - BRT); // campos UTC = hora de Brasília
const real = (w) => new Date(w.getTime() + BRT);
const hm = (s) => String(s || '0:0').split(':').map((x) => Number(x) || 0);
const comHora = (w, h, m) => { const x = new Date(w); x.setUTCHours(h, m, 0, 0); return x; };

function diasDaAgenda(wh, cadDias) {
  const on = [0, 1, 2, 3, 4, 5, 6].filter((d) => wh[d]?.enabled);
  if (!on.length) return [1, 2, 3, 4, 5];
  if (cadDias?.length) { const i = cadDias.filter((d) => on.includes(d)); return i.length ? i : on; }
  return on;
}
function proximoDiaPermitido(w, dias) {
  const d = new Date(w);
  for (let i = 0; i < 14 && !dias.includes(d.getUTCDay()); i++) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function proximoMomento(wh, w) {
  const d = new Date(w);
  for (let i = 0; i < 15; i++) {
    const dia = wh[d.getUTCDay()];
    if (dia?.enabled) {
      const ini = comHora(d, ...hm(dia.start)); const fim = comHora(d, ...hm(dia.end));
      if (d < ini) return ini;
      if (d <= fim) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}
function encaixar(wh, w) {
  const dia = wh[w.getUTCDay()];
  if (!dia?.enabled) return new Date(w);
  const ini = comHora(w, ...hm(dia.start)); const fim = comHora(w, ...hm(dia.end));
  return w < ini ? ini : w > fim ? fim : new Date(w);
}
function datasDoPlano(numeros, dias, politica, base) {
  const out = new Map();
  let antes = null;
  for (const n of [...new Set(numeros)].sort((a, b) => a - b)) {
    let d = new Date(base); d.setUTCDate(d.getUTCDate() + Math.max(0, n - 1));
    if (!(antes === null && politica === 'iniciar_imediato')) d = proximoDiaPermitido(d, dias);
    if (antes !== null) {
      const meia = new Date(d); meia.setUTCHours(0, 0, 0, 0);
      if (meia.getTime() <= antes) {
        const b = new Date(antes + 86_400_000);
        b.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), 0, 0);
        d = proximoDiaPermitido(b, dias);
      }
    }
    const meia = new Date(d); meia.setUTCHours(0, 0, 0, 0);
    antes = meia.getTime();
    out.set(n, d);
  }
  return out;
}

const cachePlano = new Map();
async function planoDaCadencia(cadenceId) {
  if (cachePlano.has(cadenceId)) return cachePlano.get(cadenceId);
  const [dias, cad, wh] = await Promise.all([
    rest(`qs_cadence_days?select=day_number,qs_cadence_activities(channel_type,scheduled_time,order_index)&cadence_id=eq.${cadenceId}&order=day_number`),
    rest(`qs_cadences?select=name,execution_weekdays,offday_policy&id=eq.${cadenceId}&limit=1`),
    lerSetting('work_hours'),
  ]);
  const v = {
    nome: cad?.[0]?.name || 'cadência',
    dias: dias || [],
    semana: cad?.[0]?.execution_weekdays || null,
    politica: cad?.[0]?.offday_policy || null,
    horario: { ...HORARIO_PADRAO, ...(wh && typeof wh === 'object' ? wh : {}) },
  };
  cachePlano.set(cadenceId, v);
  return v;
}

/**
 * Põe o lead na cadência da campanha, com o 1º WhatsApp do plano já FEITO
 * (é o modelo que acabou de sair). Encerra as pendentes da cadência antiga
 * (avulsas ficam) e reabre lead perdido/não iniciado. NÃO mexe no Bitrix.
 */
export async function entrarNaCadencia({ leadId, ownerId, cadenceId, campanhaNome, modeloNome }) {
  const plano = await planoDaCadencia(cadenceId);
  const agora = new Date();
  const w0 = parede(agora);
  const semana = diasDaAgenda(plano.horario, plano.semana);
  const datas = datasDoPlano(plano.dias.map((d) => d.day_number ?? 1), semana, plano.politica, w0);
  const primeiroDia = plano.dias.length ? Math.min(...plano.dias.map((d) => d.day_number ?? 1)) : 1;

  await rest(`qs_tasks?lead_id=eq.${leadId}&status=eq.pendente&is_extra=eq.false`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { status: 'ignorada', skip_reason: `Entrou na cadência "${plano.nome}" pelo disparo` },
  });
  const lead = (await rest(`qs_leads?select=status&id=eq.${leadId}&limit=1`))?.[0];
  const reabrir = lead && ['perdido', 'nao_iniciado'].includes(lead.status);
  await rest(`qs_leads?id=eq.${leadId}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      cadence_id: cadenceId, cadence_started_at: agora.toISOString(),
      ...(reabrir ? { status: 'em_prospeccao', loss_reason_id: null, closed_at: null } : {}),
    },
  });

  let feito = false;
  const tarefas = plano.dias.flatMap((d) =>
    [...(d.qs_cadence_activities || [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((a) => {
      const dia = d.day_number ?? 1;
      const base = new Date(datas.get(dia) ?? w0);
      const [h, m] = hm(a.scheduled_time || '09:00');
      const planejado = comHora(base, h || 9, m);
      const quando = dia === primeiroDia ? proximoMomento(plano.horario, new Date(Math.max(planejado.getTime(), w0.getTime()))) : encaixar(plano.horario, planejado);
      // O 1º WhatsApp do 1º dia é o próprio disparo (inclui o passo
      // "WhatsApp modelo", se a cadência tiver).
      const ehODisparo = !feito && dia === primeiroDia && String(a.channel_type || '').startsWith('whatsapp');
      if (ehODisparo) feito = true;
      return {
        lead_id: leadId, cadence_id: cadenceId, owner_id: ownerId, channel_type: a.channel_type,
        priority: !a.scheduled_time ? 'baixa' : a.scheduled_time >= '12:30' ? 'media' : 'alta',
        scheduled_at: (ehODisparo ? agora : real(quando)).toISOString(),
        status: ehODisparo ? 'concluida' : 'pendente',
        ...(ehODisparo ? { completed_at: agora.toISOString(), notes: `Modelo "${modeloNome}" enviado pelo disparo "${campanhaNome}".` } : {}),
        is_extra: false, tags: [`dia:${dia}`],
      };
    })
  );
  if (tarefas.length) await rest('qs_tasks', { method: 'POST', prefer: 'return=minimal', body: tarefas });
  return { tarefas: tarefas.length };
}

// ── Janela e teto ───────────────────────────────────────────────────────────

/** Agora está na janela de envio (Brasília)? */
export function naJanela(ritmo, agora = new Date()) {
  const w = parede(agora);
  if (!(ritmo.dias || []).includes(w.getUTCDay())) return false;
  const min = w.getUTCHours() * 60 + w.getUTCMinutes();
  const [hi, mi] = hm(ritmo.inicio); const [hf, mf] = hm(ritmo.fim);
  return min >= hi * 60 + mi && min < hf * 60 + mf;
}

/** Quantos este número ainda pode mandar AGORA (teto da hora e do dia). */
async function folgaDoNumero(phoneId, ritmo, agora) {
  const umaHora = new Date(agora.getTime() - 3600_000).toISOString();
  const w = parede(agora); w.setUTCHours(0, 0, 0, 0);
  const meiaNoite = real(w).toISOString();
  const contar = async (desde) => {
    const r = await rest(
      `qs_disparo_envios?select=id&phone_number_id=eq.${encodeURIComponent(phoneId)}` +
      `&enviado_em=gte.${encodeURIComponent(desde)}&limit=1000`
    ).catch(() => null);
    return Array.isArray(r) ? r.length : Infinity; // não deu pra contar = não manda
  };
  const [hora, dia] = await Promise.all([contar(umaHora), contar(meiaNoite)]);
  // Espalha a hora em 12 rodadas (cron de 5 em 5 min): sem rajada no número.
  const porRodada = Math.max(1, Math.ceil(Number(ritmo.por_hora) / 12));
  return Math.max(0, Math.min(Number(ritmo.por_hora) - hora, Number(ritmo.por_dia) - dia, porRodada));
}

// ── Um envio ────────────────────────────────────────────────────────────────

async function patchEnvio(id, body) {
  await rest(`qs_disparo_envios?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body }).catch(() => null);
}

/** Confere de novo na hora (opt-out e conversa podem ter mudado) e manda UM. */
async function enviarUm({ envio, campanha, corpo, cfg, ctx }) {
  try {
    if (envio.lead_id) {
      const l = (await rest(`qs_leads?select=optout_whatsapp_em,status&id=eq.${envio.lead_id}&limit=1`))?.[0];
      if (!l) return patchEnvio(envio.id, { status: 'pulado', motivo: 'lead apagado' });
      if (l.optout_whatsapp_em) return patchEnvio(envio.id, { status: 'pulado', motivo: MOTIVOS.optout });
      if (l.status === 'ganho') return patchEnvio(envio.id, { status: 'pulado', motivo: MOTIVOS.ganho });
      const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
      const c = await rest(`qs_wa_messages?select=id&lead_id=eq.${envio.lead_id}&direction=eq.in&sent_at=gte.${encodeURIComponent(desde)}&limit=1`);
      if (c?.length) return patchEnvio(envio.id, { status: 'pulado', motivo: MOTIVOS.conversa });
    }
    if (envio.cliente_id) {
      const o = await rest('rpc/rel_cliente_optout', { method: 'POST', body: { p_cliente: envio.cliente_id } });
      if (o === true) return patchEnvio(envio.id, { status: 'pulado', motivo: MOTIVOS.optout });
    }
    // Marketing (0242): quem disse PARAR ao número do Marketing (com ou sem o 9º dígito).
    if (campanha.setor === 'marketing') {
      const tels = variantes(envio.telefone).join(',');
      const o = await rest(`mkt_contatos?select=id&telefone=in.(${tels})&optout_whatsapp_em=not.is.null&limit=1`);
      if (o?.length) return patchEnvio(envio.id, { status: 'pulado', motivo: MOTIVOS.mkt_optout });
    }

    const alvo = { nome: envio.nome, sdr_id: envio.sdr_id, segment: ctx.segmentos.get(envio.lead_id), destino: ctx.destinos.get(envio.viagem_id), campos: ctx.campos?.get(envio.contato_id) };
    const params = valoresDasVariaveis(campanha.params, alvo, ctx);
    const m = preencher(corpo, params);
    if (m.erro) return patchEnvio(envio.id, { status: 'pulado', motivo: m.erro });

    const r = await enviarTemplate({
      phoneNumberId: envio.phone_number_id, para: envio.telefone,
      modelo: campanha.modelo_nome, idioma: campanha.modelo_idioma, params, simulacao: cfg.simulacao,
    });
    if (!r.wamid) {
      return patchEnvio(envio.id, { status: 'erro', motivo: String(r.erro || 'a Meta recusou').slice(0, 300), tentativas: (envio.tentativas || 0) + 1 });
    }
    const agora = new Date().toISOString();
    await patchEnvio(envio.id, {
      status: 'enviado', wamid: r.wamid, simulado: Boolean(r.simulado), enviado_em: agora, tentativas: (envio.tentativas || 0) + 1,
      motivo: r.simulado ? (campanha.cadence_id ? 'simulação — entraria na cadência' : 'simulação') : null,
    });
    if (r.simulado) return;

    // Envio REAL daqui pra baixo (só depois do TODO de enviarTemplate).
    // Marketing (0242): o número é do Marketing — NÃO vira bolha no chat do
    // SDR nem do Rel, não entra em cadência. Fica na linha do tempo do contato.
    if (campanha.setor === 'marketing') {
      if (envio.contato_id) {
        await rest('mkt_contato_eventos', {
          method: 'POST', prefer: 'return=minimal',
          body: { contato_id: envio.contato_id, tipo: 'disparo_enviado', dados: { campanha_id: campanha.id, campanha: campanha.nome, modelo: campanha.modelo_nome, wamid: r.wamid, texto: m.texto.slice(0, 500) } },
        }).catch(() => null);
      }
      return;
    }
    // Bolha no chat: registrarSaida (Comercial) / gravarRel (Rel) — import
    // dinâmico pra simulação não carregar o que não usa.
    if (envio.lead_id) {
      const { registrarSaida } = await import('./_waSaida.js');
      await registrarSaida({ leadId: envio.lead_id, wamid: r.wamid, texto: m.texto, remetente: `Disparo: ${campanha.nome}`, phoneId: envio.phone_number_id });
      if (campanha.cadence_id) {
        await entrarNaCadencia({ leadId: envio.lead_id, ownerId: envio.sdr_id, cadenceId: campanha.cadence_id, campanhaNome: campanha.nome, modeloNome: campanha.modelo_nome });
        await patchEnvio(envio.id, { cadencia_em: new Date().toISOString() });
      }
    } else {
      const { gravarRel } = await import('./_relEntrada.js');
      await gravarRel({ phoneId: envio.phone_number_id, telefone: envio.telefone, wamid: r.wamid, direcao: 'out', origem: 'automatica', texto: m.texto, autorNome: `Disparo: ${campanha.nome}`, status: 'sent' });
    }
  } catch (e) {
    await patchEnvio(envio.id, { status: 'erro', motivo: String(e?.message || 'erro').slice(0, 300), tentativas: (envio.tentativas || 0) + 1 });
  }
}

// ── A rodada do cron ────────────────────────────────────────────────────────

/** Contexto das variáveis de uma campanha (nomes dos SDRs, destinos, segmento). */
async function contexto(campanha, envios) {
  const nomesSdr = new Map(((await rest('qs_users?select=id,name').catch(() => [])) || []).map((u) => [u.id, u.name]));
  const segmentos = new Map();
  const destinos = new Map();
  const leads = [...new Set(envios.map((e) => e.lead_id).filter(Boolean))];
  if (leads.length) {
    const r = await rest(`qs_leads?select=id,segment&id=in.(${leads.join(',')})`).catch(() => []);
    for (const l of r || []) segmentos.set(l.id, l.segment);
  }
  const vgs = [...new Set(envios.map((e) => e.viagem_id).filter(Boolean))];
  if (vgs.length) {
    const r = await rest(`rel_viagens?select=id,destino,titulo&id=in.(${vgs.join(',')})`).catch(() => []);
    for (const v of r || []) destinos.set(v.id, v.destino || v.titulo);
  }
  // Marketing (0242): campos livres do contato (variável "campo").
  const campos = new Map();
  const cts = [...new Set(envios.map((e) => e.contato_id).filter(Boolean))];
  if (cts.length) {
    const r = await rest(`mkt_contatos?select=id,campos&id=in.(${cts.join(',')})`).catch(() => []);
    for (const x of r || []) campos.set(x.id, x.campos || {});
  }
  return { nomesSdr, segmentos, destinos, campos, grupoLink: campanha.grupo_link };
}

/**
 * Manda o próximo lote de TODAS as campanhas "enviando": por número, até a
 * folga do teto; só na janela. Devolve um resumo pro log.
 */
export async function rodada({ limiteMs = 45_000 } = {}) {
  const inicio = Date.now();
  cachePlano.clear(); // a cadência pode ter sido editada desde a última rodada
  const cfg = await lerConfig();
  if (!cfg.simulacao && !ENVIO_REAL_PLUGADO) return { parado: 'simulação desligada, mas o envio real ainda não está plugado — nada enviado' };
  const agora = new Date();
  if (!naJanela(cfg.ritmo, agora)) return { parado: 'fora da janela de envio' };

  const campanhas = await rest('qs_disparo_campanhas?select=*&status=eq.enviando&order=iniciada_em.asc').catch(() => []);
  const resumo = [];
  const folga = new Map(); // número → quanto ainda pode nesta rodada (vale entre campanhas)
  const velho = new Date(Date.now() - TRAVA_MS).toISOString();

  for (const c of campanhas || []) {
    const modelo = cfg.modelos.find((m) => m.nome === c.modelo_nome && (m.idioma || 'pt_BR') === c.modelo_idioma);
    const corpo = modelo?.corpo || c.modelo_corpo;
    if (!corpo) {
      await rest(`qs_disparo_campanhas?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: agora.toISOString(), ultimo_erro: 'Modelo não encontrado na configuração.' } });
      continue;
    }
    // Quais números têm pendente nesta campanha.
    const nums = await rest(`qs_disparo_envios?select=phone_number_id&campanha_id=eq.${c.id}&status=eq.pendente&limit=2000`).catch(() => []);
    const porNumero = [...new Set((nums || []).map((n) => n.phone_number_id).filter(Boolean))];
    let feitos = 0;
    for (const ph of porNumero) {
      if (Date.now() - inicio > limiteMs) break;
      if (!folga.has(ph)) folga.set(ph, await folgaDoNumero(ph, cfg.ritmo, agora));
      const pode = folga.get(ph);
      if (pode <= 0) continue;
      const cands = await rest(
        `qs_disparo_envios?select=id&campanha_id=eq.${c.id}&phone_number_id=eq.${encodeURIComponent(ph)}&status=eq.pendente` +
        `&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})&order=criado_em.asc&limit=${pode}`
      ).catch(() => []);
      const pegos = [];
      for (const cand of cands || []) {
        // Pega a vez ANTES de mandar: duas rodadas ao mesmo tempo não mandam
        // a mesma mensagem duas vezes.
        const r = await rest(
          `qs_disparo_envios?id=eq.${cand.id}&status=eq.pendente&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})`,
          { method: 'PATCH', prefer: 'return=representation', body: { pego_em: new Date().toISOString() } }
        ).catch(() => null);
        if (r?.[0]) pegos.push(r[0]);
      }
      if (!pegos.length) continue;
      const ctx = await contexto(c, pegos);
      for (const envio of pegos) {
        if (Date.now() - inicio > limiteMs) break;
        await enviarUm({ envio, campanha: c, corpo, cfg, ctx });
        feitos++;
        folga.set(ph, folga.get(ph) - 1);
      }
    }
    // Acabou a fila? Conclui.
    const resta = await rest(`qs_disparo_envios?select=id&campanha_id=eq.${c.id}&status=eq.pendente&limit=1`).catch(() => [1]);
    if (Array.isArray(resta) && resta.length === 0) {
      await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.enviando`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'concluida', concluida_em: new Date().toISOString() } });
    }
    resumo.push({ campanha: c.nome, feitos });
  }
  return { ok: true, simulacao: cfg.simulacao, campanhas: resumo };
}

// ── Recibos e respostas ─────────────────────────────────────────────────────

const ORDEM = { enviado: 1, entregue: 2, lido: 3, respondeu: 4 };

/** O mesmo celular com e sem o 9º dígito (a Meta às vezes manda sem). */
function variantes(tel) {
  const d = onlyDigits(tel);
  const v = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) v.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}\d{8}$/.test(d)) v.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...v];
}

/**
 * Atualiza o funil dos envios REAIS dos últimos 7 dias: recibo da Meta
 * (qs_wa_messages / rel_wa_mensagens, achados pelo wamid) e resposta do
 * cliente (mensagem que entrou depois do disparo). Quem responde no Comercial
 * ganha uma atividade de WhatsApp pra HOJE com o SDR dono — é a porta de
 * entrada no fluxo normal.
 */
export async function conciliar() {
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  let abertos = await rest(
    `qs_disparo_envios?select=id,campanha_id,lead_id,cliente_id,sdr_id,telefone,wamid,status,enviado_em` +
    `&simulado=eq.false&wamid=not.is.null&status=in.(enviado,entregue,lido)&enviado_em=gte.${encodeURIComponent(desde)}&limit=500`
  ).catch(() => []);
  // Marketing (0242): o funil das campanhas do Marketing vem direto do webhook
  // do número dele (api/_mktEntrada.js) — o recibo não passa pelo chat do QS.
  if (abertos?.length) {
    const mkt = new Set(((await rest('qs_disparo_campanhas?select=id&setor=eq.marketing').catch(() => [])) || []).map((c) => c.id));
    if (mkt.size) abertos = abertos.filter((e) => !mkt.has(e.campanha_id));
  }
  if (!abertos?.length) return { conferidos: 0 };
  let mudou = 0;
  const nomes = new Map();

  for (let i = 0; i < abertos.length; i += 80) {
    const bloco = abertos.slice(i, i + 80);
    const ids = bloco.map((e) => `"${e.wamid}"`).join(',');
    const [com, rel] = await Promise.all([
      rest(`qs_wa_messages?select=source_id,status&source_id=in.(${ids})`).catch(() => []),
      rest(`rel_wa_mensagens?select=wamid,status&wamid=in.(${ids})`).catch(() => []),
    ]);
    const recibo = new Map([...(com || []).map((m) => [m.source_id, m.status]), ...(rel || []).map((m) => [m.wamid, m.status])]);

    for (const e of bloco) {
      let novo = e.status;
      const patch = {};
      const st = recibo.get(e.wamid);
      if (st === 'failed') { novo = 'erro'; patch.motivo = 'a Meta não entregou (falhou)'; }
      else if (st === 'read' && ORDEM[novo] < 3) { novo = 'lido'; patch.lido_em = new Date().toISOString(); }
      else if (st === 'delivered' && ORDEM[novo] < 2) { novo = 'entregue'; patch.entregue_em = new Date().toISOString(); }

      // Respondeu? (mensagem recebida depois do disparo)
      let respondeu = false;
      if (e.lead_id) {
        const r = await rest(`qs_wa_messages?select=id&lead_id=eq.${e.lead_id}&direction=eq.in&sent_at=gt.${encodeURIComponent(e.enviado_em)}&limit=1`).catch(() => []);
        respondeu = Boolean(r?.length);
      } else if (e.cliente_id) {
        const r = await rest(`rel_wa_conversas?select=id&telefone=in.(${variantes(e.telefone).join(',')})&ultima_entrada_em=gt.${encodeURIComponent(e.enviado_em)}&limit=1`).catch(() => []);
        respondeu = Boolean(r?.length);
      }
      if (respondeu && novo !== 'erro') { novo = 'respondeu'; patch.respondeu_em = new Date().toISOString(); }
      if (novo === e.status) continue;
      await patchEnvio(e.id, { status: novo, ...patch });
      mudou++;

      if (novo === 'respondeu' && e.lead_id && e.sdr_id) {
        if (!nomes.has(e.campanha_id)) nomes.set(e.campanha_id, (await rest(`qs_disparo_campanhas?select=nome,cadence_id&id=eq.${e.campanha_id}&limit=1`).catch(() => null))?.[0]);
        const camp = nomes.get(e.campanha_id);
        await rest('qs_tasks', {
          method: 'POST', prefer: 'return=minimal',
          body: {
            lead_id: e.lead_id, cadence_id: camp?.cadence_id || null, owner_id: e.sdr_id, channel_type: 'whatsapp',
            priority: 'alta', scheduled_at: new Date().toISOString(), status: 'pendente', is_extra: true,
            notes: `Respondeu ao disparo "${camp?.nome || ''}". Responda pelo WhatsApp.`, tags: ['disparo:respondeu'],
          },
        }).catch(() => null);
      }
    }
  }
  return { conferidos: abertos.length, mudou };
}
