// src/solicitacoes/visao.ts
// -----------------------------------------------------------------------------
// Regras de TELA da Central (redesign 29/10, docs/ref/qs-redesign-ficha-
// solicitacoes.md, seção 4): em qual coluna do quadro cada pedido fica, em qual
// faixa de prazo, o nome limpo da cliente e o estado que vai pra URL. Nada aqui
// fala com o banco.
// -----------------------------------------------------------------------------
import { parseClientName } from "@/components/ui/nomeCliente";
import { lerParamDoHash, gravarParamNoHash, hashSemQuery } from "@/lib/hashQuery";
import { SETORES, type Setor, type Solicitacao } from "./lib";

// ── Prazo (sempre no fuso de São Paulo) ─────────────────────────────────────
const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
export const diaSP = (d: Date | string | number) => FMT_DIA.format(new Date(d));

/** Atrasada: aberta e o prazo já passou (agora, no relógio). */
export function atrasada(s: Pick<Solicitacao, "aberta" | "prazo">, agora = Date.now()) {
  return !!s.aberta && !!s.prazo && new Date(s.prazo).getTime() < agora;
}
/** Vence hoje: aberta, ainda no prazo, e o prazo cai hoje (dia de SP). */
export function venceHoje(s: Pick<Solicitacao, "aberta" | "prazo">, agora = Date.now()) {
  return !!s.aberta && !!s.prazo && !atrasada(s, agora) && diaSP(s.prazo) === diaSP(agora);
}

export type TomPrazo = "danger" | "warn" | "ok" | "neutral";
/** Tom do chip/faixa de prazo: danger atrasada · warn vence hoje · ok concluída. */
export function tomDoPrazo(s: Solicitacao, agora = Date.now()): TomPrazo {
  if (s.status === "concluida") return "ok";
  if (atrasada(s, agora)) return "danger";
  if (venceHoje(s, agora)) return "warn";
  return "neutral";
}

// ── Quadro ──────────────────────────────────────────────────────────────────
/** As 4 colunas da spec + a de recusadas/canceladas (só no Histórico). */
export type Coluna = "nova" | "ajustes" | "andamento" | "concluida" | "encerrada";
/** Em qual coluna o pedido fica (mesma semântica da 0158: a cotação "nova" espera
 *  aprovação; "aguardando quem pediu" é Aguardando ajustes; esperando cliente,
 *  fornecedor ou outro setor continua Em andamento). */
export function colunaDe(s: Solicitacao): Coluna {
  if (s.status === "recusada" || s.status === "cancelada") return "encerrada";
  if (s.status === "concluida") return "concluida";
  if (s.status === "nova") return "nova";
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return "ajustes";
  return "andamento";
}

const PESO_PRIORIDADE = { urgente: 0, alta: 1, normal: 2 } as const;
/** O que vence primeiro em cima; urgente na frente. Fechadas: a mais recente em cima. */
export function ordenar(a: Solicitacao, b: Solicitacao) {
  if (!a.aberta || !b.aberta) {
    if (a.aberta !== b.aberta) return a.aberta ? -1 : 1;
    return (b.concluido_em ?? b.atualizado_em ?? "").localeCompare(a.concluido_em ?? a.atualizado_em ?? "");
  }
  const p = PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade];
  if (p) return p;
  return (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999");
}

// ── Prazos (faixas) ─────────────────────────────────────────────────────────
export type Faixa = "atrasadas" | "hoje" | "semana" | "depois" | "concluidas";
export function faixaDe(s: Solicitacao, agora = Date.now()): Faixa | null {
  if (s.status === "concluida") return s.concluido_em && agora - new Date(s.concluido_em).getTime() <= 14 * 86_400_000 ? "concluidas" : null;
  if (!s.aberta) return null;
  if (atrasada(s, agora)) return "atrasadas";
  if (venceHoje(s, agora)) return "hoje";
  if (s.prazo && new Date(s.prazo).getTime() <= agora + 7 * 86_400_000) return "semana";
  return "depois";
}

// ── Cliente ─────────────────────────────────────────────────────────────────
/** "[V4] (STFV) Maria Souza · Islândia G1" → { nome: "Maria Souza", viagem: "Islândia G1" }. */
export function clienteDo(s: Pick<Solicitacao, "sobre_nome" | "cliente_id" | "viagem_id" | "lead_id">): { nome: string; viagem: string | null; tags: string[] } | null {
  if (!s.sobre_nome && !s.cliente_id && !s.lead_id) return null;
  const [cru, ...resto] = (s.sobre_nome ?? "").split(" · ");
  const { name, tags } = parseClientName(cru || "Cliente");
  return { nome: name || "Cliente", viagem: resto.join(" · ") || null, tags };
}

// ── Estado na URL (#area/solicitacoes?escopo=…&ver=…&s=<id>) ────────────────
export type Escopo = "recebidas" | "pedidas" | "historico";
export type Ver = "quadro" | "lista" | "prazos";
export type Dono = "todas" | "comigo" | "sem_dono";
export interface EstadoTela { escopo: Escopo; ver: Ver; origem: "todas" | Setor; dono: Dono; q: string; minhas: boolean }

const ESCOPOS: Escopo[] = ["recebidas", "pedidas", "historico"];
const VERS: Ver[] = ["quadro", "lista", "prazos"];
const DONOS: Dono[] = ["todas", "comigo", "sem_dono"];
const CHAVE_ORIGEM = "qs_sol_origem_"; // 0203: a aba de quem pediu, lembrada por setor
const CHAVE_DONO = "qs_sol_dono_";     // 29/10: "Comigo" = minhas demandas, lembrado por setor

const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lembrar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };
export const lembrarOrigem = (setor: Setor, v: string) => lembrar(CHAVE_ORIGEM + setor, v);
export const lembrarDono = (setor: Setor, v: string) => lembrar(CHAVE_DONO + setor, v);

/** A tela está aberta num endereço de área? (no Comercial do SDR não há hash: aí o estado fica só na memória) */
export function temRotaNoHash() { return hashSemQuery() !== ""; }

/** Estado inicial: URL primeiro; sem nada na URL, o que a pessoa usou por último (origem/dono). */
export function estadoInicial(setor: Setor): EstadoTela {
  const url = temRotaNoHash();
  const p = (k: string) => (url ? lerParamDoHash(k) : null);
  const escopo = p("escopo"); const ver = p("ver"); const dono = p("dono") ?? ler(CHAVE_DONO + setor); const origem = p("origem") ?? ler(CHAVE_ORIGEM + setor);
  return {
    escopo: ESCOPOS.includes(escopo as Escopo) ? (escopo as Escopo) : "recebidas",
    ver: VERS.includes(ver as Ver) ? (ver as Ver) : "quadro",
    dono: DONOS.includes(dono as Dono) ? (dono as Dono) : "todas",
    origem: origem && origem !== setor && SETORES.some((x) => x === origem) ? (origem as Setor) : "todas",
    q: p("q") ?? "",
    minhas: p("minhas") !== "0",
  };
}

/** Grava o estado da tela na query do hash (só os valores fora do padrão). */
export function gravarEstado(e: EstadoTela, aberta: string | null) {
  if (!temRotaNoHash()) return;
  gravarParamNoHash("escopo", e.escopo === "recebidas" ? null : e.escopo);
  gravarParamNoHash("ver", e.ver === "quadro" ? null : e.ver);
  gravarParamNoHash("origem", e.origem === "todas" ? null : e.origem);
  gravarParamNoHash("dono", e.dono === "todas" ? null : e.dono);
  gravarParamNoHash("q", e.q.trim() || null);
  gravarParamNoHash("minhas", e.minhas ? null : "0");
  gravarParamNoHash("s", aberta);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Os links antigos (avisos, "abrir solicitação" do Closer/Fin…) chegam como
 * "#<area>/solicitacoes/<uuid>". Lê o id e troca o endereço por
 * "#<area>/solicitacoes?…&s=<uuid>" (replaceState: não navega).
 */
export function idDoCaminho(): string | null {
  const partes = hashSemQuery().split("/");
  const i = partes.indexOf("solicitacoes");
  const id = i >= 0 ? decodeURIComponent(partes[i + 1] ?? "") : "";
  return UUID.test(id) ? id : null;
}
export function tirarIdDoCaminho() {
  const h = window.location.hash;
  const [base, q] = [h.split("?")[0], h.includes("?") ? h.slice(h.indexOf("?")) : ""];
  const novaBase = base.replace(/\/solicitacoes\/[^/?]+$/, "/solicitacoes");
  if (novaBase !== base) history.replaceState(history.state, "", window.location.pathname + window.location.search + novaBase + q);
}
/** A rota atual é a da Central? ("#rel/solicitacoes…", ou "#ops" que abre nela) */
export function naRotaDaCentral(): boolean {
  const partes = hashSemQuery().split("/");
  return partes[1] === "solicitacoes" || (partes.length === 1 && partes[0] === "ops");
}
