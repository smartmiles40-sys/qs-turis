-- 0116_relacionamento_gestora.sql
-- -----------------------------------------------------------------------------
-- GESTORA DO RELACIONAMENTO (Bruno, 13/10/2026: "a Tainara poder adicionar
-- outros funcionários e ter todas as funções pra modificar o sistema").
-- Gestor(a) do Relacionamento = role 'gestor' com setores = só ['relacionamento'].
--
-- Antes desta migration isso NÃO era possível:
--   1. o gatilho qs_users_acerta_setores (0100) colocava 'comercial' em todo
--      papel que não fosse admin/relacionamento → a gestora ganharia o Comercial;
--   2. o gatilho qs_bloqueia_espectador só barrava o papel 'relacionamento' de
--      escrever nas tabelas do Comercial → um gestor só-Relacionamento escreveria.
-- -----------------------------------------------------------------------------

-- 1. Gestor pode ficar SÓ no Relacionamento (os outros papéis seguem como antes).
create or replace function qs_users_acerta_setores()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'admin' then
    new.setores := array['comercial', 'relacionamento'];
  elsif new.role = 'relacionamento' then
    new.setores := array['relacionamento'];
  elsif new.role = 'gestor' and new.setores = array['relacionamento'] then
    null; -- gestor(a) do Relacionamento: fica só nele
  elsif not ('comercial' = any(new.setores)) then
    -- papel do Comercial sem o setor Comercial não faz sentido
    new.setores := array_append(new.setores, 'comercial');
  end if;
  return new;
end;
$$;

-- 2. Quem não tem o setor Comercial não escreve nas tabelas do Comercial.
create or replace function qs_bloqueia_espectador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  papel text;
  areas text[];
begin
  select role, setores into papel, areas from qs_users where id = auth.uid() and is_active;
  if papel = 'marketing' then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  if papel = 'relacionamento' or (papel = 'gestor' and not ('comercial' = any(coalesce(areas, '{}')))) then
    raise exception 'Perfil Relacionamento não altera dados do Comercial.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 3. "Gestor" do COMERCIAL é gestor com o setor Comercial. As policies (RLS) do
--    Comercial passam por qs_is_manager()/qs_pode_ver_monitor(): sem isto a
--    gestora do Relacionamento leria leads, tarefas e reuniões do Comercial.
--    (Aprovado pelo Bruno em 13/10/2026.)
create or replace function qs_is_manager()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or (role = 'gestor' and 'comercial' = any(coalesce(setores, '{}'))))
  );
$$;

create or replace function qs_pode_ver_monitor()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from qs_users
                  where id = auth.uid() and is_active
                    and (role in ('admin', 'marketing')
                         or (role = 'gestor' and 'comercial' = any(coalesce(setores, '{}')))));
$$;

-- 4. Promove a Tainara.
update qs_users
   set role = 'gestor', setores = array['relacionamento']
 where name = 'Tainara' and role = 'relacionamento';
