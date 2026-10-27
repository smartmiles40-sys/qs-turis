// src/lib/qs/aereo.ts
// -----------------------------------------------------------------------------
// Cronômetro da COTAÇÃO DE AÉREO do SDR (0206, Bruno 27/10/2026).
//
// Cotação de aéreo não é meta: é tempo que o SDR gasta fora da fila. Ele aperta
// "Cotando aéreo" no card do lead e "Terminei" quando acaba; cada cotação vira
// uma linha em qs_aereo_cotacoes. O Desempenho soma quantidade e horas.
//
// A cotação em andamento é uma só por pessoa (índice parcial no banco). Ela vive
// num pub/sub sem React pra que o botão do card da Fila e o da ficha do lead
// mostrem o mesmo cronômetro.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { notifyError } from "./notify";

export interface CotacaoAereo {
  id: string;
  lead_id: string | null;
  owner_id: string;
  iniciado_em: string;
  terminado_em: string | null;
}

/** null = ainda não carregou; "sem-tabela" = 0206 não aplicada (botão some). */
type Estado = CotacaoAereo | null | "sem-tabela";
let aberta: Estado = null;
let carregada = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function ouvirCotacaoAereo(f: () => void): () => void {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}
export const cotacaoAereoAberta = (): Estado => aberta;
export const cotacaoAereoCarregada = () => carregada;

const semTabela = (code?: string) => code === "PGRST205" || code === "42P01";

/** Lê a cotação em andamento de quem está logado (uma vez por sessão basta). */
export async function carregarCotacaoAberta(ownerId: string, forcar = false): Promise<void> {
  if (carregada && !forcar) return;
  const { data, error } = await supabase
    .from("qs_aereo_cotacoes")
    .select("id, lead_id, owner_id, iniciado_em, terminado_em")
    .eq("owner_id", ownerId)
    .is("terminado_em", null)
    .maybeSingle();
  carregada = true;
  if (error) {
    aberta = semTabela(error.code) ? "sem-tabela" : null;
    if (!semTabela(error.code)) console.warn("[QS] carregarCotacaoAberta:", error);
  } else {
    aberta = (data as CotacaoAereo | null) ?? null;
  }
  avisar();
}

export async function iniciarCotacaoAereo(leadId: string | null): Promise<boolean> {
  const { data, error } = await supabase
    .from("qs_aereo_cotacoes")
    .insert({ lead_id: leadId })
    .select("id, lead_id, owner_id, iniciado_em, terminado_em")
    .single();
  if (error) {
    // 23505 = já existe uma aberta (outra aba). Recarrega em vez de reclamar.
    if (error.code === "23505" && aberta && aberta !== "sem-tabela") return false;
    notifyError(error.code === "23505" ? "Você já tem uma cotação de aéreo em andamento." : "Não foi possível iniciar a cotação de aéreo.");
    return false;
  }
  aberta = data as CotacaoAereo;
  avisar();
  return true;
}

export async function terminarCotacaoAereo(): Promise<boolean> {
  if (!aberta || aberta === "sem-tabela") return false;
  const { error } = await supabase
    .from("qs_aereo_cotacoes")
    .update({ terminado_em: new Date().toISOString() })
    .eq("id", aberta.id);
  if (error) {
    notifyError("Não foi possível encerrar a cotação de aéreo.");
    return false;
  }
  aberta = null;
  avisar();
  return true;
}

/** Apertou por engano: apaga a cotação em andamento sem contar. */
export async function descartarCotacaoAereo(): Promise<boolean> {
  if (!aberta || aberta === "sem-tabela") return false;
  const { error } = await supabase.from("qs_aereo_cotacoes").delete().eq("id", aberta.id);
  if (error) {
    notifyError("Não foi possível descartar a cotação de aéreo.");
    return false;
  }
  aberta = null;
  avisar();
  return true;
}

/** Duração em segundos (em andamento conta até agora). */
export function duracaoSeg(c: Pick<CotacaoAereo, "iniciado_em" | "terminado_em">, agora = Date.now()): number {
  const fim = c.terminado_em ? new Date(c.terminado_em).getTime() : agora;
  return Math.max(0, Math.round((fim - new Date(c.iniciado_em).getTime()) / 1000));
}

/** "1h05" / "12 min" / "45 s". */
export function formatarDuracao(seg: number): string {
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** "07:42" pro cronômetro correndo. */
export function relogio(seg: number): string {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface ResumoAereo { quantidade: number; segundos: number }

/** Cotações iniciadas no período (por SDR quando ownerId vem; time inteiro senão). */
export async function fetchCotacoesAereo(desde: Date, ate: Date, ownerId?: string | null): Promise<CotacaoAereo[]> {
  let q = supabase
    .from("qs_aereo_cotacoes")
    .select("id, lead_id, owner_id, iniciado_em, terminado_em")
    .gte("iniciado_em", desde.toISOString())
    .lt("iniciado_em", ate.toISOString())
    .order("iniciado_em", { ascending: false })
    .limit(1000);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) {
    if (!semTabela(error.code)) console.warn("[QS] fetchCotacoesAereo:", error);
    return [];
  }
  return (data ?? []) as CotacaoAereo[];
}

export function resumir(lista: CotacaoAereo[], agora = Date.now()): ResumoAereo {
  return { quantidade: lista.length, segundos: lista.reduce((s, c) => s + duracaoSeg(c, agora), 0) };
}
