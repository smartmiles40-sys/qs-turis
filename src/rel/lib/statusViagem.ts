// src/rel/lib/statusViagem.ts
// -----------------------------------------------------------------------------
// A VERDADE DOS VOOS DE UMA VIAGEM (30/10/2026). Bruno: "ver realmente o que tem
// de VOO; lógica bem visível de quando TEM voo interno e quando NÃO tem; fazer
// todos os CHECK-INs; quando estiver 'em viagem', tem que estar acontecendo de
// verdade" — e o caso do Vinícius (Turquia jun/2027 mostrando "próximo voo
// 21/03/2026", data do card do Pós-Venda de outra viagem).
//
// Funções PURAS (sem banco): a tela da viagem, o quadro de partidas e os testes
// usam a mesma régua. Regras (as mesmas da view rel_viagens_v na 0227):
//
//   • Voo que VALE: dentro da janela [embarque − 10 dias, volta + 60 dias]
//     (fora dela = outra viagem / ano errado → vira inconsistência, nunca
//     "próximo voo"); o ida/volta genérico do Bitrix (só o dia) é ignorado
//     quando a viagem tem o voo de verdade; o mesmo voo repetido (um por
//     passageiro) conta uma vez; trecho CANCELADO à mão não conta.
//   • PRÓXIMO VOO = o 1º voo que vale com partida ≥ agora (voo sem horário,
//     do Bitrix, vale até o fim do dia dele) e não marcado como voado.
//   • IDA/VOLTA REAIS = os voos, quando parecem a ida/volta (1º voo até 2 dias
//     depois do embarque; último voo a partir de 2 dias antes da volta); senão
//     as datas da venda. "Em viagem" = hoje entre a ida e a volta reais.
//   • Papel de cada voo: os voos se juntam em BLOCOS (menos de 24h entre a
//     chegada de um e a partida do outro). 1º bloco = ida internacional,
//     último = volta, os do meio = VOO INTERNO. Perna Brasil→Brasil dentro da
//     ida/volta = voo nacional de conexão (não é interno).
//   • CHECK-IN a fazer = voo futuro, não feito, com a janela aberta (abre 48h
//     antes, ou no horário que a cia informou). Voo que já decolou não pede
//     check-in.
//   • 0359 (Bruno 11/11: "só apareça o que realmente for aéreo"): a data de
//     ida/volta do Bitrix só é voo quando a VENDA TEM AÉREO (serviço aéreo, ou
//     pacote/expedição sem "Passagem Aérea: Não inclusa"). Em venda de hotel,
//     seguro, passeio… essa data é do check-in/cobertura — não vira voo.
//     Voo de verdade (Expedições / IA / à mão) vale sempre.
//   • Correção manual (0227) manda: trecho voado/cancelado à mão e status da
//     viagem forçado com motivo.
// -----------------------------------------------------------------------------

export const JANELA_CHECKIN_HORAS = 48;
export const DIAS_ANTES_EMBARQUE = 10;
export const DIAS_DEPOIS_RETORNO = 60;
/** Tolerância pra dizer que o 1º/último voo "é" a ida/volta da venda. */
export const TOLERANCIA_IDA_VOLTA_DIAS = 2;
/** Intervalo máximo entre dois voos do mesmo deslocamento (conexão). */
export const CONEXAO_MAX_HORAS = 24;
const H = 3600_000;

export type FaseReal = "antes" | "em_viagem" | "concluida" | "cancelada" | "sem_data";
export type SituacaoManualTrecho = "voado" | "cancelado";
export type EstadoTrecho = "cancelado" | "voado" | "checkin_feito" | "checkin_a_fazer" | "a_voar";
export type PapelVoo = "ida" | "volta" | "interno" | "nacional_ida" | "nacional_volta";

export const ROTULO_ESTADO: Record<EstadoTrecho, string> = {
  a_voar: "A voar",
  checkin_a_fazer: "Check-in a fazer",
  checkin_feito: "Check-in feito",
  voado: "Voado",
  cancelado: "Cancelado",
};
export const ROTULO_PAPEL: Record<PapelVoo, string> = {
  ida: "Ida internacional",
  volta: "Volta internacional",
  interno: "Voo interno",
  nacional_ida: "Nacional (conexão da ida)",
  nacional_volta: "Nacional (conexão da volta)",
};

export interface TrechoVoo {
  id: string;
  tipo: string;
  partida_em: string;
  chegada_em?: string | null;
  partida_fuso?: string | null;
  origem?: string | null;
  destino?: string | null;
  origem_codigo?: string | null;
  destino_codigo?: string | null;
  numero?: string | null;
  companhia?: string | null;
  localizador?: string | null;
  fonte?: string | null;
  checkin_abre_em?: string | null;
  checkin_em?: string | null;
  checkin_feito_em?: string | null;
  /** 0227: voado/cancelado marcado à mão. */
  status_manual?: SituacaoManualTrecho | null;
  status_manual_motivo?: string | null;
  corrigido_em?: string | null;
}

export interface ViagemDatas {
  data_embarque: string | null;
  data_retorno: string | null;
  status?: string | null;
  titulo?: string | null;
  expedicao?: string | null;
  servico?: string | null;
  /** 0359: a venda tem aéreo (view rel_viagens_v). Sem a migration: decide pelo serviço. */
  aereo_vendido?: boolean | null;
  /** 0227: status forçado pelo supervisor. */
  fase_manual?: FaseReal | null;
  fase_manual_motivo?: string | null;
  fase_manual_ate?: string | null;
  alertas_ignorados?: Record<string, { motivo?: string | null; por?: string | null; em?: string | null }> | null;
}

// ── datas ───────────────────────────────────────────────────────────────────

const FMT_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const FMT_HM = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
/** Dia (AAAA-MM-DD) em São Paulo. */
export const diaSP = (iso: string | number | Date): string => FMT_SP.format(new Date(iso));
const diaAbs = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000); };
/** Dias de `de` até `ate` (AAAA-MM-DD). */
export const diasEntre = (de: string, ate: string) => diaAbs(ate) - diaAbs(de);
const somaDias = (d: string, n: number) => new Date((diaAbs(d) + n) * 86_400_000).toISOString().slice(0, 10);

export const ehVoo = (t: { tipo: string }) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";

/** Serviços que nunca têm aéreo nosso (mesma lista do rel_venda_tem_aereo, 0359). */
const SERVICOS_SEM_AEREO = new Set(["hospedagem", "passeio", "seguro", "concierge", "conta_liminar", "outro"]);

/**
 * A venda tem aéreo? Vale o que a view calculou (aereo_vendido, 0359 — olha
 * também a "Passagem Aérea" do card do Bitrix); sem a migration, pelo serviço:
 * aéreo/pacote/expedição = sim; hotel, seguro, passeio… = não; sem classificação
 * (null) = não; serviço nem informado (undefined) = sim, como antes da 0359.
 */
export function vendaTemAereo(v: Pick<ViagemDatas, "servico" | "aereo_vendido">): boolean {
  if (typeof v.aereo_vendido === "boolean") return v.aereo_vendido;
  // nada informado (quem chama não tem a venda): o comportamento de antes — conta
  if (v.servico === undefined) return true;
  if (v.servico === "aereo" || v.servico === "pacote" || v.servico === "expedicao") return true;
  if (v.servico && SERVICOS_SEM_AEREO.has(v.servico)) return false;
  return false;
}

/** Voo do Bitrix (só o dia) ou gravado à meia-noite: o horário não é conhecido. */
export function semHora(t: Pick<TrechoVoo, "fonte" | "partida_em">): boolean {
  return t.fonte === "bitrix" || FMT_HM.format(new Date(t.partida_em)) === "00:00";
}

/** Até quando o voo "ainda não decolou": a partida; sem horário, o fim do dia dele. */
export function limiteDoVoo(t: Pick<TrechoVoo, "fonte" | "partida_em">): number {
  const p = new Date(t.partida_em).getTime();
  return semHora(t) ? p + 24 * H - 1 : p;
}

// ── aeroportos do Brasil (pra separar o voo nacional de conexão) ───────────
const AEROPORTOS_BR = new Set(("GRU CGH VCP GIG SDU BSB CNF PLU SSA REC FOR NAT POA CWB FLN BEL MAO MCZ JPA AJU THE SLZ VIX GYN CGB CGR IGU NVT JOI LDB " +
  "MGF RAO UDI PMW BPS PVH RBR MCP BVB IOS FEN JDO JJD CXJ XAP PFB IMP STM CPV MOC VDC").split(" "));
const CIDADES_BR = /s[aã]o paulo|guarulhos|campinas|viracopos|rio de janeiro|bras[ií]lia|belo horizonte|confins|salvador|recife|fortaleza|natal|porto alegre|curitiba|florian[oó]polis|bel[eé]m|manaus|macei[oó]|jo[aã]o pessoa|aracaju|teresina|s[aã]o lu[ií]s|vit[oó]ria|goi[aâ]nia|cuiab[aá]|campo grande|foz do igua[cç]u|navegantes|joinville|londrina|maring[aá]|ribeir[aã]o preto|uberl[aâ]ndia|palmas|porto seguro|porto velho|rio branco|macap[aá]|boa vista|ilh[eé]us|noronha/i;

/** "GRU" de "São Paulo (GRU)"; sem código, null. */
export function codigoDe(codigo?: string | null, nome?: string | null): string | null {
  const c = (codigo || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  const m = /\(([A-Za-z]{3})\)/.exec(nome || "");
  return m ? m[1].toUpperCase() : null;
}
export function noBrasil(codigo?: string | null, nome?: string | null): boolean | null {
  const c = codigoDe(codigo, nome);
  if (c) return AEROPORTOS_BR.has(c);
  if (!nome?.trim()) return null;
  return CIDADES_BR.test(nome) || /\bbrasil\b/i.test(nome);
}

// ── quais voos valem ────────────────────────────────────────────────────────

export interface VoosDaViagem<T extends TrechoVoo> {
  /** Os que contam, sem repetidos, em ordem de partida. */
  validos: T[];
  /** Fora da janela da viagem (outra viagem / ano errado). */
  fora: T[];
  /** Ida/volta genérico do Bitrix ignorado porque já há o voo de verdade. */
  genericos: T[];
  /** O mesmo voo repetido (um por passageiro) — só o 1º entra em `validos`. */
  repetidos: T[];
  cancelados: T[];
  /** 0359: data do Bitrix numa venda SEM aéreo (hotel, seguro, "Não inclusa"…) — não é voo. */
  semAereo: T[];
}

export function janelaDaViagem(v: Pick<ViagemDatas, "data_embarque" | "data_retorno">): { de: string; ate: string } | null {
  if (!v.data_embarque) return null;
  const volta = v.data_retorno && v.data_retorno > v.data_embarque ? v.data_retorno : v.data_embarque;
  return { de: somaDias(v.data_embarque, -DIAS_ANTES_EMBARQUE), ate: somaDias(volta, DIAS_DEPOIS_RETORNO) };
}

const chaveVoo = (t: TrechoVoo) => `${new Date(t.partida_em).getTime()}|${(t.numero || "").replace(/\s+/g, "").toUpperCase() || `${t.origem ?? ""}>${t.destino ?? ""}`}`;

export function separarVoos<T extends TrechoVoo>(v: Pick<ViagemDatas, "data_embarque" | "data_retorno" | "servico" | "aereo_vendido">, trechos: T[]): VoosDaViagem<T> {
  const todosVoos = trechos.filter(ehVoo).filter((t) => t.partida_em).sort((a, b) => a.partida_em.localeCompare(b.partida_em) || a.id.localeCompare(b.id));
  // 0359: venda sem aéreo → a data do Bitrix não é voo (é a do hotel/cobertura)
  const comAereo = vendaTemAereo(v);
  const semAereo = comAereo ? [] : todosVoos.filter((t) => t.fonte === "bitrix" && t.status_manual !== "cancelado");
  const voos = comAereo ? todosVoos : todosVoos.filter((t) => !semAereo.includes(t));
  const jan = janelaDaViagem(v);
  const dentro = (t: T) => !jan || (diaSP(t.partida_em) >= jan.de && diaSP(t.partida_em) <= jan.ate);
  const cancelados = voos.filter((t) => t.status_manual === "cancelado");
  const vivos = voos.filter((t) => t.status_manual !== "cancelado");
  const fora = vivos.filter((t) => !dentro(t));
  const naJanela = vivos.filter(dentro);
  const temReal = naJanela.some((t) => t.fonte !== "bitrix");
  const genericos = temReal ? naJanela.filter((t) => t.fonte === "bitrix") : [];
  const vistos = new Set<string>();
  const validos: T[] = [], repetidos: T[] = [];
  for (const t of naJanela) {
    if (temReal && t.fonte === "bitrix") continue;
    const k = chaveVoo(t);
    if (vistos.has(k)) { repetidos.push(t); continue; }
    vistos.add(k); validos.push(t);
  }
  // sem data de embarque: só confia nos voos se cabem numa viagem (≤ 60 dias)
  if (!jan && validos.length > 1 && diasEntre(diaSP(validos[0].partida_em), diaSP(validos[validos.length - 1].partida_em)) > DIAS_DEPOIS_RETORNO) {
    return { validos: [], fora: [...fora, ...validos], genericos, repetidos, cancelados, semAereo };
  }
  return { validos, fora, genericos, repetidos, cancelados, semAereo };
}

// ── papel de cada voo (ida / interno / volta) ───────────────────────────────

export function papeisDosVoos<T extends TrechoVoo>(validos: T[], v: Pick<ViagemDatas, "data_embarque" | "data_retorno">): Map<string, PapelVoo> {
  const m = new Map<string, PapelVoo>();
  if (!validos.length) return m;
  const blocos: T[][] = [];
  for (const t of validos) {
    const ult = blocos[blocos.length - 1]?.[blocos[blocos.length - 1].length - 1];
    const fimUlt = ult ? new Date(ult.chegada_em || ult.partida_em).getTime() : null;
    if (fimUlt == null || new Date(t.partida_em).getTime() - fimUlt > CONEXAO_MAX_HORAS * H) blocos.push([t]);
    else blocos[blocos.length - 1].push(t);
  }
  const marcar = (bloco: T[], principal: "ida" | "volta") => {
    for (const t of bloco) {
      const brasil = noBrasil(t.origem_codigo, t.origem) === true && noBrasil(t.destino_codigo, t.destino) === true;
      m.set(t.id, brasil ? (principal === "ida" ? "nacional_ida" : "nacional_volta") : principal);
    }
  };
  if (blocos.length === 1) {
    // um bloco só: é a volta se sai perto da data de volta; senão, a ida
    const sai = diaSP(blocos[0][0].partida_em);
    const ehVolta = !!v.data_retorno && v.data_retorno !== v.data_embarque && diasEntre(sai, v.data_retorno) <= TOLERANCIA_IDA_VOLTA_DIAS;
    marcar(blocos[0], ehVolta ? "volta" : "ida");
    return m;
  }
  marcar(blocos[0], "ida");
  marcar(blocos[blocos.length - 1], "volta");
  for (const b of blocos.slice(1, -1)) for (const t of b) m.set(t.id, "interno");
  return m;
}

// ── estado de cada trecho ───────────────────────────────────────────────────

export function aberturaCheckin(t: Pick<TrechoVoo, "partida_em" | "checkin_abre_em" | "checkin_em">): number {
  const abre = t.checkin_abre_em || t.checkin_em;
  return abre ? new Date(abre).getTime() : new Date(t.partida_em).getTime() - JANELA_CHECKIN_HORAS * H;
}

export function estadoTrecho(t: TrechoVoo, agora: number): EstadoTrecho {
  if (t.status_manual === "cancelado") return "cancelado";
  if (t.status_manual === "voado") return "voado";
  if (limiteDoVoo(t) < agora) return "voado";
  if (t.checkin_feito_em) return "checkin_feito";
  if (ehVoo(t) && aberturaCheckin(t) <= agora) return "checkin_a_fazer";
  return "a_voar";
}

// ── ida/volta reais e a fase ────────────────────────────────────────────────

export function idaVoltaReais<T extends TrechoVoo>(v: Pick<ViagemDatas, "data_embarque" | "data_retorno">, validos: T[]): { ida: string | null; volta: string | null } {
  const emb = v.data_embarque, ret = v.data_retorno || v.data_embarque;
  if (!validos.length) return { ida: emb, volta: ret };
  const primeiro = diaSP(validos[0].partida_em);
  const ult = validos.reduce((mx, t) => Math.max(mx, new Date(t.chegada_em || t.partida_em).getTime()), 0);
  const ultimo = diaSP(ult);
  const ida = !emb || diasEntre(emb, primeiro) <= TOLERANCIA_IDA_VOLTA_DIAS ? primeiro : emb;
  const volta = !ret || diasEntre(ultimo, ret) <= TOLERANCIA_IDA_VOLTA_DIAS ? ultimo : ret;
  return { ida, volta: volta < (ida ?? volta) ? ida : volta };
}

export function faseAutomatica(status: string | null | undefined, ida: string | null, volta: string | null, hoje: string): FaseReal {
  if (status === "cancelada") return "cancelada";
  if (!ida) return "sem_data";
  if (hoje < ida) return "antes";
  if (hoje <= (volta || ida)) return "em_viagem";
  return "concluida";
}

/** A fase forçada pelo supervisor vale até `fase_manual_ate` (vazio = até alguém desfazer). */
export function faseManualValendo(v: Pick<ViagemDatas, "fase_manual" | "fase_manual_ate" | "status">, hoje: string): FaseReal | null {
  if (!v.fase_manual || v.status === "cancelada") return null;
  if (v.fase_manual_ate && hoje > v.fase_manual_ate) return null;
  return v.fase_manual;
}

// ── inconsistências (o que o supervisor tem que olhar) ─────────────────────

export type NivelInconsistencia = "alta" | "media" | "info";
export interface Inconsistencia {
  /** Chave estável — é ela que o "ignorar alerta" grava. */
  chave: string;
  nivel: NivelInconsistencia;
  titulo: string;
  detalhe: string;
  trechos: string[];
  ignorada?: { motivo?: string | null; por?: string | null; em?: string | null } | null;
}

const BR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const nomeVoo = (t: TrechoVoo) => {
  const o = codigoDe(t.origem_codigo, t.origem) || t.origem || "?";
  const d = codigoDe(t.destino_codigo, t.destino) || t.destino || "?";
  return `${t.numero ? `${t.numero} ` : ""}${o}→${d}`;
};

export interface ResumoVoos<T extends TrechoVoo> {
  voos: { t: T; papel: PapelVoo | null; estado: EstadoTrecho; valido: boolean; motivoFora?: string }[];
  proximo: T | null;
  internos: number;
  nacionais: number;
  temInterno: boolean;
  checkinsAFazer: number;
  ida: string | null;
  volta: string | null;
  faseAuto: FaseReal;
  fase: FaseReal;
  faseManual: boolean;
  inconsistencias: Inconsistencia[];
}

export function resumirVoos<T extends TrechoVoo>(v: ViagemDatas, trechos: T[], agora: number = Date.now()): ResumoVoos<T> {
  const hoje = diaSP(agora);
  const sep = separarVoos(v, trechos);
  const papeis = papeisDosVoos(sep.validos, v);
  const { ida, volta } = idaVoltaReais(v, sep.validos);
  const faseAuto = faseAutomatica(v.status, ida, volta, hoje);
  const manual = faseManualValendo(v, hoje);
  const fase = manual ?? faseAuto;

  const validosIds = new Set(sep.validos.map((t) => t.id));
  const motivoFora = new Map<string, string>();
  for (const t of sep.fora) motivoFora.set(t.id, "fora das datas da viagem");
  for (const t of sep.genericos) motivoFora.set(t.id, "data genérica do Bitrix (já tem o voo de verdade)");
  for (const t of sep.repetidos) motivoFora.set(t.id, "repetido (mesmo voo de outro passageiro)");
  for (const t of sep.cancelados) motivoFora.set(t.id, "cancelado");
  for (const t of sep.semAereo) motivoFora.set(t.id, "data da venda no Bitrix — a venda não tem aéreo (não é voo)");
  const todos = [...sep.validos, ...sep.fora, ...sep.genericos, ...sep.repetidos, ...sep.cancelados, ...sep.semAereo]
    .sort((a, b) => a.partida_em.localeCompare(b.partida_em) || a.id.localeCompare(b.id));
  const voos = todos.map((t) => ({ t, papel: papeis.get(t.id) ?? null, estado: estadoTrecho(t, agora), valido: validosIds.has(t.id), motivoFora: motivoFora.get(t.id) }));

  const proximo = sep.validos.find((t) => estadoTrecho(t, agora) !== "voado") ?? null;
  const internos = [...papeis.values()].filter((p) => p === "interno").length;
  const nacionais = [...papeis.values()].filter((p) => p === "nacional_ida" || p === "nacional_volta").length;
  const checkinsAFazer = voos.filter((x) => x.valido && x.estado === "checkin_a_fazer").length;

  const inc: Inconsistencia[] = [];
  const add = (i: Omit<Inconsistencia, "ignorada">) => inc.push({ ...i, ignorada: v.alertas_ignorados?.[i.chave] ?? null });
  const ativa = !v.status || v.status === "ativa";

  if (v.data_embarque && v.data_retorno && v.data_retorno < v.data_embarque)
    add({ chave: "volta_antes_ida", nivel: "alta", titulo: "Volta antes da ida", detalhe: `A venda diz ida ${BR(v.data_embarque)} e volta ${BR(v.data_retorno)}.`, trechos: [] });
  if (v.data_embarque && v.data_retorno && diasEntre(v.data_embarque, v.data_retorno) > DIAS_DEPOIS_RETORNO)
    add({ chave: "duracao_longa", nivel: "media", titulo: `Viagem de ${diasEntre(v.data_embarque, v.data_retorno)} dias`, detalhe: `Ida ${BR(v.data_embarque)} × volta ${BR(v.data_retorno)} — confira se a data de ida/volta não está errada.`, trechos: [] });
  for (const t of sep.fora) {
    const d = diaSP(t.partida_em);
    const anoErrado = !!v.data_embarque && d.slice(0, 4) !== v.data_embarque.slice(0, 4);
    add({
      chave: `voo_fora:${t.id}`, nivel: "alta",
      titulo: anoErrado ? `Voo com ano errado ou de outra viagem: ${BR(d)}` : `Voo fora das datas da viagem: ${BR(d)}`,
      detalhe: `${nomeVoo(t)}${t.fonte === "bitrix" ? " (data do card do Pós-Venda no Bitrix)" : ""} — a viagem é ${v.data_embarque ? BR(v.data_embarque) : "sem data"}${v.data_retorno ? ` a ${BR(v.data_retorno)}` : ""}. Corrija a data ou marque como cancelado.`,
      trechos: [t.id],
    });
  }
  const ano = /\b(20[2-3]\d)\b/.exec(v.expedicao || v.titulo || "")?.[1];
  if (ano && v.data_embarque && ano !== v.data_embarque.slice(0, 4) && ano !== (v.data_retorno || v.data_embarque).slice(0, 4))
    add({ chave: "ano_no_nome", nivel: "media", titulo: `O nome diz ${ano}, a data diz ${v.data_embarque.slice(0, 4)}`, detalhe: `"${v.expedicao || v.titulo}" com ida em ${BR(v.data_embarque)}: a turma ou a data está errada.`, trechos: [] });
  if (ativa && fase === "em_viagem" && !sep.validos.length)
    add({ chave: "em_viagem_sem_voo", nivel: "media", titulo: "Em viagem sem nenhum voo cadastrado", detalhe: "Só as datas da venda dizem que está viajando. Cadastre os voos ou force o status.", trechos: [] });
  if (ativa && faseAuto === "em_viagem" && v.data_embarque && ida && ida !== v.data_embarque && diasEntre(v.data_embarque, ida) > 0 && hoje < ida)
    add({ chave: "embarque_antes_voo", nivel: "info", titulo: "A venda diz que já embarcou, o 1º voo ainda não saiu", detalhe: `Embarque ${BR(v.data_embarque)} × 1º voo ${BR(ida)}.`, trechos: [] });
  if (ativa && v.data_embarque && !v.data_retorno)
    add({ chave: "sem_volta", nivel: "info", titulo: "Sem data de volta", detalhe: "Sem a volta, o \"em viagem\" depende só dos voos.", trechos: [] });
  if (ativa && !sep.validos.length && (v.servico === "pacote" || v.servico === "aereo") && vendaTemAereo(v) && v.data_embarque && diasEntre(hoje, v.data_embarque) <= 30 && diasEntre(hoje, v.data_retorno || v.data_embarque) >= 0)
    add({ chave: "sem_voos", nivel: "alta", titulo: "Viagem próxima sem voos", detalhe: "Pacote/aéreo a 30 dias ou menos (ou em andamento) sem nenhum voo cadastrado.", trechos: [] });
  if (sep.validos.length && sep.validos.every((t) => t.fonte === "bitrix"))
    add({ chave: "so_bitrix", nivel: "info", titulo: "Só as datas do Bitrix (sem horário, sem nº do voo)", detalhe: "Suba o bilhete ou cadastre os voos pra ter horário e check-in certo.", trechos: sep.validos.map((t) => t.id) });
  for (const t of sep.validos) {
    const p = papeis.get(t.id);
    if (p === "interno" && t.tipo === "voo_internacional")
      add({ chave: `tipo_interno:${t.id}`, nivel: "info", titulo: `Voo interno marcado como internacional: ${nomeVoo(t)}`, detalhe: `Sai em ${BR(diaSP(t.partida_em))}, no meio da viagem (nem a ida nem a volta).`, trechos: [t.id] });
    if ((p === "ida" || p === "volta") && t.tipo === "voo_interno")
      add({ chave: `tipo_idavolta:${t.id}`, nivel: "info", titulo: `Voo da ${p} marcado como interno: ${nomeVoo(t)}`, detalhe: `Faz parte da ${p === "ida" ? "ida" : "volta"} (conexão em menos de ${CONEXAO_MAX_HORAS}h).`, trechos: [t.id] });
  }
  return { voos, proximo, internos, nacionais, temInterno: internos > 0, checkinsAFazer, ida, volta, faseAuto, fase, faseManual: !!manual, inconsistencias: inc };
}

/** "Tem voo interno: sim (2 trechos)" / "não". */
export function textoVooInterno(r: Pick<ResumoVoos<TrechoVoo>, "internos" | "voos">): string {
  if (!r.voos.some((x) => x.valido)) return "sem voos cadastrados";
  return r.internos > 0 ? `sim (${r.internos} trecho${r.internos > 1 ? "s" : ""})` : "não";
}
