// api/closer.js
// -----------------------------------------------------------------------------
// ÁREA DO CLOSER (0174–0176, 22/10/2026) — o que precisa de servidor.
//
//   POST { acao: 'espelhar', negocioId }
//        → a VENDA CONSOLIDADA vai pro Bitrix: crm.deal.update do negócio do
//          lead (qs_leads.bitrix_id) com o valor (OPPORTUNITY) e a etapa de
//          venda realizada do funil em que o card está. "QS manda, Bitrix
//          espelha" (Bruno, 22/10).
//
// IDEMPOTENTE: lê o card antes; se valor e etapa já batem, não regrava nada.
// O comentário na timeline só sai quando alguma coisa mudou. Pode apertar
// "reenviar" quantas vezes quiser.
//
// FALHOU? O erro fica no cartão (qs_closer_negocios.bitrix_status = 'erro' +
// bitrix_erro) e a tela mostra o botão "Reenviar ao Bitrix". A venda no QS já
// está gravada — o Bitrix é só o espelho.
//
// Env: BITRIX_WEBHOOK_BASE (a mesma do resto do QS), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
//
// CONTRATO (0180, 22/10 — "tudo via código, sem n8n"; ver docs/CONTRATO.md):
//   POST { acao: 'contrato-config' }               → o que está pronto / o que falta
//   POST { acao: 'contrato-config-salvar', valor } → (gestão) templates, pasta, assinante
//   POST { acao: 'google-conectar' }               → (gestão) URL do consentimento do Google
//   GET  ?acao=google-callback&code&state          → o Google volta aqui; grava o refresh token
//   POST { acao: 'google-desconectar' }            → (gestão) revoga e apaga
//   POST { acao: 'zapsign-testar' }                → (gestão) confere o ZAPSIGN_API_TOKEN
//   POST { acao: 'contrato-previa', negocioId }    → campos sugeridos + de onde vieram
//   POST { acao: 'contrato-enviar', negocioId, campos, substituir? }
//        → gera pelo Google, arquiva o PDF no Drive, cria no ZapSign, grava o envio
//   POST { acao: 'contrato-atualizar', contratoId }→ relê o documento no ZapSign
//   POST { acao: 'contrato-cancelar', contratoId, motivo } → apaga no ZapSign + cancela
//   POST ?acao=zapsign-webhook                     → o ZapSign avisa (header X-QS-Secret)
// Envs novas: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ZAPSIGN_API_TOKEN,
// ZAPSIGN_WEBHOOK_SECRET; opcionais QS_URL_PUBLICA e ZAPSIGN_API_URL (sandbox).
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado, comentarNoNegocio } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';
import {
  apagarNoZapsign, arquivarAssinado, conectarGoogle, conferirEstado, contaGoogle, criarNoZapsign, desconectarGoogle,
  gerarPdf, hashDoCorpo, lerConfig, lerNoZapsign, montarPrevia, nomesDoArquivo, normalizarCampos, oQueFalta,
  statusDoDocumento, testarZapsign, urlDeConsentimento, urlDeRetorno, urlDoApp, validarCampos,
} from './_contrato.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICO = {
  expedicao: 'Expedição', pacote: 'Pacote', aereo: 'Aéreo', hospedagem: 'Hospedagem', passeio: 'Passeio',
  cruzeiro: 'Cruzeiro', seguro: 'Seguro', concierge: 'Concierge', conta_liminar: 'Conta liminar', outro: 'Outro',
};
const FORMA = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', link: 'Link de pagamento', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outra' };

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID_RE.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return u?.is_active ? u : null;
}

/** Mesma regra do banco (closer_pode_mexer): gestor do Comercial/admin, ou o closer dono. */
function podeMexer(u, negocio) {
  if (u.role === 'admin') return true;
  if (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('comercial')) return true;
  return u.role === 'closer' && negocio.closer_id === u.id;
}

/** A etapa de "venda realizada" do funil do card. Comercial 1 (categoria 0) = WON. */
async function etapaDeVenda(categoria) {
  const cat = String(categoria ?? '0');
  if (cat === '0') return 'WON';
  try {
    const etapas = await bx('crm.status.list', { filter: { ENTITY_ID: `DEAL_STAGE_${cat}` } }, 8_000);
    const lista = etapas || [];
    const porNome = lista.find((e) => /venda\s+realizada/i.test(String(e?.NAME || '')));
    if (porNome) return String(porNome.STATUS_ID);
    const sucesso = lista.find((e) => ['S', 'success'].includes(e?.EXTRA?.SEMANTICS || e?.SEMANTICS));
    return sucesso ? String(sucesso.STATUS_ID) : null;
  } catch {
    return null;
  }
}

function resumoDaFicha(f, parcelas) {
  const linhas = [
    '✅ VENDA CONSOLIDADA no QS (o QS é a fonte da verdade desta venda).',
    `Serviço: ${SERVICO[f?.servico] || f?.servico || '—'}${f?.destino ? ` — ${f.destino}` : ''}`,
    `Datas: ${dataBr(f?.data_ida)} → ${dataBr(f?.data_volta)} · Passageiros: ${f?.qtd_passageiros || '—'}`,
    `Valor total: ${brl(f?.valor_total)}`,
  ];
  if (parcelas.length) {
    linhas.push('Plano de pagamento:');
    for (const p of parcelas) {
      linhas.push(`• ${p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`}: ${brl(p.valor)} — vence ${dataBr(p.vencimento)} — ${FORMA[p.forma] || p.forma}${p.recorrente ? ' (recorrente)' : ''}`);
    }
  }
  return linhas.join('\n');
}

async function marcar(negocioId, campos, evento, autorId) {
  await rest(`qs_closer_negocios?id=eq.${negocioId}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
  if (evento) {
    await rest('qs_closer_negocio_eventos', {
      method: 'POST', prefer: 'return=minimal',
      body: { negocio_id: negocioId, tipo: 'bitrix', texto: evento, autor_id: autorId || null },
    }).catch(() => null);
  }
}

async function espelhar(negocioId, u) {
  const n = (await rest(`qs_closer_negocios?select=id,lead_id,closer_id,etapa,ficha,valor_previsto,bitrix_status&id=eq.${negocioId}&limit=1`))?.[0];
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.etapa !== 'consolidada') return { status: 409, body: { error: 'A venda ainda não foi consolidada.' } };

  const lead = (await rest(`qs_leads?select=id,bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '');
  if (!dealId) {
    await marcar(n.id, { bitrix_status: 'sem_card', bitrix_erro: 'O lead não tem negócio no Bitrix.' });
    return { status: 200, body: { ok: false, status: 'sem_card', mensagem: 'Este cliente não tem card no Bitrix — a venda ficou só no QS.' } };
  }

  try {
    const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000);
    if (!deal) throw new Error(`Negócio ${dealId} não encontrado no Bitrix.`);
    const valor = Number(n.ficha?.valor_total ?? n.valor_previsto ?? 0);
    const alvo = await etapaDeVenda(deal.CATEGORY_ID);
    const fields = {};
    if (valor > 0 && Math.abs(Number(deal.OPPORTUNITY || 0) - valor) > 0.009) {
      fields.OPPORTUNITY = valor;
      fields.CURRENCY_ID = 'BRL';
    }
    if (alvo && String(deal.STAGE_ID) !== alvo) fields.STAGE_ID = alvo;

    if (Object.keys(fields).length) {
      await bx('crm.deal.update', { id: Number(dealId), fields, params: { REGISTER_SONET_EVENT: 'Y' } }, 8_000);
      const parcelas = (await rest(`fin_planos?select=fin_parcelas(numero,valor,vencimento,forma,recorrente)&negocio_id=eq.${n.id}&limit=1`).catch(() => null))?.[0]?.fin_parcelas || [];
      parcelas.sort((a, b) => a.numero - b.numero);
      await comentarNoNegocio(dealId, resumoDaFicha(n.ficha, parcelas));
    }
    const nota = Object.keys(fields).length
      ? `Bitrix atualizado (negócio ${dealId}): ${fields.STAGE_ID ? 'etapa de venda realizada' : ''}${fields.STAGE_ID && fields.OPPORTUNITY ? ' + ' : ''}${fields.OPPORTUNITY ? `valor ${brl(valor)}` : ''}.`
      : `Bitrix já estava certo (negócio ${dealId}) — nada regravado.`;
    await marcar(n.id, {
      bitrix_status: 'ok',
      bitrix_erro: alvo ? null : 'Funil sem etapa de venda realizada: só o valor foi enviado.',
      bitrix_enviado_em: new Date().toISOString(),
    }, nota, u.id);
    return { status: 200, body: { ok: true, status: 'ok', mudou: Object.keys(fields), dealId } };
  } catch (e) {
    const msg = String(e?.message || 'Falhou').slice(0, 500);
    console.error('[closer] espelhar', n.id, msg);
    await marcar(n.id, { bitrix_status: 'erro', bitrix_erro: msg }, `Bitrix recusou: ${msg}`, u.id).catch(() => null);
    return { status: 200, body: { ok: false, status: 'erro', mensagem: msg } };
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ═════════════════════════════════════════════════════════════════════════════
// CONTRATO
// ═════════════════════════════════════════════════════════════════════════════
const ehGestao = (u) => u.role === 'admin' || (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('comercial'));
const env = (k) => String(process.env[k] || '').trim();

async function carregarNegocio(id) {
  return (await rest(`qs_closer_negocios?select=id,lead_id,closer_id,etapa,ficha,valor_previsto,viagem_id,status_contrato&id=eq.${id}&limit=1`))?.[0] || null;
}

/** O ÚNICO caminho que muda status (só pra frente, idempotente) — 0180. */
async function registrarStatus(contratoId, status, extra = {}, autorId = null) {
  return rest('rpc/contrato_registrar_status', {
    method: 'POST',
    body: { p_contrato: contratoId, p_status: status, p_extra: extra, p_autor: autorId },
  });
}

async function situacaoDaConfig() {
  const [cfg, g] = await Promise.all([lerConfig(), contaGoogle()]);
  return { cfg, g, falta: oQueFalta(cfg, g) };
}

async function configParaTela(req, u) {
  const { cfg, g, falta } = await situacaoDaConfig();
  return {
    podeConfigurar: ehGestao(u),
    modo: falta.length ? 'manual' : 'automatico',
    falta,
    config: cfg,
    google: {
      clienteConfigurado: Boolean(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET')),
      conectado: Boolean(g?.refresh_token),
      email: g?.email || null,
      conectadoEm: g?.conectado_em || null,
      ultimoErro: g?.ultimo_erro || null,
    },
    zapsign: {
      token: Boolean(env('ZAPSIGN_API_TOKEN')),
      webhookSecret: Boolean(env('ZAPSIGN_WEBHOOK_SECRET')),
      sandbox: /sandbox/i.test(env('ZAPSIGN_API_URL')),
    },
    redirectUri: urlDeRetorno(req),
    webhookUrl: `${urlDoApp(req)}/api/closer?acao=zapsign-webhook`,
  };
}

async function contratoAtivo(negocioId) {
  return (await rest(`qs_contratos?select=id,status,modo,zapsign_token&negocio_id=eq.${negocioId}&status=in.(enviado,visualizado,assinado)&order=criado_em.desc&limit=1`).catch(() => null))?.[0] || null;
}

async function enviarContrato(u, body) {
  const id = String(body.negocioId || '');
  if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Cartão inválido.' } };
  const n = await carregarNegocio(id);
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.etapa === 'perdido') return { status: 409, body: { error: 'O cartão está como perdido.' } };

  const { cfg, falta } = await situacaoDaConfig();
  if (falta.length) return { status: 409, body: { error: 'O envio automático ainda não está configurado.', falta } };

  const c = normalizarCampos(body.campos);
  const { erros } = validarCampos(c);
  if (erros.length) return { status: 400, body: { error: `Falta preencher: ${erros.join(' ')}`, erros } };

  const ativo = await contratoAtivo(n.id);
  if (ativo && !body.substituir) {
    return { status: 409, body: { error: ativo.status === 'assinado' ? 'Este cliente já assinou um contrato.' : 'Já tem um contrato enviado aguardando assinatura.', precisaConfirmar: true, statusAtual: ativo.status } };
  }

  // "gerando" esquecido (função que estourou o tempo) vira erro e libera o cartão.
  const tresMin = new Date(Date.now() - 3 * 60_000).toISOString();
  await rest(`qs_contratos?negocio_id=eq.${n.id}&status=eq.gerando&criado_em=lt.${tresMin}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'erro', erro: 'Tempo esgotado ao gerar.' },
  }).catch(() => null);

  const lead = (await rest(`qs_leads?select=bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '') || null;
  let linha;
  try {
    linha = (await rest('qs_contratos', {
      method: 'POST', prefer: 'return=representation',
      body: { negocio_id: n.id, lead_id: n.lead_id, tipo: c.tipo, modo: 'automatico', status: 'gerando', campos: c, bitrix_deal_id: dealId, enviado_por: u.id },
    }))?.[0];
  } catch (e) {
    if (e.status === 409) return { status: 409, body: { error: 'Já tem um contrato sendo gerado pra este cartão. Espere um pouco.' } };
    throw e;
  }

  const nomes = nomesDoArquivo(c, dealId, n.id);
  let gerado = null;
  try {
    gerado = await gerarPdf(c, cfg, nomes);
    await rest(`qs_contratos?id=eq.${linha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { drive_pdf_id: gerado.driveId, drive_pdf_url: gerado.driveUrl } });
    const zs = await criarNoZapsign({ c, cfg, nomes, pdf: gerado.pdf, negocioId: n.id });
    if (!zs.token) throw new Error('O ZapSign não devolveu o documento.');
    await rest(`qs_contratos?id=eq.${linha.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { zapsign_token: zs.token, zapsign_open_id: zs.openId, link_assinatura: zs.link },
    });
    await registrarStatus(linha.id, 'enviado', {}, u.id);
  } catch (e) {
    const msg = String(e?.message || 'Falhou.').slice(0, 900);
    console.error('[closer] contrato', n.id, msg);
    await registrarStatus(linha.id, 'erro', { erro: msg }, u.id).catch(() => null);
    return { status: 200, body: { ok: false, erro: msg, sobraram: e.sobraram || null, pdf: gerado?.driveUrl || null } };
  }

  // O envio anterior (se o closer confirmou substituir) é cancelado — lá no ZapSign também.
  if (ativo) {
    if (ativo.zapsign_token && ativo.status !== 'assinado') await apagarNoZapsign(ativo.zapsign_token).catch(() => null);
    await registrarStatus(ativo.id, 'cancelado', { motivo: 'Substituído por um contrato novo.' }, u.id).catch(() => null);
  }
  if (dealId) await comentarNoNegocio(dealId, `📄 Contrato de ${c.tipo === 'expedicao' ? 'expedição' : 'pacote'} enviado pelo QS (ZapSign) para ${c.email}.`).catch(() => null);
  const final = (await rest(`qs_contratos?select=id,link_assinatura,drive_pdf_url&id=eq.${linha.id}&limit=1`))?.[0];
  return { status: 200, body: { ok: true, contratoId: linha.id, link: final?.link_assinatura || null, pdf: final?.drive_pdf_url || null } };
}

/** Lê o documento no ZapSign e aplica o status (webhook e botão "Atualizar"). */
async function conferirNoZapsign(contrato, autorId) {
  const doc = await lerNoZapsign(contrato.zapsign_token);
  const st = statusDoDocumento(doc, contrato.campos?.email);
  if (!st) return contrato.status;
  const extra = { ...(st.extra || {}) };
  if (st.status === 'assinado' && !contrato.pdf_assinado_url && st.arquivo) {
    // Cópia assinada no Drive (o link do ZapSign expira). Sem Google: fica sem cópia.
    try {
      const cfg = await lerConfig();
      const nomes = nomesDoArquivo(contrato.campos || {}, contrato.bitrix_deal_id, contrato.negocio_id);
      extra.pdf_assinado_url = await arquivarAssinado(st.arquivo, `${nomes.arquivo} (assinado).pdf`, cfg);
    } catch (e) {
      console.warn('[closer] PDF assinado não arquivado', contrato.id, e?.message);
    }
  }
  const antes = contrato.status;
  const depois = await registrarStatus(contrato.id, st.status, extra, autorId);
  if (st.status === 'assinado' && antes !== 'assinado' && contrato.bitrix_deal_id) {
    await comentarNoNegocio(contrato.bitrix_deal_id, `✅ Contrato ASSINADO pelo cliente (ZapSign).${extra.pdf_assinado_url ? ` PDF: ${extra.pdf_assinado_url}` : ''}`).catch(() => null);
  }
  return depois;
}

const COLS_CONTRATO = 'id,negocio_id,status,modo,campos,zapsign_token,pdf_assinado_url,bitrix_deal_id';

async function webhookZapsign(req, res) {
  const segredo = env('ZAPSIGN_WEBHOOK_SECRET');
  if (!segredo) return res.status(503).json({ error: 'ZAPSIGN_WEBHOOK_SECRET não configurado.' });
  if (!segredoConfere(req.headers['x-qs-secret'], segredo)) return res.status(401).json({ error: 'Segredo inválido.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = String(body.token || body.doc_token || body.document?.token || '').trim();
  const evento = String(body.event_type || body.event || '').slice(0, 60) || null;
  const chave = hashDoCorpo(body);

  // Idempotência: o mesmo corpo duas vezes = processa uma vez só.
  const nova = await rest('qs_contrato_webhooks?on_conflict=chave', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { chave, zapsign_token: token || null, evento, payload: body },
  }).catch((e) => { console.error('[closer] webhook log', e?.message); return null; });
  if (Array.isArray(nova) && nova.length === 0) return res.status(200).json({ ok: true, repetido: true });
  const marcar = (resultado) => rest(`qs_contrato_webhooks?chave=eq.${chave}`, { method: 'PATCH', prefer: 'return=minimal', body: { resultado } }).catch(() => null);

  if (!/^[0-9a-f-]{20,60}$/i.test(token)) { await marcar('sem token'); return res.status(200).json({ ok: true, ignorado: 'sem token' }); }
  const contrato = (await rest(`qs_contratos?select=${COLS_CONTRATO}&zapsign_token=eq.${token}&limit=1`))?.[0];
  if (!contrato) { await marcar('documento não é do QS'); return res.status(200).json({ ok: true, ignorado: 'documento desconhecido' }); }

  try {
    let status;
    if (env('ZAPSIGN_API_TOKEN')) {
      // Nunca confia no corpo: relê o documento no ZapSign.
      status = await conferirNoZapsign(contrato, null);
    } else {
      // Sem token pra conferir (só acontece se tiraram o token depois): usa o corpo, já validado pelo segredo.
      const st = statusDoDocumento(body, contrato.campos?.email);
      status = st ? await registrarStatus(contrato.id, st.status, st.extra || {}, null) : contrato.status;
    }
    await marcar(`status: ${status}`);
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    await marcar(`erro: ${String(e?.message || '').slice(0, 300)}`);
    // 500 faz o ZapSign tentar de novo depois — e o próximo corpo igual NÃO é
    // barrado pela idempotência porque apagamos a marca.
    await rest(`qs_contrato_webhooks?chave=eq.${chave}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
    return res.status(500).json({ error: 'Falhou ao conferir no ZapSign.' });
  }
}

async function googleCallback(req, res) {
  const app = urlDoApp(req);
  const voltar = (resultado) => { res.statusCode = 302; res.setHeader('Location', `${app}/#closer/contrato/${resultado}`); return res.end(); };
  const estado = conferirEstado(req.query?.state);
  if (!estado) return voltar('erro-estado');
  if (req.query?.error) return voltar('erro-negado');
  const u = (await rest(`qs_users?select=id,role,setores,is_active&id=eq.${estado.u}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active || !ehGestao(u)) return voltar('erro-permissao');
  try {
    await conectarGoogle(req, String(req.query?.code || ''), u.id);
    return voltar('conectado');
  } catch (e) {
    console.error('[closer] google callback', e?.message);
    await rest('qs_contrato_google?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: String(e?.message).slice(0, 300), ultimo_erro_em: new Date().toISOString() } }).catch(() => null);
    return voltar('erro-google');
  }
}

async function acaoDeContrato(acao, req, u, body) {
  if (acao === 'contrato-config') return { status: 200, body: await configParaTela(req, u) };

  if (acao === 'contrato-config-salvar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial muda a configuração.' } };
    // Grava pela RPC (valida os IDs e confere a permissão de novo no banco) — com o token do usuário.
    const r = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/rpc/contrato_config_salvar`, {
      method: 'POST',
      headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: req.headers['authorization'], 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_valor: body.valor || {} }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { status: 400, body: { error: /id-google-invalido/.test(j.message) ? 'ID do Google inválido (copie só o pedaço entre /d/ e /edit).' : /email-invalido/.test(j.message) ? 'E-mail do assinante inválido.' : (j.message || 'Não salvou.') } };
    }
    return { status: 200, body: await configParaTela(req, u) };
  }

  if (acao === 'google-conectar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial conecta a conta Google.' } };
    if (!env('GOOGLE_OAUTH_CLIENT_ID') || !env('GOOGLE_OAUTH_CLIENT_SECRET')) return { status: 503, body: { error: 'Falta GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET na Vercel.' } };
    return { status: 200, body: { url: urlDeConsentimento(req, u.id) } };
  }

  if (acao === 'google-desconectar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial desconecta.' } };
    await desconectarGoogle();
    return { status: 200, body: await configParaTela(req, u) };
  }

  if (acao === 'zapsign-testar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial.' } };
    try { await testarZapsign(); return { status: 200, body: { ok: true } }; }
    catch (e) { return { status: 200, body: { ok: false, erro: e.message } }; }
  }

  if (acao === 'contrato-previa') {
    const id = String(body.negocioId || '');
    if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Cartão inválido.' } };
    const n = await carregarNegocio(id);
    if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
    if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
    const [previa, sit] = await Promise.all([montarPrevia(n), situacaoDaConfig()]);
    return { status: 200, body: { ...previa, modo: sit.falta.length ? 'manual' : 'automatico', falta: sit.falta } };
  }

  if (acao === 'contrato-enviar') return enviarContrato(u, body);

  if (acao === 'contrato-atualizar' || acao === 'contrato-cancelar') {
    const id = String(body.contratoId || '');
    if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Contrato inválido.' } };
    const c = (await rest(`qs_contratos?select=${COLS_CONTRATO}&id=eq.${id}&limit=1`))?.[0];
    if (!c) return { status: 404, body: { error: 'Contrato não encontrado.' } };
    const n = await carregarNegocio(c.negocio_id);
    if (!n || !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
    if (acao === 'contrato-atualizar') {
      if (!c.zapsign_token) return { status: 409, body: { error: 'Este contrato foi enviado por fora do ZapSign do QS.' } };
      if (!env('ZAPSIGN_API_TOKEN')) return { status: 503, body: { error: 'Falta ZAPSIGN_API_TOKEN na Vercel.' } };
      const status = await conferirNoZapsign(c, u.id);
      return { status: 200, body: { ok: true, status } };
    }
    if (c.status === 'assinado') return { status: 409, body: { error: 'Contrato assinado não se cancela.' } };
    if (c.zapsign_token && env('ZAPSIGN_API_TOKEN')) await apagarNoZapsign(c.zapsign_token).catch((e) => console.warn('[closer] apagar no ZapSign', e?.message));
    const status = await registrarStatus(c.id, 'cancelado', { motivo: String(body.motivo || '').slice(0, 300) }, u.id);
    return { status: 200, body: { ok: true, status } };
  }
  return null;
}

export default async function handler(req, res) {
  const acaoQ = String(req.query?.acao || '');
  // Entradas SEM usuário logado (cada uma com a própria trava).
  if (acaoQ === 'google-callback' && req.method === 'GET') return googleCallback(req, res);
  if (acaoQ === 'zapsign-webhook' && req.method === 'POST') {
    try { return await webhookZapsign(req, res); }
    catch (e) { console.error('[closer] webhook', e?.message); return res.status(500).json({ error: 'Falhou.' }); }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Entre de novo no QS.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(req.query?.acao || body.acao || '');

  try {
    if (acao === 'espelhar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      const id = String(body.negocioId || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cartão inválido.' });
      const r = await espelhar(id, u);
      return res.status(r.status).json(r.body);
    }
    if (acao.startsWith('contrato-') || acao.startsWith('google-') || acao === 'zapsign-testar') {
      if (!(u.role === 'closer' || ehGestao(u))) return res.status(403).json({ error: 'Só closer e gestão do Comercial.' });
      const r = await acaoDeContrato(acao, req, u, body);
      if (r) return res.status(r.status).json(r.body);
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[closer]', e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
