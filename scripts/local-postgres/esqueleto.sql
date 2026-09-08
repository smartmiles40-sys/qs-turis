-- =============================================================================
-- ESQUELETO MÍNIMO DO QS — só o que a migration 0076 encosta.
-- -----------------------------------------------------------------------------
-- Não é o schema inteiro (são 18 tabelas qs_*). É de propósito: o banco local
-- serve pra testar UMA migration, e um esqueleto pequeno deixa óbvio de quais
-- objetos a 0076 depende. Se ela passar a depender de outra coisa, quebra aqui
-- em vez de quebrar em produção.
-- =============================================================================

-- Os roles do Supabase. Sem eles os grants/revokes da migration viram no-op e o
-- teste não exercitaria a parte de permissão — que foi justamente onde apareceu
-- o bug do service_role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin; end if;
end $$;

create table qs_users (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text unique,
  role            text not null,
  is_active       boolean not null default true,
  whatsapp_number text,
  created_at      timestamptz not null default now()
);

create table qs_cadences (
  id         uuid primary key default gen_random_uuid(),
  status     text default 'disponivel',
  created_at timestamptz not null default now()
);

create table qs_cadence_owners (
  cadence_id uuid references qs_cadences(id),
  user_id    uuid references qs_users(id)
);

create table qs_leads (
  id         uuid primary key default gen_random_uuid(),
  full_name  text,
  phone      text,
  email      text,
  segment    text,
  source     text not null default 'manual' check (source in ('manual','api','integracao','importacao')),
  owner_id   uuid references qs_users(id),
  cadence_id uuid references qs_cadences(id),
  created_at timestamptz not null default now()
);

create table qs_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

create table qs_assign_state (
  scope         text primary key,
  last_owner_id uuid references qs_users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

create or replace function qs_is_manager() returns boolean
language sql stable as $$ select true $$;

-- O trigger da 0028 no estado ANTERIOR à 0076, pra migration exercitar o
-- "create or replace" de verdade — igualzinho ao que vai acontecer em produção.
create or replace function qs_assign_lead_owner() returns trigger
language plpgsql as $$
begin
  return new;
end;
$$;

create trigger trg_qs_assign_owner before insert on qs_leads
  for each row execute function qs_assign_lead_owner();

-- ── O time de verdade ───────────────────────────────────────────────────────
-- Mesmos nomes e mesma ORDEM DE created_at do banco de produção (conferido em
-- 04/09/2026), porque é created_at que define a ordem da roda.
insert into qs_users (name, email, role, is_active, created_at) values
  ('Mariana',              'mariana.rodrigues@agenciasetuforeuvou.com', 'sdr',    true,  now() - interval '5 days'),
  ('Victor Hugo',          'victor.hugo@agenciasetuforeuvou.com',       'sdr',    true,  now() - interval '4 days'),
  ('Yanca Manuella Ruivo', 'yanca.manuella@agenciasetuforeuvou.com',    'sdr',    true,  now() - interval '3 days'),
  ('Arthur',               'arthur.santos@agenciasetuforeuvou.com',     'gestor', true,  now() - interval '2 days'),
  ('Bruno Matheus',        'bruno.matheus@agenciasetuforeuvou.com',     'closer', true,  now() - interval '1 day'),
  ('SDR de ferias',        'ferias@agenciasetuforeuvou.com',            'sdr',    false, now());
