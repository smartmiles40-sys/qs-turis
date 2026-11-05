// src/lib/qs/leadsFiltro.ts
// -----------------------------------------------------------------------------
// Filtros da tela Leads traduzidos para o PostgREST (Bruno, 04/11/2026).
//
// Até aqui a tela baixava a base INTEIRA (5.784 leads, ~6 MB, 2,7–3,3 s medidos
// no ar em 04/11) e filtrava no navegador. Agora o banco filtra, ordena, conta
// (`count: "exact"`) e devolve só a página. Para não mudar o RESULTADO de nenhum
// filtro, cada regra abaixo reproduz a que rodava no navegador — os testes em
// tests/leads/leadsFiltro.test.ts comparam as duas.
//
// Módulo puro (sem supabase): monta a lista de operações e aplica num builder
// qualquer que tenha eq/or/filter/not — o do supabase-js, ou um falso no teste.
// -----------------------------------------------------------------------------
import { SEM_FONTE } from "../../controle-comercial/filtroUrl.ts";

export type TemperaturaFiltro = "quente" | "morno" | "frio";

export interface FiltrosLeads {
  /** Texto da busca (nome, empresa, e-mail, telefone, ID Bitrix). */
  busca: string;
  source: string;
  status: string;
  cadenceId: string;
  ownerId: string;
  /** qs_leads.segment exato, ou SEM_FONTE para "sem fonte". */
  fonte: string;
  lossReasonId: string;
  temp: TemperaturaFiltro | "";
  /**
   * SDR/closer só enxergam a própria carteira NESTA tela (era o filtro por
   * papel que rodava no navegador). Não é permissão — quem protege é a RLS;
   * isto só mantém a lista igual à de antes. null = sem recorte (gestor/admin).
   */
  somenteDoDono: string | null;
}

/** Uma operação de filtro, na linguagem do supabase-js. */
export type OpFiltro =
  | { op: "eq"; coluna: string; valor: string }
  | { op: "or"; expr: string }
  | { op: "filter"; coluna: string; operador: string; valor: string }
  | { op: "not"; coluna: string; operador: string; valor: string };

// Mesmas expressões do normalizeTemperature (src/lib/leadScore.ts), na mesma
// ordem de prioridade: "quente" ganha de "morno", que ganha de "frio". O `~*`
// do Postgres é sem caixa, como o toLowerCase() de lá. Mudou uma, muda a outra
// (o teste acusa).
export const TEMP_REGEX: Record<TemperaturaFiltro, string> = {
  quente: "(quente|hot|alta|high)",
  morno: "(morno|warm|m[eé]dia|medium|med)",
  frio: "(frio|cold|baixa|low)",
};

/**
 * Escapa um valor para dentro de aspas na sintaxe do `or=(...)` do PostgREST:
 * vírgula, parêntese e ponto do texto do usuário deixam de ser sintaxe.
 * Dentro das aspas, `\` e `"` vão com barra.
 */
export function aspasPostgrest(valor: string): string {
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Padrão do ILIKE para "contém o texto": `%` e `_` digitados são literais
 * (no navegador era includes(), que não tinha curinga). Obs.: o PostgREST
 * troca `*` por `%` em like/ilike e isso não tem escape — quem buscar um
 * asterisco literal recebe "qualquer coisa" naquela posição.
 */
export function padraoContem(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Telefone: no navegador a regra era "os DÍGITOS do telefone contêm os dígitos
 * digitados" (com 4+ dígitos), pra "(85) 9…" achar "5585…". O PostgREST não
 * tira os não-dígitos da coluna, então a busca vira uma regex que aceita
 * qualquer separador ENTRE os dígitos: 8596 → 8[^0-9]*5[^0-9]*9[^0-9]*6.
 * É a mesma pergunta — "a sequência de dígitos aparece, com só não-dígitos no
 * meio" ⇔ "os dígitos, juntos, contêm a sequência". Na base de 04/11 só 3 de
 * 5.669 telefones têm separador ("+55 43 99630-5550"), mas eles continuam
 * sendo achados. Não é o critério do qs_wa_key (DDD + 8 finais) de propósito:
 * a busca da tela sempre foi "contém", e trocar mudaria o que o SDR acha.
 */
export function regexDigitos(digitos: string): string {
  return digitos.split("").join("[^0-9]*");
}

/** A expressão do `or` da busca, ou null se a busca está vazia. */
export function expressaoBusca(busca: string): string | null {
  if (!busca.trim()) return null;
  const q = busca.toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const like = aspasPostgrest(padraoContem(q));
  const partes = [
    `full_name.ilike.${like}`,
    `company_name.ilike.${like}`,
    `email.ilike.${like}`,
    `bitrix_id.ilike.${like}`,
  ];
  if (qDigits.length >= 4) partes.push(`phone.match.${aspasPostgrest(regexDigitos(qDigits))}`);
  return partes.join(",");
}

/** Traduz os filtros da tela em operações do PostgREST. */
export function montarFiltrosLeads(f: FiltrosLeads): OpFiltro[] {
  const ops: OpFiltro[] = [];
  if (f.somenteDoDono) ops.push({ op: "eq", coluna: "owner_id", valor: f.somenteDoDono });
  if (f.source) ops.push({ op: "eq", coluna: "source", valor: f.source });
  if (f.status) ops.push({ op: "eq", coluna: "status", valor: f.status });
  if (f.cadenceId) ops.push({ op: "eq", coluna: "cadence_id", valor: f.cadenceId });
  if (f.ownerId) ops.push({ op: "eq", coluna: "owner_id", valor: f.ownerId });
  if (f.lossReasonId) ops.push({ op: "eq", coluna: "loss_reason_id", valor: f.lossReasonId });

  // Dois grupos "OU" (busca e "sem fonte") não podem ir em dois parâmetros
  // `or` soltos — vão juntos num and(or(...),or(...)), que o PostgREST aceita.
  const grupos: string[] = [];
  const busca = expressaoBusca(f.busca);
  if (busca) grupos.push(busca);
  if (f.fonte === SEM_FONTE) {
    // casaFonte: segment vazio (ou só espaço) = sem fonte. Em 04/11 nenhum
    // segment tinha espaço sobrando, então null ou "" cobre a regra inteira.
    grupos.push(`segment.is.null,segment.eq.""`);
  } else if (f.fonte) {
    ops.push({ op: "eq", coluna: "segment", valor: f.fonte });
  }
  if (grupos.length === 1) ops.push({ op: "or", expr: grupos[0] });
  else if (grupos.length > 1) ops.push({ op: "or", expr: `and(${grupos.map((g) => `or(${g})`).join(",")})` });

  if (f.temp) {
    // Prioridade do normalizeTemperature: um rótulo que casa com "quente" é
    // quente mesmo que também case com "frio" — por isso os `not`.
    ops.push({ op: "filter", coluna: "lead_score", operador: "imatch", valor: TEMP_REGEX[f.temp] });
    if (f.temp !== "quente") ops.push({ op: "not", coluna: "lead_score", operador: "imatch", valor: TEMP_REGEX.quente });
    if (f.temp === "frio") ops.push({ op: "not", coluna: "lead_score", operador: "imatch", valor: TEMP_REGEX.morno });
  }
  return ops;
}

interface Filtravel {
  eq(coluna: string, valor: string): Filtravel;
  or(expr: string): Filtravel;
  filter(coluna: string, operador: string, valor: string): Filtravel;
  not(coluna: string, operador: string, valor: string): Filtravel;
}

/** Aplica os filtros num builder do supabase-js (antes de order/range). */
export function aplicarFiltrosLeads<Q>(q: Q, f: FiltrosLeads): Q {
  let b = q as unknown as Filtravel;
  for (const o of montarFiltrosLeads(f)) {
    if (o.op === "eq") b = b.eq(o.coluna, o.valor);
    else if (o.op === "or") b = b.or(o.expr);
    else if (o.op === "filter") b = b.filter(o.coluna, o.operador, o.valor);
    else b = b.not(o.coluna, o.operador, o.valor);
  }
  return b as unknown as Q;
}
