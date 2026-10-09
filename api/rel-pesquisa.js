// api/rel-pesquisa.js
// -----------------------------------------------------------------------------
// PESQUISA PÓS-VIAGEM — a rota PÚBLICA (Fase 5, 0103, 09/10/2026).
//
//   GET  /api/rel-pesquisa?token=<64 hex>  → { nome, viagem, respondida }
//   POST { token, nota, comentario?, melhor_parte?, proximo_destino? }
//
// O cliente abre /pesquisa/<token> SEM login. Quem prova que ele pode responder
// é o token (64 hex aleatórios, gerado pelo banco em rel_pesquisas) — por isso
// esta rota só devolve o PRIMEIRO NOME e o nome da viagem: quem achar um token
// por acaso não vê telefone, CPF nem nada da ficha.
//
// Responde UMA vez: a segunda tentativa recebe 409 (a pessoa vê "já
// respondida"). Nota ≥ 9 com "para onde quer ir na próxima" preenchido é o
// cliente QUENTE pra recompra — a tela de Recompra lê isso direto da tabela.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const TOKEN = /^[0-9a-f]{64}$/;
const MAX_TEXTO = 2000;
const MAX_DESTINO = 200;

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
const limpo = (v, max) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

async function lerPesquisa(token) {
  const r = await rest(
    `rel_pesquisas?select=id,nota,respondida_em,cliente_id,viagem_id&token=eq.${token}&limit=1`
  );
  return r?.[0] || null;
}

export default async function handler(req, res) {
  // Página pública: nada aqui pode ficar em cache de CDN (a resposta muda
  // quando a pessoa responde).
  res.setHeader('Cache-Control', 'no-store');

  const token = String((req.method === 'GET' ? req.query?.token : (typeof req.body === 'string' ? safeParse(req.body) : req.body || {}).token) || '')
    .trim().toLowerCase();
  if (!TOKEN.test(token)) return res.status(404).json({ error: 'Link inválido.' });

  let p;
  try {
    p = await lerPesquisa(token);
  } catch (e) {
    console.error('[rel-pesquisa] leitura:', e?.message);
    return res.status(503).json({ error: 'Não conseguimos abrir a pesquisa agora. Tente de novo em instantes.' });
  }
  if (!p) return res.status(404).json({ error: 'Link inválido.' });

  if (req.method === 'GET') {
    const [cli, via] = await Promise.all([
      rest(`rel_clientes?select=nome&id=eq.${p.cliente_id}&limit=1`).catch(() => null),
      p.viagem_id ? rest(`rel_viagens?select=titulo,destino&id=eq.${p.viagem_id}&limit=1`).catch(() => null) : null,
    ]);
    const nome = String(cli?.[0]?.nome || '').trim().split(/\s+/)[0] || null;
    const v = via?.[0] || null;
    return res.status(200).json({
      nome,
      viagem: v ? (v.destino || v.titulo) : null,
      respondida: Boolean(p.respondida_em),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  if (p.respondida_em) return res.status(409).json({ error: 'Esta pesquisa já foi respondida. Obrigado!' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const nota = Number(body.nota);
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) {
    return res.status(400).json({ error: 'Escolha uma nota de 0 a 10.' });
  }

  try {
    // `respondida_em=is.null` no filtro: duas abas enviando juntas — só a
    // primeira grava; a segunda não acha linha e cai no 409.
    const r = await rest(`rel_pesquisas?id=eq.${p.id}&respondida_em=is.null`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        nota,
        comentario: limpo(body.comentario, MAX_TEXTO),
        melhor_parte: limpo(body.melhor_parte, MAX_TEXTO),
        proximo_destino: limpo(body.proximo_destino, MAX_DESTINO),
        respondida_em: new Date().toISOString(),
      },
    });
    if (!Array.isArray(r) || !r.length) return res.status(409).json({ error: 'Esta pesquisa já foi respondida. Obrigado!' });
    return res.status(200).json({ ok: true, quente: nota >= 9 && Boolean(limpo(body.proximo_destino, MAX_DESTINO)) });
  } catch (e) {
    console.error('[rel-pesquisa] gravação:', e?.message);
    return res.status(503).json({ error: 'Não conseguimos registrar agora. Tente de novo em instantes.' });
  }
}
