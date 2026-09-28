-- =============================================================================
-- 0097 — MONITOR DE LEADS PARA OS SDRs
-- -----------------------------------------------------------------------------
-- Bruno, 28/09/2026: "coloque o acompanhamento dos leads para os SDRs poderem
-- acompanhar a distribuição". A reclamação era de injustiça no rodízio; quem
-- reclama precisa ver os números.
--
--   qs_monitor_distribuicao        → qualquer usuário ativo (números do time)
--   qs_monitor_distribuicao_lista  → gestor: todos; demais: SÓ os leads que
--                                    a própria pessoa recebeu (nome/telefone de
--                                    lead de colega não sai daqui).
-- Mesmo corpo da 0094; só mudam as duas checagens.
-- =============================================================================

create or replace function qs_monitor_distribuicao(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ini timestamptz := (p_de::text || ' 00:00:00-03')::timestamptz;
  v_fim timestamptz := ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz;
  v_out jsonb;
begin
  -- 28/09 (0097): o SDR também vê o agregado — a transparência da
  -- distribuição é o ponto do monitor. A LISTA de leads segue restrita.
  if not (qs_pode_ver_monitor() or exists (select 1 from qs_users where id = auth.uid() and is_active)) then
    raise exception 'Sem permissão para o monitor de distribuição' using errcode = '42501';
  end if;

  with e as (
    select e.lead_id, e.sdr_id, e.retorno, e.chegou_em,
           (e.chegou_em at time zone 'America/Sao_Paulo') as local,
           qs_canal_da_fonte(l.segment) as canal,
           qs_destino_da_fonte(l.segment) as destino
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
     where e.chegou_em >= v_ini and e.chegou_em < v_fim
  ),
  sdrs as (
    select e.sdr_id, u.name as nome, u.role as papel,
           count(*) as total,
           count(*) filter (where not e.retorno) as novos,
           count(*) filter (where e.retorno) as retornos,
           count(*) filter (where extract(isodow from e.local) between 1 and 5) as semana,
           count(*) filter (where extract(isodow from e.local) in (6,7)) as fds,
           count(*) filter (where extract(isodow from e.local) in (6,7) and not e.retorno) as fds_novos,
           count(*) filter (where extract(isodow from e.local) = 6) as sabado,
           count(*) filter (where extract(isodow from e.local) = 7) as domingo,
           count(*) filter (where e.canal = 'live') as live,
           count(*) filter (where e.canal = 'live' and not e.retorno) as live_novos,
           count(*) filter (where e.canal = 'trafego') as trafego,
           count(*) filter (where e.canal = 'organico') as organico,
           count(*) filter (where e.canal in ('outros','sem_fonte')) as outros
      from e left join qs_users u on u.id = e.sdr_id
     group by e.sdr_id, u.name, u.role
  ),
  por_dia as (
    select to_char(e.local::date, 'YYYY-MM-DD') as dia, e.sdr_id,
           count(*) as total, count(*) filter (where not e.retorno) as novos
      from e group by 1, 2
  ),
  lives as (
    select coalesce(e.destino, 'Sem destino') as destino, e.sdr_id,
           count(*) as total, count(*) filter (where not e.retorno) as novos
      from e where e.canal = 'live' group by 1, 2
  ),
  -- Closers: LEADS distintos, não linhas de qs_meetings. Toda reagendada vira
  -- uma linha nova e inflava a contagem de quem mais remarca.
  m as (
    select m.closer_id, m.lead_id, m.tipo, m.origem, m.status,
           (m.created_at at time zone 'America/Sao_Paulo') as local
      from qs_meetings m
     where m.created_at >= v_ini and m.created_at < v_fim
       and m.closer_id is not null and m.lead_id is not null
  ),
  closers as (
    select m.closer_id, u.name as nome,
           count(distinct m.lead_id) as leads,
           count(distinct m.lead_id) filter (where coalesce(m.tipo,'primeira') = 'primeira') as primeiras,
           count(distinct m.lead_id) filter (where m.tipo = 'retomada') as retomadas,
           count(distinct m.lead_id) filter (where extract(isodow from m.local) in (6,7)) as fds,
           count(distinct m.lead_id) filter (where m.origem = 'autoagendamento') as autoagendamento,
           count(distinct m.lead_id) filter (where m.status = 'realizada') as realizadas
      from m left join qs_users u on u.id = m.closer_id
     group by m.closer_id, u.name
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'sdrs',    coalesce((select jsonb_agg(to_jsonb(s) order by s.total desc) from sdrs s), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(to_jsonb(d) order by d.dia) from por_dia d), '[]'::jsonb),
    'lives',   coalesce((select jsonb_agg(to_jsonb(v) order by v.destino) from lives v), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(to_jsonb(c) order by c.leads desc) from closers c), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$fn$;

-- ── A relação lead a lead (a "lista de cada SDR") ───────────────────────────
create or replace function qs_monitor_distribuicao_lista(
  p_de date, p_ate date, p_sdr uuid default null, p_canal text default null, p_so_fds boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ini timestamptz := (p_de::text || ' 00:00:00-03')::timestamptz;
  v_fim timestamptz := ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz;
begin
  if not qs_pode_ver_monitor() then
    -- 28/09 (0097): quem não é gestor vê só os leads que ELE recebeu.
    if not exists (select 1 from qs_users where id = auth.uid() and is_active) then
      raise exception 'Sem permissão para o monitor de distribuição' using errcode = '42501';
    end if;
    p_sdr := auth.uid();
  end if;

  return coalesce((
    select jsonb_agg(x order by x.chegou_em desc, x.lead_id)
      from (
        select e.lead_id, e.chegou_em, e.retorno, e.sdr_id,
               r.name as recebeu, l.owner_id as dono_atual_id, d.name as dono_atual,
               l.full_name as nome, l.phone as telefone, l.segment as fonte,
               qs_canal_da_fonte(l.segment) as canal, qs_destino_da_fonte(l.segment) as destino,
               l.status, l.bitrix_id,
               extract(isodow from e.chegou_em at time zone 'America/Sao_Paulo') in (6,7) as fim_de_semana
          from qs_lead_entradas e
          join qs_leads l on l.id = e.lead_id
          left join qs_users r on r.id = e.sdr_id
          left join qs_users d on d.id = l.owner_id
         where e.chegou_em >= v_ini and e.chegou_em < v_fim
           and (p_sdr is null or e.sdr_id = p_sdr)
           and (p_canal is null or qs_canal_da_fonte(l.segment) = p_canal
                or (p_canal = 'outros' and qs_canal_da_fonte(l.segment) = 'sem_fonte'))
           and (not coalesce(p_so_fds, false)
                or extract(isodow from e.chegou_em at time zone 'America/Sao_Paulo') in (6,7))
         order by e.chegou_em desc, e.lead_id
         limit 5000
      ) x
  ), '[]'::jsonb);
end;
$fn$;
