// src/lib/qs/monitorDistribuicao.ts
// -----------------------------------------------------------------------------
// O MONITOR DE DISTRIBUIÇÃO — o lado do navegador (a conta mora na 0094).
//
// A régua é QUEM RECEBEU o lead na chegada (qs_lead_entradas), não o dono de
// hoje. O dono de hoje muda quando o lead vira reunião (vai pro closer) — e foi
// essa troca que fez o time achar que a distribuição estava torta (28/09).
//
// "Novo" é o lead que o RODÍZIO distribuiu. "Retorno" é a mesma pessoa voltando,
// que a carteira devolve pro mesmo SDR. Justiça do rodízio se mede nos novos.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

export type Canal = "live" | "trafego" | "organico" | "outros";

export interface LinhaSdr {
  sdr_id: string | null;
  nome: string | null;
  papel: string | null;
  total: number;
  novos: number;
  retornos: number;
  semana: number;
  fds: number;
  fds_novos: number;
  sabado: number;
  domingo: number;
  live: number;
  live_novos: number;
  trafego: number;
  organico: number;
  outros: number;
}

export interface LinhaDia { dia: string; sdr_id: string | null; total: number; novos: number }
export interface LinhaLive { destino: string; sdr_id: string | null; total: number; novos: number }
export interface LinhaCloser {
  closer_id: string;
  nome: string | null;
  leads: number;
  primeiras: number;
  retomadas: number;
  fds: number;
  autoagendamento: number;
  realizadas: number;
}

export interface Monitor {
  de: string;
  ate: string;
  sdrs: LinhaSdr[];
  por_dia: LinhaDia[];
  lives: LinhaLive[];
  closers: LinhaCloser[];
}

export interface LeadDistribuido {
  lead_id: string;
  chegou_em: string;
  retorno: boolean;
  sdr_id: string | null;
  recebeu: string | null;
  dono_atual_id: string | null;
  dono_atual: string | null;
  nome: string | null;
  telefone: string | null;
  fonte: string | null;
  canal: string;
  destino: string | null;
  status: string | null;
  bitrix_id: string | null;
  fim_de_semana: boolean;
}

export async function fetchMonitor(de: string, ate: string): Promise<Monitor> {
  const { data, error } = await supabase.rpc("qs_monitor_distribuicao", { p_de: de, p_ate: ate });
  if (error) throw error;
  const d = (data ?? {}) as Partial<Monitor>;
  return {
    de, ate,
    sdrs: d.sdrs ?? [],
    por_dia: d.por_dia ?? [],
    lives: d.lives ?? [],
    closers: d.closers ?? [],
  };
}

export async function fetchLista(
  de: string, ate: string,
  filtro: { sdr?: string | null; canal?: Canal | null; soFds?: boolean } = {},
): Promise<LeadDistribuido[]> {
  const { data, error } = await supabase.rpc("qs_monitor_distribuicao_lista", {
    p_de: de,
    p_ate: ate,
    p_sdr: filtro.sdr ?? null,
    p_canal: filtro.canal ?? null,
    p_so_fds: !!filtro.soFds,
  });
  if (error) throw error;
  return (data ?? []) as LeadDistribuido[];
}

// ── Períodos (sempre no fuso de São Paulo) ──────────────────────────────────

function diaSP(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function somaDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 1 = segunda … 7 = domingo, do dia ISO. */
function diaDaSemana(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export type PeriodoId = "fds" | "semana" | "7d" | "30d" | "mes";

export const PERIODOS: { id: PeriodoId; rotulo: string }[] = [
  { id: "fds", rotulo: "Último fim de semana" },
  { id: "semana", rotulo: "Esta semana" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes", rotulo: "Este mês" },
];

export function intervaloDo(p: PeriodoId, agora = new Date()): { de: string; ate: string } {
  const hoje = diaSP(agora);
  const dow = diaDaSemana(hoje);
  switch (p) {
    case "fds": {
      // Sábado/domingo mais recentes. Se hoje é sábado, conta o de hoje.
      const sabado = dow === 6 ? hoje : dow === 7 ? somaDias(hoje, -1) : somaDias(hoje, -(dow + 1));
      return { de: sabado, ate: somaDias(sabado, 1) };
    }
    case "semana":
      return { de: somaDias(hoje, -(dow - 1)), ate: hoje };
    case "7d":
      return { de: somaDias(hoje, -6), ate: hoje };
    case "30d":
      return { de: somaDias(hoje, -29), ate: hoje };
    case "mes":
      return { de: hoje.slice(0, 8) + "01", ate: hoje };
  }
}

export const ROTULO_CANAL: Record<string, string> = {
  live: "Live",
  trafego: "Tráfego",
  organico: "Orgânico",
  outros: "Outros",
  sem_fonte: "Sem fonte",
};

/** A relação em CSV (abre no Excel com acento: BOM + ponto e vírgula). */
export function listaEmCsv(linhas: LeadDistribuido[]): string {
  const cab = ["Chegou em", "Recebeu", "Dono hoje", "Lead", "Telefone", "Fonte", "Canal", "Destino", "Novo/Retorno", "Fim de semana", "Status", "Bitrix"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = linhas.map((l) => [
    new Date(l.chegou_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    l.recebeu, l.dono_atual, l.nome, l.telefone, l.fonte,
    ROTULO_CANAL[l.canal] ?? l.canal, l.destino,
    l.retorno ? "Retorno" : "Novo", l.fim_de_semana ? "Sim" : "Não",
    l.status, l.bitrix_id,
  ].map(esc).join(";"));
  return "﻿" + [cab.join(";"), ...corpo].join("\n");
}
