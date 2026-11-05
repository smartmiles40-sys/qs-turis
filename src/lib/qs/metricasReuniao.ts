// src/lib/qs/metricasReuniao.ts
// -----------------------------------------------------------------------------
// TAXAS DE REUNIÃO (Bruno, 05/11): remarcação, remarcação → no-show e
// desistência. Uma regra só, usada no painel do QS (e com o mesmo texto no
// Dashboard), pra os dois números nunca discordarem.
//
// Base = as reuniões que contam no indicador (sem retomada) e que valem como
// agendamento: a linha antiga de um reagendamento ('reagendada') e a cancelada
// ficam de fora — a remarcação cria uma linha NOVA com `reagendado_de`, e é
// ela que conta (mesma regra do card "Reuniões agendadas", 25/09).
//
//  * Taxa de remarcação = agendamentos que foram remarcados ÷ agendamentos.
//    "Remarcado" = a linha nasceu de um reagendamento (reagendado_de preenchido).
//  * Remarcação → no-show = das remarcadas que já têm desfecho, quantas
//    terminaram em no-show. (As que ainda vão acontecer não entram: não dá pra
//    dizer se o cliente vai sumir.)
//  * Taxa de desistência = desistências ÷ reuniões com desfecho
//    (realizada + no-show + desistência).
// -----------------------------------------------------------------------------

export interface ReuniaoParaTaxa {
  status: string;
  tipo?: string | null;
  reagendado_de?: string | null;
}

export interface TaxasReuniao {
  agendamentos: number;
  remarcados: number;
  /** % (0–100) ou null quando não há base. */
  taxaRemarcacao: number | null;
  remarcadosComDesfecho: number;
  remarcadosNoShow: number;
  taxaRemarcacaoNoShow: number | null;
  comDesfecho: number;
  desistencias: number;
  taxaDesistencia: number | null;
}

const DESFECHO = new Set(["realizada", "no_show", "desistencia"]);

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function taxasDeReuniao(reunioes: ReuniaoParaTaxa[]): TaxasReuniao {
  const base = reunioes.filter(
    (m) => (m.tipo ?? "primeira") !== "retomada" && m.status !== "cancelada" && m.status !== "reagendada",
  );
  const remarcadas = base.filter((m) => !!m.reagendado_de);
  const remarcadasDecididas = remarcadas.filter((m) => DESFECHO.has(m.status));
  const remarcadosNoShow = remarcadasDecididas.filter((m) => m.status === "no_show").length;
  const decididas = base.filter((m) => DESFECHO.has(m.status));
  const desistencias = decididas.filter((m) => m.status === "desistencia").length;

  return {
    agendamentos: base.length,
    remarcados: remarcadas.length,
    taxaRemarcacao: pct(remarcadas.length, base.length),
    remarcadosComDesfecho: remarcadasDecididas.length,
    remarcadosNoShow,
    taxaRemarcacaoNoShow: pct(remarcadosNoShow, remarcadasDecididas.length),
    comDesfecho: decididas.length,
    desistencias,
    taxaDesistencia: pct(desistencias, decididas.length),
  };
}
