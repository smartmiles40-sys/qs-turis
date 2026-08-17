// src/lib/qs/closerAgenda.ts
// -----------------------------------------------------------------------------
// A AGENDA DOS CLOSERS — leitura do banco (migration 0027) e, principalmente, o
// cálculo dos HORÁRIOS LIVRES.
//
// A regra é uma subtração:
//
//     janela de atendimento do closer
//   − reuniões já agendadas (+ intervalo entre elas)
//   − bloqueios (férias, compromisso)
//   − antecedência mínima ("não me agende pra daqui 10 minutos")
//   − teto de reuniões no dia
//   = slots que o SDR pode clicar
//
// `computeDaySlots` é PURA (recebe os dados, devolve os slots) de propósito: é a
// regra que decide o que o SDR enxerga, então precisa ser previsível e testável
// sem banco. Quem busca os dados é a parte de cima do arquivo.
//
// Fuso: tudo em horário LOCAL do navegador (America/Sao_Paulo na operação), igual
// ao resto do QS. `time` do Postgres ("HH:MM:SS") é aplicado sobre o DIA local.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting, SdrUser } from "@/components/sdr/types";

// ── Cores dos closers no calendário ──────────────────────────────────────────
// Paleta fixa e determinística (pelo índice do closer na lista ordenada), pra
// cor não dançar entre um refresh e outro. `color` na qs_closer_config vence.
export const CLOSER_COLORS = [
  "#0147FF", // azul QS
  "#059669", // verde
  "#D97706", // âmbar
  "#7C3AED", // roxo
  "#DB2777", // rosa
  "#0891B2", // ciano
  "#CA8A04", // mostarda
  "#DC2626", // vermelho
];

export function closerColor(_closerId: string, index: number, config?: CloserConfig | null): string {
  return config?.color || CLOSER_COLORS[index % CLOSER_COLORS.length];
}

/** Toda reunião dura 1 hora (Bruno, 17/08). Não é mais escolha de ninguém. */
export const DURACAO_PADRAO_MIN = 60;

export const DEFAULT_CLOSER_CONFIG: Omit<CloserConfig, "closer_id"> = {
  slot_minutes: DURACAO_PADRAO_MIN,
  buffer_minutes: 0,
  min_notice_minutes: 0,
  max_per_day: null,
  is_bookable: true,
  color: null,
  default_link: null,
};

/**
 * Config do closer — com a AGENDA ABERTA (decisão do Bruno, 17/08).
 *
 * O que era configurável por closer (duração do slot, intervalo entre reuniões,
 * antecedência mínima, teto diário, "aceita agendamento") virou fonte de
 * confusão: o SDR via horário sumindo da grade sem entender por quê e o
 * agendamento simplesmente não acontecia. Agora a linha do banco só é lida pro
 * que é cosmético/prático — cor e link padrão. As travas vêm zeradas SEMPRE,
 * inclusive pra quem já tem configuração salva.
 *
 * O que continua protegendo é só o que é FÍSICO: dois clientes na mesma hora
 * com o mesmo especialista (trava do banco, 0032) e horário no passado.
 */
export function configFor(closerId: string, all: CloserConfig[]): CloserConfig {
  const found = all.find((c) => c.closer_id === closerId);
  return {
    closer_id: closerId,
    ...DEFAULT_CLOSER_CONFIG,
    color: found?.color ?? null,
    default_link: found?.default_link ?? null,
  };
}

// ── Janela COMERCIAL de agendamento — DESATIVADA (14/08) ────────────────────
// Existiu de 07/08 a 14/08: a grade só oferecia 09:00–19:30. O Bruno reverteu
// ("abrir para marcarem em qualquer horário, sem limitação — ficávamos
// pendentes de fazer agendamento"). O corte saiu do computeDaySlots; estas
// exports ficam só pra não quebrar código antigo e podem ser removidas na
// próxima limpeza. O que segue protegendo a agenda é o que é real: choque de
// horário (trava do banco), bloqueios e antecedência mínima.

export interface JanelaAgendamento { inicio: string; fim: string }

export const JANELA_AGENDAMENTO_KEY = "agenda_janela_agendamento";
export const JANELA_AGENDAMENTO_PADRAO: JanelaAgendamento = { inicio: "09:00", fim: "19:30" };

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → minutos desde a meia-noite. null quando o texto não presta. */
function minutosDoDia(hhmm: string): number | null {
  const m = HORA_RE.exec(String(hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

let janelaCache: JanelaAgendamento | null = null;

/**
 * A janela configurada. Uma busca por sessão — isto muda uma vez por ano, e a
 * grade é recalculada a cada clique de dia.
 *
 * Valor inválido ou banco fora do ar caem no padrão: melhor a grade comercial
 * do que a grade crua das 6h às 23h.
 */
export async function loadJanelaAgendamento(force = false): Promise<JanelaAgendamento> {
  if (janelaCache && !force) return janelaCache;
  try {
    const { getSetting } = await import("@/lib/qsSettings");
    const v = await getSetting<Partial<JanelaAgendamento>>(JANELA_AGENDAMENTO_KEY);
    const inicio = minutosDoDia(v?.inicio ?? "") != null ? String(v?.inicio) : JANELA_AGENDAMENTO_PADRAO.inicio;
    const fim = minutosDoDia(v?.fim ?? "") != null ? String(v?.fim) : JANELA_AGENDAMENTO_PADRAO.fim;
    janelaCache = minutosDoDia(inicio)! < minutosDoDia(fim)! ? { inicio, fim } : JANELA_AGENDAMENTO_PADRAO;
  } catch {
    janelaCache = JANELA_AGENDAMENTO_PADRAO;
  }
  return janelaCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEITURA
// ─────────────────────────────────────────────────────────────────────────────

/** Closers ativos, em ordem alfabética. */
export async function fetchClosers(): Promise<SdrUser[]> {
  const { data, error } = await supabase
    .from("qs_users")
    .select("id, name, email, role, is_active, created_at")
    .eq("role", "closer")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.warn("[closerAgenda] falha ao buscar closers:", error.message);
    return [];
  }
  return (data as SdrUser[]) ?? [];
}

/**
 * Ponte entre o mundo antigo (nome em texto, vindo da lista "Equipe da reunião"
 * das Configurações) e o novo (`closer_id`). Mesma regra do backfill da 0027:
 * compara sem caixa e sem espaços nas pontas. Empate resolve pra quem é closer.
 *
 * Devolve null quando não casa — e nesse caso a reunião nasce como sempre nasceu,
 * sem closer. Melhor sem dono do que com o dono errado.
 */
export async function findUserIdByName(name: string | null | undefined): Promise<string | null> {
  const alvo = (name ?? "").trim().toLowerCase();
  if (!alvo) return null;
  const { data, error } = await supabase
    .from("qs_users")
    .select("id, name, role")
    .eq("is_active", true);
  if (error) {
    console.warn("[closerAgenda] falha ao resolver o responsável pelo nome:", error.message);
    return null;
  }
  const matches = ((data as { id: string; name: string | null; role: string }[]) ?? []).filter(
    (u) => (u.name ?? "").trim().toLowerCase() === alvo
  );
  if (!matches.length) return null;
  return (matches.find((u) => u.role === "closer") ?? matches[0]).id;
}

export async function fetchAvailability(closerIds?: string[]): Promise<CloserAvailability[]> {
  let q = supabase.from("qs_closer_availability").select("*").order("weekday").order("start_time");
  if (closerIds?.length) q = q.in("closer_id", closerIds);
  const { data, error } = await q;
  if (error) {
    console.warn("[closerAgenda] falha ao buscar disponibilidade:", error.message);
    return [];
  }
  return (data as CloserAvailability[]) ?? [];
}

export async function fetchCloserConfigs(): Promise<CloserConfig[]> {
  const { data, error } = await supabase.from("qs_closer_config").select("*");
  if (error) {
    console.warn("[closerAgenda] falha ao buscar config dos closers:", error.message);
    return [];
  }
  return (data as CloserConfig[]) ?? [];
}

/** Bloqueios que TOCAM a janela [from, to) — inclui os que começaram antes. */
export async function fetchBlocks(from: Date, to: Date, closerIds?: string[]): Promise<CloserBlock[]> {
  let q = supabase
    .from("qs_closer_blocks")
    .select("*")
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at");
  if (closerIds?.length) q = q.in("closer_id", closerIds);
  const { data, error } = await q;
  if (error) {
    console.warn("[closerAgenda] falha ao buscar bloqueios:", error.message);
    return [];
  }
  return (data as CloserBlock[]) ?? [];
}

/**
 * Reuniões da janela [from, to). Traz o dono (SDR) e o closer pelo join em
 * qs_users — que é legível por todo mundo. O LEAD não vem pelo join de propósito:
 * sob a RLS ele volta nulo quando é de outro SDR. O nome sai de `lead_name`.
 */
export async function fetchMeetingsInRange(from: Date, to: Date, closerIds?: string[]): Promise<Meeting[]> {
  const janela = (sel: string) => {
    let q = supabase
      .from("qs_meetings")
      .select(sel)
      .gte("scheduled_at", from.toISOString())
      .lt("scheduled_at", to.toISOString())
      .order("scheduled_at");
    if (closerIds?.length) q = q.in("closer_id", closerIds);
    return q;
  };

  const { data, error } = await janela(
    "*, owner:qs_users!qs_meetings_owner_id_fkey(id,name,role), closer:qs_users!qs_meetings_closer_id_fkey(id,name,role)"
  );
  if (!error) return (data as unknown as Meeting[]) ?? [];

  // Sem a 0027 não existe a relação closer_id → o embed derruba a query inteira.
  // Em vez de devolver um calendário vazio (que parece "não tem reunião nenhuma"),
  // cai pra leitura simples: as reuniões aparecem, só que sem dono de horário.
  if (!closerIds?.length) {
    const simples = await janela("*");
    if (!simples.error) {
      console.warn("[closerAgenda] lendo reuniões sem o vínculo de closer (aplicar a migration 0027).");
      return (simples.data as unknown as Meeting[]) ?? [];
    }
  }
  console.warn("[closerAgenda] falha ao buscar reuniões:", error.message);
  return [];
}

/**
 * As tabelas da 0027 já existem no banco? A tela usa isso pra avisar o usuário
 * em vez de mostrar uma agenda vazia sem explicação.
 */
export async function agendaSchemaReady(): Promise<boolean> {
  const { error } = await supabase.from("qs_closer_config").select("closer_id", { count: "exact", head: true });
  return !error;
}

/** Tudo o que o calendário precisa numa janela, numa ida só. */
export interface AgendaData {
  closers: SdrUser[];
  configs: CloserConfig[];
  availability: CloserAvailability[];
  blocks: CloserBlock[];
  meetings: Meeting[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO DOS SLOTS (puro)
// ─────────────────────────────────────────────────────────────────────────────

export type SlotReason = "livre" | "ocupado" | "bloqueio" | "antecedencia" | "passado" | "limite_diario";

export interface Slot {
  start: Date;
  end: Date;
  available: boolean;
  reason: SlotReason;
  /** Reunião que ocupa este slot (quando reason = "ocupado"). */
  meeting?: Meeting;
  /** Bloqueio que cobre este slot (quando reason = "bloqueio"). */
  block?: CloserBlock;
}

export interface SlotInput {
  closerId: string;
  availability: CloserAvailability[]; // pode vir a lista completa; filtramos aqui
  blocks: CloserBlock[];
  meetings: Meeting[];
  config: CloserConfig;
}

export interface SlotOptions {
  /** Ignora esta reunião ao calcular ocupação — usado ao REMARCAR (o horário
   *  atual dela não pode aparecer como ocupado por ela mesma). */
  ignoreMeetingId?: string;
  now?: Date;
  /** Devolve só os livres (o padrão devolve todos, marcados). */
  onlyFree?: boolean;
  /**
   * Recorte comercial da grade. Omitido = usa o padrão (09:00–19:30), que é o
   * que o SDR deve ver. Passe `null` para ver a janela CRUA do closer — é o que
   * o encaixe manual do gestor precisa.
   */
  janela?: JanelaAgendamento | null;
}

function parseTime(hms: string): [number, number] {
  const [h, m] = (hms || "00:00").split(":").map(Number);
  return [h || 0, m || 0];
}

function atTime(day: Date, hms: string): Date {
  const [h, m] = parseTime(hms);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Início do dia (00:00 local). */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Os slots de UM closer em UM dia. Devolve também os ocupados (com o motivo),
 * porque numa ferramenta interna ver "14h — ocupado com Fulano" vale mais do que
 * o horário simplesmente sumir da grade.
 */
export function computeDaySlots(input: SlotInput, day: Date, opts: SlotOptions = {}): Slot[] {
  const { closerId } = input;
  const now = opts.now ?? new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  // AGENDA ABERTA (Bruno, 17/08): a grade do dia é sempre a mesma pra todo
  // especialista — 07:00 às 22:00, de hora em hora. A janela cadastrada por
  // closer deixou de recortar a grade: era ela que fazia horário sumir da tela
  // sem explicação e travava o SDR ("muito problema com o agendamento").
  const windows: CloserAvailability[] = [
    { closer_id: closerId, weekday: day.getDay(), start_time: "07:00", end_time: "22:00" } as CloserAvailability,
  ];

  // Reuniões do closer que TOCAM o dia (uma de 23:30 invade o dia seguinte).
  const dayMeetings = input.meetings.filter((m) => {
    if (m.closer_id !== closerId) return false;
    if (m.status !== "agendada") return false;
    if (opts.ignoreMeetingId && m.id === opts.ignoreMeetingId) return false;
    const s = new Date(m.scheduled_at).getTime();
    const e = s + (m.duration_min ?? 30) * 60_000;
    return overlaps(s, e, dayStart.getTime(), dayEnd.getTime());
  });

  const dayBlocks = input.blocks.filter((b) => {
    if (b.closer_id !== closerId) return false;
    return overlaps(
      new Date(b.starts_at).getTime(),
      new Date(b.ends_at).getTime(),
      dayStart.getTime(),
      dayEnd.getTime()
    );
  });

  // Teto diário e antecedência mínima SAÍRAM (Bruno, 17/08): eram limite de
  // configuração, não da realidade — o especialista podia ter a hora livre e o
  // SDR não conseguia marcar. Sem buffer entre reuniões pelo mesmo motivo.
  const step = DURACAO_PADRAO_MIN;
  const buffer = 0;

  // O recorte comercial (09:00–19:30) FOI REMOVIDO a pedido do Bruno (14/08):
  // a grade oferece qualquer horário da janela do closer, sem corte — os SDRs
  // ficavam sem conseguir agendar fora do comercial. `opts.janela` é ignorado
  // de propósito (mantido na assinatura pra não quebrar caller antigo).

  const slots: Slot[] = [];
  for (const w of windows) {
    const wStart = atTime(dayStart, w.start_time);
    const wEnd = atTime(dayStart, w.end_time);
    // Trava de segurança: janela absurda não pode virar loop infinito.
    for (let i = 0, t = wStart.getTime(); i < 300; i++, t += step * 60_000) {
      const sStart = t;
      const sEnd = t + DURACAO_PADRAO_MIN * 60_000;
      if (sEnd > wEnd.getTime()) break;

      const start = new Date(sStart);
      const end = new Date(sEnd);

      // A ordem importa: o motivo mais informativo ganha. "Ocupado com Fulano"
      // diz mais do que "passado" num slot que é as duas coisas.
      const meeting = dayMeetings.find((m) => {
        const ms = new Date(m.scheduled_at).getTime();
        const me = ms + (m.duration_min ?? 30) * 60_000;
        return overlaps(sStart, sEnd, ms - buffer, me + buffer);
      });
      const block = dayBlocks.find((b) =>
        overlaps(sStart, sEnd, new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime())
      );

      // Só sobra o que é REAL: já tem alguém nessa hora, o especialista marcou
      // bloqueio (férias/almoço) ou o horário já passou.
      let reason: SlotReason = "livre";
      if (meeting) reason = "ocupado";
      else if (block) reason = "bloqueio";
      else if (sStart < now.getTime()) reason = "passado";

      const slot: Slot = { start, end, available: reason === "livre", reason, meeting, block };
      if (!opts.onlyFree || slot.available) slots.push(slot);
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Quantos slots livres o closer tem no dia. */
export function countFreeSlots(input: SlotInput, day: Date, opts: SlotOptions = {}): number {
  return computeDaySlots(input, day, { ...opts, onlyFree: true }).length;
}

/**
 * Próximo horário livre do closer a partir de `from`, varrendo no máximo
 * `maxDays` dias. Alimenta o "Próximo livre: ter 14:00" do painel.
 */
export function nextFreeSlot(input: SlotInput, from: Date = new Date(), maxDays = 30): Slot | null {
  for (let i = 0; i < maxDays; i++) {
    const day = addDays(startOfDay(from), i);
    const free = computeDaySlots(input, day, { now: from, onlyFree: true });
    if (free.length) return free[0];
  }
  return null;
}

/**
 * O horário [start, start+duration) cabe na agenda do closer? Última conferência
 * antes de gravar — o banco tem a trava definitiva (constraint EXCLUDE), esta
 * aqui existe pra dar uma mensagem decente em vez de um erro de Postgres.
 */
export function isSlotBookable(
  input: SlotInput,
  start: Date,
  durationMin: number,
  opts: SlotOptions = {}
): { ok: true } | { ok: false; reason: SlotReason; message: string } {
  const now = opts.now ?? new Date();
  const sStart = start.getTime();
  const sEnd = sStart + durationMin * 60_000;
  const buffer = input.config.buffer_minutes * 60_000;

  // AGENDA ABERTA (17/08): "não aceita agendamento", antecedência mínima e
  // janela de atendimento saíram daqui. Sobraram as três checagens que
  // correspondem a algo real no mundo — passado, choque e bloqueio.
  if (sStart < now.getTime()) {
    return { ok: false, reason: "passado", message: "Esse horário já passou." };
  }

  const conflito = input.meetings.find((m) => {
    if (m.closer_id !== input.closerId || m.status !== "agendada") return false;
    if (opts.ignoreMeetingId && m.id === opts.ignoreMeetingId) return false;
    const ms = new Date(m.scheduled_at).getTime();
    const me = ms + (m.duration_min ?? 30) * 60_000;
    return overlaps(sStart, sEnd, ms - buffer, me + buffer);
  });
  if (conflito) {
    return { ok: false, reason: "ocupado", message: "O closer já tem reunião nesse horário." };
  }

  const bloqueio = input.blocks.find(
    (b) =>
      b.closer_id === input.closerId &&
      overlaps(sStart, sEnd, new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime())
  );
  if (bloqueio) {
    return {
      ok: false,
      reason: "bloqueio",
      message: `O closer está indisponível nesse horário${bloqueio.reason ? ` (${bloqueio.reason})` : ""}.`,
    };
  }

  return { ok: true };
}

/**
 * A conferência do horário ANTES de gravar, buscando o que precisa no banco.
 *
 * Existia `isSlotBookable` (pura, testável) desde a 0031 — e ninguém a chamava.
 * O campo de data/hora do Ganho é um `datetime-local` solto: aceitava horário no
 * passado e fora da janela do closer sem piscar. O banco só barra CHOQUE de
 * agenda (constraint EXCLUDE); o resto passava. Medido na base real em 05/08:
 * uma reunião marcada para 23h50 e outra às 20h40, fora da janela da closer.
 *
 * Devolve `null` quando está tudo certo, ou a mensagem pro usuário.
 */
export async function validarHorario(
  closerId: string,
  inicio: Date,
  duracaoMin: number,
  opts: { ignoreMeetingId?: string } = {}
): Promise<string | null> {
  if (Number.isNaN(inicio.getTime())) return "Data e hora inválidas.";
  const de = startOfDay(inicio);
  const ate = addDays(de, 1);
  const [configs, availability, blocks, meetings] = await Promise.all([
    fetchCloserConfigs(),
    fetchAvailability([closerId]),
    fetchBlocks(de, ate, [closerId]),
    fetchMeetingsInRange(de, ate, [closerId]),
  ]);
  const r = isSlotBookable(
    { closerId, config: configFor(closerId, configs), availability, blocks, meetings },
    inicio,
    duracaoMin,
    opts
  );
  return r.ok ? null : r.message;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCRITA DA DISPONIBILIDADE (Configurações → Agenda dos Closers)
// ─────────────────────────────────────────────────────────────────────────────

/** Substitui a grade semanal INTEIRA do closer (apaga e regrava). */
export async function saveAvailability(
  closerId: string,
  windows: { weekday: number; start_time: string; end_time: string }[]
): Promise<{ ok: boolean; error?: string }> {
  const del = await supabase.from("qs_closer_availability").delete().eq("closer_id", closerId);
  if (del.error) return { ok: false, error: del.error.message };
  if (!windows.length) return { ok: true };
  const { error } = await supabase
    .from("qs_closer_availability")
    .insert(windows.map((w) => ({ ...w, closer_id: closerId })));
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveCloserConfig(config: CloserConfig): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("qs_closer_config").upsert(
    {
      closer_id: config.closer_id,
      slot_minutes: config.slot_minutes,
      buffer_minutes: config.buffer_minutes,
      min_notice_minutes: config.min_notice_minutes,
      max_per_day: config.max_per_day,
      is_bookable: config.is_bookable,
      color: config.color,
      default_link: config.default_link,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "closer_id" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function createBlock(
  closerId: string,
  startsAt: Date,
  endsAt: Date,
  reason: string | null,
  createdBy?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("qs_closer_blocks")
    .insert({
      closer_id: closerId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason,
      created_by: createdBy ?? null,
    })
    .select();
  if (error) return { ok: false, error: error.message };
  // .select() vazio = RLS barrou (um SDR tentando bloquear a agenda alheia).
  if (!data || data.length === 0) {
    return { ok: false, error: "Você não tem permissão para bloquear a agenda deste closer." };
  }
  return { ok: true };
}

export async function deleteBlock(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from("qs_closer_blocks").delete().eq("id", id).select();
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Você não tem permissão para remover este bloqueio." };
  }
  return { ok: true };
}

// ── Identidade e desfecho da reunião ─────────────────────────────────────────
// Moradia comum destes três: a Agenda precisa saber DE QUEM é a reunião e SE ela
// ficou sem desfecho, e essa regra não pode divergir entre telas.

/** Fim real da reunião: `ends_at` quando existe (0027), senão início + duração. */
export function fimDaReuniao(m: Meeting): Date {
  if (m.ends_at) return new Date(m.ends_at);
  return new Date(new Date(m.scheduled_at).getTime() + (m.duration_min ?? 30) * 60_000);
}

/** Terminou e ninguém disse no que deu — o número que expõe o funil furado. */
export function semDesfecho(m: Meeting, agora: Date): boolean {
  return (m.status === "agendada" || m.status === "confirmada") && fimDaReuniao(m) < agora;
}

/**
 * De quem é esta reunião. Closer de verdade quando existe; senão o nome do
 * responsável em texto livre (`meeting_owner`), que é o que a operação usa
 * enquanto ninguém tem o papel `closer` no QS.
 */
export function chaveDoEspecialista(m: Meeting): string {
  if (m.closer_id) return m.closer_id;
  const nome = (m.closer?.name || m.meeting_owner || "").trim();
  return nome ? `nome:${nome.toLowerCase()}` : "sem";
}
