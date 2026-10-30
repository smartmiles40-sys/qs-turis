// api/_mktRegras.js
// -----------------------------------------------------------------------------
// REGRAS PURAS do Marketing (0242): telefone, e-mail, datas de recorrência e de
// sequência, recibo da Meta e o "PARAR". Sem banco, sem rede — testadas em
// tests/mkt/regras.test.ts. A tela tem a mesma régua de telefone/e-mail em
// src/mkt/disparos/regras.ts (o teste confere que as duas batem).
// -----------------------------------------------------------------------------

import { ehPedidoDeParada } from './_waOptout.js';

const SP_MS = 3 * 3600_000; // America/Sao_Paulo fixo em -03:00 desde 2019
const DIA_MS = 86_400_000;

/**
 * Telefone do contato do Marketing: só dígitos, com DDI.
 *   • 10/11 dígitos (DDD + número) → prefixa 55;
 *   • celular brasileiro com 8 dígitos (começa com 6–9) → ganha o 9º dígito:
 *     todo celular tem 9 dígitos desde 2016 e a Cloud API entrega com ele.
 *     (O wa_id que a Meta devolve às vezes vem SEM o 9 — por isso a comparação
 *     no webhook é pela chave DDD + 8 finais, não pela string.)
 *   • fixo (2–5) fica como está;
 *   • fora do Brasil: 10 a 15 dígitos, como veio.
 * Devolve '' quando não dá pra aproveitar.
 */
export function normalizarTelefoneMkt(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  // Com + ou 00 na frente, o DDI veio escrito: não adivinha 55 (ex.: +1 415…).
  const comDdi = /^\s*(\+|00)/.test(String(raw));
  if (d.startsWith('00')) d = d.slice(2);
  // 0 de discagem interurbana ("011 9…", "0 21 …"): cai fora.
  else if (!comDdi && d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (!comDdi && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  if (d.startsWith('55')) return /^55[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(d) ? d : '';
  return d.length >= 10 && d.length <= 15 ? d : '';
}

/** Chave de comparação: DDI+DDD (4) + 8 finais — casa com e sem o 9º dígito. */
export function chaveTelefone(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length >= 12 ? `${d.slice(0, 4)}${d.slice(-8)}` : d;
}

/** O mesmo celular com e sem o 9º dígito (pra buscar no banco com in.()). */
export function variantesTelefone(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  const v = new Set(d ? [d] : []);
  if (/^55\d{2}9\d{8}$/.test(d)) v.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) v.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  return [...v];
}

export const normalizarEmailMkt = (v) => String(v ?? '').trim().toLowerCase();
export const emailValidoMkt = (v) => {
  const e = normalizarEmailMkt(v);
  return e.length <= 254 && /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(e);
};

// ── Datas (relógio de São Paulo) ────────────────────────────────────────────

const hm = (s) => String(s || '0:0').split(':').map((x) => Number(x) || 0);
/** Meia-noite (em SP) do dia de `ms`, devolvida como instante UTC. */
function meiaNoiteSP(ms) {
  const w = new Date(ms - SP_MS);
  return Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) + SP_MS;
}

/**
 * Próxima ocorrência ESTRITAMENTE depois de `desde` de uma recorrência semanal.
 * dias: 0=dom … 6=sáb; hora 'HH:MM' em SP. null se `dias` vier vazio.
 */
export function proximaOcorrencia(dias, hora, desde = new Date()) {
  const ds = [...new Set((dias || []).map(Number).filter((d) => d >= 0 && d <= 6))];
  if (!ds.length || !/^\d{2}:\d{2}$/.test(String(hora || ''))) return null;
  const desdeMs = new Date(desde).getTime();
  const [h, m] = hm(hora);
  const base = meiaNoiteSP(desdeMs);
  for (let i = 0; i <= 7; i++) {
    const dia = base + i * DIA_MS;
    const dow = new Date(dia - SP_MS).getUTCDay();
    if (!ds.includes(dow)) continue;
    const t = dia + (h * 60 + m) * 60_000;
    if (t > desdeMs) return new Date(t).toISOString();
  }
  return null;
}

/**
 * Quando sai um passo da sequência: o dia da ENTRADA (em SP) + dia_offset, na
 * hora do passo. Se já passou (ex.: passo do dia 0 às 10h e a pessoa entrou às
 * 15h), sai na próxima rodada — nunca "no passado esquecido".
 */
export function dataDoPasso(inicio, diaOffset, hora, agora = new Date()) {
  const ini = new Date(inicio).getTime();
  const [h, m] = hm(hora || '10:00');
  const t = meiaNoiteSP(ini) + Math.max(0, Number(diaOffset) || 0) * DIA_MS + (h * 60 + m) * 60_000;
  const minimo = Math.max(ini, new Date(agora).getTime());
  return new Date(Math.max(t, minimo)).toISOString();
}

/** Data "dd/mm" em SP (nome das campanhas geradas). */
export function diaMesSP(ms) {
  const w = new Date(new Date(ms).getTime() - SP_MS);
  return `${String(w.getUTCDate()).padStart(2, '0')}/${String(w.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Recibos e respostas do número do Marketing ──────────────────────────────

const ORDEM = { pendente: 0, enviado: 1, entregue: 2, lido: 3, respondeu: 4 };
const DA_META = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'erro' };

/**
 * Novo estado do envio a partir do recibo da Meta. O funil só ANDA pra frente
 * (um "delivered" atrasado não desfaz o "lido"); "failed" vale sobre enviado/
 * entregue, mas não sobre quem já leu ou respondeu. null = não muda.
 */
export function avancarStatus(atual, statusMeta) {
  const novo = DA_META[String(statusMeta || '').toLowerCase()];
  if (!novo) return null;
  if (['erro', 'pulado', 'cancelado'].includes(atual)) return null;
  if (novo === 'erro') return (ORDEM[atual] ?? 0) <= 2 ? 'erro' : null;
  return (ORDEM[novo] ?? 0) > (ORDEM[atual] ?? 0) ? novo : null;
}

/** O texto que a pessoa mandou (texto, botão do modelo ou resposta de lista). */
export function textoDaMensagem(m) {
  if (!m || typeof m !== 'object') return '';
  return String(
    m.text?.body ?? m.button?.text ?? m.button?.payload ??
    m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
  );
}

/** "PARAR", "não quero mais" ou o botão "Parar de receber" do modelo. */
export function ehParadaMkt(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === 'parar de receber') return true;
  // Mais estrito que o do Comercial: frase longa ("não quero perder a data,
  // me manda o link") NÃO é saída — até 5 palavras.
  if (t.split(' ').length > 5) return false;
  return ehPedidoDeParada(texto);
}
