// src/expedicoes/lib/agregados.ts
// Números das expedições (ocupação, prontidão, % do checklist) — mesma conta do
// app antigo (lib/data/expedicoes.ts → agregarExpedicoes / getProntidaoExpedicao),
// mas lendo só os requisitos dos passageiros envolvidos e paginando tudo.
import { avaliarProntidao, type ResultadoProntidao } from "./prontidao/regras";
import { lerExpedicao, lerTudo, listarPassageirosDe, listarRequisitosDe, listarUsuarios } from "./banco";
import type { ExpedicaoComAgregados, ExpedicaoRow, PassageiroRequisitoRow, PassageiroRow } from "./database";

export type ProntidaoPassageiro = { passageiro: PassageiroRow; requisitos: PassageiroRequisitoRow[]; resultado: ResultadoProntidao };

function agruparPorPax(reqs: PassageiroRequisitoRow[]) {
  const m = new Map<string, PassageiroRequisitoRow[]>();
  for (const r of reqs) {
    const arr = m.get(r.passageiro_id);
    if (arr) arr.push(r); else m.set(r.passageiro_id, [r]);
  }
  return m;
}

export async function agregarExpedicoes(rows: ExpedicaoRow[]): Promise<ExpedicaoComAgregados[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const [pax, checklist, usuarios] = await Promise.all([
    listarPassageirosDe(ids),
    lerTudo<{ id: string; expedicao_id: string; parent_id: string | null; status: string }>(
      "checklist_itens", (q) => q.in("expedicao_id", ids), "id, expedicao_id, parent_id, status"),
    listarUsuarios(),
  ]);
  const ativos = pax.filter((p) => p.status_reserva !== "Cancelado");
  const reqPorPax = agruparPorPax(await listarRequisitosDe(ativos.map((p) => p.id)));
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

/** Prontidão de todos os passageiros (não cancelados) de uma expedição. Líder e cortesia contam. */
export async function prontidaoDaExpedicao(exp: ExpedicaoRow, passageiros?: PassageiroRow[]): Promise<ProntidaoPassageiro[]> {
  const pax = (passageiros ?? await listarPassageirosDe([exp.id])).filter((p) => p.status_reserva !== "Cancelado");
  const porPax = agruparPorPax(await listarRequisitosDe(pax.map((p) => p.id)));
  return pax.map((passageiro) => {
    const requisitos = porPax.get(passageiro.id) ?? [];
    return { passageiro, requisitos, resultado: avaliarProntidao({ passageiro, expedicao: exp, destino: exp.destino, requisitos }) };
  });
}

export async function expedicaoComAgregados(id: string): Promise<ExpedicaoComAgregados | null> {
  const e = await lerExpedicao(id);
  if (!e) return null;
  return (await agregarExpedicoes([e]))[0];
}
