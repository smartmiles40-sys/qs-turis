// src/mkt/automacoes/relatorio.ts
// -----------------------------------------------------------------------------
// RELATÓRIO POR FLUXO (09/11/2026) — a parte pura. O banco conta tudo
// (mkt_auto_relatorio, 0343) e devolve números por bloco/saída; aqui eles viram
// o que a tela mostra: resumo, o caminho passo a passo (quantos chegaram em cada
// bloco), cliques por botão, onde as pessoas param e as conversões
// (tag/campo/lista que o fluxo aplicou).
// -----------------------------------------------------------------------------
import { ROTULO_TIPO, saidasDoNo, type Grafo, type No } from "./tipos.ts";

export interface DadosRelatorio {
  iniciados?: number; concluidos?: number; andamento?: number; cancelados?: number; erros?: number;
  whatsapp?: number; instagram?: number;
  parados?: { no_id: string | null; estado: string; total: number }[];
  blocos?: { no_id: string; tipo: string; saida: string; total: number }[];
  conversoes?: { detalhe: string; pessoas: number }[];
}

export interface PassoRelatorio { noId: string; rotulo: string; tipo: No["tipo"]; entrou: number; enviou: number; erros: number; pct: number }
export interface BotaoRelatorio { noId: string; bloco: string; saida: string; rotulo: string; cliques: number; pct: number; secundaria: boolean }
export interface ParadoRelatorio { noId: string | null; bloco: string; estado: string; total: number }
export interface ConversaoRelatorio { rotulo: string; pessoas: number; pct: number }
export interface Relatorio {
  resumo: { iniciados: number; concluidos: number; taxaConclusao: number; andamento: number; cancelados: number; erros: number; whatsapp: number; instagram: number };
  passos: PassoRelatorio[];
  botoes: BotaoRelatorio[];
  parados: ParadoRelatorio[];
  conversoes: ConversaoRelatorio[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const ESTADO_LEGIVEL: Record<string, string> = {
  rodando: "andando agora",
  aguardando_resposta: "esperando a resposta/clique",
  aguardando_tempo: "esperando o tempo (Aguardar)",
  cancelada: "saiu (outro fluxo, pediu pra sair ou robô pausado)",
  erro: "parou com erro",
};

/** Nome curto do bloco: o título, ou o tipo + o começo do texto. */
export function nomeDoBloco(no: No | undefined): string {
  if (!no) return "(bloco apagado)";
  if (no.titulo) return no.titulo;
  const base = ROTULO_TIPO[no.tipo];
  if (no.tipo === "mensagem") {
    const t = no.dados.blocos.find((b) => b.tipo === "texto");
    const txt = t && t.tipo === "texto" ? t.texto.replace(/\s+/g, " ").trim() : "";
    return txt ? `${base}: ${txt.length > 40 ? `${txt.slice(0, 39)}…` : txt}` : base;
  }
  if (no.tipo === "pergunta" && no.dados.pergunta) return `${base}: ${no.dados.pergunta.slice(0, 40)}`;
  return base;
}

/** "tag:quente" → "Tag “quente”". */
export function rotuloConversao(detalhe: string): string {
  const [tipo, ...resto] = String(detalhe ?? "").split(":");
  const valor = resto.join(":");
  if (tipo === "tag") return `Tag “${valor}”`;
  if (tipo === "campo") return `Campo “${valor}” preenchido`;
  if (tipo === "lista") return `Entrou na lista “${valor}”`;
  return detalhe || "(sem nome)";
}

/** Ordem de leitura: do Início, em largura; blocos soltos no fim. */
function ordem(g: Grafo): No[] {
  const vistos = new Set<string>();
  const fila = g.nos.filter((x) => x.tipo === "inicio").map((x) => x.id);
  const out: No[] = [];
  while (fila.length) {
    const id = fila.shift() as string;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const no = g.nos.find((x) => x.id === id);
    if (!no) continue;
    out.push(no);
    for (const s of saidasDoNo(no)) {
      const l = g.ligacoes.find((x) => x.de === id && x.saida === s.id);
      if (l) fila.push(l.para);
    }
  }
  return [...out, ...g.nos.filter((x) => !vistos.has(x.id))];
}

export function montarRelatorio(d: DadosRelatorio, grafo: Grafo): Relatorio {
  const iniciados = n(d.iniciados);
  const porNo = new Map<string, { entrou: number; enviou: number; erros: number; saidas: Map<string, number> }>();
  for (const b of d.blocos ?? []) {
    const e = porNo.get(b.no_id) ?? { entrou: 0, enviou: 0, erros: 0, saidas: new Map() };
    if (b.tipo === "entrou") e.entrou += n(b.total);
    else if (b.tipo === "enviou") e.enviou += n(b.total);
    else if (b.tipo === "erro") e.erros += n(b.total);
    else if (b.tipo === "saida") e.saidas.set(b.saida, (e.saidas.get(b.saida) ?? 0) + n(b.total));
    porNo.set(b.no_id, e);
  }
  const nos = new Map(grafo.nos.map((x) => [x.id, x]));

  const passos: PassoRelatorio[] = ordem(grafo)
    .filter((no) => no.tipo !== "inicio")
    .map((no) => {
      const e = porNo.get(no.id);
      return { noId: no.id, rotulo: nomeDoBloco(no), tipo: no.tipo, entrou: e?.entrou ?? 0, enviou: e?.enviou ?? 0, erros: e?.erros ?? 0, pct: pct(e?.entrou ?? 0, iniciados) };
    });

  // Cliques por botão: as saídas de bloco com botões/lista/template (as "de verdade" e as secundárias).
  const botoes: BotaoRelatorio[] = [];
  for (const no of grafo.nos) {
    const temEscolha = (no.tipo === "mensagem" && (no.dados.interacao.tipo === "botoes" || no.dados.interacao.tipo === "lista"))
      || (no.tipo === "template" && (no.dados.botoes ?? []).length > 0) || no.tipo === "pergunta";
    if (!temEscolha) continue;
    const e = porNo.get(no.id);
    for (const s of saidasDoNo(no)) {
      if (no.tipo === "template" && s.id === "proximo") continue;
      const cliques = e?.saidas.get(s.id) ?? 0;
      botoes.push({ noId: no.id, bloco: nomeDoBloco(no), saida: s.id, rotulo: s.rotulo, cliques, pct: pct(cliques, e?.entrou ?? 0), secundaria: Boolean(s.secundaria) });
    }
  }

  const parados: ParadoRelatorio[] = (d.parados ?? [])
    .map((p) => ({ noId: p.no_id, bloco: nomeDoBloco(p.no_id ? nos.get(p.no_id) : undefined), estado: ESTADO_LEGIVEL[p.estado] ?? p.estado, total: n(p.total) }))
    .sort((a, b) => b.total - a.total);

  const conversoes: ConversaoRelatorio[] = (d.conversoes ?? [])
    .map((c) => ({ rotulo: rotuloConversao(c.detalhe), pessoas: n(c.pessoas), pct: pct(n(c.pessoas), iniciados) }))
    .sort((a, b) => b.pessoas - a.pessoas);

  const concluidos = n(d.concluidos);
  return {
    resumo: {
      iniciados, concluidos, taxaConclusao: pct(concluidos, iniciados), andamento: n(d.andamento), cancelados: n(d.cancelados), erros: n(d.erros),
      whatsapp: n(d.whatsapp), instagram: n(d.instagram),
    },
    passos, botoes, parados, conversoes,
  };
}

/** "desde quando" do filtro: 7 / 30 / 90 dias ou tudo. */
export function desdeDias(dias: number | null, agora = Date.now()): string | null {
  return dias ? new Date(agora - dias * 86_400_000).toISOString() : null;
}
