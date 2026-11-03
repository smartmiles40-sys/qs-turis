// src/lib/qs/desempenhoSdr.ts
// -----------------------------------------------------------------------------
// DESEMPENHO DO SDR, versão visual (Bruno, 03/11) — as contas puras.
//
// Não inventa métrica: o funil continua vindo de qs_funil_sdr (0095); a meta
// é a mesma de fetchMeetingKpis (qs_goals mensal "reunioes" e
// "reunioes_realizadas"), e o ritmo é o MESMO do Painel (TasksPanel, 26/10):
// dias úteis seg–sex já passados + a fração de hoje. O que é novo aqui é só a
// arrumação: série por dia e ranking, contados a partir de qs_meetings (que
// todo o time lê — RLS meetings_select = true) e de qs_tasks concluídas.
// -----------------------------------------------------------------------------

/** Fração do mês útil (seg–sex) que já passou, com hoje contando `fracHoje`. */
export function fracaoDoMesUtil(agora: Date, fracHoje = 0.5): number {
  const y = agora.getFullYear(), m = agora.getMonth();
  const ultimo = new Date(y, m + 1, 0).getDate();
  let total = 0, passados = 0;
  for (let d = 1; d <= ultimo; d++) {
    const wd = new Date(y, m, d).getDay();
    if (wd === 0 || wd === 6) continue;
    total++;
    if (d < agora.getDate()) passados++;
    else if (d === agora.getDate()) passados += fracHoje;
  }
  return total > 0 ? Math.min(1, passados / total) : 1;
}

/** Dias úteis de hoje (inclusive) até o fim do mês — mínimo 1. */
export function diasUteisRestantes(agora: Date): number {
  const y = agora.getFullYear(), m = agora.getMonth();
  const ultimo = new Date(y, m + 1, 0).getDate();
  let n = 0;
  for (let d = agora.getDate(); d <= ultimo; d++) {
    const wd = new Date(y, m, d).getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return Math.max(1, n);
}

export type TomRitmo = "ok" | "warn" | "danger";

export interface RitmoMeta {
  feito: number;
  meta: number;
  /** 0–100: quanto da meta já foi feito. */
  pct: number;
  /** 0–100: onde "deveria estar" agora. */
  idealPct: number;
  ideal: number;
  tom: TomRitmo;
  falta: number;
  /** O que falta ÷ dias úteis que sobram (contando hoje). */
  porDia: number;
}

/** Mesma régua do Painel: verde no ritmo, amarelo a ≥80% do esperado, vermelho abaixo. */
export function ritmoDaMeta(feito: number, meta: number | null, agora: Date, fracHoje = 0.5): RitmoMeta | null {
  if (!meta || meta <= 0) return null;
  const frac = fracaoDoMesUtil(agora, fracHoje);
  const ideal = meta * frac;
  const tom: TomRitmo = feito >= ideal || ideal < 1 ? "ok" : feito >= ideal * 0.8 ? "warn" : "danger";
  const falta = Math.max(0, meta - feito);
  return {
    feito, meta,
    pct: Math.min(100, (feito / meta) * 100),
    idealPct: Math.min(100, frac * 100),
    ideal: Math.round(ideal),
    tom,
    falta,
    porDia: Math.ceil(falta / diasUteisRestantes(agora)),
  };
}

// ── Série por dia ────────────────────────────────────────────────────────────

export function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Todos os dias de `de` a `ate` (AAAA-MM-DD, inclusive), zerados. */
export function diasDoIntervalo(de: string, ate: string): string[] {
  const [y1, m1, d1] = de.split("-").map(Number);
  const [y2, m2, d2] = ate.split("-").map(Number);
  const fim = new Date(y2, m2 - 1, d2).getTime();
  const out: string[] = [];
  for (let d = new Date(y1, m1 - 1, d1); d.getTime() <= fim && out.length < 400; d.setDate(d.getDate() + 1)) {
    out.push(chaveDia(d));
  }
  return out;
}

/** Conta quantas datas (ISO) caem em cada dia do intervalo. */
export function serieDiaria(datas: (string | null | undefined)[], de: string, ate: string): { dia: string; n: number }[] {
  const dias = diasDoIntervalo(de, ate);
  const conta = new Map(dias.map((d) => [d, 0]));
  for (const iso of datas) {
    if (!iso) continue;
    const k = chaveDia(new Date(iso));
    if (conta.has(k)) conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  return dias.map((dia) => ({ dia, n: conta.get(dia) ?? 0 }));
}

// ── Ranking por reuniões ─────────────────────────────────────────────────────

export interface ReuniaoRanking {
  owner_id: string | null;
  status: string;
  tipo?: string | null;
  created_at: string;
  scheduled_at: string;
  sal?: string | null;
}

export interface LinhaRanking {
  id: string;
  nome: string;
  marcadas: number;
  realizadas: number;
  sal: number;
}

/**
 * Por SDR, no intervalo [de, ate] (AAAA-MM-DD):
 *  - marcadas: reuniões CRIADAS no período (fora arquivada e retomada) — a
 *    mesma regra do "Reuniões agendadas" de fetchMeetingKpis;
 *  - realizadas / SAL: reuniões COM DATA no período que viraram realizada / SAL aceito.
 * Só entram os ids de `sdrs` (quem é SDR ativo); ordena por realizadas, depois marcadas.
 */
export function rankingPorReunioes(lista: ReuniaoRanking[], sdrs: { id: string; name: string }[], de: string, ate: string, agora = new Date()): LinhaRanking[] {
  const mapa = new Map<string, LinhaRanking>(sdrs.map((s) => [s.id, { id: s.id, nome: s.name, marcadas: 0, realizadas: 0, sal: 0 }]));
  const dentro = (iso: string) => { const k = chaveDia(new Date(iso)); return k >= de && k <= ate; };
  for (const m of lista) {
    const l = m.owner_id ? mapa.get(m.owner_id) : undefined;
    if (!l || m.tipo === "retomada") continue;
    if (m.status !== "arquivada" && dentro(m.created_at)) l.marcadas++;
    if (dentro(m.scheduled_at) && new Date(m.scheduled_at).getTime() <= agora.getTime()) {
      if (m.status === "realizada") l.realizadas++;
      if (m.sal === "aceito") l.sal++;
    }
  }
  return [...mapa.values()].sort((a, b) => b.realizadas - a.realizadas || b.marcadas - a.marcadas || b.sal - a.sal || a.nome.localeCompare(b.nome));
}
