// src/lib/qs/produtoGanho.ts
// -----------------------------------------------------------------------------
// PRODUTO NO DESFECHO DO SDR (spec "Desempenho SDR + Produto + Cotações", 06/11)
// — parte PURA (sem banco). O banco fica em produtoGanhoDados.ts (0321).
//
// O SDR escolhe o produto ao dar o desfecho: Expedição · Aéreo · Pacote · Outros.
// O produto define a ROTA, lida da tabela produto_rota (dá pra mover pacote pra
// cotação sem deploy):
//   rota REUNIAO → agendamento com closer (fluxo de sempre)
//   rota COTACAO → cotação, SEM reunião: o SDR cota ou repassa a um closer
// -----------------------------------------------------------------------------

export type ProdutoTipo = "expedicao" | "aereo" | "pacote" | "outros";
export type Rota = "reuniao" | "cotacao";

export const PRODUTOS: { tipo: ProdutoTipo; rotulo: string; dica: string }[] = [
  { tipo: "expedicao", rotulo: "Expedição", dica: "Uma das expedições em grupo" },
  { tipo: "aereo", rotulo: "Aéreo", dica: "Passagem aérea — vira cotação" },
  { tipo: "pacote", rotulo: "Pacote", dica: "Viagem montada pro cliente" },
  { tipo: "outros", rotulo: "Outros", dica: "Personalizado, concierge, seguro…" },
];

/** A regra de fábrica (igual à semente da 0321) — vale se a tabela não carregar. */
export const ROTA_PADRAO: Record<ProdutoTipo, Rota> = {
  expedicao: "reuniao", pacote: "reuniao", outros: "reuniao", aereo: "cotacao",
};

export const rotuloDoProduto = (tipo: ProdutoTipo | null | undefined): string =>
  PRODUTOS.find((p) => p.tipo === tipo)?.rotulo ?? "Sem produto";

export const ehProdutoTipo = (v: unknown): v is ProdutoTipo =>
  typeof v === "string" && PRODUTOS.some((p) => p.tipo === v);

export const rotaDoProduto = (tipo: ProdutoTipo | null, rotas: Record<ProdutoTipo, Rota> = ROTA_PADRAO): Rota | null =>
  tipo ? rotas[tipo] ?? ROTA_PADRAO[tipo] : null;

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
  /** Destino/detalhe em texto livre (pacote, outros; ou expedição fora da lista). */
  detalhe: string;
  /** Opcional na expedição (spec 4). */
  expedicaoId: string | null;
}

export const ESCOLHA_VAZIA: EscolhaProduto = { tipo: null, detalhe: "", expedicaoId: null };

/**
 * Título da reunião, que vai pro card do Bitrix ("Produto (Descritivo da
 * Reunião)") e pro convite do Google. Mantém o formato que o comercial já
 * escrevia à mão: "Expedição Itália…", "Pacote Japão".
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

/** Problema da escolha pra rota REUNIÃO, em português pro SDR; null = pode seguir. */
export function problemaDaEscolha(e: EscolhaProduto): string | null {
  if (!e.tipo) return "Escolha o produto: Expedição, Aéreo, Pacote ou Outros.";
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

// ── Cotação (rota COTACAO) ────────────────────────────────────────────────────

export type CotacaoStatus = "solicitada" | "em_cotacao" | "entregue" | "aprovada" | "perdida";
export type CotacaoCanal = "whatsapp" | "email" | "ligacao";
export type CotacaoMotivoPerda = "preco" | "datas" | "desistiu" | "comprou_fora" | "sem_retorno" | "outro";

export const ETAPAS_COTACAO: { status: CotacaoStatus; rotulo: string }[] = [
  { status: "solicitada", rotulo: "Solicitada" },
  { status: "em_cotacao", rotulo: "Em cotação" },
  { status: "entregue", rotulo: "Entregue" },
  { status: "aprovada", rotulo: "Aprovada" },
  { status: "perdida", rotulo: "Perdida" },
];
export const CANAIS: { v: CotacaoCanal; rotulo: string }[] = [
  { v: "whatsapp", rotulo: "WhatsApp" }, { v: "email", rotulo: "E-mail" }, { v: "ligacao", rotulo: "Ligação" },
];
export const MOTIVOS_PERDA: { v: CotacaoMotivoPerda; rotulo: string }[] = [
  { v: "preco", rotulo: "Preço" }, { v: "datas", rotulo: "Datas" }, { v: "desistiu", rotulo: "Desistiu" },
  { v: "comprou_fora", rotulo: "Comprou fora" }, { v: "sem_retorno", rotulo: "Sem retorno" }, { v: "outro", rotulo: "Outro" },
];

/** Formulário curto do SDR (spec 4). */
export interface DadosCotacao {
  origem: string;
  destino: string;
  dataIda: string;
  dataVolta: string;
  adultos: number;
  criancas: number;
  bebes: number;
  bagagem: string;
  flexibilidade: string;
  orcamento: string;
  observacoes: string;
  /** null = "Eu mesmo cotar" (padrão). */
  responsavelId: string | null;
}

export const COTACAO_VAZIA: DadosCotacao = {
  origem: "", destino: "", dataIda: "", dataVolta: "", adultos: 1, criancas: 0, bebes: 0,
  bagagem: "", flexibilidade: "", orcamento: "", observacoes: "", responsavelId: null,
};

export function problemaDaCotacao(d: DadosCotacao): string | null {
  if (!d.origem.trim() || !d.destino.trim()) return "Informe a origem e o destino da cotação.";
  if (!d.dataIda) return "Informe a data de ida (aproximada, se o cliente for flexível).";
  if (d.dataVolta && d.dataVolta < d.dataIda) return "A volta não pode ser antes da ida.";
  if (d.adultos + d.criancas + d.bebes <= 0) return "Informe quantos passageiros.";
  if (d.orcamento.trim() && !Number.isFinite(numeroBr(d.orcamento))) return "O orçamento do cliente precisa ser um número.";
  return null;
}

/** "R$ 4.500,50" / "4500.5" / "4.500" → 4500.5 ; vazio → NaN. */
export function numeroBr(v: string): number {
  const s = v.replace(/[R$\s]/g, "").trim();
  if (!s) return NaN;
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  return Number(norm);
}

/** Campos obrigatórios ao mover pra cada etapa (espelha o gatilho da 0321). */
export function camposDaEtapa(status: CotacaoStatus): ("valor_cotado" | "canal_entrega" | "valor_emitido" | "motivo_perda" | "validade_ate")[] {
  if (status === "entregue") return ["valor_cotado", "canal_entrega", "validade_ate"];
  if (status === "aprovada") return ["valor_emitido"];
  if (status === "perdida") return ["motivo_perda"];
  return [];
}

/** Horas úteis aproximadas entre dois instantes (seg–sex, 8h–18h, horário local). */
export function horasUteisEntre(inicio: Date, fim: Date, h0 = 8, h1 = 18): number {
  if (!(fim > inicio)) return 0;
  let total = 0;
  const cur = new Date(inicio);
  while (cur < fim) {
    const dia = cur.getDay();
    const abre = new Date(cur); abre.setHours(h0, 0, 0, 0);
    const fecha = new Date(cur); fecha.setHours(h1, 0, 0, 0);
    if (dia !== 0 && dia !== 6) {
      const a = Math.max(cur.getTime(), abre.getTime());
      const b = Math.min(fim.getTime(), fecha.getTime());
      if (b > a) total += (b - a) / 3_600_000;
    }
    cur.setDate(cur.getDate() + 1);
    cur.setHours(0, 0, 0, 0);
  }
  return total;
}
