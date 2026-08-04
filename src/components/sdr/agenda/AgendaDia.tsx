// src/components/sdr/agenda/AgendaDia.tsx
// -----------------------------------------------------------------------------
// A AGENDA DO DIA, UMA COLUNA POR ESPECIALISTA — no layout do Agendamento do
// Bitrix, que é o que a operação já conhece.
//
// A pergunta que esta tela responde num relance é "quem está livre às 15h?", e a
// segunda, mais importante: "que reunião já passou e ninguém disse no que deu?".
// Por isso o contador de PENDENTES no topo — reunião que terminou e continua
// como agendada/confirmada é buraco no funil, não detalhe visual.
//
// Colunas: os usuários com papel `closer`. Enquanto ninguém tiver esse papel, as
// colunas nascem do nome do responsável gravado na própria reunião
// (`meeting_owner`, o texto livre que a operação usa hoje) — assim a tela serve
// desde o primeiro dia, e migra sozinha quando os closers existirem de verdade.
//
// Clique em espaço vazio = agendar naquele horário. Clique na reunião = painel
// de desfecho, onde nasce o SAL (lead aceito/recusado).
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  fetchClosers,
  fetchCloserConfigs,
  fetchAvailability,
  fetchBlocks,
  fetchMeetingsInRange,
  configFor,
  closerColor,
  startOfDay,
  addDays,
  sameDay,
  fimDaReuniao,
  semDesfecho,
  chaveDoEspecialista,
} from "@/lib/qs/closerAgenda";
import { setMeetingStatus, setMeetingSal } from "@/lib/qs/meetings";
import ScheduleMeetingModal from "./ScheduleMeetingModal";
import type {
  CloserAvailability,
  CloserBlock,
  CloserConfig,
  Meeting,
  MeetingSal,
  MeetingStatus,
  SdrUser,
} from "../types";

// ── Tokens visuais ───────────────────────────────────────────────────────────
// Mesma semântica de cor do resto do QS: azul = combinado, verde = aconteceu,
// vermelho = furou, âmbar = mudou, cinza = morreu.

interface StatusToken {
  label: string;
  cor: string;
  fundo: string;
  texto: string;
}

const STATUS: Record<MeetingStatus, StatusToken> = {
  agendada:   { label: "Agendada",   cor: "#0147FF", fundo: "rgba(1,71,255,0.10)",    texto: "#1E3A8A" },
  confirmada: { label: "Confirmada", cor: "#0891B2", fundo: "rgba(8,145,178,0.12)",   texto: "#0E7490" },
  realizada:  { label: "Realizada",  cor: "#059669", fundo: "rgba(5,150,105,0.12)",   texto: "#047857" },
  no_show:    { label: "No-show",    cor: "#DC2626", fundo: "rgba(220,38,38,0.10)",   texto: "#B91C1C" },
  reagendada: { label: "Reagendada", cor: "#D97706", fundo: "rgba(217,119,6,0.12)",   texto: "#B45309" },
  cancelada:  { label: "Cancelada",  cor: "#64748B", fundo: "rgba(100,116,139,0.10)", texto: "#475569" },
};

const LARGURA_EIXO = 56;         // px da coluna de horas
const LARGURA_MIN_COLUNA = 210;  // px mínimos por especialista
const ALTURA_HORA_BASE = 56;     // px por hora em zoom 100%
const HORA_INICIO_PADRAO = 8;
const HORA_FIM_PADRAO = 20;

// ── Ícones (SVG inline, no traço do resto do app) ────────────────────────────
const ic = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IcChevronL = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M15 18l-6-6 6-6" /></svg>);
const IcChevronR = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M9 18l6-6-6-6" /></svg>);
const IcPlus = ({ s = 15 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M12 5v14M5 12h14" /></svg>);
const IcCheck = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M20 6L9 17l-5-5" /></svg>);
const IcX = ({ s = 18 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M18 6L6 18M6 6l12 12" /></svg>);
const IcRedo = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M3 2v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" /></svg>);
const IcUserX = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M17 8l5 5M22 8l-5 5" /></svg>);
const IcVideo = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>);
const IcCopy = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>);
const IcClock = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>);
const IcAlert = ({ s = 13 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
const IcExternal = ({ s = 14 }: { s?: number }) => (<svg width={s} height={s} {...ic}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>);
const IcZoomIn = ({ s = 16 }: { s?: number }) => (<svg width={s} height={s} {...ic}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" /></svg>);
const IcZoomOut = ({ s = 16 }: { s?: number }) => (<svg width={s} height={s} {...ic}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M8 11h6" /></svg>);

// ── Utilidades de tempo ──────────────────────────────────────────────────────
const dd = (n: number) => String(n).padStart(2, "0");
const minutosDoDia = (d: Date) => d.getHours() * 60 + d.getMinutes();
const hhmm = (d: Date) => `${dd(d.getHours())}:${dd(d.getMinutes())}`;

function dataLonga(d: Date): string {
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}


function minutosDeHms(hms: string): number {
  const [h, m] = (hms || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Faixas para reuniões que se sobrepõem ────────────────────────────────────
// Mesmo comportamento do Bitrix quando há choque de horário: os cards dividem a
// largura da coluna em vez de um cobrir o outro.

interface ComFaixa {
  m: Meeting;
  faixa: number;
  totalFaixas: number;
}

function distribuirEmFaixas(ms: Meeting[]): ComFaixa[] {
  const ordenados = [...ms].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );

  const blocos: Meeting[][] = [];
  let atual: Meeting[] = [];
  let fimDoBloco = 0;

  for (const m of ordenados) {
    const ini = new Date(m.scheduled_at).getTime();
    if (atual.length && ini >= fimDoBloco) {
      blocos.push(atual);
      atual = [];
      fimDoBloco = 0;
    }
    atual.push(m);
    fimDoBloco = Math.max(fimDoBloco, fimDaReuniao(m).getTime());
  }
  if (atual.length) blocos.push(atual);

  const saida: ComFaixa[] = [];
  for (const bloco of blocos) {
    const fimDaFaixa: number[] = [];
    const doBloco: ComFaixa[] = [];
    for (const m of bloco) {
      const ini = new Date(m.scheduled_at).getTime();
      let idx = fimDaFaixa.findIndex((f) => f <= ini);
      if (idx === -1) {
        fimDaFaixa.push(fimDaReuniao(m).getTime());
        idx = fimDaFaixa.length - 1;
      } else {
        fimDaFaixa[idx] = fimDaReuniao(m).getTime();
      }
      doBloco.push({ m, faixa: idx, totalFaixas: 1 });
    }
    for (const item of doBloco) saida.push({ ...item, totalFaixas: fimDaFaixa.length });
  }
  return saida;
}

// ── Colunas ──────────────────────────────────────────────────────────────────

interface Coluna {
  key: string;
  closerId: string | null;   // null = coluna herdada do texto livre
  nome: string;
  papel: string;
  cor: string;
  /** Só dá pra clicar-e-agendar em quem é closer de verdade (tem agenda no banco). */
  agendavel: boolean;
}


// ── Componente ───────────────────────────────────────────────────────────────

/** Dados injetados — usado SÓ pela página de preview (agenda-preview.html). */
export interface AgendaDiaDemo {
  closers: SdrUser[];
  configs: CloserConfig[];
  availability: CloserAvailability[];
  blocks: CloserBlock[];
  meetings: Meeting[];
}

interface AgendaDiaProps {
  onOpenLead?: (leadId: string) => void;
  /** Dia que a tela deve abrir — é assim que o clique num dia da Agenda (mês)
   *  chega aqui. Trocar o valor REPOSICIONA a tela; navegar depois é livre. */
  dataInicial?: Date | null;
  /** Em produção nunca é passado: liga o modo preview (sem banco, sem gravação). */
  demo?: AgendaDiaDemo;
}

export default function AgendaDia({ onOpenLead, dataInicial, demo }: AgendaDiaProps) {
  const { currentUser } = useQsAuth();

  const [dia, setDia] = useState<Date>(() => startOfDay(dataInicial ?? new Date()));

  // Vem da Agenda do mês: cada clique num dia manda um Date novo. Comparo pelo
  // TEMPO, e não pela referência, senão um re-render do pai jogaria o SDR de
  // volta pro dia clicado enquanto ele navega com as setas.
  const dataInicialMs = dataInicial ? startOfDay(dataInicial).getTime() : null;
  useEffect(() => {
    if (dataInicialMs !== null) setDia(new Date(dataInicialMs));
  }, [dataInicialMs]);
  const [zoom, setZoom] = useState(1);
  const [filtro, setFiltro] = useState<"todas" | "pendentes" | MeetingStatus>("todas");
  const [agora, setAgora] = useState(new Date());
  const [selecionada, setSelecionada] = useState<Meeting | null>(null);

  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [availability, setAvailability] = useState<CloserAvailability[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const [agendarPara, setAgendarPara] = useState<{ closerId: string | null; date: Date } | null>(null);
  const [remarcando, setRemarcando] = useState<Meeting | null>(null);

  const gradeRef = useRef<HTMLDivElement>(null);
  const cabecalhoRef = useRef<HTMLDivElement>(null);
  const jaRolou = useRef<string>("");

  const alturaHora = ALTURA_HORA_BASE * zoom;

  // Relógio do marcador de "agora" (e do contador de pendentes).
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Carga ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (demo) {
      setClosers(demo.closers);
      setConfigs(demo.configs);
      setAvailability(demo.availability);
      setBlocks(demo.blocks);
      setMeetings(demo.meetings);
      setLoading(false);
      return;
    }
    const from = startOfDay(dia);
    const to = addDays(from, 1);
    const [c, cfg, av, bl, mt] = await Promise.all([
      fetchClosers(),
      fetchCloserConfigs(),
      fetchAvailability(),
      fetchBlocks(from, to),
      fetchMeetingsInRange(from, to),
    ]);
    setClosers(c);
    setConfigs(cfg);
    setAvailability(av);
    setBlocks(bl);
    setMeetings(mt);
    setLoading(false);
  }, [dia, demo]);

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
      .channel("qs_agenda_closers")
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_meetings" }, onChange)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [load, demo]);

  // ── Recortes ───────────────────────────────────────────────────────────────
  const ehHoje = sameDay(dia, agora);

  const doDia = useMemo(
    () => meetings.filter((m) => sameDay(new Date(m.scheduled_at), dia)),
    [meetings, dia]
  );

  const contagens = useMemo(() => {
    const c: Record<string, number> = { todas: doDia.length, pendentes: 0 };
    (Object.keys(STATUS) as MeetingStatus[]).forEach((k) => (c[k] = 0));
    for (const m of doDia) {
      c[m.status] = (c[m.status] ?? 0) + 1;
      if (semDesfecho(m, agora)) c.pendentes += 1;
    }
    return c;
  }, [doDia, agora]);

  const visiveis = useMemo(() => {
    if (filtro === "todas") return doDia;
    if (filtro === "pendentes") return doDia.filter((m) => semDesfecho(m, agora));
    return doDia.filter((m) => m.status === filtro);
  }, [doDia, filtro, agora]);

  /** Closers de verdade + colunas herdadas do responsável em texto livre. */
  const colunas = useMemo<Coluna[]>(() => {
    const out: Coluna[] = closers.map((c, i) => ({
      key: c.id,
      closerId: c.id,
      nome: c.name,
      papel: "Especialista",
      cor: closerColor(c.id, i, configFor(c.id, configs)),
      agendavel: configFor(c.id, configs).is_bookable,
    }));

    const extras = new Map<string, string>();
    for (const m of doDia) {
      const key = chaveDoEspecialista(m);
      if (out.some((c) => c.key === key)) continue;
      if (!extras.has(key)) {
        extras.set(key, (m.closer?.name || m.meeting_owner || "").trim() || "Sem especialista");
      }
    }
    let i = out.length;
    for (const [key, nome] of extras) {
      out.push({
        key,
        closerId: key.startsWith("nome:") || key === "sem" ? null : key,
        nome,
        papel: key === "sem" ? "não atribuída" : "responsável (texto)",
        cor: key === "sem" ? "#94A3B8" : closerColor(key, i, null),
        agendavel: false,
      });
      i += 1;
    }
    return out;
  }, [closers, configs, doDia]);

  const porColuna = useMemo(() => {
    const mapa: Record<string, ComFaixa[]> = {};
    for (const col of colunas) {
      mapa[col.key] = distribuirEmFaixas(visiveis.filter((m) => chaveDoEspecialista(m) === col.key));
    }
    return mapa;
  }, [colunas, visiveis]);

  /** Janela de horas da grade: cobre o expediente configurado E o que já existe no dia. */
  const [horaInicio, horaFim] = useMemo(() => {
    let ini = HORA_INICIO_PADRAO;
    let fim = HORA_FIM_PADRAO;
    for (const a of availability) {
      if (a.weekday !== dia.getDay()) continue;
      ini = Math.min(ini, Math.floor(minutosDeHms(a.start_time) / 60));
      fim = Math.max(fim, Math.ceil(minutosDeHms(a.end_time) / 60));
    }
    for (const m of doDia) {
      ini = Math.min(ini, new Date(m.scheduled_at).getHours());
      fim = Math.max(fim, Math.ceil(minutosDoDia(fimDaReuniao(m)) / 60));
    }
    if (ehHoje) {
      ini = Math.min(ini, agora.getHours());
      fim = Math.max(fim, agora.getHours() + 1);
    }
    return [Math.max(0, ini), Math.min(24, Math.max(fim, ini + 4))];
  }, [availability, doDia, dia, ehHoje, agora]);

  const totalHoras = horaFim - horaInicio;
  const posicaoDe = useCallback(
    (d: Date) => ((minutosDoDia(d) - horaInicio * 60) / 60) * alturaHora,
    [horaInicio, alturaHora]
  );

  // Rola até o horário atual quando abre o dia de hoje.
  useEffect(() => {
    const chave = `${dia.toDateString()}`;
    if (!gradeRef.current || !ehHoje || loading || jaRolou.current === chave) return;
    jaRolou.current = chave;
    // O cabeçalho das colunas mora DENTRO da rolagem (fica sticky no topo), então
    // ele entra na conta de onde o "agora" está.
    const alturaCabecalho = cabecalhoRef.current?.offsetHeight ?? 0;
    gradeRef.current.scrollTop = Math.max(0, posicaoDe(new Date()) + alturaCabecalho - 140);
  }, [dia, ehHoje, loading, posicaoDe]);

  const linhaAgora = ehHoje ? posicaoDe(agora) : null;
  const agoraVisivel = linhaAgora !== null && linhaAgora >= 0 && linhaAgora <= totalHoras * alturaHora;

  // ── Faixas fora do expediente ──────────────────────────────────────────────
  // Sem disponibilidade cadastrada NÃO hachuramos o dia inteiro: a agenda dos
  // closers (0027) pode nem estar preenchida, e uma tela toda riscada parece
  // defeito. Hachura só quando existe janela cadastrada pra aquele dia.
  const forasDoExpediente = useCallback(
    (col: Coluna): { topo: number; altura: number }[] => {
      if (!col.closerId) return [];
      const janelas = availability
        .filter((a) => a.closer_id === col.closerId && a.weekday === dia.getDay())
        .map((a) => [minutosDeHms(a.start_time) / 60, minutosDeHms(a.end_time) / 60] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      if (!janelas.length) return [];

      const bloqueios: { topo: number; altura: number }[] = [];
      let cursor = horaInicio;
      for (const [hi, hf] of janelas) {
        const ini = Math.max(hi, horaInicio);
        const fim = Math.min(hf, horaFim);
        if (ini > cursor) bloqueios.push({ topo: (cursor - horaInicio) * alturaHora, altura: (ini - cursor) * alturaHora });
        cursor = Math.max(cursor, fim);
      }
      if (cursor < horaFim) bloqueios.push({ topo: (cursor - horaInicio) * alturaHora, altura: (horaFim - cursor) * alturaHora });
      return bloqueios.filter((b) => b.altura > 0);
    },
    [availability, dia, horaInicio, horaFim, alturaHora]
  );

  /** Bloqueios pontuais (férias, compromisso) do dia, por coluna. */
  const bloqueiosDe = useCallback(
    (col: Coluna) => {
      if (!col.closerId) return [];
      return blocks
        .filter((b) => b.closer_id === col.closerId)
        .map((b) => {
          const ini = new Date(b.starts_at);
          const fim = new Date(b.ends_at);
          const topo = Math.max(0, posicaoDe(sameDay(ini, dia) ? ini : startOfDay(dia)));
          const base = sameDay(fim, dia) ? posicaoDe(fim) : totalHoras * alturaHora;
          return { id: b.id, topo, altura: Math.max(6, base - topo), reason: b.reason };
        });
    },
    [blocks, dia, posicaoDe, totalHoras, alturaHora]
  );

  // ── Ações ──────────────────────────────────────────────────────────────────
  const irPara = (delta: number) => setDia((d) => addDays(d, delta));

  const clicarVazio = (col: Coluna, e: React.MouseEvent<HTMLDivElement>) => {
    if (!col.agendavel) return;
    // getBoundingClientRect já é relativo à viewport (a rolagem entra na conta).
    const caixa = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - caixa.top;
    const brutos = (y / alturaHora) * 60 + horaInicio * 60;
    const minutos = Math.max(0, Math.floor(brutos / 30) * 30); // encaixa de 30 em 30
    const quando = startOfDay(dia);
    quando.setHours(0, minutos, 0, 0);
    setAgendarPara({ closerId: col.closerId, date: quando });
  };

  const mudarStatus = async (m: Meeting, status: MeetingStatus) => {
    if (demo) {
      const novo = { ...m, status };
      setMeetings((ms) => ms.map((x) => (x.id === m.id ? novo : x)));
      setSelecionada(novo);
      return;
    }
    const r = await setMeetingStatus(m, status);
    if (!r.ok) return notifyError(r.error);
    notifySuccess(`Reunião marcada como ${STATUS[status].label.toLowerCase()}.`);
    setSelecionada(r.meeting);
    void load();
  };

  const marcarSal = async (m: Meeting, sal: MeetingSal) => {
    const alvo = m.sal === sal ? null : sal;
    if (demo) {
      const novo = { ...m, sal: alvo };
      setMeetings((ms) => ms.map((x) => (x.id === m.id ? novo : x)));
      setSelecionada(novo);
      return;
    }
    const r = await setMeetingSal(m, alvo, currentUser?.id ?? null);
    if (!r.ok) return notifyError(r.error);
    setSelecionada(r.meeting);
    if (alvo) notifySuccess(`Lead ${alvo} registrado.`);
    void load();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const chips: { chave: "todas" | MeetingStatus; rotulo: string }[] = [
    { chave: "todas", rotulo: "Todas" },
    { chave: "agendada", rotulo: "Agendadas" },
    { chave: "confirmada", rotulo: "Confirmadas" },
    { chave: "realizada", rotulo: "Realizadas" },
    { chave: "no_show", rotulo: "No-show" },
    { chave: "reagendada", rotulo: "Reagendadas" },
    { chave: "cancelada", rotulo: "Canceladas" },
  ];

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
      style={{ fontFamily: "inherit", height: "calc(100vh - 210px)", minHeight: 520 }}
    >
      {/* ── Topo ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-1">
          <button onClick={() => irPara(-1)} aria-label="Dia anterior" className={btnIcone}>
            <IcChevronL />
          </button>
          <button onClick={() => irPara(1)} aria-label="Próximo dia" className={btnIcone}>
            <IcChevronR />
          </button>
        </div>

        <div>
          <div className="text-[15px] font-bold text-gray-900">{dataLonga(dia)}</div>
          <div className="text-xs text-gray-500">
            {contagens.todas} {contagens.todas === 1 ? "reunião" : "reuniões"} no dia
          </div>
        </div>

        <button
          onClick={() => setDia(startOfDay(new Date()))}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
        >
          Hoje
        </button>

        {/* Pendentes: o número que expõe o funil furado */}
        {contagens.pendentes > 0 && (
          <button
            onClick={() => setFiltro("pendentes")}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
              filtro === "pendentes"
                ? "border-red-600 bg-red-600 text-white"
                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            }`}
            title="Reuniões que já terminaram e continuam sem desfecho"
          >
            <IcAlert />
            {contagens.pendentes} sem desfecho
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} aria-label="Diminuir zoom" className={btnIcone}>
            <IcZoomOut />
          </button>
          <span className="w-10 text-center text-xs tabular-nums text-gray-400">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} aria-label="Aumentar zoom" className={btnIcone}>
            <IcZoomIn />
          </button>
          <button
            onClick={() => setAgendarPara({ closerId: null, date: startOfDay(dia) })}
            className="ml-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/30"
            style={{ background: "#0147FF" }}
          >
            <IcPlus /> Agendar reunião
          </button>
        </div>
      </div>

      {/* ── Filtros ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 px-4 py-2">
        {chips.map(({ chave, rotulo }) => {
          const ativo = filtro === chave;
          const qtd = contagens[chave] ?? 0;
          return (
            <button
              key={chave}
              onClick={() => setFiltro(chave)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 ${
                ativo ? "text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
              style={ativo ? { background: chave === "todas" ? "#0147FF" : STATUS[chave as MeetingStatus].cor } : undefined}
            >
              {chave !== "todas" && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: ativo ? "rgba(255,255,255,.85)" : STATUS[chave as MeetingStatus].cor }}
                />
              )}
              {rotulo}
              <span className={ativo ? "text-white/75" : "text-gray-400"}>{qtd}</span>
            </button>
          );
        })}
      </div>

      {/* ── Cabeçalho + grade ──────────────────────────────────────────────── */}
      {/* Um contêiner de rolagem só: com muitos especialistas a grade rola pro
          lado, e o cabeçalho PRECISA rolar junto — senão o nome do especialista
          deixa de bater com a coluna dele, que é o erro mais caro desta tela. */}
      <div ref={gradeRef} className="relative flex-1 overflow-auto">
        {loading ? (
          <div className="p-4">
            <div className="h-full animate-pulse space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-10 rounded-lg bg-gray-100" />
              ))}
            </div>
          </div>
        ) : (
        <div style={{ minWidth: LARGURA_EIXO + colunas.length * LARGURA_MIN_COLUNA }}>
          <div ref={cabecalhoRef} className="sticky top-0 z-40 flex border-b border-gray-200 bg-gray-50">
            <div style={{ width: LARGURA_EIXO }} className="sticky left-0 z-10 shrink-0 bg-gray-50" />
            {colunas.map((col) => {
              const dele = doDia.filter((m) => chaveDoEspecialista(m) === col.key);
              const pend = dele.filter((m) => semDesfecho(m, agora)).length;
              return (
                <div
                  key={col.key}
                  style={{ minWidth: LARGURA_MIN_COLUNA }}
                  className="flex flex-1 items-center gap-2 border-l border-gray-200 px-3 py-2.5"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: col.cor }} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-gray-900">{col.nome}</div>
                    <div className="truncate text-xs text-gray-500">
                      {col.papel} · {dele.length} {dele.length === 1 ? "reunião" : "reuniões"}
                      {pend > 0 && <span className="ml-1 font-semibold text-red-600">· {pend} semDesfecho(s)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {!colunas.length && (
              <div className="flex-1 px-4 py-2.5 text-sm text-gray-400">Nenhuma reunião neste dia.</div>
            )}
          </div>

          <div className="relative flex" style={{ height: totalHoras * alturaHora }}>
            {/* eixo de horas */}
            <div style={{ width: LARGURA_EIXO }} className="sticky left-0 z-20 shrink-0 bg-white">
              {Array.from({ length: totalHoras }, (_, i) => (
                <div key={i} style={{ height: alturaHora }} className="relative border-b border-gray-100">
                  <span className="absolute right-2 -top-2 bg-white px-0.5 text-xs tabular-nums text-gray-400">
                    {dd(horaInicio + i)}:00
                  </span>
                </div>
              ))}
            </div>

            {/* colunas */}
            {colunas.map((col) => (
              <div
                key={col.key}
                style={{ minWidth: LARGURA_MIN_COLUNA }}
                className={`relative flex-1 border-l border-gray-200 ${col.agendavel ? "cursor-copy" : ""}`}
                onClick={(e) => clicarVazio(col, e)}
                title={col.agendavel ? "Clique num horário livre para agendar" : undefined}
              >
                {/* linhas de hora e meia hora */}
                {Array.from({ length: totalHoras }, (_, i) => (
                  <div key={i} style={{ height: alturaHora }} className="border-b border-gray-100">
                    <div className="border-b border-dashed border-gray-100" style={{ height: alturaHora / 2 }} />
                  </div>
                ))}

                {/* fora do expediente */}
                {forasDoExpediente(col).map((b, i) => (
                  <div
                    key={`f${i}`}
                    className="pointer-events-none absolute inset-x-0"
                    style={{
                      top: b.topo,
                      height: b.altura,
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(148,163,184,0.10) 0 6px, transparent 6px 12px)",
                    }}
                  />
                ))}

                {/* bloqueios (férias, compromisso) */}
                {bloqueiosDe(col).map((b) => (
                  <div
                    key={b.id}
                    className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-md border border-dashed border-gray-300 px-2 py-0.5"
                    style={{ top: b.topo, height: b.altura, background: "rgba(148,163,184,0.14)" }}
                  >
                    <span className="text-[11px] font-semibold text-gray-500">{b.reason || "Indisponível"}</span>
                  </div>
                ))}

                {/* reuniões */}
                {(porColuna[col.key] ?? []).map(({ m, faixa, totalFaixas }) => {
                  const st = STATUS[m.status] ?? STATUS.agendada;
                  const ini = new Date(m.scheduled_at);
                  const fim = fimDaReuniao(m);
                  const topo = posicaoDe(ini);
                  const altura = Math.max(22, ((fim.getTime() - ini.getTime()) / 3_600_000) * alturaHora - 2);
                  const largura = 100 / totalFaixas;
                  const atrasada = semDesfecho(m, agora);
                  const morta = m.status === "cancelada";

                  return (
                    <button
                      key={m.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelecionada(m);
                      }}
                      className="absolute overflow-hidden rounded-md px-2 py-1 text-left transition hover:z-10 hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/40"
                      style={{
                        top: topo,
                        height: altura,
                        left: `calc(${faixa * largura}% + 4px)`,
                        width: `calc(${largura}% - 8px)`,
                        background: st.fundo,
                        borderLeft: `3px solid ${st.cor}`,
                        boxShadow: atrasada ? "0 0 0 1.5px rgba(220,38,38,.55)" : "none",
                        opacity: morta ? 0.55 : 1,
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className="truncate text-xs font-bold"
                          style={{ color: st.texto, textDecoration: morta ? "line-through" : "none" }}
                        >
                          {m.lead_name || m.lead?.full_name || m.title || "Reunião"}
                        </span>
                        {atrasada && <span className="shrink-0 text-red-600"><IcAlert s={11} /></span>}
                      </div>
                      {altura > 34 && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] tabular-nums text-gray-500">
                          {hhmm(ini)} – {hhmm(fim)}
                          {m.meeting_link && <span className="text-emerald-600"><IcVideo s={10} /></span>}
                          {m.sal && (
                            <span className={`ml-auto font-bold ${m.sal === "aceito" ? "text-emerald-600" : "text-red-600"}`}>
                              SAL
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* marcador de agora */}
            {agoraVisivel && (
              <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top: linhaAgora! }}>
                <span
                  className="rounded px-1 text-[11px] font-bold tabular-nums text-white"
                  style={{ background: "#DC2626", marginLeft: 4 }}
                >
                  {hhmm(agora)}
                </span>
                <div className="h-px flex-1" style={{ background: "#DC2626" }} />
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Aviso: sem closer cadastrado, as colunas vieram do texto livre */}
      {!loading && !closers.length && colunas.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Nenhum usuário com papel <b>closer</b> cadastrado — as colunas vieram do
          “Responsável pela reunião” gravado em cada reunião. Para clicar-e-agendar
          direto na grade, crie os especialistas em Configurações → Usuários (papel
          closer) e defina a agenda deles.
        </div>
      )}

      {/* ── Painel de detalhe ──────────────────────────────────────────────── */}
      {selecionada && (
        <PainelReuniao
          reuniao={selecionada}
          coluna={colunas.find((c) => c.key === chaveDoEspecialista(selecionada))}
          agora={agora}
          onFechar={() => setSelecionada(null)}
          onStatus={(s) => void mudarStatus(selecionada, s)}
          onSal={(s) => void marcarSal(selecionada, s)}
          onRemarcar={() => {
            setRemarcando(selecionada);
            setSelecionada(null);
          }}
          onAbrirLead={onOpenLead ? () => onOpenLead(selecionada.lead_id) : undefined}
        />
      )}

      {/* ── Agendar / remarcar (reusa o modal da agenda) ───────────────────── */}
      <ScheduleMeetingModal
        open={!!agendarPara || !!remarcando}
        onClose={() => {
          setAgendarPara(null);
          setRemarcando(null);
        }}
        onSaved={() => {
          setAgendarPara(null);
          setRemarcando(null);
          void load();
        }}
        initialCloserId={agendarPara?.closerId ?? null}
        initialDate={agendarPara?.date ?? null}
        reschedule={remarcando}
      />
    </div>
  );
}

const btnIcone =
  "rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20";

// ── Painel lateral ───────────────────────────────────────────────────────────

interface PainelProps {
  reuniao: Meeting;
  coluna?: Coluna;
  agora: Date;
  onFechar: () => void;
  onStatus: (s: MeetingStatus) => void;
  onSal: (s: MeetingSal) => void;
  onRemarcar: () => void;
  onAbrirLead?: () => void;
}

function PainelReuniao({ reuniao, coluna, agora, onFechar, onStatus, onSal, onRemarcar, onAbrirLead }: PainelProps) {
  const [copiado, setCopiado] = useState(false);
  const st = STATUS[reuniao.status] ?? STATUS.agendada;
  const ini = new Date(reuniao.scheduled_at);
  const fim = fimDaReuniao(reuniao);
  const atrasada = semDesfecho(reuniao, agora);

  const copiarLink = async () => {
    if (!reuniao.meeting_link) return;
    try {
      await navigator.clipboard.writeText(reuniao.meeting_link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      notifyError("Não foi possível copiar o link.");
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-gray-200 bg-white shadow-2xl sm:w-96">
      <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ background: st.fundo, color: st.texto }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.cor }} />
            {st.label}
          </span>
          <h2 className="mt-2 truncate text-lg font-bold text-gray-900">
            {reuniao.lead_name || reuniao.lead?.full_name || reuniao.title || "Reunião"}
          </h2>
          {reuniao.lead?.bitrix_id && <p className="text-xs text-gray-400">Negócio #{reuniao.lead.bitrix_id}</p>}
        </div>
        <button onClick={onFechar} aria-label="Fechar" className={btnIcone}>
          <IcX />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto px-5 py-4 text-sm">
        {atrasada && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="mt-0.5 shrink-0"><IcAlert /></span>
            <span>Esta reunião já terminou e continua sem desfecho. Registre abaixo o que aconteceu.</span>
          </div>
        )}

        <Linha icone={<IcClock />} rotulo="Horário">
          {hhmm(ini)} – {hhmm(fim)} · {Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 60_000))} min
        </Linha>
        <Linha rotulo="Especialista">{coluna?.nome || reuniao.meeting_owner || "—"}</Linha>
        <Linha rotulo="Agendado por">{reuniao.scheduled_by || reuniao.owner?.name || "—"}</Linha>
        {reuniao.location && <Linha rotulo="Local">{reuniao.location}</Linha>}

        {reuniao.meeting_link && (
          <div className="flex gap-2">
            <a
              href={reuniao.meeting_link}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
            >
              <IcVideo /> Entrar na reunião
            </a>
            <button
              onClick={() => void copiarLink()}
              aria-label="Copiar link"
              className="rounded-lg border border-gray-200 px-3 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
            >
              {copiado ? <IcCheck /> : <IcCopy />}
            </button>
          </div>
        )}

        {/* Desfecho: é aqui que o dado do funil nasce */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Desfecho</p>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <BotaoDesfecho cor="#059669" icone={<IcCheck />} rotulo="Realizada" onClick={() => onStatus("realizada")} />
            <BotaoDesfecho cor="#D97706" icone={<IcRedo />} rotulo="Reagendar" onClick={onRemarcar} />
            <BotaoDesfecho cor="#DC2626" icone={<IcUserX />} rotulo="No-show" onClick={() => onStatus("no_show")} />
          </div>

          {reuniao.status === "agendada" && (
            <button
              onClick={() => onStatus("confirmada")}
              className="mt-1.5 w-full rounded-lg border py-1.5 text-xs font-bold transition hover:brightness-95"
              style={{ borderColor: "#0891B255", color: "#0E7490", background: "#0891B212" }}
            >
              Cliente confirmou presença
            </button>
          )}

          <p className="mt-3.5 text-xs font-bold uppercase tracking-wide text-gray-400">Lead aceito (SAL)</p>
          <div className="mt-2 flex gap-1.5">
            {([
              { valor: "aceito" as const, rotulo: "Aceito", cor: "#059669" },
              { valor: "recusado" as const, rotulo: "Recusado", cor: "#DC2626" },
            ]).map((op) => {
              const on = reuniao.sal === op.valor;
              return (
                <button
                  key={op.valor}
                  onClick={() => onSal(op.valor)}
                  className="flex-1 rounded-lg border py-1.5 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
                  style={{
                    borderColor: on ? op.cor : "#E5E7EB",
                    background: on ? `${op.cor}18` : "transparent",
                    color: on ? op.cor : "#6B7280",
                  }}
                >
                  {op.rotulo}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            Marque o desfecho assim que a reunião terminar. Aceito ou recusado, o
            registro conta como reunião realizada — o que muda é a qualidade do lead.
          </p>
        </div>

        {reuniao.notes && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Anotações</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">{reuniao.notes}</p>
          </div>
        )}

        <div className="space-y-1.5 pt-1">
          {onAbrirLead && (
            <button
              onClick={onAbrirLead}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-50"
            >
              <IcExternal /> Abrir o lead no CRM
            </button>
          )}
          {reuniao.status !== "cancelada" && (
            <button
              onClick={() => {
                if (window.confirm("Cancelar esta reunião?")) onStatus("cancelada");
              }}
              className="w-full rounded-lg py-2 text-xs font-semibold text-gray-400 transition hover:bg-gray-50 hover:text-red-600"
            >
              Cancelar reunião
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Linha({ icone, rotulo, children }: { icone?: React.ReactNode; rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {icone}
        {rotulo}
      </p>
      <p className="mt-0.5 text-gray-800">{children}</p>
    </div>
  );
}

function BotaoDesfecho({ cor, icone, rotulo, onClick }: { cor: string; icone: React.ReactNode; rotulo: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border py-2 text-xs font-bold transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
      style={{ borderColor: `${cor}44`, color: cor, background: `${cor}12` }}
    >
      {icone}
      {rotulo}
    </button>
  );
}
