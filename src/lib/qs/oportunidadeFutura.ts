// src/lib/qs/oportunidadeFutura.ts
// -----------------------------------------------------------------------------
// OPORTUNIDADE FUTURA (0083, 21/09/2026) — o lado da tela.
//
// O closer registra "o cliente quer, mas só em março" com a data e quem retoma.
// Toda a mudança (Bitrix, dono, fila) acontece no servidor; aqui é só pedir e
// mostrar. Ver api/oportunidade-futura.js.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/qs/waInbox";

export interface OportunidadeFutura {
  id: string;
  lead_id: string;
  meeting_id: string | null;
  criado_por: string | null;
  retomar_em: string;          // AAAA-MM-DD
  quem: "sdr" | "closer";
  responsavel_id: string;
  motivo: string;
  status: "aguardando" | "devolvendo" | "devolvida" | "cancelada";
  devolvida_em: string | null;
  bitrix_ida: string | null;
  bitrix_volta: string | null;
  created_at: string;
}

interface Resposta { ok: boolean; error?: string; motivo?: string; bitrix?: string }

async function chamar(body: Record<string, unknown>): Promise<Resposta> {
  try {
    const r = await fetch("/api/oportunidade-futura", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.error || `Erro ${r.status}`, motivo: d.motivo };
    return { ok: true, ...d };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

export function registrarOportunidadeFutura(dados: {
  leadId: string;
  retomarEm: string;
  quem: "sdr" | "closer";
  motivo: string;
  responsavelId?: string | null;
  meetingId?: string | null;
}) {
  return chamar({ acao: "registrar", ...dados, responsavelId: dados.responsavelId || undefined });
}

export const cancelarOportunidadeFutura = (id: string) => chamar({ acao: "cancelar", id });
export const devolverAgora = (id: string) => chamar({ acao: "devolver-agora", id });

/** A oportunidade EM ABERTO do lead (no máximo uma), ou null. */
export async function oportunidadeAberta(leadId: string): Promise<OportunidadeFutura | null> {
  const { data, error } = await supabase
    .from("qs_oportunidades_futuras")
    .select("*")
    .eq("lead_id", leadId)
    .in("status", ["aguardando", "devolvendo"])
    .maybeSingle();
  if (error) return null;   // 0083 ausente ou sem permissão: a tela só não mostra
  return (data as OportunidadeFutura | null) ?? null;
}

/**
 * "Carona": quem abre a fila acorda a devolução das oportunidades que venceram.
 * O cron da Vercel roda de hora em hora; isto garante que, no dia, a atividade
 * já esteja lá quando o SDR abrir o QS às 8h — sem depender só do agendador.
 * Uma vez a cada 15 min por aba, no máximo.
 */
let ultimaCarona = 0;
export function caronaDasOportunidades() {
  if (Date.now() - ultimaCarona < 15 * 60_000) return;
  ultimaCarona = Date.now();
  void chamar({ acao: "processar" });
}

/** Amanhã, em AAAA-MM-DD (o mínimo aceito). */
export function amanha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE");
}

export function somarDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("sv-SE");
}

export function dataCurta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
