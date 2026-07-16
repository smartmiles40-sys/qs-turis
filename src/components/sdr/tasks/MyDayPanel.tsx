// src/components/sdr/tasks/MyDayPanel.tsx
// -----------------------------------------------------------------------------
// "Meu Dia" — a lista do dia pro SDR ter CONTROLE do que já fez e do que falta
// (pedido do Bruno). Diferente do Painel (que trabalha 1 card por vez), aqui é a
// visão-lista: "A fazer hoje" (pendentes/atrasadas até o fim de hoje) + "Feitas
// hoje" (concluídas com completed_at de hoje), com um placar no topo.
// A RLS já devolve só o que é do SDR logado.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";

const BLUE = "#0147FF";
const GREEN = "#0E7C6A";
const RED = "#DC2626";

const CHANNEL_LABEL: Record<string, string> = {
  pesquisa: "Pesquisa", email: "E-mail", ligacao: "Ligação", whatsapp: "WhatsApp",
  ligacao_whatsapp: "Ligação WhatsApp", linkedin: "LinkedIn", instagram: "Instagram",
  tiktok: "TikTok", youtube: "YouTube",
};
const PRIO: Record<string, { label: string; color: string }> = {
  alta: { label: "alta", color: RED },
  media: { label: "média", color: "#B45309" },
  baixa: { label: "baixa", color: "#6B7280" },
};

interface DayTask {
  id: string;
  lead_id: string;
  leadName: string;
  channel_type: string;
  priority: string;
  scheduled_at: string;
  completed_at: string | null;
  overdue: boolean;
}

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday(): Date { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function hhmm(iso: string): string { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

export default function MyDayPanel() {
  const [todo, setTodo] = useState<DayTask[]>([]);
  const [done, setDone] = useState<DayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const start0 = startOfToday();
      const [pendRes, doneRes, leadsRes] = await Promise.all([
        supabase.from("qs_tasks").select("id, lead_id, channel_type, priority, scheduled_at, completed_at")
          .in("status", ["pendente", "atrasada"]).lte("scheduled_at", endOfToday().toISOString()).order("scheduled_at"),
        supabase.from("qs_tasks").select("id, lead_id, channel_type, priority, scheduled_at, completed_at")
          .eq("status", "concluida").gte("completed_at", start0.toISOString()).order("completed_at", { ascending: false }),
        supabase.from("qs_leads").select("id, full_name"),
      ]);
      if (pendRes.error) throw pendRes.error;
      if (doneRes.error) throw doneRes.error;

      const names = new Map((leadsRes.data ?? []).map((l: any) => [l.id, l.full_name]));
      const start0ms = start0.getTime();
      const map = (rows: any[]): DayTask[] => rows.map((t) => ({
        id: t.id,
        lead_id: t.lead_id,
        leadName: names.get(t.lead_id) ?? "Lead",
        channel_type: t.channel_type,
        priority: t.priority,
        scheduled_at: t.scheduled_at,
        completed_at: t.completed_at ?? null,
        overdue: new Date(t.scheduled_at).getTime() < start0ms,
      }));
      setTodo(map(pendRes.data ?? []));
      setDone(map(doneRes.data ?? []));
    } catch (e: any) {
      console.warn("[meu-dia] falha:", e?.message);
      setError(true);
      notifyError("Não foi possível carregar as atividades do dia.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalHoje = todo.length + done.length;
  const pctFeito = totalHoje > 0 ? Math.round((done.length / totalHoje) * 100) : 0;
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h1 className="text-xl font-extrabold text-gray-900">Meu Dia</h1>
          <button onClick={load} className="text-sm font-semibold" style={{ color: BLUE }}>Atualizar</button>
        </div>
        <p className="text-sm text-gray-500 mb-5 capitalize">{hoje}</p>

        {loading ? (
          <div className="text-sm text-gray-400 py-16 text-center">Carregando…</div>
        ) : error ? (
          <div className="text-sm text-gray-400 py-16 text-center">Não foi possível carregar.</div>
        ) : (
          <>
            {/* Placar do dia */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-900">
                  {done.length} de {totalHoje} feitas hoje
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: GREEN }}>{pctFeito}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pctFeito}%`, background: GREEN, transition: "width .3s" }} />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                <b style={{ color: BLUE }}>{todo.length}</b> a fazer
                {todo.some((t) => t.overdue) && <> · <b style={{ color: RED }}>{todo.filter((t) => t.overdue).length}</b> atrasada(s)</>}
              </div>
            </div>

            {/* A fazer */}
            <Section title={`A fazer (${todo.length})`} empty="Tudo feito por hoje! 🎉" rows={todo} kind="todo" />
            {/* Feitas */}
            <Section title={`Feitas hoje (${done.length})`} empty="Nenhuma atividade concluída ainda hoje." rows={done} kind="done" />
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, rows, kind }: { title: string; empty: string; rows: DayTask[]; kind: "todo" | "done" }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5">
      <h2 className="text-sm font-bold text-gray-900 px-5 pt-4 pb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 px-5 pb-4">{empty}</p>
      ) : (
        <ul>
          {rows.map((t) => {
            const prio = PRIO[t.priority] ?? PRIO.baixa;
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 border-t border-gray-50">
                <span className="shrink-0 w-5 text-center" style={{ color: kind === "done" ? GREEN : "#D1D5DB" }}>
                  {kind === "done" ? "✓" : "○"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium truncate ${kind === "done" ? "text-gray-500 line-through" : "text-gray-900"}`}>{t.leadName}</div>
                  <div className="text-[12px] text-gray-400">{CHANNEL_LABEL[t.channel_type] ?? t.channel_type}</div>
                </div>
                {kind === "todo" && (
                  <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${prio.color}1a`, color: prio.color }}>{prio.label}</span>
                )}
                {kind === "todo" && t.overdue && (
                  <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${RED}1a`, color: RED }}>atrasada</span>
                )}
                <span className="shrink-0 text-[12px] text-gray-400 tabular-nums w-12 text-right">
                  {kind === "done" && t.completed_at ? hhmm(t.completed_at) : hhmm(t.scheduled_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
