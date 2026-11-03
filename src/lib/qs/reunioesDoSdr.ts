// src/lib/qs/reunioesDoSdr.ts
// -----------------------------------------------------------------------------
// "REUNIÕES QUE EU MARQUEI" — a conta pura por trás da tela unificada
// (Minha agenda + Reuniões, Bruno, 03/11).
//
// Quem marcou = qs_meetings.owner_id (ver createMeeting): conferido no banco em
// 03/11 — 829 das 857 reuniões têm dono SDR e `scheduled_by` (texto) é só o
// nome dele. O closer que atende é closer_id/meeting_owner.
//
// Nada aqui vai ao banco: a tela busca, e estas funções só classificam, filtram
// e contam — pra poder testar sem rede (tests/agenda/reunioesDoSdr.test.ts).
// -----------------------------------------------------------------------------

/** O mínimo de uma reunião que a conta precisa. */
export interface ReuniaoBase {
  status: string;
  scheduled_at: string;
  ends_at?: string | null;
  duration_min?: number | null;
  sal?: string | null;
  venda_valor?: number | string | null;
}

/**
 * Situação de uma reunião pro SDR. Os status do banco (03/11): agendada,
 * confirmada, realizada, no_show, reagendada, cancelada, desistencia e
 * arquivada. "agendada/confirmada" se divide em duas: ainda vai acontecer, ou
 * já passou e o closer não deu desfecho — que é o que o SDR precisa cobrar.
 */
export type Situacao =
  | "vai_acontecer"
  | "sem_desfecho"
  | "realizada"
  | "no_show"
  | "reagendada"
  | "cancelada"
  | "desistencia"
  | "arquivada";

export const SITUACOES: { id: Situacao; rotulo: string; tom: "info" | "warn" | "ok" | "danger" | "neutral" }[] = [
  { id: "vai_acontecer", rotulo: "Vão acontecer", tom: "info" },
  { id: "sem_desfecho", rotulo: "Sem desfecho", tom: "warn" },
  { id: "realizada", rotulo: "Realizadas", tom: "ok" },
  { id: "no_show", rotulo: "No-show", tom: "danger" },
  { id: "reagendada", rotulo: "Reagendadas", tom: "neutral" },
  { id: "cancelada", rotulo: "Canceladas", tom: "neutral" },
  { id: "desistencia", rotulo: "Desistência", tom: "danger" },
  { id: "arquivada", rotulo: "Arquivadas", tom: "neutral" },
];

const ABERTAS = new Set(["agendada", "confirmada"]);

export function fimDaReuniao(m: ReuniaoBase): Date {
  if (m.ends_at) return new Date(m.ends_at);
  return new Date(new Date(m.scheduled_at).getTime() + (m.duration_min ?? 30) * 60_000);
}

export function situacaoDaReuniao(m: ReuniaoBase, agora: Date): Situacao {
  if (ABERTAS.has(m.status)) return fimDaReuniao(m).getTime() < agora.getTime() ? "sem_desfecho" : "vai_acontecer";
  switch (m.status) {
    case "realizada": case "no_show": case "reagendada": case "cancelada": case "desistencia": case "arquivada":
      return m.status;
    default:
      return "arquivada";
  }
}

export function valorDaVenda(m: ReuniaoBase): number {
  const v = Number(m.venda_valor ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ── Períodos (pela data DA REUNIÃO, hora local do navegador) ─────────────────

export type PeriodoReunioes = "proximas" | "hoje" | "semana" | "mes" | "mes_passado" | "90d" | "tudo";

export const PERIODOS_REUNIOES: { id: PeriodoReunioes; rotulo: string }[] = [
  { id: "proximas", rotulo: "De hoje em diante" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "semana", rotulo: "Esta semana" },
  { id: "mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "90d", rotulo: "90 dias" },
  { id: "tudo", rotulo: "Tudo" },
];

function dia0(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function maisDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Segunda-feira 00:00 da semana de `d`. */
export function inicioDaSemana(d: Date): Date {
  const x = dia0(d);
  const dow = x.getDay() || 7; // domingo = 7
  return maisDias(x, -(dow - 1));
}

/** [de, ate) — null = sem limite daquele lado. */
export function intervaloReunioes(p: PeriodoReunioes, agora: Date): { de: Date | null; ate: Date | null } {
  const hoje = dia0(agora);
  switch (p) {
    case "proximas": return { de: hoje, ate: null };
    case "hoje": return { de: hoje, ate: maisDias(hoje, 1) };
    case "semana": { const s = inicioDaSemana(agora); return { de: s, ate: maisDias(s, 7) }; }
    case "mes": return { de: new Date(hoje.getFullYear(), hoje.getMonth(), 1), ate: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1) };
    case "mes_passado": return { de: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), ate: new Date(hoje.getFullYear(), hoje.getMonth(), 1) };
    case "90d": return { de: maisDias(hoje, -90), ate: maisDias(hoje, 1) };
    case "tudo": return { de: null, ate: null };
  }
}

/** Um dia específico (clique na faixa da semana). */
export function intervaloDoDia(d: Date): { de: Date; ate: Date } {
  const de = dia0(d);
  return { de, ate: maisDias(de, 1) };
}

export function dentroDoIntervalo(m: ReuniaoBase, i: { de: Date | null; ate: Date | null }): boolean {
  const t = new Date(m.scheduled_at).getTime();
  if (i.de && t < i.de.getTime()) return false;
  if (i.ate && t >= i.ate.getTime()) return false;
  return true;
}

// ── Resumo ───────────────────────────────────────────────────────────────────

export interface ResumoReunioes {
  total: number;
  porSituacao: Record<Situacao, number>;
  salAceito: number;
  salRecusado: number;
  vendas: number;
  valorVendido: number;
  /** realizadas ÷ (realizadas + no-show); null sem nenhuma das duas. */
  comparecimento: number | null;
}

export function resumirReunioes(lista: ReuniaoBase[], agora: Date): ResumoReunioes {
  const porSituacao = Object.fromEntries(SITUACOES.map((s) => [s.id, 0])) as Record<Situacao, number>;
  let salAceito = 0, salRecusado = 0, vendas = 0, valorVendido = 0;
  for (const m of lista) {
    porSituacao[situacaoDaReuniao(m, agora)]++;
    if (m.sal === "aceito") salAceito++;
    else if (m.sal === "recusado") salRecusado++;
    const v = valorDaVenda(m);
    if (v > 0) { vendas++; valorVendido += v; }
  }
  const base = porSituacao.realizada + porSituacao.no_show;
  return {
    total: lista.length,
    porSituacao,
    salAceito,
    salRecusado,
    vendas,
    valorVendido,
    comparecimento: base > 0 ? (porSituacao.realizada / base) * 100 : null,
  };
}

/** Agrupa por dia (chave AAAA-MM-DD local), na ordem pedida. */
export function agruparPorDia<T extends ReuniaoBase>(lista: T[], crescente: boolean): { dia: Date; chave: string; itens: T[] }[] {
  const ord = [...lista].sort((a, b) => {
    const d = new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    return crescente ? d : -d;
  });
  const grupos: { dia: Date; chave: string; itens: T[] }[] = [];
  for (const m of ord) {
    const d = dia0(new Date(m.scheduled_at));
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.itens.push(m);
    else grupos.push({ dia: d, chave, itens: [m] });
  }
  return grupos;
}

/** Os 7 dias (seg→dom) da semana de `agora`, com quantas reuniões cada um tem. */
export function faixaDaSemana(lista: ReuniaoBase[], agora: Date): { dia: Date; total: number; abertas: number }[] {
  const s = inicioDaSemana(agora);
  return Array.from({ length: 7 }, (_, i) => {
    const dia = maisDias(s, i);
    const doDia = lista.filter((m) => dentroDoIntervalo(m, intervaloDoDia(dia)) && m.status !== "arquivada");
    return { dia, total: doDia.length, abertas: doDia.filter((m) => ABERTAS.has(m.status)).length };
  });
}
