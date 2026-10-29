// src/expedicoes/lib/alertas/dadosAlertas.ts
// -----------------------------------------------------------------------------
// Leituras extras do "Precisa de atenção" (Central, 29/10). A regra em si é pura
// (./expedicoes.ts); aqui só se busca o que os agregados não trazem:
//   • passageiros SEM VALOR — mesma conta da aba Valores (valores/dados.ts →
//     statusFin: contratado ≤ 0 e pago ≤ 0), só não cancelados. Líder e cortesia
//     ficam FORA aqui (são isentos; a aba Valores ainda os mostra como "Sem valor").
//   • ações do ROTEIRO DO LÍDER — `roteiro_lider_dias` com alerta_nivel. Não existe
//     baixa da ação no banco (proposta em docs/PROPOSTA-SCHEMA-EXPEDICOES.md),
//     então `baixada` vai null e a regra "dia passado sem baixa" fica desligada.
// Só lê as expedições que podem disparar essas regras (em viagem / embarque /
// preparação), em colunas mínimas.
// -----------------------------------------------------------------------------
import { lerPorIds } from "../banco";
import type { AcaoRoteiro } from "./expedicoes";

export interface ExtrasAlerta { pax_sem_valor: number; acoes_roteiro: AcaoRoteiro[] }

type PaxValor = { expedicao_id: string; tipo: string; status_reserva: string; valor_contratado_brl: number | null; valor_pago_brl: number | null };
type DiaLider = { expedicao_id: string; dia: number | null; data: string | null; programacao: string | null; alerta_nivel: string | null; alerta_texto: string | null; alerta_acao: string | null };

const NIVEL: Record<string, AcaoRoteiro["severidade"]> = { "Crítico": "critico", "Critico": "critico", "Atenção": "atencao", "Atencao": "atencao" };

export async function lerExtrasDosAlertas(ids: string[]): Promise<Map<string, ExtrasAlerta>> {
  const out = new Map<string, ExtrasAlerta>(ids.map((id) => [id, { pax_sem_valor: 0, acoes_roteiro: [] }]));
  if (!ids.length) return out;
  const [pax, dias] = await Promise.all([
    lerPorIds<PaxValor>("passageiros", "expedicao_id", ids, "id, expedicao_id, tipo, status_reserva, valor_contratado_brl, valor_pago_brl"),
    lerPorIds<DiaLider>("roteiro_lider_dias", "expedicao_id", ids, "id, expedicao_id, dia, data, programacao, alerta_nivel, alerta_texto, alerta_acao"),
  ]);
  for (const p of pax) {
    if (p.status_reserva === "Cancelado" || p.tipo === "Líder" || p.tipo === "Cortesia") continue;
    if (Number(p.valor_contratado_brl || 0) <= 0 && Number(p.valor_pago_brl || 0) <= 0) out.get(p.expedicao_id)!.pax_sem_valor++;
  }
  for (const d of dias) {
    if (!d.alerta_nivel) continue;
    const titulo = (d.alerta_acao || d.alerta_texto || d.programacao || "Ação do roteiro").trim();
    out.get(d.expedicao_id)?.acoes_roteiro.push({
      dia: d.dia, data: d.data, titulo: titulo.length > 90 ? `${titulo.slice(0, 87)}…` : titulo,
      severidade: NIVEL[d.alerta_nivel] ?? "ok",
      baixada: null, // [SCHEMA] sem campo de baixa hoje
    });
  }
  return out;
}
