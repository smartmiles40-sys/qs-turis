// api/rel-docs-ia.js
// -----------------------------------------------------------------------------
// CONFERÊNCIA DOS DOCUMENTOS POR IA (sprint de 13/10/2026, migration 0106).
//
// Pedido do Bruno: "conectar a API do ChatGPT pra ficar analisando os
// documentos, garantindo que todos batam com o que está no cadastro do cliente".
//
//   POST { documento_id }                         → confere UM documento (botão)
//   POST { acao:'pendentes', cliente_id?, viagem_id? } → confere os que faltam (botão)
//   GET  (Vercel Cron, Authorization: Bearer CRON_SECRET) → confere os que faltam
//
// Como funciona: baixa o arquivo do bucket PRIVADO (service role), manda pra
// OpenAI pedindo só os campos (JSON com esquema fixo) e a COMPARAÇÃO é feita
// AQUI, no servidor, contra a ficha (rel_clientes) e a validade do documento.
// A IA só lê; quem decide se bate somos nós — o resultado é previsível.
//
// O que vai pra ficha: NADA sozinho. Campo que a ficha não tem vira
// "sugestão" e o time clica em "Usar no cadastro" na tela.
//
// Privacidade: nunca loga o conteúdo do documento nem a chave. Só o id e o
// status. Sem OPENAI_API_KEY → 503 com recado claro (não quebra nada).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { quemChama } from './_relWa.js';

const BUCKET = 'rel-documentos';
const TIPOS_IA = ['passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro'];
const MIME_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 15 * 1024 * 1024;
const POR_RODADA = 8;          // documentos por chamada em lote
const EM_PARALELO = 3;
const ORCAMENTO_MS = 50_000;   // tudo tem que acabar antes do maxDuration (60s) da Vercel
const MIN_PRA_COMECAR_MS = 15_000; // com menos que isso sobrando, não começa outro documento
const MAX_TENTATIVAS = 3;      // erro passageiro (timeout, 5xx) volta pra fila até 3 vezes

/** Quanto tempo dá pra esperar uma etapa sem passar do prazo (com margem pra gravar). */
const restaAte = (prazo, padrao) => Math.max(1_000, Math.min(padrao, prazo - Date.now() - 3_000));
/** Erro que vale tentar de novo depois (rede, timeout, OpenAI/Storage fora do ar). */
const passageiro = (e) => e?.name === "TimeoutError" || e?.name === "AbortError" || e?.repetir === true
  || (typeof e?.status === "number" && e.status >= 500) || /fetch failed|network|ECONN|ETIMEDOUT/i.test(String(e?.message || ""));
/** "Hoje" no fuso do time (São Paulo), igual ao rel_hoje() do banco. */
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const ROTULO = { passaporte: 'passaporte', rg_cnh: 'RG ou CNH', visto: 'visto', vacina: 'certificado de vacina', seguro: 'seguro viagem' };

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ── Normalização / comparação ───────────────────────────────────────────────

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomeNorm = (s) => semAcento(s).toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const alnum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digitos = (s) => String(s || '').replace(/\D/g, '');
const dataOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

/** 'igual' | 'parcial' (um nome contém o outro, ex.: passaporte sem nome do meio) | 'diferente' */
function compararNomes(a, b) {
  const na = nomeNorm(a), nb = nomeNorm(b);
  if (!na || !nb) return null;
  if (na === nb) return 'igual';
  const ta = na.split(' ').filter((t) => !PARTICULAS.has(t));
  const tb = nb.split(' ').filter((t) => !PARTICULAS.has(t));
  if (ta.join(' ') === tb.join(' ')) return 'igual';
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const contidos = menor.filter((t) => maior.includes(t)).length;
  if (contidos === menor.length && menor[0] === maior[0]) return 'parcial';
  return contidos / Math.max(menor.length, 1) >= 0.5 ? 'parcial' : 'diferente';
}

const BR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

// ── OpenAI ──────────────────────────────────────────────────────────────────

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legivel', 'tipo_detectado', 'nome', 'numero_documento', 'cpf', 'nascimento', 'validade', 'nacionalidade', 'observacao'],
  properties: {
    legivel: { type: 'boolean', description: 'false se a imagem estiver cortada, borrada ou não for um documento' },
    tipo_detectado: { type: 'string', enum: ['passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro', 'outro'] },
    nome: { type: ['string', 'null'], description: 'nome completo do titular, como impresso' },
    numero_documento: { type: ['string', 'null'], description: 'nº do passaporte / RG / CNH / visto / apólice' },
    cpf: { type: ['string', 'null'], description: 'CPF se aparecer no documento' },
    nascimento: { type: ['string', 'null'], description: 'data de nascimento AAAA-MM-DD' },
    validade: { type: ['string', 'null'], description: 'data de validade/expiração AAAA-MM-DD' },
    nacionalidade: { type: ['string', 'null'] },
    observacao: { type: ['string', 'null'], description: 'algo estranho no documento, em português, curto' },
  },
};

const INSTRUCAO =
  'Você confere documentos de viagem para uma agência de turismo brasileira. ' +
  'Leia SOMENTE o que está impresso no documento (inclusive a zona MRZ do passaporte, se houver) e devolva os campos. ' +
  'Não invente: campo que não aparece ou não dá para ler fica null. Datas sempre no formato AAAA-MM-DD. ' +
  'Se não for um documento ou estiver ilegível, marque legivel=false.';

async function lerComIa({ base64, mime, nomeArquivo, tipoEsperado, prazo }) {
  const chave = process.env.OPENAI_API_KEY;
  const modelo = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const anexo = mime === 'application/pdf'
    ? { type: 'file', file: { filename: nomeArquivo || 'documento.pdf', file_data: `data:application/pdf;base64,${base64}` } }
    : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(restaAte(prazo, 40_000)),
    body: JSON.stringify({
      model: modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: INSTRUCAO },
        { role: 'user', content: [{ type: 'text', text: `Documento enviado como: ${ROTULO[tipoEsperado] || tipoEsperado}.` }, anexo] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'documento', strict: true, schema: ESQUEMA } },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    const e = new Error(r.status === 401 ? 'A chave da OpenAI foi recusada (revogada ou errada).' : `OpenAI: ${String(msg).slice(0, 160)}`);
    e.status = r.status;
    throw e;
  }
  const txt = j?.choices?.[0]?.message?.content;
  const lido = safeParse(txt || '');
  if (!lido || typeof lido.legivel !== 'boolean') throw new Error('A IA não devolveu os campos.');
  return lido;
}

// ── Comparação com a ficha ──────────────────────────────────────────────────

async function proximoEmbarque(clienteId) {
  const m = await rest(`rel_cliente_metricas?select=proximo_embarque&id=eq.${clienteId}&limit=1`).catch(() => null);
  return m?.[0]?.proximo_embarque || null;
}

function comparar({ doc, cli, lido, embarque }) {
  const divergencias = [];
  const alertas = [];
  const sugestoes = [];

  const campos_lidos = {
    tipo: lido.tipo_detectado, nome: lido.nome, numero: lido.numero_documento, cpf: lido.cpf,
    nascimento: dataOk(lido.nascimento), validade: dataOk(lido.validade), nacionalidade: lido.nacionalidade,
  };

  if (lido.tipo_detectado && lido.tipo_detectado !== 'outro' && lido.tipo_detectado !== doc.tipo) {
    divergencias.push({ campo: 'tipo', cadastro: ROTULO[doc.tipo] || doc.tipo, documento: ROTULO[lido.tipo_detectado] || lido.tipo_detectado });
  }

  // Nome
  if (lido.nome && cli.nome) {
    const c = compararNomes(cli.nome, lido.nome);
    if (c === 'diferente') divergencias.push({ campo: 'nome', cadastro: cli.nome, documento: lido.nome });
    else if (c === 'parcial') alertas.push(`Nome com diferença parcial: ficha "${cli.nome}" × documento "${lido.nome}". Confira (bilhete aéreo precisa do nome igual ao passaporte).`);
  }

  // CPF (RG/CNH costumam ter)
  const cpfDoc = digitos(lido.cpf);
  if (cpfDoc.length === 11) {
    if (cli.cpf && digitos(cli.cpf) !== cpfDoc) divergencias.push({ campo: 'cpf', cadastro: cli.cpf, documento: lido.cpf });
    else if (!cli.cpf) sugestoes.push({ alvo: 'cliente', campo: 'cpf', valor: cpfDoc, rotulo: 'CPF' });
  }

  // Nº do passaporte
  if (doc.tipo === 'passaporte' && lido.numero_documento) {
    const n = alnum(lido.numero_documento);
    if (cli.passaporte && alnum(cli.passaporte) !== n) divergencias.push({ campo: 'passaporte', cadastro: cli.passaporte, documento: lido.numero_documento });
    else if (!cli.passaporte) sugestoes.push({ alvo: 'cliente', campo: 'passaporte', valor: n, rotulo: 'Nº do passaporte' });
  }

  // Nascimento
  const nasc = dataOk(lido.nascimento);
  if (nasc) {
    if (cli.nascimento && cli.nascimento !== nasc) divergencias.push({ campo: 'nascimento', cadastro: BR(cli.nascimento), documento: BR(nasc) });
    else if (!cli.nascimento) sugestoes.push({ alvo: 'cliente', campo: 'nascimento', valor: nasc, rotulo: 'Nascimento' });
  }

  // Validade
  const val = dataOk(lido.validade);
  if (val) {
    if (doc.validade && doc.validade !== val) divergencias.push({ campo: 'validade', cadastro: BR(doc.validade), documento: BR(val) });
    else if (!doc.validade) sugestoes.push({ alvo: 'documento', campo: 'validade', valor: val, rotulo: 'Validade do documento' });

    if (doc.tipo === 'passaporte') {
      if (cli.passaporte_validade && cli.passaporte_validade !== val) {
        divergencias.push({ campo: 'passaporte_validade', cadastro: BR(cli.passaporte_validade), documento: BR(val) });
      } else if (!cli.passaporte_validade) {
        sugestoes.push({ alvo: 'cliente', campo: 'passaporte_validade', valor: val, rotulo: 'Validade do passaporte' });
      }
    }

    const hoje = hojeSP();
    if (val < hoje) alertas.push(`Documento VENCIDO em ${BR(val)}.`);
    if (doc.tipo === 'passaporte' && embarque) {
      const lim = new Date(`${embarque}T12:00:00Z`);
      lim.setUTCMonth(lim.getUTCMonth() + 6);
      if (val < lim.toISOString().slice(0, 10)) {
        alertas.push(`Passaporte vence em ${BR(val)}: menos de 6 meses depois do embarque (${BR(embarque)}). Muitos países barram.`);
      }
    }
  }

  if (lido.observacao) alertas.push(`IA: ${String(lido.observacao).slice(0, 200)}`);

  const status = !lido.legivel ? 'ilegivel' : divergencias.length ? 'divergente' : 'ok';
  const resumo = !lido.legivel
    ? 'Não deu para ler o documento. Peça uma foto nova, inteira e sem reflexo.'
    : divergencias.length
      ? `${divergencias.length} divergência${divergencias.length > 1 ? 's' : ''} com a ficha.`
      : `Bate com a ficha${alertas.length ? `, com ${alertas.length} alerta${alertas.length > 1 ? 's' : ''}` : ''}.`;

  return { status, resultado: { campos_lidos, divergencias, alertas, sugestoes, resumo } };
}

// ── Conferir um documento ───────────────────────────────────────────────────

async function gravar(id, status, resultado) {
  await rest(`rel_documentos?id=eq.${id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { ia_status: status, ia_resultado: resultado, ia_em: new Date().toISOString() },
  });
}

async function baixar(path, prazo) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const caminho = path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminho}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(restaAte(prazo, 20_000)),
  });
  if (!r.ok) {
    const e = new Error(r.status >= 500 ? `O armazenamento não respondeu (HTTP ${r.status}).` : `Arquivo não encontrado no armazenamento (HTTP ${r.status}).`);
    e.status = r.status;
    throw e;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, mime: String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function conferir(docId, prazo = Date.now() + ORCAMENTO_MS) {
  const doc = (await rest(
    `rel_documentos?select=id,cliente_id,tipo,arquivo_path,arquivo_nome,mime,tamanho,validade,status,ia_status,ia_resultado&id=eq.${docId}&limit=1`
  ))?.[0];
  if (!doc) return { id: docId, status: 'erro', erro: 'Documento não encontrado.' };

  // repetir=true: erro passageiro, o cron tenta de novo (até MAX_TENTATIVAS).
  const falha = async (motivo, repetir = false) => {
    const antes = doc.ia_status === 'erro' && doc.ia_resultado?.repetir ? Number(doc.ia_resultado.tentativas) || 1 : 0;
    const tentativas = antes + 1;
    const resultado = {
      campos_lidos: null, divergencias: [], alertas: [], sugestoes: [],
      resumo: repetir && tentativas < MAX_TENTATIVAS ? `${motivo} Vou tentar de novo sozinho.` : motivo,
      repetir, tentativas,
    };
    await gravar(doc.id, 'erro', resultado);
    return { id: doc.id, status: 'erro', resultado };
  };

  if (!TIPOS_IA.includes(doc.tipo)) return falha('Este tipo de arquivo não é conferido pela IA.');
  const cli = (await rest(
    `rel_clientes?select=id,nome,cpf,passaporte,passaporte_validade,nascimento&id=eq.${doc.cliente_id}&limit=1`
  ))?.[0];
  if (!cli) return falha('Cliente do documento não encontrado.');

  try {
    const { buf, mime: mimeStorage } = await baixar(doc.arquivo_path, prazo);
    const mime = (doc.mime || mimeStorage || '').toLowerCase().split(';')[0].trim();
    if (buf.length > MAX_BYTES) return falha('Arquivo grande demais para a IA (máx. 15 MB).');
    if (mime === 'image/heic' || mime === 'image/heif') return falha('Foto em HEIC (iPhone): a IA não lê esse formato. Peça em JPG ou PDF.');
    if (!MIME_IMAGEM.has(mime) && mime !== 'application/pdf') return falha(`Formato ${mime || 'desconhecido'} não suportado. Use JPG, PNG ou PDF.`);

    const lido = await lerComIa({ base64: buf.toString('base64'), mime, nomeArquivo: doc.arquivo_nome, tipoEsperado: doc.tipo, prazo });
    const embarque = await proximoEmbarque(cli.id);
    const { status, resultado } = comparar({ doc, cli, lido, embarque });
    await gravar(doc.id, status, resultado);
    console.log(`[rel-docs-ia] ${doc.id}: ${status}`);
    return { id: doc.id, status, resultado };
  } catch (e) {
    // chave errada/revogada: não marca o documento, sobe o erro inteiro
    if (e?.status === 401 || e?.status === 429) throw e;
    console.error(`[rel-docs-ia] ${doc.id}: erro`, e?.status || '', String(e?.message || '').slice(0, 120));
    const repetir = passageiro(e);
    const motivo = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'A leitura demorou demais.' : (e?.message || 'Falhou a conferência.');
    return falha(motivo, repetir);
  }
}

/**
 * Pendentes = tipo conferível, não recusado, e:
 *   - nunca conferido, OU
 *   - deu erro passageiro com menos de MAX_TENTATIVAS, OU
 *   - o arquivo chegou depois da última conferência.
 * Os dois primeiros filtram no banco (não pegam "300 quaisquer").
 */
async function pendentes({ clienteId, viagemId } = {}) {
  const base = `rel_documentos?select=id,enviado_em,ia_em,ia_status,repetir:ia_resultado->>repetir,tentativas:ia_resultado->>tentativas&tipo=in.(${TIPOS_IA.join(',')})&status=neq.recusado&copia_de=is.null`;
  let filtro = '';
  if (clienteId && /^[0-9a-f-]{36}$/i.test(clienteId)) filtro += `&cliente_id=eq.${clienteId}`;
  if (viagemId && /^[0-9a-f-]{36}$/i.test(viagemId)) filtro += `&viagem_id=eq.${viagemId}`;
  const [novos, recentes] = await Promise.all([
    rest(`${base}${filtro}&or=(ia_em.is.null,ia_status.eq.erro)&order=enviado_em.asc&limit=500`),
    rest(`${base}${filtro}&ia_em=not.is.null&order=enviado_em.desc&limit=200`),
  ]);
  const ids = new Set();
  for (const d of novos || []) {
    if (!d.ia_em) ids.add(d.id);
    else if (d.repetir === 'true' && (Number(d.tentativas) || 1) < MAX_TENTATIVAS) ids.add(d.id);
  }
  for (const d of recentes || []) if (new Date(d.enviado_em) > new Date(d.ia_em)) ids.add(d.id);
  return [...ids];
}

/**
 * Confere em lote com EM_PARALELO "trabalhadores". Antes de CADA documento
 * confere se ainda dá tempo (nunca passa do maxDuration). Um documento que
 * falha não derruba os outros; só chave recusada/limite da OpenAI para tudo.
 */
async function conferirLote(filtro) {
  const prazo = Date.now() + ORCAMENTO_MS;
  const ids = await pendentes(filtro);
  const fila = ids.slice(0, POR_RODADA);
  const feitos = [];
  let fatal = null;
  const trabalhador = async () => {
    while (fila.length && !fatal && prazo - Date.now() > MIN_PRA_COMECAR_MS) {
      const id = fila.shift();
      try {
        feitos.push(await conferir(id, prazo));
      } catch (e) {
        if (e?.status === 401 || e?.status === 429) { fatal = e; break; }
        console.error(`[rel-docs-ia] ${id}: não gravou`, String(e?.message || '').slice(0, 120));
        feitos.push({ id, status: 'erro' });
      }
    }
  };
  await Promise.allSettled(Array.from({ length: EM_PARALELO }, trabalhador));
  if (fatal && !feitos.length) throw fatal;
  const conta = (s) => feitos.filter((f) => f.status === s).length;
  return {
    conferidos: feitos.length,
    ok: conta('ok'), divergentes: conta('divergente'), ilegiveis: conta('ilegivel'), erros: conta('erro'),
    restam: ids.length - feitos.length,
    ...(fatal ? { aviso: fatal.status === 429 ? 'A OpenAI pediu pra esperar no meio do lote. O resto fica pra próxima rodada.' : fatal.message } : {}),
  };
}

// ── Rota ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const temChave = Boolean(String(process.env.OPENAI_API_KEY || '').trim());

  // Cron da Vercel
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    if (!temChave) return res.status(200).json({ pulado: 'Falta a chave da OpenAI na Vercel' });
    try {
      const r = await conferirLote({});
      console.log(`[rel-docs-ia] cron: ${JSON.stringify(r)}`);
      return res.status(200).json(r);
    } catch (e) {
      console.error('[rel-docs-ia] cron falhou:', String(e?.message || '').slice(0, 160));
      return res.status(500).json({ error: e?.message || 'Falhou' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  if (!temChave) return res.status(503).json({ error: 'Falta a chave da OpenAI na Vercel (OPENAI_API_KEY).' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  try {
    if (body.acao === 'pendentes') {
      return res.status(200).json(await conferirLote({ clienteId: body.cliente_id, viagemId: body.viagem_id }));
    }
    const id = String(body.documento_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Documento inválido.' });
    return res.status(200).json(await conferir(id));
  } catch (e) {
    const status = e?.status === 401 ? 503 : e?.status === 429 ? 429 : 500;
    return res.status(status).json({
      error: e?.status === 429 ? 'A OpenAI pediu pra esperar (limite ou crédito). Tente em alguns minutos.' : (e?.message || 'Falhou a conferência.'),
    });
  }
}
