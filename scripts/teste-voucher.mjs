// scripts/teste-voucher.mjs
// -----------------------------------------------------------------------------
// Teste OFFLINE da lógica da venda pelo voucher (api/_vendaVoucher.js).
// Não chama a OpenAI: usa respostas de exemplo do modelo em scripts/fixtures/
// e confere o pós-processamento (conexões, voo interno, avisos, roteiro).
//
//   node scripts/teste-voucher.mjs          (sai com código 1 se algo falhar)
//   node scripts/teste-voucher.mjs --ver    (mostra o resultado completo)
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { montarVenda, CHAVES_POR_TIPO, LEITURA, nomeLimpo, compararNomes } from '../api/_vendaVoucher.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(join(aqui, 'fixtures', n), 'utf8'));
const ver = process.argv.includes('--ver');

let ok = 0, falhou = 0;
function confere(cond, msg) {
  if (cond) { ok++; console.log(`  ✓ ${msg}`); } else { falhou++; console.log(`  ✗ ${msg}`); }
}
const temAviso = (r, re) => r.avisos.some((a) => re.test(a));
const CHAVES_ITEM = ['tipo', 'nome', 'data_inicio', 'data_fim', 'dados', 'passageiros', 'valor', 'custo', 'fornecedor'];
function formatoOk(r) {
  return JSON.stringify(Object.keys(r)) === JSON.stringify(['itens', 'pessoas', 'roteiro', 'avisos'])
    && r.itens.every((i) => JSON.stringify(Object.keys(i)) === JSON.stringify(CHAVES_ITEM))
    && r.roteiro.every((d) => typeof d.dia === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(d.data) && Array.isArray(d.atividades));
}

// ── 0. Catálogo: as chaves batem com src/propostas/lib.ts ────────────────────
console.log('\n0. Catálogo (CHAVES_POR_TIPO × TIPOS do lib.ts)');
{
  const lib = readFileSync(join(aqui, '..', 'src', 'propostas', 'lib.ts'), 'utf8');
  const bloco = lib.slice(lib.indexOf('export const TIPOS: Record<TipoItem, TipoInfo> = {'), lib.indexOf('export const ORDEM_TIPOS'));
  const doLib = {};
  let atual = null;
  for (const linha of bloco.split('\n')) {
    const t = /^ {2}(\w+): \{/.exec(linha);
    if (t) { atual = t[1]; doLib[atual] = []; }
    if (atual) for (const m of linha.matchAll(/chave: "(\w+)"/g)) doLib[atual].push(m[1]);
  }
  confere(JSON.stringify(Object.keys(doLib).sort()) === JSON.stringify(Object.keys(CHAVES_POR_TIPO).sort()), 'mesmos tipos do catálogo');
  for (const [tipo, chaves] of Object.entries(CHAVES_POR_TIPO)) {
    if (JSON.stringify(chaves) !== JSON.stringify(doLib[tipo])) confere(false, `chaves de ${tipo} iguais ao lib.ts (lib: ${doLib[tipo]})`);
  }
  confere(true, 'chaves de cada tipo iguais ao lib.ts');
  // Structured outputs strict: todo objeto precisa de additionalProperties:false e required = todas as chaves.
  const estrito = (s) => s.type !== 'object' || (s.additionalProperties === false
    && JSON.stringify(Object.keys(s.properties).sort()) === JSON.stringify([...s.required].sort())
    && Object.values(s.properties).every((p) => estrito(p.type === 'array' ? p.items : p)));
  confere(estrito(LEITURA), 'esquema LEITURA válido pro modo strict da OpenAI');
  confere(nomeLimpo('SILVA/MARIA CLARA MRS') === 'Maria Clara Silva', 'nome do bilhete "SOBRENOME/NOME MRS" vira "Maria Clara Silva"');
  confere(compararNomes('Maria Clara de Souza Silva', 'Maria Clara Silva') === 'parcial', 'nome sem o do meio = parcial');
}

// ── 1. Aéreo com voo interno no Japão ───────────────────────────────────────
console.log('\n1. Aéreo Japão (Emirates ida/volta + 2 voos internos JAL + doméstico GRU→NAT)');
{
  const r = montarVenda(fixture('voucher-aereo-japao.json'), {
    hoje: '2026-10-28',
    cadastro: [{ nome: 'Maria Clara de Souza Silva' }, { nome: 'João Pedro Silva' }],
  });
  if (ver) console.dir(r, { depth: 6 });
  confere(formatoOk(r), 'formato exato { itens, pessoas, roteiro, avisos }');
  const aereos = r.itens.filter((i) => i.tipo === 'aereo');
  const intl = aereos.find((i) => !/interno/i.test(i.nome));
  const internos = aereos.filter((i) => /interno/i.test(i.nome));
  confere(aereos.length === 3, `3 itens de aéreo (1 internacional + 2 internos) — veio ${aereos.length}`);
  confere(intl?.nome === 'Voo GRU → NRT (ida e volta)', `nome do internacional: "${intl?.nome}"`);
  confere(intl?.data_inicio === '2027-03-10' && intl?.data_fim === '2027-03-23', 'internacional: 10/03 a 23/03');
  const tr = intl?.dados.trechos || [];
  confere(tr.length === 5, `internacional tem 5 trechos (GRU-DXB-NRT, KIX-DXB-GRU-NAT) — veio ${tr.length}`);
  confere(tr.filter((t) => t.sentido === 'ida').length === 2 && tr.filter((t) => t.sentido === 'volta').length === 3, 'ida com 2 trechos, volta com 3');
  confere(tr[1]?.conexao === true && tr[0]?.conexao === false, 'DXB→NRT marcado como conexão');
  confere(tr.find((t) => t.voo === 'LA 3412')?.voo_interno === true, 'GRU→NAT (doméstico Brasil) marcado voo_interno');
  confere(tr.find((t) => t.voo === 'EK 262')?.voo_interno === false, 'GRU→DXB não é voo interno');
  confere(tr.find((t) => t.voo === 'EK 317')?.chegada_data === '2027-03-23', 'KIX→DXB 23:30→05:20 chega no dia seguinte');
  confere(internos.every((i) => i.dados.voo_interno === true && i.dados.trechos.every((t) => t.voo_interno)), 'internos HND→CTS e CTS→KIX com voo_interno');
  confere(internos[0]?.nome === 'Voo interno Tóquio → Sapporo', `nome do interno: "${internos[0]?.nome}"`);
  confere(intl?.valor === 15400 && intl?.custo === 14000, `valor/custo somados no internacional (${intl?.valor}/${intl?.custo})`);
  confere(intl?.dados.localizador === 'QWE7RT / LT55PQ', `localizadores juntos: ${intl?.dados.localizador}`);
  confere(intl?.passageiros.map((p) => p.nome).join(',') === 'Maria Clara Silva,João Pedro Silva', 'passageiros com nome limpo');
  confere(temAviso(r, /Conexão curta em DXB: 40 min/), 'aviso: conexão curta de 40 min em Dubai');
  confere(temAviso(r, /HND → CTS de 15\/03\/2027 sem horário de chegada/), 'aviso: trecho sem horário');
  confere(temAviso(r, /Passaporte de Maria Clara Silva vence 01\/07\/2027/), 'aviso: passaporte vence < 6 meses após a volta');
  confere(!temAviso(r, /Passaporte de João/), 'sem aviso pro passaporte do João (vence 2031)');
  confere(temAviso(r, /Nome no voucher "Maria Clara Silva" difere do cadastro "Maria Clara de Souza Silva"/), 'aviso: nome difere do cadastro');
  confere(!temAviso(r, /não bate com a soma/), 'total do voucher bate com a soma (sem aviso)');
  confere(temAviso(r, /2 voo\(s\) interno\(s\)/), 'aviso informativo dos voos internos');
  confere(r.pessoas.length === 2 && r.pessoas[0].cpf === '12345678909', 'pessoas sem duplicar, CPF só dígitos');
  confere(r.roteiro.length === 14, `roteiro de 14 dias (10 a 23/03) — veio ${r.roteiro.length}`);
  confere(r.roteiro[1]?.cidade === 'Tóquio', `dia 2 em Tóquio (${r.roteiro[1]?.cidade})`);
  confere(r.roteiro[5]?.cidade === 'Sapporo' && r.roteiro[5].atividades.some((a) => /Voo interno JL 503/.test(a)), 'dia 6 (15/03): voo interno pra Sapporo');
  confere(r.roteiro[8]?.cidade === 'Osaka', `dia 9 (18/03) em Osaka (${r.roteiro[8]?.cidade})`);
  confere(r.roteiro.at(-1)?.titulo === 'Retorno', 'último dia = Retorno');
}

// ── 2. Pacote Peru: hotel + transfer + trem + passeio ───────────────────────
console.log('\n2. Pacote Peru (2 hotéis + transfer + trem + passeio)');
{
  const r = montarVenda(fixture('voucher-pacote-peru.json'), { hoje: '2026-10-28', cadastro: [{ nome: 'Ana Souza' }, { nome: 'Carlos Souza' }] });
  if (ver) console.dir(r, { depth: 6 });
  confere(formatoOk(r), 'formato exato');
  confere(r.itens.map((i) => i.tipo).join(',') === 'hospedagem,transfer,hospedagem,trem,passeio', `itens em ordem de data: ${r.itens.map((i) => i.tipo)}`);
  const lima = r.itens[0];
  confere(lima.dados.regime === 'Café da manhã', `"Breakfast included" → "${lima.dados.regime}"`);
  confere(lima.dados.noites === '2' && lima.dados.quartos === '1', 'Lima: 2 noites, 1 quarto');
  const transfer = r.itens.find((i) => i.tipo === 'transfer');
  confere(transfer?.nome === 'Transfer Aeroporto de Lima → Hotel Casa Andina Miraflores' && transfer.dados.modalidade === 'Privativo' && transfer.dados.hora === '10:30', 'transfer com nome, modalidade e hora');
  const trem = r.itens.find((i) => i.tipo === 'trem');
  confere(trem?.dados.operadora === 'PeruRail' && trem.dados.saida === '06:40' && !('cor_do_vagao' in trem.dados), 'trem: chaves do catálogo, sem chave inventada');
  confere(!temAviso(r, /não bate com a soma/) && temAviso(r, /Soma dos valores lidos: R\$\s?9\.800,00/), 'soma 9.800 bate com o total');
  confere(temAviso(r, /Do voucher: Levar passaporte/), 'observação do voucher vira aviso');
  confere(temAviso(r, /Tierra Viva Cusco Plaza: faltou/) === false, 'hotel com datas não gera aviso de data');
  confere(!temAviso(r, /difere do cadastro|não aparece no voucher/), 'nomes batem com o cadastro');
  confere(r.roteiro.length === 6, `roteiro 04 a 09/05 = 6 dias — veio ${r.roteiro.length}`);
  confere(r.roteiro[0].cidade === 'Lima' && r.roteiro[0].hospedagem === 'Hotel Casa Andina Miraflores', 'dia 1 em Lima, no Casa Andina');
  confere(r.roteiro[3].atividades.some((a) => /PeruRail/.test(a)) && r.roteiro[3].atividades.some((a) => /Machu Picchu/.test(a)), 'dia 4 (07/05): trem + Machu Picchu');
  confere(r.roteiro[2].cidade === 'Cusco', 'dia 3 em Cusco');
}

// ── 3. Seguro avulso ────────────────────────────────────────────────────────
console.log('\n3. Seguro viagem avulso (viagem de 10 a 23/03 já conhecida)');
{
  const r = montarVenda(fixture('voucher-seguro.json'), {
    hoje: '2026-10-28', viagem: { data_inicio: '2027-03-10', data_fim: '2027-03-23' },
    cadastro: [{ nome: 'Maria Clara Silva', passaporte_validade: '2027-08-01' }, { nome: 'João Pedro Silva' }],
  });
  if (ver) console.dir(r, { depth: 6 });
  confere(formatoOk(r), 'formato exato');
  const s = r.itens[0];
  confere(r.itens.length === 1 && s.tipo === 'seguro' && s.nome === 'Seguro viagem — Assist Card — AC 60 Mundo', `item de seguro: "${s?.nome}"`);
  confere(s.dados.cobertura === 'USD 60.000' && s.dados.apolice === 'AC-2027-998877' && s.dados.vigencia === '10/03/2027 a 20/03/2027', 'cobertura, apólice e vigência');
  confere(s.valor === 612.4, 'valor total vai pro único item');
  confere(temAviso(r, /Seguro termina 20\/03\/2027, antes da volta \(23\/03\/2027\)/), 'aviso: seguro não cobre a volta');
  confere(temAviso(r, /Passaporte de Maria Clara Silva vence 01\/08\/2027/), 'aviso de passaporte usando a validade do cadastro');
  confere(s.passageiros.length === 2 && s.passageiros[1].nome === 'Joao Pedro Silva', 'segurados viram passageiros');
  confere(!temAviso(r, /difere do cadastro/), 'nome sem acento no voucher não conta como diferente');
  confere(r.roteiro.length === 14 && r.roteiro[0].atividades.includes('Começa a cobertura do seguro viagem'), 'roteiro usa as datas da viagem');
}

console.log(`\n${falhou ? '✗' : '✓'} ${ok} conferências ok, ${falhou} falharam.\n`);
process.exit(falhou ? 1 : 0);
