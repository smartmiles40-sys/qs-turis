// api/_waFalhas.js
// -----------------------------------------------------------------------------
// POR QUE A MENSAGEM NÃO FOI ENTREGUE (05/11/2026).
//
// A Meta manda o motivo junto do recibo "failed" (statuses[].errors). Até hoje
// o Comercial jogava fora e a tela chutava sempre "fora da janela de 24h": 42
// falhas em 7 dias, nenhuma refeita, porque ninguém sabia o que tinha havido.
// Aqui o código vira uma frase que o SDR entende e sabe o que fazer.
// -----------------------------------------------------------------------------

const MOTIVOS = {
  131047: 'Fora da janela de 24h: o cliente não escreveu nas últimas 24h. Mande um modelo aprovado.',
  470: 'Fora da janela de 24h: o cliente não escreveu nas últimas 24h. Mande um modelo aprovado.',
  131049: 'A Meta segurou a mensagem para não cansar o cliente (muitas mensagens de marketing para ele). Tente outro dia ou espere ele responder.',
  131050: 'O cliente bloqueou mensagens de marketing desta empresa.',
  131026: 'Este número não pode receber: não tem WhatsApp, está com app antigo ou não aceitou os termos novos.',
  131051: 'Tipo de mensagem não aceito pelo WhatsApp.',
  131052: 'Não deu para baixar o arquivo do cliente (grande demais ou expirado).',
  131053: 'Não deu para enviar o arquivo (formato ou tamanho não aceito).',
  131056: 'Muitas mensagens para o mesmo número em pouco tempo. Espere alguns minutos.',
  131048: 'A Meta limitou o número por suspeita de spam. Avise a gestão.',
  131042: 'Problema de pagamento na conta do WhatsApp. Avise a gestão.',
  131031: 'A conta do WhatsApp está bloqueada. Avise a gestão.',
  131045: 'O número do WhatsApp não está registrado direito. Avise a gestão.',
  130472: 'A Meta não entregou (o cliente está num teste da Meta que limita marketing).',
  132000: 'O modelo foi enviado com variáveis faltando ou a mais.',
  132001: 'O modelo não existe (ou não neste idioma).',
  132005: 'O texto do modelo ficou longo demais com as variáveis.',
  132007: 'O conteúdo do modelo fere a política da Meta.',
  132012: 'Variável do modelo em formato errado.',
  132015: 'O modelo está pausado pela Meta (pouca qualidade).',
  132016: 'O modelo foi desativado pela Meta.',
  368: 'A Meta bloqueou temporariamente o envio por violação de política.',
  131000: 'Erro da Meta ao entregar. Tente de novo em alguns minutos.',
};

/** statuses[].errors → frase curta (com o código no fim, pra quem for investigar). */
export function motivoDaFalha(errors) {
  const e = Array.isArray(errors) ? errors[0] : null;
  if (!e) return 'Não entregue (a Meta não disse o motivo).';
  const codigo = Number(e.code);
  const frase = MOTIVOS[codigo]
    || e.error_data?.details || e.message || e.title || 'Não entregue.';
  return `${frase} [${Number.isFinite(codigo) ? codigo : '?'}]`;
}

/** O recibo "failed" fala de um arquivo que o CLIENTE tentou mandar e não chegou? */
export function ehMidiaDoClienteQueNaoChegou(st) {
  const code = Number(st?.errors?.[0]?.code);
  return String(st?.status || '').toLowerCase() === 'failed' && code === 131052;
}
