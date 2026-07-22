// src/components/sdr/dashboard/CadenceHealthPanel.tsx
// -----------------------------------------------------------------------------
// "Saúde da Cadência" — a análise agregada do FUP que o Bruno pediu.
// Segmenta a fila ATIVA por PESSOAS (leads), no estágio atual de cada uma:
//   • FUP N        = dia da cadência da atividade atual (lead sem 1º contato =
//                    FUP 1; a categoria "Novo" foi extinta). N = data agendada
//                    vs. a chegada do lead.
//   • Atrasada     = a atividade atual venceu antes de hoje (selo, não balde)
// Mostra: números-chave, distribuição por etapa (funil de FUP), backlog por SDR
// e uma leitura rápida (gargalo / sobrecarga). Manager vê o time; SDR vê o dele
// (a RLS já devolve só o que é de cada um).
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError } from "@/lib/qs/notify";
import { fetchAllRows } from "@/lib/qs/queries";
import { loadWorkHours, workdaysBetween, DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/workHours";

interface LeadStage {
  leadId: string;
  ownerId: string | null;
  fupDay: number; // 1,2,3… (dia da cadência da atividade atual; sem 1º contato = 1)
  overdue: boolean;
  daysOverdue: number;
}

const GREEN = "#0E7C6A";
const AMBER = "#B45309";
const RED = "#DC2626";
const BLUE = "#0147FF";

function startOfDay(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

export default function CadenceHealthPanel() {
  const { currentUser } = useQsAuth();
  const isManager = !!currentUser && canSeeAllData(currentUser.role);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [workHours, setWorkHours] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [loading, setLoading] = useState(true);

  // Horário de Trabalho: "atrasada" e backlog contam só dias ÚTEIS — o fim de
  // semana não gera atraso (nada de "atrasada falsa" na segunda de manhã).
  useEffect(() => { loadWorkHours().then(setWorkHours); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Não-gestor: só o que é DELE. A RLS deixa passar lead/tarefa SEM dono
      // (owner_id is null), que senão apareceria na conta de todos os SDRs.
      const own = !isManager && currentUser ? currentUser.id : null;
      // Tudo paginado (cap 1000 do PostgREST): a fila aberta e a base de leads
      // passam de 1000 rápido — sem paginação, a distribuição por FUP mentiria
      // em silêncio (leads a mais simplesmente sumiriam da conta).
      const tasksP = fetchAllRows<any>((f, t) => {
        let q = supabase.from("qs_tasks").select("lead_id, owner_id, scheduled_at").in("status", ["pendente", "atrasada"]).order("id");
        if (own) q = q.eq("owner_id", own);
        return q.range(f, t);
      });
      const leadsP = fetchAllRows<any>((f, t) => {
        let q = supabase.from("qs_leads").select("id, arrived_at, created_at, status, owner_id").order("id");
        if (own) q = q.eq("owner_id", own);
        return q.range(f, t);
      });
      const [tasks, leads, usersRes] = await Promise.all([
        tasksP, leadsP,
        supabase.from("qs_users").select("id, name").eq("is_active", true),
      ]);

      const leadsById = new Map(leads.map((l: any) => [l.id, l]));
      setUserNames(new Map((usersRes.data ?? []).map((u: any) => [u.id, u.name])));

      // Uma tarefa por lead: a ATUAL = a de menor scheduled_at (a que vence antes).
      const currentByLead = new Map<string, any>();
      for (const t of tasks as any[]) {
        const lead = leadsById.get(t.lead_id);
        if (!lead || lead.status === "ganho" || lead.status === "perdido") continue;
        const prev = currentByLead.get(t.lead_id);
        if (!prev || new Date(t.scheduled_at).getTime() < new Date(prev.scheduled_at).getTime()) {
          currentByLead.set(t.lead_id, t);
        }
      }

      const built: LeadStage[] = [];
      for (const [leadId, t] of currentByLead) {
        const lead = leadsById.get(leadId);
        const base = lead.arrived_at || lead.created_at;
        let fupDay = 1;
        if (base) fupDay = Math.max(1, Math.round((startOfDay(new Date(t.scheduled_at)) - startOfDay(new Date(base))) / 86400000) + 1);
        // Atraso conta só DIAS ÚTEIS: tarefa de sexta vista na segunda = 1 dia
        // útil de atraso, não 3; no fim de semana ela NÃO aparece como atrasada
        // (o fim de semana não gera "atrasada falsa"). Verdade absoluta = work_hours.
        const workLate = workdaysBetween(workHours, new Date(t.scheduled_at), new Date());
        built.push({
          leadId,
          ownerId: t.owner_id ?? lead.owner_id ?? null,
          fupDay,
          overdue: workLate > 0,
          daysOverdue: workLate,
        });
      }
      setStages(built);
    } catch (e: any) {
      console.warn("[saúde-cadência] falha:", e?.message);
      notifyError("Não foi possível carregar a saúde da cadência.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, isManager, workHours]);

  useEffect(() => { load(); }, [load]);

  // ── Agregações ──────────────────────────────────────────────────────────────
  const total = stages.length;
  // "Novo" foi extinto: todo lead aberto é FUP N (sem 1º contato = FUP 1), então
  // a fila inteira conta como "em FUP" — ninguém some da conta.
  const emFup = total;
  const atrasadas = stages.filter((s) => s.overdue).length;
  const backlogDias = stages.reduce((m, s) => Math.max(m, s.daysOverdue), 0);

  // Distribuição por etapa: o funil começa em FUP 1 (cada um com quantos atrasados).
  const buckets: { key: string; label: string; count: number; overdue: number; color: string }[] = [
    { key: "fup1", label: "FUP 1", count: 0, overdue: 0, color: GREEN },
    { key: "fup2", label: "FUP 2", count: 0, overdue: 0, color: AMBER },
    { key: "fup3", label: "FUP 3", count: 0, overdue: 0, color: AMBER },
    { key: "fup4", label: "FUP 4", count: 0, overdue: 0, color: AMBER },
    { key: "fup5", label: "FUP 5+", count: 0, overdue: 0, color: AMBER },
  ];
  for (const s of stages) {
    const idx = Math.min(5, s.fupDay) - 1; // FUP 1→0 … FUP 5+→4
    buckets[idx].count++;
    if (s.overdue) buckets[idx].overdue++;
  }
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));

  // Por SDR (só faz sentido pro gestor; SDR só se enxerga).
  const bySdr = new Map<string, { emFup: number; atrasadas: number; backlog: number }>();
  for (const s of stages) {
    const k = s.ownerId ?? "—";
    const row = bySdr.get(k) ?? { emFup: 0, atrasadas: 0, backlog: 0 };
    row.emFup++; // todo lead aberto é FUP (categoria "Novo" extinta)
    if (s.overdue) row.atrasadas++;
    row.backlog = Math.max(row.backlog, s.daysOverdue);
    bySdr.set(k, row);
  }
  const sdrRows = [...bySdr.entries()]
    .map(([id, v]) => ({ id, name: userNames.get(id) ?? "Sem dono", ...v }))
    .sort((a, b) => b.atrasadas - a.atrasadas || b.emFup - a.emFup);

  // Leitura rápida (heurística simples de gargalo/sobrecarga).
  const insights: string[] = [];
  if (total === 0) insights.push("Sem atividades ativas na fila.");
  else {
    const pctAtrasada = Math.round((atrasadas / total) * 100);
    if (pctAtrasada >= 25) insights.push(`⚠ ${pctAtrasada}% da fila está atrasada — sinal de sobrecarga: talvez a cadência tenha atividades demais pro tamanho do time.`);
    else if (pctAtrasada > 0) insights.push(`${pctAtrasada}% da fila está atrasada (sob controle abaixo de 25%).`);
    if (buckets[1].count > 0 && buckets[0].count > 0 && buckets[1].count <= buckets[0].count * 0.4)
      insights.push("Queda forte do FUP 1 → FUP 2: muita gente para na 1ª tentativa (revisar abordagem/roteiro do 1º toque).");
    if (backlogDias >= 3) insights.push(`A atividade atrasada mais antiga está parada há ${backlogDias} dias.`);
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h1 className="text-xl font-extrabold text-gray-900">Saúde da Cadência</h1>
          <button onClick={load} className="text-sm font-semibold" style={{ color: BLUE }}>Atualizar</button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Em que <b style={{ color: AMBER }}>FUP (dia da cadência)</b> está cada pessoa e quem tem <b style={{ color: RED }}>atividade atrasada</b> — por pessoa, no estágio atual. Lead sem 1º contato já entra como <b style={{ color: GREEN }}>FUP 1</b>.
        </p>

        {loading ? (
          <div className="text-sm text-gray-400 py-16 text-center">Carregando…</div>
        ) : (
          <>
            {/* Números-chave */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatTile label="Na fila" value={total} color="var(--ink)" />
              <StatTile label="Em FUP" value={emFup} color={AMBER} />
              <StatTile label="Atrasadas" value={atrasadas} color={RED} />
              <StatTile label="Backlog (dias)" value={backlogDias} color={backlogDias >= 3 ? RED : "var(--ink)"} hint="atividade parada há mais tempo" />
            </div>

            {/* Distribuição por etapa */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <h2 className="text-sm font-bold text-gray-900 mb-4">Distribuição por etapa (quantas pessoas em cada FUP)</h2>
              <div className="space-y-2.5">
                {buckets.map((b) => (
                  <div key={b.key} className="flex items-center gap-3">
                    <span className="w-16 text-[13px] font-bold shrink-0" style={{ color: b.color }}>{b.label}</span>
                    <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden relative">
                      <div className="h-full rounded-lg" style={{ width: `${(b.count / maxBucket) * 100}%`, background: b.color, opacity: 0.85, transition: "width .3s" }} />
                    </div>
                    <span className="w-28 text-right text-[13px] tabular-nums shrink-0">
                      <b className="text-gray-900">{b.count}</b>
                      {b.overdue > 0 && <span style={{ color: RED }}> · {b.overdue} atrasada{b.overdue > 1 ? "s" : ""}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leitura rápida */}
            {insights.length > 0 && (
              <div className="rounded-2xl border p-4 mb-6" style={{ background: "rgba(240,162,39,0.10)", borderColor: "rgba(240,162,39,0.32)" }}>
                <h2 className="text-sm font-bold text-gray-900 mb-1.5">Leitura</h2>
                <ul className="text-[13.5px] text-gray-700 space-y-1 list-disc pl-5">
                  {insights.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            {/* Por SDR (gestor) */}
            {isManager && sdrRows.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <h2 className="text-sm font-bold text-gray-900 px-5 pt-4 pb-3">Por SDR</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                        <th className="px-5 py-2 font-semibold">SDR</th>
                        <th className="px-3 py-2 font-semibold text-right">Em FUP</th>
                        <th className="px-3 py-2 font-semibold text-right">Atrasadas</th>
                        <th className="px-5 py-2 font-semibold text-right">Mais antiga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sdrRows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{r.name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: AMBER }}>{r.emFup}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: r.atrasadas > 0 ? RED : "#6B7280" }}>{r.atrasadas}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: r.backlog >= 3 ? RED : "#6B7280" }}>{r.backlog > 0 ? `${r.backlog}d` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-[11px] font-semibold uppercase text-gray-400">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums mt-0.5" style={{ color }}>{value}</div>
      {hint && <div className="text-[10.5px] text-gray-400 mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}
