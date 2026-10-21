// api/proposta.js
// -----------------------------------------------------------------------------
// PROPOSTA — a rota PÚBLICA (0156, 21/10/2026).
//
//   GET  /api/proposta?token=<64 hex>[&equipe=1]  → a proposta como o cliente vê
//   POST { token, opcaoId, nome }                  → o cliente escolhe uma opção
//
// O cliente abre /proposta/<token> SEM login. O token (64 hex do banco) é a
// prova — e esta rota só devolve o que vai pra tela: nunca custo, lucro,
// fornecedor nem localizador. Cada abertura conta (vista_em = 1ª vez); o botão
// "Abrir link" do QS manda equipe=1 pra não contar o próprio time.
//
// Escolha (Bruno 21/10: "registra + avisa quem montou"): só com a proposta
// ENVIADA e sem escolha anterior. Grava a opção + o nome que o cliente digitou,
// acende a bolinha de quem montou (aprovacao_vista_em nulo) e, se a proposta
// veio de uma solicitação, comenta lá.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNOS = ['localizador'];

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function lerProposta(token) {
  const r = await rest(`qs_propostas?select=*&token=eq.${token}&limit=1`);
  return r?.[0] || null;
}

async function montarVM(p) {
  const [ops, its, users] = await Promise.all([
    rest(`qs_proposta_opcoes?select=id,ordem,titulo,descricao,recomendada,desconto,pagamentos&proposta_id=eq.${p.id}&order=ordem`),
    rest(`qs_proposta_itens?select=opcao_id,ordem,tipo,nome,descricao,data_inicio,data_fim,quantidade,valor_total,incluso,detalhes&proposta_id=eq.${p.id}&order=ordem`),
    p.criado_por ? rest(`qs_users?select=name,whatsapp_number&id=eq.${p.criado_por}&limit=1`).catch(() => null) : null,
  ]);
  const u = users?.[0] || null;
  return {
    numero: p.numero, status: p.status, titulo: p.titulo || '', destino: p.destino || '',
    data_ida: p.data_ida || '', data_volta: p.data_volta || '',
    adultos: p.adultos, criancas: p.criancas, bebes: p.bebes,
    apresentacao: p.apresentacao || '', observacoes: p.observacoes || '', esconder_precos: !!p.esconder_precos,
    capa_url: p.capa_url || '', cliente_nome: p.cliente_nome || '',
    consultor: u ? { nome: String(u.name || '').trim().split(/\s+/).slice(0, 2).join(' '), whatsapp: u.whatsapp_number || null } : null,
    aprovada_opcao_id: p.aprovada_opcao_id, aprovada_em: p.aprovada_em,
    opcoes: (ops || []).map((o) => ({
      id: o.id, titulo: o.titulo || '', descricao: o.descricao || '', recomendada: !!o.recomendada,
      desconto: Number(o.desconto) || 0, pagamentos: Array.isArray(o.pagamentos) ? o.pagamentos : [],
      itens: (its || []).filter((i) => i.opcao_id === o.id).map((i) => {
        const detalhes = { ...(i.detalhes || {}) };
        for (const k of INTERNOS) delete detalhes[k];
        return {
          tipo: i.tipo, nome: i.nome || '', descricao: i.descricao || '', data_inicio: i.data_inicio || '', data_fim: i.data_fim || '',
          quantidade: i.quantidade || 1, valor_total: Number(i.valor_total) || 0, incluso: !!i.incluso, detalhes,
        };
      }),
    })),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // A Vercel preenche req.query; a ponte do `vite dev` não — lê da URL.
  if (!req.query) req.query = Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams);
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? safeParse(req.body) : req.body || {}) : {};
  const token = String((req.method === 'GET' ? req.query?.token : body.token) || '').trim().toLowerCase();
  if (!TOKEN.test(token)) return res.status(404).json({ error: 'Link inválido.' });

  let p;
  try { p = await lerProposta(token); } catch (e) {
    console.error('[proposta] leitura:', e?.message);
    return res.status(503).json({ error: 'Não conseguimos abrir a proposta agora. Tente de novo em instantes.' });
  }
  // Rascunho e cancelada não abrem pro cliente.
  if (!p || p.status === 'rascunho' || p.status === 'cancelada') return res.status(404).json({ error: 'Proposta não encontrada.' });

  if (req.method === 'GET') {
    if (String(req.query?.equipe || '') !== '1') {
      const agora = new Date().toISOString();
      await rest(`qs_propostas?id=eq.${p.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { vista_em: p.vista_em || agora, vista_ultima_em: agora, visualizacoes: (p.visualizacoes || 0) + 1 },
      }).catch(() => null);
    }
    try {
      return res.status(200).json(await montarVM(p));
    } catch (e) {
      console.error('[proposta] montar:', e?.message);
      return res.status(503).json({ error: 'Não conseguimos abrir a proposta agora. Tente de novo em instantes.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const opcaoId = String(body.opcaoId || '');
  const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!UUID.test(opcaoId)) return res.status(400).json({ error: 'Escolha uma opção.' });
  if (nome.length < 3) return res.status(400).json({ error: 'Escreva seu nome completo.' });
  if (p.status !== 'enviada' || p.aprovada_opcao_id) return res.status(409).json({ error: 'Essa proposta já foi respondida. Fale com seu consultor se quiser mudar.' });

  const op = await rest(`qs_proposta_opcoes?select=id,ordem,titulo&id=eq.${opcaoId}&proposta_id=eq.${p.id}&limit=1`).catch(() => null);
  const opcao = op?.[0];
  if (!opcao) return res.status(400).json({ error: 'Escolha uma opção.' });

  // Só grava se ainda estiver enviada e sem escolha (dois cliques não viram duas aprovações).
  const agora = new Date().toISOString();
  const feito = await rest(`qs_propostas?id=eq.${p.id}&status=eq.enviada&aprovada_opcao_id=is.null`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'aprovada', aprovada_opcao_id: opcao.id, aprovada_em: agora, aprovada_nome: nome, aprovacao_vista_em: null, atualizado_em: agora },
  }).catch((e) => { console.error('[proposta] aprovar:', e?.message); return null; });
  if (!feito) return res.status(503).json({ error: 'Não conseguimos registrar agora. Tente de novo em instantes.' });
  if (!feito.length) return res.status(409).json({ error: 'Essa proposta já foi respondida. Fale com seu consultor se quiser mudar.' });

  if (p.solicitacao_id) {
    const nOps = await rest(`qs_proposta_opcoes?select=id&proposta_id=eq.${p.id}`).catch(() => []);
    const qual = (nOps?.length || 0) > 1 ? `a Opção ${opcao.ordem + 1}${opcao.titulo ? ` (${opcao.titulo})` : ''}` : 'a proposta';
    await rest('qs_solicitacao_eventos', {
      method: 'POST', prefer: 'return=minimal',
      body: { solicitacao_id: p.solicitacao_id, tipo: 'comentario', autor_id: null, autor_nome: `${nome} (cliente, pelo link)`, texto: `✅ Escolheu ${qual} da proposta nº ${p.numero}.` },
    }).catch((e) => console.warn('[proposta] evento da solicitação:', e?.message));
  }
  return res.status(200).json({ ok: true });
}
