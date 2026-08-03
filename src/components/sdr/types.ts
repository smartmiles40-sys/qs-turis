// src/components/sdr/types.ts

export type UserRole = "admin" | "gestor" | "sdr" | "closer";
export type LeadStatus = "nao_iniciado" | "em_prospeccao" | "ganho" | "perdido";
export type LeadSource = "manual" | "api" | "integracao" | "importacao";
export type ChannelType = "pesquisa" | "email" | "ligacao" | "ligacao_whatsapp" | "whatsapp" | "linkedin" | "instagram" | "tiktok" | "youtube";
export type PriorityLevel = "alta" | "media" | "baixa";
export type CadenceStatus = "rascunho" | "disponivel" | "congelada";
export type AcquisitionChannel = "levantada_de_mao" | "resgate" | "indicacao" | "outbound";
export type CadenceObjective = "dar_ganho" | "agendar_reuniao" | "redirecionar";
export type ExecutionMode = "manual" | "ia";
export type DistributionMode = "alternado" | "balanceado" | "desabilitado";
export type OffdayPolicy = "iniciar_imediato" | "aguardar_proximo_dia";
export type TaskStatus = "pendente" | "concluida" | "ignorada" | "atrasada";
export type GoalType = "ganhos" | "leads_finalizados" | "atividades" | "conversao" | "reunioes";
export type GoalPeriod = "diario" | "mensal";
// "confirmada" e "reagendada" chegam junto com a integração do Bitrix e só são
// graváveis depois da migration 0028 (o CHECK antigo aceitava só os outros 4).
export type MeetingStatus = "agendada" | "confirmada" | "realizada" | "no_show" | "reagendada" | "cancelada";

/** Sales Accepted Lead: o especialista aceitou ou recusou o lead na reunião (0028). */
export type MeetingSal = "aceito" | "recusado";
export type CustomFieldScope = "pessoal" | "empresa" | "contato";

export interface SdrUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  whatsapp_number?: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  department: string | null;
  company_name: string | null;
  state: string | null;
  city: string | null;
  website: string | null;
  company_linkedin: string | null;
  company_size: string | null;
  segment: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  source: LeadSource;
  status: LeadStatus;
  location: string | null;
  owner_id: string | null;
  owner?: SdrUser;
  cadence_id: string | null;
  loss_reason_id: string | null;
  loss_reason?: LossReason;
  estimated_value: number | null;
  closed_value: number | null;
  cadence_started_at: string | null;
  arrived_at: string | null;        // horário que o lead chegou
  lead_score: string | null;        // temperatura vinda do Bitrix (rótulo cru: Quente/Morno/Frio). NULL = sem score
  bitrix_id: string | null;         // vínculo com o negócio no Bitrix (APLICAR-PENDENTES.sql)
  closed_at?: string | null;        // data REAL do ganho/perda (migration 0012; trigger na transição de status)
  created_at: string;
  updated_at: string;
}

export interface LossReason {
  id: string;
  label: string;
  is_predefined: boolean;
  is_archived: boolean;
}

export interface Note {
  id: string;
  lead_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface Task {
  id: string;
  lead_id: string;
  lead?: Lead;
  cadence_id: string | null;
  owner_id: string | null;
  owner?: SdrUser;
  channel_type: ChannelType;
  priority: PriorityLevel;
  scheduled_at: string;
  status: TaskStatus;
  is_extra: boolean;
  notes: string | null;
  tags?: string[] | null;
  completed_at: string | null;
  created_at: string;
}

export interface Cadence {
  id: string;
  name: string;
  description: string | null;
  acquisition_channel: AcquisitionChannel;
  objective: CadenceObjective;
  execution_mode: ExecutionMode;
  priority: PriorityLevel;
  status: CadenceStatus;
  execution_weekdays: number[];
  auto_loss_days: number | null;
  distribution_mode: DistributionMode;
  offday_policy: OffdayPolicy;
  redirect_cadence_id: string | null;
  created_at: string;
  days?: CadenceDay[];
  owners?: CadenceOwner[];
  _leads_count?: number;
  _active_leads_count?: number;
}

export interface CadenceOwner {
  cadence_id: string;
  user_id: string;
  rr_pointer: boolean;
  user?: SdrUser;
}

export interface CadenceDay {
  id: string;
  cadence_id: string;
  day_number: number;
  activities?: CadenceActivity[];
}

export interface CadenceActivity {
  id: string;
  cadence_day_id: string;
  channel_type: ChannelType;
  scheduled_time: string | null;
  order_index: number;
  /** Roteiro escrito pelo gestor (script do card / pré-preenche o WhatsApp). */
  script_text?: string | null;
}

export interface Meeting {
  id: string;
  lead_id: string;
  lead?: Lead;
  owner_id: string | null;
  owner?: SdrUser;
  /** Closer dono do horário (migration 0027). Antes era só `meeting_owner` em texto. */
  closer_id?: string | null;
  closer?: SdrUser;
  title: string | null;
  scheduled_at: string;
  /** Fim da reunião — mantido pelo banco (trigger 0027) a partir de duration_min. */
  ends_at?: string | null;
  duration_min: number | null;
  location: string | null;
  meeting_link: string | null;
  notes: string | null;
  status: MeetingStatus;
  /** Desfecho comercial da reunião (migration 0028). Nulo = ainda não avaliado. */
  sal?: MeetingSal | null;
  sal_at?: string | null;
  sal_by?: string | null;
  /** Nome do lead denormalizado: o join `lead:qs_leads(*)` volta nulo sob a RLS
   *  quando a reunião é de um lead de outro SDR, e o calendário é do time todo. */
  lead_name?: string | null;
  scheduled_by?: string | null;
  meeting_owner?: string | null;
  client_email?: string | null;
  created_at: string;
  updated_at?: string;
}

// ── Agenda dos closers (migration 0027) ──────────────────────────────────────

/** Janela recorrente de atendimento. Almoço = duas janelas no mesmo dia. */
export interface CloserAvailability {
  id: string;
  closer_id: string;
  weekday: number;    // 0 = Domingo … 6 = Sábado
  start_time: string; // "HH:MM:SS"
  end_time: string;
  created_at?: string;
}

/** Bloqueio pontual (férias, compromisso) — some da grade de slots livres. */
export interface CloserBlock {
  id: string;
  closer_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_by?: string | null;
  created_at?: string;
}

/** Parâmetros de agendamento do closer. */
export interface CloserConfig {
  closer_id: string;
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_per_day: number | null;
  is_bookable: boolean;
  color: string | null;
  default_link: string | null;
  updated_at?: string;
}

export interface WhatsAppMessage {
  id: string;
  lead_id: string | null;
  owner_id: string | null;
  phone: string | null;
  chat_id: string | null;
  body: string | null;
  direction: "out" | "in";
  kind: "message" | "call";
  status: "sent" | "failed" | "pending";
  error: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  lead_id: string;
  type: string; // phone | email | whatsapp | linkedin (schema 0001: type+value, sem nome/cargo)
  value: string;
  is_primary: boolean;
  created_at?: string;
}

export interface LeadCustomValue {
  lead_id: string;
  custom_field_id: string;
  value: string | null;
}

export interface CustomField {
  id: string;
  scope: CustomFieldScope;
  label: string;
  field_type: string;
  is_system: boolean;
  is_archived: boolean;
}

export interface Goal {
  id: string;
  owner_id: string | null;
  type: GoalType;
  period: GoalPeriod;
  target_value: number;
  period_start: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  pesquisa: "Pesquisa",
  email: "E-mail",
  ligacao: "Ligação",
  ligacao_whatsapp: "Ligação WhatsApp",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  label: string;
}

export const DEFAULT_CHANNEL_CONFIG: ChannelConfig[] = [
  { type: "pesquisa", enabled: true, label: "Pesquisa" },
  { type: "email", enabled: true, label: "E-mail" },
  { type: "ligacao", enabled: true, label: "Ligação" },
  { type: "ligacao_whatsapp", enabled: true, label: "Ligação WhatsApp" },
  { type: "whatsapp", enabled: true, label: "WhatsApp" },
  { type: "linkedin", enabled: true, label: "LinkedIn" },
  { type: "instagram", enabled: false, label: "Instagram" },
  { type: "tiktok", enabled: false, label: "TikTok" },
  { type: "youtube", enabled: false, label: "YouTube" },
];

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_prospeccao: "Em prospecção",
  ganho: "Ganho",
  perdido: "Perdido",
};

export const CADENCE_STATUS_LABELS: Record<CadenceStatus, string> = {
  rascunho: "Rascunho",
  disponivel: "Disponível",
  congelada: "Congelada",
};

export const ACQUISITION_LABELS: Record<AcquisitionChannel, string> = {
  levantada_de_mao: "Levantada de mão",
  resgate: "Resgate",
  indicacao: "Indicação",
  outbound: "Outbound",
};

export const OBJECTIVE_LABELS: Record<CadenceObjective, string> = {
  dar_ganho: "Dar ganho ao lead",
  agendar_reuniao: "Agendar reunião",
  redirecionar: "Redirecionar para outra cadência",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: "Pendente",
  concluida: "Concluída",
  ignorada: "Ignorada",
  atrasada: "Atrasada",
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  agendada: "Agendada",
  confirmada: "Confirmada",
  realizada: "Realizada",
  no_show: "No-show",
  reagendada: "Reagendada",
  cancelada: "Cancelada",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  manual: "Manual",
  api: "API",
  integracao: "Integração",
  importacao: "Importação",
};

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
