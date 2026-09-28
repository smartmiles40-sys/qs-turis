// api/monitor-distribuicao.js
// -----------------------------------------------------------------------------
// A PORTA DO DASHBOARD pro Monitor de distribuição de leads (migration 0094).
//
// O Dashboard vive em outro Supabase: não enxerga qs_lead_entradas. Ele (ou o
// n8n) chama esta rota com o segredo interno e recebe o mesmo retrato que a
// tela Desempenho → Monitor de leads mostra — a conta mora no banco
// (qs_monitor_distribuicao), aqui só se repassa.
//
// GET /api/monitor-distribuicao?de=AAAA-MM-DD&ate=AAAA-MM-DD
//     header: x-internal-secret = INTERNAL_API_SECRET
//   → { success, de, ate, sdrs[], por_dia[], lives[], closers[] }
//
// GET ...&lista=1[&sdr=<uuid>][&canal=live|trafego|organico|outros][&fds=1]
//   → { success, leads[] }   (a relação lead a lead, até 5000)
//
// Sem datas: últimos 7 dias (fuso de São Paulo), hoje incluído.
// -----------------------------------------------------------------------------
import { rest, segredoConfere } from './_supabaseAdmin.js';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANAIS = new Set(['live', 'trafego', 'organico', 'outros']);

function hojeSP(deslocDias = 0) {
  const d = new Date(Date.now() + deslocDias * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Use GET' });
  }
  if (!segredoConfere(req.headers['x-internal-secret'], process.env.INTERNAL_API_SECRET)) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const q = req.query || {};
  const de = DATA_RE.test(String(q.de || '')) ? String(q.de) : hojeSP(-6);
  const ate = DATA_RE.test(String(q.ate || '')) ? String(q.ate) : hojeSP(0);
  if (de > ate) {
    return res.status(400).json({ success: false, error: '"de" depois de "ate"' });
  }

  try {
    if (q.lista === '1' || q.lista === 'true') {
      const body = { p_de: de, p_ate: ate, p_so_fds: q.fds === '1' || q.fds === 'true' };
      if (q.sdr) {
        if (!UUID_RE.test(String(q.sdr))) return res.status(400).json({ success: false, error: 'sdr inválido' });
        body.p_sdr = String(q.sdr);
      }
      if (q.canal) {
        if (!CANAIS.has(String(q.canal))) return res.status(400).json({ success: false, error: 'canal inválido' });
        body.p_canal = String(q.canal);
      }
      const leads = await rest('rpc/qs_monitor_distribuicao_lista', { method: 'POST', body });
      return res.status(200).json({ success: true, de, ate, leads: leads || [] });
    }

    const r = await rest('rpc/qs_monitor_distribuicao', { method: 'POST', body: { p_de: de, p_ate: ate } });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, ...(r || {}) });
  } catch (e) {
    console.error('[monitor-distribuicao]', e?.message);
    return res.status(500).json({ success: false, error: 'Falha ao montar o monitor' });
  }
}
