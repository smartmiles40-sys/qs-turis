// api/_numeroReserva.js
// -----------------------------------------------------------------------------
// PRA ONDE VAI O LEAD QUANDO O RODÍZIO NÃO RESPONDE (Bruno, 29/09/2026):
// "obrigatoriamente ele deve passar pela API e distribuir para os SDRs, não
// deve de nenhuma forma passar para o 1935".
//
// Até aqui o plano B das LPs era o 1935 (linha do closer). Agora o plano B é
// SEMPRE o chip de um SDR, nesta ordem:
//   1. sdr_pool ativo, lido na hora (sorteado — não gira a roda nem grava nada);
//   2. a última lista boa que este processo viu (banco fora do ar);
//   3. WHATSAPP_FALLBACK da Vercel — só se NÃO for um número proibido.
// Nenhum dos três → null, e quem chamou mostra "tente de novo", nunca o 1935.
//
// NUMEROS_PROIBIDOS vale também pro rodízio: se alguém cadastrar o 1935 como
// chip de SDR, ele é descartado aqui em vez de voltar pras páginas.
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';

const PROIBIDOS_FIXOS = ['5511951251935', '551151251935'];

export function proibidos() {
  const extra = String(process.env.NUMEROS_PROIBIDOS || '')
    .split(/[,\s]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
  return new Set([...PROIBIDOS_FIXOS, ...extra]);
}

export function numeroValido(n) {
  const s = String(n || '').replace(/\D/g, '');
  return /^[0-9]{12,13}$/.test(s) && !proibidos().has(s) ? s : null;
}

let ultimaLista = [];

function sortear(lista) {
  return lista.length ? lista[Math.floor(Math.random() * lista.length)] : null;
}

export async function numeroReserva() {
  try {
    const rows = await rest('sdr_pool?select=numero&status=eq.ativo&sdr_id=not.is.null', { timeoutMs: 2000 });
    const lista = (rows || []).map((r) => numeroValido(r.numero)).filter(Boolean);
    if (lista.length) {
      ultimaLista = lista;
      return sortear(lista);
    }
  } catch (e) {
    console.warn('[numeroReserva] sdr_pool indisponível:', e?.message || e);
  }
  if (ultimaLista.length) return sortear(ultimaLista);
  return numeroValido(process.env.WHATSAPP_FALLBACK);
}
