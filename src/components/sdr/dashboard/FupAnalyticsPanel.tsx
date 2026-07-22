// src/components/sdr/dashboard/FupAnalyticsPanel.tsx
// -----------------------------------------------------------------------------
// "Análises de FUP" — a leitura gerencial do follow-up (Sprint 2 de analytics).
// Três perguntas que o gestor comercial precisa responder olhando 1 tela:
//   1. MATRIZ DE DESFECHOS  — o que acontece quando cada SDR completa uma
//      atividade? (conexão, avanço, gatekeeper, telefone errado…)
//   2. CURVA DO FUP         — até qual tentativa vale a pena insistir na
//      ligação? (conexão e avanço por nº da tentativa)
//   3. ADERÊNCIA AO PLANO   — o time executa a cadência no dia planejado?
//      (no dia / atraso médio / puladas / % do plano executado)
// Filtro de período (7/30/90 dias) vale para as três seções. Gestor/admin vê
// o time inteiro com quebra por SDR; SDR vê apenas os próprios números — o
// filtro por owner_id é EXPLÍCITO na query (não confiamos só na RLS, que
// deixa passar tarefa sem dono e histórico que segue o lead).
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError } from "@/lib/qs/notify";
import { fetchAllRows } from "@/lib/qs/queries";
import { loadWorkHours, workdaysBetween, DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/workHours";

// Paleta padrão dos painéis (mesma do CadenceHealthPanel).
const BLUE = "#0147FF";
const GREEN = "#0E7C6A";
const AMBER = "#B45309";
const RED = "#DC2626";

// CONEXÃO = a atividade terminou com o SDR FALANDO com a pessoa certa.
// Cobre os valores legados ("atendeu", "ganho") e as classificações novas
// ("com_avanco"/"sem_avanco" — só existem quando houve conversa).
const CONNECTED = new Set(["atendeu", "ganho", "com_avanco", "sem_avanco"]);
// "Não atendeu" agrega os três desfechos legados de ligação sem contato.
const NO_ANSWER = new Set(["nao_atendeu", "caixa_postal", "desligou"]);
// Telefone que não serve: valor novo + o legado equivalente.
const BAD_PHONE = new Set(["telefone_incorreto", "numero_errado"]);
// Seção 2 olha só canais de LIGAÇÃO: é onde "tentativa" e "conexão" fazem
// sentido como curva (e-mail/WhatsApp não têm o conceito de "atendeu").
const CALL_CHANNELS = new Set(["ligacao", "ligacao_whatsapp"]);

// "Pulada" REAL = o SDR clicou em Pular e escolheu um motivo. Mas o status
// "ignorada" também é gravado AUTOMATICAMENTE quando o lead sai da fila (ganho,
// perdido, handover, troca/exclusão de cadência, substituição por atividade
// extra). Esses fechamentos automáticos NÃO são pulos do SDR — se contados,
// inflam "Puladas" e derrubam injustamente a aderência de quem fecha muito lead.
// Filtramos pelo skip_reason: tudo que casa aqui é fechamento do sistema.
const SYSTEM_SKIP_REASONS = new Set([
  "Lead ganho",
  "Lead perdido",
  "Handover para closer",
  "Substituída por atividade extra",
  "Lead removido da cadência",
  "Lead movido de cadência — plano anterior encerrado",
]);
function isSystemSkip(reason: string | null): boolean {
  if (!reason) return false;
  if (SYSTEM_SKIP_REASONS.has(reason)) return true;
  // Exclusão de cadência inclui o nome: `Cadência "X" excluída — plano encerrado`.
  if (reason.startsWith("Cadência") && reason.includes("encerrado")) return true;
  return false;
}

const PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIODS)[number];

// ── Tipos das linhas que buscamos ────────────────────────────────────────────

interface DoneTask {
  ownerId: string | null;
  result: string | null;
  channel: string | null;
  tags: string[] | null;
  scheduledAt: string | null;
  completedAt: string | null;
}

interface SkippedTask {
  ownerId: string | null;
  reason: string | null;
}

// ── Helpers de data (sempre em dia LOCAL) ────────────────────────────────────

// Índice do dia LOCAL (nº de dias desde a época). Usa getFullYear/Month/Date
// de propósito: fatiar a string ISO pegaria o dia em UTC e uma ligação feita
// 22h de terça (BRT) cairia na quarta — exatamente o erro que queremos evitar.
function localDayIndex(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

// Corte do período: meia-noite LOCAL de N dias atrás (o dia de hoje conta).
function cutoffIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Divisão segura: "—" quando o denominador é 0 (nunca NaN/Infinity na tela).
function pct(num: number, den: number): string {
  return den > 0 ? `${Math.round((num / den) * 100)}%` : "—";
}

// Nº da tentativa da tarefa: tag "tentativa:N" na array; SEM tag = 1
// (o 1º contato é criado pela cadência sem tag; só os follow-ups são taggeados).
function attemptOf(tags: string[] | null): number {
  for (const t of tags ?? []) {
    const m = /^tentativa:(\d+)$/.exec(t);
    if (m) return Math.max(1, parseInt(m[1], 10));
  }
  return 1;
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function FupAnalyticsPanel() {
  const { currentUser } = useQsAuth();
  const isManager = !!currentUser && canSeeAllData(currentUser.role);
  const [days, setDays] = useState<PeriodDays>(30);
  const [done, setDone] = useState<DoneTask[]>([]);
  const [skipped, setSkipped] = useState<SkippedTask[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [workHours, setWorkHours] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [loading, setLoading] = useState(true);

  // Horário de Trabalho: o "atraso em dias" conta só dias ÚTEIS (fim de semana
  // não vira atraso — regra do Bruno).
  useEffect(() => { loadWorkHours().then(setWorkHours); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cut = cutoffIso(days);
      // SDR: filtro explícito pelo próprio id (não confiar só na RLS — ela
      // deixa passar tarefa sem dono, que inflaria os números individuais).
      const own = !isManager && currentUser ? currentUser.id : null;

      // Concluídas: o período é ancorado em completed_at (quando o trabalho
      // de fato aconteceu), não em scheduled_at. Paginado (cap 1000 do
      // PostgREST) — 30/90 dias de time cheio passam disso fácil e a matriz
      // subestimava sem avisar.
      const doneP = fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_tasks")
          .select("owner_id, contact_result, channel_type, tags, scheduled_at, completed_at")
          .eq("status", "concluida")
          .gte("completed_at", cut)
          .order("id");
        if (own) q = q.eq("owner_id", own);
        return q.range(f, t);
      });
      // Puladas: não existe coluna "skipped_at", então a janela usa created_at.
      // É uma APROXIMAÇÃO (data de criação da tarefa, não do pulo) — como as
      // tarefas de cadência são criadas perto da execução, o desvio é pequeno.
      const skipP = fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_tasks")
          .select("owner_id, skip_reason, created_at")
          .eq("status", "ignorada")
          .gte("created_at", cut)
          .order("id");
        if (own) q = q.eq("owner_id", own);
        return q.range(f, t);
      });

      const [doneRows, skipRows, usersRes] = await Promise.all([
        doneP,
        skipP,
        supabase.from("qs_users").select("id, name").eq("is_active", true),
      ]);

      setDone(
        (doneRows as any[]).map((t) => ({
          ownerId: t.owner_id ?? null,
          result: t.contact_result ?? null,
          channel: t.channel_type ?? null,
          tags: t.tags ?? null,
          scheduledAt: t.scheduled_at ?? null,
          completedAt: t.completed_at ?? null,
        })),
      );
      setSkipped(
        (skipRows as any[])
          // Fora os fechamentos AUTOMÁTICOS (ganho/perdido/handover/cadência) —
          // "Puladas" e a aderência só contam o pulo consciente do SDR.
          .filter((t) => !isSystemSkip(t.skip_reason ?? null))
          .map((t) => ({
            ownerId: t.owner_id ?? null,
            reason: t.skip_reason ?? null,
          })),
      );
      setUserNames(new Map(((usersRes.data ?? []) as any[]).map((u) => [u.id, u.name])));
    } catch (e: any) {
      console.warn("[análises-fup] falha:", e?.message);
      notifyError("Não foi possível carregar as análises de FUP.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, isManager, days]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string | null) => (id ? userNames.get(id) ?? "Sem dono" : "Sem dono");

  // ══ SEÇÃO 1 — Matriz de desfechos por SDR ═══════════════════════════════════
  // Total conta TODA concluída (mesmo contact_result nulo/legado fora das
  // colunas, ex. "sem_conexao"); as colunas são recortes do total.
  interface MatrixRow {
    total: number; conexoes: number; comAvanco: number; semAvanco: number;
    gatekeeper: number; naoAtendeu: number; telIncorreto: number;
  }
  const emptyMatrix = (): MatrixRow => ({ total: 0, conexoes: 0, comAvanco: 0, semAvanco: 0, gatekeeper: 0, naoAtendeu: 0, telIncorreto: 0 });
  const matrixBySdr = new Map<string, MatrixRow>();
  const matrixTotal = emptyMatrix();
  for (const t of done) {
    const key = t.ownerId ?? "—";
    const row = matrixBySdr.get(key) ?? emptyMatrix();
    for (const r of [row, matrixTotal]) {
      r.total++;
      if (t.result && CONNECTED.has(t.result)) r.conexoes++;
      if (t.result === "com_avanco") r.comAvanco++;
      if (t.result === "sem_avanco") r.semAvanco++;
      if (t.result === "gatekeeper") r.gatekeeper++;
      if (t.result && NO_ANSWER.has(t.result)) r.naoAtendeu++;
      if (t.result && BAD_PHONE.has(t.result)) r.telIncorreto++;
    }
    matrixBySdr.set(key, row);
  }
  const matrixRows = [...matrixBySdr.entries()]
    .map(([id, v]) => ({ id, name: nameOf(id === "—" ? null : id), ...v }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // ══ SEÇÃO 2 — Conversão por tentativa (curva do FUP) ════════════════════════
  interface AttemptBucket { label: string; total: number; conexoes: number; comAvanco: number }
  const attemptBuckets: AttemptBucket[] = ["1", "2", "3", "4", "5", "6+"].map((label) => ({ label, total: 0, conexoes: 0, comAvanco: 0 }));
  for (const t of done) {
    if (!t.channel || !CALL_CHANNELS.has(t.channel)) continue; // só ligações
    const idx = Math.min(6, attemptOf(t.tags)) - 1; // 1..5 e 6+ agrupado
    const b = attemptBuckets[idx];
    b.total++;
    if (t.result && CONNECTED.has(t.result)) b.conexoes++;
    if (t.result === "com_avanco") b.comAvanco++;
  }
  // Renderiza até a maior tentativa com dado (buracos no meio aparecem zerados
  // de propósito: "ninguém chegou na tentativa 3" também é informação).
  let lastWithData = -1;
  attemptBuckets.forEach((b, i) => { if (b.total > 0) lastWithData = i; });
  const visibleBuckets = attemptBuckets.slice(0, lastWithData + 1);

  // Leitura automática: primeira tentativa cujo connect rate cai abaixo da
  // METADE do da tentativa 1. Guarda anti-ruído: só emitimos se tanto a base
  // (tentativa 1) quanto a tentativa em queda tiverem >= 10 ligações — com
  // 3 ligações, 1 atendida a mais muda tudo e a leitura viraria chute.
  let curveInsight: string | null = null;
  const t1 = attemptBuckets[0];
  if (t1.total >= 10 && t1.conexoes > 0) {
    const baseRate = t1.conexoes / t1.total;
    for (let i = 1; i < attemptBuckets.length; i++) {
      const b = attemptBuckets[i];
      if (b.total >= 10 && b.conexoes / b.total < baseRate / 2) {
        curveInsight = `Depois da tentativa ${b.label} a conexão cai abaixo de ${Math.round((baseRate / 2) * 100)}% (metade da 1ª tentativa) — ficou em ${pct(b.conexoes, b.total)}. Avalie parar de insistir por ligação a partir daí e trocar de canal.`;
        break;
      }
    }
  }
  const totalCalls = attemptBuckets.reduce((s, b) => s + b.total, 0);

  // ══ SEÇÃO 3 — Aderência ao planejado por SDR ════════════════════════════════
  interface AdherenceRow {
    concluidas: number; comDatas: number; noDia: number;
    atrasadas: number; atrasoDias: number; puladas: number;
  }
  const emptyAdh = (): AdherenceRow => ({ concluidas: 0, comDatas: 0, noDia: 0, atrasadas: 0, atrasoDias: 0, puladas: 0 });
  const adhBySdr = new Map<string, AdherenceRow>();
  const adhTotal = emptyAdh();
  const bump = (key: string, fn: (r: AdherenceRow) => void) => {
    const row = adhBySdr.get(key) ?? emptyAdh();
    fn(row); fn(adhTotal);
    adhBySdr.set(key, row);
  };
  for (const t of done) {
    bump(t.ownerId ?? "—", (r) => {
      r.concluidas++;
      // Comparação sempre por DIA LOCAL (concluir 22h ainda é "no dia").
      // Sem alguma das datas (legado), a tarefa conta como concluída mas fica
      // fora do recorte de pontualidade — por isso o denominador é comDatas.
      if (!t.completedAt || !t.scheduledAt) return;
      r.comDatas++;
      // Atraso conta só DIAS ÚTEIS: uma tarefa de sexta concluída na segunda está
      // 1 dia útil atrasada, não 3, e concluída no fim de semana NÃO é atraso
      // (o fim de semana não gera "atrasada falsa"). Adiantada (rawDiff<0) é ignorada.
      const rawDiff = localDayIndex(t.completedAt) - localDayIndex(t.scheduledAt);
      if (rawDiff < 0) return;
      const workLate = rawDiff === 0 ? 0 : workdaysBetween(workHours, new Date(t.scheduledAt), new Date(t.completedAt));
      if (workLate === 0) r.noDia++; // no dia útil (mesmo dia ou só atravessou folga)
      else { r.atrasadas++; r.atrasoDias += workLate; }
    });
  }
  for (const s of skipped) bump(s.ownerId ?? "—", (r) => { r.puladas++; });
  const adhRows = [...adhBySdr.entries()]
    .map(([id, v]) => ({ id, name: nameOf(id === "—" ? null : id), ...v }))
    .sort((a, b) => b.concluidas - a.concluidas || a.name.localeCompare(b.name));

  // "Por que se pula?" — top 5 motivos do período (vazio/nulo vira rótulo próprio).
  const skipCounts = new Map<string, number>();
  for (const s of skipped) {
    const key = s.reason?.trim() || "(sem motivo informado)";
    skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1);
  }
  const topSkips = [...skipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSkip = Math.max(1, ...topSkips.map(([, n]) => n));

  // Formatadores de célula das tabelas.
  const avgDelay = (r: AdherenceRow) => (r.atrasadas > 0 ? (r.atrasoDias / r.atrasadas).toFixed(1) : "—");
  const advanceRate = (r: MatrixRow) => pct(r.comAvanco, r.comAvanco + r.semAvanco);

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Cabeçalho: título + filtro de período + atualizar */}
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h1 className="text-xl font-extrabold text-gray-900">Análises de FUP</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors ${
                    days === p ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                  style={days === p ? { background: BLUE } : undefined}
                >
                  {p} dias
                </button>
              ))}
            </div>
            <button onClick={load} className="text-sm font-semibold" style={{ color: BLUE }}>Atualizar</button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Desfechos das atividades, <b style={{ color: BLUE }}>curva de conexão por tentativa</b> e{" "}
          <b style={{ color: AMBER }}>aderência ao planejado</b> — últimos {days} dias{isManager ? ", por SDR" : ""}.
        </p>

        {loading ? (
          <div className="text-sm text-gray-400 py-16 text-center">Carregando…</div>
        ) : (
          <>
            {/* ── Seção 1: Matriz de desfechos por SDR ── */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
              <div className="px-5 pt-4 pb-3">
                <h2 className="text-sm font-bold text-gray-900">Matriz de desfechos por SDR</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  Conexão = falou com a pessoa (atendeu, ganho, com/sem avanço). Taxa de avanço = com avanço ÷ conversas classificadas.
                </p>
              </div>
              {done.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 pb-5">Nenhuma atividade concluída nos últimos {days} dias.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[880px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                        <th className="px-5 py-2 font-semibold">SDR</th>
                        <th className="px-3 py-2 font-semibold text-right">Total</th>
                        <th className="px-3 py-2 font-semibold text-right">Conexões</th>
                        <th className="px-3 py-2 font-semibold text-right">Connect rate</th>
                        <th className="px-3 py-2 font-semibold text-right">Com avanço</th>
                        <th className="px-3 py-2 font-semibold text-right">Sem avanço</th>
                        <th className="px-3 py-2 font-semibold text-right">Gatekeeper</th>
                        <th className="px-3 py-2 font-semibold text-right">Não atendeu</th>
                        <th className="px-3 py-2 font-semibold text-right">Tel. incorreto</th>
                        <th className="px-5 py-2 font-semibold text-right">Taxa de avanço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixRows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{r.name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{r.total}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{r.conexoes}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: GREEN }}>{pct(r.conexoes, r.total)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{r.comAvanco}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.semAvanco}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: AMBER }}>{r.gatekeeper}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.naoAtendeu}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.telIncorreto > 0 ? RED : "#6B7280" }}>{r.telIncorreto}</td>
                          {/* Célula destacada: é O número da matriz (qualidade da conversa) */}
                          <td className="px-5 py-2.5 text-right tabular-nums font-bold" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{advanceRate(r)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                        <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{matrixTotal.total}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{matrixTotal.conexoes}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{pct(matrixTotal.conexoes, matrixTotal.total)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{matrixTotal.comAvanco}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{matrixTotal.semAvanco}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: AMBER }}>{matrixTotal.gatekeeper}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{matrixTotal.naoAtendeu}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: matrixTotal.telIncorreto > 0 ? RED : "#6B7280" }}>{matrixTotal.telIncorreto}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{advanceRate(matrixTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Seção 2: Conversão por tentativa (curva do FUP) ── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <h2 className="text-sm font-bold text-gray-900">Conversão por tentativa (curva do FUP)</h2>
              <p className="text-[12px] text-gray-400 mt-0.5 mb-4">
                Só ligações (Ligação e Ligação WhatsApp). Largura da barra = % de conexão da tentativa; % avanço sobre o total de ligações da tentativa.
              </p>
              {totalCalls === 0 ? (
                <p className="text-sm text-gray-400">Nenhuma ligação concluída nos últimos {days} dias.</p>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {visibleBuckets.map((b) => (
                      <div key={b.label} className="flex items-center gap-3">
                        <span className="w-16 text-[13px] font-bold shrink-0 text-gray-700">Tent. {b.label}</span>
                        <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden relative">
                          <div
                            className="h-full rounded-lg"
                            style={{ width: b.total > 0 ? `${(b.conexoes / b.total) * 100}%` : 0, background: BLUE, opacity: 0.85, transition: "width .3s" }}
                          />
                          <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold tabular-nums text-gray-700 mix-blend-multiply">
                            {pct(b.conexoes, b.total)} conexão
                          </span>
                        </div>
                        <span className="w-64 text-right text-[12.5px] tabular-nums shrink-0 text-gray-600">
                          <b className="text-gray-900">{b.total}</b> lig. · <b style={{ color: GREEN }}>{b.conexoes}</b> conex. ·{" "}
                          <b style={{ color: BLUE }}>{b.comAvanco}</b> c/ avanço ({pct(b.comAvanco, b.total)})
                        </span>
                      </div>
                    ))}
                  </div>
                  {curveInsight && (
                    <div className="rounded-xl border p-3 mt-4" style={{ background: "rgba(240,162,39,0.10)", borderColor: "rgba(240,162,39,0.32)" }}>
                      <p className="text-[13px] text-gray-700"><b>Leitura:</b> {curveInsight}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Seção 3: Aderência ao planejado ── */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden md:col-span-2">
                <div className="px-5 pt-4 pb-3">
                  <h2 className="text-sm font-bold text-gray-900">Aderência ao planejado por SDR</h2>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    "No dia" compara o dia local de conclusão com o agendado. % do plano = concluídas ÷ (concluídas + puladas). "Puladas" conta só o pulo manual do SDR — fechamentos automáticos (lead ganho/perdido/transferido, troca de cadência) não entram.
                  </p>
                </div>
                {adhRows.length === 0 ? (
                  <p className="text-sm text-gray-400 px-5 pb-5">Nenhuma atividade concluída ou pulada nos últimos {days} dias.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                          <th className="px-5 py-2 font-semibold">SDR</th>
                          <th className="px-3 py-2 font-semibold text-right">Concluídas</th>
                          <th className="px-3 py-2 font-semibold text-right">No dia</th>
                          <th className="px-3 py-2 font-semibold text-right">Atraso médio</th>
                          <th className="px-3 py-2 font-semibold text-right">Puladas</th>
                          <th className="px-5 py-2 font-semibold text-right">% do plano</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adhRows.map((r) => (
                          <tr key={r.id} className="border-t border-gray-50">
                            <td className="px-5 py-2.5 font-medium text-gray-800">{r.name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{r.concluidas}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: GREEN }}>{pct(r.noDia, r.comDatas)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.atrasadas > 0 ? RED : "#6B7280" }}>
                              {avgDelay(r)}{r.atrasadas > 0 ? "d" : ""}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.puladas > 0 ? AMBER : "#6B7280" }}>{r.puladas}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-bold" style={{ color: BLUE }}>{pct(r.concluidas, r.concluidas + r.puladas)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                          <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{adhTotal.concluidas}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{pct(adhTotal.noDia, adhTotal.comDatas)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: adhTotal.atrasadas > 0 ? RED : "#6B7280" }}>
                            {avgDelay(adhTotal)}{adhTotal.atrasadas > 0 ? "d" : ""}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: adhTotal.puladas > 0 ? AMBER : "#6B7280" }}>{adhTotal.puladas}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: BLUE }}>{pct(adhTotal.concluidas, adhTotal.concluidas + adhTotal.puladas)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Bloco pequeno: motivos de pulo (top 5 do período) */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-3">Por que se pula?</h2>
                {topSkips.length === 0 ? (
                  <p className="text-sm text-gray-400">Nenhuma atividade pulada nos últimos {days} dias.</p>
                ) : (
                  <div className="space-y-2.5">
                    {topSkips.map(([reason, count]) => (
                      <div key={reason}>
                        <div className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="text-gray-700 truncate" title={reason}>{reason}</span>
                          <b className="tabular-nums text-gray-900 shrink-0">{count}</b>
                        </div>
                        <div className="h-1.5 rounded bg-gray-100 mt-1 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${(count / maxSkip) * 100}%`, background: AMBER, opacity: 0.8 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
