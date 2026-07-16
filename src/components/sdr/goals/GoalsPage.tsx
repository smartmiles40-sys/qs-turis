import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";
import { getClosedAtColumn } from "@/lib/qs/queries";
import type { Goal, GoalPeriod, GoalType, SdrUser } from "../types";

// ── Realizado por meta ────────────────────────────────────────────────────────

// Janela de datas da meta:
//  - diario  → hoje (00:00 até 23:59:59.999)
//  - mensal  → mês corrente ancorado no mês do period_start
function getGoalRange(goal: Pick<Goal, "period" | "period_start">): { from: string; to: string } {
  const now = new Date();
  if (goal.period === "diario") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  // mensal — usa o mês do period_start como referência (fallback: mês atual)
  const anchor = goal.period_start ? new Date(`${goal.period_start}T00:00:00`) : now;
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Calcula o realizado de uma meta no seu período, para o owner.
async function computeGoalCurrent(goal: Goal): Promise<number> {
  const { from, to } = getGoalRange(goal);
  const owner = goal.owner_id;
  // Data de FECHAMENTO do lead (closed_at, migration 0012) — updated_at mudava
  // em qualquer edição e re-contava ganhos antigos na meta do mês atual.
  const closedCol = await getClosedAtColumn();

  if (goal.type === "atividades") {
    let q = supabase
      .from("qs_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "concluida")
      .gte("completed_at", from)
      .lte("completed_at", to);
    if (owner) q = q.eq("owner_id", owner);
    const { count } = await q;
    return count ?? 0;
  }

  if (goal.type === "ganhos") {
    let q = supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "ganho")
      .gte(closedCol, from)
      .lte(closedCol, to);
    if (owner) q = q.eq("owner_id", owner);
    const { count } = await q;
    return count ?? 0;
  }

  if (goal.type === "reunioes") {
    // Reuniões agendadas no período (canceladas ficam de fora).
    let q = supabase
      .from("qs_meetings")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelada")
      .gte("created_at", from)
      .lte("created_at", to);
    if (owner) q = q.eq("owner_id", owner);
    const { count } = await q;
    return count ?? 0;
  }

  if (goal.type === "leads_finalizados") {
    let q = supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .in("status", ["ganho", "perdido"])
      .gte(closedCol, from)
      .lte(closedCol, to);
    if (owner) q = q.eq("owner_id", owner);
    const { count } = await q;
    return count ?? 0;
  }

  // conversao → ganhos / finalizados * 100
  let qGanhos = supabase
    .from("qs_leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "ganho")
    .gte(closedCol, from)
    .lte(closedCol, to);
  let qFinal = supabase
    .from("qs_leads")
    .select("id", { count: "exact", head: true })
    .in("status", ["ganho", "perdido"])
    .gte(closedCol, from)
    .lte(closedCol, to);
  if (owner) {
    qGanhos = qGanhos.eq("owner_id", owner);
    qFinal = qFinal.eq("owner_id", owner);
  }
  const [ganhosRes, finalRes] = await Promise.all([qGanhos, qFinal]);
  const ganhos = ganhosRes.count ?? 0;
  const finalizados = finalRes.count ?? 0;
  return finalizados > 0 ? Math.round((ganhos / finalizados) * 100) : 0;
}

// ── Labels ──────────────────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  ganhos: "Ganhos",
  leads_finalizados: "Leads Finalizados",
  atividades: "Atividades",
  conversao: "Taxa de Conversão",
  reunioes: "Reuniões Agendadas",
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_goals")
      .select("*, owner:qs_users(*)")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar metas:", error);
      return;
    }
    // Calcula o realizado de cada meta no seu período (paralelo)
    const mapped = await Promise.all(
      ((data ?? []) as Goal[]).map(async (g) => ({
        ...g,
        current_value: await computeGoalCurrent(g),
      }))
    );
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

    // period_start ancora o mês da meta mensal e só é definido na CRIAÇÃO.
    // Na edição ele é preservado — regravar com "hoje" mudava a meta de mês
    // (ex.: ajustar a meta de julho em agosto virava meta de agosto). A única
    // exceção é quando a pessoa troca o Período (diário ↔ mensal) de propósito
    // no modal: aí a meta é re-ancorada no período atual.
    const editingGoal = modal.editingId ? goals.find((g) => g.id === modal.editingId) : null;
    const periodChanged = editingGoal != null && editingGoal.period !== modal.period;

    const payload = {
      owner_id: modal.owner_id,
      type: modal.type,
      period: modal.period,
      target_value: parseInt(modal.target_value) || 0,
      ...(!modal.editingId || periodChanged
        ? { period_start: new Date().toISOString().slice(0, 10) }
        : {}),
    };

    const { error } = modal.editingId
      ? await supabase.from("qs_goals").update(payload).eq("id", modal.editingId)
      : await supabase.from("qs_goals").insert(payload);

    if (error) {
      // Meta que falhou não pode simplesmente "não aparecer" — mantém o modal
      // aberto pra pessoa tentar de novo sem perder o que digitou.
      console.warn("Erro ao salvar meta:", error);
      notifyError("Não foi possível salvar a meta — tente novamente.");
      setSaving(false);
      return;
    }

    await fetchGoals();
    setSaving(false);
    closeModal();
  }

  async function handleDeleteGoal(id: string) {
    if (!window.confirm("Excluir esta meta? Esta ação não pode ser desfeita.")) return;
    setDeletingId(id);
    const { error } = await supabase.from("qs_goals").delete().eq("id", id);
    if (error) console.warn("Erro ao excluir meta:", error);
    await fetchGoals();
    setDeletingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <div className="flex flex-wrap gap-y-2 items-center justify-between">
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
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors"
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
                ? "bg-[#0147FF] text-white"
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
              <div className="w-8 h-8 rounded-full bg-[#0147FF] flex items-center justify-center text-white text-xs font-semibold">
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
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
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
                        <div className="flex items-center justify-end gap-1">
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
                          <button
                            onClick={() => handleDeleteGoal(goal.id)}
                            disabled={deletingId === goal.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            title="Excluir meta"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        ))}

        {users.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-6 md:p-12 text-center">
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
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]">
                  {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Meta</label>
                <select value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value as GoalType })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]">
                  {(Object.entries(GOAL_TYPE_LABELS) as [GoalType, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Período</label>
                <select value={modal.period} onChange={(e) => setModal({ ...modal, period: e.target.value as GoalPeriod })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]">
                  {(Object.entries(GOAL_PERIOD_LABELS) as [GoalPeriod, string][]).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Valor da Meta</label>
                <input type="number" value={modal.target_value} onChange={(e) => setModal({ ...modal, target_value: e.target.value })}
                  placeholder={modal.type === "conversao" ? "Ex: 30 (%)" : "Ex: 50"}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]" />
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
                className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
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
