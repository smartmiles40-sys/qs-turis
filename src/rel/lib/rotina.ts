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
//   • emissões futuras (trem-bala abre 3 meses antes…, src/lib/emissao.ts),
//     inclusive as que o CLOSER lançou na venda antes de existir a viagem
//   • solicitações abertas pro Relacionamento (Central de solicitações)
// 25/11 (Bruno): "tudo que elas têm que fazer deve ficar nessa parte"; toda
// atividade traz o contato do cliente (WhatsApp) e as emissões agendadas pra
// depois dos 7 dias aparecem em "Futuras".
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

export type GrupoRotina = "atrasadas" | "agora" | "hoje" | "proximas" | "futuras";
export const GRUPOS_ROTINA: { id: GrupoRotina; titulo: string; cor: string }[] = [
  { id: "atrasadas", titulo: "Atrasadas", cor: "#DC2626" },
  { id: "agora", titulo: "Agora", cor: "#B45309" },
  { id: "hoje", titulo: "Para hoje", cor: "#D97706" },
  { id: "proximas", titulo: "Próximos 7 dias", cor: "#2563EB" },
  { id: "futuras", titulo: "Futuras (emissões e pedidos mais pra frente)", cor: "#64748B" },
];

export interface ItemPacote { v: Viagem; atual: EstadoEtapa | null; trechos: Trecho[] }
export interface ItemEmissao {
  id: string; viagem_id: string | null; negocio_id: string | null; cliente_id: string | null; tipo: string; nome: string;
  data_inicio: string | null; data_fim: string | null; dados: Record<string, unknown>; fornecedor: string | null; valor: number | null;
  quem: string; telefone: string | null; destino: string | null;
  /** lançada pelo closer na venda e ainda sem viagem no Rel */
  doCloser: boolean;
}
export interface SolicitacaoRotina {
  id: string; numero: number | null; titulo: string; descricao: string | null; tipo_rotulo: string | null; prioridade: string;
  status: string; prazo: string | null; vencida: boolean; de_setor: string; cliente_id: string | null; viagem_id: string | null;
  conversa_id: string | null; sobre_nome: string | null; responsavel_nome: string | null; criado_por_nome: string | null;
}
/** Com quem falar no WhatsApp a partir da atividade. */
export interface Contato { clienteId: string | null; telefone: string | null; nome: string | null; conversaId?: string | null }

export type Atividade =
  | { tipo: "etapa"; chave: string; grupo: GrupoRotina; ordem: string; it: ItemPacote; estado: EstadoEtapa }
  | { tipo: "etapa_exp"; chave: string; grupo: GrupoRotina; ordem: string; exp: Expedicao; estado: EstadoEtapaExp }
  | { tipo: "checkin"; chave: string; grupo: GrupoRotina; ordem: string; quem: string; viagemId: string | null; expId: string | null; pax: number; trechos: Trecho[]; aberto: boolean; clienteId: string | null; telefone: string | null; destino: string | null }
  | { tipo: "emissao"; chave: string; grupo: GrupoRotina; ordem: string; item: ItemEmissao; estado: EstadoEmissao }
  | { tipo: "solicitacao"; chave: string; grupo: GrupoRotina; ordem: string; sol: SolicitacaoRotina };

/**
 * ÁREAS do trabalho, já na ORDEM DE PRIORIDADE do dia (25/11, Bruno: "ordem de
 * prioridade nas coisas que têm que ser feitas naquele dia, sempre em primeiro
 * e divididas por áreas"). Check-in tem hora marcada; emissão perde tarifa;
 * solicitação é alguém esperando; depois a cadência das expedições e dos pacotes.
 */
export const AREAS: { tipo: Atividade["tipo"]; titulo: string; emoji: string; cor: string }[] = [
  { tipo: "checkin", titulo: "Check-ins", emoji: "✈", cor: "#B45309" },
  { tipo: "emissao", titulo: "Emissões", emoji: "🎫", cor: "#0891B2" },
  { tipo: "solicitacao", titulo: "Solicitações", emoji: "📨", cor: "#7C3AED" },
  { tipo: "etapa_exp", titulo: "Expedições (grupos)", emoji: "🧭", cor: "#0F766E" },
  { tipo: "etapa", titulo: "Pacotes (cadência)", emoji: "🧳", cor: "#2563EB" },
];
const PESO = Object.fromEntries(AREAS.map((a, i) => [a.tipo, i])) as Record<Atividade["tipo"], number>;
/** O que é do dia: atrasadas, check-in aberto e o de hoje. */
export const ehDoDia = (g: GrupoRotina) => g === "atrasadas" || g === "agora" || g === "hoje";

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
  solicitacoes: SolicitacaoRotina[];
}

export const extrasVazios = (): DadosExtras => ({ exps: [], regsExp: new Map(), checkins: [], emissoes: [], solicitacoes: [] });

export interface CheckinGrupo { titulo: string; expId: string | null; viagemId: string | null; pax: number; trechos: Trecho[]; clienteId: string | null; telefone: string | null; destino: string | null }

/** O mesmo voo vem escrito de jeitos diferentes ("EK385", "EK 385", "0385"): só os dígitos, sem zero à esquerda. */
export const chaveDoVoo = (t: Pick<Trecho, "numero" | "companhia" | "partida_em">) =>
  `${(t.numero ?? "").replace(/\D/g, "").replace(/^0+/, "") || (t.companhia ?? "").toUpperCase()}|${t.partida_em.slice(0, 16)}`;

/** O que a rotina precisa além dos pacotes da Esteira: expedições, check-ins de grupo e emissões. */
export async function carregarExtras(): Promise<DadosExtras> {
  const agora = Date.now();
  const [{ exps }, checkins, emissoes, solicitacoes] = await Promise.all([expedicoesDaRotina(), checkinsDas24h(agora), emissoesAbertas(), solicitacoesAbertas()]);
  const regsExp = await etapasDasExpedicoes(exps.map((e) => e.id));
  return { exps, regsExp, checkins, emissoes, solicitacoes };
}

type ViagemMin = { id: string; titulo: string; destino: string | null; cliente_nome: string | null; cliente_id: string | null; status: string; expedicoes_id: string | null };

/** Nome e telefone de cada cliente (rel_clientes), em lotes. */
async function telefonesDe(ids: (string | null | undefined)[]): Promise<Map<string, { nome: string | null; telefone: string | null }>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { nome: string | null; telefone: string | null }>();
  const rs = await Promise.all(lotes(u, 150).map((l) => supabase.from("rel_clientes").select("id, nome, telefone").in("id", l)));
  for (const { data } of rs) for (const c of (data ?? []) as { id: string; nome: string | null; telefone: string | null }[]) out.set(c.id, { nome: c.nome, telefone: c.telefone });
  return out;
}

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
  const rs = await Promise.all(lotes(ids, 150).map((l) => supabase.from("rel_viagens").select("id, titulo, destino, cliente_nome, cliente_id, status, expedicoes_id").in("id", l)));
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
    const g = grupos.get(k) ?? { titulo: v.expedicoes_id ? nomesExp.get(v.expedicoes_id) ?? "Expedição" : v.cliente_nome || v.titulo, expId: v.expedicoes_id, viagemId: v.id, pax: 0, trechos: [], viagens: new Set<string>(), clienteId: v.cliente_id, telefone: null, destino: v.destino };
    g.trechos.push(t); g.viagens.add(v.id); g.pax = g.viagens.size;
    if (g.viagens.size > 1) { g.viagemId = null; g.clienteId = null; } // grupo: não tem "a" viagem nem "o" cliente
    grupos.set(k, g);
  }
  const fones = await telefonesDe([...grupos.values()].map((g) => g.clienteId));
  return [...grupos.values()].map(({ viagens, ...g }) => {
    if (g.expId && viagens.size === 1) {
      const v = vs.get([...viagens][0]);
      if (v) g.titulo = `${g.titulo} · ${v.cliente_nome || v.titulo}`;
    }
    if (g.clienteId) g.telefone = fones.get(g.clienteId)?.telefone ?? null;
    return g;
  });
}

/**
 * Itens vendidos e ainda não emitidos: os das viagens ativas (o que a venda e o
 * Rel agendaram) + os que o CLOSER marcou "emite depois" na venda e que ainda
 * não viraram viagem no Rel (25/11: "quando os closers colocarem que tem
 * emissões para fazer futuramente, também deve aparecer como atividade futura").
 */
async function emissoesAbertas(): Promise<ItemEmissao[]> {
  type Bruto = { id: string; viagem_id: string | null; negocio_id: string | null; cliente_id: string | null; tipo: string; nome: string; data_inicio: string | null; data_fim: string | null; dados: Record<string, unknown> | null; fornecedor: string | null; valor: number | null };
  const { data, error } = await supabase.from("qs_venda_itens").select("id, viagem_id, negocio_id, cliente_id, tipo, nome, data_inicio, data_fim, dados, fornecedor, valor")
    .eq("status", "vendido").not("tipo", "in", "(expedicao,concierge)").limit(3000);
  if (error) {
    if (/qs_venda_itens|does not exist|PGRST205/i.test(error.message)) return [];
    throw error;
  }
  const brutos = (data ?? []) as Bruto[];
  const comViagem = brutos.filter((i) => i.viagem_id);
  const doCloser = brutos.filter((i) => !i.viagem_id && (i.dados ?? {}).emite_depois === "sim");

  const ids = [...new Set(comViagem.map((i) => i.viagem_id!))];
  const vs = new Map<string, { nome: string; cliente_id: string | null; destino: string | null }>();
  const rs = await Promise.all(lotes(ids, 150).map((l) => supabase.from("rel_viagens").select("id, titulo, destino, cliente_nome, cliente_id, status").in("id", l)));
  for (const { data: d } of rs) for (const v of (d ?? []) as { id: string; titulo: string; destino: string | null; cliente_nome: string | null; cliente_id: string | null; status: string }[]) {
    if (v.status === "ativa") vs.set(v.id, { nome: v.cliente_nome || v.titulo, cliente_id: v.cliente_id, destino: v.destino || v.titulo });
  }
  // do closer: o nome vem do cliente (rel_clientes) ou do lead do negócio
  const negIds = [...new Set(doCloser.filter((i) => !i.cliente_id && i.negocio_id).map((i) => i.negocio_id!))];
  const leads = new Map<string, { nome: string; telefone: string | null }>();
  if (negIds.length) {
    const { data: ns } = await supabase.from("qs_closer_negocios").select("id, lead:qs_leads(full_name, first_name, last_name, phone)").in("id", negIds);
    for (const n of (ns ?? []) as unknown as { id: string; lead: { full_name: string | null; first_name: string | null; last_name: string | null; phone: string | null } | null }[]) {
      const l = n.lead;
      leads.set(n.id, { nome: (l?.full_name || [l?.first_name, l?.last_name].filter(Boolean).join(" ") || "Cliente").trim(), telefone: l?.phone ?? null });
    }
  }
  const fones = await telefonesDe([...comViagem.map((i) => i.cliente_id ?? vs.get(i.viagem_id!)?.cliente_id), ...doCloser.map((i) => i.cliente_id)]);

  const out: ItemEmissao[] = [];
  for (const i of comViagem) {
    const v = vs.get(i.viagem_id!);
    if (!v) continue;
    const cid = i.cliente_id ?? v.cliente_id;
    out.push({ ...i, dados: i.dados ?? {}, cliente_id: cid, quem: v.nome, telefone: cid ? fones.get(cid)?.telefone ?? null : null, destino: v.destino, doCloser: false });
  }
  for (const i of doCloser) {
    const c = i.cliente_id ? fones.get(i.cliente_id) : null;
    const l = i.negocio_id ? leads.get(i.negocio_id) : null;
    out.push({ ...i, dados: i.dados ?? {}, quem: c?.nome || l?.nome || "Cliente", telefone: c?.telefone ?? l?.telefone ?? null, destino: null, doCloser: true });
  }
  return out;
}

/** Solicitações abertas pro Relacionamento (Central de solicitações entre setores). */
async function solicitacoesAbertas(): Promise<SolicitacaoRotina[]> {
  const { data, error } = await supabase.from("qs_solicitacoes_v")
    .select("id, numero, titulo, descricao, tipo_rotulo, prioridade, status, prazo, vencida, de_setor, cliente_id, viagem_id, conversa_id, sobre_nome, responsavel_nome, criado_por_nome")
    .eq("para_setor", "relacionamento").eq("aberta", true).limit(500);
  if (error) return []; // a Central é extra: se falhar, a rotina segue com o resto
  return (data ?? []) as SolicitacaoRotina[];
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
      out.push({ tipo: "checkin", chave: `c:${t.id}`, grupo: abre <= agora ? "agora" : "hoje", ordem: t.partida_em, quem: it.v.cliente_nome || it.v.titulo, viagemId: it.v.id, expId: null, pax: 1, trechos: [t], aberto: abre <= agora, clienteId: it.v.cliente_id, telefone: it.v.cliente_telefone ?? null, destino: it.v.destino });
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
      out.push({ tipo: "checkin", chave: `cx:${t0.id}`, grupo: aberto ? "agora" : "hoje", ordem: t0.partida_em, quem: c.titulo, viagemId: c.viagemId, expId: c.expId, pax: c.pax, trechos, aberto, clienteId: c.clienteId, telefone: c.telefone, destino: c.destino });
    }
    for (const item of extras.emissoes) {
      const e = estadoEmissao(item, hoje);
      const g: GrupoRotina | null = e.situacao === "vencida" ? "atrasadas"
        : e.situacao === "urgente" || e.situacao === "aberta" ? "hoje"
        : e.abre && e.abre <= somaDias(hoje, 7) ? "proximas" : "futuras";
      out.push({ tipo: "emissao", chave: `m:${item.id}`, grupo: g, ordem: String(e.situacao === "aguardando" ? e.abre ?? "9999" : e.prazo ?? ""), item, estado: e });
    }
    for (const sol of extras.solicitacoes) {
      const dia = sol.prazo ? new Date(sol.prazo).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : null;
      const g: GrupoRotina = sol.vencida ? "atrasadas"
        : !dia || dia <= hoje || sol.prioridade === "urgente" || sol.status === "nova" ? "hoje"
        : dia <= somaDias(hoje, 7) ? "proximas" : "futuras";
      out.push({ tipo: "solicitacao", chave: `s:${sol.id}`, grupo: g, ordem: sol.prazo ?? "", sol });
    }
  }

  // Do dia primeiro, por ÁREA (na ordem de prioridade) e, dentro da área, o mais urgente
  // (check-in aberto > atrasada > hoje) e o mais cedo. Depois próximos 7 dias e futuras.
  const bloco = (g: GrupoRotina) => (ehDoDia(g) ? 0 : g === "proximas" ? 1 : 2);
  const urg: Record<GrupoRotina, number> = { agora: 0, atrasadas: 1, hoje: 2, proximas: 3, futuras: 4 };
  return out.sort((a, b) => bloco(a.grupo) - bloco(b.grupo) || PESO[a.tipo] - PESO[b.tipo] || urg[a.grupo] - urg[b.grupo] || a.ordem.localeCompare(b.ordem));
}

/** Rótulo curto do que fazer (coluna da esquerda) e a cor. */
export function rotuloDa(a: Atividade): { o_que: string; cor: string } {
  if (a.tipo === "etapa") return { o_que: ETAPA[a.estado.id].curto, cor: ETAPA[a.estado.id].cor };
  if (a.tipo === "etapa_exp") return { o_que: ETAPA_EXP[a.estado.id].curto, cor: ETAPA_EXP[a.estado.id].cor };
  if (a.tipo === "checkin") return { o_que: a.pax > 1 ? "Check-in grupo" : "Check-in", cor: "#B45309" };
  if (a.tipo === "solicitacao") return { o_que: "Solicitação", cor: "#7C3AED" };
  return { o_que: a.item.doCloser ? "Emissão (closer)" : "Emissão", cor: "#0891B2" };
}

/** Com quem falar no WhatsApp: o cliente da viagem/venda. Grupo de expedição não tem "o" cliente. */
export function contatoDa(a: Atividade): Contato | null {
  if (a.tipo === "etapa") return a.it.v.cliente_id || a.it.v.cliente_telefone ? { clienteId: a.it.v.cliente_id, telefone: a.it.v.cliente_telefone ?? null, nome: a.it.v.cliente_nome } : null;
  if (a.tipo === "checkin") return a.pax === 1 && (a.clienteId || a.telefone) ? { clienteId: a.clienteId, telefone: a.telefone, nome: a.quem } : null;
  if (a.tipo === "emissao") return a.item.cliente_id || a.item.telefone ? { clienteId: a.item.cliente_id, telefone: a.item.telefone, nome: a.item.quem } : null;
  if (a.tipo === "solicitacao") return a.sol.cliente_id || a.sol.conversa_id ? { clienteId: a.sol.cliente_id, telefone: null, nome: a.sol.sobre_nome, conversaId: a.sol.conversa_id } : null;
  return null;
}
