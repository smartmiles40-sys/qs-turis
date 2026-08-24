// api/wa-bitrix-digest.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-bitrix-digest?secret=<WA_WEBHOOK_SECRET>
//
// LEVA A CONVERSA DE WHATSAPP PRO CARD DO BITRIX (Bruno, 20/08/2026).
//
// Quem vive no Bitrix — Comercial e gestão — abre o card e não vê uma linha do
// que a SDR conversou. Este job fecha isso: uma vez por dia, cada lead que teve
// conversa ganha UM comentário na timeline do negócio dele, com o diálogo
// daquele dia.
//
// POR QUE FORA DO CAMINHO DE ENVIO. A regra que saiu da auditoria de WhatsApp é
// "nada pesado no caminho do webhook": a função tem 10s na Vercel e o envio da
// SDR divide esse orçamento. Pendurar uma chamada ao Bitrix em cada mensagem
// enviada faria o QS parecer lento no único lugar onde lentidão dói. Aqui é
// assíncrono e em lote — o SDR nunca espera por isto.
//
// COMO É CHAMADO. Igual ao vigia, mais de uma perna, porque agendador externo
// morre calado (aconteceu em 17/08, dois dias mudo):
//   1. agendador externo batendo nesta URL uma vez por dia (o normal);
//   2. quando não houver, dá pra chamar na mão — é idempotente.
// A UNIQUE (lead_id, dia) da 0058 é o que torna chamar duas vezes inofensivo.
//
// RETOMÁVEL DE PROPÓSITO. Processa um lote e devolve `restantes`. Se sobrou,
// basta chamar de novo: a função nunca tenta esvaziar tudo dentro de um único
// orçamento de 10s e ficar sem terminar nenhum.
//
// Envs: WA_WEBHOOK_SECRET, BITRIX_WEBHOOK_BASE, SUPABASE_URL,
//       SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { comentarNoNegocio, bitrixConfigurado } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';

const FUSO = 'America/Sao_Paulo';

/** O dia de HOJE em São Paulo, no formato YYYY-MM-DD. */
export function hojeEmSaoPaulo(base = new Date()) {
  // sv-SE devolve exatamente "YYYY-MM-DD" — é o truque mais curto pra pegar a
  // data de um fuso sem arrastar uma biblioteca inteira.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO }).format(base);
}

/** Ontem em São Paulo — o dia padrão do resumo, já fechado. */
export function ontemEmSaoPaulo() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return hojeEmSaoPaulo(d);
}

/** Início e fim do dia de São Paulo, em UTC, pra filtrar sent_at. */
export function janelaUtc(dia) {
  // -03:00 o ano inteiro: o Brasil não tem mais horário de verão desde 2019.
  // Se algum dia voltar, é ESTE ponto que precisa mudar.
  return { de: `${dia}T00:00:00-03:00`, ate: `${dia}T23:59:59.999-03:00` };
}

const hora = (iso) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO, hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return '--:--'; }
};

/**
 * Monta o texto do comentário.
 *
 * Texto puro e curto: a timeline do Bitrix não é lugar pra transcrição fiel de
 * 200 mensagens. Anexo vira "[áudio]"/"[imagem]" porque o arquivo mora no QS —
 * duplicar mídia no CRM não ajuda ninguém e pesa.
 */
export function montarComentario({ dia, mensagens, nomeLead }) {
  const [a, m, d] = dia.split('-');
  const cabecalho = `💬 WhatsApp — ${d}/${m}/${a}${nomeLead ? ` · ${nomeLead}` : ''}`;
  const linhas = mensagens.map((msg) => {
    const quem = msg.direction === 'out'
      ? (msg.sender_name ? `Nós (${msg.sender_name})` : 'Nós')
      : 'Cliente';
    let texto = String(msg.content || '').replace(/\s+/g, ' ').trim();

    // Tira a assinatura repetida. O QS já prefixa a mensagem com "*Yanca*"
    // (qs_settings.wa_signature_names) pro cliente saber com quem fala; aqui o
    // nome já está no "Nós (Yanca)", e sem isto cada linha sai
    // "Nós (Victor Hugo): *Victor Hugo* ..." — visto na amostra de 19/08.
    if (msg.sender_name) {
      const escapado = String(msg.sender_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      texto = texto.replace(new RegExp(`^\\*\\s*${escapado}\\s*\\*\\s*`, 'i'), '').trim();
    }

    if (!texto) {
      const anexos = Array.isArray(msg.attachments) ? msg.attachments.length : 0;
      texto = anexos ? `[${anexos} anexo(s)]` : '[sem texto]';
    }
    // Teto por mensagem: um textão colado não pode estourar o comentário todo.
    if (texto.length > 500) texto = `${texto.slice(0, 500)}…`;
    return `[${hora(msg.sent_at)}] ${quem}: ${texto}`;
  });

  let corpo = `${cabecalho}\n\n${linhas.join('\n')}`;
  // O Bitrix trunca comentário muito grande. Corta com aviso em vez de perder o
  // fim em silêncio — quem lê precisa saber que tem mais conversa no QS.
  if (corpo.length > 12_000) {
    corpo = `${corpo.slice(0, 12_000)}\n\n[…] conversa completa no QS.`;
  }
  return `${corpo}\n\n— enviado automaticamente pelo QS`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Use POST' });
  }
  // TRÊS PORTAS, todas com credencial — e é de propósito que sejam três.
  //
  // Até 24/08 só existia a primeira, e a tabela de controle tinha ZERO linhas:
  // o job estava no ar desde 20/08 e nunca rodou uma única vez, porque o
  // "agendador externo" que o cabeçalho pressupunha não existia. É o mesmo modo
  // de falha do vigia em 17/08 — silêncio parece "está tudo bem".
  //
  //   1. ?secret=…            na mão, ou agendador externo (reprocessar um dia)
  //   2. Bearer CRON_SECRET   o cron da Vercel — a perna principal
  //   3. Bearer <JWT>         o QS aberto na tela de alguém — a rede de segurança
  const porSegredo = segredoConfere(req.query?.secret, process.env.WA_WEBHOOK_SECRET);
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const porCron = segredoConfere(bearer, process.env.CRON_SECRET);
  const userId = (porSegredo || porCron) ? null : await getSupabaseUserId(req.headers.authorization);
  if (!porSegredo && !porCron && !userId) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  if (!bitrixConfigurado()) {
    return res.status(200).json({ ok: false, motivo: 'BITRIX_WEBHOOK_BASE não configurada' });
  }

  // `?dia=YYYY-MM-DD` pra reprocessar um dia específico; sem isso, ontem.
  // `?dia=hoje` serve pra conferir na hora, sem esperar a virada.
  const pedido = String(req.query?.dia || '').trim();
  const dia = pedido === 'hoje' ? hojeEmSaoPaulo()
    : /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido
    : ontemEmSaoPaulo();

  const limite = Math.min(Math.max(Number(req.query?.limite) || 25, 1), 60);
  const { de, ate } = janelaUtc(dia);

  // TRAVA DA CARONA. Cinco SDRs com o QS aberto batem aqui a cada 5 minutos;
  // sem isto seriam cinco leituras de até 5000 mensagens por rodada. As pernas
  // do cron e do segredo NÃO passam por aqui de propósito: quem chamou na mão
  // quer que rode agora. Usa o `enviado_em` que a 0058 já tem — sem estado novo.
  if (userId) {
    try {
      const ultimo = await rest(
        `qs_wa_bitrix_digest?select=enviado_em&dia=eq.${encodeURIComponent(dia)}&order=enviado_em.desc&limit=1`
      );
      const em = ultimo?.[0]?.enviado_em ? Date.parse(ultimo[0].enviado_em) : 0;
      if (em && Date.now() - em < 30 * 60_000) {
        return res.status(200).json({ ok: true, dia, pulou: 'rodada recente' });
      }
    } catch {
      // Não conseguir ler a trava não pode impedir a rodada — no pior caso ela
      // roda de novo, e a UNIQUE (lead_id, dia) já garante que isso é inofensivo.
    }
  }

  try {
    // 1) Quem conversou nesse dia. Traz lead_id de todas as mensagens da janela
    //    e reduz aqui — é uma leitura só, em vez de uma por lead.
    const msgs = await rest(
      `qs_wa_messages?select=lead_id,direction,content,attachments,sender_name,sent_at` +
      `&sent_at=gte.${encodeURIComponent(de)}&sent_at=lte.${encodeURIComponent(ate)}` +
      `&lead_id=not.is.null&deleted_at=is.null&order=sent_at.asc&limit=5000`
    );
    const porLead = new Map();
    for (const m of (msgs || [])) {
      if (!porLead.has(m.lead_id)) porLead.set(m.lead_id, []);
      porLead.get(m.lead_id).push(m);
    }
    if (!porLead.size) {
      return res.status(200).json({ ok: true, dia, leads: 0, enviados: 0, restantes: 0 });
    }

    // 2) Tira quem já foi enviado nesse dia (a idempotência da 0058).
    //
    // `erro=is.null` é o que separa "foi" de "tentou e falhou". Sem esse filtro,
    // uma recusa passageira do Bitrix gravava a linha com o erro preenchido, e a
    // partir dali o lead era pulado PRA SEMPRE — a conversa daquele dia nunca
    // mais chegava no card, sem nenhum sinal de que faltava.
    const jaForam = await rest(
      `qs_wa_bitrix_digest?select=lead_id&dia=eq.${encodeURIComponent(dia)}&erro=is.null&limit=5000`
    );
    for (const r of (jaForam || [])) porLead.delete(r.lead_id);

    // 3) Só quem tem card no Bitrix. Sem negócio não há timeline onde comentar —
    //    e criar negócio AQUI seria surpresa: quem faz isso é o wa-webhook, na
    //    hora em que a pessoa escreve, com a regra de duplicata dele.
    const ids = [...porLead.keys()];
    const semCard = [];
    const alvos = [];
    for (let i = 0; i < ids.length; i += 50) {
      const fatia = ids.slice(i, i + 50);
      const leads = await rest(
        `qs_leads?select=id,full_name,bitrix_id&id=in.(${fatia.join(',')})`
      );
      for (const l of (leads || [])) {
        if (l.bitrix_id) alvos.push(l); else semCard.push(l.id);
      }
    }

    // 4) O lote. Um comentário por lead, em série de propósito: o Bitrix aceita
    //    ~2 req/s e disparar 25 de uma vez é o caminho mais curto pro 503.
    const doLote = alvos.slice(0, limite);
    let enviados = 0;
    let falhas = 0;
    let processados = 0;

    // A função tem 60s (vercel.json). Se o Bitrix estiver lento, é melhor parar
    // em 45s e devolver `restantes` — o próximo disparo continua de onde parou —
    // do que ser morta no meio e não conseguir MARCAR o que já foi enviado, que
    // renderia comentário repetido no card.
    const prazo = Date.now() + 45_000;

    for (const lead of doLote) {
      if (Date.now() > prazo) {
        console.warn('[wa-digest] prazo da função estourado; o resto fica pro próximo disparo');
        break;
      }
      processados++;
      const mensagens = porLead.get(lead.id) || [];
      const texto = montarComentario({ dia, mensagens, nomeLead: lead.full_name });
      const commentId = await comentarNoNegocio(lead.bitrix_id, texto);

      try {
        // UPSERT, não INSERT. Agora que a falha é reprocessável (o passo 2 só
        // pula quem foi sem erro), a segunda tentativa encontra a linha da
        // primeira: com INSERT ela bateria na UNIQUE, o 23505 seria engolido
        // como "já existia" e o `erro` ficaria gravado pra sempre. Com o
        // merge-duplicates, o sucesso LIMPA o erro da tentativa anterior.
        await rest('qs_wa_bitrix_digest?on_conflict=lead_id,dia', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=minimal',
          body: {
            lead_id: lead.id,
            dia,
            bitrix_deal_id: String(lead.bitrix_id),
            mensagens: mensagens.length,
            enviado_em: new Date().toISOString(),
            erro: commentId ? null : 'comentário não foi aceito pelo Bitrix',
          },
        });
      } catch (e) {
        console.warn('[wa-digest] não deu pra marcar o envio:', e?.message);
      }

      if (commentId) enviados++; else falhas++;
    }

    const restantes = Math.max(alvos.length - processados, 0);
    console.log(`[wa-digest] ${dia}: ${enviados} enviados, ${falhas} falhas, ${restantes} restantes, ${semCard.length} sem card`);

    return res.status(200).json({
      ok: true,
      dia,
      leads_com_conversa: ids.length,
      enviados,
      falhas,
      restantes,
      sem_card_no_bitrix: semCard.length,
    });
  } catch (e) {
    console.error('[wa-digest] falhou:', e?.message);
    return res.status(500).json({ error: e?.message || 'erro' });
  }
}
