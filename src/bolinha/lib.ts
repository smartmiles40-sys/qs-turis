// src/bolinha/lib.ts
// -----------------------------------------------------------------------------
// BOLINHA DO QS (Bruno 22/10/2026): um "AssistiveTouch" no computador — uma
// bolinha que fica por cima de TODOS os programas (não só do QS), com os
// avisos, atalhos e um assistente.
//
// Quem desenha a janela por cima de tudo é o app do computador (Electron, em
// desktop/). Ele abre o QS em "<QS>/?bolinha=1", sem moldura e com fundo
// transparente, em dois tamanhos: 64×64 (bolinha) e 380×560 (painel). O app
// expõe `window.qsDesktop` (ver o contrato abaixo). Aberto num navegador comum
// (pra testar), `qsDesktop` não existe: a tela mostra o painel direto e os
// links abrem numa aba nova.
//
// Aqui ficam: o contrato com o app, os endereços (#…) de cada tela do QS e
// as consultas leves das telas da bolinha (sem polling: carrega ao abrir).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { setoresDe } from "@/contexts/QsAuthContext";
import type { Setor, SdrUser } from "@/components/sdr/types";

export type EstadoJanela = "bolinha" | "menu" | "painel";
/** Onde está o centro da bolinha dentro da janela (no menu, a janela é maior que a bolinha). */
export interface LayoutJanela { estado: EstadoJanela; cx: number; cy: number }

/** O que o app do computador (preload do Electron) põe na janela. */
export interface QsDesktop {
  versao: string;
  expandir(): void;
  recolher(): void;
  /** Os 5 atalhos flutuando em volta da bolinha (versão 1.1 do app). */
  menu?(): void;
  layout?(): Promise<LayoutJanela>;
  /** No menu: o mouse está em cima de um ícone? (fora deles o clique atravessa a janela) */
  clicavel?(sim: boolean): void;
  estado(): Promise<EstadoJanela>;
  arrastarInicio(): void;
  arrastarFim(): void;
  /** Abre o QS no navegador padrão já nesse endereço (#…). */
  abrirNoQS(hash: string): void;
  sair(): void;
  onMudouEstado(cb: (e: EstadoJanela, info?: LayoutJanela) => void): () => void;
}

declare global {
  interface Window { qsDesktop?: QsDesktop }
}

/** O app do computador, se a tela estiver dentro dele (num navegador comum é null). */
export function desktop(): QsDesktop | null {
  return typeof window !== "undefined" && window.qsDesktop ? window.qsDesktop : null;
}

/** A tela foi aberta como bolinha (?bolinha=1)? */
export function ehModoBolinha(): boolean {
  try { return new URLSearchParams(window.location.search).get("bolinha") === "1"; } catch { return false; }
}

/**
 * Abre uma tela do QS. No computador: no navegador padrão (o app cuida). No
 * navegador: numa aba nova, sem o "?bolinha=1".
 */
export function abrirNoQS(hash: string) {
  const h = hash && hash.startsWith("#") ? hash : "#";
  const d = desktop();
  if (d) { try { d.abrirNoQS(h); } catch { /* app antigo: sem atalho */ } return; }
  window.open(`${window.location.origin}/${h === "#" ? "" : h}`, "_blank", "noopener");
}

// ── Endereços (#…) das telas do QS ─────────────────────────────────────────
// Os mesmos que o QS lê: RelApp (#rel/cliente/<id>, #rel/viagem/<id>),
// CascaDeArea (#fin/…, #ops/…), CloserApp (#closer/…) e o SdrLayout, que lê
// "#comercial/lead|solicitacoes|painel|minha-agenda".

const PREFIXO: Record<Setor, string> = { comercial: "comercial", relacionamento: "rel", financeiro: "fin", operacional: "ops" };

/** O Comercial do closer é a Área do Closer. */
function prefixoComercial(u: Pick<SdrUser, "role"> | null | undefined) {
  return u?.role === "closer" ? "closer" : "comercial";
}
function prefixoDe(setor: Setor, u: Pick<SdrUser, "role"> | null | undefined) {
  return setor === "comercial" ? prefixoComercial(u) : PREFIXO[setor];
}

export const rotas = {
  inicio: () => "#",
  cliente: (id: string) => `#rel/cliente/${id}`,
  viagem: (id: string) => `#rel/viagem/${id}`,
  esteira: () => "#rel/esteira",
  lead: (id: string, u: Pick<SdrUser, "role"> | null | undefined) => `#${prefixoComercial(u)}/lead/${id}`,
  agenda: (u: Pick<SdrUser, "role"> | null | undefined) => (u?.role === "closer" ? "#closer/agenda" : "#comercial/minha-agenda"),
  painel: (u: Pick<SdrUser, "role"> | null | undefined) => `#${prefixoComercial(u)}/painel`,
  /** A solicitação aberta pelo lado da pessoa: quem cuida (para_setor) ou quem pediu (de_setor). */
  solicitacao: (s: { id: string; para_setor: Setor; de_setor: Setor; responsavel_id?: string | null; criado_por?: string | null },
    u: (Pick<SdrUser, "role" | "setores"> & { id: string }) | null | undefined) => {
    const minhas = setoresDe(u);
    const setor = s.criado_por === u?.id && s.responsavel_id !== u?.id && minhas.includes(s.de_setor) ? s.de_setor
      : minhas.includes(s.para_setor) ? s.para_setor : minhas.includes(s.de_setor) ? s.de_setor : s.para_setor;
    return `#${prefixoDe(setor, u)}/solicitacoes/${s.id}`;
  },
};

/** Id da solicitação a partir do link do aviso ("#…/solicitacoes/<uuid>"). */
export function solicitacaoDoLink(link: string | null | undefined): string | null {
  const m = String(link ?? "").match(/\/solicitacoes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

// ── Datas (sempre no horário de São Paulo) ─────────────────────────────────

export const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
/** Início e fim do dia (SP) em ISO, pra filtrar timestamptz. */
export function limitesDoDia(dia = hojeSP()) {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  return { inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 86_400_000).toISOString() };
}
export const horaSP = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// ── Buscar ──────────────────────────────────────────────────────────────────

export interface LeadAchado { id: string; nome: string; telefone_fim: string | null; status: string | null }

/** Leads que a pessoa enxerga (RLS: SDR vê os dele; gestão vê todos). */
export async function buscarLeads(termo: string, limite = 8): Promise<LeadAchado[]> {
  const t = termo.replace(/[,()*%\\:"']/g, " ").trim();
  if (t.length < 2) return [];
  const d = t.replace(/\D/g, "");
  const soNumero = d.length >= 4 && d.length === t.replace(/[\s.\-/()+]/g, "").length;
  let q = supabase.from("qs_leads").select("id, full_name, phone, status").order("updated_at", { ascending: false }).limit(limite);
  q = soNumero ? q.ilike("phone", `%${d.slice(-8)}%`) : q.or(`full_name.ilike.*${t}*,email.ilike.*${t}*`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; full_name: string | null; phone: string | null; status: string | null }[]).map((l) => ({
    id: l.id, nome: l.full_name || "(sem nome)", status: l.status,
    telefone_fim: (l.phone ?? "").replace(/\D/g, "").slice(-4) || null,
  }));
}

// ── Hoje ────────────────────────────────────────────────────────────────────

export interface ReuniaoHoje { id: string; nome: string; lead_id: string | null; scheduled_at: string; status: string }
export interface SolAberta { id: string; numero: number; titulo: string; sobre_nome: string | null; prazo: string | null; vencida: boolean; status: string; para_setor: Setor; de_setor: Setor; responsavel_id: string | null; criado_por: string | null }
export interface EtapaHoje { viagem_id: string; titulo: string; etapa: string; atrasada: boolean }
export interface Hoje {
  reunioes: ReuniaoHoje[];
  tarefas: { hoje: number; atrasadas: number } | null;
  solicitacoes: SolAberta[];
  esteira: EtapaHoje[] | null;
}

export async function carregarHoje(u: SdrUser): Promise<Hoje> {
  const setores = setoresDe(u);
  const { inicio, fim } = limitesDoDia();
  const comercial = setores.includes("comercial");

  const reunioes = comercial
    ? supabase.from("qs_meetings").select("id, title, lead_name, lead_id, scheduled_at, status")
        .or(`owner_id.eq.${u.id},closer_id.eq.${u.id}`).gte("scheduled_at", inicio).lt("scheduled_at", fim)
        .in("status", ["agendada", "confirmada", "realizada"]).order("scheduled_at").limit(20)
    : null;
  const tarefasHoje = comercial
    ? supabase.from("qs_tasks").select("id", { count: "exact", head: true }).eq("owner_id", u.id)
        .in("status", ["pendente", "atrasada"]).gte("scheduled_at", inicio).lt("scheduled_at", fim)
    : null;
  const tarefasAtrasadas = comercial
    ? supabase.from("qs_tasks").select("id", { count: "exact", head: true }).eq("owner_id", u.id)
        .in("status", ["pendente", "atrasada"]).lt("scheduled_at", inicio)
    : null;
  const sols = supabase.from("qs_solicitacoes_v")
    .select("id, numero, titulo, sobre_nome, prazo, vencida, status, para_setor, de_setor, responsavel_id, criado_por")
    .eq("responsavel_id", u.id).eq("aberta", true).order("prazo", { ascending: true, nullsFirst: false }).limit(10);

  const [r, th, ta, s, esteira] = await Promise.all([
    reunioes, tarefasHoje, tarefasAtrasadas, sols,
    setores.includes("relacionamento") ? esteiraDeHoje(u.id).catch(() => null) : Promise.resolve(null),
  ]);
  if (s.error) throw new Error(s.error.message);
  return {
    reunioes: ((r?.data ?? []) as { id: string; title: string | null; lead_name: string | null; lead_id: string | null; scheduled_at: string; status: string }[])
      .map((m) => ({ id: m.id, nome: m.lead_name || m.title || "Reunião", lead_id: m.lead_id, scheduled_at: m.scheduled_at, status: m.status })),
    tarefas: th && ta ? { hoje: th.count ?? 0, atrasadas: ta.count ?? 0 } : null,
    solicitacoes: (s.data ?? []) as SolAberta[],
    esteira,
  };
}

/**
 * Etapas da Esteira (Relacionamento) das MINHAS viagens que vencem hoje ou já
 * atrasaram — a mesma conta de "Minhas atividades" (src/rel/lib/etapas.ts).
 */
async function esteiraDeHoje(userId: string): Promise<EtapaHoje[]> {
  const { estadoDaEsteira, etapasDe, ETAPA } = await import("@/rel/lib/etapas");
  const hoje = hojeSP();
  const { data, error } = await supabase.from("rel_viagens_v")
    .select("id, titulo, expedicao, cliente_nome, data_venda, data_embarque, data_retorno, acompanhamento, fase")
    .eq("responsavel_id", userId).eq("status", "ativa").in("acompanhamento", ["completo", "leve"])
    .not("data_embarque", "is", null).in("fase", ["antes", "em_viagem", "concluida"])
    .order("data_embarque", { ascending: true }).limit(300);
  if (error) throw new Error(error.message);
  type V = { id: string; titulo: string; expedicao: string | null; cliente_nome: string | null; data_venda: string | null; data_embarque: string | null; data_retorno: string | null; acompanhamento: "completo" | "leve"; fase: string };
  const dez = new Date(`${hoje}T12:00:00Z`); dez.setUTCDate(dez.getUTCDate() - 10);
  const limite = dez.toISOString().slice(0, 10);
  const vs = ((data ?? []) as V[]).filter((v) => v.fase !== "concluida" || (v.data_retorno ?? "") >= limite);
  if (!vs.length) return [];
  const regs = await etapasDe(vs.map((v) => v.id));
  const out: EtapaHoje[] = [];
  for (const v of vs) {
    const { atual } = estadoDaEsteira(v, regs.get(v.id) ?? [], hoje);
    if (!atual) continue;
    const atrasada = atual.situacao === "atrasada";
    if (!atrasada && !(atual.situacao === "a_fazer" && atual.prazo === hoje)) continue;
    const nome = [v.cliente_nome, v.expedicao || v.titulo].filter(Boolean).join(" · ");
    out.push({ viagem_id: v.id, titulo: nome || "Viagem", etapa: ETAPA[atual.id]?.nome ?? atual.id, atrasada });
  }
  return out.sort((a, b) => Number(b.atrasada) - Number(a.atrasada));
}

// ── Perguntar (api/assistente.js) ──────────────────────────────────────────

export interface LinkResposta { rotulo: string; hash: string }
export interface RespostaAssistente { resposta: string; links?: LinkResposta[] }
export interface MensagemChat { de: "eu" | "qs"; texto: string; links?: LinkResposta[] }

export async function perguntar(pergunta: string, historico: MensagemChat[]): Promise<RespostaAssistente> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sua sessão expirou. Entre de novo.");
  const r = await fetch("/api/assistente", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      pergunta,
      historico: historico.slice(-6).map((m) => ({ de: m.de, texto: m.texto.slice(0, 1500) })),
    }),
  });
  const j = (await r.json().catch(() => null)) as (RespostaAssistente & { error?: string }) | null;
  if (!r.ok || !j?.resposta) throw new Error(j?.error || "Não consegui responder agora. Tente de novo em instantes.");
  return j;
}
