import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Goal, GoalPeriod, GoalType, SdrUser } from "../types";

// ── Labels ──────────────────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  ganhos: "Ganhos",
  leads_finalizados: "Leads Finalizados",
  atividades: "Atividades",
  conversao: "Taxa de Conversão",
};

const GOAL_PERIOD_LABELS: Record<GoalPeriod, string> = {
  diario: "Diário",
  mensal: "Mensal",
};

interface GoalWithCurrent extends Goal {
  current_value: number;
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ current, target, isPercent }: { current: number; target: number; isPercent?: boolean }) {
  const pct = Math.min((current / target) * 100, 100);
  const isGood = pct >= 60;

  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: isGood ? "#16A34A" : "#DC2626" }}
        />
      </div>
      <span className="text-xs text-gray-500 w-20 text-right shrink-0">
        {isPercent ? `${current}%` : current} / {isPercent ? `${target}%` : target}
      </span>
      <span className={`text-xs font-medium w-12 text-right ${isGood ? "text-green-600" : "text-red-600"}`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface ModalState {
  open: boolean;
  editingId: string | null;
  owner_id: string;
  type: GoalType;
  period: GoalPeriod;
  target_value: string;
}

const INITIAL_MODAL: ModalState = {
  open: false,
  editingId: null,
  owner_id: "",
  type: "ganhos",
  period: "mensal",
  target_value: "",
};

// ── Main Component ───────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [periodView, setPeriodView] = useState<GoalPeriod>("mensal");
  const [modal, setModal] = useState<ModalState>(INITIAL_MODAL);
  const [users, setUsers] = useState<SdrUser[]>([]);
  const [goals, setGoals] = useState<GoalWithCurrent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchGoals = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_goals")
      .select("*, owner:qs_users(*)")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar metas:", error);
      return;
    }
    // current_value may not exist in DB yet; default to 0
    const mapped = ((data ?? []) as any[]).map((g) => ({
      ...g,
      current_value: g.current_value ?? 0,
    }));
    setGoals(mapped);
  }, []);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const [_, usersRes] = await Promise.all([
        fetchGoals(),
        supabase.from("qs_users").select("*").eq("is_active", true).order("name"),
      ]);
      if (usersRes.error) console.warn("Erro ao buscar users:", usersRes.error);
      else {
        const u = (usersRes.data as SdrUser[]) ?? [];
        setUsers(u);
        if (u.length > 0) setModal((prev) => ({ ...prev, owner_id: u[0].id }));
      }
      setLoading(false);
    }
    loadAll();
  }, [fetchGoals]);

  const filteredGoals = goals.filter((g) => g.period === periodView);

  const goalsByUser = users.map((user) => ({
    user,
    goals: filteredGoals.filter((g) => g.owner_id === user.id),
  }));

  function openAddModal() {
    setModal({ ...INITIAL_MODAL, open: true, period: periodView, owner_id: users[0]?.id ?? "" });
  }

  function openEditModal(goal: GoalWithCurrent) {
    setModal({
      open: true,
      editingId: goal.id,
      owner_id: goal.owner_id ?? users[0]?.id ?? "",
      type: goal.type,
      period: goal.period,
      target_value: String(goal.target_value),
    });
  }

  function closeModal() {
    setModal(INITIAL_MODAL);
  }

  async function handleSaveGoal() {
    if (!modal.target_value || !modal.owner_id) return;
    setSaving(true);

    const payload = {
      owner_id: modal.owner_id,
      type: modal.type,
      period: modal.period,
      target_value: parseInt(modal.target_value) || 0,
      period_start: new Date().toISOString().slice(0, 10),
    };

    if (modal.editingId) {
      const { error } = await supabase.from("qs_goals").update(payload).eq("id", modal.editingId);
      if (error) console.warn("Erro ao atualizar meta:", error);
    } else {
      const { error } = await supabase.from("qs_goals").insert(payload);
      if (error) console.warn("Erro ao criar meta:", error);
    }

    await fetchGoals();
    setSaving(false);
    closeModal();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          Planejamento de Metas
        </h1>
        <button
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nova Meta
        </button>
      </div>

      {/* Period Toggle */}
      <div className="flex gap-1">
        {(["diario", "mensal"] as GoalPeriod[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriodView(p)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              periodView === p
                ? "bg-[#F97316] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {GOAL_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Goals per user */}
      <div className="space-y-3">
        {goalsByUser.map(({ user, goals: userGoals }) => (
          <div
            key={user.id}
            className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden"
          >
            {/* User header */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-semibold">
                {user.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
              </div>
              <div>
                <span className="text-sm font-medium text-gray-900">{user.name}</span>
                <span className="block text-xs text-gray-400">{user.email}</span>
              </div>
            </div>

            {/* Goals table */}
            {userGoals.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">
                Nenhuma meta definida para este período.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-44">Tipo</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Progresso</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {userGoals.map((goal) => (
                    <tr key={goal.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-5 py-3 text-sm text-gray-700">{GOAL_TYPE_LABELS[goal.type]}</td>
                      <td className="px-5 py-3">
                        <ProgressBar current={goal.current_value} target={goal.target_value} isPercent={goal.type === "conversao"} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => openEditModal(goal)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="Editar meta"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {users.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-12 text-center">
            <p className="text-sm text-gray-400">Nenhum usuário encontrado.</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={closeModal} />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-none w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {modal.editingId ? "Editar Meta" : "Nova Meta"}
              </h2>
              <button onClick={closeModal} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Responsável</label>
                <select value={modal.owner_id} onChange={(e) => setModal({ ...modal, owner_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316]">
                  {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Meta</label>
                <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as GoalType })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316]">
                  {(Object.entries(GOAL_TYPE_LABELS) as [GoalType, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Período</label>
                <select value={modal.period} onChange={(e) => setModal({ ...modal, period: e.target.value as GoalPeriod })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316]">
                  {(Object.entries(GOAL_PERIOD_LABELS) as [GoalPeriod, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Valor da Meta</label>
                <input type="number" value={modal.target_value} onChange={(e) => setModal({ ...modal, target_value: e.target.value })}
                  placeholder={modal.type === "conversao" ? "Ex: 30 (%)" : "Ex: 50"}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316]" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSaveGoal}
                disabled={saving || !modal.target_value}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] disabled:opacity-50 transition-colors"
              >
                {saving ? "Salvando..." : modal.editingId ? "Salvar" : "Criar Meta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
