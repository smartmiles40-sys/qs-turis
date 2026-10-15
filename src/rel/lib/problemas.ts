// src/rel/lib/problemas.ts
// -----------------------------------------------------------------------------
// O CONFERENTE DE VIAGENS (15/10/2026). Bruno: "mirar todas as informações que
// podem dar problema — bilhetes de passeios, horários de voos, hospedagens…
// tudo 100% visual, NADA PODE DAR ERRADO".
//
// Uma função pura (analisarViagem) olha a viagem inteira — trechos, passageiros,
// documentos e o que a IA achou — e devolve a lista de riscos, cada um com
// gravidade, categoria e os trechos envolvidos (pra tela marcar no lugar certo).
// O mesmo conferente roda no card da viagem e na central do painel, então o
// que aparece num aparece no outro.
//
// Todas as contas de horário usam o INSTANTE (partida_em/chegada_em com fuso);
// "dia" e "noite" usam a data LOCAL do lugar (fuso do trecho; sem fuso, Brasília).
// Trecho que veio do Pós-Venda do Bitrix só tem o dia — fica fora das contas de
// hora e vira um alerta próprio ("horário a confirmar").
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { grupoTipo, hojeSP, trechosDasViagens, type TipoTrecho, type Trecho, type Viagem } from "./viagens";

export type Nivel = "alta" | "media" | "info";
export type Categoria = "voo" | "conexao" | "hotel" | "transfer" | "passeio" | "documento" | "geral";

export interface Problema {
  nivel: Nivel;
  categoria: Categoria;
  titulo: string;
  detalhe?: string;
  /** trechos envolvidos — a linha do tempo marca cada um */
  trechos: string[];
  /** dia local (AAAA-MM-DD) em que o problema "mora" na linha do tempo */
  dia?: string | null;
}

export const NIVEL: Record<Nivel, { rotulo: string; cor: string; fundo: string }> = {
  alta: { rotulo: "Urgente", cor: "#B91C1C", fundo: "rgba(220,38,38,.10)" },
  media: { rotulo: "Conferir", cor: "#B45309", fundo: "rgba(217,119,6,.12)" },
  info: { rotulo: "Atenção", cor: "#1D4ED8", fundo: "rgba(37,99,235,.08)" },
};

export const CATEGORIA: Record<Categoria, string> = {
  voo: "Voos", conexao: "Conexões", hotel: "Hospedagem", transfer: "Transfers", passeio: "Passeios", documento: "Documentos", geral: "Geral",
};

export interface PassageiroConf { nome: string; passaporte: string | null; passaporte_validade: string | null }
export interface DocConf { tipo: string; status: string; cliente_id?: string | null }
export interface EntradaConferente {
  viagem: Pick<Viagem, "id" | "tipo" | "titulo" | "destino" | "data_embarque" | "data_retorno" | "status"> & { data_venda?: string | null };
  trechos: Trecho[];
  passageiros: PassageiroConf[];
  documentos: DocConf[];
  divergenciasIa: { gravidade: "alta" | "media" | "baixa"; texto: string }[];
  revisada: boolean;
  /** "agora" injetável pra teste */
  agora?: number;
}

// ── utilidades de tempo ─────────────────────────────────────────────────────

const H = 3600_000;
const ehVoo = (t: Trecho) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";
const soDia = (t: Trecho) => t.fonte === "bitrix";
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Data local AAAA-MM-DD do instante, no fuso dado (+09:00); sem fuso, São Paulo. */
export function diaLocal(iso: string | null | undefined, fuso?: string | null): string | null {
  if (!iso) return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(fuso || ""));
  if (m) {
    const min = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    return new Date(new Date(iso).getTime() + min * 60_000).toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}
/** Hora local HH:MM. */
export function horaLocal(iso: string | null | undefined, fuso?: string | null): string {
  if (!iso) return "";
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(fuso || ""));
  if (m) {
    const min = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    return new Date(new Date(iso).getTime() + min * 60_000).toISOString().slice(11, 16);
  }
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
export const diaBR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400_000);
const duracao = (min: number) => { const h = Math.floor(Math.abs(min) / 60), m = Math.round(Math.abs(min) % 60); return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m} min`; };

/** Fim do trecho: chegada; sem chegada, uma estimativa curta (só pra achar conflito). */
function fimDe(t: Trecho): number {
  const c = ms(t.chegada_em);
  if (!Number.isNaN(c)) return c;
  const p = ms(t.partida_em);
  return p + (t.tipo === "transfer" ? 1 : t.tipo === "passeio" ? 3 : ehVoo(t) ? 2 : 1) * H;
}
const nome = (t: Trecho) => {
  const de = t.origem_codigo || t.origem, para = t.destino_codigo || t.destino;
  if (t.tipo === "hospedagem") return t.descricao || t.destino || "hotel";
  const rota = [de, para].filter(Boolean).join(" → ");
  const num = [t.companhia, t.numero].filter(Boolean).join(" ");
  return [rota || t.descricao || "", num && `(${num})`].filter(Boolean).join(" ") || "trecho";
};
const aeroporto = (s: string | null | undefined) => {
  const m = String(s || "").match(/\b([A-Z]{3})\b/);
  return m ? m[1] : null;
};
const ROTULO_TIPO: Record<TipoTrecho, string> = { voo_internacional: "Voo", voo_interno: "Voo interno", trem: "Trem", transfer: "Transfer", hospedagem: "Hotel", passeio: "Passeio", outro: "Trecho" };

// ── o conferente ────────────────────────────────────────────────────────────

export function analisarViagem(e: EntradaConferente): Problema[] {
  const P: Problema[] = [];
  const add = (nivel: Nivel, categoria: Categoria, titulo: string, detalhe?: string, trechos: string[] = [], dia?: string | null) =>
    P.push({ nivel, categoria, titulo, detalhe, trechos, dia: dia ?? null });

  const { viagem: v } = e;
  if (v.status === "cancelada") return [];
  const agora = e.agora ?? Date.now();
  const hoje = hojeSP();
  const ordenados = [...e.trechos].sort((a, b) => ms(a.partida_em) - ms(b.partida_em));
  const comHora = ordenados.filter((t) => !soDia(t));
  const voos = comHora.filter(ehVoo);
  const hoteis = comHora.filter((t) => t.tipo === "hospedagem");
  const transfers = comHora.filter((t) => t.tipo === "transfer");
  const passeios = comHora.filter((t) => t.tipo === "passeio");
  const internacional = v.tipo === "expedicao" || e.trechos.some((t) => t.tipo === "voo_internacional");
  const diasPraEmbarque = v.data_embarque ? diasEntre(hoje, v.data_embarque) : null;
  const jaVoltou = v.data_retorno ? v.data_retorno < hoje : false;
  if (jaVoltou) return [];
  const pacote = grupoTipo(v.tipo) === "pacote";

  // ── Geral ──
  if (diasPraEmbarque !== null && diasPraEmbarque >= 0 && !e.revisada) {
    if (diasPraEmbarque <= 7) add("alta", "geral", `Embarca ${diasPraEmbarque === 0 ? "HOJE" : diasPraEmbarque === 1 ? "amanhã" : `em ${diasPraEmbarque} dias`} e a viagem não foi revisada`, "Confira tudo e marque como revisada.");
    else if (diasPraEmbarque <= 15) add("media", "geral", `Embarca em ${diasPraEmbarque} dias e ainda não foi revisada`);
  }
  if (!e.trechos.length && diasPraEmbarque !== null && diasPraEmbarque <= 45) {
    add(diasPraEmbarque <= 15 ? "alta" : "media", "geral", "Nenhum voo, transfer ou hotel cadastrado", "Anexe bilhetes e vouchers e rode a revisão da IA.");
  }
  if (!v.data_embarque) {
    const recente = v.data_venda ? diasEntre(v.data_venda, hoje) <= 180 : false;
    add(recente ? "media" : "info", "geral", "Viagem sem data de ida", "Sem data, os prazos e alertas não funcionam.");
  }

  // ── Voos: dados e datas ──
  for (const t of ordenados.filter(ehVoo)) {
    if (soDia(t)) {
      // já tem o bilhete desse dia (IA/Expedições com hora)? então a data do Pós-Venda é só redundante
      const dSo = diaLocal(t.partida_em)!;
      if (voos.some((x) => Math.abs(diasEntre(dSo, diaLocal(x.partida_em, x.partida_fuso)!)) <= 1)) continue;
      // expedição: o voo do grupo é cuidado pela Operação — aqui só um lembrete
      add(pacote ? "media" : "info", "voo", `Voo de ${diaBR(diaLocal(t.partida_em))} só com a data (Pós-Venda): falta horário e localizador`, "Anexe o bilhete e rode a revisão da IA.", [t.id], diaLocal(t.partida_em));
      continue;
    }
    if (!t.localizador) add("media", "voo", `${ROTULO_TIPO[t.tipo]} ${nome(t)} sem localizador`, undefined, [t.id], diaLocal(t.partida_em, t.partida_fuso));
    if (!t.numero) add("info", "voo", `${ROTULO_TIPO[t.tipo]} ${nome(t)} sem número do voo`, undefined, [t.id], diaLocal(t.partida_em, t.partida_fuso));
    if (!t.chegada_em) add("info", "voo", `${ROTULO_TIPO[t.tipo]} ${nome(t)} sem horário de chegada`, "Sem a chegada não dá pra conferir conexão, transfer e hotel.", [t.id], diaLocal(t.partida_em, t.partida_fuso));
  }
  const todosVoos = ordenados.filter(ehVoo);
  if (v.data_embarque && todosVoos.length) {
    const d1 = diaLocal(todosVoos[0].partida_em, todosVoos[0].partida_fuso)!;
    if (Math.abs(diasEntre(v.data_embarque, d1)) > 1) add("alta", "voo", `Primeiro voo (${diaBR(d1)}) não bate com a ida da venda (${diaBR(v.data_embarque)})`, "Ou a data da viagem está errada, ou o bilhete é de outra data.", [todosVoos[0].id], d1);
  }
  if (v.data_retorno && todosVoos.length > 1) {
    const ult = todosVoos[todosVoos.length - 1];
    const d2 = diaLocal(ult.partida_em, ult.partida_fuso)!;
    if (Math.abs(diasEntre(v.data_retorno, d2)) > 1) add("alta", "voo", `Último voo (${diaBR(d2)}) não bate com a volta da venda (${diaBR(v.data_retorno)})`, undefined, [ult.id], d2);
  }
  if (v.data_embarque && v.data_retorno) {
    for (const t of comHora) {
      const d = diaLocal(t.partida_em, t.partida_fuso)!;
      if (d < somaDias(v.data_embarque, -1) || d > somaDias(v.data_retorno, 1)) {
        add("media", t.tipo === "hospedagem" ? "hotel" : t.tipo === "passeio" ? "passeio" : t.tipo === "transfer" ? "transfer" : "voo",
          `${ROTULO_TIPO[t.tipo]} ${nome(t)} em ${diaBR(d)}, fora das datas da viagem`, `A viagem vai de ${diaBR(v.data_embarque)} a ${diaBR(v.data_retorno)}.`, [t.id], d);
      }
    }
  }

  // ── Check-in ──
  for (const t of voos) {
    const p = ms(t.partida_em);
    if (p < agora || t.checkin_feito_em) continue;
    const abre = ms(t.checkin_em);
    if (!Number.isNaN(abre) && abre <= agora) add(p - agora < 12 * H ? "alta" : "media", "voo", `Check-in aberto e não feito: ${nome(t)}`, `Voo às ${horaLocal(t.partida_em, t.partida_fuso)} de ${diaBR(diaLocal(t.partida_em, t.partida_fuso))}.`, [t.id], diaLocal(t.partida_em, t.partida_fuso));
  }

  // ── Conexões entre voos (e trens) ──
  const deslocamentos = comHora.filter((t) => ehVoo(t) || t.tipo === "trem");
  for (let i = 0; i + 1 < deslocamentos.length; i++) {
    const a = deslocamentos[i], b = deslocamentos[i + 1];
    if (!a.chegada_em) continue;
    const gap = (ms(b.partida_em) - ms(a.chegada_em)) / 60_000;
    if (gap > 24 * 60) continue; // ficou no lugar: não é conexão
    const dia = diaLocal(a.chegada_em, a.chegada_fuso || a.partida_fuso);
    if (gap < 0) { add("alta", "conexao", `IMPOSSÍVEL: ${nome(b)} sai antes de ${nome(a)} chegar`, `Chega ${horaLocal(a.chegada_em, a.chegada_fuso)} e o próximo sai ${horaLocal(b.partida_em, b.partida_fuso)}.`, [a.id, b.id], dia); continue; }
    const chegou = aeroporto(a.destino_codigo || a.destino), sai = aeroporto(b.origem_codigo || b.origem);
    const trocaAeroporto = !!(chegou && sai && chegou !== sai);
    if (trocaAeroporto) add("alta", "conexao", `Troca de aeroporto na conexão: chega em ${chegou} e sai de ${sai}`, `Só ${duracao(gap)} entre os dois. Precisa de transfer entre aeroportos e tempo de sobra.`, [a.id, b.id], dia);
    const intl = a.tipo === "voo_internacional" || b.tipo === "voo_internacional";
    // mesma reserva = a cia garante a conexão; reservas separadas precisam de folga
    const mesmaReserva = !!(a.localizador && a.localizador === b.localizador);
    const minimo = trocaAeroporto ? 240 : b.tipo === "trem" || a.tipo === "trem" ? 45 : intl ? (mesmaReserva ? 75 : 150) : (mesmaReserva ? 40 : 75);
    if (gap < minimo / 2) add("alta", "conexao", `Conexão muito curta: ${duracao(gap)} entre ${nome(a)} e ${nome(b)}`, `O mínimo seguro aqui é ${duracao(minimo)}${intl ? " (imigração e bagagem)" : ""}.`, [a.id, b.id], dia);
    else if (gap < minimo) add("media", "conexao", `Conexão apertada: ${duracao(gap)} entre ${nome(a)} e ${nome(b)}`, `O recomendado é ${duracao(minimo)} ou mais.`, [a.id, b.id], dia);
    if (a.localizador && b.localizador && a.localizador !== b.localizador && ehVoo(a) && ehVoo(b)) {
      add("media", "conexao", `Conexão em reservas separadas (${a.localizador} e ${b.localizador})`, "Se o primeiro atrasar, a cia do segundo não tem obrigação de remarcar. Confira bagagem despachada até o fim.", [a.id, b.id], dia);
    }
    if (gap >= 8 * 60 && gap <= 24 * 60 && !hoteis.some((h) => ms(h.partida_em) <= ms(b.partida_em) && fimDe(h) >= ms(a.chegada_em))) {
      add("info", "conexao", `Espera longa de ${duracao(gap)} em ${chegou || a.destino || "conexão"} sem hotel`, "Confira se o passageiro precisa de hotel/visto de trânsito.", [a.id, b.id], dia);
    }
  }

  // ── Conflitos de horário (qualquer coisa que não seja hotel) ──
  const naoHotel = comHora.filter((t) => t.tipo !== "hospedagem");
  for (let i = 0; i < naoHotel.length; i++) {
    for (let j = i + 1; j < naoHotel.length; j++) {
      const a = naoHotel[i], b = naoHotel[j];
      if (ms(b.partida_em) >= fimDe(a)) break;
      if ((ehVoo(a) || a.tipo === "trem") && (ehVoo(b) || b.tipo === "trem")) continue; // já tratado em conexões
      if ((a.tipo === "transfer" && ehVoo(b)) || (b.tipo === "transfer" && ehVoo(a))) continue; // tratado em transfers (antes do pouso / em cima do voo)
      add("alta", b.tipo === "passeio" || a.tipo === "passeio" ? "passeio" : b.tipo === "transfer" || a.tipo === "transfer" ? "transfer" : "geral",
        `Conflito de horário: ${ROTULO_TIPO[a.tipo]} ${nome(a)} × ${ROTULO_TIPO[b.tipo]} ${nome(b)}`,
        `${horaLocal(a.partida_em, a.partida_fuso)}–${horaLocal(new Date(fimDe(a)).toISOString(), a.chegada_fuso || a.partida_fuso)} bate com ${horaLocal(b.partida_em, b.partida_fuso)}.`,
        [a.id, b.id], diaLocal(b.partida_em, b.partida_fuso));
    }
  }

  // ── Hospedagem ──
  // "estadia" = entre chegar de um deslocamento e sair no próximo, ficando > 12h
  const estadias: { chega: Trecho; sai: Trecho | null }[] = [];
  for (let i = 0; i < deslocamentos.length; i++) {
    const a = deslocamentos[i], b = deslocamentos[i + 1] ?? null;
    if (!a.chegada_em) continue;
    const ficando = b ? ms(b.partida_em) - ms(a.chegada_em) > 12 * H : false;
    if (ficando) estadias.push({ chega: a, sai: b });
  }
  if (hoteis.length) {
    for (const h of hoteis) {
      const ci = diaLocal(h.partida_em, h.partida_fuso)!, co = h.chegada_em ? diaLocal(h.chegada_em, h.chegada_fuso || h.partida_fuso) : null;
      if (!co) add("media", "hotel", `Hotel ${nome(h)} sem data de check-out`, undefined, [h.id], ci);
      // no-show: o passageiro só chega DEPOIS da 1ª noite reservada (vale o último voo que pousa nessa janela)
      const atrasado = voos
        .filter((vv) => vv.chegada_em && co && ms(vv.partida_em) < ms(h.partida_em) + 36 * H && ms(vv.partida_em) > ms(h.partida_em) - 48 * H)
        .map((vv) => ({ vv, d: diaLocal(vv.chegada_em, vv.chegada_fuso || vv.partida_fuso)! }))
        .filter((x) => x.d > ci && x.d < co!)
        .sort((a, b) => ms(b.vv.chegada_em) - ms(a.vv.chegada_em))[0];
      if (atrasado) add("alta", "hotel", `Risco de NO-SHOW: hotel ${nome(h)} começa ${diaBR(ci)}, mas o passageiro só chega ${diaBR(atrasado.d)} (${nome(atrasado.vv)})`, "Hotel costuma cancelar a reserva inteira quando o hóspede não aparece na 1ª noite. Avise o hotel ou ajuste a data.", [h.id, atrasado.vv.id], ci);
      // chegada tarde
      const voo = voos.find((vv) => vv.chegada_em && diaLocal(vv.chegada_em, vv.chegada_fuso || vv.partida_fuso) === ci);
      if (voo) {
        const hh = Number(horaLocal(voo.chegada_em, voo.chegada_fuso || voo.partida_fuso).slice(0, 2));
        if (hh >= 22 || hh < 5) add("info", "hotel", `Chegada tarde (${horaLocal(voo.chegada_em, voo.chegada_fuso || voo.partida_fuso)}) no dia do check-in em ${nome(h)}`, "Avise o hotel do late check-in.", [h.id, voo.id], ci);
      }
    }
    // duas hospedagens na mesma noite
    for (let i = 0; i < hoteis.length; i++) for (let j = i + 1; j < hoteis.length; j++) {
      const a = hoteis[i], b = hoteis[j];
      const aci = diaLocal(a.partida_em, a.partida_fuso)!, aco = a.chegada_em ? diaLocal(a.chegada_em, a.chegada_fuso || a.partida_fuso)! : somaDias(aci, 1);
      const bci = diaLocal(b.partida_em, b.partida_fuso)!;
      if (bci < aco && bci >= aci) add("media", "hotel", `Duas hospedagens na mesma noite (${diaBR(bci)}): ${nome(a)} e ${nome(b)}`, "Se for de propósito, ignore; se não, uma das reservas está paga à toa.", [a.id, b.id], bci);
    }
    // noites sem hotel: de cada estadia
    const cobertas = new Set<string>();
    for (const h of hoteis) {
      const ci = diaLocal(h.partida_em, h.partida_fuso)!, co = h.chegada_em ? diaLocal(h.chegada_em, h.chegada_fuso || h.partida_fuso)! : somaDias(ci, 1);
      for (let d = ci; d < co; d = somaDias(d, 1)) cobertas.add(d);
    }
    for (const s of estadias) {
      const d0 = diaLocal(s.chega.chegada_em, s.chega.chegada_fuso || s.chega.partida_fuso)!;
      const d1 = s.sai ? diaLocal(s.sai.partida_em, s.sai.partida_fuso)! : d0;
      const faltam: string[] = [];
      for (let d = d0; d < d1; d = somaDias(d, 1)) if (!cobertas.has(d)) faltam.push(d);
      // chegou de madrugada e o hotel começa no mesmo dia: a "noite" anterior é a do avião
      if (faltam.length) add("alta", "hotel", `${faltam.length === 1 ? "Noite" : `${faltam.length} noites`} sem hospedagem: ${faltam.map(diaBR).join(", ")}`, `Entre a chegada (${nome(s.chega)}) e a saída${s.sai ? ` (${nome(s.sai)})` : ""}.`, [s.chega.id, ...(s.sai ? [s.sai.id] : [])], faltam[0]);
    }
    // check-out depois de ir embora
    for (const h of hoteis) {
      if (!h.chegada_em) continue;
      const co = diaLocal(h.chegada_em, h.chegada_fuso || h.partida_fuso)!;
      // a partir do último pouso que traz o passageiro pra esta hospedagem
      const pousos = voos.filter((vv) => vv.chegada_em && ms(vv.chegada_em) >= ms(h.partida_em) - 48 * H && ms(vv.chegada_em) < ms(h.chegada_em!) - 24 * H)
        .map((vv) => ms(vv.chegada_em)).filter((x) => x <= ms(h.partida_em) + 36 * H);
      if (!pousos.length) continue;
      const chegouEm = Math.max(...pousos);
      const saiAntes = voos.find((vv) => ms(vv.partida_em) > chegouEm && diaLocal(vv.partida_em, vv.partida_fuso)! < co && ms(vv.partida_em) < ms(h.chegada_em!) - 24 * H);
      if (saiAntes) add("media", "hotel", `Hotel ${nome(h)} até ${diaBR(co)}, mas o voo ${nome(saiAntes)} sai ${diaBR(diaLocal(saiAntes.partida_em, saiAntes.partida_fuso))}`, "Noites pagas depois que o passageiro já foi embora — confira.", [h.id, saiAntes.id], co);
    }
  } else if (pacote && estadias.length && e.trechos.length) {
    add("info", "hotel", "Nenhuma hospedagem cadastrada", "Se o pacote inclui hotel, anexe os vouchers. Se o cliente cuida do hotel, ignore.");
  }

  // ── Transfers ──
  for (const t of transfers) {
    if (!t.ponto_encontro && !t.contato) add("media", "transfer", `Transfer ${nome(t)} sem ponto de encontro nem contato`, "Na hora, o passageiro não vai saber onde ir nem pra quem ligar.", [t.id], diaLocal(t.partida_em, t.partida_fuso));
    const busca = ms(t.partida_em);
    // de chegada: um voo pousa até 6h antes / 1h depois da busca
    const chegada = voos.filter((vv) => vv.chegada_em && Math.abs(busca - ms(vv.chegada_em)) <= 6 * H).sort((a, b) => Math.abs(busca - ms(a.chegada_em)) - Math.abs(busca - ms(b.chegada_em)))[0];
    // de saída: um voo decola até 10h depois da busca
    const saida = voos.filter((vv) => ms(vv.partida_em) > busca && ms(vv.partida_em) - busca <= 10 * H).sort((a, b) => ms(a.partida_em) - ms(b.partida_em))[0];
    const dia = diaLocal(t.partida_em, t.partida_fuso);
    if (chegada && (!saida || Math.abs(busca - ms(chegada.chegada_em)) < ms(saida.partida_em) - busca)) {
      const dif = (busca - ms(chegada.chegada_em)) / 60_000;
      if (dif < -15) add("alta", "transfer", `Transfer marcado ANTES do voo pousar: busca ${horaLocal(t.partida_em, t.partida_fuso)}, voo chega ${horaLocal(chegada.chegada_em, chegada.chegada_fuso || chegada.partida_fuso)}`, nome(chegada), [t.id, chegada.id], dia);
      else if (dif < 30 && chegada.tipo === "voo_internacional") add("media", "transfer", `Transfer só ${duracao(Math.max(dif, 0))} depois do pouso de um voo internacional`, "Imigração e bagagem costumam levar 1h ou mais — o motorista espera?", [t.id, chegada.id], dia);
      else if (dif > 180) add("media", "transfer", `Transfer ${duracao(dif)} depois do pouso`, "Passageiro vai esperar muito no aeroporto — confira o horário.", [t.id, chegada.id], dia);
    } else if (saida) {
      const antes = (ms(saida.partida_em) - busca) / 60_000;
      const minimo = saida.tipo === "voo_internacional" ? 240 : 150; // busca + trajeto + 3h/2h de antecedência
      if (antes < minimo - 60) add("alta", "transfer", `Transfer sai só ${duracao(antes)} antes do voo ${nome(saida)}`, `Pra voo ${saida.tipo === "voo_internacional" ? "internacional, chegar 3h antes" : "nacional, chegar 2h antes"} + o trajeto.`, [t.id, saida.id], dia);
      else if (antes < minimo) add("media", "transfer", `Transfer apertado: ${duracao(antes)} antes do voo ${nome(saida)}`, "Confira a distância até o aeroporto.", [t.id, saida.id], dia);
    }
  }
  if (transfers.length) {
    for (const vv of voos.filter((x) => x.chegada_em)) {
      const ficando = estadias.some((s) => s.chega.id === vv.id);
      const temTransfer = transfers.some((t) => Math.abs(ms(t.partida_em) - ms(vv.chegada_em)) <= 6 * H);
      if (ficando && !temTransfer) add("media", "transfer", `Chegada sem transfer: ${nome(vv)} pousa ${diaBR(diaLocal(vv.chegada_em, vv.chegada_fuso || vv.partida_fuso))} ${horaLocal(vv.chegada_em, vv.chegada_fuso || vv.partida_fuso)}`, "Os outros trechos têm transfer; este não. Confira se foi contratado.", [vv.id], diaLocal(vv.chegada_em, vv.chegada_fuso || vv.partida_fuso));
    }
  }

  // ── Passeios ──
  for (const t of passeios) {
    const dia = diaLocal(t.partida_em, t.partida_fuso);
    if (!t.documento_id) add("media", "passeio", `Passeio ${nome(t)} sem bilhete/voucher anexado`, "Sem o ingresso em mãos, o passageiro pode não entrar.", [t.id], dia);
    if (!t.ponto_encontro && !t.endereco) add("info", "passeio", `Passeio ${nome(t)} sem ponto de encontro`, undefined, [t.id], dia);
    const pousou = voos.find((vv) => vv.chegada_em && ms(t.partida_em) > ms(vv.chegada_em) && ms(t.partida_em) - ms(vv.chegada_em) < 4 * H);
    if (pousou) add(pousou.tipo === "voo_internacional" ? "media" : "info", "passeio", `Passeio ${duracao((ms(t.partida_em) - ms(pousou.chegada_em)) / 60_000)} depois de pousar (${nome(pousou)})`, "Atraso de voo ou imigração pode fazer perder o passeio.", [t.id, pousou.id], dia);
    const vaiVoar = voos.find((vv) => ms(vv.partida_em) > fimDe(t) && ms(vv.partida_em) - fimDe(t) < 4 * H);
    if (vaiVoar) add("media", "passeio", `Passeio termina perto do voo ${nome(vaiVoar)}`, `Sobra só ${duracao((ms(vaiVoar.partida_em) - fimDe(t)) / 60_000)} até a decolagem.`, [t.id, vaiVoar.id], dia);
    if (!t.chegada_em) add("info", "passeio", `Passeio ${nome(t)} sem horário de término`, "Sem o fim, não dá pra conferir se bate com o resto.", [t.id], dia);
  }

  // ── Documentos e passageiros ──
  const volta = v.data_retorno || v.data_embarque;
  const seisMeses = volta ? (() => { const d = new Date(`${volta}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 6); return d.toISOString().slice(0, 10); })() : null;
  if (internacional) {
    for (const p of e.passageiros) {
      if (!p.passaporte) add(diasPraEmbarque !== null && diasPraEmbarque <= 60 ? "alta" : "media", "documento", `${p.nome}: sem passaporte cadastrado`, "Viagem internacional — cadastre o número e a validade na ficha.");
      else if (p.passaporte_validade && p.passaporte_validade < hoje) add("alta", "documento", `${p.nome}: passaporte VENCIDO`);
      else if (p.passaporte_validade && seisMeses && p.passaporte_validade < seisMeses) add("alta", "documento", `${p.nome}: passaporte vence antes de 6 meses da volta`, `Vale até ${p.passaporte_validade.split("-").reverse().join("/")}. Muitos países barram o embarque.`);
      else if (!p.passaporte_validade) add("media", "documento", `${p.nome}: validade do passaporte não cadastrada`);
    }
    if (!e.documentos.some((d) => d.tipo === "seguro") && diasPraEmbarque !== null && diasPraEmbarque <= 30) add("media", "documento", "Viagem internacional sem seguro viagem anexado");
  }
  if (!e.documentos.some((d) => d.tipo === "bilhete") && e.trechos.some(ehVoo) && diasPraEmbarque !== null && diasPraEmbarque <= 30) {
    add("media", "documento", "Nenhum bilhete aéreo anexado", "Os voos estão cadastrados, mas sem o bilhete em mãos.");
  }
  const aConferir = e.documentos.filter((d) => d.status === "recebido").length;
  if (aConferir) add(diasPraEmbarque !== null && diasPraEmbarque <= 30 ? "media" : "info", "documento", `${aConferir} documento${aConferir > 1 ? "s" : ""} esperando conferência`, "Aprove ou recuse em Arquivos da viagem.");

  // ── O que a IA achou nos documentos ──
  for (const d of e.divergenciasIa) {
    if (d.gravidade === "baixa") continue;
    add(d.gravidade === "alta" ? "alta" : "media", "documento", d.texto, "Achado da revisão da IA.");
  }

  // sem repetidos, urgentes primeiro
  const vistos = new Set<string>();
  const ordem: Record<Nivel, number> = { alta: 0, media: 1, info: 2 };
  return P.filter((p) => { const k = `${p.nivel}|${p.titulo}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || (a.dia ?? "9").localeCompare(b.dia ?? "9"));
}

// ── Carregar e conferir várias viagens de uma vez ───────────────────────────

export interface Analise { problemas: Problema[]; trechos: Trecho[] }

export async function conferirViagens(viagens: (Pick<Viagem, "id" | "tipo" | "titulo" | "destino" | "data_embarque" | "data_retorno" | "status"> & { data_venda?: string | null })[]): Promise<Map<string, Analise>> {
  const ids = viagens.map((v) => v.id);
  const saida = new Map<string, Analise>();
  if (!ids.length) return saida;
  const pedacos = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const [trechos, pass, docs, extras] = await Promise.all([
    trechosDasViagens(ids),
    Promise.all(pedacos(ids, 150).map((p) => supabase.from("rel_viagem_passageiros").select("viagem_id, cliente_id, rel_clientes(nome, passaporte, passaporte_validade)").in("viagem_id", p)))
      .then((rs) => rs.flatMap((r) => { if (r.error) throw r.error; return r.data ?? []; })),
    Promise.all(pedacos(ids, 150).map((p) => supabase.from("rel_documentos").select("viagem_id, cliente_id, tipo, status").in("viagem_id", p).neq("status", "recusado")))
      .then((rs) => rs.flatMap((r) => { if (r.error) throw r.error; return r.data ?? []; })),
    Promise.all(pedacos(ids, 150).map((p) => supabase.from("rel_viagens").select("id, revisado_em, divergencias:ia_revisao->divergencias").in("id", p)))
      .then((rs) => rs.flatMap((r) => { if (r.error) throw r.error; return r.data ?? []; })),
  ]);

  type PassRow = { viagem_id: string; cliente_id: string; rel_clientes: { nome: string; passaporte: string | null; passaporte_validade: string | null } | null };
  type DocRow = { viagem_id: string; cliente_id: string; tipo: string; status: string };
  type ExtraRow = { id: string; revisado_em: string | null; divergencias: EntradaConferente["divergenciasIa"] | null };
  // documentos pessoais (passaporte…) moram na ficha, sem viagem — o seguro e o bilhete moram na viagem
  const porViagem = <T extends { viagem_id: string }>(l: T[]) => { const m = new Map<string, T[]>(); for (const x of l) m.set(x.viagem_id, [...(m.get(x.viagem_id) ?? []), x]); return m; };
  const tMap = porViagem(trechos), pMap = porViagem(pass as unknown as PassRow[]), dMap = porViagem(docs as DocRow[]);
  const xMap = new Map((extras as unknown as ExtraRow[]).map((x) => [x.id, x]));

  for (const v of viagens) {
    const t = tMap.get(v.id) ?? [];
    const x = xMap.get(v.id);
    saida.set(v.id, {
      trechos: t,
      problemas: analisarViagem({
        viagem: v, trechos: t,
        passageiros: (pMap.get(v.id) ?? []).filter((p) => p.rel_clientes).map((p) => ({ nome: p.rel_clientes!.nome, passaporte: p.rel_clientes!.passaporte, passaporte_validade: p.rel_clientes!.passaporte_validade })),
        documentos: dMap.get(v.id) ?? [],
        divergenciasIa: Array.isArray(x?.divergencias) ? x!.divergencias! : [],
        revisada: !!x?.revisado_em,
      }),
    });
  }
  return saida;
}

export function contar(p: Problema[]) {
  return { alta: p.filter((x) => x.nivel === "alta").length, media: p.filter((x) => x.nivel === "media").length, info: p.filter((x) => x.nivel === "info").length };
}

/**
 * Noites da viagem pra linha do tempo: qual hotel cobre cada noite e quais
 * noites o passageiro está num lugar (chegou e só sai >12h depois) sem hotel.
 * Só acusa "sem hotel" se a viagem tem alguma hospedagem cadastrada.
 */
export function mapaDasNoites(trechos: Trecho[]): { hotelDaNoite: Map<string, Trecho>; semHotel: Set<string> } {
  const comHora = [...trechos].filter((t) => !soDia(t)).sort((a, b) => ms(a.partida_em) - ms(b.partida_em));
  const hoteis = comHora.filter((t) => t.tipo === "hospedagem");
  const hotelDaNoite = new Map<string, Trecho>();
  for (const h of hoteis) {
    const ci = diaLocal(h.partida_em, h.partida_fuso)!, co = h.chegada_em ? diaLocal(h.chegada_em, h.chegada_fuso || h.partida_fuso)! : somaDias(ci, 1);
    for (let d = ci; d < co; d = somaDias(d, 1)) if (!hotelDaNoite.has(d)) hotelDaNoite.set(d, h);
  }
  const semHotel = new Set<string>();
  if (!hoteis.length) return { hotelDaNoite, semHotel };
  const desl = comHora.filter((t) => ehVoo(t) || t.tipo === "trem");
  for (let i = 0; i + 1 < desl.length; i++) {
    const a = desl[i], b = desl[i + 1];
    if (!a.chegada_em || ms(b.partida_em) - ms(a.chegada_em) <= 12 * H) continue;
    const d0 = diaLocal(a.chegada_em, a.chegada_fuso || a.partida_fuso)!, d1 = diaLocal(b.partida_em, b.partida_fuso)!;
    for (let d = d0; d < d1; d = somaDias(d, 1)) if (!hotelDaNoite.has(d)) semHotel.add(d);
  }
  return { hotelDaNoite, semHotel };
}
