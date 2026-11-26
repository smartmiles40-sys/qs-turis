// src/components/sdr/agenda/AgendaMes.tsx
// -----------------------------------------------------------------------------
// A AGENDA DO MÊS INTEIRO, na grade que todo mundo já sabe ler: a da Google
// Agenda. Depois que a aba "Agendamento" saiu, esta é A tela de agenda do QS —
// então ela precisa dar conta do dia também, sem virar outra tela: clicar num
// dia abre o PAINEL DO DIA aqui mesmo, com a lista completa daquele dia.
//
// Fixa no mês de propósito: não tem seletor Mês/Semana/Dia. A grade tem SEMPRE
// 6 semanas (42 células, monthGrid), então o calendário não "pula" de tamanho
// quando o mês vira.
//
// Modo noturno: a camada de override do index.css cobre os utilitários neutros
// puros (bg-white, text-gray-*, border-gray-*), mas NÃO cobre variantes com
// opacidade (bg-gray-50/70) nem hex arbitrário (text-[#0147FF]) — esses levam
// `dark:` explícito aqui.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, podeExecutar } from "@/contexts/QsAuthContext";
import {
  fetchClosers,
  fetchCloserConfigs,
  fetchMeetingsInRange,
  startOfDay,
  addDays,
  chaveDoEspecialista,
  semDesfecho,
} from "@/lib/qs/closerAgenda";
import {
  monthGrid,
  addMonths,
  isToday,
  periodLabel,
  shortTime,
  hhmm,
  WEEKDAY_SHORT,
  WEEKDAY_LONG,
  MONTH_LONG,
} from "@/lib/qs/calendarLayout";
import ScheduleMeetingModal from "./ScheduleMeetingModal";
import "./agenda.css";
import { statusNaAgenda, ROTULO_STATUS, corDaPessoa } from "@/lib/qs/agendaStatus";
import MeetingDetailModal from "./MeetingDetailModal";
import { type CloserConfig, type Meeting, type SdrUser } from "../types";

/** Quantas reuniões cabem numa célula antes do "+N mais". */
const MAX_POR_DIA = 2;
/** Pendências do SDR (atividades extras/retornos) por célula. */
const MAX_PEND_POR_DIA = 2;

/** Atividade extra em aberto do SDR (retorno, ligação marcada…) — Bruno, 27/10:
 *  a agenda do SDR mostra as reuniões E as pendências dele no mesmo calendário. */
interface Pendencia {
  id: string;
  lead_id: string;
  scheduled_at: string;
  status: string;
  notes: string | null;
  tags: string[] | null;
  lead: { full_name: string | null } | null;
}
export function rotuloPendencia(p: Pick<Pendencia, "tags" | "notes">): string {
  if (p.tags?.includes("ligacao-agendada")) return "Ligação marcada";
  if (p.tags?.includes("retorno")) return "Retorno";
  return "Atividade extra";
}
const COR_SEM_DONO = corDaPessoa(0, true);


const ic = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IcChevronL = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M15 18l-6-6 6-6" /></svg>);
const IcChevronR = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M9 18l6-6-6-6" /></svg>);
const IcPlus = ({ s = 15 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M12 5v14M5 12h14" /></svg>);

function chaveDoDia(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function nomeDoLead(m: Meeting): string {
  return m.lead_name ?? m.lead?.full_name ?? m.title ?? "Reunião";
}

interface Especialista {
  key: string;
  closerId: string | null;
  nome: string;
  cor: string;
}

/** Dados injetados — usado SÓ pela página de preview (agenda-preview.html). */
export interface AgendaDemo {
  closers: SdrUser[];
  configs: CloserConfig[];
  meetings: Meeting[];
}

interface AgendaMesProps {
  onOpenLead?: (leadId: string) => void;
  /**
   * Clique no número do dia / "+N mais". Quando a página trata (levando pra aba
   * Reuniões, que é o dia por especialista), é ela quem manda. Sem isso — no
   * preview, por exemplo — o mês abre o dia num painel aqui mesmo.
   */
  onAbrirDia?: (dia: Date) => void;
  /** Em produção nunca é passado: liga o modo preview (sem banco, sem gravação). */
  demo?: AgendaDemo;
  /** Id do usuário: põe as atividades extras em aberto dele na grade, junto das reuniões. */
  pendenciasDe?: string;
  /** A página (Agenda) já tem o "+ Agendar reunião" no cabeçalho. */
  semBotaoAgendar?: boolean;
}

export default function AgendaMes({ onOpenLead, onAbrirDia, demo, pendenciasDe, semBotaoAgendar }: AgendaMesProps) {
  const { currentUser } = useQsAuth();
  // Espectador (marketing): calendário só de leitura.
  const executa = podeExecutar(currentUser?.role);

  const [mes, setMes] = useState<Date>(() => startOfDay(new Date()));
  const [agora, setAgora] = useState(new Date());

  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [loading, setLoading] = useState(true);

  /** Vazio = todos. Guarda a chave do especialista (ver chaveDoEspecialista). */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Dia selecionado no calendário (lateral "Dia selecionado"). Nasce hoje.
  const [diaSel, setDiaSel] = useState<Date>(() => startOfDay(new Date()));
  const [detalhe, setDetalhe] = useState<Meeting | null>(null);
  const [agendarPara, setAgendarPara] = useState<{ closerId: string | null; date: Date } | null>(null);
  const [remarcando, setRemarcando] = useState<Meeting | null>(null);

  const dias = useMemo(() => monthGrid(mes), [mes]);

  // Só serve pro "já passou e ninguém deu desfecho": de minuto em minuto basta.
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Carga ──────────────────────────────────────────────────────────────────
  const de = dias[0].getTime();
  const ate = addDays(dias[41], 1).getTime();

  const load = useCallback(async () => {
    if (demo) {
      setClosers(demo.closers);
      setConfigs(demo.configs);
      setMeetings(demo.meetings);
      setLoading(false);
      return;
    }
    const [c, cfg, mt, pd] = await Promise.all([
      fetchClosers(),
      fetchCloserConfigs(),
      fetchMeetingsInRange(new Date(de), new Date(ate)),
      pendenciasDe
        ? supabase
            .from("qs_tasks")
            .select("id, lead_id, scheduled_at, status, notes, tags, lead:qs_leads(full_name)")
            .eq("owner_id", pendenciasDe)
            .eq("is_extra", true)
            .in("status", ["pendente", "atrasada"])
            .gte("scheduled_at", new Date(de).toISOString())
            .lt("scheduled_at", new Date(ate).toISOString())
            .order("scheduled_at")
            .limit(500)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    setClosers(c);
    setConfigs(cfg);
    setMeetings(mt);
    setPendencias(((pd.data ?? []) as unknown) as Pendencia[]);
    setLoading(false);
  }, [de, ate, demo, pendenciasDe]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Realtime: outro SDR agendou ou deu desfecho → a grade se atualiza sozinha.
  useEffect(() => {
    if (demo) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 1_000);
    };
    const channel = supabase
      .channel("qs_agenda_mes")
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_meetings" }, onChange)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [load, demo]);

  // ── Especialistas ──────────────────────────────────────────────────────────
  // Closers de verdade primeiro; depois os nomes que só existem como texto livre
  // em `meeting_owner`, pra tela servir mesmo antes de alguém ter o papel closer.
  const especialistas = useMemo<Especialista[]>(() => {
    const out: Especialista[] = closers.map((c, i) => ({
      key: c.id,
      closerId: c.id,
      nome: c.name,
      cor: corDaPessoa(i),
    }));

    const extras = new Map<string, string>();
    for (const m of meetings) {
      const key = chaveDoEspecialista(m);
      if (out.some((e) => e.key === key) || extras.has(key)) continue;
      extras.set(key, (m.closer?.name || m.meeting_owner || "").trim() || "Sem especialista");
    }
    let i = out.length;
    for (const [key, nome] of extras) {
      out.push({
        key,
        closerId: null,
        nome,
        cor: corDaPessoa(i, key === "sem"),
      });
      i += 1;
    }
    return out;
  }, [closers, configs, meetings]);

  const corDaChave = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const e of especialistas) mapa.set(e.key, e.cor);
    return mapa;
  }, [especialistas]);

  /** Nome pela CHAVE, não pelo embed: `closer:qs_users(...)` volta nulo quando a
   *  RLS esconde o usuário, e aí uma reunião com dono aparecia como "Sem
   *  especialista". A lista de closers já tem o nome. */
  const nomeDoEspecialista = useCallback(
    (m: Meeting): string => {
      const porChave = especialistas.find((e) => e.key === chaveDoEspecialista(m));
      return porChave?.nome || m.closer?.name || m.meeting_owner || "Sem especialista";
    },
    [especialistas]
  );

  // ── Recortes ───────────────────────────────────────────────────────────────
  const visiveis = useMemo(
    () => (selecionados.size ? meetings.filter((m) => selecionados.has(chaveDoEspecialista(m))) : meetings),
    [meetings, selecionados]
  );

  const porDia = useMemo(() => {
    const mapa = new Map<string, Meeting[]>();
    for (const m of visiveis) {
      const k = chaveDoDia(new Date(m.scheduled_at));
      const arr = mapa.get(k);
      if (arr) arr.push(m);
      else mapa.set(k, [m]);
    }
    for (const arr of mapa.values()) {
      arr.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }
    return mapa;
  }, [visiveis]);

  /** Contagem do MÊS exibido — as 42 células incluem dias vizinhos que não contam. */
  const doMes = useMemo(
    () => visiveis.filter((m) => new Date(m.scheduled_at).getMonth() === mes.getMonth()),
    [visiveis, mes]
  );

  /** Pendências contam a GRADE INTEIRA, não só o mês: a reunião do dia 28 do mês
   *  passado está na tela, com o alerta aceso, e continua sendo buraco no funil.
   *  Contar só o mês faria o número discordar do que o olho vê. */
  const pendentesNaTela = useMemo(
    () => visiveis.filter((m) => semDesfecho(m, agora)).length,
    [visiveis, agora]
  );

  const pendPorDia = useMemo(() => {
    const mapa = new Map<string, Pendencia[]>();
    for (const p of pendencias) {
      const k = chaveDoDia(new Date(p.scheduled_at));
      const arr = mapa.get(k);
      if (arr) arr.push(p);
      else mapa.set(k, [p]);
    }
    return mapa;
  }, [pendencias]);


  // ── Ações ──────────────────────────────────────────────────────────────────
  function alternarEspecialista(key: string) {
    setSelecionados((prev) => {
      // Vazio = "todos". O primeiro clique ISOLA aquele especialista (é o que se
      // quer quase sempre); dos próximos em diante soma e subtrai da seleção.
      if (prev.size === 0) return new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size === 0 || next.size === especialistas.length ? new Set() : next;
    });
  }

  /** Só dá pra pré-selecionar o especialista quando há UM, e closer de verdade. */
  function closerSemeado(): string | null {
    if (selecionados.size !== 1) return null;
    const key = [...selecionados][0];
    return especialistas.find((e) => e.key === key)?.closerId ?? null;
  }

  function agendarEm(dia: Date) {
    // 9h é onde o expediente começa na prática: melhor do que meia-noite, e o
    // modal deixa trocar o horário de qualquer jeito.
    const quando = new Date(dia);
    quando.setHours(9, 0, 0, 0);
    setRemarcando(null);
    setAgendarPara({ closerId: closerSemeado(), date: quando });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // Desenho do Bruno (agenda.html, aba Mês): o calendário à esquerda e, ao
  // lado, o DIA SELECIONADO — clicar num dia mostra a lista dele aqui mesmo;
  // "Abrir agenda deste dia" leva pra aba Agenda do dia.
  const listaSel = porDia.get(chaveDoDia(diaSel)) ?? [];
  const pendSel = pendPorDia.get(chaveDoDia(diaSel)) ?? [];
  const maxNoDia = Math.max(1, ...dias.map((d) => (porDia.get(chaveDoDia(d)) ?? []).length));

  return (
    <div className="flex flex-col gap-4" style={{ fontFamily: "inherit" }}>
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setMes(addMonths(mes, -1))} aria-label="Mês anterior" className="ag-icon-btn"><IcChevronL /></button>
          <button type="button" onClick={() => setMes(addMonths(mes, 1))} aria-label="Próximo mês" className="ag-icon-btn"><IcChevronR /></button>
          <div className="ml-1 flex flex-col">
            {/* `capitalize` maiusculiza TODA palavra ("Agosto De 2026"): só a primeira sobe. */}
            <span className="ag-titulo first-letter:uppercase">{periodLabel("mes", mes)}</span>
            <span className="ag-muted" style={{ fontSize: 13 }}>
              {loading ? "Carregando…" : `${doMes.length} ${doMes.length === 1 ? "reunião" : "reuniões"} no mês`}
            </span>
          </div>
          {(mes.getMonth() !== agora.getMonth() || mes.getFullYear() !== agora.getFullYear()) && (
            <button type="button" onClick={() => { setMes(startOfDay(new Date())); setDiaSel(startOfDay(new Date())); }} className="ag-btn ag-btn--sm ml-1">Hoje</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Filtro por especialista — a "lista de agendas" da Google Agenda */}
          {especialistas.length > 1 && especialistas.map((e) => {
            const ativo = selecionados.size === 0 || selecionados.has(e.key);
            return (
              <button key={e.key} type="button" onClick={() => alternarEspecialista(e.key)}
                aria-pressed={selecionados.has(e.key)}
                title={ativo ? `Mostrando ${e.nome}` : `Escondendo ${e.nome}`}
                className={`ag-pill ${ativo ? "" : "ag-pill--off"}`} style={selecionados.has(e.key) ? { background: "transparent", color: "var(--ag-text)", borderColor: "var(--ag-muted)" } : undefined}>
                <span className="ag-dot" style={{ background: e.cor }} />
                {e.nome}
              </button>
            );
          })}
          {selecionados.size > 0 && (
            <button type="button" onClick={() => setSelecionados(new Set())} className="ag-pill">Mostrar todos</button>
          )}
          {pendentesNaTela > 0 && (
            <span className="ag-pill ag-pill--static ag-pill--warn"
              title="Reuniões desta tela que já terminaram e continuam sem desfecho — abra o dia para resolver">
              {pendentesNaTela} sem desfecho
            </span>
          )}
          {executa && !semBotaoAgendar && (
            <button type="button" onClick={() => agendarEm(new Date())} className="ag-btn ag-btn--sm ag-btn--primary">
              <IcPlus /> Agendar
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* Grade do mês */}
        <section aria-label="Calendário do mês" className="ag-card min-w-0 overflow-hidden" style={{ flex: "999 1 720px" }}>
          <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--ag-border)" }}>
            {WEEKDAY_SHORT.map((w) => (
              <span key={w} className="p-2.5 text-center text-[12px] font-bold uppercase ag-muted" style={{ letterSpacing: "0.06em" }}>{w}</span>
            ))}
          </div>

          {loading ? (
            <div className="py-20 text-center ag-muted">Carregando a agenda…</div>
          ) : (
            <div className="grid grid-cols-7">
              {dias.map((d) => {
                const noMes = d.getMonth() === mes.getMonth();
                const hoje = isToday(d);
                const sel = chaveDoDia(d) === chaveDoDia(diaSel);
                const lista = porDia.get(chaveDoDia(d)) ?? [];
                const pend = pendPorDia.get(chaveDoDia(d)) ?? [];
                const temPendencia = lista.some((m) => semDesfecho(m, agora));
                const calor = noMes && lista.length ? Math.min(1, lista.length / maxNoDia) : 0;
                const fundo = !noMes
                  ? "var(--ag-surface-out)"
                  : calor
                    ? `color-mix(in srgb, var(--ag-text) ${(1.5 + calor * 6).toFixed(1)}%, var(--ag-surface))`
                    : "var(--ag-surface)";
                return (
                  <div
                    key={d.getTime()}
                    role="button"
                    tabIndex={0}
                    aria-pressed={sel}
                    aria-label={`${d.getDate()} de ${MONTH_LONG[d.getMonth()]}: ${lista.length} ${lista.length === 1 ? "reunião" : "reuniões"}`}
                    onClick={() => setDiaSel(startOfDay(d))}
                    onDoubleClick={() => onAbrirDia?.(d)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDiaSel(startOfDay(d)); } }}
                    className="flex min-h-[64px] cursor-pointer flex-col items-start gap-1 p-1.5 text-left sm:min-h-[112px] sm:p-2"
                    style={{
                      background: fundo,
                      borderRight: "1px solid var(--ag-line)",
                      borderBottom: "1px solid var(--ag-line)",
                      boxShadow: sel ? "inset 0 0 0 2px var(--ag-muted)" : "none",
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold"
                        style={hoje ? { background: "var(--ag-primary)", color: "var(--ag-on-primary)" } : { color: noMes ? "var(--ag-text)" : "var(--ag-faint)" }}>
                        {d.getDate()}
                      </span>
                      {lista.length > 0 && (
                        <span className="hidden rounded-full px-[7px] py-0.5 text-[11px] font-bold tabular sm:inline"
                          style={{ background: "var(--ag-surface-3)", color: temPendencia ? "var(--ag-warn)" : "var(--ag-count)" }}
                          title={temPendencia ? "Tem reunião sem desfecho" : undefined}>
                          {lista.length}
                        </span>
                      )}
                    </div>
                    {/* celular: só um ponto dizendo que tem reunião (a lista fica ao lado/embaixo) */}
                    {lista.length > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full sm:hidden" style={{ background: temPendencia ? "var(--ag-warn)" : "var(--ag-count)" }} aria-hidden />
                    )}
                    <div className="hidden w-full flex-col gap-1 sm:flex">
                      {lista.slice(0, MAX_POR_DIA).map((m) => {
                        const inicio = new Date(m.scheduled_at);
                        const cor = corDaChave.get(chaveDoEspecialista(m)) ?? COR_SEM_DONO;
                        const morta = m.status === "cancelada";
                        return (
                          <span key={m.id} title={`${shortTime(inicio)} · ${nomeDoLead(m)} · ${nomeDoEspecialista(m)}`}
                            className="flex w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px]"
                            style={{ color: morta ? "var(--ag-subtle)" : "var(--ag-text-2)", textDecoration: morta ? "line-through" : "none" }}>
                            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: cor }} />
                            <span className="truncate">{hhmm(inicio)} {nomeDoLead(m).split(/\s+/)[0]}</span>
                          </span>
                        );
                      })}
                      {lista.length > MAX_POR_DIA && (
                        <span className="text-[12px] font-semibold" style={{ color: "var(--ag-muted-2)" }}>+{lista.length - MAX_POR_DIA} mais</span>
                      )}
                      {/* Pendências do usuário: tracejado pra não confundir com reunião */}
                      {pend.slice(0, MAX_PEND_POR_DIA).map((p) => (
                        <span key={p.id} className="truncate rounded border border-dashed px-1 text-[11px]"
                          style={{ borderColor: new Date(p.scheduled_at) < agora ? "var(--ag-now)" : "var(--ag-border-3)", color: "var(--ag-muted)" }}>
                          {shortTime(new Date(p.scheduled_at))} {p.lead?.full_name || "Lead"}
                        </span>
                      ))}
                      {pend.length > MAX_PEND_POR_DIA && (
                        <span className="text-[11px] ag-muted">+{pend.length - MAX_PEND_POR_DIA} pendência{pend.length - MAX_PEND_POR_DIA === 1 ? "" : "s"}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="px-3 py-2 text-[11px] ag-subtle" style={{ borderTop: "1px solid var(--ag-border)" }}>
            Clique num dia para ver as reuniões dele ao lado{onAbrirDia ? " (dois cliques abrem a Agenda do dia)" : ""}.
            {pendenciasDe && " Itens tracejados são as suas pendências (retornos e atividades extras)."}
          </p>
        </section>

        {/* Dia selecionado */}
        <aside className="ag-card flex min-w-0 flex-col gap-3 p-[18px]" style={{ flex: "1 1 300px" }}>
          <div className="flex flex-col">
            <span className="ag-eyebrow">Dia selecionado</span>
            <span className="text-[18px] font-bold">
              {WEEKDAY_LONG[diaSel.getDay()]}, {diaSel.getDate()} de {MONTH_LONG[diaSel.getMonth()]}
            </span>
          </div>

          {listaSel.length === 0 && <div className="ag-vazio" style={{ padding: 20 }}>Nenhuma reunião neste dia</div>}

          {listaSel.map((m) => {
            const inicio = new Date(m.scheduled_at);
            const st = statusNaAgenda(m, agora);
            const cor = corDaChave.get(chaveDoEspecialista(m)) ?? COR_SEM_DONO;
            return (
              <button key={m.id} type="button" onClick={() => setDetalhe(m)} data-st={st}
                className="ag-linha flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
                <span className="w-11 shrink-0 font-bold tabular">{hhmm(inicio)}</span>
                <span className="h-8 w-1 shrink-0 rounded-sm" style={{ background: cor }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold" style={{ textDecoration: m.status === "cancelada" ? "line-through" : "none" }}>{nomeDoLead(m)}</span>
                  <span className="truncate ag-muted" style={{ fontSize: 12 }}>{nomeDoEspecialista(m)}</span>
                </span>
                <span className="ag-badge">{ROTULO_STATUS[st]}</span>
              </button>
            );
          })}

          {pendSel.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="ag-eyebrow">Suas pendências</span>
              {pendSel.map((p) => (
                <button key={p.id} type="button" onClick={() => onOpenLead?.(p.lead_id)}
                  className="flex w-full items-center gap-2.5 rounded-[10px] border border-dashed px-3 py-2 text-left"
                  style={{ borderColor: "var(--ag-border-3)" }}
                  title={p.notes ?? undefined}>
                  <span className="w-11 shrink-0 font-bold tabular">{shortTime(new Date(p.scheduled_at))}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{p.lead?.full_name || "Lead"}</span>
                    <span className="ag-muted" style={{ fontSize: 12 }}>{rotuloPendencia(p)}{new Date(p.scheduled_at) < agora ? " · atrasada" : ""}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {executa && (
            <button type="button" onClick={() => agendarEm(diaSel)} className={`ag-btn ${listaSel.length === 0 ? "ag-btn--primary" : ""}`}>
              Agendar neste dia
            </button>
          )}
          {listaSel.length > 0 && onAbrirDia && (
            <button type="button" onClick={() => onAbrirDia(diaSel)} className="ag-btn ag-btn--md">Abrir agenda deste dia</button>
          )}
        </aside>
      </div>

      {/* Modais */}
      <ScheduleMeetingModal
        open={!!agendarPara}
        onClose={() => { setAgendarPara(null); setRemarcando(null); }}
        onSaved={() => { setAgendarPara(null); setRemarcando(null); void load(); }}
        initialCloserId={agendarPara?.closerId ?? null}
        initialDate={agendarPara?.date ?? null}
        reschedule={remarcando}
      />
      <MeetingDetailModal
        meeting={detalhe}
        onClose={() => setDetalhe(null)}
        onChanged={() => void load()}
        onReschedule={(m) => {
          setDetalhe(null);
          setRemarcando(m);
          setAgendarPara({ closerId: m.closer_id ?? null, date: new Date(m.scheduled_at) });
        }}
        onOpenLead={onOpenLead}
      />
    </div>
  );
}
