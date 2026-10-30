// src/expedicoes/lib/cockpit/saude.ts
// -----------------------------------------------------------------------------
// "SAÚDE DA EXPEDIÇÃO" (spec §3.3): 4 cartões — Ocupação, Seguro viagem,
// Financeiro e Checklist —, cada um com tag OK / Pendente / Atrasado / Sem dados
// e o destino do clique (aba + seção do cockpit). Pacote não tem checklist.
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------
import type { Fase } from "../fase.ts";
import type { ResumoChecklist } from "../checklistResumo.ts";
import type { AbaCockpit, SecaoCockpit } from "./rota.ts";
import type { LinhaMatriz } from "./matriz.ts";

export type TagSaude = "OK" | "Pendente" | "Atrasado" | "Sem dados";
export const TOM_TAG: Record<TagSaude, "ok" | "warn" | "danger"> = { OK: "ok", Pendente: "warn", Atrasado: "warn", "Sem dados": "danger" };

export interface CartaoSaude {
  id: "ocupacao" | "seguro" | "financeiro" | "checklist";
  rotulo: string;
  valor: string;
  sub: string;
  tag: TagSaude;
  /** 0..1 pra barrinha. */
  fracao: number;
  aba: AbaCockpit;
  secao?: SecaoCockpit;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (f: number) => `${Math.round(f * 100)}%`;

export function cartoesSaude(o: {
  fase: Fase;
  pacote: boolean;
  confirmados: number;
  planejados: number;
  linhas: readonly LinhaMatriz[];
  checklist: ResumoChecklist | null;
}): CartaoSaude[] {
  const out: CartaoSaude[] = [];

  // Ocupação (líderes não contam — mesma conta dos agregados).
  const { confirmados, planejados } = o;
  const cheia = planejados > 0 && confirmados >= planejados;
  out.push({
    id: "ocupacao", rotulo: "Ocupação", valor: `${confirmados}/${planejados || "—"}`,
    sub: `${planejados <= 0 ? "sem vagas planejadas" : cheia ? "esgotada" : `${planejados - confirmados} vaga${planejados - confirmados === 1 ? "" : "s"}`} · líderes não contam`,
    tag: planejados <= 0 ? "Sem dados" : cheia || o.fase === "em_viagem" || o.fase === "concluida" ? "OK" : "Pendente",
    fracao: planejados > 0 ? Math.min(1, confirmados / planejados) : 0, aba: "passageiros",
  });

  // Seguro: apólice = anexo do requisito Seguro.
  const seg = o.linhas.map((l) => l.celulas.seguro).filter((c) => c.aplica);
  const comApolice = seg.filter((c) => c.ok).length;
  out.push({
    id: "seguro", rotulo: "Seguro viagem", valor: `${comApolice}/${seg.length}`,
    sub: !seg.length ? "nenhum passageiro com seguro exigido" : comApolice === seg.length ? "todas as apólices anexadas" : `${seg.length - comApolice} sem apólice anexada no perfil`,
    tag: !seg.length ? "Sem dados" : comApolice === seg.length ? "OK" : "Pendente",
    fracao: seg.length ? comApolice / seg.length : 0, aba: "passageiros",
  });

  // Financeiro: valor vendido e quantos sem valor (líder/cortesia isentos).
  const pag = o.linhas.filter((l) => l.celulas.pagamento.aplica);
  const semValor = pag.filter((l) => l.celulas.pagamento.tom === "danger").length;
  const vendido = pag.reduce((s, l) => s + Number(l.pax.valor_contratado_brl || 0), 0);
  out.push({
    id: "financeiro", rotulo: "Financeiro", valor: brl(vendido),
    sub: !pag.length ? "sem pagantes" : semValor ? `${semValor} passageiro${semValor === 1 ? "" : "s"} sem valor lançado` : "todos com valor lançado",
    tag: !pag.length || semValor === pag.length ? "Sem dados" : semValor ? "Pendente" : "OK",
    fracao: pag.length ? (pag.length - semValor) / pag.length : 0, aba: "financeiro",
  });

  // Checklist (conta única — ../checklistResumo.ts).
  if (!o.pacote && o.checklist) {
    const c = o.checklist;
    out.push({
      id: "checklist", rotulo: "Checklist", valor: `${c.concluidas}/${c.total}`,
      sub: !c.total ? "checklist não gerado" : `${pct(c.pct)} das tarefas concluídas${c.atrasadas ? ` · ${c.atrasadas} atrasada${c.atrasadas === 1 ? "" : "s"}` : ""}`,
      tag: !c.total ? "Sem dados" : c.concluidas === c.total ? "OK" : c.atrasadas ? "Atrasado" : "Pendente",
      fracao: c.pct, aba: "checklist",
    });
  }
  return out;
}
