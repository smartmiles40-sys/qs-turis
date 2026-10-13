// api/rel-google.js
// -----------------------------------------------------------------------------
// AVALIAÇÕES NO GOOGLE (KPIs do Relacionamento — Bruno, 13/10/2026: "NPS e
// quantidade de avaliações no Google").
//
//   GET  → { nota, total, nome, fonte: 'google'|'manual'|null, em, place_id, temChave }
//          Lê da Places API (New) com GOOGLE_PLACES_API_KEY + rel_config.google.place_id.
//          Guarda em cache em rel_config.google.cache e só consulta o Google de
//          novo depois de 6 h (a API é paga por chamada).
//   POST { acao: 'place', place_id }       → salva o Place ID (admin / gestor do Rel)
//   POST { acao: 'manual', nota, total }   → sem chave/Place ID: o time digita
//
// rel_config.google = { place_id, cache: {nota,total,nome,em}, manual: {nota,total,em,por} }
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { quemChama } from './_relWa.js';

const SEIS_HORAS = 6 * 3_600_000;

async function lerConfig() {
  const r = await rest('rel_config?select=valor&chave=eq.google&limit=1').catch(() => null);
  return r?.[0]?.valor || {};
}
async function gravarConfig(valor) {
  await rest('rel_config?on_conflict=chave', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { chave: 'google', valor, atualizado_em: new Date().toISOString() },
  });
}

async function doGoogle(placeId, chave) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': chave, 'X-Goog-FieldMask': 'rating,userRatingCount,displayName' },
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Google HTTP ${r.status}`);
    return { nota: j.rating ?? null, total: j.userRatingCount ?? 0, nome: j.displayName?.text || null };
  } finally {
    clearTimeout(t);
  }
}

const podeConfigurar = (u) => u.role === 'admin' || (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('relacionamento'));

export default async function handler(req, res) {
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  const chave = String(process.env.GOOGLE_PLACES_API_KEY || '').trim();

  if (req.method === 'GET') {
    const cfg = await lerConfig();
    let aviso = null;
    if (chave && cfg.place_id) {
      const cache = cfg.cache;
      const velho = !cache?.em || Date.now() - new Date(cache.em).getTime() > SEIS_HORAS || cache.place_id !== cfg.place_id;
      if (velho) {
        try {
          const g = await doGoogle(cfg.place_id, chave);
          cfg.cache = { ...g, place_id: cfg.place_id, em: new Date().toISOString() };
          await gravarConfig(cfg);
        } catch (e) {
          aviso = `O Google não respondeu agora (${e.message}) — mostrando a última leitura.`;
        }
      }
      if (cfg.cache?.place_id === cfg.place_id) {
        return res.status(200).json({ ...cfg.cache, fonte: 'google', place_id: cfg.place_id, temChave: true, aviso });
      }
    }
    if (cfg.manual) {
      return res.status(200).json({ ...cfg.manual, nome: null, fonte: 'manual', place_id: cfg.place_id || null, temChave: Boolean(chave), aviso });
    }
    return res.status(200).json({ nota: null, total: null, nome: null, fonte: null, em: null, place_id: cfg.place_id || null, temChave: Boolean(chave), aviso });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  if (!podeConfigurar(u)) return res.status(403).json({ error: 'Só admin ou gestor do Relacionamento muda isso.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const cfg = await lerConfig();

  if (body.acao === 'place') {
    const placeId = String(body.place_id || '').trim();
    if (placeId && !/^[A-Za-z0-9_-]{10,}$/.test(placeId)) return res.status(400).json({ error: 'Place ID inválido (ex.: ChIJ...).' });
    cfg.place_id = placeId || null;
    delete cfg.cache;
    await gravarConfig(cfg);
    return res.status(200).json({ ok: true });
  }
  if (body.acao === 'manual') {
    const nota = Number(String(body.nota ?? '').replace(',', '.'));
    const total = Number(body.total);
    if (!(nota >= 1 && nota <= 5)) return res.status(400).json({ error: 'A nota do Google vai de 1 a 5.' });
    if (!Number.isInteger(total) || total < 0) return res.status(400).json({ error: 'Número de avaliações inválido.' });
    cfg.manual = { nota: Math.round(nota * 10) / 10, total, em: new Date().toISOString(), por: u.name || null };
    await gravarConfig(cfg);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'Ação inválida.' });
}
