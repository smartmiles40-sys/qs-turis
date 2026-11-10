// api/_limiteAgendamento.js
// -----------------------------------------------------------------------------
// ATÉ ONDE DÁ PRA MARCAR (Bruno, 10/11/2026): "limitar a só 3 dias úteis a frente".
//
// Vale pra reunião com o closer E pra ligação com o SDR, em todas as portas
// (link público /agendar/, Glória, e — pela cópia em src/lib/qs/limiteAgendamento.ts
// — a Agenda, o Ganho da atividade e o reagendar dentro do QS).
//
// A conta: hoje + os próximos 3 dias de SEG a SEX (sábado e domingo não contam).
//   segunda → até quinta · quinta → até terça · sexta/sábado/domingo → até quarta.
// Feriado não entra na conta (o QS não tem tabela de feriados).
//
// MANTER IGUAL A src/lib/qs/limiteAgendamento.ts (o teste confere as duas).
// -----------------------------------------------------------------------------

export const DIAS_UTEIS_A_FRENTE = 3;

const TZ = 'America/Sao_Paulo';

/** 'YYYY-MM-DD' de hoje em São Paulo. */
function hojeEmSP(agora) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** O ÚLTIMO dia em que ainda dá pra marcar, 'YYYY-MM-DD' em São Paulo. */
export function ultimoDiaPermitido(agora = new Date(), diasUteis = DIAS_UTEIS_A_FRENTE) {
  const [a, m, d] = hojeEmSP(agora).split('-').map(Number);
  let t = Date.UTC(a, m - 1, d);
  let faltam = Math.max(0, Math.floor(diasUteis));
  while (faltam > 0) {
    t += 86_400_000;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) faltam--;
  }
  return new Date(t).toISOString().slice(0, 10);
}

/** A mais cedo de duas datas 'YYYY-MM-DD' (nulo = sem prazo). */
export function menorData(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

/** O instante cai DEPOIS do último dia permitido? */
export function depoisDoLimite(inicio, agora = new Date(), diasUteis = DIAS_UTEIS_A_FRENTE) {
  return hojeEmSP(inicio) > ultimoDiaPermitido(agora, diasUteis);
}

export const RECADO_LIMITE = `Só dá pra agendar até ${DIAS_UTEIS_A_FRENTE} dias úteis à frente.`;
