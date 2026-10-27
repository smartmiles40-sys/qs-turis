// src/lib/discador/motor.ts
// -----------------------------------------------------------------------------
// MOTOR DO DISCADOR — lógica PURA (sem rede, sem React, sem Supabase, sem JsSIP).
//
// O discador liga pra N leads ao mesmo tempo pelo ramal do SDR. Quem atender
// primeiro vira a chamada do SDR; as que ainda tocam são canceladas na hora; se
// outra JÁ tinha atendido (corrida), ela é derrubada e o lead ganha um retorno
// urgente. Ninguém atendeu no tempo → "não atendeu" em todas e vai o próximo lote.
//
// Este arquivo só DECIDE. Quem executa (abre as chamadas, manda CANCEL/BYE,
// grava no banco) é o controlador.ts. Assim dá pra simular milhares de lotes
// num script de node (scripts/discador-simular.mjs) sem tocar na VoxFree.
// -----------------------------------------------------------------------------

// ── Configuração ─────────────────────────────────────────────────────────────

export interface ConfigDiscador {
  /** Quantas chamadas por lote no começo da sessão. */
  lote: number;
  /** Teto absoluto (nunca passa disso, nem se o admin pedir mais). */
  loteMax: number;
  /** Segundos que cada número toca antes de desistirmos (antes da caixa postal). */
  toqueSeg: number;
  /** Taxa de abandono tolerada (0.03 = 3%). Acima disso o lote diminui. */
  abandonoMax: number;
  /** Respiro entre um lote e o próximo (ms). */
  intervaloMs: number;
  /**
   * Recusa "rápida" (ms): resposta final de erro que chega antes disso, sem
   * nenhum toque (180/183), é suspeita de ser a CENTRAL recusando por limite
   * de canais — e não o telefone do lead.
   */
  recusaRapidaMs: number;
}

/** Teto duro do código — o pedido do Bruno é "até 10". */
export const LOTE_TETO = 10;

export const CONFIG_PADRAO: ConfigDiscador = {
  lote: 5,
  loteMax: LOTE_TETO,
  toqueSeg: 20,
  abandonoMax: 0.03,
  intervaloMs: 1500,
  recusaRapidaMs: 1200,
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Limpa o que vier do qs_settings: número fora da faixa volta pra faixa. */
export function normalizarConfig(raw: Partial<Record<keyof ConfigDiscador, unknown>> | null | undefined): ConfigDiscador {
  const r = raw ?? {};
  const loteMax = Math.round(clamp(num(r.loteMax, CONFIG_PADRAO.loteMax), 1, LOTE_TETO));
  return {
    loteMax,
    lote: Math.round(clamp(num(r.lote, CONFIG_PADRAO.lote), 1, loteMax)),
    toqueSeg: Math.round(clamp(num(r.toqueSeg, CONFIG_PADRAO.toqueSeg), 8, 45)),
    abandonoMax: clamp(num(r.abandonoMax, CONFIG_PADRAO.abandonoMax), 0, 0.5),
    intervaloMs: Math.round(clamp(num(r.intervaloMs, CONFIG_PADRAO.intervaloMs), 0, 30000)),
    recusaRapidaMs: Math.round(clamp(num(r.recusaRapidaMs, CONFIG_PADRAO.recusaRapidaMs), 0, 5000)),
  };
}

// ── Classificação da resposta SIP ────────────────────────────────────────────

/** Estado de cada número dentro do lote (o que o painel mostra). */
export type StatusPerna =
  | "discando"        // INVITE saiu, nada voltou ainda
  | "tocando"         // 180/183
  | "vencedora"       // atendeu primeiro → é a chamada do SDR
  | "derrubada"       // atendeu, mas outra já tinha atendido → BYE + retorno urgente
  | "nao_atendeu"     // tocou o tempo todo, ou 480/408/487 do lado de lá
  | "ocupado"         // 486/600
  | "invalido"        // 404/604/484/424 — número não existe / incompleto
  | "recusado_canal"  // a central recusou por limite de chamadas simultâneas
  | "cancelada"       // outro atendeu; esta ainda tocava e foi cancelada (volta pra fila)
  | "erro";           // falha técnica (WebRTC, conexão, SDP…) — volta pra fila

export const STATUS_ATIVOS: ReadonlySet<StatusPerna> = new Set<StatusPerna>(["discando", "tocando"]);

/** Rótulo curto pro painel. */
export const ROTULO_STATUS: Record<StatusPerna, string> = {
  discando: "discando",
  tocando: "tocando",
  vencedora: "atendeu",
  derrubada: "derrubado",
  nao_atendeu: "não atendeu",
  ocupado: "ocupado",
  invalido: "inválido",
  recusado_canal: "central recusou",
  cancelada: "cancelado",
  erro: "erro",
};

/** Códigos que PODEM ser a central dizendo "acabaram os canais". */
export const CODIGOS_SUSPEITOS_DE_LIMITE: ReadonlySet<number> = new Set([403, 480, 486, 503, 603]);

/**
 * Traduz a falha de uma chamada (status SIP + "cause" da JsSIP) no status da
 * perna. NÃO decide sobre limite de canais — isso só dá pra saber olhando o
 * lote inteiro (ver detectarLimiteCanais).
 */
export function classificarFalha(statusCode: number | null | undefined, cause?: string | null): StatusPerna {
  const c = typeof statusCode === "number" ? statusCode : null;
  const k = (cause ?? "").toLowerCase();
  if (c === 486 || c === 600 || k === "busy") return "ocupado";
  if (c === 404 || c === 604 || c === 484 || c === 424 || k === "not found" || k === "address incomplete") return "invalido";
  if (c === 480 || c === 408 || c === 410 || c === 430 || c === 487 || k === "unavailable" || k === "no answer" || k === "request timeout") return "nao_atendeu";
  // 403/603 (recusado), 503 (serviço indisponível), 5xx em geral: o lead não
  // "não atendeu" — algo no caminho recusou. Sem prova de limite, conta como
  // ocupado/recusado pelo destino (o celular pode ter rejeitado a chamada).
  if (c === 603 || k === "rejected") return "ocupado";
  if (c === 403 || (c !== null && c >= 500 && c < 600)) return "erro";
  if (k === "canceled") return "nao_atendeu";
  return "erro";
}

// ── Desfecho na tarefa ───────────────────────────────────────────────────────

/**
 * O que fazer com a TAREFA do lead quando o lote termina.
 *  - nao_atendeu / numero_errado → o MESMO desfecho do botão do Painel
 *    (follow-up da cadência é feito lá, nada de regra duplicada aqui)
 *  - sdr       → atendeu: o SDR dá o desfecho como hoje
 *  - retorno   → foi derrubado: cria extra urgente "discador-abandonada"
 *  - devolver  → não conta como tentativa (cancelada, recusa da central, erro)
 */
export type AcaoTarefa = "nao_atendeu" | "numero_errado" | "sdr" | "retorno" | "devolver";

export function acaoDaTarefa(s: StatusPerna): AcaoTarefa {
  switch (s) {
    case "nao_atendeu":
    case "ocupado":
      return "nao_atendeu";
    case "invalido":
      return "numero_errado";
    case "vencedora":
      return "sdr";
    case "derrubada":
      return "retorno";
    default:
      return "devolver";
  }
}

// ── Lote (máquina de estados) ────────────────────────────────────────────────

export interface ItemFila {
  tarefaId: string;
  leadId: string;
  /** Telefone já normalizado (55DDDNÚMERO). */
  telefone: string;
  nome?: string | null;
}

export interface Perna {
  /** Índice dentro do lote = ordem em que o INVITE saiu. */
  idx: number;
  item: ItemFila;
  status: StatusPerna;
  sipCode: number | null;
  inicioMs: number;
  tocouMs: number | null;
  atendeuMs: number | null;
  fimMs: number | null;
}

export interface Lote {
  numero: number;
  pernas: Perna[];
  /** idx da perna que virou a chamada do SDR. */
  vencedora: number | null;
  /** A chamada do SDR já terminou? */
  vencedoraEncerrada: boolean;
}

export type EventoPerna =
  | { tipo: "tocando"; idx: number; t: number }
  | { tipo: "atendeu"; idx: number; t: number }
  | { tipo: "falhou"; idx: number; t: number; sipCode: number | null; cause?: string | null }
  | { tipo: "encerrou"; idx: number; t: number }
  | { tipo: "relogio"; t: number; toqueMs: number }
  | { tipo: "parar"; t: number };

/** O que o controlador precisa FAZER na rede depois de um evento. */
export type Comando =
  | { tipo: "promover"; idx: number }   // vira a chamada ativa do SDR (áudio)
  | { tipo: "cancelar"; idx: number }   // CANCEL (ainda tocando)
  | { tipo: "desligar"; idx: number };  // BYE (atendeu e sobrou)

export function novoLote(numero: number, itens: ItemFila[], t: number): Lote {
  return {
    numero,
    vencedora: null,
    vencedoraEncerrada: false,
    pernas: itens.map((item, idx) => ({
      idx, item, status: "discando", sipCode: null, inicioMs: t, tocouMs: null, atendeuMs: null, fimMs: null,
    })),
  };
}

function copia(l: Lote): Lote {
  return { ...l, pernas: l.pernas.map((p) => ({ ...p })) };
}

/**
 * Aplica um evento ao lote. Função pura: devolve o lote novo + os comandos de
 * rede. Eventos atrasados (perna que já terminou) são ignorados, com UMA
 * exceção importante: "atendeu" numa perna que já tínhamos cancelado (o 200 OK
 * cruzou com o nosso CANCEL) — essa pessoa ATENDEU e vai ouvir silêncio, então
 * conta como derrubada e ganha retorno.
 */
export function aplicarEvento(lote: Lote, ev: EventoPerna): { lote: Lote; comandos: Comando[] } {
  const l = copia(lote);
  const comandos: Comando[] = [];

  if (ev.tipo === "relogio") {
    for (const p of l.pernas) {
      if (STATUS_ATIVOS.has(p.status) && ev.t - p.inicioMs >= ev.toqueMs) {
        p.status = "nao_atendeu";
        p.fimMs = ev.t;
        comandos.push({ tipo: "cancelar", idx: p.idx });
      }
    }
    return { lote: l, comandos };
  }

  if (ev.tipo === "parar") {
    for (const p of l.pernas) {
      if (STATUS_ATIVOS.has(p.status)) {
        p.status = "cancelada";
        p.fimMs = ev.t;
        comandos.push({ tipo: "cancelar", idx: p.idx });
      }
    }
    return { lote: l, comandos };
  }

  const p = l.pernas[ev.idx];
  if (!p) return { lote: l, comandos };

  switch (ev.tipo) {
    case "tocando":
      if (p.status === "discando") { p.status = "tocando"; p.tocouMs = ev.t; }
      break;

    case "atendeu": {
      if (p.status === "vencedora" || p.status === "derrubada") break; // repetido (accepted + confirmed)
      p.atendeuMs = ev.t;
      if (l.vencedora === null && STATUS_ATIVOS.has(p.status)) {
        // 1ª a atender: é do SDR. As outras que tocam → CANCEL já.
        p.status = "vencedora";
        l.vencedora = p.idx;
        comandos.push({ tipo: "promover", idx: p.idx });
        for (const o of l.pernas) {
          if (o.idx !== p.idx && STATUS_ATIVOS.has(o.status)) {
            o.status = "cancelada";
            o.fimMs = ev.t;
            comandos.push({ tipo: "cancelar", idx: o.idx });
          }
        }
      } else {
        // Já tem vencedora (ou já tínhamos desistido desta): "só desliga".
        p.status = "derrubada";
        p.fimMs = ev.t;
        comandos.push({ tipo: "desligar", idx: p.idx });
      }
      break;
    }

    case "falhou":
      if (STATUS_ATIVOS.has(p.status)) {
        p.status = classificarFalha(ev.sipCode, ev.cause);
        p.sipCode = ev.sipCode ?? null;
        p.fimMs = ev.t;
      } else if (p.sipCode === null && ev.sipCode != null) {
        p.sipCode = ev.sipCode; // guarda o código mesmo se já tínhamos decidido (log)
      }
      break;

    case "encerrou":
      if (p.status === "vencedora") { l.vencedoraEncerrada = true; p.fimMs = ev.t; }
      else if (STATUS_ATIVOS.has(p.status)) { p.status = "nao_atendeu"; p.fimMs = ev.t; }
      break;
  }
  return { lote: l, comandos };
}

/** Nenhum número do lote ainda tocando? (a vencedora pode estar em conversa) */
export function loteResolvido(l: Lote): boolean {
  return l.pernas.every((p) => !STATUS_ATIVOS.has(p.status));
}

// ── Limite de canais da central ──────────────────────────────────────────────

export type DiagnosticoCentral =
  | { tipo: "ok" }
  /** A central aceitou só `capacidade` chamadas; as outras foram recusadas na hora. */
  | { tipo: "limite"; capacidade: number; recusadas: number[] }
  /** TODAS foram recusadas na hora (lote > 1) — limite = 1? conta bloqueada? */
  | { tipo: "recusou_tudo"; codigo: number | null; recusadas: number[] };

function recusaRapida(p: Perna, cfg: ConfigDiscador): boolean {
  return p.tocouMs === null
    && p.atendeuMs === null
    && p.fimMs !== null
    && p.sipCode !== null
    && CODIGOS_SUSPEITOS_DE_LIMITE.has(p.sipCode)
    && p.fimMs - p.inicioMs <= cfg.recusaRapidaMs;
}

/**
 * Olha o lote inteiro e decide se a central recusou por LIMITE de chamadas.
 *
 * Assinatura do limite: as primeiras X chamadas tocam normalmente e as que
 * saíram DEPOIS voltam recusadas na hora (sem tocar), todas com o mesmo tipo
 * de código. Um único "ocupado" rápido no meio do lote é só alguém ocupado.
 */
export function detectarLimiteCanais(l: Lote, cfg: ConfigDiscador): DiagnosticoCentral {
  const n = l.pernas.length;
  const rapidas = l.pernas.filter((p) => recusaRapida(p, cfg));
  if (rapidas.length === 0) return { tipo: "ok" };
  if (rapidas.length === n) {
    if (n === 1) return { tipo: "ok" }; // um só número: é o número, não a central
    return { tipo: "recusou_tudo", codigo: rapidas[0].sipCode, recusadas: rapidas.map((p) => p.idx) };
  }
  const outras = l.pernas.filter((p) => !recusaRapida(p, cfg));
  const maxIdxOutras = Math.max(...outras.map((p) => p.idx));
  const minIdxRapidas = Math.min(...rapidas.map((p) => p.idx));
  // Todas as recusadas saíram depois de todas as que passaram → é o padrão do limite.
  if (minIdxRapidas > maxIdxOutras) {
    return { tipo: "limite", capacidade: outras.length, recusadas: rapidas.map((p) => p.idx) };
  }
  // Fora de ordem, mas 2+ recusas rápidas com o MESMO código: ainda é suspeito.
  const mesmoCodigo = rapidas.every((p) => p.sipCode === rapidas[0].sipCode);
  if (rapidas.length >= 2 && mesmoCodigo) {
    return { tipo: "limite", capacidade: outras.length, recusadas: rapidas.map((p) => p.idx) };
  }
  return { tipo: "ok" };
}

/**
 * Aplica o diagnóstico ao lote: pernas recusadas pela central viram
 * "recusado_canal" (o lead volta pra fila, a tarefa fica intacta).
 */
export function marcarRecusasDaCentral(l: Lote, d: DiagnosticoCentral): Lote {
  if (d.tipo === "ok") return l;
  const c = copia(l);
  for (const idx of d.recusadas) {
    const p = c.pernas[idx];
    if (p) p.status = "recusado_canal";
  }
  return c;
}

// ── Sessão (contadores + decisão de N) ───────────────────────────────────────

export interface SessaoDiscador {
  nAtual: number;
  /** Teto descoberto na central (null = ainda não sabemos). */
  capacidadeCentral: number | null;
  lotes: number;
  discadas: number;       // chamadas que realmente saíram (sem as recusadas pela central)
  atendidas: number;      // vencedoras + derrubadas
  abandonadas: number;    // derrubadas
  naoAtendidas: number;
  ocupados: number;
  invalidos: number;
  recusasCentral: number;
  /** Lotes seguidos em que a central recusou TUDO (2 seguidos = para). */
  recusasTotaisSeguidas: number;
  /** Avisos pro painel ("a central aceitou só 3 ao mesmo tempo"). */
  avisos: string[];
  /** Motivo de parada forçada (null = pode seguir). */
  bloqueio: string | null;
}

export function novaSessao(cfg: ConfigDiscador): SessaoDiscador {
  return {
    nAtual: Math.min(cfg.lote, cfg.loteMax),
    capacidadeCentral: null,
    lotes: 0, discadas: 0, atendidas: 0, abandonadas: 0, naoAtendidas: 0, ocupados: 0, invalidos: 0,
    recusasCentral: 0, recusasTotaisSeguidas: 0, avisos: [], bloqueio: null,
  };
}

export function taxaAbandono(s: SessaoDiscador): number {
  return s.atendidas > 0 ? s.abandonadas / s.atendidas : 0;
}

/**
 * Fecha a conta do lote na sessão e decide o N do PRÓXIMO lote.
 *
 * Regras (conservadoras de propósito):
 *  1. Central recusou por limite → N = o que ela aceitou (mín. 1) e avisa.
 *  2. Central recusou TUDO → N = 1; se repetir com N = 1, para a sessão
 *     (cara de bloqueio/crédito — a pane de 25/09 começou assim).
 *  3. Teve abandono neste lote e a taxa da sessão passou do limite → N cai
 *     pela metade (mín. 1). Com N = 1 não existe abandono.
 *  4. Taxa voltou pra dentro do limite → N volta pro configurado, sem passar
 *     do teto descoberto na central.
 */
export function fecharLote(
  sessao: SessaoDiscador,
  lote: Lote,
  diag: DiagnosticoCentral,
  cfg: ConfigDiscador,
): SessaoDiscador {
  const s: SessaoDiscador = { ...sessao, avisos: [...sessao.avisos] };
  s.lotes += 1;
  let abandonoNoLote = 0;
  for (const p of lote.pernas) {
    if (p.status === "recusado_canal") { s.recusasCentral += 1; continue; }
    s.discadas += 1;
    if (p.status === "vencedora") s.atendidas += 1;
    else if (p.status === "derrubada") { s.atendidas += 1; s.abandonadas += 1; abandonoNoLote += 1; }
    else if (p.status === "nao_atendeu") s.naoAtendidas += 1;
    else if (p.status === "ocupado") s.ocupados += 1;
    else if (p.status === "invalido") s.invalidos += 1;
  }

  if (diag.tipo === "limite") {
    const cap = Math.max(1, diag.capacidade);
    s.capacidadeCentral = s.capacidadeCentral === null ? cap : Math.min(s.capacidadeCentral, cap);
    s.avisos.push(`A central aceitou só ${cap} ${cap === 1 ? "chamada" : "chamadas"} ao mesmo tempo — lote reduzido para ${s.capacidadeCentral}.`);
    s.recusasTotaisSeguidas = 0;
  } else if (diag.tipo === "recusou_tudo") {
    s.recusasTotaisSeguidas += 1;
    s.capacidadeCentral = 1;
    s.avisos.push(`A central recusou todas as ${lote.pernas.length} chamadas na hora${diag.codigo ? ` (${diag.codigo})` : ""} — tentando de 1 em 1.`);
  } else {
    // Um lote de 1 recusado na hora com 403/503 depois de já termos caído pra 1
    // também conta como "recusou tudo".
    const unica = lote.pernas.length === 1 ? lote.pernas[0] : null;
    if (unica && s.capacidadeCentral === 1 && unica.tocouMs === null && unica.atendeuMs === null
      && (unica.sipCode === 403 || unica.sipCode === 503) && unica.fimMs !== null
      && unica.fimMs - unica.inicioMs <= cfg.recusaRapidaMs) {
      s.recusasTotaisSeguidas += 1;
    } else {
      s.recusasTotaisSeguidas = 0;
    }
  }
  if (s.recusasTotaisSeguidas >= 2) {
    s.bloqueio = "A central está recusando todas as chamadas na hora (pode ser bloqueio, crédito ou limite = 0). Discador parado — avise a VoxFree.";
  }

  const teto = Math.min(cfg.loteMax, s.capacidadeCentral ?? cfg.loteMax);
  const taxa = taxaAbandono(s);
  if (abandonoNoLote > 0 && taxa > cfg.abandonoMax) {
    const novo = Math.max(1, Math.floor(s.nAtual / 2));
    if (novo < s.nAtual) s.avisos.push(`Abandono em ${(taxa * 100).toFixed(1)}% (limite ${(cfg.abandonoMax * 100).toFixed(0)}%) — lote reduzido de ${s.nAtual} para ${novo}.`);
    s.nAtual = Math.min(novo, teto);
  } else if (taxa <= cfg.abandonoMax) {
    s.nAtual = Math.min(cfg.lote, teto);
  } else {
    s.nAtual = Math.min(s.nAtual, teto);
  }
  s.nAtual = Math.max(1, s.nAtual);
  return s;
}

// ── Montagem do lote a partir da fila ────────────────────────────────────────

/**
 * Pega os próximos `n` da fila, sem repetir lead no lote e pulando quem já foi
 * discado hoje. Devolve o lote e o resto da fila (na mesma ordem).
 */
export function proximoLote(
  fila: ItemFila[],
  n: number,
  jaDiscadosHoje: ReadonlySet<string>,
): { itens: ItemFila[]; resto: ItemFila[] } {
  const itens: ItemFila[] = [];
  const resto: ItemFila[] = [];
  const noLote = new Set<string>();
  for (const it of fila) {
    if (itens.length < n && !noLote.has(it.leadId) && !jaDiscadosHoje.has(it.leadId) && it.telefone.length >= 11) {
      itens.push(it);
      noLote.add(it.leadId);
    } else if (!jaDiscadosHoje.has(it.leadId) && !noLote.has(it.leadId)) {
      resto.push(it);
    }
  }
  return { itens, resto };
}

/**
 * Leads que NÃO podem ser discados de novo hoje depois deste lote: todo mundo
 * cuja ligação de fato aconteceu (tocou, atendeu, ocupado, inválido). Quem foi
 * cancelado antes de atender, recusado pela central ou deu erro técnico volta
 * pra fila.
 */
export function leadsConsumidos(l: Lote): string[] {
  return l.pernas.filter((p) => acaoDaTarefa(p.status) !== "devolver").map((p) => p.item.leadId);
}

/** Pernas que voltam pra fila (no FIM dela). */
export function itensDevolvidos(l: Lote): ItemFila[] {
  return l.pernas.filter((p) => acaoDaTarefa(p.status) === "devolver").map((p) => p.item);
}

/** Quantas vezes um lead pode voltar pra fila na mesma sessão (cancelado/erro). */
export const MAX_DEVOLUCOES = 2;

/**
 * Junta a fila restante com os devolvidos do lote (no FIM, pra não tocar de
 * novo logo em seguida). Quem já voltou MAX_DEVOLUCOES vezes sai da sessão —
 * a tarefa fica intacta na Fila de hoje pro SDR ligar na mão.
 */
export function reenfileirar(
  resto: ItemFila[],
  devolvidos: ItemFila[],
  contagem: Map<string, number>,
): { fila: ItemFila[]; descartados: ItemFila[] } {
  const descartados: ItemFila[] = [];
  const voltam: ItemFila[] = [];
  for (const it of devolvidos) {
    const n = (contagem.get(it.leadId) ?? 0) + 1;
    contagem.set(it.leadId, n);
    if (n > MAX_DEVOLUCOES) descartados.push(it);
    else voltam.push(it);
  }
  return { fila: [...resto, ...voltam], descartados };
}
