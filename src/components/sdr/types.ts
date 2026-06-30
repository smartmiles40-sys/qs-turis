// src/components/sdr/types.ts

export type UserRole = "admin" | "gestor" | "sdr" | "closer";
export type LeadStatus = "nao_iniciado" | "em_prospeccao" | "ganho" | "perdido";
export type LeadSource = "manual" | "api" | "integracao" | "importacao";
export type ChannelType = "pesquisa" | "email" | "ligacao" | "whatsapp" | "linkedin" | "instagram" | "tiktok" | "youtube";
export type PriorityLevel = "alta" | "media" | "baixa";
export type CadenceStatus = "rascunho" | "disponivel" | "congelada";
export type AcquisitionChannel = "levantada_de_mao" | "resgate" | "indicacao" | "outbound";
export type CadenceObjective = "dar_ganho" | "agendar_reuniao" | "redirecionar";
export type ExecutionMode = "manual" | "ia";
export type DistributionMode = "alternado" | "balanceado" | "desabilitado";
export type OffdayPolicy = "iniciar_imediato" | "aguardar_proximo_dia";
export type TaskStatus = "pendente" | "concluida" | "ignorada" | "atrasada";
export type GoalType = "ganhos" | "leads_finalizados" | "atividades" | "conversao";
export type GoalPeriod = "diario" | "mensal";
export type MeetingStatus = "agendada" | "realizada" | "no_show" | "cancelada";
export type CustomFieldScope = "pessoal" | "empresa" | "contato";

export interface SdrUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
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
}

export interface Meeting {
  id: string;
  lead_id: string;
  lead?: Lead;
  owner_id: string | null;
  scheduled_at: string;
  status: MeetingStatus;
  created_at: string;
}

export interface Contact {
  id: string;
  lead_id: string;
  type: string;
  value: string;
  is_primary: boolean;
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
  realizada: "Realizada",
  no_show: "No-show",
  cancelada: "Cancelada",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  manual: "Manual",
  api: "API",
  integracao: "Integração",
  importacao: "Importação",
};

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
