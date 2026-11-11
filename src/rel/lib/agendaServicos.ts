// src/rel/lib/agendaServicos.ts
// -----------------------------------------------------------------------------
// CHECK-INS e AGENDA DE SERVIÇOS das Viagens (Bruno, 11/11/2026).
//
// 1. CHECK-INS — "uma aba onde só deve ter aéreo e todos em sequência de novos
//    check-ins": só VOO que vale (aéreo de verdade — nunca a data do Bitrix de
//    uma venda de hotel/seguro, ver 0359), que ainda não decolou, em ordem de
//    ABERTURA do check-in. A abertura é a que a cia informou (checkin_abre_em)
//    ou, sem ela, ESTIMADA em 48h antes da partida (JANELA_CHECKIN_HORAS) — a
//    tela diz "estimado". O mesmo voo repetido na mesma viagem (um trecho por
//    passageiro) vira UM item; "feito" marca todos.
//
// 2. AGENDA DE SERVIÇOS — "hoje está muito confuso tudo junto: hotel, pacote,
//    aéreo, seguro…": cada trecho vira as AÇÕES do cliente com data/hora
//    (check-in do hotel, check-out, passeio começa, transfer, trem, voo parte,
//    check-in online abre), separadas por TIPO e filtráveis pela data da ação
//    ou pela data de embarque da viagem. Venda de hotel/passeio/seguro sem
//    trecho cadastrado entra pelas datas da venda ("sem horário — data da venda").
//
// Lógica PURA (sem banco) — testes em tests/viagens/agendaServicos.test.ts.
// -----------------------------------------------------------------------------
import { aberturaCheckin, ehVoo, limiteDoVoo, semHora, vendaTemAereo, JANELA_CHECKIN_HORAS } from "./statusViagem.ts";

const H = 3600_000;

/** O que a agenda precisa de um trecho (rel_trechos_v). */
export interface TrechoAgenda {
  id: string;
  viagem_id: string;
  tipo: string;
  partida_em: string;
  chegada_em?: string | null;
  partida_fuso?: string | null;
  chegada_fuso?: string | null;
  origem?: string | null;
  destino?: string | null;
  origem_codigo?: string | null;
  destino_codigo?: string | null;
  descricao?: string | null;
  companhia?: string | null;
  numero?: string | null;
  localizador?: string | null;
  endereco?: string | null;
  ponto_encontro?: string | null;
  passageiros?: string[] | null;
  fonte?: string | null;
  checkin_abre_em?: string | null;
  checkin_em?: string | null;
  checkin_feito_em?: string | null;
  status_manual?: "voado" | "cancelado" | null;
  /** 0359 (view): o trecho é um voo que vale. Ausente = migration ainda não aplicada. */
  conta_como_voo?: boolean | null;
  viagem_aereo_vendido?: boolean | null;
}

/** O que a agenda precisa da viagem (rel_viagens_v). */
export interface ViagemAgenda {
  id: string;
  titulo: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  data_embarque: string | null;
  data_retorno: string | null;
  servico: string | null;
  status?: string | null;
  responsavel_nome?: string | null;
  aereo_vendido?: boolean | null;
}

// ── 1. o que é voo de verdade ───────────────────────────────────────────────

/**
 * O trecho é um VOO que vale? Com a 0359 aplicada, a view já decidiu
 * (conta_como_voo). Sem ela: tipo voo, não cancelado, e a data do Bitrix só se
 * a venda tem aéreo — nunca a data do hotel/seguro.
 */
export function ehVooQueVale(t: TrechoAgenda, v?: Pick<ViagemAgenda, "servico" | "aereo_vendido"> | null): boolean {
  if (!ehVoo(t) || t.status_manual === "cancelado") return false;
  if (typeof t.conta_como_voo === "boolean") return t.conta_como_voo;
  if (t.fonte !== "bitrix") return true;
  const aereo = typeof t.viagem_aereo_vendido === "boolean" ? t.viagem_aereo_vendido : vendaTemAereo(v ?? {});
  return aereo;
}

/** Voo só com a data do Bitrix (sem bilhete: sem horário, sem nº) — não dá pra fazer check-in ainda. */
export const semBilhete = (t: Pick<TrechoAgenda, "fonte" | "partida_em" | "numero">) => t.fonte === "bitrix" || (semHora(t) && !t.numero);

// ── 2. fila de check-ins ────────────────────────────────────────────────────

export type SituacaoCheckin = "aberto" | "abre_logo" | "futuro" | "feito";
export const ROTULO_SITUACAO_CHECKIN: Record<SituacaoCheckin, string> = {
  aberto: "Aberto — fazer agora",
  abre_logo: "Abre em menos de 24h",
  futuro: "Ainda não abriu",
  feito: "Feito",
};

export interface ItemCheckin {
  /** viagem + voo (o mesmo voo de vários passageiros da viagem vira um item) */
  chave: string;
  trechoIds: string[];
  viagem_id: string;
  t: TrechoAgenda;
  /** quando abre (ms) */
  abre: number;
  /** true = sem horário da cia: estimado em 48h antes da partida */
  estimado: boolean;
  situacao: SituacaoCheckin;
  semBilhete: boolean;
  passageiros: string[];
}

export interface OpcoesCheckin {
  /** mostrar também os já feitos (padrão: não) */
  feitos?: boolean;
  /** incluir voo só com a data do Bitrix, sem bilhete (padrão: não) */
  semBilhete?: boolean;
  /** só os que abrem até este instante (ms). */
  abreAte?: number | null;
}

const chaveDoVoo = (t: TrechoAgenda) =>
  `${t.viagem_id}|${new Date(t.partida_em).getTime()}|${(t.numero || "").replace(/\s+/g, "").toUpperCase() || `${t.origem ?? ""}>${t.destino ?? ""}`}`;

/**
 * Os check-ins a fazer, em ordem de abertura (depois partida, depois id).
 * Entra: voo que vale, não decolou (voo sem horário vale até o fim do dia),
 * não marcado como voado.
 */
export function filaDeCheckins(trechos: TrechoAgenda[], viagens: Map<string, ViagemAgenda>, agora: number, op: OpcoesCheckin = {}): ItemCheckin[] {
  const grupos = new Map<string, TrechoAgenda[]>();
  for (const t of trechos) {
    if (!t.partida_em || t.status_manual === "voado") continue;
    if (!ehVooQueVale(t, viagens.get(t.viagem_id))) continue;
    if (limiteDoVoo(t) < agora) continue;
    const k = chaveDoVoo(t);
    const g = grupos.get(k);
    if (g) g.push(t); else grupos.set(k, [t]);
  }
  const out: ItemCheckin[] = [];
  for (const [chave, ts] of grupos) {
    ts.sort((a, b) => a.id.localeCompare(b.id));
    const t = ts.find((x) => x.checkin_abre_em) ?? ts[0];
    const feito = ts.every((x) => !!x.checkin_feito_em);
    const sb = semBilhete(t);
    if (feito && !op.feitos) continue;
    if (sb && !op.semBilhete) continue;
    const abre = aberturaCheckin({ partida_em: t.partida_em, checkin_abre_em: t.checkin_abre_em ?? null, checkin_em: null });
    if (op.abreAte != null && abre > op.abreAte && !feito) continue;
    const situacao: SituacaoCheckin = feito ? "feito" : abre <= agora ? "aberto" : abre - agora <= 24 * H ? "abre_logo" : "futuro";
    const passageiros = [...new Set(ts.flatMap((x) => x.passageiros ?? []).map((p) => p.trim()).filter(Boolean))];
    out.push({ chave, trechoIds: ts.map((x) => x.id), viagem_id: t.viagem_id, t, abre, estimado: !t.checkin_abre_em, situacao, semBilhete: sb, passageiros });
  }
  return out.sort((a, b) => a.abre - b.abre || a.t.partida_em.localeCompare(b.t.partida_em) || a.chave.localeCompare(b.chave));
}

export const TEXTO_ESTIMADO = `estimado: ${JANELA_CHECKIN_HORAS}h antes do voo (a cia não informou a abertura)`;

// ── 3. agenda de ações por tipo ─────────────────────────────────────────────

export type CategoriaAcao = "aereo" | "hotel" | "passeio" | "transfer" | "trem" | "seguro" | "outro";
export const CATEGORIAS_ACAO: { id: CategoriaAcao; rotulo: string }[] = [
  { id: "aereo", rotulo: "Aéreo" },
  { id: "hotel", rotulo: "Hotel" },
  { id: "passeio", rotulo: "Passeio" },
  { id: "transfer", rotulo: "Transfer" },
  { id: "trem", rotulo: "Trem" },
  { id: "seguro", rotulo: "Seguro" },
  { id: "outro", rotulo: "Outros" },
];

export type EventoAcao =
  | "checkin_online" | "voo_parte"
  | "hotel_checkin" | "hotel_checkout"
  | "passeio_inicio" | "passeio_fim"
  | "transfer" | "trem_parte"
  | "seguro_inicio" | "seguro_fim"
  | "outro";

export const ROTULO_EVENTO: Record<EventoAcao, string> = {
  checkin_online: "Check-in online abre",
  voo_parte: "Voo parte",
  hotel_checkin: "Check-in no hotel",
  hotel_checkout: "Check-out do hotel",
  passeio_inicio: "Passeio começa",
  passeio_fim: "Passeio termina",
  transfer: "Transfer (busca)",
  trem_parte: "Trem parte",
  seguro_inicio: "Seguro começa",
  seguro_fim: "Seguro termina",
  outro: "Serviço",
};

export interface Acao {
  chave: string;
  viagem_id: string;
  trecho_id: string | null;
  categoria: CategoriaAcao;
  evento: EventoAcao;
  /** instante da ação (ISO) */
  quando: string;
  /** fuso do lugar (+09:00) — a tela mostra a hora local */
  fuso: string | null;
  /** sem horário conhecido (só o dia) */
  semHora: boolean;
  /** veio das datas da venda (não há trecho cadastrado) */
  daVenda: boolean;
  /** check-in online estimado (48h antes) */
  estimado?: boolean;
  feito?: boolean;
  titulo: string;
  detalhe: string;
}

const CAT_DO_TRECHO: Record<string, CategoriaAcao> = {
  voo_internacional: "aereo", voo_interno: "aereo", hospedagem: "hotel", passeio: "passeio", transfer: "transfer", trem: "trem", outro: "outro",
};

const ponta = (codigo?: string | null, nome?: string | null) => (codigo || "").trim().toUpperCase() || (nome || "").trim();
const rota = (t: TrechoAgenda) => [ponta(t.origem_codigo, t.origem), ponta(t.destino_codigo, t.destino)].filter(Boolean).join(" → ");

/** As ações de UM trecho. Voo que não vale (data do Bitrix de venda sem aéreo) não gera nada. */
export function acoesDoTrecho(t: TrechoAgenda, v?: ViagemAgenda | null, agora = Date.now()): Acao[] {
  const cat = CAT_DO_TRECHO[t.tipo] ?? "outro";
  if (t.status_manual === "cancelado" || !t.partida_em) return [];
  const base = { viagem_id: t.viagem_id, trecho_id: t.id, categoria: cat, daVenda: false };
  const sh = semHora(t);
  const out: Acao[] = [];
  if (cat === "aereo") {
    if (!ehVooQueVale(t, v)) return [];
    const voo = [t.companhia, t.numero].filter(Boolean).join(" ") || "Voo";
    const detalhe = [rota(t), t.localizador ? `loc. ${t.localizador}` : ""].filter(Boolean).join(" · ");
    out.push({ ...base, chave: `${t.id}|voo`, evento: "voo_parte", quando: t.partida_em, fuso: t.partida_fuso ?? null, semHora: sh, titulo: voo, detalhe });
    if (!semBilhete(t) && limiteDoVoo(t) >= agora) {
      const abre = aberturaCheckin({ partida_em: t.partida_em, checkin_abre_em: t.checkin_abre_em ?? null, checkin_em: null });
      out.push({ ...base, chave: `${t.id}|checkin`, evento: "checkin_online", quando: new Date(abre).toISOString(), fuso: null, semHora: false, estimado: !t.checkin_abre_em, feito: !!t.checkin_feito_em, titulo: voo, detalhe });
    }
    return out;
  }
  const nome = (t.descricao || "").trim();
  const lugar = (t.destino || t.origem || "").trim();
  if (cat === "hotel") {
    const titulo = nome || (lugar ? `Hotel em ${lugar}` : "Hotel");
    const detalhe = [nome && lugar ? lugar : "", t.endereco || ""].filter(Boolean).join(" · ");
    out.push({ ...base, chave: `${t.id}|in`, evento: "hotel_checkin", quando: t.partida_em, fuso: t.partida_fuso ?? null, semHora: sh, titulo, detalhe });
    if (t.chegada_em) out.push({ ...base, chave: `${t.id}|out`, evento: "hotel_checkout", quando: t.chegada_em, fuso: t.chegada_fuso ?? t.partida_fuso ?? null, semHora: semHora({ fonte: t.fonte, partida_em: t.chegada_em }), titulo, detalhe });
    return out;
  }
  if (cat === "passeio") {
    const titulo = nome || (lugar ? `Passeio em ${lugar}` : "Passeio");
    const detalhe = [t.ponto_encontro ? `encontro: ${t.ponto_encontro}` : "", lugar && nome ? lugar : ""].filter(Boolean).join(" · ");
    out.push({ ...base, chave: `${t.id}|ini`, evento: "passeio_inicio", quando: t.partida_em, fuso: t.partida_fuso ?? null, semHora: sh, titulo, detalhe });
    if (t.chegada_em && new Date(t.chegada_em).getTime() > new Date(t.partida_em).getTime())
      out.push({ ...base, chave: `${t.id}|fim`, evento: "passeio_fim", quando: t.chegada_em, fuso: t.chegada_fuso ?? t.partida_fuso ?? null, semHora: false, titulo, detalhe });
    return out;
  }
  const evento: EventoAcao = cat === "transfer" ? "transfer" : cat === "trem" ? "trem_parte" : "outro";
  const titulo = cat === "trem" ? ([t.companhia, t.numero].filter(Boolean).join(" ") || nome || "Trem") : nome || ROTULO_EVENTO[evento];
  const detalhe = [rota(t), t.ponto_encontro ? `encontro: ${t.ponto_encontro}` : ""].filter(Boolean).join(" · ");
  out.push({ ...base, chave: `${t.id}|${evento}`, evento, quando: t.partida_em, fuso: t.partida_fuso ?? null, semHora: sh, titulo, detalhe });
  return out;
}

/** Meio-dia em São Paulo do dia (data da venda, sem horário). */
const meioDia = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00-03:00`).toISOString();

/**
 * Venda de hotel / passeio / seguro SEM trecho daquele tipo: as datas da venda
 * viram ações "sem horário — data da venda" (senão o hotel some da agenda).
 */
export function acoesDaVenda(v: ViagemAgenda, trechosDaViagem: TrechoAgenda[]): Acao[] {
  if (!v.data_embarque) return [];
  const tem = (cat: CategoriaAcao) => trechosDaViagem.some((t) => (CAT_DO_TRECHO[t.tipo] ?? "outro") === cat && t.status_manual !== "cancelado");
  const base = { viagem_id: v.id, trecho_id: null, fuso: null, semHora: true, daVenda: true, titulo: v.titulo, detalhe: "data da venda (sem horário) — suba o voucher pra ter a hora" };
  const fim = v.data_retorno && v.data_retorno !== v.data_embarque ? v.data_retorno : null;
  if (v.servico === "hospedagem" && !tem("hotel")) {
    return [
      { ...base, chave: `${v.id}|venda|in`, categoria: "hotel", evento: "hotel_checkin", quando: meioDia(v.data_embarque) },
      ...(fim ? [{ ...base, chave: `${v.id}|venda|out`, categoria: "hotel" as const, evento: "hotel_checkout" as const, quando: meioDia(fim) }] : []),
    ];
  }
  if (v.servico === "passeio" && !tem("passeio")) {
    return [{ ...base, chave: `${v.id}|venda|ini`, categoria: "passeio", evento: "passeio_inicio", quando: meioDia(v.data_embarque) }];
  }
  if (v.servico === "seguro") {
    return [
      { ...base, chave: `${v.id}|venda|seg`, categoria: "seguro", evento: "seguro_inicio", quando: meioDia(v.data_embarque), detalhe: "início da cobertura (data da venda)" },
      ...(fim ? [{ ...base, chave: `${v.id}|venda|segfim`, categoria: "seguro" as const, evento: "seguro_fim" as const, quando: meioDia(fim), detalhe: "fim da cobertura (data da venda)" }] : []),
    ];
  }
  return [];
}

export interface FiltroAcoes {
  /** categorias escolhidas (vazio = todas) */
  categorias?: CategoriaAcao[];
  /** período da AÇÃO [de, ate) em ms */
  de?: number | null;
  ate?: number | null;
  /** período do EMBARQUE da viagem [de, ate] (AAAA-MM-DD) */
  embarqueDe?: string | null;
  embarqueAte?: string | null;
}

/** Todas as ações (trechos + datas da venda), filtradas e em ordem de data/hora. */
export function montarAcoes(trechos: TrechoAgenda[], viagens: Map<string, ViagemAgenda>, f: FiltroAcoes = {}, agora = Date.now()): Acao[] {
  const porViagem = new Map<string, TrechoAgenda[]>();
  for (const t of trechos) {
    const l = porViagem.get(t.viagem_id);
    if (l) l.push(t); else porViagem.set(t.viagem_id, [t]);
  }
  const todas: Acao[] = [];
  for (const t of trechos) todas.push(...acoesDoTrecho(t, viagens.get(t.viagem_id), agora));
  for (const v of viagens.values()) todas.push(...acoesDaVenda(v, porViagem.get(v.id) ?? []));
  const cats = f.categorias?.length ? new Set(f.categorias) : null;
  return todas
    .filter((a) => !cats || cats.has(a.categoria))
    .filter((a) => {
      const q = new Date(a.quando).getTime();
      return (f.de == null || q >= f.de) && (f.ate == null || q < f.ate);
    })
    .filter((a) => {
      if (!f.embarqueDe && !f.embarqueAte) return true;
      const e = viagens.get(a.viagem_id)?.data_embarque;
      if (!e) return false;
      return (!f.embarqueDe || e >= f.embarqueDe) && (!f.embarqueAte || e <= f.embarqueAte);
    })
    .sort((a, b) => a.quando.localeCompare(b.quando) || a.chave.localeCompare(b.chave));
}

/** Quantas ações de cada categoria (pros números das abas). */
export function contarPorCategoria(acoes: Acao[]): Record<CategoriaAcao, number> {
  const c = Object.fromEntries(CATEGORIAS_ACAO.map((x) => [x.id, 0])) as Record<CategoriaAcao, number>;
  for (const a of acoes) c[a.categoria]++;
  return c;
}
