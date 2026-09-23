// api/_wa.js
// -----------------------------------------------------------------------------
// Peças compartilhadas do WhatsApp do QS que não dependem de transporte:
// assinatura de quem escreve, telefone, posse do lead, janela e a baixa da
// atividade de WhatsApp.
//
// Até 22/09/2026 este arquivo também era a ponte com o Chatwoot (contatos,
// conversas, caixas, ingestão). Chatwoot e Evolution saíram do QS em 23/09 —
// o envio agora é direto na Cloud API da Meta (_meta.js + _waSaida.js) e a
// entrada chega pelo webhook da Meta (_metaEntrada.js).
//
// Regra de ouro deste arquivo: NADA aqui confia no navegador. Toda rota que
// devolve ou envia mensagem primeiro pergunta "este lead é mesmo deste usuário?"
// contra o banco, com service_role.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

// ── Assinatura do SDR ───────────────────────────────────────────────────────
// Todo mundo escreve pelo MESMO número oficial. Do lado do cliente, isso
// significa que sem assinatura ninguém sabe com quem está falando.
//
// Então o nome vai daqui, e vai do SERVIDOR: o navegador manda só o texto, quem
// diz quem está assinando é a sessão autenticada. Um SDR não consegue mandar
// mensagem assinada com o nome de outro.
//
// O nome exibido é editável em Configurações → Atendimento (mapa
// `wa_signature_names`), porque o cadastro costuma ter o nome completo
// ("Victor Hugo Silva Santos") e no WhatsApp o time se apresenta pelo nome curto.
// Sem nada mapeado, cai no automático: os dois primeiros nomes do cadastro.

export const WA_SIGNATURE_MAP_KEY = 'wa_signature_names';
export const WA_SIGNATURE_ENABLED_KEY = 'wa_signature_enabled';

/** Nome curto padrão: "Victor Hugo Silva" → "Victor Hugo"; "Yanka" → "Yanka". */
export function nomeCurto(nomeCompleto) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  // Nome composto ("Victor Hugo", "Ana Paula", "Maria Clara") só é preservado
  // quando a 2ª palavra NÃO é conectivo de sobrenome (da, de, dos...).
  const conectivos = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  if (partes.length > 1 && !conectivos.has(partes[1].toLowerCase())) {
    return `${partes[0]} ${partes[1]}`;
  }
  return partes[0];
}

// Configuração de assinatura muda uma vez por mês; mensagem sai o dia inteiro.
// Sem cache, cada envio pagaria duas idas ao banco antes de falar com a Meta.
// 60s é curto o bastante pra ninguém "esperar" a mudança e longo o bastante pra
// sumir com o custo numa rajada de mensagens (a função serverless quente reusa
// o processo; se ela reciclar, o cache simplesmente nasce vazio de novo).
const CACHE_MS = 60_000;
let cacheAssinatura = { em: 0, mapa: null, ligada: true };

async function lerConfigAssinatura() {
  if (Date.now() - cacheAssinatura.em < CACHE_MS) return cacheAssinatura;
  try {
    const rows = await rest(
      `qs_settings?select=key,value&key=in.(${WA_SIGNATURE_MAP_KEY},${WA_SIGNATURE_ENABLED_KEY})`
    );
    const porChave = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
    const mapa = porChave[WA_SIGNATURE_MAP_KEY];
    cacheAssinatura = {
      em: Date.now(),
      mapa: mapa && typeof mapa === 'object' ? mapa : null,
      ligada: porChave[WA_SIGNATURE_ENABLED_KEY] !== false,
    };
  } catch (e) {
    // Banco fora do ar não pode impedir o SDR de responder o cliente: segue com
    // o padrão (ligada, nome do cadastro) e tenta de novo na próxima.
    console.warn('[wa] config de assinatura indisponível:', e?.message);
    cacheAssinatura = { em: Date.now(), mapa: null, ligada: true };
  }
  return cacheAssinatura;
}

/**
 * Como este usuário assina. Lê o mapa das Configurações; volta pro nome curto do
 * cadastro quando não houver nada mapeado. String vazia = não assina.
 */
export async function signatureName(user) {
  if (!user?.id) return '';
  const { mapa } = await lerConfigAssinatura();
  const escolhido = mapa?.[user.id];
  // Mapeado como "" de propósito = este usuário não assina.
  if (typeof escolhido === 'string') return escolhido.trim();
  return nomeCurto(user.name);
}

/** A assinatura está ligada? (padrão: sim) */
export async function signatureEnabled() {
  const { ligada } = await lerConfigAssinatura();
  return ligada;
}

/**
 * Carimba o nome como primeira linha, em negrito do WhatsApp:
 *
 *   *Victor Hugo*
 *   Oi João, tudo bem?
 *
 * Idempotente: reenviar um texto que já está assinado com o mesmo nome não
 * empilha duas assinaturas (acontece quando o SDR copia e cola a própria
 * mensagem anterior).
 */
export function assinarTexto(text, nome) {
  const corpo = String(text ?? '');
  const assinatura = String(nome || '').trim();
  if (!assinatura) return corpo;
  const primeiraLinha = corpo.split('\n', 1)[0].trim();
  if (primeiraLinha === `*${assinatura}*`) return corpo;
  return corpo ? `*${assinatura}*\n${corpo}` : `*${assinatura}*`;
}

/** Atalho: resolve o nome e assina, respeitando o liga/desliga. */
export async function assinarComoUsuario(text, user) {
  const { ligada } = await lerConfigAssinatura();
  if (!ligada) return String(text ?? '');
  return assinarTexto(text, await signatureName(user));
}

// ── Telefone ────────────────────────────────────────────────────────────────

export function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** E.164 BR. <=11 dígitos = sem DDI → prepõe 55 (trata DDD 55/RS certo). */
export function toE164BR(raw) {
  const d = onlyDigits(raw);
  if (!d) return null;
  return '+' + (d.length <= 11 ? '55' + d : d);
}

/**
 * Chave canônica de comparação: DDD + 8 dígitos finais, SEM o nono dígito e SEM
 * o 55. Existe porque o mesmo celular aparece escrito de 4 jeitos diferentes
 *  (com/sem +55, com/sem o 9) entre o CRM e o WhatsApp — comparar
 * string crua faria o lead certo não casar com a conversa dele.
 */
/** A chave de UM número já isolado. DDD + 8 dígitos, sem 55 e sem o 9º. */
function chaveDeUmNumero(d) {
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  let rest = d.slice(2);
  if (rest.length === 9 && rest.startsWith('9')) rest = rest.slice(1);
  if (rest.length !== 8) return null;
  return ddd + rest;
}

/**
 * Candidatos de telefone dentro de um campo que pode ter MAIS DE UM.
 *
 * O Bitrix manda o telefone como lista, e o campo chega assim:
 *
 *     " 5519993152056,  551993152056"    ← o mesmo número com e sem o 9º dígito
 *     "5547999689893554799689893"        ← dois números COLADOS, sem separador
 *
 * O segundo caso é obra nossa: o normalizador antigo fazia
 * `replace(/\D/g,'')` na string inteira e grudava os dois. Medido em produção:
 * 57 leads assim — e mensagem de WhatsApp desses leads NUNCA vinculava, porque a
 * chave dava null e o webhook descartava em silêncio.
 */
function candidatosDeTelefone(raw) {
  const bruto = String(raw ?? '');
  const fora = [];

  // 1) separadores explícitos (vírgula, ponto e vírgula, barra, quebra de linha)
  for (const p of bruto.split(/[,;/|\n\r]+/)) {
    const d = onlyDigits(p);
    if (d) fora.push(d);
  }

  // 2) grudados: uma sequência longa demais pra ser um número só. Tenta os
  //    tamanhos plausíveis do começo — 13 (55+DDD+9), 12, 11 (DDD+9), 10.
  for (const d of [...fora]) {
    if (d.length > 13) {
      for (const n of [13, 12, 11, 10]) fora.push(d.slice(0, n));
    }
  }

  return fora;
}

/**
 * Chave canônica do telefone (DDD + 8 dígitos). Tolera campo com vários números:
 * devolve a chave do PRIMEIRO que for válido.
 */
export function waKey(raw) {
  const cands = candidatosDeTelefone(raw);
  for (const cand of cands) {
    const k = chaveDeUmNumero(cand);
    if (k) return k;
  }

  // Número de fora do Brasil (Portugal, Alemanha, Paraguai — clientes reais de
  // uma agência de viagens). A regra brasileira não serve, mas a comparação
  // continua valendo: os dois lados passam por aqui, então basta uma chave
  // ESTÁVEL. Prefixo "i:" pra nunca colidir com uma chave de DDD+8.
  const internacional = cands.filter((d) => d.length >= 10 && d.length <= 15).sort((a, b) => b.length - a.length)[0];
  return internacional ? `i:${internacional}` : null;
}

// ── Leads ───────────────────────────────────────────────────────────────────

const LEAD_COLS = 'id,owner_id,full_name,first_name,last_name,phone,status';

/**
 * Acha o lead dono deste telefone. Busca ampla pelos 8 dígitos finais (o que
 * sobrevive a qualquer formatação) e só então confirma pela chave canônica.
 */
export async function findLeadByPhone(phone) {
  const key = waKey(phone);
  if (!key) return null;
  const last8 = key.slice(-8);
  const rows = await rest(
    `qs_leads?select=${LEAD_COLS}&phone=ilike.*${encodeURIComponent(last8)}*&order=updated_at.desc&limit=20`
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.find((l) => waKey(l.phone) === key) || null;
}

export async function getLead(leadId) {
  const rows = await rest(`qs_leads?select=${LEAD_COLS}&id=eq.${encodeURIComponent(leadId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

// ── Autorização ─────────────────────────────────────────────────────────────

/** Valida o JWT do Supabase Auth e devolve o id do usuário (ou null). */
export async function getSupabaseUserId(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Timeout obrigatório: a função inteira tem 10s na Vercel. Sem isto, um
  // /auth/v1/user lento consome sozinho todo o orçamento e o envio "falha"
  // depois de já ter saído.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A trava do produto inteiro: este usuário pode mexer neste lead?
 * Mesma regra da RLS (0007): gestor/admin vê tudo; SDR só o dele ou sem dono.
 * Um usuário desativado não passa.
 */
export async function assertCanAccessLead(userId, leadId) {
  const [users, lead] = await Promise.all([
    rest(`qs_users?select=id,name,role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`),
    getLead(leadId),
  ]);
  const user = (Array.isArray(users) && users[0]) || null;
  if (!user || user.is_active === false) return { ok: false, reason: 'usuario-invalido' };
  if (!lead) return { ok: false, reason: 'lead-inexistente' };

  // O CLOSER ATENDE QUALQUER CONVERSA (Bruno, 18/08: "abre por papel mesmo").
  // Espelha a migration 0050, que abriu o mesmo caminho na leitura — as duas
  // pontas precisam andar juntas, senão ele VÊ a conversa e toma 403 ao
  // responder, que é pior do que não ver.
  const podeTudo = user.role === 'admin' || user.role === 'gestor' || user.role === 'closer';
  if (podeTudo || lead.owner_id === userId || lead.owner_id == null) return { ok: true, lead, user };

  // Quem passou o lead adiante continua podendo falar com o cliente. Sem este
  // ramo, o SDR VÊ a conversa (a RLS da 0025 permite) mas toma 403 ao responder
  // — quebrando exatamente o fluxo "agendou, foi pro closer, mas continuo junto".
  // Espelha `qs_owns_lead` da migration 0029: as duas regras têm que andar juntas.
  //
  // Só o handover MAIS RECENTE conta. Antes bastava existir qualquer passagem
  // histórica em nome do usuário, o que dava acesso vitalício: um lead que rodou
  // por três donos ficava legível pelos três, para sempre.
  try {
    const ultimo = await rest(
      `qs_handovers?select=from_user_id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&order=created_at.desc&limit=1`
    );
    if (Array.isArray(ultimo) && ultimo[0]?.from_user_id === userId) {
      return { ok: true, lead, user };
    }
  } catch (e) {
    console.warn('[wa] checagem de handover:', e?.message);
  }

  return { ok: false, reason: 'lead-de-outro-sdr' };
}

/** O cliente escreveu pra gente nas últimas `horas`? (qualquer linha) */
export async function clienteFalouRecente(leadId, horas = 24) {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  try {
    const rows = await rest(
      `qs_wa_messages?select=id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&direction=eq.in&sent_at=gte.${encodeURIComponent(desde)}&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    // Na dúvida, "sim": responder onde o cliente falou é o comportamento antigo,
    // e o antigo é sempre o palpite seguro.
    console.warn('[wa] clienteFalouRecente:', e?.message);
    return true;
  }
}

// ── Cadência: baixar a atividade de WhatsApp sozinha ────────────────────────

/**
 * Quando o SDR responde pelo QS, a tarefa de WhatsApp daquele lead que estava
 * pendente pra hoje (ou atrasada) é dada como feita. Some o trabalho de marcar
 * na mão — que é onde a aderência costuma se perder.
 *
 * Best-effort de propósito: se falhar, o envio da mensagem NÃO pode falhar junto.
 * Desligável em qs_settings.wa_auto_complete_task = false.
 */
export async function completeWhatsAppTask(leadId, ownerId = null) {
  try {
    const cfg = await rest(`qs_settings?select=value&key=eq.wa_auto_complete_task&limit=1`);
    if (cfg?.[0]?.value === false) return null;
  } catch { /* sem config = ligado */ }

  try {
    // Tem que ser "até a próxima meia-noite de BRASÍLIA", não "daqui a 24h".
    // Com janela deslizante, uma mensagem às 15h de hoje concluía o FUP das 9h
    // de AMANHÃ — a atividade sumia da fila sem nunca ter sido feita.
    const BRT_OFFSET_H = 3;
    const agora = new Date();
    const brt = new Date(agora.getTime() - BRT_OFFSET_H * 3600_000);
    const meiaNoiteBrtSeguinte = new Date(Date.UTC(
      brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1, BRT_OFFSET_H, 0, 0
    ));
    const limite = meiaNoiteBrtSeguinte.toISOString();

    // Só a tarefa DO DONO: depois de um handover, o closer respondendo não pode
    // baixar a atividade do SDR (e vice-versa) — isso sujaria a aderência de cada um.
    const filtroDono = ownerId ? `&owner_id=eq.${encodeURIComponent(ownerId)}` : '';

    const abertas = await rest(
      `qs_tasks?select=id,scheduled_at&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&channel_type=eq.whatsapp&status=eq.pendente&scheduled_at=lt.${encodeURIComponent(limite)}` +
      filtroDono +
      `&order=scheduled_at.asc&limit=1`
    );
    const alvo = abertas?.[0];
    if (!alvo) return null;

    await rest(`qs_tasks?id=eq.${encodeURIComponent(alvo.id)}`, {
      method: 'PATCH',
      body: { status: 'concluida', completed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
    return alvo.id;
  } catch (e) {
    console.warn('[wa] completeWhatsAppTask:', e?.message);
    return null;
  }
}

// ── Gravação no QS ──────────────────────────────────────────────────────────
