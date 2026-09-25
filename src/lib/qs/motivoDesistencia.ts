// src/lib/qs/motivoDesistencia.ts
// -----------------------------------------------------------------------------
// A pergunta do motivo da DESISTÊNCIA — igual nas duas telas de desfecho (a
// Agenda do Dia e o detalhe da reunião), porque o desfecho não pode depender de
// por onde o closer entrou.
//
// Por que existe (22/09): a desistência passou a levar o card pra coluna
// Cancelamento/Desistência do Bitrix, que exige o campo "motivo da
// desistência". Antes o QS nem perguntava — e o card ficava onde estava.
// -----------------------------------------------------------------------------

/**
 * Pergunta o motivo e confirma a desistência numa pergunta só.
 * Devolve o motivo, ou `null` quando a pessoa desistiu de registrar.
 */
export function perguntarMotivoDesistencia(quem: string): string | null {
  let aviso = "";
  for (;;) {
    const resposta = window.prompt(
      `${aviso}Registrar DESISTÊNCIA de ${quem}?\n\n` +
      "O lead vai para PERDIDO e as atividades abertas dele são encerradas. No Bitrix, " +
      "o card vai para PERDIDOS — ou para Cancelamento/Desistência se o cliente já tinha " +
      "comprado (Em emissão, pagamento ou contrato).\n\n" +
      "Qual foi o motivo? (vai para o card)"
    );
    if (resposta === null) return null;
    const motivo = resposta.trim();
    if (motivo.length >= 3) return motivo.slice(0, 500);
    aviso = "⚠️ Escreva o motivo — sem ele a desistência não é registrada.\n\n";
  }
}
