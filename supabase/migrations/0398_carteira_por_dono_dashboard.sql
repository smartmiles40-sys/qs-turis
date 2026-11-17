-- 0398_carteira_por_dono_dashboard.sql
-- -----------------------------------------------------------------------------
-- Bruno (17/11): "Na aba de metas do dashboard, coloque quantos leads cada SDR
-- está trabalhando". O QS já sabe; o /api/dashboard-sync manda a foto a cada
-- 5 min pra tabela carteira_qs do Dashboard.
--
-- Mesma régua da Saúde da Carteira (0075) e do Desempenho (0322):
--   ativos      = lead do dono que não está ganho nem perdido
--   trabalhando = desses, os que têm atividade aberta (pendente/atrasada)
--   atrasados   = desses, os que têm atividade aberta de dia anterior a hoje (SP)
--
-- Só o servidor chama (service_role). Volta:
--   drop function if exists qs_carteira_por_dono();
-- -----------------------------------------------------------------------------

create or replace function qs_carteira_por_dono()
returns table (
  owner_id          uuid,
  nome              text,
  papel             text,
  leads_ativos      int,
  leads_trabalhando int,
  leads_atrasados   int
)
language sql stable security invoker set search_path = public as $$
  with hoje0 as (
    select date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as t
  ),
  abertas as (
    select k.lead_id,
           bool_or(k.scheduled_at < (select t from hoje0)) as atrasada
      from qs_tasks k
     where k.status in ('pendente','atrasada')
     group by k.lead_id
  )
  select u.id, u.name, u.role,
         count(l.id)::int,
         count(a.lead_id)::int,
         count(a.lead_id) filter (where a.atrasada)::int
    from qs_users u
    join qs_leads l on l.owner_id = u.id and l.status not in ('ganho','perdido')
    left join abertas a on a.lead_id = l.id
   where u.is_active
   group by u.id, u.name, u.role;
$$;

revoke all on function qs_carteira_por_dono() from public, anon, authenticated;
grant execute on function qs_carteira_por_dono() to service_role;
