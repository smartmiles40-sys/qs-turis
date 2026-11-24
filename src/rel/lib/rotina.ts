// src/rel/lib/rotina.ts
// -----------------------------------------------------------------------------
// ROTINA DO RELACIONAMENTO (24/11/2026). Bruno: "uma rotina igual dos SDRs…
// elas têm que seguir a cadência pra fazer check-in, revisar as coisas da
// expedição etc., assim não precisam ficar organizando o dia a dia".
//
// Uma FILA ÚNICA do time, já na ordem de fazer, juntando:
//   • check-in de voo (pacote, por voo; expedição, por GRUPO num voo só)
//   • etapas da esteira dos pacotes (etapas.ts)
//   • etapas da cadência das expedições (etapasExpedicao.ts)
//   • emissões futuras (trem-bala abre 3 meses antes…, src/lib/emissao.ts)
// Nada é gravado pra montar a fila: tudo é calculado do que já existe, então
// não há tarefa "órfã" nem cron — concluiu, sai; mudou a data, a fila acompanha.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { lotes } from "@/lib/lotes";
import { estadoEmissao, type EstadoEmissao } from "@/lib/emissao";
import { ETAPA, type EstadoEtapa } from "./etapas";
import { ETAPA_EXP, estadoDaExpedicao, type EstadoEtapaExp, type Expedicao, type RegistroEtapaExp } from "./etapasExpedicao";
import { etapasDasExpedicoes, expedicoesDaRotina } from "./etapasExpedicaoBanco";
import { hojeSP, type Trecho, type Viagem } from "./viagens";
import { ehVooQueVale } from "./agendaServicos";

export type GrupoRotina = "atrasadas" | "agora" | "hoje" | "proximas";
export const GRUPOS_ROTINA: { id: GrupoRotina; titulo: string; cor: string }[] = [
  { id: "atrasadas", titulo: "Atrasadas", cor: "#DC2626" },
  { id: "agora", titulo: "Agora", cor: "#B45309" },
  { id: "hoje", titulo: "Para hoje", cor: "#D97706" },
  { id: "proximas", titulo: "Próximos 7 dias", cor: "#2563EB" },
];

export interface ItemPacote { v: Viagem; atual: EstadoEtapa | null; trechos: Trecho[] }
export interface ItemEmissao { id: string; viagem_id: string; tipo: string; nome: string; data_inicio: string | null; dados: Record<string, unknown>; fornecedor: string | null; quem: string }

export type Atividade =
  | { tipo: "etapa"; chave: string; grupo: GrupoRotina; ordem: string; it: ItemPacote; estado: EstadoEtapa }
  | { tipo: "etapa_exp"; chave: string; grupo: GrupoRotina; ordem: string; exp: Expedicao; estado: EstadoEtapaExp }
  | { tipo: "checkin"; chave: string; grupo: GrupoRotina; ordem: string; quem: string; viagemId: string | null; expId: string | null; pax: number; trechos: Trecho[]; aberto: boolean }
  | { tipo: "emissao"; chave: string; grupo: GrupoRotina; ordem: string; item: ItemEmissao; estado: EstadoEmissao };

/** Prioridade dentro do grupo: check-in > emissão vencendo > etapa. Menor = primeiro. */
const PESO: Record<Atividade["tipo"], number> = { checkin: 0, emissao: 1, etapa_exp: 2, etapa: 3 };

const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function grupoDaEtapa(e: { id: string; situacao: string; abre: string | null; prazo: string | null }, hoje: string): GrupoRotina | null {
  // "Em viagem" é acompanhamento contínuo: vira atividade na véspera da volta (fechar a etapa)
  if (e.id === "em_viagem" && e.situacao === "a_fazer") return e.prazo && e.prazo <= somaDias(hoje, 1) ? "hoje" : null;
  if (e.situacao === "atrasada") return "atrasadas";
  if (e.situacao === "a_fazer") return e.prazo && e.prazo > somaDias(hoje, 1) ? "proximas" : "hoje";
  if (e.situacao === "aguardando" && e.abre && e.abre <= somaDias(hoje, 7)) return "proximas";
  return null;
}

export interface DadosExtras {
  exps: Expedicao[];
  regsExp: Map<string, RegistroEtapaExp[]>;
  /** check-ins de quem não está na Esteira dos pacotes (expedições e o resto), um por grupo × voo */
  checkins: CheckinGrupo[];
  emissoes: ItemEmissao[];
}

export interface CheckinGrupo { titulo: string; expId: string | null; viagemId: string | null; pax: number; trechos: Trecho[] }

/** O mesmo voo vem escrito de jeitos diferentes ("EK385", "EK 385", "0385"): só os dígitos, sem zero à esquerda. */
export const chaveDoVoo = (t: Pick<Trecho, "numero" | "companhia" | "partida_em">) =>
  `${(t.numero ?? "").replace(/\D/g, "").replace(/^0+/, "") || (t.companhia ?? "").toUpperCase()}|${t.partida_em.slice(0, 16)}`;

/** O que a rotina precisa além dos pacotes da Esteira: expedições, check-ins de grupo e emissões. */
export async function carregarExtras(): Promise<DadosExtras> {
  const agora = Date.now();
  const [{ exps }, checkins, emissoes] = await Promise.all([expedicoesDaRotina(), checkinsDas24h(agora), emissoesAbertas()]);
  const regsExp = await etapasDasExpedicoes(exps.map((e) => e.id));
  return { exps, regsExp, checkins, emissoes };
}

type ViagemMin = { id: string; titulo: string; cliente_nome: string | null; status: string; expedicoes_id: string | null };

/**
 * Todo voo (de viagem ativa) cujo check-in abre nas próximas 24h e que não decolou.
 * Não só das expedições em andamento: quem ESTENDEU a viagem volta depois do grupo
 * "Concluído" e o check-in da volta é do time do mesmo jeito. Expedição junta por
 * GRUPO × voo; o resto, por viagem × voo.
 */
async function checkinsDas24h(agora: number): Promise<CheckinGrupo[]> {
  const ate = new Date(agora + 24 * 3600_000).toISOString(), desde = new Date(agora).toISOString();
  const { data, error } = await supabase.from("rel_trechos_v").select("*")
    .is("checkin_feito_em", null).lte("checkin_em", ate).gt("partida_em", desde).limit(3000);
  if (error) throw error;
  const ts = ((data ?? []) as Trecho[]).filter((t) => ehVooQueVale(t) && !t.status_manual);
  const ids = [...new Set(ts.map((t) => t.viagem_id))];
  const vs = new Map<string, ViagemMin>();
  const rs = await Promise.all(lotes(ids, 150).map((l) => supabase.from("rel_viagens").select("id, titulo, cliente_nome, status, expedicoes_id").in("id", l)));
  for (const { data: d, error: e } of rs) { if (e) throw e; for (const v of (d ?? []) as ViagemMin[]) vs.set(v.id, v); }
  const expIds = [...new Set([...vs.values()].map((v) => v.expedicoes_id).filter((x): x is string => !!x))];
  const nomesExp = new Map<string, string>();
  if (expIds.length) {
    const { data: es } = await supabase.from("expedicoes").select("id, nome").in("id", expIds);
    for (const e of (es ?? []) as { id: string; nome: string }[]) nomesExp.set(e.id, e.nome);
  }
  const grupos = new Map<string, CheckinGrupo & { viagens: Set<string> }>();
  for (const t of ts) {
    const v = vs.get(t.viagem_id);
    if (!v || v.status !== "ativa") continue;
    const dono = v.expedicoes_id ? `x:${v.expedicoes_id}` : `v:${v.id}`;
    const k = `${dono}|${chaveDoVoo(t)}`;
    const g = grupos.get(k) ?? { titulo: v.expedicoes_id ? nomesExp.get(v.expedicoes_id) ?? "Expedição" : v.cliente_nome || v.titulo, expId: v.expedicoes_id, viagemId: v.id, pax: 0, trechos: [], viagens: new Set<string>() };
    g.trechos.push(t); g.viagens.add(v.id); g.pax = g.viagens.size;
    if (g.viagens.size > 1) g.viagemId = null; // grupo: não tem "a" viagem
    grupos.set(k, g);
  }
  return [...grupos.values()].map(({ viagens, ...g }) => {
    if (g.expId && viagens.size === 1) {
      const v = vs.get([...viagens][0]);
      if (v) g.titulo = `${g.titulo} · ${v.cliente_nome || v.titulo}`;
    }
    return g;
  });
}

/** Itens vendidos e ainda não emitidos, das viagens ativas (o que a venda e o Rel agendaram). */
async function emissoesAbertas(): Promise<ItemEmissao[]> {
  const { data, error } = await supabase.from("qs_venda_itens").select("id, viagem_id, tipo, nome, data_inicio, dados, fornecedor")
    .eq("status", "vendido").not("viagem_id", "is", null).not("tipo", "in", "(expedicao,concierge)").limit(2000);
  if (error) {
    if (/qs_venda_itens|does not exist|PGRST205/i.test(error.message)) return [];
    throw error;
  }
  const itens = (data ?? []) as Omit<ItemEmissao, "quem">[];
  const ids = [...new Set(itens.map((i) => i.viagem_id))];
  const nomes = new Map<string, string>();
  const rs = await Promise.all(lotes(ids, 150).map((l) => supabase.from("rel_viagens").select("id, titulo, cliente_nome, status").in("id", l)));
  for (const { data: vs } of rs) for (const v of (vs ?? []) as { id: string; titulo: string; cliente_nome: string | null; status: string }[]) {
    if (v.status === "ativa") nomes.set(v.id, v.cliente_nome || v.titulo);
  }
  return itens.filter((i) => nomes.has(i.viagem_id)).map((i) => ({ ...i, dados: (i.dados ?? {}) as Record<string, unknown>, quem: nomes.get(i.viagem_id)! }));
}

/** Monta a fila do dia, já agrupada e na ordem de fazer. */
export function montarRotina(pacotes: ItemPacote[], extras: DadosExtras | null, agora = Date.now(), hoje = hojeSP()): Atividade[] {
  const out: Atividade[] = [];
  const vistos = new Set<string>(); // trecho que já virou check-in pelo pacote não repete

  for (const it of pacotes) {
    const e = it.atual;
    if (e) {
      const g = grupoDaEtapa(e, hoje);
      if (g) out.push({ tipo: "etapa", chave: `e:${it.v.id}:${e.id}`, grupo: g, ordem: String(e.prazo ?? e.abre ?? ""), it, estado: e });
    }
    for (const t of it.trechos) {
      if (!ehVooQueVale(t, it.v) || !t.checkin_em || t.checkin_feito_em || t.status_manual) continue;
      const abre = new Date(t.checkin_em).getTime(), sai = new Date(t.partida_em).getTime();
      if (abre > agora + 24 * 3600_000 || sai <= agora) continue;
      vistos.add(t.id);
      out.push({ tipo: "checkin", chave: `c:${t.id}`, grupo: abre <= agora ? "agora" : "hoje", ordem: t.partida_em, quem: it.v.cliente_nome || it.v.titulo, viagemId: it.v.id, expId: null, pax: 1, trechos: [t], aberto: abre <= agora });
    }
  }

  if (extras) {
    for (const exp of extras.exps) {
      const { atual } = estadoDaExpedicao(exp, extras.regsExp.get(exp.id) ?? [], hoje);
      if (!atual) continue;
      const g = grupoDaEtapa(atual, hoje);
      if (g) out.push({ tipo: "etapa_exp", chave: `x:${exp.id}:${atual.id}`, grupo: g, ordem: String(atual.prazo ?? atual.abre ?? ""), exp, estado: atual });
    }
    for (const c of extras.checkins) {
      const trechos = c.trechos.filter((t) => !vistos.has(t.id));
      if (!trechos.length) continue;
      const t0 = trechos[0];
      const aberto = trechos.some((t) => t.checkin_em && new Date(t.checkin_em).getTime() <= agora);
      out.push({ tipo: "checkin", chave: `cx:${t0.id}`, grupo: aberto ? "agora" : "hoje", ordem: t0.partida_em, quem: c.titulo, viagemId: c.viagemId, expId: c.expId, pax: c.pax, trechos, aberto });
    }
    for (const item of extras.emissoes) {
      const e = estadoEmissao(item, hoje);
      const g: GrupoRotina | null = e.situacao === "vencida" ? "atrasadas"
        : e.situacao === "urgente" || e.situacao === "aberta" ? "hoje"
        : e.abre && e.abre <= somaDias(hoje, 7) ? "proximas" : null;
      if (g) out.push({ tipo: "emissao", chave: `m:${item.id}`, grupo: g, ordem: String(e.situacao === "aguardando" ? e.abre : e.prazo ?? ""), item, estado: e });
    }
  }

  const ordemGrupo: Record<GrupoRotina, number> = { agora: 0, atrasadas: 1, hoje: 2, proximas: 3 };
  return out.sort((a, b) => ordemGrupo[a.grupo] - ordemGrupo[b.grupo] || PESO[a.tipo] - PESO[b.tipo] || a.ordem.localeCompare(b.ordem));
}

/** Rótulo curto do que fazer (coluna da esquerda) e a cor. */
export function rotuloDa(a: Atividade): { o_que: string; cor: string } {
  if (a.tipo === "etapa") return { o_que: ETAPA[a.estado.id].curto, cor: ETAPA[a.estado.id].cor };
  if (a.tipo === "etapa_exp") return { o_que: ETAPA_EXP[a.estado.id].curto, cor: ETAPA_EXP[a.estado.id].cor };
  if (a.tipo === "checkin") return { o_que: a.pax > 1 ? "Check-in grupo" : "Check-in", cor: "#B45309" };
  return { o_que: "Emissão", cor: "#0891B2" };
}
