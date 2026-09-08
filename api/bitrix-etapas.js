// api/bitrix-etapas.js
// -----------------------------------------------------------------------------
// DIAGNÓSTICO: os funis e as colunas do Bitrix, com nome e id.
//
//   GET /api/bitrix-etapas
//   header x-lead-secret: <LEAD_INBOUND_SECRET>
//
// Por que existe: id de coluna no Bitrix é opaco (`C25:UC_271QUB`) e não tem
// onde consultar sem entrar no portal. Escrever o id errado numa automação NÃO
// dá erro — o negócio simplesmente vai parar numa coluna que ninguém olha, que
// é exatamente o defeito que já aconteceu aqui com o `C25:NEW` (naquele funil
// ele se chama "Ajuste", não "Novo lead").
//
// Só lê. Não escreve nada, não move nada. E exige o mesmo segredo do
// lead-inbound porque a lista de funis é informação interna.
// -----------------------------------------------------------------------------
import { segredoConfere } from './_supabaseAdmin.js';

function base() {
  return (process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
}

async function chamar(metodo, params = {}) {
  const url = `${base()}/${metodo}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
    const corpo = await r.json().catch(() => null);
    if (!r.ok || corpo?.error) {
      throw new Error(corpo?.error_description || corpo?.error || `HTTP ${r.status}`);
    }
    return corpo?.result;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.LEAD_INBOUND_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: 'LEAD_INBOUND_SECRET não configurado' });
  if (!segredoConfere(req.headers['x-lead-secret'], secret)) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }
  if (!base()) return res.status(500).json({ ok: false, error: 'BITRIX_WEBHOOK_BASE não configurado' });

  try {
    // O funil 0 NÃO aparece em `crm.dealcategory.list` — ele é o padrão, e é
    // implícito. Mas ele TEM nome no portal, e chutar "Geral" leva a erro de
    // leitura: aqui ele se chama "Comercial 1", o que só dá pra saber
    // perguntando. `crm.dealcategory.default.get` é quem responde.
    const categorias = await chamar('crm.dealcategory.list', {
      order: { SORT: 'ASC' },
      select: ['ID', 'NAME', 'SORT'],
    });

    let nomeDoPadrao = '(funil padrão — nome não obtido)';
    try {
      const p = await chamar('crm.dealcategory.default.get', {});
      if (p?.NAME) nomeDoPadrao = p.NAME;
    } catch { /* segue com o rótulo genérico */ }

    const funis = [{ id: 0, nome: nomeDoPadrao }].concat(
      (Array.isArray(categorias) ? categorias : []).map((c) => ({ id: Number(c.ID), nome: c.NAME }))
    );

    const saida = [];
    for (const f of funis) {
      let etapas = [];
      try {
        const st = await chamar('crm.dealcategory.stage.list', { id: f.id });
        etapas = (Array.isArray(st) ? st : []).map((e) => ({
          status_id: e.STATUS_ID,   // é ISTO que vai em STAGE_ID
          nome: e.NAME,
          sort: Number(e.SORT),
        }));
      } catch (e) {
        etapas = [{ erro: e.message }];
      }
      saida.push({ ...f, etapas });
    }

    return res.status(200).json({
      ok: true,
      dica: 'STAGE_ID do negócio recebe o `status_id` da etapa, e CATEGORY_ID recebe o `id` do funil. Os dois têm que ser do MESMO funil.',
      funis: saida,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || 'falha ao falar com o Bitrix' });
  }
}
