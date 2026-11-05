// api/_expBitrixSync.js
// -----------------------------------------------------------------------------
// SINCRONIZAÇÃO DE PASSAGEIROS BITRIX → EXPEDIÇÕES (05/11/2026).
// Porta do sistema antigo (sistema-expedicoes): a0a7eb5 (sync genérica, etapa por
// expedição + automática), 685d5f8 (fila "Novas vendas"), b1c8258 (avulso casado
// pelo deal entra na expedição), 513705e (deal sem contato não vira "Sem nome") e
// 0229a25/e9ec971 (fan-out diário às 09:00 de Brasília).
//
// Usado por api/expedicoes.js:
//   POST ?acao=sincronizar-bitrix  → botão "Atualizar do Bitrix" (uma expedição, grava na hora).
//   GET  ?acao=sincronizar-todas   → Vercel Cron (Bearer CRON_SECRET), 12:00 UTC = 09:00 BRT.
//
// Qual é a coluna (etapa) do Bitrix de cada expedição:
//   1) expedicoes.bitrix_stage_id ("C29:UC_F6M93I" — a etapa exata; coluna da 0317);
//   2) senão expedicoes.bitrix_pipeline_id (etapa "C12:UC_X" ou funil "C12"/"12");
//   3) senão (só no botão) a etapa onde está a MAIORIA dos negócios dos passageiros dela.
// A automática só roda nas expedições com 1 ou 2 — nunca chuta.
//
// Casamento negócio → passageiro (função pura decidirCasamento, testada em
// tests/expedicoes/novasVendas.test.ts):
//   a) pelo nº do negócio (bitrix_deal_id, em qualquer expedição):
//      - linha AVULSA (sem expedição) e não pendente de aprovação → ENTRA nesta
//        expedição e vai pra fila Novas vendas (fix b1c8258; os requisitos nascem
//        pelo trigger do banco, que dispara em UPDATE OF expedicao_id);
//      - senão → só preenche o que está vazio (nunca muda de expedição);
//   b) dentro da expedição: CPF → contato do Bitrix → nome + nascimento → só preenche o vazio;
//   c) nada casou → passageiro NOVO (status Confirmado) com nova_venda = true.
//   Deal sem contato, ou contato sem nome e sem CPF → PULA (fix 513705e: no QS o
//   botão criava "Sem nome").
//
// AUTOMÁTICA × ESPELHO: enquanto o espelho (banco antigo → QS) estiver ligado, quem
// manda é o banco antigo e o espelho sobrescreveria o QS. Por isso a automática só
// GRAVA com a env EXP_BITRIX_AUTO_LIGADO=1; sem ela roda em MODO SECO: lê o Bitrix,
// decide tudo e só DEVOLVE o que faria (prévia). Nunca escreve no Bitrix.
//
// Limite de tempo e retomada: cada execução para em ~40 s. Com a tabela
// exp_bitrix_sync_rodadas (0318) a execução seguinte do mesmo dia (o cron roda às
// 12:00, 12:15 e 12:30 UTC) continua de onde parou; sem ela, só a das 12:00 roda
// e o que não coube aparece em "faltaram".
//
// Envs: BITRIX_WEBHOOK_BASE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
//       (já existem) + EXP_BITRIX_AUTO_LIGADO=1 (opcional: liga a gravação da automática).
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';

/** Mesmo teste do _bitrixLead.js (sem importar ele: este módulo fica leve pros testes). */
const bitrixConfigurado = () => !!String(process.env.BITRIX_WEBHOOK_BASE || '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NEGOCIOS = 500;
const ORCAMENTO_MS = 40_000;
const MAX_PREVIA = 40;

const enc = (v) => encodeURIComponent(String(v));
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
const texto = (v) => (vazio(v) ? null : String(v).trim());
const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Nome normalizado pra casar (sem acento, minúsculo, espaços colapsados). */
export const normNome = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const nascDia = (v) => String(v ?? '').slice(0, 10);

/** Data do Bitrix (ISO "2029-07-04T..." ou "DD/MM/AAAA") → "AAAA-MM-DD". */
export function toISO(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})[/.](\d{2})[/.](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ── Funções puras ───────────────────────────────────────────────────────────

/**
 * Coluna do Bitrix da expedição → { filtro do crm.deal.list, origem } ou null.
 * bitrix_stage_id (etapa exata) vence; depois bitrix_pipeline_id (etapa ou funil).
 */
export function colunaDaExpedicao(exp) {
  const etapa = String(exp?.bitrix_stage_id ?? '').trim();
  if (/^C\d+:[A-Z0-9_]+$/i.test(etapa)) return { filtro: { STAGE_ID: etapa.toUpperCase() }, origem: 'etapa' };
  const s = String(exp?.bitrix_pipeline_id ?? '').trim();
  if (/^C\d+:[A-Z0-9_]+$/i.test(s)) return { filtro: { STAGE_ID: s.toUpperCase() }, origem: 'coluna' };
  const m = s.match(/^C?(\d+)$/i);
  return m ? { filtro: { CATEGORY_ID: Number(m[1]) }, origem: 'funil' } : null;
}

export const rotuloColuna = (filtro) => (filtro?.STAGE_ID ? filtro.STAGE_ID : `funil ${filtro?.CATEGORY_ID}`);

// Campos custom do CONTATO no Bitrix (docs/N8N_INTEGRATION.md do antigo; mesmos de api/expedicoes.js).
const F_CPF = 'UF_CRM_1752691408782', F_CPF_ALT = 'UF_CRM_1749757426655';
const F_PASS = 'UF_CRM_1752523114589', F_PASS_ALT = 'UF_CRM_1783969513247';
const F_VENC = 'UF_CRM_1752523126895';
const multi = (v) => (Array.isArray(v) && v.length ? (v[0]?.VALUE ?? null) : null);

export const nomeDoContato = (c) => [c?.NAME, c?.SECOND_NAME, c?.LAST_NAME].filter((x) => !vazio(x)).map((x) => String(x).trim()).join(' ').trim();

/**
 * Contato CRU do Bitrix → dados do passageiro, ou { pular } quando não dá pra criar
 * ninguém (fix 513705e: sem nome E sem CPF não vira "Sem nome").
 */
export function contatoParaPassageiro(c, dealId) {
  if (!c || typeof c !== 'object') return { pular: 'negócio sem contato no Bitrix' };
  let cpf = soDig(c[F_CPF]);
  if (cpf.length < 11) { const alt = soDig(c[F_CPF_ALT]); if (alt) cpf = alt.padStart(11, '0'); }
  const nome = nomeDoContato(c);
  if (!nome && !cpf) return { pular: 'contato sem nome e sem CPF' };
  const email = multi(c.EMAIL);
  return {
    d: {
      bitrix_deal_id: String(dealId),
      bitrix_contact_id: c.ID != null && !vazio(c.ID) ? String(c.ID).trim() : null,
      // Sem nome mas com CPF: guarda um rótulo que o time reconhece e corrige.
      nome_completo: nome || `Sem nome (CPF ${cpf})`,
      cpf: cpf || null,
      passaporte: texto(c[F_PASS]) || texto(c[F_PASS_ALT]),
      validade_passaporte: toISO(c[F_VENC]),
      data_nascimento: toISO(c.BIRTHDATE),
      email: email && emailValido(email) ? String(email).trim() : null,
      telefone: texto(multi(c.PHONE)),
    },
  };
}

const CAMPOS = ['nome_completo', 'cpf', 'passaporte', 'validade_passaporte', 'data_nascimento', 'email', 'telefone', 'bitrix_contact_id', 'bitrix_deal_id'];

/** Patch "só preenche o que está vazio": o que veio preenchido e está vazio na linha. */
export function patchVazios(d, ex) {
  const patch = {};
  for (const k of CAMPOS) if (!vazio(d[k]) && vazio(ex?.[k])) patch[k] = d[k];
  return patch;
}

/** Casamento reforçado dentro da expedição: CPF → contato → nome + nascimento. */
export function acharNaLista(d, lista) {
  const cpf = soDig(d.cpf);
  const contato = vazio(d.bitrix_contact_id) ? null : String(d.bitrix_contact_id).trim();
  const nome = normNome(d.nome_completo), nasc = nascDia(d.data_nascimento);
  return (cpf && lista.find((r) => soDig(r.cpf) === cpf))
    || (contato && lista.find((r) => String(r.bitrix_contact_id ?? '').trim() === contato))
    || (nome && nasc && lista.find((r) => normNome(r.nome_completo) === nome && nascDia(r.data_nascimento) === nasc))
    || null;
}

/**
 * Decide o que fazer com UM negócio (puro, sem rede).
 * @param d          dados do passageiro (contatoParaPassageiro)
 * @param ctx.expedicaoId   expedição sendo sincronizada
 * @param ctx.porDeal       linha que já tem este bitrix_deal_id (qualquer expedição) ou null
 * @param ctx.lista         passageiros desta expedição
 * @param ctx.colunaDividida a coluna é de mais de uma expedição (não dá pra saber o grupo)
 * @param ctx.temNovaVenda  a coluna passageiros.nova_venda existe (0317)
 * @returns { acao: 'anexar'|'atualizar'|'criar'|'sem_grupo', alvo?, patch?, registro?, outraExpedicao? }
 */
export function decidirCasamento(d, { expedicaoId, porDeal = null, lista = [], colunaDividida = false, temNovaVenda = true }) {
  const marca = temNovaVenda ? { nova_venda: true } : {};
  if (porDeal) {
    const avulso = porDeal.expedicao_id == null && porDeal.pendente_aprovacao !== true;
    if (avulso) {
      if (colunaDividida) return { acao: 'sem_grupo' };
      return { acao: 'anexar', alvo: porDeal, patch: { ...patchVazios(d, porDeal), expedicao_id: expedicaoId, ...marca } };
    }
    const outra = porDeal.expedicao_id && porDeal.expedicao_id !== expedicaoId ? porDeal.expedicao_id : undefined;
    return { acao: 'atualizar', alvo: porDeal, patch: patchVazios(d, porDeal), ...(outra ? { outraExpedicao: outra } : {}) };
  }
  const naExp = acharNaLista(d, lista);
  if (naExp) return { acao: 'atualizar', alvo: naExp, patch: patchVazios(d, naExp) };
  if (colunaDividida) return { acao: 'sem_grupo' };
  return {
    acao: 'criar',
    registro: {
      expedicao_id: expedicaoId,
      ...Object.fromEntries(CAMPOS.map((k) => [k, d[k] ?? null])),
      status_reserva: 'Confirmado',
      voo_nacional_necessario: false,
      ...marca,
    },
  };
}

/**
 * A coluna é dividida? Pela etapa própria (bitrix_stage_id): só se OUTRA expedição
 * ativa usa a mesma etapa. Pela coluna/funil/maioria (como o botão sempre fez): se
 * algum negócio dela já é passageiro de outra expedição.
 */
export function colunaEhDividida({ origem, expedicaoId, porDeal, outrasComMesmaEtapa = 0 }) {
  if (origem === 'etapa') return outrasComMesmaEtapa > 0;
  return [...porDeal.values()].some((p) => p.expedicao_id && p.expedicao_id !== expedicaoId);
}

// ── Bitrix (só leitura: crm.deal.list / crm.contact.list) ───────────────────

async function bxCru(metodo, params, timeoutMs = 15_000) {
  const base = String(process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
  if (!/\.(list|get)$/.test(metodo)) throw new Error(`Método do Bitrix não permitido aqui: ${metodo}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/${metodo}.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: ctrl.signal,
    });
    const j = await r.json().catch(() => null);
    if (!j || j.error) throw new Error(`Bitrix: ${j?.error_description || j?.error || `resposta ${r.status}`}`);
    return j;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('O Bitrix não respondeu a tempo.');
    throw e;
  } finally { clearTimeout(t); }
}

/** Todas as páginas de um .list do Bitrix (50 por página), até `max` linhas. */
async function bxTudo(metodo, params, max = MAX_NEGOCIOS) {
  const out = [];
  let start = 0;
  while (out.length < max) {
    const r = await bxCru(metodo, { ...params, start });
    out.push(...(r.result || []));
    if (r.next == null) break;
    start = r.next;
  }
  return out.slice(0, max);
}

// ── Banco ───────────────────────────────────────────────────────────────────

const COLS = 'id,expedicao_id,pendente_aprovacao,nome_completo,cpf,passaporte,validade_passaporte,data_nascimento,email,telefone,bitrix_contact_id,bitrix_deal_id';

const _colunas = new Map();
/** A coluna existe? (0317 pode ainda não estar aplicada.) Só guarda o "sim" — o "não" pergunta de novo. */
async function colunaExiste(tabela, coluna) {
  const k = `${tabela}.${coluna}`;
  if (_colunas.get(k)) return true;
  const ok = await rest(`${tabela}?select=${coluna}&limit=1`).then(() => true, () => false);
  if (ok) _colunas.set(k, true);
  return ok;
}

/** Etapa onde está a maioria dos negócios dos passageiros da expedição (só o botão usa). */
async function colunaPelaMaioria(expId) {
  const meus = ((await rest(`passageiros?select=bitrix_deal_id&expedicao_id=eq.${expId}&bitrix_deal_id=not.is.null&limit=200`)) || [])
    .map((p) => String(p.bitrix_deal_id).trim()).filter((id) => /^\d+$/.test(id));
  if (!meus.length) return { erro: 'Ainda não sei qual coluna do Bitrix é desta expedição: preencha a "Etapa do Bitrix" na edição da expedição (ou adicione um passageiro com o nº do negócio) e tente de novo.' };
  const conta = new Map();
  for (let i = 0; i < meus.length; i += 50) {
    const deals = await bxTudo('crm.deal.list', { filter: { ID: meus.slice(i, i + 50) }, select: ['ID', 'STAGE_ID'] }, 50);
    for (const d of deals) if (d.STAGE_ID) conta.set(d.STAGE_ID, (conta.get(d.STAGE_ID) || 0) + 1);
  }
  const [etapa] = [...conta.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!etapa) return { erro: 'Os negócios desta expedição não foram achados no Bitrix.' };
  return { filtro: { STAGE_ID: etapa }, origem: 'maioria' };
}

/**
 * Sincroniza UMA expedição. `gravar=false` = modo seco (decide tudo, não escreve nada).
 * Lê o banco em bloco (2 consultas) e decide em memória; só escreve o que muda.
 */
export async function sincronizarExpedicao(exp, { gravar, permitirMaioria = false } = {}) {
  let coluna = colunaDaExpedicao(exp);
  if (!coluna && permitirMaioria) {
    const m = await colunaPelaMaioria(exp.id);
    if (m.erro) return { ok: false, codigo: exp.codigo, status: 409, error: m.erro };
    coluna = m;
  }
  if (!coluna) return { ok: false, codigo: exp.codigo, status: 409, error: 'Expedição sem etapa do Bitrix.' };
  const temNovaVenda = await colunaExiste('passageiros', 'nova_venda');

  // 1) Negócios da coluna.
  const deals = await bxTudo('crm.deal.list', { filter: coluna.filtro, select: ['ID', 'CONTACT_ID', 'STAGE_ID', 'TITLE'], order: { ID: 'ASC' } });
  const pulados = [];
  const comContato = [];
  for (const d of deals) {
    if (d.CONTACT_ID && String(d.CONTACT_ID) !== '0') comContato.push(d);
    else pulados.push({ deal: String(d.ID), nome: d.TITLE || '', motivo: 'negócio sem contato no Bitrix' });
  }

  // 2) Quem já é passageiro (pelo deal, global) e a lista desta expedição.
  const ids = comContato.map((d) => String(d.ID));
  const porDeal = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = (await rest(`passageiros?select=${COLS}&bitrix_deal_id=in.(${ids.slice(i, i + 100).map(enc).join(',')})`)) || [];
    for (const p of lote) if (!porDeal.has(String(p.bitrix_deal_id))) porDeal.set(String(p.bitrix_deal_id), p);
  }
  const lista = (await rest(`passageiros?select=${COLS}&expedicao_id=eq.${exp.id}`)) || [];
  let outrasComMesmaEtapa = 0;
  if (coluna.origem === 'etapa') {
    const outras = (await rest(`expedicoes?select=id&bitrix_stage_id=eq.${enc(coluna.filtro.STAGE_ID)}&id=neq.${exp.id}&status=not.in.(${enc('Concluída')},${enc('Cancelada')})`)) || [];
    outrasComMesmaEtapa = outras.length;
  }
  const colunaDividida = colunaEhDividida({ origem: coluna.origem, expedicaoId: exp.id, porDeal, outrasComMesmaEtapa });

  // 3) Contatos (50 por chamada).
  const contatos = new Map();
  const cids = [...new Set(comContato.map((d) => String(d.CONTACT_ID)))];
  for (let i = 0; i < cids.length; i += 50) {
    const lote = await bxTudo('crm.contact.list', { filter: { ID: cids.slice(i, i + 50) }, select: ['*', 'UF_*', 'PHONE', 'EMAIL'] }, 50);
    for (const c of lote) contatos.set(String(c.ID), c);
  }

  // 4) Decide e (se gravar) aplica.
  const r = {
    ok: true, codigo: exp.codigo, expedicao_id: exp.id, coluna: rotuloColuna(coluna.filtro), origem: coluna.origem,
    negocios: deals.length, criados: 0, anexados: 0, atualizados: 0, conferidos: 0,
    pulados, sem_grupo: [], erros: [], previa: [], limite: deals.length >= MAX_NEGOCIOS, seco: !gravar,
  };
  const anotar = (item) => { if (r.previa.length < MAX_PREVIA) r.previa.push(item); };

  for (const deal of comContato) {
    const dealId = String(deal.ID);
    const conv = contatoParaPassageiro(contatos.get(String(deal.CONTACT_ID)), dealId);
    if (conv.pular) { pulados.push({ deal: dealId, nome: deal.TITLE || '', motivo: conv.pular }); continue; }
    const d = conv.d;
    const dec = decidirCasamento(d, { expedicaoId: exp.id, porDeal: porDeal.get(dealId) || null, lista, colunaDividida, temNovaVenda });
    try {
      if (dec.acao === 'sem_grupo') { r.sem_grupo.push({ deal: dealId, nome: d.nome_completo }); continue; }
      if (dec.acao === 'atualizar') {
        const campos = Object.keys(dec.patch);
        if (!campos.length) { r.conferidos++; continue; }
        if (gravar) await rest(`passageiros?id=eq.${dec.alvo.id}`, { method: 'PATCH', body: dec.patch, prefer: 'return=minimal' });
        Object.assign(dec.alvo, dec.patch);
        r.atualizados++;
        anotar({ acao: 'atualizar', deal: dealId, nome: dec.alvo.nome_completo || d.nome_completo, campos });
        continue;
      }
      if (dec.acao === 'anexar') {
        if (gravar) await rest(`passageiros?id=eq.${dec.alvo.id}`, { method: 'PATCH', body: dec.patch, prefer: 'return=minimal' });
        Object.assign(dec.alvo, dec.patch);
        lista.push(dec.alvo);
        r.anexados++;
        anotar({ acao: 'anexar', deal: dealId, nome: dec.alvo.nome_completo || d.nome_completo });
        continue;
      }
      // criar
      let novo = { id: null, ...dec.registro, pendente_aprovacao: false };
      if (gravar) {
        try {
          const [linha] = await insert('passageiros', [dec.registro]);
          novo = { ...novo, id: linha?.id ?? null };
        } catch (e) {
          // Corrida (alguém criou ao mesmo tempo) ou CPF repetido: re-acha e só preenche o vazio.
          const conflito = (await rest(`passageiros?select=${COLS}&bitrix_deal_id=eq.${enc(dealId)}&limit=1`))?.[0]
            || acharNaLista(d, (await rest(`passageiros?select=${COLS}&expedicao_id=eq.${exp.id}`)) || []);
          if (!conflito) throw e;
          const patch = patchVazios(d, conflito);
          if (Object.keys(patch).length) await rest(`passageiros?id=eq.${conflito.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
          r.atualizados++;
          continue;
        }
      }
      lista.push(novo);
      porDeal.set(dealId, novo);
      r.criados++;
      anotar({ acao: 'criar', deal: dealId, nome: d.nome_completo });
    } catch (e) {
      r.erros.push({ deal: dealId, erro: e?.message || 'falhou' });
    }
  }
  return r;
}

// ── Botão "Atualizar do Bitrix" (uma expedição, grava na hora) ──────────────

export async function sincronizarBitrixUma(req, res) {
  const expId = req.body?.expedicao_id;
  if (!UUID.test(String(expId || ''))) return res.status(400).json({ ok: false, error: 'Expedição inválida.' });
  if (!bitrixConfigurado()) return res.status(503).json({ ok: false, error: 'Integração com o Bitrix não configurada (falta BITRIX_WEBHOOK_BASE na Vercel).' });
  const temEtapa = await colunaExiste('expedicoes', 'bitrix_stage_id');
  const exp = (await rest(`expedicoes?select=id,codigo,bitrix_pipeline_id${temEtapa ? ',bitrix_stage_id' : ''}&id=eq.${expId}&limit=1`))?.[0];
  if (!exp?.codigo) return res.status(404).json({ ok: false, error: 'Expedição sem código.' });
  const r = await sincronizarExpedicao(exp, { gravar: true, permitirMaioria: true });
  if (!r.ok) return res.status(r.status || 409).json({ ok: false, error: r.error });
  // Compatível com a tela: "criados" soma os que entraram (novos + avulsos anexados).
  const { previa, ...resto } = r;
  void previa;
  return res.status(200).json({ ...resto, criados: r.criados + r.anexados, atualizados: r.atualizados + r.conferidos });
}

// ── Automática (cron diário, todas as expedições ativas) ────────────────────

/** Liga a gravação da automática? Só com EXP_BITRIX_AUTO_LIGADO=1 (o espelho manda até lá). */
export const autoGravando = (env = process.env) => String(env.EXP_BITRIX_AUTO_LIGADO || '').trim() === '1';

/** Quais expedições ainda faltam hoje (ordem: embarque mais próximo primeiro). */
export function pendentesDaRodada(exps, feitas) {
  const ja = new Set(feitas || []);
  return exps.filter((e) => !ja.has(e.id));
}

const resumoCurto = (r) => {
  const { previa, ...resto } = r;
  return { ...resto, previa: r.seco ? previa : previa.slice(0, 10) };
};

async function lerOuAbrirRodada(dia, modo) {
  try {
    const achar = async () => (await rest(`exp_bitrix_sync_rodadas?select=id,feitas,resumo,terminado_em&dia=eq.${dia}&modo=eq.${modo}&limit=1`))?.[0] || null;
    let rod = await achar();
    if (!rod) {
      try { [rod] = await insert('exp_bitrix_sync_rodadas', [{ dia, modo }]); }
      catch { rod = await achar(); }
    }
    return rod ? { ...rod, feitas: rod.feitas || [], resumo: rod.resumo || {} } : null;
  } catch { return null; } // sem a 0318: segue sem retomada
}

export async function sincronizarTodas(req, res) {
  const t0 = Date.now();
  if (!bitrixConfigurado()) return res.status(503).json({ ok: false, error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
  const gravar = autoGravando() && String(req.query?.seco || '') !== '1';
  const modo = gravar ? 'gravando' : 'seco';
  const forcar = String(req.query?.forcar || '') === '1';
  const dia = hojeBrasilia();

  const temEtapa = await colunaExiste('expedicoes', 'bitrix_stage_id');
  const ativas = (await rest(`expedicoes?select=id,codigo,nome,status,data_embarque,bitrix_pipeline_id${temEtapa ? ',bitrix_stage_id' : ''}&status=not.in.(${enc('Concluída')},${enc('Cancelada')})&order=data_embarque.asc`)) || [];
  const alvo = ativas.filter((e) => colunaDaExpedicao(e));
  const sem_etapa = ativas.filter((e) => !colunaDaExpedicao(e)).map((e) => e.codigo);

  const rod = await lerOuAbrirRodada(dia, modo);
  if (rod?.terminado_em && !forcar) {
    return res.status(200).json({ ok: true, modo, dia, ja_terminou: rod.terminado_em, total: alvo.length });
  }
  // Sem a tabela de retomada, só a 1ª execução do dia trabalha (as de 12:15/12:30 repetiriam tudo).
  if (!rod && !forcar && new Date().getUTCMinutes() >= 10 && String(req.headers?.['user-agent'] || '').includes('vercel-cron')) {
    return res.status(200).json({ ok: true, modo, dia, pulou: 'sem a tabela exp_bitrix_sync_rodadas (0318) não há retomada; só a execução das 12:00 roda.' });
  }

  const feitas = forcar ? [] : [...(rod?.feitas || [])];
  const resumo = forcar ? {} : { ...(rod?.resumo || {}) };
  const fila = pendentesDaRodada(alvo, feitas);
  const resultados = [];
  for (const exp of fila) {
    if (Date.now() - t0 > ORCAMENTO_MS) break;
    let r;
    try { r = await sincronizarExpedicao(exp, { gravar }); }
    catch (e) { r = { ok: false, codigo: exp.codigo, error: e?.message || 'falhou' }; }
    resultados.push(resumoCurto(r.ok ? r : { ...r, previa: [] }));
    feitas.push(exp.id);
    resumo[exp.codigo] = resultados[resultados.length - 1];
    if (rod) {
      try {
        await rest(`exp_bitrix_sync_rodadas?id=eq.${rod.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { feitas, resumo, atualizado_em: new Date().toISOString(), terminado_em: feitas.length >= alvo.length ? new Date().toISOString() : null },
        });
      } catch (e) { console.warn('[exp-bitrix] não gravou a rodada:', e?.message); }
    }
  }
  const faltaram = pendentesDaRodada(alvo, feitas).map((e) => e.codigo);
  const soma = (k) => resultados.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const corpo = {
    ok: true, modo, dia, total: alvo.length, feitas_agora: resultados.length, faltaram, terminou: !faltaram.length,
    criados: soma('criados'), anexados: soma('anexados'), atualizados: soma('atualizados'),
    sem_etapa, resultados, ms: Date.now() - t0,
  };
  console.log(`[exp-bitrix] ${modo}: ${resultados.length}/${alvo.length} expedições; +${corpo.criados} novos, ${corpo.anexados} anexados, ${corpo.atualizados} atualizados; faltam ${faltaram.length}`);
  return res.status(200).json(corpo);
}
