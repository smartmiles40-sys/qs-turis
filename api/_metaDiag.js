// api/_metaDiag.js
// -----------------------------------------------------------------------------
// DIAGNÓSTICO DA META SEM LOGIN (23/09/2026) — pra quem dá suporte ao QS testar
// a configuração da Cloud API de fora, sem abrir tela nenhuma e SEM ver chave.
//
// Protegido por QS_DIAG_SECRET (header x-qs-diag). Devolve só fatos que não
// são segredo: se o número existe, os ids, se o app está assinado na conta,
// pra onde aponta o webhook, os campos assinados e se o token expira. Nunca
// devolve token, app secret nem verify token.
// -----------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto';
import { credenciaisDaMeta, graph, apontarWebhookProQs } from './_meta.js';

export function diagAutorizado(req) {
  const esperado = String(process.env.QS_DIAG_SECRET || '').trim();
  const veio = String(req.headers['x-qs-diag'] || '').trim();
  if (!esperado || !veio || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}

async function tenta(fn) {
  try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, erro: e?.message, codigo: e?.metaCode ?? null }; }
}

export async function diagnosticoMeta() {
  const env = {
    META_CALLS_TOKEN: Boolean(process.env.META_CALLS_TOKEN || process.env.META_WA_TOKEN),
    META_PHONE_NUMBER_ID: String(process.env.META_PHONE_NUMBER_ID || '').trim() || null,
    META_WABA_ID: String(process.env.META_WABA_ID || '').trim() || null,
    META_CALLS_APP_ID: String(process.env.META_CALLS_APP_ID || '').trim() || null,
    META_CALLS_APP_SECRET: Boolean(process.env.META_CALLS_APP_SECRET),
    META_CALLS_VERIFY_TOKEN: Boolean(process.env.META_CALLS_VERIFY_TOKEN),
  };
  const cr = await credenciaisDaMeta();
  const out = { env, padrao: cr ? { phoneId: cr.phoneId, waba: cr.waba, origem: cr.origem, origemWaba: cr.origemWaba } : null };
  if (!cr) return out;
  const token = cr.token;

  // O token: de quem é, se expira, quais permissões e quais contas enxerga.
  out.token = await tenta(async () => {
    const r = await fetch(`https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const d = (await r.json())?.data || {};
    return {
      app: d.app_id || null, tipo: d.type || null, valido: d.is_valid ?? null,
      expira: d.expires_at ? (d.expires_at === 0 ? 'nunca' : new Date(d.expires_at * 1000).toISOString()) : 'nunca',
      permissoes: d.scopes || [],
      contas: (d.granular_scopes || []).map((g) => ({ escopo: g.scope, ids: g.target_ids || [] })),
    };
  });

  // O número: existe? este token enxerga? qual status?
  out.numero = await tenta(async () => graph(
    `/${cr.phoneId}?fields=display_phone_number,verified_name,status,code_verification_status,quality_rating,messaging_limit_tier,platform_type,name_status`,
    { token }
  ));

  if (cr.waba) {
    out.conta = await tenta(async () => graph(`/${cr.waba}?fields=id,name`, { token }));
    out.numerosDaConta = await tenta(async () => ({
      lista: ((await graph(`/${cr.waba}/phone_numbers?fields=id,display_phone_number,verified_name,status`, { token }))?.data || []),
    }));
    out.appsAssinados = await tenta(async () => ({
      lista: ((await graph(`/${cr.waba}/subscribed_apps`, { token }))?.data || [])
        .map((a) => ({ id: a?.whatsapp_business_api_data?.id, nome: a?.whatsapp_business_api_data?.name })),
    }));
  }

  const appId = env.META_CALLS_APP_ID;
  const secret = String(process.env.META_CALLS_APP_SECRET || '').trim();
  if (appId && secret) {
    out.webhookDoApp = await tenta(async () => {
      const j = await graph(`/${appId}/subscriptions`, { token: `${appId}|${secret}` });
      const wa = (j?.data || []).find((x) => x?.object === 'whatsapp_business_account');
      return {
        callback: wa?.callback_url || null,
        ativo: wa?.active ?? null,
        campos: (wa?.fields || []).map((f) => (typeof f === 'string' ? f : f?.name)),
      };
    });
  }
  return out;
}

export { apontarWebhookProQs };
