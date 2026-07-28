-- =============================================================================
-- 0027 — Agenda dos closers (pipeline de reuniões nativa)
-- -----------------------------------------------------------------------------
-- Tira o QS da dependência da Google Agenda: a agenda dos closers passa a viver
-- AQUI. Três coisas novas:
--
--   1) A reunião passa a saber QUEM é o closer (closer_id → qs_users), em vez do
--      nome em texto livre (meeting_owner) que a lista de "Equipe da reunião"
--      gravava. Sem isso não existe "agenda do closer".
--   2) Disponibilidade: janela semanal recorrente (qs_closer_availability),
--      bloqueios pontuais (qs_closer_blocks) e parâmetros de agendamento
--      (qs_closer_config). É daí que saem os SLOTS LIVRES.
--   3) Trava anti-choque de agenda NO BANCO (constraint EXCLUDE): dois SDRs
--      clicando no mesmo horário do mesmo closer no mesmo segundo — o segundo
--      leva erro, não uma reunião duplicada. Checagem no front não resolve isso.
--
-- Visibilidade (decisão do Bruno): o time INTEIRO vê a agenda inteira. Por isso
-- meetings_select vira `true`. A RLS dos LEADS continua fechada por dono — daí a
-- coluna `lead_name` denormalizada: sem ela o calendário mostraria "—" na
-- reunião de um lead que não é seu (o join volta nulo sob RLS).
-- =============================================================================

create extension if not exists btree_gist;

-- ── (1) A reunião ganha closer, fim e nome do lead ──────────────────────────
alter table qs_meetings add column if not exists closer_id uuid references qs_users(id) on delete set null;
alter table qs_meetings add column if not exists ends_at   timestamptz;
alter table qs_meetings add column if not exists lead_name text;

-- Mantém ends_at e lead_name coerentes sozinhos. ends_at existe como COLUNA (e
-- não como expressão na constraint) porque `timestamptz + interval` é STABLE, e
-- constraint/coluna gerada exige IMMUTABLE — dentro de um trigger não tem essa
-- restrição.
create or replace function qs_meetings_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.ends_at := new.scheduled_at + make_interval(mins => greatest(coalesce(new.duration_min, 30), 1));
  if new.lead_name is null then
    select l.full_name into new.lead_name from qs_leads l where l.id = new.lead_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_qs_meetings_fill on qs_meetings;
create trigger trg_qs_meetings_fill before insert or update on qs_meetings
  for each row execute function qs_meetings_fill();

-- Backfill: nome do closer (texto livre) → usuário real.
update qs_meetings m
   set closer_id = u.id
  from qs_users u
 where m.closer_id is null
   and m.meeting_owner is not null
   and lower(btrim(u.name)) = lower(btrim(m.meeting_owner));

-- Backfill de ends_at / lead_name nas linhas antigas.
update qs_meetings m
   set ends_at   = coalesce(m.ends_at, m.scheduled_at + make_interval(mins => greatest(coalesce(m.duration_min, 30), 1))),
       lead_name = coalesce(m.lead_name, l.full_name)
  from qs_leads l
 where l.id = m.lead_id
   and (m.ends_at is null or m.lead_name is null);

update qs_meetings
   set ends_at = scheduled_at + make_interval(mins => greatest(coalesce(duration_min, 30), 1))
 where ends_at is null;

create index if not exists idx_qs_meetings_closer     on qs_meetings(closer_id);
create index if not exists idx_qs_meetings_closer_day on qs_meetings(closer_id, scheduled_at);

-- ── (2) Trava anti-choque de agenda ─────────────────────────────────────────
-- Só vale pra reunião AGENDADA (cancelada/no-show/realizada não ocupam horário)
-- e pra closer definido. Envolvida num bloco porque, se a base já tiver duas
-- reuniões sobrepostas do mesmo closer (herança do texto livre), a constraint
-- não entra — e isso não pode derrubar a migration inteira.
do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_closer_no_overlap
    exclude using gist (
      closer_id with =,
      tstzrange(scheduled_at, ends_at, '[)') with &&
    )
    where (closer_id is not null and ends_at is not null and status = 'agendada');
exception
  when duplicate_object then
    raise notice '[0027] trava anti-choque já existia — ok';
  when others then
    raise warning '[0027] trava anti-choque NÃO aplicada (%). Provável sobreposição já existente: rode a query de conferência no fim deste arquivo, resolva e reaplique.', sqlerrm;
end $$;

-- ── (3) Disponibilidade semanal do closer ───────────────────────────────────
-- Uma linha por janela. O intervalo de almoço não é um campo: são duas janelas
-- (09:00–12:00 e 13:30–18:00). Menos regra, mais flexível.
create table if not exists qs_closer_availability (
  id         uuid primary key default gen_random_uuid(),
  closer_id  uuid not null references qs_users(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),  -- 0 = Domingo
  start_time time not null,
  end_time   time not null,
  created_at timestamptz not null default now(),
  constraint qs_closer_availability_window check (end_time > start_time)
);
create index if not exists idx_qs_closer_avail on qs_closer_availability(closer_id, weekday);

-- ── (4) Bloqueios pontuais (férias, almoço extra, compromisso pessoal) ──────
create table if not exists qs_closer_blocks (
  id         uuid primary key default gen_random_uuid(),
  closer_id  uuid not null references qs_users(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_by uuid references qs_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qs_closer_blocks_window check (ends_at > starts_at)
);
create index if not exists idx_qs_closer_blocks on qs_closer_blocks(closer_id, starts_at);

-- ── (5) Parâmetros de agendamento por closer ────────────────────────────────
create table if not exists qs_closer_config (
  closer_id          uuid primary key references qs_users(id) on delete cascade,
  slot_minutes       int not null default 60  check (slot_minutes between 5 and 480),
  buffer_minutes     int not null default 0   check (buffer_minutes between 0 and 240),
  min_notice_minutes int not null default 120 check (min_notice_minutes >= 0),
  max_per_day        int check (max_per_day is null or max_per_day > 0),
  is_bookable        boolean not null default true,
  color              text,
  default_link       text,   -- link fixo de sala (Meet/Zoom) do closer
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_qs_closer_config_updated on qs_closer_config;
create trigger trg_qs_closer_config_updated before update on qs_closer_config
  for each row execute function qs_set_updated_at();

-- ── (6) RLS ─────────────────────────────────────────────────────────────────
alter table qs_closer_availability enable row level security;
alter table qs_closer_blocks       enable row level security;
alter table qs_closer_config       enable row level security;

-- Leitura: qualquer autenticado. Um SDR PRECISA enxergar a disponibilidade de
-- todos os closers pra conseguir agendar — é o ponto da tela.
drop policy if exists closer_avail_select on qs_closer_availability;
create policy closer_avail_select on qs_closer_availability for select to authenticated using (true);

drop policy if exists closer_blocks_select on qs_closer_blocks;
create policy closer_blocks_select on qs_closer_blocks for select to authenticated using (true);

drop policy if exists closer_config_select on qs_closer_config;
create policy closer_config_select on qs_closer_config for select to authenticated using (true);

-- Escrita: gestor/admin, ou o PRÓPRIO closer na agenda dele. Um SDR não remaneja
-- o horário de trabalho de um closer.
drop policy if exists closer_avail_write on qs_closer_availability;
create policy closer_avail_write on qs_closer_availability for all to authenticated
  using (qs_is_manager() or closer_id = auth.uid())
  with check (qs_is_manager() or closer_id = auth.uid());

drop policy if exists closer_blocks_write on qs_closer_blocks;
create policy closer_blocks_write on qs_closer_blocks for all to authenticated
  using (qs_is_manager() or closer_id = auth.uid())
  with check (qs_is_manager() or closer_id = auth.uid());

drop policy if exists closer_config_write on qs_closer_config;
create policy closer_config_write on qs_closer_config for all to authenticated
  using (qs_is_manager() or closer_id = auth.uid())
  with check (qs_is_manager() or closer_id = auth.uid());

-- Reuniões: o time inteiro vê a agenda inteira (decisão do Bruno).
drop policy if exists meetings_select on qs_meetings;
create policy meetings_select on qs_meetings for select to authenticated using (true);

-- Quem pode MEXER continua restrito — agora incluindo o closer dono do horário
-- (é ele que marca realizada/no-show).
drop policy if exists meetings_update on qs_meetings;
create policy meetings_update on qs_meetings for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or closer_id = auth.uid())
  with check (true);

drop policy if exists meetings_delete on qs_meetings;
create policy meetings_delete on qs_meetings for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or closer_id = auth.uid());

-- ── (7) Semente: closers ativos sem configuração nascem agendáveis ──────────
-- 60 min, 2h de antecedência, seg–sex 09:00–12:00 e 13:30–18:00. O closer (ou o
-- gestor) ajusta depois em Configurações → Agenda dos Closers.
insert into qs_closer_config (closer_id)
select u.id from qs_users u
 where u.role = 'closer' and u.is_active
   and not exists (select 1 from qs_closer_config c where c.closer_id = u.id);

insert into qs_closer_availability (closer_id, weekday, start_time, end_time)
select u.id, d.weekday, w.start_time, w.end_time
  from qs_users u
 cross join (values (1),(2),(3),(4),(5)) as d(weekday)
 cross join (values ('09:00'::time,'12:00'::time), ('13:30'::time,'18:00'::time)) as w(start_time, end_time)
 where u.role = 'closer' and u.is_active
   and not exists (select 1 from qs_closer_availability a where a.closer_id = u.id);

-- ── (8) Realtime: o calendário atualiza sozinho quando alguém agenda ────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'qs_meetings'
  ) then
    alter publication supabase_realtime add table qs_meetings;
  end if;
end $$;

-- =============================================================================
-- CONFERÊNCIA (rode se o aviso da seção 2 aparecer)
-- Lista as sobreposições já existentes por closer — resolva-as (remarcar ou
-- cancelar) e reaplique só o bloco `do $$ ... alter table ... exclude ...`.
--
--   select a.id, b.id, a.closer_id, a.scheduled_at, b.scheduled_at
--     from qs_meetings a
--     join qs_meetings b
--       on a.closer_id = b.closer_id and a.id < b.id
--      and a.status = 'agendada' and b.status = 'agendada'
--      and tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)');
-- =============================================================================
