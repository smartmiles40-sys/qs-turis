// api/rel-viagem-ia.js
// -----------------------------------------------------------------------------
// REVISÃO DA VIAGEM PELA IA (0115, 13/10/2026).
//
// Bruno: "a própria IA faz uma revisão dos aéreos, seguro viagem etc. e cruza
// os dados pra ver se é tudo a MESMA viagem; e identifica o que é voo interno,
// transfer etc., cruzando tudo pra trazer uma informação mais precisa".
//
//   POST { viagem_id }      → revisa UMA viagem (botão na tela da viagem)
//   GET  ?lote=1            → (Vercel Cron, Bearer CRON_SECRET) revisa as viagens
//                             que embarcam nos próximos 90 dias e ganharam
//                             documento novo desde a última revisão
//
// Como funciona:
//   1. Junta da viagem os documentos de viagem (bilhete, seguro, voucher,
//      contrato, comprovante, outro — passaporte/RG/foto ficam com a
//      conferência de identidade do rel-docs-ia) + o texto dos campos do
//      Bitrix (venda e cards ligados, ex.: Pós-Venda) que falam de voo/hotel.
//   2. A IA LÊ cada um (JSON de esquema fixo): tipo, passageiros, localizador,
//      segmentos (voo/transfer/trem/hotel/passeio, com cidade, código IATA,
//      país, data/hora local e fuso), seguro (vigência, segurados).
//      Leitura de documento que não mudou é reaproveitada (não paga de novo).
//   3. O SERVIDOR cruza (a IA não decide nada sozinha):
//      • voo interno × internacional pelo PAÍS de origem/destino;
//      • passageiros do documento × passageiros da viagem (nomes sem acento);
//      • datas dentro da janela embarque−2d … retorno+2d;
//      • o destino da viagem aparece em algum trecho;
//      • seguro cobre do embarque ao retorno e todos os passageiros;
//      • documento que parece de OUTRA viagem (outra data/passageiro) → alerta.
//   4. Os segmentos viram TRECHOS (fonte 'ia'), sem duplicar o que já existe de
//      outra fonte: mesmo nº de voo no mesmo dia, ou mesma rota ±2h → só
//      completa campo vazio do trecho existente. Trecho manual/expedições nunca
//      é apagado.
//
// Fuso: grava a hora com o fuso do local de partida quando a IA informa;
// sem fuso, grava como horário de Brasília (-03:00) e avisa no resultado.
// Sem OPENAI_API_KEY → 503 com recado claro.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { quemChama } from './_relWa.js';

const BUCKET = 'rel-documentos';
// Comprovante de pagamento não tem voo nem hotel (2 mil arquivos do Bitrix) — fica fora.
const TIPOS_DOC = ['bilhete', 'seguro', 'voucher', 'contrato', 'outro'];
// Prints que o time sobe no card (checagem da IA, confirmação do cliente, Sherpa, resumo do WhatsApp)
// não são documento de viagem: a IA não perde tempo com eles.
const SEM_PRINTS = 'or=(descricao.is.null,and(descricao.not.ilike.*print*,descricao.not.ilike.*checagem*,descricao.not.ilike.*confirma*,descricao.not.ilike.*comprovante*))';
const MIME_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_DOCS = 12;             // documentos lidos por viagem
const EM_PARALELO = 4;
const ORCAMENTO_MS = 50_000;     // maxDuration 60s
const MIN_PRA_COMECAR_MS = 14_000;
const VIAGENS_POR_LOTE = 3;

const restaAte = (prazo, padrao) => Math.max(1_000, Math.min(padrao, prazo - Date.now() - 3_000));
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const BR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ── Normalização ────────────────────────────────────────────────────────────

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomeNorm = (s) => semAcento(s).toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const lugarNorm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const alnum = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

/** Os dois nomes são a mesma pessoa? (passagem costuma vir SOBRENOME/NOME, sem nome do meio) */
function mesmaPessoa(a, b) {
  const ta = nomeNorm(a).split(' ').filter((t) => t && !PARTICULAS.has(t));
  const tb = nomeNorm(b).split(' ').filter((t) => t && !PARTICULAS.has(t));
  if (!ta.length || !tb.length) return false;
  const comuns = ta.filter((t) => tb.includes(t)).length;
  const menor = Math.min(ta.length, tb.length);
  // primeiro nome + algum sobrenome, ou todos os tokens do nome menor
  return comuns >= Math.min(2, menor) && (ta.includes(tb[0]) || tb.includes(ta[0]) || comuns === menor);
}

/** País → chave comparável ("Brasil", "BR", "Brazil" → "br"). */
const PAISES = {
  brasil: 'br', brazil: 'br', br: 'br', peru: 'pe', pe: 'pe', chile: 'cl', cl: 'cl', argentina: 'ar', ar: 'ar',
  egito: 'eg', egypt: 'eg', eg: 'eg', 'emirados arabes unidos': 'ae', 'emirados arabes': 'ae', uae: 'ae', ae: 'ae',
  japao: 'jp', japan: 'jp', jp: 'jp', china: 'cn', cn: 'cn', tailandia: 'th', thailand: 'th', th: 'th',
  islandia: 'is', iceland: 'is', is: 'is', turquia: 'tr', turkiye: 'tr', turkey: 'tr', tr: 'tr', grecia: 'gr', greece: 'gr', gr: 'gr',
  italia: 'it', italy: 'it', it: 'it', espanha: 'es', spain: 'es', es: 'es', portugal: 'pt', pt: 'pt', franca: 'fr', france: 'fr', fr: 'fr',
  'estados unidos': 'us', eua: 'us', usa: 'us', us: 'us', catar: 'qa', qatar: 'qa', qa: 'qa', colombia: 'co', co: 'co',
  'coreia do sul': 'kr', 'south korea': 'kr', kr: 'kr', quenia: 'ke', kenya: 'ke', ke: 'ke', noruega: 'no', norway: 'no', no: 'no',
  suica: 'ch', switzerland: 'ch', ch: 'ch', 'reino unido': 'gb', inglaterra: 'gb', uk: 'gb', gb: 'gb', indonesia: 'id', id: 'id',
  panama: 'pa', pa: 'pa', mexico: 'mx', mx: 'mx', alemanha: 'de', germany: 'de', de: 'de', holanda: 'nl', netherlands: 'nl', nl: 'nl',
};
const paisChave = (p) => { const k = lugarNorm(p); return k ? (PAISES[k] || k) : null; };

// ── OpenAI ──────────────────────────────────────────────────────────────────

const STR = { type: ['string', 'null'] };
const SEGMENTO = {
  type: 'object', additionalProperties: false,
  required: ['categoria', 'origem', 'origem_codigo', 'origem_pais', 'destino', 'destino_codigo', 'destino_pais',
    'partida_local', 'partida_fuso', 'chegada_local', 'chegada_fuso', 'companhia', 'numero', 'classe', 'bagagem', 'nome_local',
    'terminal_partida', 'terminal_chegada', 'assento', 'numero_bilhete', 'passageiros', 'ponto_encontro', 'contato', 'endereco', 'observacao'],
  properties: {
    categoria: { type: 'string', enum: ['voo_internacional', 'voo_interno', 'transfer', 'trem', 'hospedagem', 'passeio'] },
    origem: { ...STR, description: 'cidade de origem (hotel: cidade do hotel)' },
    origem_codigo: { ...STR, description: 'código IATA do aeroporto de origem, se houver' },
    origem_pais: { ...STR, description: 'país da origem, em português' },
    destino: STR, destino_codigo: STR, destino_pais: STR,
    partida_local: { ...STR, description: 'data e hora LOCAIS de partida (hotel: check-in) AAAA-MM-DDTHH:MM' },
    partida_fuso: { ...STR, description: 'fuso do local de partida, ex.: +09:00, -03:00; null se não souber' },
    chegada_local: { ...STR, description: 'data e hora LOCAIS de chegada (hotel: check-out) AAAA-MM-DDTHH:MM' },
    chegada_fuso: STR,
    companhia: { ...STR, description: 'cia aérea / empresa de trem ou transfer' },
    numero: { ...STR, description: 'nº do voo ou trem, ex.: LA8084' },
    classe: STR, bagagem: STR,
    nome_local: { ...STR, description: 'nome do hotel, do passeio ou do ponto do transfer' },
    terminal_partida: { ...STR, description: 'terminal/portão de embarque, se impresso' },
    terminal_chegada: STR,
    assento: STR,
    numero_bilhete: { ...STR, description: 'nº do e-ticket / bilhete (ex.: 957-2412345678)' },
    passageiros: { type: 'array', items: { type: 'string' }, description: 'passageiros DESTE trecho, se o documento separa' },
    ponto_encontro: { ...STR, description: 'transfer/passeio: onde o motorista/guia encontra (ex.: saguão do hotel, portão B)' },
    contato: { ...STR, description: 'telefone/WhatsApp do motorista, fornecedor, hotel ou guia' },
    endereco: { ...STR, description: 'endereço do hotel ou do passeio' },
    observacao: { ...STR, description: 'outra informação útil deste trecho, curta (ex.: café incluso, 15 min de tolerância)' },
  },
};
const ESQUEMA = {
  type: 'object', additionalProperties: false,
  required: ['legivel', 'tipo_detectado', 'passageiros', 'localizador', 'segmentos', 'seguro', 'observacao'],
  properties: {
    legivel: { type: 'boolean' },
    tipo_detectado: { type: 'string', enum: ['bilhete_aereo', 'seguro', 'voucher_hotel', 'voucher_transfer', 'voucher_passeio', 'trem', 'roteiro', 'outro'] },
    passageiros: { type: 'array', items: { type: 'string' }, description: 'nomes dos passageiros/segurados como impressos' },
    localizador: { ...STR, description: 'código da reserva / PNR / localizador' },
    segmentos: { type: 'array', items: SEGMENTO },
    seguro: {
      anyOf: [{ type: 'null' }, {
        type: 'object', additionalProperties: false,
        required: ['seguradora', 'apolice', 'vigencia_inicio', 'vigencia_fim', 'segurados', 'cobertura'],
        properties: {
          seguradora: STR, apolice: STR,
          vigencia_inicio: { ...STR, description: 'AAAA-MM-DD' }, vigencia_fim: { ...STR, description: 'AAAA-MM-DD' },
          segurados: { type: 'array', items: { type: 'string' } },
          cobertura: { ...STR, description: 'valor/plano de cobertura médica, curto' },
        },
      }],
    },
    observacao: { ...STR, description: 'algo estranho, em português, curto' },
  },
};

const INSTRUCAO =
  'Você revisa documentos de viagem de uma agência de turismo brasileira (passagens aéreas, e-tickets, ' +
  'apólices de seguro viagem, vouchers de hotel, transfer, passeio e trem). Leia SOMENTE o que está impresso ' +
  'e devolva os campos do esquema. Não invente: o que não aparece fica null. ' +
  'Cada voo/trecho é UM segmento (ida com conexão = vários segmentos). Use voo_interno quando origem e destino ' +
  'são do MESMO país e voo_internacional quando são de países diferentes. Transfer = deslocamento terrestre ' +
  '(aeroporto↔hotel, cidade↔cidade de carro/van/ônibus). Hotel = segmento hospedagem (partida=check-in, ' +
  'chegada=check-out). Datas e horas no horário LOCAL do lugar, formato AAAA-MM-DDTHH:MM, com o fuso se souber. ' +
  'Transfer e passeio: partida_local = HORA DA BUSCA/encontro. Copie tudo que estiver impresso: terminal, assento, ' +
  'nº do e-ticket, bagagem, classe, ponto de encontro, telefone de contato, endereço do hotel. ' +
  'Se não for um documento de viagem ou estiver ilegível, legivel=false.';

async function chamarIa(conteudo, prazo) {
  const chave = process.env.OPENAI_API_KEY;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(restaAte(prazo, 40_000)),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [{ role: 'system', content: INSTRUCAO }, { role: 'user', content: conteudo }],
      response_format: { type: 'json_schema', json_schema: { name: 'documento_viagem', strict: true, schema: ESQUEMA } },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(r.status === 401 ? 'A chave da OpenAI foi recusada (revogada ou errada).' : `OpenAI: ${String(j?.error?.message || `HTTP ${r.status}`).slice(0, 160)}`);
    e.status = r.status;
    throw e;
  }
  const lido = safeParse(j?.choices?.[0]?.message?.content || '');
  if (!lido || typeof lido.legivel !== 'boolean') throw new Error('A IA não devolveu os campos.');
  return lido;
}

async function baixar(path, prazo) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const caminho = path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminho}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(restaAte(prazo, 20_000)),
  });
  if (!r.ok) { const e = new Error(`Arquivo não encontrado no armazenamento (HTTP ${r.status}).`); e.status = r.status; throw e; }
  return { buf: Buffer.from(await r.arrayBuffer()), mime: String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function lerDocumento(doc, prazo) {
  const { buf, mime: mimeSt } = await baixar(doc.arquivo_path, prazo);
  const mime = String(doc.mime || mimeSt || '').toLowerCase().split(';')[0].trim();
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('Arquivo grande demais para a IA (máx. 15 MB).'), { definitivo: true });
  if (!MIME_IMAGEM.has(mime) && mime !== 'application/pdf') throw Object.assign(new Error(`Formato ${mime || 'desconhecido'} não lido pela IA (use PDF, JPG ou PNG).`), { definitivo: true });
  const b64 = buf.toString('base64');
  const anexo = mime === 'application/pdf'
    ? { type: 'file', file: { filename: doc.arquivo_nome || 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } }
    : { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } };
  return chamarIa([{ type: 'text', text: `Documento cadastrado como "${doc.tipo}"${doc.descricao ? ` (${doc.descricao})` : ''}.` }, anexo], prazo);
}

// ── Texto do Bitrix (venda + cards ligados) ─────────────────────────────────

const CHAVE_VIAGEM = /voo|v[oô]o|a[eé]re|trecho|ida|volta|retorno|embarque|hotel|hosped|transfer|seguro|localizador|cia|companhia|bilhete|passage|conex|chegada|partida|roteiro/i;
function textoDoBitrix(fontes) {
  const linhas = [];
  for (const { rotulo, dados } of fontes) {
    for (const [k, v] of Object.entries(dados || {})) {
      if (!CHAVE_VIAGEM.test(k)) continue;
      const val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (!val.trim() || val.length > 1500) continue;
      linhas.push(`[${rotulo}] ${k}: ${val}`);
    }
  }
  return linhas.join('\n').slice(0, 6000);
}

// ── Cruzamento (o servidor decide) ──────────────────────────────────────────

/** "2026-10-27T15:55" + "+09:00" → ISO com fuso (sem fuso: -03:00). */
function comFuso(local, fuso) {
  const m = String(local || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return { iso: null, chutado: false };
  const f = /^[+-]\d{2}:\d{2}$/.test(String(fuso || '')) ? fuso : null;
  return { iso: `${m[1]}T${m[2] || '12'}:${m[3] || '00'}:00${f || '-03:00'}`, chutado: !f };
}

function categoriaConfirmada(s) {
  if (s.categoria === 'voo_internacional' || s.categoria === 'voo_interno') {
    const a = paisChave(s.origem_pais), b = paisChave(s.destino_pais);
    if (a && b) return a === b ? 'voo_interno' : 'voo_internacional';
  }
  return s.categoria;
}

function cruzar({ viagem, passageiros, leituras, trechosAntes }) {
  const divergencias = [];
  const avisos = [];
  const add = (gravidade, texto, documento_id = null) => divergencias.push({ gravidade, texto, documento_id });
  const temDatas = Boolean(viagem.data_embarque);
  const ini = temDatas ? somaDias(viagem.data_embarque, -2) : null;
  const fim = temDatas ? somaDias(viagem.data_retorno || viagem.data_embarque, 2) : null;
  const dentro = (d) => !temDatas || !d || (d >= ini && d <= fim);
  const nomesViagem = passageiros.map((p) => p.nome).filter(Boolean);
  const lugarViagem = lugarNorm(`${viagem.destino || ''} ${viagem.expedicao || ''} ${viagem.titulo || ''}`);
  const palavrasViagem = lugarViagem.split(' ').filter((w) => w.length > 3 && !/^(20\d\d|grupo|expedicao|viagem|pacote)$/.test(w));

  const segmentos = [];
  const cobertura = new Map(passageiros.map((p) => [p.cliente_id, { cliente_id: p.cliente_id, nome: p.nome, bilhete: false, seguro: false }]));
  let fusoChutado = false;
  const localizadores = new Set();

  for (const l of leituras) {
    if (!l.lido) continue;
    const L = l.lido;
    const rotDoc = l.fonte === 'bitrix' ? 'campos do Bitrix' : `"${l.arquivo_nome || l.tipo_cadastro}"`;
    if (!L.legivel) { if (l.fonte !== 'bitrix') add('media', `A IA não conseguiu ler ${rotDoc}. Peça o arquivo de novo (PDF ou foto inteira).`, l.documento_id); continue; }

    // passageiros do documento × da viagem
    const nomesDoc = (L.passageiros || []).concat(L.seguro?.segurados || []).filter(Boolean);
    const reconhecidos = nomesDoc.filter((n) => nomesViagem.some((v) => mesmaPessoa(n, v)));
    const estranhos = nomesDoc.filter((n) => !nomesViagem.some((v) => mesmaPessoa(n, v)));

    // datas do documento
    const datas = (L.segmentos || []).map((s) => String(s.partida_local || '').slice(0, 10)).filter(Boolean);
    if (L.seguro?.vigencia_inicio) datas.push(L.seguro.vigencia_inicio);
    const foraDaJanela = datas.filter((d) => !dentro(d));

    if (l.fonte !== 'bitrix' && nomesDoc.length && nomesViagem.length && !reconhecidos.length
      && (datas.length === 0 || foraDaJanela.length === datas.length)) {
      add('alta', `${rotDoc} parece ser de OUTRA viagem: nenhum passageiro bate${datas.length ? ` e as datas (${[...new Set(datas)].map(BR).join(', ')}) estão fora desta viagem` : ''}.`, l.documento_id);
      continue; // não usa os trechos de um documento de outra viagem
    }
    if (l.fonte !== 'bitrix' && datas.length && foraDaJanela.length === datas.length && temDatas) {
      add('alta', `${rotDoc}: todas as datas (${[...new Set(datas)].map(BR).join(', ')}) estão fora da viagem (${BR(viagem.data_embarque)} a ${BR(viagem.data_retorno)}). Pode ser de outra viagem ou a data da viagem está errada.`, l.documento_id);
    } else if (foraDaJanela.length && temDatas) {
      add('media', `${rotDoc}: ${foraDaJanela.length} data(s) fora da viagem (${[...new Set(foraDaJanela)].map(BR).join(', ')}).`, l.documento_id);
    }
    if (L.localizador) localizadores.add(alnum(L.localizador));
    for (const n of estranhos) add('media', `${rotDoc}: "${n}" não é passageiro desta viagem no QS.`, l.documento_id);

    // quem está coberto
    for (const p of cobertura.values()) {
      const noDoc = (L.passageiros || []).some((n) => mesmaPessoa(n, p.nome));
      const segurado = (L.seguro?.segurados || []).some((n) => mesmaPessoa(n, p.nome));
      if (noDoc && (L.segmentos || []).some((s) => s.categoria.startsWith('voo'))) p.bilhete = true;
      if (segurado || (L.tipo_detectado === 'seguro' && noDoc)) p.seguro = true;
    }

    // seguro cobre a viagem?
    if (L.seguro && temDatas) {
      const vi = L.seguro.vigencia_inicio, vf = L.seguro.vigencia_fim;
      if (vi && vi > viagem.data_embarque) add('alta', `Seguro ${L.seguro.seguradora || ''} começa em ${BR(vi)}, depois do embarque (${BR(viagem.data_embarque)}).`, l.documento_id);
      const volta = viagem.data_retorno || viagem.data_embarque;
      if (vf && vf < volta) add('alta', `Seguro ${L.seguro.seguradora || ''} termina em ${BR(vf)}, antes da volta (${BR(volta)}).`, l.documento_id);
    }

    for (const s of L.segmentos || []) {
      const categoria = categoriaConfirmada(s);
      const p = comFuso(s.partida_local, s.partida_fuso);
      const c = comFuso(s.chegada_local, s.chegada_fuso || s.partida_fuso);
      if (!p.iso) continue;
      if (p.chutado && categoria !== 'hospedagem') fusoChutado = true;
      if (categoria !== s.categoria) avisos.push(`${s.numero || s.origem || ''}→${s.destino || ''}: a IA disse ${s.categoria}, mas pelos países é ${categoria}.`);
      segmentos.push({
        categoria, documento_id: l.documento_id, fonte_leitura: l.fonte,
        origem: [s.origem, s.origem_codigo && `(${s.origem_codigo})`].filter(Boolean).join(' ') || null,
        destino: [s.destino, s.destino_codigo && `(${s.destino_codigo})`].filter(Boolean).join(' ') || null,
        origem_codigo: s.origem_codigo || null, destino_codigo: s.destino_codigo || null,
        origem_pais: s.origem_pais || null, destino_pais: s.destino_pais || null,
        partida_em: p.iso, chegada_em: c.iso && c.iso >= p.iso ? c.iso : null,
        companhia: s.companhia || null, numero: s.numero || null, nome_local: s.nome_local || null,
        classe: s.classe || null, bagagem: s.bagagem || null,
        partida_fuso: p.chutado ? null : s.partida_fuso, chegada_fuso: c.chutado ? null : (s.chegada_fuso || s.partida_fuso),
        terminal_partida: s.terminal_partida || null, terminal_chegada: s.terminal_chegada || null,
        assento: s.assento || null, numero_bilhete: s.numero_bilhete || null,
        passageiros: (s.passageiros && s.passageiros.length ? s.passageiros : L.passageiros || []).filter(Boolean),
        ponto_encontro: s.ponto_encontro || null, contato: s.contato || null, endereco: s.endereco || null, observacoes: s.observacao || null,
        localizador: L.localizador || null,
        confianca: l.fonte === 'bitrix' ? 0.6 : (L.passageiros?.length ? 0.9 : 0.75),
      });
    }
  }

  // tira repetidos entre documentos (o mesmo voo em 2 bilhetes)
  const unicos = [];
  for (const s of segmentos.sort((a, b) => a.partida_em.localeCompare(b.partida_em))) {
    const igual = unicos.find((u) => mesmoTrecho(u, s));
    if (igual) { for (const k of ['companhia', 'numero', 'chegada_em', 'localizador', 'nome_local', ...CAMPOS_EXTRA]) igual[k] = igual[k] || s[k]; igual.confianca = Math.max(igual.confianca, s.confianca); }
    else unicos.push({ ...s });
  }

  // o destino da viagem aparece em algum trecho?
  if (palavrasViagem.length && unicos.length) {
    const tocados = lugarNorm(unicos.map((s) => `${s.destino || ''} ${s.origem || ''} ${s.destino_pais || ''} ${s.origem_pais || ''} ${s.nome_local || ''}`).join(' '));
    if (!palavrasViagem.some((w) => tocados.includes(w))) {
      add('media', `Nenhum trecho lido chega a "${viagem.destino || viagem.expedicao || viagem.titulo}". Confira se os documentos são desta viagem.`);
    }
  }
  if (localizadores.size > 1) avisos.push(`Localizadores diferentes nos bilhetes: ${[...localizadores].join(', ')} (normal se cada passageiro tem a própria reserva).`);
  if (fusoChutado) avisos.push('Alguns horários vieram sem fuso no documento: gravei como horário de Brasília (-03:00). Confira os voos fora do Brasil.');

  // sugestão de datas quando a viagem não tem
  const voos = unicos.filter((s) => s.categoria.startsWith('voo'));
  if (!temDatas && voos.length) {
    avisos.push(`A viagem está sem data no QS. Pelos bilhetes: embarque ${BR(voos[0].partida_em)} e último voo ${BR(voos[voos.length - 1].partida_em)}.`);
  }

  // cobertura
  const internacional = unicos.some((s) => s.categoria === 'voo_internacional') || viagem.tipo === 'expedicao';
  const cob = [...cobertura.values()];
  const temBilhete = leituras.some((l) => l.lido?.segmentos?.some((s) => s.categoria.startsWith('voo')));
  const temSeguro = leituras.some((l) => l.lido?.seguro || l.lido?.tipo_detectado === 'seguro');
  if (temBilhete) for (const p of cob.filter((x) => !x.bilhete)) add('media', `${p.nome}: não achei bilhete aéreo no nome dele(a).`);
  if (temSeguro) for (const p of cob.filter((x) => !x.seguro)) add('media', `${p.nome}: não está no seguro viagem.`);
  if (!temSeguro && internacional) add('media', 'Viagem internacional sem apólice de seguro viagem anexada.');

  const docsLidos = leituras.filter((l) => l.fonte !== 'bitrix' && l.lido?.legivel).length;
  const incompleta = !temBilhete || (!temDatas);
  const graves = divergencias.filter((d) => d.gravidade !== 'baixa').length;
  const status = graves ? 'divergente' : incompleta ? 'incompleta' : 'ok';
  const resumo = [
    `${docsLidos} documento(s) lido(s), ${unicos.length} trecho(s) identificados`,
    `(${['voo_internacional', 'voo_interno', 'transfer', 'trem', 'hospedagem', 'passeio'].map((k) => [k, unicos.filter((s) => s.categoria === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', ') || 'nenhum'})`,
    graves ? `· ${graves} ponto(s) pra conferir` : status === 'incompleta' ? `· faltam ${!temBilhete ? 'bilhetes aéreos' : 'datas da viagem'}` : '· tudo bate com a viagem',
  ].join(' ');
  return { segmentos: unicos, divergencias, avisos, passageiros_cobertos: cob, status, resumo, internacional, temBilhete, temSeguro };
}

/**
 * QUANTO DA VENDA BATE (Bruno, 15/10): só documentação, passagens e roteiro.
 * Cada item é uma conferência sim/não; a porcentagem é itens ok ÷ itens.
 * Item que não se aplica (ex.: passaporte em viagem nacional) não entra.
 */
function conformidade({ viagem, passageiros, r }) {
  const itens = [];
  const add = (area, texto, ok) => itens.push({ area, texto, ok: Boolean(ok) });
  const volta = viagem.data_retorno || viagem.data_embarque;
  const seisMeses = volta ? (() => { const d = new Date(`${volta}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 6); return d.toISOString().slice(0, 10); })() : null;
  const cob = new Map(r.passageiros_cobertos.map((c) => [c.cliente_id, c]));
  const graveDeDoc = r.divergencias.some((d) => d.gravidade === 'alta' && d.documento_id);

  // Documentação
  for (const p of passageiros) {
    if (r.internacional) {
      add('documentacao', `${p.nome}: passaporte cadastrado`, p.passaporte);
      if (p.passaporte_validade && seisMeses) add('documentacao', `${p.nome}: passaporte vale 6 meses depois da volta`, p.passaporte_validade >= seisMeses);
      add('documentacao', `${p.nome}: no seguro viagem`, cob.get(p.cliente_id)?.seguro);
    }
  }
  if (r.internacional && !passageiros.length) add('documentacao', 'Passageiros com ficha na viagem', false);

  // Passagens
  const voos = r.segmentos.filter((x) => x.categoria.startsWith('voo'));
  for (const p of passageiros) add('passagens', `${p.nome}: bilhete aéreo no nome`, cob.get(p.cliente_id)?.bilhete);
  add('passagens', 'Os documentos são desta viagem (nomes e datas)', r.temBilhete && !graveDeDoc);
  const perto = (a, b) => a && b && Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) <= 86400_000;
  if (viagem.data_embarque) add('passagens', 'Primeiro voo bate com a data de ida', voos.length && perto(diaDe(voos[0].partida_em), viagem.data_embarque));
  if (viagem.data_retorno && viagem.data_retorno !== viagem.data_embarque) {
    add('passagens', 'Último voo bate com a data de volta', voos.length > 1 && perto(diaDe(voos[voos.length - 1].partida_em), viagem.data_retorno));
  }

  // Roteiro
  add('roteiro', 'Os trechos chegam ao destino vendido', r.segmentos.length && !r.divergencias.some((d) => /Nenhum trecho lido chega/.test(d.texto)));
  for (let i = 0; i + 1 < voos.length; i++) {
    const a = voos[i], b = voos[i + 1];
    if (a.chegada_em && diaDe(b.partida_em) <= somaDias(diaDe(a.chegada_em), 1)) {
      add('roteiro', `Conexão ${a.numero || a.destino || ''} → ${b.numero || b.origem || ''} dá tempo`, new Date(b.partida_em) - new Date(a.chegada_em) >= 45 * 60_000);
    }
  }
  const datasFora = r.divergencias.filter((d) => /fora da viagem/.test(d.texto)).length;
  add('roteiro', 'Datas dos documentos dentro da viagem', r.segmentos.length && !datasFora);

  const areas = {};
  for (const a of ['documentacao', 'passagens', 'roteiro']) {
    const daArea = itens.filter((i) => i.area === a);
    areas[a] = { ok: daArea.filter((i) => i.ok).length, total: daArea.length };
  }
  const ok = itens.filter((i) => i.ok).length;
  return { pct: itens.length ? Math.round((ok / itens.length) * 100) : 0, ok, total: itens.length, areas, itens };
}

// Colunas da 0139 que a IA preenche (o resto do trecho já existia).
const CAMPOS_EXTRA = ['origem_codigo', 'destino_codigo', 'partida_fuso', 'chegada_fuso', 'terminal_partida', 'terminal_chegada',
  'classe', 'bagagem', 'assento', 'numero_bilhete', 'passageiros', 'ponto_encontro', 'contato', 'endereco', 'observacoes'];

function diaDe(iso) { return String(iso || '').slice(0, 10); }
function mesmoTrecho(a, b) {
  const na = alnum(a.numero), nb = alnum(b.numero);
  // mesmo nº de voo com até 30h de diferença (o banco devolve em UTC, a IA em hora local)
  if (na && nb && na === nb && Math.abs(new Date(a.partida_em) - new Date(b.partida_em)) <= 30 * 3600_000) return true;
  const rota = (x) => `${alnum(x.origem_codigo || x.origem)}>${alnum(x.destino_codigo || x.destino)}`;
  const dt = Math.abs(new Date(a.partida_em) - new Date(b.partida_em));
  return a.categoria === b.categoria && rota(a) === rota(b) && rota(a) !== '>' && dt <= 2 * 3600_000;
}

// ── Trechos ─────────────────────────────────────────────────────────────────

async function aplicarTrechos(viagemId, segmentos, existentes) {
  const conta = { novos: 0, completados: 0, removidos: 0 };
  const refs = new Set();
  for (const s of segmentos) {
    const tipo = s.categoria;
    const igual = existentes.find((t) => mesmoTrecho(
      { ...t, categoria: t.tipo, origem_codigo: null, destino_codigo: null },
      { ...s, categoria: s.categoria },
    ));
    if (igual && igual.fonte !== 'ia') {
      const patch = {};
      for (const [k, v] of [['companhia', s.companhia], ['numero', s.numero], ['localizador', s.localizador], ['chegada_em', s.chegada_em], ['origem', s.origem], ['destino', s.destino], ...CAMPOS_EXTRA.map((c) => [c, s[c]])]) {
        if ((!igual[k] || (Array.isArray(igual[k]) && !igual[k].length)) && v && (!Array.isArray(v) || v.length)) patch[k] = v;
      }
      if (Object.keys(patch).length) { await rest(`rel_viagem_trechos?id=eq.${igual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); conta.completados++; }
      continue;
    }
    const ref = 'ia:' + crypto.createHash('sha1').update([tipo, alnum(s.numero), diaDe(s.partida_em), alnum(s.origem_codigo || s.origem)].join('|')).digest('hex').slice(0, 16);
    refs.add(ref);
    const descricao = s.nome_local || null;
    await rest('rel_viagem_trechos?on_conflict=viagem_id,ref_externa', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        viagem_id: viagemId, ref_externa: ref, fonte: 'ia', tipo, descricao,
        origem: s.origem, destino: s.destino, partida_em: s.partida_em, chegada_em: s.chegada_em,
        companhia: s.companhia, numero: s.numero, localizador: s.localizador,
        ...Object.fromEntries(CAMPOS_EXTRA.map((c) => [c, s[c] ?? (c === 'passageiros' ? [] : null)])),
        ia_confianca: s.confianca, documento_id: s.documento_id || null,
      },
    });
    if (!existentes.some((t) => t.ref_externa === ref)) conta.novos++;
  }
  // trecho da IA que não apareceu mais (documento trocado) sai — se ninguém fez o check-in dele
  for (const t of existentes.filter((x) => x.fonte === 'ia' && !refs.has(x.ref_externa) && !x.checkin_feito_em)) {
    await rest(`rel_viagem_trechos?id=eq.${t.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    conta.removidos++;
  }
  return conta;
}

// ── Revisar uma viagem ──────────────────────────────────────────────────────

async function revisar(viagemId, prazo = Date.now() + ORCAMENTO_MS) {
  const viagem = (await rest(`rel_viagens?select=id,titulo,destino,expedicao,tipo,status,data_embarque,data_retorno,bitrix_dados,ia_revisao&id=eq.${viagemId}&limit=1`))?.[0];
  if (!viagem) throw Object.assign(new Error('Viagem não encontrada.'), { status: 404 });

  const [pass, docs, ligados, trechosAntes] = await Promise.all([
    rest(`rel_viagem_passageiros?select=cliente_id,rel_clientes(nome,passaporte,passaporte_validade)&viagem_id=eq.${viagemId}`),
    rest(`rel_documentos?select=id,tipo,descricao,arquivo_path,arquivo_nome,mime,tamanho,enviado_em,status&viagem_id=eq.${viagemId}&tipo=in.(${TIPOS_DOC.join(',')})&status=neq.recusado&${SEM_PRINTS}&order=enviado_em.desc&limit=${MAX_DOCS}`),
    rest(`rel_viagem_deals?select=bitrix_deal_id,funil,bitrix_dados&viagem_id=eq.${viagemId}`).catch(() => []),
    rest(`rel_viagem_trechos?select=*&viagem_id=eq.${viagemId}&order=partida_em.asc`),
  ]);
  const passageiros = (pass || []).map((p) => ({ cliente_id: p.cliente_id, nome: p.rel_clientes?.nome || '', passaporte: p.rel_clientes?.passaporte || null, passaporte_validade: p.rel_clientes?.passaporte_validade || null }));

  // reaproveita leitura de documento que não mudou
  const cache = new Map((((viagem.ia_revisao?.versao || 1) >= 2 && viagem.ia_revisao?.documentos) || []).filter((d) => d.lido && !d.erro).map((d) => [d.documento_id || d.fonte, d]));
  const leituras = [];
  const fila = [];
  for (const d of docs || []) {
    const c = cache.get(d.id);
    if (c && c.lido_em && new Date(c.lido_em) >= new Date(d.enviado_em)) leituras.push(c);
    else fila.push(d);
  }

  // texto do Bitrix (uma leitura só, refeita quando o texto muda)
  const txt = textoDoBitrix([{ rotulo: 'venda', dados: viagem.bitrix_dados }, ...(ligados || []).map((l) => ({ rotulo: l.funil || `card ${l.bitrix_deal_id}`, dados: l.bitrix_dados }))]);
  const hashTxt = txt ? crypto.createHash('sha1').update(txt).digest('hex').slice(0, 12) : null;
  let tarefaBitrix = null;
  if (txt) {
    const c = cache.get('bitrix');
    if (c && c.hash === hashTxt) leituras.push(c);
    else tarefaBitrix = txt;
  }

  let fatal = null;
  let semTempo = 0;
  const lerUm = async (d) => {
    const base = { fonte: 'documento', documento_id: d.id, arquivo_nome: d.arquivo_nome, tipo_cadastro: d.tipo };
    try {
      leituras.push({ ...base, lido: await lerDocumento(d, prazo), lido_em: new Date().toISOString() });
    } catch (e) {
      if (e?.status === 401 || e?.status === 429) { fatal = e; return; }
      leituras.push({ ...base, lido: null, erro: e?.name === 'TimeoutError' ? 'A leitura demorou demais.' : String(e?.message || 'falhou').slice(0, 200) });
    }
  };
  const trabalhador = async () => {
    while (fila.length && !fatal) {
      if (prazo - Date.now() < MIN_PRA_COMECAR_MS) { semTempo += fila.length; fila.length = 0; break; }
      await lerUm(fila.shift());
    }
  };
  const tarefas = Array.from({ length: EM_PARALELO }, trabalhador);
  if (tarefaBitrix) {
    tarefas.push((async () => {
      try {
        const lido = await chamarIa([{ type: 'text', text: `Campos de texto do CRM (Bitrix) desta venda. Extraia só os voos/hotéis/transfers descritos:\n\n${tarefaBitrix}` }], prazo);
        leituras.push({ fonte: 'bitrix', documento_id: null, arquivo_nome: 'Campos do Bitrix', tipo_cadastro: 'bitrix', hash: hashTxt, lido, lido_em: new Date().toISOString() });
      } catch (e) {
        if (e?.status === 401 || e?.status === 429) fatal = e;
      }
    })());
  }
  await Promise.allSettled(tarefas);
  if (fatal) throw fatal;

  const r = cruzar({ viagem, passageiros, leituras, trechosAntes: trechosAntes || [] });
  if (semTempo) r.avisos.push(`${semTempo} documento(s) ficaram pra próxima revisão (tempo esgotado).`);
  const errosLeitura = leituras.filter((l) => l.erro);
  for (const l of errosLeitura) r.divergencias.push({ gravidade: 'baixa', texto: `Não li "${l.arquivo_nome || l.tipo_cadastro}": ${l.erro}`, documento_id: l.documento_id });

  const trechos = await aplicarTrechos(viagemId, r.segmentos, trechosAntes || []);
  let status = r.status;
  if (!leituras.some((l) => l.lido)) status = (docs || []).length || txt ? 'erro' : 'incompleta';
  const semNada = !(docs || []).length && !txt;

  const ia_revisao = {
    versao: 2,
    conformidade: conformidade({ viagem, passageiros, r }),
    documentos: leituras.map((l) => ({ fonte: l.fonte, documento_id: l.documento_id, arquivo_nome: l.arquivo_nome, tipo_cadastro: l.tipo_cadastro, hash: l.hash, lido: l.lido, lido_em: l.lido_em, erro: l.erro })),
    segmentos: r.segmentos,
    divergencias: r.divergencias,
    avisos: r.avisos,
    passageiros_cobertos: r.passageiros_cobertos,
    trechos,
    resumo: semNada ? 'A viagem não tem bilhete, seguro nem voucher anexado — nada pra revisar ainda.' : r.resumo,
    modelo: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
  await rest(`rel_viagens?id=eq.${viagemId}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { ia_revisao, ia_revisao_em: new Date().toISOString(), ia_revisao_status: status },
  });
  console.log(`[rel-viagem-ia] ${viagemId}: ${status} (${leituras.length} leituras, ${r.segmentos.length} trechos)`);
  return { viagem_id: viagemId, status, ia_revisao };
}

/** Viagens que embarcam nos próximos 90 dias com documento novo desde a última revisão. */
/**
 * Fila da IA (15/10 — Bruno: "carregar todos os arquivos, ter todos os dados"):
 *   1. quem nunca foi lido e tem arquivo: em viagem e próximos embarques primeiro,
 *      depois sem data, depois as já concluídas (das mais recentes pra trás);
 *   2. quem ganhou arquivo novo depois da última leitura (até 90 dias).
 */
async function candidatas() {
  const hoje = hojeSP(), ate = somaDias(hoje, 90);
  const nunca = await rest(
    `rel_viagens?select=id,data_embarque,data_retorno,rel_documentos!inner(id)` +
    `&status=eq.ativa&ia_revisao_em=is.null` +
    `&rel_documentos.tipo=in.(${TIPOS_DOC.join(',')})&rel_documentos.status=neq.recusado` +
    `&rel_documentos.limit=1&limit=3000`
  ).catch(() => []);
  const peso = (v) => {
    const fim = v.data_retorno || v.data_embarque;
    if (fim && fim >= hoje) return `0|${v.data_embarque || ''}`;             // em viagem / vai viajar
    if (!v.data_embarque) return '1|';                                         // sem data
    return `2|${String(99999999 - Number(String(v.data_embarque).replace(/-/g, '')))}`; // concluída: recente primeiro
  };
  const primeiro = (nunca || []).sort((a, b) => peso(a).localeCompare(peso(b))).map((v) => v.id);
  if (primeiro.length) return primeiro;

  const docs = await rest(
    `rel_documentos?select=viagem_id,enviado_em,rel_viagens!inner(id,status,data_embarque,ia_revisao_em)` +
    `&viagem_id=not.is.null&tipo=in.(${TIPOS_DOC.join(',')})&status=neq.recusado` +
    `&rel_viagens.status=eq.ativa&rel_viagens.data_embarque=gte.${hoje}&rel_viagens.data_embarque=lte.${ate}` +
    `&order=enviado_em.desc&limit=1000`
  ).catch(() => []);
  const porViagem = new Map();
  for (const d of docs || []) {
    const v = d.rel_viagens;
    if (!v) continue;
    if (v.ia_revisao_em && new Date(d.enviado_em) <= new Date(v.ia_revisao_em)) continue;
    if (!porViagem.has(v.id)) porViagem.set(v.id, v.data_embarque);
  }
  return [...porViagem.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id]) => id);
}

// ── Rota ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const temChave = Boolean(String(process.env.OPENAI_API_KEY || '').trim());

  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    if (!temChave) return res.status(200).json({ pulado: 'Falta a chave da OpenAI na Vercel' });
    const prazo = Date.now() + ORCAMENTO_MS;
    const feitas = [];
    try {
      const ids = (await candidatas()).slice(0, VIAGENS_POR_LOTE);
      for (const id of ids) {
        if (prazo - Date.now() < MIN_PRA_COMECAR_MS + 6_000) break;
        try { feitas.push({ id, status: (await revisar(id, prazo)).status }); }
        catch (e) {
          if (e?.status === 401 || e?.status === 429) { feitas.push({ id, status: 'parou', erro: e.message }); break; }
          feitas.push({ id, status: 'erro', erro: String(e?.message || '').slice(0, 120) });
        }
      }
      console.log(`[rel-viagem-ia] cron: ${JSON.stringify(feitas)}`);
      return res.status(200).json({ revisadas: feitas });
    } catch (e) {
      console.error('[rel-viagem-ia] cron falhou:', String(e?.message || '').slice(0, 160));
      return res.status(500).json({ error: e?.message || 'Falhou' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  if (!temChave) return res.status(503).json({ error: 'Falta a chave da OpenAI na Vercel (OPENAI_API_KEY). Sem ela a IA não revisa.' });

  const body = typeof req.body === 'string' ? (safeParse(req.body) || {}) : (req.body || {});
  const id = String(body.viagem_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Viagem inválida.' });
  try {
    return res.status(200).json(await revisar(id));
  } catch (e) {
    const status = e?.status === 404 ? 404 : e?.status === 401 ? 503 : e?.status === 429 ? 429 : 500;
    return res.status(status).json({
      error: e?.status === 429 ? 'A OpenAI pediu pra esperar (limite ou crédito). Tente em alguns minutos.' : (e?.message || 'Falhou a revisão.'),
    });
  }
}

// teste local das regras puras
export const _regras = { mesmaPessoa, paisChave, categoriaConfirmada, comFuso, mesmoTrecho, cruzar, textoDoBitrix };
