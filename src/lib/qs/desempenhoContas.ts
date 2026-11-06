// src/lib/qs/desempenhoContas.ts
// Contas PURAS do Desempenho SDR (sem Supabase) — testadas em tests/desempenho.
// Tipos do RPC qs_desempenho (0322) e as regras de leitura das telas.

export interface Reunioes {
  marcadas: number; rr: number; futuras: number; no_show: number; canceladas: number; sem_desfecho: number;
  reagendadas: number; sal_aceito: number; sal_recusado: number; inferidas: number;
  forcash_reunioes: number; forcash_sem_valor: number;
}
export interface FunilSdr {
  recebeu: number; trabalhou: number; falou: number; marcou: number; aconteceu: number;
  sla_medidos: number; sla_na_meta: number; sla_mediana_min: number | null;
}
export interface Cadencia {
  em_trabalho: number; leads_atrasados: number; mais_antiga_dias: number;
  faixas: { faixa: string; em_dia: number; atrasadas: number }[];
}
export interface Atividades { programadas: number; concluidas: number; atrasadas: number }
export interface Cotacoes {
  solicitadas: number; entregues: number; entregues_hoje: number; aprovadas: number; perdidas: number;
  vencidas: number; abertas: number; repassadas: number;
  sla_mediana_h: number | null; sla_p90_h: number | null;
  forcash_proprio: number; forcash_repassado: number;
}
export interface Produto {
  produto: string; marcadas: number; rr: number; no_show: number; sal_aceito: number; sal_recusado: number;
  inferidas: number; forcash: number;
}
export type Conversoes = Record<string, { leads: number; marcou: number }>;

export interface BlocoDesempenho {
  reunioes: Reunioes;
  reunioes_hoje: number;
  reunioes_hoje_confirmadas: number;
  funil: FunilSdr;
  cadencia: Cadencia;
  fim_cadencia: number;
  atividades: Atividades;
  sem_1o_contato: number;
  por_confirmar: number;
  desfechos_pendentes: number;
  cotacoes: Cotacoes;
  produtos: Produto[];
  fontes: Conversoes;
  temperaturas: Conversoes;
}
export interface LinhaSdr extends BlocoDesempenho { sdr_id: string; nome: string }

export interface Desempenho {
  de: string; ate: string; gestor: boolean; meta_sla_min: number; gerado_em: string;
  time: BlocoDesempenho;
  sdrs: LinhaSdr[];
  velocidade: { faixa: string; ordem: number; leads: number; marcou: number }[];
  cotacoes_perda: { motivo: string; n: number }[];
  cotacoes_closers: { nome: string; recebidas: number; aprovadas: number; valor: number }[];
  closers_pendentes: { nome: string; pendentes: number }[];
}


// ── Contas ───────────────────────────────────────────────────────────────────

export function tempoHumano(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const r = Math.round(min % 60);
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

export const taxa = (a: number, b: number): number | null => (b > 0 ? a / b : null);
export const pctTxt = (v: number | null, casas = 0): string =>
  v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(casas).replace(".", ",")}%`;
export const brl = (n: number): string =>
  n > 0 ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "R$ —";
export const horasTxt = (h: number | null): string => (h === null || h === undefined ? "—" : tempoHumano(Number(h) * 60));

/** Comparecimento = R.R ÷ as que já passaram (sem futuras e sem canceladas). */
export const comparecimento = (r: Reunioes) => taxa(r.rr, r.rr + r.no_show + r.sem_desfecho);
export const taxaReagendamento = (r: Reunioes) => taxa(r.reagendadas, r.marcadas);
export const taxaSal = (r: Reunioes) => taxa(r.sal_aceito, r.rr);

export const ETAPAS_FUNIL = [
  { id: "recebeu", rotulo: "Recebeu" },
  { id: "trabalhou", rotulo: "Trabalhou" },
  { id: "falou", rotulo: "Falou com o lead" },
  { id: "marcou", rotulo: "Marcou reunião" },
  { id: "aconteceu", rotulo: "Reunião aconteceu" },
] as const;
type EtapaFunil = (typeof ETAPAS_FUNIL)[number]["id"];

/** % de cada etapa sobre a anterior (a 1ª é 100%). */
export function passagens(f: FunilSdr): (number | null)[] {
  return ETAPAS_FUNIL.map((e, i) => (i === 0 ? (f.recebeu > 0 ? 1 : null) : taxa(f[e.id as EtapaFunil], f[ETAPAS_FUNIL[i - 1].id as EtapaFunil])));
}

/**
 * "Onde vaza": a etapa (a partir da 2ª) com o maior gap NEGATIVO de passagem
 * contra o time, em pontos percentuais. null se nenhuma está abaixo do time
 * ou se o SDR não tem volume pra comparar.
 */
export function ondeVaza(sdr: FunilSdr, time: FunilSdr): number | null {
  if (sdr.recebeu < 5) return null;
  const a = passagens(sdr), b = passagens(time);
  let pior: number | null = null, gap = 0;
  for (let i = 1; i < a.length; i++) {
    if (a[i] === null || b[i] === null) continue;
    const g = (a[i] as number) - (b[i] as number);
    if (g < gap) { gap = g; pior = i; }
  }
  return pior;
}

/**
 * Ponto de atenção do card do SDR: a métrica com maior gap negativo vs o time
 * (relativo). Frase curta, pronta pro card.
 */
export function pontoDeAtencao(s: BlocoDesempenho, time: BlocoDesempenho, nSdrs: number): string {
  const cands: { gap: number; txt: string }[] = [];
  const rel = (v: number | null, ref: number | null) => (v === null || ref === null || ref === 0 ? null : (v - ref) / ref);
  const push = (gap: number | null, txt: string) => { if (gap !== null && gap < -0.15) cands.push({ gap, txt }); };

  const conv = taxa(s.funil.marcou, s.funil.recebeu), convT = taxa(time.funil.marcou, time.funil.recebeu);
  push(rel(conv, convT), `Só ${pctTxt(conv, 1)} dos leads viram reunião (time ${pctTxt(convT, 1)}).`);
  const falou = taxa(s.funil.falou, s.funil.recebeu), falouT = taxa(time.funil.falou, time.funil.recebeu);
  push(rel(falou, falouT), `Fala com ${pctTxt(falou)} dos leads (time ${pctTxt(falouT)}).`);
  const marcaConversa = taxa(s.funil.marcou, s.funil.falou), marcaConversaT = taxa(time.funil.marcou, time.funil.falou);
  push(rel(marcaConversa, marcaConversaT), `Conversa vira reunião em ${pctTxt(marcaConversa)} (time ${pctTxt(marcaConversaT)}).`);
  const comp = comparecimento(s.reunioes), compT = comparecimento(time.reunioes);
  push(rel(comp, compT), `Só ${pctTxt(comp)} das reuniões aconteceram (time ${pctTxt(compT)}).`);
  const sal = taxaSal(s.reunioes), salT = taxaSal(time.reunioes);
  push(rel(sal, salT), `SAL em ${pctTxt(sal)} das R.R (time ${pctTxt(salT)}).`);
  const sla = s.funil.sla_mediana_min, slaT = time.funil.sla_mediana_min;
  if (sla !== null && slaT) push(-(sla - slaT) / slaT, `1º contato demora ${tempoHumano(sla)} (time ${tempoHumano(slaT)}).`);
  // Atrasadas: compara com a média por SDR.
  const mediaAtr = nSdrs > 0 ? time.atividades.atrasadas / nSdrs : 0;
  if (mediaAtr > 0 && s.atividades.atrasadas > mediaAtr * 1.3) {
    cands.push({ gap: -(s.atividades.atrasadas - mediaAtr) / mediaAtr, txt: `${s.atividades.atrasadas.toLocaleString("pt-BR")} atividades atrasadas.` });
  }
  cands.sort((a, b) => a.gap - b.gap);
  return cands[0]?.txt ?? "Sem ponto fora da curva contra o time.";
}

export const ROTULO_PRODUTO: Record<string, string> = { expedicao: "Expedição", aereo: "Aéreo", pacote: "Pacote", outros: "Outros" };
export const ROTULO_FONTE: Record<string, string> = { live: "Live", trafego: "Tráfego", organico: "Orgânico", outros: "Outros" };
export const ROTULO_TEMP: Record<string, string> = { quente: "Quente", morno: "Morno", frio: "Frio", sem: "Sem temperatura" };
export const ROTULO_MOTIVO: Record<string, string> = { preco: "Preço", datas: "Datas", desistiu: "Desistiu", comprou_fora: "Comprou fora", sem_retorno: "Sem retorno", outro: "Outro" };

/** Produtos da rota reunião, na ordem da tela, com zero onde não houve. */
export function produtosReuniao(ps: Produto[]): Produto[] {
  return ["expedicao", "pacote", "outros"].map((p) => ps.find((x) => x.produto === p) ?? {
    produto: p, marcadas: 0, rr: 0, no_show: 0, sal_aceito: 0, sal_recusado: 0, inferidas: 0, forcash: 0,
  });
}

export const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

const REU0: Reunioes = { marcadas: 0, rr: 0, futuras: 0, no_show: 0, canceladas: 0, sem_desfecho: 0, reagendadas: 0, sal_aceito: 0, sal_recusado: 0, inferidas: 0, forcash_reunioes: 0, forcash_sem_valor: 0 };
const FUN0: FunilSdr = { recebeu: 0, trabalhou: 0, falou: 0, marcou: 0, aconteceu: 0, sla_medidos: 0, sla_na_meta: 0, sla_mediana_min: null };
const CAD0: Cadencia = { em_trabalho: 0, leads_atrasados: 0, mais_antiga_dias: 0, faixas: [] };
const ATI0: Atividades = { programadas: 0, concluidas: 0, atrasadas: 0 };
const COT0: Cotacoes = { solicitadas: 0, entregues: 0, entregues_hoje: 0, aprovadas: 0, perdidas: 0, vencidas: 0, abertas: 0, repassadas: 0, sla_mediana_h: null, sla_p90_h: null, forcash_proprio: 0, forcash_repassado: 0 };

/** O banco devolve null onde o SDR não tem linha (ex.: nenhuma cotação). Aqui vira zero. */
export function normalizarBloco(b: Partial<BlocoDesempenho> | null | undefined): BlocoDesempenho {
  return {
    reunioes: { ...REU0, ...(b?.reunioes ?? {}) },
    reunioes_hoje: Number(b?.reunioes_hoje ?? 0),
    reunioes_hoje_confirmadas: Number(b?.reunioes_hoje_confirmadas ?? 0),
    funil: { ...FUN0, ...(b?.funil ?? {}) },
    cadencia: { ...CAD0, ...(b?.cadencia ?? {}) },
    fim_cadencia: Number(b?.fim_cadencia ?? 0),
    atividades: { ...ATI0, ...(b?.atividades ?? {}) },
    sem_1o_contato: Number(b?.sem_1o_contato ?? 0),
    por_confirmar: Number(b?.por_confirmar ?? 0),
    desfechos_pendentes: Number(b?.desfechos_pendentes ?? 0),
    cotacoes: { ...COT0, ...(b?.cotacoes ?? {}) },
    produtos: b?.produtos ?? [],
    fontes: b?.fontes ?? {},
    temperaturas: b?.temperaturas ?? {},
  };
}

export const duracaoTxt = (seg: number | null): string => {
  if (seg === null || seg === undefined) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min${s % 60 ? ` ${String(s % 60).padStart(2, "0")}s` : ""}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
