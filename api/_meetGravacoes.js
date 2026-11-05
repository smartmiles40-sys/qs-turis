// api/_meetGravacoes.js
// -----------------------------------------------------------------------------
// GRAVAÇÃO + TRANSCRIÇÃO DO GOOGLE MEET → CARD DO QS (05/11/2026, 0314).
//
// Bruno: "no nosso drive temos todas as gravações + transcrição". A reunião
// nasce na agenda da conta que organiza (especialista@agenciasetuforeuvou.com,
// GOOGLE_REFRESH_TOKEN — ver api/_google.js) e o QS guarda o
// qs_meetings.calendar_event_id. Quando a reunião é gravada, o Google ANEXA ao
// próprio evento da agenda: o vídeo (video/mp4), o Doc da transcrição e/ou o
// Doc das "Anotações do Gemini". Então o caminho é:
//
//   1. Calendar events.get(calendar_event_id, fields=attachments) — o token da
//      agenda (escopo …/auth/calendar) basta pra LER os anexos;
//   2. o texto do Doc: Drive files/{id}/export?mimeType=text/plain. O token da
//      agenda NÃO tem escopo de Drive (403 insufficient scope) — então tenta a
//      conta de serviço (GOOGLE_SA_*, a mesma do Drive do Marketing), que só
//      enxerga o arquivo se a pasta "Meet Recordings" tiver sido compartilhada
//      com o e-mail dela (ou com delegação de domínio, MEET_GRAVACAO_SA_SUB).
//      Sem nenhum dos dois: grava só os LINKS e diz em gravacao_erro o que falta.
//   3. reserva: evento sem anexo (ou reunião sem calendar_event_id) → busca no
//      Drive pelo código do Meet no nome do arquivo (só com a conta de serviço).
//
// Este arquivo NÃO fala com o Supabase nem com o Bitrix: o que é puro (escolha
// de anexos, código do Meet, quando tentar de novo, montagem do comentário) é
// testado em tests/meet/*.test.ts; a rota api/meet-gravacoes.js orquestra.
// -----------------------------------------------------------------------------

import { obterTokenGoogle, fetchComPrazo } from './_google.js';
import { calendarioPadrao } from './_googleAgenda.js';
import { lerCredenciais, assinarJwt, URL_TOKEN, API_DRIVE, escaparQ } from './_mktDriveGoogle.js';

const API_CAL = 'https://www.googleapis.com/calendar/v3';
export const ESCOPO_DRIVE_LEITURA = 'https://www.googleapis.com/auth/drive.readonly';
export const MIME_DOC = 'application/vnd.google-apps.document';

/** Conta que organiza as reuniões (só pra frase de erro; o token é o do _google.js). */
export const DONO_PADRAO = 'especialista@agenciasetuforeuvou.com';

/** Espera depois do fim da reunião antes da 1ª busca (o Google leva uns minutos pra processar). */
export const ESPERA_INICIAL_MIN = 20;
/** Depois disso sem achar nada, desiste: sem_gravacao. */
export const DESISTE_APOS_H = 48;
/** Se só achou um dos dois (vídeo OU texto), espera até aqui pelo outro antes de fechar como achada. */
export const ESPERA_O_OUTRO_H = 3;
/** Teto de tentativas (status erro — ex.: falta acesso — não fica tentando pra sempre). */
export const MAX_TENTATIVAS = 30;
/** Teto do texto guardado no QS. */
export const MAX_TEXTO = 200_000;
/** Teto do texto no comentário do Bitrix. */
export const MAX_TEXTO_BITRIX = 50_000;

const MIN = 60_000;
const H = 60 * MIN;

// ─── Puras ───────────────────────────────────────────────────────────────────

/** "https://meet.google.com/cuz-kdsr-ngw?authuser=0" → "cuz-kdsr-ngw" (ou null). */
export function codigoDoMeet(link) {
  const m = /meet\.google\.com\/(?:lookup\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i.exec(String(link || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** Id do arquivo do Drive a partir do anexo (fileId) ou da URL (/d/ID/ ou ?id=ID). */
export function idDoArquivo(anexo) {
  if (!anexo) return null;
  if (anexo.fileId && /^[A-Za-z0-9_-]{10,200}$/.test(anexo.fileId)) return anexo.fileId;
  const url = String(anexo.fileUrl || anexo.webViewLink || '');
  const m = /\/d\/([A-Za-z0-9_-]{10,200})/.exec(url) || /[?&]id=([A-Za-z0-9_-]{10,200})/.exec(url);
  return m ? m[1] : null;
}

const TRANSCRICAO = /transcri|transcript/i;
// Sem emoji em nada que vai pro Bitrix: o MySQL dele é utf8 de 3 bytes e corta o texto.
const GEMINI = /gemini|anota[cç][oõ]es|notes by/i;

/**
 * Dos anexos do evento (ou dos arquivos achados no Drive), separa:
 *   video       — a gravação (mimeType video/*)
 *   documento   — o Doc com o texto: a TRANSCRIÇÃO se houver; senão as
 *                 Anotações do Gemini (tipo 'gemini')
 * Docs que não são nem um nem outro (pauta anexada à mão etc.) são ignorados.
 */
export function escolherAnexos(anexos) {
  const lista = (Array.isArray(anexos) ? anexos : []).filter((a) => a && (a.fileUrl || a.fileId || a.webViewLink));
  const video = lista.find((a) => String(a.mimeType || '').startsWith('video/')) || null;
  const docs = lista.filter((a) => a.mimeType === MIME_DOC);
  const transcricao = docs.find((a) => TRANSCRICAO.test(String(a.title || a.name || ''))) || null;
  const gemini = docs.find((a) => a !== transcricao && GEMINI.test(String(a.title || a.name || ''))) || null;
  const doc = transcricao || gemini;
  return {
    video: video ? { id: idDoArquivo(video), url: video.fileUrl || video.webViewLink || null, titulo: video.title || video.name || null } : null,
    documento: doc
      ? { id: idDoArquivo(doc), url: doc.fileUrl || doc.webViewLink || null, titulo: doc.title || doc.name || null, tipo: transcricao ? 'transcricao' : 'gemini' }
      : null,
  };
}

/** Fim da reunião: ends_at, senão início + duração (30 min se não houver, igual ao qs_meetings_fill). */
export function fimDaReuniao(m) {
  if (m?.ends_at) return new Date(m.ends_at).getTime();
  const ini = new Date(m?.scheduled_at || 0).getTime();
  return ini + Math.max(1, Number(m?.duration_min) || 30) * MIN;
}

/** Espera entre tentativas: 15 min, 30, 1 h, 2 h, 4 h, e daí 6 h. */
export function intervaloEntreTentativas(tentativas) {
  const n = Math.max(1, Number(tentativas) || 1);
  return Math.min(15 * MIN * 2 ** (n - 1), 6 * H);
}

/**
 * Vale buscar esta reunião agora? Devolve { tentar, motivo, ultima }.
 * `ultima` = se não achar nada desta vez, fecha como sem_gravacao.
 * `refazer` ignora a espera entre tentativas e o teto (carga manual).
 */
export function decidirTentativa(m, agora = Date.now(), { refazer = false } = {}) {
  if (!m || m.status !== 'realizada') return { tentar: false, motivo: 'nao_realizada', ultima: false };
  const st = m.gravacao_status;
  if (st === 'achada' || st === 'sem_gravacao') return { tentar: false, motivo: st, ultima: false };
  const fim = fimDaReuniao(m);
  if (!Number.isFinite(fim)) return { tentar: false, motivo: 'sem_horario', ultima: false };
  if (agora < fim + ESPERA_INICIAL_MIN * MIN) return { tentar: false, motivo: 'cedo', ultima: false };
  const ultima = agora - fim >= DESISTE_APOS_H * H;
  const n = Number(m.gravacao_tentativas) || 0;
  if (refazer) return { tentar: true, motivo: 'refazer', ultima };
  if (n >= MAX_TENTATIVAS) return { tentar: false, motivo: 'teto', ultima };
  if (n > 0 && m.gravacao_buscada_em) {
    const desde = agora - new Date(m.gravacao_buscada_em).getTime();
    if (desde < intervaloEntreTentativas(n)) return { tentar: false, motivo: 'espera', ultima };
  }
  return { tentar: true, motivo: n ? 'de_novo' : 'primeira', ultima };
}

/**
 * Depois de uma busca, qual o status? Recebe o que foi achado:
 *   { video, documento, textoOk, erroTexto, erroGoogle, eventoSumiu, fim, agora, ultima }
 */
export function statusDepois(r) {
  const { video, documento, textoOk, erroTexto, erroGoogle, eventoSumiu, fim, agora, ultima } = r;
  if (erroGoogle) return ultima && eventoSumiu ? 'sem_gravacao' : 'erro';
  if (!video && !documento) return ultima ? 'sem_gravacao' : 'pendente';
  if (documento && !textoOk && erroTexto) return 'erro';   // achou o Doc mas não leu: falta acesso
  if (video && documento) return 'achada';
  // Só um dos dois: espera um pouco pelo outro (o vídeo costuma sair depois do texto).
  return ultima || agora - fim >= ESPERA_O_OUTRO_H * H ? 'achada' : 'pendente';
}

/** Corta no teto, sem partir no meio de uma linha quando dá. */
export function cortarTexto(texto, max = MAX_TEXTO) {
  const s = String(texto || '').replace(/\r\n/g, '\n').replace(/^﻿/, '').trim();
  if (s.length <= max) return { texto: s, cortada: false };
  let corte = s.lastIndexOf('\n', max);
  if (corte < max * 0.9) corte = max;
  return { texto: s.slice(0, corte), cortada: true };
}

const fmtData = (iso) => {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  } catch { return String(iso || ''); }
};

/** Texto do comentário na timeline do negócio no Bitrix. */
export function montarComentarioBitrix({ m, gravacaoUrl, transcricaoUrl, texto, tipo, max = MAX_TEXTO_BITRIX }) {
  const linhas = [`Reunião do Google Meet de ${fmtData(m?.scheduled_at)}${m?.title ? ` — ${m.title}` : ''}`];
  if (gravacaoUrl) linhas.push(`Gravação: ${gravacaoUrl}`);
  if (transcricaoUrl) linhas.push(`${tipo === 'gemini' ? 'Anotações do Gemini' : 'Transcrição'}: ${transcricaoUrl}`);
  const t = String(texto || '').trim();
  if (t) {
    const { texto: pedaco, cortada } = cortarTexto(t, max);
    linhas.push('', tipo === 'gemini' ? '— Anotações do Gemini —' : '— Transcrição —', pedaco);
    if (cortada) linhas.push('', `[…] texto cortado aqui (${t.length.toLocaleString('pt-BR')} caracteres no total) — o completo está no QS, na reunião do cliente.`);
  } else if (transcricaoUrl) {
    linhas.push('', 'O texto não pôde ser lido automaticamente — abra o link acima.');
  }
  return linhas.join('\n');
}

/** Id do negócio no Bitrix a partir do lead (qs_leads.bitrix_id). */
export function dealIdDoLead(lead) {
  const l = Array.isArray(lead) ? lead[0] : lead;
  const d = String(l?.bitrix_id ?? '').replace(/\D/g, '');
  return d || null;
}

/** Frase pro Bruno quando o texto não pôde ser lido. */
export function fraseSemAcessoAoTexto({ motivoOauth, motivoSa, emailSa, dono = DONO_PADRAO }) {
  const passos = [];
  if (emailSa) passos.push(`compartilhar a pasta "Meet Recordings" do Drive de ${dono} com ${emailSa} (Leitor)`);
  else passos.push('configurar a conta de serviço (GOOGLE_SA_JSON na Vercel) e compartilhar com ela a pasta "Meet Recordings"');
  passos.push(`ou gerar de novo o GOOGLE_REFRESH_TOKEN de ${dono} incluindo o escopo ${ESCOPO_DRIVE_LEITURA}`);
  const porque = [motivoOauth && `agenda: ${motivoOauth}`, motivoSa && `conta de serviço: ${motivoSa}`].filter(Boolean).join('; ');
  return `Achei a transcrição no Drive, mas o QS não tem acesso pra ler o texto${porque ? ` (${porque})` : ''}. Para resolver: ${passos.join(', ')}.`.slice(0, 1000);
}

/** Lê a resposta de erro do Google numa frase curta. */
export function motivoGoogle(status, corpo) {
  const e = corpo && corpo.error;
  const msg = (e && (e.message || (typeof e === 'string' ? e : ''))) || '';
  const razao = e?.errors?.[0]?.reason || e?.status || '';
  if (status === 403 && /insufficient|scope/i.test(`${msg} ${razao}`)) return 'token sem escopo de Drive (403 insufficient scope)';
  if (status === 404) return 'arquivo não encontrado ou não compartilhado (404)';
  if (status === 403) return `sem permissão (403${razao ? ` ${razao}` : ''})`;
  if (status === 401) return 'token recusado (401)';
  return `HTTP ${status}${msg ? ` · ${String(msg).slice(0, 140)}` : ''}`;
}

// ─── Conta de serviço (Drive, só leitura) ────────────────────────────────────

/** { email, chave } da conta de serviço (as mesmas envs do Drive do Marketing), ou null. */
export function credenciaisContaServico(env = process.env) {
  try {
    // lerCredenciais exige MKT_DRIVE_ID (é do Drive do Marketing); aqui ele não importa.
    const { email, chave } = lerCredenciais({ ...env, MKT_DRIVE_ID: env.MKT_DRIVE_ID || '-' });
    return { email, chave };
  } catch {
    return null;
  }
}

let cacheSa = null;

/** Token da conta de serviço com drive.readonly (e, se houver, delegação pra MEET_GRAVACAO_SA_SUB). */
export async function tokenContaServico({ env = process.env, signal = null } = {}) {
  const cred = credenciaisContaServico(env);
  if (!cred) return { token: null, email: null, motivo: 'conta de serviço não configurada (GOOGLE_SA_JSON)' };
  const sub = String(env.MEET_GRAVACAO_SA_SUB || '').trim() || undefined;
  const chaveCache = `${cred.email}|${sub || ''}`;
  const agora = Math.floor(Date.now() / 1000);
  if (cacheSa && cacheSa.chave === chaveCache && cacheSa.exp - 300 > agora) return { token: cacheSa.token, email: cred.email };
  try {
    const assertion = assinarJwt({ email: cred.email, chave: cred.chave, escopo: ESCOPO_DRIVE_LEITURA, agora, sub });
    const r = await fetchComPrazo(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, { timeoutMs: 6_000, signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      return { token: null, email: cred.email, motivo: `Google recusou a conta de serviço: ${j.error_description || j.error || r.status}` };
    }
    cacheSa = { chave: chaveCache, token: j.access_token, exp: agora + Number(j.expires_in || 3600) };
    return { token: cacheSa.token, email: cred.email };
  } catch (e) {
    return { token: null, email: cred.email, motivo: `conta de serviço: ${e?.name === 'AbortError' ? 'Google não respondeu' : e?.message || e}` };
  }
}

/** Só pra teste. */
export function _limparCacheSa() { cacheSa = null; }

// ─── Chamadas ao Google (só leitura) ─────────────────────────────────────────

/**
 * Lê o evento da agenda. Devolve { ok, anexos, sumiu, motivo }.
 * sumiu = 404/410 ou evento cancelado (não adianta tentar de novo).
 */
export async function lerEvento(eventId, { env = process.env, signal = null } = {}) {
  let token;
  try { token = await obterTokenGoogle({ signal }); } catch (e) { return { ok: false, anexos: [], sumiu: false, motivo: e?.message || 'token da agenda' }; }
  const cal = encodeURIComponent(calendarioPadrao(env));
  const url = `${API_CAL}/calendars/${cal}/events/${encodeURIComponent(eventId)}?fields=${encodeURIComponent('status,attachments(fileId,fileUrl,title,mimeType),hangoutLink')}`;
  let r;
  try {
    r = await fetchComPrazo(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 8_000, signal });
  } catch (e) {
    return { ok: false, anexos: [], sumiu: false, motivo: e?.name === 'AbortError' ? 'Google Agenda não respondeu a tempo' : `rede: ${e?.message || e}` };
  }
  const corpo = await r.json().catch(() => null);
  if (r.status === 404 || r.status === 410) return { ok: false, anexos: [], sumiu: true, motivo: 'evento não existe mais na agenda' };
  if (!r.ok) return { ok: false, anexos: [], sumiu: false, motivo: `Google Agenda: ${motivoGoogle(r.status, corpo)}` };
  if (corpo?.status === 'cancelled') return { ok: true, anexos: [], sumiu: true, motivo: 'evento cancelado na agenda' };
  return { ok: true, anexos: Array.isArray(corpo?.attachments) ? corpo.attachments : [], sumiu: false, hangoutLink: corpo?.hangoutLink || null };
}

async function exportarCom(token, fileId, signal) {
  const url = `${API_DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain&supportsAllDrives=true`;
  let r;
  try {
    r = await fetchComPrazo(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 12_000, signal });
  } catch (e) {
    return { ok: false, status: 0, motivo: e?.name === 'AbortError' ? 'Drive não respondeu a tempo' : `rede: ${e?.message || e}` };
  }
  if (r.ok) return { ok: true, texto: await r.text() };
  const corpo = await r.json().catch(() => null);
  return { ok: false, status: r.status, motivo: motivoGoogle(r.status, corpo) };
}

/**
 * Texto do Doc: tenta o token da agenda; se recusar, a conta de serviço.
 * Devolve { ok, texto, via } ou { ok:false, erro (frase pro Bruno) }.
 */
export async function lerTextoDoDoc(fileId, { env = process.env, signal = null } = {}) {
  let motivoOauth = null;
  try {
    const t = await obterTokenGoogle({ signal });
    const r = await exportarCom(t, fileId, signal);
    if (r.ok) return { ok: true, texto: r.texto, via: 'agenda' };
    motivoOauth = r.motivo;
  } catch (e) {
    motivoOauth = e?.message || 'token da agenda';
  }
  const sa = await tokenContaServico({ env, signal });
  let motivoSa = sa.motivo || null;
  if (sa.token) {
    const r = await exportarCom(sa.token, fileId, signal);
    if (r.ok) return { ok: true, texto: r.texto, via: 'conta_servico' };
    motivoSa = r.motivo;
  }
  return {
    ok: false,
    erro: fraseSemAcessoAoTexto({ motivoOauth, motivoSa, emailSa: sa.email, dono: String(env.MEET_GRAVACAO_DONO || '').trim() || DONO_PADRAO }),
  };
}

/**
 * Reserva: arquivos no Drive com o código do Meet no nome (só a conta de
 * serviço, que é quem tem escopo de Drive). Devolve no formato de anexo.
 */
export async function buscarNoDrivePorCodigo(codigo, { env = process.env, signal = null } = {}) {
  if (!codigo) return [];
  const sa = await tokenContaServico({ env, signal });
  if (!sa.token) return [];
  const qs = new URLSearchParams({
    q: `name contains '${escaparQ(codigo)}' and trashed = false`,
    corpora: 'allDrives',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '20',
    fields: 'files(id,name,mimeType,webViewLink)',
  });
  try {
    const r = await fetchComPrazo(`${API_DRIVE}/files?${qs}`, { headers: { Authorization: `Bearer ${sa.token}` } }, { timeoutMs: 8_000, signal });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return (j?.files || []).map((f) => ({ fileId: f.id, title: f.name, mimeType: f.mimeType, fileUrl: f.webViewLink }));
  } catch {
    return [];
  }
}
