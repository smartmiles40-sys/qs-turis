// src/fin/comissoes/calculo.ts
// -----------------------------------------------------------------------------
// COMISSÕES DOS SDRs E CLOSERS (Bruno, 06/11/2026): "quanto cada um vai receber,
// como se fosse uma planilha, card por card".
//
// CONTA PURA — nada de banco aqui (os testes importam este arquivo direto).
// Quem chama entrega as vendas (espelho do Bitrix, fin_com_vendas, 0327), as
// regras, os ajustes do financeiro e o mês; a conta devolve uma linha por
// card × pessoa × papel.
//
// AS REGRAS DO BRUNO
//   * R.R (reunião realizada) = valor FIXO, só pro SDR, no mês da
//     `data_reuniao_realizada` — mesmo sem venda (é o que o Rank SDR conta).
//   * Venda de Expedição = valor FIXO por card.
//   * Venda de Aéreo e de Pacote = PERCENTUAL do valor da venda.
//   * A venda vale no mês da `data_venda` ("na hora que ele sobe a venda").
//   * Tipos sem regra (Seguro, Passeios, Hospedagem, Outros…) e venda sem tipo
//     entram com 0 e um selo; o financeiro digita um valor manual com motivo.
//   * Regra por papel (SDR / closer), exceção por pessoa e vigência (data de
//     início): a regra que vale é a mais nova com vigência <= data do fato.
//     Campo vazio numa exceção = usa a regra geral naquele campo.
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
export type Categoria = "expedicao" | "aereo" | "pacote" | "sem_regra" | "sem_tipo";

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
}

export interface Regra {
  id?: string;
  obs?: string | null;
  papel: Papel;
  pessoa_id: string | null;             // null = regra geral do papel
  vigente_desde: string;                // YYYY-MM-DD
  valor_rr: number | null;
  valor_expedicao: number | null;
  pct_aereo: number | null;
  pct_pacote: number | null;
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

export interface Linha {
  chave: string;                        // bitrix_id|papel|pessoa
  bitrix_id: string;
  papel: Papel;
  pessoa_id: string | null;             // null = fila "sem dono"
  nome_bitrix: string;                  // como veio do Bitrix (sem dono: pra mapear)
  cliente: string;
  pipeline: string;
  fase: string;
  tipo_venda: string | null;
  categoria: Categoria | null;          // null quando a linha é só R.R
  expedicao: string | null;
  /** Valor da venda que vale NESTE mês (0 quando a linha é só R.R ou cancelada). */
  valor_venda: number;
  data_venda: string | null;
  venda_no_mes: boolean;
  rr: boolean;                          // a reunião foi realizada (em qualquer mês)
  rr_data: string | null;
  rr_no_mes: boolean;                   // a R.R paga NESTE mês
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
  if (t) return "sem_regra";
  // Sem tipo, mas é a venda "Não se aplica" do SDR: o Dashboard trata como aéreo.
  return ehAereo(n) ? "aereo" : "sem_tipo";
}

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  expedicao: "Expedição", aereo: "Aéreo", pacote: "Pacote", sem_regra: "Sem regra", sem_tipo: "Sem tipo",
};

// ── Regras de comissão ──────────────────────────────────────────────────────
type CampoRegra = "valor_rr" | "valor_expedicao" | "pct_aereo" | "pct_pacote";

/**
 * O valor de um campo da regra que vale pra pessoa no dia: a exceção da pessoa
 * mais nova com vigência <= dia (se o campo estiver preenchido), senão a regra
 * geral do papel mais nova com vigência <= dia. Sem nenhuma: 0.
 */
export function valorDaRegra(regras: Regra[], papel: Papel, pessoaId: string | null, dia: string, campo: CampoRegra): number {
  const vigentes = regras
    .filter((r) => r.papel === papel && r.vigente_desde <= dia)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : a.vigente_desde > b.vigente_desde ? -1 : 0));
  if (pessoaId) {
    const daPessoa = vigentes.find((r) => r.pessoa_id === pessoaId);
    if (daPessoa && daPessoa[campo] != null) return Number(daPessoa[campo]) || 0;
  }
  const geral = vigentes.find((r) => r.pessoa_id == null);
  return geral && geral[campo] != null ? Number(geral[campo]) || 0 : 0;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

export function comissaoDaVenda(regras: Regra[], papel: Papel, pessoaId: string | null, categoria: Categoria, valor: number, dia: string): number {
  if (categoria === "expedicao") return centavos(valorDaRegra(regras, papel, pessoaId, dia, "valor_expedicao"));
  if (categoria === "aereo") return centavos((valor * valorDaRegra(regras, papel, pessoaId, dia, "pct_aereo")) / 100);
  if (categoria === "pacote") return centavos((valor * valorDaRegra(regras, papel, pessoaId, dia, "pct_pacote")) / 100);
  return 0;
}

// ── Mês ─────────────────────────────────────────────────────────────────────
export const noMes = (dia: string | null | undefined, mes: string) => !!dia && dia.slice(0, 7) === mes;

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

/**
 * Todas as linhas do mês (YYYY-MM): uma por card × papel × pessoa.
 *  * SDR: o card entra se a VENDA é do mês OU a R.R é do mês.
 *  * Closer: o card entra se a VENDA é do mês e não é venda do próprio SDR.
 *  * Card com nome do Bitrix que não casou com ninguém do QS → pessoa_id null
 *    (fila "sem dono", só o financeiro vê). Card sem SDR nem closer (os dois
 *    "Não se aplica" ou vazios) com venda no mês → uma linha "sem dono" de closer.
 */
export function linhasDoMes(vendas: VendaCard[], regras: Regra[], ajustes: Ajuste[], mes: string): Linha[] {
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

    const base = (papel: Papel, pessoaId: string | null, nomeBitrix: string, entraVenda: boolean, entraRr: boolean): Linha => {
      const vendaVale = entraVenda && !cancelada;
      const comissaoRr = entraRr && papel === "sdr" ? centavos(valorDaRegra(regras, "sdr", pessoaId, v.data_reuniao_realizada!, "valor_rr")) : 0;
      const comissaoVenda = vendaVale ? comissaoDaVenda(regras, papel, pessoaId, categoria, total, v.data_venda!) : 0;
      const calculada = centavos(comissaoRr + comissaoVenda);
      const ajuste = ajusteVigente(ajustes, v.bitrix_id, pessoaId, papel, mes);
      const comissao = ajuste ? (ajuste.tipo === "nao_comissiona" ? 0 : centavos(Number(ajuste.valor) || 0)) : calculada;
      const selos: string[] = [];
      if (entraVenda && cancelada) selos.push("Venda cancelada");
      if (entraVenda && categoria === "sem_regra") selos.push("Sem regra");
      if (entraVenda && categoria === "sem_tipo") selos.push("Sem tipo");
      if (papel === "sdr" && entraVenda && vendaDoSdr) selos.push("Venda do próprio SDR");
      if (papel === "sdr" && rr && !rrNoMes && entraVenda) selos.push("R.R paga em outro mês");
      if (ajuste?.tipo === "nao_comissiona") selos.push("Não comissiona");
      else if (ajuste) selos.push("Valor ajustado");
      if (!pessoaId) selos.push("Sem dono");
      return {
        chave: `${v.bitrix_id}|${papel}|${pessoaId ?? nomeBitrix}`,
        bitrix_id: v.bitrix_id, papel, pessoa_id: pessoaId, nome_bitrix: nomeBitrix,
        cliente: (v.nome ?? "").trim() || "—", pipeline: v.pipeline ?? "", fase: v.fase ?? "",
        tipo_venda: v.tipo_venda, categoria: entraVenda ? categoria : null, expedicao: v.nome_expedicao,
        valor_venda: vendaVale ? total : 0, data_venda: v.data_venda, venda_no_mes: entraVenda,
        rr, rr_data: v.data_reuniao_realizada, rr_no_mes: entraRr,
        cancelada: entraVenda && cancelada, venda_do_sdr: vendaDoSdr,
        comissao_rr: comissaoRr, comissao_venda: comissaoVenda, comissao_calculada: calculada,
        ajuste, comissao, selos,
      };
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
  return linhas.sort((a, b) => (a.data_venda ?? a.rr_data ?? "").localeCompare(b.data_venda ?? b.rr_data ?? "") || a.bitrix_id.localeCompare(b.bitrix_id));
}

export interface ResumoPessoa {
  pessoa_id: string | null;
  papel: Papel;
  nome_bitrix: string;
  cards: number;
  vendas: number;            // quantos cards com venda no mês (não cancelada)
  soma_vendas: number;
  rr: number;                // R.R pagas no mês
  total: number;             // comissão a receber
}

export function resumoPorPessoa(linhas: Linha[]): ResumoPessoa[] {
  const m = new Map<string, ResumoPessoa>();
  for (const l of linhas) {
    const k = `${l.papel}|${l.pessoa_id ?? "?" + l.nome_bitrix}`;
    const r = m.get(k) ?? { pessoa_id: l.pessoa_id, papel: l.papel, nome_bitrix: l.nome_bitrix, cards: 0, vendas: 0, soma_vendas: 0, rr: 0, total: 0 };
    r.cards += 1;
    if (l.valor_venda > 0) { r.vendas += 1; r.soma_vendas = centavos(r.soma_vendas + l.valor_venda); }
    if (l.rr_no_mes) r.rr += 1;
    r.total = centavos(r.total + l.comissao);
    m.set(k, r);
  }
  return [...m.values()];
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
 * Comissão; Closer sem R.R) + Data da venda, Pipeline e o nome da pessoa.
 */
export function csvDasLinhas(linhas: (Linha & { pessoa?: string })[], papel: Papel): string {
  const cab = papel === "sdr"
    ? ["Pessoa", "ID", "Nome", "R.R", "Data da R.R", "Valor da venda", "Tipo da venda", "Expedição", "Data da venda", "Pipeline", "Comissão", "Observação"]
    : ["Pessoa", "ID", "Nome", "Valor da venda", "Tipo da venda", "Expedição", "Data da venda", "Pipeline", "Comissão", "Observação"];
  const out = [cab.join(";")];
  for (const l of linhas) {
    const obs = [...l.selos, l.ajuste ? `Motivo: ${l.ajuste.motivo}` : ""].filter(Boolean).join(" · ");
    const comum = [l.pessoa ?? l.nome_bitrix, l.bitrix_id, l.cliente];
    const venda = [l.venda_no_mes ? numeroBr(l.valor_venda) : "", l.venda_no_mes ? (l.tipo_venda ?? "Sem tipo") : "", l.expedicao ?? "", dataBr(l.data_venda), l.pipeline];
    const linha = papel === "sdr"
      ? [...comum, l.rr_no_mes ? "Sim" : "Não", dataBr(l.rr_data), ...venda, numeroBr(l.comissao), obs]
      : [...comum, ...venda, numeroBr(l.comissao), obs];
    out.push(linha.map((c) => celula(String(c ?? ""))).join(";"));
  }
  return out.join("\r\n");
}
