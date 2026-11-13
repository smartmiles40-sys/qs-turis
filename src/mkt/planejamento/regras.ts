// src/mkt/planejamento/regras.ts — regras PURAS do planejamento (0395), lado da tela.
// Espelho de api/_mktPlanRegras.js (o teste confere os dois) e de
// mkt_plan_item_faltas() no banco, que é a trava de verdade.

export type Formato = "reels" | "carrossel" | "estatico" | "story" | "video_longo" | "outro";
export type Periodicidade = "mensal" | "semanal" | "diario";
export type Falta = "titulo" | "formato" | "referencia" | "adaptacao" | "perfil" | "data" | "data_fora" | "horario" | "sem_itens";

export const FORMATOS: Formato[] = ["reels", "carrossel", "estatico", "story", "video_longo", "outro"];
export const NOME_FORMATO: Record<Formato, string> = {
  reels: "Reels", carrossel: "Carrossel", estatico: "Estático", story: "Story", video_longo: "Vídeo longo", outro: "Outro",
};
export const NOME_PERIODICIDADE: Record<Periodicidade, string> = { mensal: "Mensal", semanal: "Semanal", diario: "Diário" };

export const NOME_FALTA: Record<Falta, string> = {
  titulo: "título",
  formato: "formato",
  referencia: "referência (link)",
  adaptacao: "como vai ser adaptado para a nossa marca",
  perfil: "onde vai ser postado (perfil)",
  data: "data de postagem",
  data_fora: "data fora do período do planejamento",
  horario: "horário",
  sem_itens: "nenhum conteúdo no planejamento",
};

export interface ItemPlano {
  id?: string;
  ordem?: number;
  titulo?: string;
  formato?: Formato | null;
  referencias?: string[];
  adaptacao?: string | null;
  perfil_ids?: string[];
  data_postagem?: string | null;
  horario?: string | null;
}
export interface Periodo { periodo_inicio: string; periodo_fim: string }
export interface Pendencia { item_id: string | null; ordem?: number; titulo?: string; faltas: Falta[] }

const LINK = /^https?:\/\/\S+$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function faltasDoItem(item: ItemPlano, plan: Periodo, perfisAtivos: string[]): Falta[] {
  const f: Falta[] = [];
  if (String(item.titulo ?? "").trim().length < 3) f.push("titulo");
  if (!item.formato || !FORMATOS.includes(item.formato)) f.push("formato");
  if (!(item.referencias ?? []).some((r) => LINK.test(String(r).trim()))) f.push("referencia");
  if (String(item.adaptacao ?? "").trim().length < 20) f.push("adaptacao");
  const perfis = item.perfil_ids ?? [];
  if (perfis.length === 0 || perfis.some((p) => !perfisAtivos.includes(p))) f.push("perfil");
  const d = item.data_postagem ?? "";
  if (!DATA.test(d)) f.push("data");
  else if (d < plan.periodo_inicio || d > plan.periodo_fim) f.push("data_fora");
  if (!HORA.test(String(item.horario ?? ""))) f.push("horario");
  return f;
}

export function faltasDoPlanejamento(plan: Periodo, itens: ItemPlano[], perfisAtivos: string[]): Pendencia[] {
  if (!itens.length) return [{ item_id: null, faltas: ["sem_itens"] }];
  return itens
    .map((i, n) => ({ item_id: i.id ?? null, ordem: i.ordem ?? n, titulo: i.titulo ?? "", faltas: faltasDoItem(i, plan, perfisAtivos) }))
    .filter((x) => x.faltas.length > 0);
}

export function textoDasFaltas(pendencias: Pendencia[]): string[] {
  return pendencias.map((p) => {
    if (p.faltas.includes("sem_itens")) return NOME_FALTA.sem_itens;
    const nome = p.titulo ? ` (${String(p.titulo).slice(0, 60)})` : "";
    return `Conteúdo ${Number(p.ordem ?? 0) + 1}${nome}: falta ${p.faltas.map((x) => NOME_FALTA[x] ?? x).join(", ")}`;
  });
}

export function periodoValido(periodicidade: Periodicidade, inicio: string, fim: string): string | null {
  if (!DATA.test(inicio ?? "") || !DATA.test(fim ?? "") || fim < inicio) return "Período inválido.";
  const dias = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;
  if (periodicidade === "diario" && dias !== 1) return "Planejamento diário é de um dia só.";
  if (periodicidade === "semanal" && dias > 7) return "Planejamento semanal tem no máximo 7 dias.";
  if (periodicidade === "mensal" && dias > 31) return "Planejamento mensal tem no máximo 31 dias.";
  return null;
}

/** Segunda a domingo da semana de uma data (AAAA-MM-DD). */
export function semanaDe(data: string): { inicio: string; fim: string } {
  const d = new Date(data + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  const ini = new Date(d.getTime() - dow * 86_400_000);
  const fim = new Date(ini.getTime() + 6 * 86_400_000);
  return { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}
