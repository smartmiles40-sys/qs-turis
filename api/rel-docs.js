// api/rel-docs.js
// -----------------------------------------------------------------------------
// O LINK DE DOCUMENTOS (Fase 3, 0103) — o cliente abre /documentos/<token>,
// SEM login, e manda passaporte, RG, comprovante... Quem gera o link é o time
// (rel_doc_pedidos, na ficha ou na viagem).
//
//   GET  ?token=                                   → o que foi pedido e o que já chegou
//   POST { token, acao:'url', tipo, nome, mime, tamanho }
//        → endereço ASSINADO pra subir o arquivo direto no Storage (o arquivo
//          não passa pela Vercel — sem o teto de 4,5 MB do corpo)
//   POST { token, acao:'confirmar', tipo, path, nome, mime, tamanho, validade? }
//        → confere que o arquivo subiu e registra em rel_documentos
//   POST { token, acao:'concluir' }                → o cliente terminou
//
// Segurança: o token (64 hex, aleatório) é a única chave. A resposta nunca
// traz telefone, CPF nem arquivo de ninguém — só o primeiro nome e o que foi
// pedido. O bucket é PRIVADO; o caminho sempre começa com o id do cliente do
// token, e o servidor confere isso antes de registrar.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const BUCKET = 'rel-documentos';
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ARQUIVOS_POR_PEDIDO = 20;
const MIME_OK = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};
const TIPOS = new Set(['passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro', 'voucher', 'contrato', 'comprovante', 'outro']);
const TOKEN = /^[0-9a-f]{64}$/;

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

function storage() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

/** O pedido do token, com o cliente. null = não existe. */
async function pedidoDoToken(token) {
  if (!TOKEN.test(String(token || ''))) return null;
  const r = await rest(
    `rel_doc_pedidos?select=id,cliente_id,viagem_id,tipos,mensagem,expira_em,concluido_em&token=eq.${token}&limit=1`
  );
  return r?.[0] || null;
}

const expirado = (p) => new Date(p.expira_em).getTime() < Date.now();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})) : {};
  const token = String((req.method === 'GET' ? req.query?.token : body.token) || '').trim().toLowerCase();

  let pedido;
  try {
    pedido = await pedidoDoToken(token);
  } catch (e) {
    console.error('[rel-docs] leitura do pedido:', e?.message);
    return res.status(500).json({ error: 'Não consegui abrir o pedido agora. Tente de novo em instantes.' });
  }
  if (!pedido) return res.status(404).json({ error: 'Link inválido.' });

  // ── O que foi pedido ──
  if (req.method === 'GET') {
    const [cli, docs] = await Promise.all([
      rest(`rel_clientes?select=nome&id=eq.${pedido.cliente_id}&limit=1`).catch(() => null),
      rest(`rel_documentos?select=tipo,arquivo_nome,status,enviado_em&pedido_id=eq.${pedido.id}&order=enviado_em.asc`).catch(() => []),
    ]);
    return res.status(200).json({
      nome: String(cli?.[0]?.nome || '').trim().split(/\s+/)[0] || null,
      tipos: pedido.tipos,
      mensagem: pedido.mensagem || null,
      expirado: expirado(pedido),
      concluido: Boolean(pedido.concluido_em),
      enviados: (docs || []).map((d) => ({ tipo: d.tipo, arquivo_nome: d.arquivo_nome, status: d.status })),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  if (expirado(pedido)) return res.status(410).json({ error: 'Este link expirou. Peça um novo para a agência.' });

  const acao = String(body.acao || '');
  const tipo = String(body.tipo || '');
  const st = storage();

  // ── Endereço assinado pra subir ──
  if (acao === 'url') {
    if (!TIPOS.has(tipo) || !pedido.tipos.includes(tipo)) return res.status(400).json({ error: 'Este documento não foi pedido.' });
    const mime = String(body.mime || '').toLowerCase().split(';')[0].trim();
    const ext = MIME_OK[mime];
    if (!ext) return res.status(400).json({ error: 'Envie foto (JPG, PNG) ou PDF.' });
    const tamanho = Number(body.tamanho || 0);
    if (!(tamanho > 0) || tamanho > MAX_BYTES) return res.status(413).json({ error: 'Arquivo maior que 15 MB.' });
    const contagem = await rest(`rel_documentos?select=id&pedido_id=eq.${pedido.id}`).catch(() => []);
    if ((contagem || []).length >= MAX_ARQUIVOS_POR_PEDIDO) {
      return res.status(429).json({ error: 'Limite de arquivos deste link atingido. Fale com a agência.' });
    }
    const sorteio = Math.random().toString(36).slice(2, 10);
    const path = `${pedido.cliente_id}/${Date.now()}-${tipo}-${sorteio}.${ext}`;
    const r = await fetch(`${st.url}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST', headers: st.headers, body: '{}',
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.url) {
      console.error('[rel-docs] upload assinado:', r.status, JSON.stringify(j).slice(0, 200));
      return res.status(502).json({ error: 'Não consegui preparar o envio. Tente de novo.' });
    }
    return res.status(200).json({ path, url: `${st.url}/storage/v1${j.url}` });
  }

  // ── Registrar o que subiu ──
  if (acao === 'confirmar') {
    if (!TIPOS.has(tipo) || !pedido.tipos.includes(tipo)) return res.status(400).json({ error: 'Este documento não foi pedido.' });
    const path = String(body.path || '');
    if (!path.startsWith(`${pedido.cliente_id}/`) || path.includes('..') || !/^[0-9a-f-]{36}\/[\w.-]+$/.test(path)) {
      return res.status(400).json({ error: 'Arquivo inválido.' });
    }
    // O arquivo existe mesmo? (lista a pasta do cliente filtrando pelo nome)
    const nomeNoBucket = path.split('/')[1];
    const lista = await fetch(`${st.url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: st.headers,
      body: JSON.stringify({ prefix: `${pedido.cliente_id}/`, search: nomeNoBucket, limit: 5 }),
    }).then((r) => r.json()).catch(() => null);
    if (!Array.isArray(lista) || !lista.some((o) => o?.name === nomeNoBucket)) {
      return res.status(400).json({ error: 'O arquivo não chegou. Envie de novo.' });
    }
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(String(body.validade || '')) ? body.validade : null;
    await rest('rel_documentos', {
      method: 'POST', prefer: 'return=minimal',
      body: {
        cliente_id: pedido.cliente_id,
        viagem_id: pedido.viagem_id,
        pedido_id: pedido.id,
        tipo,
        arquivo_path: path,
        arquivo_nome: String(body.nome || nomeNoBucket).slice(0, 160),
        mime: String(body.mime || '').slice(0, 80) || null,
        tamanho: Number(body.tamanho) || null,
        validade,
        enviado_por: 'cliente',
      },
    });
    // Validade do passaporte entra na ficha só se ela ainda não tem.
    if (tipo === 'passaporte' && validade) {
      await rest(`rel_clientes?id=eq.${pedido.cliente_id}&passaporte_validade=is.null`, {
        method: 'PATCH', prefer: 'return=minimal', body: { passaporte_validade: validade },
      }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (acao === 'concluir') {
    if (!pedido.concluido_em) {
      await rest(`rel_doc_pedidos?id=eq.${pedido.id}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { concluido_em: new Date().toISOString() },
      });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}
