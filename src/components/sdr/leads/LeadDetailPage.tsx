// src/components/sdr/leads/LeadDetailPage.tsx
// -----------------------------------------------------------------------------
// FICHA DO LEAD — usada pelo SDR (SdrLayout) e pelo Closer (CloserApp).
//
// Redesenho de 03/11 (Bruno, Claude Design, variações SDR e Closer):
//   cabeçalho (avatar, temperatura, status, ações do papel + "Mais ações") →
//   faixa "Próximo passo" → coluna esquerda (SDR: Cadência; Closer: Passagem do
//   SDR + Venda; os dois: Sobre o lead + Respostas do formulário) → coluna
//   "Atividade" (chips Tudo/Reuniões/Ligações/Notas/Sistema + Prospecção,
//   Cadastro e Venda, que eram abas).
// NENHUMA função da ficha antiga saiu — o mapa está em "Mais ações" e nos chips.
// Peças novas em ./ficha/ (regras puras testadas em tests/ficha-lead/).
// -----------------------------------------------------------------------------
import React, { useState, useEffect, useCallback, useSyncExternalStore, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  createCadenceTasks,
  closeOpenCadenceTasks,
  updateQsLead,
  deleteQsLead,
  updateQsNote,
  deleteQsNote,
  completeTask,
  undoCompleteTask,
  updateOpenTask,
  LEAD_SELECT,
} from "@/lib/qs/queries";
import { confirmar } from "@/lib/qs/confirmar";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { dialViaSip } from "@/lib/sip";
import { dialViaWebphone, isWebphoneConfigured } from "@/lib/webphone";
import { carregarCotacaoAberta, cotacaoAereoAberta, iniciarCotacaoAereo, ouvirCotacaoAereo } from "@/lib/qs/aereo";
import "./ficha/ficha.css";
import MenuDaFicha, { type ItemDoMenu } from "./ficha/MenuDaFicha";
import CadenciaSdr from "./ficha/CadenciaSdr";
import PassagemDoSdr from "./ficha/PassagemDoSdr";
import VendaResumo, { useVendaDoLead } from "./ficha/VendaResumo";
import { IcCalendario, IcCheck, IcNota, IcPontos, IcRaio, IcRelogio, IcSeta, IcTelefone, IcVoltar, IcWhats } from "./ficha/icones";
import {
  dataRelativa, ehLigacao, escolherProximoPasso, iniciaisDoNome, diaDaCadencia, passaNoFiltro, quandoCurto,
  quandoPorExtenso, reuniaoAberta as reuniaoEstaAberta, textoDeVazio, type FiltroAtividade, type PapelDaFicha, type TipoAtividade,
} from "./ficha/regras";
import { getLeadScore, getSdrTemperature, TEMPERATURAS, chipDaTemperatura, type LeadTemperature } from "@/lib/leadScore";
import { loadWorkHours, nextWorkMoment } from "@/lib/workHours";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import WhatsAppModal from "@/components/sdr/whatsapp/WhatsAppModal";
import ScheduleMeetingModal from "@/components/sdr/agenda/ScheduleMeetingModal";
import MeetingDetailModal from "@/components/sdr/agenda/MeetingDetailModal";
import { setMeetingStatus, desfechoDaOportunidadeFutura } from "@/lib/qs/meetings";
import RespostasDoFormulario from "@/components/sdr/leads/RespostasDoFormulario";
import { DetalheDaReuniao } from "@/controle-comercial/ReunioesDoCliente";
import OportunidadeFuturaModal, { FaixaOportunidadeFutura } from "@/components/sdr/leads/OportunidadeFuturaModal";
import { ComCoresDoRel, EnviarFinanceiroModal, StatusNoFinanceiro } from "@/fin/EnviarFinanceiro";
import { ComCoresDaCentral, PedidosSobre } from "@/solicitacoes/PedirOutroSetor";
import NovaSolicitacao from "@/solicitacoes/NovaSolicitacao";
import { podeAbrirAreaCloser } from "@/closer/lib";
import VendaDoCliente from "@/closer/VendaDoCliente";
import CotandoAereo from "@/components/sdr/aereo/CotandoAereo";
import CadastroDoLead from "@/clientes/cadastro/CadastroDoLead";
import LigacoesDoLead from "@/components/sdr/leads/LigacoesDoLead";
import SeloCardBitrix from "@/components/sdr/leads/SeloCardBitrix";
import type { LeadComCardBitrix } from "@/components/sdr/leads/cardBitrix";
import type {
  Lead,
  LeadStatus,
  LeadSource,
  SdrUser,
  Cadence,
  CadenceDay,
  Note,
  Meeting,
  Task,
} from "../types";
import {
  STATUS_LABELS,
  SOURCE_LABELS,
  CHANNEL_LABELS,
  MEETING_STATUS_LABELS,
} from "../types";

// A tela ÚNICA de venda (0214): "Marcar como ganho" do closer abre ela — é a
// única que grava a venda e exige a proposta anexada. Preguiçosa: o SDR não paga.
const SubirVenda = lazy(() => import("@/venda/SubirVenda"));

// ── Props ────────────────────────────────────────────────────────────────────

interface LeadDetailPageProps {
  leadId: string;
  onBack: () => void;
  /**
   * Qual variação do desenho: "closer" (CloserApp) ou "sdr" (SdrLayout).
   * Sem a prop, decide pelo papel de quem abriu (closer → closer).
   */
  papel?: PapelDaFicha;
}

// ── Types ────────────────────────────────────────────────────────────────────

// O que a coluna "Atividade" mostra. Os 5 primeiros são os chips do desenho
// (filtros da linha do tempo); os 3 últimos eram ABAS da ficha antiga
// (Prospecção, Cadastro — que morava na Visão Geral — e Venda).
type AbaAtividade = FiltroAtividade | "prospeccao" | "cadastro" | "venda";

interface ItemDaLinha {
  id: string;
  tipo: TipoAtividade;
  ts: string;
  titulo: string;
  por?: string | null;
  texto?: string | null;
  linhas?: { k: string; v: React.ReactNode }[];
  nota?: Note;
  reuniao?: Meeting;
  perigo?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MEETING_COLORS: Record<string, { bg: string; text: string }> = {
  agendada: { bg: "bg-blue-50", text: "text-blue-700" },
  realizada: { bg: "bg-green-50", text: "text-green-700" },
  no_show: { bg: "bg-orange-50", text: "text-orange-700" },
  cancelada: { bg: "bg-red-50", text: "text-red-700" },
  // 0079: sem isto a desistência caía no fallback e aparecia como "agendada"
  // (azul) no histórico do lead — dizendo o contrário do que aconteceu.
  desistencia: { bg: "bg-purple-50", text: "text-purple-700" },
  arquivada: { bg: "bg-gray-50", text: "text-gray-400" },
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  pesquisa: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  email: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  ligacao: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  ligacao_whatsapp: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
      <path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" />
    </svg>
  ),
  whatsapp: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  linkedin: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 6a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  ),
};

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── Temperatura (lead_score editável pelo SDR) ──────────────────────────────
// Gravamos o rótulo PT cru — o mesmo formato que vem do Bitrix; getLeadScore
// (normalizeTemperature) entende os dois lados.

const TEMPERATURE_OPTIONS: { label: string; color: string }[] = [
  { label: "Quente", color: "#E5484D" },
  { label: "Morno", color: "#E8920B" },
  { label: "Frio", color: "#2563EB" },
];


// ── Editar lead (modal do header) ────────────────────────────────────────────

interface LeadEditForm {
  full_name: string;
  phone: string;
  email: string;
  company_name: string;
  job_title: string;
  department: string;
  source: LeadSource;
  city: string;
  state: string;
  estimated_value: string;
  company_linkedin: string;
  company_size: string;
}

function leadToEditForm(lead: Lead): LeadEditForm {
  return {
    full_name: lead.full_name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    company_name: lead.company_name ?? "",
    job_title: lead.job_title ?? "",
    department: lead.department ?? "",
    source: lead.source,
    city: lead.city ?? "",
    state: lead.state ?? "",
    estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : "",
    company_linkedin: lead.company_linkedin ?? "",
    company_size: lead.company_size ?? "",
  };
}

// Aceita "1.500,50", "1500.50" e "1500" — devolve null pra vazio e NaN pra inválido.
function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return Number(normalized);
}

// ── Chips da coluna "Atividade" ──────────────────────────────────────────────
// Os 5 do desenho + os que eram abas. "Venda" (contrato e link de pagamento do
// closer no cadastro da pessoa, 26/10) só pra quem abre a área do closer.
const CHIPS_FILTRO: { id: FiltroAtividade; rotulo: string }[] = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "reuniao", rotulo: "Reuniões" },
  { id: "ligacao", rotulo: "Ligações" },
  { id: "nota", rotulo: "Notas" },
  { id: "sistema", rotulo: "Sistema" },
];

const RESULTADO_DA_TAREFA: Record<string, string> = {
  ganho: "Ganho / Agendou", concluida: "Concluída", sem_interesse: "Perdido", atendeu: "Atendeu (pediu retorno)",
  nao_atendeu: "Não atendeu", caixa_postal: "Caixa postal", numero_errado: "Nº errado", desligou: "Desligou",
  com_avanco: "Com avanço", sem_avanco: "Sem avanço", gatekeeper: "Parado no gatekeeper",
  persona_indisponivel: "Persona indisponível", telefone_incorreto: "Telefone incorreto", sem_conexao: "Sem conexão",
};

const TOM_DA_TEMPERATURA: Record<string, string> = { quente: "danger", morno: "warn", frio: "info" };

/** "2026-11-05T18:30" no fuso local, pro <input type="datetime-local">. */
function paraInputLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LeadDetailPage({ leadId, onBack, papel: papelDaProp }: LeadDetailPageProps) {
  const { currentUser } = useQsAuth();
  const papel: PapelDaFicha = papelDaProp ?? (currentUser?.role === "closer" ? "closer" : "sdr");
  const [aba, setAbaCrua] = useState<AbaAtividade>("tudo");
  // Faixa/menus novos do redesenho (03/11).
  const [mostrarPerdido, setMostrarPerdido] = useState(false);
  const [tarefaReagendar, setTarefaReagendar] = useState<Task | null>(null);
  const [novaDataTarefa, setNovaDataTarefa] = useState("");
  const [salvandoReagendar, setSalvandoReagendar] = useState(false);
  const [tarefaOcupada, setTarefaOcupada] = useState<string | null>(null);
  const [subirVendaAberto, setSubirVendaAberto] = useState(false);
  const [avisoVenda, setAvisoVenda] = useState<{ tom: "ok" | "aviso"; mensagem: string } | null>(null);
  const [newNote, setNewNote] = useState("");
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  // Oportunidade futura (0083): o modal e um contador que faz a faixa reler.
  const [mostrarOportunidade, setMostrarOportunidade] = useState(false);
  const [versaoOportunidade, setVersaoOportunidade] = useState(0);
  // Financeiro (0127, 14/10): o SDR/closer manda o cliente e acompanha o status.
  const [enviarFin, setEnviarFin] = useState(false);
  const [sinalFin, setSinalFin] = useState(0);
  // Central de Solicitações (0149): pedir ao Relacionamento/Operações/Financeiro.
  const [pedirSetor, setPedirSetor] = useState(false);
  const [pedirPagamento, setPedirPagamento] = useState(false);
  const [sinalPedidos, setSinalPedidos] = useState(0);
  const [selectedCloser, setSelectedCloser] = useState("");
  const [handoverSuccess, setHandoverSuccess] = useState(false);
  const [showReEngagement, setShowReEngagement] = useState(false);
  const [reEngagementScheduled, setReEngagementScheduled] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [lossReasons, setLossReasons] = useState<{ id: string; label: string }[]>([]);
  const [selectedLossReason, setSelectedLossReason] = useState("");

  // ── Agendar Reunião: modal único do QS (agenda dos closers, 0027) ──
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  // Reunião aberta no modal OFICIAL de desfecho, e a que está sendo remarcada.
  const [reuniaoAberta, setReuniaoAberta] = useState<Meeting | null>(null);
  const [reuniaoRemarcar, setReuniaoRemarcar] = useState<Meeting | null>(null);

  // ── WhatsApp (Task 3) ──
  const [showWhatsApp, setShowWhatsApp] = useState(false);

  // ── Sprint 4 (A1): editar/excluir lead, notas, contatos, reuniões etc. ──
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [savingNote, setSavingNote] = useState(false);
  const [savingHandover, setSavingHandover] = useState(false);
  const [schedulingReContact, setSchedulingReContact] = useState(false);
  const [bitrixCopied, setBitrixCopied] = useState(false);
  const [savingScore, setSavingScore] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<LeadEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonValue, setWonValue] = useState("");
  const [wonError, setWonError] = useState<string | null>(null);
  const [savingWon, setSavingWon] = useState(false);
  const [removingCadence, setRemovingCadence] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);

  // ── Data state ──
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [cadenceDays, setCadenceDays] = useState<CadenceDay[]>([]);
  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [allUsers, setAllUsers] = useState<SdrUser[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Venda do closer (card "Venda" + "Marcar como ganho" → SubirVenda) ──
  const veVenda = papel === "closer" && podeAbrirAreaCloser(currentUser);
  const venda = useVendaDoLead(leadId, veVenda);
  // Saiu do bloco "Venda" (contrato/link mudam lá dentro) → o card relê.
  function setAba(nova: AbaAtividade) {
    if (aba === "venda" && nova !== "venda" && veVenda) venda.recarregar();
    setAbaCrua(nova);
  }

  // ── Cotando aéreo (0206): o cronômetro aparece no cabeçalho enquanto corre ──
  const cotacao = useSyncExternalStore(ouvirCotacaoAereo, cotacaoAereoAberta);
  useEffect(() => { if (currentUser?.id) void carregarCotacaoAberta(currentUser.id); }, [currentUser?.id]);

  // ── Fetch lead and related data ──
  const fetchLead = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_leads")
      .select(LEAD_SELECT)
      .eq("id", leadId)
      .single();
    if (error) {
      console.warn("Erro ao buscar lead:", error);
      // PGRST116 = zero linhas no .single() → o lead realmente não existe (ou a
      // RLS escondeu). Qualquer OUTRO erro é falha de rede/servidor e não pode
      // virar "Lead não encontrado" — vira estado de erro com "Tentar de novo".
      if ((error as { code?: string }).code !== "PGRST116") {
        setLoadError(error.message || "Falha de conexão ao buscar o lead.");
      }
      return null;
    }
    setLead(data as Lead);
    return data as Lead;
  }, [leadId]);

  // ── Reload tasks (Sprint 4: "Próximas atividades" precisa refletir remoções) ──
  const reloadTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_tasks")
      .select("*")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: true });
    if (error) {
      console.warn("Erro ao recarregar tasks:", error);
      return;
    }
    setTasks((data as Task[]) ?? []);
  }, [leadId]);

  // ── Reload meetings (Task 1) ──
  const reloadMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*)")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false });
    if (error) {
      console.warn("Erro ao recarregar reuniões:", error);
      return;
    }
    setMeetings((data as Meeting[]) ?? []);
  }, [leadId]);

  // Oportunidade futura registrada pela ficha (29/09): a reunião do lead que
  // ficou sem desfecho recebe um — senão continua trancando a agenda do closer.
  const fecharReunioesDaOportunidade = useCallback(async () => {
    const { data } = await supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*)")
      .eq("lead_id", leadId)
      .in("status", ["agendada", "confirmada"]);
    for (const m of (data as Meeting[]) ?? []) {
      const s = desfechoDaOportunidadeFutura(m);
      if (!s) continue;
      const r = await setMeetingStatus(m, s, m.lead?.bitrix_id);
      if (!r.ok) notifyError(`A oportunidade foi registrada, mas a reunião ficou sem desfecho: ${r.error}`);
    }
    void reloadMeetings();
  }, [leadId, reloadMeetings]);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setLoadError(null);
      const leadData = await fetchLead();

      const [notesRes, meetingsRes, tasksRes, closersRes] = await Promise.all([
        supabase.from("qs_notes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
        supabase.from("qs_meetings").select("*, lead:qs_leads(*)").eq("lead_id", leadId).order("scheduled_at", { ascending: false }),
        supabase.from("qs_tasks").select("*").eq("lead_id", leadId).order("scheduled_at", { ascending: true }),
        supabase.from("qs_users").select("*"),
      ]);

      if (notesRes.error) console.warn("Erro ao buscar notes:", notesRes.error);
      else setNotes((notesRes.data as Note[]) ?? []);

      if (meetingsRes.error) console.warn("Erro ao buscar meetings:", meetingsRes.error);
      else setMeetings((meetingsRes.data as Meeting[]) ?? []);

      if (tasksRes.error) console.warn("Erro ao buscar tasks:", tasksRes.error);
      else setTasks((tasksRes.data as Task[]) ?? []);

      if (closersRes.error) console.warn("Erro ao buscar usuários:", closersRes.error);
      else {
        const usersList = (closersRes.data as SdrUser[]) ?? [];
        setAllUsers(usersList); // usado pra exibir o autor real das anotações
        const closersList = usersList.filter((u) => u.role === "closer" && u.is_active);
        setClosers(closersList);
        if (closersList.length > 0) setSelectedCloser(closersList[0].id);
      }

      // Fetch loss reasons for re-engagement (Change 16)
      const { data: lrData } = await supabase
        .from("qs_loss_reasons")
        .select("id, label")
        .eq("is_archived", false);
      if (lrData) setLossReasons(lrData as any[]);

      // Fetch cadence if lead has one
      if (leadData?.cadence_id) {
        const { data: cadData, error: cadErr } = await supabase
          .from("qs_cadences")
          .select("*")
          .eq("id", leadData.cadence_id)
          .single();
        if (cadErr) console.warn("Erro ao buscar cadence:", cadErr);
        else setCadence(cadData as Cadence);

        const { data: daysData, error: daysErr } = await supabase
          .from("qs_cadence_days")
          .select("*, activities:qs_cadence_activities(*)")
          .eq("cadence_id", leadData.cadence_id)
          .order("day_number", { ascending: true });
        if (daysErr) console.warn("Erro ao buscar cadence days:", daysErr);
        else setCadenceDays((daysData as CadenceDay[]) ?? []);
      }

      setLoading(false);
    }
    loadAll();
  }, [leadId, fetchLead, retryTick]);

  // ── Add note ──
  async function addNote() {
    // Guarda de duplo clique/Enter+clique: sem ela, dois inserts iguais entravam.
    if (!newNote.trim() || !lead || savingNote) return;
    setSavingNote(true);
    try {
      const { data, error } = await supabase
        .from("qs_notes")
        .insert({ lead_id: lead.id, author_id: currentUser?.id ?? lead.owner_id, body: newNote.trim() })
        .select()
        .single();
      if (error) {
        console.warn("Erro ao adicionar nota:", error);
        notifyError("Não foi possível salvar a anotação — tente novamente.");
        return;
      }
      // Espelha a nota como comentário na timeline do negócio no Bitrix.
      notifyBitrix("nota", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        body: newNote.trim(),
      });
      setNotes([data as Note, ...notes]);
      setNewNote("");
    } finally {
      setSavingNote(false);
    }
  }

  // ── Edit/delete note (Sprint 4) ──
  function startEditNote(note: Note) {
    setEditingNoteId(note.id);
    setEditingNoteBody(note.body);
  }

  async function saveNoteEdit() {
    if (!editingNoteId || !editingNoteBody.trim() || savingNoteEdit) return;
    setSavingNoteEdit(true);
    try {
      const updated = await updateQsNote(editingNoteId, editingNoteBody.trim());
      if (!updated) return; // updateQsNote já avisou por toast
      setNotes(notes.map((n) => (n.id === updated.id ? updated : n)));
      setEditingNoteId(null);
      setEditingNoteBody("");
    } finally {
      setSavingNoteEdit(false);
    }
  }

  async function handleDeleteNote(note: Note) {
    if (!window.confirm("Excluir esta anotação? Ela sai do histórico do lead e não dá pra desfazer.")) return;
    const ok = await deleteQsNote(note.id);
    if (!ok) return; // deleteQsNote já avisou por toast
    setNotes(notes.filter((n) => n.id !== note.id));
    if (editingNoteId === note.id) {
      setEditingNoteId(null);
      setEditingNoteBody("");
    }
  }

  // ── Temperatura editável (Sprint 4) ──
  // O badge deixa de ser só reflexo do Bitrix: o SDR classifica Quente/Morno/Frio.
  // ── Temperatura do SDR (05/11, migration 0311) ──
  // A SEGUNDA temperatura: a leitura de quem conversou. Nasce no agendamento
  // (obrigatória) e pode ser corrigida aqui. Não mexe na foto já gravada na
  // reunião — essa é a que o agendamento registrou.
  async function setTemperaturaSdr(level: LeadTemperature) {
    if (!lead || savingScore) return;
    setSavingScore(true);
    try {
      const updated = await updateQsLead(lead.id, {
        temperatura_sdr: level,
        temperatura_sdr_em: new Date().toISOString(),
      });
      if (!updated) return;
      setLead(updated);
      notifySuccess(`Temperatura do SDR: ${chipDaTemperatura(level).label}.`);
    } finally {
      setSavingScore(false);
    }
  }

  async function setTemperature(label: string | null) {
    if (!lead || savingScore) return;
    setSavingScore(true);
    try {
      const updated = await updateQsLead(lead.id, { lead_score: label });
      if (!updated) return; // updateQsLead já avisou por toast
      setLead(updated);
      notifySuccess(label ? `Temperatura atualizada: ${label}.` : "Temperatura removida.");
    } finally {
      setSavingScore(false);
    }
  }

  // ── Editar lead (Sprint 4 — o maior buraco do app) ──
  function openEditModal() {
    if (!lead) return;
    setEditForm(leadToEditForm(lead));
    setEditError(null);
    setShowEditModal(true);
  }

  async function saveLeadEdit() {
    if (!lead || !editForm || savingEdit) return;
    const fullName = editForm.full_name.trim();
    if (!fullName) {
      setEditError("O nome do lead não pode ficar vazio.");
      return;
    }
    const estimated = parseMoney(editForm.estimated_value);
    if (estimated !== null && (Number.isNaN(estimated) || estimated < 0)) {
      setEditError("Valor estimado inválido — use números (ex.: 1500 ou 1.500,50).");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const payload: Partial<Lead> = {
        full_name: fullName,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
        company_name: editForm.company_name.trim() || null,
        job_title: editForm.job_title.trim() || null,
        department: editForm.department.trim() || null,
        source: editForm.source,
        city: editForm.city.trim() || null,
        state: editForm.state.trim() || null,
        estimated_value: estimated,
        company_linkedin: editForm.company_linkedin.trim() || null,
        company_size: editForm.company_size.trim() || null,
      };
      // Mantém first/last coerentes com o nome exibido (iniciais do avatar) —
      // só quando o nome realmente mudou, pra não sobrescrever dados do Bitrix.
      if (fullName !== (lead.full_name ?? "")) {
        const parts = fullName.split(/\s+/);
        payload.first_name = parts[0] ?? null;
        payload.last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }
      const updated = await updateQsLead(lead.id, payload);
      if (!updated) return; // updateQsLead já avisou por toast (e mediu o efeito)
      setLead(updated);
      setShowEditModal(false);
      notifySuccess("Lead atualizado.");
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Excluir lead no detalhe (Sprint 4 — só gestor/admin, cascade forte) ──
  async function handleDeleteLead() {
    if (!lead || deletingLead) return;
    const ok = window.confirm(
      `EXCLUIR o lead ${lead.full_name ?? "sem nome"}?\n\n` +
        "Isso apaga DEFINITIVAMENTE o lead e, em cascata, todo o histórico: " +
        "anotações, atividades, reuniões, contatos e handovers. Não dá pra desfazer.\n\n" +
        "Se a intenção é só tirar da fila, prefira marcar como Perdido."
    );
    if (!ok) return;
    setDeletingLead(true);
    try {
      const deleted = await deleteQsLead(lead.id); // camada mede RLS e avisa em falha
      if (!deleted) return;
      notifySuccess("Lead excluído.");
      onBack();
    } finally {
      setDeletingLead(false);
    }
  }

  // ── Remover da cadência (Sprint 4) ──
  async function removeFromCadence() {
    if (!lead || !lead.cadence_id || removingCadence) return;
    const ok = window.confirm(
      `Remover ${lead.full_name ?? "este lead"} da cadência${cadence?.name ? ` "${cadence.name}"` : ""}?\n\n` +
        "As atividades ABERTAS do plano serão encerradas (as extras e as já concluídas ficam)."
    );
    if (!ok) return;
    setRemovingCadence(true);
    try {
      const updated = await updateQsLead(lead.id, { cadence_id: null, cadence_started_at: null });
      if (!updated) return; // updateQsLead já avisou por toast
      const closed = await closeOpenCadenceTasks(lead.id, "Lead removido da cadência");
      if (!closed) {
        notifyError("O lead saiu da cadência, mas as atividades abertas do plano NÃO foram encerradas — encerre-as no Painel.");
      }
      setLead(updated);
      setCadence(null);
      setCadenceDays([]);
      await reloadTasks();
      notifySuccess("Lead removido da cadência.");
    } finally {
      setRemovingCadence(false);
    }
  }

  // ── Mark as won (Sprint 4: modal pede o VALOR FECHADO — closed_value nunca
  // era escrito e a "receita ganha" do dashboard vivia em R$ 0) ──
  function openWonModal() {
    if (!lead) return;
    // Incentiva sem obrigar: pré-preenche com a estimativa quando existir.
    setWonValue(lead.estimated_value != null ? String(lead.estimated_value) : "");
    setWonError(null);
    setShowWonModal(true);
  }

  async function confirmWon() {
    if (!lead || savingWon) return;
    const value = parseMoney(wonValue);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setWonError("Valor inválido — use números (ex.: 1500 ou 1.500,50). Deixe vazio pra não informar.");
      return;
    }
    setSavingWon(true);
    setWonError(null);
    try {
      // updateQsLead MEDE o que o banco aceitou (erro OU .single() sem linha) e
      // avisa por toast em falha — nada de sucesso otimista.
      const updated = await updateQsLead(lead.id, {
        status: "ganho" as LeadStatus,
        closed_value: value,
      });
      if (!updated) return;
      // Encerra as atividades ainda abertas do lead (mesmo comportamento do Painel);
      // sem isso elas ficam "pendente" pra sempre e inflam contadores e a taxa de atraso.
      const { error: tasksError } = await supabase
        .from("qs_tasks")
        .update({ status: "ignorada", skip_reason: "Lead ganho" })
        .eq("lead_id", lead.id)
        .in("status", ["pendente", "atrasada"]);
      if (tasksError) {
        console.warn("Erro ao encerrar atividades do lead ganho:", tasksError);
        notifyError("Lead ganho, mas as atividades abertas não foram encerradas — encerre-as no Painel.");
      }
      // Move o negócio pra coluna de Ganho no Bitrix. O evento continua "ganho"
      // (whitelist); o servidor lê o closed_value do próprio lead (gravado acima).
      notifyBitrix("ganho", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        full_name: lead.full_name,
        closed_value: value,
      });
      setLead(updated);
      setShowWonModal(false);
      await reloadTasks();
      notifySuccess("Lead marcado como GANHO.");
    } finally {
      setSavingWon(false);
    }
  }

  // ── Mark as lost (with re-engagement check — Change 16) ──
  // `jaConfirmado`: o modal "Marcar como perdido" (03/11) já é a confirmação.
  async function markAsLost(lossReasonId?: string, jaConfirmado = false) {
    if (!lead) return;
    // Confirmação: um toque errado não pode encerrar o lead.
    const reasonLabel = lossReasonId ? lossReasons.find((r) => r.id === lossReasonId)?.label : null;
    if (!jaConfirmado && !window.confirm(`Marcar ${lead.full_name ?? "este lead"} como PERDIDO${reasonLabel ? ` (${reasonLabel})` : ""}?`)) {
      setSelectedLossReason("");
      return;
    }
    const updateData: Record<string, unknown> = { status: "perdido" as LeadStatus };
    if (lossReasonId) updateData.loss_reason_id = lossReasonId;

    // Pelo updateQsLead, que MEDE o que o banco aceitou — igual ao "ganho" logo
    // acima. Checar só `error` não bastava: sob RLS a recusa volta 0 linhas SEM
    // erro, e o código seguia encerrando as atividades e avisando o Bitrix de
    // uma perda que nunca foi gravada.
    const perdido = await updateQsLead(lead.id, updateData as Partial<Lead>);
    if (!perdido) {
      setSelectedLossReason("");
      return;
    }

    // Encerra as atividades ainda abertas do lead (mesmo comportamento do Painel).
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: "Lead perdido" })
      .eq("lead_id", lead.id)
      .in("status", ["pendente", "atrasada"]);
    setSelectedLossReason("");
    await reloadTasks();

    // Move o negócio pra coluna de Perdido no Bitrix (com o motivo).
    notifyBitrix("perdido", {
      lead_id: lead.id,
      bitrix_id: lead.bitrix_id,
      full_name: lead.full_name,
      loss_reason: lossReasonId ? lossReasons.find((r) => r.id === lossReasonId)?.label ?? null : null,
    });

    // Check if loss reason suggests re-engagement
    if (lossReasonId) {
      const reason = lossReasons.find((r) => r.id === lossReasonId);
      const label = reason?.label?.toLowerCase() || "";
      if (label.includes("retorno") || label.includes("budget") || label.includes("timing") || label.includes("momento") || label.includes("orçamento")) {
        setShowReEngagement(true);
        await fetchLead();
        return;
      }
    }

    await fetchLead();
  }

  // ── Schedule re-engagement (Change 16) ──
  async function scheduleReEngagement(days: number) {
    // Guarda de duplo clique: dois toques em "30 dias" criavam DUAS tarefas.
    if (!lead || schedulingReContact) return;
    setSchedulingReContact(true);
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + days);
    // Horário de Trabalho = verdade absoluta: o +N dias pode cair num fim de
    // semana/folga (nasceria "atrasado"). Snap pro próximo momento de trabalho.
    const scheduledWork = nextWorkMoment(await loadWorkHours(), scheduledAt);

    // A tag "re_contato" faz o Painel exibir esta tarefa mesmo com o lead perdido
    // (o filtro padrão esconde tarefas de leads ganhos/perdidos).
    const { error } = await supabase.from("qs_tasks").insert({
      lead_id: lead.id,
      owner_id: lead.owner_id,
      channel_type: "ligacao",
      status: "pendente",
      priority: "media",
      scheduled_at: scheduledWork.toISOString(),
      is_extra: true,
      tags: ["re_contato"],
      notes: `Re-contato agendado (${days} dias) - Lead marcado como perdido`,
    });

    if (error) {
      console.warn("Erro ao agendar re-contato:", error);
      notifyError("Não foi possível agendar o re-contato.");
      setSchedulingReContact(false);
    } else {
      setReEngagementScheduled(true);
      await reloadTasks();
      setTimeout(() => {
        setReEngagementScheduled(false);
        setShowReEngagement(false);
        setSchedulingReContact(false);
      }, 2000);
    }
  }

  // ── Handover to closer ──
  // Handover NÃO é ganho: só troca o dono e encerra as atividades de prospecção.
  // (Antes marcava status "ganho", inflando o placar/ranking sem venda — o ganho
  // de verdade continua sendo dado pelo fluxo de desfecho, com reunião.)
  async function handleHandover() {
    // Guarda de duplo clique: sem ela, dois handovers idênticos eram registrados.
    if (!lead || !selectedCloser || savingHandover) return;
    setSavingHandover(true);
    try {
    const { data: hoRow, error: hoError } = await supabase
      .from("qs_handovers")
      .insert({ lead_id: lead.id, from_user_id: lead.owner_id, to_user_id: selectedCloser })
      .select("id")
      .maybeSingle();
    if (hoError || !hoRow) {
      console.warn("Erro ao criar handover:", hoError);
      notifyError("Não foi possível fazer o handover — tente novamente.");
      return;
    }
    // A troca de dono vai pela função da 0040, não por UPDATE direto: o UPDATE
    // direto é recusado com "new row violates row-level security policy" sempre
    // que o novo dono não é quem está editando — que é exatamente o caso aqui.
    // Foi o mesmo tropeço da transferência entre SDRs.
    //
    // MEDIDO: sob RLS a recusa volta 0 linhas SEM erro. Sem medir, a passagem era
    // dada como feita — as atividades do SDR eram encerradas e o Bitrix avisado —
    // com o lead ainda no nome do SDR antigo: sumia da fila dele e nunca chegava
    // no closer.
    const { data: rpcOk, error: upError } = await supabase.rpc("qs_transferir_lead", {
      p_lead: lead.id,
      p_para: selectedCloser,
      p_motivo: "Handover para closer",
    });
    const donoRows = (rpcOk as { ok?: boolean } | null)?.ok ? [1] : null;
    if (upError || !donoRows) {
      console.warn("Erro ao atualizar lead após handover:", upError);
      // Desfaz o registro do handover: deixá-lo de pé descreveria uma passagem
      // que não aconteceu (e o qs_owns_lead da 0029 lê essa tabela).
      await supabase.from("qs_handovers").delete().eq("id", hoRow.id);
      notifyError("O handover NÃO foi concluído — o lead continua com o dono atual. Tente de novo.");
      return;
    }

    // A prospecção acabou: encerra as atividades abertas pra não ficarem na fila do SDR antigo.
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: "Handover para closer" })
      .eq("lead_id", lead.id)
      .in("status", ["pendente", "atrasada"]);

    // Registra o handover na timeline do Bitrix (sem mover coluna).
    const closerName = closers.find((c) => c.id === selectedCloser)?.name ?? "closer";
    notifyBitrix("nota", {
      lead_id: lead.id,
      bitrix_id: lead.bitrix_id,
      body: `Lead enviado para o closer ${closerName} (handover no QS).`,
    });

    setShowHandoverModal(false);
    setHandoverSuccess(true);
    setTimeout(() => setHandoverSuccess(false), 3000);
    await fetchLead();
    await reloadTasks();
    } finally {
      setSavingHandover(false);
    }
  }

  // ── Reunião agendada pelo modal central ──
  // O insert, a atividade de confirmação e o aviso ao Bitrix são do
  // ScheduleMeetingModal / lib/qs/meetings.ts. Aqui só recarregamos a aba.
  async function afterMeetingSaved() {
    await reloadMeetings();
    setShowMeetingModal(false);
    setAba("reuniao");
  }

  // ── Reativar lead (ganho/perdido → em prospecção, cadência do dia 1) ──
  async function reativarLead() {
    if (!lead || reactivating) return;
    if (!window.confirm(`Reativar ${lead.full_name ?? "este lead"}? As atividades da cadência serão recriadas do dia 1.`)) return;
    setReactivating(true);
    try {
      const { error } = await supabase.from("qs_leads").update({
        status: "em_prospeccao",
        loss_reason_id: null,
        cadence_started_at: new Date().toISOString(),
        arrived_at: new Date().toISOString(),
      }).eq("id", lead.id);
      if (error) {
        console.warn("Erro ao reativar lead:", error);
        notifyError("Não foi possível reativar o lead — tente novamente.");
        return;
      }

      // Recria as tarefas pela função única da cadência (a versão antiga
      // inseria uma coluna inexistente e falhava em silêncio: o lead
      // voltava a "em prospecção" com ZERO atividades e sumia da fila).
      if (lead.cadence_id) {
        await createCadenceTasks(lead.id, lead.cadence_id, lead.owner_id);
      }

      // Sprint 4: a reativação agora tem rastro no Bitrix — antes o
      // deal ficava em LOSE lá enquanto o QS trabalhava o lead de novo.
      // Whitelist do sync é perdido|ganho|reuniao|nota → vai como "nota".
      notifyBitrix("nota", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        body: `Lead REATIVADO no QS${currentUser?.name ? ` por ${currentUser.name}` : ""} — voltou pra prospecção com a cadência reiniciada do dia 1. Atualize a coluna do negócio no Bitrix se necessário.`,
      });

      setLead({ ...lead, status: "em_prospeccao" as LeadStatus, loss_reason_id: null });
      await reloadTasks();
    } finally {
      setReactivating(false);
    }
  }

  // ── Ligar (mesmo caminho do canal "Ligação" da Fila) ──
  // Pergunta antes: o telefone de um cliente de verdade toca. Prefere o webfone
  // WebRTC; sem ramal provisionado, cai no click-to-dial do softphone (BravoTech).
  async function ligar() {
    if (!lead?.phone) return;
    const ok = await confirmar({
      titulo: "Você confirma querer ligar por telefone?",
      mensagem: `A chamada vai tocar agora para ${lead.full_name || "o lead"} (${formatPhoneDisplay(lead.phone)}).`,
      confirmarLabel: "Confirmar e ligar",
      recusarLabel: "Recusar",
    });
    if (!ok) return;
    if (await isWebphoneConfigured()) {
      notifySuccess("Ligando pelo webfone…");
      const r = await dialViaWebphone(lead.phone, { leadName: lead.full_name ?? null, leadId: lead.id, ownerId: currentUser?.id ?? null });
      if (!r.ok) notifyError(r.error || "Webfone WebRTC indisponível.");
      return;
    }
    const r = await dialViaSip(lead.phone);
    if (r.ok) notifySuccess("Discando no softphone (BravoTech)… registre o desfecho ao terminar.");
    else notifyError(r.error || "Não foi possível abrir o softphone (BravoTech).");
  }

  // ── Concluir / desfazer uma atividade pela ficha ──
  // Igual ao "Concluir" da Fila pra canais que não são ligação (conclui, conta
  // como contato feito e move o card do Bitrix de Novo lead pra Follow-up 1).
  // LIGAÇÃO não conclui aqui: ela exige a classificação (atendeu, caixa postal…)
  // que gera o follow-up — isso é a Fila de hoje, e a ficha manda pra lá.
  async function concluirTarefa(t: Task) {
    if (!lead || tarefaOcupada) return;
    if (ehLigacao(t.channel_type)) {
      const ir = await confirmar({
        titulo: "Ligação se conclui na Fila de hoje",
        mensagem: "A ligação pede a classificação (atendeu, caixa postal, com avanço…) e já gera o próximo passo. Isso é feito na Fila de hoje.",
        confirmarLabel: "Abrir a Fila de hoje",
        recusarLabel: "Ficar aqui",
      });
      if (ir) window.location.hash = "#comercial/painel";
      return;
    }
    setTarefaOcupada(t.id);
    try {
      const feita = await completeTask(t.id, "concluida");
      if (!feita) return; // completeTask já avisou (ou já estava concluída)
      notifyBitrix("primeiro-contato", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        full_name: lead.full_name,
        canal: CHANNEL_LABELS[t.channel_type],
        desfecho: "Concluída",
        alcancou: true,
        sdr: currentUser?.name ?? null,
      });
      await reloadTasks();
      notifySuccess(`${CHANNEL_LABELS[t.channel_type] ?? "Atividade"} concluída.`);
    } finally {
      setTarefaOcupada(null);
    }
  }

  async function desfazerTarefa(t: Task) {
    if (tarefaOcupada || ehLigacao(t.channel_type)) return;
    setTarefaOcupada(t.id);
    try {
      const ok = await undoCompleteTask(t.id);
      if (!ok) return;
      await reloadTasks();
      notifySuccess("Conclusão desfeita — a atividade voltou pra fila.");
    } finally {
      setTarefaOcupada(null);
    }
  }

  // ── Reagendar uma atividade aberta (Horário de Trabalho manda: encaixa no expediente) ──
  function abrirReagendarTarefa(t: Task) {
    setTarefaReagendar(t);
    setNovaDataTarefa(paraInputLocal(t.scheduled_at));
  }

  async function salvarReagendarTarefa() {
    if (!tarefaReagendar || !novaDataTarefa || salvandoReagendar) return;
    const pedido = new Date(novaDataTarefa);
    if (Number.isNaN(pedido.getTime())) { notifyError("Data inválida."); return; }
    setSalvandoReagendar(true);
    try {
      const encaixe = nextWorkMoment(await loadWorkHours(), pedido);
      const ok = await updateOpenTask(tarefaReagendar.id, { scheduled_at: encaixe.toISOString() });
      if (!ok) return; // updateOpenTask já avisou
      await reloadTasks();
      setTarefaReagendar(null);
      const mudou = Math.abs(encaixe.getTime() - pedido.getTime()) > 60_000;
      notifySuccess(`Atividade reagendada para ${quandoPorExtenso(encaixe.toISOString())}${mudou ? " (encaixada no horário de trabalho)" : ""}.`);
    } finally {
      setSalvandoReagendar(false);
    }
  }

  // ── "Marcar como ganho" do closer → a tela única de venda ──
  function abrirSubirVenda() {
    if (venda.carregando) return;
    if (!venda.negocio) {
      notifyError("Este cliente ainda não tem cartão no pipeline. Traga pro pipeline no bloco Venda e depois registre a venda.");
      setAba("venda");
      return;
    }
    setSubirVendaAberto(true);
  }

  // ── Loading / Not found ──
  function Aviso({ titulo, texto, acao }: { titulo: string; texto?: string | null; acao?: React.ReactNode }) {
    return (
      <div className="fl" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 8, padding: 16 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{titulo}</p>
        {texto && <p className="fl-mudo" style={{ maxWidth: 420, textAlign: "center" }}>{texto}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
          {acao}
          <button type="button" className="fl-btn" onClick={onBack}>Voltar para Leads</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fl" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <p className="fl-mudo">Carregando...</p>
      </div>
    );
  }

  // Falha de rede/servidor NÃO é "Lead não encontrado" — oferece tentar de novo.
  if (!lead && loadError) {
    return (
      <Aviso titulo="Não foi possível carregar o lead." texto={loadError}
        acao={<button type="button" className="fl-btn fl-btn--acao" onClick={() => setRetryTick((t) => t + 1)}>Tentar de novo</button>} />
    );
  }

  if (!lead) return <Aviso titulo="Lead não encontrado." />;

  // ── Isolamento por dono ──────────────────────────────────────────────────────
  // SDR/closer só abrem o PRÓPRIO lead (esta tela abre por ID direto — via busca
  // global, link ou URL — sem passar pelo filtro da lista). Gestor/admin veem tudo.
  // Backstop de tela: a garantia REAL é a RLS 0007/0008 no banco.
  const canView =
    !!currentUser &&
    // O closer atende qualquer conversa (0050) — o card do cliente acompanha,
    // senão o "Abrir card" da lista de WhatsApp termina num beco sem saída.
    (canSeeAllData(currentUser.role) || currentUser.role === "closer" || lead.owner_id === currentUser.id);
  if (!canView) {
    return <Aviso titulo="Este lead é de outro SDR." texto="Você só tem acesso aos seus próprios leads." />;
  }

  // Lead fechado não mostra Ganho/Perdido (re-clicar re-disparava o Bitrix e
  // sobrescrevia o desfecho); a saída correta é "Reativar Lead".
  const isClosed = lead.status === "ganho" || lead.status === "perdido";
  // Excluir lead é ação de gestor/admin (RLS leads_delete = qs_is_manager()).
  const canDeleteLead = !!currentUser && canSeeAllData(currentUser.role);
  // Oportunidade futura: decisão do closer (ou da gestão) sobre o NEGÓCIO.
  const podeOportunidade = !!currentUser && (canSeeAllData(currentUser.role) || currentUser.role === "closer");
  // Cotação de aéreo do SDR: cronômetro, não meta (0206). Sem a migration, some.
  const podeCotarAereo = !!currentUser && (currentUser.role === "sdr" || canSeeAllData(currentUser.role)) && cotacao !== "sem-tabela";
  const cotandoAgora = cotacao && cotacao !== "sem-tabela" ? cotacao : null;

  const agora = new Date();
  const nomeDoLead = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Sem nome";
  const temperatura = getLeadScore(lead);
  const temperaturaSdr = getSdrTemperature(lead.temperatura_sdr);
  const totalDeDias = cadenceDays.reduce((m, d) => Math.max(m, d.day_number), 0);
  const diaCad = diaDaCadencia(lead.cadence_started_at, totalDeDias, agora);
  const reunioesAbertas = meetings.filter(reuniaoEstaAberta).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const reuniaoRealizada = meetings.some((m) => m.status === "realizada");
  const proximo = escolherProximoPasso(papel, tasks, meetings);
  const autorDe = (id: string | null) => allUsers.find((u) => u.id === id)?.name ?? null;

  // Selo de status do cabeçalho. SDR: a cadência; Closer: o estado da reunião.
  const seloStatus: { texto: string; tom: string } = (() => {
    if (lead.status === "ganho") return { texto: "Ganho", tom: "ok" };
    if (lead.status === "perdido") return { texto: `Perdido${lead.loss_reason?.label ? ` · ${lead.loss_reason.label}` : ""}`, tom: "danger" };
    if (papel === "closer") {
      const aberta = reunioesAbertas[0];
      if (aberta) return { texto: aberta.status === "confirmada" ? "Reunião confirmada" : "Reunião agendada", tom: "info" };
      const ultima = [...meetings].sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];
      if (ultima) return { texto: `Reunião: ${MEETING_STATUS_LABELS[ultima.status]?.toLowerCase() ?? ultima.status}`, tom: ultima.status === "no_show" || ultima.status === "desistencia" ? "warn" : "" };
      return { texto: "Sem reunião", tom: "" };
    }
    if (lead.status === "em_prospeccao" && diaCad) return { texto: `Em prospecção · Dia ${diaCad.dia} de ${diaCad.total}`, tom: "info" };
    return { texto: STATUS_LABELS[lead.status], tom: lead.status === "em_prospeccao" ? "info" : "" };
  })();

  // ── Linha do tempo (coluna "Atividade") ──
  const linha: ItemDaLinha[] = [];
  const chegada = lead.arrived_at || lead.created_at;
  if (chegada) {
    linha.push({
      id: "chegada", tipo: "sistema", ts: chegada, titulo: "Lead entrou no sistema", por: SOURCE_LABELS[lead.source] ?? lead.source,
      linhas: [
        ...(lead.segment ? [{ k: "Fonte / Produto", v: lead.segment }] : []),
        ...(lead.lead_score ? [{ k: "Temperatura", v: temperatura?.label ?? lead.lead_score }] : []),
        ...(lead.bitrix_id ? [{ k: "ID do Bitrix", v: lead.bitrix_id }] : []),
      ],
    });
  }
  notes.forEach((n) => linha.push({
    id: `n-${n.id}`, tipo: "nota", ts: n.created_at, titulo: "Anotação", texto: n.body, nota: n,
    // Autor REAL da nota (antes exibia sempre o dono do lead — num handover, as notas antigas "mudavam" de autor).
    por: autorDe(n.author_id) ?? lead.owner?.name ?? "Autor",
  }));
  tasks.filter((t) => t.status === "concluida" && t.completed_at).forEach((t) => {
    const res = (t as unknown as { contact_result?: string }).contact_result;
    linha.push({
      id: `t-${t.id}`, tipo: ehLigacao(t.channel_type) ? "ligacao" : "tarefa", ts: t.completed_at!,
      titulo: `${CHANNEL_LABELS[t.channel_type] ?? t.channel_type} — ${res ? (RESULTADO_DA_TAREFA[res] ?? res) : "concluída"}`,
      por: t.is_extra ? "Atividade extra" : "Cadência SDR", texto: t.notes || null,
    });
  });
  meetings.forEach((m) => linha.push({
    id: `m-${m.id}`, tipo: "reuniao", ts: m.created_at, reuniao: m,
    titulo: m.origem === "autoagendamento" ? "Lead marcou pela página de agendamento" : `Reunião ${MEETING_STATUS_LABELS[m.status]?.toLowerCase() ?? m.status}`,
    por: m.scheduled_by || (m.origem === "gloria" ? "Glória (IA)" : null),
    linhas: [
      { k: "Quando", v: quandoPorExtenso(m.scheduled_at) + (m.duration_min ? ` · ${m.duration_min} min` : "") },
      ...(m.meeting_owner || m.closer?.name ? [{ k: "Com", v: m.closer?.name ?? m.meeting_owner }] : []),
      { k: "Situação", v: MEETING_STATUS_LABELS[m.status] ?? m.status },
      ...(m.title ? [{ k: "Assunto", v: m.title }] : []),
      ...(m.location ? [{ k: "Local", v: m.location }] : []),
      ...(m.meeting_link ? [{ k: "Link", v: <a href={m.meeting_link} target="_blank" rel="noopener noreferrer">Abrir o link</a> }] : []),
    ],
    texto: m.notes || null,
  }));
  // closed_at não "anda" com edições posteriores (updated_at andava)
  if (lead.status === "ganho") linha.push({ id: "ganho", tipo: "sistema", ts: lead.closed_at ?? lead.updated_at, titulo: "Lead GANHO",
    linhas: lead.closed_value != null ? [{ k: "Valor fechado", v: lead.closed_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }] : [] });
  if (lead.status === "perdido") linha.push({ id: "perdido", tipo: "sistema", ts: lead.closed_at ?? lead.updated_at, titulo: "Lead perdido", perigo: true,
    texto: lead.loss_reason?.label ? `Motivo: ${lead.loss_reason.label}` : null });
  linha.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const contagem = (f: FiltroAtividade) => linha.filter((i) => passaNoFiltro(f, i.tipo)).length;

  // ── "Mais ações": tudo o que a ficha antiga tinha em botões soltos ──
  const itensMais: ItemDoMenu[] = [
    ...(papel === "closer" ? [
      { rotulo: "Agendar reunião", onClick: () => setShowMeetingModal(true) },
      { rotulo: "Enviar para Closer", onClick: () => setShowHandoverModal(true), dica: "Passa o lead para outro closer (handover)" },
    ] : []),
    ...(reunioesAbertas[0] ? [{ rotulo: "Lançar desfecho da reunião", onClick: () => setReuniaoAberta(reunioesAbertas[0]) }] : []),
    ...(podeOportunidade ? [{ rotulo: "Oportunidade futura", onClick: () => setMostrarOportunidade(true) }] : []),
    ...(!isClosed ? [
      { rotulo: "Marcar como perdido", onClick: () => { setSelectedLossReason(""); setMostrarPerdido(true); } },
      // SDR: o "Ganho" de status do lead (com valor fechado). O closer ganha pela tela de venda.
      ...(papel === "sdr" ? [{ rotulo: "Marcar como ganho", onClick: openWonModal }] : []),
    ] : [{ rotulo: reactivating ? "Reativando…" : "↩ Reativar lead", onClick: () => void reativarLead(), disabled: reactivating }]),
    ...(podeCotarAereo && !cotandoAgora ? [{
      rotulo: "Cotando aéreo", onClick: () => void iniciarCotacaoAereo(lead.id),
      dica: "Marque quando começar a cotar um aéreo pra este cliente. O tempo entra no seu Desempenho.",
    }] : []),
    { rotulo: "Pedir a outro setor", onClick: () => setPedirSetor(true), dica: "Vira um pedido com dono e prazo na fila do outro setor; você acompanha aqui" },
    { rotulo: "Enviar ao financeiro", onClick: () => setEnviarFin(true), dica: "O Financeiro fala com o cliente pelo WhatsApp e resolve a dúvida; você acompanha o status aqui" },
    ...(papel === "sdr" ? [{ rotulo: "Pedir pagamento", onClick: () => setPedirPagamento(true), dica: "Pix pra fornecedor, link de pagamento pro cliente, cartão da empresa ou provisão — já amarrado a este lead" }] : []),
    { separador: true },
    { rotulo: "Editar dados", onClick: openEditModal },
    ...(lead.cadence_id ? [{ rotulo: removingCadence ? "Removendo…" : "Remover da cadência", onClick: () => void removeFromCadence(), disabled: removingCadence }] : []),
    ...(lead.bitrix_id ? [{ rotulo: bitrixCopied ? "ID copiado ✓" : `Copiar ID do Bitrix (${lead.bitrix_id})`, onClick: () => void copiarIdBitrix() }] : []),
    ...(canDeleteLead ? [
      { separador: true } as ItemDoMenu,
      { rotulo: deletingLead ? "Excluindo…" : "Excluir lead", onClick: () => void handleDeleteLead(), disabled: deletingLead, perigo: true,
        dica: "Excluir o lead e todo o histórico (irreversível)" },
    ] : []),
  ];

  async function copiarIdBitrix() {
    if (!lead?.bitrix_id) return;
    try {
      await navigator.clipboard.writeText(lead.bitrix_id);
      // Feedback visual (Sprint 4): antes o clique não dava sinal nenhum.
      setBitrixCopied(true);
      setTimeout(() => setBitrixCopied(false), 1500);
    } catch {
      notifyError("Não foi possível copiar o ID — copie manualmente.");
    }
  }

  // ── Um item da linha do tempo ──
  function renderItem(i: ItemDaLinha, ultimo: boolean) {
    const n = i.nota;
    // A RLS (0007: notes_update/delete) só aceita autor ou gestor — o menu segue a mesma regra.
    const podeMexerNaNota = !!n && !!currentUser && (canSeeAllData(currentUser.role) || n.author_id === currentUser.id);
    const editando = !!n && editingNoteId === n.id;
    const m = i.reuniao;
    const ponto = i.perigo ? "perigo" : i.tipo;
    return (
      <li key={i.id}>
        <div className="fl-tempo__eixo">
          <div className={`fl-tempo__ponto fl-tempo__ponto--${ponto}`}>
            {i.tipo === "reuniao" ? <IcCalendario /> : i.tipo === "ligacao" ? <IcTelefone size={16} /> : i.tipo === "nota" ? <IcNota /> : i.tipo === "tarefa" ? <IcCheck /> : <IcRaio />}
          </div>
          {!ultimo && <div className="fl-tempo__fio" />}
        </div>
        <div className="fl-tempo__corpo">
          <div className="fl-tempo__titulo" style={{ justifyContent: "space-between" }}>
            <div className="fl-tempo__titulo">
              <strong>{i.titulo}</strong>
              <span>{quandoCurto(i.ts, agora)}{i.por ? ` · ${i.por}` : ""}</span>
            </div>
            {podeMexerNaNota && !editando && (
              <MenuDaFicha botao={<IcPontos />} rotuloAcessivel="Ações da anotação" classeBotao="fl-btn fl-btn--icone fl-btn--sm"
                itens={[
                  { rotulo: "Editar", onClick: () => startEditNote(n!) },
                  { rotulo: "Excluir", onClick: () => void handleDeleteNote(n!), perigo: true },
                ]} />
            )}
          </div>
          {editando ? (
            <div className="fl-nota">
              <textarea value={editingNoteBody} onChange={(e) => setEditingNoteBody(e.target.value)} rows={3} aria-label="Editar anotação" />
              <div className="fl-modal__rodape">
                <button type="button" className="fl-btn fl-btn--sm" onClick={() => { setEditingNoteId(null); setEditingNoteBody(""); }}>Cancelar</button>
                <button type="button" className="fl-btn fl-btn--sm fl-btn--acao" onClick={saveNoteEdit} disabled={!editingNoteBody.trim() || savingNoteEdit}>
                  {savingNoteEdit ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          ) : i.texto ? <p className="fl-tempo__texto">{i.texto}</p> : null}
          {i.linhas && i.linhas.length > 0 && (
            <dl className="fl-quadro" style={{ margin: 0 }}>
              {i.linhas.map((r) => (<div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>))}
            </dl>
          )}
          {m && reuniaoEstaAberta(m) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* DESFECHO SÓ PELO MODAL OFICIAL (25/09): SAL, valor, Bitrix e a agenda do closer. */}
              <button type="button" className="fl-btn fl-btn--sm" onClick={() => setReuniaoAberta(m)}>Lançar desfecho / remarcar</button>
              <button type="button" className="fl-btn fl-btn--sm" onClick={() => setAba("reuniao")}>Ver detalhes</button>
            </div>
          )}
        </div>
      </li>
    );
  }

  // ── A coluna "Atividade" ──
  function renderAtividade(lead: Lead) {
    if (aba === "prospeccao") return renderProspeccao(lead);
    if (aba === "cadastro") return <CadastroDoLead leadId={lead.id} />;
    if (aba === "venda") return <ComCoresDoRel><VendaDoCliente leadId={lead.id} /></ComCoresDoRel>;
    const filtro = aba;
    const visiveis = linha.filter((i) => passaNoFiltro(filtro, i.tipo));
    return (
      <>
        <div className="fl-nota">
          <label htmlFor="fl-nova-nota">Nova anotação</label>
          <textarea id="fl-nova-nota" rows={2} value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="O que aconteceu na conversa?" />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="fl-btn fl-btn--sm fl-btn--acao" onClick={addNote} disabled={!newNote.trim() || savingNote}>
              {savingNote ? "Salvando..." : "Salvar nota"}
            </button>
          </div>
        </div>

        {/* Áudio das ligações do webfone (0233), antes da lista de tentativas. */}
        {filtro === "ligacao" && <LigacoesDoLead leadId={lead.id} />}
        {/* Reuniões: os cartões completos (convidados, desfecho, gravação — 0215). */}
        {filtro === "reuniao" ? renderReunioesCompletas() : visiveis.length === 0 ? (
          filtro === "ligacao" ? null : <div className="fl-vazio">{textoDeVazio(filtro)}</div>
        ) : (
          <>
            {filtro === "ligacao" && <span className="fl-rotulo">Tentativas registradas</span>}
            <ol className="fl-tempo">{visiveis.map((i, k) => renderItem(i, k === visiveis.length - 1))}</ol>
          </>
        )}
      </>
    );
  }

  // ── Faixa "Próximo passo" ──
  function renderProximoPasso() {
    let titulo = "Nenhum próximo passo marcado";
    let quando: string = isClosed ? `Lead ${lead!.status === "ganho" ? "ganho" : "perdido"}.` : "Agende uma reunião ou crie a atividade na Fila de hoje.";
    let botoes: React.ReactNode = !isClosed && (
      <button type="button" className="fl-btn fl-btn--acao" onClick={() => setShowMeetingModal(true)}>Agendar reunião</button>
    );
    if (proximo?.tipo === "reuniao") {
      const m = proximo.reuniao;
      titulo = m.title || (m.tipo === "retomada" ? "Reunião de retomada" : "Reunião com o cliente");
      const com = m.closer?.name ?? m.meeting_owner;
      quando = `${quandoPorExtenso(m.scheduled_at)} · ${dataRelativa(m.scheduled_at, agora)}${com ? ` · com ${com}` : ""}`;
      botoes = (
        <>
          <button type="button" className="fl-btn fl-btn--contorno" onClick={() => setReuniaoRemarcar(m)}>Reagendar</button>
          {papel === "closer" ? (
            <>
              <button type="button" className={`fl-btn ${m.meeting_link ? "fl-btn--contorno" : "fl-btn--acao"}`} onClick={() => setReuniaoAberta(m)}>Lançar desfecho</button>
              {m.meeting_link && (
                <a className="fl-btn fl-btn--acao" href={m.meeting_link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Entrar no Meet</a>
              )}
            </>
          ) : (
            <button type="button" className="fl-btn fl-btn--acao" onClick={() => setReuniaoAberta(m)}>Concluir atividade</button>
          )}
        </>
      );
    } else if (proximo?.tipo === "tarefa") {
      const t = proximo.tarefa;
      const atrasada = new Date(t.scheduled_at).getTime() < agora.getTime() && !mesmoDiaLocal(t.scheduled_at);
      titulo = `${CHANNEL_LABELS[t.channel_type] ?? t.channel_type}${t.is_extra ? " (atividade extra)" : ""}`;
      if (t.notes) titulo += ` · ${t.notes.length > 70 ? t.notes.slice(0, 70) + "…" : t.notes}`;
      quando = `${quandoPorExtenso(t.scheduled_at)} · ${atrasada ? "atrasada, " : ""}${dataRelativa(t.scheduled_at, agora)}`;
      botoes = (
        <>
          <button type="button" className="fl-btn fl-btn--contorno" onClick={() => abrirReagendarTarefa(t)}>Reagendar</button>
          <button type="button" className="fl-btn fl-btn--acao" disabled={tarefaOcupada === t.id} onClick={() => void concluirTarefa(t)}>
            Concluir atividade
          </button>
        </>
      );
    }
    return (
      <section className="fl-faixa" aria-label="Próximo passo">
        <div className="fl-faixa__o-que">
          <div className="fl-faixa__icone">{proximo?.tipo === "tarefa" ? <IcRelogio /> : <IcCalendario size={22} />}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className="fl-faixa__rot">Próximo passo</span>
            <span className="fl-faixa__titulo">{titulo}</span>
            <span className="fl-faixa__quando">{quando}</span>
          </div>
        </div>
        {botoes && <div className="fl-faixa__botoes">{botoes}</div>}
      </section>
    );
  }

  function mesmoDiaLocal(iso: string) {
    const d = new Date(iso);
    return d.toDateString() === agora.toDateString();
  }

  // ── "Sobre o lead" (era a Visão Geral: status, responsável, dados do lead) ──
  function renderSobre(lead: Lead) {
    const linhas: [string, React.ReactNode][] = [
      ["Responsável", lead.owner?.name ?? "Não atribuído"],
      ["Origem", SOURCE_LABELS[lead.source] ?? lead.source],
      ...(lead.segment ? [["Fonte / Produto", lead.segment] as [string, React.ReactNode]] : []),
      ["Chegou em", lead.arrived_at ? formatDateTime(lead.arrived_at) : "—"],
      ["Temperatura", temperatura ? <span style={{ color: `var(--${TOM_DA_TEMPERATURA[temperatura.level]})` }}>{temperatura.label}</span> : "—"],
      ["Temperatura do SDR", temperaturaSdr ? <span style={{ color: `var(--${TOM_DA_TEMPERATURA[temperaturaSdr.level]})` }}>{temperaturaSdr.emoji} {temperaturaSdr.label}</span> : "—"],
      ["Status", STATUS_LABELS[lead.status] + (lead.status === "perdido" && lead.loss_reason?.label ? ` · ${lead.loss_reason.label}` : "")],
      ...(papel === "closer" && lead.cadence_id ? [["Cadência", cadence?.name ?? "—"] as [string, React.ReactNode]] : []),
      ...(lead.cadence_started_at ? [["Cadência desde", formatDate(lead.cadence_started_at)] as [string, React.ReactNode]] : []),
      ...((lead.city || lead.state) ? [["Cidade / UF", [lead.city, lead.state].filter(Boolean).join(" / ")] as [string, React.ReactNode]] : []),
      ...(lead.job_title ? [["Cargo", lead.job_title] as [string, React.ReactNode]] : []),
      ...(lead.company_name ? [["Empresa", lead.company_name] as [string, React.ReactNode]] : []),
      ...(lead.linkedin_url ? [["LinkedIn", lead.linkedin_url] as [string, React.ReactNode]] : []),
      ...(lead.estimated_value != null ? [["Valor estimado", lead.estimated_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })] as [string, React.ReactNode]] : []),
      ...(lead.closed_value != null ? [["Valor fechado", lead.closed_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })] as [string, React.ReactNode]] : []),
      ["Criado em", formatDate(lead.created_at)],
      ["Última atualização", formatDate(lead.updated_at)],
    ];
    return (
      <section className="fl-card" aria-label="Sobre o lead" style={{ gap: 10 }}>
        <h2 style={{ marginBottom: 4 }}>Sobre o lead</h2>
        {linhas.map(([k, v]) => <div key={k} className="fl-linha"><span>{k}</span><span>{v}</span></div>)}
        {lead.owner?.email && <p className="fl-mudo">{lead.owner.email}</p>}
        <button type="button" className="fl-btn fl-btn--link" onClick={openEditModal}>Editar dados</button>
      </section>
    );
  }


  // ── Próximas atividades (Sprint 4) ───────────────────────────────────────────
  // As tasks pendentes eram buscadas mas NUNCA exibidas — só as concluídas
  // apareciam. O selo "Atrasada" é DERIVADO da data (regra da casa: status
  // 'atrasada' nunca é gravado), por cima do que estiver no banco.
  function renderUpcomingTasksBox() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const openTasks = tasks
      .filter((t) => t.status === "pendente" || t.status === "atrasada")
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    if (openTasks.length === 0) return null;
    return (
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-[#0147FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h4 className="text-xs font-semibold text-blue-800">Próximas atividades ({openTasks.length})</h4>
        </div>
        <div className="space-y-2">
          {openTasks.map((t) => {
            const isLate = new Date(t.scheduled_at).getTime() < todayStart.getTime();
            return (
              <div key={t.id} className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-[#0147FF] flex items-center justify-center shrink-0">
                  {CHANNEL_ICONS[t.channel_type]}
                </span>
                <span className="text-sm font-medium text-gray-800">{CHANNEL_LABELS[t.channel_type]}</span>
                <span className="text-xs text-gray-400">{formatDateTime(t.scheduled_at)}</span>
                {t.is_extra && <span className="text-[10px] font-medium text-gray-400 uppercase">extra</span>}
                {isLate && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">
                    Atrasada
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }


  // ── Reuniões completas (chip "Reuniões"): o que foi coletado + desfecho ──
  function renderReunioesCompletas() {
        return (
          <div className="space-y-3">
            {meetings.map((meeting) => {
              const mColor = MEETING_COLORS[meeting.status] ?? MEETING_COLORS.agendada;
              return (
                <div key={meeting.id} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${mColor.bg} ${mColor.text}`}>
                        {MEETING_STATUS_LABELS[meeting.status]}
                      </span>
                      {meeting.title && (
                        <span className="text-sm font-semibold text-gray-900 truncate">{meeting.title}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">Criada em {formatDateTime(meeting.created_at)}</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm text-gray-700">
                        {formatDateTime(meeting.scheduled_at)}
                        {meeting.duration_min ? ` · ${meeting.duration_min} min` : ""}
                      </span>
                    </div>
                    {meeting.location && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-sm text-gray-700">{meeting.location}</span>
                      </div>
                    )}
                    {meeting.meeting_link && (
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m7.328-7.328a4 4 0 015.656 5.656l-1.5 1.5" />
                        </svg>
                        <a
                          href={meeting.meeting_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#0147FF] hover:underline truncate"
                          title="Abrir link da reunião"
                        >
                          {meeting.meeting_link}
                        </a>
                      </div>
                    )}
                    {meeting.notes && (
                      <p className="text-[12.5px] text-gray-500 whitespace-pre-wrap pt-1">{meeting.notes}</p>
                    )}
                    {/* Convidados, desfecho e gravação (28/10, 0215). */}
                    <DetalheDaReuniao m={meeting} onMudou={() => void reloadMeetings()} />
                  </div>

                  {/* DESFECHO SÓ PELO MODAL OFICIAL (25/09). Aqui havia Realizada/
                      No-show/Cancelar que gravavam o status cru: sem SAL, sem
                      valor, sem o envio único ao Bitrix, sem encerrar a atividade
                      de confirmação nem destravar a agenda do closer. */}
                  {(meeting.status === "agendada" || meeting.status === "confirmada") && (
                    <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => setReuniaoAberta(meeting)}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Lançar desfecho / remarcar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {meetings.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-400">Nenhuma reunião agendada.</p>
              </div>
            )}
          </div>
        );
  }

  // ── Prospecção (era aba): a cadência dia a dia + próximas e realizadas ──
  function renderProspeccao(lead: Lead) {
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Timeline de Prospecção</h3>
            <p className="text-xs text-gray-500 mb-6">
              Cadência: {cadence?.name ?? "\u2014"}
              {lead.cadence_started_at && ` | Início: ${formatDate(lead.cadence_started_at)}`}
            </p>

            {/* (As "Informações do formulário" moraram aqui até 2026-07-24 —
                agora vivem consolidadas no card "Dados do Lead" da Visão Geral.) */}

            {/* Próximas atividades (Sprint 4: pendentes/futuras, antes invisíveis) */}
            {(() => {
              const box = renderUpcomingTasksBox();
              return box ? <div className="mb-6">{box}</div> : null;
            })()}

            {/* Atividades realizadas (dados reais das tasks concluídas) */}
            {(() => {
              const doneTasks = tasks.filter((t) => t.status === "concluida");
              if (doneTasks.length === 0) return null;
              return (
                <div className="mb-6 rounded-lg border border-green-100 bg-green-50/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h4 className="text-xs font-semibold text-green-800">
                      Atividades realizadas ({doneTasks.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {doneTasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                          {CHANNEL_ICONS[t.channel_type]}
                        </span>
                        <span className="text-sm font-medium text-gray-800">{CHANNEL_LABELS[t.channel_type]}</span>
                        <span className="text-xs text-gray-400">
                          {formatDateTime(t.completed_at ?? t.scheduled_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {cadenceDays.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Nenhuma cadência vinculada.</p>
            )}

            <div className="relative">
              {/* Timeline line */}
              {cadenceDays.length > 0 && (
                <div className="absolute left-[19px] top-4 bottom-4 w-px bg-gray-200" />
              )}

              <div className="space-y-6">
                {cadenceDays.map((day) => {
                  const startDate = lead.cadence_started_at ? new Date(lead.cadence_started_at) : new Date();
                  const estimatedDate = new Date(startDate);
                  estimatedDate.setDate(estimatedDate.getDate() + day.day_number - 1);
                  const isPast = estimatedDate < new Date();

                  return (
                    <div key={day.id} className="relative flex gap-4">
                      {/* Day circle */}
                      <div
                        className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                          isPast
                            ? "bg-[#0147FF] border-[#0147FF] text-white"
                            : "bg-white border-gray-200 text-gray-500"
                        }`}
                      >
                        <span className="text-xs font-bold">D{day.day_number}</span>
                      </div>

                      {/* Day content */}
                      <div className="flex-1 pb-2">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-900">Dia {day.day_number}</h4>
                          <span className="text-xs text-gray-400">
                            {formatDate(estimatedDate.toISOString())}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {day.activities?.map((act) => (
                            <div
                              key={act.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border ${
                                isPast
                                  ? "bg-green-50/50 border-green-100"
                                  : "bg-[#F8F9FA] border-gray-100"
                              }`}
                            >
                              <div
                                className={`w-7 h-7 rounded-full flex items-center justify-center ${
                                  isPast
                                    ? "bg-green-100 text-green-600"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {CHANNEL_ICONS[act.channel_type]}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {CHANNEL_LABELS[act.channel_type]}
                                </p>
                                {act.scheduled_time && (
                                  <p className="text-xs text-gray-400">Horário: {act.scheduled_time}</p>
                                )}
                              </div>
                              {isPast && (
                                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const veAbaVenda = podeAbrirAreaCloser(currentUser);
  const chipsExtras: { id: AbaAtividade; rotulo: string }[] = [
    { id: "prospeccao", rotulo: "Prospecção" },
    { id: "cadastro", rotulo: "Cadastro" },
    ...(veAbaVenda ? [{ id: "venda" as AbaAtividade, rotulo: "Venda" }] : []),
  ];

  return (
    <div className="fl">
      <div className="fl__wrap">
      <button type="button" className="fl-voltar" onClick={onBack}><IcVoltar />Voltar para Leads</button>

      {/* Oportunidade futura em aberto: aparece ANTES de tudo, pra ninguém
          ligar no meio da espera que o cliente pediu. */}
      <div className="empty:hidden">
        <FaixaOportunidadeFutura
          leadId={lead.id}
          podeAgir={podeOportunidade}
          versao={versaoOportunidade}
          onMudou={() => { void fetchLead(); void reloadTasks(); }}
        />
      </div>
      {mostrarOportunidade && (
        <OportunidadeFuturaModal
          leadId={lead.id}
          leadName={lead.full_name || "Cliente"}
          onFechar={() => setMostrarOportunidade(false)}
          onSalvo={() => { setVersaoOportunidade((v) => v + 1); void reloadTasks(); void fecharReunioesDaOportunidade(); }}
        />
      )}

      {/* ── Cabeçalho ── */}
      <header className="fl-cab">
        <div className="fl-cab__quem">
          {/* Iniciais derivadas do full_name — first/last_name nunca chegam do Bitrix. */}
          <div className="fl-avatar" aria-hidden="true">{iniciaisDoNome(lead.full_name)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div className="fl-cab__nome">
              <h1>{nomeDoLead}</h1>
              {/* Temperatura EDITÁVEL (Sprint 4): o SDR classifica Quente/Morno/Frio aqui mesmo. */}
              <MenuDaFicha alinhar="esquerda" rotuloAcessivel="Temperatura do lead — clique para classificar"
                classeBotao={`fl-selo ${temperatura ? `fl-selo--${TOM_DA_TEMPERATURA[temperatura.level]}` : "fl-selo--tracejado"}`}
                botao={savingScore ? "..." : temperatura ? temperatura.label : "Classificar"}
                itens={[
                  ...TEMPERATURE_OPTIONS.map((opt) => ({ rotulo: opt.label, cor: opt.color, disabled: savingScore, onClick: () => void setTemperature(opt.label) })),
                  ...(lead.lead_score ? [{ separador: true } as ItemDoMenu, { rotulo: "Sem classificação", disabled: savingScore, onClick: () => void setTemperature(null) }] : []),
                ]} />
              {/* Temperatura do SDR (05/11): a segunda, dada por quem conversou. */}
              <MenuDaFicha alinhar="esquerda" rotuloAcessivel="Temperatura do SDR — clique para mudar"
                classeBotao={`fl-selo ${temperaturaSdr ? `fl-selo--${TOM_DA_TEMPERATURA[temperaturaSdr.level]}` : "fl-selo--tracejado"}`}
                botao={savingScore ? "..." : temperaturaSdr ? `SDR: ${temperaturaSdr.emoji} ${temperaturaSdr.label}` : "SDR: classificar"}
                itens={TEMPERATURAS.map((t) => ({ rotulo: chipDaTemperatura(t).label, cor: chipDaTemperatura(t).color, disabled: savingScore, onClick: () => void setTemperaturaSdr(t) }))} />
              <span className={`fl-selo${seloStatus.tom ? ` fl-selo--${seloStatus.tom}` : ""}`}>{seloStatus.texto}</span>
              {/* Card no Bitrix (12/11, 0362): pendência visível + "Tentar agora". */}
              <SeloCardBitrix lead={lead as LeadComCardBitrix} podeTentar={canView} onMudou={() => void fetchLead()} />
            </div>
            <div className="fl-cab__dados">
              {/* Cargo/empresa quando existem (raros no fluxo do Bitrix). */}
              {(lead.job_title || lead.company_name) && <span>{[lead.job_title, lead.company_name].filter(Boolean).join(" na ")}</span>}
              {lead.segment && <span title="Fonte / Produto">{lead.segment}</span>}
              {lead.phone && <span>{formatPhoneDisplay(lead.phone) || lead.phone}</span>}
              {lead.email && <span style={{ overflowWrap: "anywhere" }}>{lead.email}</span>}
              {lead.bitrix_id && (
                <button type="button" onClick={() => void copiarIdBitrix()} title="ID do cliente (Bitrix) — clique para copiar">
                  {bitrixCopied ? "Copiado ✓" : `ID ${lead.bitrix_id}`}
                </button>
              )}
            </div>
            <ComCoresDoRel>
              <div className="empty:hidden"><StatusNoFinanceiro alvo={{ leadId: lead.id }} recarregar={sinalFin} compacto /></div>
            </ComCoresDoRel>
            <ComCoresDaCentral>
              <div className="empty:hidden"><PedidosSobre alvo={{ leadId: lead.id }} recarregar={sinalPedidos} /></div>
            </ComCoresDaCentral>
            {/* Cotação de aéreo correndo: o cronômetro e o "Terminei" ficam à vista. */}
            {cotandoAgora && <div><CotandoAereo leadId={lead.id} /></div>}
          </div>
        </div>

        <div className="fl-cab__acoes">
          {lead.phone && (
            <button type="button" className="fl-btn fl-btn--icone" aria-label="Ligar" title="Ligar (webfone)" onClick={() => void ligar()}>
              <IcTelefone />
            </button>
          )}
          <button type="button" className="fl-btn fl-btn--whats" onClick={() => setShowWhatsApp(true)} title="Abrir WhatsApp">
            <IcWhats />WhatsApp
          </button>
          {papel === "sdr" ? (
            <>
              <button type="button" className="fl-btn" onClick={() => setShowMeetingModal(true)}>Agendar reunião</button>
              <button type="button" className="fl-btn fl-btn--acao" onClick={() => setShowHandoverModal(true)}>Enviar para Closer</button>
            </>
          ) : (
            <>
              <button type="button" className="fl-btn" onClick={() => setPedirPagamento(true)}
                title="Pix pra fornecedor, link de pagamento pro cliente, cartão da empresa ou provisão — já amarrado a este lead">
                Pedir pagamento
              </button>
              {veVenda && (
                <button type="button" className="fl-btn fl-btn--acao" onClick={abrirSubirVenda} disabled={venda.carregando}
                  title="Abre a tela de venda (itens, valores e a proposta anexada)">
                  Marcar como ganho
                </button>
              )}
            </>
          )}
          <MenuDaFicha itens={itensMais} rotuloAcessivel="Mais ações" botao={<>Mais ações<IcSeta /></>} />
        </div>
      </header>

      {avisoVenda && (
        <div className={`fl-card`} role="status" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "12px 16px",
          borderColor: avisoVenda.tom === "ok" ? "var(--ok)" : "var(--warn)" }}>
          <span style={{ flex: 1, minWidth: 0, color: avisoVenda.tom === "ok" ? "var(--ok)" : "var(--warn)", fontWeight: 600 }}>{avisoVenda.mensagem}</span>
          <button type="button" className="fl-btn fl-btn--sm" onClick={() => setAvisoVenda(null)}>Fechar</button>
        </div>
      )}

      {/* ── Próximo passo ── */}
      {renderProximoPasso()}

      <div className="fl-colunas">
        {/* ── Coluna esquerda ── */}
        <aside className="fl-lado">
          {papel === "closer" ? (
            <>
              <PassagemDoSdr leadId={lead.id} interesse={lead.segment}
                agendadoPor={[...meetings].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.scheduled_by ?? null} />
              {veVenda && (
                <VendaResumo venda={venda} reuniaoRealizada={reuniaoRealizada} pacoteDoLead={lead.segment} onAbrirVenda={() => setAba("venda")} />
              )}
            </>
          ) : (
            <CadenciaSdr
              cadence={cadence}
              cadenceDays={cadenceDays}
              iniciadaEm={lead.cadence_started_at}
              tasks={tasks}
              ocupadoId={tarefaOcupada}
              temCadencia={!!lead.cadence_id}
              removendo={removingCadence}
              onRemover={() => void removeFromCadence()}
              onVerCompleta={() => setAba("prospeccao")}
              onMarcar={(t) => { if (t.status === "concluida") void desfazerTarefa(t); else void concluirTarefa(t); }}
            />
          )}
          {renderSobre(lead)}
          {/* As respostas do formulário da LP (14/09) — no closer já entram na Passagem do SDR. */}
          {papel === "sdr" && <RespostasDoFormulario leadId={lead.id} variante="coluna" />}
        </aside>

        {/* ── Coluna principal: Atividade ── */}
        <main className="fl-principal fl-card" style={{ gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
            <h2>Atividade</h2>
            <div className="fl-chips" role="tablist" aria-label="Filtrar a atividade">
              {CHIPS_FILTRO.map((c) => {
                const n = c.id === "tudo" ? 0 : contagem(c.id);
                return (
                  <button key={c.id} type="button" role="tab" aria-selected={aba === c.id}
                    className={`fl-chip${aba === c.id ? " fl-chip--on" : ""}`} onClick={() => setAba(c.id)}>
                    {c.rotulo}{n > 0 && <span className="fl-chip__n">{n}</span>}
                  </button>
                );
              })}
              <span className="fl-chips__sep" aria-hidden="true" />
              {chipsExtras.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={aba === c.id}
                  className={`fl-chip${aba === c.id ? " fl-chip--on" : ""}`} onClick={() => setAba(c.id)}>
                  {c.rotulo}
                </button>
              ))}
            </div>
          </div>
          {renderAtividade(lead)}
        </main>
      </div>
      </div>

      {/* "Marcar como ganho" do closer: a tela ÚNICA de venda (proposta anexada obrigatória). */}
      {subirVendaAberto && venda.negocio && (
        <Suspense fallback={null}>
          <ComCoresDoRel>
            <SubirVenda origem="closer" negocio={venda.negocio} aberto={subirVendaAberto}
              onFechar={() => setSubirVendaAberto(false)}
              onSalvo={(r) => { setSubirVendaAberto(false); setAvisoVenda(r); venda.recarregar(); void fetchLead(); }} />
          </ComCoresDoRel>
        </Suspense>
      )}

      {/* Marcar como perdido (era um <select> vermelho no cabeçalho). */}
      {mostrarPerdido && (
        <div className="fl-modal-fundo" role="dialog" aria-modal="true" aria-labelledby="fl-perdido-t" onClick={() => setMostrarPerdido(false)}>
          <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="fl-perdido-t">Marcar {nomeDoLead} como perdido</h2>
            <p className="fl-mudo">O lead sai da fila, as atividades abertas são encerradas e o negócio vai pra coluna de Perdido no Bitrix.</p>
            <label className="fl-rotulo" htmlFor="fl-motivo">Motivo</label>
            <select id="fl-motivo" className="fl-campo fl-campo--caixa" value={selectedLossReason} onChange={(e) => setSelectedLossReason(e.target.value)}>
              <option value="">Sem motivo</option>
              {lossReasons.map((lr) => <option key={lr.id} value={lr.id}>{lr.label}</option>)}
            </select>
            <div className="fl-modal__rodape">
              <button type="button" className="fl-btn" onClick={() => setMostrarPerdido(false)}>Cancelar</button>
              <button type="button" className="fl-btn" style={{ background: "var(--danger)", borderColor: "var(--danger)", color: "#FFFFFF" }}
                onClick={() => { setMostrarPerdido(false); void markAsLost(selectedLossReason || undefined, true); }}>
                Confirmar perdido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reagendar a atividade do "Próximo passo". */}
      {tarefaReagendar && (
        <div className="fl-modal-fundo" role="dialog" aria-modal="true" aria-labelledby="fl-reag-t" onClick={() => setTarefaReagendar(null)}>
          <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="fl-reag-t">Reagendar {CHANNEL_LABELS[tarefaReagendar.channel_type]?.toLowerCase() ?? "atividade"}</h2>
            <p className="fl-mudo">Hoje: {quandoPorExtenso(tarefaReagendar.scheduled_at)}. Se cair fora do horário de trabalho, o QS encaixa no próximo horário livre.</p>
            <label className="fl-rotulo" htmlFor="fl-reag-data">Nova data e hora</label>
            <input id="fl-reag-data" type="datetime-local" className="fl-campo fl-campo--caixa" value={novaDataTarefa} onChange={(e) => setNovaDataTarefa(e.target.value)} />
            <div className="fl-modal__rodape">
              <button type="button" className="fl-btn" onClick={() => setTarefaReagendar(null)}>Cancelar</button>
              <button type="button" className="fl-btn fl-btn--acao" disabled={!novaDataTarefa || salvandoReagendar} onClick={() => void salvarReagendarTarefa()}>
                {salvandoReagendar ? "Salvando..." : "Reagendar"}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Success Toast */}
      {handoverSuccess && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl bg-green-600 text-white shadow-lg animate-pulse">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm font-semibold">Handover realizado com sucesso!</span>
        </div>
      )}

      {/* Re-engagement Modal (Change 16) */}
      {showReEngagement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-4 md:p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Agendar Re-contato</h2>
            <p className="text-sm text-gray-500 mb-6">
              Este lead foi perdido por um motivo que pode ser temporário. Deseja agendar um re-contato futuro?
            </p>
            {reEngagementScheduled ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-green-700">Re-contato agendado!</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {/* disabled durante a gravação (Sprint 4): dois toques criavam DUAS tarefas */}
                {[30, 60, 90].map((days) => (
                  <button
                    key={days}
                    onClick={() => scheduleReEngagement(days)}
                    disabled={schedulingReContact}
                    className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#0147FF] hover:bg-[#0147FF]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {days} dias
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowReEngagement(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Pular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Handover Modal */}
      {showHandoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#2563EB]/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Handover SDR → Closer</h2>
                  <p className="text-xs text-gray-500">Transferir lead para o especialista de vendas</p>
                </div>
              </div>
              <button
                onClick={() => setShowHandoverModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Lead Summary */}
              <div className="bg-[#F8F9FA] rounded-xl p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Resumo do Lead</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Nome</span>
                    <p className="text-sm font-semibold text-gray-900">{lead.full_name}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Empresa</span>
                    <p className="text-sm font-semibold text-gray-900">{lead.company_name || "--"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Canal de Origem</span>
                    <p className="text-sm text-gray-700">{SOURCE_LABELS[lead.source]}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Segmento</span>
                    <p className="text-sm text-gray-700">{lead.segment || "--"}</p>
                  </div>
                </div>
              </div>

              {/* Histórico de contatos */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Histórico de Contatos</h3>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {cadenceDays.slice(0, 3).map((day) => (
                    <div key={day.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F8F9FA]">
                      <div className="w-6 h-6 rounded-full bg-[#0147FF]/10 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-[#0147FF]">D{day.day_number}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {day.activities?.map((act) => (
                          <span
                            key={act.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] text-gray-600"
                          >
                            {CHANNEL_ICONS[act.channel_type]}
                            {CHANNEL_LABELS[act.channel_type]}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {cadenceDays.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhuma cadência vinculada.</p>
                  )}
                </div>
              </div>

              {/* Anotações do SDR */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Anotações do SDR</h3>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {notes.slice(0, 3).map((note) => (
                    <div key={note.id} className="p-2.5 rounded-lg bg-[#F8F9FA]">
                      <p className="text-xs text-gray-600 leading-relaxed">{note.body}</p>
                      <span className="text-[10px] text-gray-400 mt-1 block">{formatDateTime(note.created_at)}</span>
                    </div>
                  ))}
                  {notes.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhuma anotação registrada.</p>
                  )}
                </div>
              </div>

              {/* Closer Selection */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Selecionar Closer</h3>
                <select
                  value={selectedCloser}
                  onChange={(e) => setSelectedCloser(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                >
                  {closers.length === 0 && <option value="">Nenhum closer disponível</option>}
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} - Closer</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowHandoverModal(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleHandover}
                disabled={!selectedCloser || savingHandover}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {savingHandover ? "Enviando..." : "Confirmar Handover"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agendar reunião — modal único do QS (closer + horários livres) */}
      <MeetingDetailModal
        meeting={reuniaoAberta}
        onClose={() => setReuniaoAberta(null)}
        onChanged={() => { void reloadMeetings(); }}
        onReschedule={(m) => { setReuniaoAberta(null); setReuniaoRemarcar(m); }}
      />
      <ScheduleMeetingModal
        open={!!reuniaoRemarcar}
        reschedule={reuniaoRemarcar}
        onClose={() => setReuniaoRemarcar(null)}
        onSaved={() => { setReuniaoRemarcar(null); void reloadMeetings(); }}
      />

      <ScheduleMeetingModal
        open={showMeetingModal}
        onClose={() => setShowMeetingModal(false)}
        onSaved={() => { void afterMeetingSaved(); }}
        lead={lead}
      />

      {/* Editar Lead Modal (Sprint 4) */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Editar Lead</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                aria-label="Fechar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(
                [
                  { key: "full_name", label: "Nome completo *", type: "text", placeholder: "Nome do lead" },
                  { key: "phone", label: "Telefone", type: "text", placeholder: "(11) 99999-9999" },
                  { key: "email", label: "E-mail", type: "email", placeholder: "nome@empresa.com" },
                  { key: "company_name", label: "Empresa", type: "text", placeholder: "Nome da empresa" },
                  { key: "job_title", label: "Cargo", type: "text", placeholder: "Ex.: Diretor Comercial" },
                  { key: "department", label: "Departamento", type: "text", placeholder: "Ex.: Comercial" },
                  { key: "city", label: "Cidade", type: "text", placeholder: "Ex.: São Paulo" },
                  { key: "state", label: "Estado", type: "text", placeholder: "Ex.: SP" },
                  { key: "estimated_value", label: "Valor estimado (R$)", type: "text", placeholder: "Ex.: 1.500,00" },
                  { key: "company_linkedin", label: "LinkedIn da empresa", type: "text", placeholder: "linkedin.com/company/..." },
                  { key: "company_size", label: "Porte da empresa", type: "text", placeholder: "Ex.: 11-50 funcionários" },
                ] as { key: keyof LeadEditForm; label: string; type: string; placeholder: string }[]
              ).map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">{field.label}</label>
                  <input
                    type={field.type}
                    value={editForm[field.key] as string}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, [field.key]: e.target.value } : prev))}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Origem</label>
                <select
                  value={editForm.source}
                  onChange={(e) => setEditForm((prev) => (prev ? { ...prev, source: e.target.value as LeadSource } : prev))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                >
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {editError && (
              <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {editError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveLeadEdit}
                disabled={savingEdit}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingEdit ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ganho Modal (Sprint 4: pede o valor fechado — closed_value alimentava
          o dashboard com R$ 0 porque nunca era escrito) */}
      {showWonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-4 md:p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Marcar como GANHO</h2>
            <p className="text-sm text-gray-500 mb-4">
              {lead.full_name ?? "Este lead"} vai pra coluna de Ganho (aqui e no Bitrix) e as atividades abertas serão encerradas.
            </p>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Valor fechado (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={wonValue}
              onChange={(e) => setWonValue(e.target.value)}
              placeholder="Ex.: 1.500,00"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600/20 focus:border-green-600"
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Opcional, mas é ele que vira a receita ganha no dashboard — sem valor, o ganho conta como R$ 0.
            </p>
            {wonError && (
              <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {wonError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                onClick={() => setShowWonModal(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmWon}
                disabled={savingWon}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingWon ? "Salvando..." : "Confirmar GANHO"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ComCoresDaCentral>
        <NovaSolicitacao aberto={pedirSetor} deSetor="comercial" paraInicial="operacional"
          alvo={{ leadId: lead.id, sobre: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null }}
          onFechar={() => setPedirSetor(false)}
          onCriada={() => { setPedirSetor(false); setSinalPedidos((n) => n + 1); notifySuccess("Pedido enviado — acompanhe aqui no lead ou em Solicitações."); }} />
        <NovaSolicitacao aberto={pedirPagamento} deSetor="comercial" soPagamento
          alvo={{ leadId: lead.id, sobre: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null }}
          onFechar={() => setPedirPagamento(false)}
          onCriada={() => { setPedirPagamento(false); setSinalPedidos((n) => n + 1); notifySuccess("Pedido de pagamento enviado ao Financeiro — acompanhe aqui no lead."); }} />
      </ComCoresDaCentral>

      <ComCoresDoRel>
        <EnviarFinanceiroModal aberto={enviarFin} origem="comercial" alvo={{ leadId: lead.id, telefone: lead.phone }}
          nome={lead.full_name || null} onFechar={() => setEnviarFin(false)}
          onEnviado={() => { setEnviarFin(false); setSinalFin((n) => n + 1); notifySuccess("Enviado ao Financeiro."); }} />
      </ComCoresDoRel>

      {/* WhatsApp Modal (Task 3) */}
      <WhatsAppModal
        open={showWhatsApp}
        onClose={() => setShowWhatsApp(false)}
        lead={{
          id: lead.id,
          name: lead.full_name || `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
          phone: lead.phone,
        }}
        ownerId={currentUser?.id ?? null}
      />
    </div>
  );
}
