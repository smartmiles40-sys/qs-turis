-- supabase/migrations/0405_sla_ligacao_marcada.sql
-- -----------------------------------------------------------------------------
-- LIGAÇÃO MARCADA PELO CLIENTE NÃO CONTA COMO ESPERA (Bruno, 18/11/2026)
--   "Ligação marcada pelo cliente já entra contando SLA" — 11 dos 12 leads que
--   apareciam esperando há horas tinham marcado a ligação pra dali a 1–3 dias.
-- 1) Lead que marcou a ligação no formulário (tarefa extra com a tag
--    'ligacao-agendada' criada junto com a chegada): o relógio começa na HORA
--    MARCADA. Ligou antes = 0 min.
-- 2) Enquanto a hora não chega, o lead sai do "aguardando" e vai pra lista
--    "marcadas" (com a hora). Os blocos ganham a contagem 'marcadas'.
-- 3) Lead esperando sem nenhuma tarefa aberta ganha 'sem_tarefa' (ex.: conversa
--    que chegou pelo WhatsApp e virou lead sem cadência — não aparece na Fila).
-- O KPI "Espera do lead" da qs_desempenho passa a usar o mesmo início.
-- Só leitura. Volta: rodar de novo a 0401 e tirar o trecho 0405 da qs_desempenho.
-- -----------------------------------------------------------------------------

-- Hora marcada pelo cliente no formulário (null = não marcou).
create or replace function public.qs_sla_marcada(p_lead uuid, p_chegou timestamptz)
returns timestamptz
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $f$
  select min(k.scheduled_at) from qs_tasks k
   where k.lead_id = p_lead
     and k.tags @> array['ligacao-agendada']::text[]
     and k.created_at >= p_chegou - interval '5 minutes'
     and k.created_at <  p_chegou + interval '1 hour'
$f$;
revoke all on function public.qs_sla_marcada(uuid, timestamptz) from public, anon;
grant execute on function public.qs_sla_marcada(uuid, timestamptz) to authenticated;
comment on function public.qs_sla_marcada(uuid, timestamptz) is
  '0405: hora da ligação marcada pelo cliente no formulário (tarefa ligacao-agendada criada na chegada). O relógio do SLA começa nela.';

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
    select e.lead_id, e.sdr_id, e.chegou_em, l.full_name, l.status,
           qs_sla_marcada(e.lead_id, e.chegou_em) as marcada,
           exists (select 1 from qs_tasks k where k.lead_id = e.lead_id and k.status = 'pendente') as tem_tarefa
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
      join sdrs s on s.id = e.sdr_id
     where e.chegou_em >= v_ini and not coalesce(e.retorno, false)
  ),
  j as (
    select c.*, greatest(c.chegou_em, coalesce(c.marcada, c.chegou_em)) as inicio,
           least(tq.tk, tq.cl, tq.wa) as toque,
           case when least(tq.tk, tq.cl, tq.wa) is null then null
                when least(tq.tk, tq.cl, tq.wa) = tq.cl then 'ligacao'
                when least(tq.tk, tq.cl, tq.wa) = tq.wa then 'whatsapp'
                else 'tarefa' end as canal,
           case when least(tq.tk, tq.cl, tq.wa) is not null
                then greatest(0, qs_horas_uteis(greatest(c.chegou_em, coalesce(c.marcada, c.chegou_em)), least(tq.tk, tq.cl, tq.wa), v_hor)) * 60
                when coalesce(c.marcada, c.chegou_em) > now() then 0
                else greatest(0, qs_horas_uteis(greatest(c.chegou_em, coalesce(c.marcada, c.chegou_em)), now(), v_hor)) * 60 end as minutos
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
  -- 0405: ligação marcada com hora ainda no futuro não está esperando — vai pra "marcadas".
  jj as (
    select j.*,
           (toque is not null) as atendido,
           (toque is null and status in ('nao_iniciado','em_prospeccao') and coalesce(marcada, chegou_em) <= now()) as esperando,
           (toque is null and status in ('nao_iniciado','em_prospeccao') and marcada > now()) as marcada_futura
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
             'marcadas',    count(*) filter (where marcada_futura),
             'mediana_min', round((percentile_cont(0.5) within group (order by minutos) filter (where atendido))::numeric, 0)
           ) as b
      from per join jj on jj.chegou_em >= per.ini and jj.chegou_em < per.fim
     group by grouping sets ((per.p, jj.sdr_id), (per.p))
  ),
  vazio as (
    select jsonb_build_object('recebidos',0,'atendidos',0,'na_meta',0,'fora_meta',0,'aguardando',0,'marcadas',0,'mediana_min',null) as b
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
               'chegou_em', x.chegou_em, 'minutos', round(x.minutos::numeric, 0),
               'marcada_para', x.marcada, 'sem_tarefa', not x.tem_tarefa)
             order by x.minutos desc)
        from (select * from jj where esperando and inicio >= v_hoje0 - interval '7 days'
               order by minutos desc limit 200) x
        join sdrs s on s.id = x.sdr_id), '[]'::jsonb),
    -- 0405: ligação marcada pelo cliente cuja hora ainda não chegou (mais próxima primeiro).
    'marcadas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lead_id', x.lead_id, 'nome', x.full_name, 'sdr_id', x.sdr_id, 'sdr_nome', s.name,
               'chegou_em', x.chegou_em, 'marcada_para', x.marcada)
             order by x.marcada)
        from jj x join sdrs s on s.id = x.sdr_id
       where x.marcada_futura), '[]'::jsonb),
    -- Cada cliente atendido no mês: quanto tempo levou e por onde (clique no card).
    'atendidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lead_id', x.lead_id, 'nome', x.full_name, 'sdr_id', x.sdr_id, 'sdr_nome', s.name,
               'chegou_em', x.chegou_em, 'atendido_em', x.toque, 'canal', x.canal,
               'marcada_para', x.marcada,
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
  '0405 (18/11): espera até a 1ª interação — ligação marcada conta a partir da hora marcada; marcadas futuras em lista própria; sem_tarefa no aguardando.';

-- ── KPI "Espera do lead" do Desempenho (qs_desempenho): mesmo início ──────────
do $mig$
declare
  v_def   text := pg_get_functiondef('public.qs_desempenho(date,date)'::regprocedure);
  v_velho text := $t$qs_horas_uteis(c.chegou_em, least(t.primeira, tq.toque), qs_horario_sla() /* 0400: SLA só seg–sex */)$t$;
  v_novo  text := $t$qs_horas_uteis(greatest(c.chegou_em, coalesce(qs_sla_marcada(c.lead_id, c.chegou_em), c.chegou_em)) /* 0405: ligação marcada */, least(t.primeira, tq.toque), qs_horario_sla() /* 0400: SLA só seg–sex */)$t$;
begin
  if position('0405: ligação marcada' in v_def) > 0 then
    raise notice '0405 já aplicada na qs_desempenho';
    return;
  end if;
  if position(v_velho in v_def) = 0 then
    raise exception '0405: a qs_desempenho vigente não tem o trecho do min_1o esperado — conferir antes';
  end if;
  execute replace(v_def, v_velho, v_novo);
end
$mig$;
