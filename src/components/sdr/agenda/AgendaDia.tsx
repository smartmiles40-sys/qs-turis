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
import { useQsAuth, podeExecutar } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  fetchClosers,
  fetchCloserConfigs,
  fetchAvailability,
  fetchBlocks,
  fetchMeetingsInRange,
  configFor,
  startOfDay,
  addDays,
  sameDay,
  fimDaReuniao,
  semDesfecho,
  chaveDoEspecialista,
} from "@/lib/qs/closerAgenda";
import { setMeetingStatus, setMeetingSal, sweepOutcomeTasks, temDesfecho, desfechoDaOportunidadeFutura, reagendarReuniao, gerarSalaMeet, avisarBitrixDaSala, deleteMeeting, type DesfechoCompleto } from "@/lib/qs/meetings";
import DesfechoVenda from "./DesfechoVenda";
import BriefingDoLead from "./BriefingDoLead";
import { getSetting } from "@/lib/qsSettings";
import ScheduleMeetingModal from "./ScheduleMeetingModal";
import OportunidadeFuturaModal from "../leads/OportunidadeFuturaModal";
import { ReuniaoTrancada } from "./BloqueioDesfecho";
import { useBloqueioDesfecho, ehPendenteDeDesfecho } from "@/lib/qs/bloqueioDesfecho";
import { perguntarMotivoDesistencia } from "@/lib/qs/motivoDesistencia";
import DesfechosNaoEnviados from "./DesfechosNaoEnviados";
import "./agenda.css";
import {
  statusNaAgenda, chipsDaAgenda, filtrarPorStatus, acontecendoAgora, proximaReuniao, faltaDesfecho,
  emQuantoTempo, ROTULO_STATUS, estaAberta, corDaPessoa, iniciais, type FiltroAgenda,
} from "@/lib/qs/agendaStatus";
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
  // Cinza mais apagado que "cancelada" de propósito: a arquivada não é um
  // desfecho, é a ausência dele. Ela existe na tela pra não sumir do histórico,
  // não pra disputar atenção com o que ainda precisa de ação.
  arquivada:  { label: "Arquivada",  cor: "#9CA3AF", fundo: "rgba(156,163,175,0.10)", texto: "#6B7280" },
  cancelada:  { label: "Cancelada",  cor: "#64748B", fundo: "rgba(100,116,139,0.10)", texto: "#475569" },
  // Roxo (0079): desistência não é "aconteceu" (verde) nem "furou" (vermelho).
  // É o cliente saindo da negociação — cor própria pra não se confundir com
  // cancelada, que é a agenda mudando de ideia, não o cliente.
  desistencia: { label: "Desistência", cor: "#7C3AED", fundo: "rgba(124,58,237,0.10)", texto: "#6D28D9" },
};

/** Usada até o banco responder e no preview. A de verdade vem de qs_settings. */
const MOTIVOS_SAL_PADRAO = [
  'Fora do perfil',
  'Sem orçamento',
  'Sem urgência (>6 meses)',
  'Já comprou com concorrente',
  'Dado incorreto / não era o decisor',
  'Curioso — sem intenção real',
];

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
  /** A página (Agenda) já tem o "+ Agendar reunião" no cabeçalho. */
  semBotaoAgendar?: boolean;
}

export default function AgendaDia({ onOpenLead, dataInicial, demo, semBotaoAgendar }: AgendaDiaProps) {
  const { currentUser } = useQsAuth();
  // Espectador (marketing): a agenda é só de leitura. A recusa real é do banco
  // (gatilho da 0036) — aqui evitamos oferecer o que vai falhar.
  const executa = podeExecutar(currentUser?.role);
  // Agenda trancada (21/09): a lateral não oferece o Meet de reunião trancada.
  const { bloqueado: bloqueadoDia } = useBloqueioDesfecho();

  const [dia, setDia] = useState<Date>(() => startOfDay(dataInicial ?? new Date()));

  // Vem da Agenda do mês: cada clique num dia manda um Date novo. Comparo pelo
  // TEMPO, e não pela referência, senão um re-render do pai jogaria o SDR de
  // volta pro dia clicado enquanto ele navega com as setas.
  const dataInicialMs = dataInicial ? startOfDay(dataInicial).getTime() : null;
  useEffect(() => {
    if (dataInicialMs !== null) setDia(new Date(dataInicialMs));
  }, [dataInicialMs]);
  const [zoom, setZoom] = useState(1);
  const [filtro, setFiltro] = useState<FiltroAgenda>("todas");
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

  // ── Arrastar e soltar (estilo Google Agenda) ───────────────────────────────
  // A reunião vira um card arrastável: soltar em outro horário remarca, soltar
  // em outra coluna troca o especialista — pelo MESMO caminho do botão
  // "Remarcar" (qs_reagendar_reuniao, 0033), então a trava anti-choque do banco
  // e o histórico de reagendamentos continuam valendo. Se o banco recusar
  // (horário ocupado / sem permissão), o card volta pro lugar e o erro aparece.
  // `overMin` é minuto-do-dia já ENCAIXADO (15 em 15): só re-renderiza quando o
  // fantasma muda de vaga, não a cada pixel do mouse.
  const [drag, setDrag] = useState<{ m: Meeting; overCol: string | null; overMin: number | null } | null>(null);
  const [soltando, setSoltando] = useState(false);

  // Recusa exige motivo: o painel abre a lista em vez de gravar direto.
  const [pedindoMotivo, setPedindoMotivo] = useState<string | null>(null);
  // Lista fechada, definida pelo comercial em qs_settings (0032) — trocar os
  // motivos não exige deploy nem migration.
  const [motivosSal, setMotivosSal] = useState<string[]>(MOTIVOS_SAL_PADRAO);
  useEffect(() => {
    if (demo) return;
    void getSetting<string[]>('sal_motivos').then((lista) => {
      if (Array.isArray(lista) && lista.length) setMotivosSal(lista);
    });
  }, [demo]);

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

  // Passivo: reuniões que venceram ANTES desta cobrança existir não têm
  // atividade de desfecho. A varredura cria as que faltam — uma vez por abertura
  // da tela, idempotente, e quase sempre sem escrever nada.
  useEffect(() => {
    if (demo || !executa) return;
    void sweepOutcomeTasks();
  }, [demo, executa]);

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

  // Chips do desenho: saem das regras de status (lib/qs/agendaStatus.ts).
  const chips = useMemo(() => chipsDaAgenda(doDia, agora, filtro), [doDia, agora, filtro]);
  const visiveis = useMemo(() => filtrarPorStatus(doDia, filtro, agora), [doDia, filtro, agora]);

  /** Closers de verdade + colunas herdadas do responsável em texto livre. */
  const colunas = useMemo<Coluna[]>(() => {
    const out: Coluna[] = closers.map((c, i) => ({
      key: c.id,
      closerId: c.id,
      nome: c.name,
      papel: "Especialista",
      cor: corDaPessoa(i),
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
        cor: corDaPessoa(i, key === "sem"),
        agendavel: false,
      });
      i += 1;
    }
    return out;
  }, [closers, configs, doDia]);

  const porColuna = useMemo(() => {
    const mapa: Record<string, ComFaixa[]> = {};
    for (const col of colunas) {
      mapa[col.key] = distribuirEmFaixas(doDia.filter((m) => chaveDoEspecialista(m) === col.key));
    }
    return mapa;
  }, [colunas, doDia]);

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

  /** Minuto do dia (encaixado de 15 em 15) a partir da posição do mouse na coluna. */
  const minutoDoEvento = (e: React.DragEvent<HTMLDivElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - caixa.top;
    const brutos = (y / alturaHora) * 60 + horaInicio * 60;
    return Math.max(0, Math.round(brutos / 15) * 15);
  };

  /** A coluna aceita receber esta reunião? Coluna de texto livre não tem closer
   *  pra atribuir — só aceita a PRÓPRIA reunião (mover de horário sem trocar). */
  const colunaAceita = (col: Coluna, m: Meeting) =>
    col.closerId != null || col.key === chaveDoEspecialista(m);

  const soltarReuniao = async (col: Coluna, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const atual = drag;
    setDrag(null);
    if (!atual || soltando || !colunaAceita(col, atual.m)) return;

    const min = minutoDoEvento(e);
    const quando = startOfDay(dia);
    quando.setHours(0, min, 0, 0);

    const antes = new Date(atual.m.scheduled_at);
    const mesmaColuna = col.key === chaveDoEspecialista(atual.m);
    if (mesmaColuna && quando.getTime() === antes.getTime()) return; // soltou onde estava

    if (demo) {
      const novo = { ...atual.m, scheduled_at: quando.toISOString(), closer_id: col.closerId ?? atual.m.closer_id };
      setMeetings((ms) => ms.map((x) => (x.id === atual.m.id ? novo : x)));
      return;
    }

    setSoltando(true);
    const r = await reagendarReuniao({
      meeting: atual.m,
      scheduledAt: quando,
      closerId: col.closerId ?? atual.m.closer_id ?? null,
      closerNome: col.closerId ? col.nome : atual.m.meeting_owner ?? col.nome,
      por: currentUser?.name ?? null,
    });
    setSoltando(false);
    if (!r.ok) return notifyError(r.error);
    notifySuccess(
      mesmaColuna
        ? `${atual.m.lead_name || "Reunião"} movida para ${hhmm(quando)}.`
        : `${atual.m.lead_name || "Reunião"} agora é de ${col.nome}, às ${hhmm(quando)}.`
    );
    void load();
  };

  const mudarStatus = async (m: Meeting, status: MeetingStatus, venda?: DesfechoCompleto) => {
    if (demo) {
      const novo = { ...m, status };
      setMeetings((ms) => ms.map((x) => (x.id === m.id ? novo : x)));
      setSelecionada(novo);
      return;
    }
    // O SAL viaja junto com o desfecho desde 19/08 (antes era um segundo
    // clique, e por isso quase nunca acontecia).
    const { sal: salEscolhido, ...dadosDaVenda } = venda ?? {};
    const r = await setMeetingStatus(
      m, status, m.lead?.bitrix_id, dadosDaVenda,
      salEscolhido ? { ...salEscolhido, by: currentUser?.id ?? null } : null
    );
    if (!r.ok) return notifyError(r.error);
    notifySuccess(`Reunião marcada como ${STATUS[status].label.toLowerCase()}.`);
    setSelecionada(r.meeting);
    void load();
  };

  /**
   * Cria a sala do Meet de uma reunião que ficou sem ela.
   *
   * A sala nasce junto com o agendamento; quando essa criação falha — entre
   * 21/08 e 24/08 a agenda devolveu 403 em todas as chamadas — a reunião fica
   * salva e o cliente sem convite, e não havia como tentar de novo: reagendar
   * também não cria, porque o código só mexe no evento quando já existe um.
   * Aqui o gatilho é o único diferente; o caminho é o mesmo do agendamento.
   */
  const criarSala = async (m: Meeting) => {
    if (demo) return;
    const sala = await gerarSalaMeet(m);
    if (!sala.link) {
      // O aviso já vem dizendo o motivo, e o gerarSalaMeet grava em
      // calendar_error — então a próxima abertura do painel mostra o porquê.
      notifyError(sala.aviso ?? "Não consegui criar a sala do Meet.");
      void load();
      return;
    }
    avisarBitrixDaSala(m, { bitrix_id: m.lead?.bitrix_id, lead_name: m.lead_name, link: sala.link });
    notifySuccess("Sala criada e convite enviado pro cliente.");
    setSelecionada(null);
    void load();
  };

  /**
   * Apaga a reunião de vez (some da lista e da agenda).
   *
   * Diferente de "cancelar", que mantém a linha com status cancelada e continua
   * contando no histórico. Este é pro caso de reunião criada por engano ou
   * duplicada — que só dava pra resolver pela agenda mensal, enquanto o time
   * trabalha aqui.
   */
  const excluirReuniao = async (m: Meeting) => {
    if (demo) return;
    if (!window.confirm("Excluir permanentemente esta reunião? Esta ação não pode ser desfeita.")) return;
    const r = await deleteMeeting(m.id);
    if (!r.ok) return notifyError(r.error ?? "Não foi possível excluir.");
    notifySuccess("Reunião excluída.");
    setSelecionada(null);
    void load();
  };

  const marcarSal = async (m: Meeting, sal: MeetingSal, motivo?: string | null) => {
    const alvo = m.sal === sal ? null : sal;
    // Recusar SEM motivo não é permitido — nem aqui nem no banco (CHECK da
    // 0032). "Recusado" sem porquê vira um número que ninguém sabe atacar.
    if (alvo === "recusado" && !motivo) {
      setPedindoMotivo(m.id);
      return;
    }
    if (demo) {
      const novo = { ...m, sal: alvo, sal_motivo: alvo === "recusado" ? motivo ?? null : null };
      setMeetings((ms) => ms.map((x) => (x.id === m.id ? novo : x)));
      setSelecionada(novo);
      setPedindoMotivo(null);
      return;
    }
    const r = await setMeetingSal(m, alvo, currentUser?.id ?? null, m.lead?.bitrix_id, motivo ?? null);
    if (!r.ok) return notifyError(r.error);
    setPedindoMotivo(null);
    setSelecionada(r.meeting);
    if (alvo) notifySuccess(`Lead ${alvo} registrado.`);
    void load();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // Desenho do Bruno (agenda.html, 03/11): topo com ‹ › e os chips de status,
  // a faixa do Bitrix, a grade por especialista e, ao lado, o que está
  // acontecendo agora, a próxima e o que falta registrar. No celular a grade
  // vira lista (a grade com N colunas não cabe numa tela de 375 px).
  const nomeDaReuniao = (m: Meeting) => m.lead_name || m.lead?.full_name || m.title || "Reunião";
  const nomeDaColuna = (m: Meeting) => colunas.find((c) => c.key === chaveDoEspecialista(m))?.nome || m.closer?.name || m.meeting_owner || "sem especialista";
  const primeiro = (n: string) => n.trim().split(/\s+/)[0] || n;
  const faixaHoras = (m: Meeting) => `${hhmm(new Date(m.scheduled_at))} às ${hhmm(fimDaReuniao(m))}`;
  // Agenda trancada (21/09): o closer com desfecho atrasado não abre o Meet das próximas.
  const trancadaPraMim = (m: Meeting) => bloqueadoDia && !ehPendenteDeDesfecho(m);

  const rolandoAgora = ehHoje ? acontecendoAgora(doDia, agora) : [];
  const proxima = proximaReuniao(doDia, agora);
  const pendentesDoDia = faltaDesfecho(doDia, agora);
  const especialistasNoDia = new Set(doDia.map((m) => chaveDoEspecialista(m))).size;
  const listaCelular = [...visiveis].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return (
    <div className="flex flex-col gap-4" style={{ fontFamily: "inherit" }}>
      {/* ── Topo ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => irPara(-1)} aria-label="Dia anterior" className="ag-icon-btn"><IcChevronL /></button>
          <button type="button" onClick={() => irPara(1)} aria-label="Próximo dia" className="ag-icon-btn"><IcChevronR /></button>
          <div className="ml-1 flex flex-col">
            <span className="ag-titulo">{dataLonga(dia)}</span>
            <span className="ag-muted" style={{ fontSize: 13 }}>
              {doDia.length} {doDia.length === 1 ? "reunião" : "reuniões"} · {especialistasNoDia} {especialistasNoDia === 1 ? "especialista" : "especialistas"}
            </span>
          </div>
          {!ehHoje && (
            <button type="button" onClick={() => setDia(startOfDay(new Date()))} className="ag-btn ag-btn--sm ml-1">Hoje</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtrar por status">
          {chips.map((c) => (
            <button key={c.id} type="button" className="ag-pill" aria-pressed={filtro === c.id}
              data-st={c.id === "todas" ? undefined : c.id}
              onClick={() => setFiltro(filtro === c.id && c.id !== "todas" ? "todas" : c.id)}>
              {c.id !== "todas" && <span className="ag-dot" />}
              {c.rotulo} <span className="ag-qtd tabular">{c.qtd}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Desfechos que não chegaram no Bitrix (22/09) — só pra gestão, que é
          quem responde pelo número do Dashboard. Mesmo botão de sempre. */}
      {!demo && (currentUser?.role === "admin" || currentUser?.role === "gestor") && <DesfechosNaoEnviados />}

      <div className="flex flex-wrap items-start gap-4">
        {/* ── Grade (computador) ───────────────────────────────────────────── */}
        <section aria-label="Grade do dia" className="ag-card hidden min-w-0 overflow-hidden md:block" style={{ flex: "999 1 640px" }}>
          <div ref={gradeRef} className="relative overflow-auto" style={{ maxHeight: "max(520px, calc(100vh - 300px))" }}>
            {loading ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: "var(--ag-surface-2)" }} />
                ))}
              </div>
            ) : (
            <div style={{ minWidth: LARGURA_EIXO + Math.max(1, colunas.length) * LARGURA_MIN_COLUNA }}>
              {/* Cabeçalho mora DENTRO da rolagem (sticky): com muitos
                  especialistas a grade rola pro lado e o nome tem que rolar junto. */}
              <div ref={cabecalhoRef} className="sticky top-0 z-40 flex" style={{ background: "var(--ag-surface)", borderBottom: "1px solid var(--ag-border)" }}>
                <div style={{ width: LARGURA_EIXO, background: "var(--ag-surface)" }} className="sticky left-0 z-10 shrink-0" />
                {colunas.map((col) => {
                  const dele = doDia.filter((m) => chaveDoEspecialista(m) === col.key);
                  const pend = dele.filter((m) => semDesfecho(m, agora)).length;
                  return (
                    <div key={col.key} style={{ minWidth: LARGURA_MIN_COLUNA, borderLeft: "1px solid var(--ag-border)" }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5">
                      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: col.cor, color: "var(--ag-on-primary)" }}>{iniciais(col.nome)}</div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-bold">{col.nome}</span>
                        <span className="truncate ag-muted" style={{ fontSize: 12 }}>
                          {dele.length} {dele.length === 1 ? "reunião" : "reuniões"}
                          {pend > 0 && ` · ${pend} sem desfecho`}
                          {col.papel !== "Especialista" && ` · ${col.papel}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!colunas.length && (
                  <div className="flex-1 px-4 py-3.5 ag-muted">Nenhuma reunião neste dia.</div>
                )}
              </div>

              <div className="relative flex" style={{ height: totalHoras * alturaHora }}>
                {/* eixo de horas */}
                <div style={{ width: LARGURA_EIXO, background: "var(--ag-surface)" }} className="sticky left-0 z-20 shrink-0">
                  {Array.from({ length: totalHoras }, (_, i) => (
                    <div key={i} style={{ height: alturaHora }} className="relative">
                      <span className="absolute right-2.5 top-0.5 tabular" style={{ fontSize: 12, color: "var(--ag-subtle)" }}>
                        {dd(horaInicio + i)}:00
                      </span>
                    </div>
                  ))}
                </div>

                {colunas.map((col) => (
                  <div
                    key={col.key}
                    style={{ minWidth: LARGURA_MIN_COLUNA, borderLeft: "1px solid var(--ag-border)", cursor: col.agendavel && executa ? "copy" : undefined }}
                    className="relative flex-1"
                    onClick={(e) => { if (executa) clicarVazio(col, e); }}
                    onDragOver={(e) => {
                      if (!drag || !colunaAceita(col, drag.m)) return;
                      e.preventDefault(); // sem isto o navegador proíbe o drop
                      e.dataTransfer.dropEffect = "move";
                      const min = minutoDoEvento(e);
                      setDrag((d) => (d && (d.overCol !== col.key || d.overMin !== min) ? { ...d, overCol: col.key, overMin: min } : d));
                    }}
                    onDrop={(e) => void soltarReuniao(col, e)}
                    title={col.agendavel && executa ? "Clique num horário livre para agendar" : undefined}
                  >
                    {/* fantasma do arrasto: onde a reunião vai cair se soltar aqui */}
                    {drag && drag.overCol === col.key && drag.overMin != null && (
                      <div
                        className="pointer-events-none absolute inset-x-1.5 z-20 rounded-[10px] border-2 border-dashed"
                        style={{
                          top: ((drag.overMin - horaInicio * 60) / 60) * alturaHora,
                          height: Math.max(22, (((fimDaReuniao(drag.m).getTime() - new Date(drag.m.scheduled_at).getTime()) / 3_600_000) || 0.5) * alturaHora - 2),
                          borderColor: "var(--ag-muted)",
                          background: "var(--ag-surface-3)",
                        }}
                      >
                        <span className="ml-1 rounded px-1 text-[11px] font-bold tabular" style={{ background: "var(--ag-primary)", color: "var(--ag-on-primary)" }}>
                          {`${dd(Math.floor(drag.overMin / 60))}:${dd(drag.overMin % 60)}`}
                        </span>
                      </div>
                    )}
                    {/* linhas de hora */}
                    {Array.from({ length: totalHoras }, (_, i) => (
                      <div key={i} style={{ height: alturaHora, borderTop: "1px solid var(--ag-line)" }} />
                    ))}

                    {/* fora do expediente */}
                    {forasDoExpediente(col).map((b, i) => (
                      <div key={`f${i}`} className="pointer-events-none absolute inset-x-0"
                        style={{ top: b.topo, height: b.altura, backgroundImage: "repeating-linear-gradient(45deg, var(--ag-line) 0 6px, transparent 6px 12px)" }} />
                    ))}

                    {/* bloqueios (férias, compromisso) */}
                    {bloqueiosDe(col).map((b) => (
                      <div key={b.id} className="pointer-events-none absolute inset-x-1.5 overflow-hidden rounded-[10px] border border-dashed px-2 py-0.5"
                        style={{ top: b.topo, height: b.altura, background: "var(--ag-surface-2)", borderColor: "var(--ag-border-3)" }}>
                        <span className="text-[11px] font-semibold ag-muted">{b.reason || "Indisponível"}</span>
                      </div>
                    ))}

                    {/* reuniões */}
                    {(porColuna[col.key] ?? []).map(({ m, faixa, totalFaixas }) => {
                      const st = statusNaAgenda(m, agora);
                      const ini = new Date(m.scheduled_at);
                      const fim = fimDaReuniao(m);
                      const topo = posicaoDe(ini);
                      const altura = Math.max(22, ((fim.getTime() - ini.getTime()) / 3_600_000) * alturaHora - 4);
                      const largura = 100 / totalFaixas;
                      const morta = m.status === "cancelada";
                      const apagada = filtro !== "todas" && st !== filtro;
                      // Só o que ainda VAI acontecer se move: desfecho dado é história.
                      const arrastavel = executa && !demo && estaAberta(m);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          data-st={st}
                          onClick={(e) => { e.stopPropagation(); setSelecionada(m); }}
                          draggable={arrastavel}
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", m.id); // exigido pelo Firefox
                            setDrag({ m, overCol: null, overMin: null });
                          }}
                          onDragEnd={() => setDrag(null)}
                          title={`${nomeDaReuniao(m)} · ${hhmm(ini)}–${hhmm(fim)} · ${ROTULO_STATUS[st]}${arrastavel ? " · arraste para mudar o horário ou o especialista" : ""}`}
                          className="ag-ev"
                          style={{
                            top: topo + 2,
                            height: altura,
                            left: `calc(${faixa * largura}% + 6px)`,
                            width: `calc(${largura}% - 12px)`,
                            opacity: drag?.m.id === m.id ? 0.35 : apagada ? 0.25 : 1,
                            cursor: arrastavel ? "grab" : "pointer",
                          }}
                        >
                          <span className="truncate" style={{ fontWeight: 700, fontSize: 13, paddingRight: m.sal ? 36 : 0, textDecoration: morta ? "line-through" : "none" }}>
                            {nomeDaReuniao(m)}
                          </span>
                          {altura > 34 && (
                            <span className="flex items-center gap-1 tabular" style={{ fontSize: 12, opacity: 0.9 }}>
                              {hhmm(ini)} – {hhmm(fim)} · {ROTULO_STATUS[st]}
                              {m.meeting_link && estaAberta(m) && <span aria-label="tem link do Meet"><IcVideo s={11} /></span>}
                            </span>
                          )}
                          {m.sal && (
                            <span className={`ag-sal absolute right-2 top-2 ${m.sal === "recusado" ? "ag-sal--off" : ""}`}
                              title={m.sal === "aceito" ? "SAL aceito" : `SAL recusado${m.sal_motivo ? `: ${m.sal_motivo}` : ""}`}>SAL</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* marcador de agora */}
                {agoraVisivel && (
                  <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: linhaAgora!, borderTop: "2px solid var(--ag-now)" }}>
                    <span className="absolute left-1.5 -top-[11px] rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular"
                      style={{ background: "var(--ag-now)", color: "var(--ag-on-now)" }}>
                      {hhmm(agora)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>

          {/* rodapé da grade: zoom e agendar no dia (quando a página não tem o botão) */}
          <div className="flex flex-wrap items-center justify-end gap-1.5 px-3 py-2" style={{ borderTop: "1px solid var(--ag-border)" }}>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} aria-label="Diminuir zoom" className="ag-icon-btn ag-icon-btn--sm"><IcZoomOut /></button>
            <span className="w-10 text-center text-xs tabular ag-subtle">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} aria-label="Aumentar zoom" className="ag-icon-btn ag-icon-btn--sm"><IcZoomIn /></button>
            {executa && !semBotaoAgendar && (
              <button type="button" onClick={() => setAgendarPara({ closerId: null, date: startOfDay(dia) })} className="ag-btn ag-btn--sm ag-btn--primary ml-1">
                <IcPlus /> Agendar reunião
              </button>
            )}
          </div>

          {/* Aviso: sem closer cadastrado, as colunas vieram do texto livre */}
          {!loading && !closers.length && colunas.length > 0 && (
            <div className="px-4 py-2 text-xs" style={{ borderTop: "1px solid var(--ag-border)", color: "var(--ag-warn)" }}>
              Nenhum usuário com papel <b>closer</b> cadastrado — as colunas vieram do
              “Responsável pela reunião” gravado em cada reunião. Para clicar-e-agendar
              direto na grade, crie os especialistas em Configurações → Usuários (papel
              closer) e defina a agenda deles.
            </div>
          )}
        </section>

        {/* ── Lista (celular) ──────────────────────────────────────────────── */}
        <section aria-label="Reuniões do dia" className="ag-card w-full overflow-hidden md:hidden">
          {loading ? (
            <div className="h-32 animate-pulse" style={{ background: "var(--ag-surface-2)" }} />
          ) : listaCelular.length === 0 ? (
            <div className="p-6 text-center ag-muted">{doDia.length ? "Nenhuma reunião com esse status." : "Nenhuma reunião neste dia."}</div>
          ) : (
            <ul>
              {listaCelular.map((m) => {
                const st = statusNaAgenda(m, agora);
                return (
                  <li key={m.id} data-st={st} style={{ borderBottom: "1px solid var(--ag-line)" }}>
                    <button type="button" onClick={() => setSelecionada(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      <span className="w-12 shrink-0 text-[16px] font-bold tabular">{hhmm(new Date(m.scheduled_at))}</span>
                      <span className="ag-barra" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold" style={{ textDecoration: m.status === "cancelada" ? "line-through" : "none" }}>{nomeDaReuniao(m)}</span>
                        <span className="truncate ag-muted" style={{ fontSize: 13 }}>com {primeiro(nomeDaColuna(m))}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="ag-badge">{ROTULO_STATUS[st]}</span>
                        {m.sal === "aceito" && <span className="ag-sal">SAL</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Lateral: agora, próxima, falta registrar ─────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
          {rolandoAgora.map((m) => (
            <section key={m.id} className="ag-card ag-card--alto flex flex-col gap-3 p-[18px]">
              <span className="ag-eyebrow" style={{ color: "var(--ag-muted-2)" }}>Acontecendo agora</span>
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-[18px] font-bold">{nomeDaReuniao(m)}</span>
                <span style={{ color: "var(--ag-muted-2)" }}>{faixaHoras(m)} · com {primeiro(nomeDaColuna(m))}</span>
              </div>
              {m.meeting_link && !trancadaPraMim(m) ? (
                <a href={m.meeting_link} target="_blank" rel="noreferrer" className="ag-btn ag-btn--primary">Entrar no Meet</a>
              ) : (
                <button type="button" className="ag-btn" onClick={() => setSelecionada(m)}>
                  {trancadaPraMim(m) ? "Ver por que está trancada" : "Abrir reunião (sem link do Meet)"}
                </button>
              )}
            </section>
          ))}

          {proxima ? (
            <button type="button" onClick={() => setSelecionada(proxima)} className="ag-card flex flex-col gap-1.5 p-[18px] text-left">
              <span className="ag-eyebrow">
                Próxima · {ehHoje ? emQuantoTempo(agora, new Date(proxima.scheduled_at)) : `às ${hhmm(new Date(proxima.scheduled_at))}`}
              </span>
              <span className="truncate text-[16px] font-bold">{nomeDaReuniao(proxima)}</span>
              <span className="ag-muted">{faixaHoras(proxima)} · com {primeiro(nomeDaColuna(proxima))}</span>
            </button>
          ) : !loading && rolandoAgora.length === 0 && (
            <section className="ag-card flex flex-col gap-1.5 p-[18px]">
              <span className="ag-eyebrow">Próxima</span>
              <span className="ag-muted">Nenhuma reunião pela frente neste dia.</span>
            </section>
          )}

          {pendentesDoDia.length > 0 && (
            <section className="ag-card ag-card--destaque flex flex-col gap-2.5 p-[18px]">
              <span className="ag-eyebrow" style={{ color: "var(--ag-warn)" }}>Falta registrar o desfecho · {pendentesDoDia.length}</span>
              {pendentesDoDia.map((m) => (
                <div key={m.id} className="ag-linha flex items-center justify-between gap-2.5 px-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{nomeDaReuniao(m)}</span>
                    <span className="ag-muted" style={{ fontSize: 12 }}>{hhmm(new Date(m.scheduled_at))} · {primeiro(nomeDaColuna(m))}</span>
                  </div>
                  <button type="button" className="ag-btn ag-btn--sm ag-btn--warn" onClick={() => setSelecionada(m)}>
                    {executa ? "Registrar" : "Ver"}
                  </button>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>

      {/* ── Painel de detalhe ──────────────────────────────────────────────── */}
      {selecionada && (
        <PainelReuniao
          // key: trocar de reunião remonta o painel — senão o formulário de
          // desfecho aberto numa reunião aparecia já aberto na outra (07/10).
          key={selecionada.id}
          reuniao={selecionada}
          coluna={colunas.find((c) => c.key === chaveDoEspecialista(selecionada))}
          agora={agora}
          onFechar={() => setSelecionada(null)}
          onStatus={(s, venda) => void mudarStatus(selecionada, s, venda)}
          onSal={(s, motivo) => void marcarSal(selecionada, s, motivo)}
          motivos={motivosSal}
          pedindoMotivo={pedindoMotivo === selecionada.id ? selecionada.id : null}
          onCancelarMotivo={() => setPedindoMotivo(null)}
          somenteLeitura={!executa}
          onRemarcar={() => {
            setRemarcando(selecionada);
            setSelecionada(null);
          }}
          onAbrirLead={onOpenLead ? () => onOpenLead(selecionada.lead_id) : undefined}
          onCriarSala={() => void criarSala(selecionada)}
          onExcluir={() => void excluirReuniao(selecionada)}
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
  onStatus: (s: MeetingStatus, desfecho?: DesfechoCompleto) => void;
  onSal: (s: MeetingSal, motivo?: string) => void;
  /** Lista fechada de motivos (qs_settings.sal_motivos). */
  motivos: string[];
  /** Reunião cujo motivo está sendo pedido — null = nenhum. */
  pedindoMotivo: string | null;
  onCancelarMotivo: () => void;
  /** Espectador (marketing): mostra os dados, esconde tudo que muda algo. */
  somenteLeitura?: boolean;
  onRemarcar: () => void;
  onAbrirLead?: () => void;
  /** Refaz a sala do Meet de uma reunião que ficou sem link. */
  onCriarSala: () => void;
  /** Apaga a reunião de vez — diferente de cancelar, que mantém a linha. */
  onExcluir: () => void;
}

function PainelReuniao({ reuniao, coluna, agora, onFechar, onStatus, onSal, onRemarcar, onAbrirLead, motivos, pedindoMotivo, onCancelarMotivo, somenteLeitura, onCriarSala, onExcluir }: PainelProps) {
  const [copiado, setCopiado] = useState(false);
  // Mesmo passo do modal de detalhe: antes de fechar, pergunta valor e tipo.
  const [fechando, setFechando] = useState<"realizada" | "no_show" | null>(null);
  const [oportunidade, setOportunidade] = useState(false);
  const st = STATUS[reuniao.status] ?? STATUS.agendada;
  const ini = new Date(reuniao.scheduled_at);
  const fim = fimDaReuniao(reuniao);
  const atrasada = semDesfecho(reuniao, agora);
  // Agenda trancada (Bruno, 21/09): mesma regra da Minha Agenda e do modal.
  const { bloqueado, pendentes: atrasadasDoCloser } = useBloqueioDesfecho();
  if (bloqueado && !ehPendenteDeDesfecho(reuniao)) {
    return (
      <div className="fixed inset-y-0 right-0 z-40 max-md:z-[50] flex w-full flex-col justify-center border-l border-gray-200 bg-white p-5 shadow-2xl sm:w-96">
        <ReuniaoTrancada pendentes={atrasadasDoCloser.length} onFechar={onFechar} />
      </div>
    );
  }

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
    // Celular (04/11): o painel ocupa a tela toda e o botão flutuante do
    // WhatsApp (z 45) ficava POR CIMA dele, tapando o "Recusado" do SAL e o
    // texto do desfecho. Lá ele sobe pra z 50 e cobre os flutuantes; o
    // rodapé respeita a barrinha do iPhone.
    <div className="fixed inset-y-0 right-0 z-40 max-md:z-[50] max-md:pb-[env(safe-area-inset-bottom)] flex w-full flex-col border-l border-gray-200 bg-white shadow-2xl sm:w-96">
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
          {/* O produto ao lado do nome: é a primeira coisa que o especialista
              precisa saber ao abrir a reunião — sobre o que ela é. */}
          {reuniao.title && reuniao.title !== reuniao.lead_name && (
            <p className="truncate text-sm font-semibold" style={{ color: "#0147FF" }}>{reuniao.title}</p>
          )}
          {reuniao.lead?.bitrix_id && <p className="text-xs text-gray-400">Negócio #{reuniao.lead.bitrix_id}</p>}
        </div>
        <button onClick={onFechar} aria-label="Fechar" className={btnIcone}>
          <IcX />
        </button>
      </div>

      {/* pb-24: o botão flutuante do WhatsApp é `fixed` no canto inferior
          direito com z-[45], e este painel é z-40 — ou seja, ele fica POR CIMA
          daqui. Sem esta folga, o que estiver no fim do painel (cancelar,
          excluir, o desfecho quando a lista é longa) nasce escondido embaixo
          dele. Reservar o espaço é mais seguro do que disputar z-index com um
          lançador que precisa mesmo ficar acima do conteúdo. */}
      <div className="flex-1 space-y-4 overflow-auto px-5 py-4 pb-24 text-sm">
        {/* O contexto que faltava: o closer lançava o desfecho aqui SEM ver
            nada do que o SDR conversou. O resumo vem pelo servidor, então
            funciona mesmo antes da migration de leitura (0052). */}
        <BriefingDoLead leadId={reuniao.lead_id} />
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

        {/* SEM SALA. Reunião marcada cujo evento no Google nunca foi criado — o
            cliente não recebeu convite e ninguém tinha como saber, porque o
            único sintoma era a ausência do botão "Entrar na reunião". */}
        {!reuniao.meeting_link && !somenteLeitura &&
          (reuniao.status === "agendada" || reuniao.status === "confirmada") && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-900">
              Esta reunião está <b>sem link</b> — o cliente não recebeu convite.
            </p>
            {reuniao.calendar_error && (
              <p className="mt-1 text-[11px] text-amber-700">Motivo: {reuniao.calendar_error}</p>
            )}
            <button
              onClick={onCriarSala}
              className="mt-2 w-full rounded-lg bg-amber-600 py-2 text-xs font-bold text-white transition hover:bg-amber-700"
            >
              Criar sala do Meet
            </button>
          </div>
        )}

        {/* Desfecho: é aqui que o dado do funil nasce. Espectador não vê — não
            é dele a decisão, e botão que sempre falha só irrita. */}
        {!somenteLeitura && <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Desfecho</p>

          {/* Desfecho só em reunião ABERTA (25/09). Antes os botões apareciam em
              cancelada/reagendada/realizada — e o "Cancelar" apagava desfecho (10
              casos). O banco também trava (0093). */}
          {!fechando && (reuniao.status === "agendada" || reuniao.status === "confirmada") && (
            <>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                <BotaoDesfecho cor="#059669" icone={<IcCheck />} rotulo="Realizada" onClick={() => setFechando("realizada")} />
                <BotaoDesfecho cor="#D97706" icone={<IcRedo />} rotulo="Reagendar" onClick={onRemarcar} />
                <BotaoDesfecho cor="#DC2626" icone={<IcUserX />} rotulo="No-show" onClick={() => setFechando("no_show")} />
              </div>
              {/* DESISTÊNCIA (0079), separada dos três acima porque fala de
                  outra coisa: aqueles descrevem a REUNIÃO, este descreve o
                  NEGÓCIO. Sem valor e sem SAL — e o lead vai pra perdido, por
                  isso o aviso antes do clique. Mesmo botão do modal de detalhe:
                  o desfecho não pode ser diferente dependendo de por onde o
                  closer entrou. */}
              <button
                onClick={() => {
                  const quem = reuniao.lead_name || reuniao.lead?.full_name || "este cliente";
                  // O motivo vai pro card do Bitrix (22/09) — mesma pergunta do modal.
                  const motivo = perguntarMotivoDesistencia(quem);
                  if (motivo) onStatus("desistencia", { motivoDesistencia: motivo });
                }}
                className="mt-1.5 w-full rounded-lg border py-1.5 text-xs font-bold transition hover:brightness-95"
                style={{ borderColor: "#7C3AED55", color: "#6D28D9", background: "#7C3AED12" }}
              >
                Desistência do cliente
              </button>
              {/* OPORTUNIDADE FUTURA (0083): o cliente quer, mas não agora. Fala do
                  NEGÓCIO, como a desistência — por isso mora ao lado dela. */}
              <button
                onClick={() => setOportunidade(true)}
                className="mt-1.5 w-full rounded-lg border py-1.5 text-xs font-bold transition hover:brightness-95"
                style={{ borderColor: "#4F46E555", color: "#4338CA", background: "#4F46E512" }}
              >
                Oportunidade futura
              </button>
              {oportunidade && (
                <OportunidadeFuturaModal
                  leadId={reuniao.lead_id}
                  leadName={reuniao.lead_name || reuniao.lead?.full_name || "Cliente"}
                  meetingId={reuniao.id}
                  onFechar={() => setOportunidade(false)}
                  // Registrar a oportunidade É o desfecho: sem isto a reunião
                  // ficava "agendada" e trancava a agenda do closer (29/09).
                  onSalvo={() => {
                    const s = desfechoDaOportunidadeFutura(reuniao);
                    if (s) onStatus(s);
                  }}
                />
              )}
            </>
          )}

          {fechando && (
            <div className="mt-2.5">
              <DesfechoVenda
                tipo={fechando}
                onVoltar={() => setFechando(null)}
                pedirSal={(reuniao.tipo ?? "primeira") !== "retomada"}
                onConfirmar={(desfecho) => { setFechando(null); onStatus(fechando, desfecho); }}
              />
            </div>
          )}

          {reuniao.status === "agendada" && (
            <button
              onClick={() => onStatus("confirmada")}
              className="mt-1.5 w-full rounded-lg border py-1.5 text-xs font-bold transition hover:brightness-95"
              style={{ borderColor: "#0891B255", color: "#0E7490", background: "#0891B212" }}
            >
              Cliente confirmou presença
            </button>
          )}

          {/* SAL, mas NUNCA no no-show: quem não conversou com o lead não tem
              como dizer se ele prestava. No-show antigo que já tem SAL gravado
              mostra o que está lá, só pra leitura. */}
          {reuniao.status === "no_show" ? (
            reuniao.sal ? (
              <>
                <p className="mt-3.5 text-xs font-bold uppercase tracking-wide text-gray-400">Lead aceito (SAL)</p>
                <p className="mt-1 text-sm font-bold" style={{ color: reuniao.sal === "aceito" ? "#059669" : "#DC2626" }}>
                  {reuniao.sal === "aceito" ? "Aceito" : "Recusado"}
                  {reuniao.sal_motivo ? <span className="font-normal" style={{ color: "var(--ink2)" }}> — {reuniao.sal_motivo}</span> : null}
                </p>
              </>
            ) : null
          ) : (
            <>
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
          {/* Motivo da recusa — lista fechada. Recusar sem dizer por quê produz
              um número que ninguém consegue atacar; e o banco recusa (0032). */}
          {pedindoMotivo && (
            <div className="mt-2.5 rounded-xl border p-2.5" style={{ borderColor: "#DC262633", background: "#DC26260A" }}>
              <p className="text-xs font-bold" style={{ color: "#B91C1C" }}>Por que o lead foi recusado?</p>
              <div className="mt-2 grid gap-1">
                {motivos.map((mot) => (
                  <button
                    key={mot}
                    onClick={() => onSal("recusado", mot)}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold transition hover:brightness-95"
                    style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink2)" }}
                  >
                    {mot}
                  </button>
                ))}
              </div>
              <button
                onClick={onCancelarMotivo}
                className="mt-2 w-full py-1 text-[11px] font-bold text-gray-400 hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}

          {reuniao.sal === "recusado" && reuniao.sal_motivo && !pedindoMotivo && (
            <p className="mt-2 text-xs" style={{ color: "var(--ink2)" }}>
              Motivo: <b>{reuniao.sal_motivo}</b>
            </p>
          )}

          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            Marque o desfecho assim que a reunião terminar. Aceito ou recusado, o
            registro conta como reunião realizada — o que muda é a qualidade do lead.
            Recusar um lead ruim MELHORA o seu número de conversão.
          </p>
            </>
          )}
        </div>}

        {/* Espectador vê o desfecho JÁ REGISTRADO, só não pode mudá-lo — o dado
            é o que ele veio buscar. */}
        {somenteLeitura && reuniao.sal && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Lead aceito (SAL)</p>
            <p className="mt-1 text-sm font-bold" style={{ color: reuniao.sal === "aceito" ? "#059669" : "#DC2626" }}>
              {reuniao.sal === "aceito" ? "Aceito" : "Recusado"}
              {reuniao.sal_motivo ? <span className="font-normal" style={{ color: "var(--ink2)" }}> — {reuniao.sal_motivo}</span> : null}
            </p>
          </div>
        )}

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
          {reuniao.status !== "cancelada" && !temDesfecho(reuniao) && !somenteLeitura && (
            <button
              onClick={() => {
                if (window.confirm("Cancelar esta reunião?")) onStatus("cancelada");
              }}
              className="w-full rounded-lg py-2 text-xs font-semibold text-gray-400 transition hover:bg-gray-50 hover:text-red-600"
            >
              Cancelar reunião
            </button>
          )}
          {/* EXCLUIR ≠ CANCELAR. Cancelar mantém a linha (a reunião existiu e
              conta no histórico); excluir apaga, e serve pra registro criado por
              engano ou duplicado. Só existia na agenda mensal, mas o time
              trabalha nesta tela — então não havia como apagar de onde se olha. */}
          {!somenteLeitura && !temDesfecho(reuniao) && (
            <button
              onClick={onExcluir}
              className="w-full rounded-lg py-2 text-xs font-semibold text-gray-300 transition hover:bg-red-50 hover:text-red-600"
            >
              Excluir reunião
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
