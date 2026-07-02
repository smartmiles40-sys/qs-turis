import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────────

interface RankEntry {
  id: string;
  name: string;
  avatar: string; // iniciais
  atividades: number; // tarefas concluídas no período
  ganhos: number; // leads ganhos no período
  finalizados: number; // ganhos + perdidos no período
  conversao: number; // ganhos / finalizados * 100
}

type RankingPeriod = "hoje" | "semana" | "mes";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const ini = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return ini || "?";
}

function getRankRange(period: RankingPeriod): { from: string; to: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (period === "hoje") {
    return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
  }
  if (period === "semana") {
    // Janela móvel de 7 dias (inclui hoje)
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - 6);
    return { from: d.toISOString(), to: endOfToday.toISOString() };
  }
  // mes — do primeiro dia do mês corrente até o fim de hoje
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { from: first.toISOString(), to: endOfToday.toISOString() };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RankingPanel() {
  const [period, setPeriod] = useState<RankingPeriod>("mes");
  const [entries, setEntries] = useState<RankEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const periods: { key: RankingPeriod; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "semana", label: "Semana" },
    { key: "mes", label: "Mês" },
  ];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { from, to } = getRankRange(period);

      const [usersRes, tasksRes, leadsRes] = await Promise.all([
        supabase
          .from("qs_users")
          .select("id, name")
          .eq("is_active", true)
          .in("role", ["sdr", "closer", "gestor"])
          .order("name"),
        supabase
          .from("qs_tasks")
          .select("owner_id")
          .eq("status", "concluida")
          .gte("completed_at", from)
          .lte("completed_at", to),
        supabase
          .from("qs_leads")
          .select("owner_id, status")
          .in("status", ["ganho", "perdido"])
          .gte("updated_at", from)
          .lte("updated_at", to),
      ]);

      if (cancelled) return;

      if (usersRes.error) console.warn("Erro ao buscar usuários (ranking):", usersRes.error);
      if (tasksRes.error) console.warn("Erro ao buscar atividades (ranking):", tasksRes.error);
      if (leadsRes.error) console.warn("Erro ao buscar leads (ranking):", leadsRes.error);

      const users = (usersRes.data ?? []) as { id: string; name: string }[];
      const tasks = (tasksRes.data ?? []) as { owner_id: string | null }[];
      const leads = (leadsRes.data ?? []) as { owner_id: string | null; status: string }[];

      // Agrega atividades concluídas por owner
      const atividadesMap = new Map<string, number>();
      tasks.forEach((t) => {
        if (!t.owner_id) return;
        atividadesMap.set(t.owner_id, (atividadesMap.get(t.owner_id) ?? 0) + 1);
      });

      // Agrega ganhos e finalizados por owner
      const ganhosMap = new Map<string, number>();
      const finalizadosMap = new Map<string, number>();
      leads.forEach((l) => {
        if (!l.owner_id) return;
        finalizadosMap.set(l.owner_id, (finalizadosMap.get(l.owner_id) ?? 0) + 1);
        if (l.status === "ganho") ganhosMap.set(l.owner_id, (ganhosMap.get(l.owner_id) ?? 0) + 1);
      });

      const rows: RankEntry[] = users.map((u) => {
        const atividades = atividadesMap.get(u.id) ?? 0;
        const ganhos = ganhosMap.get(u.id) ?? 0;
        const finalizados = finalizadosMap.get(u.id) ?? 0;
        const conversao = finalizados > 0 ? (ganhos / finalizados) * 100 : 0;
        return { id: u.id, name: u.name, avatar: getInitials(u.name), atividades, ganhos, finalizados, conversao };
      });

      // Ordena por desempenho: ganhos → atividades → conversão (desc)
      rows.sort(
        (a, b) => b.ganhos - a.ganhos || b.atividades - a.atividades || b.conversao - a.conversao
      );

      setEntries(rows);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
          <h2 className="text-sm font-medium text-gray-700">Ranking de Qualificadores</h2>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                background: period === p.key ? "#F97316" : "transparent",
                color: period === p.key ? "#fff" : "#6B7280",
                border: period === p.key ? "1px solid #F97316" : "1px solid #E5E7EB",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-500 text-center py-8">Carregando ranking...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Nenhum qualificador ativo encontrado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3 pl-2 w-10">#</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Qualificador</th>
                <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Atividades</th>
                <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Ganhos</th>
                <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Finalizados</th>
                <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 pb-3">Taxa de Conversão</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((sdr, idx) => {
                const hasActivity = sdr.atividades > 0 || sdr.ganhos > 0 || sdr.finalizados > 0;
                const isTop = idx === 0 && hasActivity;
                return (
                  <tr
                    key={sdr.id}
                    className={`border-b border-gray-50 transition-colors hover:bg-gray-50 ${isTop ? "bg-amber-50/40" : ""}`}
                  >
                    {/* Position */}
                    <td className="py-3 pl-2">
                      {isTop ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                          </svg>
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-gray-500 pl-1.5">{idx + 1}</span>
                      )}
                    </td>

                    {/* Name */}
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            background: isTop ? "#FEF3C7" : "#F3F4F6",
                            color: isTop ? "#D97706" : "#6B7280",
                          }}
                        >
                          <span className="text-xs font-bold">{sdr.avatar}</span>
                        </div>
                        <span className={`text-sm ${isTop ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
                          {sdr.name}
                        </span>
                      </div>
                    </td>

                    {/* Atividades */}
                    <td className="py-3 text-center">
                      <span className={`text-sm ${isTop ? "font-bold text-[#F97316]" : "font-medium text-gray-700"}`}>
                        {sdr.atividades}
                      </span>
                    </td>

                    {/* Ganhos */}
                    <td className="py-3 text-center">
                      <span className={`text-sm ${isTop ? "font-bold text-[#F97316]" : "font-medium text-gray-700"}`}>
                        {sdr.ganhos}
                      </span>
                    </td>

                    {/* Finalizados */}
                    <td className="py-3 text-center">
                      <span className="text-sm text-gray-600">{sdr.finalizados}</span>
                    </td>

                    {/* Taxa de Conversão */}
                    <td className="py-3 text-center">
                      <span className={`text-sm font-medium ${sdr.conversao >= 30 ? "text-green-600" : "text-gray-700"}`}>
                        {sdr.conversao.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
