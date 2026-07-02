-- =============================================================================
-- QS Turis — Schema inicial (engenharia reversa a partir do código do app)
-- Gera todas as tabelas qs_* que o front espera. Rode isto no novo projeto
-- Supabase (SQL Editor) OU via `supabase db push`.
--
-- SEGURANÇA (leia docs/SUPABASE.md):
--   O modelo de auth atual é caseiro (tabela qs_users). Habilitamos RLS em todas
--   as tabelas, mas com política permissiva para a chave anônima, preservando o
--   comportamento atual do app (confiança em nível de aplicação). Para segurança
--   real por usuário, migrar para Supabase Auth + políticas por auth.uid().
-- =============================================================================

create extension if not exists pgcrypto;

-- Helper: mantém updated_at atualizado.
create or replace function qs_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ── Usuários ────────────────────────────────────────────────────────────────
create table if not exists qs_users (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null unique,
  password        text,  -- legado (autenticação agora é via Supabase Auth)
  role            text not null default 'sdr' check (role in ('admin','gestor','sdr','closer')),
  is_active       boolean not null default true,
  whatsapp_number text,  -- número que o SDR usa para atender no WhatsApp
  created_at      timestamptz not null default now()
);

-- ── Motivos de perda ────────────────────────────────────────────────────────
create table if not exists qs_loss_reasons (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  is_predefined boolean not null default false,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── Cadências ───────────────────────────────────────────────────────────────
create table if not exists qs_cadences (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  acquisition_channel text check (acquisition_channel in ('levantada_de_mao','resgate','indicacao','outbound')),
  objective           text check (objective in ('dar_ganho','agendar_reuniao','redirecionar')),
  execution_mode      text default 'manual' check (execution_mode in ('manual','ia')),
  priority            text default 'media' check (priority in ('alta','media','baixa')),
  status              text not null default 'rascunho' check (status in ('rascunho','disponivel','congelada')),
  execution_weekdays  int[] default '{1,2,3,4,5}',
  auto_loss_days      int,
  distribution_mode   text default 'desabilitado' check (distribution_mode in ('alternado','balanceado','desabilitado')),
  offday_policy       text default 'aguardar_proximo_dia' check (offday_policy in ('iniciar_imediato','aguardar_proximo_dia')),
  redirect_cadence_id uuid references qs_cadences(id) on delete set null,
  created_at          timestamptz not null default now()
);

create table if not exists qs_cadence_days (
  id         uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references qs_cadences(id) on delete cascade,
  day_number int not null
);

create table if not exists qs_cadence_activities (
  id              uuid primary key default gen_random_uuid(),
  cadence_day_id  uuid not null references qs_cadence_days(id) on delete cascade,
  channel_type    text not null check (channel_type in ('pesquisa','email','ligacao','whatsapp','linkedin','instagram','tiktok','youtube')),
  scheduled_time  text,
  order_index     int not null default 0,
  script_text     text
);

create table if not exists qs_cadence_owners (
  cadence_id uuid not null references qs_cadences(id) on delete cascade,
  user_id    uuid not null references qs_users(id) on delete cascade,
  rr_pointer boolean not null default false,
  primary key (cadence_id, user_id)
);

-- ── Leads ───────────────────────────────────────────────────────────────────
create table if not exists qs_leads (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text,
  last_name          text,
  full_name          text,
  job_title          text,
  department         text,
  company_name       text,
  state              text,
  city               text,
  website            text,
  company_linkedin   text,
  company_size       text,
  segment            text,
  phone              text,
  email              text,
  linkedin_url       text,
  source             text not null default 'manual' check (source in ('manual','api','integracao','importacao')),
  status             text not null default 'nao_iniciado' check (status in ('nao_iniciado','em_prospeccao','ganho','perdido')),
  location           text,
  owner_id           uuid references qs_users(id) on delete set null,
  cadence_id         uuid references qs_cadences(id) on delete set null,
  loss_reason_id     uuid references qs_loss_reasons(id) on delete set null,
  estimated_value    numeric,
  closed_value       numeric,
  cadence_started_at timestamptz,
  arrived_at         timestamptz default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists trg_qs_leads_updated on qs_leads;
create trigger trg_qs_leads_updated before update on qs_leads
  for each row execute function qs_set_updated_at();

-- ── Tarefas ─────────────────────────────────────────────────────────────────
create table if not exists qs_tasks (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references qs_leads(id) on delete cascade,
  cadence_id     uuid references qs_cadences(id) on delete set null,
  owner_id       uuid references qs_users(id) on delete set null,
  channel_type   text not null check (channel_type in ('pesquisa','email','ligacao','whatsapp','linkedin','instagram','tiktok','youtube')),
  priority       text default 'media' check (priority in ('alta','media','baixa')),
  scheduled_at   timestamptz not null default now(),
  status         text not null default 'pendente' check (status in ('pendente','concluida','ignorada','atrasada')),
  is_extra       boolean not null default false,
  notes          text,
  contact_result text,
  skip_reason    text,
  tags           text[] default '{}',
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- ── Reuniões ────────────────────────────────────────────────────────────────
create table if not exists qs_meetings (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references qs_leads(id) on delete cascade,
  owner_id     uuid references qs_users(id) on delete set null,
  title        text,
  scheduled_at timestamptz not null,
  duration_min int default 30,
  location     text,
  meeting_link text,
  notes        text,
  status       text not null default 'agendada' check (status in ('agendada','realizada','no_show','cancelada')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
drop trigger if exists trg_qs_meetings_updated on qs_meetings;
create trigger trg_qs_meetings_updated before update on qs_meetings
  for each row execute function qs_set_updated_at();

-- ── Metas ───────────────────────────────────────────────────────────────────
create table if not exists qs_goals (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references qs_users(id) on delete cascade,
  type         text not null check (type in ('ganhos','leads_finalizados','atividades','conversao')),
  period       text not null check (period in ('diario','mensal')),
  target_value numeric not null default 0,
  period_start date not null default current_date,
  created_at   timestamptz not null default now()
);

-- ── Anotações ───────────────────────────────────────────────────────────────
create table if not exists qs_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references qs_leads(id) on delete cascade,
  author_id  uuid references qs_users(id) on delete set null,
  body       text not null,
  tags       text[] default '{}',
  created_at timestamptz not null default now()
);

-- ── Config de canais ────────────────────────────────────────────────────────
create table if not exists qs_channel_config (
  type    text primary key check (type in ('pesquisa','email','ligacao','whatsapp','linkedin','instagram','tiktok','youtube')),
  enabled boolean not null default true,
  label   text not null
);

-- ── Campos personalizados ───────────────────────────────────────────────────
create table if not exists qs_custom_fields (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('pessoal','empresa','contato')),
  label       text not null,
  field_type  text not null default 'text',
  is_system   boolean not null default false,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists qs_lead_custom_values (
  lead_id         uuid not null references qs_leads(id) on delete cascade,
  custom_field_id uuid not null references qs_custom_fields(id) on delete cascade,
  value           text,
  primary key (lead_id, custom_field_id)
);

-- ── Handovers (SDR -> Closer) ───────────────────────────────────────────────
create table if not exists qs_handovers (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references qs_leads(id) on delete cascade,
  from_user_id uuid references qs_users(id) on delete set null,
  to_user_id   uuid references qs_users(id) on delete set null,
  briefing     text,
  created_at   timestamptz not null default now()
);

-- ── Produtos ────────────────────────────────────────────────────────────────
create table if not exists qs_products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Contatos do lead (multi telefone/email) ─────────────────────────────────
create table if not exists qs_contacts (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references qs_leads(id) on delete cascade,
  type       text not null,
  value      text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Log de WhatsApp (mensagens e ligações) ──────────────────────────────────
create table if not exists qs_whatsapp_messages (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid references qs_leads(id) on delete set null,
  owner_id   uuid references qs_users(id) on delete set null,
  phone      text,
  chat_id    text,
  body       text,
  direction  text not null default 'out' check (direction in ('out','in')),
  kind       text not null default 'message' check (kind in ('message','call')),
  status     text not null default 'pending' check (status in ('sent','failed','pending')),
  error      text,
  created_at timestamptz not null default now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
create index if not exists idx_qs_leads_owner on qs_leads(owner_id);
create index if not exists idx_qs_leads_status on qs_leads(status);
create index if not exists idx_qs_leads_cadence on qs_leads(cadence_id);
create index if not exists idx_qs_tasks_owner on qs_tasks(owner_id);
create index if not exists idx_qs_tasks_status on qs_tasks(status);
create index if not exists idx_qs_tasks_sched on qs_tasks(scheduled_at);
create index if not exists idx_qs_tasks_lead on qs_tasks(lead_id);
create index if not exists idx_qs_meetings_owner on qs_meetings(owner_id);
create index if not exists idx_qs_meetings_sched on qs_meetings(scheduled_at);
create index if not exists idx_qs_notes_lead on qs_notes(lead_id);
create index if not exists idx_qs_wa_lead on qs_whatsapp_messages(lead_id);

-- ── RLS (permissivo para a chave anônima — confiança em nível de app) ───────
do $$
declare t text;
begin
  foreach t in array array[
    'qs_users','qs_loss_reasons','qs_cadences','qs_cadence_days','qs_cadence_activities',
    'qs_cadence_owners','qs_leads','qs_tasks','qs_meetings','qs_goals','qs_notes',
    'qs_channel_config','qs_custom_fields','qs_lead_custom_values','qs_handovers',
    'qs_products','qs_contacts','qs_whatsapp_messages'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', 'app_all_' || t, t);
    execute format('create policy %I on %I for all to anon, authenticated using (true) with check (true)', 'app_all_' || t, t);
  end loop;
end $$;
