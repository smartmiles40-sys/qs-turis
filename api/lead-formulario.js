// api/lead-formulario.js
// -----------------------------------------------------------------------------
// AS RESPOSTAS QUE O CLIENTE DEU NO FORMULÁRIO DA LP.
//
// O buraco (Bruno, 14/09): "nossos SDRs ficam ligando e mandando mensagem
// direto, e não veem o que as pessoas cadastram nas respostas que temos como
// padrão". O lead responde 5 perguntas na landing page — quando pretende
// decidir, se a faixa de investimento faz sentido, com quem viaja — e nada
// disso chegava ao QS: o `/api/lead-inbound` recebe do n8n só nome, telefone,
// e-mail, fonte e o id do negócio. As respostas ficavam SÓ no card do Bitrix,
// numa aba que ninguém abre com o cliente no telefone.
//
// Por que ler do Bitrix em vez de pedir pro n8n mandar: o dado JÁ ESTÁ lá, em
// campos `UF_CRM_*` do negócio, inclusive nos leads antigos. Mudar o workflow
// resolveria só os próximos, e dependia de um passo manual fora deste repo.
// Aqui um GET traz tudo, e o histórico inteiro ganha as respostas de uma vez.
//
//   GET /api/lead-formulario?lead_id=<uuid>[&fresh=1]
//   Authorization: Bearer <jwt do usuário logado>
//   → { answers: [{ campo, rotulo, valor }], atualizado_em, motivo? }
//
// A permissão é a MESMA do resto (assertCanAccessLead): quem não pode abrir o
// lead não lê as respostas dele. O token do Bitrix nunca sai do servidor — é
// por isso que isto é uma rota, e não um fetch do navegador.
//
// CACHE em `qs_lead_form_answers`: respostas de formulário não mudam depois de
// enviadas. Sem cache, cada card aberto na fila seria uma chamada ao Bitrix, e
// o portal tem limite; com cache, o painel do SDR responde do banco e o Bitrix
// é consultado uma vez por lead. `&fresh=1` força reler.
//
// Env: BITRIX_WEBHOOK_BASE (já usada pelo bitrix-sync), SUPABASE_*.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';

/**
 * OS CAMPOS QUE SÃO RESPOSTA DO CLIENTE — e só eles.
 *
 * O negócio tem 242 campos personalizados, e quase todos são processo interno:
 * "MQL (Preencha com sim)", "Setores", "DATA DO MQL", "Reunião realizada?".
 * Jogar tudo na tela do SDR seria trocar "não vê nada" por "não acha nada".
 * Medido em 14/09 nos 20 leads mais recentes: estas são as perguntas que a
 * landing page faz, mais o Instagram (que o time pede pra abrir antes de ligar).
 *
 * O rótulo NÃO está escrito aqui de propósito: ele vem do próprio portal
 * (`crm.deal.fields` → `listLabel`), então mudar o texto da pergunta no Bitrix
 * muda o que o SDR lê, sem deploy. O que está escrito é o id do campo.
 *
 * LP nova com pergunta nova: acrescentar o `UF_CRM_*` em
 * `qs_settings.bitrix_campos_formulario` (array de strings) — a chave, quando
 * existe, SUBSTITUI esta lista, e a ordem dela é a ordem da tela.
 */
const CAMPOS_PADRAO = [
  'UF_CRM_1773087861990', // "Essa data faz sentido para você?"
  'UF_CRM_1773088121860', // "A faixa de investimento faz sentido para você?"
  'UF_CRM_1773088140847', // "Em quanto tempo você imagina tomar uma decisão sobre essa viagem?"
  'UF_CRM_1773096435043', // "Como você pretende viajar?"
  'UF_CRM_1773096503878', // "Como você se define como viajante?"
  'UF_CRM_1771877600411', // "Id do Instagram do cliente"
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A querystring, com ou sem a Vercel.
 *
 * Em produção quem monta o `req.query` é a Vercel; no `vite dev` a ponte de
 * /api (vite.config.ts) entrega o `req` cru do Node, sem query nenhuma — e a
 * rota responderia 400 pra todo mundo em desenvolvimento.
 */
function param(req, nome) {
  if (req.query && req.query[nome] !== undefined) return String(req.query[nome]);
  try {
    return new URL(req.url, 'http://local').searchParams.get(nome) ?? '';
  } catch {
    return '';
  }
}

/** Quanto tempo o que está no banco vale sem perguntar de novo ao Bitrix. */
const VALIDADE_MS = 12 * 60 * 60 * 1000;

// ── Catálogo de campos do portal ────────────────────────────────────────────
// `crm.deal.fields` devolve os 290 campos com rótulo (`listLabel`) e, nas
// listas, as opções (`items`) — é o que traduz "939" para "Frio". São ~200KB de
// resposta: guardar em memória pelo tempo da instância evita repetir isso a
// cada card aberto. Catálogo vazio NÃO vira cache (é sintoma de webhook sem
// escopo de CRM, e gravar isso esconderia o problema até alguém redeployar).
let catalogoCache = { em: 0, campos: null };
const CATALOGO_VALIDADE_MS = 10 * 60 * 1000;

async function catalogo() {
  const agora = Date.now();
  if (catalogoCache.campos && agora - catalogoCache.em < CATALOGO_VALIDADE_MS) {
    return catalogoCache.campos;
  }
  const campos = await bx('crm.deal.fields', {}, 10_000);
  if (campos && typeof campos === 'object' && Object.keys(campos).length) {
    catalogoCache = { em: agora, campos };
  }
  return campos || {};
}

/** A lista de campos configurada, ou a de fábrica. */
async function camposEscolhidos() {
  try {
    const rows = await rest('qs_settings?select=value&key=eq.bitrix_campos_formulario&limit=1');
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    const lista = Array.isArray(v) ? v.filter((c) => typeof c === 'string' && c.trim()) : [];
    if (lista.length) return lista.map((c) => c.trim());
  } catch (e) {
    console.warn('[formulario] bitrix_campos_formulario:', e?.message);
  }
  return CAMPOS_PADRAO;
}

/** Vazio do Bitrix tem cinco formatos diferentes, e todos significam "não respondeu". */
function vazio(v) {
  return v === '' || v === null || v === undefined || v === false ||
    (Array.isArray(v) && v.length === 0);
}

/**
 * O valor cru do campo vira o texto que o cliente escolheu.
 *
 * Lista guarda o ID DA OPÇÃO, não o rótulo: sem esta tradução o SDR leria
 * "Lead: 941" em vez de "Morno". Campo múltiplo vem como array.
 */
function textoDoValor(valor, campo) {
  const itens = Array.isArray(campo?.items) ? campo.items : null;
  const traduz = (v) => {
    if (itens) {
      const achou = itens.find((i) => String(i.ID) === String(v));
      if (achou) return String(achou.VALUE);
    }
    return String(v);
  };
  if (Array.isArray(valor)) return valor.filter((v) => !vazio(v)).map(traduz).join(' · ');
  if (campo?.type === 'date' || campo?.type === 'datetime') {
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    }
  }
  return traduz(valor);
}

/** Monta as respostas do negócio, na ordem configurada. Exportada pra dar
 *  pra conferir um card pelo Node sem subir o app inteiro. */
export async function respostasDoNegocio(bitrixId) {
  const [campos, escolhidos] = await Promise.all([catalogo(), camposEscolhidos()]);
  const deal = await bx('crm.deal.get', { id: bitrixId }, 10_000);
  // Negócio apagado no Bitrix: o `crm.deal.get` devolve vazio SEM erro. Sem este
  // ramo, o lead ficaria com a resposta antiga pra sempre — melhor dizer que o
  // card sumiu do que mostrar dado que ninguém consegue mais conferir.
  if (!deal || typeof deal !== 'object' || !deal.ID) return null;

  const saida = [];
  for (const nome of escolhidos) {
    const valor = deal[nome];
    if (vazio(valor)) continue;
    const campo = campos[nome] || {};
    // `title` vem igual ao `UF_CRM_*` neste portal; o rótulo de gente mora no
    // listLabel. Sem rótulo nenhum, o campo é pulado: "UF_CRM_1773087861990:
    // Casal" não ajuda ninguém a conduzir uma ligação.
    const rotulo = typeof campo.listLabel === 'string' && campo.listLabel !== nome
      ? campo.listLabel.trim()
      : (typeof campo.formLabel === 'string' && campo.formLabel !== nome ? campo.formLabel.trim() : null);
    if (!rotulo) continue;
    const texto = textoDoValor(valor, campo).trim();
    if (!texto) continue;
    saida.push({ campo: nome, rotulo, valor: texto });
  }
  return saida;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const leadId = param(req, 'lead_id').trim();
  if (!UUID_RE.test(leadId)) return res.status(400).json({ error: 'lead_id inválido' });

  const userId = await getSupabaseUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Faça login novamente.' });

  const permissao = await assertCanAccessLead(userId, leadId);
  if (!permissao.ok) {
    return res.status(permissao.reason === 'lead-inexistente' ? 404 : 403).json({ error: permissao.reason });
  }

  // As duas juntas: isto roda com o SDR olhando o card, e uma consulta esperando
  // a outra é meio segundo que ele passa vendo o espaço vazio.
  const [cache, bitrixId] = await Promise.all([
    rest(`qs_lead_form_answers?select=bitrix_id,answers,fetched_at&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`)
      .then((rows) => (Array.isArray(rows) && rows[0]) || null)
      .catch((e) => { console.warn('[formulario] cache:', e?.message); return null; }),
    rest(`qs_leads?select=bitrix_id&id=eq.${encodeURIComponent(leadId)}&limit=1`)
      .then((rows) => (Array.isArray(rows) && rows[0] && rows[0].bitrix_id) || null)
      .catch((e) => { console.warn('[formulario] lead:', e?.message); return null; }),
  ]);

  // Sem card no Bitrix não há onde ler: lead cadastrado à mão, ou card que o
  // QS ainda não aprendeu. Devolve vazio com o motivo — a tela some, não quebra.
  if (!bitrixId) {
    return res.status(200).json({ answers: [], atualizado_em: null, motivo: 'sem_card' });
  }

  const fresco = param(req, 'fresh') === '1';
  const valido = cache &&
    String(cache.bitrix_id || '') === String(bitrixId) &&
    Date.now() - new Date(cache.fetched_at).getTime() < VALIDADE_MS;

  if (valido && !fresco) {
    return res.status(200).json({
      answers: Array.isArray(cache.answers) ? cache.answers : [],
      atualizado_em: cache.fetched_at,
      origem: 'cache',
    });
  }

  if (!bitrixConfigurado()) {
    // Sem BITRIX_WEBHOOK_BASE ainda dá pra servir o que já foi lido um dia.
    return res.status(200).json({
      answers: cache && Array.isArray(cache.answers) ? cache.answers : [],
      atualizado_em: cache?.fetched_at ?? null,
      motivo: 'bitrix_nao_configurado',
    });
  }

  let answers;
  try {
    answers = await respostasDoNegocio(bitrixId);
  } catch (e) {
    console.warn('[formulario] bitrix:', e?.message);
    // Bitrix fora do ar não pode apagar o que já está no banco: devolve o
    // cache velho (marcado) em vez de uma tela vazia que parece "não respondeu".
    return res.status(200).json({
      answers: cache && Array.isArray(cache.answers) ? cache.answers : [],
      atualizado_em: cache?.fetched_at ?? null,
      motivo: 'bitrix_indisponivel',
    });
  }

  if (answers === null) {
    return res.status(200).json({
      answers: cache && Array.isArray(cache.answers) ? cache.answers : [],
      atualizado_em: cache?.fetched_at ?? null,
      motivo: 'card_inexistente',
    });
  }

  const agora = new Date().toISOString();
  try {
    await rest('qs_lead_form_answers?on_conflict=lead_id', {
      method: 'POST',
      body: [{ lead_id: leadId, bitrix_id: String(bitrixId), answers, fetched_at: agora }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  } catch (e) {
    // Gravar é otimização, não o serviço: se o cache falhar, a resposta sai
    // igual e o próximo acesso pergunta ao Bitrix de novo.
    console.warn('[formulario] gravando cache:', e?.message);
  }

  return res.status(200).json({ answers, atualizado_em: agora, origem: 'bitrix' });
}
