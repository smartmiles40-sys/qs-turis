// api/_mktGruposEvo.js
// -----------------------------------------------------------------------------
// A ÚNICA porta do QS para a instância Evolution do MARKETING (0243, 30/10/2026).
//
// Toda chamada à Evolution feita pelo Marketing passa por evoMkt(). Antes do
// fetch ela:
//   1) lê a instância configurada (mkt_grupos_conexao, uma linha só);
//   2) aplica a TRAVA (motivoBloqueioInstancia): recusa a instância do
//      Relacionamento (env REL_GRUPOS_INSTANCIA + 'relacionamento-grupos-4183'),
//      as instâncias dos SDRs (qs_wa_linhas), a lista do banco
//      (mkt_grupos_bloqueios), MKT_GRUPOS_PROIBIDAS, nome de outro setor e
//      nome sem "marketing"/"mkt"; e o número do Rel (REL_GRUPOS_NUMERO);
//   3) monta o caminho com a instância ELA MESMA (quem chama não passa nome de
//      instância) e confere que o caminho termina nela (caminhoDaInstancia).
// O banco tem a mesma trava (trigger em mkt_grupos_conexao e na fila).
//
// Servidor: MKT_EVOLUTION_URL / MKT_EVOLUTION_APIKEY (se o Marketing for pra
// uma Evolution só dele, como o SendFlow planejou) ou, na falta, a mesma
// EVOLUTION_URL / EVOLUTION_APIKEY do QS.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { motivoBloqueioInstancia, caminhoDaInstancia, normalizarInstancia } from './_mktGruposRegras.js';

const EVO_URL = () => String(process.env.MKT_EVOLUTION_URL || process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const EVO_KEY = () => String(process.env.MKT_EVOLUTION_APIKEY || process.env.EVOLUTION_APIKEY || '');
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/** A linha de configuração (ou null). */
export async function lerConexao() {
  return (await rest('mkt_grupos_conexao?select=*&id=eq.1&limit=1').catch(() => null))?.[0] || null;
}

/** Tudo que é de outro setor: env, SDRs e a lista do banco. */
export async function listasProibidas() {
  const [linhas, bloqueios] = await Promise.all([
    rest('qs_wa_linhas?select=instancia,numero').catch(() => []),
    rest('mkt_grupos_bloqueios?select=valor,tipo').catch(() => []),
  ]);
  const proibidas = [
    process.env.REL_GRUPOS_INSTANCIA, ...csv(process.env.MKT_GRUPOS_PROIBIDAS),
    ...(linhas || []).map((l) => l.instancia),
    ...(bloqueios || []).filter((b) => b.tipo === 'instancia').map((b) => b.valor),
  ].filter(Boolean);
  const numerosProibidos = [
    process.env.REL_GRUPOS_NUMERO, ...csv(process.env.NUMEROS_PROIBIDOS),
    ...(linhas || []).map((l) => l.numero),
    ...(bloqueios || []).filter((b) => b.tipo === 'numero').map((b) => b.valor),
  ].filter(Boolean);
  return { proibidas, numerosProibidos, fixada: process.env.MKT_GRUPOS_INSTANCIA || '' };
}

/** Confere uma instância candidata (antes de gravar na configuração). */
export async function conferirCandidata(instancia, numero) {
  return motivoBloqueioInstancia(instancia, numero, await listasProibidas());
}

/**
 * A trava. Devolve a conexão liberada ou LANÇA. Chamada a cada evoMkt —
 * barato (2 consultas) e é o que garante que mudar a configuração no meio de
 * uma rodada não deixa mensagem sair pela instância errada.
 */
export async function travaMkt() {
  const c = await lerConexao();
  if (!c?.instancia) { const e = new Error('Marketing sem instância configurada (Configurações do chip).'); e.trava = true; throw e; }
  const listas = await listasProibidas();
  const motivo = motivoBloqueioInstancia(c.instancia, c.numero, listas);
  if (motivo) { const e = new Error(`Trava do Marketing: ${motivo}`); e.trava = true; throw e; }
  return { ...c, __listas: listas };
}

/**
 * Chamada à Evolution PELA instância do Marketing.
 *   rota: 'message/sendText', 'group/findGroupInfos', 'instance/connectionState'…
 *   sufixo: querystring (ex.: '?groupJid=…')
 */
export async function evoMkt(rota, { method = 'GET', body, sufixo = '', timeoutMs = 20000, conexao } = {}) {
  const c = conexao?.__listas ? conexao : await travaMkt();
  // Confere DE NOVO aqui, colado no fetch — mesmo com a conexão vinda de fora.
  const motivo = motivoBloqueioInstancia(c.instancia, c.numero, c.__listas);
  if (motivo) { const e = new Error(`Trava do Marketing: ${motivo}`); e.trava = true; throw e; }
  const base = EVO_URL();
  const chave = EVO_KEY();
  if (!base || !chave) throw new Error('Evolution não configurada (MKT_EVOLUTION_URL/EVOLUTION_URL e a chave).');
  const caminho = `/${String(rota).replace(/^\/+|\/+$/g, '')}/${encodeURIComponent(c.instancia)}${sufixo}`;
  if (!caminhoDaInstancia(caminho, c.instancia)) throw new Error('Caminho da Evolution fora da instância do Marketing — bloqueado.');
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
    if (!r.ok) { const e = new Error(`Evolution ${r.status}: ${txt.slice(0, 200)}`); e.status = r.status; throw e; }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('A Evolution demorou demais pra responder.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Mesma trava, uma vez por rodada: devolve a conexão com as listas pra repassar ao evoMkt (que confere de novo). */
export const conexaoTravada = () => travaMkt();

/** O nome bate com a instância configurada? (webhook: ignora qualquer outra). */
export const ehAInstancia = (c, nome) => Boolean(c?.instancia) && normalizarInstancia(c.instancia) === normalizarInstancia(nome);
