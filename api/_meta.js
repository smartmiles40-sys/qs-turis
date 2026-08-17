// api/_meta.js
// -----------------------------------------------------------------------------
// Fala com a Graph API da Meta para gerenciar os MODELOS de mensagem do WhatsApp
// (o que o Gerenciador do WhatsApp Business faz na mão).
//
// De onde vêm as credenciais: da própria caixa oficial no Chatwoot. Quando o
// número da Cloud API foi ligado lá, o Chatwoot guardou `api_key` (token de
// usuário de sistema, que não expira), `phone_number_id` e `business_account_id`
// no provider_config da inbox. Reusar isso evita criar env nova — e evita ter o
// mesmo segredo em dois lugares, que é como um deles fica velho sem ninguém ver.
//
// ⚠️ O token NUNCA vai para o navegador. Toda chamada à Meta acontece aqui.
// -----------------------------------------------------------------------------

import { cw } from './_wa.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

let cache = null;   // { token, waba, phoneId, em } — vale por execução

/**
 * Acha a caixa da API oficial no Chatwoot e devolve as credenciais da Meta.
 * Devolve null quando não há caixa oficial configurada (aí o portal se desliga
 * sozinho em vez de estourar).
 */
export async function credenciaisDaMeta() {
  if (cache && Date.now() - cache.em < 5 * 60_000) return cache;
  try {
    const d = await cw('/inboxes');
    const lista = Array.isArray(d?.payload) ? d.payload : [];
    for (const i of lista) {
      if (!String(i.channel_type || '').includes('Channel::Whatsapp')) continue;
      const c = i.provider_config || {};
      if (!c.api_key || !c.business_account_id) continue;
      cache = { token: c.api_key, waba: c.business_account_id, phoneId: c.phone_number_id || null, em: Date.now() };
      return cache;
    }
  } catch (e) {
    console.warn('[meta] não consegui ler as credenciais no Chatwoot:', e?.message);
  }
  return null;
}

async function graph(path, { method = 'GET', body, token, timeoutMs = 12_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await r.json().catch(() => null);
    if (json?.error) {
      const err = new Error(json.error.error_user_msg || json.error.message || 'A Meta recusou');
      err.metaCode = json.error.code;
      err.status = r.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** TODOS os modelos, com status — é o que o admin precisa ver (não só os aprovados). */
export async function listarModelos() {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  const d = await graph(`/${cr.waba}/message_templates?limit=200`, { token: cr.token });
  const modelos = (d?.data || []).map((t) => {
    const comp = Array.isArray(t.components) ? t.components : [];
    const corpo = comp.find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
    const header = comp.find((c) => String(c.type).toUpperCase() === 'HEADER');
    return {
      id: t.id,
      nome: t.name,
      idioma: t.language,
      categoria: t.category,
      status: t.status,                       // APPROVED | PENDING | REJECTED | PAUSED
      motivo: t.rejected_reason || null,      // por que a Meta recusou
      corpo,
      cabecalho: header?.format === 'TEXT' ? header.text : null,
      cabecalhoMidia: header && header.format !== 'TEXT' ? header.format : null,
      rodape: comp.find((c) => String(c.type).toUpperCase() === 'FOOTER')?.text || null,
      variaveis: [...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]),
    };
  });
  return { modelos };
}

/**
 * Cria um modelo e manda pra análise da Meta.
 *
 * As regras que a Meta impõe e que a gente checa ANTES de mandar (erro dela vem
 * em inglês e sem contexto — melhor explicar aqui):
 *  • nome só com minúsculas, números e _;
 *  • variáveis numeradas em sequência a partir de 1 ({{1}}, {{2}}…);
 *  • corpo não pode começar nem terminar com variável;
 *  • categoria MARKETING | UTILITY (AUTHENTICATION tem regra própria).
 */
export async function criarModelo({ nome, categoria, idioma, corpo, cabecalho, rodape }) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };

  const problema = validarModelo({ nome, categoria, corpo });
  if (problema) return { erro: 'invalido', mensagem: problema };

  const components = [];
  if (cabecalho?.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: cabecalho.trim() });
  components.push({ type: 'BODY', text: corpo.trim() });
  if (rodape?.trim()) components.push({ type: 'FOOTER', text: rodape.trim() });

  try {
    const d = await graph(`/${cr.waba}/message_templates`, {
      method: 'POST',
      token: cr.token,
      body: { name: nome.trim(), category: categoria, language: idioma || 'pt_BR', components },
    });
    return { ok: true, id: d?.id, status: d?.status || 'PENDING' };
  } catch (e) {
    return { erro: 'meta-recusou', mensagem: e.message, codigo: e.metaCode };
  }
}

export async function excluirModelo(nome) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  try {
    await graph(`/${cr.waba}/message_templates?name=${encodeURIComponent(nome)}`, { method: 'DELETE', token: cr.token });
    return { ok: true };
  } catch (e) {
    return { erro: 'meta-recusou', mensagem: e.message, codigo: e.metaCode };
  }
}

/** Devolve a explicação do problema, ou null quando está tudo certo. */
export function validarModelo({ nome, categoria, corpo }) {
  const n = String(nome || '').trim();
  if (!n) return 'Dê um nome ao modelo.';
  if (!/^[a-z0-9_]+$/.test(n)) {
    return 'O nome só aceita letras minúsculas, números e _ (sem espaço, acento ou maiúscula). Ex.: retomada_outubro';
  }
  if (n.length > 512) return 'O nome está longo demais.';

  const c = String(corpo || '').trim();
  if (!c) return 'Escreva o texto da mensagem.';
  if (c.length > 1024) return 'O texto passa de 1024 caracteres — a Meta não aceita.';

  if (!['MARKETING', 'UTILITY'].includes(String(categoria))) {
    return 'Escolha a categoria: Utilidade (aviso, confirmação) ou Marketing (oferta, retomada).';
  }

  const vars = [...c.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1].trim());
  if (vars.length) {
    if (!vars.every((v) => /^\d+$/.test(v))) {
      return 'As variáveis precisam ser numeradas: use {{1}}, {{2}}… (não {{nome}}).';
    }
    const nums = vars.map(Number);
    const esperado = Array.from({ length: Math.max(...nums) }, (_, i) => i + 1);
    if (!esperado.every((e) => nums.includes(e))) {
      return `As variáveis têm que ser em sequência a partir de 1 — está faltando alguma de {{1}} a {{${Math.max(...nums)}}}.`;
    }
    if (/^\s*{{/.test(c) || /}}\s*$/.test(c)) {
      return 'O texto não pode começar nem terminar com variável — a Meta recusa. Escreva algo antes e depois.';
    }
  }
  return null;
}
