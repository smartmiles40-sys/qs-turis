// api/_vazamento.js
// -----------------------------------------------------------------------------
// A TRAVA DE VAZAMENTO — o que o modelo pensa NUNCA chega no cliente.
//
// ── O QUE ACONTECEU, COM HORA ───────────────────────────────────────────────
//
// 25/08, 21:45:32, lead 0b6319e1, `status: sent` — ou seja, o cliente recebeu:
//
//   "Ele vai te chamar por aqui em breve pra alinhar tudo, segurança pro seu
//    filho, datas e orçamento
//    Ok.
//    We need to produce a reply continuing conversation — but in this scenario,
//    we already transferred to human and must follow "Assim que
//    transferir_para_humano responder ok, escreva no máximo uma mensagem curta
//    dizendo que o especialista assume daqui, e pare." The assistant's final
//    message seems compliant [...] The assistant should not continue."
//
// Três coisas vazaram de uma vez: o texto LITERAL do prompt, em inglês, e o
// fato de a Glória ser um modelo seguindo roteiro. Num lead de verdade isso não
// é constrangimento, é o fim da conversa — e do lead.
//
// ── POR QUE AQUI, E NÃO NUM IF DO n8n ───────────────────────────────────────
//
// Pelo mesmo motivo que o MODO_TESTE mora nesta rota: quem escreve o texto é o
// MODELO, no meio do raciocínio dele, e desvio de workflow não segura o que o
// modelo decide escrever. A trava tem que estar em quem EXECUTA o envio. Esta
// rota é o último ponto por onde toda palavra passa antes de virar WhatsApp.
//
// ── COMO ELA DECIDE ─────────────────────────────────────────────────────────
//
// Precisão acima de cobertura. Um falso positivo aqui engole uma resposta boa e
// joga um lead na fila de um humano sem necessidade — então nada de "detector
// de inglês", que quebraria em "Showw", "Ok" e "hahah", que são justamente o
// jeito da casa de escrever.
//
// Só sinais que NÃO têm como aparecer numa mensagem legítima de WhatsApp:
//
//   1. Nomes internos. `transferir_para_humano`, `$json`, `lead_id`. Se um
//      desses aparece no texto do cliente, já deu errado, não importa o resto.
//   2. Meta-discurso em inglês sobre si mesma. "we need to", "the assistant",
//      "the user", "final message". A conversa inteira é em pt-BR com um cliente
//      brasileiro; isso é raciocínio, não atendimento.
//   3. Artefatos de máquina. Cerca de código, chaves duplas de template.
//   4. Confissão de instrução. "minhas instruções", "meu prompt".
//
// NÃO entram na lista, de propósito: "assistente" (ela se apresenta assim),
// "IA"/"robô" (o prompt manda ASSUMIR quando perguntam) e "Ok" solto.
//
// ── O QUE ACONTECE QUANDO PEGA ──────────────────────────────────────────────
//
// A RODADA INTEIRA é recusada, não só o balão sujo. Se o modelo vazou
// raciocínio num balão, o que ele produziu naquele turno não é confiável, e
// mandar metade é como o cliente recebe uma resposta que termina no meio.
//
// Recusar devolve 422, que no n8n cai no "O QS recusou?" e vira tarefa pro dono
// do lead. O lead não fica sem resposta: fica com uma pessoa.
// -----------------------------------------------------------------------------

/** Nomes que só existem do lado de dentro. Um destes no texto = vazou. */
const NOMES_INTERNOS = [
  'transferir_para_humano', 'salvar_qualificacao', 'horarios_livres',
  'agendar_reuniao', 'base_conhecimento_site', 'match_gloria_documents',
  'qs_gloria', 'gloria_documents', 'lead_id', 'p_lead', 'cw_message_id',
  'MODO_TESTE', 'GLORIA_SECRET', 'ESPERA_SEGUNDOS', 'systemMessage',
  'gloria-responder', 'gloria-transferir', 'gloria-agendar',
];

/**
 * Meta-discurso: o modelo falando SOBRE a conversa em vez de conversar.
 * Em inglês porque é assim que o raciocínio dele sai — e porque um cliente
 * brasileiro no WhatsApp não escreve nada disso.
 */
const META = [
  /\bthe assistant\b/i,
  /\bassistant'?s\b/i,
  /\bthe user\b/i,
  /\bwe (need|must|should) to\b/i,
  /\bi (need|should|must) to\b/i,
  /\blet me (produce|craft|write|check|think)\b/i,
  /\bfinal message\b/i,
  /\bin this scenario\b/i,
  /\bsystem (prompt|message)\b/i,
  /\bper the instructions\b/i,
  /\bas an ai\b/i,
  // pt-BR, restrito ao que é confissão de bastidor. "assistente" fica DE FORA:
  // ela se apresenta como assistente da agência, e isso é legítimo.
  /\bminhas instru[çc][õo]es\b/i,
  /\bmeu prompt\b/i,
  /\bfui instru[íi]da\b/i,
  /\bregras acima\b/i,
];

/** Coisa de máquina que nunca deveria virar mensagem. */
const ARTEFATOS = [
  /```/,
  /\{\{|\}\}/,
  /<\|.*?\|>/,
  /^\s*\{\s*"/,
];

/**
 * Este texto tem cara de raciocínio vazado?
 * Devolve null quando está limpo, ou { sinal, trecho } quando pega.
 */
export function cheiraVazamento(texto) {
  const t = String(texto || '');
  if (!t.trim()) return null;

  for (const nome of NOMES_INTERNOS) {
    const i = t.indexOf(nome);
    if (i >= 0) {
      return { sinal: 'nome_interno', detalhe: nome, trecho: recorte(t, i) };
    }
  }

  for (const re of META) {
    const m = t.match(re);
    if (m) {
      return { sinal: 'meta_discurso', detalhe: m[0], trecho: recorte(t, t.indexOf(m[0])) };
    }
  }

  for (const re of ARTEFATOS) {
    const m = t.match(re);
    if (m) {
      return { sinal: 'artefato', detalhe: m[0].slice(0, 20), trecho: recorte(t, t.indexOf(m[0])) };
    }
  }

  return null;
}

/**
 * A rodada inteira. Devolve null se está tudo limpo, ou o achado com o número
 * do balão — o número importa: balão 3 sujo com 1 e 2 limpos é o padrão do
 * vazamento de 25/08, e saber disso ajuda a ajustar o prompt depois.
 */
export function rodadaVazou(mensagens) {
  const lista = Array.isArray(mensagens) ? mensagens : [];
  for (let i = 0; i < lista.length; i++) {
    const achado = cheiraVazamento(lista[i]?.texto);
    if (achado) return { ...achado, balao: i + 1, de: lista.length };
  }
  return null;
}

/** 120 caracteres em volta do ponto suspeito — o bastante pro log fazer sentido. */
function recorte(t, i) {
  const ini = Math.max(0, i - 40);
  return (ini > 0 ? '…' : '') + t.slice(ini, ini + 120).replace(/\s+/g, ' ').trim() + '…';
}
