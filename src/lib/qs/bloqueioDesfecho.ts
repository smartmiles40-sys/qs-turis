// src/lib/qs/bloqueioDesfecho.ts
// -----------------------------------------------------------------------------
// AGENDA TRANCADA SEM DESFECHO (Bruno, 21/09/2026).
//
// Closer com reunião de DIA ANTERIOR ainda "agendada"/"confirmada" (sem
// desfecho) não segue pras próximas: na agenda dele, as reuniões de hoje em
// diante ficam trancadas — não abre o card nem o link do Meet — até ele
// registrar o desfecho de todas as atrasadas. As atrasadas continuam abertas
// (é por elas que ele destrava).
//
// Decisões do Bruno:
//   • contam TODAS as atrasadas, não só as de ontem (senão pular um dia apaga
//     a pendência) — em 21/09 eram 23 do Bruno Matheus e 8 da Talita;
//   • trava só a TELA do closer. SDR e o autoagendamento do site continuam
//     marcando na agenda dele normalmente.
//
// Só vale pro papel "closer". Gestão e SDR nunca ficam trancados.
// A regra mora aqui, uma vez: Minha Agenda, Agenda do mês (modal) e Agenda do
// dia perguntam a mesma coisa, senão uma delas vira a porta dos fundos.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";

export const MENSAGEM_BLOQUEIO =
  "Dê o desfecho nas últimas reuniões para poder seguir para as próximas reuniões.";

const ABERTAS = ["agendada", "confirmada"];

export interface ReuniaoPendente {
  id: string;
  scheduled_at: string;
  lead_name: string | null;
}

/** 00:00 de hoje no relógio do computador (o time trabalha em Brasília). */
export function inicioDeHoje(agora = new Date()): Date {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Esta reunião é uma das que PRECISAM de desfecho (dia anterior, ainda aberta)? */
export function ehPendenteDeDesfecho(m: { status: string; scheduled_at: string }): boolean {
  return ABERTAS.includes(m.status) && new Date(m.scheduled_at) < inicioDeHoje();
}

// ── Estado compartilhado ────────────────────────────────────────────────────
// Uma consulta pro app todo: as três telas leem o mesmo resultado, e o
// desfecho registrado em qualquer uma delas destrava todas na hora.

let pendentes: ReuniaoPendente[] = [];
let donoAtual: string | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

async function buscar(user: { id: string; name?: string | null }) {
  const nome = String(user.name ?? "").replace(/[,()]/g, "");
  const { data, error } = await supabase
    .from("qs_meetings")
    .select("id, scheduled_at, lead_name")
    .in("status", ABERTAS)
    .lt("scheduled_at", inicioDeHoje().toISOString())
    .or(`closer_id.eq.${user.id}${nome ? `,meeting_owner.eq.${nome}` : ""}`)
    .order("scheduled_at", { ascending: true })
    .limit(200);
  // Erro de leitura NÃO tranca ninguém: travar a agenda por falha de rede
  // seria punir o closer por um problema nosso.
  pendentes = error ? [] : ((data ?? []) as ReuniaoPendente[]);
  donoAtual = user.id;
  avisar();
}

let usuarioAtual: { id: string; name?: string | null } | null = null;

/** Relê as pendências. Chamado depois de todo desfecho registrado. */
export function recarregarBloqueio(): void {
  if (usuarioAtual) void buscar(usuarioAtual);
}

/**
 * `bloqueado` = closer com reunião de dia anterior sem desfecho.
 * Relê ao montar, a cada 2 minutos e quando a aba volta ao foco.
 */
export function useBloqueioDesfecho() {
  const { currentUser } = useQsAuth();
  const [, forcar] = useState(0);
  const ehCloser = currentUser?.role === "closer";

  useEffect(() => {
    if (!currentUser || !ehCloser) return;
    usuarioAtual = { id: currentUser.id, name: currentUser.name };
    const f = () => forcar((n) => n + 1);
    ouvintes.add(f);
    void buscar(usuarioAtual);
    const t = window.setInterval(() => recarregarBloqueio(), 120_000);
    const foco = () => { if (document.visibilityState === "visible") recarregarBloqueio(); };
    document.addEventListener("visibilitychange", foco);
    return () => {
      ouvintes.delete(f);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", foco);
    };
  }, [currentUser, ehCloser]);

  const meus = ehCloser && donoAtual === currentUser?.id ? pendentes : [];
  return { bloqueado: meus.length > 0, pendentes: meus };
}
