-- 0074_saude_da_carteira.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- O QUE E ISTO -----------------------------------------------------------
--
-- A SAUDE DA CARTEIRA: uma nota de 0 a 100 por SDR, e ela mede UMA coisa —
-- a VELOCIDADE com que ele conclui a PRIMEIRA atividade de cada lead novo.
--
-- Por que essa e nao outra (decisao do Bruno, 03/09/2026): e a unica coisa que
-- o SDR controla inteiramente e que muda o resultado. Lead de trafego pago
-- esfria em horas; quem responde em 40 minutos conversa com outra pessoa,
-- nao com o mesmo lead mais tarde.
--
-- Medido nos ultimos 30 dias antes de escrever isto (1790 leads): mediana do
-- time 1,8h, e 43% dos leads recebem a primeira atividade concluida em menos
-- de 1h. Por pessoa: 1,1h / 1,7h / 3,6h. A regua abaixo nasce desses numeros —
-- ela e exigente mas alcancavel, e nao foi inventada no chute.
--
-- -- POR QUE O CALCULO E AQUI E NAO NO NAVEGADOR ------------------------------
--
-- A carteira do time passa de 2 mil leads e o PostgREST corta toda resposta em
-- 1000 linhas SEM AVISAR (ver docs/ e a memoria do teto de 1000). Uma media
-- calculada em cima de uma lista truncada nao da erro: da um numero errado com
-- cara de certo. Agregado no banco, o teto nao existe.
--
-- SECURITY INVOKER (o padrao, explicito abaixo): a RLS das tabelas continua
-- valendo. O SDR ve so a linha dele porque so enxerga os leads dele; o gestor
-- ve o time inteiro. Nao ha filtro de tela pra alguem burlar.
--
-- -- A REGUA VEM POR PARAMETRO, NAO CRAVADA ----------------------------------
--
-- Os limites (1h / 4h / 24h / 72h) entram como argumento porque quem manda
-- neles e Configuracoes -> Carteira (qs_settings.carteira_regua_velocidade).
-- Apertar a meta e um clique do gestor, nao um deploy — e a funcao continua
-- sendo uma funcao pura, sem ler configuracao por dentro.
-- ---------------------------------------------------------------------------


-- -- (1) A NOTA DE UM LEAD ----------------------------------------------------
--
-- Decrescente e continua, em quatro faixas. Continua de proposito: um degrau
-- faria 1h00 valer 100 e 1h01 valer 80, e o SDR aprenderia a "bater a faixa"
-- em vez de ser rapido.
--
--   ate p_excelente  -> 100
--   ate p_bom        -> 100 desce ate 80
--   ate p_aceitavel  ->  80 desce ate 55
--   ate p_zero       ->  55 desce ate  0
--   depois disso     ->   0
create or replace function public.qs_nota_velocidade(
  p_horas     numeric,
  p_excelente numeric default 1,
  p_bom       numeric default 4,
  p_aceitavel numeric default 24,
  p_zero      numeric default 72
) returns numeric
language sql immutable parallel safe as $$
  select case
    -- Sem medida ainda: NULL, e NULL nao entra na media (nao e nota zero).
    when p_horas is null then null
    -- Conclusao carimbada antes da chegada (relogio torto, importacao antiga):
    -- tratamos como instantanea em vez de deixar virar nota negativa.
    when p_horas <= p_excelente then 100
    when p_horas <= p_bom       then 100 - 20 * ((p_horas - p_excelente) / nullif(p_bom - p_excelente, 0))
    when p_horas <= p_aceitavel then  80 - 25 * ((p_horas - p_bom)       / nullif(p_aceitavel - p_bom, 0))
    when p_horas <= p_zero      then  55 - 55 * ((p_horas - p_aceitavel) / nullif(p_zero - p_aceitavel, 0))
    else 0
  end;
$$;

comment on function public.qs_nota_velocidade is
  'Nota 0-100 de UM lead pela velocidade da primeira atividade concluida. Continua por faixas; a regua vem por parametro (Configuracoes -> Carteira).';


-- -- (2) O TEMPO ATE A PRIMEIRA ATIVIDADE, LEAD A LEAD -------------------------
--
-- View de apoio: uma linha por lead, com quantas horas levou entre CHEGAR e
-- ter a primeira atividade CONCLUIDA.
--
-- A pegadinha que essa view resolve: lead que chegou e NUNCA teve atividade
-- concluida. Ignorar esses inflaria a nota — o jeito mais facil de ter uma
-- media boa seria nao tocar em ninguem. Entao, se ja passou tempo suficiente
-- pra nota ser zero de qualquer jeito, ele entra como zero. Se acabou de
-- chegar, fica NULL e simplesmente nao conta ainda (nao da pra cobrar
-- velocidade de quem chegou ha dez minutos).
create or replace view public.qs_lead_primeira_atividade
with (security_invoker = true) as
  select
    l.id                                   as lead_id,
    l.owner_id,
    l.arrived_at,
    l.status,
    p.primeira_conclusao,
    case
      when p.primeira_conclusao is null then null
      else greatest(0, extract(epoch from (p.primeira_conclusao - l.arrived_at)) / 3600.0)
    end                                    as horas_ate_primeira,
    -- Horas que o lead esta esperando, pra quem nunca teve atividade concluida.
    case
      when p.primeira_conclusao is not null then null
      else extract(epoch from (now() - l.arrived_at)) / 3600.0
    end                                    as horas_esperando
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
  'Uma linha por lead: quantas horas entre chegar e a primeira atividade concluida. Base da Saude da Carteira.';


-- -- (3) A SAUDE, POR SDR ------------------------------------------------------
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
  -- A nota (0-100). NULL quando nao houve lead suficiente na janela: melhor
  -- "sem dados" do que um 100 falso por ausencia de medicao.
  nota                 numeric,
  leads_medidos        int,
  horas_mediana        numeric,
  -- Carteira: quantos estao vivos, quantos tem atividade aberta, quantos nao.
  leads_ativos         int,
  leads_trabalhando    int,
  leads_esquecidos     int,
  -- "Saude da cadencia" reduzida a um numero: das atividades abertas, quantas
  -- ainda estao no prazo. O painel completo continua em Analises.
  atividades_abertas   int,
  atividades_atrasadas int,
  -- Producao do dia (o denominador, a meta, vem de qs_goals no app).
  concluidas_hoje      int
)
language sql stable security invoker parallel safe as $$
  with janela as (
    select now() - make_interval(days => greatest(p_dias, 1)) as inicio
  ),
  -- Notas dos leads que chegaram na janela. Quem nunca teve atividade mas ja
  -- passou do limite de zero entra com zero (ver comentario da view).
  notas as (
    select
      v.owner_id,
      coalesce(
        qs_nota_velocidade(v.horas_ate_primeira, p_excelente, p_bom, p_aceitavel, p_zero),
        case when v.horas_esperando > p_zero then 0 else null end
      ) as nota_lead,
      v.horas_ate_primeira
    from qs_lead_primeira_atividade v, janela j
    where v.arrived_at >= j.inicio
  ),
  agregado_nota as (
    select owner_id,
           round(avg(nota_lead), 1)                   as nota,
           count(nota_lead)::int                      as leads_medidos,
           round((percentile_cont(0.5) within group (
             order by horas_ate_primeira))::numeric, 1) as horas_mediana
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
           count(*)::int                                                   as leads_ativos,
           count(*) filter (where a.lead_id is not null)::int               as leads_trabalhando,
           count(*) filter (where a.lead_id is null)::int                   as leads_esquecidos
      from qs_leads l
      left join (select distinct lead_id from abertas) a on a.lead_id = l.id
     where l.status not in ('ganho','perdido')
       and l.owner_id is not null
     group by l.owner_id
  ),
  fila as (
    select owner_id,
           count(*)::int                                                    as atividades_abertas,
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
    -- So quem trabalha carteira. Marketing e somente leitura e nao tem lead.
    and u.role in ('sdr','closer','gestor','admin')
    -- Some quem nao tem nada: um card zerado de admin so faria volume.
    and (coalesce(c.leads_ativos,0) > 0 or coalesce(an.leads_medidos,0) > 0)
  order by an.nota desc nulls last, u.name;
$$;

comment on function public.qs_carteira_saude is
  'Saude da Carteira por SDR: nota 0-100 pela velocidade da 1a atividade, mais leads ativos/esquecidos, atraso e producao do dia. RLS aplica (SDR ve so a linha dele).';


-- -- (4) A SERIE DOS ULTIMOS DIAS ----------------------------------------------
--
-- A nota de HOJE nao diz se a coisa esta melhorando. Aqui vai um ponto por dia,
-- calculado sobre os leads que CHEGARAM naquele dia — que e a leitura honesta:
-- a nota de terca e sobre os leads de terca, nao sobre uma media que arrasta.
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
  select
    v.owner_id,
    (v.arrived_at at time zone 'America/Sao_Paulo')::date as dia,
    round(avg(coalesce(
      qs_nota_velocidade(v.horas_ate_primeira, p_excelente, p_bom, p_aceitavel, p_zero),
      case when v.horas_esperando > p_zero then 0 else null end
    )), 1) as nota,
    count(*)::int as leads
  from qs_lead_primeira_atividade v
  where v.owner_id is not null
    and v.arrived_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
                        at time zone 'America/Sao_Paulo'
                        - make_interval(days => greatest(p_dias, 1) - 1)
  group by 1, 2
  order by 2;
$$;

comment on function public.qs_carteira_saude_serie is
  'Um ponto por dia da Saude da Carteira, sobre os leads que chegaram naquele dia. Alimenta a linha dos ultimos 14 dias.';


-- -- (5) PERMISSAO --------------------------------------------------------------
grant execute on function public.qs_nota_velocidade(numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.qs_carteira_saude(int,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.qs_carteira_saude_serie(int,numeric,numeric,numeric,numeric) to authenticated;
grant select on public.qs_lead_primeira_atividade to authenticated;
