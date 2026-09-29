// api/lead-site.js
// -----------------------------------------------------------------------------
// O FORMULÁRIO CURTO DAS PÁGINAS SEM FORMULÁRIO (Bruno, 29/09/2026).
//
// "Estamos tendo muitos problemas com separação de lead dos SDRs, então para
// acabar com o problema, vamos deixar tudo com as automações do QS de
// distribuição."
//
// Pacotes, portal e qualquer botão "Falar no WhatsApp" não abrem mais o
// WhatsApp de ninguém. Abrem um formulário curto (nome, WhatsApp, e-mail) que
// chega AQUI, e daqui o lead segue o MESMO caminho de qualquer lead do QS:
// createInboundLead → dono pela distribuição do QS → cadência → negócio no
// Bitrix com esse dono como responsável. Nenhuma página escolhe SDR.
//
//   POST /api/lead-site
//   { nome, telefone, email?, destino, canal: 'Orgânico'|'Tráfego', origem?, site? }
//   → { ok: true }
//
// Pública como o /api/lead, com as mesmas travas: CORS pela allowlist
// (qs_settings.lp_origins), campo-armadilha `site`, teto por IP por hora.
// A resposta não diz quem virou dono — a página não precisa saber.
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { normPhone, createInboundLead } from './_leads.js';
import { lerConfig, origemPermitida, aplicarCors, chaveIp, texto } from './lead.js';

// A própria página de formulário do QS (/api/whatsapp) posta pra cá.
const ORIGEM_PROPRIA = 'https://qs-turis.vercel.app';

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const { origens, teto } = await lerConfig();
  const permitido = origin === ORIGEM_PROPRIA || origemPermitida(origin, origens);

  res.setHeader('Cache-Control', 'no-store');
  aplicarCors(res, origin, permitido);

  if (req.method === 'OPTIONS') return res.status(permitido ? 204 : 403).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }
  if (origin && !permitido) return res.status(403).json({ ok: false, error: 'Origem não autorizada' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};

  // Robô preencheu o campo escondido: responde ok e não cria nada.
  if (texto(body.site, 200)) return res.status(200).json({ ok: true });

  const nome = texto(body.nome, 120);
  const telefone = normPhone(body.telefone);
  const email = texto(body.email, 160);
  const destino = texto(body.destino, 60) || 'Site';
  const canal = /tr[aá]fego/i.test(String(body.canal || '')) ? 'Tráfego' : 'Orgânico';

  if (!nome) return res.status(400).json({ ok: false, error: 'Informe seu nome' });
  if (!telefone || telefone.length < 10) return res.status(400).json({ ok: false, error: 'WhatsApp inválido' });

  try {
    const chave = chaveIp(req);
    if (chave) {
      const ok = await rest('rpc/qs_lp_rate_bump', { method: 'POST', body: { p_chave: chave, p_teto: teto }, timeoutMs: 2000 });
      if (ok === false) return res.status(429).json({ ok: false, error: 'Muitos envios. Tente de novo em alguns minutos.' });
    }
  } catch (e) {
    console.warn('[lead-site] limite por IP indisponível:', e?.message || e);
  }

  try {
    // Fonte no formato do Bitrix ("[Destino] - Orgânico|Tráfego"): é por ela
    // que o QS sabe que o lead é de página (e as regras de temperatura/vídeo).
    const { lead, deduped } = await createInboundLead({
      full_name: nome,
      phone: telefone,
      email,
      segment: `[${destino}] - ${canal}`,
      source: 'integracao',
    });
    console.log('[lead-site] lead', lead?.id || '-', deduped ? '(já existia)' : '(novo)', `[${destino}] - ${canal}`, texto(body.origem, 80) || '');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[lead-site]', err?.code || '', err?.message || err);
    return res.status(503).json({ ok: false, error: 'Não conseguimos registrar agora. Tente de novo em instantes.' });
  }
}
