// api/_waNascimento.js
// -----------------------------------------------------------------------------
// Quem escreveu no WhatsApp e NÃO é lead: vira lead (perguntando ao Bitrix
// antes) ou cai na triagem. Saiu de dentro do wa-webhook (Chatwoot) em
// 21/09/2026 porque o webhook da Evolution — o dos números dos SDRs — precisa
// da MESMA regra. Duas cópias divergiriam na primeira correção.
// -----------------------------------------------------------------------------

import { waKey } from './_wa.js';
import { insert, rest } from './_supabaseAdmin.js';
import { procurarNegocioPorTelefone } from './_bitrixLead.js';
import { createInboundLead } from './_leads.js';

/**
 * Registra a mensagem que NÃO deu pra vincular.
 *
 * O webhook responde 200 e segue a vida de propósito (erro aqui vira
 * retentativa eterna do Chatwoot). O preço disso era a mensagem sumir sem
 * rastro em lugar nenhum — foi assim que "não estão chegando mensagens" ficou
 * invisível. Agora cada descarte deixa uma linha.
 *
 * Best-effort: se o próprio registro falhar, o webhook segue. Registrar o
 * problema nunca pode virar um problema maior.
 */
export async function registrarDescarte(motivo, dados = {}) {
  const linha = {
    motivo,
    phone: dados.phone ? String(dados.phone).replace(/\D/g, '') : null,
    inbox_id: dados.inboxId ?? null,
    cw_message_id: dados.messageId ?? null,
    detalhe: dados.detalhe ?? null,
    // Número do SDR por onde a mensagem chegou (0082): é o que faz a triagem
    // aparecer pro próprio SDR, e não só pra gestão.
    ...(dados.linhaUserId ? { linha_user_id: dados.linhaUserId } : {}),
    ...(dados.sourceId ? { source_id: dados.sourceId } : {}),
  };
  try {
    // O nome como o WhatsApp mostra (coluna da 0047). É o que transforma a
    // triagem de uma lista de telefones numa lista de PESSOAS — reconhecer
    // "é a Tainara, do time" leva um segundo; deduzir isso de +5585… não.
    await insert('qs_wa_descartadas', { ...linha, contato_nome: dados.nome || null }, { returning: false });
  } catch (e) {
    // Coluna ausente = 0047 ainda não colada. Registrar o descarte importa mais
    // que o nome: sem a linha, "sumiu mensagem" volta a não ter onde ser
    // investigado — que é exatamente o buraco que a 0038 fechou.
    if (/contato_nome|42703|PGRST204/i.test(String(e?.message))) {
      try {
        await insert('qs_wa_descartadas', linha, { returning: false });
        return;
      } catch (e2) {
        console.warn('[wa-webhook] não deu pra registrar o descarte:', e2?.message);
        return;
      }
    }
    console.warn('[wa-webhook] não deu pra registrar o descarte:', e?.message);
  }
}

/**
 * Os números que NUNCA viram lead: o próprio time.
 *
 * Vem de `qs_users.whatsapp_number` (o cadastro que já existe na tela de
 * usuários) mais a chave `wa_ignorar_numeros` em `qs_settings` — uma lista de
 * telefones em texto, pro Bruno acrescentar caso de exceção sem precisar de
 * deploy. Comparação pela chave canônica, então o formato tanto faz.
 *
 * Cache de 5 min: isto roda no caminho do webhook e a lista quase nunca muda.
 */
let cacheIgnorados = null;

export async function numerosIgnorados() {
  if (cacheIgnorados && Date.now() - cacheIgnorados.em < 5 * 60_000) return cacheIgnorados.set;
  const set = new Set();
  try {
    const users = await rest('qs_users?select=whatsapp_number&whatsapp_number=not.is.null');
    for (const u of (users || [])) {
      const k = waKey(u.whatsapp_number);
      if (k) set.add(k);
    }
  } catch (e) {
    console.warn('[wa-webhook] não deu pra ler os números do time:', e?.message);
  }
  try {
    const s = await rest(`qs_settings?select=value&key=eq.wa_ignorar_numeros&limit=1`);
    const bruto = s?.[0]?.value;
    const lista = Array.isArray(bruto) ? bruto : String(bruto ?? '').split(/[,;\s]+/);
    for (const n of lista) {
      const k = waKey(n);
      if (k) set.add(k);
    }
  } catch {
    // chave inexistente é o normal — não é erro.
  }
  cacheIgnorados = { set, em: Date.now() };
  return set;
}

/**
 * Número desconhecido escreveu: decide se vira lead e devolve o lead criado
 * (ou null pra cair na triagem de sempre).
 *
 * Só nasce lead de mensagem RECEBIDA. Se fomos NÓS que escrevemos primeiro pra
 * um número solto — disparo do time, contato pessoal de alguém, teste —, criar
 * card seria inventar demanda: o time não perdeu ninguém, ele que iniciou.
 */
export async function nascerDoWhatsApp({ phone, nome, direcao, inboxId, ownerId = null, canal = 'API oficial' }) {
  if (direcao !== 'in') return null;

  const chave = waKey(phone);
  if (!chave) return null;
  if ((await numerosIgnorados()).has(chave)) {
    console.log('[wa-webhook] número do time escreveu; não vira lead:', chave);
    return null;
  }

  // O Bitrix é a fonte da verdade sobre "essa pessoa já é nossa cliente?".
  const noBitrix = await procurarNegocioPorTelefone(phone);

  // Bitrix fora do ar não autoriza chutar. Sem a resposta dele, criar seria
  // apostar que a pessoa é nova — e a medição de 13/08 diz que a aposta perde:
  // 13 em cada 18 já existiam lá. Cai na triagem, que é reversível; card
  // duplicado no funil do Comercial não é.
  if (noBitrix?.indisponivel) {
    console.warn('[wa-webhook] Bitrix indisponível, mando pra triagem:', noBitrix.motivo);
    return null;
  }

  const payload = {
    full_name: nome || `WhatsApp ${String(phone).replace(/\D/g, '').slice(-8)}`,
    phone,
    source: 'api',
    segment: `WhatsApp (${canal})`,
    // Escreveu pro chip de um SDR: o lead é DELE, sem rodízio. Foi pra ele
    // que a pessoa escreveu, e é pelo número dele que a conversa segue.
    ...(ownerId ? { owner_id: ownerId } : {}),
    // Achou negócio lá: o lead nasce colado nele. O createInboundLead entende
    // `bitrix_id` preenchido como "já tem card" e NÃO abre negócio novo — que é
    // justamente o que evita a duplicata que sujou o funil em 18/08.
    ...(noBitrix?.dealId ? { bitrix_id: noBitrix.dealId } : {}),
  };

  const { lead } = await createInboundLead(payload, {
    // Cliente que já está no Bitrix entra sem cadência (ver o porquê no
    // _leads.js). Gente nova de verdade entra na cadência padrão.
    semCadencia: !!noBitrix?.dealId,
    // Contato que existe no Bitrix SEM negócio: o id vai junto pra que o
    // negócio novo seja aberto no contato que já está lá, em vez de nascer um
    // contato duplicado ao lado (a busca daqui tenta 8 formatos de telefone; a
    // de dentro do crm.deal.add tentava um só).
    bitrixContatoId: noBitrix?.contatoId || null,
  });
  if (!lead) return null;

  // Rastro pra quem abrir o card entender de onde ele saiu — e, quando veio do
  // Bitrix, que NÃO é um lead novo apesar de ter acabado de aparecer no QS.
  try {
    await insert('qs_notes', {
      lead_id: lead.id,
      author_id: null,
      body: (noBitrix?.dealId
        ? `📲 Escreveu no WhatsApp (${canal}).\nJá existia no Bitrix — negócio ${noBitrix.dealId}. Card do QS ligado a ele, sem abrir negócio novo.`
        : `📲 Escreveu no WhatsApp (${canal}) e não existia no Bitrix. Lead e negócio criados agora.`)
        // Qual LINHA recebeu importa: o time tem mais de uma (SDR na API
        // oficial, closer no número conectado por QR). Saber por onde a pessoa
        // entrou é o que permite responder pela linha certa depois.
        + (inboxId ? `\nCaixa: ${inboxId}.` : ''),
      tags: ['whatsapp', 'origem'],
    }, { returning: false });
  } catch (e) {
    console.warn('[wa-webhook] nota de origem do WhatsApp falhou (segue):', e?.message);
  }

  console.log(`[wa-webhook] lead ${lead.id} nasceu do WhatsApp (${noBitrix?.dealId ? 'reaproveitou negócio ' + noBitrix.dealId : 'negócio novo ' + (lead.bitrix_id || '-')})`);
  return lead;
}
