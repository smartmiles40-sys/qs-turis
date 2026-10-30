// src/mkt/drive/formato.ts — formatação pura (testada em tests/mkt-drive).
import type { FiltrosBusca, TipoArquivo } from "./tipos.ts";

export function formatarTamanho(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u[i]}`;
}

export function formatarDuracao(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatarData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}

export const ROTULO_TIPO: Record<TipoArquivo, string> = {
  pasta: "Pasta", video: "Vídeo", imagem: "Imagem", audio: "Áudio", pdf: "PDF", documento: "Documento Google", outro: "Arquivo",
};

/** Há algum filtro ligado? (decide entre "navegar na pasta" e "buscar"). */
export function temFiltro(f: FiltrosBusca): boolean {
  return !!(f.texto.trim() || f.tipo || f.desde || f.ate || f.tags.length || f.expedicaoId);
}

/** Pedido de busca no índice a partir dos filtros da tela. */
export function corpoBusca(f: FiltrosBusca, pastaAtual: string | null, offset = 0) {
  return {
    acao: "buscar_indice",
    texto: f.texto.trim() || undefined,
    tipo: f.tipo || undefined,
    desde: f.desde || undefined,
    ate: f.ate || undefined,
    tags: f.tags.length ? f.tags : undefined,
    expedicaoId: f.expedicaoId || undefined,
    pastaId: f.soNestaPasta && pastaAtual ? pastaAtual : undefined,
    offset,
  };
}

/** O <video> do navegador toca isto? (o resto abre na visualização do Drive). */
export function tocaNoNavegador(mime: string): boolean {
  return /^video\/(mp4|webm|ogg|quicktime)$/.test(mime) || /^audio\//.test(mime);
}
