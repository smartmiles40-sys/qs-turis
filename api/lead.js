// api/lead.js
// -----------------------------------------------------------------------------
// O ENDEREÇO QUE AS LANDING PAGES CHAMAM (Bruno, 04/09/2026).
//
// A pessoa envia o formulário na LP -> esta rota decide QUAL SDR vai atender,
// grava o bilhete (telefone -> SDR) e devolve o número de WhatsApp. A LP então
// redireciona pro wa.me daquele número.
//
// ELA NÃO CRIA O LEAD. Quem cria continua sendo o n8n, pelo /api/lead-inbound,
// exatamente como antes deste projeto existir. Quando aquele lead entra em
// qs_leads, o trigger trg_qs_assign_owner acha o bilhete pelo telefone e grava
// o MESMO SDR como dono do card — que é o que faz o Bitrix receber o
// responsável certo. Ver supabase/migrations/0076_pool_de_numeros.sql.
//
// Body (JSON): { nome, telefone, email, origem, expedicao, fila? }
// Resposta:    { ok, numero, sdr_nome, fallback }
//
// ── ESTA ROTA É PÚBLICA, E ISSO É DE PROPÓSITO ──────────────────────────────
// Ela roda no navegador do visitante, então não pode carregar segredo nenhum
// (diferente do lead-inbound, que exige x-lead-secret). As contenções são:
//   • CORS por allowlist (qs_settings.lp_origins) — não impede curl, mas impede
//     que outro site chame isto pelo navegador de terceiros;
//   • campo-armadilha (honeypot) — robô de formulário preenche tudo que vê;
//   • teto por IP por hora (qs_settings.lp_rate_limit);
//   • vocabulário fechado: nenhum campo do corpo vira coluna sem passar por aqui.
// O pior estrago possível continua sendo lead falso e roda girada — nada
// destrutivo, nada que apague dado.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { normPhone } from './_leads.js';

// Última linha de defesa se qs_settings.lp_origins sumir ou vier corrompido.
// Não é a fonte da verdade — a tabela é. Está aqui pra uma LP não parar de
// funcionar por causa de um jsonb malformado.
const ORIGENS_PADRAO = [
  'https://setuforeuvouviagens.com.br',
  'https://live.setuforeuvouviagens.com.br',
  'https://forms.setuforeuvouviagens.com.br',
];

const TETO_PADRAO = 20;          // chamadas por IP por hora
const RPC_TIMEOUT_MS = 3500;     // acima disso a pessoa está esperando demais: cai no fallback

// Cache de processo pras configurações. A função serverless é reaproveitada
// entre chamadas, então isso economiza duas idas ao banco por lead sem impedir
// que uma mudança em qs_settings valha em poucos minutos.
let cacheCfg = { em: 0, origens: null, teto: null };
const CACHE_MS = 60_000;

async function lerConfig() {
  if (cacheCfg.origens && Date.now() - cacheCfg.em < CACHE_MS) return cacheCfg;
  try {
    const rows = await rest('qs_settings?select=key,value&key=in.(lp_origins,lp_rate_limit)', { timeoutMs: 2500 });
    const mapa = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    const origens = Array.isArray(mapa.lp_origins) && mapa.lp_origins.length
      ? mapa.lp_origins.filter((o) => typeof o === 'string')
      : ORIGENS_PADRAO;
    const teto = Number.isFinite(Number(mapa.lp_rate_limit)) ? Number(mapa.lp_rate_limit) : TETO_PADRAO;
    cacheCfg = { em: Date.now(), origens, teto };
  } catch {
    // Banco fora: segue com o padrão em vez de recusar a LP inteira.
    cacheCfg = { em: Date.now(), origens: ORIGENS_PADRAO, teto: TETO_PADRAO };
  }
  return cacheCfg;
}

/**
 * O Origin bate com a allowlist?
 *
 * Compara ORIGEM (esquema + host + porta), nunca "o host termina com...":
 * `endsWith('setuforeuvouviagens.com.br')` deixaria passar
 * `https://setuforeuvouviagens.com.br.evil.com`, que é um domínio de outra
 * pessoa. Comparação exata é a única que não tem esse buraco.
 */
function origemPermitida(origin, permitidas) {
  if (!origin) return false;
  let o;
  try { o = new URL(origin); } catch { return false; }
  const normal = `${o.protocol}//${o.host}`;
  return permitidas.some((p) => {
    try { const u = new URL(p); return `${u.protocol}//${u.host}` === normal; } catch { return false; }
  });
}

function aplicarCors(res, origin, permitido) {
  if (permitido) res.setHeader('Access-Control-Allow-Origin', origin);
  // Sem Vary: Origin, um CDN/proxy no meio serviria pra LP B o cabeçalho que
  // liberava a LP A. Junto com o no-store abaixo, fecha o assunto de cache.
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Hash do IP. Guardar o IP cru só pra contar chamadas é dado pessoal a mais
 * (LGPD) sem ganho nenhum: o hash conta igual. O sal é o LEAD_INBOUND_SECRET
 * (já existe e é server-side); sem sal, uma tabela de hashes de IPv4 é
 * reversível por força bruta em minutos.
 */
function chaveIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.socket?.remoteAddress || '';
  if (!ip) return '';
  const sal = process.env.LEAD_INBOUND_SECRET || 'qs-lp';
  return createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Texto de campo de formulário: corta tamanho e tira caracteres de controle.
 * Casar com control char é o objetivo aqui — é assim que um \n ou um \0 vindo do
 * formulário para de entrar no banco e de sujar linha de log.
 */
function texto(v, max) {
  if (v == null) return null;
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\x00-\x1F\x7F]/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function responder(res, numero, sdrNome, fallback) {
  return res.status(200).json({ ok: true, numero, sdr_nome: sdrNome, fallback });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const { origens, teto } = await lerConfig();
  const permitido = origemPermitida(origin, origens);

  // NUNCA cacheia. Duas pessoas diferentes têm que receber SDRs diferentes; uma
  // resposta guardada por CDN entregaria o mesmo número pra fila inteira e
  // quebraria a distribuição sem sintoma nenhum além de "o rodízio não gira".
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  aplicarCors(res, origin, permitido);

  if (req.method === 'OPTIONS') {
    return res.status(permitido ? 204 : 403).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  // Origin ausente (curl, server-to-server) passa; Origin PRESENTE e de fora,
  // não. O navegador de terceiro sempre manda Origin — é ele que estamos
  // barrando. Bloquear a ausência quebraria teste por curl e pré-visualização.
  if (origin && !permitido) {
    return res.status(403).json({ ok: false, error: 'Origem não autorizada' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};

  // CAMPO-ARMADILHA. A LP tem um input escondido chamado `site`; gente não vê,
  // robô de formulário preenche. Responde 200 com o fallback pra não ensinar o
  // robô qual campo o entregou — e, principalmente, NÃO gira a roda.
  if (texto(body.site, 200)) {
    return responder(res, process.env.WHATSAPP_FALLBACK || null, null, true);
  }

  const nome      = texto(body.nome, 120);
  const telefone  = normPhone(body.telefone);
  const email     = texto(body.email, 160);
  const origem    = texto(body.origem, 80);
  const expedicao = texto(body.expedicao, 80);
  const fila      = texto(body.fila, 40) || 'forms';

  const fallback = process.env.WHATSAPP_FALLBACK || null;

  // Telefone é o único campo obrigatório: é a chave do bilhete. Sem ele não há
  // como o trigger casar o lead do n8n com o SDR que atendeu.
  if (!telefone || telefone.length < 10) {
    return res.status(400).json({ ok: false, error: 'Telefone inválido' });
  }

  // ── TETO POR IP ───────────────────────────────────────────────────────────
  // Falha aberta de propósito: se o banco não responde, o limite não é aplicado
  // e o lead segue. Perder lead pago por causa do contador de abuso seria
  // trocar um problema hipotético por um prejuízo real.
  try {
    const chave = chaveIp(req);
    if (chave) {
      const ok = await rest('rpc/qs_lp_rate_bump', {
        method: 'POST',
        body: { p_chave: chave, p_teto: teto },
        timeoutMs: 2000,
      });
      if (ok === false) {
        console.warn('[lead] teto por IP atingido');
        return res.status(429).json({ ok: false, error: 'Muitos envios. Tente de novo em alguns minutos.' });
      }
    }
  } catch (e) {
    console.warn('[lead] limite por IP indisponível:', e?.message || e);
  }

  // ── A DECISÃO ─────────────────────────────────────────────────────────────
  try {
    const linhas = await rest('rpc/reservar_sdr', {
      method: 'POST',
      body: {
        p_nome: nome,
        p_telefone: telefone,
        p_email: email,
        p_origem: origem,
        p_expedicao: expedicao,
        p_fila: fila,
      },
      timeoutMs: RPC_TIMEOUT_MS,
    });

    const r = Array.isArray(linhas) ? linhas[0] : linhas;

    // Zero linhas = ninguém no rodízio (nenhum SDR ativo com número ativo).
    // Não é erro do banco: é o sinal combinado pra cair no fallback.
    if (!r || !r.numero) {
      console.warn('[lead] sem SDR no rodízio — caindo no WHATSAPP_FALLBACK');
      return responder(res, fallback, null, true);
    }

    return responder(res, r.numero, r.sdr_nome || null, false);
  } catch (err) {
    // Detalhe completo só no log da Vercel; pro navegador vai o fallback. A
    // pessoa é redirecionada de qualquer jeito — lead pago não morre na porta
    // por causa de um timeout do Postgres.
    console.error('[lead]', err?.code || '', err?.message || err, err?.details || '');
    if (!fallback) {
      // Sem fallback configurado não há o que devolver. 503 (e não 500) porque
      // é indisponibilidade temporária: a LP pode tentar de novo.
      return res.status(503).json({ ok: false, error: 'Nenhum número disponível no momento' });
    }
    return responder(res, fallback, null, true);
  }
}
