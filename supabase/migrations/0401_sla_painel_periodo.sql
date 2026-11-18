-- supabase/migrations/0401_sla_painel_periodo.sql
-- -----------------------------------------------------------------------------
-- ESPERA DO LEAD SEGUE O FILTRO DA PÁGINA (Bruno, 18/11/2026)
--   "hoje o SLA e o pipe têm filtros que não andam juntos" + "um bloco só com
--    hoje, semana, mês e data personalizada".
-- qs_sla_painel ganha (p_de, p_ate) opcionais e devolve, além de hoje/semana/mês
-- (a Fila de hoje continua chamando sem parâmetro), o bloco "faixa" = leads que
-- chegaram de p_de 00:00 até p_ate 23:59 (SP). A lista "atendidos" passa a
-- cobrir o mês atual + a faixa. Regra do 1º toque e relógio seg–sex = 0400.
-- Só leitura. Volta: rodar de novo a 0400 (depois de drop desta assinatura).
-- -----------------------------------------------------------------------------

drop function if exists public.qs_sla_painel();

create or replace function public.qs_sla_painel(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hoje0  timestamptz := (v_hoje::text || ' 00:00:00-03')::timestamptz;
  v_sem0   timestamptz := ((v_hoje - (extract(isodow from v_hoje)::int - 1))::text || ' 00:00:00-03')::timestamptz;
  v_mes0   timestamptz := (date_trunc('month', v_hoje)::date::text || ' 00:00:00-03')::timestamptz;
  v_ini    timestamptz;
  -- 0401: faixa escolhida no filtro da página (Desempenho). Sem datas = mês atual.
  v_de0    timestamptz := (coalesce(p_de, date_trunc('month', v_hoje)::date)::text || ' 00:00:00-03')::timestamptz;
  v_ate1   timestamptz := ((coalesce(p_ate, v_hoje) + 1)::text || ' 00:00:00-03')::timestamptz;
  v_gestor boolean := qs_pode_ver_monitor();
  v_eu     uuid := auth.uid();
  v_hor    jsonb := qs_horario_sla();
  v_meta   numeric := coalesce((select nullif(value #>> '{}', '')::numeric from qs_settings where key = 'sla_1o_contato_min'), 30);
  v_out    jsonb;
begin
  if not v_gestor and not exists (select 1 from qs_users where id = v_eu and is_active) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  -- A lista de espera olha 7 dias; os números, o mês (o que começar antes).
  if p_de is not null and p_ate is not null and p_ate < p_de then
    raise exception 'Data final antes da inicial' using errcode = '22023';
  end if;
  if p_de is not null and p_ate is not null and p_ate - p_de > 400 then
    raise exception 'Período grande demais (máx. 400 dias)' using errcode = '22023';
  end if;
  v_ini := least(v_mes0, v_hoje0 - interval '7 days', v_de0);

  with
  sdrs as (
    select u.id, u.name from qs_users u
     where u.role = 'sdr' and (v_gestor or u.id = v_eu)
  ),
  c as (
    select e.lead_id, e.sdr_id, e.chegou_em, l.full_name, l.status
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
      join sdrs s on s.id = e.sdr_id
     where e.chegou_em >= v_ini and not coalesce(e.retorno, false)
  ),
  j as (
    select c.*, least(tq.tk, tq.cl, tq.wa) as toque,
           case when least(tq.tk, tq.cl, tq.wa) is null then null
                when least(tq.tk, tq.cl, tq.wa) = tq.cl then 'ligacao'
                when least(tq.tk, tq.cl, tq.wa) = tq.wa then 'whatsapp'
                else 'tarefa' end as canal,
           case when least(tq.tk, tq.cl, tq.wa) is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, least(tq.tk, tq.cl, tq.wa), v_hor)) * 60
                else greatest(0, qs_horas_uteis(c.chegou_em, now(), v_hor)) * 60 end as minutos
      from c
      left join lateral (
        select
          (select min(k.completed_at) from qs_tasks k
            where k.lead_id = c.lead_id and k.status = 'concluida' and k.completed_at >= c.chegou_em) as tk,
          (select min(l.created_at) from qs_call_logs l
            where l.lead_id = c.lead_id and l.created_at >= c.chegou_em) as cl,
          (select min(coalesce(m.sent_at, m.created_at)) from qs_wa_messages m
            where m.lead_id = c.lead_id and m.direction = 'out'
              and m.linha_user_id is not null and m.deleted_at is null
              and coalesce(m.status, '') <> 'failed'
              and coalesce(m.sent_at, m.created_at) >= c.chegou_em) as wa
      ) tq on true
  ),
  -- Lead fechado (ganho/perdido) sem toque não fica "aguardando".
  jj as (
    select j.*,
           (toque is not null) as atendido,
           (toque is null and status in ('nao_iniciado','em_prospeccao')) as esperando
      from j
  ),
  per as (
    select 'hoje' as p, v_hoje0 as ini, 'infinity'::timestamptz as fim union all
    select 'semana', v_sem0, 'infinity'::timestamptz union all
    select 'mes', v_mes0, 'infinity'::timestamptz union all
    select 'faixa', v_de0, v_ate1
  ),
  agg as (
    select per.p, grouping(jj.sdr_id) = 1 as eh_time, jj.sdr_id,
           jsonb_build_object(
             'recebidos',   count(*),
             'atendidos',   count(*) filter (where atendido),
             'na_meta',     count(*) filter (where atendido and minutos <= v_meta),
             'fora_meta',   count(*) filter (where (atendido and minutos > v_meta) or (esperando and minutos > v_meta)),
             'aguardando',  count(*) filter (where esperando),
             'mediana_min', round((percentile_cont(0.5) within group (order by minutos) filter (where atendido))::numeric, 0)
           ) as b
      from per join jj on jj.chegou_em >= per.ini and jj.chegou_em < per.fim
     group by grouping sets ((per.p, jj.sdr_id), (per.p))
  ),
  vazio as (
    select jsonb_build_object('recebidos',0,'atendidos',0,'na_meta',0,'fora_meta',0,'aguardando',0,'mediana_min',null) as b
  )
  select jsonb_build_object(
    'meta_min', v_meta,
    'gestor', v_gestor,
    'gerado_em', now(),
    'faixa_de', (v_de0 at time zone 'America/Sao_Paulo')::date,
    'faixa_ate', ((v_ate1 at time zone 'America/Sao_Paulo')::date - 1),
    'time', jsonb_build_object(
      'hoje',   coalesce((select b from agg where eh_time and p = 'hoje'),   (select b from vazio)),
      'semana', coalesce((select b from agg where eh_time and p = 'semana'), (select b from vazio)),
      'mes',    coalesce((select b from agg where eh_time and p = 'mes'),    (select b from vazio)),
      'faixa',  coalesce((select b from agg where eh_time and p = 'faixa'),  (select b from vazio))),
    'sdrs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sdr_id', s.id, 'nome', s.name,
               'hoje',   coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'hoje'),   (select b from vazio)),
               'semana', coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'semana'), (select b from vazio)),
               'mes',    coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'mes'),    (select b from vazio)),
               'faixa',  coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'faixa'),  (select b from vazio)))
             order by s.name)
        from sdrs s
       where v_gestor = false
          or exists (select 1 from qs_users u where u.id = s.id and u.is_active)
          or exists (select 1 from c where c.sdr_id = s.id)), '[]'::jsonb),
    'aguardando', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lead_id', x.lead_id, 'nome', x.full_name, 'sdr_id', x.sdr_id, 'sdr_nome', s.name,
               'chegou_em', x.chegou_em, 'minutos', round(x.minutos::numeric, 0))
             order by x.minutos desc)
        from (select * from jj where esperando and chegou_em >= v_hoje0 - interval '7 days'
               order by minutos desc limit 200) x
        join sdrs s on s.id = x.sdr_id), '[]'::jsonb),
    -- Cada cliente atendido no mês: quanto tempo levou e por onde (clique no card).
    'atendidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lead_id', x.lead_id, 'nome', x.full_name, 'sdr_id', x.sdr_id, 'sdr_nome', s.name,
               'chegou_em', x.chegou_em, 'atendido_em', x.toque, 'canal', x.canal,
               'minutos', round(x.minutos::numeric, 0))
             order by x.chegou_em desc)
        from jj x join sdrs s on s.id = x.sdr_id
       where x.atendido and x.chegou_em >= least(v_mes0, v_de0)
         and (x.chegou_em >= v_mes0 or x.chegou_em < v_ate1)), '[]'::jsonb)
  ) into v_out;

  return v_out;
end
$function$;

revoke all on function public.qs_sla_painel(date, date) from public, anon;
grant execute on function public.qs_sla_painel(date, date) to authenticated;

comment on function public.qs_sla_painel(date, date) is
  '0401 (18/11): espera até a 1ª interação por SDR — hoje/semana/mês + faixa (p_de..p_ate) do filtro da página + leads aguardando.';
