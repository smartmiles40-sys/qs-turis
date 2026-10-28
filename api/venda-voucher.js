// api/venda-voucher.js
// -----------------------------------------------------------------------------
// SUBIR O VOUCHER E A IA PREENCHER A VENDA (Bruno 28/10/2026): "queria colocar
// para só subir o voucher ou algo assim e a IA já preencher tudo, inclusive se
// tem voos internos, e fazer toda a lógica da venda".
//
//   POST {
//     arquivos?: [{ nome, mime, base64 }            ← upload direto (até ~3 MB no total:
//               | { bucket: 'rel-documentos', path }] o limite de corpo da Vercel é 4,5 MB;
//                                                     arquivo maior vai pelo Storage)
//     texto?: string                                ← e-mail/voucher colado
//     cliente_ids?: uuid[]                          ← confere nomes/passaportes com rel_clientes
//     cadastro?: [{ nome, passaporte_validade? }]   ← ou os nomes que já estão na venda
//     viagem?: { data_inicio, data_fim }            ← datas já conhecidas (confere o seguro)
//   }
//   → { itens, pessoas, roteiro, avisos }   (formato de qs_venda_itens — ver api/_vendaVoucher.js)
//
// Como lê:
//   • PDF (com texto OU escaneado) vai INTEIRO pra OpenAI como `file` — o modelo
//     recebe o texto extraído E a imagem de cada página. Por isso NÃO entrou
//     dependência nova (pdf-parse/unpdf): o pdfmake do projeto não lê PDF, e
//     extrair texto aqui só duplicaria o que a API já faz, sem ler o escaneado.
//   • Imagem (jpg/png/webp) vai com visão (detail high).
//   • Texto colado vai como texto.
//   Limites: até 6 arquivos, 10 MB cada, 20 páginas por PDF, 40 no total, 40 mil
//   caracteres de texto.
//
// A IA só devolve a LEITURA (esquema fixo, structured outputs); a lógica da
// venda (conexões, voo interno, datas, valores, avisos, roteiro) é feita no
// servidor por montarVenda() — testada offline em scripts/teste-voucher.mjs.
//
// Nada é gravado: a rota só lê e devolve. Quem salva é a tela (Registrar venda),
// depois que o closer confere. Nunca loga o conteúdo do voucher.
// Sem OPENAI_API_KEY → 503 com recado claro.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { LEITURA, INSTRUCAO, montarVenda } from './_vendaVoucher.js';

const MAX_ARQUIVOS = 6;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGINAS_PDF = 20;
const MAX_PAGINAS_TOTAL = 40;
const MAX_TEXTO = 40_000;
const BUCKETS_OK = new Set(['rel-documentos']);
const MIME_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SETORES_OK = ['comercial', 'relacionamento', 'operacoes'];

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const UUID = /^[0-9a-f-]{36}$/i;

function erro(status, msg) { const e = new Error(msg); e.status = status; e.nosso = true; return e; }

/** Closer, gestão, Rel e Operações (quem sobe venda ou monta a viagem). */
async function quemPode(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const s = Array.isArray(u.setores) ? u.setores : [];
  return u.role === 'admin' || u.role === 'closer' || u.role === 'gestor' || SETORES_OK.some((x) => s.includes(x)) ? u : null;
}

/** Conta as páginas de um PDF sem biblioteca (objetos /Type /Page). Aproximado, só pro limite. */
export function paginasDoPdf(buf) {
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? m.length : 1;
}

function mimeDe(nome, mime, buf) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (m === 'image/jpg') return 'image/jpeg';
  if (m) return m;
  const ext = String(nome || '').toLowerCase().split('.').pop();
  return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || '';
}

async function baixarDoStorage(bucket, path) {
  if (!BUCKETS_OK.has(bucket)) throw erro(400, 'Esse lugar do armazenamento não é aceito aqui.');
  if (!path || String(path).includes('..')) throw erro(400, 'Caminho do arquivo inválido.');
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const caminho = String(path).split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${caminho}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw erro(r.status >= 500 ? 502 : 404, `Não achei o arquivo no armazenamento (HTTP ${r.status}).`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') };
}

/** Lê e valida os anexos → partes da mensagem pra OpenAI. */
async function anexosDe(arquivos) {
  if (!Array.isArray(arquivos)) return [];
  if (arquivos.length > MAX_ARQUIVOS) throw erro(413, `Mande no máximo ${MAX_ARQUIVOS} arquivos por vez.`);
  const partes = [];
  let paginas = 0;
  for (const [i, a] of arquivos.entries()) {
    const nome = String(a?.nome || `arquivo-${i + 1}`).slice(0, 120);
    let buf, mimeVeio = a?.mime;
    if (a?.base64) {
      const b64 = String(a.base64).replace(/^data:[^,]*,/, '');
      if (b64.length > MAX_BYTES * 1.37) throw erro(413, `${nome} passa de 10 MB.`);
      buf = Buffer.from(b64, 'base64');
    } else if (a?.bucket && a?.path) {
      ({ buf, mime: mimeVeio } = await baixarDoStorage(String(a.bucket), String(a.path)));
    } else throw erro(400, `${nome}: mande o arquivo (base64) ou o caminho no armazenamento.`);
    if (!buf.length) throw erro(400, `${nome} está vazio.`);
    if (buf.length > MAX_BYTES) throw erro(413, `${nome} passa de 10 MB.`);
    const mime = mimeDe(nome, mimeVeio, buf);
    const b64 = buf.toString('base64');
    if (mime === 'application/pdf') {
      const n = paginasDoPdf(buf);
      if (n > MAX_PAGINAS_PDF) throw erro(413, `${nome} tem ${n} páginas; o limite é ${MAX_PAGINAS_PDF}. Mande só as páginas do voucher.`);
      paginas += n;
      partes.push({ type: 'text', text: `Arquivo ${i + 1}: ${nome}` });
      partes.push({ type: 'file', file: { filename: nome.endsWith('.pdf') ? nome : `${nome}.pdf`, file_data: `data:application/pdf;base64,${b64}` } });
    } else if (MIME_IMAGEM.has(mime)) {
      paginas += 1;
      partes.push({ type: 'text', text: `Arquivo ${i + 1}: ${nome}` });
      partes.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } });
    } else if (mime.startsWith('text/')) {
      partes.push({ type: 'text', text: `Arquivo ${i + 1} (${nome}):\n${buf.toString('utf8').slice(0, MAX_TEXTO)}` });
    } else throw erro(415, `${nome}: só PDF, imagem (JPG/PNG/WebP) ou texto.`);
    if (paginas > MAX_PAGINAS_TOTAL) throw erro(413, `Passou de ${MAX_PAGINAS_TOTAL} páginas no total. Mande em duas vezes.`);
  }
  return partes;
}

async function lerComIa(partes) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(50_000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: INSTRUCAO },
        { role: 'user', content: [{ type: 'text', text: 'Leia os documentos abaixo (todos são da MESMA venda) e preencha os campos.' }, ...partes] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'leitura_voucher', strict: true, schema: LEITURA } },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401) throw erro(503, 'A chave da OpenAI foi recusada (revogada ou errada).');
    if (r.status === 429) throw erro(429, 'A OpenAI pediu pra esperar (limite ou crédito). Tente em alguns minutos.');
    throw erro(502, `A IA não conseguiu ler: ${String(j?.error?.message || `HTTP ${r.status}`).slice(0, 160)}`);
  }
  const msg = j?.choices?.[0]?.message;
  if (msg?.refusal) throw erro(422, 'A IA se recusou a ler esse arquivo.');
  const lido = safeParse(msg?.content || '');
  if (!lido || typeof lido.legivel !== 'boolean') throw erro(502, 'A IA não devolveu os campos. Tente de novo.');
  return lido;
}

async function cadastroDe(body) {
  const lista = Array.isArray(body.cadastro)
    ? body.cadastro.filter((c) => c && typeof c.nome === 'string').slice(0, 30)
      .map((c) => ({ nome: c.nome, passaporte_validade: c.passaporte_validade || null }))
    : [];
  const ids = (Array.isArray(body.cliente_ids) ? body.cliente_ids : []).filter((x) => UUID.test(String(x))).slice(0, 30);
  if (ids.length) {
    const rows = await rest(`rel_clientes?select=nome,passaporte_validade,nascimento&id=in.(${ids.join(',')})`).catch(() => []);
    for (const r of rows || []) if (r?.nome) lista.push({ nome: r.nome, passaporte_validade: r.passaporte_validade, nascimento: r.nascimento });
  }
  return lista;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }

  const u = await quemPode(req).catch(() => null);
  if (!u) return res.status(401).json({ error: 'Entre no QS de novo (ou peça acesso ao Comercial).' });
  if (!String(process.env.OPENAI_API_KEY || '').trim()) {
    return res.status(503).json({ error: 'A leitura do voucher ainda não foi configurada (falta a chave da OpenAI na Vercel: OPENAI_API_KEY).' });
  }

  const body = typeof req.body === 'string' ? (safeParse(req.body) || {}) : (req.body || {});
  try {
    const partes = await anexosDe(body.arquivos);
    const texto = String(body.texto || '').trim();
    if (texto) partes.push({ type: 'text', text: `Texto colado (e-mail/voucher):\n${texto.slice(0, MAX_TEXTO)}` });
    if (!partes.length) return res.status(400).json({ error: 'Mande o voucher (PDF ou foto) ou cole o texto.' });

    const [leitura, cadastro] = await Promise.all([lerComIa(partes), cadastroDe(body)]);
    const resultado = montarVenda(leitura, { cadastro, hoje: hojeSP(), viagem: body.viagem && typeof body.viagem === 'object' ? body.viagem : undefined });
    if (texto.length > MAX_TEXTO) resultado.avisos.push('O texto colado era muito grande; só o começo foi lido.');
    console.log(`[venda-voucher] ${u.id}: ${resultado.itens.length} itens, ${resultado.avisos.length} avisos`);
    return res.status(200).json(resultado);
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error('[venda-voucher] falhou:', String(e?.message || '').slice(0, 160));
    if (timeout) return res.status(504).json({ error: 'A leitura demorou demais. Tente com menos páginas.' });
    return res.status(e?.nosso ? e.status : 500).json({ error: e?.nosso ? e.message : 'Falhou a leitura do voucher.' });
  }
}
