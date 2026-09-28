-- =============================================================================
-- 0095 — FUNIL POR SDR: UMA definição por etapa, calculada aqui
-- -----------------------------------------------------------------------------
-- Bruno, 28/09/2026: a Visão Geral vira um FUNIL por SDR — "quantos leads
-- quentes/mornos/frios foram pra cada um, de quais fontes, como está o FUP, de
-- quantas pessoas falaram e quantas geraram reunião, no-show". O gestor enxerga
-- onde cada um perde; o SDR se autoavalia contra a média do time.
--
-- Por que no banco: a Visão Geral antiga calculava show-rate em 5 lugares e
-- conversão em 3 códigos diferentes — o número mudava de tela pra tela. Aqui é
-- o único lugar onde "falou", "marcou" e "aconteceu" são definidos.
--
-- COORTE: os leads que cada SDR RECEBEU no período (qs_lead_entradas, 0094), e
-- o que aconteceu com ELES até agora. Não é "o que o SDR fez no período".
--
-- DEFINIÇÕES
--   trabalhou  = ≥1 atividade concluída
--   falou      = alguma atividade com resultado de conversa (atendeu,
--                sem_interesse, sem_avanco, com_avanco, ganho, gatekeeper,
--                persona_indisponivel) OU o lead tem reunião
--   marcou     = tem reunião tipo "primeira" (remarcação não conta 2x)
--   aconteceu  = alguma dessas reuniões realizada
--   no-show / cancelou = sem realizada, com no_show / cancelada|desistencia
--   futura     = ainda agendada/confirmada
--   1º contato = HORAS ÚTEIS (qs_horas_uteis + work_hours) da chegada até a 1ª
--                atividade concluída. Lead que chega 23h não conta a madrugada.
--                Medido em 28/09: ≤5 min → 22% marcam; 30min–2h → 8,5%.
--
-- ESCOPO: gestor/admin/marketing (e service_role) veem todo mundo. SDR/closer
-- veem a PRÓPRIA linha + os totais do time (pra se comparar), nunca a linha
-- de um colega.
-- =============================================================================

create or replace function qs_funil_sdr(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ini    timestamptz := (p_de::text || ' 00:00:00-03')::timestamptz;
  v_fim    timestamptz := ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz;
  v_hoje0  timestamptz := (((now() at time zone 'America/Sao_Paulo')::date)::text || ' 00:00:00-03')::timestamptz;
  v_gestor boolean := qs_pode_ver_monitor();
  v_eu     uuid := auth.uid();
  v_hor    jsonb := (select value from qs_settings where key = 'work_hours');
  v_out    jsonb;
begin
  if not v_gestor and not exists (select 1 from qs_users where id = v_eu and is_active) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  with c as (
    select e.lead_id, e.sdr_id, e.retorno, e.chegou_em,
           case lower(coalesce(l.lead_score, ''))
             when 'quente' then 'quente' when 'hot' then 'quente'
             when 'morno' then 'morno' when 'warm' then 'morno'
             when 'frio' then 'frio' when 'cold' then 'frio'
             else 'sem' end as temp,
           case qs_canal_da_fonte(l.segment) when 'sem_fonte' then 'outros' else qs_canal_da_fonte(l.segment) end as canal,
           l.status
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
      join qs_users u on u.id = e.sdr_id and u.role = 'sdr'
     where e.chegou_em >= v_ini and e.chegou_em < v_fim
  ),
  t as (
    select c.lead_id,
           count(*) filter (where k.status = 'concluida') as tent,
           min(k.completed_at) filter (where k.status = 'concluida') as primeira,
           bool_or(k.status = 'concluida' and k.contact_result in
             ('atendeu','sem_interesse','sem_avanco','com_avanco','ganho','gatekeeper','persona_indisponivel')) as conversou
      from c join qs_tasks k on k.lead_id = c.lead_id
     group by c.lead_id
  ),
  m as (
    select c.lead_id,
           bool_or(mm.status = 'realizada') as realizou,
           bool_or(mm.status = 'no_show') as noshow,
           bool_or(mm.status in ('cancelada','desistencia')) as cancelou,
           bool_or(mm.status in ('agendada','confirmada')) as futura
      from c join qs_meetings mm on mm.lead_id = c.lead_id and coalesce(mm.tipo, 'primeira') = 'primeira'
     group by c.lead_id
  ),
  j as (
    select c.*,
           coalesce(t.tent, 0) as tent,
           t.primeira is not null and t.tent > 0 as trab,
           (m.lead_id is not null) as marcou,
           coalesce(t.conversou, false) or m.lead_id is not null as falou,
           coalesce(m.realizou, false) as realizou,
           coalesce(m.noshow, false) and not coalesce(m.realizou, false) as noshow,
           coalesce(m.cancelou, false) and not coalesce(m.realizou, false) and not coalesce(m.noshow, false) as cancelou,
           coalesce(m.futura, false) and not coalesce(m.realizou, false) as futura,
           case when t.primeira is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, t.primeira, v_hor)) * 60 end as min_1o
      from c left join t using (lead_id) left join m using (lead_id)
  ),
  -- Uma linha por SDR + uma do time (sdr_id nulo), com a mesma conta.
  agg as (
    select grouping(j.sdr_id) = 1 as eh_time, j.sdr_id,
           count(*) as recebidos,
           count(*) filter (where not j.retorno) as novos,
           count(*) filter (where j.retorno) as retornos,
           count(*) filter (where j.trab) as trabalhou,
           count(*) filter (where j.falou) as falou,
           count(*) filter (where j.marcou) as marcou,
           count(*) filter (where j.realizou) as aconteceu,
           count(*) filter (where j.noshow) as noshow,
           count(*) filter (where j.cancelou) as cancelou,
           count(*) filter (where j.futura) as futura,
           round(avg(j.tent) filter (where j.tent > 0), 1) as tent_media,
           count(*) filter (where j.status = 'em_prospeccao') as em_fup,
           count(*) filter (where j.status = 'perdido') as perdidos,
           count(*) filter (where j.min_1o is not null and not j.retorno) as medidos_1o,
           count(*) filter (where j.min_1o <= 5 and not j.retorno) as ate5min,
           round((percentile_cont(0.5) within group (order by j.min_1o) filter (where not j.retorno))::numeric, 0) as mediana_1o_min,
           jsonb_build_object(
             'quente', jsonb_build_object('n', count(*) filter (where j.temp = 'quente'), 'marcou', count(*) filter (where j.temp = 'quente' and j.marcou)),
             'morno',  jsonb_build_object('n', count(*) filter (where j.temp = 'morno'),  'marcou', count(*) filter (where j.temp = 'morno' and j.marcou)),
             'frio',   jsonb_build_object('n', count(*) filter (where j.temp = 'frio'),   'marcou', count(*) filter (where j.temp = 'frio' and j.marcou)),
             'sem',    jsonb_build_object('n', count(*) filter (where j.temp = 'sem'),    'marcou', count(*) filter (where j.temp = 'sem' and j.marcou))
           ) as temperatura,
           jsonb_build_object(
             'trafego',  jsonb_build_object('n', count(*) filter (where j.canal = 'trafego'),  'marcou', count(*) filter (where j.canal = 'trafego' and j.marcou)),
             'live',     jsonb_build_object('n', count(*) filter (where j.canal = 'live'),     'marcou', count(*) filter (where j.canal = 'live' and j.marcou)),
             'organico', jsonb_build_object('n', count(*) filter (where j.canal = 'organico'), 'marcou', count(*) filter (where j.canal = 'organico' and j.marcou)),
             'outros',   jsonb_build_object('n', count(*) filter (where j.canal = 'outros'),   'marcou', count(*) filter (where j.canal = 'outros' and j.marcou))
           ) as fontes
      from j
     group by grouping sets ((j.sdr_id), ())
  ),
  -- Velocidade do 1º contato × reunião (só leads novos): a prova do relógio.
  velocidade as (
    select faixa, ordem, count(*) as leads, count(*) filter (where marcou) as marcou
      from (
        select j.marcou,
               case when j.min_1o is null then 'sem contato'
                    when j.min_1o <= 5 then 'até 5 min'
                    when j.min_1o <= 30 then '5 a 30 min'
                    when j.min_1o <= 120 then '30 min a 2h'
                    else 'mais de 2h' end as faixa,
               case when j.min_1o is null then 5
                    when j.min_1o <= 5 then 1
                    when j.min_1o <= 30 then 2
                    when j.min_1o <= 120 then 3
                    else 4 end as ordem
          from j where not j.retorno
      ) x
     group by faixa, ordem
  ),
  -- Foto de AGORA (não depende do período): fila e atrasos por pessoa.
  agora as (
    select k.owner_id,
           count(*) filter (where k.scheduled_at < v_hoje0) as atrasadas,
           count(*) filter (where k.scheduled_at < v_hoje0 + interval '1 day') as fila_hoje
      from qs_tasks k
     where k.status = 'pendente'
     group by k.owner_id
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'gestor', v_gestor,
    'time', (select to_jsonb(a) - 'sdr_id' - 'eh_time' from agg a where a.eh_time),
    'sdrs', coalesce((
      select jsonb_agg(to_jsonb(a) - 'eh_time'
               || jsonb_build_object('nome', u.name,
                                     'atrasadas', coalesce(g.atrasadas, 0),
                                     'fila_hoje', coalesce(g.fila_hoje, 0))
               order by u.name)
        from agg a
        join qs_users u on u.id = a.sdr_id
        left join agora g on g.owner_id = a.sdr_id
       where not a.eh_time and (v_gestor or a.sdr_id = v_eu)
    ), '[]'::jsonb),
    'velocidade', coalesce((select jsonb_agg(to_jsonb(v) order by v.ordem) from velocidade v), '[]'::jsonb),
    'closers', case when v_gestor then coalesce((
      select jsonb_agg(jsonb_build_object('nome', u.name, 'desfechos_atrasados', coalesce(g.atrasadas, 0)) order by u.name)
        from qs_users u left join agora g on g.owner_id = u.id
       where u.role = 'closer' and u.is_active
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- A própria fila de quem pergunta (SDR, closer ou gestor): o card "Hoje".
    'eu', jsonb_build_object(
      'atrasadas', coalesce((select atrasadas from agora where owner_id = v_eu), 0),
      'fila_hoje', coalesce((select fila_hoje from agora where owner_id = v_eu), 0)
    )
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function qs_funil_sdr(date, date) from public, anon;
grant execute on function qs_funil_sdr(date, date) to authenticated, service_role;
