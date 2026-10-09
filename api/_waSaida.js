// api/_waSaida.js
// -----------------------------------------------------------------------------
// O QUE SAI PELO NÚMERO OFICIAL (23/09/2026) — tudo que não é "falar com a
// Meta" em si: a janela de 24h, o registro da bolha no QS e o modelo resolvido.
//
// A mensagem que sai é gravada com o `wamid` que a Meta devolveu como
// `source_id`. É por ele que os recibos (✓ entregue, ✓✓ lida, ✗ falhou) que
// chegam pelo webhook acham a bolha — a mesma chave da entrada (0084).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { modelosAprovados, credenciaisDaMeta, garantirNumeroDaVercel } from './_meta.js';

let cacheLinha = null;

/**
 * A "caixa" do número oficial em `qs_wa_numeros_meta` (a coluna ainda se chama
 * cw_inbox_id por herança do Chatwoot; hoje é só o carimbo do número). A
 * entrada grava com ela; a saída tem que gravar com a mesma, senão a conversa
 * parece ter dois números.
 */
export async function caixaOficial() {
  if (cacheLinha && Date.now() - cacheLinha.em < 60_000) return cacheLinha.v;
  // O número PADRÃO de agora (o conectado pelo painel, ou o da Vercel).
  const phoneId = (await credenciaisDaMeta())?.phoneId || '';
  await garantirNumeroDaVercel();
  let v = null;
  try {
    const r = await rest(
      `qs_wa_numeros_meta?select=cw_inbox_id&phone_number_id=eq.${encodeURIComponent(phoneId)}&limit=1`
    );
    v = r?.[0]?.cw_inbox_id ?? null;
  } catch (e) {
    console.warn('[wa-saida] não li o número oficial:', e?.message);
  }
  cacheLinha = { v, em: Date.now() };
  return v;
}

// ── QUAL NÚMERO ENVIA (28/09/2026, Coexistence: um número por SDR) ─────────────

let cacheNumeros = null;

/** Os números conectados, com dono e marca. 60 s de cache por execução. */
async function numerosConectados() {
  if (cacheNumeros && Date.now() - cacheNumeros.em < 60_000) return cacheNumeros.v;
  let v = [];
  try {
    // Só os do Comercial: o número do Relacionamento (0101) não tem dono e
    // seria lido aqui como "o oficial".
    v = await rest('qs_wa_numeros_meta?select=phone_number_id,user_id,cw_inbox_id,status,segredo_id&status=eq.conectado&setor=eq.comercial') || [];
  } catch (e) {
    console.warn('[wa-saida] não li os números conectados:', e?.message);
  }
  cacheNumeros = { v, em: Date.now() };
  return v;
}

/** A marca (cw_inbox_id) de um número; sem número, a do oficial. */
export async function caixaDoNumero(phoneId) {
  if (!phoneId) return caixaOficial();
  const n = (await numerosConectados()).find((x) => x.phone_number_id === String(phoneId));
  return n?.cw_inbox_id ?? null;
}

/** O SDR dono de um número (null = número compartilhado). */
async function donoDoNumero(phoneId) {
  if (!phoneId) return null;
  const n = (await numerosConectados()).find((x) => x.phone_number_id === String(phoneId));
  return n?.user_id ?? null;
}

/**
 * POR QUAL NÚMERO sai a mensagem deste lead. Devolve o phone_number_id, ou
 * null = o número oficial (padrão).
 *
 *   1. A CONVERSA EM ANDAMENTO continua no mesmo número: o da última mensagem
 *      com o lead nos últimos 30 dias — desde que seja o oficial, o de quem
 *      envia ou o do dono do lead. Trocar de número no meio da conversa faz o
 *      cliente receber de um número desconhecido e fecha a janela de 24h.
 *   2. Conversa nova: o número de QUEM ENVIA, se for um SDR conectado.
 *   3. Senão, o número do DONO DO LEAD (gestor/closer escrevendo no lead dele).
 *   4. Senão, o oficial.
 *
 * CLOSER (08/10/2026): fala SEMPRE pelo número do time (o padrão, hoje o
 * 1935 por Coexistence) — ou pelo próprio, se tiver um. Nunca pelo chip do
 * SDR que passou o lead: o cliente agendou com o closer e a conversa dele é
 * no número do time.
 *
 * Número de SDR só conta com token guardado (segredo_id) — sem ele não há
 * como enviar. Os automáticos (boas-vindas, Glória) NÃO passam por aqui: usam
 * modelos que só existem na conta oficial.
 */
export async function numeroDoEnvio({ leadId, userId = null, ownerId = null, papel = null }) {
  let caixaDaConversa = null;
  try {
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const r = await rest(
      `qs_wa_messages?select=cw_inbox_id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&cw_inbox_id=not.is.null&sent_at=gte.${encodeURIComponent(desde)}&order=sent_at.desc&limit=1`
    );
    caixaDaConversa = r?.[0]?.cw_inbox_id ?? null;
  } catch (e) {
    console.warn('[wa-saida] não li a última conversa (segue a regra do dono):', e?.message);
  }
  return escolherNumero({ numeros: await numerosConectados(), caixaDaConversa, userId, ownerId, papel });
}

/** A regra de numeroDoEnvio, sem banco (testável). */
export function escolherNumero({ numeros, caixaDaConversa, userId = null, ownerId = null, papel = null }) {
  // Número de SDR só conta com token guardado; o oficial pode vir da Vercel
  // (sem segredo_id) e continua valendo como "a conversa está no oficial".
  const nums = (numeros || []).filter((n) => !n.user_id || n.segredo_id);
  const pessoal = (uid) => (uid ? nums.find((n) => n.user_id === uid) : null);
  if (papel === 'closer') return pessoal(userId)?.phone_number_id ?? null;
  const pode = (n) => n && (!n.user_id || n.user_id === userId || n.user_id === ownerId);

  if (caixaDaConversa != null) {
    const n = nums.find((x) => x.cw_inbox_id === caixaDaConversa);
    if (pode(n)) return n.user_id ? n.phone_number_id : null;
  }
  const meu = pessoal(userId);
  if (meu) return meu.phone_number_id;
  const doDono = pessoal(ownerId);
  if (doDono) return doDono.phone_number_id;
  return null;
}

/**
 * O cliente escreveu pelo número oficial nas últimas 24h? Só assim texto livre
 * é entregue; fora disso a Meta recusa (às vezes calada). Conta no NOSSO banco.
 * Sem conseguir olhar, deixa passar — a própria Meta responde e o erro volta.
 */
export async function janelaAberta(leadId, phoneId = null) {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    const caixa = await caixaDoNumero(phoneId);
    const filtro = caixa != null ? `&cw_inbox_id=eq.${Number(caixa)}` : '';
    const r = await rest(
      `qs_wa_messages?select=id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&direction=eq.in&sent_at=gte.${encodeURIComponent(desde)}${filtro}&limit=1`
    );
    return Array.isArray(r) && r.length > 0;
  } catch (e) {
    console.warn('[wa-saida] janela de 24h indisponível (segue):', e?.message);
    return true;
  }
}

/**
 * Grava a bolha que acabou de sair. NUNCA lança: a mensagem já está no celular
 * do cliente, e "não consegui gravar" não pode virar "não enviou" (o SDR
 * reenviaria e o cliente receberia duas vezes).
 */
export async function registrarSaida({
  leadId, wamid, texto = '', anexos = [], remetente = null, respondendoA = null, trechoCitado = null,
  phoneId = null,
}) {
  if (!leadId || !wamid) return false;
  try {
    const novo = await rest('rpc/qs_wa_ingest_meta', {
      method: 'POST',
      body: {
        p_lead: leadId,
        p_linha: await donoDoNumero(phoneId),
        p_source: String(wamid),
        p_direction: 'out',
        p_content: String(texto || ''),
        p_attachments: anexos,
        p_sender: remetente || 'Se Tu For, Eu Vou',
        p_sent_at: new Date().toISOString(),
        p_status: 'sent',
        p_reply_to: respondendoA,
        p_reply_prev: trechoCitado,
        p_inbox: await caixaDoNumero(phoneId),
      },
    });
    return novo === true;
  } catch (e) {
    console.error('[wa-saida] enviada, mas não gravou no QS:', e?.message);
    return false;
  }
}

/**
 * Acha o modelo aprovado pelo nome, confere as variáveis e devolve o texto
 * preenchido (é o que vira a bolha no QS). O corpo NUNCA vem do navegador.
 */
export async function resolverModeloMeta(modelo, phoneId = null) {
  const nome = String(modelo?.nome || '').trim();
  if (!nome) return { error: 'modelo-sem-nome' };
  const params = (modelo?.params && typeof modelo.params === 'object') ? modelo.params : {};

  const lista = await modelosAprovados(phoneId);
  const t = lista.find((m) => m.nome === nome && (!modelo.idioma || m.idioma === modelo.idioma));
  if (!t) return { error: 'modelo-nao-encontrado' };

  const midiaUrl = String(modelo?.midia?.url || '').trim();
  if (t.precisaMidia && !midiaUrl) return { error: 'modelo-precisa-de-midia', formato: t.headerFormato };

  let faltando = null;
  const texto = t.corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, chave) => {
    const v = params[chave];
    if (v == null || String(v).trim() === '') { faltando = chave; return ''; }
    return String(v).trim();
  });
  if (faltando) return { error: 'modelo-variavel-vazia', variavel: faltando };

  return {
    nome: t.nome,
    idioma: t.idioma,
    texto,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v).trim()])),
    midia: t.precisaMidia ? { url: midiaUrl } : null,
    formatoMidia: t.precisaMidia ? t.headerFormato : null,
  };
}

/** A mensagem citada, se for deste lead: o wamid (pra Meta) e o trecho (pra bolha). */
export async function mensagemCitada(leadId, idNoQs) {
  if (!idNoQs) return { wamid: null, trecho: null };
  try {
    const r = await rest(
      `qs_wa_messages?select=source_id,content&id=eq.${encodeURIComponent(idNoQs)}` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    const m = r?.[0];
    const wamid = m?.source_id ? String(m.source_id).replace(/^WAID:/, '') : null;
    return { wamid, trecho: m?.content ? String(m.content).slice(0, 160) : null };
  } catch {
    return { wamid: null, trecho: null };
  }
}
