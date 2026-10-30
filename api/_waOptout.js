// api/_waOptout.js
// -----------------------------------------------------------------------------
// "PARAR": reconhecer e registrar o pedido de saída do lead.
//
// POR QUE ISTO IMPORTA MAIS DO QUE PARECE. A qualidade do número na Meta
// (verde/amarelo/vermelho) é calculada a partir de quantas pessoas BLOQUEIAM e
// DENUNCIAM — e quem denuncia é, quase sempre, quem pediu para parar e continuou
// recebendo. A qualidade define o teto diário de mensagens. Ou seja: ignorar um
// "PARAR" hoje vira menos disparo daqui a duas semanas, e a conta chega sem
// etiqueta explicando de onde veio.
//
// O QUE ACONTECE E O QUE NÃO ACONTECE (ver a 0087):
//   • registra o pedido no lead e deixa uma nota para o SDR ver;
//   • bloqueia o template AUTOMÁTICO de primeiro contato;
//   • NÃO muda o status do lead, NÃO tira da cadência, NÃO marca como perdido.
//     Isso é decisão comercial, não consequência de uma palavra numa mensagem.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

/**
 * O que as pessoas REALMENTE escrevem quando querem sair — não só o que os
 * manuais mandam escrever. A Meta trata "STOP" nativamente em alguns países;
 * no Brasil, não.
 */
const PEDIDOS = [
  'parar', 'pare', 'para', 'sair', 'cancelar', 'descadastrar', 'remover',
  'stop', 'unsubscribe',
  'nao quero', 'nao quero mais', 'nao tenho interesse', 'sem interesse',
  'me tira', 'me tire', 'me remove', 'me remova', 'me exclua',
  'para de mandar', 'pare de mandar', 'nao me mande', 'nao manda mais',
  'nao quero receber', 'nao desejo receber',
];

/** Tira acento e pontuação: "Não quero!" e "nao quero" viram a mesma coisa. */
function limpar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALVOS = new Set(PEDIDOS.map(limpar));

/** Cortesia que pode vir antes do pedido: "por favor parar", "pode parar", "quero sair". */
const ANTES = ['por favor', 'favor', 'pode', 'podem', 'quero', 'gostaria de', 'pfv', 'pf', 'ok', 'oi', 'ola'].map(limpar);

/**
 * O que pode vir DEPOIS sem mudar o sentido: "parar por favor", "não quero
 * mais, obrigada", "me tira dessa lista". Só palavras desta lista — qualquer
 * outra ("não quero PERDER a data", "para QUANDO é…") desfaz o pedido.
 */
const DEPOIS = new Set([
  'mais', 'por', 'favor', 'pf', 'pfv', 'obrigado', 'obrigada', 'obg', 'grato', 'grata',
  'ja', 'agora', 'de', 'da', 'dessa', 'desta', 'disso', 'isso', 'lista', 'grupo',
  'mensagem', 'mensagens', 'msg', 'msgs', 'receber', 'enviar', 'mandar', 'aqui', 'me', 'nao', 'ok',
]);

/**
 * A mensagem é um pedido de saída?
 *
 * A mensagem INTEIRA, até 40 caracteres, tem que ser o pedido — com cortesia
 * antes e só "cauda neutra" depois (DEPOIS). Correção de 30/10/2026: antes
 * bastava COMEÇAR com o pedido, e "não quero perder a data, me manda o link?"
 * ou "para quando é a próxima turma?" descadastravam lead interessado.
 * Descadastrar alguém animado é um estrago maior do que deixar passar um
 * pedido legítimo, que a pessoa repete.
 */
export function ehPedidoDeParada(texto) {
  let limpo = limpar(texto);
  if (!limpo || limpo.length > 40) return false;
  for (const a of ANTES) {
    if (limpo.startsWith(`${a} `)) { limpo = limpo.slice(a.length + 1); break; }
  }
  const palavras = limpo.split(' ');
  // o pedido mais longo que cabe no começo; o resto tem que ser só cauda neutra
  for (let n = Math.min(palavras.length, 5); n >= 1; n--) {
    if (ALVOS.has(palavras.slice(0, n).join(' '))) {
      return palavras.slice(n).every((p) => DEPOIS.has(p));
    }
  }
  return false;
}

/**
 * Registra o pedido. Devolve `true` só na PRIMEIRA vez (a função do banco é
 * idempotente), para a nota não se repetir a cada "PARAR" que a pessoa mandar.
 */
export async function registrarOptout(leadId, texto) {
  if (!leadId) return false;
  try {
    const r = await rest('rpc/qs_wa_optout', {
      method: 'POST',
      body: { p_lead: leadId, p_texto: String(texto ?? '').slice(0, 300) },
    });
    return r === true || r?.[0] === true;
  } catch (e) {
    console.warn('[optout] não consegui registrar:', e?.message);
    return false;
  }
}

/** Este lead pediu para parar? Consultado antes de todo envio AUTOMÁTICO. */
export async function pediuParaParar(leadId) {
  if (!leadId) return false;
  try {
    const rows = await rest(
      `qs_leads?select=optout_whatsapp_em&id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    return Boolean(rows?.[0]?.optout_whatsapp_em);
  } catch (e) {
    // Na dúvida, ENVIA. Um erro de leitura não pode calar o primeiro contato de
    // toda a base — o risco de não falar com quem quer falar é maior aqui do que
    // o de uma mensagem a mais para quem pediu para sair (que já está registrado
    // e vai ser barrado na próxima).
    console.warn('[optout] não consegui conferir:', e?.message);
    return false;
  }
}
