// src/components/sdr/leads/ficha/regras.ts
// -----------------------------------------------------------------------------
// Regras PURAS da ficha do lead (redesenho de 03/11, variações SDR e Closer).
// Nada de banco nem de React aqui: só decidir o que mostrar a partir dos dados
// que a LeadDetailPage já carrega. Testes em tests/ficha-lead/regras.test.ts.
// -----------------------------------------------------------------------------

export type PapelDaFicha = "sdr" | "closer";

// ── Iniciais do avatar ────────────────────────────────────────────────────────
// Do full_name (first/last_name nunca chegam do Bitrix): primeira + última.
export function iniciaisDoNome(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const a = partes[0][0] ?? "";
  const b = partes.length > 1 ? partes[partes.length - 1][0] ?? "" : "";
  return (a + b).toUpperCase() || "?";
}

// ── Datas ─────────────────────────────────────────────────────────────────────
const DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Diferença em dias de CALENDÁRIO (local) entre `iso` e `agora`. */
export function diasDeCalendario(iso: string, agora: Date): number {
  return Math.round((inicioDoDia(new Date(iso)) - inicioDoDia(agora)) / DIA_MS);
}

export function mesmoDia(iso: string | null | undefined, agora: Date): boolean {
  return !!iso && diasDeCalendario(iso, agora) === 0;
}

/** "daqui a 2 dias", "amanhã", "hoje, daqui a 3 h", "há 5 dias"… */
export function dataRelativa(iso: string, agora: Date): string {
  const dias = diasDeCalendario(iso, agora);
  if (dias === 0) {
    const min = Math.round((new Date(iso).getTime() - agora.getTime()) / 60000);
    if (min > 0 && min < 60) return `hoje, daqui a ${min} min`;
    if (min >= 60) return `hoje, daqui a ${Math.round(min / 60)} h`;
    if (min <= 0 && min > -60) return min === 0 ? "agora" : `hoje, há ${-min} min`;
    return `hoje, há ${Math.round(-min / 60)} h`;
  }
  if (dias === 1) return "amanhã";
  if (dias === -1) return "ontem";
  if (dias > 1) return `daqui a ${dias} dias`;
  return `há ${-dias} dias`;
}

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const dois = (n: number) => String(n).padStart(2, "0");

/** "Quinta, 05/11 às 18:30" */
export function quandoPorExtenso(iso: string): string {
  const d = new Date(iso);
  return `${DIAS_SEMANA[d.getDay()]}, ${dois(d.getDate())}/${dois(d.getMonth() + 1)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** "Hoje, 12:37" · "Ontem, 09:10" · "28/10, 14:00" (ano só quando não é o atual). */
export function quandoCurto(iso: string, agora: Date): string {
  const d = new Date(iso);
  const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  const dias = diasDeCalendario(iso, agora);
  if (dias === 0) return `Hoje, ${hora}`;
  if (dias === -1) return `Ontem, ${hora}`;
  if (dias === 1) return `Amanhã, ${hora}`;
  const ano = d.getFullYear() !== agora.getFullYear() ? `/${d.getFullYear()}` : "";
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}${ano}, ${hora}`;
}

export function horaDe(iso: string): string {
  const d = new Date(iso);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

// ── Cadência ──────────────────────────────────────────────────────────────────
/**
 * Em que dia da cadência o lead está: dia 1 = o dia em que a cadência começou.
 * Sem início ou sem dias cadastrados → null (a ficha não inventa "Dia 1 de 1").
 * Passou do último dia → fica no último (a cadência acabou, não "Dia 9 de 5").
 */
export function diaDaCadencia(
  iniciadaEm: string | null | undefined,
  totalDeDias: number,
  agora: Date,
): { dia: number; total: number; acabou: boolean } | null {
  if (!iniciadaEm || totalDeDias <= 0) return null;
  const corrido = -diasDeCalendario(iniciadaEm, agora) + 1;
  const dia = Math.min(Math.max(corrido, 1), totalDeDias);
  return { dia, total: totalDeDias, acabou: corrido > totalDeDias };
}

// ── Tarefas e reuniões ────────────────────────────────────────────────────────
export interface TarefaMin {
  id: string;
  channel_type: string;
  status: string;
  scheduled_at: string;
  completed_at: string | null;
}
export interface ReuniaoMin {
  id: string;
  status: string;
  scheduled_at: string;
}

export const CANAIS_DE_LIGACAO = ["ligacao", "ligacao_whatsapp"];
export const ehLigacao = (canal: string) => CANAIS_DE_LIGACAO.includes(canal);
export const tarefaAberta = (t: Pick<TarefaMin, "status">) => t.status === "pendente" || t.status === "atrasada";
export const reuniaoAberta = (m: Pick<ReuniaoMin, "status">) => m.status === "agendada" || m.status === "confirmada";

/**
 * As "tarefas de hoje" do card da cadência: as abertas marcadas pra hoje, as
 * abertas ATRASADAS (ainda pedem ação) e as concluídas hoje. Ordem: horário.
 */
export function tarefasDeHoje<T extends TarefaMin>(tarefas: T[], agora: Date): (T & { atrasada: boolean })[] {
  const hoje = inicioDoDia(agora);
  return tarefas
    .filter((t) =>
      (tarefaAberta(t) && inicioDoDia(new Date(t.scheduled_at)) <= hoje) ||
      (t.status === "concluida" && mesmoDia(t.completed_at, agora)))
    .map((t) => ({ ...t, atrasada: tarefaAberta(t) && inicioDoDia(new Date(t.scheduled_at)) < hoje }))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
}

export type ProximoPasso<T, M> =
  | { tipo: "reuniao"; reuniao: M; quando: string }
  | { tipo: "tarefa"; tarefa: T; quando: string }
  | null;

/**
 * A faixa azul "Próximo passo". Closer: a reunião em aberto vem antes de tudo
 * (é o trabalho dele); sem reunião, a próxima atividade. SDR: o que vier
 * primeiro no relógio, reunião ou atividade (atrasada primeiro, claro).
 */
export function escolherProximoPasso<T extends TarefaMin, M extends ReuniaoMin>(
  papel: PapelDaFicha, tarefas: T[], reunioes: M[],
): ProximoPasso<T, M> {
  const porData = (a: { scheduled_at: string }, b: { scheduled_at: string }) =>
    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
  const r = reunioes.filter(reuniaoAberta).sort(porData)[0];
  const t = tarefas.filter(tarefaAberta).sort(porData)[0];
  if (papel === "closer" && r) return { tipo: "reuniao", reuniao: r, quando: r.scheduled_at };
  if (r && (!t || porData(r, t) <= 0)) return { tipo: "reuniao", reuniao: r, quando: r.scheduled_at };
  if (t) return { tipo: "tarefa", tarefa: t, quando: t.scheduled_at };
  return null;
}

// ── Linha do tempo (coluna "Atividade") ───────────────────────────────────────
export type TipoAtividade = "reuniao" | "ligacao" | "nota" | "sistema" | "tarefa";
export type FiltroAtividade = "tudo" | "reuniao" | "ligacao" | "nota" | "sistema";

/** O chip "Sistema" também mostra as tarefas concluídas que não são ligação. */
export function passaNoFiltro(filtro: FiltroAtividade, tipo: TipoAtividade): boolean {
  return filtro === "tudo" || filtro === tipo || (filtro === "sistema" && tipo === "tarefa");
}

export function textoDeVazio(filtro: FiltroAtividade): string {
  switch (filtro) {
    case "ligacao": return "Nenhuma ligação registrada ainda. As ligações feitas pelo webfone do QS aparecem aqui.";
    case "reuniao": return "Nenhuma reunião com este cliente ainda.";
    case "sistema": return "Nenhum evento do sistema ainda.";
    default: return "Nenhuma anotação ainda. Escreva a primeira aqui em cima.";
  }
}

// ── Venda (card do closer) ────────────────────────────────────────────────────
export type EstadoPasso = "feito" | "andamento" | "falta";
export interface PassoDaVenda { rotulo: "Reunião" | "Proposta" | "Contrato" | "Pagamento"; estado: EstadoPasso; detalhe: string }

/**
 * Reunião → Proposta → Contrato → Pagamento, com o que existe de verdade:
 *   · Reunião: alguma reunião realizada, ou o cartão já passou das etapas de espera;
 *   · Proposta: PDF/foto anexado na venda (as propostas do QS estão "Em breve");
 *   · Contrato: status do ZapSign no cartão (enviado/visualizado = andamento);
 *   · Pagamento: status do link no cartão (enviado/parcial = andamento).
 */
export function passosDaVenda(f: {
  reuniaoRealizada: boolean;
  etapa: string | null;
  propostasAnexadas: number;
  statusContrato: string | null;
  statusPagamento: string | null;
}): PassoDaVenda[] {
  const ESPERA = ["aguardando_reuniao", "reagendamento", "no_show"];
  const reuniao = f.reuniaoRealizada || (!!f.etapa && !ESPERA.includes(f.etapa));
  const c = f.statusContrato;
  const p = f.statusPagamento;
  return [
    { rotulo: "Reunião", estado: reuniao ? "feito" : "falta", detalhe: reuniao ? "Reunião feita" : "Reunião ainda não aconteceu" },
    { rotulo: "Proposta", estado: f.propostasAnexadas > 0 ? "feito" : "falta",
      detalhe: f.propostasAnexadas > 0 ? `${f.propostasAnexadas} proposta(s) anexada(s) na venda` : "Nenhuma proposta anexada na venda" },
    { rotulo: "Contrato", estado: c === "assinado" ? "feito" : c === "enviado" || c === "visualizado" ? "andamento" : "falta",
      detalhe: c === "assinado" ? "Contrato assinado" : c === "visualizado" ? "Contrato visualizado pelo cliente" : c === "enviado" ? "Contrato enviado" : c === "recusado" ? "Contrato recusado" : "Contrato não enviado" },
    { rotulo: "Pagamento", estado: p === "pago" ? "feito" : p === "enviado" || p === "parcial" ? "andamento" : "falta",
      detalhe: p === "pago" ? "Pago" : p === "parcial" ? "Pago em parte" : p === "enviado" ? "Link de pagamento enviado" : "Pagamento não enviado" },
  ];
}

// ── Notas "humanas" (Passagem do SDR) ─────────────────────────────────────────
/** Tira o eco automático ("Ligação — Caixa postal") e as notas de origem. Mesmo filtro do BriefingDoLead. */
export function notaHumana(n: { body: string; tags?: string[] | null }): boolean {
  if ((n.tags || []).includes("origem")) return false;
  return !/^(ligação|liga[çc]ao|whatsapp|e-?mail)\s*[—–-]\s*(caixa postal|não atendeu|nao atendeu|desligou|sem conex|número|numero)/i.test(n.body.trim());
}
