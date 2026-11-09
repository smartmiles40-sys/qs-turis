// src/mkt/trafego/tipos.ts — o que a /api/mkt-trafego devolve (0265).
// As contas são todas do servidor (api/_mktTrafegoCalc.js); a tela só mostra.

export type Metrica =
  | "verba_pct" | "gasto_periodo" | "gasto_dia" | "cpl"
  | "custo_agendamento" | "custo_reuniao" | "cac" | "sem_lead";
export type Escopo = "periodo" | "destino" | "campanha";
export type Situacao = "ok" | "alerta" | "disparou" | "amostra_pequena" | "sem_dado" | "desligada";

export interface Cota { tipo: "destino" | "campanha"; alvo: string; rotulo: string; valor: number }

export interface Periodo {
  id: string; nome: string; inicio: string; fim: string; valor: number; cotas: Cota[]; ativo: boolean;
  criado_por: string | null; criado_em: string;
}

export interface Verba {
  hoje: string; diasTotais: number; diasRestantes: number; pctTempo: number; pctVerba: number;
  gasto: number; gastoHoje: number; saldo: number; ritmoIdeal: number; acimaDoRitmo: number;
  mediaDiaria: number; projecao: number; sobraOuFaltaNaProjecao: number; acabaNoDia: string | null;
  diariaSegura: number; orcamentoDiario: number; programado: number; estouroProgramado: number; estouraNoDia: string | null;
}

export interface LinhaFunil {
  gasto: number; leadsMeta: number; impressoes: number; cliques: number; leads: number; agendamentos: number;
  realizadas: number; vendas: number; faturamento: number; cpl: number | null; custoAgendamento: number | null;
  custoReuniao: number | null; cac: number | null; roas: number | null;
}
export interface GrupoDestino extends LinhaFunil {
  chave: string; destino: string; canal: string; rotulo: string; campanhas: string[]; gastoRateado: number;
}
export interface CampanhaFunil {
  id: string; nome: string; destino: string | null; destinoRotulo: string; tipo: string; effective_status: string | null;
  gasto: number; leadsMeta: number; impressoes: number; cliques: number; cplMeta: number | null; qs: LinhaFunil | null;
}
export interface Funil {
  porDestino: GrupoDestino[];
  porCampanha: CampanhaFunil[];
  total: LinhaFunil;
  semCasar: {
    gastoSemDestino: number; pctGastoCasado: number | null; gastoRateado: number;
    campanhasSemDestino: { id: string; nome: string; gasto: number; motivo?: string }[];
    leadsSemCampanha: { rotulo: string; leads: number }[];
    leadsPagos: number; leadsComUtm: number;
  };
}

export interface Campanha {
  id: string; nome: string; status: string | null; effective_status: string | null;
  destino: string | null; destino_auto: string | null; destino_manual: string | null; destinoRotulo: string; tipo: string | null;
  daily_budget: number | null; lifetime_budget: number | null; orcamentoDiario: number;
  gasto: number; gastoHoje: number; leadsMeta: number; liberada_ate: string | null; vista_em: string;
}

export interface Avaliacao { situacao: Situacao; valor: number | null; infinito?: boolean; limite: number; texto: string }
export interface Regra {
  id: string; nome: string; ativa: boolean; periodo_id: string | null; escopo: Escopo; alvo: string | null; alvo_rotulo: string | null;
  metrica: Metrica; limite: number; gasto_minimo: number; horas: number | null; acao: "avisar" | "pausar";
  criado_por: string | null; atualizado_por: string | null; atualizado_em: string;
  avaliacao: Avaliacao; alvosAtivos: { id: string; nome: string }[]; acaoAgora: "nada" | "avisar" | "pausar" | "pausaria";
}

export interface Acao {
  id: number; criado_em: string; tipo: "aviso" | "pausa" | "pausaria" | "reativacao" | "erro" | "alerta";
  regra_id: string | null; regra_nome: string | null; alvo_tipo: string | null; alvo_id: string | null; alvo_nome: string | null;
  metrica: string | null; valor_medido: number | null; limite: number | null;
  antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; quem: string | null; detalhe: string | null;
}

export interface Painel {
  configurado: boolean; falta: string[]; faltaBanco: boolean; pausaLigada: boolean; podeEditar?: boolean; hoje?: string;
  estado?: { ultima_sync_ok: string | null; ultima_tentativa: string | null; ultimo_erro: string | null; ultima_avaliacao: string | null; conta_nome: string | null; resumo: Record<string, unknown> } | null;
  periodos?: Periodo[]; periodo?: Periodo | null; config?: { avisar_ids: string[] };
  metricas?: Record<Metrica, { rotulo: string; unidade: string }>;
  semDado?: boolean; acoes?: Acao[]; destinos?: { chave: string; rotulo: string }[];
  funil?: Funil; campanhas?: Campanha[]; orcamento?: { diario: number; vitalicias: number };
  verba?: Verba; cotas?: (Cota & { verba: Verba })[]; regras?: Regra[];
  alertas?: { chave: string; tom: "erro" | "aviso"; texto: string }[];
}

export const NOME_METRICA: Record<Metrica, string> = {
  verba_pct: "% da verba gasta",
  gasto_periodo: "Gasto no período",
  gasto_dia: "Gasto de hoje",
  cpl: "Custo por lead (CPL)",
  custo_agendamento: "Custo por agendamento",
  custo_reuniao: "Custo por reunião realizada",
  cac: "CAC (custo por venda)",
  sem_lead: "Gastou sem nenhum lead",
};
