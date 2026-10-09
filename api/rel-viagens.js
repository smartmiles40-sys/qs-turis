// api/rel-viagens.js
// -----------------------------------------------------------------------------
// VIAGENS DO RELACIONAMENTO NASCEM DA VENDA NO BITRIX (Fase 3, 0103).
//
//   GET  (Vercel Cron, a cada 30 min, Authorization: Bearer CRON_SECRET)
//        → sincroniza: lê os negócios do Comercial 1 (categoria 0) mexidos
//          desde a última rodada.
//   POST { acao: 'sincronizar' }          → o mesmo, pelo botão da tela
//   POST { acao: 'importar', dealId }     → traz UM negócio (qualquer etapa)
//
// Regras da sincronização:
//   • Venda = etapa "Em emissão" (UC_70BW8E) ou ganho (WON). É a mesma regra do
//     Dashboard: "Em emissão" já conta como venda (21/09/2026).
//   • Desistência (UC_NV92A7) ou perdido (LOSE) → a viagem que já existe vira
//     'cancelada'. As etapas Gerar Pagamento/Envio de contrato também são do
//     grupo "falha" no Bitrix (UC_IHT3PF, UC_FYJCD5) mas vêm ANTES da venda —
//     por isso o cancelamento olha a etapa, nunca o grupo.
//   • ID pai preenchido (≠ "0", ≠ o próprio ID): o negócio é de ACOMPANHANTE
//     (casal, família) — a pessoa entra como passageira na viagem do pai.
//   • O cliente é achado pela ficha única: CPF → contato do Bitrix → telefone.
//     Nunca apaga o que já está na ficha; só completa o que falta.
//   • Na viagem que já existe, campo que vier vazio do Bitrix NÃO apaga o que o
//     time editou à mão.
//
// O cursor fica em rel_config.bitrix_sync. A primeira rodada é um "backfill":
// vendas com Data de Ida a partir de 30 dias atrás OU vendidas desde 01/06/2026.
// Cada rodada tem ~50 s; o que não couber continua na próxima.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';

const ORCAMENTO_MS = 50_000;
const ETAPAS_VENDA = new Set(['WON', 'UC_70BW8E']);
const ETAPAS_CANCELA = new Set(['UC_NV92A7', 'LOSE']);

// Campos do negócio (Comercial 1). Mapeados em 09/10/2026 por crm.deal.fields.
const F = {
  destino: 'UF_CRM_1746633298495',
  ida: 'UF_CRM_1746633380991',
  volta: 'UF_CRM_1746633410333',
  nomeExpedicao: 'UF_CRM_1768941254969',      // enum ("Não se aplica" = não é expedição)
  selecioneExpedicao: 'UF_CRM_1746374883088', // enum (antigo)
  qualExpedicao: 'UF_CRM_1771970668975',      // enum (form de fechamento)
  tipoVenda: 'UF_CRM_1743296167520',          // enum
  tipoPacote: 'UF_CRM_1771511032311',         // enum
  cpf: 'UF_CRM_1762288761917',
  validadePassaporte: 'UF_CRM_DEAL_1771942313366',
  nascimento: 'UF_CRM_1756148121396',
  nascimento2: 'UF_CRM_DATADENASCIMENTO',
  pax: 'UF_CRM_1778773233483',
  pax2: 'UF_CRM_1756146545056',
  dataVenda: 'UF_CRM_1767827179708',
  obsRelacionamento: 'UF_CRM_1756147556245',
  necessidade: 'UF_CRM_1756147294051',
  idPai: 'UF_CRM_1790891281841',
};
// Campos do contato.
const C = {
  cpf: 'UF_CRM_1749757426655',
  cpf2: 'UF_CRM_1752691408782',
  passaporte: 'UF_CRM_1752523114589',
  passaporte2: 'UF_CRM_1783969513247',
  vencPassaporte: 'UF_CRM_1752523126895',
};

const SELECT_DEAL = ['ID', 'TITLE', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', 'OPPORTUNITY', 'CONTACT_ID', 'DATE_MODIFY', ...Object.values(F)];

// ── Pequenas utilidades ─────────────────────────────────────────────────────

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const vazio = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const texto = (v) => (vazio(v) ? null : String(Array.isArray(v) ? v[0] : v).trim() || null);
/** "2026-11-09T03:00:00+03:00" → "2026-11-09" (o Bitrix guarda a data no fuso dele). */
const data = (v) => {
  const t = texto(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
const numero = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Mesmo jeito do gatilho do banco: dígitos e, com DDD BR sem 55, põe o 55. */
function telefoneNormal(v) {
  let d = soDigitos(v);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const calc = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]) ? d : null;
}

function passaporteValido(v) {
  const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{5,12}$/.test(p) ? p : null;
}

function emailValido(v) {
  const e = String(v ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

// ── Rótulos dos campos de lista (enum) ──────────────────────────────────────

let cacheCampos = null;
async function rotulos() {
  if (cacheCampos && Date.now() - cacheCampos.em < 30 * 60_000) return cacheCampos.v;
  const campos = await bx('crm.deal.fields', {}, 12_000);
  const v = {};
  for (const [k, def] of Object.entries(campos || {})) {
    if (Array.isArray(def?.items)) v[k] = new Map(def.items.map((i) => [String(i.ID), String(i.VALUE)]));
  }
  cacheCampos = { v, em: Date.now() };
  return v;
}
function rotulo(mapa, campo, valor) {
  const id = texto(valor);
  if (!id) return null;
  return mapa[campo]?.get(id) || null;
}

// ── Cliente (ficha única) ───────────────────────────────────────────────────

/** Lê o contato do Bitrix (cache por rodada). */
async function contatoDoBitrix(id, cache) {
  const k = soDigitos(id);
  if (!k || k === '0') return null;
  if (cache.has(k)) return cache.get(k);
  let c = null;
  try { c = await bx('crm.contact.get', { id: k }); } catch (e) { console.warn('[rel-viagens] contato', k, e?.message); }
  cache.set(k, c);
  return c;
}

/** Os dados da pessoa, juntando negócio + contato. */
function dadosDaPessoa(deal, contato) {
  const nome = [texto(contato?.NAME), texto(contato?.LAST_NAME)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    || null;
  const fone = Array.isArray(contato?.PHONE) ? contato.PHONE.map((p) => telefoneNormal(p?.VALUE)).find(Boolean) : null;
  const email = Array.isArray(contato?.EMAIL) ? contato.EMAIL.map((p) => emailValido(p?.VALUE)).find(Boolean) : null;
  return {
    nome,
    telefone: fone || null,
    email: email || null,
    cpf: cpfValido(deal?.[F.cpf]) || cpfValido(contato?.[C.cpf]) || cpfValido(contato?.[C.cpf2]),
    nascimento: data(deal?.[F.nascimento]) || data(deal?.[F.nascimento2]) || data(contato?.BIRTHDATE),
    passaporte: passaporteValido(contato?.[C.passaporte]) || passaporteValido(contato?.[C.passaporte2]),
    passaporte_validade: data(deal?.[F.validadePassaporte]) || data(contato?.[C.vencPassaporte]),
    bitrix_contato_id: texto(contato?.ID) || (soDigitos(deal?.CONTACT_ID) && deal.CONTACT_ID !== '0' ? String(deal.CONTACT_ID) : null),
  };
}

const VIVOS = 'mesclado_em_id=is.null';
async function procurar(filtro) {
  const r = await rest(`rel_clientes?select=*&${filtro}&${VIVOS}&limit=1`);
  return r?.[0] || null;
}

/** Acha (CPF → contato Bitrix → telefone) ou cria a ficha. Devolve o id ou null. */
async function garantirCliente(p) {
  if (!p.nome && !p.telefone && !p.cpf) return null;
  let atual = null;
  if (p.cpf) atual = await procurar(`cpf=eq.${p.cpf}`);
  if (!atual && p.bitrix_contato_id) atual = await procurar(`bitrix_contato_id=eq.${encodeURIComponent(p.bitrix_contato_id)}`);
  if (!atual && p.telefone) atual = await procurar(`telefone=eq.${p.telefone}`);

  if (atual) {
    // Só completa o que falta. Os campos únicos (CPF, passaporte, Bitrix) podem
    // colidir com outra ficha — aí tenta de novo sem eles.
    const patch = {};
    for (const k of ['telefone', 'email', 'cpf', 'nascimento', 'passaporte', 'passaporte_validade', 'bitrix_contato_id']) {
      if (vazio(atual[k]) && !vazio(p[k])) patch[k] = p[k];
    }
    if (Object.keys(patch).length) {
      try {
        await rest(`rel_clientes?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      } catch (e) {
        if (e?.status !== 409) throw e;
        delete patch.cpf; delete patch.passaporte; delete patch.bitrix_contato_id;
        if (Object.keys(patch).length) await rest(`rel_clientes?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      }
    }
    return atual.id;
  }

  const novo = {
    nome: p.nome || (p.telefone ? `Cliente ${p.telefone.slice(-4)}` : 'Cliente do Bitrix'),
    telefone: p.telefone, email: p.email, cpf: p.cpf, nascimento: p.nascimento,
    passaporte: p.passaporte, passaporte_validade: p.passaporte_validade, bitrix_contato_id: p.bitrix_contato_id,
    observacoes: 'Ficha criada a partir da venda no Bitrix.',
  };
  try {
    const r = await rest('rel_clientes', { method: 'POST', body: novo, prefer: 'return=representation' });
    return r?.[0]?.id || null;
  } catch (e) {
    if (e?.status !== 409) throw e;
    // Alguém com o mesmo CPF/passaporte/contato já existe (talvez criado agora):
    // usa ele.
    const outro = (p.cpf && await procurar(`cpf=eq.${p.cpf}`))
      || (p.passaporte && await procurar(`passaporte=eq.${p.passaporte}`))
      || (p.bitrix_contato_id && await procurar(`bitrix_contato_id=eq.${encodeURIComponent(p.bitrix_contato_id)}`));
    return outro?.id || null;
  }
}

// ── Viagem ──────────────────────────────────────────────────────────────────

function camposDaViagem(deal, mapa) {
  const nomeExp = rotulo(mapa, F.nomeExpedicao, deal[F.nomeExpedicao]);
  const expedicao = (nomeExp && !/n[aã]o se aplica/i.test(nomeExp) ? nomeExp : null)
    || rotulo(mapa, F.qualExpedicao, deal[F.qualExpedicao])
    || rotulo(mapa, F.selecioneExpedicao, deal[F.selecioneExpedicao]);
  const tipoVenda = (rotulo(mapa, F.tipoVenda, deal[F.tipoVenda]) || '').toLowerCase();
  const tipoPacote = (rotulo(mapa, F.tipoPacote, deal[F.tipoPacote]) || '').toLowerCase();
  let tipo = 'outro';
  if (expedicao || tipoVenda.includes('expedi') || tipoPacote.includes('expedi')) tipo = 'expedicao';
  else if (tipoVenda.includes('pacote') || tipoPacote.includes('personaliz')) tipo = 'pacote';
  else if (tipoVenda.includes('aére') || tipoVenda.includes('aere') || tipoVenda.includes('passage')) tipo = 'aereo';
  else if (tipoVenda.includes('hosped')) tipo = 'hospedagem';

  const destino = texto(deal[F.destino]);
  const embarque = data(deal[F.ida]);
  let retorno = data(deal[F.volta]);
  if (retorno && embarque && retorno < embarque) retorno = null; // data trocada no Bitrix: não trava a gravação
  // Em "Em emissão" o card ainda não tem destino nem datas e o título é o
  // genérico "Negociação #id" — melhor dizer o que foi vendido.
  const tituloCard = texto(deal.TITLE);
  const generico = !tituloCard || /^negocia[cç][aã]o\s*#?\d*$/i.test(tituloCard);
  const rotuloVenda = rotulo(mapa, F.tipoVenda, deal[F.tipoVenda]);
  const titulo = expedicao || destino || (generico ? `${rotuloVenda || 'Venda'} — #${deal.ID}` : tituloCard);
  return {
    titulo: titulo.slice(0, 200),
    destino,
    expedicao,
    tipo,
    data_venda: data(deal[F.dataVenda]),
    data_embarque: embarque,
    data_retorno: retorno,
    valor: numero(deal.OPPORTUNITY),
    qtd_passageiros: Math.round(numero(deal[F.pax]) || numero(deal[F.pax2]) || 0) || null,
    observacoes: texto(deal[F.obsRelacionamento]),
    necessidades: texto(deal[F.necessidade]),
  };
}

async function viagemDoDeal(dealId) {
  const r = await rest(`rel_viagens?select=id,status,cliente_id,titulo,destino,expedicao,tipo,data_venda,data_embarque,data_retorno,valor,qtd_passageiros,observacoes,necessidades&bitrix_deal_id=eq.${encodeURIComponent(dealId)}&limit=1`);
  return r?.[0] || null;
}

/** ID pai válido = número, ≠ 0, ≠ o próprio negócio. */
function idPai(deal) {
  const p = soDigitos(deal?.[F.idPai]);
  return p && p !== '0' && p !== String(deal.ID) ? p : null;
}

/**
 * Importa um negócio. `ctx` carrega os caches e os contadores da rodada.
 * `profundidade` evita laço (pai que aponta pro filho).
 */
async function importarDeal(deal, ctx, profundidade = 0) {
  const id = String(deal.ID);
  const conta = ctx.conta;

  // ── Cancelamento ──
  if (ETAPAS_CANCELA.has(deal.STAGE_ID)) {
    const v = await viagemDoDeal(id);
    if (v && v.status !== 'cancelada') {
      await rest(`rel_viagens?id=eq.${v.id}`, { method: 'PATCH', body: { status: 'cancelada' }, prefer: 'return=minimal' });
      conta.cancelados++;
    }
    return;
  }
  if (!ctx.qualquerEtapa && !ETAPAS_VENDA.has(deal.STAGE_ID)) return;

  const contato = await contatoDoBitrix(deal.CONTACT_ID, ctx.contatos);
  const clienteId = await garantirCliente(dadosDaPessoa(deal, contato));

  // ── Acompanhante: entra como passageiro na viagem do pai ──
  const pai = idPai(deal);
  if (pai && profundidade < 2) {
    let vPai = await viagemDoDeal(pai);
    if (!vPai) {
      let dealPai = null;
      try { dealPai = await bx('crm.deal.get', { id: pai }); } catch { /* pai não existe */ }
      if (dealPai && (ETAPAS_VENDA.has(dealPai.STAGE_ID) || ctx.qualquerEtapa)) {
        await importarDeal(dealPai, { ...ctx, qualquerEtapa: true }, profundidade + 1);
        vPai = await viagemDoDeal(pai);
      }
    }
    if (vPai) {
      if (clienteId) {
        try {
          await rest('rel_viagem_passageiros?on_conflict=viagem_id,cliente_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=minimal',
            body: { viagem_id: vPai.id, cliente_id: clienteId, bitrix_deal_id: id },
          });
          conta.passageiros++;
        } catch (e) {
          // O mesmo card já é passageiro de outra viagem (o ID pai mudou): ignora.
          if (e?.status !== 409) throw e;
        }
      }
      return;
    }
    // Pai não é venda nem existe: segue como viagem própria.
  }

  // ── Viagem própria ──
  const novos = camposDaViagem(deal, ctx.mapa);
  const atual = await viagemDoDeal(id);
  if (!atual) {
    await rest('rel_viagens', {
      method: 'POST', prefer: 'return=minimal',
      body: { ...novos, cliente_id: clienteId, bitrix_deal_id: id, origem: 'bitrix', status: 'ativa' },
    });
    conta.criados++;
    return;
  }
  // Atualiza só o que veio preenchido e mudou; reativa se tinha cancelado.
  const patch = {};
  // O título só acompanha o Bitrix enquanto é o que NÓS geramos; se o time
  // renomeou a viagem na tela, fica o nome dele.
  const tituloNosso = !atual.titulo || /— #\d+$/.test(atual.titulo)
    || atual.titulo === atual.destino || atual.titulo === atual.expedicao;
  for (const [k, v] of Object.entries(novos)) {
    if (v == null) continue;
    if (k === 'titulo' && !tituloNosso) continue;
    if (String(atual[k] ?? '') !== String(v)) patch[k] = v;
  }
  if (!atual.cliente_id && clienteId) patch.cliente_id = clienteId;
  if (atual.status === 'cancelada') patch.status = 'ativa';
  if (Object.keys(patch).length) {
    await rest(`rel_viagens?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    conta.atualizados++;
  }
}

// ── A rodada ────────────────────────────────────────────────────────────────

async function lerCursor() {
  const r = await rest('rel_config?select=valor&chave=eq.bitrix_sync&limit=1').catch(() => null);
  return r?.[0]?.valor || {};
}
async function gravarCursor(valor) {
  await rest('rel_config?on_conflict=chave', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { chave: 'bitrix_sync', valor, atualizado_em: new Date().toISOString() },
  });
}

/**
 * Traz de uma vez os contatos de uma página de negócios (1 chamada em vez de
 * 50). O backfill passa de 400 vendas: sem isto, cada rodada gastaria quase
 * todo o orçamento só lendo contato um por um.
 */
async function precarregarContatos(lista, cache) {
  const ids = [...new Set(lista.map((d) => soDigitos(d.CONTACT_ID)).filter((x) => x && x !== '0' && !cache.has(x)))];
  if (!ids.length) return;
  try {
    const cs = await bx('crm.contact.list', { filter: { ID: ids }, select: ['*', 'UF_*', 'PHONE', 'EMAIL'] }, 12_000);
    for (const c of cs || []) cache.set(String(c.ID), c);
  } catch (e) {
    console.warn('[rel-viagens] contatos em lote falharam (segue um por um):', e?.message);
  }
}

/** Uma página de crm.deal.list (devolve também o `next` do Bitrix). */
async function pagina(filtro, ordem, start) {
  const base = String(process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
  const r = await fetch(`${base}/crm.deal.list.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: filtro, order: ordem, select: SELECT_DEAL, start }),
  });
  const j = await r.json().catch(() => null);
  if (!j || j.error) throw new Error(j?.error_description || j?.error || `Bitrix HTTP ${r.status}`);
  return { lista: j.result || [], next: j.next ?? null };
}

export async function sincronizar() {
  const inicio = Date.now();
  const conta = { lidos: 0, criados: 0, atualizados: 0, cancelados: 0, passageiros: 0, erros: 0, completo: true };
  const ctx = { conta, contatos: new Map(), mapa: await rotulos(), qualquerEtapa: false };
  const cursor = await lerCursor();
  const acabouTempo = () => Date.now() - inicio > ORCAMENTO_MS;

  async function processar(deal) {
    conta.lidos++;
    try { await importarDeal(deal, ctx); }
    catch (e) { conta.erros++; console.error(`[rel-viagens] negócio ${deal.ID}:`, e?.message); }
  }

  // ── 1ª vez: backfill por ID crescente (dá pra continuar de onde parou) ──
  if (!cursor.backfill_feito) {
    const corte = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const filtros = [
      { CATEGORY_ID: 0, STAGE_ID: [...ETAPAS_VENDA], [`>=${F.ida}`]: corte },
      { CATEGORY_ID: 0, STAGE_ID: [...ETAPAS_VENDA], [`>=${F.dataVenda}`]: '2026-06-01' },
    ];
    // A paginação é pelo próprio ID (">ID" + ordem crescente), não pelo `start`
    // do Bitrix: assim a rodada que estoura o tempo continua exatamente do
    // último negócio processado.
    const backfillInicio = cursor.backfill_inicio || new Date(inicio).toISOString();
    let etapa = Number(cursor.backfill_etapa || 0);
    let ultimoId = Number(cursor.backfill_id || 0);
    while (etapa < filtros.length) {
      if (acabouTempo()) {
        conta.completo = false;
        await gravarCursor({ backfill_inicio: backfillInicio, backfill_etapa: etapa, backfill_id: ultimoId });
        return conta;
      }
      const { lista } = await pagina({ ...filtros[etapa], '>ID': ultimoId }, { ID: 'ASC' }, 0);
      if (!lista.length) { etapa++; ultimoId = 0; continue; }
      await precarregarContatos(lista, ctx.contatos);
      for (const d of lista) {
        await processar(d);
        ultimoId = Math.max(ultimoId, Number(d.ID));
        if (acabouTempo()) break;
      }
    }
    // Daqui pra frente, só o que mudou desde o começo do backfill.
    await gravarCursor({ backfill_feito: true, ultimo: backfillInicio });
    return conta;
  }

  // ── Rodadas normais: tudo do Comercial 1 mexido desde o cursor ──
  // Sem filtro de etapa: é assim que a desistência/perda aparece. Ordenado por
  // data de modificação, o cursor avança até o último processado.
  let ultimo = cursor.ultimo || new Date(inicio - 86_400_000).toISOString();
  let start = 0;
  const desde = ultimo;
  for (;;) {
    if (acabouTempo()) { conta.completo = false; break; }
    // ">=": negócio com o mesmo horário do último processado não se perde
    // (processar de novo é inofensivo — tudo aqui é idempotente).
    const { lista, next } = await pagina({ CATEGORY_ID: 0, '>=DATE_MODIFY': desde }, { DATE_MODIFY: 'ASC', ID: 'ASC' }, start);
    await precarregarContatos(lista.filter((d) => ETAPAS_VENDA.has(d.STAGE_ID)), ctx.contatos);
    for (const d of lista) {
      if (ETAPAS_VENDA.has(d.STAGE_ID) || ETAPAS_CANCELA.has(d.STAGE_ID)) await processar(d);
      if (d.DATE_MODIFY) ultimo = d.DATE_MODIFY;
      if (acabouTempo()) { conta.completo = false; break; }
    }
    if (!conta.completo || next == null || !lista.length) break;
    start = next;
  }
  await gravarCursor({ ...cursor, ultimo });
  return conta;
}

// ── Rota ────────────────────────────────────────────────────────────────────

async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const ok = u.role === 'admin' || (Array.isArray(u.setores) && u.setores.includes('relacionamento'));
  return ok ? u : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });

  // Cron da Vercel
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });
    try {
      const r = await sincronizar();
      console.log(`[rel-viagens] cron: ${JSON.stringify(r)}`);
      return res.status(200).json(r);
    } catch (e) {
      console.error('[rel-viagens] cron falhou:', e?.message);
      return res.status(500).json({ error: e?.message || 'Falhou' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  try {
    if (body.acao === 'sincronizar') {
      const r = await sincronizar();
      console.log(`[rel-viagens] manual (${u.name}): ${JSON.stringify(r)}`);
      return res.status(200).json(r);
    }
    if (body.acao === 'importar') {
      const dealId = soDigitos(body.dealId);
      if (!dealId) return res.status(400).json({ error: 'Informe o número do negócio no Bitrix.' });
      let deal = null;
      try { deal = await bx('crm.deal.get', { id: dealId }); } catch { /* segue */ }
      if (!deal) return res.status(404).json({ error: `Negócio ${dealId} não encontrado no Bitrix.` });
      const conta = { lidos: 1, criados: 0, atualizados: 0, cancelados: 0, passageiros: 0, erros: 0, completo: true };
      await importarDeal(deal, { conta, contatos: new Map(), mapa: await rotulos(), qualquerEtapa: true });
      const v = await viagemDoDeal(idPai(deal) || dealId);
      return res.status(200).json({ ...conta, viagemId: v?.id || null });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[rel-viagens]', e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}

// Só para teste local (sem banco): as regras puras de leitura do Bitrix.
export const _regras = { camposDaViagem, dadosDaPessoa, idPai, rotulos, telefoneNormal, cpfValido };
