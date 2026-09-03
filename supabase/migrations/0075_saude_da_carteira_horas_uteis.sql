-- 0075_saude_da_carteira_horas_uteis.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--    Depende da 0074 (qs_nota_velocidade).
--
-- -- O DEFEITO QUE ESTA MIGRATION CONSERTA ------------------------------------
--
-- A 0074 media o tempo ate a primeira atividade em horas de RELOGIO. A serie
-- de 14 dias entregou a prova de que isso estava errado: 23/08 e 30/08 (dois
-- DOMINGOS) apareciam com nota 21 e 33, enquanto os dias uteis ficavam em 85+.
--
-- Nao era a pessoa piorando no domingo. Era o lead chegando no domingo e sendo
-- trabalhado na segunda de manha — 20 horas de relogio, ~0 hora de expediente.
-- A metrica estava cobrando trabalho num dia em que ninguem trabalha, e uma
-- metrica que faz isso perde a credibilidade do time na primeira semana.
--
-- O QS ja resolve isso em todo lugar (o atraso da fila conta dias UTEIS, a
-- tarefa de sexta vista na segunda e 1 dia de atraso e nao 3). A Saude da
-- Carteira passa a seguir a mesma regra, lendo o mesmo qs_settings.work_hours.
--
-- -- EFEITO MEDIDO (03/09/2026, 30 dias) --------------------------------------
--
--   Victor Hugo   1,7h de relogio -> 0,6h uteis
--   Yanca         1,1h            -> 0,9h
--   Mariana       3,6h            -> 1,3h
--
-- A ordem mudou: em horas uteis o Victor Hugo passa a Yanca, e a Mariana deixa
-- de parecer tres vezes mais lenta que o time — ela estava recebendo mais lead
-- fora do expediente, nao demorando mais pra atender.
--
-- Por isso a regua padrao do app tambem apertou junto (0,5h / 1h / 4h / 16h):
-- com a medida corrigida, a antiga deixava todo mundo em 83-90 e a nota parava
-- de dizer qualquer coisa.
-- ---------------------------------------------------------------------------


-- -- (1) HORAS UTEIS ENTRE DOIS INSTANTES --------------------------------------
--
-- Soma a interseccao do intervalo com a janela de cada dia habilitado em
-- qs_settings.work_hours. Domingo desligado nao conta nada; a noite entre um
-- expediente e o outro tambem nao.
create or replace function public.qs_horas_uteis(
  p_inicio  timestamptz,
  p_fim     timestamptz,
  p_horario jsonb
) returns numeric
language plpgsql immutable parallel safe as $$
declare
  ini timestamp; fim timestamp; d date; dia jsonb;
  abre timestamp; fecha timestamp; a timestamp; b timestamp;
  total numeric := 0; voltas int := 0;
begin
  if p_inicio is null or p_fim is null then return null; end if;
  if p_fim <= p_inicio then return 0; end if;
  -- Sem configuracao nao inventamos expediente: cai no relogio de parede.
  if p_horario is null or jsonb_typeof(p_horario) <> 'object' then
    return extract(epoch from (p_fim - p_inicio)) / 3600.0;
  end if;

  ini := p_inicio at time zone 'America/Sao_Paulo';
  fim := p_fim    at time zone 'America/Sao_Paulo';
  d   := ini::date;

  -- 45 dias de teto: alem disso a nota e zero de qualquer jeito, e um lead
  -- parado ha dois anos nao pode custar 700 voltas de laco por linha.
  while d <= fim::date and voltas < 45 loop
    voltas := voltas + 1;
    dia := p_horario -> (extract(dow from d)::int)::text;
    if dia is not null and coalesce((dia->>'enabled')::boolean, false) then
      abre  := d + coalesce(nullif(dia->>'start',''), '09:00')::time;
      fecha := d + coalesce(nullif(dia->>'end',''),   '18:00')::time;
      a := greatest(ini, abre);
      b := least(fim, fecha);
      if b > a then
        total := total + extract(epoch from (b - a)) / 3600.0;
      end if;
    end if;
    d := d + 1;
  end loop;

  return total;
end;
$$;

comment on function public.qs_horas_uteis is
  'Horas dentro do expediente (qs_settings.work_hours) entre dois instantes. Fim de semana e madrugada nao contam.';


-- -- (2) A VIEW VOLTA A SER CRUA ------------------------------------------------
--
-- A conta de horas saiu da view porque ela e cara (laco por dia) e a view nao
-- sabe qual e a janela de interesse: calculada ali, rodaria pra base inteira
-- antes de qualquer filtro. Agora quem consulta filtra primeiro e so entao
-- chama qs_horas_uteis.
--
-- DROP e nao CREATE OR REPLACE: o Postgres nao deixa REMOVER coluna de view com
-- replace. As funcoes abaixo tem corpo em string ($$), que ele nao rastreia
-- como dependencia — entao derrubar a view aqui nao leva as funcoes junto, e
-- elas voltam a funcionar assim que ela e recriada, duas linhas depois.
drop view if exists public.qs_lead_primeira_atividade;

create or replace view public.qs_lead_primeira_atividade
with (security_invoker = true) as
  select
    l.id       as lead_id,
    l.owner_id,
    l.arrived_at,
    l.status,
    p.primeira_conclusao
  from qs_leads l
  left join lateral (
    select min(t.completed_at) as primeira_conclusao
      from qs_tasks t
     where t.lead_id = l.id
       and t.status = 'concluida'
       and t.completed_at is not null
  ) p on true
  where l.arrived_at is not null;

comment on view public.qs_lead_primeira_atividade is
  'Um lead por linha: quando chegou e quando a primeira atividade dele foi concluida. A conta de horas uteis e feita por quem consulta.';


-- -- (3) A SAUDE, AGORA EM HORAS UTEIS -------------------------------------------
create or replace function public.qs_carteira_saude(
  p_dias      int     default 30,
  p_excelente numeric default 1,
  p_bom       numeric default 4,
  p_aceitavel numeric default 24,
  p_zero      numeric default 72
) returns table (
  owner_id             uuid,
  nome                 text,
  papel                text,
  nota                 numeric,
  leads_medidos        int,
  horas_mediana        numeric,
  leads_ativos         int,
  leads_trabalhando    int,
  leads_esquecidos     int,
  atividades_abertas   int,
  atividades_atrasadas int,
  concluidas_hoje      int
)
language sql stable security invoker parallel safe as $$
  with cfg as (
    select (select value from qs_settings where key = 'work_hours') as horario,
           now() - make_interval(days => greatest(p_dias, 1))        as inicio
  ),
  medidos as (
    select
      v.owner_id,
      case when v.primeira_conclusao is not null
           then greatest(0, qs_horas_uteis(v.arrived_at, v.primeira_conclusao, c.horario))
      end as horas,
      case when v.primeira_conclusao is null
           then qs_horas_uteis(v.arrived_at, now(), c.horario)
      end as esperando
    from qs_lead_primeira_atividade v, cfg c
    where v.arrived_at >= c.inicio
  ),
  notas as (
    select owner_id, horas,
           coalesce(
             qs_nota_velocidade(horas, p_excelente, p_bom, p_aceitavel, p_zero),
             -- Lead que nunca teve atividade e ja passou do prazo entra como
             -- ZERO. Sem isto, o jeito mais facil de ter media boa seria nao
             -- tocar em ninguem.
             case when esperando > p_zero then 0 else null end
           ) as nota_lead
      from medidos
  ),
  agregado_nota as (
    select owner_id,
           round(avg(nota_lead), 1)                     as nota,
           count(nota_lead)::int                        as leads_medidos,
           round((percentile_cont(0.5) within group (order by horas))::numeric, 1) as horas_mediana
      from notas
     where owner_id is not null
     group by owner_id
  ),
  abertas as (
    select lead_id, owner_id, scheduled_at
      from qs_tasks
     where status in ('pendente','atrasada')
  ),
  carteira as (
    select l.owner_id,
           count(*)::int                                          as leads_ativos,
           count(*) filter (where a.lead_id is not null)::int      as leads_trabalhando,
           count(*) filter (where a.lead_id is null)::int          as leads_esquecidos
      from qs_leads l
      left join (select distinct lead_id from abertas) a on a.lead_id = l.id
     where l.status not in ('ganho','perdido')
       and l.owner_id is not null
     group by l.owner_id
  ),
  fila as (
    select owner_id,
           count(*)::int as atividades_abertas,
           count(*) filter (where scheduled_at < date_trunc('day', now() at time zone 'America/Sao_Paulo')
                                                at time zone 'America/Sao_Paulo')::int as atividades_atrasadas
      from abertas
     where owner_id is not null
     group by owner_id
  ),
  hoje as (
    select owner_id, count(*)::int as concluidas_hoje
      from qs_tasks
     where status = 'concluida'
       and completed_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
       and owner_id is not null
     group by owner_id
  )
  select
    u.id, u.name, u.role,
    an.nota,
    coalesce(an.leads_medidos, 0),
    an.horas_mediana,
    coalesce(c.leads_ativos, 0),
    coalesce(c.leads_trabalhando, 0),
    coalesce(c.leads_esquecidos, 0),
    coalesce(f.atividades_abertas, 0),
    coalesce(f.atividades_atrasadas, 0),
    coalesce(h.concluidas_hoje, 0)
  from qs_users u
  left join agregado_nota an on an.owner_id = u.id
  left join carteira       c on c.owner_id  = u.id
  left join fila           f on f.owner_id  = u.id
  left join hoje           h on h.owner_id  = u.id
  where u.is_active
    and u.role in ('sdr','closer','gestor','admin')
    and (coalesce(c.leads_ativos,0) > 0 or coalesce(an.leads_medidos,0) > 0)
  order by an.nota desc nulls last, u.name;
$$;

comment on function public.qs_carteira_saude is
  'Saude da Carteira por SDR: nota 0-100 pela velocidade da 1a atividade em HORAS UTEIS, mais leads ativos/esquecidos, atraso e producao do dia. RLS aplica.';


-- -- (4) A SERIE, TAMBEM EM HORAS UTEIS ------------------------------------------
create or replace function public.qs_carteira_saude_serie(
  p_dias      int     default 14,
  p_excelente numeric default 1,
  p_bom       numeric default 4,
  p_aceitavel numeric default 24,
  p_zero      numeric default 72
) returns table (
  owner_id uuid,
  dia      date,
  nota     numeric,
  leads    int
)
language sql stable security invoker parallel safe as $$
  with cfg as (
    select (select value from qs_settings where key = 'work_hours') as horario
  )
  select
    v.owner_id,
    (v.arrived_at at time zone 'America/Sao_Paulo')::date as dia,
    round(avg(coalesce(
      qs_nota_velocidade(
        case when v.primeira_conclusao is not null
             then greatest(0, qs_horas_uteis(v.arrived_at, v.primeira_conclusao, c.horario)) end,
        p_excelente, p_bom, p_aceitavel, p_zero),
      case when v.primeira_conclusao is null
            and qs_horas_uteis(v.arrived_at, now(), c.horario) > p_zero then 0 end
    )), 1) as nota,
    count(*)::int as leads
  from qs_lead_primeira_atividade v, cfg c
  where v.owner_id is not null
    and v.arrived_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
                        at time zone 'America/Sao_Paulo'
                        - make_interval(days => greatest(p_dias, 1) - 1)
  group by 1, 2
  order by 2;
$$;

comment on function public.qs_carteira_saude_serie is
  'Um ponto por dia da Saude da Carteira (horas uteis), sobre os leads que chegaram naquele dia.';


-- -- (5) PERMISSAO -----------------------------------------------------------------
grant execute on function public.qs_horas_uteis(timestamptz,timestamptz,jsonb) to authenticated;
grant execute on function public.qs_carteira_saude(int,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.qs_carteira_saude_serie(int,numeric,numeric,numeric,numeric) to authenticated;
grant select on public.qs_lead_primeira_atividade to authenticated;
