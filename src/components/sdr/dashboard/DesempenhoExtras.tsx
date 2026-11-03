// src/components/sdr/dashboard/DesempenhoExtras.tsx
// -----------------------------------------------------------------------------
// As peças novas do Desempenho visual (Bruno, 03/11: "deixe mais visual… não
// ficou bom a disposição das coisas"): meta do mês com barra e ritmo, funil em
// degraus, evolução por dia, ranking e ligações gravadas.
//
// Nenhuma métrica nova: funil = qs_funil_sdr (0095); meta = fetchMeetingKpis
// (qs_goals); ritmo = a régua do Painel; dia a dia e ranking = contagem direta
// de qs_meetings (o time todo lê) e de qs_tasks concluídas (cada um lê as suas).
// -----------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows, fetchMeetingKpis, type MeetingKpis } from "@/lib/qs/queries";
import { fmtPct, type Etapa, type EtapaId } from "@/lib/qs/funil";
import {
  ritmoDaMeta, serieDiaria, rankingPorReunioes, type ReuniaoRanking, type LinhaRanking, type RitmoMeta,
} from "@/lib/qs/desempenhoSdr";
import { Player, duracao, quando } from "../leads/LigacoesDoLead";

export const AZUL = "#0147FF";
export const LARANJA = "#F5821F";
export const LARANJA_TXT = "#C2410C";
const NUM = { fontVariantNumeric: "tabular-nums" as const };

/** Limites do período (datas de São Paulo) como timestamps: [de, ate+1). */
function limites(de: string, ate: string) {
  const [y, m, d] = ate.split("-").map(Number);
  const prox = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { ini: `${de}T00:00:00-03:00`, fim: `${prox}T00:00:00-03:00` };
}

export interface GravacaoResumo {
  id: string;
  inicio: string;
  duracao_seg: number;
  storage_path: string;
  sdr?: { name: string | null } | null;
  lead?: { full_name: string | null } | null;
}

export interface Extras {
  reunioes: ReuniaoRanking[];
  sdrs: { id: string; name: string }[];
  /** completed_at das atividades concluídas — só quando há um SDR em foco. */
  atividades: string[] | null;
  kpis: MeetingKpis | null;
  gravacoes: { total: number; segundos: number; recentes: GravacaoResumo[] } | null;
}

/**
 * Busca o que o funil não traz. `sdrId` = o SDR em foco (o próprio, ou o
 * escolhido pela gestão); null = time inteiro (aí não baixa atividades, que
 * seriam dezenas de milhares de linhas no mês).
 */
export function useExtrasDesempenho(de: string, ate: string, sdrId: string | null, ativo = true): Extras | null {
  const [x, setX] = useState<Extras | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    const { ini, fim } = limites(de, ate);
    (async () => {
      try {
        const [reunioes, sdrsRes, atividades, kpis, grav] = await Promise.all([
          fetchAllRows<ReuniaoRanking>((f, t) =>
            supabase.from("qs_meetings").select("id,owner_id,status,tipo,created_at,scheduled_at,sal")
              .or(`and(created_at.gte.${ini},created_at.lt.${fim}),and(scheduled_at.gte.${ini},scheduled_at.lt.${fim})`)
              .order("id").range(f, t) as unknown as PromiseLike<{ data: ReuniaoRanking[] | null; error: { message?: string } | null }>),
          supabase.from("qs_users").select("id,name").eq("role", "sdr").eq("is_active", true).order("name"),
          sdrId
            ? fetchAllRows<{ completed_at: string }>((f, t) =>
                supabase.from("qs_tasks").select("completed_at").eq("status", "concluida").eq("owner_id", sdrId)
                  .gte("completed_at", ini).lt("completed_at", fim).order("id").range(f, t) as unknown as PromiseLike<{ data: { completed_at: string }[] | null; error: { message?: string } | null }>)
              .then((r) => r.map((a) => a.completed_at))
              .catch(() => null)
            : Promise.resolve(null),
          fetchMeetingKpis(sdrId),
          (async () => {
            let q = supabase.from("qs_ligacao_gravacoes")
              .select("id,inicio,duracao_seg,storage_path,sdr:qs_users!qs_ligacao_gravacoes_sdr_id_fkey(name),lead:qs_leads(full_name)", { count: "exact" })
              .gte("inicio", ini).lt("inicio", fim).order("inicio", { ascending: false }).limit(200);
            if (sdrId) q = q.eq("sdr_id", sdrId);
            const { data, count, error } = await q;
            if (error) return null; // 0233 fora do ar / sem permissão: o card some
            const lista = (data ?? []) as unknown as GravacaoResumo[];
            return { total: count ?? lista.length, segundos: lista.reduce((s, g) => s + (g.duracao_seg || 0), 0), recentes: lista.slice(0, 4) };
          })(),
        ]);
        if (!vivo) return;
        setX({ reunioes, sdrs: (sdrsRes.data as { id: string; name: string }[]) ?? [], atividades, kpis, gravacoes: grav });
      } catch (e) {
        console.warn("[desempenho] extras:", e);
        if (vivo) setX({ reunioes: [], sdrs: [], atividades: null, kpis: null, gravacoes: null });
      }
    })();
    return () => { vivo = false; };
  }, [de, ate, sdrId, ativo]);
  return x;
}

// ── Peças de layout ──────────────────────────────────────────────────────────

export function Rotulo({ children }: { children: ReactNode }) {
  return <div className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "var(--subtle, #6B6B73)" }}>{children}</div>;
}

export function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${className}`} style={{ borderColor: "var(--border, #E4E4E7)", background: "var(--surface, #fff)" }}>
      {children}
    </div>
  );
}

export function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: ReactNode; sub?: ReactNode; tom?: "alerta" | "ok" }) {
  return (
    <div className="rounded-2xl border px-5 py-4 flex flex-col gap-1 min-w-0" style={{ borderColor: "var(--border, #E4E4E7)", background: "var(--surface, #fff)" }}>
      <Rotulo>{rotulo}</Rotulo>
      <div className="text-[36px] leading-none font-extrabold tracking-tight mt-1"
        style={{ ...NUM, color: tom === "alerta" ? LARANJA_TXT : tom === "ok" ? "var(--ok, #15803D)" : "var(--text, #0F172A)" }}>
        {valor}
      </div>
      {sub && <div className="text-[13px] mt-1" style={{ color: "var(--muted, #52525B)" }}>{sub}</div>}
    </div>
  );
}

// ── Meta do mês ──────────────────────────────────────────────────────────────

const ROTULO_RITMO = { ok: "no ritmo", warn: "perto do ritmo", danger: "atrás do ritmo" } as const;
const COR_RITMO = { ok: "var(--ok, #15803D)", warn: "var(--warn, #A16207)", danger: "var(--danger, #B91C1C)" } as const;

function BarraMeta({ titulo, r, semMeta }: { titulo: string; r: RitmoMeta | null; semMeta: number }) {
  if (!r) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline">
          <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>{titulo}</span>
          <span className="text-[20px] font-extrabold" style={NUM}>{semMeta}</span>
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--subtle)" }}>Sem meta cadastrada pra este mês (Configurações › Metas).</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-baseline gap-2 flex-wrap">
        <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>{titulo}</span>
        <span style={NUM}>
          <b className="text-[26px] font-extrabold" style={{ color: "var(--text)" }}>{r.feito}</b>
          <span className="text-[15px]" style={{ color: "var(--subtle)" }}> / {r.meta}</span>
        </span>
      </div>
      <div className="relative h-4 rounded-full" style={{ background: "var(--surface-2, #F4F4F5)" }}
        role="progressbar" aria-valuenow={Math.round(r.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={titulo}>
        <div className="absolute left-0 top-0 h-4 rounded-full" style={{ width: `${Math.max(1.5, r.pct)}%`, background: COR_RITMO[r.tom] }} />
        <div className="absolute -top-1 w-0.5 h-6" style={{ left: `${r.idealPct}%`, background: "var(--text, #09090B)" }}
          title={`Pra estar no ritmo hoje: ${r.ideal}`} />
      </div>
      <div className="flex justify-between gap-2 flex-wrap text-[12.5px]" style={{ color: "var(--muted)" }}>
        <span><b style={{ color: COR_RITMO[r.tom] }}>{ROTULO_RITMO[r.tom]}</b> · o risco é onde deveria estar hoje ({r.ideal})</span>
        <span>{r.falta > 0 ? <>faltam <b style={NUM}>{r.falta}</b> · <b style={NUM}>{r.porDia}</b> por dia útil</> : "meta batida"}</span>
      </div>
    </div>
  );
}

export function MetaDoMes({ kpis, time }: { kpis: MeetingKpis | null; time?: boolean }) {
  const agora = new Date();
  const mes = agora.toLocaleDateString("pt-BR", { month: "long" });
  return (
    <Cartao className="flex flex-col gap-5">
      <div className="flex justify-between items-baseline gap-2">
        <h2 className="m-0 text-[17px] font-extrabold" style={{ color: "var(--text)" }}>Meta de {mes}{time ? " · time" : ""}</h2>
        <span className="text-[12.5px]" style={{ color: "var(--subtle)" }}>dias úteis, seg–sex</span>
      </div>
      {!kpis ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : (
        <>
          <BarraMeta titulo="Reuniões agendadas" r={ritmoDaMeta(kpis.agendadas, kpis.metaAgendadas, agora)} semMeta={kpis.agendadas} />
          <BarraMeta titulo="Reuniões realizadas" r={ritmoDaMeta(kpis.realizadas, kpis.metaRealizadas, agora)} semMeta={kpis.realizadas} />
        </>
      )}
    </Cartao>
  );
}

// ── Funil em degraus ─────────────────────────────────────────────────────────

export function FunilDegraus({ passos, pior, recebidos }: { passos: Etapa[]; pior: EtapaId | null; recebidos: number }) {
  const max = Math.max(1, recebidos);
  return (
    <div className="flex flex-col gap-1.5">
      {passos.map((p, i) => {
        const largura = Math.max(6, (p.n / max) * 100);
        const ruim = p.id === pior;
        return (
          <div key={p.id} className="flex flex-col items-center">
            {i > 0 && (
              <div className="text-[12px] py-0.5" style={{ ...NUM, color: ruim ? LARANJA_TXT : "var(--muted)" }}>
                ↓ <b>{fmtPct(p.taxa)}</b>{p.taxaTime !== null && <span style={{ color: "var(--subtle)" }}> · time {fmtPct(p.taxaTime)}</span>}
              </div>
            )}
            <div className="h-11 rounded-xl flex items-center justify-between px-4 gap-3 text-white transition-all"
              style={{ width: `${largura}%`, minWidth: 210, background: ruim ? LARANJA : AZUL, opacity: 1 - i * 0.09 }}
              title={`${p.rotulo}: ${p.n} (${p.ajuda})`}>
              <span className="text-[13.5px] font-semibold truncate">{p.rotulo}</span>
              <span className="text-[19px] font-extrabold" style={NUM}>{p.n.toLocaleString("pt-BR")}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Evolução por dia (uma série por gráfico, sem eixo duplo) ─────────────────

function BarrasDiarias({ titulo, serie, cor }: { titulo: string; serie: { dia: string; n: number }[]; cor: string }) {
  const max = Math.max(1, ...serie.map((s) => s.n));
  const total = serie.reduce((a, s) => a + s.n, 0);
  const dias = serie.length;
  const media = dias ? total / dias : 0;
  const hoje = new Date().toLocaleDateString("en-CA");
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>{titulo}</span>
        <span className="text-[13px]" style={{ ...NUM, color: "var(--muted)" }}>
          <b className="text-[18px]" style={{ color: "var(--text)" }}>{total.toLocaleString("pt-BR")}</b> no período · {media.toFixed(1).replace(".", ",")}/dia
        </span>
      </div>
      <div className="flex items-end h-28" style={{ gap: 2 }} role="img" aria-label={`${titulo}: ${total} no período`}>
        {serie.map((s) => {
          const [, m, d] = s.dia.split("-");
          const fds = [0, 6].includes(new Date(`${s.dia}T12:00:00`).getDay());
          return (
            <div key={s.dia} className="flex-1 h-full flex items-end group relative" title={`${d}/${m}: ${s.n}`}>
              <div className="w-full rounded-t" style={{
                height: s.n ? `${Math.max(4, (s.n / max) * 100)}%` : 2,
                background: s.n ? cor : "var(--border, #E4E4E7)",
                opacity: fds ? 0.45 : s.dia === hoje ? 0.75 : 1,
              }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px]" style={{ ...NUM, color: "var(--subtle)" }}>
        <span>{serie[0] ? serie[0].dia.slice(8) + "/" + serie[0].dia.slice(5, 7) : ""}</span>
        <span>barras claras = fim de semana · passe o mouse pra ver o dia</span>
        <span>{serie.length ? serie[serie.length - 1].dia.slice(8) + "/" + serie[serie.length - 1].dia.slice(5, 7) : ""}</span>
      </div>
    </div>
  );
}

export function EvolucaoDiaria({ de, ate, extras, sdrId }: { de: string; ate: string; extras: Extras | null; sdrId: string | null }) {
  if (!extras) return <Cartao><p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando a evolução…</p></Cartao>;
  const doSdr = sdrId ? extras.reunioes.filter((m) => m.owner_id === sdrId) : extras.reunioes.filter((m) => extras.sdrs.some((s) => s.id === m.owner_id));
  const marcadas = serieDiaria(doSdr.filter((m) => m.status !== "arquivada" && m.tipo !== "retomada").map((m) => m.created_at), de, ate);
  return (
    <Cartao className="flex flex-col gap-5">
      <h2 className="m-0 text-[17px] font-extrabold" style={{ color: "var(--text)" }}>Evolução por dia</h2>
      <div className={`grid gap-6 ${extras.atividades ? "lg:grid-cols-2" : ""}`}>
        {extras.atividades && <BarrasDiarias titulo="Atividades concluídas" serie={serieDiaria(extras.atividades, de, ate)} cor="#64748B" />}
        <BarrasDiarias titulo="Reuniões agendadas" serie={marcadas} cor={AZUL} />
      </div>
    </Cartao>
  );
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export function RankingReunioes({ de, ate, extras, eu }: { de: string; ate: string; extras: Extras | null; eu?: string | null }) {
  const linhas: LinhaRanking[] = extras ? rankingPorReunioes(extras.reunioes, extras.sdrs, de, ate) : [];
  const max = Math.max(1, ...linhas.map((l) => l.realizadas));
  return (
    <Cartao className="flex flex-col gap-3">
      <div className="flex justify-between items-baseline gap-2">
        <h2 className="m-0 text-[17px] font-extrabold" style={{ color: "var(--text)" }}>Ranking do período</h2>
        <span className="text-[12px]" style={{ color: "var(--subtle)" }}>por reuniões realizadas</span>
      </div>
      {!extras ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : linhas.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Nenhum SDR ativo.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {linhas.map((l, i) => {
            const souEu = l.id === eu;
            return (
              <li key={l.id} className="grid items-center gap-3 rounded-xl px-2 py-1.5"
                style={{ gridTemplateColumns: "22px minmax(0,110px) minmax(0,1fr) auto", background: souEu ? "var(--info-bg, #EFF6FF)" : undefined }}>
                <span className="text-[14px] font-extrabold text-center" style={{ ...NUM, color: i < 3 ? "var(--text)" : "var(--subtle)" }}>{i + 1}</span>
                <span className="text-[13.5px] truncate" style={{ color: "var(--text)", fontWeight: souEu ? 800 : 600 }}>
                  {souEu ? "Você" : l.nome.split(" ")[0]}
                </span>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2, #F4F4F5)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(l.realizadas / max) * 100}%`, background: AZUL, opacity: souEu ? 1 : 0.55 }} />
                </div>
                <span className="text-[12.5px] whitespace-nowrap" style={{ ...NUM, color: "var(--muted)" }} title="realizadas · agendadas · SAL aceito">
                  <b className="text-[15px]" style={{ color: "var(--text)" }}>{l.realizadas}</b> real. · {l.marcadas} agend. · {l.sal} SAL
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

// ── Ligações gravadas (0233) ─────────────────────────────────────────────────

export function LigacoesGravadas({ extras, gestor }: { extras: Extras | null; gestor: boolean }) {
  const g = extras?.gravacoes;
  if (!g) return null; // sem a tabela / sem permissão: não ocupa espaço
  return (
    <Cartao className="flex flex-col gap-3">
      <Rotulo>Ligações gravadas</Rotulo>
      <div className="flex items-baseline gap-2" style={NUM}>
        <span className="text-[30px] font-extrabold leading-none" style={{ color: "var(--text)" }}>{g.total}</span>
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>{g.total ? `· ${duracao(g.segundos)} de conversa` : "no período"}</span>
      </div>
      {g.recentes.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--subtle)" }}>
          As ligações atendidas pelo webfone ficam na ficha do lead, aba Ligações. {gestor ? "A gestão ouve todas." : "Você ouve as suas."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {g.recentes.map((r) => (
            <li key={r.id} className="flex flex-col gap-1">
              <div className="text-[12.5px] truncate" style={{ color: "var(--muted)" }}>
                <b style={{ color: "var(--text)" }}>{r.lead?.full_name ?? "Sem lead"}</b> · {quando(r.inicio)} · {duracao(r.duracao_seg)}
                {gestor && r.sdr?.name ? ` · ${r.sdr.name.split(" ")[0]}` : ""}
              </div>
              <Player g={r} />
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/** SAL aceito no período, das reuniões com data no período (do SDR em foco ou do time). */
export function salDoPeriodo(extras: Extras | null, de: string, ate: string, sdrId: string | null): { sal: number; realizadas: number } | null {
  if (!extras) return null;
  const linhas = rankingPorReunioes(extras.reunioes, extras.sdrs, de, ate);
  const alvo = sdrId ? linhas.filter((l) => l.id === sdrId) : linhas;
  return { sal: alvo.reduce((a, l) => a + l.sal, 0), realizadas: alvo.reduce((a, l) => a + l.realizadas, 0) };
}
