-- 0399_leads_recebidos_por_mes_dashboard.sql
-- -----------------------------------------------------------------------------
-- Bruno (17/11), corrigindo a 0398: "não é leads em trabalho, e sim leads
-- recebidos, ou seja, quantos leads cada SDR recebeu no mês".
--
-- Fonte: qs_lead_entradas (0094). O SDR que recebeu é o do momento da chegada,
-- mesmo que depois o lead mude de dono. É a mesma base do Desempenho
-- (0322/0323) e do Funil por SDR (0095).
--   recebidos = todas as entradas do mês (lead novo + lead que voltou)
--   novos     = só lead que nunca tinha entrado (not retorno)
-- Mês no fuso de São Paulo.
--
-- Só o servidor chama (service_role). O /api/dashboard-sync manda a cada 5 min
-- pra leads_recebidos_qs do Dashboard.
--
-- Volta:
--   drop function if exists qs_leads_recebidos_por_mes(date);
-- -----------------------------------------------------------------------------

drop function if exists qs_carteira_por_dono();

create or replace function qs_leads_recebidos_por_mes(p_desde date)
returns table (
  owner_id  uuid,
  nome      text,
  papel     text,
  mes       text,
  recebidos int,
  novos     int
)
language sql stable security invoker set search_path = public as $$
  select u.id, u.name, u.role,
         to_char(e.chegou_em at time zone 'America/Sao_Paulo', 'YYYY-MM'),
         count(*)::int,
         count(*) filter (where not e.retorno)::int
    from qs_lead_entradas e
    join qs_users u on u.id = e.sdr_id
   where e.chegou_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo')
   group by 1, 2, 3, 4;
$$;

revoke all on function qs_leads_recebidos_por_mes(date) from public, anon, authenticated;
grant execute on function qs_leads_recebidos_por_mes(date) to service_role;
