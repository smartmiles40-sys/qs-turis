// src/lib/qs/waLinha.ts
// -----------------------------------------------------------------------------
// O WHATSAPP DO PRÓPRIO SDR (0082, 21/09/2026): o estado da linha de quem está
// logado, compartilhado entre as telas (a aba WhatsApp, o chat, o modo aparelho).
//
// Um só estado pro app inteiro, de propósito: o chat decide "mando pelo meu
// número ou abro o celular?" olhando isto. Se cada tela buscasse a sua cópia, o
// SDR conectaria na aba WhatsApp e o chat aberto no card continuaria dizendo
// "responda pelo celular" até alguém recarregar.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/qs/waInbox";

export type EstadoLinha = "open" | "close" | "connecting" | string;

export interface MinhaLinha {
  user_id: string;
  instancia: string;
  numero: string | null;
  status: EstadoLinha;
  status_em: string | null;
  conectado_em: string | null;
  historico_em: string | null;
}

export interface LinhaDoTime extends MinhaLinha {
  usuario: { name: string; role: string } | null;
}

export interface RespostaLinha {
  ok?: boolean;
  error?: string;
  motivo?: string;
  base64?: string | null;
  pairingCode?: string | null;
  jaConectada?: boolean;
  estado?: EstadoLinha;
  numero?: string | null;
  historicoEm?: string | null;
  // importação do histórico
  cursor?: number;
  total?: number;
  importadas?: number;
  leads?: number;
  fim?: boolean;
  aindaSincronizando?: boolean;
  resumo?: { conversas: number; semTelefone: number; semLead: number; comLead: number; lid: number };
}

// ── Estado compartilhado ────────────────────────────────────────────────────

let atual: MinhaLinha | null = null;
let carregado = false;
let buscando: Promise<void> | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

async function buscar(): Promise<void> {
  try {
    const r = await fetch("/api/wa-linha", { headers: await authHeaders() });
    // 503 = Evolution/migration não configurada: é "sem linha", não erro de tela.
    const d = r.ok ? await r.json() : null;
    atual = (d?.linha as MinhaLinha | null) ?? null;
  } catch {
    // rede caiu: mantém o último estado conhecido
  } finally {
    carregado = true;
    avisar();
  }
}

/** Relê a linha do servidor (depois de conectar, desconectar, importar). */
export function recarregarMinhaLinha(): Promise<void> {
  if (!buscando) buscando = buscar().finally(() => { buscando = null; });
  return buscando;
}

/** Ajuste local imediato, sem esperar a próxima leitura. */
export function marcarMinhaLinha(patch: Partial<MinhaLinha>) {
  if (!atual) return;
  atual = { ...atual, ...patch };
  avisar();
}

/**
 * A linha de quem está logado. `noAr` é o que o resto do app consulta.
 * Relê a cada 2 minutos e quando a aba volta ao foco: o chip pode cair a
 * qualquer hora, e o SDR precisa saber antes de escrever, não depois.
 */
export function useMinhaLinha() {
  const [, forcar] = useState(0);
  useEffect(() => {
    const f = () => forcar((n) => n + 1);
    ouvintes.add(f);
    if (!carregado) void recarregarMinhaLinha();
    const t = window.setInterval(() => void recarregarMinhaLinha(), 120_000);
    const foco = () => { if (document.visibilityState === "visible") void recarregarMinhaLinha(); };
    document.addEventListener("visibilitychange", foco);
    return () => {
      ouvintes.delete(f);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", foco);
    };
  }, []);
  return { linha: atual, carregado, noAr: atual?.status === "open" };
}

// ── Chamadas ────────────────────────────────────────────────────────────────

export async function acaoDaLinha(
  acao: "conectar" | "estado" | "desconectar" | "historico",
  extra: { cursor?: number; userId?: string; telefone?: string } = {},
): Promise<RespostaLinha> {
  try {
    const r = await fetch("/api/wa-linha", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao, ...extra }),
    });
    const d = (await r.json().catch(() => ({}))) as RespostaLinha;
    if (!r.ok) return { ok: false, error: d.error || `Erro ${r.status}`, motivo: d.motivo };
    return { ok: true, ...d };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** As linhas do time todo (gestão e closer). */
export async function linhasDoTime(): Promise<LinhaDoTime[]> {
  try {
    const r = await fetch("/api/wa-linha?todas=1", { headers: await authHeaders() });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.linhas) ? d.linhas : [];
  } catch {
    return [];
  }
}

/** +55 11 99999-8888 a partir de 5511999998888. */
export function formatarNumero(n: string | null | undefined): string {
  const d = String(n || "").replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : "";
}
