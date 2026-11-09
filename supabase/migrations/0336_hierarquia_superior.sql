-- supabase/migrations/0336_hierarquia_superior.sql
-- -----------------------------------------------------------------------------
-- HIERARQUIA: QUEM ESTÁ UM CARGO ACIMA ACOMPANHA AS DEMANDAS DE QUEM ESTÁ ABAIXO
-- (Bruno, 09/11/2026: "a Tainara consiga acompanhar as solicitações abertas de
--  todos… definir uma ordem hierárquica, pra sempre quem estiver um cargo acima
--  conseguir acompanhar as demandas da pessoa abaixo").
--
-- 1) qs_users.superior_id = a quem a pessoa responde (uma árvore; sem ciclo).
-- 2) qs_subordinados(uid): todo mundo abaixo, em qualquer nível (o chefe do chefe
--    também vê). qs_eh_do_meu_time(alvo): o alvo está abaixo de mim?
-- 3) qs_ve_solicitacao: além do setor/criador/responsável, quem está ACIMA de quem
--    pediu ou de quem é responsável também vê (mesmo em outro setor).
-- 4) Semente: Laura e Mariane (Atendimento do Relacionamento) respondem à Tainara.
--
-- Volta: alter table qs_users drop column superior_id; drop function qs_subordinados,
-- qs_eh_do_meu_time, qs_meu_time, qs_definir_superior; recriar qs_ve_solicitacao (0203).
-- -----------------------------------------------------------------------------

alter table qs_users add column if not exists superior_id uuid references qs_users(id) on delete set null;
alter table qs_users drop constraint if exists qs_users_superior_nao_e_ele;
alter table qs_users add constraint qs_users_superior_nao_e_ele check (superior_id is null or superior_id <> id);
create index if not exists idx_qs_users_superior on qs_users (superior_id);
comment on column qs_users.superior_id is 'A quem a pessoa responde (0336). Quem está acima, em qualquer nível, acompanha as demandas dela.';

-- Todo mundo abaixo de p_chefe (qualquer nível; para em 10 níveis e não entra em ciclo).
create or replace function qs_subordinados(p_chefe uuid default auth.uid())
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive abaixo(id, nivel, caminho) as (
    select u.id, 1, array[p_chefe, u.id] from qs_users u where u.superior_id = p_chefe and u.id <> p_chefe
    union all
    select u.id, a.nivel + 1, a.caminho || u.id
      from qs_users u join abaixo a on u.superior_id = a.id
     where a.nivel < 10 and not (u.id = any(a.caminho))
  )
  select distinct id from abaixo;
$$;
revoke all on function qs_subordinados(uuid) from public, anon;
grant execute on function qs_subordinados(uuid) to authenticated;

create or replace function qs_eh_do_meu_time(p_alvo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_alvo is not null and auth.uid() is not null
     and exists (select 1 from qs_subordinados(auth.uid()) s where s = p_alvo);
$$;
revoke all on function qs_eh_do_meu_time(uuid) from public, anon;
grant execute on function qs_eh_do_meu_time(uuid) to authenticated;

-- Pra tela: o meu time (id, nome, nível) — ativos e inativos (demanda antiga de quem saiu também conta).
create or replace function qs_meu_time()
returns table (id uuid, name text, is_active boolean, superior_id uuid)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.is_active, u.superior_id
    from qs_users u where u.id in (select qs_subordinados(auth.uid()))
   order by u.is_active desc, u.name;
$$;
revoke all on function qs_meu_time() from public, anon;
grant execute on function qs_meu_time() to authenticated;

-- Definir o superior: admin, ou gestor do mesmo setor da pessoa. Recusa ciclo.
create or replace function qs_definir_superior(p_usuario uuid, p_superior uuid)
returns void language plpgsql security definer set search_path = public as $$
declare eu qs_users; alvo qs_users;
begin
  select * into eu from qs_users where id = auth.uid();
  select * into alvo from qs_users where id = p_usuario;
  if alvo.id is null then raise exception 'usuario-nao-encontrado'; end if;
  if not (eu.role = 'admin' or (eu.role = 'gestor' and coalesce(eu.setores, '{}') && coalesce(alvo.setores, '{}'))) then
    raise exception 'sem-permissao';
  end if;
  if p_superior is not null then
    if p_superior = p_usuario then raise exception 'superior-ciclo'; end if;
    -- o novo chefe não pode estar abaixo da pessoa
    if exists (select 1 from qs_subordinados(p_usuario) s where s = p_superior) then raise exception 'superior-ciclo'; end if;
  end if;
  update qs_users set superior_id = p_superior where id = p_usuario;
end $$;
revoke all on function qs_definir_superior(uuid, uuid) from public, anon;
grant execute on function qs_definir_superior(uuid, uuid) to authenticated;

-- Quem vê a solicitação: o de antes + quem está acima de quem pediu ou do responsável.
create or replace function public.qs_ve_solicitacao(p_de text, p_para text, p_criador uuid, p_resp uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select p_criador = auth.uid() or p_resp = auth.uid() or qs_do_setor(p_de) or qs_do_setor(p_para)
      or qs_eh_do_meu_time(p_criador) or qs_eh_do_meu_time(p_resp);
$function$;

-- Semente: o Atendimento do Relacionamento responde à Tainara (gestora).
update qs_users u set superior_id = t.id
  from qs_users t
 where t.name ilike 'Tainara%' and t.role = 'gestor'
   and u.name in ('Laura de Assunção | Relacionamento', 'Mariane | Relacionamento')
   and u.superior_id is null;
