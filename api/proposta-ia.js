// api/proposta-ia.js
// -----------------------------------------------------------------------------
// "MONTAR COM IA" (Bruno, 03/11/2026, migration 0290).
//
//   POST { proposta_id, modelo, campos, pedido? }   (Authorization: Bearer <jwt>)
//     → { extracao, conferir, descartados, avisos, uso, lidos }
//
// Lê TODOS os insumos da proposta (prints/PDFs do bucket privado
// `propostas-insumos` + textos colados), manda pra OpenAI com o esquema JSON
// estrito do modelo (api/_propostaIa.js) e devolve o resultado LIMPO. Não grava
// nada na proposta: quem preenche o rascunho é a tela (src/propostas/ia.ts,
// mesclando sem passar por cima do que o closer editou) e nada vai pro cliente
// sem o closer abrir, conferir e salvar. Aqui só marca `lido_em` nos insumos.
//
// Quem pode: quem pode editar a proposta (do setor dela, quem criou ou admin).
// Mesmo padrão do api/rel-docs-ia.js: OPENAI_MODEL || 'gpt-4o-mini', sem
// OPENAI_API_KEY → 503 claro, nunca loga conteúdo (só id, contagem e tokens).
// Tudo acaba antes do maxDuration (60 s no vercel.json).
//
// "EM BREVE" (Bruno, 03/11/2026): a geração de propostas pelo QS ficou pra
// depois (src/propostas/disponivel.ts). Sem PROPOSTAS_IA_LIGADA=1 na Vercel a
// rota responde 503 "em breve" antes de tocar no banco ou na OpenAI.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { INSTRUCAO, MODELOS_IA, esquemaProposta, textoDoPedido, validarExtracao } from './_propostaIa.js';

const BUCKET = 'propostas-insumos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const LIMITES = {
  arquivos: 8,                    // por rodada (os mais recentes, se tiver mais)
  bytesArquivo: 10 * 1024 * 1024, // por arquivo
  bytesTotal: 20 * 1024 * 1024,   // somando tudo (vai em base64 pra OpenAI)
  caracteresTexto: 40_000,        // textos colados + pedido
};
const ORCAMENTO_MS = 55_000;
export const iaLigada = () => /^(1|true|sim|on)$/i.test(String(process.env.PROPOSTAS_IA_LIGADA || '').trim());
const restaAte = (prazo, padrao) => Math.max(1_000, Math.min(padrao, prazo - Date.now() - 2_500));

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function quemEdita(req, propostaId) {
  const uid = await getSupabaseUserId(req.headers?.authorization);
  if (!uid || !UUID.test(uid)) return { erro: 401 };
  const u = (await rest(`qs_users?select=id,role,setores,is_active&id=eq.${uid}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return { erro: 401 };
  const p = (await rest(`qs_propostas?select=id,setor,status,criado_por,destino,data_ida,data_volta,adultos,criancas,bebes&id=eq.${propostaId}&limit=1`))?.[0];
  if (!p) return { erro: 404 };
  const setores = Array.isArray(u.setores) ? u.setores : [];
  if (!(u.role === 'admin' || setores.includes(p.setor) || p.criado_por === u.id)) return { erro: 403 };
  if (p.status === 'cancelada') return { erro: 409 };
  return { u, p };
}

async function baixar(path, prazo) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const caminho = String(path).split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${caminho}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(restaAte(prazo, 15_000)),
  });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return Buffer.from(await r.arrayBuffer());
}

/** Separa o que dá pra mandar: textos, arquivos (até os limites) e avisos do que ficou de fora. */
export function separarInsumos(insumos) {
  const avisos = [];
  const textos = [];
  let chars = 0;
  for (const i of insumos.filter((x) => x.tipo === 'texto')) {
    const t = String(i.texto || '').trim();
    if (!t) continue;
    if (chars + t.length > LIMITES.caracteresTexto) { avisos.push('Texto colado grande demais: só o começo foi lido.'); textos.push(t.slice(0, Math.max(0, LIMITES.caracteresTexto - chars))); break; }
    textos.push(t); chars += t.length;
  }
  const todos = insumos.filter((x) => x.tipo === 'arquivo');
  const arquivos = [];
  let bytes = 0;
  // os mais recentes primeiro (o print que acabou de subir sempre entra)
  for (const a of [...todos].reverse()) {
    const mime = String(a.mime || '').toLowerCase();
    const nome = a.arquivo_nome || 'arquivo';
    if (mime === 'image/heic' || mime === 'image/heif') { avisos.push(`"${nome}" está em HEIC (iPhone): mande em JPG/PNG ou tire print da tela.`); continue; }
    if (!MIME_IMAGEM.has(mime) && mime !== 'application/pdf') { avisos.push(`"${nome}": formato não lido pela IA (use imagem ou PDF).`); continue; }
    if ((a.tamanho || 0) > LIMITES.bytesArquivo) { avisos.push(`"${nome}" passa de 10 MB e ficou de fora.`); continue; }
    if (arquivos.length >= LIMITES.arquivos) { avisos.push(`Mais de ${LIMITES.arquivos} arquivos: "${nome}" ficou de fora desta rodada (os mais recentes entram).`); continue; }
    if (bytes + (a.tamanho || 0) > LIMITES.bytesTotal) { avisos.push(`"${nome}" ficou de fora: os arquivos somam mais de 20 MB.`); continue; }
    arquivos.push(a); bytes += a.tamanho || 0;
  }
  arquivos.reverse(); // volta pra ordem em que subiram
  return { textos, arquivos, avisos };
}

async function chamarOpenAi({ modelo, campos, conteudoUsuario, prazo }) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(restaAte(prazo, 50_000)),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 8000,
      messages: [{ role: 'system', content: INSTRUCAO }, { role: 'user', content: conteudoUsuario }],
      response_format: { type: 'json_schema', json_schema: { name: `proposta_${modelo}`, strict: true, schema: esquemaProposta(modelo, campos) } },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = String(j?.error?.message || `HTTP ${r.status}`);
    const e = new Error(r.status === 401 ? 'A chave da OpenAI foi recusada (revogada ou errada).'
      : /context|maximum|too large|too many/i.test(msg) ? 'Insumos demais pra uma leitura só: tire alguns prints e rode de novo (dá pra rodar em partes).'
      : `OpenAI: ${msg.slice(0, 160)}`);
    e.status = r.status;
    throw e;
  }
  const esc = j?.choices?.[0];
  if (esc?.message?.refusal) throw Object.assign(new Error('A IA se recusou a ler estes insumos.'), { status: 422 });
  if (esc?.finish_reason === 'length') throw Object.assign(new Error('A resposta da IA ficou grande demais. Rode com menos insumos de cada vez.'), { status: 422 });
  const lido = safeParse(esc?.message?.content || '');
  if (!lido || typeof lido !== 'object') throw Object.assign(new Error('A IA não devolveu os campos.'), { status: 502 });
  return { lido, uso: { entrada: j?.usage?.prompt_tokens ?? null, saida: j?.usage?.completion_tokens ?? null, modelo: j?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini' } };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST' }); }
  if (!iaLigada()) return res.status(503).json({ error: 'Montar proposta com IA pelo QS: em breve.', em_breve: true });
  const prazo = Date.now() + ORCAMENTO_MS;
  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) || {};
  const propostaId = String(body.proposta_id || '');
  if (!UUID.test(propostaId)) return res.status(400).json({ error: 'Salve a proposta antes de montar com IA.' });
  const modelo = String(body.modelo || '');
  if (!MODELOS_IA.includes(modelo)) return res.status(400).json({ error: 'Escolha o modelo da proposta (pacote, serviços ou seguro).' });

  let quem;
  try { quem = await quemEdita(req, propostaId); } catch (e) {
    console.error('[proposta-ia] acesso:', String(e?.message || '').slice(0, 120));
    return res.status(503).json({ error: 'Não conseguimos abrir a proposta agora. Tente de novo.' });
  }
  if (quem.erro === 401) return res.status(401).json({ error: 'Entre no QS de novo.' });
  if (quem.erro === 404) return res.status(404).json({ error: 'Proposta não encontrada.' });
  if (quem.erro === 403) return res.status(403).json({ error: 'Só quem monta a proposta pode usar a IA nela.' });
  if (quem.erro === 409) return res.status(409).json({ error: 'Proposta cancelada.' });
  if (!String(process.env.OPENAI_API_KEY || '').trim()) return res.status(503).json({ error: 'Falta a chave da OpenAI na Vercel (OPENAI_API_KEY).' });

  const pedido = String(body.pedido || '').trim().slice(0, 4000);
  let insumos;
  try {
    insumos = await rest(`qs_proposta_insumos?select=id,tipo,arquivo_path,arquivo_nome,mime,tamanho,texto&proposta_id=eq.${propostaId}&order=criado_em.asc&limit=60`);
  } catch (e) {
    console.error('[proposta-ia] insumos:', String(e?.message || '').slice(0, 120));
    return res.status(503).json({ error: 'Não conseguimos ler os insumos (a migration 0290 foi aplicada?).' });
  }
  const { textos, arquivos, avisos } = separarInsumos(insumos || []);
  if (!arquivos.length && !textos.length && !pedido) return res.status(400).json({ error: 'Suba pelo menos um print, PDF ou texto antes.' });

  // baixa os arquivos em paralelo; o que falhar vira aviso (não derruba o resto)
  const baixados = await Promise.all(arquivos.map(async (a) => {
    try { return { a, buf: await baixar(a.arquivo_path, prazo) }; } catch {
      avisos.push(`Não conseguimos abrir "${a.arquivo_nome || 'arquivo'}" no armazenamento.`); return null;
    }
  }));
  const ok = baixados.filter(Boolean);
  const anexos = ok.map(({ a, buf }) => (String(a.mime).toLowerCase() === 'application/pdf'
    ? { type: 'file', file: { filename: a.arquivo_nome || 'insumo.pdf', file_data: `data:application/pdf;base64,${buf.toString('base64')}` } }
    : { type: 'image_url', image_url: { url: `data:${a.mime};base64,${buf.toString('base64')}`, detail: 'high' } }));
  if (!anexos.length && !textos.length && !pedido) return res.status(400).json({ error: 'Nenhum insumo pôde ser lido.', avisos });

  const campos = Array.isArray(body.campos) ? body.campos : [];
  const conteudoUsuario = [
    { type: 'text', text: textoDoPedido({ modelo, proposta: quem.p, pedido, textos, nomesArquivos: ok.map(({ a }) => a.arquivo_nome || 'arquivo') }) },
    ...anexos,
  ];

  try {
    const { lido, uso } = await chamarOpenAi({ modelo, campos, conteudoUsuario, prazo });
    const r = validarExtracao(lido, { modelo, campos });
    const lidos = ok.map(({ a }) => a.id);
    const ids = [...lidos, ...(insumos || []).filter((i) => i.tipo === 'texto').map((i) => i.id)];
    if (ids.length) {
      await rest(`qs_proposta_insumos?id=in.(${ids.join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { lido_em: new Date().toISOString() } }).catch(() => null);
    }
    console.log(`[proposta-ia] ${propostaId}: ${modelo}, ${ok.length} arquivo(s), ${textos.length} texto(s), tokens ${uso.entrada}/${uso.saida}`);
    return res.status(200).json({ ...r, avisos, uso, lidos: ids });
  } catch (e) {
    const tempo = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    console.error(`[proposta-ia] ${propostaId}: erro`, e?.status || (tempo ? 'timeout' : ''), String(e?.message || '').slice(0, 120));
    if (tempo) return res.status(504).json({ error: 'A leitura demorou demais. Tente com menos prints de cada vez.', avisos });
    const status = e?.status === 401 ? 503 : e?.status === 429 ? 429 : (e?.status === 422 || e?.status === 400) ? 422 : 502;
    return res.status(status).json({
      error: e?.status === 429 ? 'A OpenAI pediu pra esperar (limite ou crédito). Tente em alguns minutos.' : (e?.message || 'Falhou a leitura.'),
      avisos,
    });
  }
}
