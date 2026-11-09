// src/fin/comissoes/calculo.ts
// -----------------------------------------------------------------------------
// COMISSÕES DOS SDRs E CLOSERS (Bruno, 06/11/2026): "quanto cada um vai receber,
// como se fosse uma planilha, card por card".
//
// CONTA PURA — nada de banco aqui (os testes importam este arquivo direto).
// Quem chama entrega as vendas (espelho do Bitrix, fin_com_vendas), as regras,
// os ajustes do financeiro, os lucros digitados, as cotações e o mês; a conta
// devolve uma linha por card × pessoa × papel, mais as linhas de bônus diário
// e de cotação de aéreo do SDR.
//
// AS REGRAS DO BRUNO (PDF "Comissão por tipo de produto", vigente out/2026; 0328)
//   SDR — venda originada (o card em que ela é a SDR, no mês da data_venda):
//     * Expedição: fixo por destino — Peru, Amazônia ou "geral" (Ásia, Europa,
//       Egito e qualquer outro destino).
//     * Pacote: fixo.
//     * Aéreo vendido pela PRÓPRIA SDR: % do LUCRO.
//     * Passagem (fechada pelo closer), hospedagem, seguro, passeios e outros: fixo.
//     * Cotação de aéreo feita por ela e entregue no mês: fixo por proposta.
//   SDR — R.R (no mês da data_reuniao_realizada): a FAIXA do mês (quantas R.R
//     ela teve) define o valor de TODAS as R.R do mês. Reunião de aéreo da própria
//     SDR recebe o valor da faixa, mas NÃO conta pra subir de faixa.
//   SDR — bônus diário: no dia em que agendou N reuniões (data_quando_agendou),
//     ganha o bônus da MAIOR faixa batida (6 → R$ 20; 10 → R$ 40; não soma).
//   Closer (venda no mês, que não seja do próprio SDR):
//     * Expedição: fixo por destino (mesmos 3 grupos).
//     * Pacote, aéreo e demais: % do LUCRO (por pessoa: Talita 11%, Bruno 10%).
//   * Lucro: o Bitrix não traz custo → o Financeiro digita por card. Sem lucro,
//     a linha de % sai R$ 0 com o selo "Falta lucro".
//   * Venda sem tipo: 0 + selo; o financeiro ajusta com motivo.
//   * Regra por papel, exceção por pessoa (campo vazio = geral) e vigência.
//
// AS REGRAS DO DASHBOARD (copiadas de New dashboard/src/lib, mesmas contas)
//   * Closer da venda = "Responsável pela reunião" (useRankData.ts).
//   * Venda de aéreo do próprio SDR (reunião "Não se aplica" ou o nome da própria
//     SDR) é venda DO SDR, não do closer (vendaDoSdr.ts → ehVendaDoSdr).
//   * Reunião de aéreo não conta como R.R, menos a lista AEREOS_QUE_CONTAM
//     (reuniaoStatus.ts → reuniaoFoiRealizada).
//   * Venda cancelada (fase Cancelamento/Desistência) não conta (vendaCancelada.ts).
//   * Venda = tem data_venda e total > 0 (vendaConta.ts).
// -----------------------------------------------------------------------------

export type Papel = "sdr" | "closer";
export type Categoria = "expedicao" | "aereo" | "pacote" | "outros" | "sem_tipo";
export type Destino = "geral" | "peru" | "amazonia";
export type TipoLinha = "card" | "bonus_dia" | "cotacao";

/** Um card do Bitrix como o QS guarda (fin_com_vendas). */
export interface VendaCard {
  bitrix_id: string;
  nome: string | null;
  pipeline: string | null;
  fase: string | null;
  tipo_venda: string | null;
  nome_expedicao: string | null;
  total: number | null;
  data_venda: string | null;            // YYYY-MM-DD
  sdr: string | null;                   // nome como veio do Bitrix
  responsavel_reuniao: string | null;   // = closer no Dashboard
  data_reuniao_realizada: string | null;
  no_show: boolean | null;
  sdr_id: string | null;                // qs_users.id resolvido (apelidos)
  closer_id: string | null;
  data_quando_agendou?: string | null;  // dia em que o SDR agendou (bônus diário)
  custo?: number | null;                // se um dia vier do Bitrix
}

export interface Faixa { de: number; valor: number }
export interface FaixaBonus { min: number; valor: number }

export interface Regra {
  id?: string;
  obs?: string | null;
  papel: Papel;
  pessoa_id: string | null;             // null = regra geral do papel
  vigente_desde: string;                // YYYY-MM-DD
  valor_exp_geral?: number | null;
  valor_exp_peru?: number | null;
  valor_exp_amazonia?: number | null;
  valor_pacote?: number | null;         // SDR
  valor_outros?: number | null;         // SDR: passagem (via closer), hospedagem, seguro, outros
  pct_lucro?: number | null;            // SDR: aéreo próprio · closer: pacote, aéreo e demais
  valor_cotacao?: number | null;        // SDR
  faixas_rr?: Faixa[] | null;           // SDR
  bonus_dia?: FaixaBonus[] | null;      // SDR
  sem_comissao?: boolean | null;        // exceção: a pessoa não entra na conta (supervisor)
}

export interface Ajuste {
  bitrix_id: string;
  pessoa_id: string;
  papel: Papel;
  mes: string;                          // YYYY-MM
  tipo: "valor" | "nao_comissiona" | "limpar";
  valor: number | null;
  motivo: string;
  criado_em: string;
  criado_por?: string | null;
}

/** Cotação de aéreo feita pelo próprio SDR e entregue (fin_com_cotacoes, 0328). */
export interface Cotacao {
  id: string;
  sdr_id: string;
  destino: string | null;
  status: string;
  entregue_em: string;                  // ISO
  negocio_bitrix_id: string | null;
}

export interface Extras {
  /** Lucro digitado pelo financeiro, por bitrix_id. */
  lucros?: Record<string, number>;
  cotacoes?: Cotacao[];
}

export interface Linha {
  chave: string;                        // bitrix_id|papel|pessoa
  tipo_linha: TipoLinha;
  bitrix_id: string;                    // bônus: "bonus-AAAA-MM-DD"; cotação: "cot-<id>"
  papel: Papel;
  pessoa_id: string | null;             // null = fila "sem dono"
  nome_bitrix: string;                  // como veio do Bitrix (sem dono: pra mapear)
  cliente: string;
  pipeline: string;
  fase: string;
  tipo_venda: string | null;
  categoria: Categoria | null;          // null quando a linha não tem venda no mês
  expedicao: string | null;
  destino: Destino | null;
  /** Valor da venda que vale NESTE mês (0 quando a linha é só R.R ou cancelada). */
  valor_venda: number;
  data_venda: string | null;
  venda_no_mes: boolean;
  /** Lucro usado no % (null = não tem). */
  lucro: number | null;
  lucro_origem: "digitado" | "bitrix" | null;
  usa_lucro: boolean;                   // a comissão desta venda é % do lucro
  rr: boolean;                          // a reunião foi realizada (em qualquer mês)
  rr_data: string | null;
  rr_no_mes: boolean;                   // a R.R paga NESTE mês
  rr_conta_faixa: boolean;              // soma pra faixa (aéreo do próprio SDR não soma)
  valor_por_rr: number;                 // o valor da faixa aplicado (0 sem R.R)
  agendamentos: number;                 // bônus diário: quantos agendou no dia
  data_ref: string | null;              // bônus/cotação: o dia
  cancelada: boolean;
  venda_do_sdr: boolean;
  comissao_rr: number;
  comissao_venda: number;
  comissao_calculada: number;
  ajuste: Ajuste | null;
  comissao: number;                     // a que vale (calculada ou ajustada)
  selos: string[];
}

// ── Regras copiadas do Dashboard ───────────────────────────────────────────
const NAO_SE_APLICA = /^n[aã]o se aplica$/i;
const TIPO_AEREO = /passage(m|ns)\s+a[eé]rea/i;

export const AEREOS_QUE_CONTAM = new Set([
  "47771", "47865", "49779", "49951", "49963", "49403", "49795",
  "47841", "48205", "48207", "48813", "48819", "48847", "49179", "49065", "49453", "50229", "50369",
  "51111",
]);

const FASES_POS_REUNIAO = new Set([
  "em negociação", "em negociacao", "venda realizada", "vendas realizadas / vendas relacionamento",
  "em negociação (quente)", "em negociacao (quente)", "vendas realizadas / vendas comercial",
  "em emissão/venda realizada", "em emissão", "gerar pagamento", "envio de contrato", "cancelamento/desistência",
]);

/** "Mariana Rodrigues - SDR" → "Mariana Rodrigues". */
export function nomeBase(nome: string): string {
  return nome.replace(/\s*-\s*(sdr|closer|especialista|coordenador|coordenadora)\s*$/i, "").trim();
}

export function ehNaoSeAplica(nome: string | null | undefined): boolean {
  return NAO_SE_APLICA.test((nome ?? "").trim());
}

export function ehVendaDoSdr(n: Pick<VendaCard, "responsavel_reuniao" | "sdr">): boolean {
  const resp = (n.responsavel_reuniao ?? "").trim();
  const sdr = (n.sdr ?? "").trim();
  if (!resp || !sdr) return false;
  if (NAO_SE_APLICA.test(resp)) return true;
  if (/-\s*(closer|especialista|coordenador|coordenadora)\s*$/i.test(sdr)) return false;
  return nomeBase(resp).toLowerCase() === nomeBase(sdr).toLowerCase();
}

export function ehAereo(n: Pick<VendaCard, "tipo_venda" | "responsavel_reuniao" | "sdr">): boolean {
  if (TIPO_AEREO.test(n.tipo_venda ?? "")) return true;
  return NAO_SE_APLICA.test((n.responsavel_reuniao ?? "").trim()) && !!(n.sdr ?? "").trim();
}

export function reuniaoFoiRealizada(n: Pick<VendaCard, "tipo_venda" | "responsavel_reuniao" | "sdr" | "bitrix_id" | "no_show" | "fase">): boolean {
  if (ehAereo(n) && !AEREOS_QUE_CONTAM.has(String(n.bitrix_id).trim())) return false;
  if (!n.no_show) return true;
  return FASES_POS_REUNIAO.has((n.fase || "").toLowerCase().trim());
}

export function ehCancelada(n: Pick<VendaCard, "fase">): boolean {
  const f = (n.fase || "").toLowerCase();
  return f.includes("desist") || f.includes("cancelamento");
}

/** Tipo de venda do Bitrix → categoria da comissão. */
export function categoriaDe(n: Pick<VendaCard, "tipo_venda" | "responsavel_reuniao" | "sdr">): Categoria {
  const t = (n.tipo_venda ?? "").trim().toLowerCase();
  if (/^expedi/.test(t)) return "expedicao";
  if (TIPO_AEREO.test(t)) return "aereo";
  if (/^pacote/.test(t)) return "pacote";
  if (t) return "outros";
  // Sem tipo, mas é a venda "Não se aplica" do SDR: o Dashboard trata como aéreo.
  return ehAereo(n) ? "aereo" : "sem_tipo";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nome da expedição → grupo de valor. Vazio/"Não se aplica" = geral (com selo). */
export function destinoDe(nomeExpedicao: string | null | undefined): Destino {
  const t = semAcento(nomeExpedicao ?? "");
  if (/\bperu\b/.test(t)) return "peru";
  if (/amazon/.test(t)) return "amazonia";
  return "geral";
}

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  expedicao: "Expedição", aereo: "Aéreo", pacote: "Pacote", outros: "Outros", sem_tipo: "Sem tipo",
};
export const ROTULO_DESTINO: Record<Destino, string> = { geral: "Ásia/Europa/Egito…", peru: "Peru", amazonia: "Amazônia" };

// ── Regras de comissão ──────────────────────────────────────────────────────
type CampoNum = "valor_exp_geral" | "valor_exp_peru" | "valor_exp_amazonia" | "valor_pacote" | "valor_outros" | "pct_lucro" | "valor_cotacao";
type CampoLista = "faixas_rr" | "bonus_dia";

function vigentes(regras: Regra[], papel: Papel, dia: string): Regra[] {
  return regras
    .filter((r) => r.papel === papel && r.vigente_desde <= dia)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : a.vigente_desde > b.vigente_desde ? -1 : 0));
}

/** O campo que vale pra pessoa no dia: a exceção mais nova com o campo preenchido; senão a geral mais nova. */
function campoDaRegra<K extends keyof Regra>(regras: Regra[], papel: Papel, pessoaId: string | null, dia: string, campo: K): Regra[K] | null {
  const vs = vigentes(regras, papel, dia);
  if (pessoaId) {
    const daPessoa = vs.find((r) => r.pessoa_id === pessoaId);
    if (daPessoa && daPessoa[campo] != null) return daPessoa[campo];
  }
  const geral = vs.find((r) => r.pessoa_id == null);
  return geral && geral[campo] != null ? geral[campo] : null;
}

/** A pessoa está fora da comissão nesse papel/dia (exceção "sem comissão" vigente)? */
export function foraDaComissao(regras: Regra[], papel: Papel, pessoaId: string | null, dia: string): boolean {
  if (!pessoaId) return false;
  const daPessoa = vigentes(regras, papel, dia).find((r) => r.pessoa_id === pessoaId);
  return !!daPessoa?.sem_comissao;
}

/** Campo numérico da regra (0 quando ninguém preencheu). */
export function valorDaRegra(regras: Regra[], papel: Papel, pessoaId: string | null, dia: string, campo: CampoNum): number {
  return Number(campoDaRegra(regras, papel, pessoaId, dia, campo)) || 0;
}

function listaDaRegra<T>(regras: Regra[], papel: Papel, pessoaId: string | null, dia: string, campo: CampoLista): T[] {
  const v = campoDaRegra(regras, papel, pessoaId, dia, campo);
  return Array.isArray(v) ? (v as T[]) : [];
}

/** As faixas de R.R que valem pro SDR no dia (vazio = sem regra). */
export function faixasDoSdr(regras: Regra[], pessoaId: string | null, dia: string): Faixa[] {
  return listaDaRegra<Faixa>(regras, "sdr", pessoaId, dia, "faixas_rr");
}

/** Valor por R.R pra quem teve `qtd` R.R no mês (a maior faixa com "de" <= qtd). */
export function valorDaFaixa(faixas: Faixa[], qtd: number): { valor: number; faixa: Faixa | null; proxima: Faixa | null } {
  const ord = [...faixas].sort((a, b) => a.de - b.de);
  let faixa: Faixa | null = null;
  for (const f of ord) if (qtd >= f.de) faixa = f;
  const proxima = ord.find((f) => f.de > qtd) ?? null;
  return { valor: Number(faixa?.valor) || 0, faixa, proxima };
}

/** Bônus do dia com `qtd` agendamentos (a maior faixa batida; não soma). */
export function bonusDoDia(faixas: FaixaBonus[], qtd: number): number {
  let v = 0;
  for (const f of [...faixas].sort((a, b) => a.min - b.min)) if (qtd >= f.min) v = Number(f.valor) || 0;
  return v;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

const CAMPO_EXP: Record<Destino, CampoNum> = { geral: "valor_exp_geral", peru: "valor_exp_peru", amazonia: "valor_exp_amazonia" };

/** Comissão de uma venda. `usaLucro` diz se é % do lucro (aí lucro null = 0). */
export function comissaoDaVenda(
  regras: Regra[], papel: Papel, pessoaId: string | null, v: { categoria: Categoria; destino: Destino; vendaDoSdr: boolean; lucro: number | null }, dia: string,
): { valor: number; usaLucro: boolean } {
  const r = (c: CampoNum) => valorDaRegra(regras, papel, pessoaId, dia, c);
  const pctDoLucro = () => ({ valor: v.lucro == null ? 0 : centavos((v.lucro * r("pct_lucro")) / 100), usaLucro: true });
  if (v.categoria === "sem_tipo") return { valor: 0, usaLucro: false };
  if (v.categoria === "expedicao") return { valor: centavos(r(CAMPO_EXP[v.destino])), usaLucro: false };
  if (papel === "closer") return pctDoLucro();
  if (v.categoria === "pacote") return { valor: centavos(r("valor_pacote")), usaLucro: false };
  if (v.categoria === "aereo" && v.vendaDoSdr) return pctDoLucro();
  return { valor: centavos(r("valor_outros")), usaLucro: false };
}

// ── Mês ─────────────────────────────────────────────────────────────────────
export const noMes = (dia: string | null | undefined, mes: string) => !!dia && dia.slice(0, 7) === mes;

/** ISO (UTC) → dia em Brasília. */
const diaBr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** O ajuste que vale: o mais novo da chave (histórico fica no banco). */
export function ajusteVigente(ajustes: Ajuste[], bitrixId: string, pessoaId: string | null, papel: Papel, mes: string): Ajuste | null {
  if (!pessoaId) return null;
  let melhor: Ajuste | null = null;
  for (const a of ajustes) {
    if (a.bitrix_id !== bitrixId || a.pessoa_id !== pessoaId || a.papel !== papel || a.mes !== mes) continue;
    if (!melhor || a.criado_em > melhor.criado_em) melhor = a;
  }
  return melhor && melhor.tipo !== "limpar" ? melhor : null;
}

const nomeVazio = (s: string | null | undefined) => !(s ?? "").trim() || ehNaoSeAplica(s);
const chavePessoa = (pessoaId: string | null, nomeBitrix: string) => pessoaId ?? `?${nomeBitrix.toLowerCase()}`;

function linhaVazia(p: Partial<Linha> & Pick<Linha, "chave" | "tipo_linha" | "bitrix_id" | "papel" | "pessoa_id" | "nome_bitrix">): Linha {
  return {
    cliente: "—", pipeline: "", fase: "", tipo_venda: null, categoria: null, expedicao: null, destino: null,
    valor_venda: 0, data_venda: null, venda_no_mes: false, lucro: null, lucro_origem: null, usa_lucro: false,
    rr: false, rr_data: null, rr_no_mes: false, rr_conta_faixa: false, valor_por_rr: 0, agendamentos: 0, data_ref: null,
    cancelada: false, venda_do_sdr: false, comissao_rr: 0, comissao_venda: 0, comissao_calculada: 0,
    ajuste: null, comissao: 0, selos: [], ...p,
  };
}

/**
 * Todas as linhas do mês (YYYY-MM).
 *  * SDR: o card entra se a VENDA é do mês OU a R.R é do mês. Mais uma linha por
 *    dia com bônus de agendamentos e uma por cotação de aéreo entregue.
 *  * Closer: o card entra se a VENDA é do mês e não é venda do próprio SDR.
 *  * Nome do Bitrix que não casou com ninguém do QS → pessoa_id null ("sem
 *    dono"). Card sem SDR nem closer com venda no mês → "sem dono" de closer.
 */
export function linhasDoMes(vendas: VendaCard[], regras: Regra[], ajustes: Ajuste[], mes: string, extras: Extras = {}): Linha[] {
  const lucros = extras.lucros ?? {};
  const linhas: Linha[] = [];

  for (const v of vendas) {
    const total = Number(v.total) || 0;
    const cancelada = ehCancelada(v);
    const temVenda = !!v.data_venda && total > 0;
    const vendaNoMes = temVenda && noMes(v.data_venda, mes);
    const vendaDoSdr = ehVendaDoSdr(v);
    const rr = !!v.data_reuniao_realizada && reuniaoFoiRealizada(v);
    const rrNoMes = rr && noMes(v.data_reuniao_realizada, mes);
    const categoria = categoriaDe(v);
    const destino = destinoDe(v.nome_expedicao);
    const custo = Number(v.custo) || 0;
    const digitado = lucros[v.bitrix_id];
    const lucro = digitado != null ? Number(digitado) : custo > 0 ? centavos(total - custo) : null;
    const lucroOrigem = digitado != null ? "digitado" as const : custo > 0 ? "bitrix" as const : null;

    const base = (papel: Papel, pessoaId: string | null, nomeBitrix: string, entraVenda: boolean, entraRr: boolean): Linha => {
      const vendaVale = entraVenda && !cancelada;
      const cv = vendaVale ? comissaoDaVenda(regras, papel, pessoaId, { categoria, destino, vendaDoSdr, lucro }, v.data_venda!) : { valor: 0, usaLucro: false };
      const selos: string[] = [];
      if (entraVenda && cancelada) selos.push("Venda cancelada");
      if (entraVenda && categoria === "sem_tipo") selos.push("Sem tipo");
      if (entraVenda && categoria === "expedicao" && (nomeVazio(v.nome_expedicao))) selos.push("Expedição sem nome");
      if (vendaVale && cv.usaLucro && lucro == null) selos.push("Falta lucro");
      if (papel === "sdr" && entraVenda && vendaDoSdr) selos.push("Venda do próprio SDR");
      if (papel === "sdr" && entraRr && ehAereo(v)) selos.push("R.R de aéreo: fora da faixa");
      if (papel === "sdr" && rr && !rrNoMes && entraVenda) selos.push("R.R paga em outro mês");
      if (!pessoaId) selos.push("Sem dono");
      return linhaVazia({
        chave: `${v.bitrix_id}|${papel}|${pessoaId ?? nomeBitrix}`, tipo_linha: "card",
        bitrix_id: v.bitrix_id, papel, pessoa_id: pessoaId, nome_bitrix: nomeBitrix,
        cliente: (v.nome ?? "").trim() || "—", pipeline: v.pipeline ?? "", fase: v.fase ?? "",
        tipo_venda: v.tipo_venda, categoria: entraVenda ? categoria : null, expedicao: v.nome_expedicao,
        destino: entraVenda && categoria === "expedicao" ? destino : null,
        valor_venda: vendaVale ? total : 0, data_venda: v.data_venda, venda_no_mes: entraVenda,
        lucro: entraVenda ? lucro : null, lucro_origem: entraVenda ? lucroOrigem : null, usa_lucro: vendaVale && cv.usaLucro,
        rr, rr_data: v.data_reuniao_realizada, rr_no_mes: entraRr, rr_conta_faixa: entraRr && papel === "sdr" && !ehAereo(v),
        cancelada: entraVenda && cancelada, venda_do_sdr: vendaDoSdr,
        comissao_venda: cv.valor, selos,
      });
    };

    const temSdr = !nomeVazio(v.sdr);
    const temCloser = !nomeVazio(v.responsavel_reuniao) && !vendaDoSdr;

    if (temSdr && (vendaNoMes || rrNoMes)) {
      linhas.push(base("sdr", v.sdr_id, nomeBase(v.sdr!), vendaNoMes, rrNoMes));
    }
    if (temCloser && vendaNoMes) {
      linhas.push(base("closer", v.closer_id, nomeBase(v.responsavel_reuniao!), true, false));
    }
    if (!temSdr && !temCloser && vendaNoMes) {
      linhas.push(base("closer", null, (v.responsavel_reuniao ?? "").trim() || "(sem responsável)", true, false));
    }
  }

  // R.R: a faixa do mês (contada por SDR) vale pra todas as R.R dela.
  const rrPorSdr = new Map<string, number>();
  for (const l of linhas) if (l.papel === "sdr" && l.rr_conta_faixa) {
    const k = chavePessoa(l.pessoa_id, l.nome_bitrix);
    rrPorSdr.set(k, (rrPorSdr.get(k) ?? 0) + 1);
  }
  for (const l of linhas) if (l.papel === "sdr" && l.rr_no_mes) {
    const qtd = rrPorSdr.get(chavePessoa(l.pessoa_id, l.nome_bitrix)) ?? 0;
    l.valor_por_rr = valorDaFaixa(listaDaRegra<Faixa>(regras, "sdr", l.pessoa_id, l.rr_data!, "faixas_rr"), qtd).valor;
    l.comissao_rr = centavos(l.valor_por_rr);
  }

  // Bônus diário de agendamentos (por SDR × dia em que agendou).
  const agendou = new Map<string, { pessoaId: string | null; nome: string; dia: string; qtd: number }>();
  for (const v of vendas) {
    if (!noMes(v.data_quando_agendou, mes) || nomeVazio(v.sdr)) continue;
    const nome = nomeBase(v.sdr!);
    const k = `${chavePessoa(v.sdr_id, nome)}|${v.data_quando_agendou}`;
    const a = agendou.get(k) ?? { pessoaId: v.sdr_id, nome, dia: v.data_quando_agendou!, qtd: 0 };
    a.qtd += 1;
    agendou.set(k, a);
  }
  for (const a of agendou.values()) {
    const valor = bonusDoDia(listaDaRegra<FaixaBonus>(regras, "sdr", a.pessoaId, a.dia, "bonus_dia"), a.qtd);
    if (valor <= 0) continue;
    linhas.push(linhaVazia({
      chave: `bonus-${a.dia}|sdr|${a.pessoaId ?? a.nome}`, tipo_linha: "bonus_dia", bitrix_id: `bonus-${a.dia}`,
      papel: "sdr", pessoa_id: a.pessoaId, nome_bitrix: a.nome,
      cliente: `Bônus do dia: ${a.qtd} agendamentos`, tipo_venda: "Bônus diário",
      agendamentos: a.qtd, data_ref: a.dia, comissao_venda: valor, selos: a.pessoaId ? [] : ["Sem dono"],
    }));
  }

  // Cotações de aéreo entregues pelo próprio SDR.
  for (const c of extras.cotacoes ?? []) {
    const dia = diaBr(c.entregue_em);
    if (!noMes(dia, mes)) continue;
    const valor = centavos(valorDaRegra(regras, "sdr", c.sdr_id, dia, "valor_cotacao"));
    linhas.push(linhaVazia({
      chave: `cot-${c.id}|sdr|${c.sdr_id}`, tipo_linha: "cotacao", bitrix_id: `cot-${c.id}`,
      papel: "sdr", pessoa_id: c.sdr_id, nome_bitrix: "",
      cliente: `Cotação de aéreo${c.destino ? `: ${c.destino}` : ""}`, tipo_venda: "Cotação de aéreo",
      fase: c.status, data_ref: dia, comissao_venda: valor,
    }));
  }

  // Quem está fora da comissão (supervisor) some da conta.
  const dentro = linhas.filter((l) => !foraDaComissao(regras, l.papel, l.pessoa_id, l.data_venda ?? l.rr_data ?? l.data_ref ?? `${mes}-01`));
  linhas.length = 0;
  linhas.push(...dentro);

  // Total calculado + ajuste do financeiro.
  for (const l of linhas) {
    l.comissao_calculada = centavos(l.comissao_rr + l.comissao_venda);
    const ajuste = ajusteVigente(ajustes, l.bitrix_id, l.pessoa_id, l.papel, mes);
    l.ajuste = ajuste;
    l.comissao = ajuste ? (ajuste.tipo === "nao_comissiona" ? 0 : centavos(Number(ajuste.valor) || 0)) : l.comissao_calculada;
    if (ajuste?.tipo === "nao_comissiona") l.selos.push("Não comissiona");
    else if (ajuste) l.selos.push("Valor ajustado");
  }

  const ordem: Record<TipoLinha, number> = { card: 0, cotacao: 1, bonus_dia: 2 };
  return linhas.sort((a, b) =>
    ordem[a.tipo_linha] - ordem[b.tipo_linha]
    || (a.data_venda ?? a.rr_data ?? a.data_ref ?? "").localeCompare(b.data_venda ?? b.rr_data ?? b.data_ref ?? "")
    || a.bitrix_id.localeCompare(b.bitrix_id));
}

export interface ResumoPessoa {
  pessoa_id: string | null;
  papel: Papel;
  nome_bitrix: string;
  cards: number;
  vendas: number;            // quantos cards com venda no mês (não cancelada)
  soma_vendas: number;
  rr: number;                // R.R pagas no mês
  rr_faixa: number;          // R.R que contam pra faixa
  valor_por_rr: number;
  total_rr: number;
  total_vendas: number;
  dias_bonus: number;
  total_bonus: number;
  cotacoes: number;
  total_cotacoes: number;
  falta_lucro: number;       // vendas de % sem lucro digitado
  total: number;             // comissão a receber
}

export function resumoPorPessoa(linhas: Linha[]): ResumoPessoa[] {
  const m = new Map<string, ResumoPessoa>();
  for (const l of linhas) {
    const k = `${l.papel}|${l.pessoa_id ?? "?" + l.nome_bitrix}`;
    const r = m.get(k) ?? {
      pessoa_id: l.pessoa_id, papel: l.papel, nome_bitrix: l.nome_bitrix, cards: 0, vendas: 0, soma_vendas: 0,
      rr: 0, rr_faixa: 0, valor_por_rr: 0, total_rr: 0, total_vendas: 0, dias_bonus: 0, total_bonus: 0,
      cotacoes: 0, total_cotacoes: 0, falta_lucro: 0, total: 0,
    };
    // As partes usam o calculado; o total respeita o ajuste.
    if (l.tipo_linha === "card") {
      r.cards += 1;
      if (l.valor_venda > 0) { r.vendas += 1; r.soma_vendas = centavos(r.soma_vendas + l.valor_venda); }
      if (l.rr_no_mes) { r.rr += 1; r.total_rr = centavos(r.total_rr + l.comissao_rr); r.valor_por_rr = Math.max(r.valor_por_rr, l.valor_por_rr); }
      if (l.rr_conta_faixa) r.rr_faixa += 1;
      r.total_vendas = centavos(r.total_vendas + l.comissao_venda);
      if (l.usa_lucro && l.lucro == null) r.falta_lucro += 1;
    } else if (l.tipo_linha === "bonus_dia") {
      r.dias_bonus += 1; r.total_bonus = centavos(r.total_bonus + l.comissao_venda);
    } else {
      r.cotacoes += 1; r.total_cotacoes = centavos(r.total_cotacoes + l.comissao_venda);
    }
    r.total = centavos(r.total + l.comissao);
    m.set(k, r);
  }
  return [...m.values()];
}

/** "Como chegou nesse valor" de uma linha (aparece na planilha e no CSV). */
export function explicacao(l: Linha): string {
  const brl = (n: number) => `R$ ${numeroBr(n)}`;
  if (l.tipo_linha === "bonus_dia") return `${l.agendamentos} agendamentos no dia → ${brl(l.comissao_venda)}`;
  if (l.tipo_linha === "cotacao") return `Cotação entregue → ${brl(l.comissao_venda)}`;
  const partes: string[] = [];
  if (l.rr_no_mes) partes.push(`R.R ${brl(l.comissao_rr)}`);
  if (l.venda_no_mes && !l.cancelada && l.categoria) {
    if (l.usa_lucro) partes.push(l.lucro == null ? "venda: falta o lucro" : `venda: % de ${brl(l.lucro)} de lucro = ${brl(l.comissao_venda)}`);
    else if (l.categoria === "expedicao") partes.push(`expedição ${l.destino ? ROTULO_DESTINO[l.destino] : ""} ${brl(l.comissao_venda)}`);
    else partes.push(`${ROTULO_CATEGORIA[l.categoria].toLowerCase()} ${brl(l.comissao_venda)}`);
  }
  return partes.join(" + ");
}

// ── Exportação (CSV pro Excel em português) ─────────────────────────────────
/** 1234.5 → "1.234,50" (sem "R$", pra Excel ler como número). */
export function numeroBr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

export const dataBr = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");

function celula(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV com separador ";" e números no formato brasileiro, nas colunas que o Bruno
 * pediu (SDR: ID | Nome | R.R | Valor da venda | Tipo da venda | Expedição |
 * Comissão; Closer sem R.R) + Lucro, Data, Pipeline, a conta e o nome da pessoa.
 */
export function csvDasLinhas(linhas: (Linha & { pessoa?: string })[], papel: Papel): string {
  const cab = papel === "sdr"
    ? ["Pessoa", "ID", "Nome", "R.R", "Data da R.R", "Valor por R.R", "Valor da venda", "Tipo da venda", "Expedição", "Lucro", "Data", "Pipeline", "Comissão", "Conta", "Observação"]
    : ["Pessoa", "ID", "Nome", "Valor da venda", "Tipo da venda", "Expedição", "Lucro", "Data", "Pipeline", "Comissão", "Conta", "Observação"];
  const out = [cab.join(";")];
  for (const l of linhas) {
    const obs = [...l.selos, l.ajuste ? `Motivo: ${l.ajuste.motivo}` : ""].filter(Boolean).join(" · ");
    const card = l.tipo_linha === "card";
    const comum = [l.pessoa ?? l.nome_bitrix, card ? l.bitrix_id : "", l.cliente];
    const venda = [
      l.venda_no_mes ? numeroBr(l.valor_venda) : "", card ? (l.venda_no_mes ? (l.tipo_venda ?? "Sem tipo") : "") : (l.tipo_venda ?? ""),
      l.expedicao && l.venda_no_mes ? l.expedicao : "", l.lucro != null ? numeroBr(l.lucro) : "",
      dataBr(card ? l.data_venda : l.data_ref), l.pipeline,
    ];
    const fim = [numeroBr(l.comissao), explicacao(l), obs];
    const linha = papel === "sdr"
      ? [...comum, l.rr_no_mes ? "Sim" : card ? "Não" : "", dataBr(l.rr_data), l.rr_no_mes ? numeroBr(l.valor_por_rr) : "", ...venda, ...fim]
      : [...comum, ...venda, ...fim];
    out.push(linha.map((c) => celula(String(c ?? ""))).join(";"));
  }
  return out.join("\r\n");
}
