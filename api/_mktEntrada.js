// api/_mktEntrada.js
// -----------------------------------------------------------------------------
// WHATSAPP DO MARKETING — a entrada (0244, 30/10/2026).
//
// A Meta entrega TODOS os números da WABA no mesmo /api/wa-calls. O
// _metaEntrada.js olha o setor do número (qs_wa_numeros_meta.setor) e, SÓ
// quando é 'marketing', importa este módulo (import dinâmico: um erro aqui não
// alcança a entrada do Comercial nem a do Relacionamento) e entrega a mudança.
//
//   messages            → o cliente escreveu/clicou (+ recibos ✓ ✓✓) → motor
//   smb_message_echoes  → alguém respondeu pelo celular (Coexistência) → pausa o robô
//   history             → histórico do celular ao conectar: ignorado de propósito
//                         (o robô não pode "responder" mensagens de meses atrás)
//
// Idempotência por wamid: o índice único de mkt_wa_mensagens transforma a
// reentrega da Meta em conflito, e o motor não responde duas vezes.
// -----------------------------------------------------------------------------

import { receberMensagem, registrarEco, registrarRecibo } from './_mktMotor.js';

const transitorio = (e) => e?.code === 'TIMEOUT' || e?.status >= 500 || /fetch failed|ECONNRESET|socket/i.test(String(e?.message || ''));

/** Mesmo formato de conta do _metaEntrada (recebidas, ecos, historico, recibos, pendentes). */
export async function processarMarketing(ch, numero, nomes) {
  const conta = { recebidas: 0, ecos: 0, historico: 0, recibos: 0, pendentes: 0 };
  const value = ch?.value || {};
  const phoneId = String(numero?.phone_number_id || value?.metadata?.phone_number_id || '');
  if (!phoneId) return conta;

  if (ch.field === 'messages') {
    for (const m of value.messages || []) {
      try {
        const r = await receberMensagem(phoneId, m, nomes?.get?.(String(m.from)) || null);
        if (r.gravada) conta.recebidas++;
      } catch (e) {
        console.error('[mkt-entrada] mensagem não gravada:', e?.message);
        if (transitorio(e)) conta.pendentes++;
      }
    }
    for (const st of value.statuses || []) {
      if (await registrarRecibo(st).catch(() => false)) conta.recibos++;
    }
  }
  if (ch.field === 'smb_message_echoes') {
    for (const m of value.message_echoes || []) {
      try { if (await registrarEco(phoneId, m)) conta.ecos++; }
      catch (e) { if (transitorio(e)) conta.pendentes++; }
    }
  }
  // 'history' fica de fora de propósito (ver o topo).
  return conta;
}
