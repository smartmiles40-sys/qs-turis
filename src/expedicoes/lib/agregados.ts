// src/expedicoes/lib/agregados.ts
// Números das expedições (ocupação, prontidão, % do checklist) — mesma conta do
// app antigo (lib/data/expedicoes.ts → agregarExpedicoes / getProntidaoExpedicao),
// mas lendo só os requisitos dos passageiros envolvidos e paginando tudo.
//
// 22/10 (leveza): os números só precisam de 12 colunas dos passageiros e 9 dos
// requisitos (COLUNAS_*_PRONTIDAO em banco.ts) — antes vinha a linha inteira
// (55 colunas). Usuários vêm da leitura guardada (a mesma do ExpProvider), e o
// cabeçalho da expedição lê expedição + passageiros + checklist ao mesmo tempo.
import { avaliarProntidao, type ResultadoProntidao } from "./prontidao/regras";
import { lerExpedicao, lerPaxProntidao, lerReqProntidao, lerTudo, listarPassageirosDe, listarRequisitosDe, listarUsuarios, type PaxProntidao, type ReqProntidao } from "./banco";
import type { ExpedicaoComAgregados, ExpedicaoRow, PassageiroRequisitoRow, PassageiroRow, UsuarioRow } from "./database";

/** Passageiro + requisitos + resultado. Por padrão a linha inteira; as contas leves usam PaxProntidao/ReqProntidao. */
export type ProntidaoPassageiro<P = PassageiroRow, R = PassageiroRequisitoRow> = { passageiro: P; requisitos: R[]; resultado: ResultadoProntidao };

export function agruparPorPax<R extends { passageiro_id: string }>(reqs: R[]) {
  const m = new Map<string, R[]>();
  for (const r of reqs) {
    const arr = m.get(r.passageiro_id);
    if (arr) arr.push(r); else m.set(r.passageiro_id, [r]);
  }
  return m;
}

type CkMin = { id: string; expedicao_id: string; parent_id: string | null; status: string };
const lerChecklistMin = (ids: string[]) =>
  lerTudo<CkMin>("checklist_itens", (q) => q.in("expedicao_id", ids), "id, expedicao_id, parent_id, status");

/** Passageiros (leves) e, assim que chegam, os requisitos dos não cancelados. */
async function paxEReqs(ids: string[]) {
  const ativos = (await lerPaxProntidao(ids)).filter((p) => p.status_reserva !== "Cancelado");
  return { ativos, reqPorPax: agruparPorPax(await lerReqProntidao(ativos.map((p) => p.id))) };
}

function montar(rows: ExpedicaoRow[], ativos: PaxProntidao[], reqPorPax: Map<string, ReqProntidao[]>, checklist: CkMin[], usuarios: UsuarioRow[]): ExpedicaoComAgregados[] {
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  return rows.map((e) => {
    const paxDaExp = ativos.filter((p) => p.expedicao_id === e.id);
    const processos = checklist.filter((c) => c.expedicao_id === e.id && !c.parent_id);
    return {
      ...e,
      // Ocupação conta só pagantes/cortesias — líderes (equipe) ficam fora.
      pax_confirmados: paxDaExp.filter((p) => p.status_reserva === "Confirmado" && p.tipo !== "Líder").length,
      docs_pendentes: paxDaExp.filter((p) => !p.passaporte).length,
      prontidao_total: paxDaExp.length,
      prontidao_aptos: paxDaExp.filter((p) =>
        avaliarProntidao({ passageiro: p, expedicao: e, destino: e.destino, requisitos: reqPorPax.get(p.id) ?? [] }).prontidao === "Apto").length,
      checklist_pct: processos.length ? processos.filter((c) => c.status === "Concluído").length / processos.length : 0,
      responsavel_op_nome: e.responsavel_operacional_id ? nome.get(e.responsavel_operacional_id) ?? null : null,
      responsavel_com_nome: e.responsavel_comercial_id ? nome.get(e.responsavel_comercial_id) ?? null : null,
    };
  });
}

export async function agregarExpedicoes(rows: ExpedicaoRow[]): Promise<ExpedicaoComAgregados[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const [{ ativos, reqPorPax }, checklist, usuarios] = await Promise.all([paxEReqs(ids), lerChecklistMin(ids), listarUsuarios()]);
  return montar(rows, ativos, reqPorPax, checklist, usuarios);
}

/** Prontidão de todos os passageiros (não cancelados) de uma expedição. Líder e cortesia contam. */
export async function prontidaoDaExpedicao(exp: ExpedicaoRow, passageiros?: PassageiroRow[]): Promise<ProntidaoPassageiro[]> {
  const pax = (passageiros ?? await listarPassageirosDe([exp.id])).filter((p) => p.status_reserva !== "Cancelado");
  const porPax = agruparPorPax(await listarRequisitosDe(pax.map((p) => p.id)));
  return pax.map((passageiro) => {
    const requisitos = porPax.get(passageiro.id) ?? [];
    return { passageiro, requisitos, resultado: avaliarProntidao({ passageiro, expedicao: exp, destino: exp.destino, requisitos }) };
  });
}

/**
 * Mesma conta de `prontidaoDaExpedicao`, lendo só as colunas da regra. Devolve
 * também TODOS os passageiros lidos (inclusive cancelados), pra quem precisa contar.
 */
export async function prontidaoLeveDaExpedicao(exp: ExpedicaoRow): Promise<{ pax: PaxProntidao[]; pront: ProntidaoPassageiro<PaxProntidao, ReqProntidao>[] }> {
  const pax = await lerPaxProntidao([exp.id]);
  const ativos = pax.filter((p) => p.status_reserva !== "Cancelado");
  const porPax = agruparPorPax(await lerReqProntidao(ativos.map((p) => p.id)));
  return {
    pax,
    pront: ativos.map((passageiro) => {
      const requisitos = porPax.get(passageiro.id) ?? [];
      return { passageiro, requisitos, resultado: avaliarProntidao({ passageiro, expedicao: exp, destino: exp.destino, requisitos }) };
    }),
  };
}

/**
 * Cabeçalho de uma expedição. Roda a cada aviso do realtime, então: expedição,
 * passageiros (leves), checklist e usuários (guardados) saem JUNTOS — só os
 * requisitos esperam os ids dos passageiros. Antes eram 4 idas em fila.
 */
export async function expedicaoComAgregados(id: string): Promise<ExpedicaoComAgregados | null> {
  const [e, { ativos, reqPorPax }, checklist, usuarios] = await Promise.all([lerExpedicao(id), paxEReqs([id]), lerChecklistMin([id]), listarUsuarios()]);
  if (!e) return null;
  return montar([e], ativos, reqPorPax, checklist, usuarios)[0];
}
