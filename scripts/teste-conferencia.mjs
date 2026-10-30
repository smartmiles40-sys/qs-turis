// scripts/teste-conferencia.mjs
// -----------------------------------------------------------------------------
// Teste OFFLINE da análise pós-venda (api/_vendaConferencia.js): o cruzamento
// determinístico proposta × venda × emitido e os riscos por regra. Sem banco,
// sem IA.
//
//   node scripts/teste-conferencia.mjs          (sai com código 1 se algo falhar)
//   node scripts/teste-conferencia.mjs --ver    (mostra os resultados)
// -----------------------------------------------------------------------------
import {
  conferirVenda, statusDaVenda, juntarRiscos, fecharAnalise, trechosDoTexto, evidencias, itemVendidoEmitido,
  RISCOS_IA, materialParaIa, textoDoExtrato,
} from '../api/_vendaConferencia.js';

const ver = process.argv.includes('--ver');
let ok = 0, falhou = 0;
function confere(cond, msg) { if (cond) { ok++; console.log(`  ✓ ${msg}`); } else { falhou++; console.log(`  ✗ ${msg}`); } }
const show = (r) => { if (ver) console.log(JSON.stringify(r, null, 2)); };
const temRisco = (r, cat, nivel) => r.riscos.some((x) => x.categoria === cat && (!nivel || x.nivel === nivel));
const linha = (r, re) => r.linhas.find((l) => re.test(l.nome));

const HOJE = '2026-10-30';
const PROPOSTA = { numero: 12, opcao: 'Japão clássico', total: 40000, adultos: 2, criancas: 0, bebes: 0 };
const AEREO = {
  tipo: 'aereo', nome: 'Aéreo Japão', valor_total: 20000, custo: 17000, quantidade: 2,
  detalhes: { trechos: [
    { sentido: 'ida', origem: 'GRU', destino: 'NRT', data: '2027-03-10', saida: '10:00', chegada: '18:00', chegada_data: '2027-03-11', cia: 'JL', voo: 'JL 45' },
    { sentido: 'interno', origem: 'HND', destino: 'KIX', data: '2027-03-15', saida: '09:00', chegada: '10:15', chegada_data: '', cia: 'JL', voo: 'JL 123' },
    { sentido: 'volta', origem: 'KIX', destino: 'GRU', data: '2027-03-20', saida: '22:00', chegada: '08:00', chegada_data: '2027-03-21', cia: 'JL', voo: 'JL 46' },
  ] },
};
const HOTEL = { tipo: 'hospedagem', nome: 'Hotel Gracery Shinjuku', data_inicio: '2027-03-11', data_fim: '2027-03-15', valor_total: 8000, custo: 7000, quantidade: 1 };
const SEGURO = { tipo: 'seguro', nome: 'Seguro viagem', data_inicio: '2027-03-10', data_fim: '2027-03-21', valor_total: 600, custo: 400, quantidade: 2 };
const PESSOAS = [{ nome: 'Maria Clara Silva', passaporte_validade: '2030-01-01' }, { nome: 'João Pedro Silva', passaporte_validade: '2029-05-01' }];
const PAG = { forma: 'pix', condicao: 'avista', parcelas: 1 };
const TRECHO = (o, d, ini, fim, extra = {}) => ({ fonte: 'trecho', tipo: 'aereo', trecho: { origem_codigo: o, destino_codigo: d, partida_em: ini, chegada_em: fim, localizador: 'ABC123', numero: extra.voo || '', passageiros: extra.pax || ['SILVA/MARIA CLARA', 'SILVA/JOAO PEDRO'] } });

// ── 1. Proposta: falta voo interno e seguro ─────────────────────────────────
console.log('\n1. Proposta × emitido — falta o voo interno e o seguro');
{
  const r = conferirVenda({
    hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO, HOTEL, SEGURO],
    vendido: [{ tipo: 'aereo', nome: 'Aéreo' }, { tipo: 'hospedagem', nome: 'Hotel Gracery', data_inicio: '2027-03-11', data_fim: '2027-03-15', status: 'emitido', dados: { localizador: 'HTL9' }, passageiros: [{ nome: 'Maria Clara Silva' }, { nome: 'João Pedro Silva' }] }, { tipo: 'seguro', nome: 'Seguro' }],
    emitido: [
      TRECHO('GRU', 'NRT', '2027-03-10T13:00:00Z', '2027-03-11T09:00:00Z', { voo: 'JL45' }),
      TRECHO('KIX', 'GRU', '2027-03-20T13:00:00Z', '2027-03-21T11:00:00Z', { voo: 'JL46' }),
    ],
    pessoas: PESSOAS, pagamento: PAG, total_venda: 40000,
  });
  show(r);
  confere(r.base === 'proposta', 'base = proposta');
  confere(r.contagens.ok === 3 && r.contagens.falta === 2, `3 ok e 2 faltando (veio ${r.contagens.ok}/${r.contagens.falta})`);
  confere(linha(r, /HND → KIX/)?.situacao === 'falta' && linha(r, /HND → KIX/)?.voo_interno, 'HND → KIX = falta, voo interno');
  confere(temRisco(r, 'voo_interno', 'alto'), 'risco alto: voo interno sem bilhete');
  confere(r.status === 'risco_alto', 'status = risco_alto');
  confere(r.faltam.length === 2 && r.faltam.some((f) => /Seguro/.test(f)), 'extrato lista o seguro em "falta emitir"');
  confere(/FALTA EMITIR/.test(textoDoExtrato(r)), 'texto do extrato pra solicitação');
}

// ── 2. Tudo emitido ─────────────────────────────────────────────────────────
console.log('\n2. Tudo emitido');
{
  const r = conferirVenda({
    hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO, HOTEL, SEGURO],
    vendido: [{ tipo: 'aereo', nome: 'Aéreo' }, { tipo: 'hospedagem', nome: 'Hotel' }, { tipo: 'seguro', nome: 'Seguro' }],
    emitido: [
      TRECHO('GRU', 'NRT', '2027-03-10T13:00:00Z', '2027-03-11T09:00:00Z'),
      TRECHO('HND', 'KIX', '2027-03-15T00:00:00Z', '2027-03-15T01:15:00Z'),
      TRECHO('KIX', 'GRU', '2027-03-20T13:00:00Z', '2027-03-21T11:00:00Z'),
      { fonte: 'venda', tipo: 'hospedagem', nome: 'Gracery Shinjuku', data_inicio: '2027-03-11', data_fim: '2027-03-15', localizador: 'H1' },
      { fonte: 'venda', tipo: 'seguro', nome: 'Assist Card', data_inicio: '2027-03-10', data_fim: '2027-03-21', localizador: 'AP1', passageiros: ['Maria Clara Silva', 'João Pedro Silva'] },
    ],
    pessoas: PESSOAS, pagamento: PAG, total_venda: 40000,
  });
  show(r);
  confere(r.contagens.ok === 5 && r.contagens.falta === 0 && r.contagens.divergente === 0, `5 de 5 ok (veio ${JSON.stringify(r.contagens)})`);
  confere(!r.riscos.some((x) => x.nivel === 'alto'), 'sem risco alto');
  confere(r.status === 'tudo_emitido', `status = tudo_emitido (veio ${r.status})`);
}

// ── 3. Divergências: data do hotel e data do voo ────────────────────────────
console.log('\n3. Divergências');
{
  const r = conferirVenda({
    hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO, HOTEL],
    vendido: [{ tipo: 'aereo', nome: 'Aéreo' }, { tipo: 'hospedagem', nome: 'Hotel' }],
    emitido: [
      TRECHO('GRU', 'NRT', '2027-03-12T13:00:00Z', '2027-03-13T09:00:00Z'),
      TRECHO('HND', 'KIX', '2027-03-15T00:00:00Z', '2027-03-15T01:15:00Z', { pax: ['SILVA/MARIA CLARA'] }),
      TRECHO('KIX', 'GRU', '2027-03-20T13:00:00Z', '2027-03-21T11:00:00Z'),
      { fonte: 'venda', tipo: 'hospedagem', nome: 'Gracery Shinjuku', data_inicio: '2027-03-12', data_fim: '2027-03-15', localizador: 'H1' },
      { fonte: 'venda', tipo: 'transfer', nome: 'Transfer Narita', data_inicio: '2027-03-11', localizador: 'T1' },
    ],
    pessoas: PESSOAS, pagamento: PAG,
  });
  show(r);
  confere(/data diferente/.test(linha(r, /GRU → NRT/)?.motivos.join(' ') || ''), 'GRU → NRT: data diferente');
  confere(/1 de 2/.test(linha(r, /HND → KIX/)?.motivos.join(' ') || ''), 'HND → KIX: bilhete com 1 de 2 passageiros');
  confere(linha(r, /Gracery/)?.situacao === 'divergente' && /início diferente/.test(linha(r, /Gracery/).motivos[0]), 'hotel: início diferente');
  confere(linha(r, /Transfer/)?.situacao === 'extra', 'transfer emitido fora da proposta = extra');
  confere(r.status === 'divergencia' || r.status === 'risco_alto', `status = divergência (ou risco) — veio ${r.status}`);
}

// ── 4. Sem proposta: pacote ─────────────────────────────────────────────────
console.log('\n4. Sem proposta');
{
  const r = conferirVenda({ hoje: HOJE, vendido: [{ tipo: 'pacote', nome: 'Pacote Peru', data_inicio: '2027-05-01', data_fim: '2027-05-10', valor: 15000 }], pessoas: PESSOAS, pagamento: PAG });
  show(r);
  confere(r.base === 'venda', 'base = venda');
  confere(temRisco(r, 'sem_proposta', 'alto'), 'pacote sem proposta = risco alto');
  confere(r.contagens.falta === 1, 'pacote não emitido = falta');
  const r2 = conferirVenda({ hoje: HOJE, vendido: [{ tipo: 'hospedagem', nome: 'Hotel', data_inicio: '2027-05-01', data_fim: '2027-05-03', status: 'emitido', dados: { localizador: 'X' } }] });
  confere(r2.contagens.ok === 1 && r2.contagens.extra === 0, 'item vendido emitido conta como ok (sem duplicar como extra)');
  confere(temRisco(r2, 'sem_proposta', 'medio'), 'hotel sem proposta = risco médio');
  const r3 = conferirVenda({ hoje: HOJE, vendido: [{ tipo: 'expedicao', nome: 'Expedição Japão 2027' }], viajantes: [{ nome: 'Maria', valor_contratado: 20000, valor_pago: 20000 }] });
  confere(!temRisco(r3, 'sem_proposta'), 'expedição pura não exige proposta');
  confere(r3.contagens.ok === 1, 'expedição com viajante = ok (vaga)');
}

// ── 5. Passaporte ───────────────────────────────────────────────────────────
console.log('\n5. Passaporte');
{
  const r = conferirVenda({ hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO], vendido: [{ tipo: 'aereo', nome: 'A' }], pessoas: [{ nome: 'Maria Clara Silva', passaporte_validade: '2027-06-01' }, { nome: 'João Pedro Silva', passaporte_validade: null }] });
  confere(r.riscos.some((x) => x.categoria === 'passaporte' && x.nivel === 'alto' && /Maria/.test(x.motivo)), 'vence < 6 meses depois da volta = alto');
  confere(r.riscos.some((x) => x.categoria === 'passaporte' && x.nivel === 'medio' && /João/.test(x.motivo)), 'sem validade no cadastro = médio');
}

// ── 6. Conexão curta ────────────────────────────────────────────────────────
console.log('\n6. Conexão curta (horário real dos trechos emitidos)');
{
  const r = conferirVenda({
    hoje: HOJE, vendido: [{ tipo: 'aereo', nome: 'Aéreo', status: 'emitido' }],
    emitido: [
      TRECHO('NAT', 'GRU', '2027-03-10T09:00:00Z', '2027-03-10T12:00:00Z', { voo: 'G3 1' }),
      TRECHO('GRU', 'NRT', '2027-03-10T12:30:00Z', '2027-03-11T09:00:00Z', { voo: 'JL 45' }),
    ],
    pessoas: PESSOAS,
  });
  show(r);
  confere(r.riscos.some((x) => x.categoria === 'conexao' && x.nivel === 'alto' && /30 min/.test(x.motivo)), 'conexão de 30 min = alto');
}

// ── 7. Nome diferente ───────────────────────────────────────────────────────
console.log('\n7. Nome emitido × cadastro');
{
  const r = conferirVenda({ hoje: HOJE, vendido: [], emitido: [TRECHO('GRU', 'LIM', '2027-03-10T09:00:00Z', '2027-03-10T15:00:00Z', { pax: ['SOUZA/CARLOS', 'SILVA/MARIA'] })], pessoas: PESSOAS });
  confere(r.riscos.some((x) => x.categoria === 'nome' && x.nivel === 'alto' && /Carlos/.test(x.motivo)), 'pessoa que não está no cadastro = alto');
  confere(r.riscos.some((x) => x.categoria === 'nome' && x.nivel === 'medio' && /Maria Silva/.test(x.motivo)), 'nome abreviado = médio');
}

// ── 8. Margem e pagamento ───────────────────────────────────────────────────
console.log('\n8. Margem e pagamento');
{
  const r = conferirVenda({
    hoje: HOJE, vendido: [{ tipo: 'hospedagem', nome: 'Hotel', data_inicio: '2026-11-05', data_fim: '2026-11-08', valor: 1000, custo: 1200 }, { tipo: 'expedicao', nome: 'Expedição' }],
    viajantes: [{ nome: 'Maria', valor_contratado: 10000, valor_pago: 2000 }],
    pagamento: { forma: '', condicao: 'entrada', entrada: null, entrada_data: null },
  });
  show(r);
  confere(temRisco(r, 'margem', 'alto'), 'custo > venda = margem negativa alto');
  confere(temRisco(r, 'pagamento', 'alto'), 'falta receber e embarca em < 30 dias = alto');
  confere(r.riscos.some((x) => /Forma de pagamento/.test(x.motivo)), 'forma de pagamento vazia');
  confere(temRisco(r, 'prazo', 'alto'), 'embarque em 6 dias com hotel por emitir = alto');
}

// ── 9. Documento solto e texto de voos ──────────────────────────────────────
console.log('\n9. Documento (PDF) e texto dos voos');
{
  const t = trechosDoTexto('GRU → NRT 10/03/2027 10:00–18:00 (chega 11/03/2027) JL 45\nHND → KIX 15/03/2027 09:00–10:15 JL 123 (voo interno)');
  confere(t.length === 2 && t[0].data === '2027-03-10' && t[1].origem === 'HND' && t[1].voo === 'JL 123', 'lê o texto "voos" do voucher');
  confere(itemVendidoEmitido({ status: 'vendido', dados: { localizador: 'X1' } }) && !itemVendidoEmitido({ status: 'vendido', dados: {} }), 'localizador = emitido');
  const r = conferirVenda({ hoje: HOJE, proposta: PROPOSTA, apresentado: [SEGURO, HOTEL], vendido: [{ tipo: 'seguro' }, { tipo: 'hospedagem' }], emitido: [{ fonte: 'documento', doc_tipo: 'seguro', nome: 'apolice.pdf' }] });
  confere(linha(r, /Seguro/)?.situacao === 'ok' && /arquivo/.test(linha(r, /Seguro/).nota), 'PDF de seguro cobre o seguro (nota: datas não conferidas)');
  confere(linha(r, /Gracery/)?.situacao === 'falta', 'o mesmo PDF não cobre o hotel');
  confere(evidencias([{ fonte: 'documento', doc_tipo: 'comprovante' }]).length === 0, 'comprovante de pagamento não é emissão');
}

// ── 10. Status, IA e esquema ────────────────────────────────────────────────
console.log('\n10. Status, junção com a IA e esquema');
{
  confere(statusDaVenda({ ok: 1, falta: 0, divergente: 0, extra: 0 }, []) === 'tudo_emitido', 'tudo ok → tudo_emitido');
  confere(statusDaVenda({ falta: 1 }, [{ nivel: 'medio' }]) === 'faltam_emissoes', 'falta → faltam_emissoes');
  confere(statusDaVenda({ falta: 1, divergente: 1 }, []) === 'divergencia', 'divergência ganha de falta');
  confere(statusDaVenda({ falta: 0 }, [{ nivel: 'alto' }]) === 'risco_alto', 'risco alto ganha de tudo');
  const j = juntarRiscos([{ nivel: 'medio', categoria: 'seguro', motivo: 'Viagem internacional sem seguro viagem na venda.', fonte: 'regra' }],
    [{ nivel: 'alto', categoria: 'documento', motivo: 'Japão exige visto pra este passaporte.' }, { nivel: 'medio', categoria: 'seguro', motivo: 'Viagem internacional sem seguro viagem.' }, { nivel: 'xx', categoria: 'outro', motivo: 'lixo' }]);
  confere(j.length === 2 && j[0].fonte === 'ia' && j[0].nivel === 'alto', 'IA soma risco novo, não repete o parecido, ignora nível inválido');
  const base = conferirVenda({ hoje: HOJE, vendido: [{ tipo: 'expedicao', nome: 'E' }], viajantes: [{ nome: 'A', valor_contratado: 1, valor_pago: 1 }] });
  const f = fecharAnalise(base, [{ nivel: 'alto', categoria: 'outro', motivo: 'Algo grave' }], { usada: true });
  confere(f.status === 'risco_alto' && f.ia.usada, 'fecharAnalise recalcula o status com a IA');
  const estrito = (s) => s.type !== 'object' || (s.additionalProperties === false && JSON.stringify(Object.keys(s.properties).sort()) === JSON.stringify([...s.required].sort()) && Object.values(s.properties).every((p) => estrito(p.type === 'array' ? p.items : p)));
  confere(estrito(RISCOS_IA), 'esquema da IA é estrito (structured outputs)');
  const m = materialParaIa({ hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO], vendido: [], pessoas: [{ nome: 'MARIA', passaporte_validade: '2030-01-01', cpf: '123' }] }, conferirVenda({ hoje: HOJE, proposta: PROPOSTA, apresentado: [AEREO] }));
  confere(!JSON.stringify(m).includes('"cpf"') && m.extrato.length === 3, 'material da IA sem CPF, com o extrato');
}

console.log(`\n${ok} ok, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
