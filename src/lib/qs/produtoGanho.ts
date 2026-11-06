// src/lib/qs/produtoGanho.ts
// -----------------------------------------------------------------------------
// PRODUTO NO "GANHO / AGENDOU" (Bruno, 06/11/2026) — parte PURA (sem banco).
//
// O SDR escolhe o produto ao dar ganho: Aéreo · Pacote · Expedição · Outros.
//   · Expedição → escolhe uma das expedições à venda no Operacional.
//   · Aéreo → "Eu mesmo emito" (ganho sem reunião, lead fica com o SDR) ou
//     "Passar pro closer" (agendamento normal).
// Antes o produto era só texto livre no título: dava pro closer ler, mas não
// dava pra medir a demanda que sai de cada SDR pros closers.
// O banco fica em produtoGanhoDados.ts (migration 0321).
// -----------------------------------------------------------------------------

export type ProdutoTipo = "aereo" | "pacote" | "expedicao" | "outros";
export type QuemFaz = "closer" | "sdr";

export const PRODUTOS: { tipo: ProdutoTipo; rotulo: string; dica: string }[] = [
  { tipo: "aereo", rotulo: "Aéreo", dica: "Passagem aérea" },
  { tipo: "pacote", rotulo: "Pacote", dica: "Viagem montada pro cliente" },
  { tipo: "expedicao", rotulo: "Expedição", dica: "Uma das expedições em grupo" },
  { tipo: "outros", rotulo: "Outros", dica: "Personalizado, concierge, seguro…" },
];

export const rotuloDoProduto = (tipo: ProdutoTipo | null | undefined): string =>
  PRODUTOS.find((p) => p.tipo === tipo)?.rotulo ?? "Sem produto";

export const ehProdutoTipo = (v: unknown): v is ProdutoTipo =>
  typeof v === "string" && PRODUTOS.some((p) => p.tipo === v);

export interface ExpedicaoAVenda {
  id: string;
  codigo: string | null;
  nome: string;
  destino: string | null;
  data_embarque: string | null;
  status: string | null;
}

/** O que o SDR escolheu no seletor. */
export interface EscolhaProduto {
  tipo: ProdutoTipo | null;
  /** Destino/detalhe em texto livre (pacote, aéreo, outros; ou expedição fora da lista). */
  detalhe: string;
  expedicaoId: string | null;
  /** Só vale pro aéreo. Nos outros produtos é sempre o closer. */
  quemFaz: QuemFaz;
}

export const ESCOLHA_VAZIA: EscolhaProduto = { tipo: null, detalhe: "", expedicaoId: null, quemFaz: "closer" };

/** O SDR vai fazer sozinho (sem reunião)? Hoje só existe pro aéreo. */
export const sdrFazSozinho = (e: EscolhaProduto): boolean => e.tipo === "aereo" && e.quemFaz === "sdr";

/**
 * Título da reunião, que vai pro card do Bitrix ("Produto (Descritivo da
 * Reunião)") e pro convite do Google. Mantém o formato que o comercial já
 * escrevia à mão: "Expedição Itália…", "Pacote Japão", "Passagem aérea Lisboa".
 */
export function tituloDoProduto(e: EscolhaProduto, expedicoes: ExpedicaoAVenda[] = []): string {
  const detalhe = e.detalhe.trim().replace(/\s+/g, " ");
  if (!e.tipo) return detalhe;
  if (e.tipo === "expedicao") {
    const exp = e.expedicaoId ? expedicoes.find((x) => x.id === e.expedicaoId) : null;
    if (exp) return /^expedi[çc][ãa]o\b/i.test(exp.nome) ? exp.nome : `Expedição ${exp.nome}`;
    return detalhe ? `Expedição ${detalhe}` : "Expedição";
  }
  if (e.tipo === "aereo") return detalhe ? `Passagem aérea ${detalhe}` : "Passagem aérea";
  if (e.tipo === "pacote") return detalhe ? `Pacote ${detalhe}` : "Pacote";
  return detalhe || "Outros";
}

/** Problema que impede seguir, em português pro SDR; null = pode seguir. */
export function problemaDaEscolha(e: EscolhaProduto): string | null {
  if (!e.tipo) return "Escolha o produto: Aéreo, Pacote, Expedição ou Outros.";
  if (e.tipo === "expedicao" && !e.expedicaoId && !e.detalhe.trim()) {
    return "Escolha qual expedição (ou escreva o destino, se ela não estiver na lista).";
  }
  if ((e.tipo === "pacote" || e.tipo === "outros") && !e.detalhe.trim()) {
    return e.tipo === "pacote"
      ? "Escreva o destino do pacote — é o que o closer lê antes de entrar na reunião."
      : "Escreva o que é — é o que o closer lê antes de entrar na reunião.";
  }
  return null;
}

/** "Fev/2027" a partir de "2027-02-13" (sem fuso: é data pura). */
export function mesAno(data: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(data ?? "");
  if (!m) return "";
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(m[2]) - 1] ?? ""}/${m[1]}`;
}

// ── Métrica: demanda por produto ─────────────────────────────────────────────

/** Reunião agendada pelo SDR (só o que a métrica usa). */
export interface ReuniaoParaDemanda {
  owner_id: string | null;
  produto_tipo: string | null;
  tipo?: string | null;
  status?: string | null;
}
/** Ganho feito pelo próprio SDR, sem reunião. */
export interface GanhoSdrParaDemanda {
  owner_id: string | null;
  produto_tipo: string | null;
}

export interface LinhaDemanda {
  ownerId: string;
  /** Agendadas pro closer, por produto. */
  closer: Record<ProdutoTipo, number>;
  /** Reuniões sem produto (antes da 0321 ou agendadas por fora). */
  semProduto: number;
  /** Aéreos que o próprio SDR emitiu. */
  aereoSdr: number;
  totalCloser: number;
  total: number;
}

const zerado = (): Record<ProdutoTipo, number> => ({ aereo: 0, pacote: 0, expedicao: 0, outros: 0 });

/**
 * Soma por SDR. Conta a 1ª reunião (retomada é conversa do closer, não demanda
 * nova do SDR) e ignora a linha antiga de reagendamento e a cancelada — a mesma
 * base das taxas de reunião (metricasReuniao.ts).
 */
export function demandaPorProduto(reunioes: ReuniaoParaDemanda[], ganhosSdr: GanhoSdrParaDemanda[]): LinhaDemanda[] {
  const por = new Map<string, LinhaDemanda>();
  const linha = (id: string) => {
    let l = por.get(id);
    if (!l) {
      l = { ownerId: id, closer: zerado(), semProduto: 0, aereoSdr: 0, totalCloser: 0, total: 0 };
      por.set(id, l);
    }
    return l;
  };
  for (const r of reunioes) {
    if (!r.owner_id) continue;
    if ((r.tipo ?? "primeira") === "retomada") continue;
    if (r.status === "reagendada" || r.status === "cancelada") continue;
    const l = linha(r.owner_id);
    if (ehProdutoTipo(r.produto_tipo)) l.closer[r.produto_tipo] += 1;
    else l.semProduto += 1;
    l.totalCloser += 1;
    l.total += 1;
  }
  for (const g of ganhosSdr) {
    if (!g.owner_id) continue;
    const l = linha(g.owner_id);
    l.aereoSdr += 1;
    l.total += 1;
  }
  return [...por.values()].sort((a, b) => b.total - a.total);
}

/** Soma das linhas (o total do time). */
export function somarDemanda(linhas: LinhaDemanda[]): Omit<LinhaDemanda, "ownerId"> {
  const t = { closer: zerado(), semProduto: 0, aereoSdr: 0, totalCloser: 0, total: 0 };
  for (const l of linhas) {
    for (const p of PRODUTOS) t.closer[p.tipo] += l.closer[p.tipo];
    t.semProduto += l.semProduto;
    t.aereoSdr += l.aereoSdr;
    t.totalCloser += l.totalCloser;
    t.total += l.total;
  }
  return t;
}
