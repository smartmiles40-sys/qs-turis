// src/rel/lib/etapas.ts
// -----------------------------------------------------------------------------
// ESTEIRA DO RELACIONAMENTO (0141, 16/10/2026) — o processo do time, do jeito
// que o Bruno descreveu:
//   1. Passagem de bastão — reunião Comercial × Relacionamento
//   2. Revisão — proposta × o que foi emitido, inclusive dados pessoais
//   3–5. Checagens D-30, D-7 e D-3 — mudou algo na passagem/reserva?
//   6. Check-in — o time faz o check-in de todos os voos
//   7. Em viagem — acompanhamento: onde está, próximo passo
//   8. Retorno — boas-vindas de volta, pesquisa, recompra
//
// Cada etapa tem quando ABRE, o PRAZO e um checklist. A etapa atual de uma
// viagem é a primeira não concluída que se aplica. D-30/D-7 não se aplicam
// quando a venda aconteceu depois da data da checagem.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { hojeSP, marcarRevisada, type Viagem } from "./viagens";

export type EtapaId = "passagem" | "revisao" | "d30" | "d7" | "d3" | "checkin" | "em_viagem" | "retorno";

export interface DefEtapa {
  id: EtapaId;
  nome: string;
  curto: string;
  cor: string;
  descricao: string;
  checklist: string[];
  /** checagens D-x perguntam se mudou algo na reserva */
  perguntaAlteracao?: boolean;
}

export const ETAPAS: DefEtapa[] = [
  { id: "passagem", nome: "Passagem de bastão", curto: "Bastão", cor: "#7C3AED",
    descricao: "Reunião entre Comercial e Relacionamento: o que foi vendido, prometido e combinado.",
    checklist: ["Reunião Comercial × Relacionamento feita", "Proposta e o que foi prometido ao cliente registrados", "Necessidades especiais anotadas (alimentação, saúde, mobilidade, datas especiais)", "Boas-vindas enviadas ao cliente pelo Relacionamento"] },
  { id: "revisao", nome: "Revisão da venda", curto: "Revisão", cor: "#2563EB",
    descricao: "Cruzar a proposta com o que foi emitido, inclusive dados pessoais.",
    checklist: ["Nome de cada passageiro no bilhete = passaporte (grafia completa)", "Datas e horários dos voos = proposta", "Hotéis conferidos (nomes, datas de entrada e saída, regime, quartos)", "Transfers e passeios conferidos (datas, horários, vouchers)", "Dados pessoais conferidos (nascimento, documento, validade do passaporte, contato)", "Seguro viagem conferido (pessoas e datas)", "Vistos e exigências de entrada do destino verificados"] },
  { id: "d30", nome: "Checagem D-30", curto: "D-30", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "30 dias antes: conferir se alguma coisa mudou na passagem e nas reservas.",
    checklist: ["Reservas aéreas conferidas no site/sistema da cia (horários, voos, assentos)", "Reservas de hotel confirmadas", "Documentos e vistos em dia"] },
  { id: "d7", nome: "Checagem D-7", curto: "D-7", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "7 dias antes: nova conferência e envio das informações finais.",
    checklist: ["Reservas aéreas conferidas de novo (horários e terminais)", "Transfers e passeios confirmados com os fornecedores", "Informações finais da viagem enviadas ao cliente (roteiro, voos, hotéis, contatos)"] },
  { id: "d3", nome: "Checagem D-3", curto: "D-3", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "3 dias antes: última conferência antes do embarque.",
    checklist: ["Voos conferidos (horário, terminal, portão se houver)", "Transfer de chegada confirmado (hora e ponto de encontro)", "Cliente avisado de qualquer mudança"] },
  { id: "checkin", nome: "Check-in", curto: "Check-in", cor: "#B45309",
    descricao: "O time faz o check-in de todos os voos e manda os cartões de embarque.",
    checklist: ["Check-in feito em todos os voos de ida", "Cartões de embarque enviados ao cliente", "Mensagem de boa viagem enviada"] },
  { id: "em_viagem", nome: "Em viagem", curto: "Em viagem", cor: "#0369A1",
    descricao: "Acompanhamento: onde o cliente está, próximo passo, check-ins dos voos internos e da volta.",
    checklist: ["Mensagem de chegada ao destino", "Check-in dos voos internos e da volta feitos", "Acompanhamento no meio da viagem (está tudo bem?)"] },
  { id: "retorno", nome: "Retorno", curto: "Retorno", cor: "#BE185D",
    descricao: "Cliente voltou: boas-vindas, pesquisa e próxima viagem.",
    checklist: ["Mensagem de boas-vindas de volta", "Pesquisa de satisfação enviada", "Oportunidade de recompra/indicação registrada"] },
];
export const ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e])) as Record<EtapaId, DefEtapa>;

export interface RegistroEtapa {
  viagem_id: string;
  etapa: EtapaId;
  concluida_em: string | null;
  concluida_por: string | null;
  checklist: { item: string; feito: boolean }[];
  houve_alteracao: boolean | null;
  alteracao: string | null;
  obs: string | null;
}

export type SituacaoEtapa = "feita" | "nao_se_aplica" | "aguardando" | "a_fazer" | "atrasada";

export interface EstadoEtapa { id: EtapaId; abre: string | null; prazo: string | null; situacao: SituacaoEtapa; registro: RegistroEtapa | null }

const soma = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const diasAte = (d: string | null, hoje = hojeSP()) => (d ? Math.round((new Date(`${d}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86400_000) : null);

/** Quando cada etapa abre e vence. */
function janelas(v: Pick<Viagem, "data_venda" | "data_embarque" | "data_retorno">): Record<EtapaId, { abre: string | null; prazo: string | null; aplica: boolean }> {
  const venda = v.data_venda, ida = v.data_embarque, volta = v.data_retorno || v.data_embarque;
  const base = venda || ida;
  const dX = (n: number) => ({ abre: ida ? soma(ida, -n) : null, prazo: ida ? soma(ida, -n + (n >= 7 ? 2 : 1)) : null, aplica: !ida || !venda || venda <= soma(ida, -n) });
  return {
    passagem: { abre: base, prazo: base ? soma(base, 2) : null, aplica: true },
    revisao: { abre: base, prazo: base ? soma(base, 5) : null, aplica: true },
    d30: dX(30),
    d7: dX(7),
    d3: { abre: ida ? soma(ida, -3) : null, prazo: ida ? soma(ida, -2) : null, aplica: true },
    checkin: { abre: ida ? soma(ida, -2) : null, prazo: ida, aplica: true },
    em_viagem: { abre: ida, prazo: volta, aplica: true },
    retorno: { abre: volta, prazo: volta ? soma(volta, 3) : null, aplica: true },
  };
}

/** O estado de todas as etapas de uma viagem + a etapa atual. */
export function estadoDaEsteira(v: Pick<Viagem, "data_venda" | "data_embarque" | "data_retorno">, registros: RegistroEtapa[], hoje = hojeSP()): { etapas: EstadoEtapa[]; atual: EstadoEtapa | null } {
  const j = janelas(v);
  const reg = new Map(registros.map((r) => [r.etapa, r]));
  const etapas = ETAPAS.map((e): EstadoEtapa => {
    const r = reg.get(e.id) ?? null;
    const { abre, prazo, aplica } = j[e.id];
    let situacao: SituacaoEtapa;
    if (r?.concluida_em) situacao = "feita";
    else if (!aplica) situacao = "nao_se_aplica";
    else if (abre && abre > hoje) situacao = "aguardando";
    else if (prazo && prazo < hoje) situacao = "atrasada";
    else situacao = "a_fazer";
    return { id: e.id, abre, prazo, situacao, registro: r };
  });
  const atual = etapas.find((e) => e.situacao !== "feita" && e.situacao !== "nao_se_aplica") ?? null;
  return { etapas, atual };
}

// ── banco ───────────────────────────────────────────────────────────────────

export async function etapasDe(ids: string[]): Promise<Map<string, RegistroEtapa[]>> {
  const m = new Map<string, RegistroEtapa[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("rel_viagem_etapas").select("*").in("viagem_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as RegistroEtapa[]) m.set(r.viagem_id, [...(m.get(r.viagem_id) ?? []), r]);
  }
  return m;
}

export async function concluirEtapa(p: {
  viagemId: string; etapa: EtapaId; userId: string; checklist: { item: string; feito: boolean }[];
  houveAlteracao?: boolean | null; alteracao?: string | null; obs?: string | null;
}) {
  const { error } = await supabase.from("rel_viagem_etapas").upsert({
    viagem_id: p.viagemId, etapa: p.etapa, concluida_em: new Date().toISOString(), concluida_por: p.userId || null,
    checklist: p.checklist, houve_alteracao: p.houveAlteracao ?? null, alteracao: p.alteracao?.trim() || null, obs: p.obs?.trim() || null,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "viagem_id,etapa" });
  if (error) throw error;
  // a revisão também acende o "REVISADO ✓" do painel
  if (p.etapa === "revisao") await marcarRevisada(p.viagemId, true, p.userId, p.obs ?? "");
}

export async function desfazerEtapa(viagemId: string, etapa: EtapaId, userId: string) {
  const { error } = await supabase.from("rel_viagem_etapas").update({ concluida_em: null, concluida_por: null, atualizado_em: new Date().toISOString() })
    .eq("viagem_id", viagemId).eq("etapa", etapa);
  if (error) throw error;
  if (etapa === "revisao") await marcarRevisada(viagemId, false, userId, "");
}
