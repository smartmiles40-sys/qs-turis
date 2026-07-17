// src/components/sdr/dashboard/DailyFlowPanel.tsx
// -----------------------------------------------------------------------------
// "Análise dia a dia" — o volume operacional que o dono do produto pediu:
//   • Leads que chegaram por dia  → contagem de qs_leads pela DATA (dia local)
//                                    de `arrived_at`.
//   • Agendamentos por dia        → contagem de qs_meetings pela DATA de CRIAÇÃO
//                                    da reunião. Usamos `created_at` (quando a
//                                    reunião foi AGENDADA/registrada), não
//                                    `scheduled_at` (quando ela VAI acontecer) —
//                                    "agendamento feito no dia" é o ato de marcar.
//                                    `created_at` existe em qs_meetings desde o
//                                    schema inicial (migration 0001).
// Janela: últimos 21 dias (inclui hoje). Dias sem dado aparecem como 0 (não
// pulamos dias). Agrupamento por DATA LOCAL do navegador. A RLS já devolve só o
// que é de cada um — SDR vê o seu; gestor/admin vê o do time (só ajustamos o
// texto via canSeeAllData; NÃO filtramos por owner_id na mão).
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError } from "@/lib/qs/notify";
import { fetchAllRows } from "@/lib/qs/queries";

const BLUE = "#0147FF";
const GREEN = "#0E7C6A";
const DAYS = 21;

interface DayBucket {
  key: string; // YYYY-MM-DD (data local)
  date: Date;
  count: number;
}

// Chave estável da data LOCAL (date-only), no fuso do navegador.
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Os últimos N dias (mais antigo → hoje), todos zerados — garante que dias sem
// dado apareçam como 0 em vez de sumirem.
function emptyBuckets(days: number): DayBucket[] {
  const today = startOfLocalDay(new Date());
  const out: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ key: localDayKey(d), date: d, count: 0 });
  }
  return out;
}

// Distribui as linhas nos baldes de dia pela DATA LOCAL do campo escolhido.
function bucketize(rows: any[], field: string): DayBucket[] {
  const buckets = emptyBuckets(DAYS);
  const idx = new Map(buckets.map((b, i) => [b.key, i] as const));
  for (const r of rows) {
    const raw = r?.[field];
    if (!raw) continue;
    const i = idx.get(localDayKey(new Date(raw)));
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function DailyFlowPanel() {
  const { currentUser } = useQsAuth();
  const isManager = !!currentUser && canSeeAllData(currentUser.role);
  const scope = isManager ? "do time" : "seu";

  const [leadBuckets, setLeadBuckets] = useState<DayBucket[]>([]);
  const [meetingBuckets, setMeetingBuckets] = useState<DayBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(false);
    try {
      // Início da janela: 00:00 local do 1º dos 21 dias.
      const start = startOfLocalDay(new Date());
      start.setDate(start.getDate() - (DAYS - 1));
      const startISO = start.toISOString();

      const own = !isManager && currentUser ? currentUser.id : null;
      // Paginado (cap 1000 do PostgREST) — 21 dias de operação cheia passam
      // disso e as barras dos últimos dias sumiam em silêncio.
      // Não-gestor: conta só o que é DELE. A RLS deixa passar lead/reunião SEM
      // dono (owner_id is null), que senão seria contado pra TODOS os SDRs.
      const [leadRows, meetingRows] = await Promise.all([
        fetchAllRows<any>((f, t) => {
          let q = supabase.from("qs_leads").select("arrived_at").gte("arrived_at", startISO).order("id");
          if (own) q = q.eq("owner_id", own);
          return q.range(f, t);
        }),
        fetchAllRows<any>((f, t) => {
          let q = supabase.from("qs_meetings").select("created_at").gte("created_at", startISO).order("id");
          if (own) q = q.eq("owner_id", own);
          return q.range(f, t);
        }),
      ]);

      setLeadBuckets(bucketize(leadRows, "arrived_at"));
      setMeetingBuckets(bucketize(meetingRows, "created_at"));
    } catch (e: any) {
      console.warn("[fluxo-diário] falha:", e?.message);
      setError(true);
      if (!silent) notifyError("Não foi possível carregar a análise dia a dia.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, isManager]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh silencioso (TV do time) — mesmo guard de aba oculta do
  // restante do dashboard.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) load(true);
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-sm font-medium text-gray-700">Análise dia a dia (últimos 21 dias)</h2>
        <button onClick={() => load()} className="text-xs font-semibold" style={{ color: BLUE }}>Atualizar</button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Volume {scope} de leads que chegaram e de agendamentos feitos, por dia.
      </p>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm text-gray-400 text-center py-10">Carregando…</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-sm text-gray-400 text-center py-10">Não foi possível carregar os dados.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <DailyBars
            title="Leads que chegaram por dia"
            hint="Contagem pela data de chegada do lead (arrived_at)."
            buckets={leadBuckets}
            color={GREEN}
          />
          <DailyBars
            title="Agendamentos por dia"
            hint="Contagem pela data em que a reunião foi agendada (created_at)."
            buckets={meetingBuckets}
            color={BLUE}
          />
        </div>
      )}
    </div>
  );
}

function DailyBars({ title, hint, buckets, color }: { title: string; hint: string; buckets: DayBucket[]; color: string }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const avg = (total / (buckets.length || 1)).toFixed(1).replace(".", ",");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mb-4">{hint}</p>

      {/* Total + média */}
      <div className="flex gap-8 mb-5">
        <div>
          <div className="text-[11px] font-semibold uppercase text-gray-400">Total (21 dias)</div>
          <div className="text-2xl font-extrabold tabular-nums" style={{ color }}>{total}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase text-gray-400">Média / dia</div>
          <div className="text-2xl font-extrabold tabular-nums text-gray-900">{avg}</div>
        </div>
      </div>

      {/* Barras: uma por dia */}
      <div className="flex items-end gap-1 h-32">
        {buckets.map((b) => (
          <div
            key={b.key}
            className="flex-1 flex flex-col items-center justify-end h-full"
            title={`${fmtDay(b.date)}: ${b.count}`}
          >
            <span className="text-[9px] tabular-nums text-gray-500 mb-0.5 leading-none">
              {b.count > 0 ? b.count : ""}
            </span>
            <div
              className="w-full rounded-t"
              style={{
                height: `${(b.count / max) * 100}%`,
                minHeight: 2,
                background: b.count > 0 ? color : "#E5E7EB",
                opacity: b.count > 0 ? 0.9 : 1,
                transition: "height .3s",
              }}
            />
          </div>
        ))}
      </div>

      {/* Eixo X: dia do mês (a cada 5 dias + o último) */}
      <div className="flex gap-1 mt-1.5">
        {buckets.map((b, i) => (
          <div key={b.key} className="flex-1 text-center text-[8.5px] text-gray-400 tabular-nums leading-none">
            {i % 5 === 0 || i === buckets.length - 1 ? String(b.date.getDate()) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
