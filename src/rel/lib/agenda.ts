// src/rel/lib/agenda.ts
// -----------------------------------------------------------------------------
// AGENDA DO RELACIONAMENTO (0123, 14/10/2026).
//
// Ler vai sempre pela view rel_agenda_v: ela devolve a agenda de TODO o time
// (é o panorama), com o compromisso privado dos outros virando "Ocupado".
// Escrever vai na tabela — a RLS deixa o dono mexer na dele e a gestora/admin
// em qualquer uma.
//
// Horas: a tela trabalha no horário do navegador (o time está em São Paulo);
// no banco é timestamptz, então o instante é sempre o certo.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type TipoEvento = "reuniao" | "ligacao" | "tarefa" | "visita" | "embarque" | "pessoal" | "outro";

export const TIPOS_EVENTO: Record<TipoEvento, { rotulo: string; cor: string }> = {
  reuniao: { rotulo: "Reunião", cor: "#0E7C6A" },
  ligacao: { rotulo: "Ligação", cor: "#2563EB" },
  tarefa: { rotulo: "Tarefa", cor: "#7C3AED" },
  visita: { rotulo: "Visita", cor: "#D97706" },
  embarque: { rotulo: "Embarque", cor: "#DB2777" },
  pessoal: { rotulo: "Pessoal", cor: "#64748B" },
  outro: { rotulo: "Outro", cor: "#0891B2" },
};

export interface Evento {
  id: string;
  dono_id: string;
  dono_nome: string | null;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  tipo: TipoEvento;
  privado: boolean;
  /** Privado de outra pessoa: só o horário aparece. */
  mascarado: boolean;
  titulo: string;
  descricao: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  viagem_id: string | null;
  conversa_id: string | null;
  local: string | null;
  link: string | null;
}

export interface EventoForm {
  id?: string;
  dono_id: string;
  titulo: string;
  descricao: string | null;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  tipo: TipoEvento;
  privado: boolean;
  cliente_id: string | null;
  viagem_id?: string | null;
  conversa_id?: string | null;
  local: string | null;
  link: string | null;
}

export interface PessoaDoTime { id: string; name: string; role: string }

export interface Embarque { id: string; titulo: string; data_embarque: string; cliente_nome: string | null; responsavel_id: string | null; tipo: string | null }

/** Eventos que encostam no período [de, ate). */
export async function listarEventos(de: Date, ate: Date, donoId?: string | null): Promise<Evento[]> {
  let q = supabase.from("rel_agenda_v").select("*")
    .lt("inicio", ate.toISOString())
    // Encosta no período: termina depois do começo OU (duração zero) começa nele.
    .or(`fim.gt.${de.toISOString()},inicio.gte.${de.toISOString()}`)
    .order("inicio").limit(2000);
  if (donoId) q = q.eq("dono_id", donoId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Evento[];
}

export async function salvarEvento(f: EventoForm): Promise<void> {
  const campos = {
    dono_id: f.dono_id,
    titulo: f.titulo.trim(),
    descricao: f.descricao?.trim() || null,
    inicio: f.inicio,
    fim: f.fim,
    dia_inteiro: f.dia_inteiro,
    tipo: f.tipo,
    privado: f.privado,
    cliente_id: f.cliente_id,
    viagem_id: f.viagem_id ?? null,
    conversa_id: f.conversa_id ?? null,
    local: f.local?.trim() || null,
    link: f.link?.trim() || null,
  };
  const r = f.id
    ? await supabase.from("rel_agenda").update(campos).eq("id", f.id).select("id")
    : await supabase.from("rel_agenda").insert(campos);
  // UPDATE barrado pela RLS não dá erro: só não muda nenhuma linha.
  if (f.id && !r.error && !(r.data as unknown[] | null)?.length) throw new Error("Sem permissão pra mudar isso.");
  if (r.error) {
    if (r.error.message.includes("row-level")) throw new Error("Você só mexe na sua agenda. A de outra pessoa, só a gestora ou o admin.");
    if (r.error.message.includes("rel_agenda_fim_depois")) throw new Error("O fim tem que ser depois do início.");
    throw new Error(r.error.message);
  }
}

export async function apagarEvento(id: string): Promise<void> {
  const { error } = await supabase.from("rel_agenda").delete().eq("id", id);
  if (error) throw new Error(error.message.includes("row-level") ? "Só o dono ou a gestora apaga." : error.message);
}

/** O time do Relacionamento: ativos com o setor (admins entram — têm os dois setores). */
export async function listarTime(): Promise<PessoaDoTime[]> {
  const { data, error } = await supabase.from("qs_users").select("id, name, role, setores, is_active")
    .eq("is_active", true).contains("setores", ["relacionamento"]).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as (PessoaDoTime & { setores: string[] })[]).map(({ id, name, role }) => ({ id, name, role }));
}

/** Embarques de viagens ativas no período (camada só de leitura). */
export async function listarEmbarques(de: Date, ate: Date): Promise<Embarque[]> {
  const { data, error } = await supabase.from("rel_viagens_v")
    .select("id, titulo, data_embarque, cliente_nome, responsavel_id, tipo")
    .eq("status", "ativa").gte("data_embarque", diaIso(de)).lt("data_embarque", diaIso(ate))
    .order("data_embarque").limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Embarque[];
}

// ── Datas: SEMPRE no horário de São Paulo ───────────────────────────────────
// O time está em SP, mas um notebook em outro fuso mostraria (e gravaria) tudo
// deslocado. Como o Brasil não tem horário de verão desde 2019, SP é UTC−3
// fixo: dá pra fazer a conta direto, sem depender do fuso do navegador.

export const DIA_MS = 86_400_000;
export const FUSO = "America/Sao_Paulo";
const OFFSET_MS = -3 * 3600_000;

/** As partes de uma data no relógio de SP (mes começa em 0, dow 0 = domingo). */
export function sp(d: Date) {
  const w = new Date(d.getTime() + OFFSET_MS);
  return { ano: w.getUTCFullYear(), mes: w.getUTCMonth(), dia: w.getUTCDate(), hora: w.getUTCHours(), min: w.getUTCMinutes(), dow: w.getUTCDay() };
}
/** Data a partir das partes do relógio de SP. */
export function deSp(ano: number, mes: number, dia: number, hora = 0, min = 0): Date {
  return new Date(Date.UTC(ano, mes, dia, hora, min) - OFFSET_MS);
}
/** toLocaleDateString já no fuso de SP. */
export const fmtSP = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("pt-BR", { ...o, timeZone: FUSO });

export function inicioDoDia(d: Date): Date { const p = sp(d); return deSp(p.ano, p.mes, p.dia); }
export function somarDias(d: Date, n: number): Date { return new Date(d.getTime() + n * DIA_MS); }
/** O dia de `d` às `hora`:`min` (SP). */
export function comHora(d: Date, hora: number, min = 0): Date { const p = sp(d); return deSp(p.ano, p.mes, p.dia, hora, min); }
/** Segunda-feira da semana. */
export function inicioDaSemana(d: Date): Date { const x = inicioDoDia(d); const dow = (sp(x).dow + 6) % 7; return somarDias(x, -dow); }
export function inicioDoMes(d: Date): Date { const p = sp(d); return deSp(p.ano, p.mes, 1); }
/** Dia 1 do mês `passo` meses depois (ou antes). */
export function somarMeses(d: Date, passo: number): Date { const p = sp(d); return deSp(p.ano, p.mes + passo, 1); }
export function mesmoDia(a: Date, b: Date) { return diaIso(a) === diaIso(b); }
/** "2026-10-14" no relógio de SP. */
export function diaIso(d: Date): string {
  const p = sp(d);
  return `${p.ano}-${String(p.mes + 1).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}
/** "2026-10-14" + "09:30" → o instante em SP. */
export function juntar(dia: string, hora: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  const [h, mi] = (hora || "00:00").split(":").map(Number);
  return deSp(a, m - 1, d, h || 0, mi || 0);
}
export function horaHHMM(d: Date): string { const p = sp(d); return `${String(p.hora).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`; }

export const horaCurtaBR = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

/** Minutos ocupados de um evento dentro de [de, ate). */
export function minutosNoPeriodo(e: Pick<Evento, "inicio" | "fim">, de: Date, ate: Date): number {
  const i = Math.max(new Date(e.inicio).getTime(), de.getTime());
  const f = Math.min(new Date(e.fim).getTime(), ate.getTime());
  return Math.max(0, Math.round((f - i) / 60_000));
}

export function duracaoCurta(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
