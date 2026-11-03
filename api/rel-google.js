// api/rel-google.js
// -----------------------------------------------------------------------------
// AVALIAÇÕES NO GOOGLE (KPIs do Relacionamento — Bruno, 13/10/2026: "NPS e
// quantidade de avaliações no Google").
//
// 03/11/2026: o Bruno cortou a Places API do Google ("custo muito besta").
// A nota e o nº de avaliações são SEMPRE digitados à mão; nenhuma chamada paga.
//
//   GET  → { nota, total, nome: null, fonte: 'manual'|null, em }
//   POST { acao: 'manual', nota, total } → admin / gestor do Rel digita
//
// rel_config.google = { manual: {nota,total,em,por} }  (place_id/cache antigos são ignorados)
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import { quemChama } from './_relWa.js';

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

const podeConfigurar = (u) => u.role === 'admin' || (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('relacionamento'));

export default async function handler(req, res) {
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });

  if (req.method === 'GET') {
    const cfg = await lerConfig();
    if (cfg.manual) return res.status(200).json({ ...cfg.manual, nome: null, fonte: 'manual' });
    return res.status(200).json({ nota: null, total: null, nome: null, fonte: null, em: null });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  if (!podeConfigurar(u)) return res.status(403).json({ error: 'Só admin ou gestor do Relacionamento muda isso.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});

  if (body.acao === 'manual') {
    const nota = Number(String(body.nota ?? '').replace(',', '.'));
    const total = Number(body.total);
    if (!(nota >= 1 && nota <= 5)) return res.status(400).json({ error: 'A nota do Google vai de 1 a 5.' });
    if (!Number.isInteger(total) || total < 0) return res.status(400).json({ error: 'Número de avaliações inválido.' });
    const cfg = await lerConfig();
    cfg.manual = { nota: Math.round(nota * 10) / 10, total, em: new Date().toISOString(), por: u.name || null };
    delete cfg.cache;
    await gravarConfig(cfg);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'Ação inválida.' });
}
