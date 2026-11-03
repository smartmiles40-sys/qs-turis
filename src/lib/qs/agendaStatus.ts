// src/lib/qs/agendaStatus.ts
// -----------------------------------------------------------------------------
// STATUS DA AGENDA (redesign 03/11, desenho agenda.html do Bruno).
//
// Os chips da Agenda do dia ("Acontecendo agora", "Falta registrar o desfecho",
// Agendadas, Realizadas...) saem DAQUI, e daqui só. As regras são as que o QS
// já usava, juntadas num lugar:
//
//   • status do banco (qs_meetings.status): agendada, confirmada, realizada,
//     no_show, reagendada, cancelada, desistencia, arquivada;
//   • "agendada/confirmada" que JÁ TERMINOU = falta registrar o desfecho — a
//     mesma conta do semDesfecho (closerAgenda.ts) e do situacaoDaReuniao
//     (reunioesDoSdr.ts): fim < agora, fim = ends_at ou início + duração (30 min
//     quando não há duração gravada);
//   • "agendada/confirmada" que já começou e ainda não terminou = acontecendo
//     agora (é nela que o "Entrar no Meet" importa);
//   • status desconhecido cai em "arquivada", como no situacaoDaReuniao.
//
// Nada aqui vai ao banco nem lê relógio sozinho: `agora` entra por parâmetro,
// pra poder testar (tests/agenda/agendaStatus.test.ts).
//
// Também moram aqui as ROTAS da agenda (/agenda/dia, /agenda/time,
// /agenda/mes) e o mapa dos endereços antigos, pelo mesmo motivo: são regra
// pura e precisam de teste.
// -----------------------------------------------------------------------------

export interface ReuniaoDaAgenda {
  status: string;
  scheduled_at: string;
  ends_at?: string | null;
  duration_min?: number | null;
}

export type StatusAgenda =
  | "acontecendo"
  | "sem_desfecho"
  | "agendada"
  | "confirmada"
  | "realizada"
  | "no_show"
  | "reagendada"
  | "cancelada"
  | "desistencia"
  | "arquivada";

/** Ordem dos chips: primeiro o que pede ação agora, depois o que é história. */
export const STATUS_AGENDA: { id: StatusAgenda; rotulo: string; rotuloUm: string }[] = [
  { id: "acontecendo", rotulo: "Acontecendo agora", rotuloUm: "Acontecendo agora" },
  { id: "sem_desfecho", rotulo: "Falta registrar o desfecho", rotuloUm: "Sem desfecho" },
  { id: "agendada", rotulo: "Agendadas", rotuloUm: "Agendada" },
  { id: "confirmada", rotulo: "Confirmadas", rotuloUm: "Confirmada" },
  { id: "realizada", rotulo: "Realizadas", rotuloUm: "Realizada" },
  { id: "no_show", rotulo: "No-show", rotuloUm: "No-show" },
  { id: "reagendada", rotulo: "Reagendadas", rotuloUm: "Reagendada" },
  { id: "cancelada", rotulo: "Canceladas", rotuloUm: "Cancelada" },
  { id: "desistencia", rotulo: "Desistência", rotuloUm: "Desistência" },
  { id: "arquivada", rotulo: "Arquivadas", rotuloUm: "Arquivada" },
];

export const ROTULO_STATUS: Record<StatusAgenda, string> = Object.fromEntries(
  STATUS_AGENDA.map((s) => [s.id, s.rotuloUm])
) as Record<StatusAgenda, string>;

const ABERTAS = new Set(["agendada", "confirmada"]);
const FECHADAS = new Set(["realizada", "no_show", "reagendada", "cancelada", "desistencia", "arquivada"]);

export function inicioDaReuniao(m: ReuniaoDaAgenda): Date {
  return new Date(m.scheduled_at);
}

export function fimDaReuniaoAgenda(m: ReuniaoDaAgenda): Date {
  if (m.ends_at) return new Date(m.ends_at);
  return new Date(new Date(m.scheduled_at).getTime() + (m.duration_min ?? 30) * 60_000);
}

/** A reunião ainda espera um desfecho (agendada ou confirmada)? */
export function estaAberta(m: ReuniaoDaAgenda): boolean {
  return ABERTAS.has(m.status);
}

export function statusNaAgenda(m: ReuniaoDaAgenda, agora: Date): StatusAgenda {
  if (ABERTAS.has(m.status)) {
    const t = agora.getTime();
    if (fimDaReuniaoAgenda(m).getTime() < t) return "sem_desfecho";
    if (inicioDaReuniao(m).getTime() <= t) return "acontecendo";
    return m.status as "agendada" | "confirmada";
  }
  return FECHADAS.has(m.status) ? (m.status as StatusAgenda) : "arquivada";
}

export type FiltroAgenda = StatusAgenda | "todas";

export function contarPorStatus(lista: ReuniaoDaAgenda[], agora: Date): Record<FiltroAgenda, number> {
  const c = Object.fromEntries(STATUS_AGENDA.map((s) => [s.id, 0])) as Record<FiltroAgenda, number>;
  c.todas = lista.length;
  for (const m of lista) c[statusNaAgenda(m, agora)] += 1;
  return c;
}

export interface ChipDaAgenda {
  id: FiltroAgenda;
  rotulo: string;
  qtd: number;
}

/**
 * Os chips da tela: "Todas" + cada status que tem pelo menos uma reunião (ou
 * que está selecionado — senão o chip ativo sumiria e não daria pra desmarcar).
 */
export function chipsDaAgenda(lista: ReuniaoDaAgenda[], agora: Date, ativo: FiltroAgenda = "todas"): ChipDaAgenda[] {
  const c = contarPorStatus(lista, agora);
  return [
    { id: "todas" as FiltroAgenda, rotulo: "Todas", qtd: c.todas },
    ...STATUS_AGENDA.filter((s) => c[s.id] > 0 || s.id === ativo).map((s) => ({ id: s.id as FiltroAgenda, rotulo: s.rotulo, qtd: c[s.id] })),
  ];
}

export function filtrarPorStatus<T extends ReuniaoDaAgenda>(lista: T[], filtro: FiltroAgenda, agora: Date): T[] {
  if (filtro === "todas") return lista;
  return lista.filter((m) => statusNaAgenda(m, agora) === filtro);
}

const porInicio = <T extends ReuniaoDaAgenda>(a: T, b: T) => inicioDaReuniao(a).getTime() - inicioDaReuniao(b).getTime();

/** As que estão rolando neste minuto, da que começou antes pra depois. */
export function acontecendoAgora<T extends ReuniaoDaAgenda>(lista: T[], agora: Date): T[] {
  return lista.filter((m) => statusNaAgenda(m, agora) === "acontecendo").sort(porInicio);
}

/** A próxima reunião em aberto que ainda não começou (null se não há). */
export function proximaReuniao<T extends ReuniaoDaAgenda>(lista: T[], agora: Date): T | null {
  const futuras = lista
    .filter((m) => estaAberta(m) && inicioDaReuniao(m).getTime() > agora.getTime())
    .sort(porInicio);
  return futuras[0] ?? null;
}

/** As que já terminaram e ninguém disse no que deu, da mais antiga pra mais nova. */
export function faltaDesfecho<T extends ReuniaoDaAgenda>(lista: T[], agora: Date): T[] {
  return lista.filter((m) => statusNaAgenda(m, agora) === "sem_desfecho").sort(porInicio);
}

/** "em 26 min", "em 1 h", "em 2 h 05" — o tempo até a próxima. */
export function emQuantoTempo(de: Date, ate: Date): string {
  const min = Math.max(0, Math.ceil((ate.getTime() - de.getTime()) / 60_000));
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `em ${h} h ${String(r).padStart(2, "0")}` : `em ${h} h`;
}

// ── Pessoas ──────────────────────────────────────────────────────────────────

/** Cor do especialista pela ordem da coluna — variável da paleta da agenda (agenda.css). */
export function corDaPessoa(i: number, semDono = false): string {
  return semDono ? "var(--ag-pessoa-sem)" : `var(--ag-pessoa-${(i % 6) + 1})`;
}

/** "Bruno Matheus" → "BM"; "Talita" → "T". */
export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

// ── Rotas ────────────────────────────────────────────────────────────────────

/** As três abas do desenho, em todo papel. */
export const ABAS_AGENDA = [
  { id: "dia", rotulo: "Agenda do dia" },
  { id: "time", rotulo: "Reuniões do time" },
  { id: "mes", rotulo: "Mês" },
] as const;
export type AbaAgendaBase = (typeof ABAS_AGENDA)[number]["id"];

/** Abas que só a área do closer tem (vieram da antiga tela "Reuniões" dele). */
export const ABAS_AGENDA_CLOSER = [
  { id: "desfechos", rotulo: "Meus desfechos" },
  { id: "falta-agendar", rotulo: "Falta agendar" },
] as const;
export type AbaAgendaCloser = (typeof ABAS_AGENDA_CLOSER)[number]["id"];
export type AbaAgenda = AbaAgendaBase | AbaAgendaCloser;

const BASE = new Set<string>(ABAS_AGENDA.map((a) => a.id));
const DO_CLOSER = new Set<string>(ABAS_AGENDA_CLOSER.map((a) => a.id));

export function ehAbaBase(x: string | null | undefined): x is AbaAgendaBase {
  return !!x && BASE.has(x);
}

/**
 * Área do Closer (#closer/<tela>/<id>) → aba da agenda, ou null se a tela não
 * é da agenda. Endereços antigos continuam abrindo:
 *   #closer/agenda .................. dia
 *   #closer/painel .................. dia            (Atividades, saiu em 03/11)
 *   #closer/reunioes[/todas] ........ dia            (era a lista + dia + mês)
 *   #closer/reunioes/agenda ......... desfechos      (Minha agenda do closer)
 *   #closer/reunioes/falta-agendar .. falta-agendar
 */
export function abaDoCloser(tela: string, id?: string | null): AbaAgenda | null {
  if (tela === "agenda") {
    if (id && (BASE.has(id) || DO_CLOSER.has(id))) return id as AbaAgenda;
    return "dia";
  }
  if (tela === "painel") return "dia";
  if (tela === "reunioes") {
    if (id === "agenda") return "desfechos";
    if (id === "falta-agendar") return "falta-agendar";
    return "dia";
  }
  return null;
}

/**
 * Comercial (#comercial/...) → aba da agenda, ou null se o endereço não é da
 * agenda. O Comercial antigo só conhecia "#comercial/minha-agenda" (aviso,
 * bolinha), que desde 03/11 é a lista de quem marcou — a aba "time".
 */
export function abaDoComercial(hash: string): AbaAgendaBase | null {
  const [area, tela, id] = hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (area !== "comercial") return null;
  if (tela === "agenda") return ehAbaBase(id) ? id : "dia";
  if (tela === "reunioes") return "dia";
  if (tela === "minha-agenda") return "time";
  return null;
}

export function hashDaAgenda(area: "comercial" | "closer", aba: AbaAgenda): string {
  return `#${area}/agenda/${aba}`;
}
