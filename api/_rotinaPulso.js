// api/_rotinaPulso.js
// -----------------------------------------------------------------------------
// PULSO DAS ROTINAS (12/11/2026) — "automação parada" não pode ser silêncio.
//
// Achado da revisão de 12/11: a cópia de comissões (fin-comissoes) parou em
// 09/11 e ninguém soube; o tráfego Meta, o sync do Dashboard e a IA dos docs
// "pulam" quando falta variável de ambiente e respondem 200 como se estivesse
// tudo bem. Este arquivo dá a cada cron um rastro no banco e ao /api/qs-alertas
// a regra pra cobrar quando o rastro envelhece ou quando a rotina está pulando.
//
// RASTRO: uma linha por rotina em qs_settings, chave `rotina_pulso:<id>`, valor
//   { em, status: 'ok'|'pulado'|'erro', motivo, ok_em }
//   - em     = última vez que o cron RODOU (qualquer desfecho);
//   - ok_em  = última vez que terminou BEM (só muda com status 'ok').
// Sem migration (qs_settings já existe) e sem env nova. Gravado pelo service
// role; lido pelos logados (a policy de leitura de qs_settings) — não tem
// segredo nenhum aqui, só horário e motivo.
//
// Gravar NUNCA derruba a rotina: qualquer falha aqui vira console.warn.
//
// PRA PÔR UMA ROTINA NOVA: (1) acrescente em ROTINAS abaixo; (2) no cron chame
// `await pulso('<id>', { status, motivo })` no fim (ok / pulado / erro).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const MIN = 60_000;
const HORA = 60 * MIN;
export const PREFIXO = 'rotina_pulso:';

/**
 * Catálogo: o que cada rotina faz e de quanto em quanto tempo ela PRECISA ter
 * dado certo (folga já embutida — ~3 a 6 rodadas perdidas antes de acusar).
 * `cron` é só documentação (o horário mora no vercel.json).
 */
export const ROTINAS = {
  'fin-comissoes': { nome: 'Comissões (cópia do Dashboard → Financeiro)', cron: '11,41 * * * *', toleranciaMs: 3 * HORA },
  'dashboard-sync': { nome: 'Envio das reuniões pro Dashboard', cron: '*/5 * * * *', toleranciaMs: 45 * MIN },
  'mkt-trafego': { nome: 'Tráfego Meta (leitura e travas)', cron: '7,37 * * * *', toleranciaMs: 3 * HORA },
  'mkt-grupos': { nome: 'Grupos do Marketing (motor de envio)', cron: '* * * * *', toleranciaMs: 20 * MIN },
  'meet-gravacoes': { nome: 'Gravações do Meet', cron: '7-59/15 * * * *', toleranciaMs: 2 * HORA },
  'rel-docs-ia': { nome: 'Conferência de documentos por IA (Relacionamento)', cron: '15 */2 * * *', toleranciaMs: 7 * HORA },
};

const ehObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Valor novo do rastro a partir do anterior (puro — testável). */
export function proximoPulso(anterior, { status = 'ok', motivo = null } = {}, agoraMs = Date.now()) {
  const em = new Date(agoraMs).toISOString();
  const st = ['ok', 'pulado', 'erro'].includes(status) ? status : 'ok';
  return {
    em,
    status: st,
    motivo: motivo == null ? null : String(motivo).slice(0, 300),
    ok_em: st === 'ok' ? em : (ehObj(anterior) ? anterior.ok_em ?? null : null),
  };
}

/** Mesmo desfecho gravado há menos de `minIntervaloMs`: não precisa regravar. */
export function podePular(anterior, { status = 'ok', motivo = null } = {}, agoraMs, minIntervaloMs) {
  if (!minIntervaloMs || !ehObj(anterior) || anterior.status !== status) return false;
  if ((anterior.motivo ?? null) !== (motivo == null ? null : String(motivo).slice(0, 300))) return false;
  const em = Date.parse(anterior.em || '');
  return Number.isFinite(em) && agoraMs - em < minIntervaloMs;
}

/**
 * Registra que a rotina rodou. Nunca lança. `minIntervaloMs` (cron de minuto em
 * minuto) evita regravar o mesmo desfecho a cada rodada.
 */
export async function pulso(rotina, desfecho = {}, { minIntervaloMs = 0 } = {}) {
  try {
    const chave = `${PREFIXO}${rotina}`;
    const rows = await rest(`qs_settings?select=value&key=eq.${encodeURIComponent(chave)}&limit=1`, { timeoutMs: 5_000 });
    const anterior = Array.isArray(rows) ? rows[0]?.value : null;
    if (podePular(anterior, desfecho, Date.now(), minIntervaloMs)) return;
    await rest('qs_settings?on_conflict=key', {
      method: 'POST',
      body: { key: chave, value: proximoPulso(anterior, desfecho), updated_at: new Date().toISOString() },
      prefer: 'resolution=merge-duplicates,return=minimal',
      timeoutMs: 5_000,
    });
  } catch (e) {
    console.warn(`[rotina-pulso] ${rotina}:`, String(e?.message || e).slice(0, 200));
  }
}

const quando = (ms) => {
  if (!Number.isFinite(ms)) return 'nunca';
  const h = ms / HORA;
  return h < 1 ? `há ${Math.round(ms / MIN)} min` : h < 48 ? `há ${h.toFixed(1).replace('.', ',')} h` : `há ${Math.round(h / 24)} dias`;
};

/**
 * Regra (pura): recebe { [id]: valorDoPulso } e devolve a lista de alertas.
 *  - parada:  o cron não RODA há mais que a tolerância (morreu, saiu do vercel.json, 401…);
 *  - pulando: rodou, mas pulou (falta env/config) e não dá certo há mais que a tolerância;
 *  - falhando: rodou com erro e não dá certo há mais que a tolerância.
 * Rotina sem rastro nenhum (ainda não publicada) não acusa.
 */
export function regraRotinas(pulsos, agoraMs, catalogo = ROTINAS) {
  const alertas = [];
  for (const [id, cfg] of Object.entries(catalogo)) {
    const p = pulsos?.[id];
    if (!ehObj(p)) continue;
    const em = Date.parse(p.em || '');
    const okEm = Date.parse(p.ok_em || '');
    const desdeRodou = Number.isFinite(em) ? agoraMs - em : Infinity;
    const desdeOk = Number.isFinite(okEm) ? agoraMs - okEm : Infinity;
    if (desdeRodou > cfg.toleranciaMs) {
      alertas.push({
        id: `rotina_parada:${id}`,
        nivel: 'alto',
        titulo: `Automação parada: ${cfg.nome}`,
        texto: `Não roda ${quando(desdeRodou)} (o normal é ${cfg.cron}). Conferir o cron na Vercel.`,
      });
      continue;
    }
    if (desdeOk <= cfg.toleranciaMs) continue;
    if (p.status === 'pulado') {
      alertas.push({
        id: `rotina_pulando:${id}`,
        nivel: 'alto',
        titulo: `Automação pulando: ${cfg.nome}`,
        texto: `Roda mas não faz nada: ${p.motivo || 'falta configuração'}. Último sucesso ${quando(desdeOk)}.`,
      });
    } else if (p.status === 'erro') {
      alertas.push({
        id: `rotina_falhando:${id}`,
        nivel: 'alto',
        titulo: `Automação falhando: ${cfg.nome}`,
        texto: `Último erro: ${p.motivo || 'sem detalhe'}. Último sucesso ${quando(desdeOk)}.`,
      });
    }
  }
  return alertas;
}

/**
 * Rastro que já existia antes do pulso: fin_com_sync (id=1) { rodou_em, erro }.
 * Vira um pulso "equivalente" pra rotina de comissões, pra o alerta valer já
 * (o fin-comissoes só grava ali quando roda configurado — por isso a parada de
 * 09/11 ficou invisível). Se houver pulso de verdade, o mais novo vence.
 */
export function pulsoDaFinComSync(linha) {
  if (!ehObj(linha) || !linha.rodou_em) return null;
  const st = linha.erro ? 'erro' : 'ok';
  return { em: linha.rodou_em, status: st, motivo: linha.erro || null, ok_em: st === 'ok' ? linha.rodou_em : null };
}

function maisNovo(a, b) {
  if (!ehObj(a)) return b;
  if (!ehObj(b)) return a;
  return (Date.parse(b.em || '') || 0) > (Date.parse(a.em || '') || 0) ? { ...b, ok_em: b.ok_em || a.ok_em } : { ...a, ok_em: a.ok_em || b.ok_em };
}

/** Checagem no formato do /api/qs-alertas: { dados, alertas }. */
export async function checarRotinas(agoraMs) {
  const rows = await rest(`qs_settings?select=key,value&key=like.${encodeURIComponent(PREFIXO)}*`);
  const pulsos = {};
  for (const r of Array.isArray(rows) ? rows : []) pulsos[String(r.key).slice(PREFIXO.length)] = r.value;
  try {
    const fin = await rest('fin_com_sync?select=rodou_em,erro&id=eq.1&limit=1');
    const legado = pulsoDaFinComSync(Array.isArray(fin) ? fin[0] : null);
    if (legado) pulsos['fin-comissoes'] = maisNovo(pulsos['fin-comissoes'], legado);
  } catch { /* tabela ausente: segue só com os pulsos */ }
  const dados = Object.fromEntries(Object.keys(ROTINAS).map((id) => [id, pulsos[id] ? { em: pulsos[id].em, status: pulsos[id].status, ok_em: pulsos[id].ok_em } : 'sem rastro ainda']));
  return { dados, alertas: regraRotinas(pulsos, agoraMs) };
}
