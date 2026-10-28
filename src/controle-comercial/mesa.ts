// src/controle-comercial/mesa.ts
// -----------------------------------------------------------------------------
// Dados da MESA DO SUPERVISOR e do "desativar / afastar" (0215). Tudo passa por
// RPCs SECURITY DEFINER que conferem qs_is_manager() no banco — a tela só
// esconde o botão; quem barra de verdade é o servidor.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { loadWorkHours, overdueCutoff } from "@/lib/workHours";

export type Papel = "sdr" | "closer";

export interface ReuniaoMesa { id: string; em: string; lead_id: string | null; lead_nome: string | null; link: string | null; como: "closer" | "marcou" }
export interface PessoaMesa {
  id: string; nome: string; papel: Papel; ativo: boolean;
  ausente_ate: string | null; ausente_motivo: string | null;
  visto_em: string | null; online_desde: string | null; tela: string | null; acao_atual: string | null;
  lead_id: string | null; lead_nome: string | null; aba_visivel: boolean | null;
  em_ligacao: boolean | null; ligacao_desde: string | null;
  concluidas_hoje: number; pendentes_hoje: number; atrasadas: number; leads_abertos: number;
  ligacoes_hoje: number; atendidas_hoje: number;
  ultima: { em: string; canal: string | null; resultado: string | null; lead_id: string | null; lead_nome: string | null } | null;
  reunioes: ReuniaoMesa[];
}
export interface Mesa { agora: string; pessoas: PessoaMesa[] }

/** Erro que significa "a 0215 ainda não foi aplicada". */
export const faltaMigration = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || e.code === "42P01" || /does not exist|could not find the function/i.test(e.message ?? ""));

export class SemMigration extends Error {
  constructor() { super("A Mesa precisa da migration 0215 aplicada no banco."); }
}

function lanca(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (faltaMigration(error)) throw new SemMigration();
  throw new Error(error.message || "erro ao ler");
}

let corteCache: { dia: string; corte: Date } | null = null;
/** Corte de "atrasada" com a régua de dia útil do sistema (workHours). */
async function corteDeAtraso(): Promise<Date> {
  const dia = new Date().toDateString();
  if (corteCache?.dia === dia) return corteCache.corte;
  const wh = await loadWorkHours().catch(() => null);
  const corte = wh ? overdueCutoff(wh) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  corteCache = { dia, corte };
  return corte;
}

export async function carregarMesa(incluirInativos: boolean): Promise<Mesa> {
  const corte = await corteDeAtraso();
  const { data, error } = await supabase.rpc("qs_mesa_comercial", { p_corte_atraso: corte.toISOString(), p_incluir_inativos: incluirInativos });
  lanca(error);
  const d = (data ?? {}) as { agora?: string; pessoas?: PessoaMesa[] };
  return { agora: d.agora ?? new Date().toISOString(), pessoas: d.pessoas ?? [] };
}

// ── Situação (online / ausente / offline) ────────────────────────────────────
export type Situacao = "ligacao" | "online" | "ausente" | "offline" | "afastado" | "inativo";
/** Online: bateu nos últimos 3 min com a aba visível. Ausente: até 30 min, ou aba escondida. */
export function situacao(p: PessoaMesa, agoraMs: number): Situacao {
  if (!p.ativo) return "inativo";
  if (p.ausente_ate && p.ausente_ate >= new Date(agoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })) return "afastado";
  if (!p.visto_em) return "offline";
  const ha = agoraMs - new Date(p.visto_em).getTime();
  if (p.em_ligacao && ha < 3 * 60_000) return "ligacao";
  if (ha < 3 * 60_000 && p.aba_visivel !== false) return "online";
  if (ha < 30 * 60_000) return "ausente";
  return "offline";
}
export const NOME_SITUACAO: Record<Situacao, string> = {
  ligacao: "Em ligação", online: "Online", ausente: "Ausente", offline: "Offline", afastado: "Afastado", inativo: "Desativado",
};

// ── Afastar / desativar ──────────────────────────────────────────────────────
export interface Previa {
  pessoa: { id: string; nome: string; papel: string; ativo: boolean; ausente_ate: string | null; ausente_motivo: string | null };
  leads_abertos: number; tarefas_abertas: number; reservas_30d: number; negocios_abertos: number;
  reunioes_futuras: { id: string; em: string; ate: string | null; lead_nome: string | null; titulo: string | null }[];
  rodizio: { id: string; nome: string; leads_abertos: number }[];
  closers: { id: string; nome: string }[];
  pessoas: { id: string; nome: string; papel: string }[];
}
export async function previaAfastar(userId: string): Promise<Previa> {
  const { data, error } = await supabase.rpc("qs_comercial_afastar_previa", { p_user: userId });
  lanca(error);
  return data as Previa;
}

export interface PedidoAfastar {
  userId: string;
  modo: "desativar" | "ausencia" | "reativar";
  ausenteAte?: string | null;
  motivo?: string | null;
  /** null = dividir no rodízio. */
  destino?: string | null;
  mover?: boolean;
  reunioes?: { id: string; closer_id: string }[];
  negociosPara?: string | null;
}
export interface ResumoAfastar { leads?: number; tarefas?: number; reservas?: number; reunioes?: number; negocios?: number }
export async function afastar(p: PedidoAfastar): Promise<ResumoAfastar> {
  const { data, error } = await supabase.rpc("qs_comercial_afastar", {
    p_user: p.userId, p_modo: p.modo, p_ausente_ate: p.ausenteAte || null, p_motivo: p.motivo || null,
    p_destino: p.destino || null, p_mover: !!p.mover, p_reunioes: p.reunioes ?? [], p_negocios_para: p.negociosPara || null,
  });
  lanca(error);
  return (data ?? {}) as ResumoAfastar;
}

export interface RegistroAfastamento {
  id: string; user_id: string; feito_por: string | null; modo: string; ausente_ate: string | null; motivo: string | null;
  resumo: ResumoAfastar & { destino?: string | null }; criado_em: string;
}
export async function historicoAfastamentos(): Promise<RegistroAfastamento[]> {
  const { data, error } = await supabase.from("qs_comercial_afastamentos")
    .select("id, user_id, feito_por, modo, ausente_ate, motivo, resumo, criado_em")
    .order("criado_em", { ascending: false }).limit(15);
  lanca(error);
  return (data ?? []) as RegistroAfastamento[];
}

// ── Gravação da reunião ──────────────────────────────────────────────────────
export async function salvarGravacao(meetingId: string, url: string): Promise<void> {
  const { error } = await supabase.rpc("qs_reuniao_gravacao", { p_meeting: meetingId, p_url: url.trim() });
  lanca(error);
}

// ── Formatos ─────────────────────────────────────────────────────────────────
const TZ = "America/Sao_Paulo";
export const horaBr = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const dataHoraCurta = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
export function haQuanto(iso: string | null, agoraMs: number): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((agoraMs - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `há ${Math.floor(h / 24)} d`;
}
export function duracao(desdeIso: string | null, agoraMs: number): string {
  if (!desdeIso) return "";
  const s = Math.max(0, Math.round((agoraMs - new Date(desdeIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s % 60).padStart(2, "0")}`;
}
