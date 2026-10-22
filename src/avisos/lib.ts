// src/avisos/lib.ts
// -----------------------------------------------------------------------------
// AVISOS NA TELA (0196, Bruno 22/10/2026): "um bip na tela toda vez que a
// pessoa tiver uma nova solicitação; ícone bem pequeno que a pessoa arrasta".
//
// O banco cria os avisos (gatilhos + cron /api/avisos) em qs_avisos — cada um
// só lê os seus. Aqui ficam: leitura, "marcar lido", o bip, as preferências e
// o que fazer ao clicar num aviso (abrir a tela certa, trocando de área se
// precisar). Ver docs/AVISOS.md.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Setor } from "@/components/sdr/types";

export type TipoAviso = "solicitacao" | "prazo" | "reuniao" | "esteira" | "tarefas";

export interface Aviso {
  id: number;
  user_id: string;
  tipo: TipoAviso | string;
  area: Setor | null;
  titulo: string;
  texto: string | null;
  link: string | null;
  origem: string | null;
  origem_id: string | null;
  criado_em: string;
  lido_em: string | null;
}

const CAMPOS = "id, user_id, tipo, area, titulo, texto, link, origem, origem_id, criado_em, lido_em";
/** Quantos não lidos a tela carrega (o contador mostra "50+" acima disso). */
export const LIMITE = 50;

/** Os não lidos, do mais novo pro mais velho — 1 consulta no índice (user_id, lido_em, criado_em). */
export async function carregarNaoLidos(userId: string): Promise<Aviso[]> {
  const { data, error } = await supabase.from("qs_avisos").select(CAMPOS)
    .eq("user_id", userId).is("lido_em", null)
    .order("criado_em", { ascending: false }).limit(LIMITE + 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as Aviso[];
}

/** Os últimos já lidos (pra consulta no painel). */
export async function carregarLidos(userId: string, limite = 15): Promise<Aviso[]> {
  const { data, error } = await supabase.from("qs_avisos").select(CAMPOS)
    .eq("user_id", userId).not("lido_em", "is", null)
    .order("criado_em", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Aviso[];
}

export async function marcarLidos(ids: number[] | "todos"): Promise<void> {
  const { error } = await supabase.rpc("qs_avisos_marcar_lidos", ids === "todos" ? { p_todos: true } : { p_ids: ids });
  if (error) throw new Error(error.message);
}

// ── Preferências (só neste computador) ─────────────────────────────────────

export interface PrefsAvisos {
  /** Silenciar o bip (na aba e na bolinha). */
  semBip: boolean;
  /** Não mostrar a notificação do Windows mesmo com permissão. */
  semWindows: boolean;
  /** A pessoa usa a bolinha flutuante (pra oferecer reabrir). */
  bolinha: boolean;
}
const CHAVE_PREFS = "qs_avisos_prefs";
const PADRAO: PrefsAvisos = { semBip: false, semWindows: false, bolinha: false };

export function lerPrefs(): PrefsAvisos {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_PREFS) || "{}") as Partial<PrefsAvisos>;
    return { ...PADRAO, ...p };
  } catch { return { ...PADRAO }; }
}
export function gravarPrefs(p: PrefsAvisos) {
  try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(p)); } catch { /* sem memória: só não lembra */ }
}

/**
 * Só UMA aba toca o bip / mostra o Windows pra cada aviso (quem tem o QS aberto
 * em 3 abas não ouve 3 bips). A primeira que "carimbar" o aviso ganha.
 */
export function pegarVez(id: number): boolean {
  const k = `qs_aviso_vez_${id}`;
  try {
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, String(Date.now()));
    // faxina dos carimbos velhos (mais de 1 dia)
    if (Math.random() < 0.1) {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const c = localStorage.key(i);
        if (c?.startsWith("qs_aviso_vez_") && Date.now() - Number(localStorage.getItem(c) || 0) > 86_400_000) localStorage.removeItem(c);
      }
    }
    return true;
  } catch { return true; }
}

// ── Bip (Web Audio, sem arquivo) ────────────────────────────────────────────

let audio: AudioContext | null = null;
/** Prepara o som num clique (o navegador só libera áudio depois de um gesto). */
export function prepararSom() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    if (audio.state === "suspended") void audio.resume();
  } catch { /* sem som */ }
}

/** Dois toquinhos curtos (≈ 0,3 s). */
export function bip() {
  try {
    prepararSom();
    const ctx = audio;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    [0, 0.16].forEach((atraso, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1175;
      vol.gain.setValueAtTime(0.0001, t + atraso);
      vol.gain.exponentialRampToValueAtTime(0.18, t + atraso + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.13);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t + atraso);
      osc.stop(t + atraso + 0.15);
    });
  } catch { /* sem som */ }
}

// ── Textos ──────────────────────────────────────────────────────────────────

export function haQuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export const COR_TIPO: Record<string, string> = {
  solicitacao: "#0147FF",
  prazo: "#DC2626",
  reuniao: "#6D28D9",
  esteira: "#0E7C6A",
  tarefas: "#B45309",
};
export const ROTULO_TIPO: Record<string, string> = {
  solicitacao: "Solicitação",
  prazo: "Prazo",
  reuniao: "Reunião",
  esteira: "Esteira",
  tarefas: "Tarefas",
};

/** Bolinha flutuante: só Chrome/Edge 116+ têm a "janela por cima de tudo". */
export function temBolinha(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}
export function temNotificacao(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}
