// src/expedicoes/lista/central/linhas.ts
// Modelo de cada linha da Central de Expedições: fase, nome base + grupo,
// ocupação, prontidão e textos prontos. Sem React — as três visões (Por fase,
// Linha do tempo, Tabela), os indicadores e o Exportar leem daqui.
import { infoFase, type Fase, type InfoFase } from "../../lib/fase.ts";
import { nomeDaExpedicao } from "../../lib/nomeExpedicao.ts";
import type { ExpedicaoComAgregados } from "../../lib/database";

export interface LinhaExp {
  e: ExpedicaoComAgregados;
  base: string;
  grupo: string | null;
  inf: InfoFase;
  fase: Fase;
  cancelada: boolean;
  /** 0..1 confirmados (sem líderes) / vagas. */
  ocupacao: number;
  vagasLivres: number;
  /** 0..1 aptos / avaliados (null sem passageiros). */
  aptos: number | null;
}

export function montarLinha(e: ExpedicaoComAgregados, hoje: string): LinhaExp {
  const { base, grupo } = nomeDaExpedicao(e);
  const inf = infoFase(e.data_embarque, e.data_retorno, hoje);
  return {
    e, base, grupo, inf, fase: inf.fase,
    cancelada: e.status === "Cancelada",
    ocupacao: e.pax_planejados > 0 ? Math.min(1, e.pax_confirmados / e.pax_planejados) : 0,
    vagasLivres: Math.max(0, (e.pax_planejados ?? 0) - e.pax_confirmados),
    aptos: e.prontidao_total ? e.prontidao_aptos / e.prontidao_total : null,
  };
}

/** "26/10" */
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
/** "26/10/2026" */
export const ddmmaaaa = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
/** "26/10 → 12/11/2026" */
export const periodo = (l: LinhaExp) => `${ddmm(l.e.data_embarque)} → ${ddmmaaaa(l.e.data_retorno)}`;

/** Ordem por data de início (sem data por último), desempate pelo grupo. */
export function porInicio(a: LinhaExp, b: LinhaExp): number {
  return (a.e.data_embarque ?? "9999").localeCompare(b.e.data_embarque ?? "9999")
    || a.base.localeCompare(b.base, "pt-BR")
    || (a.grupo ?? "").localeCompare(b.grupo ?? "", undefined, { numeric: true });
}

/** Concluída há no máximo 12 meses (seção e indicador "Concluídas"). */
export function concluidaRecente(l: LinhaExp): boolean {
  return l.fase === "concluida" && l.inf.diasParaFim >= -365;
}

/** CSV simples (abre no Excel BR: ";" e BOM) das linhas visíveis. */
export function csvDasLinhas(linhas: LinhaExp[], rotuloFase: (f: Fase) => string): string {
  const cab = ["Código", "Expedição", "Grupo", "Destino", "Embarque", "Retorno", "Fase", "Status", "Confirmados", "Vagas", "Vagas livres", "Aptos", "Avaliados", "Resp. operacional", "Resp. comercial"];
  const cel = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhasCsv = linhas.map((l) => [
    l.e.codigo, l.base, l.grupo ?? "", l.e.destino, ddmmaaaa(l.e.data_embarque), ddmmaaaa(l.e.data_retorno),
    l.cancelada ? "Cancelada" : rotuloFase(l.fase), l.e.status, l.e.pax_confirmados, l.e.pax_planejados, l.vagasLivres,
    l.e.prontidao_aptos, l.e.prontidao_total, l.e.responsavel_op_nome ?? "", l.e.responsavel_com_nome ?? "",
  ].map(cel).join(";"));
  return String.fromCharCode(0xfeff) /* BOM pro Excel ler acentos */ + [cab.join(";"), ...linhasCsv].join("\r\n");
}

// Ordenação da visão Tabela (vai pra URL como ?ord=col:dir).
export type ColTabela = "ordem" | "nome" | "codigo" | "datas" | "fase" | "status" | "pax" | "aptos";
export interface Ordenacao { col: ColTabela; dir: "asc" | "desc" }
export const ORDENACAO_PADRAO: Ordenacao = { col: "datas", dir: "asc" };

export function lerOrdenacao(v: string | null): Ordenacao {
  const [col, dir] = (v ?? "").split(":");
  const cols: ColTabela[] = ["ordem", "nome", "codigo", "datas", "fase", "status", "pax", "aptos"];
  return cols.includes(col as ColTabela) ? { col: col as ColTabela, dir: dir === "desc" ? "desc" : "asc" } : ORDENACAO_PADRAO;
}
