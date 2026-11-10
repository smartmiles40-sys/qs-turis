// api/_linkAgendamento.js
// -----------------------------------------------------------------------------
// LINKS DE AGENDAMENTO DO MARKETING (0354, Bruno 10/11/2026)
//   "o pessoal do marketing conseguir criar esses links e já deixar traqueado tudo"
//
// O /agendar/ recebe da URL: utm_source…utm_term e `l` (o código do link criado
// em Marketing › Links de agendamento). Aqui:
//   • utmDoCorpo(): as UTMs que a página mandou (limpas, só as preenchidas);
//   • registrarUso(): grava o agendamento no link (mkt_link_agendamento_usos);
//   • linhaDeRastro(): o texto que vai na nota do lead e no resumo da reunião.
// Tudo best-effort: falhar o rastro NUNCA derruba o agendamento do cliente.
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';
import { completarUtmNoNegocio } from './_bitrixLead.js';

const CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export const CODIGO_RE = /^[a-z0-9-]{3,60}$/;

/** As UTMs do corpo do POST — só as preenchidas, até 255 caracteres. Puro. */
export function utmDoCorpo(body) {
  const out = {};
  for (const k of CAMPOS) {
    const v = body?.[k];
    const t = typeof v === 'string' ? v.trim().slice(0, 255) : '';
    if (t) out[k] = t;
  }
  return out;
}

/** O código do link (`l`), ou null se não for um código possível. Puro. */
export function codigoDoCorpo(body) {
  const c = typeof body?.link === 'string' ? body.link.trim().toLowerCase() : '';
  return CODIGO_RE.test(c) ? c : null;
}

/** "Link: Japão stories · utm_source=instagram · utm_campaign=japao-27". Puro. */
export function linhaDeRastro(utm, nomeLink = null) {
  const partes = [nomeLink ? `Link: ${nomeLink}` : null, ...CAMPOS.filter((k) => utm?.[k]).map((k) => `${k}=${utm[k]}`)].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** O link ativo pelo código (ou null). */
export async function lerLink(codigo) {
  if (!codigo) return null;
  try {
    const rows = await rest(`mkt_links_agendamento?select=id,nome,tipo&codigo=eq.${encodeURIComponent(codigo)}&arquivado_em=is.null&limit=1`, { timeoutMs: 2500 });
    return rows?.[0] || null;
  } catch (e) {
    console.warn('[link-agendamento] leitura (0354 aplicada?):', e?.message);
    return null;
  }
}

/** Grava o agendamento no link. */
export async function registrarUso({ link, tipo, leadId, meetingId = null, ligacaoId = null, quando = null }) {
  if (!link?.id) return;
  await insert('mkt_link_agendamento_usos', {
    link_id: link.id, lead_id: leadId || null, meeting_id: meetingId, ligacao_id: ligacaoId, tipo, quando,
  }, { returning: false }).catch((e) => console.warn('[link-agendamento] uso não gravado:', e?.message));
}

/** Lead que voltou (card já existia): UTMs só nos campos vazios do negócio. */
export async function utmNoCardExistente(lead, utm, deduped) {
  if (!deduped || !lead?.bitrix_id || !Object.keys(utm || {}).length) return;
  await completarUtmNoNegocio(lead.bitrix_id, utm);
}
