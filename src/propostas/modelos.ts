// src/propostas/modelos.ts
// -----------------------------------------------------------------------------
// OS 3 MODELOS DE PROPOSTA (Bruno, 03/11/2026): "as propostas de TODOS os tipos
// de solicitação padronizadas neste formato". Os modelos vêm dos 3 PDFs-padrão:
//
//   pacote   → "Proposta de pacote personalizado - Padrão.pdf" (Cancún, 14 pág.)
//   servicos → "Proposta de serviços (passeios, gestão, etc) - Padrão.pdf"
//   seguro   → "Proposta de Seguro Viagem - Padrão.pdf"
//
// Onde mora cada coisa (0280):
//   · qs_propostas.modelo   — qual dos 3 (nulo = proposta antiga, tela antiga);
//   · qs_propostas.conteudo — os textos de cada seção (jsonb);
//   · as OPÇÕES continuam sendo o que o cliente escolhe e aprova pelo link:
//       pacote   → cada cartão do "Investimento" (duplo, casal, single…);
//       servicos → uma opção só, cada serviço é um item (valor por pessoa);
//       seguro   → cada plano (HERO 80, Ouro…) é uma opção.
//     O que o cartão tem a mais que a opção (selo, rótulo…) fica em
//     conteudo.opcoes_extra, na MESMA ordem das opções.
//
// Tabelas e listas são texto com uma linha por item e colunas separadas por
// "|" (dá pra colar direto da cotação do fornecedor). Linha que começa com "#"
// é cabeçalho de grupo e com ">" é observação, onde a tabela tem isso no PDF.
// Os textos fixos dos PDFs estão aqui literalmente (FIXO_*).
// -----------------------------------------------------------------------------

export type ModeloProposta = "pacote" | "servicos" | "seguro";

export const MODELOS: Record<ModeloProposta, { rotulo: string; dica: string; cabecalho: string }> = {
  pacote: { rotulo: "Pacote personalizado", dica: "Roteiro completo: voos, hotel, dia a dia, documentos, investimento", cabecalho: "Proposta de Viagem" },
  servicos: { rotulo: "Serviços (passeios, gestão, etc.)", dica: "Serviços avulsos com valor por pessoa, resumo e roteiro de referência", cabecalho: "Proposta de Serviços" },
  seguro: { rotulo: "Seguro viagem", dica: "Planos de uma ou mais seguradoras, comparativo e recomendação", cabecalho: "Proposta de Seguro Viagem" },
};
export const ORDEM_MODELOS: ModeloProposta[] = ["pacote", "servicos", "seguro"];

// ── Qual modelo pra cada tipo de solicitação ────────────────────────────────
// Tipos vivos em qs_solicitacao_tipos (03/11). Seguro não tinha tipo próprio:
// a 0281 cria "ops_cot_seguro"; até lá, "seguro" no título/descrição decide.
export const MODELO_DO_TIPO: Record<string, ModeloProposta> = {
  // cotação / venda nova → pacote
  ops_cotacao: "pacote", ops_cot_aereo: "pacote", ops_cot_hotel: "pacote",
  com_cotacao: "pacote", com_indicacao: "pacote", com_proposta: "pacote", rel_oportunidade_venda: "pacote",
  // seguro
  ops_cot_seguro: "seguro",
  // serviços sobre uma viagem que já existe
  ops_alteracao: "servicos", ops_assento: "servicos", ops_bagagem: "servicos", ops_remarcacao: "servicos",
  ops_checkin: "servicos", ops_nome: "servicos", ops_emissao: "servicos", ops_cancelamento: "servicos",
  ops_documentos: "servicos", ops_fornecedor: "servicos", ops_outro: "servicos",
  com_outro: "servicos", rel_contato: "servicos", rel_documentos: "servicos", rel_pos_venda: "servicos",
  rel_emissoes_pendentes: "servicos", rel_outro: "servicos",
  fin_cobranca: "servicos", fin_outro: "servicos",
};

/** O modelo que a proposta nasce, pela solicitação de onde veio. */
export function modeloDaSolicitacao(s: { tipo_id?: string | null; titulo?: string | null; descricao?: string | null; formulario?: unknown } | null | undefined): ModeloProposta {
  if (!s) return "pacote";
  const texto = `${s.titulo ?? ""} ${s.descricao ?? ""}`;
  if (s.tipo_id === "ops_cot_seguro" || /\bseguro/i.test(texto)) return "seguro";
  const pedido = (s.formulario as { pedido?: string } | null)?.pedido;
  if (pedido === "alteracao" || pedido === "correcao") return "servicos";
  return (s.tipo_id && MODELO_DO_TIPO[s.tipo_id]) || "pacote";
}

// ── Texto → linhas / colunas ────────────────────────────────────────────────
export const linhas = (t: unknown): string[] => String(t ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
export const colunas = (l: string): string[] => l.split("|").map((c) => c.trim());
/** Uma linha por item → [colunas]. */
export const tabela = (t: unknown): string[][] => linhas(t).map(colunas);

export type LinhaTabela = { tipo: "grupo" | "nota" | "linha"; cols: string[] };
/** Tabela com "# grupo" e "> observação" (voos, coberturas). */
export function tabelaComGrupos(t: unknown): LinhaTabela[] {
  return linhas(t).map((l) => {
    if (l.startsWith("#")) return { tipo: "grupo", cols: [l.replace(/^#+\s*/, "")] };
    if (l.startsWith(">")) return { tipo: "nota", cols: [l.replace(/^>+\s*/, "")] };
    return { tipo: "linha", cols: colunas(l) };
  });
}

/** "**Hero Seguros:** câmbio…" → pedaços com negrito (sem HTML). */
export function negritos(t: string): { b: boolean; t: string }[] {
  const out: { b: boolean; t: string }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > i) out.push({ b: false, t: t.slice(i, m.index) });
    out.push({ b: true, t: m[1] });
    i = m.index + m[0].length;
  }
  if (i < t.length) out.push({ b: false, t: t.slice(i) });
  return out;
}

/** "R$ 1.000,48" / "1000.48" / "577,82" → número (0 se não der). */
export function numeroBr(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── Datas no jeito dos PDFs ─────────────────────────────────────────────────
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const SEMANA_CURTA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const d0 = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const ok = (iso: string | null | undefined): iso is string => !!iso && /^\d{4}-\d{2}-\d{2}/.test(iso);

/** "17/08" */
export const ddmm = (iso: string | null | undefined) => (ok(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
/** "17/08/2027" */
export const ddmmaaaa = (iso: string | null | undefined) => (ok(iso) ? `${ddmm(iso)}/${iso.slice(0, 4)}` : "");
/** "17 a 23 de agosto de 2027" · "28 de novembro a 3 de dezembro de 2026" */
export function periodoLongo(ini: string, fim: string): string {
  if (!ok(ini)) return "";
  const [a1, m1, d1] = [Number(ini.slice(0, 4)), Number(ini.slice(5, 7)), Number(ini.slice(8, 10))];
  if (!ok(fim)) return `${d1} de ${MESES[m1 - 1]} de ${a1}`;
  const [a2, m2, d2] = [Number(fim.slice(0, 4)), Number(fim.slice(5, 7)), Number(fim.slice(8, 10))];
  if (a1 === a2 && m1 === m2) return `${d1} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  if (a1 === a2) return `${d1} de ${MESES[m1 - 1]} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  return `${d1} de ${MESES[m1 - 1]} de ${a1} a ${d2} de ${MESES[m2 - 1]} de ${a2}`;
}
/** "17 A 23/08/2027" (faixa do topo) · "30/10 A 12/11/2026" */
export function periodoCurto(ini: string, fim: string): string {
  if (!ok(ini)) return "";
  if (!ok(fim)) return ddmmaaaa(ini);
  if (ini.slice(0, 7) === fim.slice(0, 7)) return `${Number(ini.slice(8, 10))} a ${ddmmaaaa(fim)}`;
  if (ini.slice(0, 4) === fim.slice(0, 4)) return `${ddmm(ini)} a ${ddmmaaaa(fim)}`;
  return `${ddmmaaaa(ini)} a ${ddmmaaaa(fim)}`;
}
/** "19 de outubro de 2026" */
export const dataExtenso = (iso: string | null | undefined) => (ok(iso) ? `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}` : "");
/** "outubro de 2026" */
export const mesAno = (iso: string | null | undefined) => (ok(iso) ? `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}` : "");
export const mesNome = (iso: string) => (ok(iso) ? MESES[Number(iso.slice(5, 7)) - 1] : "");
export const diaSemana = (iso: string) => (ok(iso) ? SEMANA[d0(iso).getDay()] : "");
/** "Sex 30/10" */
export const diaCurto = (iso: string) => (ok(iso) ? `${SEMANA_CURTA[d0(iso).getDay()]} ${ddmm(iso)}` : "");
/** Dias contando o 1º e o último (30/10 → 12/11 = 14 dias), como no seguro. */
export function diasInclusivos(ini: string, fim: string): number {
  if (!ok(ini) || !ok(fim)) return 0;
  return Math.max(0, Math.round((d0(fim).getTime() - d0(ini).getTime()) / 86400000) + 1);
}
const NUM_EXTENSO = ["Zero", "Uma", "Duas", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove", "Dez"];
export const extenso = (n: number) => NUM_EXTENSO[n] ?? String(n);
export const hojeIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// ── Textos FIXOS dos PDFs (literais) ────────────────────────────────────────
export const FIXO = {
  agencia: "Se Tu For, Eu Vou! Viagens",
  telefone: "+55 11 95125 1935",
  email: "atendimento@agenciasetuforeuvou.com",
  slogan: "Se tu for, eu vou!",
  // pacote
  antesDeIrSub: "Clima, documentos e as dicas locais que fazem diferença na viagem.",
  climaRotulos: ["Máxima média", "Mínima média", "Temperatura do mar", "De sol por dia"],
  taxasSelo: "Tudo incluso",
  taxasTitulo: "Taxas locais já inclusas",
  opcionaisSub: "Itens que podem ser adicionados ao pacote, se vocês quiserem.",
  experienciaSelo: "Exclusivo Se Tu For, Eu Vou!",
  experienciaTitulo: "A experiência Se Tu For",
  experienciaSub: "Vocês não compram só um pacote. Cuidamos de cada detalhe para que a única preocupação seja aproveitar.",
  liderRotulo: "Líder de expedição",
  recapSelo: "Tudo o que está no pacote",
  recapTitulo: "Recapitulando a viagem",
  investimento: "Investimento",
  semJuros: "sem juros no cartão de crédito",
  // serviços
  servValores: "Em reais (R$)",
  servSec1: "Serviços adicionais por dia",
  servValoresIndividuais: "Valores individuais.",
  servPorPessoa: "Por pessoa",
  servPrevisto: "Já previsto na programação",
  servSec2: "Resumo dos serviços adicionais",
  servResumoCols: ["Data e serviço", "Valor por pessoa"],
  servJaIncluido: "Já incluído",
  servFormaPagamento: "Forma de pagamento",
  servSec3: "Informações importantes",
  servSec4: "Roteiro da viagem",
  servRoteiroSub: "Programação de referência da viagem, para situar cada serviço no dia a dia.",
  servSugestao: "Sugestão",
  // seguro
  seguroPreparado: "Preparado para",
  seguroCondicoes: "Nas próximas páginas está o comparativo das coberturas. Gostou de alguma opção? É só chamar a gente que cuidamos da emissão.",
  seguroComparativoSec: "Comparativo das principais coberturas",
  seguroCompletasSec: "Coberturas completas",
  seguroRecSec: "Nossa recomendação",
  seguroRecEyebrow: "A melhor opção para a sua viagem",
  seguroPorque: "Por que escolhemos este plano",
  seguroFecho: "Ficou com alguma dúvida ou quer seguir com a emissão? É só chamar a gente!",
  seguroCambio: "Valores sujeitos à variação do câmbio, confirmados no dia da emissão.",
};

// ── Campos de cada modelo (o editor desenha a partir daqui) ─────────────────
export interface CampoModelo {
  chave: string;
  rotulo: string;
  tipo: "texto" | "area" | "tabela" | "check";
  dica?: string;
  exemplo?: string;
  linhas?: number;
  /** "Montar com IA" preenche este campo (texto = a descrição que vai pra IA). */
  ia?: true | string;
}
export interface SecaoModelo { titulo: string; dica?: string; campos: CampoModelo[] }

export const SECOES_PACOTE: SecaoModelo[] = [
  {
    titulo: "Capa", dica: "Título grande = o título da proposta; texto abaixo = a apresentação; foto = a foto da capa.",
    campos: [
      { chave: "selo", rotulo: "Selo acima do título", tipo: "texto", exemplo: "ALL INCLUSIVE", ia: "Selo curto acima do título, ex.: ALL INCLUSIVE (só se os insumos disserem)" },
      { chave: "capa_quadros", rotulo: "Quadros da capa (Rótulo | valor | detalhe)", tipo: "tabela", linhas: 4,
        exemplo: "Saída | Fortaleza | Ter, 17/08 às 16:50\nChegada em Cancún | Qua, 18/08 | às 11:35\nVolta a Fortaleza | Seg, 23/08 | às 10:40\nCompanhia | GOL | econômica" },
      { chave: "rota", rotulo: "Rota do voo de ida (Código | Cidade | voo · hora até o próximo)", tipo: "tabela", linhas: 4,
        exemplo: "FOR | Fortaleza | G3 2055 · 16:50\nGIG | Rio de Janeiro | G3 6610 · 01:35\nBOG | Bogotá | G3 6628 · 07:45\nCUN | Cancún" },
      { chave: "capa_resumo", rotulo: "Faixa de baixo (Rótulo | valor)", tipo: "tabela", linhas: 3,
        dica: "Vazio = Datas (das datas da viagem).", exemplo: "Datas | 17 a 23 de agosto de 2027\nAcomodação | Quarto duplo ou single\nHospedagem | 4 noites, tudo incluído" },
    ],
  },
  {
    titulo: "Sumário e voos",
    campos: [
      { chave: "sumario_sub", rotulo: "Linha abaixo de \"Sumário da viagem\"", tipo: "texto", ia: "Resumo em uma linha: destino · datas · hotel · quarto · cidade de saída", exemplo: "Cancún all inclusive · 17 a 23 de agosto de 2027 · 4 noites no Hilton · quarto duplo ou single · saída de Fortaleza" },
      { chave: "sumario", rotulo: "Sumário (Data | o que acontece)", tipo: "tabela", linhas: 7, dica: "Vazio = usa a data e o título de cada dia do dia a dia.",
        exemplo: "17/08 | Embarque em Fortaleza, rumo ao Caribe\n18/08 | Chegada a Cancún e tarde livre no Hilton" },
      { chave: "voos_nota", rotulo: "Observação dos voos", tipo: "area", exemplo: "Horários em hora local de cada cidade. Cancún fica 2 horas atrás de Fortaleza em agosto." },
      { chave: "voos", rotulo: "Tabela de voos (Trecho | Voo | Saída | Chegada | Duração)", tipo: "tabela", linhas: 10,
        dica: "\"# …\" = linha de Ida/Volta · \"> …\" = conexão.",
        exemplo: "# Ida · terça, 17/08/2027 · 20h45 no total, 2 escalas\nFortaleza → Rio de Janeiro (Galeão) | G3 2055 | 16:50 | 20:10 | 3h20\n> Conexão de 5h25 no Rio de Janeiro, com troca de avião\nRio de Janeiro → Bogotá | G3 6610 | 01:35 (18/08) | 06:00 | 6h25\n# Volta · domingo, 22/08/2027 · 15h50 no total, 2 escalas\nCancún → Bogotá | G3 6632 | 16:50 | 20:15 | 3h25" },
    ],
  },
  {
    titulo: "Bom saber",
    campos: [
      { chave: "bom_saber", rotulo: "Cartões (# Título do cartão, depois um item por linha)", tipo: "tabela", linhas: 12,
        exemplo: "# Documentos\nPassaporte válido e visto mexicano eletrônico…\nLista completa em \"Antes de ir\"." },
    ],
  },
  {
    titulo: "Antes de ir",
    campos: [
      { chave: "clima_titulo", rotulo: "Título do clima", tipo: "texto", exemplo: "Clima em Cancún em meados de agosto" },
      { chave: "clima", rotulo: "Máxima | Mínima | Mar | Sol por dia", tipo: "texto", exemplo: "31 °C | 27 °C | 29 °C | 11 h", dica: "Deixe vazio o que não fizer sentido (ex.: mar)." },
      { chave: "tempo", rotulo: "Como é o tempo (um por linha)", tipo: "area", linhas: 4 },
      { chave: "mala", rotulo: "O que levar na mala (um por linha)", tipo: "area", linhas: 4 },
      { chave: "antes_foto", rotulo: "Foto (link)", tipo: "texto" },
    ],
  },
  {
    titulo: "Documentos e cancelamento",
    campos: [
      { chave: "documentos", rotulo: "Documentos necessários (Documento | Detalhe)", tipo: "tabela", linhas: 6, exemplo: "Passaporte | Válido por pelo menos 6 meses a partir da data de entrada no México." },
      { chave: "documentos_nota", rotulo: "Nota abaixo dos documentos", tipo: "texto" },
      { chave: "cancelamento", rotulo: "Condições de cancelamento (Serviço | Cancelamento grátis até | Depois disso)", tipo: "tabela", linhas: 6, ia: true,
        exemplo: "Hilton Cancun | 05/08/2027 | Multa de 20% até a chegada. Sem comparecimento, cobrança total." },
      { chave: "cancelamento_nota", rotulo: "Nota abaixo do cancelamento", tipo: "texto" },
    ],
  },
  {
    titulo: "Dicas locais",
    campos: [
      { chave: "dicas", rotulo: "Dicas (Título | texto)", tipo: "tabela", linhas: 9, exemplo: "Moeda | Peso mexicano (MXN). Pagar em pesos costuma sair melhor que em dólar." },
      { chave: "dicas_foto", rotulo: "Foto (link)", tipo: "texto" },
    ],
  },
  {
    titulo: "Taxas e opcionais",
    campos: [
      { chave: "taxas_sub", rotulo: "Texto abaixo de \"Taxas locais já inclusas\"", tipo: "area" },
      { chave: "taxas", rotulo: "Taxas (Taxa | Quando | No pacote)", tipo: "tabela", linhas: 5, ia: "Taxas locais citadas nos insumos (Taxa | Quando | No pacote: Incluso ou Não incluso)", exemplo: "Taxa da hospedagem do Hilton | Check-in, 18/08 | Incluso" },
      { chave: "taxas_nota", rotulo: "Nota abaixo das taxas", tipo: "texto" },
      { chave: "opcionais", rotulo: "Opcionais (Categoria | Nome | Descrição | Valor por pessoa | Valor casal)", tipo: "tabela", linhas: 3, ia: "Opcionais com preço nos insumos, ex.: mala de porão (Categoria | Nome | Descrição | + R$ por pessoa | Casal: + R$)",
        exemplo: "Bagagem | Mala de porão | Uma mala despachada por pessoa em todos os trechos, de ida e de volta. | + R$ 750 | Casal: + R$ 1.500" },
      { chave: "opcionais_aviso_titulo", rotulo: "Título do aviso dos opcionais", tipo: "texto" },
      { chave: "opcionais_aviso", rotulo: "Texto do aviso dos opcionais", tipo: "area" },
    ],
  },
  {
    titulo: "A experiência Se Tu For",
    campos: [
      { chave: "experiencia", rotulo: "Cartões (Título | texto)", tipo: "tabela", linhas: 8 },
      { chave: "lider", rotulo: "Faixa \"Líder de expedição\" (vazio = não aparece)", tipo: "area" },
    ],
  },
  {
    titulo: "Recapitulando a viagem",
    campos: [
      { chave: "recap_sub", rotulo: "Linha abaixo do título", tipo: "texto" },
      { chave: "recap", rotulo: "Cartões (Rótulo | Título | texto)", tipo: "tabela", linhas: 10, dica: "Comece o rótulo com * pra destacar o cartão (borda escura).",
        exemplo: "Aéreo | GOL ida e volta | Fortaleza e Cancún, conexões no Rio de Janeiro e em Bogotá.\n*Exclusivo Se Tu For | Experiência Se Tu For | Líder de expedição com o grupo, roteiro personalizado…" },
      { chave: "recap_notas", rotulo: "Notas no fim (uma por linha; a última sai menor — créditos das fotos)", tipo: "area", linhas: 3 },
    ],
  },
  {
    titulo: "Investimento", dica: "Os cartões de preço são as opções abaixo (o cliente escolhe uma).",
    campos: [
      { chave: "invest_titulo", rotulo: "Título", tipo: "texto", exemplo: "Líder de expedição com o grupo" },
      { chave: "invest_texto", rotulo: "Texto abaixo do título", tipo: "area" },
      { chave: "condicoes", rotulo: "Condições", tipo: "area", linhas: 4 },
      { chave: "chamada", rotulo: "Chamada da faixa final", tipo: "texto", exemplo: "Garanta as datas de agosto enquanto o valor está travado. É só chamar a gente." },
    ],
  },
];

export const SECOES_SERVICOS: SecaoModelo[] = [
  {
    titulo: "Capa", dica: "Título grande = o título da proposta (ex.: Família Sobreira); texto abaixo = a apresentação.",
    campos: [
      { chave: "selo", rotulo: "Selo no canto (opcional)", tipo: "texto", exemplo: "Proposta atualizada" },
      { chave: "cidades", rotulo: "Cidades (acima do título)", tipo: "texto", exemplo: "Madri · Toledo · Barcelona", ia: "Cidades da viagem separadas por · (ex.: Madri · Toledo · Barcelona)" },
    ],
  },
  {
    titulo: "1 · Serviços adicionais por dia", dica: "Cada serviço é cadastrado abaixo, com o valor por pessoa.",
    campos: [{ chave: "nota_valores", rotulo: "Texto depois de \"Valores individuais.\"", tipo: "area" }],
  },
  {
    titulo: "2 · Resumo e pagamento", dica: "A tabela do resumo sai sozinha dos serviços.",
    campos: [
      { chave: "pagamento", rotulo: "Forma de pagamento (faixa verde)", tipo: "area", exemplo: "Pagamento em condição especial via PIX, em razão da proximidade do embarque e da aceitação do fornecedor." },
      { chave: "nota_resumo", rotulo: "Texto abaixo da forma de pagamento", tipo: "area", linhas: 4 },
    ],
  },
  {
    titulo: "3 · Informações importantes",
    campos: [
      { chave: "infos", rotulo: "Cartões (Rótulo | texto)", tipo: "tabela", linhas: 3, ia: "Informações importantes dos serviços, ex.: transporte (Rótulo | texto)", exemplo: "Transporte dos passeios | Ônibus de 30 lugares para o grupo.\nChegada e saída | Ônibus de 54 lugares." },
      { chave: "infos_nota", rotulo: "Texto abaixo dos cartões", tipo: "area" },
    ],
  },
  {
    titulo: "4 · Roteiro da viagem",
    campos: [
      { chave: "ida", rotulo: "Faixa IDA (Voo | Rota | detalhe)", tipo: "tabela", linhas: 2, exemplo: "Iberia 150 | Fortaleza 18:25 → Madri 06:10 | Qui 29/10 · chegada sex 30/10 · voo direto" },
      { chave: "roteiro", rotulo: "Dias (# Cidade | hotel · período, depois Data | Título | texto | sugestão)", tipo: "tabela", linhas: 14,
        dica: "\"# Madri | Ramada… · 30/10 a 04/11\" abre a cidade. Dia: 2026-10-30 | Chegada a Madri e city tour | texto | s (s = SUGESTÃO). \"> …\" = dia de transição (faixa tracejada).",
        exemplo: "# Madri | Ramada by Wyndham Tres Cantos · 30/10 a 04/11\n2026-10-30 | Chegada a Madri e city tour | Chegada às 06:10 e city tour panorâmico (4h)…\n2026-10-31 | Segóvia | Excursão privativa de dia inteiro | s\n> 2026-11-04 | Trem para Barcelona e passeio panorâmico | alta velocidade Madri → Barcelona… | s" },
      { chave: "retorno", rotulo: "Faixa RETORNO (Voo | Rota | detalhe)", tipo: "tabela", linhas: 2, exemplo: "Iberia 404 | Barcelona 09:15 → Madri 10:40 | Dom 08/11" },
    ],
  },
];

export const SECOES_SEGURO: SecaoModelo[] = [
  {
    titulo: "Capa", dica: "\"Preparado para\" = o nome do cliente; destino e datas = os da viagem; texto abaixo do nome = a apresentação (vazio = gerado).",
    campos: [
      { chave: "condicoes_pagamento", rotulo: "Pagamento", tipo: "texto" },
      { chave: "validade", rotulo: "Validade", tipo: "texto" },
    ],
  },
  {
    titulo: "Comparativo", dica: "Colunas na ordem dos planos (todas as seguradoras, da 1ª à última).",
    campos: [
      { chave: "comparativo", rotulo: "Coberturas lado a lado (Cobertura | plano 1 | plano 2 | …)", tipo: "tabela", linhas: 9,
        exemplo: "Assistência médica | 80.000 | 100.000 | 250.000 | 50.000 | 100.000 | 250.000\nCancelamento de viagem | 1.500 | 1.500 | 2.000 | — | — | 1.000" },
      { chave: "comparativo_notas", rotulo: "Notas (uma por linha; **negrito** funciona)", tipo: "area", linhas: 4, ia: "Notas da cotação, uma por linha, ex.: **Hero Seguros:** câmbio de referência US$ 1 = R$ 5,01.", exemplo: "**Hero Seguros:** câmbio de referência US$ 1 = R$ 5,01." },
    ],
  },
  {
    titulo: "Nossa recomendação", dica: "O plano recomendado é o marcado com ★ nos planos.",
    campos: [
      { chave: "rec_sub", rotulo: "Texto abaixo do nome do plano", tipo: "texto", exemplo: "O plano mais vendido da Universal e o melhor equilíbrio entre proteção e preço para a sua viagem." },
      { chave: "rec_motivos", rotulo: "Por que escolhemos este plano (um por linha; **negrito** funciona)", tipo: "area", linhas: 5 },
      { chave: "rec_alt_titulo", rotulo: "Alternativa: título", tipo: "texto", exemplo: "Quer cobertura máxima? Universal Diamante" },
      { chave: "rec_alt_texto", rotulo: "Alternativa: texto (**negrito** funciona)", tipo: "area" },
    ],
  },
  { titulo: "Rodapé", campos: [{ chave: "rodape", rotulo: "Rodapé de todas as páginas", tipo: "texto", ia: "Número/data de cada cotação, ex.: Cotação Hero Seguros nº 403-14360 · Cotação Universal de 14/10/2026", exemplo: "Cotação Hero Seguros nº 403-14360-0-60-0 · Cotação Universal Assistance de 14/10/2026" }] },
];

export const SECOES: Record<ModeloProposta, SecaoModelo[]> = { pacote: SECOES_PACOTE, servicos: SECOES_SERVICOS, seguro: SECOES_SEGURO };

// ── Estruturas que não cabem em texto corrido ───────────────────────────────
export interface DiaPacote { data: string; titulo: string; subtitulo: string; linhas: string; fotos: string }
export interface HotelPacote { selo: string; nome: string; descricao: string; checkin: string; checkout: string; comodidades_rotulo: string; comodidades: string; fotos: string }
export interface SeguradoraModelo { nome: string; nota: string; coberturas: string; rodape: string }
/** O que o cartão/plano tem a mais que a opção (mesma ordem das opções). */
export interface ExtraOpcao { selo?: string; rotulo?: string; total_rotulo?: string; grupo?: number; preco_pax?: number }

export type Conteudo = Record<string, unknown> & {
  dias?: DiaPacote[];
  hoteis?: HotelPacote[];
  seguradoras?: SeguradoraModelo[];
  opcoes_extra?: ExtraOpcao[];
};

export const diaVazio = (data = ""): DiaPacote => ({ data, titulo: "", subtitulo: "", linhas: "", fotos: "" });
export const hotelVazio = (): HotelPacote => ({ selo: "", nome: "", descricao: "", checkin: "", checkout: "", comodidades_rotulo: "No resort", comodidades: "", fotos: "" });
export const seguradoraVazia = (nome = ""): SeguradoraModelo => ({ nome, nota: "", coberturas: "", rodape: "" });

/** Textos que já nascem preenchidos (os genéricos dos PDFs, literais). */
export function conteudoInicial(modelo: ModeloProposta, ctx: { pax: number; cliente: string; hoje?: string }): Conteudo {
  const hoje = ctx.hoje ?? hojeIso();
  const n = ctx.pax || 0;
  if (modelo === "pacote") {
    return {
      selo: "", capa_quadros: "", rota: "", capa_resumo: "",
      sumario_sub: "", sumario: "", voos_nota: "Horários em hora local de cada cidade.", voos: "",
      bom_saber: [
        "# A Se Tu For com vocês a viagem toda",
        "Um líder de expedição da Se Tu For viaja com o grupo, e nossa equipe acompanha antes, durante e depois.",
        "Conferimos cada voo, transfer e passeio e avisamos qualquer mudança.",
        "Precisou de algo no destino? É só chamar no WhatsApp.",
        "# Bagagem",
        "Inclui uma mochila e uma mala de mão por pessoa em todos os trechos.",
        "Mala despachada não está inclusa. Pode ser adicionada como opcional, consultando o nosso time de especialistas, pois o valor pode mudar a qualquer momento.",
        "# Documentos",
        "Lista completa em \"Antes de ir\".",
      ].join("\n"),
      clima_titulo: "", clima: "", tempo: "", mala: "", antes_foto: "",
      documentos: "Passaporte | \nSeguro viagem | \nCartão de crédito físico | Útil no check-in do hotel e para despesas pessoais.",
      documentos_nota: `Regras de entrada consultadas em ${mesAno(hoje)}. Conferimos tudo de novo antes da viagem.`,
      cancelamento: "", cancelamento_nota: "",
      dicas: "Moeda | \nGorjetas | \nFuso horário | \nTomadas | \nÁgua | \nInternet | \nNa chegada | \nPara provar | ",
      dicas_foto: "",
      taxas_sub: "No destino, algumas taxas e impostos são cobrados direto no destino. Na Se Tu For, eles já estão no valor do pacote: vocês viajam sem conta extra para fazer e sem surpresa.",
      taxas: "", taxas_nota: "",
      opcionais: "",
      opcionais_aviso_titulo: "Consulte antes de incluir",
      opcionais_aviso: "O valor da bagagem de porão é definido pela companhia aérea e pode mudar a qualquer momento. Para incluir, fale com o nosso time de especialistas, que confirma o valor atualizado.",
      experiencia: [
        "Roteiro personalizado dia a dia | Um guia feito para vocês, com horários, restaurantes e bares indicados, preços médios, passeios extras e programas gratuitos para cada noite.",
        "Tudo conferido antes do embarque | Cruzamos voos, hotel, transfers e passeios entre si e resolvemos qualquer divergência antes de vocês saírem de casa.",
        "Documentação sem dor de cabeça | Orientação sobre passaporte e visto, com checklist de tudo o que precisa estar na mala.",
        "Salas VIP no caminho | Mapeamos as salas VIP de cada aeroporto que os seus cartões dão acesso, para as conexões virarem descanso.",
        "Transfer em todos os passeios | Do hotel ao passeio e de volta, sem táxi, sem negociação e sem perder tempo.",
        "Sem conta extra no destino | As taxas e impostos locais já estão no pacote. Vocês só se preocupam em aproveitar.",
        "Memórias da viagem | Uma dinâmica com uma pequena missão por dia, pensada para transformar a viagem em lembranças que ficam.",
      ].join("\n"),
      lider: "Um líder de expedição da Se Tu For viaja com o grupo do embarque à volta. E nossa equipe acompanha tudo pelo WhatsApp.",
      recap_sub: "", recap: "*Exclusivo Se Tu For | Experiência Se Tu For | Líder de expedição com o grupo, roteiro personalizado, vouchers conferidos e orientação de documentos.",
      recap_notas: "",
      invest_titulo: "Líder de expedição com o grupo",
      invest_texto: "Um líder de expedição da Se Tu For acompanha vocês do embarque à volta, conduzindo cada passeio e cuidando de tudo de perto.",
      condicoes: `Valores consultados em ${ddmmaaaa(hoje)}, sujeitos a disponibilidade e alteração até a confirmação da reserva. Taxas e impostos locais já inclusos. Gorjetas a critério de cada viajante.`,
      chamada: "É só chamar a gente.",
      dias: [], hoteis: [hotelVazio()], opcoes_extra: [],
    };
  }
  if (modelo === "servicos") {
    const familia = /^fam[ií]lia\b/i.test(ctx.cliente.trim());
    return {
      selo: "", cidades: "",
      nota_valores: `Cada serviço tem seu próprio valor por pessoa, considerando os ${n} passageiros. ${familia ? "A família escolhe quais quer" : "Vocês escolhem quais querem"} incluir na programação.`,
      pagamento: "",
      nota_resumo: `Os valores são individuais e consideram ${n} passageiros. Valores sujeitos à confirmação de disponibilidade até a contratação. As experiências podem ser contratadas individualmente ou em conjunto, conforme a preferência ${familia ? "da família" : "de vocês"}.`,
      infos: "",
      infos_nota: `As refeições não estão incluídas, exceto quando indicado no serviço. A proposta pode ser personalizada de acordo com o que ${ctx.cliente || "vocês"} desejar incluir na programação.`,
      ida: "", roteiro: "", retorno: "", opcoes_extra: [],
    };
  }
  return {
    condicoes_pagamento: "PIX, boleto ou cartão de crédito em até 12x.",
    validade: `valores de ${ddmmaaaa(hoje)}, sujeitos à variação do câmbio; na emissão confirmamos o valor do dia.`,
    comparativo: [
      "Assistência médica", "Despesas farmacêuticas", "Perda / extravio de bagagem", "Atraso de voo", "Cancelamento de viagem",
      "Interrupção de viagem", "Regresso sanitário", "Sala VIP em atraso de voo",
    ].map((c) => `${c} | `).join("\n"),
    comparativo_notas: "",
    rec_sub: "", rec_motivos: "", rec_alt_titulo: "", rec_alt_texto: "", rodape: "",
    seguradoras: [seguradoraVazia()], opcoes_extra: [],
  };
}

// ── Pacote: dias do dia a dia ───────────────────────────────────────────────
/** "16:50 | Embarque…" → [{quando, texto}] */
export const linhasDoDia = (t: string) => tabela(t).map((c) => ({ quando: c.length > 1 ? c[0] : "", texto: c.length > 1 ? c.slice(1).join(" | ") : c[0] }));
/** "url | legenda" → fotos */
export const fotos = (t: unknown) => tabela(t).filter((c) => /^https?:\/\//i.test(c[0])).map((c) => ({ url: c[0], legenda: c[1] ?? "" }));

// ── Serviços: roteiro por cidade ────────────────────────────────────────────
export interface DiaRoteiro { n: number; data: string; titulo: string; texto: string; sugestao: boolean }
export type BlocoRoteiro = { tipo: "cidade"; cidade: string; hotel: string; dias: DiaRoteiro[] } | { tipo: "transicao"; dia: DiaRoteiro };
export function roteiroServicos(t: unknown): { blocos: BlocoRoteiro[]; totalDias: number } {
  const blocos: BlocoRoteiro[] = [];
  let n = 0;
  const dia = (cols: string[]): DiaRoteiro => {
    n += 1;
    const sug = /^(s|sim|sugest[aã]o)$/i.test(cols[3] ?? "");
    return { n, data: cols[0] ?? "", titulo: cols[1] ?? "", texto: cols[2] ?? "", sugestao: sug };
  };
  for (const l of linhas(t)) {
    if (l.startsWith("#")) {
      const c = colunas(l.replace(/^#+\s*/, ""));
      blocos.push({ tipo: "cidade", cidade: c[0] ?? "", hotel: c.slice(1).join(" | "), dias: [] });
    } else if (l.startsWith(">")) {
      blocos.push({ tipo: "transicao", dia: dia(colunas(l.replace(/^>+\s*/, ""))) });
    } else {
      let ult = blocos[blocos.length - 1];
      if (!ult || ult.tipo !== "cidade") { ult = { tipo: "cidade", cidade: "", hotel: "", dias: [] }; blocos.push(ult); }
      ult.dias.push(dia(colunas(l)));
    }
  }
  return { blocos, totalDias: n };
}

/** Detalhes de um serviço do modelo "servicos" (qs_proposta_itens.detalhes). */
export interface DetalhesServico {
  local?: string; nota_dia?: string; data_rotulo?: string; resumo?: string;
  opcional_rotulo?: string; opcional_texto?: string; opcional_valor?: string; opcional_nota?: string; opcional_resumo?: string;
  alternativas_intro?: string; alternativas?: string;
}
export interface Alternativa { rotulo: string; texto: string; valor: number; resumo: string; destaque: boolean }
/** "*OPÇÃO 2 · COM ALMOÇO | texto | 1.000,48 | Segóvia com almoço" (* = cartão escuro). */
export const alternativas = (t: unknown): Alternativa[] => tabela(t).map((c) => {
  const destaque = c[0]?.startsWith("*") ?? false;
  return { rotulo: (c[0] ?? "").replace(/^\*\s*/, ""), texto: c[1] ?? "", valor: numeroBr(c[2]), resumo: c[3] ?? "", destaque };
});

/** Linhas do "Resumo dos serviços adicionais" (sai sozinho dos serviços). */
export function resumoServicos(itens: { nome: string; data_inicio: string; incluso: boolean; valor_total: number; detalhes: Record<string, unknown> }[]):
  { tag: string; texto: string; valor: string }[] {
  const out: { tag: string; texto: string; valor: string }[] = [];
  const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  for (const i of itens) {
    const d = i.detalhes as DetalhesServico;
    const tag = ddmm(i.data_inicio) || d.data_rotulo || "Viagem";
    const alts = alternativas(d.alternativas);
    if (alts.length) for (const a of alts) out.push({ tag, texto: a.resumo || `${i.nome} — ${a.rotulo}`, valor: reais(a.valor) });
    else out.push({ tag, texto: d.resumo || i.nome, valor: i.incluso ? FIXO.servJaIncluido : reais(i.valor_total) });
    if (d.opcional_rotulo || d.opcional_texto) out.push({ tag, texto: `Opcional: ${d.opcional_resumo || d.opcional_texto || d.opcional_rotulo}`, valor: `+ ${reais(numeroBr(d.opcional_valor))}` });
  }
  return out;
}
