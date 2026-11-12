// api/bitrix-entrada.js
// -----------------------------------------------------------------------------
// A PORTA DO BITRIX NO QS, SEM O n8n NO MEIO (corte do n8n, 03/11/2026).
//
//   POST|GET /api/bitrix-entrada?evento=<evento>&secret=<BITRIX_ENTRADA_SECRET>[&...]
//
// Eventos (cada um era um workflow do n8n):
//
//   lead              ← webhook n8n `qs-lead-inbound` (qs-bitrix-completo,
//                       bitrix-inbound-to-qs, qs-inbound-leads) e `qs-bitrix-inbound`
//                       (bitrix-to-qs, evento ONCRMDEALADD). Cria/acha o card
//                       pelo /api/lead-inbound. Aceita &lista=, &duplicar=1,
//                       &mover=1 como lá. &funil=25 ignora negócio de outro funil.
//   resgate           ← webhook n8n `qs-resgate`. É `lead` com lista=resgate e
//                       duplicar=1 FIXOS, mais os padrões do resgate (Fonte
//                       "Resgate", telefone com 55).
//   primeiro-contato  ← webhook n8n `lead-apresentacao`. Chama o /api/primeiro-contato.
//   atividade         ← webhook n8n `bitrix-atividade-concluida` (evento de saída
//                       ONCRMACTIVITYADD/UPDATE). Primeira atividade concluída
//                       move o negócio de "Novo Lead" pra "Follow-up 1".
//
// POR QUE UMA ROTA NOVA, E NÃO MEXER NO lead-inbound/primeiro-contato:
// aquelas duas falam um contrato limpo (JSON + header x-lead-secret) que o site,
// o stfv-forms e os testes já usam. O Bitrix não manda header, manda campo com
// maiúscula e corpo form-urlencoded. Em vez de ensinar esse dialeto a cada rota,
// esta aqui TRADUZ e chama o handler que já existe — porteiro do 1935, dedupe,
// listas, primeiro contato e Glória continuam morando num lugar só.
//
// AUTENTICAÇÃO (fail-closed): o Bitrix não manda header custom, então vale
//   • `?secret=` igual a BITRIX_ENTRADA_SECRET, ou
//   • `auth[application_token]` (no corpo) igual a BITRIX_APP_TOKEN — é o token
//     que o Bitrix põe em todo evento do webhook de SAÍDA.
// Sem nenhuma das duas envs configurada, nada passa (503). O segredo é OUTRO,
// não o LEAD_INBOUND_SECRET: ele fica escrito na URL dos robôs, à vista de quem
// edita automação no Bitrix; vazar um não abre o outro.
//
// Envs: BITRIX_ENTRADA_SECRET e/ou BITRIX_APP_TOKEN (novas) · LEAD_INBOUND_SECRET
//       (o lead-inbound continua exigindo) · BITRIX_WEBHOOK_BASE (eventos
//       `atividade` e `lead` sem dados, que leem do Bitrix) · SUPABASE_*.
// -----------------------------------------------------------------------------

import leadInbound from './lead-inbound.js';
import primeiroContato from './primeiro-contato.js';
import { segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';
import {
  lerCorpo, achatar, pegar, leadDoBitrix, temIdentificador, completarPeloNegocio,
  idDaAtividade, processarAtividade, juntarUtm,
} from './_bitrixEntrada.js';

export const EVENTOS = ['lead', 'resgate', 'primeiro-contato', 'atividade'];

/** Quem está chamando é o nosso Bitrix? Exportado pros testes. */
export function autorizado(mapa, query, env = process.env) {
  const segredo = String(env.BITRIX_ENTRADA_SECRET || '').trim();
  const appToken = String(env.BITRIX_APP_TOKEN || '').trim();
  if (!segredo && !appToken) return { ok: false, status: 503, error: 'BITRIX_ENTRADA_SECRET / BITRIX_APP_TOKEN não configurados' };
  const recebido = typeof query?.secret === 'string' ? query.secret : '';
  if (segredo && segredoConfere(recebido, segredo)) return { ok: true };
  if (appToken && segredoConfere(pegar(mapa, 'auth[application_token]'), appToken)) return { ok: true };
  return { ok: false, status: 401, error: 'Não autorizado' };
}

const sim = (v) => /^(1|true|sim)$/i.test(String(v ?? ''));
const q1 = (v) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  const query = req.query || {};
  // A query vem primeiro: no robô do Bitrix é ali que estão os dados.
  // `secret` e `evento` são nossos e não entram no mapa do lead.
  const { secret: _s, evento: _e, ...queryDados } = query;
  const corpo = lerCorpo(req.body);
  const mapa = achatar(queryDados, corpo);

  const auth = autorizado(mapa, query);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const evento = String(q1(query.evento) || '').trim().toLowerCase();
  if (!EVENTOS.includes(evento)) {
    return res.status(400).json({ ok: false, error: `evento inválido — use ${EVENTOS.join(', ')}` });
  }

  // Log SEM PII: só o evento e as chaves que chegaram (é o que mostra, em 1
  // minuto, que o robô está mandando `Telefone` e não `telefone`).
  try { console.log(`[bitrix-entrada] ${evento} | chaves:`, Object.keys(mapa).filter((k) => !k.startsWith('auth')).join(', ')); } catch { /* ignora */ }

  try {
    if (evento === 'atividade') return await eventoAtividade(mapa, res);
    if (evento === 'primeiro-contato') return await eventoPrimeiroContato(mapa, req, res);
    return await eventoLead(evento, mapa, query, req, res);
  } catch (e) {
    console.error(`[bitrix-entrada] ${evento} falhou:`, e?.bitrix || '', e?.message || e);
    return res.status(502).json({ ok: false, error: 'Falha ao processar o evento', code: e?.bitrix || undefined });
  }
}

// ── lead / resgate ──────────────────────────────────────────────────────────

async function eventoLead(evento, mapa, query, req, res) {
  const resgate = evento === 'resgate';
  const lead = leadDoBitrix(mapa, { resgate });

  // ONCRMDEALADD ou robô que só manda `document_id`: os dados da pessoa não
  // vêm junto. Busca no negócio, como o workflow bitrix-to-qs fazia.
  const funil = String(q1(query.funil) || '').trim();
  const precisaDoNegocio = Boolean(lead.bitrix_id && (!temIdentificador(lead) || funil));
  let utmNegocio = null; // pro log: o negócio tinha UTM? (null = não foi lido)
  if (precisaDoNegocio) {
    if (!bitrixConfigurado()) {
      return res.status(503).json({ ok: false, error: 'BITRIX_WEBHOOK_BASE não configurado — não dá pra ler o negócio' });
    }
    const achado = await completarPeloNegocio(lead.bitrix_id, bx);
    if (!achado) return res.status(404).json({ ok: false, error: `Negócio ${lead.bitrix_id} não encontrado no Bitrix` });
    // Evento de saída dispara pra TODO negócio, de qualquer funil. Com &funil=
    // a gente ignora o que não é do funil pedido (ex.: Ops e Rel).
    if (funil && String(achado.deal.CATEGORY_ID ?? '') !== funil) {
      return res.status(200).json({ ok: true, ignorado: true, motivo: 'outro_funil', funil: String(achado.deal.CATEGORY_ID ?? '') });
    }
    const { utm_source, utm_medium, utm_campaign, utm_content, utm_term, ...pessoa } = achado.campos;
    for (const [k, v] of Object.entries(pessoa)) if (lead[k] == null) lead[k] = v;
    utmNegocio = { utm_source, utm_medium, utm_campaign, utm_content, utm_term };
  } else if (lead.bitrix_id && bitrixConfigurado()) {
    // UTM SEMPRE (12/11/2026): 1.021 de 1.022 leads de 30 dias chegaram sem UTM
    // porque o negócio só era lido quando faltava nome/telefone ou com &funil=.
    // Agora toda entrada com negócio lê o negócio UMA vez (só o deal, sem o
    // contato — a pessoa já veio na URL). Best-effort: falhar aqui não pode
    // impedir o lead de entrar.
    try {
      const achado = await completarPeloNegocio(lead.bitrix_id, bx, { semContato: true });
      if (achado) {
        const c = achado.campos;
        utmNegocio = { utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign, utm_content: c.utm_content, utm_term: c.utm_term };
      }
    } catch (e) {
      console.warn('[bitrix-entrada] leitura das UTMs do negócio falhou (segue sem):', e?.bitrix || '', String(e?.message || '').slice(0, 120));
    }
  }
  // A UTM boa que veio pela URL não é sobrescrita; o negócio completa o resto.
  const origemUtm = juntarUtm(lead, utmNegocio);
  // Log sem PII: diz, em um dia de produção, se o problema é do QS ou se a UTM
  // nem chega ao negócio do Bitrix (negocio_com_utm=nao em todo lead pago).
  try {
    const temNoNegocio = utmNegocio ? Object.values(utmNegocio).some(Boolean) : null;
    console.log(`[bitrix-entrada] utm | negocio_lido=${utmNegocio ? 'sim' : 'nao'} negocio_com_utm=${temNoNegocio == null ? '-' : temNoNegocio ? 'sim' : 'nao'} origem=${JSON.stringify(origemUtm)}`);
  } catch { /* ignora */ }

  if (!temIdentificador(lead)) {
    return res.status(400).json({
      ok: false,
      error: 'Nenhum dado do lead veio na chamada (Nome, Telefone ou E-mail). No Bitrix, confira os parâmetros na URL do robô.',
      campos_recebidos: Object.keys(mapa).filter((k) => !k.startsWith('auth')),
    });
  }

  const segredoInterno = process.env.LEAD_INBOUND_SECRET;
  if (!segredoInterno) return res.status(500).json({ ok: false, error: 'LEAD_INBOUND_SECRET não configurado no servidor' });

  // Repassa ao /api/lead-inbound exatamente o que o n8n repassava. No resgate,
  // a lista e o card próprio são FIXOS — é isso que o endereço significa.
  const queryInterna = resgate
    ? { lista: 'resgate', duplicar: '1' }
    : {
        ...(q1(query.lista) ? { lista: String(q1(query.lista)) } : {}),
        ...(sim(q1(query.duplicar)) ? { duplicar: '1' } : {}),
        ...(sim(q1(query.mover)) ? { mover: '1' } : {}),
      };

  return leadInbound({
    method: 'POST',
    headers: { ...req.headers, 'x-lead-secret': segredoInterno, 'content-type': 'application/json' },
    query: queryInterna,
    body: lead,
  }, res);
}

// ── primeiro-contato ────────────────────────────────────────────────────────

async function eventoPrimeiroContato(mapa, req, res) {
  const segredoInterno = String(process.env.PRIMEIRO_CONTATO_SECRET || process.env.LEAD_INBOUND_SECRET || '').trim();
  if (!segredoInterno) return res.status(500).json({ ok: false, error: 'Segredo não configurado no servidor' });
  const body = {
    telefone: pegar(mapa, 'telefone', 'phone', 'whatsapp', 'celular'),
    origem: 'bitrix',
  };
  const leadId = pegar(mapa, 'lead_id');
  if (leadId) body.lead_id = leadId;
  return primeiroContato({
    method: 'POST',
    headers: { ...req.headers, 'x-lead-secret': segredoInterno, 'content-type': 'application/json' },
    query: {},
    body,
  }, res);
}

// ── atividade ───────────────────────────────────────────────────────────────

async function eventoAtividade(mapa, res) {
  const activityId = idDaAtividade(mapa);
  // Evento sem ID (ping/handshake do Bitrix): responde ok e não faz nada.
  if (!activityId) return res.status(200).json({ ok: true, ignorado: true, motivo: 'sem_id' });
  if (!bitrixConfigurado()) return res.status(503).json({ ok: false, error: 'BITRIX_WEBHOOK_BASE não configurado' });
  const r = await processarAtividade(activityId, bx);
  if (r.movido) console.log(`[bitrix-entrada] atividade ${activityId}: negócio ${r.deal_id} → Follow-up 1`);
  return res.status(200).json({ ok: true, ...r });
}
