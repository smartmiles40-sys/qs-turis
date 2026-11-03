// src/propostas/disponivel.ts
// -----------------------------------------------------------------------------
// A CHAVE ÚNICA da geração de propostas pelo QS (Bruno, 03/11/2026):
//   "E se só pedirmos para anexar a proposta na hora da venda, e deixar 'Em
//    breve' nessa parte, pq quero pensar em uma forma de conseguirmos gerar
//    essas propostas por dentro do QS (de uma forma automática)."
//
// false = em todo o QS (Closer, SDR, Rel, Ops, Solicitações, ficha do negócio)
// o menu "Propostas" aparece com o selo "Em breve", "Nova proposta"/"Montar
// proposta" somem e a tela mostra o cartão explicativo. O que já existe segue
// de pé: as propostas já montadas abrem (formato antigo, sem modelos nem IA),
// e o link público (PropostaPublica + api/proposta.js) continua aprovando.
//
// Com false o front NÃO toca nas colunas da 0280 (modelo/conteudo) nem na
// tabela/bucket da 0290 (insumos da IA) — as duas podem continuar sem aplicar.
//
// PARA RELIGAR: aplicar 0280 e 0290, trocar para true aqui e ligar
// PROPOSTAS_IA_LIGADA=1 na Vercel (api/proposta-ia.js responde 503 sem ela).
// -----------------------------------------------------------------------------
export const PROPOSTAS_NO_QS = false;

/** O selo do item "Propostas" nos menus (undefined = sem selo). */
export const SELO_PROPOSTAS: string | undefined = PROPOSTAS_NO_QS ? undefined : "Em breve";

export const TEXTO_EM_BREVE =
  "Geração de propostas pelo QS em breve. Por enquanto, monte a proposta como de costume e anexe na hora de registrar a venda.";
