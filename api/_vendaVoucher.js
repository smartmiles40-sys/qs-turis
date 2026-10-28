// api/_vendaVoucher.js
// -----------------------------------------------------------------------------
// A "LÓGICA DA VENDA" do voucher (Bruno 28/10/2026: "só subir o voucher e a IA
// já preencher tudo, inclusive se tem voos internos").
//
// A IA só LÊ o voucher e devolve uma LEITURA crua (voos, hotéis, seguros,
// serviços, pessoas — esquema LEITURA abaixo). Quem monta a venda é ESTE
// arquivo, no servidor, sem IA: o resultado é previsível e testável offline
// (scripts/teste-voucher.mjs roda aqui em cima com respostas de exemplo).
//
//   montarVenda(leitura, { cadastro, hoje }) → { itens, pessoas, roteiro, avisos }
//
// O que ele faz:
//   • ordena os trechos, junta os que são CONEXÃO (sai de onde o anterior
//     chegou, em até 24h) numa jornada só;
//   • marca voo_interno quando origem e destino estão no MESMO país (doméstico
//     no Brasil ou dentro do país de destino); jornada que sai do Brasil = ida,
//     que volta pro Brasil = volta, o resto = interna;
//   • um item de aéreo pras jornadas internacionais (ida + volta) e um item
//     separado por voo interno no destino;
//   • datas de início/fim da viagem, soma dos valores, roteiro dia a dia;
//   • avisos: passaporte que vence < 6 meses após a volta, nome do voucher que
//     difere do cadastro, trecho sem horário, conexão curta, seguro que não
//     cobre a viagem, check-out antes do check-in…
//
// Os tipos e as chaves de `dados` seguem o catálogo único (TIPOS em
// src/propostas/lib.ts). CHAVES_POR_TIPO abaixo é só o filtro das chaves que a
// IA pode mandar em `servicos[].detalhes`; o teste confere que ele bate com o
// lib.ts (se mudar lá, o teste avisa).
// -----------------------------------------------------------------------------

// ── Esquema da LEITURA (o que a IA devolve — structured outputs, strict) ──────
const S = { type: ['string', 'null'] };
const N = { type: ['number', 'null'] };
const LISTA_S = { type: 'array', items: { type: 'string' } };
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

export const TIPOS_SERVICO = ['transfer', 'trem', 'passeio', 'carro', 'cruzeiro', 'visto', 'pacote', 'expedicao', 'concierge', 'outro'];

export const LEITURA = obj({
  legivel: { type: 'boolean', description: 'false se não for voucher/reserva/bilhete ou estiver ilegível' },
  moeda: { ...S, description: 'moeda dos valores (BRL, USD, EUR…)' },
  valor_total: { ...N, description: 'valor total da reserva, se aparecer' },
  voos: {
    type: 'array', description: 'UM item por voo (ida com conexão = vários voos)',
    items: obj({
      origem: { ...S, description: 'código IATA da origem (3 letras)' },
      origem_cidade: S, origem_pais: { ...S, description: 'país da origem, em português' },
      destino: { ...S, description: 'código IATA do destino' },
      destino_cidade: S, destino_pais: S,
      data: { ...S, description: 'data da partida AAAA-MM-DD (hora local)' },
      hora_saida: { ...S, description: 'HH:MM local' },
      chegada_data: { ...S, description: 'data da chegada AAAA-MM-DD, se for outro dia' },
      hora_chegada: { ...S, description: 'HH:MM local' },
      cia: S, voo: { ...S, description: 'número do voo, ex.: JL 45' },
      localizador: S, classe: S, bagagem: { ...S, description: 'franquia de bagagem despachada, como impressa' },
      passageiros: LISTA_S, valor: N, custo: N,
    }),
  },
  hospedagens: {
    type: 'array',
    items: obj({
      hotel: S, cidade: S, pais: S,
      checkin: { ...S, description: 'AAAA-MM-DD' }, checkout: { ...S, description: 'AAAA-MM-DD' },
      checkin_hora: S, checkout_hora: S, regime: S, quarto: S, quartos: N, endereco: S,
      localizador: S, fornecedor: S, passageiros: LISTA_S, valor: N, custo: N,
    }),
  },
  seguros: {
    type: 'array',
    items: obj({
      seguradora: S, plano: S, cobertura: { ...S, description: 'cobertura médica, ex.: USD 60.000' }, apolice: S,
      inicio: { ...S, description: 'AAAA-MM-DD' }, fim: { ...S, description: 'AAAA-MM-DD' },
      segurados: LISTA_S, valor: N, custo: N,
    }),
  },
  servicos: {
    type: 'array', description: 'transfer, trem, passeio, carro, cruzeiro, visto, pacote etc.',
    items: obj({
      tipo: { type: 'string', enum: TIPOS_SERVICO },
      nome: S, data_inicio: S, data_fim: S, cidade: S, hora: S, de: S, para: S, fornecedor: S,
      detalhes: { type: 'array', items: obj({ chave: { type: 'string' }, valor: { type: 'string' } }) },
      passageiros: LISTA_S, valor: N, custo: N,
    }),
  },
  pessoas: {
    type: 'array',
    items: obj({ nome: { type: 'string' }, cpf: S, passaporte: S, nascimento: S, validade_passaporte: S }),
  },
  observacoes: { ...LISTA_S, description: 'algo importante do voucher que não coube acima, curto, em português' },
});

export const INSTRUCAO =
  'Você lê vouchers, bilhetes aéreos, reservas de hotel, apólices de seguro e e-mails de confirmação para uma ' +
  'agência de viagens brasileira. Leia SOMENTE o que está escrito e preencha os campos. Não invente: o que não ' +
  'aparece fica null (ou lista vazia). Datas AAAA-MM-DD, horas HH:MM no horário LOCAL impresso. Cada voo é um item ' +
  '(ida com conexão = dois voos). Códigos de aeroporto em IATA (3 letras). Países em português. Nomes de ' +
  'passageiros como impressos (SOBRENOME/NOME vira "Nome Sobrenome"). Valores como número, sem símbolo. ' +
  'Em servicos.detalhes use chaves simples (modalidade, operadora, numero, saida, chegada, classe, assento, local, ' +
  'duracao, locadora, categoria, retirada_local, devolucao_local, navio, cabine, destino, inclui, pais, tipo_visto).';

// ── Catálogo (espelho das CHAVES de TIPOS em src/propostas/lib.ts) ───────────
export const CHAVES_POR_TIPO = {
  aereo: ['companhia', 'voos', 'classe', 'item_pessoal', 'bagagem_mao', 'bagagem_despachada', 'localizador'],
  hospedagem: ['cidade', 'estrelas', 'quarto', 'quartos', 'regime', 'checkin_hora', 'checkout_hora', 'endereco'],
  transfer: ['modalidade', 'hora', 'de', 'para'],
  trem: ['operadora', 'numero', 'de', 'para', 'saida', 'chegada', 'classe', 'assento'],
  passeio: ['local', 'hora', 'duracao', 'modalidade'],
  seguro: ['seguradora', 'plano', 'cobertura', 'apolice'],
  carro: ['locadora', 'categoria', 'retirada_local', 'retirada_hora', 'devolucao_local', 'devolucao_hora'],
  cruzeiro: ['companhia', 'navio', 'cabine', 'regime', 'porto_embarque', 'porto_desembarque'],
  visto: ['pais', 'tipo_visto', 'prazo'],
  pacote: ['destino', 'operadora', 'hoteis', 'inclui'],
  expedicao: ['expedicao', 'edicao', 'grupo', 'quarto', 'divide_quarto_com'],
  concierge: ['descricao'],
  outro: [],
};
const REGIMES = ['Sem refeição', 'Café da manhã', 'Meia pensão', 'Pensão completa', 'All inclusive'];

// ── Utilidades ───────────────────────────────────────────────────────────────
const txt = (v) => (v == null ? '' : String(v).trim());
const semAcento = (s) => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const nomeNorm = (s) => semAcento(s).toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const dataOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(txt(s)) && !Number.isNaN(Date.parse(`${txt(s)}T12:00:00Z`)) ? txt(s) : '');
const horaOk = (s) => { const m = /^(\d{1,2})[:h](\d{2})/.exec(txt(s)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const BR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const minutos = (data, hora) => (data && hora ? Date.parse(`${data}T${hora}:00Z`) / 60_000 : null);
const moedaBR = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const unicos = (arr) => [...new Set(arr.filter(Boolean))];

/** País → chave curta ("Japão", "Japan", "JP" → "jp"). */
const PAISES = {
  brasil: 'br', brazil: 'br', br: 'br', peru: 'pe', chile: 'cl', argentina: 'ar', egito: 'eg', egypt: 'eg',
  'emirados arabes unidos': 'ae', 'emirados arabes': 'ae', uae: 'ae', japao: 'jp', japan: 'jp', jp: 'jp', china: 'cn', cn: 'cn',
  tailandia: 'th', thailand: 'th', islandia: 'is', iceland: 'is', turquia: 'tr', turkiye: 'tr', turkey: 'tr', grecia: 'gr', greece: 'gr',
  italia: 'it', italy: 'it', espanha: 'es', spain: 'es', portugal: 'pt', franca: 'fr', france: 'fr',
  'estados unidos': 'us', eua: 'us', usa: 'us', us: 'us', catar: 'qa', qatar: 'qa', colombia: 'co', 'coreia do sul': 'kr',
  'south korea': 'kr', quenia: 'ke', kenya: 'ke', noruega: 'no', norway: 'no', suica: 'ch', switzerland: 'ch',
  'reino unido': 'gb', inglaterra: 'gb', uk: 'gb', indonesia: 'id', panama: 'pa', mexico: 'mx', alemanha: 'de', germany: 'de',
  holanda: 'nl', netherlands: 'nl', 'africa do sul': 'za', marrocos: 'ma', jordania: 'jo', india: 'in', vietna: 'vn', australia: 'au',
};
const paisChave = (p) => { const k = semAcento(p).toLowerCase().trim(); return k ? (PAISES[k] || k) : ''; };

/** Aeroportos mais comuns da agência: IATA → [país, cidade]. Só complementa o que a IA não disse. */
const IATA = {
  GRU: ['br', 'São Paulo'], CGH: ['br', 'São Paulo'], VCP: ['br', 'Campinas'], GIG: ['br', 'Rio de Janeiro'], SDU: ['br', 'Rio de Janeiro'],
  BSB: ['br', 'Brasília'], CNF: ['br', 'Belo Horizonte'], NAT: ['br', 'Natal'], REC: ['br', 'Recife'], FOR: ['br', 'Fortaleza'],
  SSA: ['br', 'Salvador'], POA: ['br', 'Porto Alegre'], CWB: ['br', 'Curitiba'], FLN: ['br', 'Florianópolis'], BEL: ['br', 'Belém'],
  MAO: ['br', 'Manaus'], GYN: ['br', 'Goiânia'], VIX: ['br', 'Vitória'], MCZ: ['br', 'Maceió'], JPA: ['br', 'João Pessoa'],
  NRT: ['jp', 'Tóquio'], HND: ['jp', 'Tóquio'], KIX: ['jp', 'Osaka'], ITM: ['jp', 'Osaka'], CTS: ['jp', 'Sapporo'], FUK: ['jp', 'Fukuoka'],
  OKA: ['jp', 'Okinawa'], NGO: ['jp', 'Nagoya'], HIJ: ['jp', 'Hiroshima'],
  PEK: ['cn', 'Pequim'], PKX: ['cn', 'Pequim'], PVG: ['cn', 'Xangai'], SHA: ['cn', 'Xangai'], CAN: ['cn', 'Cantão'], XIY: ['cn', "Xi'an"],
  CTU: ['cn', 'Chengdu'], TFU: ['cn', 'Chengdu'], KWL: ['cn', 'Guilin'], CKG: ['cn', 'Chongqing'],
  IST: ['tr', 'Istambul'], SAW: ['tr', 'Istambul'], NAV: ['tr', 'Capadócia'], ASR: ['tr', 'Kayseri'], ADB: ['tr', 'Izmir'], AYT: ['tr', 'Antália'],
  LIM: ['pe', 'Lima'], CUZ: ['pe', 'Cusco'], AQP: ['pe', 'Arequipa'], SCL: ['cl', 'Santiago'], CJC: ['cl', 'Calama'], PUQ: ['cl', 'Punta Arenas'],
  EZE: ['ar', 'Buenos Aires'], AEP: ['ar', 'Buenos Aires'], FTE: ['ar', 'El Calafate'], USH: ['ar', 'Ushuaia'], BRC: ['ar', 'Bariloche'],
  CAI: ['eg', 'Cairo'], LXR: ['eg', 'Luxor'], ASW: ['eg', 'Assuã'], DXB: ['ae', 'Dubai'], AUH: ['ae', 'Abu Dhabi'], DOH: ['qa', 'Doha'],
  BKK: ['th', 'Bangkok'], DMK: ['th', 'Bangkok'], CNX: ['th', 'Chiang Mai'], HKT: ['th', 'Phuket'], KEF: ['is', 'Reykjavík'],
  LIS: ['pt', 'Lisboa'], OPO: ['pt', 'Porto'], MAD: ['es', 'Madri'], BCN: ['es', 'Barcelona'], CDG: ['fr', 'Paris'], ORY: ['fr', 'Paris'],
  FCO: ['it', 'Roma'], MXP: ['it', 'Milão'], VCE: ['it', 'Veneza'], ATH: ['gr', 'Atenas'], JTR: ['gr', 'Santorini'], JMK: ['gr', 'Mykonos'],
  FRA: ['de', 'Frankfurt'], MUC: ['de', 'Munique'], AMS: ['nl', 'Amsterdã'], LHR: ['gb', 'Londres'], ZRH: ['ch', 'Zurique'],
  JFK: ['us', 'Nova York'], EWR: ['us', 'Nova York'], MIA: ['us', 'Miami'], MCO: ['us', 'Orlando'], ATL: ['us', 'Atlanta'],
  PTY: ['pa', 'Cidade do Panamá'], BOG: ['co', 'Bogotá'], MEX: ['mx', 'Cidade do México'], CUN: ['mx', 'Cancún'],
  ICN: ['kr', 'Seul'], NBO: ['ke', 'Nairóbi'], JNB: ['za', 'Joanesburgo'], CPT: ['za', 'Cidade do Cabo'], CMN: ['ma', 'Casablanca'],
  RAK: ['ma', 'Marrakech'], AMM: ['jo', 'Amã'], DEL: ['in', 'Nova Délhi'], SGN: ['vn', 'Ho Chi Minh'], HAN: ['vn', 'Hanói'],
  DPS: ['id', 'Bali'], SYD: ['au', 'Sydney'], OSL: ['no', 'Oslo'], TOS: ['no', 'Tromsø'],
};

/** 'igual' | 'parcial' (um contém o outro, ex.: sem o nome do meio) | 'diferente' | null */
export function compararNomes(a, b) {
  const P = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
  const ta = nomeNorm(a).split(' ').filter((t) => t && !P.has(t));
  const tb = nomeNorm(b).split(' ').filter((t) => t && !P.has(t));
  if (!ta.length || !tb.length) return null;
  if (ta.join(' ') === tb.join(' ')) return 'igual';
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const contidos = menor.filter((t) => maior.includes(t)).length;
  if (contidos === menor.length) return 'parcial';
  return contidos >= 2 && contidos / menor.length >= 0.5 ? 'parcial' : 'diferente';
}
/** "SILVA/MARIA CLARA MRS" → "Maria Clara Silva". */
export function nomeLimpo(s) {
  let n = txt(s).replace(/\b(MRS|MR|MS|MISS|MSTR|CHD|INF|SR|SRA)\.?$/i, '').trim();
  if (n.includes('/')) { const [sob, nome] = n.split('/'); n = `${nome} ${sob}`; }
  return n.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (p) => p.toLowerCase());
}

// ── Voos: normalizar, juntar conexões, voo interno ───────────────────────────
function normalizarVoo(v) {
  const origem = txt(v.origem).toUpperCase().slice(0, 3);
  const destino = txt(v.destino).toUpperCase().slice(0, 3);
  const data = dataOk(v.data);
  const hs = horaOk(v.hora_saida), hc = horaOk(v.hora_chegada);
  let chegada_data = dataOk(v.chegada_data) || data;
  // Chegada "antes" da saída no mesmo dia = chegou no dia seguinte (voo noturno).
  if (data && chegada_data === data && hs && hc && hc < hs) chegada_data = somaDias(data, 1);
  return {
    origem, destino,
    origem_cidade: txt(v.origem_cidade) || IATA[origem]?.[1] || '',
    destino_cidade: txt(v.destino_cidade) || IATA[destino]?.[1] || '',
    origem_pais: paisChave(v.origem_pais) || IATA[origem]?.[0] || '',
    destino_pais: paisChave(v.destino_pais) || IATA[destino]?.[0] || '',
    data, hora_saida: hs, chegada_data, hora_chegada: hc,
    cia: txt(v.cia), voo: txt(v.voo).toUpperCase(), localizador: txt(v.localizador).toUpperCase(),
    classe: txt(v.classe), bagagem: txt(v.bagagem),
    passageiros: (v.passageiros || []).map(nomeLimpo).filter(Boolean),
    valor: num(v.valor), custo: num(v.custo),
  };
}
const chaveOrdem = (t) => `${t.data || '9999-99-99'}T${t.hora_saida || '99:99'}`;

/** Junta trechos em JORNADAS: o próximo sai de onde o anterior chegou, em até 24h → conexão. */
export function jornadasDe(trechos, avisos) {
  const ordenados = [...trechos].sort((a, b) => chaveOrdem(a).localeCompare(chaveOrdem(b)));
  const jornadas = [];
  for (const t of ordenados) {
    const ult = jornadas.at(-1)?.at(-1);
    let conecta = false;
    if (ult && ult.destino && ult.destino === t.origem) {
      const chegou = minutos(ult.chegada_data, ult.hora_chegada);
      const sai = minutos(t.data, t.hora_saida);
      if (chegou != null && sai != null) {
        const espera = sai - chegou;
        conecta = espera >= 0 && espera <= 24 * 60;
        if (conecta) {
          t.conexao_min = espera;
          const internacional = ult.origem_pais !== t.destino_pais;
          if (espera < (internacional ? 90 : 45)) avisos.push(`Conexão curta em ${t.origem}: ${espera} min entre ${ult.voo || 'o voo anterior'} e ${t.voo || 'o próximo'}.`);
        }
      } else if (ult.chegada_data && t.data) {
        conecta = diasEntre(ult.chegada_data, t.data) <= 1 && diasEntre(ult.chegada_data, t.data) >= 0;
      }
    }
    if (conecta) jornadas.at(-1).push(t); else jornadas.push([t]);
  }
  return jornadas;
}

/** País de "casa" (de onde sai a viagem) e país de destino principal. */
function paisesDaViagem(trechos) {
  const casa = trechos[0]?.origem_pais || 'br';
  const conta = {};
  for (const t of trechos) for (const p of [t.origem_pais, t.destino_pais]) if (p && p !== casa) conta[p] = (conta[p] || 0) + 1;
  const destino = Object.entries(conta).sort((a, b) => b[1] - a[1])[0]?.[0] || casa;
  return { casa, destino };
}

const linhaVoo = (t) => [
  `${t.origem || '?'} → ${t.destino || '?'}`, BR(t.data), t.hora_saida && `${t.hora_saida}–${t.hora_chegada || '?'}${t.chegada_data && t.chegada_data !== t.data ? ` (chega ${BR(t.chegada_data)})` : ''}`,
  t.voo, t.voo_interno ? '(voo interno)' : '',
].filter(Boolean).join(' ');

function itensDeVoos(brutos, avisos) {
  const trechos = brutos.map(normalizarVoo);
  if (!trechos.length) return { itens: [], trechos: [] };
  const { casa, destino } = paisesDaViagem(trechos);
  for (const t of trechos) {
    t.voo_interno = Boolean(t.origem_pais && t.destino_pais && t.origem_pais === t.destino_pais);
    if (!t.origem_pais || !t.destino_pais) avisos.push(`Não deu pra saber o país de ${t.origem || '?'} → ${t.destino || '?'}: confira se é voo interno.`);
    if (!t.data) avisos.push(`Trecho ${t.origem || '?'} → ${t.destino || '?'} sem data.`);
    else if (!t.hora_saida || !t.hora_chegada) avisos.push(`Trecho ${t.origem || '?'} → ${t.destino || '?'} de ${BR(t.data)} sem horário${!t.hora_saida ? ' de saída' : ' de chegada'}.`);
    if (!t.localizador) avisos.push(`Trecho ${t.origem || '?'} → ${t.destino || '?'} sem localizador.`);
  }
  const jornadas = jornadasDe(trechos, avisos);
  for (const j of jornadas) {
    const ini = j[0], fim = j.at(-1);
    const sentido = ini.origem_pais === casa && fim.destino_pais !== casa ? 'ida'
      : fim.destino_pais === casa && ini.origem_pais !== casa ? 'volta'
      : j.every((t) => t.voo_interno) ? 'interno' : (ini.origem_pais === casa ? 'ida' : 'interno');
    j.forEach((t, i) => { t.sentido = sentido; t.conexao = i > 0; });
  }

  const itens = [];
  // Item 1: as jornadas internacionais (ida + volta e as conexões delas), mesmo bilhete.
  const internacionais = jornadas.filter((j) => j[0].sentido !== 'interno');
  const internas = jornadas.filter((j) => j[0].sentido === 'interno');
  const montar = (js, interno) => {
    const ts = js.flat();
    const ida = js.find((j) => j[0].sentido === 'ida'), volta = js.find((j) => j[0].sentido === 'volta');
    const a = ts[0], z = ts.at(-1);
    const nome = interno
      ? `Voo interno ${a.origem_cidade || a.origem} → ${z.destino_cidade || z.destino}`
      : ida && volta ? `Voo ${ida[0].origem} → ${ida.at(-1).destino} (ida e volta)` : `Voo ${a.origem} → ${z.destino}`;
    const cias = unicos(ts.map((t) => t.cia));
    const locs = unicos(ts.map((t) => t.localizador));
    const pax = unicos(ts.flatMap((t) => t.passageiros));
    const valores = ts.map((t) => t.valor).filter((v) => v != null);
    const custos = ts.map((t) => t.custo).filter((v) => v != null);
    return {
      tipo: 'aereo', nome,
      data_inicio: a.data || '', data_fim: (volta || interno) ? (z.chegada_data || z.data || '') : '',
      dados: {
        companhia: cias.join(' / '), voos: ts.map(linhaVoo).join('\n'), classe: unicos(ts.map((t) => t.classe))[0] || '',
        bagagem_despachada: unicos(ts.map((t) => t.bagagem))[0] || '', localizador: locs.join(' / '),
        voo_interno: interno || ts.some((t) => t.voo_interno),
        trechos: ts.map((t) => ({
          sentido: t.sentido, conexao: t.conexao, voo_interno: t.voo_interno,
          origem: t.origem, origem_cidade: t.origem_cidade, destino: t.destino, destino_cidade: t.destino_cidade,
          data: t.data, hora_saida: t.hora_saida, chegada_data: t.chegada_data, hora_chegada: t.hora_chegada,
          cia: t.cia, voo: t.voo, localizador: t.localizador, classe: t.classe, bagagem: t.bagagem,
          ...(t.conexao_min != null && t.conexao ? { conexao_min: t.conexao_min } : {}),
        })),
      },
      passageiros: pax.map((nome) => ({ nome })),
      valor: valores.length ? num(valores.reduce((s, v) => s + v, 0)) : null,
      custo: custos.length ? num(custos.reduce((s, v) => s + v, 0)) : null,
      fornecedor: cias.join(' / '),
    };
  };
  if (internacionais.length) itens.push(montar(internacionais, false));
  // Voos internos: um item por jornada (cada um tem bilhete/horário próprio).
  for (const j of internas) itens.push(montar([j], true));
  if (destino !== casa && internas.length) avisos.push(`${internas.length} voo(s) interno(s) no destino — já separados como itens próprios.`);
  return { itens, trechos };
}

// ── Hotéis, seguros, serviços ───────────────────────────────────────────────
function regimeDo(s) {
  const n = semAcento(s).toLowerCase();
  if (!n) return '';
  if (/all.?inclu|tudo inclu/.test(n)) return 'All inclusive';
  if (/pensao completa|full board/.test(n)) return 'Pensão completa';
  if (/meia pensao|half board/.test(n)) return 'Meia pensão';
  if (/cafe|breakfast|\bbb\b|b&b/.test(n)) return 'Café da manhã';
  if (/sem refei|room only|so hosped|\bro\b/.test(n)) return 'Sem refeição';
  return REGIMES.includes(txt(s)) ? txt(s) : '';
}

function itemHotel(h, avisos) {
  const ci = dataOk(h.checkin), co = dataOk(h.checkout);
  const nome = txt(h.hotel) || 'Hospedagem';
  if (!ci || !co) avisos.push(`${nome}: faltou ${!ci ? 'check-in' : 'check-out'} no voucher.`);
  else if (co <= ci) avisos.push(`${nome}: check-out (${BR(co)}) não é depois do check-in (${BR(ci)}).`);
  const regime = regimeDo(h.regime);
  if (txt(h.regime) && !regime) avisos.push(`${nome}: regime "${txt(h.regime)}" não bate com a lista; escolha na mão.`);
  return {
    tipo: 'hospedagem', nome, data_inicio: ci, data_fim: co,
    dados: {
      cidade: txt(h.cidade), quarto: txt(h.quarto), quartos: h.quartos != null ? String(h.quartos) : '', regime,
      checkin_hora: horaOk(h.checkin_hora), checkout_hora: horaOk(h.checkout_hora), endereco: txt(h.endereco),
      ...(txt(h.localizador) ? { localizador: txt(h.localizador) } : {}),
      ...(ci && co && co > ci ? { noites: String(diasEntre(ci, co)) } : {}),
    },
    passageiros: unicos((h.passageiros || []).map(nomeLimpo)).map((nome) => ({ nome })),
    valor: num(h.valor), custo: num(h.custo), fornecedor: txt(h.fornecedor),
  };
}

function itemSeguro(s) {
  const ini = dataOk(s.inicio), fim = dataOk(s.fim);
  return {
    tipo: 'seguro', nome: ['Seguro viagem', txt(s.seguradora), txt(s.plano)].filter(Boolean).join(' — '),
    data_inicio: ini, data_fim: fim,
    dados: {
      seguradora: txt(s.seguradora), plano: txt(s.plano), cobertura: txt(s.cobertura), apolice: txt(s.apolice),
      vigencia: ini || fim ? `${BR(ini)} a ${BR(fim)}` : '',
    },
    passageiros: unicos((s.segurados || []).map(nomeLimpo)).map((nome) => ({ nome })),
    valor: num(s.valor), custo: num(s.custo), fornecedor: txt(s.seguradora),
  };
}

function itemServico(s) {
  const tipo = TIPOS_SERVICO.includes(s.tipo) ? s.tipo : 'outro';
  const permitidas = new Set(CHAVES_POR_TIPO[tipo]);
  const dados = {};
  for (const { chave, valor } of s.detalhes || []) {
    const k = semAcento(chave).toLowerCase().replace(/[^a-z_]/g, '_');
    if (txt(valor) && (permitidas.has(k) || tipo === 'outro')) dados[k] = txt(valor);
  }
  if (permitidas.has('de') && txt(s.de)) dados.de = txt(s.de);
  if (permitidas.has('para') && txt(s.para)) dados.para = txt(s.para);
  if (permitidas.has('hora') && horaOk(s.hora)) dados.hora = horaOk(s.hora);
  if (tipo === 'trem' && horaOk(s.hora) && !dados.saida) dados.saida = horaOk(s.hora);
  if (tipo === 'passeio' && txt(s.cidade) && !dados.local) dados.local = txt(s.cidade);
  if (txt(s.cidade)) dados.cidade = txt(s.cidade);
  const nomePadrao = { transfer: `Transfer ${txt(s.de)} → ${txt(s.para)}`, trem: `Trem ${txt(s.de)} → ${txt(s.para)}` }[tipo];
  return {
    tipo, nome: txt(s.nome) || (txt(s.de) && txt(s.para) ? nomePadrao : '') || tipo[0].toUpperCase() + tipo.slice(1),
    data_inicio: dataOk(s.data_inicio), data_fim: dataOk(s.data_fim), dados,
    passageiros: unicos((s.passageiros || []).map(nomeLimpo)).map((nome) => ({ nome })),
    valor: num(s.valor), custo: num(s.custo), fornecedor: txt(s.fornecedor),
  };
}

// ── Roteiro dia a dia (mesmos campos do roteiro_dias: dia, data, cidade, titulo, hospedagem) ──
function montarRoteiro({ inicio, fim, trechos, itens }) {
  if (!inicio || !fim || fim < inicio) return [];
  const total = Math.min(diasEntre(inicio, fim), 90);
  const hoteis = itens.filter((i) => i.tipo === 'hospedagem' && i.data_inicio && i.data_fim);
  const dias = [];
  let cidadeAtual = '';
  for (let n = 0; n <= total; n++) {
    const data = somaDias(inicio, n);
    const atividades = [];
    let cidadeDoDia = '';
    for (const t of trechos) {
      if (t.data === data) {
        atividades.push(`${t.voo_interno ? 'Voo interno' : 'Voo'} ${t.voo || ''} ${t.origem_cidade || t.origem} → ${t.destino_cidade || t.destino}${t.hora_saida ? ` às ${t.hora_saida}` : ''}${t.conexao ? ' (conexão)' : ''}`.replace(/\s+/g, ' '));
      }
      if (t.chegada_data === data && t.destino_cidade) {
        if (t.chegada_data !== t.data) atividades.push(`Chegada em ${t.destino_cidade}${t.hora_chegada ? ` às ${t.hora_chegada}` : ''}`);
        cidadeDoDia = t.destino_cidade;
      }
    }
    for (const h of hoteis) {
      if (h.data_inicio === data) atividades.push(`Check-in no ${h.nome}${h.dados.checkin_hora ? ` (a partir das ${h.dados.checkin_hora})` : ''}`);
      if (h.data_fim === data) atividades.push(`Check-out do ${h.nome}${h.dados.checkout_hora ? ` (até ${h.dados.checkout_hora})` : ''}`);
    }
    for (const i of itens) {
      if (['aereo', 'hospedagem', 'seguro'].includes(i.tipo)) continue;
      const ate = i.data_fim || i.data_inicio;
      if (i.data_inicio && data >= i.data_inicio && data <= ate) {
        const h = i.dados.hora || i.dados.saida;
        atividades.push(`${i.nome}${h && data === i.data_inicio ? ` às ${h}` : ''}`);
        if (i.tipo === 'trem' && i.dados.para && data === i.data_inicio) cidadeDoDia = i.dados.para;
      }
    }
    for (const i of itens.filter((x) => x.tipo === 'seguro')) {
      if (i.data_inicio === data) atividades.push('Começa a cobertura do seguro viagem');
    }
    // Onde dorme: hotel que cobre a noite (check-in ≤ data < check-out).
    const hotel = hoteis.find((h) => h.data_inicio <= data && data < h.data_fim);
    if (hotel?.dados.cidade) cidadeDoDia = hotel.dados.cidade;
    if (cidadeDoDia) cidadeAtual = cidadeDoDia;
    const titulo = n === 0 ? 'Embarque' : n === total ? 'Retorno'
      : atividades.find((a) => /^(Voo|Trem|Transfer)/.test(a)) ? `Deslocamento${cidadeAtual ? ` para ${cidadeAtual}` : ''}`
      : atividades.length ? atividades[0] : (cidadeAtual ? `Dia livre em ${cidadeAtual}` : 'Dia livre');
    dias.push({ dia: n + 1, data, cidade: cidadeAtual, titulo, hospedagem: hotel?.nome || '', atividades });
  }
  return dias;
}

// ── Pessoas e avisos de documento ───────────────────────────────────────────
function juntarPessoas(leitura, itens) {
  const lista = [];
  const add = (p) => {
    const nome = nomeLimpo(p.nome);
    if (!nome) return;
    const ja = lista.find((x) => compararNomes(x.nome, nome) === 'igual');
    if (ja) { for (const k of ['cpf', 'passaporte', 'nascimento', 'validade_passaporte']) if (!ja[k] && p[k]) ja[k] = p[k]; return; }
    lista.push({
      nome,
      ...(txt(p.cpf) ? { cpf: txt(p.cpf).replace(/\D/g, '') } : {}),
      ...(txt(p.passaporte) ? { passaporte: txt(p.passaporte).toUpperCase() } : {}),
      ...(dataOk(p.nascimento) ? { nascimento: dataOk(p.nascimento) } : {}),
      ...(dataOk(p.validade_passaporte) ? { validade_passaporte: dataOk(p.validade_passaporte) } : {}),
    });
  };
  (leitura.pessoas || []).forEach(add);
  itens.forEach((i) => i.passageiros.forEach((p) => add({ nome: p.nome })));
  return lista;
}

/**
 * Monta a venda a partir da LEITURA da IA.
 * @param {object} leitura  o JSON do esquema LEITURA
 * @param {{ cadastro?: {nome:string, passaporte_validade?:string|null, nascimento?:string|null}[], hoje?: string,
 *           viagem?: { data_inicio?: string, data_fim?: string } }} [ctx]  viagem = datas já conhecidas (ex.: venda com seguro avulso)
 */
export function montarVenda(leitura, ctx = {}) {
  const L = leitura || {};
  const avisos = [];
  if (L.legivel === false) avisos.push('A IA achou que o arquivo não é um voucher ou está ilegível. Confira tudo.');

  const { itens: aereos, trechos } = itensDeVoos(L.voos || [], avisos);
  const hoteis = (L.hospedagens || []).map((h) => itemHotel(h, avisos));
  const seguros = (L.seguros || []).map(itemSeguro);
  const servicos = (L.servicos || []).map(itemServico);
  const itens = [...aereos, ...hoteis, ...servicos, ...seguros];

  // Datas da viagem: do primeiro voo (ou primeiro item) ao último.
  const datas = itens.flatMap((i) => (i.tipo === 'seguro' ? [] : [i.data_inicio, i.data_fim])).filter(Boolean).sort();
  // Sem voo/hotel/serviço com data (ex.: só o seguro), vale a viagem informada ou a vigência do seguro.
  const dSeg = seguros.flatMap((i) => [i.data_inicio, i.data_fim]).filter(Boolean).sort();
  const vi = ctx.viagem || {};
  const inicio = trechos.map((t) => t.data).filter(Boolean).sort()[0] || datas[0] || dataOk(vi.data_inicio) || dSeg[0] || '';
  const fim = [...trechos.map((t) => t.chegada_data || t.data), ...datas].filter(Boolean).sort().at(-1) || dataOk(vi.data_fim) || dSeg.at(-1) || '';
  if (!inicio) avisos.push('Não achei datas no voucher: preencha início e fim da viagem na mão.');

  // Ordem cronológica dos itens (seguro por último quando não tem data).
  itens.sort((a, b) => (a.data_inicio || '9999').localeCompare(b.data_inicio || '9999'));

  for (const s of seguros) {
    if (inicio && s.data_inicio && s.data_inicio > inicio) avisos.push(`Seguro começa ${BR(s.data_inicio)}, depois do embarque (${BR(inicio)}).`);
    if (fim && s.data_fim && s.data_fim < fim) avisos.push(`Seguro termina ${BR(s.data_fim)}, antes da volta (${BR(fim)}).`);
    if (!s.data_inicio || !s.data_fim) avisos.push('Seguro sem vigência no voucher: confira as datas.');
  }
  for (const i of [...hoteis, ...servicos]) {
    if (inicio && fim && i.data_inicio && (i.data_inicio < inicio || i.data_inicio > fim)) {
      avisos.push(`${i.nome} (${BR(i.data_inicio)}) fica fora das datas da viagem (${BR(inicio)} a ${BR(fim)}): é a mesma viagem?`);
    }
  }
  if (trechos.length && !trechos.some((t) => t.sentido === 'volta')) avisos.push('Não achei o voo de volta no voucher.');

  // Pessoas + conferência com o cadastro.
  const pessoas = juntarPessoas(L, itens);
  // Passageiro do bilhete (sem acento, "JOAO") usa o nome da lista de pessoas ("João") quando é a mesma pessoa.
  for (const i of itens) {
    i.passageiros = i.passageiros.map((p) => ({ nome: pessoas.find((x) => compararNomes(x.nome, p.nome) === 'igual')?.nome || p.nome }));
  }
  const cadastro = (ctx.cadastro || []).filter((c) => txt(c?.nome));
  for (const p of pessoas) {
    const val = p.validade_passaporte
      || cadastro.find((c) => compararNomes(c.nome, p.nome) && compararNomes(c.nome, p.nome) !== 'diferente')?.passaporte_validade || '';
    const volta = fim || inicio;
    if (val && volta && dataOk(val) && dataOk(val) < somaDias(volta, 183)) {
      avisos.push(`Passaporte de ${p.nome} vence ${BR(dataOk(val))}: menos de 6 meses depois da volta (${BR(volta)}).`);
    }
    if (cadastro.length) {
      const nivel = cadastro.map((c) => ({ c, r: compararNomes(c.nome, p.nome) }));
      if (nivel.some((x) => x.r === 'igual')) continue;
      const parecido = nivel.find((x) => x.r === 'parcial');
      if (parecido) avisos.push(`Nome no voucher "${p.nome}" difere do cadastro "${nomeLimpo(parecido.c.nome)}".`);
      else avisos.push(`${p.nome} está no voucher mas não no cadastro da venda.`);
    }
  }
  for (const c of cadastro) {
    if (pessoas.length && !pessoas.some((p) => { const r = compararNomes(c.nome, p.nome); return r && r !== 'diferente'; })) {
      avisos.push(`${nomeLimpo(c.nome)} está no cadastro mas não aparece no voucher.`);
    }
  }

  // Valores.
  const moeda = txt(L.moeda).toUpperCase();
  if (moeda && moeda !== 'BRL' && moeda !== 'R$') avisos.push(`Valores do voucher em ${moeda}: converta pra reais antes de salvar.`);
  const soma = itens.reduce((s, i) => s + (i.valor || 0), 0);
  const total = num(L.valor_total);
  if (total != null && !itens.some((i) => i.valor != null) && itens.length === 1) itens[0].valor = total;
  else if (total != null && soma && Math.abs(total - soma) > 1) avisos.push(`Total do voucher (${moedaBR(total)}) não bate com a soma dos itens (${moedaBR(soma)}).`);
  else if (total != null && !soma) avisos.push(`Total do voucher: ${moedaBR(total)} — não deu pra dividir por item.`);
  if (soma && (!moeda || moeda === 'BRL')) avisos.push(`Soma dos valores lidos: ${moedaBR(soma)}.`);

  for (const o of L.observacoes || []) if (txt(o)) avisos.push(`Do voucher: ${txt(o)}`);
  if (ctx.hoje && inicio && inicio < ctx.hoje) avisos.push(`A viagem começa em ${BR(inicio)}, antes de hoje: é o voucher certo?`);

  const roteiro = montarRoteiro({ inicio, fim, trechos, itens });
  return {
    itens: itens.map(({ tipo, nome, data_inicio, data_fim, dados, passageiros, valor, custo, fornecedor }) =>
      ({ tipo, nome, data_inicio, data_fim, dados, passageiros, valor, custo, fornecedor })),
    pessoas,
    roteiro,
    avisos: unicos(avisos),
  };
}
