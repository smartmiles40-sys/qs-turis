// src/lib/qs/limiteAgendamento.ts
// -----------------------------------------------------------------------------
// ATÉ ONDE DÁ PRA MARCAR (Bruno, 10/11/2026): "limitar a só 3 dias úteis a frente".
// Hoje + os próximos 3 dias de seg a sex (fim de semana não conta, feriado também
// não — o QS não tem tabela de feriados).
//   segunda → até quinta · quinta → até terça · sexta/sábado/domingo → até quarta.
//
// Vale pra reunião nova e pro reagendamento (createMeeting / reagendarReuniao),
// em todas as portas do QS. Registro retroativo (realizada / no-show) não passa
// por aqui. MANTER IGUAL A api/_limiteAgendamento.js (o teste confere as duas).
// -----------------------------------------------------------------------------

export const DIAS_UTEIS_A_FRENTE = 3;

const TZ = "America/Sao_Paulo";

function diaEmSP(quando: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(quando);
}

/** O ÚLTIMO dia em que ainda dá pra marcar, 'YYYY-MM-DD' em São Paulo. */
export function ultimoDiaPermitido(agora: Date = new Date(), diasUteis = DIAS_UTEIS_A_FRENTE): string {
  const [a, m, d] = diaEmSP(agora).split("-").map(Number);
  let t = Date.UTC(a, m - 1, d);
  let faltam = Math.max(0, Math.floor(diasUteis));
  while (faltam > 0) {
    t += 86_400_000;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) faltam--;
  }
  return new Date(t).toISOString().slice(0, 10);
}

/** O instante cai DEPOIS do último dia permitido? */
export function depoisDoLimite(inicio: Date, agora: Date = new Date(), diasUteis = DIAS_UTEIS_A_FRENTE): boolean {
  return diaEmSP(inicio) > ultimoDiaPermitido(agora, diasUteis);
}

/** O dia (meia-noite local) passou do limite? Pra régua de dias do seletor. */
export function diaForaDoLimite(dia: Date, agora: Date = new Date()): boolean {
  const ymd = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
  return ymd > ultimoDiaPermitido(agora);
}

/** "qui, 13/11" — pro recado. */
export function rotuloDoLimite(agora: Date = new Date()): string {
  const [a, m, d] = ultimoDiaPermitido(agora).split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d, 12));
  const dia = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][dt.getUTCDay()];
  return `${dia}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function recadoDoLimite(agora: Date = new Date()): string {
  return `Só dá pra agendar até ${DIAS_UTEIS_A_FRENTE} dias úteis à frente (até ${rotuloDoLimite(agora)}).`;
}
