// src/expedicoes/lib/cockpit/rota.ts
// -----------------------------------------------------------------------------
// ABAS DO COCKPIT E REDIRECTS (redesign 29/10, spec §3.2).
// As 10 abas antigas viraram 6. A aba ativa vai na query do hash:
//   #ops/expedicoes/<id>?aba=logistica&secao=rooming
// e TODO endereço antigo continua abrindo no lugar certo:
//   • segmento de caminho com a barra codificada (o QS grava assim):  <id>%2Frooming
//   • segmento com barra normal (link digitado/colado):              <id>/rooming
//   • query com o id antigo:                                          ?aba=rooming
// Os sub-endereços de Passageiros (pax/<id>, pax/<id>/perfil, prontidao/<id>) seguem
// no caminho — a gaveta do passageiro e os links de fora (ficha do cliente,
// divergências, "mudar de expedição") dependem deles.
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------

export type AbaCockpit = "geral" | "passageiros" | "logistica" | "financeiro" | "arquivos" | "portal";

export const ABAS_COCKPIT: readonly { id: AbaCockpit; rotulo: string }[] = [
  { id: "geral", rotulo: "Visão geral" },
  { id: "passageiros", rotulo: "Passageiros" },
  { id: "logistica", rotulo: "Logística" },
  { id: "financeiro", rotulo: "Financeiro" },
  { id: "arquivos", rotulo: "Arquivos" },
  { id: "portal", rotulo: "ExpedAmigo" },
];

/** Seções que dá pra abrir direto (?secao=…). */
export type SecaoCockpit = "rooming" | "roteiro" | "divisoes" | "checklist" | "drive" | "links" | "docs-lider" | "documentos";

/** Id antigo (ou novo) de aba → aba nova + seção. */
export const REDIRECT_ABA: Readonly<Record<string, { aba: AbaCockpit; secao?: SecaoCockpit }>> = {
  "": { aba: "geral" },
  geral: { aba: "geral" },
  "visao-geral": { aba: "geral" },
  passageiros: { aba: "passageiros" },
  valores: { aba: "financeiro" },
  financeiro: { aba: "financeiro" },
  rooming: { aba: "logistica", secao: "rooming" },
  checklist: { aba: "logistica", secao: "checklist" },
  "roteiro-lider": { aba: "logistica", secao: "roteiro" },
  roteiro: { aba: "logistica", secao: "roteiro" },
  grupos: { aba: "logistica", secao: "divisoes" },
  divisoes: { aba: "logistica", secao: "divisoes" },
  logistica: { aba: "logistica" },
  documentos: { aba: "arquivos", secao: "drive" },
  links: { aba: "arquivos", secao: "links" },
  arquivos: { aba: "arquivos" },
  portal: { aba: "portal" },
  expedamigo: { aba: "portal" },
};

const SECOES = new Set<string>(["rooming", "roteiro", "divisoes", "checklist", "drive", "links", "docs-lider", "documentos"]);

/** Abas que não existem em pacote (Logística = rooming + roteiro + divisões + checklist, todas ocultas em pacote). */
export const ABAS_FORA_DO_PACOTE: ReadonlySet<AbaCockpit> = new Set(["logistica"]);

function partesDoHash(hash: string): { segs: string[]; query: URLSearchParams } {
  const semCerquilha = hash.replace(/^#\/?/, "");
  const i = semCerquilha.indexOf("?");
  const caminho = i >= 0 ? semCerquilha.slice(0, i) : semCerquilha;
  return { segs: caminho.split("/").filter((s) => s !== ""), query: new URLSearchParams(i >= 0 ? semCerquilha.slice(i + 1) : "") };
}

const decodificar = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * O caminho da expedição dentro do hash ("<id>/<aba>/<sub…>"), juntando os dois
 * formatos: "#ops/expedicoes/abc%2Frooming" e "#ops/expedicoes/abc/rooming".
 * Null se o hash não tem área/tela/id.
 */
export function caminhoDoHash(hash: string): string | null {
  const { segs } = partesDoHash(hash);
  if (segs.length < 3) return null;
  return segs.slice(2).map(decodificar).join("/");
}

export interface RotaCockpit {
  id: string;
  aba: AbaCockpit;
  secao: SecaoCockpit | null;
  /** Resto do caminho (só Passageiros usa: ["pax", id] etc.). */
  sub: string[];
  /** true quando o endereço está num formato antigo e deve ser reescrito pro canônico. */
  normalizar: boolean;
}

/**
 * Resolve a aba a partir do `caminho` que o app hospedeiro entrega (já decodificado,
 * mas sem o que vem depois de uma barra NÃO codificada) e do hash cru.
 */
export function resolverRotaCockpit(o: { caminho: string; hash?: string | null; pacote?: boolean }): RotaCockpit {
  let caminho = o.caminho;
  const doHash = o.hash ? caminhoDoHash(o.hash) : null;
  // O hash cru é a verdade quando é do mesmo id: pega a barra normal (que o app
  // hospedeiro corta — lerHashDaArea só lê o 3º pedaço) e as trocas de aba feitas
  // com replaceState (que o hospedeiro não vê: o `caminho` dele fica velho).
  if (doHash && doHash.split("/")[0] === caminho.split("/")[0]) caminho = doHash;
  const [id, abaCaminho = "", ...sub] = caminho.split("/");
  const query = o.hash ? partesDoHash(o.hash).query : new URLSearchParams();
  const abaQuery = query.get("aba");
  const secaoQuery = query.get("secao");

  let alvo: { aba: AbaCockpit; secao?: SecaoCockpit };
  let normalizar = false;
  if (abaCaminho) {
    alvo = REDIRECT_ABA[abaCaminho] ?? { aba: "geral" };
    // Passageiros com gaveta aberta continua no caminho; o resto vira ?aba=.
    normalizar = !(alvo.aba === "passageiros" && sub.length > 0);
  } else if (abaQuery) {
    alvo = REDIRECT_ABA[abaQuery] ?? { aba: "geral" };
    // ?aba=rooming (id antigo) → ?aba=logistica&secao=rooming
    normalizar = abaQuery !== alvo.aba || (!!alvo.secao && secaoQuery !== alvo.secao);
  } else {
    alvo = { aba: "geral" };
  }
  let secao: SecaoCockpit | null = alvo.secao ?? (secaoQuery && SECOES.has(secaoQuery) ? (secaoQuery as SecaoCockpit) : null);
  let aba = alvo.aba;
  if (o.pacote && ABAS_FORA_DO_PACOTE.has(aba)) { aba = "geral"; secao = null; normalizar = true; }
  return { id, aba, secao, sub: aba === "passageiros" ? sub : [], normalizar };
}

/**
 * Hash canônico do cockpit, mantendo a área e a tela do hash atual:
 * "#ops/expedicoes/<id>?aba=logistica&secao=rooming". Visão geral = sem ?aba.
 * Null se o hash atual não tem área/tela.
 */
export function hashCanonico(hashAtual: string, id: string, aba: AbaCockpit, secao?: SecaoCockpit | null): string | null {
  const { segs } = partesDoHash(hashAtual);
  if (segs.length < 2) return null;
  const q = new URLSearchParams();
  if (aba !== "geral") q.set("aba", aba);
  if (secao) q.set("secao", secao);
  const s = q.toString();
  return `#${segs[0]}/${segs[1]}/${encodeURIComponent(id)}${s ? `?${s}` : ""}`;
}
