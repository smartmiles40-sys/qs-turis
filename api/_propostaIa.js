// api/_propostaIa.js
// -----------------------------------------------------------------------------
// "MONTAR COM IA" — as regras puras (sem rede), usadas por api/proposta-ia.js e
// pelos testes. Mesmo padrão do api/rel-docs-ia.js: a IA só LÊ e devolve um
// JSON com esquema fixo (json_schema strict); quem decide o que vale somos nós.
//
//   esquemaProposta(modelo, campos) → o esquema JSON estrito daquele modelo:
//       viagem (destino, datas, passageiros…), os campos de texto do modelo que
//       a tela mandou (vêm de SECOES em src/propostas/modelos.ts, marcados com
//       `ia`), e as listas estruturadas que o modelo usa:
//         pacote   → voos, hotéis, roteiro dia a dia, cartões de preço
//         servicos → voos, hotéis, roteiro, serviços (valor por pessoa)
//         seguro   → planos de seguro (seguradora, plano, coberturas, valores)
//       + pagamento, validade e a lista "conferir".
//   validarExtracao(bruto, ctx) → limpa o que a IA devolveu: preço que não é
//       número positivo, data que não existe, hora fora do formato, código de
//       aeroporto torto… é DESCARTADO (nunca "corrigido" no chute) e vira um
//       item de "conferir". Volta antes da ida, check-out antes do check-in e
//       preços diferentes pro mesmo cartão também viram "conferir".
// -----------------------------------------------------------------------------

export const MODELOS_IA = ['pacote', 'servicos', 'seguro'];

// Limites do que a IA pode devolver (resposta enxuta, tela legível)
const MAX = { voos: 16, hoteis: 8, roteiro: 40, servicos: 30, seguros: 12, coberturas: 30, precos: 6, conferir: 12, campos: 30, comodidades: 12 };
const TXT_CURTO = 200;
const TXT_LONGO = 4000;
const VALOR_MAX = 5_000_000; // R$ — acima disso é leitura errada

// ── Peças do esquema ────────────────────────────────────────────────────────
const S = (description) => ({ type: ['string', 'null'], description });
const N = (description) => ({ type: ['number', 'null'], description });
const I = (description) => ({ type: ['integer', 'null'], description });
const obj = (properties, description) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});
const lista = (items, description) => ({ type: 'array', items, description });

const DATA = 'data AAAA-MM-DD; null se não estiver escrita (não deduza o ano no chute)';
const HORA = 'hora HH:MM, 24h, hora local';
const VALOR_PP = 'valor por pessoa em reais (número, sem R$); null se não estiver escrito em reais';
const VALOR_TOT = 'valor total em reais (número, sem R$); null se não estiver escrito em reais';

const VIAGEM = obj({
  titulo: S('título curto da proposta, ex.: "Cancún all inclusive" (só se der pra tirar dos insumos)'),
  cliente_nome: S('nome do cliente/família como aparece nos insumos'),
  destino: S('destino principal, ex.: "Cancún, México"'),
  data_ida: S(`ida/início da viagem, ${DATA}`),
  data_volta: S(`volta/fim da viagem, ${DATA}`),
  adultos: I('nº de adultos'),
  criancas: I('nº de crianças'),
  bebes: I('nº de bebês (colo)'),
});

const VOO = obj({
  sentido: { type: 'string', enum: ['ida', 'volta', 'interno'], description: 'ida, volta ou trecho interno' },
  cia: S('companhia aérea, ex.: GOL, LATAM, Iberia'),
  numero: S('número do voo, ex.: G3 2055'),
  origem: S('código IATA de 3 letras da origem, ex.: FOR'),
  origem_cidade: S('cidade de origem'),
  destino: S('código IATA de 3 letras do destino'),
  destino_cidade: S('cidade de destino'),
  data: S(`data da saída, ${DATA}`),
  saida: S(`saída, ${HORA}`),
  chegada: S(`chegada, ${HORA}`),
  chegada_data: S(`data da chegada se for outro dia, ${DATA}`),
  duracao: S('duração do trecho, ex.: 3h20'),
  classe: S('classe/tarifa, ex.: Econômica, Light, Plus'),
  bagagem: S('bagagem incluída como escrito, ex.: "1 mala de 23 kg + mão 10 kg"'),
}, 'um trecho de voo; conexões são trechos separados, na ordem');

const HOTEL = obj({
  nome: S('nome do hotel'),
  cidade: S('cidade'),
  endereco: S('endereço'),
  checkin: S(`check-in, ${DATA}`),
  checkout: S(`check-out, ${DATA}`),
  checkin_hora: S(HORA),
  checkout_hora: S(HORA),
  regime: S('regime: sem refeição, café da manhã, meia pensão, pensão completa ou all inclusive'),
  quarto: S('tipo de quarto, ex.: Duplo Resort View'),
  comodidades: lista({ type: 'string' }, 'comodidades citadas (curtas)'),
});

const DIA = obj({
  data: S(DATA),
  titulo: S('título do dia, ex.: "Chegada a Cancún"'),
  texto: S('o que acontece no dia (curto)'),
});

const SERVICO = obj({
  nome: S('nome do serviço/passeio, ex.: "Excursão a Segóvia"'),
  local: S('cidade/local'),
  data: S(DATA),
  descricao: S('o que inclui (curto)'),
  valor_pessoa: N(VALOR_PP),
  incluso: { type: 'boolean', description: 'true se o insumo diz que já está incluso/previsto (sem preço)' },
});

const SEGURO = obj({
  seguradora: S('seguradora, ex.: Hero Seguros, Universal Assistance'),
  plano: S('nome do plano, ex.: HERO 80'),
  cobertura_medica: S('assistência médica como escrito, ex.: "US$ 80.000"'),
  inicio: S(`início da vigência, ${DATA}`),
  fim: S(`fim da vigência, ${DATA}`),
  valor_pessoa: N(VALOR_PP),
  valor_total: N(VALOR_TOT),
  coberturas: lista(obj({ nome: S('cobertura, ex.: Bagagem extraviada'), valor: S('valor como escrito, ex.: "US$ 1.200" ou "Não inclui"') }), 'coberturas do plano'),
});

const PRECO = obj({
  rotulo: S('o que o preço é, ex.: "Quarto duplo · por pessoa", "Single", "Casal"'),
  titulo: S('título do cartão, ex.: "2 viajantes"'),
  valor_pessoa: N(VALOR_PP),
  valor_total: N(VALOR_TOT),
  parcelas: I('nº de parcelas no cartão, se escrito'),
  desconto: N('desconto em reais, se escrito'),
}, 'um preço do pacote (cada acomodação/forma é um cartão)');

const CONFERIR = obj({
  campo: { type: 'string', description: 'o que conferir, ex.: "preço do quarto duplo", "data da volta"' },
  motivo: { type: 'string', description: 'por quê, curto: conflito entre insumos, ilegível, moeda estrangeira…' },
});

/** Campos de texto do modelo que a tela manda (chave + rótulo), já filtrados. */
export function camposValidos(campos) {
  const vistos = new Set();
  const out = [];
  for (const c of Array.isArray(campos) ? campos : []) {
    const chave = String(c?.chave || '');
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ chave, rotulo: String(c?.rotulo || chave).slice(0, 200), tabela: c?.tipo === 'tabela' });
    if (out.length >= MAX.campos) break;
  }
  return out;
}

/** O esquema JSON estrito do modelo (o que a OpenAI é obrigada a devolver). */
export function esquemaProposta(modelo, campos) {
  const cs = camposValidos(campos);
  const props = {
    viagem: VIAGEM,
    campos: obj(Object.fromEntries(cs.map((c) => [c.chave, S(c.tabela ? `${c.rotulo} — tabela: uma linha por item, colunas separadas por " | "` : c.rotulo)])),
      'textos da proposta; null no que os insumos não dizem'),
  };
  if (modelo === 'pacote' || modelo === 'servicos') {
    props.voos = lista(VOO, 'voos na ordem: ida (com conexões), trechos internos, volta');
    props.hoteis = lista(HOTEL, 'hospedagens na ordem da viagem');
    props.roteiro = lista(DIA, 'roteiro dia a dia, se os insumos tiverem');
  }
  if (modelo === 'pacote') props.precos = lista(PRECO, 'preços do pacote');
  if (modelo === 'servicos') props.servicos = lista(SERVICO, 'serviços cotados, cada um com seu valor por pessoa');
  if (modelo === 'seguro') props.seguros = lista(SEGURO, 'cada plano cotado é um item');
  props.pagamento = S('forma de pagamento como escrita, ex.: "PIX ou 10x sem juros no cartão"');
  props.validade = S('validade da cotação como escrita');
  props.conferir = lista(CONFERIR, `no máximo ${MAX.conferir} itens: dúvidas, conflitos (dois preços diferentes), coisas ilegíveis`);
  return obj(props);
}

const ROTULO_MODELO = { pacote: 'pacote personalizado (voos, hotel, dia a dia, preço do pacote)', servicos: 'serviços avulsos (passeios, transfers, gestão) com valor por pessoa', seguro: 'seguro viagem (planos de uma ou mais seguradoras)' };

export const INSTRUCAO =
  'Você monta o rascunho de uma proposta de viagem para uma agência de turismo brasileira, a partir dos INSUMOS que o consultor subiu ' +
  '(prints de voos, hotel, passeios, seguro, telas de consolidadora, PDFs e textos colados de WhatsApp ou e-mail). ' +
  'REGRAS: (1) Use SOMENTE o que está escrito nos insumos. Nunca invente preço, data, horário, número de voo, nome de hotel ou de pessoa. ' +
  '(2) O que não aparecer fica null (ou lista vazia). (3) Datas AAAA-MM-DD; horas HH:MM em 24h; valores em reais como número (1599.48), sem R$. ' +
  'Valor em moeda estrangeira: não converta — deixe o valor em reais null e coloque em "conferir". ' +
  '(4) Se dois insumos discordarem (ex.: dois preços diferentes para a mesma coisa, datas que não batem), use o mais recente/claro e coloque em "conferir". ' +
  '(5) Texto em português do Brasil, curto, no tom de uma proposta para o cliente; não copie dados internos (custo, comissão, localizador, login). ' +
  '(6) "conferir" é curto e só com o que o consultor realmente precisa olhar.';

/** Texto do usuário que abre a mensagem (contexto + o que o cliente pediu + textos colados). */
export function textoDoPedido({ modelo, proposta, pedido, textos, nomesArquivos }) {
  const p = proposta || {};
  const ja = [
    p.destino && `destino: ${p.destino}`, p.data_ida && `ida: ${p.data_ida}`, p.data_volta && `volta: ${p.data_volta}`,
    (p.adultos || p.criancas || p.bebes) && `passageiros: ${p.adultos || 0} adultos, ${p.criancas || 0} crianças, ${p.bebes || 0} bebês`,
  ].filter(Boolean).join('; ');
  const partes = [
    `Modelo da proposta: ${ROTULO_MODELO[modelo] || modelo}.`,
    ja && `O consultor já preencheu (use só pra se situar; se os insumos disserem diferente, coloque em "conferir"): ${ja}.`,
    pedido && `O QUE O CLIENTE PEDIU:\n${pedido}`,
    ...(textos || []).map((t, n) => `TEXTO COLADO ${n + 1}:\n${t}`),
    nomesArquivos?.length ? `Arquivos anexados, na ordem: ${nomesArquivos.join(', ')}.` : 'Sem arquivos anexados.',
  ];
  return partes.filter(Boolean).join('\n\n');
}

// ── Validação do que voltou ─────────────────────────────────────────────────
const limpa = (v, max = TXT_CURTO) => {
  if (v == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
};

/** "2027-08-17" que existe no calendário e cai num ano razoável. */
export function dataValida(v) {
  const s = limpa(v, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2024 || a > 2040) return '';
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d ? s : '';
}
export function horaValida(v) {
  const s = limpa(v, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}
/** Preço: número positivo e plausível (string "1.599,48" também vale). Senão null. */
export function valorValido(v) {
  if (v == null || v === '') return null;
  let n = typeof v === 'number' ? v : NaN;
  if (typeof v === 'string') {
    let s = v.replace(/[^\d,.-]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    n = s ? Number(s) : NaN;
  }
  if (!Number.isFinite(n) || n <= 0 || n > VALOR_MAX) return null;
  return Math.round(n * 100) / 100;
}
const inteiro = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const iata = (v) => { const s = limpa(v, 5).toUpperCase(); return /^[A-Z]{3}$/.test(s) ? s : ''; };

/**
 * Limpa a resposta da IA. Devolve { extracao, conferir, descartados }:
 *   · extracao   — só o que passou (strings vazias = "não achou");
 *   · conferir   — o que a IA pediu pra conferir + o que nós achamos;
 *   · descartados — o que a IA mandou e não passou (pra tela explicar).
 */
export function validarExtracao(bruto, { modelo, campos } = {}) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const conferir = [];
  const descartados = [];
  const fora = (campo, valor, motivo) => {
    descartados.push({ campo, valor: limpa(typeof valor === 'object' ? JSON.stringify(valor) : valor, 80), motivo });
    conferir.push({ campo, motivo: `${motivo} (a IA leu "${limpa(typeof valor === 'object' ? JSON.stringify(valor) : valor, 40)}" e foi descartado)` });
  };
  const data = (campo, v) => { const d = dataValida(v); if (!d && v != null && String(v).trim()) fora(campo, v, 'data inválida'); return d; };
  const hora = (campo, v) => { const h = horaValida(v); if (!h && v != null && String(v).trim()) fora(campo, v, 'horário inválido'); return h; };
  const valor = (campo, v) => { const x = valorValido(v); if (x == null && v != null && String(v).trim() !== '') fora(campo, v, 'preço inválido'); return x; };

  // viagem
  const vg = b.viagem && typeof b.viagem === 'object' ? b.viagem : {};
  const viagem = {
    titulo: limpa(vg.titulo, 120), cliente_nome: limpa(vg.cliente_nome, 160), destino: limpa(vg.destino, 160),
    data_ida: data('data da ida', vg.data_ida), data_volta: data('data da volta', vg.data_volta),
    adultos: inteiro(vg.adultos, 60), criancas: inteiro(vg.criancas, 60), bebes: inteiro(vg.bebes, 20),
  };
  if (viagem.data_ida && viagem.data_volta && viagem.data_volta < viagem.data_ida) {
    conferir.push({ campo: 'datas da viagem', motivo: `a volta (${viagem.data_volta}) ficou antes da ida (${viagem.data_ida}); a volta foi descartada` });
    descartados.push({ campo: 'data da volta', valor: viagem.data_volta, motivo: 'antes da ida' });
    viagem.data_volta = '';
  }

  // campos de texto (só as chaves que a tela pediu)
  const permitidos = camposValidos(campos);
  const bc = b.campos && typeof b.campos === 'object' ? b.campos : {};
  const textos = {};
  for (const c of permitidos) {
    if (typeof bc[c.chave] !== 'string') continue;
    // linha a linha: tabela e lista têm uma linha por item
    const t = bc[c.chave].split(/\r?\n/).map((l) => limpa(l, 600)).filter(Boolean).join('\n').slice(0, TXT_LONGO);
    if (t) textos[c.chave] = t;
  }

  const arr = (x, max) => (Array.isArray(x) ? x.slice(0, max).filter((i) => i && typeof i === 'object') : []);

  const voos = arr(b.voos, MAX.voos).map((v, n) => ({
    sentido: ['ida', 'volta', 'interno'].includes(v.sentido) ? v.sentido : 'ida',
    cia: limpa(v.cia, 60), numero: limpa(v.numero, 20).toUpperCase(),
    origem: iata(v.origem), origem_cidade: limpa(v.origem_cidade, 80),
    destino: iata(v.destino), destino_cidade: limpa(v.destino_cidade, 80),
    data: data(`data do voo ${n + 1}`, v.data), saida: hora(`saída do voo ${n + 1}`, v.saida), chegada: hora(`chegada do voo ${n + 1}`, v.chegada),
    chegada_data: data(`chegada do voo ${n + 1}`, v.chegada_data),
    duracao: limpa(v.duracao, 20), classe: limpa(v.classe, 40), bagagem: limpa(v.bagagem, 160),
  })).filter((v) => v.numero || v.origem || v.destino || v.origem_cidade || v.destino_cidade);

  const hoteis = arr(b.hoteis, MAX.hoteis).map((h, n) => {
    const x = {
      nome: limpa(h.nome, 160), cidade: limpa(h.cidade, 80), endereco: limpa(h.endereco, 240),
      checkin: data(`check-in do hotel ${n + 1}`, h.checkin), checkout: data(`check-out do hotel ${n + 1}`, h.checkout),
      checkin_hora: hora(`hora do check-in ${n + 1}`, h.checkin_hora), checkout_hora: hora(`hora do check-out ${n + 1}`, h.checkout_hora),
      regime: limpa(h.regime, 60), quarto: limpa(h.quarto, 120),
      comodidades: (Array.isArray(h.comodidades) ? h.comodidades : []).map((c) => limpa(c, 80)).filter(Boolean).slice(0, MAX.comodidades),
    };
    if (x.checkin && x.checkout && x.checkout <= x.checkin) {
      conferir.push({ campo: `datas do ${x.nome || `hotel ${n + 1}`}`, motivo: 'check-out no mesmo dia ou antes do check-in; o check-out foi descartado' });
      x.checkout = '';
    }
    return x;
  }).filter((h) => h.nome);

  const roteiro = arr(b.roteiro, MAX.roteiro).map((d, n) => ({ data: data(`data do dia ${n + 1}`, d.data), titulo: limpa(d.titulo, 120), texto: limpa(d.texto, 600) }))
    .filter((d) => d.titulo || d.texto);

  const out = { viagem, campos: textos, voos, hoteis, roteiro, precos: [], servicos: [], seguros: [] };

  if (modelo === 'pacote') {
    out.precos = arr(b.precos, MAX.precos).map((p, n) => ({
      rotulo: limpa(p.rotulo, 80), titulo: limpa(p.titulo, 80),
      valor_pessoa: valor(`preço ${n + 1} por pessoa`, p.valor_pessoa), valor_total: valor(`preço ${n + 1} total`, p.valor_total),
      parcelas: inteiro(p.parcelas, 24), desconto: valorValido(p.desconto),
    })).filter((p) => p.valor_pessoa != null || p.valor_total != null);
    // dois preços diferentes pro mesmo cartão (mesmo rótulo) = conferir
    const porRotulo = new Map();
    for (const p of out.precos) {
      const k = (p.rotulo || p.titulo).toLowerCase();
      if (!k) continue;
      const v = p.valor_pessoa ?? p.valor_total;
      if (porRotulo.has(k) && porRotulo.get(k) !== v) conferir.push({ campo: `preço "${p.rotulo || p.titulo}"`, motivo: `dois valores diferentes nos insumos (${porRotulo.get(k)} e ${v})` });
      else porRotulo.set(k, v);
    }
  }
  if (modelo === 'servicos') {
    out.servicos = arr(b.servicos, MAX.servicos).map((s, n) => ({
      nome: limpa(s.nome, 160), local: limpa(s.local, 80), data: data(`data do serviço ${n + 1}`, s.data), descricao: limpa(s.descricao, 1200),
      valor_pessoa: valor(`preço do serviço ${n + 1}`, s.valor_pessoa), incluso: s.incluso === true,
    })).filter((s) => s.nome);
  }
  if (modelo === 'seguro') {
    out.seguros = arr(b.seguros, MAX.seguros).map((s, n) => ({
      seguradora: limpa(s.seguradora, 80), plano: limpa(s.plano, 80), cobertura_medica: limpa(s.cobertura_medica, 60),
      inicio: data(`início do seguro ${n + 1}`, s.inicio), fim: data(`fim do seguro ${n + 1}`, s.fim),
      valor_pessoa: valor(`preço por pessoa do plano ${n + 1}`, s.valor_pessoa), valor_total: valor(`preço total do plano ${n + 1}`, s.valor_total),
      coberturas: arr(s.coberturas, MAX.coberturas).map((c) => ({ nome: limpa(c.nome, 120), valor: limpa(c.valor, 60) })).filter((c) => c.nome && c.valor),
    })).filter((s) => s.plano || s.seguradora);
  }
  out.pagamento = limpa(b.pagamento, 600);
  out.validade = limpa(b.validade, 300);

  // o que a própria IA pediu pra conferir vem primeiro
  const daIa = arr(b.conferir, MAX.conferir).map((c) => ({ campo: limpa(c.campo, 120), motivo: limpa(c.motivo, 240) })).filter((c) => c.campo);
  const todos = [...daIa, ...conferir];
  const vistos = new Set();
  const unicos = todos.filter((c) => { const k = `${c.campo}|${c.motivo}`; if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, MAX.conferir + 8);
  return { extracao: out, conferir: unicos, descartados };
}
