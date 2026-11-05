// src/solicitacoes/conversa.ts
// -----------------------------------------------------------------------------
// QUADRO + CONVERSA da Central (05/11/2026, mockup "G · Quadro + conversa").
// Regras PURAS (sem banco, sem React — testadas em tests/solicitacoes/):
//
//   • em qual das 4 colunas o pedido fica
//       Novas (ninguém pegou) · Com alguém · Voltou para quem pediu (falta
//       informação, prazo pausado) · Concluídas (últimos 7 dias; recolhida
//       por padrão — botão "Ver concluídas (N)")
//   • o chip de prazo (vermelho venceu · laranja vence hoje · verde no prazo)
//   • quem é PARTICIPANTE (recebe aviso e conta "não lida"): quem pediu, o
//     responsável, quem acompanha e — enquanto ninguém pegou — o setor todo.
//     Espelha a coluna "participo" da view (0315).
//   • não lidas por pessoa e o número do selo do menu
//   • a linha do tempo: eventos viram pílulas, comentários viram bolhas
// -----------------------------------------------------------------------------
import type { EventoSol, Setor, Solicitacao, UltimoEvento } from "./lib";

// ── Datas no fuso de São Paulo ──────────────────────────────────────────────
const FMT_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const FMT_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const FMT_SEMANA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });
const FMT_DDMM = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

/** Número do dia (SP) — pra comparar "hoje", "ontem", "amanhã". */
function diaNum(d: Date | string | number): number {
  const [y, m, dd] = FMT_DIA.format(new Date(d)).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000);
}
const hora = (d: Date | string | number) => FMT_HORA.format(new Date(d));
const semana = (d: Date | string | number) => FMT_SEMANA.format(new Date(d)).replace(".", "");

/** "hoje, 09:00" · "ontem, 14:22" · "amanhã, 10:00" · "qui, 29/10 09:00". */
export function quandoCurto(iso: string, agora = Date.now()): string {
  const dif = diaNum(iso) - diaNum(agora);
  if (dif === 0) return `hoje, ${hora(iso)}`;
  if (dif === -1) return `ontem, ${hora(iso)}`;
  if (dif === 1) return `amanhã, ${hora(iso)}`;
  return `${semana(iso)}, ${FMT_DDMM.format(new Date(iso))} ${hora(iso)}`;
}

// ── Colunas ─────────────────────────────────────────────────────────────────
export type ColunaQ = "nova" | "com_alguem" | "voltou" | "concluida";
export const COLUNAS_Q: { id: ColunaQ; rotulo: string; dica: string; vazio: string; ponto: string }[] = [
  { id: "nova", rotulo: "Novas", dica: "ninguém pegou ainda", vazio: "Todos os pedidos já têm alguém cuidando", ponto: "var(--text)" },
  { id: "com_alguem", rotulo: "Com alguém", dica: "tem responsável trabalhando", vazio: "Ninguém está com pedido aberto", ponto: "var(--q-azul)" },
  { id: "voltou", rotulo: "Voltou para quem pediu", dica: "falta informação, prazo pausado", vazio: "Nenhum pedido esperando resposta", ponto: "var(--q-laranja)" },
  { id: "concluida", rotulo: "Concluídas", dica: "últimos 7 dias", vazio: "Nada concluído nos últimos 7 dias", ponto: "var(--ok)" },
];

/** Janela da coluna Concluídas (05/11: "as concluídas estão poluindo o quadro"). */
export const DIAS_CONCLUIDAS = 7;

/** Colunas que aparecem: Concluídas só quando a pessoa pede ("Ver concluídas"). */
export function colunasVisiveis(verConcluidas: boolean): typeof COLUNAS_Q {
  return verConcluidas ? COLUNAS_Q : COLUNAS_Q.filter((c) => c.id !== "concluida");
}

type SolMin = Pick<Solicitacao, "status" | "aguardando_quem" | "concluido_em">;
const JANELA_CONCLUIDAS = DIAS_CONCLUIDAS * 86_400_000;

/**
 * Coluna do quadro. Esperando o cliente/fornecedor/outro setor continua "Com
 * alguém" (o responsável segue dono); só "aguardando quem pediu" volta.
 * Recusada, cancelada e concluída há mais de 7 dias saem do quadro (Buscar).
 */
export function colunaDoQuadro(s: SolMin, agora = Date.now()): ColunaQ | null {
  switch (s.status) {
    case "nova": return "nova";
    case "em_andamento": return "com_alguem";
    case "aguardando": return s.aguardando_quem === "solicitante" ? "voltou" : "com_alguem";
    case "concluida": return s.concluido_em && agora - new Date(s.concluido_em).getTime() <= JANELA_CONCLUIDAS ? "concluida" : null;
    default: return null;
  }
}

// ── Chip de prazo ───────────────────────────────────────────────────────────
/** r = venceu · o = vence hoje · ok = no prazo · n = sem prazo / pausado. */
export type TomChip = "r" | "o" | "ok" | "n";
type SolPrazo = Pick<Solicitacao, "status" | "aguardando_quem" | "prazo" | "concluido_em">;

function venceuHa(prazo: string, agora: number): string {
  const min = Math.max(1, Math.floor((agora - new Date(prazo).getTime()) / 60_000));
  if (min < 60) return `Venceu há ${min} min`;
  const dias = diaNum(agora) - diaNum(prazo);
  if (dias <= 0) return `Venceu há ${Math.floor(min / 60)}h`;
  if (dias === 1) return "Venceu ontem";
  return `Venceu há ${dias} dias`;
}

export function chipDePrazo(s: SolPrazo, agora = Date.now()): { tom: TomChip; texto: string } {
  if (s.status === "concluida") {
    const atrasou = !!s.prazo && !!s.concluido_em && new Date(s.concluido_em).getTime() > new Date(s.prazo).getTime();
    return atrasou ? { tom: "r", texto: "Concluída com atraso" } : { tom: "ok", texto: "No prazo" };
  }
  if (s.status === "recusada") return { tom: "n", texto: "Recusada" };
  if (s.status === "cancelada") return { tom: "n", texto: "Cancelada" };
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return { tom: "n", texto: "Prazo pausado" };
  if (!s.prazo) return { tom: "n", texto: "Sem prazo" };
  const t = new Date(s.prazo).getTime();
  if (t < agora) return { tom: "r", texto: venceuHa(s.prazo, agora) };
  const dif = diaNum(s.prazo) - diaNum(agora);
  if (dif === 0) return { tom: "o", texto: `Hoje, ${hora(s.prazo)}` };
  if (dif === 1) return { tom: "ok", texto: `Amanhã, ${hora(s.prazo)}` };
  return { tom: "ok", texto: `${semana(s.prazo).replace(/^./, (c) => c.toUpperCase())}, ${FMT_DDMM.format(new Date(s.prazo))}` };
}

/** "2h 10min", "45 min", "3 dias" — distância legível entre dois instantes. */
export function duracaoLegivel(ms: number): string {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 dia" : `${d} dias`;
}

/**
 * O prazo em destaque no pedido aberto: "Faltam 2h 10min" / "Atrasado há 1 dia"
 * / "Prazo pausado" + a data por extenso embaixo.
 */
export function contagemDoPrazo(s: SolPrazo, agora = Date.now()): { tom: TomChip; grande: string; sub: string } {
  const quando = s.prazo ? quandoCurto(s.prazo, agora) : "";
  if (s.status === "concluida") {
    const c = chipDePrazo(s, agora);
    return { tom: c.tom, grande: c.texto, sub: s.concluido_em ? `concluída ${quandoCurto(s.concluido_em, agora)}` : "" };
  }
  if (s.status === "recusada" || s.status === "cancelada") return { tom: "n", grande: s.status === "recusada" ? "Recusada" : "Cancelada", sub: "" };
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return { tom: "n", grande: "Prazo pausado", sub: "volta a contar quando quem pediu responder" };
  if (!s.prazo) return { tom: "n", grande: "Sem prazo", sub: "" };
  const dif = new Date(s.prazo).getTime() - agora;
  if (dif < 0) return { tom: "r", grande: `Atrasado há ${duracaoLegivel(dif)}`, sub: `venceu ${quando}` };
  return { tom: chipDePrazo(s, agora).tom, grande: `Faltam ${duracaoLegivel(dif)}`, sub: `vence ${quando}` };
}

// ── Filtros do topo ─────────────────────────────────────────────────────────
export type FiltroQ = "todos" | "atrasados" | "comigo";
export function passaNoFiltro(s: Pick<Solicitacao, "status" | "aguardando_quem" | "prazo" | "concluido_em" | "responsavel_id" | "criado_por" | "sem_dono_atrasada">,
  f: FiltroQ, eu: string, agora = Date.now()): boolean {
  if (f === "todos") return true;
  if (f === "comigo") return s.responsavel_id === eu;
  return (s.status !== "concluida" && chipDePrazo(s, agora).tom === "r") || !!s.sem_dono_atrasada;
}

// ── Participantes ───────────────────────────────────────────────────────────
type SolPart = Pick<Solicitacao, "status" | "criado_por" | "responsavel_id" | "para_setor"> & { seguindo?: boolean };
/**
 * Quem participa do pedido (recebe aviso de mensagem e conta "não lida"):
 * quem pediu · o responsável · quem acompanha · o setor que recebe enquanto
 * ninguém pegou (status "nova" sem dono). Igual à coluna "participo" da 0315.
 */
export function ehParticipante(s: SolPart, eu: string, meusSetores: readonly (Setor | string)[], ehAdmin = false): boolean {
  if (!eu) return false;
  if (s.criado_por === eu || s.responsavel_id === eu || s.seguindo) return true;
  return s.status === "nova" && !s.responsavel_id && (ehAdmin || meusSetores.includes(s.para_setor));
}

/** Quem é participante "de nascença" não precisa (nem pode) clicar Acompanhar. */
export function podeAcompanhar(s: SolPart, eu: string): boolean {
  return !!eu && s.criado_por !== eu && s.responsavel_id !== eu;
}

// ── Não lidas ───────────────────────────────────────────────────────────────
type EvMin = Pick<EventoSol, "autor_id" | "criado_em">;
/** Eventos de OUTRAS pessoas depois do meu último "visto" (janela de 30 dias, como a view). */
export function contarNaoLidas(eventos: readonly EvMin[], vistoEm: string | null | undefined, eu: string, agora = Date.now()): number {
  const desde = Math.max(vistoEm ? new Date(vistoEm).getTime() : -Infinity, agora - 30 * 86_400_000);
  return eventos.filter((e) => e.autor_id !== eu && new Date(e.criado_em).getTime() > desde).length;
}

/** Soma das não lidas dos pedidos de que participo (o que aparece no quadro). */
export function totalNaoLidas(lista: readonly Pick<Solicitacao, "nao_lidas" | "participo">[]): number {
  return lista.reduce((n, s) => n + (s.participo ? s.nao_lidas ?? 0 : 0), 0);
}

/**
 * O número do selo de "Solicitações" no menu.
 * Com a 0315: não lidas (o pedido novo já conta 1 pra cada um do setor) — mas
 * nunca menos que as novas sem dono (quem já abriu e não pegou continua vendo)
 * — + desfechos vencidos. Sem a 0315: o selo antigo (novas + novidades + desfechos).
 */
export function numeroDoMenu(c: { novas: number; novidades: number; desfechos: number; naoLidas?: number | null }): number {
  if (typeof c.naoLidas === "number") return Math.max(c.naoLidas, c.novas) + c.desfechos;
  return c.novas + c.novidades + c.desfechos;
}

// ── Linha do tempo ──────────────────────────────────────────────────────────
export type ItemConversa =
  | { tipo: "evento"; id: string; texto: string }
  | { tipo: "msg"; id: string; quem: string; hora: string; texto: string; eu: boolean; evento: number; auto: boolean };

const primeiro = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "Alguém";

/** O que aconteceu, em uma frase ("Laura pegou o pedido"). null = é mensagem. */
export function fraseDoEvento(e: Pick<EventoSol, "tipo" | "para" | "autor_id" | "autor_nome">, quemPediu?: string | null): string | null {
  const q = primeiro(e.autor_nome);
  switch (e.tipo) {
    case "comentario": return null;
    case "criada": return `${q} criou o pedido`;
    case "aceita": return `${q} pegou o pedido`;
    case "passada": return !e.autor_id && e.autor_nome === "QS" ? `Distribuído para ${primeiro(e.para)}` : `${q} passou o pedido para ${primeiro(e.para)}`;
    case "ajuste": return `Pedido voltou para ${primeiro(quemPediu) || "quem pediu"} · prazo pausado`;
    case "ajustada": return `${q} enviou os ajustes · prazo voltou a contar`;
    case "concluida": return `${q} concluiu o pedido`;
    case "confirmada": return `${q} confirmou que resolveu`;
    case "reaberta": return `${q} reabriu o pedido`;
    case "recusada": return `${q} recusou o pedido`;
    case "cancelada": return `${q} cancelou o pedido`;
    case "prazo": return `${q} mudou o prazo`;
    case "vinculada": return `${q} vinculou ${e.para ?? "o cliente"}`;
    case "desfecho": return `${q} deu o desfecho`;
    case "status":
      if (e.para === "em_andamento") return `${q} retomou o pedido`;
      if (e.para?.startsWith("aguardando:")) {
        const k = e.para.split(":")[1];
        return `${q} marcou: esperando ${k === "cliente" ? "o cliente" : k === "fornecedor" ? "o fornecedor" : k === "outro_setor" ? "outro setor" : "quem pediu"}`;
      }
      return `${q} mudou o andamento`;
    default: return `${q} atualizou o pedido`;
  }
}

/**
 * Eventos → pílulas e bolhas. Eventos com texto (o que falta, o que foi feito,
 * o motivo) viram pílula + bolha do autor. `descricaoInicial` (pedido sem
 * formulário) entra como a primeira mensagem de quem pediu.
 */
export function itensDaConversa(eventos: readonly EventoSol[], eu: string, opts: { quemPediu?: string | null; descricaoInicial?: string | null; agora?: number } = {}): ItemConversa[] {
  const agora = opts.agora ?? Date.now();
  const out: ItemConversa[] = [];
  for (const e of eventos) {
    const frase = fraseDoEvento(e, opts.quemPediu);
    const quando = quandoCurto(e.criado_em, agora);
    if (frase) out.push({ tipo: "evento", id: `e${e.id}`, texto: `${frase} · ${quando}` });
    const texto = e.tipo === "criada" ? opts.descricaoInicial?.trim() || null : e.texto?.trim() || null;
    const ehDistribuicao = e.tipo === "passada" && !e.autor_id;
    if (texto && !ehDistribuicao && e.tipo !== "desfecho") {
      // 0316: mensagem só com arquivos ("anexou X", para = 'anexos') — a tela mostra os arquivos no lugar do texto
      const auto = e.tipo === "comentario" && e.para === "anexos";
      out.push({ tipo: "msg", id: `m${e.id}`, quem: e.autor_id === eu ? "Você" : primeiro(e.autor_nome), hora: quando, texto, eu: !!eu && e.autor_id === eu, evento: e.id, auto });
    }
  }
  return out;
}

/** Prévia no cartão: "Antônio: Conseguiu achar?" ou a frase do último evento. */
export function previaDoUltimo(u: UltimoEvento | null | undefined, eu: string, quemPediu?: string | null): string {
  if (!u) return "";
  if (u.tipo === "comentario") {
    const quem = u.autor_id === eu ? "Você" : primeiro(u.autor_nome);
    return u.para === "anexos" ? `📎 ${quem} ${u.texto ?? "anexou um arquivo"}` : `${quem}: ${u.texto ?? ""}`;
  }
  return fraseDoEvento(u, quemPediu) ?? "";
}

/** Iniciais do avatar ("Laura Souza" → "LS"; eu → "EU"). */
export function iniciais(nome: string | null | undefined, ehEu = false): string {
  if (ehEu) return "EU";
  const p = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** Respostas rápidas do rodapé da conversa (gravam comentário). */
export const RESPOSTAS_RAPIDAS: { rotulo: string; texto: string }[] = [
  { rotulo: "Já estou vendo", texto: "Já estou vendo, te aviso assim que resolver." },
  { rotulo: "Preciso de mais informação", texto: "Preciso de mais informação para seguir. Pode me passar os detalhes?" },
  { rotulo: "Resolvido", texto: "Resolvido!" },
];

/**
 * Descrição em "Rótulo: valor" por linha vira cartões (o resto fica como texto).
 * Linha sem ":" (ou com rótulo comprido) vai pro texto livre.
 */
export function camposDaDescricao(desc: string | null | undefined): { campos: [string, string][]; resto: string } {
  const campos: [string, string][] = [];
  const resto: string[] = [];
  for (const linha of (desc ?? "").split(/\r?\n/)) {
    const m = /^\s*([^:]{1,32}):\s+(\S.*)$/.exec(linha);
    if (m && !/^https?$/i.test(m[1].trim())) campos.push([m[1].trim(), m[2].trim()]);
    else resto.push(linha);
  }
  return { campos, resto: resto.join("\n").trim() };
}
