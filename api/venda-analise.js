// api/venda-analise.js
// -----------------------------------------------------------------------------
// ANÁLISE PÓS-VENDA (Bruno 30/10/2026). Toda venda que sobe no QS (Closer, Rel,
// Ops) passa por aqui antes de concluir: cruza a PROPOSTA aprovada (o que foi
// apresentado) com o que já foi EMITIDO e devolve o extrato (ok / falta /
// divergente) + os riscos.
//
//   POST { rascunho: {...} }   → análise da tela, ANTES de gravar (nada é salvo)
//        rascunho = { origem, negocio_id?, cliente_id?, viagem_id?, cliente:{nome},
//                     itens:[qs_venda_itens-like], viajantes:[{nome,valor_contratado,valor_pago}],
//                     pagamento:{forma,condicao,entrada,entrada_data,parcelas}, total,
//                     — subir venda final (11/11), todos opcionais —
//                     pagamentos:[{forma,valor,data,parcelas,obs}],
//                     pessoas|familia:[{chave,nome,vinculo,cpf,nascimento,comprador,responsavel,itens?}] }
//        (sem "pessoas", a família sai dos passageiros dos itens no formato novo, com `chave`;
//         as datas da expedição vêm de expedicoes pelo dados.expedicao_id do item)
//   POST { venda_id, motivo?: 'subir_venda'|'reanalise'|'correcao', ia_previa?: {riscos,texto,modelo} }
//        → analisa a venda GRAVADA, guarda (0230: venda_analise_gravar) e, se
//          falta emitir/diverge, abre a solicitação "Emissões pendentes" pro Rel.
//          ia_previa = a leitura da IA que a tela já pediu no rascunho (não paga 2×).
//   → { ...extrato, riscos, status, ia:{usada, modelo, aviso, texto}, gravado?, solicitacao? }
//
// Base DETERMINÍSTICA (api/_vendaConferencia.js). A IA (OpenAI, mesmo padrão do
// api/venda-voucher.js: chat/completions + json_schema strict) só complementa os
// riscos e o texto. Sem OPENAI_API_KEY → roda "modo regras" e avisa
// "análise por IA indisponível". A IA nunca recebe CPF/passaporte/telefone.
// Não manda mensagem pra ninguém: o aviso pro Rel é a solicitação interna.
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { conferirVenda, fecharAnalise, materialParaIa, textoDoExtrato, lerRespostaIa, RISCOS_IA, INSTRUCAO_IA } from './_vendaConferencia.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETORES_OK = ['comercial', 'relacionamento', 'operacoes', 'operacional', 'financeiro'];
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const AVISO_SEM_IA = 'Análise por IA indisponível (falta a chave da OpenAI na Vercel): conferência feita só pelas regras.';
const lista = (a) => (Array.isArray(a) ? a : []);
const q = (s) => encodeURIComponent(s);

function erro(status, msg) { const e = new Error(msg); e.status = status; e.nosso = true; return e; }

async function quemPode(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,role,setores,is_active,name&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const s = lista(u.setores);
  return u.role === 'admin' || u.role === 'closer' || u.role === 'gestor' || SETORES_OK.some((x) => s.includes(x)) ? u : null;
}
const vePainel = (u) => u.role === 'admin' || u.role === 'gestor' || ['relacionamento', 'operacoes', 'operacional', 'financeiro'].some((x) => lista(u.setores).includes(x));

// ── Carregar os três lados ──────────────────────────────────────────────────
async function leadDoNegocio(negocioId) {
  if (!negocioId || !UUID.test(negocioId)) return null;
  return (await rest(`qs_closer_negocios?select=lead_id,closer_id&id=eq.${negocioId}&limit=1`).catch(() => null))?.[0] || null;
}

/** Proposta APROVADA mais recente ligada à viagem, ao cliente ou ao lead (direto ou pela solicitação). */
export async function propostaAprovada({ negocio_id, cliente_id, viagem_id }) {
  const filtros = [];
  if (viagem_id && UUID.test(viagem_id)) filtros.push(`viagem_id.eq.${viagem_id}`);
  if (cliente_id && UUID.test(cliente_id)) filtros.push(`cliente_id.eq.${cliente_id}`);
  const neg = await leadDoNegocio(negocio_id);
  if (neg?.lead_id) {
    filtros.push(`lead_id.eq.${neg.lead_id}`);
    const sols = await rest(`qs_solicitacoes?select=id&lead_id=eq.${neg.lead_id}`).catch(() => []);
    if (sols?.length) filtros.push(`solicitacao_id.in.(${sols.map((s) => s.id).join(',')})`);
  }
  if (!filtros.length) return null;
  const p = (await rest(`qs_propostas?select=id,numero,adultos,criancas,bebes,aprovada_opcao_id,destino&status=eq.aprovada&or=(${q(filtros.join(','))})&order=aprovada_em.desc.nullslast&limit=1`).catch(() => null))?.[0];
  if (!p) return null;
  let opcao = p.aprovada_opcao_id
    ? (await rest(`qs_proposta_opcoes?select=id,titulo,desconto&id=eq.${p.aprovada_opcao_id}&limit=1`).catch(() => null))?.[0]
    : null;
  if (!opcao) opcao = (await rest(`qs_proposta_opcoes?select=id,titulo,desconto&proposta_id=eq.${p.id}&order=ordem.asc&limit=1`).catch(() => null))?.[0];
  if (!opcao) return null;
  const itens = await rest(`qs_proposta_itens?select=tipo,nome,data_inicio,data_fim,quantidade,valor_total,custo,incluso,detalhes&opcao_id=eq.${opcao.id}&order=ordem.asc`).catch(() => []);
  const total = (itens || []).reduce((s, i) => s + (i.incluso ? 0 : Number(i.valor_total) || 0), 0) - (Number(opcao.desconto) || 0);
  return {
    id: p.id, itens: itens || [],
    meta: { numero: p.numero, opcao: opcao.titulo, total: Math.max(0, Math.round(total * 100) / 100), adultos: p.adultos, criancas: p.criancas, bebes: p.bebes },
  };
}

/** Tudo que comprova emissão na viagem: trechos, documentos e itens emitidos de OUTRAS vendas da mesma viagem. */
export async function emitidosDaViagem(viagemId, vendaId) {
  if (!viagemId || !UUID.test(viagemId)) return { emitido: [], pessoas: [] };
  const [trechos, docs, itens, pax] = await Promise.all([
    rest(`rel_viagem_trechos?select=id,tipo,descricao,origem,destino,origem_codigo,destino_codigo,partida_em,chegada_em,companhia,numero,localizador,numero_bilhete,passageiros&viagem_id=eq.${viagemId}&order=partida_em.asc&limit=200`).catch(() => []),
    rest(`rel_documentos?select=id,tipo,arquivo_nome,descricao&viagem_id=eq.${viagemId}&tipo=in.(voucher,bilhete,seguro,visto)&limit=200`).catch(() => []),
    rest(`qs_venda_itens?select=id,tipo,nome,data_inicio,data_fim,dados,passageiros,status,venda_id&viagem_id=eq.${viagemId}&status=eq.emitido&limit=200`).catch(() => []),
    rest(`rel_viagem_passageiros?select=cliente_id&viagem_id=eq.${viagemId}&limit=50`).catch(() => []),
  ]);
  const emitido = [];
  for (const t of trechos || []) {
    const dia = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '');
    if (/^voo/.test(t.tipo || '')) {
      emitido.push({ fonte: 'trecho', tipo: 'aereo', ref: t.id, trecho: {
        origem: t.origem_codigo || t.origem, destino: t.destino_codigo || t.destino, partida_em: t.partida_em, chegada_em: t.chegada_em,
        data: dia(t.partida_em), chegada_data: dia(t.chegada_em), numero: t.numero, companhia: t.companhia,
        localizador: t.localizador || t.numero_bilhete || '', passageiros: lista(t.passageiros),
      } });
    } else {
      emitido.push({ fonte: 'trecho', tipo: t.tipo, ref: t.id, nome: t.descricao || t.tipo, data_inicio: dia(t.partida_em), data_fim: dia(t.chegada_em), localizador: t.localizador || '', passageiros: lista(t.passageiros) });
    }
  }
  for (const d of docs || []) emitido.push({ fonte: 'documento', doc_tipo: d.tipo, nome: d.descricao || d.arquivo_nome || d.tipo, ref: d.id });
  for (const i of itens || []) if (i.venda_id !== vendaId) emitido.push({ ...i, fonte: 'venda', ref: i.id });
  const ids = (pax || []).map((p) => p.cliente_id).filter((x) => UUID.test(String(x)));
  return { emitido, clienteIds: ids };
}

async function pessoasDe(clienteIds, extras = []) {
  const ids = [...new Set(clienteIds.filter((x) => x && UUID.test(String(x))))].slice(0, 30);
  const rows = ids.length ? await rest(`rel_clientes?select=nome,passaporte_validade&id=in.(${ids.join(',')})`).catch(() => []) : [];
  const out = [...(rows || [])];
  for (const e of extras) if (e?.nome && !out.some((p) => String(p.nome).toLowerCase() === String(e.nome).toLowerCase())) out.push(e);
  return out;
}

// ── IA (opcional): auditor de emissão ──────────────────────────────────────
const semIa = (modelo, motivo) => ({ usada: false, modelo, aviso: `Análise por IA indisponível (${motivo}): conferência feita só pelas regras.`, riscos: [], texto: '' });

/**
 * Revisão da IA. NUNCA lança e nunca derruba a análise: qualquer falha (sem chave, HTTP, recusa,
 * resposta cortada, JSON inválido) volta { usada:false, aviso } e a análise segue só com as regras.
 * Modelo: OPENAI_MODEL (padrão gpt-4o-mini); temperatura 0; saída em json_schema strict (RISCOS_IA).
 */
export async function revisarComIa(material) {
  const chave = String(process.env.OPENAI_API_KEY || '').trim();
  if (!chave) return { usada: false, aviso: AVISO_SEM_IA, riscos: [], texto: '' };
  const modelo = String(process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        model: modelo, temperature: 0,
        messages: [
          { role: 'system', content: INSTRUCAO_IA },
          { role: 'user', content: `Audite esta venda. Material (JSON):\n${materialEmTexto(material)}` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'auditoria_emissao', strict: true, schema: RISCOS_IA } },
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return semIa(modelo, r.status === 401 ? 'chave da OpenAI recusada' : r.status === 429 ? 'OpenAI pediu pra esperar' : `HTTP ${r.status}`);
    const escolha = j?.choices?.[0];
    if (escolha?.message?.refusal) return semIa(modelo, 'a IA recusou revisar');
    if (escolha?.finish_reason === 'length') return semIa(modelo, 'a resposta da IA veio cortada');
    const lido = lerRespostaIa(escolha?.message?.content ?? '');
    if (!lido) return { usada: false, modelo, aviso: 'A IA não devolveu a revisão: conferência feita só pelas regras.', riscos: [], texto: '' };
    return { usada: true, modelo, aviso: '', riscos: lido.riscos, texto: lido.texto };
  } catch (e) {
    const t = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return semIa(modelo, t ? 'demorou demais' : 'falhou');
  }
}

/** JSON do material sem estourar o limite: encurta as listas em vez de cortar o texto no meio (JSON quebrado). */
export function materialEmTexto(material, limite = 60_000) {
  let m = material || {};
  let t = JSON.stringify(m);
  for (const n of [40, 20, 10, 5, 0]) {
    if (t.length <= limite) return t;
    m = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, n) : v]));
    t = JSON.stringify(m);
  }
  return t.length <= limite ? t : JSON.stringify({ aviso: 'material grande demais; revise só pelo extrato', riscos_das_regras: lista(m.riscos_das_regras).slice(0, 20) });
}

/** Datas oficiais das expedições dos itens (dados.expedicao_id). Falhou/sem expedição → null (a regra não roda). */
export async function expedicoesDosItens(itens) {
  const ids = unicosUuid(lista(itens).filter((i) => i?.tipo === 'expedicao').map((i) => i?.dados?.expedicao_id));
  if (!ids.length) return null;
  const rows = await rest(`expedicoes?select=id,nome,data_embarque,data_retorno&id=in.(${ids.join(',')})`).catch(() => null);
  return Array.isArray(rows) && rows.length ? rows : null;
}
const unicosUuid = (a) => [...new Set(a.map((x) => String(x || '')).filter((x) => UUID.test(x)))].slice(0, 30);

/**
 * Venda gravada — tabelas novas (frente Banco: qs_venda_pagamentos na 0356+; qs_venda_pessoas da 0351).
 * Lê com defesa: tabela que não existe (ou erro) → null, e a conferência roda como na venda antiga.
 */
export async function extrasDaVenda(vendaId) {
  const [pags, pes] = await Promise.all([
    rest(`qs_venda_pagamentos?select=ordem,forma,valor,data,parcelas,obs&venda_id=eq.${vendaId}&order=ordem.asc`).catch(() => null),
    rest(`qs_venda_pessoas?select=cliente_id,comprador,chave,vinculo,menor,responsavel_cliente_id,itens,removida_em&venda_id=eq.${vendaId}`).catch(() => null),
  ]);
  const ativas = Array.isArray(pes) ? pes.filter((p) => p && !p.removida_em) : [];
  let familia = null;
  if (ativas.length) {
    const ids = unicosUuid(ativas.map((p) => p.cliente_id));
    const fichas = ids.length ? await rest(`rel_clientes?select=id,nome,cpf,nascimento&id=in.(${ids.join(',')})`).catch(() => []) : [];
    const porId = new Map(lista(fichas).map((c) => [c.id, c]));
    familia = ativas.map((p) => {
      const c = porId.get(p.cliente_id) || {};
      return {
        nome: c.nome || '', cpf: c.cpf || '', nascimento: c.nascimento || '', cliente_id: p.cliente_id, chave: p.chave || p.cliente_id,
        comprador: Boolean(p.comprador), vinculo: p.vinculo || '', menor: typeof p.menor === 'boolean' ? p.menor : null,
        responsavel: p.responsavel_cliente_id || null, itens: Array.isArray(p.itens) ? p.itens : [],
      };
    }).filter((p) => p.nome);
  }
  return { pagamentos: Array.isArray(pags) ? pags : null, familia: familia && familia.length ? familia : null };
}

async function analisar(ctx, { proposta_id, iaPrevia } = {}) {
  const base = conferirVenda(ctx);
  let ia;
  // A leitura da IA que a tela já pediu (não paga 2×) passa pela mesma limpeza da resposta da OpenAI.
  const previa = iaPrevia && typeof iaPrevia === 'object' ? lerRespostaIa({ riscos: iaPrevia.riscos, texto: iaPrevia.texto }) : null;
  if (previa) {
    ia = { usada: Boolean(iaPrevia.usada ?? true), modelo: String(iaPrevia.modelo || ''), aviso: String(iaPrevia.aviso || ''), riscos: previa.riscos, texto: previa.texto };
  } else {
    ia = await revisarComIa(materialParaIa(ctx, base));
  }
  const final = fecharAnalise(base, ia.riscos, { usada: ia.usada, modelo: ia.modelo || null, aviso: ia.aviso || '', texto: ia.texto || '', riscos: ia.riscos });
  final.proposta_id = proposta_id || null;
  final.proposta = ctx.proposta || null;
  final.texto_extrato = textoDoExtrato(final);
  return final;
}

// ── Rascunho (tela, antes de gravar) ────────────────────────────────────────
async function analisarRascunho(r) {
  const prop = await propostaAprovada(r);
  const { emitido, clienteIds = [] } = await emitidosDaViagem(r.viagem_id, null);
  const nomes = [r.cliente?.nome, ...lista(r.viajantes).map((v) => v?.nome)].filter(Boolean).map((nome) => ({ nome, passaporte_validade: null }));
  const pessoas = await pessoasDe([r.cliente_id, ...clienteIds], nomes);
  const vendido = lista(r.itens).slice(0, 60);
  const familia = lista(r.pessoas).length ? lista(r.pessoas) : lista(r.familia);
  const ctx = {
    hoje: hojeSP(), proposta: prop?.meta || null, apresentado: prop?.itens || [],
    vendido, emitido, pessoas,
    viajantes: lista(r.viajantes).slice(0, 30), pagamento: r.pagamento || null, total_venda: r.total ?? null,
    pagamentos: Array.isArray(r.pagamentos) ? r.pagamentos.slice(0, 30) : null,
    familia: familia.length ? familia.slice(0, 30) : null,
    expedicoes: await expedicoesDosItens(vendido),
  };
  return analisar(ctx, { proposta_id: prop?.id });
}

// ── Venda gravada ───────────────────────────────────────────────────────────
async function carregarVenda(vendaId, u) {
  const v = (await rest(`qs_vendas?select=*&id=eq.${vendaId}&limit=1`))?.[0];
  if (!v) throw erro(404, 'Venda não encontrada.');
  if (!vePainel(u) && v.criado_por !== u.id) {
    const neg = await leadDoNegocio(v.negocio_id);
    if (neg?.closer_id !== u.id) throw erro(403, 'Essa venda não é sua.');
  }
  return v;
}

async function analisarVenda(vendaId, u, iaPrevia) {
  const v = await carregarVenda(vendaId, u);
  const [itens, pax, prop, emit, extras] = await Promise.all([
    rest(`qs_venda_itens?select=id,tipo,nome,data_inicio,data_fim,dados,passageiros,valor,custo,status,ordem&venda_id=eq.${vendaId}&order=ordem.asc`).catch(() => []),
    rest(`passageiros?select=nome_completo,status_reserva,valor_contratado_brl,valor_pago_brl,validade_passaporte,cliente_id&venda_id=eq.${vendaId}`).catch(() => []),
    propostaAprovada(v),
    emitidosDaViagem(v.viagem_id, vendaId),
    extrasDaVenda(vendaId),
  ]);
  const emitido = [...emit.emitido];
  for (const p of pax || []) if (['Pré-reserva', 'Confirmado'].includes(p.status_reserva)) emitido.push({ fonte: 'expedicao', tipo: 'expedicao', nome: p.nome_completo, status_reserva: p.status_reserva });
  const pessoas = await pessoasDe([v.cliente_id, ...(emit.clienteIds || []), ...(pax || []).map((p) => p.cliente_id)],
    (pax || []).map((p) => ({ nome: p.nome_completo, passaporte_validade: p.validade_passaporte })));
  const ctx = {
    hoje: hojeSP(), proposta: prop?.meta || null, apresentado: prop?.itens || [],
    vendido: itens || [], emitido, pessoas,
    viajantes: (pax || []).map((p) => ({ nome: p.nome_completo, valor_contratado: p.valor_contratado_brl, valor_pago: p.valor_pago_brl })),
    pagamento: v.pagamento || null, total_venda: v.valor_total,
    pagamentos: extras.pagamentos, familia: extras.familia,
    expedicoes: await expedicoesDosItens(itens || []),
  };
  return { venda: v, analise: await analisar(ctx, { proposta_id: prop?.id, iaPrevia }) };
}

async function gravar(vendaId, analise, u, motivo) {
  try {
    const r = await rest('rpc/venda_analise_gravar', {
      method: 'POST',
      body: { p_venda: vendaId, p_resultado: analise, p_por: u.id, p_motivo: ['subir_venda', 'reanalise', 'correcao'].includes(motivo) ? motivo : 'reanalise' },
    });
    return { gravado: true, solicitacao: r && r.solicitacao_id ? { id: r.solicitacao_id, numero: r.solicitacao_numero, nova: Boolean(r.solicitacao_nova) } : null };
  } catch (e) {
    const m = String(e?.message || '');
    const falta0230 = /venda_analise_gravar|PGRST202|Could not find the function/i.test(m);
    console.error('[venda-analise] gravar falhou:', m.slice(0, 160));
    return { gravado: false, aviso: falta0230 ? 'A análise não ficou guardada: falta aplicar a 0230 no banco.' : 'A análise não ficou guardada (erro no banco).', falta0230 };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  const u = await quemPode(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'Entre no QS de novo.' });
  const body = typeof req.body === 'string' ? (safeParse(req.body) || {}) : (req.body || {});
  try {
    if (body.rascunho && typeof body.rascunho === 'object') {
      const a = await analisarRascunho(body.rascunho);
      console.log(`[venda-analise] rascunho ${u.id}: ${a.status} ${JSON.stringify(a.contagens)} ia=${a.ia.usada}`);
      return res.status(200).json({ ...a, gravado: false });
    }
    const vendaId = String(body.venda_id || '');
    if (!UUID.test(vendaId)) return res.status(400).json({ error: 'Mande a venda (venda_id) ou o rascunho.' });
    const { analise } = await analisarVenda(vendaId, u, body.ia_previa);
    const g = await gravar(vendaId, analise, u, body.motivo);
    console.log(`[venda-analise] venda ${vendaId}: ${analise.status} gravado=${g.gravado} sol=${g.solicitacao?.numero ?? '-'}`);
    return res.status(200).json({ ...analise, venda_id: vendaId, ...g });
  } catch (e) {
    console.error('[venda-analise] falhou:', String(e?.message || '').slice(0, 160));
    return res.status(e?.nosso ? e.status : 500).json({ error: e?.nosso ? e.message : 'Falhou a análise pós-venda.' });
  }
}
