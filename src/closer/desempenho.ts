// src/closer/desempenho.ts
// -----------------------------------------------------------------------------
// DESEMPENHO DO CLOSER (03/11/2026) — "100% visual, só o que importa".
// A conta mora aqui (sem React, sem rede) pra dar pra testar; a tela é
// ./DesempenhoCloser.tsx.
//
// O QUE CADA NÚMERO É (período pela data da reunião / do envio / da venda):
//   R.R. ............ reuniões REALIZADAS (qs_meetings.status = 'realizada').
//   No-show ......... qs_meetings.status = 'no_show'; taxa = no-show ÷ (realizadas + no-show).
//   Reunião de aéreo (Tipo de venda 71 "Passagens aéreas") não conta como
//   reunião — mesma regra do Dashboard (14/10).
//   SAL ............. das realizadas de 1ª reunião (tipo 'primeira'), quantas
//                     o closer marcou SAL aceito. Retomada não entra.
//   Propostas ....... qs_propostas enviadas no período (enviada_em), por quem
//                     enviou (enviada_por; sem ele, criado_por).
//   Vendas .......... cartões do pipeline com pré-venda OU ficha de fechamento
//                     no período (qs_closer_negocios), sem aéreo. Valor = ficha
//                     → pré-venda → valor previsto. Uma venda por cartão.
//   Faturamento ..... soma das vendas. Ticket médio = faturamento ÷ vendas.
//   Conversão ....... vendas ÷ R.R.
//   Em negociação ... o valor que o closer INFORMOU no desfecho das realizadas
//                     (qs_meetings.venda_valor, sem aéreo). NÃO é venda: no-show
//                     também leva valor ali (medido em 03/11: 12 de 19).
// -----------------------------------------------------------------------------

export const TIPO_AEREO = "71";

export interface ReuniaoLida {
  closer_id: string | null;
  status: string;
  tipo: string | null;
  sal: string | null;
  venda_valor: number | string | null;
  venda_tipo: string | null;
}
export interface NegocioLido {
  id: string;
  closer_id: string | null;
  pre_venda_em: string | null;
  pre_venda_valor: number | string | null;
  pre_venda_tipo?: string | null;
  pre_venda_tipo_bitrix?: string | null;
  consolidada_em: string | null;
  valor_previsto: number | string | null;
  etapa?: string | null;
  ficha: { valor_total?: number | string | null; tipo_bitrix?: string | null; servico?: string | null } | null;
}
export interface PropostaLida { enviada_por: string | null; criado_por: string | null; status: string }

export interface Metricas {
  id: string;
  nome: string;
  realizadas: number;
  noShow: number;
  taxaNoShow: number | null;   // 0..1
  primeiras: number;           // realizadas de 1ª reunião (base do SAL)
  sal: number;                 // SAL aceito
  salSemResposta: number;      // 1ª reunião realizada sem SAL marcado
  taxaSal: number | null;
  propostas: number;
  vendas: number;
  faturamento: number;
  ticket: number | null;
  conversao: number | null;    // vendas ÷ realizadas
  emNegociacao: number;
}

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export const reuniaoDeAereo = (r: Pick<ReuniaoLida, "venda_tipo">) => String(r.venda_tipo ?? "") === TIPO_AEREO;

export function vendaDeAereo(n: NegocioLido): boolean {
  return String(n.pre_venda_tipo_bitrix ?? "") === TIPO_AEREO
    || String(n.ficha?.tipo_bitrix ?? "") === TIPO_AEREO
    || n.pre_venda_tipo === "aereo"
    || n.ficha?.servico === "aereo";
}
export const valorDaVenda = (n: NegocioLido) => num(n.ficha?.valor_total ?? n.pre_venda_valor ?? n.valor_previsto);

export function calcularDesempenho(
  dados: { reunioes: ReuniaoLida[]; negocios: NegocioLido[]; propostas: PropostaLida[] },
  closers: { id: string; nome: string }[],
): { porCloser: Metricas[]; time: Metricas } {
  const nomes = new Map(closers.map((c) => [c.id, c.nome]));
  const linhas = new Map<string, Metricas>();
  const linha = (id: string): Metricas => {
    let l = linhas.get(id);
    if (!l) {
      l = { id, nome: nomes.get(id) ?? "Sem nome", realizadas: 0, noShow: 0, taxaNoShow: null, primeiras: 0, sal: 0, salSemResposta: 0, taxaSal: null, propostas: 0, vendas: 0, faturamento: 0, ticket: null, conversao: null, emNegociacao: 0 };
      linhas.set(id, l);
    }
    return l;
  };
  for (const c of closers) linha(c.id);

  for (const r of dados.reunioes) {
    if (!r.closer_id || reuniaoDeAereo(r)) continue;
    const l = linha(r.closer_id);
    if (r.status === "realizada") {
      l.realizadas++;
      l.emNegociacao += num(r.venda_valor);
      if ((r.tipo ?? "primeira") === "primeira") {
        l.primeiras++;
        if (r.sal === "aceito") l.sal++;
        else if (!r.sal) l.salSemResposta++;
      }
    } else if (r.status === "no_show") {
      l.noShow++;
    }
  }
  const vistos = new Set<string>();
  for (const n of dados.negocios) {
    if (!n.closer_id || vistos.has(n.id) || vendaDeAereo(n)) continue;
    if (n.etapa === "perdido" || n.etapa === "venda_cancelada") continue;
    vistos.add(n.id);
    const l = linha(n.closer_id);
    l.vendas++;
    l.faturamento += valorDaVenda(n);
  }
  for (const p of dados.propostas) {
    const quem = p.enviada_por || p.criado_por;
    if (!quem || !linhas.has(quem)) continue; // só conta proposta de closer
    linha(quem).propostas++;
  }

  const fechar = (l: Metricas) => {
    l.taxaNoShow = div(l.noShow, l.realizadas + l.noShow);
    l.taxaSal = div(l.sal, l.primeiras);
    l.ticket = div(l.faturamento, l.vendas);
    l.conversao = div(l.vendas, l.realizadas);
    return l;
  };
  const porCloser = [...linhas.values()].map(fechar)
    .sort((a, b) => b.faturamento - a.faturamento || b.realizadas - a.realizadas || a.nome.localeCompare(b.nome));
  const time = fechar(porCloser.reduce<Metricas>((t, l) => ({
    ...t,
    realizadas: t.realizadas + l.realizadas, noShow: t.noShow + l.noShow, primeiras: t.primeiras + l.primeiras,
    sal: t.sal + l.sal, salSemResposta: t.salSemResposta + l.salSemResposta, propostas: t.propostas + l.propostas,
    vendas: t.vendas + l.vendas, faturamento: t.faturamento + l.faturamento, emNegociacao: t.emNegociacao + l.emNegociacao,
  }), { id: "time", nome: "Time", realizadas: 0, noShow: 0, taxaNoShow: null, primeiras: 0, sal: 0, salSemResposta: 0, taxaSal: null, propostas: 0, vendas: 0, faturamento: 0, ticket: null, conversao: null, emNegociacao: 0 }));
  return { porCloser, time };
}

// ── Período (São Paulo; o Brasil não tem horário de verão desde 2019) ─────────
export type PresetPeriodo = "mes" | "mes_passado" | "7d" | "30d" | "personalizado";
export const PRESETS: { id: PresetPeriodo; rotulo: string }[] = [
  { id: "mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "personalizado", rotulo: "Escolher datas" },
];
function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** De/até (AAAA-MM-DD, inclusive) de um preset, a partir de "hoje" em SP. */
export function datasDoPreset(p: PresetPeriodo, hoje: string): { de: string; ate: string } {
  if (p === "7d") return { de: somaDias(hoje, -6), ate: hoje };
  if (p === "30d") return { de: somaDias(hoje, -29), ate: hoje };
  if (p === "mes_passado") {
    const primeiro = `${hoje.slice(0, 8)}01`;
    const ultimoPassado = somaDias(primeiro, -1);
    return { de: `${ultimoPassado.slice(0, 8)}01`, ate: ultimoPassado };
  }
  return { de: `${hoje.slice(0, 8)}01`, ate: hoje };
}
/** Intervalo pro banco: [de 00:00, dia seguinte ao "até" 00:00) em -03:00. */
export const intervaloIso = (de: string, ate: string) => ({ deIso: `${de}T00:00:00-03:00`, ateIso: `${somaDias(ate, 1)}T00:00:00-03:00` });
