// src/expedicoes/lib/saudePipeline.ts
// -----------------------------------------------------------------------------
// PIPELINE DA SAÚDE (Bruno, 03/11: "somente a parte de saúde que realmente fica um
// pipeline, que é o que tem maior prioridade"). Cada caso de saúde cai numa coluna
// — só com dados que já existem, nada de status novo no banco:
//
//   1. Inscrição com alerta   inscricoes_pendentes 'pendente' com alguma resposta
//                             de saúde "Sim" (a vacina não conta) — ainda não é
//                             passageiro; a decisão é na aba Passageiros da viagem
//   2. Declarou alerta        passageiros.saude clínico "Sim" (ou condicoes_medicas)
//                             sem laudo, ou laudo 'a_fazer' (cad_laudos_medicos, 0225)
//   3. Laudo em andamento     laudo 'em_andamento'
//   4. Receita a enviar       laudo emitido/dispensado (ou sem caso clínico) e
//                             passageiros.receita_pendente sem receita_enviada_em (0223)
//   5. Liberado               laudo emitido (apto / com ressalvas) ou dispensado, sem
//                             receita pendente
//   6. Não apto               laudo emitido com apto = 'nao'
//
// Ordem dos cartões: quem embarca antes em cima. Lógica PURA (sem "@/") — node:test.
// -----------------------------------------------------------------------------
import { PERGUNTAS_SAUDE } from "./saude.ts";

export type EtapaSaude = "inscricao" | "declarou" | "andamento" | "receita" | "liberado" | "nao_apto";

export const ETAPAS_SAUDE: { id: EtapaSaude; rotulo: string; dica: string; tom: "aviso" | "erro" | "ok" | "neutro" | "lista" }[] = [
  { id: "inscricao", rotulo: "Inscrição com alerta", dica: "Respondeu \"Sim\" na saúde e a inscrição ainda espera aprovação", tom: "neutro" },
  { id: "declarou", rotulo: "Declarou alerta", dica: "Passageiro com alerta clínico e o laudo ainda não começou", tom: "erro" },
  { id: "andamento", rotulo: "Laudo em andamento", dica: "O médico está cuidando (exames, conversa, anotações)", tom: "aviso" },
  { id: "receita", rotulo: "Receita a enviar", dica: "Marcado \"preciso emitir e enviar a receita\" e ainda não foi enviada", tom: "lista" },
  { id: "liberado", rotulo: "Liberado", dica: "Laudo emitido (apto ou com ressalvas) ou dispensado", tom: "ok" },
  { id: "nao_apto", rotulo: "Não apto", dica: "O médico emitiu o laudo como não apto a viajar", tom: "erro" },
];

export interface EntradaEtapa {
  /** quantos itens clínicos o passageiro declarou */
  clinicos: number;
  laudo: { status: "a_fazer" | "em_andamento" | "emitido" | "dispensado"; apto: "sim" | "nao" | "ressalvas" | null } | null;
  receitaPendente?: boolean | null;
  receitaEnviadaEm?: string | null;
}

/** Em que coluna o passageiro está. null = não é caso de saúde (só alimentar, ou nada). */
export function etapaSaude(c: EntradaEtapa): Exclude<EtapaSaude, "inscricao"> | null {
  const receitaAberta = !!c.receitaPendente && !c.receitaEnviadaEm;
  const st = c.laudo?.status ?? "a_fazer";
  if (st === "em_andamento") return "andamento";
  if (st === "emitido" && c.laudo?.apto === "nao") return "nao_apto";
  if (st === "emitido" || st === "dispensado") return receitaAberta ? "receita" : "liberado";
  // sem laudo / a fazer
  if (c.clinicos > 0) return "declarou";
  return receitaAberta ? "receita" : null;
}

/** Inscrição do formulário com alguma resposta de saúde "Sim" (a vacina de febre amarela não conta). */
export function inscricaoTemAlertaSaude(dados: unknown): boolean {
  const d = (dados && typeof dados === "object" ? dados : {}) as { saude?: unknown };
  const s = (d.saude && typeof d.saude === "object" ? d.saude : {}) as Record<string, unknown>;
  return PERGUNTAS_SAUDE.some((q) => q.campo !== "vacina_febre_amarela" && s[q.campo] === "Sim");
}

export interface CartaoPipeline<T> {
  etapa: EtapaSaude;
  /** dias até o embarque (null = sem data) */
  dias: number | null;
  nome: string;
  item: T;
}

/** Monta as colunas na ordem de ETAPAS_SAUDE, cada uma com quem embarca antes em cima. */
export function montarPipeline<T>(cartoes: CartaoPipeline<T>[]): Record<EtapaSaude, CartaoPipeline<T>[]> {
  const out = Object.fromEntries(ETAPAS_SAUDE.map((e) => [e.id, [] as CartaoPipeline<T>[]])) as Record<EtapaSaude, CartaoPipeline<T>[]>;
  for (const c of cartoes) out[c.etapa].push(c);
  for (const e of ETAPAS_SAUDE) {
    out[e.id].sort((a, b) => (a.dias ?? 99999) - (b.dias ?? 99999) || a.nome.localeCompare(b.nome, "pt-BR"));
  }
  return out;
}
