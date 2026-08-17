// api/_waConferencia.js
// -----------------------------------------------------------------------------
// "TENHO CERTEZA DE QUE TODA MENSAGEM CHEGOU?" — a conferência que responde isso.
//
// O webhook do Chatwoot é a única porta de entrada das mensagens no QS. Ele é
// confiável, mas é uma chamada de rede: deploy no meio do caminho, instabilidade
// ou um erro nosso e a mensagem fica só no Chatwoot — sem barulho nenhum. Foi o
// que aconteceu em 10/08 (25 mensagens) e ninguém percebeu por uma semana.
//
// Esta conferência olha as conversas com atividade RECENTE no Chatwoot e pergunta
// ao banco se a última mensagem de cada uma chegou. É de propósito estreita: roda
// junto do monitor (a cada poucos minutos) e precisa ser barata. O varredor
// completo, que compara tudo, é trabalho de manutenção — não de vigia.
//
// Devolve o que faltou; quem chama decide se avisa.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { cw, cwConfigured, idsDeWhatsApp } from './_wa.js';

/** Quanto tempo pra trás olhar. Curto: o vigia roda o tempo todo. */
const JANELA_MIN = 90;

/**
 * Confere as conversas mexidas nos últimos `janelaMin` minutos.
 * Devolve { conferidas, faltando: [...], erro? }.
 */
export async function conferirRecebimento({ janelaMin = JANELA_MIN } = {}) {
  if (!cwConfigured()) return { conferidas: 0, faltando: [], erro: 'chatwoot-nao-configurado' };

  const caixas = await idsDeWhatsApp();
  if (!caixas || !caixas.length) return { conferidas: 0, faltando: [], erro: 'sem-caixas' };

  const limite = Date.now() - janelaMin * 60_000;
  const faltando = [];
  let conferidas = 0;

  for (const inboxId of caixas) {
    let lista;
    try {
      const d = await cw(`/conversations?inbox_id=${inboxId}&status=all`);
      lista = d?.data?.payload || [];
    } catch (e) {
      console.warn('[wa-conferencia] não consegui listar conversas:', e?.message);
      continue;
    }

    // `last_activity_at` vem em epoch de segundos. Só o que mexeu na janela.
    const recentes = lista.filter((c) => Number(c.last_activity_at || 0) * 1000 >= limite);

    for (const c of recentes) {
      const ultima = c.last_non_activity_message;
      // Sem id, sem conteúdo ou nota privada: não é mensagem que o QS guardaria.
      if (!ultima?.id || ultima.private || !String(ultima.content || '').trim()) continue;

      conferidas++;
      try {
        const achou = await rest(
          `qs_wa_messages?select=id&cw_message_id=eq.${encodeURIComponent(ultima.id)}&limit=1`
        );
        if (Array.isArray(achou) && achou.length) continue;
      } catch (e) {
        console.warn('[wa-conferencia] consulta ao banco falhou:', e?.message);
        continue;   // banco fora não é mensagem perdida — não inventa alarme
      }

      // Não está no QS. Antes de gritar, olha se ela foi DESCARTADA com motivo
      // (número que não é lead, por exemplo): isso é decisão nossa, tem rastro
      // na triagem e não é perda.
      let descartada = false;
      try {
        const d = await rest(
          `qs_wa_descartadas?select=id&cw_message_id=eq.${encodeURIComponent(ultima.id)}&limit=1`
        );
        descartada = Array.isArray(d) && d.length > 0;
      } catch { /* sem a tabela, trata como não descartada */ }
      if (descartada) continue;

      faltando.push({
        conversa: c.id,
        inbox: inboxId,
        mensagem: ultima.id,
        telefone: c.meta?.sender?.phone_number || null,
        quando: new Date(Number(ultima.created_at || 0) * 1000).toISOString(),
        trecho: String(ultima.content || '').replace(/\s+/g, ' ').slice(0, 60),
      });
    }
  }

  return { conferidas, faltando };
}

/** O texto do alerta, quando há mensagem que não chegou. */
export function textoDoAlerta(faltando) {
  const n = faltando.length;
  const linhas = faltando.slice(0, 5).map((f) => `• ${f.telefone || 'sem número'}: "${f.trecho}"`);
  return (
    `⚠️ QS: ${n} mensagem${n > 1 ? 's' : ''} chegou no WhatsApp e NÃO entrou no CRM.\n\n` +
    linhas.join('\n') +
    (n > 5 ? `\n… e mais ${n - 5}.` : '') +
    `\n\nAbra a conversa do cliente no QS: só de abrir, o histórico é puxado e a mensagem aparece.`
  );
}
