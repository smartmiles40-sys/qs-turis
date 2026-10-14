-- 0126_areas_financeiro_operacoes.sql
-- -----------------------------------------------------------------------------
-- MAIS DUAS ÁREAS NO QS (Bruno, 14/10/2026): Financeiro e Operações.
--
-- Mesmo molde do Relacionamento (0100/0116): um sistema e um banco só, e o
-- login leva cada um à sua área. Aqui só a FUNDAÇÃO de acesso:
--   • setores válidos: comercial | relacionamento | financeiro | operacional
--   • papéis novos 'financeiro' e 'operacional' (atendente da área: só a
--     própria área, nunca escreve nas tabelas qs_* do Comercial)
--   • o gatilho acerta os setores: admin = os 4; atendente = a área dele;
--     gestor mantém os que foram escolhidos (vazio = comercial)
--   • fin_tem_acesso / fin_pode_configurar / ops_tem_acesso / ops_pode_configurar
--   • fin_config e ops_config (casca, chave/valor)
--   • cargos: gestor do Financeiro cuida dos cargos do Financeiro; idem Operações
--
-- Partiu das definições VIGENTES no banco em 14/10 (não das migrations antigas).
-- -----------------------------------------------------------------------------

-- ── Papéis e setores ───────────────────────────────────────────────────────
alter table qs_users drop constraint if exists qs_users_role_check;
alter table qs_users add constraint qs_users_role_check
  check (role = any (array['admin', 'gestor', 'sdr', 'closer', 'marketing', 'relacionamento', 'financeiro', 'operacional']));

alter table qs_users drop constraint if exists qs_users_setores_check;
alter table qs_users add constraint qs_users_setores_check
  check (setores <@ array['comercial', 'relacionamento', 'financeiro', 'operacional'] and cardinality(setores) >= 1);

create or replace function qs_users_acerta_setores() returns trigger
language plpgsql as $$
begin
  if new.role = 'admin' then
    new.setores := array['comercial', 'relacionamento', 'financeiro', 'operacional'];
  elsif new.role in ('relacionamento', 'financeiro', 'operacional') then
    new.setores := array[new.role];
  elsif new.role = 'gestor' then
    -- Gestor fica com as áreas escolhidas; sem nenhuma, é do Comercial.
    if new.setores is null or cardinality(new.setores) = 0 then
      new.setores := array['comercial'];
    end if;
  elsif new.setores is null or not ('comercial' = any(new.setores)) then
    -- SDR, closer, marketing: sempre do Comercial.
    new.setores := array_append(coalesce(new.setores, '{}'), 'comercial');
  end if;
  return new;
end;
$$;

-- Admin passa a ter as 4 áreas (o gatilho só roda quando role/setores mudam).
update qs_users set setores = array['comercial', 'relacionamento', 'financeiro', 'operacional'] where role = 'admin';

-- Quem não é do Comercial não escreve nas tabelas do Comercial.
create or replace function qs_bloqueia_espectador() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  papel text;
  areas text[];
begin
  select role, setores into papel, areas from qs_users where id = auth.uid() and is_active;
  if papel = 'marketing' then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  if papel in ('relacionamento', 'financeiro', 'operacional')
     or (papel = 'gestor' and not ('comercial' = any(coalesce(areas, '{}')))) then
    raise exception 'Perfil de outra área (Relacionamento, Financeiro ou Operações) não altera dados do Comercial.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── Acesso às áreas ────────────────────────────────────────────────────────
create or replace function fin_tem_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or 'financeiro' = any(setores))
  );
$$;
create or replace function fin_pode_configurar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or (role = 'gestor' and 'financeiro' = any(setores)))
  );
$$;
create or replace function ops_tem_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or 'operacional' = any(setores))
  );
$$;
create or replace function ops_pode_configurar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or (role = 'gestor' and 'operacional' = any(setores)))
  );
$$;
grant execute on function fin_tem_acesso(), fin_pode_configurar(), ops_tem_acesso(), ops_pode_configurar() to authenticated;

-- ── Configuração (casca) ───────────────────────────────────────────────────
create table if not exists fin_config (
  chave         text primary key,
  valor         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
create table if not exists ops_config (
  chave         text primary key,
  valor         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table fin_config enable row level security;
alter table ops_config enable row level security;
drop policy if exists fin_config_ler on fin_config;
drop policy if exists fin_config_mudar on fin_config;
drop policy if exists ops_config_ler on ops_config;
drop policy if exists ops_config_mudar on ops_config;
create policy fin_config_ler   on fin_config for select to authenticated using (fin_tem_acesso());
create policy fin_config_mudar on fin_config for all    to authenticated using (fin_pode_configurar()) with check (fin_pode_configurar());
create policy ops_config_ler   on ops_config for select to authenticated using (ops_tem_acesso());
create policy ops_config_mudar on ops_config for all    to authenticated using (ops_pode_configurar()) with check (ops_pode_configurar());
grant select, insert, update, delete on fin_config, ops_config to authenticated;

-- ── Cargos (0122): cada gestor cuida dos cargos da sua área ────────────────
create or replace function qs_pode_gerir_cargo(p_setor text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin'
            or (role = 'gestor' and 'relacionamento' = any(setores) and p_setor in ('relacionamento', 'financeiro'))
            or (role = 'gestor' and 'financeiro'     = any(setores) and p_setor = 'financeiro')
            or (role = 'gestor' and 'operacional'    = any(setores) and p_setor = 'operacional'))
  );
$$;
