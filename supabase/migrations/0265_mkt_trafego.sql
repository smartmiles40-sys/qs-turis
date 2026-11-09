-- 0265_mkt_trafego.sql
-- -----------------------------------------------------------------------------
-- TRÁFEGO › META ADS: VERBA E TRAVAS (Bruno, 03/11/2026).
-- ESCRITA em 03/11/2026. NÃO APLICADA. Idempotente (pode rodar de novo).
-- ORDEM: depois da 0240 (usa mkt_tem_acesso / mkt_eh_aprovador / mkt_papeis_de /
-- mkt_aprovadores e o area='marketing' do qs_avisos).
--
-- "A verba de tráfego vive estourando e contamina os meses seguintes. Hoje são
--  R$ 15.000 até o dia 15. Quero acompanhar a Meta dentro do QS e ter travas:
--  desligar campanha se o custo por reunião passar do valor que a gente
--  estipular, idem agendamento, CAC… Temos que ser precisos."
--
-- O QUE MUDA EM PRODUÇÃO (só ACRESCENTA):
--   • qs_leads ganha utm_source/utm_medium/utm_campaign/utm_content/utm_term
--     (nulas). O QS grava quando a entrada do lead trouxer (api/_leads.js), só
--     o PRIMEIRO toque (não sobrescreve).
--   • tabelas novas mkt_trafego_* com RLS própria (nada pra anon):
--       - leitura: quem tem acesso ao Marketing (mkt_tem_acesso);
--       - travas (regras): papel 'trafego' ou gestor/admin (mkt_trafego_pode_editar);
--       - períodos de verba e quem recebe aviso: gestor/admin (mkt_pode_gerir);
--       - o que vem da Meta (campanhas, conjuntos, anúncios, insights, leituras)
--         e o histórico de ações: SÓ o servidor escreve (service_role, pela
--         /api/mkt-trafego). A tela só lê.
--   • funções: mkt_trafego_funil(inicio, fim) (os números do QS por Fonte do
--     lead), mkt_trafego_acumulado() e mkt_trafego_avisar(...) (só servidor).
--
-- TRAVA NO BANCO: toda regra nasce em 'avisar' (default). 'pausar' precisa ser
-- escolhido de propósito — e mesmo assim só pausa de verdade com a env
-- MKT_TRAFEGO_PAUSA_LIGADA=1 na Vercel (sem ela, vira "pausaria" no histórico).
-- -----------------------------------------------------------------------------

-- ── 1) UTM no lead (preparado; o QS grava quando vier) ──────────────────────
alter table qs_leads add column if not exists utm_source   text;
alter table qs_leads add column if not exists utm_medium   text;
alter table qs_leads add column if not exists utm_campaign text;
alter table qs_leads add column if not exists utm_content  text;
alter table qs_leads add column if not exists utm_term     text;
comment on column qs_leads.utm_campaign is
  'utm_campaign do PRIMEIRO toque (0265). Gravado por api/_leads.js quando a entrada traz '
  '(formulário, robô do Bitrix com o parâmetro, ou UTM_CAMPAIGN do negócio). Nunca sobrescrito.';

create index if not exists qs_leads_created_at_idx on qs_leads (created_at);

-- ── 2) Quem mexe ────────────────────────────────────────────────────────────
-- Travas: papel 'trafego' do Marketing, ou quem aprova (gestor de Marketing, admin).
create or replace function mkt_trafego_pode_editar() returns boolean
language sql stable security definer set search_path = public as $$
  select mkt_tem_acesso()
     and (mkt_eh_aprovador(auth.uid()) or 'trafego' = any(mkt_papeis_de(auth.uid())));
$$;
revoke all on function mkt_trafego_pode_editar() from public, anon;
grant execute on function mkt_trafego_pode_editar() to authenticated;

create or replace function mkt_trafego_touch() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ── 3) O que vem da Meta (só o servidor escreve) ────────────────────────────
-- Valores em REAIS (a Graph API manda orçamento em centavos; o servidor divide).
create table if not exists mkt_trafego_campanhas (
  id               text primary key,             -- id da campanha na Meta
  nome             text not null,
  status           text,                          -- o que a gente liga/desliga (ACTIVE/PAUSED…)
  effective_status text,                          -- o que está valendo (inclui ADSET_PAUSED, WITH_ISSUES…)
  objetivo         text,
  daily_budget     numeric(14,2),                 -- CBO: orçamento diário da campanha
  lifetime_budget  numeric(14,2),
  spend_cap        numeric(14,2),
  inicio_meta      timestamptz,
  fim_meta         timestamptz,
  criada_meta      timestamptz,
  atualizada_meta  timestamptz,
  -- calculados pelo servidor a partir do NOME (api/_mktTrafegoCalc.js)
  destino          text,                          -- chave ('tailandia', 'china+japao'…); nulo = sem destino no nome
  tipo             text,                          -- 'trafego' | 'live'
  -- O Tráfego corrige pela tela quando o nome não diz (ex.: "[STFV] [sem vídeo] | ABO |",
  -- 26% do gasto de outubro). '*' = vários destinos: o gasto é RATEADO pelos
  -- leads do mesmo canal. Vence o `destino` automático.
  destino_manual   text,
  -- leitura anterior (pra pegar "orçamento alterado por fora")
  daily_budget_antes numeric(14,2),
  vista_em         timestamptz not null default now(), -- primeira vez que o QS viu
  -- "Reativar" pelo QS: as travas não pausam de novo até aqui (só avisam)
  liberada_ate     timestamptz,
  atualizado_em    timestamptz not null default now()
);

create table if not exists mkt_trafego_conjuntos (
  id               text primary key,
  campanha_id      text not null,
  nome             text not null,
  status           text,
  effective_status text,
  daily_budget     numeric(14,2),                 -- ABO: orçamento diário do conjunto
  lifetime_budget  numeric(14,2),
  daily_budget_antes numeric(14,2),
  atualizado_em    timestamptz not null default now()
);
create index if not exists mkt_trafego_conjuntos_campanha_idx on mkt_trafego_conjuntos (campanha_id);

create table if not exists mkt_trafego_anuncios (
  id               text primary key,
  conjunto_id      text,
  campanha_id      text not null,
  nome             text not null,
  status           text,
  effective_status text,
  atualizado_em    timestamptz not null default now()
);
create index if not exists mkt_trafego_anuncios_campanha_idx on mkt_trafego_anuncios (campanha_id);

-- Insight DIÁRIO por campanha (dia no fuso da conta de anúncio).
create table if not exists mkt_trafego_insights_dia (
  data         date not null,
  campanha_id  text not null,
  gasto        numeric(14,2) not null default 0,
  impressoes   bigint not null default 0,
  cliques      bigint not null default 0,
  leads        integer not null default 0,         -- o que a META conta como lead (pixel/formulário)
  atualizado_em timestamptz not null default now(),
  primary key (data, campanha_id)
);
create index if not exists mkt_trafego_insights_campanha_idx on mkt_trafego_insights_dia (campanha_id, data);

-- Fotografia a cada leitura: gasto e leads ACUMULADOS por campanha. É o que dá
-- "gastou R$ X nas últimas N horas" sem pedir dado por hora à Meta.
-- O servidor apaga o que passa de 4 dias.
create table if not exists mkt_trafego_leituras (
  lido_em      timestamptz not null,
  campanha_id  text not null,
  gasto_acum   numeric(14,2) not null,
  leads_acum   integer not null,
  primary key (lido_em, campanha_id)
);
create index if not exists mkt_trafego_leituras_campanha_idx on mkt_trafego_leituras (campanha_id, lido_em desc);

-- Estado da integração (linha única).
create table if not exists mkt_trafego_estado (
  id               integer primary key default 1 check (id = 1),
  ultima_sync_ok   timestamptz,
  ultima_tentativa timestamptz,
  ultimo_erro      text,
  ultima_avaliacao timestamptz,
  conta_nome       text,
  conta_moeda      text,
  conta_fuso       text,
  resumo           jsonb not null default '{}'::jsonb
);
insert into mkt_trafego_estado (id) values (1) on conflict (id) do nothing;

-- ── 4) Período de verba (gestor) ────────────────────────────────────────────
create table if not exists mkt_trafego_periodos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) between 1 and 80),
  inicio        date not null,
  fim           date not null,
  valor         numeric(14,2) not null check (valor > 0),
  -- divisão opcional: [{ "tipo": "destino"|"campanha", "alvo": "tailandia"|"<id>", "rotulo": "Tailândia", "valor": 5000 }]
  cotas         jsonb not null default '[]'::jsonb check (jsonb_typeof(cotas) = 'array'),
  ativo         boolean not null default true,
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint mkt_trafego_periodos_datas check (fim >= inicio and fim - inicio <= 120)
);
drop trigger if exists trg_mkt_trafego_periodos_touch on mkt_trafego_periodos;
create trigger trg_mkt_trafego_periodos_touch before update on mkt_trafego_periodos
  for each row execute function mkt_trafego_touch();

-- Configuração editável pela tela (linha única): quem recebe os avisos.
-- avisar_ids vazio = papel 'trafego' + gestores de Marketing + admins.
create table if not exists mkt_trafego_config (
  id            integer primary key default 1 check (id = 1),
  avisar_ids    uuid[] not null default '{}',
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
insert into mkt_trafego_config (id) values (1) on conflict (id) do nothing;
drop trigger if exists trg_mkt_trafego_config_touch on mkt_trafego_config;
create trigger trg_mkt_trafego_config_touch before update on mkt_trafego_config
  for each row execute function mkt_trafego_touch();

-- ── 5) Travas (regras) ──────────────────────────────────────────────────────
create table if not exists mkt_trafego_regras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) between 1 and 120),
  ativa         boolean not null default true,
  -- nulo = o período ativo de hoje
  periodo_id    uuid references mkt_trafego_periodos(id) on delete cascade,
  escopo        text not null default 'periodo' check (escopo in ('periodo', 'destino', 'campanha')),
  alvo          text,                                   -- chave do destino ou id da campanha
  alvo_rotulo   text,
  metrica       text not null check (metrica in (
                  'verba_pct', 'gasto_periodo', 'gasto_dia', 'cpl',
                  'custo_agendamento', 'custo_reuniao', 'cac', 'sem_lead')),
  limite        numeric(14,2) not null check (limite > 0),
  gasto_minimo  numeric(14,2) not null default 0 check (gasto_minimo >= 0),
  horas         integer check (horas is null or horas between 1 and 72), -- só 'sem_lead'
  -- TODA regra nasce só avisando. 'pausar' é escolha explícita por regra.
  acao          text not null default 'avisar' check (acao in ('avisar', 'pausar')),
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint mkt_trafego_regras_alvo check ((escopo = 'periodo') = (alvo is null)),
  constraint mkt_trafego_regras_horas check ((metrica = 'sem_lead') = (horas is not null))
);
drop trigger if exists trg_mkt_trafego_regras_touch on mkt_trafego_regras;
create trigger trg_mkt_trafego_regras_touch before update on mkt_trafego_regras
  for each row execute function mkt_trafego_touch();

-- Quem atualizou é quem está logado (o cliente não escolhe).
create or replace function mkt_trafego_regras_quem() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.atualizado_por := auth.uid();
    if tg_op = 'INSERT' then new.criado_por := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_mkt_trafego_regras_quem on mkt_trafego_regras;
create trigger trg_mkt_trafego_regras_quem before insert or update on mkt_trafego_regras
  for each row execute function mkt_trafego_regras_quem();

-- ── 6) Histórico de ações (só o servidor escreve) ───────────────────────────
create table if not exists mkt_trafego_acoes (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  tipo          text not null check (tipo in ('aviso', 'pausa', 'pausaria', 'reativacao', 'erro', 'alerta')),
  regra_id      uuid references mkt_trafego_regras(id) on delete set null,
  regra_nome    text,
  alvo_tipo     text check (alvo_tipo in ('campanha', 'conjunto', 'conta', 'periodo', 'destino')),
  alvo_id       text,
  alvo_nome     text,
  metrica       text,
  valor_medido  numeric(14,2),
  limite        numeric(14,2),
  antes         jsonb,
  depois        jsonb,
  quem          uuid references qs_users(id) on delete set null, -- nulo = o robô (cron)
  detalhe       text,
  chave         text unique                                     -- idempotência (uma vez por dia etc.)
);
create index if not exists mkt_trafego_acoes_quando_idx on mkt_trafego_acoes (criado_em desc);

-- ── 7) RLS ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['mkt_trafego_campanhas', 'mkt_trafego_conjuntos', 'mkt_trafego_anuncios',
                           'mkt_trafego_insights_dia', 'mkt_trafego_leituras', 'mkt_trafego_estado',
                           'mkt_trafego_periodos', 'mkt_trafego_config', 'mkt_trafego_regras', 'mkt_trafego_acoes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, public', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select to authenticated using ((select mkt_tem_acesso()))', t || '_ler', t);
  end loop;
end $$;

-- Leituras é coisa interna do servidor: nem o Marketing precisa ler.
drop policy if exists mkt_trafego_leituras_ler on mkt_trafego_leituras;
revoke select on mkt_trafego_leituras from authenticated;

-- Períodos e config: gestor/admin.
grant insert, update, delete on mkt_trafego_periodos to authenticated;
drop policy if exists mkt_trafego_periodos_gerir on mkt_trafego_periodos;
create policy mkt_trafego_periodos_gerir on mkt_trafego_periodos for all to authenticated
  using ((select mkt_pode_gerir())) with check ((select mkt_pode_gerir()));

grant update on mkt_trafego_config to authenticated;
drop policy if exists mkt_trafego_config_gerir on mkt_trafego_config;
create policy mkt_trafego_config_gerir on mkt_trafego_config for update to authenticated
  using ((select mkt_pode_gerir())) with check ((select mkt_pode_gerir()));

-- Travas: tráfego e gestor.
grant insert, update, delete on mkt_trafego_regras to authenticated;
drop policy if exists mkt_trafego_regras_editar on mkt_trafego_regras;
create policy mkt_trafego_regras_editar on mkt_trafego_regras for all to authenticated
  using ((select mkt_trafego_pode_editar())) with check ((select mkt_trafego_pode_editar()));

-- Destino da campanha à mão (a tabela é do servidor; esta é a única porta da tela).
create or replace function mkt_trafego_definir_destino(p_campanha text, p_destino text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not mkt_trafego_pode_editar() then
    raise exception 'Só o Marketing corrige o destino.' using errcode = '42501';
  end if;
  update mkt_trafego_campanhas
     set destino_manual = nullif(btrim(lower(coalesce(p_destino, ''))), ''), atualizado_em = now()
   where id = p_campanha;
  if not found then raise exception 'Campanha não encontrada.'; end if;
end $$;
revoke all on function mkt_trafego_definir_destino(text, text) from public, anon;
grant execute on function mkt_trafego_definir_destino(text, text) to authenticated;

-- ── 8) Funções do servidor ──────────────────────────────────────────────────
-- Os números do QS por Fonte do lead (segment) e utm_campaign, SAFRA do lead:
-- o lead que ENTROU no período leva junto tudo que aconteceu com ele depois.
--   agendamentos = leads com pelo menos 1 reunião marcada (menos 'arquivada')
--   realizadas   = leads com reunião 'realizada' (ou realizada_em preenchido)
--   vendas       = cartões do pipeline do closer (qs_closer_negocios) com
--                  PRÉ-VENDA ou FICHA de fechamento, tirando Passagens aéreas
--                  (tipo 71) e cartão perdido/venda cancelada. MESMA regra do
--                  Desempenho do closer (src/closer/desempenho.ts). Uma venda
--                  por cartão.
--   faturamento  = soma do valor dessas vendas: ficha → pré-venda → previsto.
--
-- CORREÇÃO 04/11/2026 (antes de aplicar): a 1ª versão contava venda por
-- qs_meetings.venda_valor. Isso NÃO é venda — é o "em negociação" que o closer
-- informa no desfecho, e até no-show leva valor ali (12 de 19 em 03/11). Em 30
-- dias somaria 59 "vendas" e R$ 1,89 mi que não existem.
create or replace function mkt_trafego_funil(p_inicio date, p_fim date)
returns table (segment text, utm_campaign text, leads integer, agendamentos integer,
               realizadas integer, vendas integer, faturamento numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(auth.role(), '') = 'service_role' or mkt_tem_acesso()) then
    raise exception 'Sem acesso ao Marketing.' using errcode = '42501';
  end if;
  return query
  with l as (
    select q.id, q.segment, q.utm_campaign
      from qs_leads q
     where q.created_at >= (p_inicio::text || ' 00:00:00-03')::timestamptz
       and q.created_at <  ((p_fim + 1)::text || ' 00:00:00-03')::timestamptz
  ), m as (
    select r.lead_id,
           bool_or(r.status <> 'arquivada') as agendou,
           bool_or(r.status = 'realizada' or r.realizada_em is not null) as realizou
      from qs_meetings r
      join l on l.id = r.lead_id
     group by r.lead_id
  ), v as (
    select n.lead_id,
           count(*)::int as vendas,
           sum(coalesce(
             case when n.ficha->>'valor_total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (n.ficha->>'valor_total')::numeric end,
             n.pre_venda_valor, n.valor_previsto, 0)) as fat
      from qs_closer_negocios n
      join l on l.id = n.lead_id
     where (n.pre_venda_em is not null or n.consolidada_em is not null)
       and coalesce(n.etapa, '') not in ('perdido', 'venda_cancelada')
       and coalesce(n.pre_venda_tipo_bitrix, '') <> '71'
       and coalesce(n.ficha->>'tipo_bitrix', '') <> '71'
       and coalesce(n.pre_venda_tipo, '') <> 'aereo'
       and coalesce(n.ficha->>'servico', '') <> 'aereo'
     group by n.lead_id
  )
  select l.segment, l.utm_campaign,
         count(*)::int,
         (count(*) filter (where m.agendou))::int,
         (count(*) filter (where m.realizou))::int,
         coalesce(sum(v.vendas), 0)::int,
         coalesce(sum(v.fat), 0)::numeric
    from l
    left join m on m.lead_id = l.id
    left join v on v.lead_id = l.id
   group by l.segment, l.utm_campaign;
end $$;
revoke all on function mkt_trafego_funil(date, date) from public, anon;
grant execute on function mkt_trafego_funil(date, date) to authenticated, service_role;

-- Gasto e leads acumulados por campanha (pra fotografia de cada leitura).
create or replace function mkt_trafego_acumulado()
returns table (campanha_id text, gasto_acum numeric, leads_acum integer)
language sql stable security definer set search_path = public as $$
  select campanha_id, sum(gasto), sum(leads)::int from mkt_trafego_insights_dia group by campanha_id;
$$;
revoke all on function mkt_trafego_acumulado() from public, anon, authenticated;
grant execute on function mkt_trafego_acumulado() to service_role;

-- Aviso no sino pra quem cuida do tráfego. Idempotente pela chave.
create or replace function mkt_trafego_avisar(p_titulo text, p_texto text, p_chave text, p_link text default '#mkt/meta-ads')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  n integer := 0;
  lista uuid[];
begin
  select avisar_ids into lista from mkt_trafego_config where id = 1;
  if lista is null or cardinality(lista) = 0 then
    select array_agg(distinct x) into lista from (
      select e.user_id as x from mkt_equipe e join qs_users q on q.id = e.user_id and q.is_active
       where 'trafego' = any(e.papeis)
      union select * from mkt_aprovadores()
      union select id from qs_users where is_active and role = 'admin'
    ) s;
  end if;
  foreach u in array coalesce(lista, '{}') loop
    perform qs_aviso_criar(u, 'trafego', 'marketing', p_titulo, p_texto, p_link,
                           'mkt_trafego', null, p_chave);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function mkt_trafego_avisar(text, text, text, text) from public, anon, authenticated;
grant execute on function mkt_trafego_avisar(text, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- ROLLBACK (manual, se precisar):
--   drop function if exists mkt_trafego_avisar(text, text, text, text), mkt_trafego_acumulado(),
--     mkt_trafego_funil(date, date), mkt_trafego_definir_destino(text, text), mkt_trafego_pode_editar(), mkt_trafego_regras_quem(), mkt_trafego_touch() cascade;
--   drop table if exists mkt_trafego_acoes, mkt_trafego_regras, mkt_trafego_config, mkt_trafego_periodos,
--     mkt_trafego_estado, mkt_trafego_leituras, mkt_trafego_insights_dia, mkt_trafego_anuncios,
--     mkt_trafego_conjuntos, mkt_trafego_campanhas;
--   (as colunas utm_* de qs_leads podem ficar: são nulas e ninguém depende delas)
-- -----------------------------------------------------------------------------
