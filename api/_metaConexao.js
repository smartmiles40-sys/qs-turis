// api/_metaConexao.js
// -----------------------------------------------------------------------------
// O PAINEL DE CONEXÃO DA CLOUD API — "igual ManyChat" (Bruno, 23/09/2026).
//
// O admin clica em "Conectar WhatsApp", faz login na janela da própria Meta
// (Cadastro Incorporado / Embedded Signup), escolhe a empresa e o número — e o
// QS recebe um CÓDIGO de uso único + os ids do número e da conta. Aqui:
//
//   1. o código vira um token de negócio (/oauth/access_token, com o app secret);
//   2. conferimos o número (nome, qualidade, limite);
//   3. o app é assinado na conta (subscribed_apps) — sem isso nada chega;
//   4. número novo na Cloud API é REGISTRADO com o PIN de 6 dígitos;
//      WhatsApp Business do celular (Coexistência) pede a sincronização;
//   5. o webhook do app aponta pro QS (uma vez, vale pra todos os números);
//   6. o token vai pro Vault (qs_meta_guardar_conexao, 0091).
//
// Configuração pública do botão (não é segredo): o id do app
// (META_CALLS_APP_ID) e o id da configuração do Cadastro Incorporado
// (qs_settings.meta_cadastro.config_id), que o admin cola na tela.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { graph, credenciaisDaMeta, limparCacheMeta, apontarWebhookProQs, garantirNumeroDaVercel, copiarModelosDoOficial, contarModelos, descobrirWaba } from './_meta.js';
import { saudeDaCaixaOficial } from './_waSaude.js';

const GRAPH = 'https://graph.facebook.com/v23.0';
const CHAVE_CFG = 'meta_cadastro';

export async function lerConfigCadastro() {
  let cfg = {};
  try {
    const r = await rest(`qs_settings?select=value&key=eq.${CHAVE_CFG}&limit=1`);
    cfg = (r?.[0]?.value && typeof r[0].value === 'object') ? r[0].value : {};
  } catch { /* segue vazio */ }
  return {
    appId: String(process.env.META_CALLS_APP_ID || '').trim() || null,
    configId: cfg.config_id ? String(cfg.config_id) : null,
    // Sem o app secret não dá pra trocar o código — o botão nem aparece.
    podeTrocarCodigo: Boolean(process.env.META_CALLS_APP_SECRET),
  };
}

export async function salvarConfigCadastro({ configId }) {
  const id = String(configId || '').trim();
  if (id && !/^\d{5,25}$/.test(id)) return { erro: 'O id da configuração tem só números.' };
  await rest('qs_settings', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { key: CHAVE_CFG, value: { config_id: id || null }, updated_at: new Date().toISOString() },
  });
  return { ok: true };
}

/** Código de uso único (vale ~30 s) → token de negócio. */
async function trocarCodigo(code) {
  const appId = String(process.env.META_CALLS_APP_ID || '').trim();
  const secret = String(process.env.META_CALLS_APP_SECRET || '').trim();
  if (!appId || !secret) return { erro: 'Faltam META_CALLS_APP_ID e META_CALLS_APP_SECRET na Vercel.' };
  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`;
  const j = await fetch(url).then((r) => r.json()).catch(() => null);
  if (!j?.access_token) {
    return { erro: `A Meta não trocou o código: ${j?.error?.message || 'sem resposta'}. Tente conectar de novo (o código vale poucos segundos).` };
  }
  return { token: String(j.access_token) };
}

/**
 * O número de uma conta, quando a janela não disse qual. Na Coexistence a
 * conta é 1:1 com o número; com mais de um, fica o que ainda não está no QS.
 */
async function numeroDaConta(wabaId, token) {
  let lista = [];
  try {
    const d = await graph(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status`, { token });
    lista = Array.isArray(d?.data) ? d.data : [];
  } catch (e) {
    return { erro: `Não consegui ler os números da conta na Meta: ${e.message}` };
  }
  if (!lista.length) return { erro: 'A conta conectada não tem número. Conecte de novo e digite o número do SDR na janela.' };
  if (lista.length === 1) return { phoneId: String(lista[0].id) };
  const noQs = new Set((await rest('qs_wa_numeros_meta?select=phone_number_id').catch(() => [])).map((r) => r.phone_number_id));
  const novos = lista.filter((n) => !noQs.has(String(n.id)));
  if (novos.length === 1) return { phoneId: String(novos[0].id) };
  return { erro: `A conta tem ${lista.length} números (${lista.map((n) => n.display_phone_number).join(', ')}) e não sei qual foi escolhido. Conecte de novo até o fim da janela.` };
}

/**
 * Coexistence — o SDR desligou a integração pelo celular, ou religou
 * (campo `account_update` do webhook; entry.id = a WABA). Offboarded = o
 * número sai do QS (status desconectado, fora do envio); reconnected = volta.
 * Só mexe em número de COEXISTENCE: o oficial nunca é derrubado por aqui.
 */
export async function eventoDaConta(wabaId, value) {
  const ev = String(value?.event || '').toUpperCase();
  const saiu = ev === 'ACCOUNT_OFFBOARDED' || ev === 'PARTNER_REMOVED';
  const voltou = ev === 'ACCOUNT_RECONNECTED';
  if (!saiu && !voltou) return null;
  const linhas = await rest(`qs_wa_numeros_meta?select=phone_number_id,numero,user_id&modo=eq.coexistencia&waba_id=eq.${encodeURIComponent(String(wabaId))}`).catch(() => []);
  const fone = String(value?.phone_number || value?.waba_info?.phone_number || '').replace(/\D/g, '');
  const alvos = (linhas || []).filter((l) => !fone || String(l.numero || '').replace(/\D/g, '').endsWith(fone.slice(-8)));
  for (const l of alvos.length ? alvos : (linhas || [])) {
    await rest(`qs_wa_numeros_meta?phone_number_id=eq.${encodeURIComponent(l.phone_number_id)}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: saiu
        ? { status: 'desconectado', ultimo_erro: `Desligado pelo celular/Meta (${ev}) em ${new Date().toISOString()}`, atualizado_em: new Date().toISOString() }
        : { status: 'conectado', ultimo_erro: null, atualizado_em: new Date().toISOString() },
    });
    console.log(`[meta-conexao] ${ev}: ${l.phone_number_id} (${l.numero || 's/ número'}) → ${saiu ? 'desconectado' : 'conectado'}`);
  }
  limparCacheMeta();
  return { evento: ev, numeros: (alvos.length ? alvos : linhas || []).length };
}

/**
 * Conecta (ou reconecta) um número.
 *   modo 'cloud'        → número na Cloud API; `pin` (6 dígitos) registra o número
 *   modo 'coexistencia' → WhatsApp Business do celular; `userId` = o SDR dono
 */
export async function conectarNumero({ code, wabaId, phoneId, modo, pin, userId, rotulo, por, urlBase }) {
  const m = modo === 'coexistencia' ? 'coexistencia' : 'cloud';
  if (!code) return { erro: 'A janela da Meta não devolveu o código. Conecte de novo até o fim.' };
  if ((wabaId && !/^\d+$/.test(String(wabaId))) || (phoneId && !/^\d+$/.test(String(phoneId)))) return { erro: 'Ids inválidos.' };

  const t = await trocarCodigo(code);
  if (t.erro) return t;
  const token = t.token;

  // Embedded Signup v4 / Coexistence (28/09/2026): o evento de conclusão
  // (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) pode vir sem o phone_number_id —
  // e às vezes sem evento nenhum. O token trocado enxerga a conta: descobre.
  if (!wabaId) {
    wabaId = await descobrirWaba(token);
    if (!wabaId) return { erro: 'Conectado na Meta, mas não descobri a conta (WABA). Conecte de novo até o fim da janela.' };
  }
  if (!phoneId) {
    const achado = await numeroDaConta(String(wabaId), token);
    if (achado.erro) return achado;
    phoneId = achado.phoneId;
  }

  // (2) O número existe e este token enxerga ele?
  let info;
  try {
    info = await graph(
      `/${phoneId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { token }
    );
  } catch (e) {
    return { erro: `Não consegui ler o número na Meta: ${e.message}` };
  }

  // (3) O app assinado na conta — é o que faz as mensagens chegarem.
  try {
    await graph(`/${wabaId}/subscribed_apps`, { method: 'POST', token });
  } catch (e) {
    return { erro: `A Meta não deixou assinar o app na conta: ${e.message}` };
  }

  // (4) Registro (Cloud) ou sincronização (Coexistência).
  const avisos = [];
  if (m === 'cloud') {
    const p = String(pin || '').trim();
    if (p) {
      if (!/^\d{6}$/.test(p)) return { erro: 'O PIN tem 6 números.' };
      try {
        await graph(`/${phoneId}/register`, { method: 'POST', token, body: { messaging_product: 'whatsapp', pin: p } });
      } catch (e) {
        // Número que já estava registrado responde erro — e está tudo bem.
        avisos.push(`Registro: ${e.message}`);
      }
    }
  } else {
    for (const tipo of ['smb_app_state_sync', 'history']) {
      try {
        await graph(`/${phoneId}/smb_app_data`, { method: 'POST', token, body: { messaging_product: 'whatsapp', sync_type: tipo } });
      } catch (e) {
        avisos.push(`Sincronização (${tipo}): ${e.message}`);
      }
    }
  }

  // (6) Guarda.
  try {
    await rest('rpc/qs_meta_guardar_conexao', {
      method: 'POST',
      body: {
        p_phone: String(phoneId), p_waba: String(wabaId),
        p_numero: info?.display_phone_number || null, p_nome: info?.verified_name || null,
        p_modo: m, p_token: token, p_user: userId || null, p_rotulo: rotulo || null, p_por: por || null,
      },
    });
    // A marca do número nas mensagens (0092): a janela de 24h é por número.
    await rest('rpc/qs_meta_marcar_caixa', { method: 'POST', body: { p_phone: String(phoneId) } });
  } catch (e) {
    return { erro: `Conectado na Meta, mas não consegui guardar no QS: ${e.message}` };
  }
  limparCacheMeta();

  // (5) Webhook do app → QS. Depois de guardar: usa a credencial nova se for a padrão.
  const w = await apontarWebhookProQs(urlBase).catch((e) => ({ erro: e?.message }));
  if (w?.erro) avisos.push(`Webhook: ${w.detalhe || w.erro}`);

  // (7) Coexistence: a WABA é 1:1 com o número — nasce sem modelo nenhum.
  // Copia os aprovados do oficial (vão pra análise da Meta de novo). Falha
  // aqui NÃO desfaz a conexão: o botão do cartão repete a cópia.
  if (m === 'coexistencia') {
    const c = await copiarModelosDoOficial(String(phoneId)).catch((e) => ({ erro: e?.message }));
    if (c?.erro) avisos.push(`Modelos: não copiei do oficial (${c.erro}). Use "Copiar modelos do oficial" no cartão.`);
    else if (!c?.mesmaConta) {
      avisos.push(`Modelos: ${c.criados.length} enviados pra aprovação da Meta nesta conta` +
        (c.pulados.filter((p) => p.motivo !== 'já existe').length ? `, ${c.pulados.filter((p) => p.motivo !== 'já existe').length} com mídia no topo precisam ser criados à mão` : '') +
        (c.erros.length ? `, ${c.erros.length} recusados na hora` : '') + '.');
    }
  }

  return {
    ok: true,
    numero: info?.display_phone_number || null,
    nome: info?.verified_name || null,
    avisos,
  };
}

/**
 * Registra na Cloud API um número que já está na conta mas aparece "Pendente"
 * (caso de quem adiciona o número pelo painel da Meta em vez do botão). O PIN
 * de 6 dígitos vira a verificação em duas etapas do número.
 */
export async function registrarNumero(phoneId, pin) {
  const p = String(pin || '').trim();
  if (!/^\d{6}$/.test(p)) return { erro: 'O PIN tem 6 números.' };
  const cr = await credenciaisDaMeta(phoneId);
  if (!cr) return { erro: 'Não tenho o token deste número (confira META_CALLS_TOKEN na Vercel).' };
  try {
    await graph(`/${cr.phoneId}/register`, { method: 'POST', token: cr.token, body: { messaging_product: 'whatsapp', pin: p } });
    return { ok: true };
  } catch (e) {
    return { erro: `A Meta recusou o registro: ${e.message}` };
  }
}

export async function desconectarNumero(phoneId) {
  if (!/^\d+$/.test(String(phoneId || ''))) return { erro: 'Número inválido.' };
  await rest('rpc/qs_meta_desconectar', { method: 'POST', body: { p_phone: String(phoneId) } });
  limparCacheMeta();
  return { ok: true };
}

/**
 * O retrato da tela: cada número com o que o QS sabe (dono, modo, quando) e o
 * que a Meta diz AGORA (nome, qualidade, limite de envio). Mais a saúde da
 * entrada de mensagens e a configuração do botão.
 */
export async function listarConexoes() {
  await garantirNumeroDaVercel();
  const [linhas, cfg, saude, users] = await Promise.all([
    rest('qs_wa_numeros_meta?select=phone_number_id,user_id,rotulo,waba_id,numero,nome_verificado,modo,status,segredo_id,conectado_em,cw_inbox_id,ultimo_erro&order=criado_em.asc')
      .catch(() => []),
    lerConfigCadastro(),
    saudeDaCaixaOficial().catch(() => null),
    rest('qs_users?select=id,name,role&is_active=eq.true&order=name').catch(() => []),
  ]);
  const nomes = new Map((users || []).map((u) => [u.id, u.name]));
  const envPhone = String(process.env.META_PHONE_NUMBER_ID || '').trim();

  // Oficial DESLIGADO não aparece mais (Bruno, 29/09: tirar o 4863-6051, banido,
  // e o 92633-2597 do QS). Fica no banco pelo histórico das conversas e pra
  // numeroPadrao() saber que não deve usá-lo. Número de SDR desconectado continua
  // aparecendo — é por ele que se vê que precisa reconectar.
  const visiveis = (linhas || []).filter((n) => n.user_id || n.status !== 'desconectado');
  const numeros = await Promise.all(visiveis.map(async (n) => {
    const temToken = Boolean(n.segredo_id) || (n.phone_number_id === envPhone && Boolean(process.env.META_CALLS_TOKEN || process.env.META_WA_TOKEN));
    let meta = null;
    let metaErro = null;
    if (temToken && n.status === 'conectado') {
      try {
        const cr = await credenciaisDaMeta(n.phone_number_id);
        if (cr) {
          meta = await graph(
            `/${n.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,status`,
            { token: cr.token, timeoutMs: 8000 }
          );
        }
      } catch (e) {
        metaErro = e.message;
      }
    }
    // Modelos da conta deste número — só pra número de SDR (conta própria na
    // Coexistence). O oficial já mostra os dele na tela de modelos.
    const modelos = (n.user_id && temToken && n.status === 'conectado')
      ? await contarModelos(n.phone_number_id).catch(() => null)
      : null;

    // Última mensagem de cliente que entrou por este número.
    let ultimaEntrada = null;
    try {
      const filtro = n.user_id
        ? `linha_user_id=eq.${encodeURIComponent(n.user_id)}`
        : (n.cw_inbox_id != null ? `cw_inbox_id=eq.${Number(n.cw_inbox_id)}` : null);
      if (filtro) {
        const r = await rest(`qs_wa_messages?select=sent_at&direction=eq.in&${filtro}&order=sent_at.desc&limit=1`);
        ultimaEntrada = r?.[0]?.sent_at || null;
      }
    } catch { /* segue */ }

    return {
      phoneId: n.phone_number_id,
      numero: meta?.display_phone_number || n.numero || null,
      nome: meta?.verified_name || n.nome_verificado || n.rotulo || null,
      modo: n.modo,
      status: temToken ? n.status : 'desconectado',
      origem: n.segredo_id ? 'painel' : (n.phone_number_id === envPhone ? 'vercel' : null),
      dono: n.user_id ? (nomes.get(n.user_id) || 'SDR') : null,
      donoId: n.user_id || null,
      conectadoEm: n.conectado_em || null,
      qualidade: meta?.quality_rating || null,       // GREEN | YELLOW | RED
      limite: meta?.messaging_limit_tier || null,    // TIER_250 | TIER_1K | ...
      statusMeta: meta?.status || null,
      metaErro,
      ultimaEntrada,
      modelos,
    };
  }));

  return {
    ok: true,
    numeros,
    cadastro: cfg,
    entrada: saude,
    sdrs: (users || []).filter((u) => u.role === 'sdr' || u.role === 'closer').map((u) => ({ id: u.id, nome: u.name })),
  };
}
