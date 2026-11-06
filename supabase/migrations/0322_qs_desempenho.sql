-- 0322_qs_desempenho.sql
-- -----------------------------------------------------------------------------
-- Spec 06/11 "Desempenho SDR + Produto + Cotações", Fase 3: as views 1–14 numa
-- função só. As páginas 1 (Principal) e 2 (Conversão) leem DESTA chamada — o
-- mesmo número sai igual em todo lugar porque vem da mesma conta.
--
-- Definições (seção 2 da spec), adaptadas ao QS:
--  * Reunião do SDR  = lead distinto com reunião ORIGINAL (reagendado_de nulo)
--    criada pelo SDR no período. A remarcação é a mesma reunião: segue a cadeia
--    (mesmo SDR + lead, criadas depois) até o estado final. 'arquivada' (0072)
--    não conta em indicador nenhum como original.
--  * R.R             = alguma reunião da cadeia com realizada_em ou SAL preenchido.
--  * Destino (exclusivo): rr | futura | no_show | cancelada | sem_desfecho.
--  * Reagendamento   = cadeia com mais de uma reunião ou status 'reagendada'.
--  * SAL             = aceitas ÷ R.R.
--  * Comparecimento  = R.R ÷ (R.R + no-show + sem desfecho) — as que já passaram,
--    sem futuras e sem canceladas (cancelada não tinha como comparecer).
--  * For-cash reunião = R.R com SAL aceito: venda_valor do negócio, senão o
--    preco_venda_brl da expedição. Sem valor → conta em forcash_sem_valor.
--  * For-cash próprio = valor_emitido das cotações aprovadas no período que o
--    SDR cotou (não repassadas). Repassadas aprovadas saem à parte.
--  * SLA 1º contato  = horas úteis (work_hours) da entrada até a 1ª atividade
--    concluída — a MESMA conta da 0095. Meta: qs_settings 'sla_1o_contato_min'
--    (padrão 30).
-- -----------------------------------------------------------------------------

create or replace function public.qs_desempenho(p_de date, p_ate date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ini    timestamptz := (p_de::text || ' 00:00:00-03')::timestamptz;
  v_fim    timestamptz := ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz;
  v_hoje0  timestamptz := (((now() at time zone 'America/Sao_Paulo')::date)::text || ' 00:00:00-03')::timestamptz;
  v_amanha timestamptz := v_hoje0 + interval '1 day';
  v_gestor boolean := qs_pode_ver_monitor();
  v_eu     uuid := auth.uid();
  v_hor    jsonb := (select value from qs_settings where key = 'work_hours');
  v_meta   numeric := coalesce((select nullif(value #>> '{}', '')::numeric from qs_settings where key = 'sla_1o_contato_min'), 30);
  v_out    jsonb;
begin
  if not v_gestor and not exists (select 1 from qs_users where id = v_eu and is_active) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  with
  sdrs as (
    select u.id, u.name from qs_users u where u.role = 'sdr'
  ),
  -- ── Reuniões: uma linha por (SDR, lead) marcada no período ─────────────────
  orig as (
    select m.owner_id as sdr_id, m.lead_id, min(m.created_at) as t0
      from qs_meetings m join sdrs s on s.id = m.owner_id
     where m.reagendado_de is null and m.status <> 'arquivada'
       and m.created_at >= v_ini and m.created_at < v_fim
       and m.lead_id is not null
     group by 1, 2
  ),
  cadeia as (
    select o.sdr_id, m.lead_id, m.created_at, m.status, m.scheduled_at, m.produto, m.produto_inferido, m.expedicao_id,
           m.realizada_em, m.sal, m.venda_valor
      from orig o
      join qs_meetings m on m.lead_id = o.lead_id and m.owner_id = o.sdr_id and m.created_at >= o.t0
  ),
  fin as (
    select distinct on (sdr_id, lead_id) sdr_id, lead_id, status, scheduled_at, produto, produto_inferido, expedicao_id
      from cadeia order by sdr_id, lead_id, created_at desc
  ),
  r as (
    select c.sdr_id, c.lead_id,
           bool_or(c.realizada_em is not null or c.sal is not null) as rr,
           bool_or(c.sal = 'aceito') as sal_ok,
           bool_or(c.sal = 'recusado') and not bool_or(c.sal = 'aceito') as sal_no,
           count(*) > 1 or bool_or(c.status = 'reagendada') as reag,
           max(c.venda_valor) filter (where c.venda_valor > 0) as venda
      from cadeia c group by 1, 2
  ),
  reu as (
    select r.*, f.produto::text as produto, f.produto_inferido as inferido, f.scheduled_at,
           case when r.rr then 'rr'
                when f.status in ('agendada','confirmada') and f.scheduled_at >= now() then 'futura'
                when f.status = 'no_show' then 'no_show'
                when f.status in ('cancelada','desistencia') then 'cancelada'
                else 'sem_desfecho' end as destino,
           case when r.sal_ok then coalesce(r.venda, nullif(e.preco_venda_brl, 0)) end as valor
      from r join fin f using (sdr_id, lead_id)
      left join expedicoes e on e.id = f.expedicao_id
  ),
  reu_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) as marcadas,
           count(*) filter (where destino = 'rr') as rr,
           count(*) filter (where destino = 'futura') as futuras,
           count(*) filter (where destino = 'no_show') as no_show,
           count(*) filter (where destino = 'cancelada') as canceladas,
           count(*) filter (where destino = 'sem_desfecho') as sem_desfecho,
           count(*) filter (where reag) as reagendadas,
           count(*) filter (where sal_ok) as sal_aceito,
           count(*) filter (where sal_no) as sal_recusado,
           count(*) filter (where inferido) as inferidas,
           coalesce(sum(valor), 0) as forcash_reunioes,
           count(*) filter (where sal_ok and valor is null) as forcash_sem_valor
      from reu group by grouping sets ((sdr_id), ())
  ),
  prod_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id, produto,
           count(*) as marcadas,
           count(*) filter (where destino = 'rr') as rr,
           count(*) filter (where destino = 'no_show') as no_show,
           count(*) filter (where sal_ok) as sal_aceito,
           count(*) filter (where sal_no) as sal_recusado,
           count(*) filter (where inferido) as inferidas,
           coalesce(sum(valor), 0) as forcash
      from reu group by grouping sets ((sdr_id, produto), (produto))
  ),
  -- Reuniões que acontecem HOJE (agenda do dia, não marcação)
  hoje_reu as (
    select m.owner_id as sdr_id,
           count(*) as hoje,
           count(*) filter (where m.status = 'confirmada') as hoje_confirmadas
      from qs_meetings m join sdrs s on s.id = m.owner_id
     where m.scheduled_at >= v_hoje0 and m.scheduled_at < v_amanha
       and m.status not in ('reagendada','cancelada','desistencia','arquivada')
     group by 1
  ),
  -- ── Coorte de leads que chegaram (a mesma da 0095) ─────────────────────────
  c as (
    select e.lead_id, e.sdr_id, e.retorno, e.chegou_em,
           case lower(coalesce(l.temperatura_sdr, l.lead_score, ''))
             when 'quente' then 'quente' when 'hot' then 'quente'
             when 'morno' then 'morno' when 'warm' then 'morno'
             when 'frio' then 'frio' when 'cold' then 'frio'
             else 'sem' end as temp,
           case qs_canal_da_fonte(l.segment) when 'sem_fonte' then 'outros' else qs_canal_da_fonte(l.segment) end as canal,
           l.status
      from qs_lead_entradas e
      join qs_leads l on l.id = e.lead_id
      join sdrs u on u.id = e.sdr_id
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
  mm as (
    select c.lead_id,
           bool_or(m.realizada_em is not null or m.sal is not null) as realizou
      from c join qs_meetings m on m.lead_id = c.lead_id
       and coalesce(m.tipo, 'primeira') = 'primeira' and m.status <> 'arquivada'
     group by c.lead_id
  ),
  j as (
    select c.*,
           t.primeira is not null and t.tent > 0 as trab,
           (mm.lead_id is not null) as marcou,
           coalesce(t.conversou, false) or mm.lead_id is not null as falou,
           coalesce(mm.realizou, false) as realizou,
           case when t.primeira is not null
                then greatest(0, qs_horas_uteis(c.chegou_em, t.primeira, v_hor)) * 60 end as min_1o
      from c left join t using (lead_id) left join mm using (lead_id)
  ),
  funil as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) as recebeu,
           count(*) filter (where trab) as trabalhou,
           count(*) filter (where falou) as falou,
           count(*) filter (where marcou) as marcou,
           count(*) filter (where realizou) as aconteceu,
           count(*) filter (where min_1o is not null and not retorno) as sla_medidos,
           count(*) filter (where min_1o <= v_meta and not retorno) as sla_na_meta,
           round((percentile_cont(0.5) within group (order by min_1o) filter (where not retorno))::numeric, 0) as sla_mediana_min
      from j group by grouping sets ((sdr_id), ())
  ),
  fonte as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id, canal as chave, count(*) as leads, count(*) filter (where marcou) as marcou
      from j group by grouping sets ((sdr_id, canal), (canal))
  ),
  temp as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id, temp as chave, count(*) as leads, count(*) filter (where marcou) as marcou
      from j group by grouping sets ((sdr_id, temp), (temp))
  ),
  velocidade as (
    select faixa, ordem, count(*) as leads, count(*) filter (where marcou) as marcou
      from (select marcou,
                   case when min_1o is null then 'sem contato' when min_1o <= 5 then 'até 5 min'
                        when min_1o <= 30 then '5 a 30 min' when min_1o <= 120 then '30 min a 2h' else 'mais de 2h' end as faixa,
                   case when min_1o is null then 5 when min_1o <= 5 then 1 when min_1o <= 30 then 2 when min_1o <= 120 then 3 else 4 end as ordem
              from j where not retorno) x
     group by faixa, ordem
  ),
  -- ── Agora: cadência, atividades do dia, pendências ─────────────────────────
  abertas as (
    select distinct on (k.lead_id) k.lead_id, k.owner_id as sdr_id, k.scheduled_at,
           (select nullif(regexp_replace(x, '^dia:', ''), '')::int from unnest(k.tags) x where x ~ '^dia:\d+$' limit 1) as dia_tag,
           l.arrived_at, l.created_at as lead_criado
      from qs_tasks k
      join qs_leads l on l.id = k.lead_id and l.status not in ('ganho','perdido')
      join sdrs s on s.id = k.owner_id
     where k.status in ('pendente','atrasada')
     order by k.lead_id, k.scheduled_at
  ),
  cad as (
    select sdr_id,
           coalesce(dia_tag, greatest(1, ((scheduled_at at time zone 'America/Sao_Paulo')::date
                                          - (coalesce(arrived_at, lead_criado) at time zone 'America/Sao_Paulo')::date) + 1)) as fup,
           scheduled_at < v_hoje0 as atrasada,
           ((v_hoje0 at time zone 'America/Sao_Paulo')::date - (scheduled_at at time zone 'America/Sao_Paulo')::date) as dias_parada
      from abertas
  ),
  cad_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) as em_trabalho,
           count(*) filter (where atrasada) as leads_atrasados,
           coalesce(max(dias_parada) filter (where atrasada), 0) as mais_antiga_dias,
           jsonb_build_array(
             jsonb_build_object('faixa','FUP 1',    'em_dia', count(*) filter (where fup = 1 and not atrasada),               'atrasadas', count(*) filter (where fup = 1 and atrasada)),
             jsonb_build_object('faixa','FUP 2–5',  'em_dia', count(*) filter (where fup between 2 and 5 and not atrasada),   'atrasadas', count(*) filter (where fup between 2 and 5 and atrasada)),
             jsonb_build_object('faixa','FUP 6–10', 'em_dia', count(*) filter (where fup between 6 and 10 and not atrasada),  'atrasadas', count(*) filter (where fup between 6 and 10 and atrasada)),
             jsonb_build_object('faixa','FUP 11–20','em_dia', count(*) filter (where fup between 11 and 20 and not atrasada), 'atrasadas', count(*) filter (where fup between 11 and 20 and atrasada)),
             jsonb_build_object('faixa','FUP 21–29','em_dia', count(*) filter (where fup between 21 and 29 and not atrasada), 'atrasadas', count(*) filter (where fup between 21 and 29 and atrasada)),
             jsonb_build_object('faixa','FUP 30+',  'em_dia', count(*) filter (where fup >= 30 and not atrasada),             'atrasadas', count(*) filter (where fup >= 30 and atrasada))
           ) as faixas
      from cad group by grouping sets ((sdr_id), ())
  ),
  fim_cad as (
    select grouping(l.owner_id) = 1 as eh_time, l.owner_id as sdr_id, count(*) as fim_cadencia
      from qs_leads l join sdrs s on s.id = l.owner_id
     where l.status = 'em_prospeccao'
       and not exists (select 1 from qs_tasks k where k.lead_id = l.id and k.status in ('pendente','atrasada'))
     group by grouping sets ((l.owner_id), ())
  ),
  ativ as (
    select grouping(k.owner_id) = 1 as eh_time, k.owner_id as sdr_id,
           count(*) filter (where k.scheduled_at >= v_hoje0 and k.scheduled_at < v_amanha and k.status <> 'ignorada') as programadas,
           count(*) filter (where k.completed_at >= v_hoje0 and k.completed_at < v_amanha and k.status = 'concluida') as concluidas,
           count(*) filter (where k.status in ('pendente','atrasada') and k.scheduled_at < v_hoje0) as atrasadas
      from qs_tasks k join sdrs s on s.id = k.owner_id
     where (k.scheduled_at < v_amanha and k.status in ('pendente','atrasada'))
        or (k.scheduled_at >= v_hoje0 and k.scheduled_at < v_amanha)
        or (k.completed_at >= v_hoje0 and k.completed_at < v_amanha)
     group by grouping sets ((k.owner_id), ())
  ),
  sem_1o as (
    select grouping(l.owner_id) = 1 as eh_time, l.owner_id as sdr_id, count(*) as sem_1o_contato
      from qs_leads l join sdrs s on s.id = l.owner_id
     where l.status in ('nao_iniciado','em_prospeccao')
       and coalesce(l.arrived_at, l.created_at) >= now() - interval '30 days'
       and not exists (select 1 from qs_tasks k where k.lead_id = l.id and k.status = 'concluida')
     group by grouping sets ((l.owner_id), ())
  ),
  por_conf as (
    select grouping(m.owner_id) = 1 as eh_time, m.owner_id as sdr_id, count(*) as por_confirmar
      from qs_meetings m join sdrs s on s.id = m.owner_id
     where m.status = 'agendada' and m.scheduled_at >= now() and m.scheduled_at < v_amanha + interval '1 day'
     group by grouping sets ((m.owner_id), ())
  ),
  -- Desfecho pendente do closer: passou (2h de folga) e ninguém registrou.
  pend_closer as (
    select m.closer_id, m.owner_id as sdr_id
      from qs_meetings m
     where m.status in ('agendada','confirmada') and m.scheduled_at < now() - interval '2 hours'
       and m.closer_id is not null and m.sal is null
  ),
  -- ── Cotações ───────────────────────────────────────────────────────────────
  cot as (
    select q.*, qs_horas_uteis(q.solicitada_em, q.entregue_em, v_hor) as h_entrega
      from cotacoes q
  ),
  cot_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) filter (where solicitada_em >= v_ini and solicitada_em < v_fim) as solicitadas,
           count(*) filter (where entregue_em >= v_ini and entregue_em < v_fim) as entregues,
           count(*) filter (where entregue_em >= v_hoje0 and entregue_em < v_amanha) as entregues_hoje,
           count(*) filter (where status = 'aprovada' and decidida_em >= v_ini and decidida_em < v_fim) as aprovadas,
           count(*) filter (where status = 'perdida' and decidida_em >= v_ini and decidida_em < v_fim) as perdidas,
           count(*) filter (where status = 'entregue' and validade_ate < now()) as vencidas,
           count(*) filter (where status in ('solicitada','em_cotacao')) as abertas,
           count(*) filter (where repassada_closer and solicitada_em >= v_ini and solicitada_em < v_fim) as repassadas,
           round((percentile_cont(0.5) within group (order by h_entrega) filter (where entregue_em >= v_ini and entregue_em < v_fim))::numeric, 1) as sla_mediana_h,
           round((percentile_cont(0.9) within group (order by h_entrega) filter (where entregue_em >= v_ini and entregue_em < v_fim))::numeric, 1) as sla_p90_h,
           coalesce(sum(valor_emitido) filter (where status = 'aprovada' and not repassada_closer and decidida_em >= v_ini and decidida_em < v_fim), 0) as forcash_proprio,
           coalesce(sum(valor_emitido) filter (where status = 'aprovada' and repassada_closer and decidida_em >= v_ini and decidida_em < v_fim), 0) as forcash_repassado
      from cot group by grouping sets ((sdr_id), ())
  ),
  cot_perda as (
    select motivo_perda::text as motivo, count(*) as n
      from cot where status = 'perdida' and decidida_em >= v_ini and decidida_em < v_fim
     group by 1
  ),
  cot_closer as (
    select responsavel_id, count(*) as recebidas,
           count(*) filter (where status = 'aprovada') as aprovadas,
           coalesce(sum(valor_emitido) filter (where status = 'aprovada'), 0) as valor
      from cot where repassada_closer and solicitada_em >= v_ini and solicitada_em < v_fim
     group by 1
  ),
  -- ── Linha por SDR (tudo junto, pra os cards) ───────────────────────────────
  linha as (
    select s.id as sdr_id, s.name as nome,
           to_jsonb(ra) - 'eh_time' - 'sdr_id' as reunioes,
           coalesce(h.hoje, 0) as reunioes_hoje, coalesce(h.hoje_confirmadas, 0) as reunioes_hoje_confirmadas,
           to_jsonb(fu) - 'eh_time' - 'sdr_id' as funil,
           to_jsonb(ca) - 'eh_time' - 'sdr_id' as cadencia,
           coalesce(fc.fim_cadencia, 0) as fim_cadencia,
           to_jsonb(av) - 'eh_time' - 'sdr_id' as atividades,
           coalesce(s1.sem_1o_contato, 0) as sem_1o_contato,
           coalesce(pc.por_confirmar, 0) as por_confirmar,
           (select count(*) from pend_closer p where p.sdr_id = s.id) as desfechos_pendentes,
           to_jsonb(co) - 'eh_time' - 'sdr_id' as cotacoes,
           coalesce((select jsonb_agg(to_jsonb(p) - 'eh_time' - 'sdr_id' order by p.marcadas desc)
                       from prod_agg p where not p.eh_time and p.sdr_id = s.id), '[]'::jsonb) as produtos,
           coalesce((select jsonb_object_agg(f.chave, jsonb_build_object('leads', f.leads, 'marcou', f.marcou))
                       from fonte f where not f.eh_time and f.sdr_id = s.id), '{}'::jsonb) as fontes,
           coalesce((select jsonb_object_agg(x.chave, jsonb_build_object('leads', x.leads, 'marcou', x.marcou))
                       from temp x where not x.eh_time and x.sdr_id = s.id), '{}'::jsonb) as temperaturas
      from sdrs s
      left join reu_agg ra on not ra.eh_time and ra.sdr_id = s.id
      left join hoje_reu h on h.sdr_id = s.id
      left join funil fu on not fu.eh_time and fu.sdr_id = s.id
      left join cad_agg ca on not ca.eh_time and ca.sdr_id = s.id
      left join fim_cad fc on not fc.eh_time and fc.sdr_id = s.id
      left join ativ av on not av.eh_time and av.sdr_id = s.id
      left join sem_1o s1 on not s1.eh_time and s1.sdr_id = s.id
      left join por_conf pc on not pc.eh_time and pc.sdr_id = s.id
      left join cot_agg co on not co.eh_time and co.sdr_id = s.id
     where (ra.sdr_id is not null or fu.sdr_id is not null or ca.sdr_id is not null or co.sdr_id is not null
            or exists (select 1 from qs_users u where u.id = s.id and u.is_active))
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'gestor', v_gestor, 'meta_sla_min', v_meta, 'gerado_em', now(),
    'time', jsonb_build_object(
      'reunioes',   coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from reu_agg a where a.eh_time), '{}'::jsonb),
      'reunioes_hoje', coalesce((select sum(hoje) from hoje_reu), 0),
      'reunioes_hoje_confirmadas', coalesce((select sum(hoje_confirmadas) from hoje_reu), 0),
      'funil',      coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from funil a where a.eh_time), '{}'::jsonb),
      'cadencia',   coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from cad_agg a where a.eh_time), '{}'::jsonb),
      'fim_cadencia', coalesce((select fim_cadencia from fim_cad where eh_time), 0),
      'atividades', coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from ativ a where a.eh_time), '{}'::jsonb),
      'sem_1o_contato', coalesce((select sem_1o_contato from sem_1o where eh_time), 0),
      'por_confirmar', coalesce((select por_confirmar from por_conf where eh_time), 0),
      'desfechos_pendentes', (select count(*) from pend_closer),
      'cotacoes',   coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from cot_agg a where a.eh_time), '{}'::jsonb),
      'produtos',   coalesce((select jsonb_agg(to_jsonb(p) - 'eh_time' - 'sdr_id' order by p.marcadas desc) from prod_agg p where p.eh_time), '[]'::jsonb),
      'fontes',     coalesce((select jsonb_object_agg(f.chave, jsonb_build_object('leads', f.leads, 'marcou', f.marcou)) from fonte f where f.eh_time), '{}'::jsonb),
      'temperaturas', coalesce((select jsonb_object_agg(x.chave, jsonb_build_object('leads', x.leads, 'marcou', x.marcou)) from temp x where x.eh_time), '{}'::jsonb)
    ),
    'sdrs', coalesce((select jsonb_agg(to_jsonb(l) order by l.nome) from linha l where v_gestor or l.sdr_id = v_eu), '[]'::jsonb),
    'velocidade', coalesce((select jsonb_agg(to_jsonb(v) order by v.ordem) from velocidade v), '[]'::jsonb),
    'cotacoes_perda', coalesce((select jsonb_agg(to_jsonb(p) order by p.n desc) from cot_perda p), '[]'::jsonb),
    'cotacoes_closers', case when v_gestor then coalesce((
        select jsonb_agg(to_jsonb(x) - 'responsavel_id' || jsonb_build_object('nome', u.name) order by x.recebidas desc)
          from cot_closer x join qs_users u on u.id = x.responsavel_id), '[]'::jsonb) else '[]'::jsonb end,
    'closers_pendentes', case when v_gestor then coalesce((
        select jsonb_agg(jsonb_build_object('nome', u.name, 'pendentes', n) order by n desc)
          from (select closer_id, count(*) as n from pend_closer group by 1) p join qs_users u on u.id = p.closer_id), '[]'::jsonb) else '[]'::jsonb end
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.qs_desempenho(date, date) from public, anon;
grant execute on function public.qs_desempenho(date, date) to authenticated;

comment on function public.qs_desempenho(date, date) is
  'Spec 06/11 (views 1–14): desempenho SDR + produto + cotações numa chamada. Páginas 1 e 2 do Desempenho leem daqui.';
