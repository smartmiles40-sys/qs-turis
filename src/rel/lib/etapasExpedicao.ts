// src/rel/lib/etapasExpedicao.ts
// -----------------------------------------------------------------------------
// CADÊNCIA DAS EXPEDIÇÕES (0417, 24/11/2026). Bruno: "uma rotina igual dos SDRs
// para o relacionamento… fazer check-in, revisar as coisas da expedição etc.".
// A esteira dos pacotes (etapas.ts) é por VIAGEM; a expedição é um GRUPO (uma
// viagem por pessoa), então aqui a etapa é do grupo inteiro:
//   Documentos D-90 → Revisão do grupo D-60 → D-30 → D-7 → D-3 → Check-in do
//   grupo → Em viagem → Retorno
// Etapa que venceu antes de a rotina começar (ZERADAS_ATE) não conta como
// atrasada — o time começa do dia de hoje pra frente.
// -----------------------------------------------------------------------------
import type { SituacaoEtapa } from "./etapas";

export type EtapaExpId = "documentos" | "revisao" | "d30" | "d7" | "d3" | "checkin" | "em_viagem" | "retorno";

export interface DefEtapaExp { id: EtapaExpId; nome: string; curto: string; cor: string; descricao: string; checklist: string[]; perguntaAlteracao?: boolean }

export const ETAPAS_EXP: DefEtapaExp[] = [
  { id: "documentos", nome: "Documentos do grupo", curto: "Documentos", cor: "#7C3AED",
    descricao: "90 dias antes: documentação de todo mundo em dia.",
    checklist: ["Passaporte de todos válido até 6 meses depois da volta", "Vistos e exigências de entrada de todos verificados", "Dados pessoais completos (CPF, nascimento, contato) de todos", "Seguro viagem de todos (pessoas e datas)"] },
  { id: "revisao", nome: "Revisão do grupo", curto: "Revisão", cor: "#2563EB",
    descricao: "60 dias antes: a lista do grupo bate com as vendas e com o que foi emitido.",
    checklist: ["Lista de passageiros = vendas da expedição", "Aéreo emitido para todos, nome no bilhete = passaporte", "Rooming list fechada (quem divide quarto com quem)", "Hotéis e receptivo confirmados com o fornecedor", "Restrições de alimentação, saúde e mobilidade anotadas"] },
  { id: "d30", nome: "Checagem D-30", curto: "D-30", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "30 dias antes: mudou alguma coisa nos voos, hotéis ou receptivo?",
    checklist: ["Voos do grupo conferidos no site/sistema da cia", "Hotéis e receptivo reconfirmados", "Grupo de WhatsApp da expedição com todo mundo dentro", "Encontro/reunião pré-viagem marcado"] },
  { id: "d7", nome: "Checagem D-7", curto: "D-7", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "7 dias antes: informações finais para o grupo.",
    checklist: ["Roteiro final, voos e contatos enviados no grupo", "Guia/receptivo com a lista final de passageiros", "Ponto de encontro no aeroporto combinado com todos"] },
  { id: "d3", nome: "Checagem D-3", curto: "D-3", cor: "#0E7C6A", perguntaAlteracao: true,
    descricao: "3 dias antes: última conferência antes do embarque.",
    checklist: ["Voos conferidos (horário, terminal)", "Transfer de chegada confirmado com o receptivo", "Grupo avisado de qualquer mudança"] },
  { id: "checkin", nome: "Check-in do grupo", curto: "Check-in", cor: "#B45309",
    descricao: "Check-in de todo o grupo nos voos de ida e cartões de embarque enviados.",
    checklist: ["Check-in de todo o grupo feito nos voos de ida", "Cartões de embarque enviados", "Mensagem de boa viagem no grupo"] },
  { id: "em_viagem", nome: "Em viagem", curto: "Em viagem", cor: "#0369A1",
    descricao: "Acompanhamento do grupo no destino.",
    checklist: ["Chegada do grupo ao destino confirmada", "Check-in dos voos internos e da volta feitos", "Acompanhamento com o guia (está tudo bem?)"] },
  { id: "retorno", nome: "Retorno", curto: "Retorno", cor: "#BE185D",
    descricao: "Grupo voltou: boas-vindas, pesquisa e próxima viagem.",
    checklist: ["Boas-vindas de volta no grupo", "Pesquisa de satisfação enviada", "Indicações e interesse em nova expedição registrados"] },
];
export const ETAPA_EXP = Object.fromEntries(ETAPAS_EXP.map((e) => [e.id, e])) as Record<EtapaExpId, DefEtapaExp>;

/** A rotina das expedições começou hoje: o que venceu antes não vira atrasada. */
export const ZERADAS_EXP_ATE = "2026-11-24";

export interface Expedicao { id: string; nome: string; codigo: string | null; status: string | null; data_embarque: string | null; data_retorno: string | null; pax: number }
export interface RegistroEtapaExp {
  expedicao_id: string; etapa: EtapaExpId; concluida_em: string | null; concluida_por: string | null;
  checklist: { item: string; feito: boolean }[]; houve_alteracao: boolean | null; alteracao: string | null; obs: string | null;
}
export interface EstadoEtapaExp { id: EtapaExpId; abre: string | null; prazo: string | null; situacao: SituacaoEtapa; registro: RegistroEtapaExp | null }

// puro (sem banco): o acesso ao banco fica em etapasExpedicaoBanco.ts
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const soma = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function janelas(e: Pick<Expedicao, "data_embarque" | "data_retorno">): Record<EtapaExpId, { abre: string | null; prazo: string | null }> {
  const ida = e.data_embarque, volta = e.data_retorno || e.data_embarque;
  const dx = (abre: number, prazo: number) => ({ abre: ida ? soma(ida, -abre) : null, prazo: ida ? soma(ida, -prazo) : null });
  return {
    documentos: dx(90, 75), revisao: dx(60, 45), d30: dx(30, 28), d7: dx(7, 5), d3: dx(3, 2),
    checkin: { abre: ida ? soma(ida, -2) : null, prazo: ida },
    em_viagem: { abre: ida, prazo: volta },
    retorno: { abre: volta, prazo: volta ? soma(volta, 3) : null },
  };
}

export function estadoDaExpedicao(e: Pick<Expedicao, "data_embarque" | "data_retorno">, registros: RegistroEtapaExp[], hoje = hojeSP()): { etapas: EstadoEtapaExp[]; atual: EstadoEtapaExp | null } {
  const j = janelas(e);
  const reg = new Map(registros.map((r) => [r.etapa, r]));
  const etapas = ETAPAS_EXP.map((d): EstadoEtapaExp => {
    const r = reg.get(d.id) ?? null;
    const { abre, prazo } = j[d.id];
    let situacao: SituacaoEtapa;
    if (r?.concluida_em) situacao = "feita";
    else if (!e.data_embarque) situacao = "nao_se_aplica";
    else if (prazo && prazo < ZERADAS_EXP_ATE) situacao = "zerada";
    else if (abre && abre > hoje) situacao = "aguardando";
    else if (prazo && prazo < hoje) situacao = "atrasada";
    else situacao = "a_fazer";
    return { id: d.id, abre, prazo, situacao, registro: r };
  });
  const atual = etapas.find((x) => x.situacao !== "feita" && x.situacao !== "nao_se_aplica" && x.situacao !== "zerada") ?? null;
  return { etapas, atual };
}
