// api/_waSaude.js
// -----------------------------------------------------------------------------
// A saúde do número OFICIAL (Cloud API da Meta), pra faixa de aviso do QS.
//
// Era a metade Meta do antigo _waAlerta.js; a outra metade vigiava as
// instâncias da Evolution e mandava alerta por WhatsApp — saiu junto com a
// Evolution em 23/09/2026 (decisão do Bruno: o aviso fica só na tela).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

/** Depois de quanto tempo sem sinal da Meta a coisa vira alarme. */
const SILENCIO_META_MS = 6 * 60 * 60 * 1000;

/**
 * A SAÚDE DA CAIXA OFICIAL — o ponto cego que custou 20 dias.
 *
 * Entre 02/09 e 22/09/2026 o número oficial não gravou uma única mensagem e
 * nada no sistema tinha como perceber: o vigia só sabia perguntar à Evolution
 * se a instância estava `open`, e a caixa oficial não é uma instância.
 *
 * O que torna este diagnóstico útil e não só mais um alarme: ele separa as três
 * causas que, de fora, parecem a mesma coisa (silêncio).
 *
 *   • `nao-chega`         — a Meta parou de chamar. App dessubscrito, URL
 *                           trocada, ou a inscrição suspensa por excesso de erro.
 *   • `assinatura`        — a Meta chama e NÓS recusamos. META_CALLS_APP_SECRET
 *                           diferente do app secret real: 401 em tudo.
 *   • `chega-e-ignora`    — a Meta chama, aceitamos, e nada casa com um formato
 *                           conhecido.
 *
 * A diferença entre a primeira e a segunda é o que ninguém consegue ver pelo
 * lado de fora — e é a que muda completamente o que fazer a seguir. Ver a 0086.
 */
export async function saudeDaCaixaOficial() {
  let pulso = null;
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.wa_meta_pulso&limit=1`);
    pulso = rows?.[0]?.value ?? null;
  } catch (e) {
    return { ok: null, motivo: 'sem-leitura', detalhe: e?.message || null };
  }
  if (!pulso) return { ok: null, motivo: 'sem-pulso' };

  const agora = Date.now();
  const ms = (iso) => (iso ? agora - new Date(iso).getTime() : null);
  const desdeQualquer = ms(pulso.ultimo_em);
  const desdeValido = ms(pulso.ultimo_valido_em);

  const recusadas = Number(pulso['assinatura-invalida'] || 0);
  const gravadas = Number(pulso.gravado || 0);
  const ignoradas = Number(pulso.ignorado || 0);

  const base = {
    ultimoEm: pulso.ultimo_em || null,
    ultimoValidoEm: pulso.ultimo_valido_em || null,
    silencioMs: desdeValido,
    recusadasHoje: recusadas,
    gravadasHoje: gravadas,
    ignoradasHoje: ignoradas,
  };

  // A Meta está batendo na porta e sendo recusada: é a causa mais traiçoeira,
  // porque "o webhook está recebendo" é verdade e mesmo assim nada entra.
  if (recusadas > 0 && gravadas === 0) {
    return { ...base, ok: false, motivo: 'assinatura' };
  }
  // Nunca houve sinal válido, ou faz tempo demais.
  if (desdeValido == null || desdeValido > SILENCIO_META_MS) {
    // Chegou alguma coisa (mesmo recusada) → a Meta chama, o problema é nosso.
    if (desdeQualquer != null && desdeQualquer <= SILENCIO_META_MS) {
      return { ...base, ok: false, motivo: 'chega-e-ignora' };
    }
    return { ...base, ok: false, motivo: 'nao-chega' };
  }
  return { ...base, ok: true, motivo: null };
}
