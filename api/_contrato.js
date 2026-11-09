// api/_contrato.js
// -----------------------------------------------------------------------------
// CONTRATO 100% EM CÓDIGO (0180, Bruno 22/10/2026: "eu não quero que seja nada
// via n8n"; 27/10: "vamos parar de usar o console" — sem Google Docs/Drive).
//
//   1. MONTAR OS CAMPOS: venda registrada (qs_vendas/qs_venda_itens/expedicoes)
//      → ficha/proposta → Bitrix; pessoa: último envio → cadastro único
//      (rel_clientes, com RG e endereço) → lead → Bitrix. O closer confere e
//      corrige na prévia, e o que ele corrigir volta pro cadastro
//      (gravarNoCadastro, 09/11).
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
// 09/11 (Bruno: "digitar UMA VEZ no QS"): a VENDA REGISTRADA pelo closer
// (qs_vendas + qs_venda_itens + passageiros + expedicoes) manda nos dados da
// viagem; o cadastro único (rel_clientes) manda nos dados da pessoa; o Bitrix
// só tapa buraco. A escolha é PURA (camposDasFontes) — a leitura do banco fica
// em montarPrevia — pra dar pra testar a prioridade sem rede.
export const CAMPOS = ['tipo', 'nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone', 'viajante', 'expedicao', 'destino', 'tipo_pacote',
  'inclusos', 'nao_inclusos', 'ida', 'volta', 'passagem', 'seguro', 'valor_total', 'forma_pagamento', 'vendedor', 'data_venda', 'roteiro'];
const LONGOS = { destino: 1500, inclusos: 4000, nao_inclusos: 1500, forma_pagamento: 1000, endereco: 500, viajante: 500, roteiro: 30000 };
// Rótulo do item da proposta quando ele não tem nome (cláusula 1.3 do pacote).
const ROTULO_ITEM = {
  aereo: 'Aéreo', hospedagem: 'Hospedagem', transfer: 'Transfer', trem: 'Trens', passeio: 'Passeio', seguro: 'Seguro viagem',
  carro: 'Carro', cruzeiro: 'Cruzeiro', visto: 'Visto', pacote: 'Pacote', expedicao: 'Expedição', concierge: 'Assessoria',
};
// Dados da PESSOA: a correção do closer no último envio vale de novo.
const DA_PESSOA = ['nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone'];
const DA_VENDA = 'venda registrada';
const DO_CADASTRO = 'cadastro do cliente';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unicos = (xs) => [...new Set(xs.filter(Boolean))];
const isoDe = (v) => (String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || '';
const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = numeroDoValor(v);
  return Number.isFinite(n) ? n : 0;
};
const centavos = (n) => Math.round(n * 100) / 100;

// ── Endereço: colunas da 0213 ↔ texto do contrato ───────────────────────────
/** "Rua X, 160, ap 12, Vila Olímpia, São Paulo/SP, CEP 04551-010" a partir das colunas endereco_*. */
export function enderecoDoCliente(c) {
  if (!c) return '';
  const t = (k) => String(c[`endereco_${k}`] ?? '').trim();
  const cep = soDigitos(t('cep'));
  const cidadeUf = [t('cidade'), t('estado')].filter(Boolean).join('/');
  return [
    [t('rua'), t('numero')].filter(Boolean).join(', '),
    t('complemento'), t('bairro'), cidadeUf,
    cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : t('cep'),
  ].filter(Boolean).join(', ');
}
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const limparPontas = (s) => String(s || '').replace(/\s*,\s*,/g, ',').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
/**
 * Texto livre do contrato → colunas, de forma CONSERVADORA: só separa o que dá
 * pra reconhecer com segurança — o CEP (regex) e "Cidade/UF" ou "Cidade - UF"
 * no fim (UF válida). O resto vai inteiro em endereco_rua; número, complemento
 * e bairro ficam vazios. Só é usado quando o cadastro NÃO tem endereço estruturado.
 */
export function enderecoParaColunas(texto) {
  const s = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const m = s.match(/(?:CEP[:\s]*)?(\d{5})-?(\d{3})(?!\d)/i);
  let resto = limparPontas(m ? s.replace(m[0], '') : s);
  let cidade = null;
  let estado = null;
  const cu = resto.match(/(?:^|,)\s*([^,\/]*?[^\s,\/-])\s*(?:\/|\s[-–]\s)\s*([A-Za-z]{2})$/);
  if (cu && UFS.has(cu[2].toUpperCase())) {
    cidade = cu[1].trim();
    estado = cu[2].toUpperCase();
    resto = limparPontas(resto.slice(0, cu.index));
  }
  return {
    endereco_rua: resto || null, endereco_numero: null, endereco_complemento: null, endereco_bairro: null,
    endereco_cidade: cidade, endereco_estado: estado, endereco_cep: m ? `${m[1]}${m[2]}` : null,
  };
}
/** O cadastro já tem endereço ESTRUTURADO (algo além da rua)? Aí o texto do contrato não entra. */
export const temEnderecoEstruturado = (c) =>
  ['numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep'].some((k) => String(c?.[`endereco_${k}`] ?? '').trim() !== '');
export const AVISO_ENDERECO = 'Endereço editado no contrato não foi copiado pro cadastro (cadastro já tem endereço estruturado).';

// ── Pagamento da venda (qs_vendas.pagamento) em texto de contrato ───────────
/**
 * { forma, condicao: avista|parcelado|entrada, entrada, entrada_data, parcelas,
 *   primeira_parcela, obs } → "Entrada de R$ 2.000,00 em 10/11/2026 e 10
 * parcelas de R$ 2.499,00 (a 1ª em 10/12/2026), via cartão de crédito. Obs."
 * Na condição "entrada", `parcelas` = parcelas DEPOIS da entrada (como na tela
 * da venda). Aceita os nomes alternativos data_entrada / n_parcelas / peculiaridades.
 */
export function textoDoPagamentoDaVenda(pag, valorTotal, { condicaoEspecial = false, condicaoObs = '' } = {}) {
  const p = pag && typeof pag === 'object' ? pag : {};
  const total = num(valorTotal);
  const forma = FORMA[p.forma] || String(p.forma || '').trim();
  const entrada = num(p.entrada);
  const n = Math.max(0, Math.trunc(Number(p.parcelas ?? p.n_parcelas ?? p.num_parcelas) || 0));
  const dEnt = dataBr(isoDe(p.entrada_data ?? p.data_entrada) || (p.entrada_data ?? p.data_entrada ?? ''));
  const d1 = dataBr(isoDe(p.primeira_parcela ?? p.data_primeira_parcela) || (p.primeira_parcela ?? p.data_primeira_parcela ?? ''));
  const obs = String(p.obs ?? p.peculiaridades ?? '').replace(/\s+/g, ' ').trim();
  const condicao = ['avista', 'parcelado', 'entrada'].includes(p.condicao) ? p.condicao
    : entrada > 0 ? 'entrada' : n > 1 ? 'parcelado' : (forma || total ? 'avista' : '');
  const parcelas = (qtd, base) => {
    if (!qtd) return '';
    const cada = base > 0 ? ` de ${brl(centavos(base / qtd))}` : '';
    return `${qtd} ${qtd === 1 ? 'parcela' : 'parcelas'}${cada}${d1 ? ` (a 1ª em ${d1})` : ''}`;
  };
  let txt = '';
  if (condicao === 'avista') txt = `À vista${total > 0 ? ` (${brl(total)})` : ''}${dEnt ? ` em ${dEnt}` : ''}`;
  else if (condicao === 'parcelado') txt = parcelas(n, total) || 'Parcelado';
  else if (condicao === 'entrada') {
    const ent = entrada > 0 ? `Entrada de ${brl(entrada)}${dEnt ? ` em ${dEnt}` : ''}` : 'Entrada';
    const resto = parcelas(n, total > entrada ? total - entrada : 0);
    txt = resto ? `${ent} e ${resto}` : ent;
  }
  if (txt && forma) txt += `, via ${forma}`;
  else if (!txt && forma) txt = `Via ${forma}`;
  const extras = [];
  if (obs) extras.push(obs);
  if (condicaoEspecial && String(condicaoObs || '').trim()) extras.push(`Condição especial: ${String(condicaoObs).replace(/\s+/g, ' ').trim()}`);
  return [txt, ...extras].filter(Boolean).map((s) => s.replace(/[.\s]+$/, '')).join('. ') + (txt || extras.length ? '.' : '');
}

// ── Viajantes da venda (tabela passageiros + json do item) ──────────────────
const nomeChave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const boolOuNulo = (v) => (v === true || v === false ? v : v === 'true' ? true : v === 'false' ? false : null);

/**
 * Quem viaja nesta venda, com o VALOR e o aéreo de cada um. Fonte principal:
 * a tabela `passageiros` (venda_id = a venda; cancelado fica de fora); o json
 * `qs_venda_itens.passageiros` completa quem não virou passageiro.
 */
export function viajantesDaVenda(vf) {
  if (!vf) return [];
  const out = [];
  for (const p of vf.passageiros || []) {
    if (/cancelad/i.test(String(p.status_reserva || ''))) continue;
    out.push({
      passageiro_id: p.id || null, cliente_id: p.cliente_id || null, item_id: p.venda_item_id || null, expedicao_id: p.expedicao_id || null,
      nome: String(p.nome_completo || '').trim(), cpf: p.cpf || '', nascimento: p.data_nascimento || '', email: p.email || '', telefone: p.telefone || '',
      valor: p.valor_contratado_brl == null || p.valor_contratado_brl === '' ? null : num(p.valor_contratado_brl),
      aereo_incluso: boolOuNulo(p.aereo_incluso),
    });
  }
  for (const it of vf.itens || []) {
    for (const p of Array.isArray(it.passageiros) ? it.passageiros : []) {
      const nome = String(p?.nome || '').trim();
      if (!nome) continue;
      const ja = out.find((o) => (p.cliente_id && o.cliente_id === p.cliente_id) || nomeChave(o.nome) === nomeChave(nome));
      const valor = p.valor_contratado ?? p.valor_contratado_brl ?? p.valor;
      const aereo = boolOuNulo(p.aereo_incluso);
      if (ja) {
        if (ja.valor == null && valor != null && valor !== '') ja.valor = num(valor);
        if (ja.aereo_incluso == null && aereo != null) ja.aereo_incluso = aereo;
        continue;
      }
      out.push({
        passageiro_id: null, cliente_id: p.cliente_id || null, item_id: it.id || null, expedicao_id: it.dados?.expedicao_id || null,
        nome, cpf: p.cpf || '', nascimento: p.nascimento || '', email: p.email || '', telefone: p.telefone || '',
        valor: valor == null || valor === '' ? null : num(valor), aereo_incluso: aereo,
      });
    }
  }
  return out;
}

const listaDeNomes = (vs) => vs.map((v) => v.nome || 'viajante').join(', ');
/**
 * Passagem aérea a partir da venda: vale o `aereo_incluso` de CADA viajante
 * (expedição com aéreo incluso sai "Inclusa" mesmo sem item de aéreo). Um item
 * "aéreo" vendido junto também conta como incluso. '' = a venda não diz.
 */
export function passagemDaVenda(vf) {
  if (!vf) return '';
  const itens = vf.itens || [];
  const temAereo = itens.some((i) => i.tipo === 'aereo');
  const com = viajantesDaVenda(vf).filter((v) => v.aereo_incluso !== null);
  if (com.length) {
    const sim = com.filter((v) => v.aereo_incluso);
    const nao = com.filter((v) => !v.aereo_incluso);
    if (!nao.length || temAereo) return 'Inclusa';
    if (!sim.length) return 'Não inclusa';
    return `Inclusa para ${listaDeNomes(sim)}; não inclusa para ${listaDeNomes(nao)}`;
  }
  if (temAereo) return 'Inclusa';
  if (itens.some((i) => i.tipo === 'expedicao')) return '';
  return itens.length ? 'Não inclusa' : '';
}

/** Dias do roteiro (roteiro_dias, sem extensão) → texto do Anexo I. "Dia N" abre cada dia. */
export function textoDoRoteiro(dias) {
  const lista = (dias || []).slice().sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || (Number(a.dia) || 0) - (Number(b.dia) || 0));
  return lista.map((d, i) => {
    const cab = [`Dia ${d.dia ?? i + 1}`, d.data ? dataBr(d.data) : '', String(d.cidade || '').trim()].filter(Boolean).join(' · ');
    const titulo = String(d.titulo || '').replace(/\s+/g, ' ').trim();
    const desc = String(d.descricao || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
    return [`${cab}${titulo ? ` — ${titulo}` : ''}`, desc].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}

const linhaDoItem = (i) => {
  const d = i.dados && typeof i.dados === 'object' ? i.dados : {};
  const desc = String(i.descricao || d.descricao || d.detalhes || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const rot = String(i.nome || ROTULO_ITEM[i.tipo] || i.tipo || '').trim();
  return rot && desc ? `${rot}: ${desc}` : rot || desc;
};

/** O que a venda registrada diz do contrato (null = não tem venda registrada). */
export function resumoDaVenda(vf) {
  if (!vf || (!vf.venda && !(vf.itens || []).length)) return null;
  const itens = vf.itens || [];
  const venda = vf.venda || {};
  const exps = itens.filter((i) => i.tipo === 'expedicao');
  const expDe = (i) => (vf.expedicoes || []).find((e) => e.id === i?.dados?.expedicao_id) || null;
  const r = { tipo: exps.length ? 'expedicao' : itens.length ? 'pacote' : '' };
  const datas = (lista, k) => lista.map((x) => isoDe(x[k])).filter(Boolean).sort();
  if (exps.length) {
    r.expedicao = unicos(exps.map((i) => String(expDe(i)?.nome || i.dados?.expedicao || i.nome || '').trim())).join(' + ');
    r.destino = unicos(exps.map((i) => String(expDe(i)?.destino || '').trim())).join(' + ');
    const ini = exps.map((i) => ({ d: i.data_inicio || expDe(i)?.data_embarque }));
    const fim = exps.map((i) => ({ d: i.data_fim || expDe(i)?.data_retorno }));
    r.ida = dataBr(datas(ini, 'd')[0] || '');
    r.volta = dataBr(datas(fim, 'd').slice(-1)[0] || '');
    const principal = expDe(exps[0]);
    r.roteiro = textoDoRoteiro((vf.roteiro || []).filter((d) => !principal || d.expedicao_id === principal.id));
  } else if (itens.length) {
    r.inclusos = itens.map(linhaDoItem).filter(Boolean).join('\n');
    const pac = itens.find((i) => i.tipo === 'pacote');
    r.destino = String(pac?.dados?.destino || '').trim();
    r.ida = dataBr(datas(itens, 'data_inicio')[0] || '');
    r.volta = dataBr(datas(itens, 'data_fim').slice(-1)[0] || '');
  }
  const soma = centavos(itens.reduce((s, i) => s + num(i.valor), 0));
  r.valor = num(venda.valor_total) > 0 ? num(venda.valor_total) : soma;
  r.passagem = passagemDaVenda(vf);
  r.seguro = itens.some((i) => i.tipo === 'seguro') ? 'Incluso' : '';
  r.forma_pagamento = vf.venda ? textoDoPagamentoDaVenda(venda.pagamento, r.valor, { condicaoEspecial: venda.condicao_especial, condicaoObs: venda.condicao_obs }) : '';
  return r;
}

/**
 * A ESCOLHA dos campos (pura). Prioridade:
 *   pessoa → último envio (o que o closer corrigiu) → cadastro do cliente
 *            (rel_clientes, inclusive RG e endereço) → lead → Bitrix;
 *   viagem → venda registrada → venda consolidada (ficha) / proposta aprovada
 *            → Bitrix → valor previsto do cartão.
 * f = { negocio, lead, ultimo, cliente, venda, proposta, bitrix: {deal, contato}, closerNome, hoje }
 */
export function camposDasFontes(f) {
  const campos = {};
  const origem = {};
  const por = (k, valor, de) => {
    const v = valor == null ? '' : String(valor).trim();
    if (!campos[k] && v) { campos[k] = v; origem[k] = de; }
  };
  const negocio = f.negocio || {};
  const lead = f.lead || {};
  const ficha = negocio.ficha || null;
  const proposta = f.proposta || null;
  const cliente = f.cliente || null;
  const d = f.bitrix?.deal || {};
  const ct = f.bitrix?.contato || {};
  const rv = resumoDaVenda(f.venda);

  // A correção do closer no último envio (só dados da pessoa).
  if (f.ultimo) for (const k of DA_PESSOA) por(k, f.ultimo[k], 'último envio');

  // ── Tipo: expedição × pacote ──
  if (rv?.tipo) { campos.tipo = rv.tipo; origem.tipo = DA_VENDA; }
  else {
    campos.tipo = ficha?.servico === 'expedicao' || d.expedicao ? 'expedicao' : 'pacote';
    origem.tipo = ficha?.servico ? 'venda consolidada' : d.expedicao ? 'Bitrix' : 'padrão';
  }
  const tipo = campos.tipo;

  // ── Pessoa: cadastro único → lead → Bitrix ──
  por('nome', cliente?.nome, DO_CADASTRO);
  por('nome', d.nome && d.nome !== '.' ? d.nome : '', 'Bitrix (negócio)');
  por('nome', juntarNome(ct.primeiro, ct.sobrenome), 'Bitrix (contato)');
  por('nome', lead.full_name || juntarNome(lead.first_name, lead.last_name), 'lead');
  por('cpf', cpfValido(cliente?.cpf) ? formatarCpf(cliente.cpf) : cliente?.cpf, DO_CADASTRO);
  por('cpf', d.cpf, 'Bitrix (negócio)');
  por('cpf', ct.cpf2, 'Bitrix (contato)');
  por('cpf', ct.cpf, 'Bitrix (contato)');
  por('rg', cliente?.rg, DO_CADASTRO);
  por('rg', ct.rg, 'Bitrix (contato)');
  por('nascimento', dataBr(cliente?.nascimento), DO_CADASTRO);
  por('nascimento', d.nascimento, 'Bitrix (negócio)');
  por('nascimento', ct.nascimento, 'Bitrix (contato)');
  por('endereco', enderecoDoCliente(cliente), DO_CADASTRO);
  por('endereco', d.endereco, 'Bitrix (negócio)');
  por('endereco', ct.endereco, 'Bitrix (contato)');
  por('email', cliente?.email, DO_CADASTRO);
  por('email', lead.email, 'lead');
  por('email', d.email, 'Bitrix (negócio)');
  por('email', ct.email, 'Bitrix (contato)');
  por('email', d.email2, 'Bitrix (negócio)');
  por('telefone', formatarTelefone(cliente?.telefone), DO_CADASTRO);
  por('telefone', formatarTelefone(lead.phone), 'lead');
  por('telefone', formatarTelefone(ct.telefone), 'Bitrix (contato)');

  // ── Viagem: venda registrada → ficha/proposta → Bitrix ──
  const deFicha = ficha ? 'venda consolidada' : 'proposta aprovada';
  if (tipo === 'expedicao') {
    if (rv?.tipo === 'expedicao') por('expedicao', rv.expedicao, DA_VENDA);
    // Nome da expedição: o Bitrix vem antes da ficha (a ficha guarda o DESTINO, não o nome da expedição).
    por('expedicao', d.expedicao, 'Bitrix (negócio)');
    por('expedicao', ficha?.destino, 'venda consolidada');
  }
  const itens = ficha?.itens?.length ? ficha.itens : proposta?.itens || [];
  por('destino', rv?.destino, DA_VENDA);
  const destinoBase = ficha?.destino || proposta?.destino || '';
  if (destinoBase) por('destino', destinoBase, deFicha);
  por('destino', d.destino, 'Bitrix (negócio)');
  if (tipo === 'pacote') {
    por('inclusos', rv?.inclusos, DA_VENDA);
    if (itens.length) por('inclusos', itens.map(linhaDoItem).filter(Boolean).join('\n'), deFicha);
  }
  por('tipo_pacote', d.tipo_pacote, 'Bitrix (negócio)');
  if (tipo === 'pacote') por('tipo_pacote', 'Personalizado', 'padrão');
  por('ida', rv?.ida, DA_VENDA);
  por('ida', dataBr(ficha?.data_ida || proposta?.data_ida), deFicha);
  por('ida', d.ida, 'Bitrix (negócio)');
  por('volta', rv?.volta, DA_VENDA);
  por('volta', dataBr(ficha?.data_volta || proposta?.data_volta), deFicha);
  por('volta', d.volta, 'Bitrix (negócio)');
  por('passagem', rv?.passagem, DA_VENDA);
  por('seguro', rv?.seguro, DA_VENDA);
  const tiposItens = new Set(itens.map((i) => i.tipo));
  if (itens.length) {
    por('passagem', tiposItens.has('aereo') ? 'Inclusa' : '', deFicha);
    por('seguro', tiposItens.has('seguro') ? 'Incluso' : '', deFicha);
  }
  por('passagem', d.passagem, 'Bitrix (negócio)');
  por('seguro', d.seguro, 'Bitrix (negócio)');
  if (itens.length) por('passagem', 'Não inclusa', deFicha);
  por('valor_total', rv?.valor > 0 ? formatarValor(rv.valor) : '', DA_VENDA);
  por('valor_total', ficha?.valor_total ? formatarValor(Number(ficha.valor_total)) : '', 'venda consolidada');
  por('valor_total', proposta?.total ? formatarValor(Number(proposta.total)) : '', 'proposta aprovada');
  por('valor_total', d.valor_total ? formatarValor(d.valor_total) : '', 'Bitrix (negócio)');
  por('valor_total', negocio.valor_previsto ? formatarValor(Number(negocio.valor_previsto)) : '', 'valor previsto do cartão');
  por('forma_pagamento', rv?.forma_pagamento, DA_VENDA);
  por('forma_pagamento', textoDoPlano(ficha?.plano), 'venda consolidada');
  por('forma_pagamento', d.forma_pagamento, 'Bitrix (negócio)');
  if (tipo === 'expedicao') por('roteiro', rv?.roteiro, 'roteiro da expedição');
  por('vendedor', f.closerNome, 'closer do cartão');
  por('vendedor', d.vendedor, 'Bitrix (negócio)');
  por('data_venda', f.hoje || hojeBr(), 'hoje');

  for (const k of CAMPOS) if (campos[k] == null) campos[k] = '';
  return { campos, origem };
}

// ── Leitura do banco (o que camposDasFontes recebe) ─────────────────────────
const COLS_CLIENTE_BASE = 'id,nome,cpf,nascimento,email,telefone,mesclado_em_id,endereco_cep,endereco_rua,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_estado';
// rg chega com a 0339; até ela ser aplicada o select sem rg segue funcionando.
let temColunaRg = null;
async function lerClientes(filtro) {
  if (temColunaRg !== false) {
    try {
      const r = await rest(`rel_clientes?select=${COLS_CLIENTE_BASE},rg&${filtro}`);
      temColunaRg = true;
      return r || [];
    } catch (e) {
      if (!/\brg\b/.test(String(e?.message || ''))) throw e;   // 'column rel_clientes.rg does not exist'
      temColunaRg = false;
    }
  }
  return (await rest(`rel_clientes?select=${COLS_CLIENTE_BASE}&${filtro}`)) || [];
}

/** 0352: fichas (rel_clientes) por id, com RG e endereço → Map(id → ficha). */
export async function fichasPorIds(ids) {
  const lista = unicos(ids || []).filter((x) => UUID.test(String(x)));
  if (!lista.length) return new Map();
  const r = await lerClientes(`id=in.(${lista.join(',')})`);
  return new Map((r || []).map((c) => [c.id, c]));
}

/**
 * A ficha da pessoa no cadastro único. Primeiro pelos vínculos (venda → lead
 * → viagem do Rel), seguindo a mescla; só depois por telefone/e-mail.
 * `por`: 'vinculo' | 'contato' (o write-back só sobrescreve quem veio por vínculo).
 */
export async function acharCliente(negocio, lead, venda) {
  const ids = [venda?.cliente_id, lead?.cliente_id];
  if (negocio?.viagem_id) {
    const v = (await rest(`rel_viagens?select=cliente_id&id=eq.${negocio.viagem_id}&limit=1`).catch(() => null))?.[0];
    ids.push(v?.cliente_id);
  }
  for (const id0 of unicos(ids).filter((x) => UUID.test(String(x)))) {
    let id = id0;
    for (let salto = 0; salto < 3; salto++) {
      const c = (await lerClientes(`id=eq.${id}&limit=1`).catch(() => []))?.[0];
      if (!c) break;
      if (c.mesclado_em_id && UUID.test(c.mesclado_em_id)) { id = c.mesclado_em_id; continue; }
      return { cliente: c, por: 'vinculo' };
    }
  }
  let fone = soDigitos(lead?.phone);
  if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
  const filtros = [];
  if (fone) filtros.push(`telefone.eq.${fone}`);
  if (lead?.email) filtros.push(`email.eq.${encodeURIComponent(String(lead.email).trim().toLowerCase())}`);
  if (!filtros.length) return { cliente: null, por: null };
  const c = (await lerClientes(`mesclado_em_id=is.null&arquivado_em=is.null&or=(${filtros.join(',')})&order=criado_em.asc&limit=1`).catch(() => []))?.[0] || null;
  return { cliente: c, por: c ? 'contato' : null };
}

/** A venda registrada do cartão: cabeçalho, itens vivos, expedições, roteiro e passageiros. */
export async function carregarVenda(negocio) {
  const venda = (await rest(`qs_vendas?select=id,cliente_id,valor_total,pagamento,condicao_especial,condicao_obs,observacoes&negocio_id=eq.${negocio.id}&limit=1`).catch(() => null))?.[0] || null;
  const filtro = venda ? `or=(venda_id.eq.${venda.id},negocio_id.eq.${negocio.id})` : `negocio_id=eq.${negocio.id}`;
  const itens = ((await rest(`qs_venda_itens?select=id,tipo,nome,data_inicio,data_fim,dados,passageiros,valor,status,ordem&${filtro}&order=ordem.asc`).catch(() => null)) || [])
    .filter((i) => i.status !== 'cancelado');
  if (!venda && !itens.length) return null;
  const expIds = unicos(itens.filter((i) => i.tipo === 'expedicao').map((i) => i.dados?.expedicao_id)).filter((x) => UUID.test(String(x)));
  const [expedicoes, roteiro, passageiros] = await Promise.all([
    expIds.length ? rest(`expedicoes?select=id,codigo,nome,destino,data_embarque,data_retorno,preco_venda_brl,preco_sem_aereo_brl&id=in.(${expIds.join(',')})`).catch(() => []) : [],
    expIds.length ? rest(`roteiro_dias?select=expedicao_id,dia,data,titulo,descricao,cidade,ordem&expedicao_id=in.(${expIds.join(',')})&extensao_id=is.null&order=ordem.asc,dia.asc`).catch(() => []) : [],
    venda ? rest(`passageiros?select=id,cliente_id,venda_item_id,expedicao_id,nome_completo,cpf,email,telefone,data_nascimento,valor_contratado_brl,aereo_incluso,status_reserva&venda_id=eq.${venda.id}&order=created_at.asc`).catch(() => []) : [],
  ]);
  return { venda, itens, expedicoes: expedicoes || [], roteiro: roteiro || [], passageiros: passageiros || [] };
}

export async function montarPrevia(negocio) {
  const lead = (await rest(`qs_leads?select=id,full_name,first_name,last_name,email,phone,bitrix_id,cliente_id&id=eq.${negocio.lead_id}&limit=1`))?.[0] || {};
  const dealId = soDigitos(lead.bitrix_id);
  const ficha = negocio.ficha || null;

  const ultimo = (await rest(`qs_contratos?select=campos&negocio_id=eq.${negocio.id}&order=criado_em.desc&limit=1`).catch(() => null))?.[0]?.campos || null;
  const venda = await carregarVenda(negocio).catch(() => null);
  const { cliente } = await acharCliente(negocio, lead, venda?.venda);

  // Proposta aprovada (só quando não há venda registrada nem ficha).
  let proposta = null;
  if (!ficha && !venda?.itens?.length) {
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

  let closerNome = '';
  if (negocio.closer_id) closerNome = (await rest(`qs_users?select=name&id=eq.${negocio.closer_id}&limit=1`).catch(() => null))?.[0]?.name || '';

  const { campos, origem } = camposDasFontes({ negocio, lead, ultimo, cliente, venda, proposta, bitrix: bxd, closerNome });
  const viajantes = viajantesDaVenda(venda).map((v) => ({ nome: v.nome, valor: v.valor, aereo_incluso: v.aereo_incluso }));
  return { campos, origem, dealId: dealId || null, avisoBitrix, clienteId: cliente?.id || null, viajantes };
}

// ── FASE 3 (base): o contrato de UMA pessoa da venda ────────────────────────
/** Idade em anos completos na data de referência (dd/mm/aaaa ou ISO). null = não sei. */
export function idadeEm(nascimento, referencia) {
  const n = dataDe(dataBr(isoDe(nascimento) || nascimento));
  const r = dataDe(dataBr(isoDe(referencia) || referencia)) || dataDe(hojeBr());
  if (!n || !r) return null;
  let anos = r.getUTCFullYear() - n.getUTCFullYear();
  if (r.getUTCMonth() < n.getUTCMonth() || (r.getUTCMonth() === n.getUTCMonth() && r.getUTCDate() < n.getUTCDate())) anos -= 1;
  return anos;
}

/**
 * Os campos do contrato de UM viajante (decisão do Bruno, 09/11): no contrato
 * de cada um sai o VALOR DAQUELA PESSOA; menor de idade é assinado pelo pai/mãe
 * (contratante = responsável) e o menor aparece como VIAJANTE no quadro.
 *   base        = { campos, origem } de montarPrevia/camposDasFontes (a venda toda)
 *   viajante    = item de viajantesDaVenda + dados do cadastro (rg, endereco…)
 *   responsavel = a pessoa que assina pelo menor (mesmo formato)
 * Não liga em nada (ZapSign/banco): é a base da fase 3.
 */
export function montarPreviaDaPessoa(base, viajante, { responsavel = null, totalDaVenda = null, nViajantes = null, menor: menorForcado = false } = {}) {
  const campos = { ...(base?.campos || {}) };
  const origem = { ...(base?.origem || {}) };
  const avisos = [];
  const v = viajante || {};
  const idade = idadeEm(v.nascimento, campos.data_venda);
  // 0352: `menor: true` vem da venda (qs_venda_pessoas.menor = menor na data da VIAGEM).
  const menor = menorForcado === true || (idade != null && idade < 18);
  const quemAssina = menor ? responsavel : v;
  if (menor && !responsavel) avisos.push(`${v.nome || 'O viajante'} é menor de idade: falta o responsável (pai/mãe) que assina.`);
  if (idade == null && !menor) avisos.push(`Sem data de nascimento de ${v.nome || 'viajante'}: não dá pra saber se é menor.`);

  const fmt = {
    nome: (x) => String(x || '').replace(/\s+/g, ' ').trim(),
    cpf: (x) => (cpfValido(x) ? formatarCpf(x) : String(x || '').trim()),
    rg: (x) => String(x || '').trim(),
    nascimento: (x) => dataBr(isoDe(x) || x),
    endereco: (x) => String(x || '').trim(),
    email: (x) => String(x || '').trim().toLowerCase(),
    telefone: (x) => (x ? formatarTelefone(x) : ''),
  };
  // Os dados da pessoa vêm SÓ de quem assina (nada da base, que é o comprador).
  for (const k of DA_PESSOA) {
    const val = quemAssina ? fmt[k](quemAssina[k] ?? (k === 'endereco' ? enderecoDoCliente(quemAssina) : '')) : '';
    campos[k] = val;
    origem[k] = val ? (menor ? 'responsável pelo menor' : 'viajante') : '';
  }
  campos.viajante = menor
    ? [fmt.nome(v.nome), fmt.nascimento(v.nascimento) ? `nascido(a) em ${fmt.nascimento(v.nascimento)}` : '', cpfValido(v.cpf) ? `CPF ${formatarCpf(v.cpf)}` : '', 'menor de idade, representado(a) pelo(a) CONTRATANTE']
      .filter(Boolean).join(', ')
    : '';
  if (menor) origem.viajante = 'viajante menor de idade';

  if (v.valor != null && num(v.valor) > 0) {
    campos.valor_total = formatarValor(num(v.valor));
    origem.valor_total = 'valor do viajante';
    const total = num(totalDaVenda);
    if (total > 0 && Math.abs(total - num(v.valor)) >= 0.01 && campos.forma_pagamento) {
      campos.forma_pagamento = `${campos.forma_pagamento.replace(/\.$/, '')}. Condições da venda total de ${brl(total)}${nViajantes > 1 ? ` (${nViajantes} viajantes)` : ''}.`;
    }
  } else {
    avisos.push(`Sem valor contratado de ${v.nome || 'viajante'}: ficou o valor da venda toda.`);
  }
  if (v.aereo_incluso === true || v.aereo_incluso === false) {
    campos.passagem = v.aereo_incluso ? 'Inclusa' : 'Não inclusa';
    origem.passagem = 'viajante';
  }
  return { campos, origem, avisos, menor, idade };
}

// ── WRITE-BACK: o que o closer corrigiu no contrato volta pro cadastro ─────
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/**
 * O que gravar em rel_clientes (puro). Completa o que está VAZIO; sobrescreve
 * só o que o closer EDITOU de verdade: o valor enviado é diferente do que a
 * prévia sugeriu (ou a prévia trouxe do "último envio", que já era correção dele).
 * Sem `previa` = só completa vazios. `podeSobrescrever` = false quando a ficha
 * foi achada só por telefone/e-mail (pode não ser a mesma pessoa).
 */
export function correcoesDoCliente(cliente, c, previa = null, { podeSobrescrever = true, avisos = null } = {}) {
  if (!cliente?.id || !c) return {};
  const orig = previa?.campos || {};
  const origem = previa?.origem || {};
  const editou = (k, novo, norm) => Boolean(previa) && podeSobrescrever && (novo !== norm(orig[k]) || origem[k] === 'último envio');
  const patch = {};
  const decidir = (k, coluna, novo, atual, norm) => {
    if (!novo) return;
    if (!atual) { patch[coluna] = novo; return; }
    if (novo !== atual && editou(k, novo, norm)) patch[coluna] = novo;
  };
  const cpfN = (x) => soDigitos(x);
  if (cpfValido(c.cpf)) decidir('cpf', 'cpf', cpfN(c.cpf), cpfN(cliente.cpf), cpfN);
  const nascN = (x) => { const dd = dataDe(dataBr(isoDe(x) || x)); return dd ? dd.toISOString().slice(0, 10) : ''; };
  decidir('nascimento', 'nascimento', nascN(c.nascimento), nascN(cliente.nascimento), nascN);
  const mailN = (x) => { const s = String(x || '').trim().toLowerCase(); return EMAIL_OK.test(s) ? s : ''; };
  decidir('email', 'email', mailN(c.email), mailN(cliente.email), mailN);
  if ('rg' in cliente) {
    const rgN = (x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    decidir('rg', 'rg', rgN(c.rg), rgN(cliente.rg), rgN);
  }
  const endN = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  const endNovo = endN(c.endereco);
  const endAtual = endN(enderecoDoCliente(cliente));
  // Endereço ESTRUTURADO no cadastro (número/bairro/cidade/UF/CEP…) nunca é
  // trocado pelo texto livre do contrato — só avisa quando o closer mudou algo.
  // Cadastro vazio (ou só com a rua) → quebra conservadora (enderecoParaColunas).
  const querGravar = endNovo && (!endAtual || (endNovo !== endAtual && editou('endereco', endNovo, endN)));
  if (querGravar && temEnderecoEstruturado(cliente)) { if (Array.isArray(avisos)) avisos.push(AVISO_ENDERECO); }
  else if (querGravar) Object.assign(patch, enderecoParaColunas(endNovo));
  return patch;
}

/**
 * Grava no cadastro único (service role) o que o closer corrigiu — chamado no
 * envio e no "Gerar o PDF" do cartão. Nunca derruba o contrato: erro vira aviso.
 * CPF já usado por OUTRA ficha (índice único) → grava o resto e avisa.
 */
export async function gravarNoCadastro({ negocio, campos, previa = null, userId = null, clienteId = null }) {
  try {
    let cliente = null;
    let por = null;
    if (clienteId && UUID.test(String(clienteId))) {
      // 0352: contrato por pessoa — a ficha de QUEM ASSINA (o próprio ou o responsável), pelo vínculo da venda.
      cliente = (await lerClientes(`id=eq.${clienteId}&limit=1`).catch(() => []))?.[0] || null;
      por = cliente ? 'vinculo' : null;
    } else {
      const lead = (await rest(`qs_leads?select=email,phone,cliente_id&id=eq.${negocio.lead_id}&limit=1`).catch(() => null))?.[0] || {};
      const venda = (await rest(`qs_vendas?select=cliente_id&negocio_id=eq.${negocio.id}&limit=1`).catch(() => null))?.[0] || null;
      ({ cliente, por } = await acharCliente(negocio, lead, venda));
    }
    if (!cliente) return { clienteId: null, gravados: [], aviso: 'Não achei a ficha do cliente no cadastro — nada foi gravado.' };
    const avisos = [];
    let patch = correcoesDoCliente(cliente, campos, previa, { podeSobrescrever: por === 'vinculo', avisos });
    if (!Object.keys(patch).length) return { clienteId: cliente.id, gravados: [], aviso: avisos.join(' ') || null };
    const gravar = (p) => rest(`rel_clientes?id=eq.${cliente.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...p, ...(userId ? { atualizado_por: userId } : {}) } });
    let aviso = avisos.join(' ') || null;
    try {
      await gravar(patch);
    } catch (e) {
      const msg = String(e?.message || '');
      if (patch.cpf && (e?.status === 409 || /rel_clientes_cpf_uq|duplicate/i.test(msg))) {
        const { cpf, ...resto } = patch;
        aviso = [aviso, `O CPF ${formatarCpf(cpf)} já está em outra ficha do cadastro — não gravei o CPF (vale juntar as fichas no Relacionamento).`].filter(Boolean).join(' ');
        patch = resto;
        if (Object.keys(patch).length) await gravar(patch);
      } else if (patch.rg && /\brg\b/.test(msg)) {
        const { rg, ...resto } = patch;
        patch = resto;
        if (Object.keys(patch).length) await gravar(patch);
      } else throw e;
    }
    return { clienteId: cliente.id, gravados: Object.keys(patch).map((k) => (k.startsWith('endereco_') ? 'endereco' : k)).filter((k, i, a) => a.indexOf(k) === i), aviso };
  } catch (e) {
    console.warn('[contrato] cadastro não atualizado', negocio?.id, e?.message);
    return { clienteId: null, gravados: [], aviso: `Não consegui atualizar o cadastro do cliente (${String(e?.message || 'erro').slice(0, 120)}).` };
  }
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
  for (const k of ['nome', 'rg', 'viajante', 'expedicao', 'tipo_pacote']) c[k] = c[k].replace(/\s+/g, ' ');
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
  if (c.tipo === 'expedicao' && !c.roteiro) avisos.push('Sem roteiro: o contrato sai sem o Anexo I (a cláusula 1.1 cita só o roteiro apresentado).');
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
