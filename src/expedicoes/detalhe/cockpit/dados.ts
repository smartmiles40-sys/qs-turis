// src/expedicoes/detalhe/cockpit/dados.ts
// -----------------------------------------------------------------------------
// Leitura do COCKPIT (redesign 29/10, spec §3). Uma ida só, compartilhada pela
// Visão geral e pelos badges das abas (pendências de Passageiros, "!" do
// Financeiro, nº de arquivos) — assim o badge e a matriz contam igual.
// SÓ LÊ. Nenhuma escrita aqui.
//
//   passageiros + quartos + alocações (+ grupos/extensões)  → rooming/dados.ts
//   requisitos (colunas da regra)                           → prontidão / matriz
//   roteiro_dias (portal) + roteiro_lider_dias               → Hoje, Próximos dias, Ações
//   checklist_itens (colunas mínimas)                        → Saúde (conta única) e prazos
//   arquivos da expedição (contagem)                         → badge de Arquivos
// -----------------------------------------------------------------------------
import { lerReqProntidao, lerTudo, supabase, type ReqProntidao } from "../../lib/banco";
import { avaliarProntidao, type ResultadoProntidao } from "../../lib/prontidao/regras";
import { carregarRooming, type DadosRooming } from "../../rooming/dados";
import { preencheuFormulario } from "../../passageiros/dados";
import type { Fase } from "../../lib/fase";
import { montarMatriz, type LinhaMatriz, type PaxMatriz } from "../../lib/cockpit/matriz";
import type { DiaPortalMin } from "../../lib/cockpit/viagem";
import type { AlocacaoQuartoRow, ExpedicaoRow, PassageiroRow, QuartoRow, RoteiroLiderDiaRow } from "../../lib/database";

export type CkCockpit = { id: string; status: string; prazo: string | null; parent_id: string | null; tarefa: string; etapa: string };

export interface ResumoCockpit {
  rooming: DadosRooming;
  requisitos: ReqProntidao[];
  diasPortal: DiaPortalMin[];
  diasLider: RoteiroLiderDiaRow[];
  checklist: CkCockpit[];
  /** Arquivos da expedição sem passageiro (o que o Drive da expedição lista). */
  arquivos: number;
}

export async function carregarResumoCockpit(exp: ExpedicaoRow): Promise<ResumoCockpit> {
  const pacote = exp.tipo === "pacote";
  const pRooming = carregarRooming(exp.id);
  const pReqs = pRooming.then((r) => lerReqProntidao(r.passageiros.filter((p) => p.status_reserva !== "Cancelado").map((p) => p.id)));
  const [rooming, requisitos, diasPortal, diasLider, checklist, arq] = await Promise.all([
    pRooming,
    pReqs,
    lerTudo<DiaPortalMin & { id: string }>("roteiro_dias", (q) => q.eq("expedicao_id", exp.id), "id, dia, data, titulo, cidade"),
    pacote ? Promise.resolve([] as RoteiroLiderDiaRow[]) : lerTudo<RoteiroLiderDiaRow>("roteiro_lider_dias", (q) => q.eq("expedicao_id", exp.id)),
    pacote ? Promise.resolve([] as CkCockpit[]) : lerTudo<CkCockpit>("checklist_itens", (q) => q.eq("expedicao_id", exp.id), "id, status, prazo, parent_id, tarefa, etapa"),
    supabase.from("arquivos").select("id", { count: "exact", head: true }).eq("expedicao_id", exp.id).is("passageiro_id", null),
  ]);
  return { rooming, requisitos, diasPortal, diasLider, checklist, arquivos: arq.count ?? 0 };
}

export function agruparReqs<R extends { passageiro_id: string }>(reqs: readonly R[]): Map<string, R[]> {
  const m = new Map<string, R[]>();
  for (const r of reqs) { const a = m.get(r.passageiro_id); if (a) a.push(r); else m.set(r.passageiro_id, [r]); }
  return m;
}

/** Prontidão dos não cancelados (mesma regra de sempre: lib/prontidao/regras.ts). */
export function prontidaoDosPax(exp: ExpedicaoRow, pax: readonly PassageiroRow[], reqs: readonly ReqProntidao[]): Map<string, ResultadoProntidao> {
  const porPax = agruparReqs(reqs);
  const out = new Map<string, ResultadoProntidao>();
  for (const p of pax) {
    if (p.status_reserva === "Cancelado") continue;
    out.set(p.id, avaliarProntidao({ passageiro: p, expedicao: exp, destino: exp.destino, requisitos: porPax.get(p.id) ?? [] }));
  }
  return out;
}

/**
 * Situação do quarto de cada passageiro: hotéis do grupo principal (sem extensão)
 * em que ele está alocado. Hotel de extensão só conta pra quem já está nele
 * (a contratação da extensão fica no Rooming). Null = expedição sem hotel.
 */
export function quartosDosPax(quartos: readonly QuartoRow[], alocacoes: readonly AlocacaoQuartoRow[]): (paxId: string) => PaxMatriz["quarto"] {
  const ativos = quartos.filter((q) => (q.status ?? "").toLowerCase() !== "cancelado");
  if (!ativos.length) return () => null;
  const chave = (q: QuartoRow) => `${(q.hotel_cidade ?? "").trim()}|${(q.check_in ?? "").slice(0, 10)}|${(q.check_out ?? "").slice(0, 10)}|${q.extensao_id ?? ""}`;
  const principais = [...new Set(ativos.filter((q) => !q.extensao_id).map(chave))];
  const porId = new Map(ativos.map((q) => [q.id, q]));
  const porPax = new Map<string, QuartoRow[]>();
  for (const a of alocacoes) {
    const q = porId.get(a.quarto_id);
    if (!q) continue;
    const l = porPax.get(a.passageiro_id);
    if (l) l.push(q); else porPax.set(a.passageiro_id, [q]);
  }
  return (paxId) => {
    const meus = (porPax.get(paxId) ?? []).sort((a, b) => (a.check_in ?? "").localeCompare(b.check_in ?? ""));
    const chaves = new Set(meus.map(chave));
    const completo = principais.every((k) => chaves.has(k));
    return { rotulo: meus[0] ? `Quarto ${meus[0].numero}` : null, completo: completo && meus.length > 0 };
  };
}

/** Linhas da matriz a partir do que já foi lido (cockpit ou aba Passageiros — mesma conta). */
export function linhasDaMatriz(o: {
  exp: ExpedicaoRow; fase: Fase; pax: readonly PassageiroRow[]; requisitos: readonly ReqProntidao[];
  quartos: readonly QuartoRow[]; alocacoes: readonly AlocacaoQuartoRow[]; prontidao?: Map<string, ResultadoProntidao>;
}): LinhaMatriz[] {
  const pront = o.prontidao ?? prontidaoDosPax(o.exp, o.pax, o.requisitos);
  const reqs = agruparReqs(o.requisitos);
  const quarto = quartosDosPax(o.quartos, o.alocacoes);
  const pax: PaxMatriz[] = o.pax.map((p) => ({
    id: p.id, nome: p.nome_completo, tipo: p.tipo, status_reserva: p.status_reserva,
    passaporte: p.passaporte, validade_passaporte: p.validade_passaporte,
    preencheu: preencheuFormulario(p), quarto: quarto(p.id),
    valor_contratado_brl: p.valor_contratado_brl, valor_pago_brl: p.valor_pago_brl,
    checagens: pront.get(p.id)?.checagens ?? [],
    requisitos: (reqs.get(p.id) ?? []).map((r) => ({ tipo: r.tipo, status: r.status, arquivo_id: r.arquivo_id })),
  }));
  return montarMatriz(pax, o.exp, o.fase);
}
