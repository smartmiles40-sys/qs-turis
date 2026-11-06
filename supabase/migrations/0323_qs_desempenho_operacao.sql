-- 0323_qs_desempenho_operacao.sql
-- -----------------------------------------------------------------------------
-- Spec 06/11, Fase 5 (views 15, 17 e 18; a 16 — faixas de velocidade do 1º
-- contato — já sai do qs_desempenho da 0322, mesma coorte).
-- Fonte das ligações: qs_call_logs. O webfone (WebRTC/BravoTech) já grava UMA
-- linha por chamada com lead, SDR (owner_id), atendida e duração — então não
-- precisou de ingestão nova; as gravações (qs_ligacao_gravacoes) entram só na
-- lista de "ligações recentes".
--
--  15 ligacoes : ligações, % atendidas, tempo médio quando atende, total em
--                conversa, tentativas até a 1ª conversa e tempo (horas úteis)
--                da entrada até a 1ª conversa — dos leads que chegaram no período.
--  17 entrada  : leads recebidos por dia (fim de semana marcado).
--  18 heatmap  : taxa de atendimento por dia da semana × hora (8h–20h).
-- p_sdr null = time todo. SDR que não é gestor só vê a si mesmo.
-- -----------------------------------------------------------------------------

create or replace function public.qs_desempenho_operacao(p_de date, p_ate date, p_sdr uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ini    timestamptz := (p_de::text || ' 00:00:00-03')::timestamptz;
  v_fim    timestamptz := ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz;
  v_gestor boolean := qs_pode_ver_monitor();
  v_eu     uuid := auth.uid();
  v_sdr    uuid := p_sdr;
  v_hor    jsonb := (select value from qs_settings where key = 'work_hours');
  v_out    jsonb;
begin
  if not v_gestor then
    if not exists (select 1 from qs_users where id = v_eu and is_active) then
      raise exception 'Sem permissão' using errcode = '42501';
    end if;
    v_sdr := v_eu;
  end if;

  with
  sdrs as (select id, name from qs_users where role = 'sdr' and (v_sdr is null or id = v_sdr)),
  lig as (
    select l.owner_id as sdr_id, l.lead_id, l.answered, coalesce(l.duration_sec, 0) as dur, l.created_at,
           (l.created_at at time zone 'America/Sao_Paulo') as local
      from qs_call_logs l join sdrs s on s.id = l.owner_id
     where l.created_at >= v_ini and l.created_at < v_fim
  ),
  lig_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) as ligacoes,
           count(*) filter (where answered) as atendidas,
           round(avg(dur) filter (where answered))::int as media_atendida_seg,
           coalesce(sum(dur) filter (where answered), 0) as total_conversa_seg,
           count(distinct lead_id) as leads_ligados
      from lig group by grouping sets ((sdr_id), ())
  ),
  -- Coorte: leads que chegaram no período → tentativas e tempo até a 1ª conversa
  coorte as (
    select e.lead_id, e.sdr_id, e.chegou_em
      from qs_lead_entradas e join sdrs s on s.id = e.sdr_id
     where e.chegou_em >= v_ini and e.chegou_em < v_fim and not e.retorno
  ),
  primeira as (
    select c.lead_id, c.sdr_id, c.chegou_em,
           (select min(l.created_at) from qs_call_logs l
             where l.lead_id = c.lead_id and l.answered and l.created_at >= c.chegou_em) as conversa_em
      from coorte c
  ),
  tent as (
    select p.*,
           (select count(*) from qs_call_logs l
             where l.lead_id = p.lead_id and l.created_at >= p.chegou_em
               and l.created_at <= coalesce(p.conversa_em, p.chegou_em - interval '1 second')) as tentativas
      from primeira p
  ),
  tent_agg as (
    select grouping(sdr_id) = 1 as eh_time, sdr_id,
           count(*) as leads_coorte,
           count(*) filter (where conversa_em is not null) as com_conversa,
           round(avg(tentativas) filter (where conversa_em is not null), 1) as tentativas_ate_conversa,
           round((percentile_cont(0.5) within group (order by qs_horas_uteis(chegou_em, conversa_em, v_hor))
                  filter (where conversa_em is not null))::numeric, 2) as horas_ate_conversa
      from tent group by grouping sets ((sdr_id), ())
  ),
  entrada as (
    select (e.chegou_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as leads,
           count(*) filter (where not e.retorno) as novos
      from qs_lead_entradas e join sdrs s on s.id = e.sdr_id
     where e.chegou_em >= v_ini and e.chegou_em < v_fim
     group by 1
  ),
  heat as (
    select extract(isodow from local)::int as dow, extract(hour from local)::int as hora,
           count(*) as ligacoes, count(*) filter (where answered) as atendidas
      from lig where extract(hour from local) between 8 and 20
     group by 1, 2
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'gestor', v_gestor, 'sdr_id', v_sdr,
    'time', jsonb_build_object(
      'ligacoes', coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from lig_agg a where a.eh_time), '{}'::jsonb),
      'conversa', coalesce((select to_jsonb(a) - 'eh_time' - 'sdr_id' from tent_agg a where a.eh_time), '{}'::jsonb)
    ),
    'sdrs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sdr_id', s.id, 'nome', s.name,
               'ligacoes', coalesce(to_jsonb(a) - 'eh_time' - 'sdr_id', '{}'::jsonb),
               'conversa', coalesce(to_jsonb(t) - 'eh_time' - 'sdr_id', '{}'::jsonb)) order by s.name)
        from sdrs s
        left join lig_agg a on not a.eh_time and a.sdr_id = s.id
        left join tent_agg t on not t.eh_time and t.sdr_id = s.id
       where a.sdr_id is not null or t.sdr_id is not null), '[]'::jsonb),
    'entrada_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'dow', extract(isodow from d.dia)::int,
                                          'leads', coalesce(e.leads, 0), 'novos', coalesce(e.novos, 0)) order by d.dia)
        from generate_series(p_de, p_ate, interval '1 day') g(x)
        cross join lateral (select g.x::date as dia) d
        left join entrada e on e.dia = d.dia), '[]'::jsonb),
    'heatmap', coalesce((select jsonb_agg(to_jsonb(h) order by h.dow, h.hora) from heat h), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.qs_desempenho_operacao(date, date, uuid) from public, anon;
grant execute on function public.qs_desempenho_operacao(date, date, uuid) to authenticated;

create index if not exists idx_qs_call_logs_lead_created on public.qs_call_logs (lead_id, created_at);
create index if not exists idx_qs_call_logs_owner_created on public.qs_call_logs (owner_id, created_at);
