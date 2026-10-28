// api/rel-recompra.js
// -----------------------------------------------------------------------------
// DESATIVADA em 28/10/2026 (0218).
//
// Até aqui, "Criar oportunidade no Comercial" fazia o cliente da casa nascer
// como lead do SDR (createInboundLead, fonte "Recompra — Relacionamento").
// Decisão do Bruno: "o cliente fica 100% com o Relacionamento e não volta para
// o Comercial". A recompra agora vira cartão no PIPELINE DE VENDAS do próprio
// Rel (rel_oportunidades, tela #rel/vendas) — criado direto no banco pela tela.
//
// A rota fica de pé respondendo 410 (Gone) pra qualquer tela antiga em cache
// receber um recado claro em vez de criar lead. O histórico (rel_recompras e
// os leads já criados) não foi tocado.
// -----------------------------------------------------------------------------

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    error: 'A recompra não vai mais para o Comercial: o cliente fica com o Relacionamento. '
      + 'Crie a oportunidade no Pipeline de vendas do Rel (atualize a página).',
  });
}
