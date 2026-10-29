// src/expedicoes/lib/cockpit/viagem.ts
// -----------------------------------------------------------------------------
// "A VIAGEM INTEIRA", "HOJE", "PRÓXIMOS DIAS" E "AÇÕES DA OPERAÇÃO" (spec §3.3).
//
// Hotéis não têm tabela: as datas ficam em cada QUARTO (quartos.check_in/out) e o
// hotel é o agrupamento hotel_cidade + check-in + check-out + extensão (mesma
// chave do rooming, rooming/calculos.ts → chaveTrecho). Cada hotel vira uma barra
// que ocupa as colunas do check-in ATÉ o check-out (inclusive — no dia da troca
// os dois hotéis aparecem), em pistas alternadas pra não sobrepor. Os dias que
// nenhum hotel cobre viram um trecho "Em voo / sem hotel".
//
// O dia do roteiro junta as duas tabelas, que não têm ligação no banco:
//   • roteiro_dias (portal do viajante): título, cidade;
//   • roteiro_lider_dias (área do líder): programação, local, líderes, pax e o ALERTA
//     (nível + texto + ação + responsável) — é daí que saem as "ações da operação".
// Casam pela data; sem data, pelo nº do dia (D1 = embarque).
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------
import { diasEntre } from "../fase.ts";

const iso = (d: string | null | undefined) => (d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d)?.[0] ?? null : null);

/** "YYYY-MM-DD" + n dias (sem fuso). */
export function somarDias(dataIso: string, n: number): string {
  const [y, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "29/10" */
export const ddmm = (dataIso: string) => `${dataIso.slice(8, 10)}/${dataIso.slice(5, 7)}`;

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function diaDaSemana(dataIso: string, longo = false): string {
  const [y, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (longo ? SEMANA_LONGA : SEMANA)[w];
}

// ── Faixa de dias + hotéis ───────────────────────────────────────────────────
export interface DiaFaixa { n: number; data: string; estado: "passado" | "hoje" | "futuro" }

export interface QuartoMin {
  hotel_cidade: string | null;
  check_in: string | null;
  check_out: string | null;
  extensao_id?: string | null;
  status?: string | null;
}

export interface BarraFaixa {
  chave: string;
  tipo: "hotel" | "voo";
  nome: string;
  checkIn: string;
  checkOut: string;
  /** Coluna inicial (1 = D1) e final EXCLUSIVA — direto pro grid-column "a / b". */
  colIni: number;
  colFim: number;
  /** Pista (0, 1, …) pra não sobrepor. */
  pista: number;
  extensao: boolean;
  quartos: number;
}

export interface FaixaViagem {
  dias: DiaFaixa[];
  barras: BarraFaixa[];
  /** Hotéis com datas (as barras do tipo hotel). */
  hoteis: number;
  pistas: number;
  /** Hotéis que existem nos quartos mas sem check-in/check-out (não dá pra desenhar). */
  semDatas: number;
}

export function montarFaixaViagem(o: { inicio: string | null; fim: string | null; hoje: string; quartos: readonly QuartoMin[] }): FaixaViagem {
  const inicio = iso(o.inicio);
  const fim = iso(o.fim) ?? inicio;
  if (!inicio || !fim) return { dias: [], barras: [], hoteis: 0, pistas: 0, semDatas: 0 };
  const total = Math.max(1, diasEntre(inicio, fim) + 1);
  const dias: DiaFaixa[] = Array.from({ length: total }, (_, i) => {
    const data = somarDias(inicio, i);
    return { n: i + 1, data, estado: data < o.hoje ? "passado" : data === o.hoje ? "hoje" : "futuro" };
  });
  const col = (data: string) => diasEntre(inicio, data) + 1; // pode cair fora (antes/depois)

  // Agrupa quartos ativos em hotéis.
  const grupos = new Map<string, { nome: string; ci: string | null; co: string | null; ext: boolean; n: number }>();
  for (const q of o.quartos) {
    if ((q.status ?? "").toLowerCase() === "cancelado") continue;
    const nome = (q.hotel_cidade ?? "").trim().replace(/\s+/g, " ") || "Hotel";
    const ci = iso(q.check_in), co = iso(q.check_out);
    const chave = `${nome}|${ci ?? ""}|${co ?? ""}|${q.extensao_id ?? ""}`;
    const g = grupos.get(chave);
    if (g) g.n++; else grupos.set(chave, { nome, ci, co, ext: !!q.extensao_id, n: 1 });
  }
  let semDatas = 0;
  const hoteis: Omit<BarraFaixa, "pista">[] = [];
  for (const [chave, g] of grupos) {
    if (!g.ci || !g.co) { semDatas++; continue; }
    const a = Math.max(1, col(g.ci));
    const b = Math.min(total, col(g.co));
    if (b < 1 || a > total || b < a) continue; // fora da viagem
    hoteis.push({ chave, tipo: "hotel", nome: g.nome, checkIn: g.ci, checkOut: g.co, colIni: a, colFim: b + 1, extensao: g.ext, quartos: g.n });
  }
  hoteis.sort((x, y) => x.colIni - y.colIni || x.colFim - y.colFim || x.nome.localeCompare(y.nome));

  // Dias sem hotel nenhum (do check-in ao check-out inclusive) → "Em voo / sem hotel".
  // Só quando a viagem tem algum hotel: sem hotel nenhum, a faixa fica só com os dias.
  const coberto = new Array<boolean>(total + 1).fill(false);
  for (const h of hoteis) for (let c = h.colIni; c < h.colFim; c++) coberto[c] = true;
  const voos: Omit<BarraFaixa, "pista">[] = [];
  if (hoteis.length) {
    let c = 1;
    while (c <= total) {
      if (coberto[c]) { c++; continue; }
      const ini = c;
      while (c <= total && !coberto[c]) c++;
      // Encosta no hotel seguinte (o dia da chegada), como no mockup.
      const fimExcl = Math.min(total + 1, c + (c <= total ? 1 : 0));
      voos.push({ chave: `voo|${ini}`, tipo: "voo", nome: "Em voo / sem hotel", checkIn: dias[ini - 1].data, checkOut: dias[Math.min(total, fimExcl - 1) - 1].data,
        colIni: ini, colFim: fimExcl, extensao: false, quartos: 0 });
    }
  }

  // Pistas: guloso por início; cada barra vai na primeira pista livre.
  const todas = [...hoteis, ...voos].sort((x, y) => x.colIni - y.colIni || x.colFim - y.colFim);
  const fimDaPista: number[] = [];
  const barras: BarraFaixa[] = todas.map((b) => {
    let p = fimDaPista.findIndex((f) => f <= b.colIni);
    if (p < 0) { p = fimDaPista.length; fimDaPista.push(0); }
    fimDaPista[p] = b.colFim;
    return { ...b, pista: p };
  });
  return { dias, barras, hoteis: hoteis.length, pistas: fimDaPista.length, semDatas };
}

/** Hotel da noite de `data` (check-in <= data < check-out); no último dia, o que faz check-out nele. */
export function hotelDoDia(barras: readonly BarraFaixa[], data: string): BarraFaixa | null {
  const h = barras.filter((b) => b.tipo === "hotel");
  return h.find((b) => b.checkIn <= data && data < b.checkOut) ?? h.find((b) => b.checkOut === data) ?? null;
}

// ── Dias do roteiro ──────────────────────────────────────────────────────────
export interface DiaPortalMin { dia: number | null; data: string | null; titulo: string | null; cidade: string | null }
export interface DiaLiderMin {
  id: string;
  dia: number | null;
  data: string | null;
  local: string | null;
  fase?: string | null;
  programacao: string | null;
  lideres_ativos: string | null;
  pax: string | null;
  alerta_nivel: string | null;
  alerta_texto: string | null;
  alerta_acao: string | null;
  alerta_responsavel: string | null;
}

export type NivelAlerta = "critico" | "atencao" | "verificar";
export function nivelDoAlerta(n: string | null | undefined): NivelAlerta | null {
  const t = (n ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t === "critico") return "critico";
  if (t === "atencao") return "atencao";
  if (t === "verificar") return "verificar";
  return null;
}
export const ROTULO_NIVEL: Record<NivelAlerta, string> = { critico: "Crítico", atencao: "Atenção", verificar: "Verificar" };

export interface DiaRoteiro {
  n: number;
  data: string | null;
  titulo: string;
  cidade: string | null;
  lideres: string | null;
  pax: string | null;
  alerta: { nivel: NivelAlerta; texto: string | null; acao: string | null; responsavel: string | null } | null;
}

/** Data de um dia sem data (D1 = embarque). */
const dataDoDia = (inicio: string | null, dia: number | null) => (inicio && dia && dia > 0 ? somarDias(inicio, dia - 1) : null);

/** Um dia por data (ou nº), juntando o roteiro do portal e o do líder. Ordenado. */
export function montarDiasRoteiro(o: { inicio: string | null; portal: readonly DiaPortalMin[]; lider: readonly DiaLiderMin[] }): DiaRoteiro[] {
  const inicio = iso(o.inicio);
  const m = new Map<string, DiaRoteiro>();
  const chave = (data: string | null, dia: number | null) => data ?? `#${dia ?? 0}`;
  const nDe = (data: string | null, dia: number | null) => (data && inicio ? diasEntre(inicio, data) + 1 : dia ?? 0);
  for (const d of o.portal) {
    const data = iso(d.data) ?? dataDoDia(inicio, d.dia);
    m.set(chave(data, d.dia), { n: nDe(data, d.dia), data, titulo: (d.titulo ?? "").trim(), cidade: d.cidade?.trim() || null, lideres: null, pax: null, alerta: null });
  }
  for (const d of o.lider) {
    const data = iso(d.data) ?? dataDoDia(inicio, d.dia);
    const k = chave(data, d.dia);
    const atual = m.get(k) ?? { n: nDe(data, d.dia), data, titulo: "", cidade: null, lideres: null, pax: null, alerta: null };
    const nivel = nivelDoAlerta(d.alerta_nivel);
    m.set(k, {
      ...atual,
      titulo: atual.titulo || primeiraLinha(d.programacao) || "",
      cidade: atual.cidade ?? (d.local?.trim() || null),
      lideres: d.lideres_ativos?.trim() || atual.lideres,
      pax: d.pax?.trim() || atual.pax,
      alerta: nivel ? { nivel, texto: d.alerta_texto?.trim() || null, acao: d.alerta_acao?.trim() || null, responsavel: d.alerta_responsavel?.trim() || null } : atual.alerta,
    });
  }
  return [...m.values()].sort((a, b) => (a.data ?? "9999").localeCompare(b.data ?? "9999") || a.n - b.n);
}

function primeiraLinha(s: string | null | undefined): string {
  const l = (s ?? "").split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? "";
  return l.length > 110 ? `${l.slice(0, 107)}…` : l;
}

/** Os próximos `n` dias DEPOIS de hoje que estão no roteiro. */
export function proximosDias(dias: readonly DiaRoteiro[], hoje: string, n = 2): DiaRoteiro[] {
  return dias.filter((d) => d.data && d.data > hoje).slice(0, n);
}

// ── Tag do dia no roteiro do líder (Logística) ───────────────────────────────
export type TagDia = { rotulo: "OK" | "Verificar" | "Atenção" | "Crítico" | "Hoje"; tom: "neutral" | "info" | "warn" | "danger" | "dark" };
export function tagDoDiaLider(d: { data: string | null; alerta_nivel: string | null }, hoje: string): TagDia {
  if (iso(d.data) === hoje) return { rotulo: "Hoje", tom: "dark" };
  const n = nivelDoAlerta(d.alerta_nivel);
  if (n === "critico") return { rotulo: "Crítico", tom: "danger" };
  if (n === "atencao") return { rotulo: "Atenção", tom: "warn" };
  if (n === "verificar") return { rotulo: "Verificar", tom: "warn" };
  return { rotulo: "OK", tom: "neutral" };
}

// ── Ações da operação ────────────────────────────────────────────────────────
export interface AcaoOperacao {
  id: string;
  dia: number | null;
  data: string | null;
  /** "Crítico" | "Atenção" | "Verificar" | "Sem baixa" (dia já passou). */
  tag: string;
  tom: "danger" | "warn" | "neutral";
  titulo: string;
  descricao: string | null;
  responsavel: string | null;
  passou: boolean;
}

/**
 * Ações abertas do roteiro do líder: todo dia com nível de alerta e texto/ação.
 * [SCHEMA] Ainda não existe baixa (resolvida_em) — então TODA ação de dia passado
 * aparece como "Sem baixa". Quando a migration entrar, passe `resolvida` e as
 * resolvidas somem daqui (ver docs/PROPOSTA-SCHEMA-EXPEDICOES.md §1).
 */
export function acoesDaOperacao(dias: readonly (DiaLiderMin & { resolvida?: boolean })[], hoje: string): AcaoOperacao[] {
  const peso = { danger: 0, warn: 1, neutral: 2 } as const;
  return dias
    .filter((d) => !d.resolvida && nivelDoAlerta(d.alerta_nivel) && (d.alerta_acao || d.alerta_texto))
    .map((d) => {
      const nivel = nivelDoAlerta(d.alerta_nivel)!;
      const data = iso(d.data);
      const passou = !!data && data < hoje;
      const tag = passou ? "Sem baixa" : ROTULO_NIVEL[nivel];
      const tom: AcaoOperacao["tom"] = passou ? "warn" : nivel === "critico" ? "danger" : nivel === "atencao" ? "warn" : "neutral";
      const principal = (d.alerta_acao || d.alerta_texto || "").trim();
      const resto = d.alerta_acao && d.alerta_texto ? d.alerta_texto.trim() : null;
      const titulo = [d.dia ? `Dia ${d.dia}` : null, data ? ddmm(data) : null, primeiraLinha(principal)].filter(Boolean).join(" · ");
      return { id: d.id, dia: d.dia, data, tag, tom, titulo, descricao: resto, responsavel: d.alerta_responsavel?.trim() || null, passou };
    })
    // Primeiro as que ainda vão acontecer (por severidade e data); depois as sem baixa (mais recentes antes).
    .sort((a, b) => Number(a.passou) - Number(b.passou)
      || (a.passou ? (b.data ?? "").localeCompare(a.data ?? "") : peso[a.tom] - peso[b.tom] || (a.data ?? "9999").localeCompare(b.data ?? "9999")));
}
