// src/components/sdr/cadences/CadenceCreatePage.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchQsUsers } from "@/lib/qs/queries";
import { fetchEnabledChannels } from "@/lib/qs/channels";
import { notifyError } from "@/lib/qs/notify";
import { peekDuplicateSource, clearDuplicateSource } from "./duplicateSource";
import type {
  ChannelType,
  AcquisitionChannel,
  CadenceObjective,
  CadenceStatus,
  PriorityLevel,
  ExecutionMode,
  DistributionMode,
  OffdayPolicy,
  SdrUser,
} from "../types";
import {
  CHANNEL_LABELS,
  ACQUISITION_LABELS,
  CADENCE_STATUS_LABELS,
  OBJECTIVE_LABELS,
  PRIORITY_LABELS,
  WEEKDAY_LABELS,
} from "../types";

// ── Props ───────────────────────────────────────────────────────────────────

interface CadenceCreatePageProps {
  cadenceId: string | null; // null = create, string = edit
  onBack: () => void;
}

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ChannelIcon({ type, size = 16 }: { type: ChannelType; size?: number }) {
  const s = size;
  switch (type) {
    case "pesquisa":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "email":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "ligacao":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "ligacao_whatsapp":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
          <path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case "instagram":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    case "tiktok":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
        </svg>
      );
    case "youtube":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-1.92 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33z" />
          <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

// ── Channel Colors ──────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<ChannelType, string> = {
  pesquisa: "#6366F1",
  email: "#0EA5E9",
  ligacao: "#F59E0B",
  ligacao_whatsapp: "#12A18A",
  whatsapp: "#22C55E",
  linkedin: "#0A66C2",
  instagram: "#E1306C",
  tiktok: "#010101",
  youtube: "#FF0000",
};

// Todos os canais aceitos pelo banco (CHECK das migrations 0001/0004) — inclui
// instagram/tiktok/youtube, que antes existiam no tipo mas não apareciam no builder.
const ALL_CHANNELS: ChannelType[] = ["pesquisa", "email", "ligacao", "ligacao_whatsapp", "whatsapp", "linkedin", "instagram", "tiktok", "youtube"];

// ── Step Definition ─────────────────────────────────────────────────────────

interface StepDef {
  id: number;
  label: string;
  sublabel: string;
}

const STEPS: StepDef[] = [
  { id: 1, label: "Informações Básicas", sublabel: "Nome e canal" },
  { id: 2, label: "Construção", sublabel: "Dias e atividades" },
  { id: 3, label: "Gestão de Entrada", sublabel: "Distribuição" },
  { id: 4, label: "Integrações", sublabel: "Conectores" },
];

// ── Períodos de execução (substituem o horário exato) ───────────────────────

// O período define a PRIORIDADE da atividade no FUP (pedido do Bruno):
//   Manhã = alta · Tarde = média · Dia todo = baixa ("não é importante").
// Sem coluna nova no banco: "Dia todo" grava scheduled_time = null; manhã/tarde
// gravam o horário. A prioridade da tarefa é derivada disso em createCadenceTasks.
const PERIODS = [
  { key: "manha", label: "Manhã", time: "09:00" as string | null, priority: "alta", hint: "Prioridade alta" },
  { key: "tarde", label: "Tarde", time: "12:30" as string | null, priority: "media", hint: "Prioridade média" },
  { key: "dia_todo", label: "Dia todo", time: null as string | null, priority: "baixa", hint: "Baixa prioridade (não é importante)" },
] as const;

const PRIORITY_LABEL: Record<string, string> = { alta: "alta", media: "média", baixa: "baixa" };

/** Deriva o período (manhã/tarde/dia todo) a partir do horário salvo. */
function periodOf(time: string | null): "manha" | "tarde" | "dia_todo" {
  if (!time) return "dia_todo";
  return time >= "12:30" ? "tarde" : "manha";
}

// ── ID generator ────────────────────────────────────────────────────────────

let _idCounter = 100;
function nextId(prefix: string) {
  return `${prefix}-${++_idCounter}`;
}

// ── Formulário padrão (criação). Na edição, os dados reais vêm do Supabase ──

function getDefaultForm(): FormState {
  return {
    execution_mode: "manual",
    objective: "agendar_reuniao",
    name: "",
    description: "",
    acquisition_channel: "levantada_de_mao",
    priority: "media",
    status: "rascunho",
    auto_loss_enabled: false,
    auto_loss_days: 14,
    redirect_cadence_id: "",
    days: [
      {
        id: nextId("day"),
        day_number: 1,
        activities: [
          { id: nextId("act"), cadence_day_id: "", channel_type: "whatsapp", scheduled_time: "09:00", order_index: 0, script_text: "" },
        ],
      },
    ],
    weekdays: [1, 2, 3, 4, 5],
    distribution_mode: "alternado",
    offday_policy: "aguardar_proximo_dia",
    owner_ids: [],
  };
}

// Converte a linha do Supabase (com days/activities/owners aninhados) pro form.
// Usada na EDIÇÃO e na DUPLICAÇÃO. freshIds: true = gera ids locais novos
// (duplicação — nenhum id da origem é reaproveitado; no salvamento em modo
// criação tudo vira INSERT novo de qualquer forma).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCadenceToForm(c: any, opts?: { freshIds?: boolean }): FormState {
  const fresh = opts?.freshIds === true;
  return {
    execution_mode: c.execution_mode ?? "manual",
    objective: c.objective ?? "agendar_reuniao",
    name: c.name ?? "",
    description: c.description ?? "",
    acquisition_channel: c.acquisition_channel ?? "levantada_de_mao",
    priority: c.priority ?? "media",
    status: c.status ?? "rascunho",
    auto_loss_enabled: c.auto_loss_days !== null && c.auto_loss_days !== undefined,
    auto_loss_days: c.auto_loss_days ?? 14,
    redirect_cadence_id: c.redirect_cadence_id ?? "",
    // Joins aninhados do Supabase não garantem ordem → ordena dias e atividades.
    days: (c.days ?? [])
      .slice()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort((a: any, b: any) => (a.day_number ?? 0) - (b.day_number ?? 0))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => {
        const dayId = fresh ? nextId("day") : d.id;
        return {
          id: dayId,
          day_number: d.day_number,
          activities: (d.activities ?? [])
            .slice()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((a: any) => ({
              id: fresh ? nextId("act") : a.id,
              cadence_day_id: dayId,
              channel_type: a.channel_type,
              scheduled_time: a.scheduled_time,
              order_index: a.order_index,
              script_text: a.script_text || "",
            })),
        };
      }),
    weekdays: c.execution_weekdays ?? [1, 2, 3, 4, 5],
    distribution_mode: c.distribution_mode ?? "alternado",
    offday_policy: c.offday_policy ?? "aguardar_proximo_dia",
    owner_ids: ((c.owners ?? []) as { user_id: string }[]).map((o) => o.user_id),
  };
}

// ── Form State ──────────────────────────────────────────────────────────────

interface FormDay {
  id: string;
  day_number: number;
  activities: FormActivity[];
}

interface FormActivity {
  id: string;
  cadence_day_id: string;
  channel_type: ChannelType;
  scheduled_time: string | null;
  order_index: number;
  script_text: string;
}

interface FormState {
  execution_mode: ExecutionMode;
  objective: CadenceObjective;
  name: string;
  description: string;
  acquisition_channel: AcquisitionChannel;
  priority: PriorityLevel;
  status: CadenceStatus;
  auto_loss_enabled: boolean;
  auto_loss_days: number;
  redirect_cadence_id: string; // ao terminar o plano sem desfecho, mover o lead pra esta cadência ("" = não redirecionar)
  days: FormDay[];
  weekdays: number[];
  distribution_mode: DistributionMode;
  offday_policy: OffdayPolicy;
  owner_ids: string[]; // SDRs que recebem os leads desta cadência (round-robin)
}

// ── Component ───────────────────────────────────────────────────────────────

export default function CadenceCreatePage({ cadenceId, onBack }: CadenceCreatePageProps) {
  const isEdit = cadenceId !== null;
  // DUPLICAÇÃO: em modo criação, o card "Duplicar" pode ter deixado a cadência
  // de origem no duplicateSource. LÊ com peek (não limpa) no inicializador — no
  // StrictMode o inicializador roda 2x e um "consume" limparia a origem pro mount
  // que fica, abrindo o builder em branco. A limpeza acontece uma vez no effect
  // abaixo, já com o valor capturado no estado.
  const [dupSourceId] = useState<string | null>(() => (cadenceId === null ? peekDuplicateSource() : null));
  useEffect(() => { if (dupSourceId) clearDuplicateSource(); }, [dupSourceId]);
  const [activeStep, setActiveStep] = useState(1);
  const [form, setForm] = useState<FormState>(getDefaultForm);
  const [loading, setLoading] = useState(isEdit || dupSourceId !== null);
  // Falha ao carregar a cadência na EDIÇÃO: com isso ligado, salvar é bloqueado.
  // Sem essa guarda, o editor abria com o form default vazio e o salvamento
  // apagava os dias/atividades REAIS da cadência, gravando um esqueleto por cima.
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sdrs, setSdrs] = useState<SdrUser[]>([]);
  // Outras cadências (pro seletor "redirecionar ao terminar o plano") COM status:
  // só as "disponíveis" podem ser escolhidas como destino novo (congelar bloqueia
  // vínculos novos), mas um destino já gravado que congelou continua listado —
  // rotulado — pra o select não "sumir" com o valor salvo.
  const [otherCadences, setOtherCadences] = useState<{ id: string; name: string; status: CadenceStatus }[]>([]);
  // Canais habilitados (Configurações → Canais de Contato). Só eles viram opção
  // de canal nas atividades da cadência — canal desligado some da escolha (mas o
  // já selecionado numa atividade continua visível, pra não sumir na edição).
  const [enabledChannels, setEnabledChannels] = useState<Set<ChannelType> | null>(null);
  useEffect(() => { fetchEnabledChannels().then(setEnabledChannels); }, []);

  // SDRs disponíveis para atribuir à cadência (só quem qualifica: sdr/closer).
  useEffect(() => {
    fetchQsUsers().then((all) => setSdrs(all.filter((u) => u.role === "sdr" || u.role === "closer")));
    supabase.from("qs_cadences").select("id, name, status").order("name").then(({ data }) => {
      setOtherCadences(
        ((data ?? []) as { id: string; name: string; status: CadenceStatus }[]).filter((c) => c.id !== cadenceId)
      );
    });
  }, [cadenceId]);

  // DUPLICAÇÃO: carrega a cadência de origem e pré-preenche o form como CÓPIA
  // ("Cópia de X", status rascunho, ids locais novos — nada aponta pra origem).
  // Se o fetch falhar, o builder abre em branco (avisando) — sem risco de
  // sobrescrever nada, porque em modo criação o salvamento é sempre INSERT.
  useEffect(() => {
    if (!dupSourceId) return;
    let cancelled = false;
    (async () => {
      const { data: cad, error } = await supabase
        .from("qs_cadences")
        .select("*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(user_id)")
        .eq("id", dupSourceId)
        .single();
      if (cancelled) return;
      if (error || !cad) {
        console.warn("Erro ao carregar cadência para duplicar:", error);
        notifyError("Não foi possível carregar a cadência de origem — o builder abriu em branco.");
        setLoading(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = cad as any;
      setForm({
        ...mapCadenceToForm(c, { freshIds: true }),
        name: `Cópia de ${c.name ?? "cadência"}`,
        status: "rascunho",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dupSourceId]);

  // Fetch existing cadence for edit mode. Extraído em useCallback pra tela de
  // erro poder "Tentar de novo" sem sair do editor.
  const loadCadence = useCallback(async () => {
    if (!cadenceId) return;
    setLoading(true);
    setLoadError(false);
    const { data: cad, error } = await supabase
      .from("qs_cadences")
      .select("*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(user_id)")
      .eq("id", cadenceId)
      .single();
    if (error || !cad) {
      // Sem os passos reais carregados, salvar sobrescreveria a cadência com um
      // esqueleto vazio — marca a falha e o resto da tela bloqueia o salvamento.
      console.warn("Erro ao buscar cadência para edição:", error);
      setLoadError(true);
      setLoading(false);
      return;
    }
    setForm(mapCadenceToForm(cad));
    setLoading(false);
  }, [cadenceId]);

  useEffect(() => {
    loadCadence();
  }, [loadCadence]);

  // Save cadence
  async function handleSave() {
    if (!form.name.trim()) return;

    // GUARDA (edição): se os passos reais NÃO carregaram, salvar apagaria a
    // estrutura da cadência e gravaria um esqueleto vazio por cima. Bloqueia.
    if (isEdit && loadError) {
      notifyError("Os dados da cadência não carregaram — salvar agora apagaria as atividades reais. Clique em \"Tentar de novo\" antes de salvar.");
      return;
    }

    // Cadência sem NENHUMA atividade gera 0 tarefas: o lead vinculado fica
    // invisível na fila de todo mundo. Bloqueia o salvamento.
    const totalActivities = form.days.reduce((sum, d) => sum + d.activities.length, 0);
    if (totalActivities === 0) {
      notifyError("A cadência precisa de pelo menos 1 atividade — adicione uma na etapa \"Construção\" antes de salvar.");
      setActiveStep(2);
      return;
    }

    // Dois "Dia 3" no plano viram duas linhas em qs_cadence_days e tarefas
    // duplicadas no mesmo dia — bloqueia até o número ficar único.
    if (duplicatedDayNumbers.size > 0) {
      const dias = Array.from(duplicatedDayNumbers).sort((a, b) => a - b).join(", ");
      notifyError(`Há mais de um cartão com o mesmo número de dia (Dia ${dias}) — cada "Dia N" deve aparecer uma única vez.`);
      setActiveStep(2);
      return;
    }

    // Objetivo "Redirecionar" sem destino é promessa vazia: o motor de fim de
    // cadência (cadenceSweep) age pelo redirect_cadence_id, não pelo rótulo.
    if (form.objective === "redirecionar" && !form.redirect_cadence_id) {
      notifyError('O objetivo é "Redirecionar", mas nenhuma cadência de destino foi escolhida — defina na etapa "Gestão de Entrada" → Fim da cadência.');
      setActiveStep(3);
      return;
    }

    setSaving(true);

    const cadencePayload = {
      name: form.name,
      description: form.description || null,
      acquisition_channel: form.acquisition_channel,
      objective: form.objective,
      execution_mode: form.execution_mode,
      priority: form.priority,
      status: form.status,
      execution_weekdays: form.weekdays,
      auto_loss_days: form.auto_loss_enabled ? form.auto_loss_days : null,
      redirect_cadence_id: form.redirect_cadence_id || null,
      distribution_mode: form.distribution_mode,
      offday_policy: form.offday_policy,
    };

    let savedCadenceId = cadenceId;

    if (isEdit && cadenceId) {
      // Update existing
      const { error } = await supabase.from("qs_cadences").update(cadencePayload).eq("id", cadenceId);
      if (error) { console.warn("Erro ao atualizar cadência:", error); notifyError("Não foi possível salvar a cadência — tente novamente."); setSaving(false); return; }

      // ⚠️ P1 conhecido (backlog 2026-07-13): esta edição é delete-tudo +
      // reinsere SEM transação — se um insert de dia/atividade falhar no meio,
      // a cadência fica com o plano parcial (a Sprint 3 já bloqueou o pior
      // caso: salvar por cima com fetch falho). O conserto definitivo é uma
      // RPC transacional no Postgres (função que recebe o plano inteiro em
      // JSON e regrava dias+atividades num BEGIN/COMMIT). Decidimos NÃO criar
      // migration nesta sprint (Sprint 4) — se falhar aqui, reabrir a cadência
      // e salvar de novo regrava o plano inteiro e conserta.
      // Delete old days (cascade should handle activities)
      await supabase.from("qs_cadence_days").delete().eq("cadence_id", cadenceId);
    } else {
      // Insert new
      const { data, error } = await supabase.from("qs_cadences").insert(cadencePayload).select("id").single();
      if (error || !data) { console.warn("Erro ao criar cadência:", error); notifyError("Não foi possível criar a cadência — tente novamente."); setSaving(false); return; }
      savedCadenceId = data.id;
    }

    // Insert days and activities
    for (const day of form.days) {
      const { data: dayData, error: dayErr } = await supabase
        .from("qs_cadence_days")
        .insert({ cadence_id: savedCadenceId, day_number: day.day_number })
        .select("id")
        .single();
      if (dayErr || !dayData) { console.warn("Erro ao criar dia:", dayErr); continue; }

      if (day.activities.length > 0) {
        const acts = day.activities.map((a, idx) => ({
          cadence_day_id: dayData.id,
          channel_type: a.channel_type,
          scheduled_time: a.scheduled_time,
          order_index: idx,
          script_text: a.script_text || null,
        }));
        const { error: actErr } = await supabase.from("qs_cadence_activities").insert(acts);
        if (actErr) console.warn("Erro ao criar atividades:", actErr);
      }
    }

    // Donos da cadência (quem recebe os leads no round-robin). Substitui o conjunto.
    if (savedCadenceId) {
      await supabase.from("qs_cadence_owners").delete().eq("cadence_id", savedCadenceId);
      if (form.owner_ids.length > 0) {
        const { error: ownErr } = await supabase.from("qs_cadence_owners").insert(
          form.owner_ids.map((userId) => ({ cadence_id: savedCadenceId, user_id: userId, rr_pointer: false }))
        );
        if (ownErr) { console.warn("Erro ao salvar os SDRs da cadência:", ownErr); notifyError("Cadência salva, mas os SDRs responsáveis NÃO foram gravados — reabra e tente de novo."); }
      }
    }

    setSaving(false);
    onBack();
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleWeekday(day: number) {
    setForm((prev) => {
      const has = prev.weekdays.includes(day);
      return {
        ...prev,
        weekdays: has ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day].sort(),
      };
    });
  }

  function addDay() {
    setForm((prev) => {
      const maxDay = prev.days.length > 0 ? Math.max(...prev.days.map((d) => d.day_number)) : 0;
      const newDay: FormDay = { id: nextId("day"), day_number: maxDay + 1, activities: [] };
      return { ...prev, days: [...prev.days, newDay] };
    });
  }

  function removeDay(dayId: string) {
    // Dia com atividades: confirma antes (apagar sem querer joga fora canais,
    // períodos e scripts já preenchidos).
    const day = form.days.find((d) => d.id === dayId);
    if (
      day &&
      day.activities.length > 0 &&
      !window.confirm(
        `Excluir o Dia ${day.day_number} com ${day.activities.length} atividade${day.activities.length > 1 ? "s" : ""}? Os canais e scripts deste dia serão perdidos.`
      )
    ) {
      return;
    }
    setForm((prev) => ({ ...prev, days: prev.days.filter((d) => d.id !== dayId) }));
  }

  function updateDayNumber(dayId: string, dayNumber: number) {
    setForm((prev) => ({ ...prev, days: prev.days.map((d) => (d.id === dayId ? { ...d, day_number: dayNumber } : d)) }));
  }

  function addActivity(dayId: string) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.map((d) => {
        if (d.id !== dayId) return d;
        const newAct: FormActivity = { id: nextId("act"), cadence_day_id: dayId, channel_type: "whatsapp", scheduled_time: "09:00", order_index: d.activities.length, script_text: "" };
        return { ...d, activities: [...d.activities, newAct] };
      }),
    }));
  }

  function removeActivity(dayId: string, actId: string) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.map((d) => {
        if (d.id !== dayId) return d;
        return { ...d, activities: d.activities.filter((a) => a.id !== actId) };
      }),
    }));
  }

  function updateActivity(dayId: string, actId: string, updates: Partial<FormActivity>) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.map((d) => {
        if (d.id !== dayId) return d;
        return { ...d, activities: d.activities.map((a) => (a.id === actId ? { ...a, ...updates } : a)) };
      }),
    }));
  }

  const cadenceDuration = form.days.length > 0 ? Math.max(...form.days.map((d) => d.day_number)) : 0;
  const isBuilderStep = STEPS[activeStep - 1]?.label === "Construção";

  // Dias com número repetido (dois "Dia 3"): alerta visual no builder e o
  // handleSave bloqueia até resolver.
  const dayNumberCounts = new Map<number, number>();
  form.days.forEach((d) => dayNumberCounts.set(d.day_number, (dayNumberCounts.get(d.day_number) ?? 0) + 1));
  const duplicatedDayNumbers = new Set(
    Array.from(dayNumberCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([n]) => n)
  );

  function renderStep() {
    switch (activeStep) {
      case 1: return renderStepBasicInfo();
      case 2: return renderStepBuilder();
      case 3: return renderStepEntryManagement();
      case 4: return renderStepIntegrations();
      default: return null;
    }
  }

  // ── Step: Informações Básicas ──
  function renderStepBasicInfo() {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Nome da Cadência</label>
          <input type="text" value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Ex: Levantada de Mao - Padrao INVT"
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-[#0147FF]/10 transition" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Descrição</label>
          <textarea value={form.description} onChange={(e) => updateForm("description", e.target.value)} placeholder="Descreva o propósito desta cadência..." rows={3}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-[#0147FF]/10 transition resize-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Canal de Aquisição</label>
          <select value={form.acquisition_channel} onChange={(e) => updateForm("acquisition_channel", e.target.value as AcquisitionChannel)}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] bg-white">
            {(Object.keys(ACQUISITION_LABELS) as AcquisitionChannel[]).map((ch) => (
              <option key={ch} value={ch}>{ACQUISITION_LABELS[ch]}</option>
            ))}
          </select>
        </div>
        {/* Objetivo: antes era exibido nos cards e no filtro, mas NUNCA era
            editável (todo mundo nascia "Agendar reunião") — auditoria FASE 3.
            "Redirecionar" exige a cadência de destino (validado no salvar). */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Objetivo</label>
          <select value={form.objective} onChange={(e) => updateForm("objective", e.target.value as CadenceObjective)}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] bg-white">
            {(Object.keys(OBJECTIVE_LABELS) as CadenceObjective[]).map((o) => (
              <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>
            ))}
          </select>
          {form.objective === "redirecionar" && (
            <p className="text-[11px] text-amber-600 mt-1.5">
              O redirecionamento só acontece com a cadência de destino definida na etapa "Gestão de Entrada" → Fim da cadência.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Prioridade</label>
          <div className="flex gap-3">
            {(Object.keys(PRIORITY_LABELS) as PriorityLevel[]).map((p) => {
              const colors: Record<PriorityLevel, { bg: string; border: string; text: string }> = {
                alta: { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B" },
                media: { bg: "#FFF7ED", border: "#FDBA74", text: "#9A3412" },
                baixa: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534" },
              };
              const c = colors[p];
              const selected = form.priority === p;
              return (
                <button key={p} onClick={() => updateForm("priority", p)}
                  className="flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all"
                  style={{ borderColor: selected ? c.border : "#E5E7EB", background: selected ? c.bg : "white", color: selected ? c.text : "#6B7280" }}>
                  {PRIORITY_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
          <select value={form.status} onChange={(e) => updateForm("status", e.target.value as CadenceStatus)}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#0147FF] bg-white">
            {(Object.keys(CADENCE_STATUS_LABELS) as CadenceStatus[]).map((s) => (
              <option key={s} value={s}>{CADENCE_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  // ── Step: Construção ──
  function renderStepBuilder() {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 rounded-full bg-[#0147FF]/10 border border-[#0147FF]/20">
              <span className="text-xs font-medium text-[#0147FF]">
                Tempo: {cadenceDuration} {cadenceDuration === 1 ? "dia" : "dias"}
              </span>
            </div>
            <span className="text-xs text-gray-500 font-medium">
              {form.days.reduce((sum, d) => sum + d.activities.length, 0)} atividades
            </span>
          </div>
        </div>

        {duplicatedDayNumbers.size > 0 && (
          <div className="px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
            Há mais de um cartão com o mesmo número de dia (
            {Array.from(duplicatedDayNumbers).sort((a, b) => a - b).map((n) => `Dia ${n}`).join(", ")}
            ) — ajuste os números antes de salvar: cada "Dia N" deve aparecer uma única vez.
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Dias de Execução</label>
          <div className="flex gap-2">
            {WEEKDAY_LABELS.map((label, idx) => {
              const active = form.weekdays.includes(idx);
              return (
                <button key={idx} onClick={() => toggleWeekday(idx)}
                  className={`w-10 h-10 rounded-lg text-xs font-bold transition-all border-2 ${
                    active ? "border-[#0147FF] bg-[#0147FF] text-white" : "border-gray-200 bg-white text-gray-400"
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dias lado a lado (colunas) — role na horizontal pra ver a cadência inteira */}
        <div className="flex gap-4 overflow-x-auto pb-3 items-start">
          {[...form.days].sort((a, b) => a.day_number - b.day_number).map((day) => (
            <div key={day.id} className="w-[300px] shrink-0 bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-[#F8F9FA] border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">Dia</span>
                  <input type="number" min={1} value={day.day_number} onChange={(e) => updateDayNumber(day.id, parseInt(e.target.value) || 1)}
                    title={duplicatedDayNumbers.has(day.day_number) ? "Número de dia repetido — ajuste antes de salvar" : undefined}
                    className={`w-14 px-2 py-1 rounded-lg border text-sm text-center font-bold focus:outline-none ${
                      duplicatedDayNumbers.has(day.day_number)
                        ? "border-red-400 bg-red-50 text-red-700 focus:border-red-500"
                        : "border-gray-200 focus:border-[#0147FF]"
                    }`} />
                </div>
                {form.days.length > 1 && (
                  <button onClick={() => removeDay(day.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                    <IconTrash />
                  </button>
                )}
              </div>
              <div className="p-3 space-y-3">
                {day.activities.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-3">Sem atividades ainda.</p>
                )}
                {day.activities.map((act) => (
                  <div key={act.id} className="space-y-2 p-3 rounded-lg bg-[#F8F9FA] border border-gray-100">
                    {/* Canal — só os habilitados (Configurações), + o já escolhido */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {ALL_CHANNELS.filter((ch) => !enabledChannels || enabledChannels.has(ch) || act.channel_type === ch).map((ch) => {
                        const selected = act.channel_type === ch;
                        return (
                          <button key={ch} onClick={() => updateActivity(day.id, act.id, { channel_type: ch })}
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: selected ? CHANNEL_COLORS[ch] + "18" : "transparent", color: selected ? CHANNEL_COLORS[ch] : "#9CA3AF", border: selected ? `1.5px solid ${CHANNEL_COLORS[ch]}40` : "1.5px solid transparent" }}
                            title={CHANNEL_LABELS[ch]}>
                            <ChannelIcon type={ch} size={14} />
                          </button>
                        );
                      })}
                    </div>
                    {/* Período = prioridade no FUP: Manhã (alta) / Tarde (média) / Dia todo (baixa) */}
                    <div className="flex items-center gap-1.5">
                      {PERIODS.map((p) => {
                        const selected = periodOf(act.scheduled_time) === p.key;
                        return (
                          <button key={p.key} onClick={() => updateActivity(day.id, act.id, { scheduled_time: p.time })}
                            title={p.hint}
                            className="flex-1 px-2 py-1 rounded-lg text-xs font-semibold border transition leading-tight"
                            style={selected
                              ? { background: "#0147FF", color: "#fff", borderColor: "#0147FF" }
                              : { background: "#fff", color: "#6B7280", borderColor: "#E5E7EB" }}>
                            {p.label}
                            <span className="block text-[9px] font-medium opacity-70">{PRIORITY_LABEL[p.priority]}</span>
                          </button>
                        );
                      })}
                      <button onClick={() => removeActivity(day.id, act.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <IconTrash />
                      </button>
                    </div>
                    {/* Script */}
                    <textarea
                      value={act.script_text || ""}
                      onChange={(e) => updateActivity(day.id, act.id, { script_text: e.target.value })}
                      placeholder="Script (opcional)..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-[#0147FF]/10 resize-none bg-white"
                    />
                  </div>
                ))}
                <button onClick={() => addActivity(day.id)} className="w-full inline-flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium text-[#0147FF] border border-dashed border-[#0147FF]/40 hover:bg-[#0147FF]/5 transition">
                  <IconPlus /> Atividade
                </button>
              </div>
            </div>
          ))}

          {/* Coluna "adicionar dia" */}
          <button onClick={addDay}
            className="w-[140px] shrink-0 self-stretch min-h-[160px] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-[#0147FF] hover:text-[#0147FF] hover:bg-[#0147FF]/5 transition-all">
            <IconPlus /> Dia
          </button>
        </div>
      </div>
    );
  }

  // ── Step 5: Gestão de Entrada ──
  function renderStepEntryManagement() {
    return (
      <div className="space-y-8">
        {/* SDRs responsáveis — quem recebe os leads DESTA cadência (round-robin) */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">SDRs responsáveis por esta cadência</label>
          <p className="text-xs text-gray-500 mb-3">
            Os leads que entrarem nesta cadência são divididos <b>igualmente entre os SDRs marcados</b> (rodízio). Se nenhum for marcado, caem na distribuição geral (o SDR com menos leads no momento).
          </p>
          {sdrs.length === 0 ? (
            <div className="p-4 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 text-[13px] text-amber-800">
              Nenhum SDR cadastrado ainda. Crie os SDRs em <b>Configurações → Usuários</b> pra poder atribuí-los aqui.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sdrs.map((u) => {
                const on = form.owner_ids.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => updateForm("owner_ids", on ? form.owner_ids.filter((id) => id !== u.id) : [...form.owner_ids, u.id])}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border-2 text-sm font-medium transition-all"
                    style={on
                      ? { borderColor: "#0147FF", background: "#0147FF", color: "#fff" }
                      : { borderColor: "#E5E7EB", background: "#fff", color: "#4B5563" }}
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                      style={{ background: on ? "rgba(255,255,255,.25)" : "#F3F4F6", color: on ? "#fff" : "#6B7280" }}>
                      {u.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                    </span>
                    {u.name}
                    {on && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {form.owner_ids.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">{form.owner_ids.length} SDR{form.owner_ids.length > 1 ? "s" : ""} no rodízio desta cadência.</p>
          )}
        </div>

        {/* HONESTIDADE (auditoria FASE 3): a escolha "alternado × balanceado" era
            decorativa — o trigger do banco (migration 0008) SEMPRE balanceia:
            rodízio por menor carga DENTRO da cadência, desempate pela carga
            global. Trocamos o seletor sem efeito por um cartão que descreve a
            regra real. O valor gravado em distribution_mode é preservado. */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Distribuição de Leads</label>
          <div className="p-4 rounded-xl border-2 border-gray-200 bg-white">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-bold text-gray-900">Automática (balanceada)</span>
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500">
                regra fixa do sistema
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Cada lead que entra vai pro SDR do rodízio desta cadência com <b>menos leads ativos nela</b> (desempate
              pela carga global do SDR). A regra roda no banco, na chegada do lead — não há outra opção por enquanto.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Política para Dias Sem Execução (Offday)</label>
          <div className="space-y-3">
            {(["iniciar_imediato", "aguardar_proximo_dia"] as OffdayPolicy[]).map((policy) => (
              <button key={policy} onClick={() => updateForm("offday_policy", policy)}
                className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                  form.offday_policy === policy ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"
                }`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  form.offday_policy === policy ? "border-[#0147FF]" : "border-gray-300"
                }`}>
                  {form.offday_policy === policy && <div className="w-2.5 h-2.5 rounded-full bg-[#0147FF]" />}
                </div>
                <div>
                  <span className="text-sm font-bold text-gray-900">
                    {policy === "iniciar_imediato" ? "Iniciar Imediatamente" : "Aguardar Próximo Dia Útil"}
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {policy === "iniciar_imediato"
                      ? "Inicia a cadência no dia da entrada, mesmo que não seja dia de execução."
                      : "Aguarda o próximo dia de execução configurado para iniciar a cadência."}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Fim da cadência: o que acontece quando o plano termina sem ganho/perdido.
            Sem isso o lead ficava "em prospecção" pra sempre, sem nenhuma tarefa. */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Fim da cadência</label>
          <p className="text-xs text-gray-500 mb-3">O que fazer com o lead que terminar todas as atividades sem virar ganho nem perdido.</p>

          <div className="space-y-3">
            <div className={`p-4 rounded-xl border-2 transition-all ${form.redirect_cadence_id ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
              <span className="text-sm font-bold text-gray-900 block mb-1">Redirecionar para outra cadência</span>
              <p className="text-xs text-gray-500 mb-2">Ao terminar o plano, o lead entra automaticamente na cadência escolhida (novas atividades são criadas).</p>
              {/* Só cadência DISPONÍVEL pode ser escolhida como destino novo
                  (congelada não recebe vínculo novo — mesma regra do
                  fetchAvailableCadences). Um destino JÁ GRAVADO que congelou
                  continua listado, rotulado, pro select não perder o valor. */}
              <select
                value={form.redirect_cadence_id}
                onChange={(e) => updateForm("redirect_cadence_id", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:border-[#0147FF]"
              >
                <option value="">Não redirecionar</option>
                {otherCadences
                  .filter((c) => c.status === "disponivel" || c.id === form.redirect_cadence_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.status !== "disponivel" ? ` (${CADENCE_STATUS_LABELS[c.status].toLowerCase()} — não recebe leads)` : ""}
                    </option>
                  ))}
              </select>
              {(() => {
                const sel = otherCadences.find((c) => c.id === form.redirect_cadence_id);
                if (!sel || sel.status === "disponivel") return null;
                return (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    A cadência de destino está {CADENCE_STATUS_LABELS[sel.status].toLowerCase()} — os leads que terminarem o plano vão <b>esperar</b> até ela ser retomada (não caem na perda automática).
                  </p>
                );
              })()}
            </div>

            <div className={`p-4 rounded-xl border-2 transition-all ${form.auto_loss_enabled ? "border-[#0147FF] bg-[#0147FF]/5" : "border-gray-200 bg-white"}`}>
              <button onClick={() => updateForm("auto_loss_enabled", !form.auto_loss_enabled)} className="flex items-center gap-3 text-left w-full">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${form.auto_loss_enabled ? "border-[#0147FF] bg-[#0147FF]" : "border-gray-300"}`}>
                  {form.auto_loss_enabled && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </div>
                <div>
                  <span className="text-sm font-bold text-gray-900">Perda automática</span>
                  <p className="text-xs text-gray-500 mt-0.5">Terminou o plano e passou dos dias abaixo sem desfecho → o lead vira perdido sozinho (e a perda vai pro Bitrix).</p>
                </div>
              </button>
              {form.auto_loss_enabled && (
                <div className="flex items-center gap-2 mt-3 pl-8">
                  <span className="text-xs text-gray-500">Perder após</span>
                  <input
                    type="number" min={1} max={365}
                    value={form.auto_loss_days}
                    onChange={(e) => updateForm("auto_loss_days", Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-center tabular-nums focus:outline-none focus:border-[#0147FF]"
                  />
                  <span className="text-xs text-gray-500">dias na cadência</span>
                </div>
              )}
            </div>

            {form.redirect_cadence_id && form.auto_loss_enabled && (
              <p className="text-[11.5px] text-gray-500">Com os dois ligados, o redirecionamento vence: o lead só vira perdido se a cadência de destino também esgotar (e ela tiver perda automática).</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step 6: Integrações ──
  function renderStepIntegrations() {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Integrações</h3>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          Em breve será possível conectar esta cadência com CRMs, plataformas de e-mail marketing, WhatsApp Business API e outras ferramentas.
        </p>
        <span className="mt-4 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-[#FFF7ED] text-[#9A3412]">
          Em desenvolvimento
        </span>
      </div>
    );
  }

  // ── Main Render ──
  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#F8F9FA] items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  // Edição com fetch falho: NUNCA mostra o editor vazio (salvar por cima
  // apagaria a cadência real). Só sai daqui recarregando com sucesso ou voltando.
  if (isEdit && loadError) {
    return (
      <div className="flex min-h-screen bg-[#F8F9FA] items-center justify-center px-4" style={{ fontFamily: "inherit" }}>
        <div className="bg-white border border-gray-100 rounded-xl p-8 max-w-md w-full text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Não foi possível carregar a cadência</h2>
          <p className="text-sm text-gray-500 mb-6">
            Os dias e atividades desta cadência não carregaram. Para proteger os dados, a edição fica bloqueada — salvar agora apagaria a estrutura real da cadência.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Voltar
            </button>
            <button
              onClick={loadCadence}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] transition"
            >
              Tentar de novo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#F8F9FA]" style={{ fontFamily: "inherit" }}>
      {/* ── Step Sidebar ──────────────────────────────────────────────── */}
      <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-100 bg-white md:min-h-screen">
        <div className="p-4 md:p-6">
          <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition mb-6">
            <IconBack /> Voltar
          </button>
          <h2 className="text-lg font-bold text-gray-900 mb-1">{isEdit ? "Editar Cadência" : "Criar Cadência"}</h2>
          <p className="text-xs text-gray-500 mb-8">Configure passo a passo</p>

          <nav className="flex flex-col gap-1">
            {STEPS.map((step) => {
              const isActive = activeStep === step.id;
              const isCompleted = activeStep > step.id;
              return (
                <button key={step.id} onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all relative ${
                    isActive ? "bg-[#0147FF]/5" : ""
                  }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                    isActive ? "bg-[#0147FF] text-white" : isCompleted ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {isCompleted ? <IconCheck /> : step.id}
                  </div>
                  <div className="min-w-0">
                    <span className={`block text-sm font-medium truncate ${isActive ? "text-[#0147FF]" : "text-gray-700"}`}>
                      {step.label}
                    </span>
                    <span className="block text-[11px] text-gray-400 truncate">{step.sublabel}</span>
                  </div>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-[#0147FF]" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center flex-wrap gap-y-3 justify-between px-4 md:px-8 py-5 bg-white border-b border-gray-100">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{isEdit ? "Editar Cadência" : "Criar Cadência"}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Etapa {activeStep} de {STEPS.length}: {STEPS[activeStep - 1].label}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {activeStep > 1 && (
              <button onClick={() => setActiveStep((s) => s - 1)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Anterior
              </button>
            )}
            {activeStep < STEPS.length ? (
              <button onClick={() => setActiveStep((s) => s + 1)}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] transition">
                Próximo
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-50 transition"
              >
                <IconCheck /> {saving ? "Salvando..." : "Salvar cadência"}
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 md:py-8">
          <div className={isBuilderStep ? "" : "max-w-2xl mx-auto"}>{renderStep()}</div>
        </div>
      </div>
    </div>
  );
}
