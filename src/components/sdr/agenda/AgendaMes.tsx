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
  configFor,
  closerColor,
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
import MeetingDetailModal from "./MeetingDetailModal";
import { MEETING_STATUS_LABELS, type CloserConfig, type Meeting, type SdrUser } from "../types";

/** Quantas reuniões cabem numa célula antes do "+N mais". */
const MAX_POR_DIA = 3;
const COR_SEM_DONO = "#94A3B8";

/** Azul QS — no escuro o #0147FF sobre carta escura fica ilegível. */
const LINK = "text-[#0147FF] dark:text-[#86A9FF]";

const ic = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IcChevronL = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M15 18l-6-6 6-6" /></svg>);
const IcChevronR = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M9 18l6-6-6-6" /></svg>);
const IcPlus = ({ s = 15 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M12 5v14M5 12h14" /></svg>);
const IcAlert = ({ s = 13 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
const IcX = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M18 6L6 18M6 6l12 12" /></svg>);

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
}

export default function AgendaMes({ onOpenLead, onAbrirDia, demo }: AgendaMesProps) {
  const { currentUser } = useQsAuth();
  // Espectador (marketing): calendário só de leitura.
  const executa = podeExecutar(currentUser?.role);

  const [mes, setMes] = useState<Date>(() => startOfDay(new Date()));
  const [agora, setAgora] = useState(new Date());

  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  /** Vazio = todos. Guarda a chave do especialista (ver chaveDoEspecialista). */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [diaAberto, setDiaAberto] = useState<Date | null>(null);
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
    const [c, cfg, mt] = await Promise.all([
      fetchClosers(),
      fetchCloserConfigs(),
      fetchMeetingsInRange(new Date(de), new Date(ate)),
    ]);
    setClosers(c);
    setConfigs(cfg);
    setMeetings(mt);
    setLoading(false);
  }, [de, ate, demo]);

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

  // Esc fecha o painel do dia — é o que a mão espera de um painel sobreposto.
  useEffect(() => {
    if (!diaAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDiaAberto(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [diaAberto]);

  // ── Especialistas ──────────────────────────────────────────────────────────
  // Closers de verdade primeiro; depois os nomes que só existem como texto livre
  // em `meeting_owner`, pra tela servir mesmo antes de alguém ter o papel closer.
  const especialistas = useMemo<Especialista[]>(() => {
    const out: Especialista[] = closers.map((c, i) => ({
      key: c.id,
      closerId: c.id,
      nome: c.name,
      cor: closerColor(c.id, i, configFor(c.id, configs)),
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
        cor: key === "sem" ? COR_SEM_DONO : closerColor(key, i, null),
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

  const listaDoDiaAberto = diaAberto ? porDia.get(chaveDoDia(diaAberto)) ?? [] : [];

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
  const btnIcone = "p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors";

  return (
    <div className="space-y-3" style={{ fontFamily: "inherit" }}>
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMes(startOfDay(new Date()))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Hoje
          </button>
          <div className="flex items-center">
            <button onClick={() => setMes(addMonths(mes, -1))} aria-label="Mês anterior" className={btnIcone}>
              <IcChevronL />
            </button>
            <button onClick={() => setMes(addMonths(mes, 1))} aria-label="Próximo mês" className={btnIcone}>
              <IcChevronR />
            </button>
          </div>
          {/* `capitalize` do Tailwind maiusculiza TODA palavra e vira "Agosto De
              2026". Só a primeira letra sobe. */}
          <h2 className="ml-1 text-base font-bold text-gray-900 first-letter:uppercase">
            {periodLabel("mes", mes)}
          </h2>
          {!loading && (
            <span className="text-xs text-gray-400">
              · {doMes.length} reunião{doMes.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pendentesNaTela > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"
              title="Reuniões desta tela que já terminaram e continuam sem desfecho — abra o dia para resolver"
            >
              <IcAlert />
              {pendentesNaTela} sem desfecho
            </span>
          )}
          {executa && <button
            onClick={() => agendarEm(new Date())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0147FF] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0139D6]"
          >
            <IcPlus />
            Agendar
          </button>}
        </div>
      </div>

      {/* Filtro por especialista — é a "lista de agendas" da Google Agenda */}
      {especialistas.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {especialistas.map((e) => {
            const ativo = selecionados.size === 0 || selecionados.has(e.key);
            return (
              <button
                key={e.key}
                onClick={() => alternarEspecialista(e.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  ativo ? "border-gray-200 bg-white text-gray-700" : "border-gray-100 bg-gray-50 text-gray-400"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: ativo ? e.cor : "#CBD5E1" }} />
                {e.nome}
              </button>
            );
          })}
          {selecionados.size > 0 && (
            <button
              onClick={() => setSelecionados(new Set())}
              className={`px-1.5 text-xs font-semibold hover:underline ${LINK}`}
            >
              Mostrar todos
            </button>
          )}
        </div>
      )}

      {/* Grade do mês */}
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="grid grid-cols-7 border-b border-gray-100">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {w}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400">Carregando a agenda…</p>
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {dias.map((d) => {
              const noMes = d.getMonth() === mes.getMonth();
              const hoje = isToday(d);
              const lista = porDia.get(chaveDoDia(d)) ?? [];
              const sobrando = Math.max(0, lista.length - MAX_POR_DIA);

              return (
                <div
                  key={d.getTime()}
                  className={`group relative min-h-[112px] border-b border-r border-gray-100 p-1.5 ${
                    // Dia de outro mês: no claro é um cinza levíssimo; no escuro
                    // tem que AFUNDAR (mais escuro que a carta), senão vira o
                    // retângulo cinza claro que estraga a tela inteira.
                    noMes ? "bg-gray-50 dark:bg-[#12181F]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => (onAbrirDia ? onAbrirDia(d) : setDiaAberto(d))}
                      title={onAbrirDia ? "Abrir este dia em Reuniões" : "Ver o dia inteiro"}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                        hoje
                          ? "bg-[#0147FF] text-white"
                          : noMes
                            ? "text-gray-700 hover:bg-gray-100"
                            : "text-gray-400 hover:bg-gray-100"
                      }`}
                    >
                      {d.getDate()}
                    </button>
                    {executa && <button
                      onClick={() => agendarEm(d)}
                      title="Agendar neste dia"
                      className="rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-[#0147FF] focus:opacity-100 group-hover:opacity-100 dark:hover:text-[#86A9FF]"
                      aria-label={`Agendar em ${d.getDate()}`}
                    >
                      <IcPlus s={13} />
                    </button>}
                  </div>

                  <div className="mt-1 space-y-0.5">
                    {lista.slice(0, MAX_POR_DIA).map((m) => {
                      const inicio = new Date(m.scheduled_at);
                      const cor = corDaChave.get(chaveDoEspecialista(m)) ?? COR_SEM_DONO;
                      const pendencia = semDesfecho(m, agora);
                      const nome = nomeDoLead(m);
                      return (
                        <button
                          key={m.id}
                          onClick={() => setDetalhe(m)}
                          title={`${shortTime(inicio)} · ${nome} · ${nomeDoEspecialista(m)}${pendencia ? " · sem desfecho" : ""}`}
                          className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-100 ${
                            // Reunião já resolvida fica de lado, não apagada: no
                            // escuro 50% de opacidade sobre carta escura já é
                            // ilegível, então lá o desconto é menor.
                            m.status === "agendada" || m.status === "confirmada" ? "" : "opacity-50 dark:opacity-65"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cor }} />
                          <span className="shrink-0 text-[10px] font-semibold text-gray-500">
                            {shortTime(inicio)}
                          </span>
                          <span
                            className={`truncate text-[10px] text-gray-700 ${
                              m.status === "cancelada" ? "line-through" : ""
                            }`}
                          >
                            {nome}
                          </span>
                          {pendencia && <span className="ml-auto shrink-0 text-amber-500"><IcAlert s={11} /></span>}
                        </button>
                      );
                    })}
                    {sobrando > 0 && (
                      <button
                        onClick={() => (onAbrirDia ? onAbrirDia(d) : setDiaAberto(d))}
                        className={`w-full px-1 text-left text-[10px] font-semibold hover:underline ${LINK}`}
                      >
                        +{sobrando} mais
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="px-3 py-2 text-[11px] text-gray-400">
          Clique no número do dia para ver o dia inteiro por especialista. Passe o mouse sobre um dia para agendar nele.
        </p>
      </div>

      {/* Painel do dia — a lista completa daquele dia, sem sair da Agenda */}
      {diaAberto && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDiaAberto(null)} />
          <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-100 bg-white">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {WEEKDAY_LONG[diaAberto.getDay()]}, {diaAberto.getDate()} de {MONTH_LONG[diaAberto.getMonth()]}
                </h3>
                <p className="text-xs text-gray-500">
                  {listaDoDiaAberto.length === 0
                    ? "Nenhuma reunião neste dia"
                    : `${listaDoDiaAberto.length} reunião${listaDoDiaAberto.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <button onClick={() => setDiaAberto(null)} aria-label="Fechar" className={btnIcone}>
                <IcX />
              </button>
            </div>

            <div className="space-y-1.5 p-4">
              {listaDoDiaAberto.map((m) => {
                const inicio = new Date(m.scheduled_at);
                const cor = corDaChave.get(chaveDoEspecialista(m)) ?? COR_SEM_DONO;
                const pendencia = semDesfecho(m, agora);
                return (
                  <button
                    key={m.id}
                    onClick={() => { setDiaAberto(null); setDetalhe(m); }}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-gray-100 p-2.5 text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cor }} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold text-gray-900 ${m.status === "cancelada" ? "line-through" : ""}`}>
                        {nomeDoLead(m)}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {hhmm(inicio)} · {nomeDoEspecialista(m)} · {MEETING_STATUS_LABELS[m.status]}
                      </p>
                    </div>
                    {pendencia && (
                      <span className="shrink-0 text-amber-500" title="Já terminou e continua sem desfecho">
                        <IcAlert s={15} />
                      </span>
                    )}
                  </button>
                );
              })}

              <button
                onClick={() => { const d = diaAberto; setDiaAberto(null); agendarEm(d); }}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                <IcPlus s={14} />
                Agendar neste dia
              </button>
            </div>
          </div>
        </div>
      )}

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
