-- supabase/migrations/0400_sla_painel.sql
-- -----------------------------------------------------------------------------
-- SLA DO 1º ATENDIMENTO NA FILA DE HOJE + QUADRO POR SDR (Bruno, 17/11/2026)
--   "Na tela principal eles têm que ter o SLA do dia deles e em desempenho deve
--    ter o SLA para olharem diariamente, semanalmente e mensalmente."
--
-- Uma chamada devolve, por SDR e pro time, HOJE / SEMANA (seg→hoje) / MÊS:
--   recebidos   = leads novos que chegaram pra ele (qs_lead_entradas, sem retorno)
--   atendidos   = já teve o 1º toque
--   na_meta     = 1º toque em até `meta_min` minutos ÚTEIS (work_hours)
--   fora_meta   = atendido depois da meta  +  ainda esperando e JÁ passou da meta
--                 (quem não atende não "melhora" o SLA por omissão)
--   aguardando  = ainda sem toque
--   mediana_min = mediana do tempo útil até o 1º toque (só atendidos)
-- e a lista de leads AGUARDANDO o 1º atendimento (últimos 7 dias), com o tempo
-- útil já corrido — é o alerta da Fila de hoje.
--
-- 1º toque = o que vier primeiro, sempre DEPOIS da chegada (mesma regra da 0353):
--   tarefa concluída · ligação do webfone · WhatsApp enviado pela linha do SDR.
-- Meta: qs_settings 'sla_1o_contato_min' (padrão 30).
-- SÓ DIA DE SEMANA (Bruno, 17/11): "sábado não é pra contar o SLA". O relógio
-- usa o work_hours com sábado e domingo desligados — lead que chega na sexta à
-- noite ou no fim de semana começa a contar na segunda de manhã. O work_hours
-- em si NÃO muda (ele também libera as atividades de sábado).
-- SDR comum vê só a própria linha; gestor (qs_pode_ver_monitor) vê todos.
-- Só leitura, nenhum dado é alterado. Volta: drop function public.qs_sla_painel(),
-- public.qs_horario_sla() e trocar o texto de volta na qs_desempenho.
-- -----------------------------------------------------------------------------

-- Horário do SLA = work_hours sem sábado (6) e domingo (0).
create or replace function public.qs_horario_sla()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when w is null then null
              else jsonb_set(jsonb_set(w, '{6,enabled}', 'false'::jsonb, true), '{0,enabled}', 'false'::jsonb, true) end
    from (select (select value from qs_settings where key = 'work_hours') as w) x
$$;
revoke all on function public.qs_horario_sla() from public, anon;
grant execute on function public.qs_horario_sla() to authenticated;

create or replace function public.qs_sla_painel()
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
  v_ini := least(v_mes0, v_hoje0 - interval '7 days');

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
    select c.*, tq.toque,
           case when tq.toque is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, tq.toque, v_hor)) * 60
                else greatest(0, qs_horas_uteis(c.chegou_em, now(), v_hor)) * 60 end as minutos
      from c
      left join lateral (
        select least(
          (select min(k.completed_at) from qs_tasks k
            where k.lead_id = c.lead_id and k.status = 'concluida' and k.completed_at >= c.chegou_em),
          (select min(l.created_at) from qs_call_logs l
            where l.lead_id = c.lead_id and l.created_at >= c.chegou_em),
          (select min(coalesce(m.sent_at, m.created_at)) from qs_wa_messages m
            where m.lead_id = c.lead_id and m.direction = 'out'
              and m.linha_user_id is not null and m.deleted_at is null
              and coalesce(m.status, '') <> 'failed'
              and coalesce(m.sent_at, m.created_at) >= c.chegou_em)
        ) as toque
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
    select 'hoje' as p, v_hoje0 as ini union all
    select 'semana', v_sem0 union all
    select 'mes', v_mes0
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
      from per join jj on jj.chegou_em >= per.ini
     group by grouping sets ((per.p, jj.sdr_id), (per.p))
  ),
  vazio as (
    select jsonb_build_object('recebidos',0,'atendidos',0,'na_meta',0,'fora_meta',0,'aguardando',0,'mediana_min',null) as b
  )
  select jsonb_build_object(
    'meta_min', v_meta,
    'gestor', v_gestor,
    'gerado_em', now(),
    'time', jsonb_build_object(
      'hoje',   coalesce((select b from agg where eh_time and p = 'hoje'),   (select b from vazio)),
      'semana', coalesce((select b from agg where eh_time and p = 'semana'), (select b from vazio)),
      'mes',    coalesce((select b from agg where eh_time and p = 'mes'),    (select b from vazio))),
    'sdrs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sdr_id', s.id, 'nome', s.name,
               'hoje',   coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'hoje'),   (select b from vazio)),
               'semana', coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'semana'), (select b from vazio)),
               'mes',    coalesce((select b from agg a where not a.eh_time and a.sdr_id = s.id and a.p = 'mes'),    (select b from vazio)))
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
        join sdrs s on s.id = x.sdr_id), '[]'::jsonb)
  ) into v_out;

  return v_out;
end
$function$;

revoke all on function public.qs_sla_painel() from public, anon;
grant execute on function public.qs_sla_painel() to authenticated;

comment on function public.qs_sla_painel() is
  '0400 (17/11): SLA do 1º atendimento por SDR — hoje/semana/mês + leads aguardando o 1º toque. Fila de hoje e Desempenho leem daqui.';

-- ── O KPI antigo do Desempenho (qs_desempenho, 0353) segue a mesma regra ──────
-- Troca de texto na função VIGENTE, só no cálculo do min_1o (cotações e o resto
-- continuam no work_hours normal). Com trava: se o trecho não estiver lá, falha.
do $mig$
declare
  v_def   text := pg_get_functiondef('public.qs_desempenho(date,date)'::regprocedure);
  v_velho text := $t$qs_horas_uteis(c.chegou_em, least(t.primeira, tq.toque), v_hor)$t$;
  v_novo  text := $t$qs_horas_uteis(c.chegou_em, least(t.primeira, tq.toque), qs_horario_sla() /* 0400: SLA só seg–sex */)$t$;
begin
  if position('0400: SLA só seg–sex' in v_def) > 0 then
    raise notice '0400 já aplicada na qs_desempenho';
    return;
  end if;
  if position(v_velho in v_def) = 0 then
    raise exception '0400: a qs_desempenho vigente não tem o trecho do min_1o esperado — conferir antes';
  end if;
  execute replace(v_def, v_velho, v_novo);
end
$mig$;
