// api/primeiro-contato.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/primeiro-contato
//   header x-lead-secret: <PRIMEIRO_CONTATO_SECRET ou LEAD_INBOUND_SECRET>
//   { telefone: "5511...", lead_id?, origem? }
//
// A PORTA DE FORA da mensagem automatica de primeiro contato. A REGRA mora em
// `_primeiroContato.js`; aqui so tem o que e de HTTP: conferir o segredo, achar
// o lead e traduzir o motivo em codigo de status.
//
// -- POR QUE ESTA ROTA CONTINUA EXISTINDO -------------------------------------
//
// Desde 31/08 o QS dispara SOZINHO quando o lead nasce (ver `lead-inbound.js`),
// entao o caminho normal nao passa mais por aqui. Ela fica por tres motivos:
//
//   1. O workflow do Bitrix/n8n continua apontando pra ca. Trocar o gatilho e
//      apagar o gatilho antigo no mesmo dia e ficar sem rede: se o disparo
//      automatico tiver algum problema, e aqui que da pra voltar (basta pôr o
//      gatilho em "externo" na tela).
//   2. Ha lead que entra no QS por outra porta que nao o `lead-inbound`.
//   3. Da pra reenviar na mao um lead especifico, com `lead_id`, sem SQL.
//
// -- OS MOTIVOS, E O STATUS DE CADA UM ----------------------------------------
//
// 200 ok:false  desligado · sem_template · ja_enviado · teto_do_dia
//                 → o QS decidiu nao mandar, e isso NAO e erro. O n8n nao
//                   precisa tentar de novo; precisa ler o motivo.
// 400           telefone_invalido
// 404           lead_inexistente  (quem cria lead e o `lead-inbound`; sem card,
//                 a resposta do cliente cairia em lugar nenhum)
// 502           envio_falhou      (a Meta recusou — o detalhe vem junto)
// 503           sem_config · reserva_falhou  (Supabase fora; retry faz sentido)
//
// Envs: PRIMEIRO_CONTATO_SECRET (ou LEAD_INBOUND_SECRET) + CHATWOOT_* + SUPABASE_*
// (CHATWOOT_* ainda e usado: as credenciais da Meta sao lidas de la.)
// -----------------------------------------------------------------------------

import { findLeadByPhone } from './_wa.js';
import { rest, segredoConfere } from './_supabaseAdmin.js';
import { dispararPrimeiroContato, normalizarCelular } from './_primeiroContato.js';

/** motivo -> status HTTP. O que nao esta aqui e 200 (decisao, nao erro). */
const STATUS = {
  telefone_invalido: 400,
  lead_inexistente: 404,
  envio_falhou: 502,
  sem_config: 503,
  reserva_falhou: 503,
  erro: 500,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  // Segredo proprio quando existir; senao o mesmo do lead-inbound, que vem do
  // mesmo n8n e do mesmo nivel de confianca. Assim ligar isto nao depende de
  // cadastrar variavel nova na Vercel.
  const segredo = String(process.env.PRIMEIRO_CONTATO_SECRET || process.env.LEAD_INBOUND_SECRET || '').trim();
  if (!segredo) return res.status(500).json({ error: 'Segredo nao configurado no servidor' });
  if (!segredoConfere(req.headers['x-lead-secret'], segredo)) {
    return res.status(401).json({ error: 'Nao autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const origem = String(body.origem || 'bitrix').slice(0, 40);

  // O telefone e conferido AQUI, antes de qualquer consulta: e ele que acha o
  // lead, e numero torto tem que virar 400 com motivo — nunca uma busca vazia
  // que responderia "lead nao existe" e mandaria alguem procurar o card errado.
  const telefone = normalizarCelular(body.telefone ?? body.phone ?? body.Telefone);
  if (!telefone) {
    return res.status(400).json({
      ok: false, motivo: 'telefone_invalido',
      error: 'Telefone nao e um celular brasileiro valido (fixo ou numero incompleto nao recebe WhatsApp).',
    });
  }

  let lead;
  try {
    lead = body.lead_id ? await buscarPorId(String(body.lead_id)) : await findLeadByPhone(telefone);
  } catch (e) {
    console.error('[primeiro-contato] busca do lead falhou:', e?.message || e);
    return res.status(503).json({ ok: false, motivo: 'sem_config', error: 'Nao consegui consultar o lead' });
  }
  if (!lead) {
    return res.status(404).json({
      ok: false, motivo: 'lead_inexistente',
      error: 'Nao existe lead com esse telefone no QS. Confira se o lead-inbound rodou antes.',
    });
  }

  const r = await dispararPrimeiroContato({ lead, telefone, origem });

  if (r.ok) return res.status(200).json(r);
  // `error` fica com o texto pra gente ler; `motivo` continua sendo o campo
  // estavel que o n8n compara. Os dois de proposito: o historico do n8n mostra
  // o corpo da resposta, e "motivo: teto_do_dia" sozinho nao explica nada pra
  // quem abre o log tres semanas depois.
  return res.status(STATUS[r.motivo] ?? 200).json({ ...r, error: r.detalhe });
}

async function buscarPorId(id) {
  const rows = await rest(
    `qs_leads?select=id,owner_id,full_name,first_name,last_name,phone,status,segment&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return (Array.isArray(rows) && rows[0]) || null;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
