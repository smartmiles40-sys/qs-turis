// api/mkt-trafego.js
// -----------------------------------------------------------------------------
// TRÁFEGO › META ADS (0265, 03/11/2026) — rota única. As contas moram em
// api/_mktTrafegoCalc.js; a conversa com a Meta em api/_metaAds.js; banco e
// travas em api/_mktTrafegoMotor.js. Aqui é porta e permissão.
//
//   GET  ?cron=1   (Vercel Cron a cada 30 min, Bearer CRON_SECRET)
//                  → lê a Meta, grava, avalia as travas e age.
//   POST { acao: 'painel', periodoId? }   → tudo que a tela mostra (Marketing)
//   POST { acao: 'sincronizar' }          → "Atualizar agora" (Tráfego/gestor)
//   POST { acao: 'reativar', acaoId }     → reativa campanha que o QS pausou (Tráfego/gestor)
//
// Quem entra: Marketing (admin, papel marketing ou setor marketing). Quem
// sincroniza/reativa: papel 'trafego' do Marketing, gestor de Marketing, admin
// — a mesma regra de mkt_trafego_pode_editar() no banco.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { faltaConfigurar } from './_metaAds.js';
import { sincronizar, agir, montarPainel, reativar } from './_mktTrafegoMotor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const e = (await rest(`mkt_equipe?select=papeis&user_id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return { ...u, papeis: Array.isArray(e?.papeis) ? e.papeis : [] };
}
/** Mesma regra de mkt_tem_acesso() (0240). */
export function ehDoMarketing(u) {
  const s = Array.isArray(u.setores) ? u.setores : [];
  return u.role === 'admin' || u.role === 'marketing' || s.includes('marketing');
}
/**
 * Mesma regra de mkt_trafego_pode_editar() (0265): tráfego ou quem aprova.
 * 04/11/2026 (0266, acesso completo do time): quem aprova = TODO o Marketing
 * (admin, papel marketing ou setor marketing) — ver mkt_eh_aprovador na 0266.
 * Sem a 0266 aplicada o banco ainda recusa as travas pra quem não é gestor;
 * o servidor já segue a regra nova.
 */
export function podeEditar(u) {
  return ehDoMarketing(u);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (!q.cron) return res.status(400).json({ error: 'Ação desconhecida.' });
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });
    if (faltaConfigurar().length) return res.status(200).json({ ok: true, pulado: `Meta não configurada (${faltaConfigurar().join(', ')})` });
    const saida = {};
    try {
      saida.leitura = await sincronizar({ orcamentoMs: 35_000 });
    } catch (e) {
      // A leitura falhou (token vencido, Meta fora): segue pro agir, que manda o
      // alerta "sem dado há mais de 2 h" e NÃO julga trava com número parado.
      console.error('[mkt-trafego] leitura falhou:', String(e?.message || '').slice(0, 300));
      saida.erroLeitura = String(e?.message || 'falhou').slice(0, 300);
    }
    try {
      saida.acoes = await agir({ mudancas: saida.leitura?.mudancas ?? [] });
    } catch (e) {
      console.error('[mkt-trafego] travas falharam:', String(e?.message || '').slice(0, 300));
      saida.erroTravas = String(e?.message || 'falhou').slice(0, 300);
    }
    console.log(`[mkt-trafego] ${JSON.stringify({ ...saida, leitura: saida.leitura && { ...saida.leitura, mudancas: saida.leitura.mudancas?.length } })}`);
    return res.status(saida.erroTravas ? 500 : 200).json(saida);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida.' });
  if (!ehDoMarketing(u)) return res.status(403).json({ error: 'Meta Ads é do Marketing.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  try {
    if (acao === 'painel') {
      const periodoId = UUID.test(String(body.periodoId || '')) ? String(body.periodoId) : null;
      const p = await montarPainel({ periodoId });
      return res.status(200).json({ ...p, podeEditar: podeEditar(u) });
    }
    if (!podeEditar(u)) return res.status(403).json({ error: 'Só o Marketing faz isso.' });
    if (acao === 'sincronizar') {
      if (faltaConfigurar().length) return res.status(400).json({ error: `Falta configurar na Vercel: ${faltaConfigurar().join(', ')}`, configurar: true });
      const leitura = await sincronizar({ orcamentoMs: 35_000 });
      const acoes = await agir({ mudancas: leitura.mudancas });
      return res.status(200).json({ ok: true, leitura: { ...leitura, mudancas: leitura.mudancas.length }, acoes });
    }
    if (acao === 'reativar') {
      const id = Number(body.acaoId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Ação inválida.' });
      return res.status(200).json(await reativar({ acaoId: id, quem: u.id }));
    }
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[mkt-trafego]', acao, String(e?.message || '').slice(0, 300));
    return res.status(e?.status && e.status < 500 ? e.status : 500).json({ error: String(e?.message || 'Falhou.').slice(0, 300) });
  }
}
