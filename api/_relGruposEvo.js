// api/_relGruposEvo.js
// -----------------------------------------------------------------------------
// O "miolo" da ligação dos grupos com a Evolution (28/10/2026), separado de
// api/rel-grupos.js pra que as ações novas (api/_relGruposMais.js) usem as
// MESMAS travas. REGRA DO BRUNO, sem exceção: por essa instância só GRUPO.
//   • ehGrupo / grupoLiberado: todo envio passa por aqui e recusa o que não é
//     um grupo já conhecido (rel_wa_grupos, sem saiu_em) — nunca sai pra pessoa.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

export const INSTANCIA = () => String(process.env.REL_GRUPOS_INSTANCIA || 'relacionamento-grupos-4183');
const EVO_URL = () => String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
export const NUMERO = () => String(process.env.REL_GRUPOS_NUMERO || '5511980124183');
export const inst = () => encodeURIComponent(INSTANCIA());

// Endereço de grupo do WhatsApp: "1203634…@g.us" (ou o formato antigo "5511…-1612…@g.us").
const JID_GRUPO = /^[0-9]+(-[0-9]+)?@g\.us$/;
export const ehGrupo = (jid) => JID_GRUPO.test(String(jid || ''));

export function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export async function evo(caminho, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const base = EVO_URL();
  const chave = process.env.EVOLUTION_APIKEY;
  if (!base || !chave) throw new Error('Evolution não configurada (EVOLUTION_URL / EVOLUTION_APIKEY).');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}${caminho}`, {
      method,
      headers: { apikey: chave, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await r.text();
    const json = safeParse(txt);
    if (!r.ok) throw new Error(`Evolution ${r.status}: ${txt.slice(0, 200)}`);
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('A Evolution demorou demais pra responder.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Trava de TODO envio/mudança pela Evolution: só grupo já conhecido e em que o
 * número ainda está. Devolve a linha do grupo (pra quem precisar de eu_admin).
 */
export async function grupoLiberado(jid) {
  if (!ehGrupo(jid)) throw new Error('Destino não é grupo — envio bloqueado.');
  const g = (await rest(`rel_wa_grupos?select=*&jid=eq.${encodeURIComponent(jid)}&limit=1`))?.[0];
  if (!g) throw new Error('Grupo desconhecido — envio bloqueado.');
  if (g.saiu_em) throw new Error('O número não está mais nesse grupo.');
  return g;
}

/** A chave de uma mensagem do grupo como o WhatsApp quer (pra citar, reagir, apagar, editar). */
export function chaveDe(m) {
  return { remoteJid: m.grupo_jid, fromMe: Boolean(m.de_mim), id: m.msg_id, ...(m.de_mim ? {} : { participant: m.autor_participante || m.autor_jid || undefined }) };
}

/** "*Nome:*\n" — tudo que sai pelo QS vai assinado com o nome de quem mandou. */
export const assinatura = (u) => String(u?.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';

/**
 * Grava/atualiza mensagem de grupo pelo msg_id. Se o banco ainda não tem as
 * colunas da 0219 (status, encaminhada), grava sem elas em vez de perder a mensagem.
 */
export async function gravarMsg(opcoes) {
  const caminho = 'rel_wa_grupo_mensagens?on_conflict=msg_id';
  try { return await rest(caminho, opcoes); }
  catch (e) {
    if (!/column|schema cache/i.test(String(e?.message || ''))) throw e;
    const body = { ...opcoes.body };
    delete body.status; delete body.encaminhada;
    return rest(caminho, { ...opcoes, body });
  }
}

/** Registra a mensagem que o número mandou (o webhook pode chegar antes ou depois — merge pelo msg_id). */
export async function registrarSaida(linha) {
  if (!linha?.msg_id) return;
  const { previa: _p, ...campos } = linha;
  await gravarMsg({
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { de_mim: true, status: 'enviada', criado_em: new Date().toISOString(), ...campos },
  }).catch(() => null);
  await rest('rpc/rel_wa_grupo_nova_msg', {
    method: 'POST',
    body: { p_jid: linha.grupo_jid, p_quando: new Date().toISOString(), p_previa: String(linha.previa || linha.texto || '').slice(0, 140), p_de_mim: true, p_mencionou: false },
  }).catch(() => null);
}

/**
 * Os ids do PRÓPRIO número nos grupos: o telefone e os códigos @lid. O @lid não
 * vem em lugar nenhum de graça — a gente aprende quando o número manda mensagem
 * num grupo (key.participant da mensagem fromMe) e guarda em rel_config.
 */
let cacheMeus = null;
export async function meusIds(key) {
  if (!cacheMeus) {
    const r = (await rest("rel_config?select=valor&chave=eq.rel_grupos_meus_ids&limit=1").catch(() => null))?.[0]?.valor;
    cacheMeus = new Set(Array.isArray(r) ? r : []);
    cacheMeus.add(`${NUMERO()}@s.whatsapp.net`);
  }
  const novo = key?.fromMe ? [key.participant, key.participantAlt].filter((x) => x && !cacheMeus.has(x)) : [];
  if (novo.length) {
    novo.forEach((x) => cacheMeus.add(x));
    await rest('rel_config?on_conflict=chave', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { chave: 'rel_grupos_meus_ids', valor: [...cacheMeus] } }).catch(() => null);
  }
  return cacheMeus;
}
