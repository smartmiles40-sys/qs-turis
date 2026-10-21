// src/expedicoes/paginas/_globais/prontidaoGlobal.ts
// Prontidão de todas as expedições ativas + avisos operacionais + resumo de prazos.
// Mesma conta do app antigo (lib/data/expedicoes.ts → getProntidaoTodas,
// getAlertasOperacionais, getResumoProntidao, getResumoProcessos), mas lendo só as
// expedições em grupo ativas (pacotes ficam de fora, como lá) e paginando tudo
// (o antigo cortava checklist_itens em 1000 linhas sem avisar).
import { avaliarProntidao } from "../../lib/prontidao/regras";
import { avaliarAlerta, regraDoTipo, type SeveridadeAlerta } from "../../lib/alertas/regras";
import { lerPorIds, listarExpedicoes, listarPassageirosDe, listarRequisitosDe } from "../../lib/banco";
import { daysUntil } from "../../lib/utils";
import { faseAtualChecklist } from "../../lib/constants";
import type { ProntidaoPassageiro } from "../../lib/agregados";
import type { EtapaChecklist, ExpedicaoRow, PassageiroRequisitoRow, TipoRequisito } from "../../lib/database";

export const EXP_ATIVA = (s: string) => s !== "Concluída" && s !== "Cancelada";

export type ProntidaoAtivas = { expedicoes: ExpedicaoRow[]; porExpedicao: Map<string, ProntidaoPassageiro[]> };

/**
 * Expedições em grupo ativas (≠ Concluída/Cancelada) com a prontidão de cada
 * passageiro não cancelado. `soFuturas` = só as que ainda não embarcaram (é o que
 * os avisos usam — deixa a conta do menu mais leve).
 */
export async function carregarProntidaoAtivas(opcoes: { soFuturas?: boolean } = {}): Promise<ProntidaoAtivas> {
  let expedicoes = (await listarExpedicoes("expedicao")).filter((e) => EXP_ATIVA(e.status));
  if (opcoes.soFuturas) expedicoes = expedicoes.filter((e) => { const d = daysUntil(e.data_embarque); return d != null && d >= 0; });
  const porExpedicao = new Map<string, ProntidaoPassageiro[]>();
  if (expedicoes.length === 0) return { expedicoes, porExpedicao };
  const expById = new Map(expedicoes.map((e) => [e.id, e]));
  const pax = (await listarPassageirosDe(expedicoes.map((e) => e.id))).filter((p) => p.status_reserva !== "Cancelado" && p.expedicao_id);
  const reqs = await listarRequisitosDe(pax.map((p) => p.id));
  const reqPorPax = new Map<string, PassageiroRequisitoRow[]>();
  for (const r of reqs) { const a = reqPorPax.get(r.passageiro_id); if (a) a.push(r); else reqPorPax.set(r.passageiro_id, [r]); }
  for (const passageiro of pax) {
    const exp = expById.get(passageiro.expedicao_id!);
    if (!exp) continue;
    const requisitos = reqPorPax.get(passageiro.id) ?? [];
    const arr = porExpedicao.get(exp.id) ?? [];
    arr.push({ passageiro, requisitos, resultado: avaliarProntidao({ passageiro, expedicao: exp, destino: exp.destino, requisitos }) });
    porExpedicao.set(exp.id, arr);
  }
  return { expedicoes, porExpedicao };
}

export type AlertaOperacional = {
  expedicao_id: string;
  expedicao_nome: string;
  data_embarque: string;
  dias_ate_embarque: number;
  passageiro_id: string;
  passageiro_nome: string;
  tipo: TipoRequisito;
  severidade: SeveridadeAlerta;
  rotulo: string;
  detalhe: string;
};

/** Avisos: exigência pendente dentro da janela do tipo. Mais urgente primeiro; crítico antes de atenção. */
export function calcularAlertas({ expedicoes, porExpedicao }: ProntidaoAtivas): AlertaOperacional[] {
  const alertas: AlertaOperacional[] = [];
  for (const e of expedicoes) {
    if (!EXP_ATIVA(e.status)) continue;
    const dias = daysUntil(e.data_embarque);
    if (dias == null || dias < 0) continue;
    for (const { passageiro, resultado } of porExpedicao.get(e.id) ?? []) {
      for (const c of resultado.checagens) {
        const severidade = avaliarAlerta(c.tipo, c.semaforo, dias);
        if (!severidade) continue;
        alertas.push({
          expedicao_id: e.id, expedicao_nome: e.nome, data_embarque: e.data_embarque, dias_ate_embarque: dias,
          passageiro_id: passageiro.id, passageiro_nome: passageiro.nome_completo,
          tipo: c.tipo, severidade, rotulo: regraDoTipo(c.tipo)?.rotulo ?? c.tipo, detalhe: c.detalhe,
        });
      }
    }
  }
  alertas.sort((a, b) => a.dias_ate_embarque - b.dias_ate_embarque || (a.severidade === b.severidade ? 0 : a.severidade === "critico" ? -1 : 1));
  return alertas;
}

export type ResumoProntidaoExpedicao = {
  id: string; nome: string; data_embarque: string; status: string; diasAteEmbarque: number | null;
  total: number; aptos: number; atencao: number; bloqueados: number;
  /** Tipo de requisito que mais bloqueia nesta expedição. */
  topBloqueador: string | null;
};

export function resumoProntidao({ expedicoes, porExpedicao }: ProntidaoAtivas): ResumoProntidaoExpedicao[] {
  return expedicoes.map((e) => {
    const linhas = porExpedicao.get(e.id) ?? [];
    let aptos = 0, atencao = 0, bloqueados = 0;
    const porTipo = new Map<string, number>();
    for (const { resultado } of linhas) {
      if (resultado.prontidao === "Apto") aptos++; else if (resultado.prontidao === "Atenção") atencao++; else bloqueados++;
      for (const c of resultado.checagens) if (c.semaforo === "bloqueio") porTipo.set(c.tipo, (porTipo.get(c.tipo) ?? 0) + 1);
    }
    const topBloqueador = [...porTipo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { id: e.id, nome: e.nome, data_embarque: e.data_embarque, status: e.status, diasAteEmbarque: daysUntil(e.data_embarque), total: linhas.length, aptos, atencao, bloqueados, topBloqueador };
  });
}

export type ResumoProcessoExpedicao = {
  id: string; nome: string; data_embarque: string; status: string; faseAtual: EtapaChecklist | null;
  total: number; concluidos: number; atrasados: number; proximos7d: number; checklist_pct: number;
};

type CkLite = { id: string; expedicao_id: string; status: string; prazo: string | null; parent_id: string | null };

/** Prazos do checklist (só processos-pai): atrasados, próximos 7 dias, fase atual. */
export async function resumoProcessos(expedicoes: ExpedicaoRow[]): Promise<ResumoProcessoExpedicao[]> {
  if (expedicoes.length === 0) return [];
  const itens = await lerPorIds<CkLite>("checklist_itens", "expedicao_id", expedicoes.map((e) => e.id), "id, expedicao_id, status, prazo, parent_id");
  return expedicoes.map((e) => {
    const topo = itens.filter((i) => i.expedicao_id === e.id && !i.parent_id);
    let concluidos = 0, atrasados = 0, proximos7d = 0;
    for (const i of topo) {
      const ok = i.status === "Concluído";
      if (ok) concluidos++;
      const d = daysUntil(i.prazo);
      if (!ok && d != null) { if (d < 0) atrasados++; else if (d <= 7) proximos7d++; }
    }
    return {
      id: e.id, nome: e.nome, data_embarque: e.data_embarque, status: e.status, faseAtual: faseAtualChecklist(daysUntil(e.data_embarque)),
      total: topo.length, concluidos, atrasados, proximos7d, checklist_pct: topo.length ? concluidos / topo.length : 0,
    };
  });
}
