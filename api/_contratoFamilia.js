// api/_contratoFamilia.js
// -----------------------------------------------------------------------------
// CONTRATO POR PESSOA (Fase 3 da família, 0352 — Bruno 09/11/2026)
//   "Na hora de subir o contrato, escolher quem vai junto e enviar UM CONTRATO
//    PARA CADA PESSOA; o contrato de cada um mostra o valor daquela pessoa;
//    menor de idade: pai/mãe (responsável) assina pelo filho."
//
// Regras PURAS (sem rede), testadas em tests/contrato/contratoFamilia.test.ts:
//   • quemAssina      — o próprio; menor = o responsável (padrão: o comprador)
//   • valorDaPessoa   — o da pessoa; o comprador = total − filhos (= card PAI
//                       no Bitrix, valorDoPai) ou o total se ninguém tem valor
//   • bloqueiosDaPessoa — o que impede o contrato DAQUELA pessoa (as outras seguem)
//   • planoDaFamilia  — uma linha por pessoa ativa: valor, quem assina,
//                       bloqueios, o contrato atual/ativo (o "do cartão" antigo
//                       conta como o do comprador, igual ao banco)
//   • resumoDosContratos — "2/4 assinados" + o status do CARTÃO (mesma regra
//                       de contrato_resumo_cartao na 0352)
//   • decidirEnvio    — idempotência por pessoa
// A execução (ZapSign, Storage, banco) fica em api/closer.js.
// -----------------------------------------------------------------------------

import { cpfValido, idadeEm, enderecoDoCliente } from './_contrato.js';
import { valorDoPai } from './_closerBitrixFamilia.js';

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;
const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || '';

/** Status em que o contrato "está valendo" pra pessoa (não gera outro por cima). */
export const ATIVOS = ['gerando', 'enviado', 'visualizado', 'assinado'];
/** O que entra no resumo (já saiu pro cliente). */
const SAIU = ['enviado', 'visualizado', 'assinado', 'recusado', 'cancelado'];

export const ativasDaVenda = (pessoas) => (pessoas || []).filter((p) => !p.removida_em);

/** A pessoa é menor? A 0351 conta na data da viagem; no contrato vale também a idade HOJE (quem assina é hoje). */
export function ehMenor(pessoa, ficha, hoje) {
  if (pessoa?.menor === true) return true;
  const idade = idadeEm(ficha?.nascimento, hoje);
  return idade != null && idade < 18;
}

/**
 * Quem assina o contrato da pessoa.
 * → { clienteId, ficha, proprio, falta? } — `falta` = não tem quem assinar.
 */
export function quemAssina(pessoa, { fichas, comprador, hoje } = {}) {
  const ficha = fichas?.get?.(pessoa.cliente_id) || null;
  if (!ehMenor(pessoa, ficha, hoje)) return { clienteId: pessoa.cliente_id, ficha, proprio: true, menor: false };
  const respId = pessoa.responsavel_cliente_id || (!pessoa.comprador && comprador ? comprador.cliente_id : null);
  if (!respId || respId === pessoa.cliente_id) return { clienteId: null, ficha: null, proprio: false, menor: true, falta: 'responsavel' };
  const fr = fichas?.get?.(respId) || null;
  return { clienteId: respId, ficha: fr, proprio: false, menor: true, falta: fr ? null : 'ficha_responsavel' };
}

/** Valor que sai no contrato da pessoa (null = não separado). */
export function valorDaPessoa(pessoa, { pessoas, valorTotal }) {
  if (pessoa.comprador) {
    const pai = valorDoPai(valorTotal, pessoas);
    if (pai != null) return pai;
    const proprio = num(pessoa.valor);
    return proprio > 0 ? centavos(proprio) : num(valorTotal) > 0 ? centavos(valorTotal) : null;
  }
  const v = num(pessoa.valor);
  return v > 0 ? centavos(v) : null;
}

/** O que impede o contrato DESTA pessoa (lista vazia = pode ir). */
export function bloqueiosDaPessoa(pessoa, { ficha, assina, valor }) {
  const b = [];
  const nome = primeiroNome(ficha?.nome) || 'A pessoa';
  if (!ficha) b.push('Não achei a ficha desta pessoa no cadastro.');
  else if (!pessoa.comprador && !ficha.nascimento && !assina?.menor) b.push(`Sem data de nascimento de ${nome}: não dá pra saber se é menor de idade (complete a ficha).`);
  if (assina?.falta === 'responsavel') b.push(`${nome} é menor de idade e não tem responsável (pai/mãe) pra assinar — defina em "Editar quem vai".`);
  else if (assina?.falta === 'ficha_responsavel') b.push(`Não achei a ficha do responsável de ${nome}.`);
  else if (assina?.ficha) {
    const f = assina.ficha;
    const quem = assina.proprio ? nome : `O responsável (${primeiroNome(f.nome) || 'pai/mãe'})`;
    if (!String(f.nome || '').trim()) b.push(`${quem} está sem nome no cadastro.`);
    if (!cpfValido(f.cpf)) b.push(`${quem} está sem CPF válido no cadastro.`);
    if (!EMAIL_OK.test(String(f.email || '').trim())) b.push(`${quem} está sem e-mail no cadastro (o ZapSign manda o contrato por e-mail).`);
    if (soDigitos(f.telefone).length < 10) b.push(`${quem} está sem telefone com DDD no cadastro.`);
  }
  if (!(valor > 0)) b.push(`Sem valor de ${nome} na venda — separe o valor desta pessoa em "Editar quem vai".`);
  return b;
}

const chaveDoContrato = (k, compradorVpId) => k.venda_pessoa_id || compradorVpId || null;

/**
 * Uma linha por pessoa ativa da venda.
 *   pessoas   = qs_venda_pessoas (id, cliente_id, comprador, vinculo, menor, responsavel_cliente_id, valor, aereo_incluso, removida_em, bitrix_deal_id)
 *   fichas    = Map(cliente_id → rel_clientes)
 *   contratos = qs_contratos do cartão, MAIS RECENTE PRIMEIRO (venda_pessoa_id nulo = do cartão → comprador)
 */
export function planoDaFamilia({ pessoas, fichas, contratos = [], valorTotal, hoje }) {
  const ativas = ativasDaVenda(pessoas);
  const comprador = ativas.find((p) => p.comprador) || null;
  const linhas = ativas.map((p) => {
    const ficha = fichas?.get?.(p.cliente_id) || null;
    const assina = quemAssina(p, { fichas, comprador, hoje });
    const valor = valorDaPessoa(p, { pessoas, valorTotal });
    const meus = contratos.filter((k) => chaveDoContrato(k, comprador?.id) === p.id);
    const ativo = meus.find((k) => ATIVOS.includes(k.status)) || null;
    // O que a tela mostra: o vivo; sem vivo, o último (erro/cancelado/recusado).
    const atual = ativo || meus.find((k) => k.status === 'recusado') || meus[0] || null;
    return {
      venda_pessoa_id: p.id,
      cliente_id: p.cliente_id,
      nome: ficha?.nome || null,
      comprador: Boolean(p.comprador),
      vinculo: p.vinculo || null,
      menor: assina.menor,
      idade: idadeEm(ficha?.nascimento, hoje),
      valor,
      aereo_incluso: p.aereo_incluso ?? null,
      bitrix_deal_id: p.bitrix_deal_id || null,
      assina: {
        cliente_id: assina.clienteId,
        proprio: assina.proprio,
        nome: assina.ficha?.nome || null,
        email: assina.ficha?.email || null,
        telefone: assina.ficha?.telefone || null,
      },
      bloqueios: bloqueiosDaPessoa(p, { ficha, assina, valor }),
      atual: atual ? resumoDoContrato(atual) : null,
      ativo: ativo ? resumoDoContrato(ativo) : null,
      // pra montar o contrato (servidor): não vai pra tela
      _ficha: ficha, _assina: assina.ficha,
    };
  });
  // O comprador primeiro (é quem fecha).
  linhas.sort((a, b) => Number(b.comprador) - Number(a.comprador));
  return linhas;
}

const resumoDoContrato = (k) => ({
  id: k.id, status: k.status, modo: k.modo || null, link_assinatura: k.link_assinatura || null, erro: k.erro || null,
  zapsign_token: k.zapsign_token || null, drive_pdf_url: k.drive_pdf_url || null, pdf_assinado_url: k.pdf_assinado_url || null,
  criado_em: k.criado_em || null, enviado_em: k.enviado_em || null, assinado_em: k.assinado_em || null,
});

/** Linha sem os campos internos (o que vai pra tela). */
export const linhaParaTela = ({ _ficha, _assina, ...resto }) => resto;

/**
 * "2/4 assinados" e o status do CARTÃO (mesma regra da 0352).
 * `statuses` = o status do contrato que vale de cada pessoa (null/undefined = sem contrato).
 * → { total, assinados, pendentes, recusados, texto, statusCartao }
 *   total = pessoas cujo contrato já saiu (enviado/visto/assinado/recusado).
 *   statusCartao null = nada saiu ainda (o cartão não muda).
 */
export function resumoDosContratos(statuses) {
  const s = (statuses || []).filter(Boolean);
  const pend = s.filter((x) => x === 'enviado' || x === 'visualizado');
  const viu = s.filter((x) => x === 'visualizado').length;
  const rec = s.filter((x) => x === 'recusado').length;
  const ass = s.filter((x) => x === 'assinado').length;
  const fech = s.filter((x) => x === 'cancelado').length;
  const total = pend.length + rec + ass;
  let statusCartao = null;
  if (pend.length + rec + ass + fech > 0) {
    statusCartao = pend.length ? (viu === pend.length ? 'visualizado' : 'enviado') : rec ? 'recusado' : ass ? 'assinado' : 'cancelado';
  }
  return {
    total, assinados: ass, pendentes: pend.length, recusados: rec, statusCartao,
    texto: total ? `contratos ${ass}/${total} assinado${total === 1 ? '' : 's'}` : '',
  };
}

/** O status que conta de cada linha do plano (o mesmo que _contratos_por_pessoa escolhe). */
export const statusDasLinhas = (linhas) => (linhas || []).map((l) => (l.atual && SAIU.includes(l.atual.status) ? l.atual.status : null));

/**
 * Idempotência por pessoa: o que fazer com o pedido de contrato.
 *   'enviar' | 'substituir' | 'pular-assinado' | 'pular-ativo' | 'pular-gerando'
 */
export function decidirEnvio(ativo, { substituir = false } = {}) {
  if (!ativo) return 'enviar';
  if (ativo.status === 'assinado') return 'pular-assinado';
  if (ativo.status === 'gerando') return 'pular-gerando';
  return substituir ? 'substituir' : 'pular-ativo';
}

/** O "viajante" que montarPreviaDaPessoa recebe, a partir da ficha + linha. */
export function viajanteDaLinha(l) {
  const f = l._ficha || {};
  return {
    nome: f.nome || l.nome || '', cpf: f.cpf || '', rg: f.rg || '', nascimento: f.nascimento || '',
    endereco: enderecoDoCliente(f), email: f.email || '', telefone: f.telefone || '',
    valor: l.valor, aereo_incluso: l.aereo_incluso,
  };
}
export function responsavelDaLinha(l) {
  if (!l.menor || !l._assina) return null;
  const f = l._assina;
  return { nome: f.nome || '', cpf: f.cpf || '', rg: f.rg || '', nascimento: f.nascimento || '', endereco: enderecoDoCliente(f), email: f.email || '', telefone: f.telefone || '' };
}
