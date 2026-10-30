// scripts/teste-venda-analise-rota.mjs
// -----------------------------------------------------------------------------
// Teste OFFLINE da rota api/venda-analise.js com o PostgREST e a OpenAI de
// mentira (fetch trocado). Confere: rascunho sem chave = modo regras + aviso;
// venda gravada chama venda_analise_gravar; sem a 0230 devolve gravado:false
// + falta0230; com chave, a IA soma risco; erro da OpenAI cai pro modo regras.
//
//   node scripts/teste-venda-analise-rota.mjs
// -----------------------------------------------------------------------------
process.env.SUPABASE_URL = 'http://banco.falso';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa';
delete process.env.OPENAI_API_KEY;

const U = '11111111-1111-4111-8111-111111111111';
const VENDA = '22222222-2222-4222-8222-222222222222';
const CLI = '33333333-3333-4333-8333-333333333333';
let gravou = null, rpcExiste = true, openai = 'ok';

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/auth/v1/user')) return json({ id: U });
  if (u.includes('api.openai.com')) {
    if (openai === 'erro') return json({ error: { message: 'x' } }, 429);
    return json({ choices: [{ message: { content: JSON.stringify({ riscos: [{ nivel: 'alto', categoria: 'documento', motivo: 'Destino exige visto pra esse passaporte.' }], texto: 'Olhe o visto primeiro.' }) } }] });
  }
  const p = decodeURIComponent(u.split('/rest/v1/')[1] || '');
  if (p.startsWith('qs_users')) return json([{ id: U, role: 'closer', setores: ['comercial'], is_active: true, name: 'Closer' }]);
  if (p.startsWith('rpc/venda_analise_gravar')) {
    if (!rpcExiste) return json({ code: 'PGRST202', message: 'Could not find the function public.venda_analise_gravar' }, 404);
    gravou = JSON.parse(opt.body); return json({ analise_id: 'a1', status: gravou.p_resultado.status, solicitacao_id: 's1', solicitacao_numero: 42, solicitacao_nova: true });
  }
  if (p.startsWith('qs_vendas')) return json([{ id: VENDA, origem: 'closer', criado_por: U, cliente_id: CLI, negocio_id: null, viagem_id: null, valor_total: 5000, pagamento: { forma: 'pix', condicao: 'avista' } }]);
  if (p.startsWith('qs_venda_itens')) return json([{ id: 'i1', tipo: 'hospedagem', nome: 'Hotel Lima', data_inicio: '2027-01-10', data_fim: '2027-01-12', dados: {}, passageiros: [], valor: 5000, custo: 4000, status: 'vendido' }]);
  if (p.startsWith('rel_clientes')) return json([{ nome: 'Maria Silva', passaporte_validade: '2030-01-01' }]);
  if (p.startsWith('qs_propostas')) return json([]);
  return json([]);
};

const { default: handler } = await import('../api/venda-analise.js');
function chamar(body) {
  return new Promise((ok) => {
    const res = { headers: {}, statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { ok({ status: this.statusCode, body: b }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  });
}

let ok = 0, falhou = 0;
const confere = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { falhou++; console.log(`  ✗ ${m}`); } };

let r = await chamar({ rascunho: { origem: 'closer', cliente: { nome: 'Maria Silva' }, itens: [{ tipo: 'pacote', nome: 'Pacote Peru', data_inicio: '2027-01-10' }], viajantes: [], pagamento: { forma: 'pix' }, total: 1000 } });
confere(r.status === 200 && r.body.gravado === false && r.body.contagens.falta === 1, 'rascunho: 200, nada gravado, 1 falta');
confere(r.body.ia.usada === false && /IA indispon/.test(r.body.ia.aviso), 'sem chave: modo regras + "análise por IA indisponível"');
confere(r.body.riscos.some((x) => x.categoria === 'sem_proposta' && x.nivel === 'alto'), 'pacote sem proposta = risco alto');

r = await chamar({ venda_id: VENDA, motivo: 'subir_venda' });
confere(r.status === 200 && r.body.gravado && r.body.solicitacao?.numero === 42 && gravou?.p_venda === VENDA, 'venda gravada: chama venda_analise_gravar e devolve a solicitação');
confere(typeof gravou.p_resultado.texto_extrato === 'string' && /FALTA EMITIR/.test(gravou.p_resultado.texto_extrato), 'manda o texto do extrato pra solicitação');

rpcExiste = false;
r = await chamar({ venda_id: VENDA });
confere(r.status === 200 && r.body.gravado === false && r.body.falta0230, 'sem a 0230: gravado false + falta0230');

process.env.OPENAI_API_KEY = 'sk-teste';
r = await chamar({ rascunho: { origem: 'ops', cliente: { nome: 'Maria' }, itens: [{ tipo: 'hospedagem', nome: 'H', status: 'emitido', dados: { localizador: 'X' } }], viajantes: [], pagamento: { forma: 'pix' }, total: 10 } });
confere(r.body.ia.usada && r.body.riscos.some((x) => x.fonte === 'ia') && r.body.status === 'risco_alto', 'com chave: IA soma risco alto e muda o status');
openai = 'erro';
r = await chamar({ rascunho: { origem: 'ops', cliente: { nome: 'Maria' }, itens: [], viajantes: [], pagamento: null, total: 0 } });
confere(r.status === 200 && r.body.ia.usada === false && /indispon/.test(r.body.ia.aviso), 'OpenAI com erro: cai pro modo regras sem derrubar');
r = await chamar({ venda_id: 'x' });
confere(r.status === 400, 'venda_id inválido = 400');

console.log(`\n${ok} ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
