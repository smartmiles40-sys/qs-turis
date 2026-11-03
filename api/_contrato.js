// api/_contrato.js
// -----------------------------------------------------------------------------
// CONTRATO 100% EM CÓDIGO (0180, Bruno 22/10/2026: "eu não quero que seja nada
// via n8n"; 27/10: "vamos parar de usar o console" — sem Google Docs/Drive).
//
//   1. MONTAR OS CAMPOS: venda consolidada (ficha) + proposta aprovada + ficha
//      do cliente (rel_clientes) + Bitrix (negócio e contato) + lead. O closer
//      confere e corrige tudo na prévia antes de mandar.
//   2. GERAR: o próprio QS monta o PDF a partir dos modelos que moram no
//      código (api/_contratoModelo.js — texto fiel aos contratos em uso).
//   3. GUARDAR: o PDF gerado e o assinado vão pro Storage (bucket privado
//      "contratos"); a tela abre por link temporário.
//   4. ZAPSIGN: cria o documento (cliente + assinante fixo da agência) com
//      external_id = id do cartão no QS.
//
// Só fetch puro (sem SDK) e timeout em toda chamada.
// Quem chama: api/closer.js (?acao=contrato-*, zapsign-webhook).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';
import { gerarPdfDoContrato, linhasDosInclusos } from './_contratoModelo.js';

const env = (k) => String(process.env[k] || '').trim();

export const CONFIG_PADRAO = {
  // IDs do Google da época do n8n: não são mais usados (o modelo mora no
  // código), só ficam pra RPC contrato_config_salvar continuar aceitando.
  template_pacote: '1vRh_zQHh-Q2rD8g0FsGIHRxAwqwtPY7X',
  template_expedicao: '1FbKqTW5ysiFbKQI_9eM0xDPJ123Zz0UG',
  pasta_contratos: '14sJB-IOUEBjcyq0R6JxF5ZO1AaY0exQ8',
  assinante_nome: 'Luís Antonio Caetano',
  assinante_email: 'contato@setuforeuvou.com',
  assinante_telefone: '5585987660748',
};

// ── fetch com prazo ─────────────────────────────────────────────────────────
async function buscar(url, opts = {}, ms = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${new URL(url).host} não respondeu em ${Math.round(ms / 1000)} s.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ── Configuração ────────────────────────────────────────────────────────────
export async function lerConfig() {
  const r = await rest('qs_contrato_config?select=valor&chave=eq.geral&limit=1').catch(() => null);
  const v = r?.[0]?.valor || {};
  const out = { ...CONFIG_PADRAO };
  for (const k of Object.keys(CONFIG_PADRAO)) if (v[k]) out[k] = String(v[k]);
  return out;
}

/** O que falta pra rodar sozinho. Vazio = modo automático. */
export function oQueFalta(cfg) {
  const falta = [];
  if (!env('ZAPSIGN_API_TOKEN')) falta.push('Cadastrar ZAPSIGN_API_TOKEN na Vercel.');
  if (!env('ZAPSIGN_WEBHOOK_SECRET')) falta.push('Cadastrar ZAPSIGN_WEBHOOK_SECRET na Vercel (e o mesmo valor na URL do webhook do ZapSign).');
  if (!cfg.assinante_email) falta.push('Informar o assinante da agência.');
  return falta;
}

// ── URL pública do app (webhook do ZapSign na tela de configuração) ───────
export function urlDoApp(req) {
  const fixa = env('QS_URL_PUBLICA');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return (fixa || `https://${host}`).replace(/\/+$/, '');
}

// ── Formatação (igual ao n8n) ───────────────────────────────────────────────
/** 26990 → "26.990,00" (o template já tem o "R$" antes). Aceita "34990,00 (Entrada…)" e "34990|BRL". */
export function numeroDoValor(v) {
  if (typeof v === 'number') return v;
  // Só o começo: "34990,00 (Entrada de R$2.000…)" e "34990|BRL" valem 34990.
  let s = (String(v ?? '').split('|')[0].trim().match(/^[R$\s]*([\d.,]+)/) || [])[1] || '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // "26.990" = vinte e seis mil
  const n = Number(s);
  return s && Number.isFinite(n) ? n : NaN;
}
export function formatarValor(v) {
  const n = numeroDoValor(v);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '');
}
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
export function formatarCpf(v) {
  const d = soDigitos(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v);
}
export function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function formatarTelefone(v) {
  let d = soDigitos(String(v ?? '').split(',')[0]);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '').split(',')[0].trim();
}
/** ISO (2026-11-10 ou 2026-11-10T03:00:00+03:00) → 10/11/2026. Já em dd/mm/aaaa: fica. */
export function dataBr(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
export const hojeBr = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMA = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão de crédito', link: 'link de pagamento', transferencia: 'transferência', dinheiro: 'dinheiro', outro: 'outra forma' };

/** "Entrada de R$ 2.000,00 via Pix e 12 parcelas de R$ 2.749,16 no cartão de crédito" — do plano da ficha. */
export function textoDoPlano(plano) {
  if (!plano) return '';
  const partes = [];
  const ent = plano.entrada;
  if (ent && Number(ent.valor) > 0) partes.push(`Entrada de ${brl(ent.valor)} via ${FORMA[ent.forma] || ent.forma || 'Pix'}`);
  const pars = Array.isArray(plano.parcelas) ? plano.parcelas.filter((p) => Number(p.valor) > 0) : [];
  if (pars.length) {
    // Agrupa parcelas iguais (mesmo valor e forma).
    const grupos = [];
    for (const p of pars) {
      const g = grupos.find((x) => Math.abs(x.valor - Number(p.valor)) < 0.01 && x.forma === p.forma);
      if (g) g.n += 1; else grupos.push({ valor: Number(p.valor), forma: p.forma, n: 1, recorrente: !!p.recorrente });
    }
    for (const g of grupos) {
      partes.push(`${g.n} ${g.n === 1 ? 'parcela' : 'parcelas'} de ${brl(g.valor)} no ${FORMA[g.forma] || g.forma}${g.recorrente ? ' (recorrente)' : ''}`);
    }
  }
  return partes.join(' e ');
}

// ── BITRIX: lê o negócio e o contato e traduz listas/usuários/datas ────────
const BX_DEAL = {
  nome: 'UF_CRM_1761744211241',          // Nome completo do Cliente (não colocar só ponto!)
  cpf: 'UF_CRM_1762288761917',           // CPF do cliente
  email: 'UF_CRM_1762288786624',         // E-mail do cliente
  email2: 'UF_CRM_1756145690413',        // E-mail
  endereco: 'UF_CRM_1756145544358',      // Endereço
  nascimento: 'UF_CRM_1756148121396',    // Data de Nascimento
  expedicao: 'UF_CRM_1768941254969',     // Nome da expedição
  destino: 'UF_CRM_1746633298495',       // Destino
  tipo_pacote: 'UF_CRM_1771511032311',   // Tipo de pacote
  ida: 'UF_CRM_1770123693704',           // Ida - Prevista
  volta: 'UF_CRM_1770123722849',         // Volta - Prevista
  passagem: 'UF_CRM_1770124038221',      // Passagem Aérea
  seguro: 'UF_CRM_1771008352486',        // Seguro Viagem
  valor_total: 'UF_CRM_1770124224965',   // Valor total (para todas as pessoas)
  forma_pagamento: 'UF_CRM_1761744617281', // Forma de pagamento confirmada:
  vendedor: 'UF_CRM_1746633208073',      // Vendedor
};
const BX_CONTATO = {
  cpf2: 'UF_CRM_1752691408782',          // CPF 2 (a tag do template é "Contato: CPF 2")
  cpf: 'UF_CRM_1749757426655',           // CPF
  rg: 'UF_CRM_1768940114697',            // RG
};

const cacheCampos = {};
async function camposDe(entidade) {
  const c = cacheCampos[entidade];
  if (c && Date.now() - c.em < 10 * 60_000) return c.v;
  const v = await bx(`crm.${entidade}.fields`, {}, 8_000).catch(() => ({}));
  cacheCampos[entidade] = { v: v || {}, em: Date.now() };
  return v || {};
}
const cacheUsuario = new Map();
async function nomeDoUsuario(id) {
  if (cacheUsuario.has(id)) return cacheUsuario.get(id);
  const u = (await bx('user.get', { ID: id }, 6_000).catch(() => null))?.[0];
  const nome = u ? [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() : '';
  cacheUsuario.set(id, nome);
  return nome;
}
async function legivel(valor, def) {
  if (valor == null || valor === '' || valor === false) return '';
  const lista = Array.isArray(valor) ? valor : [valor];
  const out = [];
  for (const v of lista) {
    if (v == null || v === '') continue;
    const tipo = def?.type;
    if (tipo === 'enumeration' && Array.isArray(def.items)) {
      out.push(def.items.find((i) => String(i.ID) === String(v))?.VALUE || String(v));
    } else if (tipo === 'employee') {
      out.push((await nomeDoUsuario(v)) || String(v));
    } else if (tipo === 'date' || tipo === 'datetime') {
      out.push(dataBr(v));
    } else if (tipo === 'boolean') {
      out.push(String(v) === '1' || String(v) === 'Y' ? 'Sim' : 'Não');
    } else if (tipo === 'money') {
      out.push(String(v).split('|')[0]);
    } else if (typeof v === 'object') {
      out.push(String(v.VALUE ?? ''));
    } else {
      out.push(String(v));
    }
  }
  return out.filter(Boolean).join(', ').trim();
}
const naoSeAplica = (s) => /^\s*(n[aã]o\s+se\s+aplica|nenhuma?|-)\s*$/i.test(String(s || ''));

export async function dadosDoBitrix(dealId) {
  if (!bitrixConfigurado() || !dealId) return null;
  const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000).catch(() => null);
  if (!deal) return null;
  const defs = await camposDe('deal');
  const d = {};
  for (const [k, campo] of Object.entries(BX_DEAL)) d[k] = await legivel(deal[campo], defs[campo]);
  d.categoria = deal.CATEGORY_ID;
  d.titulo = deal.TITLE || '';
  if (naoSeAplica(d.expedicao)) d.expedicao = '';
  const ct = {};
  const contatoId = Number(deal.CONTACT_ID || 0);
  if (contatoId > 0) {
    const c = await bx('crm.contact.get', { id: contatoId }, 8_000).catch(() => null);
    if (c) {
      const cdefs = await camposDe('contact');
      ct.nome = [c.NAME, c.SECOND_NAME, c.LAST_NAME].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      ct.sobrenome = String(c.LAST_NAME || '').trim();
      ct.primeiro = String(c.NAME || '').trim();
      ct.email = Array.isArray(c.EMAIL) ? (c.EMAIL[0]?.VALUE || '') : '';
      ct.telefone = Array.isArray(c.PHONE) ? (c.PHONE[0]?.VALUE || '') : '';
      ct.nascimento = dataBr(c.BIRTHDATE);
      ct.endereco = [c.ADDRESS, c.ADDRESS_2, c.ADDRESS_CITY, c.ADDRESS_PROVINCE, c.ADDRESS_POSTAL_CODE].filter((x) => String(x || '').trim()).join(', ');
      for (const [k, campo] of Object.entries(BX_CONTATO)) ct[k] = await legivel(c[campo], cdefs[campo]);
    }
  }
  return { deal: d, contato: ct };
}

/** Nome completo sem duplicar o sobrenome (mesma regra do n8n). */
function juntarNome(nome, sobrenome) {
  const a = String(nome || '').replace(/\s+/g, ' ').trim();
  const b = String(sobrenome || '').replace(/\s+/g, ' ').trim();
  if (!b) return a;
  if (!a) return b;
  return a.toLowerCase().endsWith(b.toLowerCase()) ? a : `${a} ${b}`;
}

// ── PRÉVIA: os campos que vão no contrato e de onde vieram ─────────────────
export const CAMPOS = ['tipo', 'nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone', 'expedicao', 'destino', 'tipo_pacote',
  'inclusos', 'nao_inclusos', 'ida', 'volta', 'passagem', 'seguro', 'valor_total', 'forma_pagamento', 'vendedor', 'data_venda'];
const LONGOS = { destino: 1500, inclusos: 4000, nao_inclusos: 1500, forma_pagamento: 1000, endereco: 500 };
// Rótulo do item da proposta quando ele não tem nome (cláusula 1.3 do pacote).
const ROTULO_ITEM = {
  aereo: 'Aéreo', hospedagem: 'Hospedagem', transfer: 'Transfer', trem: 'Trens', passeio: 'Passeio', seguro: 'Seguro viagem',
  carro: 'Carro', cruzeiro: 'Cruzeiro', visto: 'Visto', pacote: 'Pacote', expedicao: 'Expedição', concierge: 'Assessoria',
};
// Dados da PESSOA: a correção do closer no último envio vale de novo.
const DA_PESSOA = ['nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone'];

export async function montarPrevia(negocio) {
  const campos = {};
  const origem = {};
  const por = (k, valor, de) => {
    const v = valor == null ? '' : String(valor).trim();
    if (!campos[k] && v) { campos[k] = v; origem[k] = de; }
  };

  const lead = (await rest(`qs_leads?select=id,full_name,first_name,last_name,email,phone,bitrix_id&id=eq.${negocio.lead_id}&limit=1`))?.[0] || {};
  const dealId = soDigitos(lead.bitrix_id);
  const ficha = negocio.ficha || null;

  // A correção do closer no último envio (só dados da pessoa).
  const ultimo = (await rest(`qs_contratos?select=campos&negocio_id=eq.${negocio.id}&order=criado_em.desc&limit=1`).catch(() => null))?.[0];
  if (ultimo?.campos) for (const k of DA_PESSOA) por(k, ultimo.campos[k], 'último envio');

  // Ficha do cliente no Relacionamento.
  let cliente = null;
  if (negocio.viagem_id) {
    const v = (await rest(`rel_viagens?select=cliente_id&id=eq.${negocio.viagem_id}&limit=1`).catch(() => null))?.[0];
    if (v?.cliente_id) cliente = (await rest(`rel_clientes?select=nome,cpf,nascimento,email,telefone&id=eq.${v.cliente_id}&limit=1`).catch(() => null))?.[0];
  }
  if (!cliente) {
    let fone = soDigitos(lead.phone);
    if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
    const filtros = [];
    if (fone) filtros.push(`telefone.eq.${fone}`);
    if (lead.email) filtros.push(`email.eq.${encodeURIComponent(String(lead.email).trim().toLowerCase())}`);
    if (filtros.length) {
      cliente = (await rest(`rel_clientes?select=nome,cpf,nascimento,email,telefone&mesclado_em_id=is.null&arquivado_em=is.null&or=(${filtros.join(',')})&order=criado_em.asc&limit=1`).catch(() => null))?.[0] || null;
    }
  }

  // Proposta aprovada (quando não tem ficha).
  let proposta = null;
  if (!ficha) {
    const sols = await rest(`qs_solicitacoes?select=id&lead_id=eq.${negocio.lead_id}`).catch(() => []);
    const ors = [`lead_id.eq.${negocio.lead_id}`];
    if (sols?.length) ors.push(`solicitacao_id.in.(${sols.map((s) => s.id).join(',')})`);
    proposta = (await rest(`qs_propostas?select=id,numero,destino,data_ida,data_volta,aprovada_opcao_id&status=eq.aprovada&or=(${ors.join(',')})&order=aprovada_em.desc&limit=1`).catch(() => null))?.[0] || null;
    if (proposta?.aprovada_opcao_id) {
      const op = (await rest(`qs_proposta_opcoes?select=desconto,itens:qs_proposta_itens(tipo,nome,descricao,valor_total)&id=eq.${proposta.aprovada_opcao_id}&limit=1`).catch(() => null))?.[0];
      if (op) {
        const sub = (op.itens || []).reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
        proposta.total = Math.max(0, sub - Math.min(Number(op.desconto) || 0, sub));
        proposta.itens = op.itens || [];
      }
    }
  }

  let bxd = null;
  let avisoBitrix = null;
  try { bxd = await dadosDoBitrix(dealId); } catch (e) { avisoBitrix = `Bitrix não respondeu (${e.message}).`; }
  if (dealId && !bxd && !avisoBitrix) avisoBitrix = `Não consegui ler o negócio ${dealId} no Bitrix.`;
  const d = bxd?.deal || {};
  const ct = bxd?.contato || {};

  // ── Tipo: expedição × pacote ──
  const tipo = ficha?.servico === 'expedicao' || d.expedicao ? 'expedicao' : 'pacote';
  campos.tipo = tipo;
  origem.tipo = ficha?.servico ? 'venda consolidada' : d.expedicao ? 'Bitrix' : 'padrão';

  // ── Pessoa ──
  por('nome', d.nome && d.nome !== '.' ? d.nome : '', 'Bitrix (negócio)');
  por('nome', juntarNome(ct.primeiro, ct.sobrenome), 'Bitrix (contato)');
  por('nome', cliente?.nome, 'ficha do cliente');
  por('nome', lead.full_name || juntarNome(lead.first_name, lead.last_name), 'lead');
  por('cpf', cliente?.cpf, 'ficha do cliente');
  por('cpf', d.cpf, 'Bitrix (negócio)');
  por('cpf', ct.cpf2, 'Bitrix (contato)');
  por('cpf', ct.cpf, 'Bitrix (contato)');
  por('rg', ct.rg, 'Bitrix (contato)');
  por('nascimento', dataBr(cliente?.nascimento), 'ficha do cliente');
  por('nascimento', d.nascimento, 'Bitrix (negócio)');
  por('nascimento', ct.nascimento, 'Bitrix (contato)');
  por('endereco', d.endereco, 'Bitrix (negócio)');
  por('endereco', ct.endereco, 'Bitrix (contato)');
  por('email', d.email, 'Bitrix (negócio)');
  por('email', cliente?.email, 'ficha do cliente');
  por('email', lead.email, 'lead');
  por('email', ct.email, 'Bitrix (contato)');
  por('email', d.email2, 'Bitrix (negócio)');
  por('telefone', formatarTelefone(lead.phone), 'lead');
  por('telefone', formatarTelefone(cliente?.telefone), 'ficha do cliente');
  por('telefone', formatarTelefone(ct.telefone), 'Bitrix (contato)');

  // ── Venda: o QS manda (ficha → proposta → Bitrix) ──
  if (tipo === 'expedicao') {
    por('expedicao', d.expedicao, 'Bitrix (negócio)');
    por('expedicao', ficha?.destino, 'venda consolidada');
  }
  const itens = ficha?.itens?.length ? ficha.itens : proposta?.itens || [];
  const destinoBase = ficha?.destino || proposta?.destino || '';
  if (destinoBase) por('destino', destinoBase, ficha ? 'venda consolidada' : 'proposta aprovada');
  por('destino', d.destino, 'Bitrix (negócio)');
  // Cláusula 1.3 do pacote: um item por linha, "Rótulo: descrição".
  const linhaDoItem = (i) => {
    const desc = String(i.descricao || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const rot = String(i.nome || ROTULO_ITEM[i.tipo] || i.tipo || '').trim();
    return rot && desc ? `${rot}: ${desc}` : rot || desc;
  };
  if (tipo === 'pacote' && itens.length) por('inclusos', itens.map(linhaDoItem).filter(Boolean).join('\n'), ficha ? 'venda consolidada' : 'proposta aprovada');
  por('tipo_pacote', d.tipo_pacote, 'Bitrix (negócio)');
  if (tipo === 'pacote') por('tipo_pacote', 'Personalizado', 'padrão');
  por('ida', dataBr(ficha?.data_ida || proposta?.data_ida), ficha ? 'venda consolidada' : 'proposta aprovada');
  por('ida', d.ida, 'Bitrix (negócio)');
  por('volta', dataBr(ficha?.data_volta || proposta?.data_volta), ficha ? 'venda consolidada' : 'proposta aprovada');
  por('volta', d.volta, 'Bitrix (negócio)');
  const tiposItens = new Set(itens.map((i) => i.tipo));
  if (itens.length) {
    por('passagem', tiposItens.has('aereo') ? 'Inclusa' : '', ficha ? 'venda consolidada' : 'proposta aprovada');
    por('seguro', tiposItens.has('seguro') ? 'Incluso' : '', ficha ? 'venda consolidada' : 'proposta aprovada');
  }
  por('passagem', d.passagem, 'Bitrix (negócio)');
  por('seguro', d.seguro, 'Bitrix (negócio)');
  if (itens.length) por('passagem', 'Não inclusa', ficha ? 'venda consolidada' : 'proposta aprovada');
  por('valor_total', ficha?.valor_total ? formatarValor(Number(ficha.valor_total)) : '', 'venda consolidada');
  por('valor_total', proposta?.total ? formatarValor(Number(proposta.total)) : '', 'proposta aprovada');
  por('valor_total', d.valor_total ? formatarValor(d.valor_total) : '', 'Bitrix (negócio)');
  por('valor_total', negocio.valor_previsto ? formatarValor(Number(negocio.valor_previsto)) : '', 'valor previsto do cartão');
  por('forma_pagamento', textoDoPlano(ficha?.plano), 'venda consolidada');
  por('forma_pagamento', d.forma_pagamento, 'Bitrix (negócio)');
  if (negocio.closer_id) {
    const c = (await rest(`qs_users?select=name&id=eq.${negocio.closer_id}&limit=1`).catch(() => null))?.[0];
    por('vendedor', c?.name, 'closer do cartão');
  }
  por('vendedor', d.vendedor, 'Bitrix (negócio)');
  por('data_venda', hojeBr(), 'hoje');

  for (const k of CAMPOS) if (campos[k] == null) campos[k] = '';
  return { campos, origem, dealId: dealId || null, avisoBitrix };
}

// ── Validação (a mesma regra no front) ─────────────────────────────────────
export function normalizarCampos(entrada) {
  const c = {};
  for (const k of CAMPOS) c[k] = String(entrada?.[k] ?? '').replace(/[ \t]+\n/g, '\n').trim().slice(0, LONGOS[k] || 300);
  c.tipo = c.tipo === 'expedicao' ? 'expedicao' : 'pacote';
  // Padrão do contrato (o mesmo que sai no PDF): e-mail minúsculo, CPF e
  // telefone com máscara, valor 0.000,00, datas dd/mm/aaaa, sem espaço duplo.
  c.email = c.email.toLowerCase();
  if (cpfValido(c.cpf)) c.cpf = formatarCpf(c.cpf);
  if (c.telefone) c.telefone = formatarTelefone(c.telefone);
  if (numeroDoValor(c.valor_total) > 0) c.valor_total = formatarValor(c.valor_total);
  for (const k of ['nascimento', 'ida', 'volta', 'data_venda']) c[k] = dataBr(c[k]);
  for (const k of ['nome', 'expedicao', 'tipo_pacote']) c[k] = c[k].replace(/\s+/g, ' ');
  return c;
}

/** "dd/mm/aaaa" → Date (meio-dia UTC), ou null se não for uma data de verdade. */
function dataDe(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? d : null;
}
export function validarCampos(c) {
  const erros = [];
  const avisos = [];
  if (!c.nome || c.nome === '.') erros.push('Nome completo do cliente.');
  if (!cpfValido(c.cpf)) erros.push('CPF válido (11 números).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) erros.push('E-mail válido do cliente (é por ele que o ZapSign manda o contrato).');
  if (soDigitos(c.telefone).length < 10) erros.push('Telefone com DDD.');
  if (!(numeroDoValor(c.valor_total) > 0)) erros.push('Valor total.');
  if (!c.forma_pagamento) erros.push('Forma de pagamento.');
  if (c.tipo === 'expedicao' && !c.expedicao) erros.push('Nome da expedição.');
  if (c.tipo === 'pacote' && !c.destino) erros.push('Destino / descrição do pacote.');
  if (c.tipo === 'pacote' && !linhasDosInclusos(c.inclusos).length) erros.push('O que está incluso (cláusula 1.3, um item por linha).');
  if (!dataDe(c.data_venda)) erros.push('Data da venda (dd/mm/aaaa).');
  for (const [k, rot] of [['ida', 'Ida prevista'], ['volta', 'Volta prevista']]) if (c[k] && !dataDe(c[k])) erros.push(`${rot} em dd/mm/aaaa.`);
  if (dataDe(c.ida) && dataDe(c.volta) && dataDe(c.volta) < dataDe(c.ida)) erros.push('A volta está antes da ida (confira o ano).');
  for (const [k, rot] of [['endereco', 'Endereço'], ['ida', 'Ida prevista'], ['volta', 'Volta prevista']]) if (!c[k]) avisos.push(`${rot} vazio — sai "-" no contrato.`);
  if (c.tipo === 'pacote' && !c.nascimento) avisos.push('Data de nascimento vazia — sai "-" no contrato.');
  if (c.nascimento && !dataDe(c.nascimento)) avisos.push('Data de nascimento fora do padrão dd/mm/aaaa.');
  if (c.tipo === 'expedicao' && (!c.passagem || !c.seguro)) avisos.push('Passagem aérea ou seguro vazio — sai "-" no quadro resumo.');
  return { erros, avisos };
}

// ── GERAR (no próprio QS: api/_contratoModelo.js) e GUARDAR (Supabase Storage) ──
export function nomesDoArquivo(c, dealId, negocioId) {
  const tipoLabel = c.tipo === 'expedicao' ? 'Expedição' : 'Pacote';
  const ref = c.tipo === 'expedicao' ? c.expedicao : (String(c.destino).split(/[:—]/)[0] || c.tipo_pacote);
  const refCurta = String(ref || '').trim().slice(0, 80);
  const id = dealId ? `D_${dealId}` : `QS-${String(negocioId).slice(0, 8)}`;
  return {
    arquivo: `Contrato de ${tipoLabel}${refCurta ? ` ${refCurta}` : ''} | ${c.nome} | ${id}`.replace(/[\\/]/g, '-'),
    zapsign: `Contrato de ${tipoLabel} - ${c.nome}${refCurta ? ` | ${refCurta}` : ''} - ${id}`,
  };
}

/** Gera o PDF do contrato a partir dos campos (sem Google). */
export const gerarPdf = (c) => gerarPdfDoContrato(c);

// Bucket PRIVADO "contratos" (0211). O banco guarda o caminho com o prefixo
// "storage:"; a tela pede um link temporário (linkDoPdf) na hora de abrir.
const BUCKET = 'contratos';
const PREFIXO = 'storage:';
const baseSupabase = () => env('SUPABASE_URL').replace(/\/+$/, '');
const chaveServico = () => env('SUPABASE_SERVICE_ROLE_KEY');

export async function guardarPdf(caminho, buffer) {
  const r = await buscar(`${baseSupabase()}/storage/v1/object/${BUCKET}/${caminho}`, {
    method: 'POST',
    headers: { apikey: chaveServico(), Authorization: `Bearer ${chaveServico()}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: buffer,
  }, 20_000);
  if (!r.ok) throw new Error(`Storage: ${(await r.text()).slice(0, 200) || `HTTP ${r.status}`}`);
  return `${PREFIXO}${caminho}`;
}

/** "storage:…" → link de 10 min; link http antigo (Drive) passa direto. */
export async function linkDoPdf(guardado) {
  const s = String(guardado || '');
  if (!s.startsWith(PREFIXO)) return s || null;
  const r = await buscar(`${baseSupabase()}/storage/v1/object/sign/${BUCKET}/${s.slice(PREFIXO.length)}`, {
    method: 'POST',
    headers: { apikey: chaveServico(), Authorization: `Bearer ${chaveServico()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 600 }),
  }, 10_000);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.signedURL) throw new Error('Não achei o PDF guardado.');
  return `${baseSupabase()}/storage/v1${j.signedURL}`;
}

/** Guarda a cópia ASSINADA (o link do ZapSign expira em minutos). */
export async function arquivarAssinado(urlAssinado, caminho) {
  const r = await buscar(urlAssinado, {}, 20_000);
  if (!r.ok) throw new Error(`Não baixei o PDF assinado (HTTP ${r.status}).`);
  return guardarPdf(caminho, Buffer.from(await r.arrayBuffer()));
}

// ── ZAPSIGN ─────────────────────────────────────────────────────────────────
const baseZapsign = () => (env('ZAPSIGN_API_URL') || 'https://api.zapsign.com.br').replace(/\/+$/, '');

async function zapsign(method, caminho, json) {
  const tk = env('ZAPSIGN_API_TOKEN');
  if (!tk) throw new Error('Falta ZAPSIGN_API_TOKEN na Vercel.');
  const r = await buscar(`${baseZapsign()}/api/v1/${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${tk}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  }, 25_000);
  const txt = await r.text();
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  if (!r.ok) {
    const err = new Error(`ZapSign: ${j?.detail || j?.message || (typeof j === 'object' && j ? JSON.stringify(j).slice(0, 300) : txt.slice(0, 200)) || `HTTP ${r.status}`}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

function telefoneDoAssinante(t) {
  let d = soDigitos(t);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 ? { phone_country: d.slice(0, 2), phone_number: d.slice(2) } : {};
}

export async function criarNoZapsign({ c, cfg, nomes, pdf, negocioId }) {
  const doc = await zapsign('POST', 'docs/', {
    name: nomes.zapsign.slice(0, 250),
    base64_pdf: pdf.toString('base64'),
    lang: 'pt-br',
    disable_signer_emails: false,
    signed_file_only_finished: false,
    external_id: negocioId,
    signers: [
      { name: c.nome, email: c.email, send_automatic_email: true, send_automatic_whatsapp: false },
      {
        name: cfg.assinante_nome, email: cfg.assinante_email, ...telefoneDoAssinante(cfg.assinante_telefone),
        send_automatic_email: true, send_automatic_whatsapp: false,
      },
    ],
  });
  const cliente = (doc?.signers || []).find((s) => String(s.email || '').toLowerCase() === c.email) || doc?.signers?.[0];
  return { token: doc?.token, openId: doc?.open_id != null ? String(doc.open_id) : null, link: cliente?.sign_url || null };
}

export const lerNoZapsign = (token) => zapsign('GET', `docs/${encodeURIComponent(token)}/`);
export const apagarNoZapsign = (token) => zapsign('DELETE', `docs/${encodeURIComponent(token)}/`);
export const testarZapsign = () => zapsign('GET', 'docs/?page=1');

/**
 * Status do contrato a partir do documento LIDO no ZapSign (fonte confiável).
 * O cartão vai para "assinado" quando o CLIENTE assina (o assinante da agência
 * assina depois, sem mexer no cartão).
 */
export function statusDoDocumento(doc, emailCliente) {
  if (!doc) return null;
  if (doc.deleted || doc.deleted_at) return { status: 'cancelado' };
  const signers = Array.isArray(doc.signers) ? doc.signers : [];
  const cli = signers.find((s) => String(s.email || '').toLowerCase() === String(emailCliente || '').toLowerCase()) || signers[0] || {};
  const viu = Number(cli.times_viewed || 0);
  const extra = { visualizacoes: viu, link_assinatura: cli.sign_url || undefined };
  if (doc.status === 'refused' || cli.status === 'refused') return { status: 'recusado', extra };
  // `concluido`: TODOS assinaram (status do documento). O doc_signed chega a cada
  // assinatura; o PDF do cliente sai antes da agência assinar e precisa ser
  // arquivado de novo quando o documento fecha (03/11).
  if (doc.status === 'signed' || cli.status === 'signed') return { status: 'assinado', extra: { ...extra, quando: cli.signed_at || undefined }, arquivo: doc.signed_file || null, concluido: doc.status === 'signed' };
  if (viu > 0 || cli.last_view_at) return { status: 'visualizado', extra: { ...extra, quando: cli.last_view_at || undefined } };
  return { status: 'enviado', extra };
}

export const hashDoCorpo = (corpo) => createHash('sha256').update(typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? {})).digest('hex');
