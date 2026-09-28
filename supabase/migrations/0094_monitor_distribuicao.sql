-- =============================================================================
-- 0094 — MONITOR DE DISTRIBUIÇÃO DE LEADS (quem RECEBEU cada lead)
-- -----------------------------------------------------------------------------
-- Bruno, 28/09/2026: "o pessoal reclama que os leads estão indo desproporcional
-- pra cada um. Quero a relação de todos os leads que cada SDR tem, quantos foram
-- pra cada um no fim de semana, live também — e amarrar no QS pra mandar pro
-- Dashboard."
--
-- POR QUE UMA TABELA NOVA, E NÃO CONTAR qs_leads.owner_id
--
-- owner_id é quem está com o lead AGORA, não quem o recebeu. Ele muda:
--   • reunião marcada → o lead passa pro CLOSER (api/_agenda.js);
--   • oportunidade futura / transferência manual → vai pra outro SDR.
-- Medido em 28/09 (14 dias): contando owner_id, Yanca 347 × Mariana 213 — parece
-- injusto. Contando quem RECEBEU (1º handover ou dono atual), dá 163 × 162 × 158
-- de leads novos. A reclamação nascia da régua errada.
--
-- Esta tabela grava o dono NO MOMENTO DA CHEGADA e não muda mais. É a régua da
-- distribuição. O canal (Live/Tráfego/Orgânico) NÃO é congelado aqui: vem da
-- Fonte do lead na hora da leitura, porque o Bitrix às vezes corrige a Fonte
-- depois.
--
-- NOVO × RETORNO
--   retorno = o mesmo telefone já tinha entrado antes. Esse lead a CARTEIRA
--   devolve pro mesmo SDR (_leads.js, 0073), fora do rodízio. É metade do volume,
--   e é onde a diferença entre as pessoas aparece. Separado de propósito: o
--   rodízio só responde pelos NOVOS.
-- =============================================================================

create table if not exists qs_lead_entradas (
  lead_id      uuid primary key references qs_leads(id) on delete cascade,
  sdr_id       uuid references qs_users(id) on delete set null,
  chegou_em    timestamptz not null,
  retorno      boolean not null default false,
  -- true = linha montada pelo backfill desta migration (dono deduzido do 1º
  -- handover). Linhas novas vêm do gatilho, gravadas na hora.
  reconstruido boolean not null default false,
  criado_em    timestamptz not null default now()
);

create index if not exists qs_lead_entradas_chegou_idx on qs_lead_entradas (chegou_em desc);
create index if not exists qs_lead_entradas_sdr_idx on qs_lead_entradas (sdr_id, chegou_em desc);

comment on table qs_lead_entradas is
  'Quem RECEBEU cada lead na chegada (não muda quando o lead vai pro closer). Régua do Monitor de distribuição. Ver 0094.';

alter table qs_lead_entradas enable row level security;
drop policy if exists qs_lead_entradas_ler on qs_lead_entradas;
create policy qs_lead_entradas_ler on qs_lead_entradas for select
  using (qs_is_manager() or sdr_id = auth.uid());

-- ── Canal e destino a partir da Fonte do Bitrix ("[Tailândia] - Live") ──────
create or replace function qs_canal_da_fonte(p_fonte text)
returns text
language sql
immutable
as $fn$
  select case
    when p_fonte is null or btrim(p_fonte) = '' then 'sem_fonte'
    when p_fonte ilike '%live%' then 'live'
    when p_fonte ilike '%tráfego%' or p_fonte ilike '%trafego%' then 'trafego'
    when p_fonte ilike '%orgânico%' or p_fonte ilike '%organico%' then 'organico'
    else 'outros'
  end;
$fn$;

create or replace function qs_destino_da_fonte(p_fonte text)
returns text
language sql
immutable
as $fn$
  select nullif(btrim(substring(coalesce(p_fonte, '') from '^\s*\[([^\]]+)\]')), '');
$fn$;

-- ── Gatilho: grava a entrada na hora em que o lead nasce ────────────────────
-- AFTER INSERT: o BEFORE (qs_assign_lead_owner) já escolheu o dono.
create or replace function qs_registrar_entrada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_chave text := qs_tel_chave(new.phone);
  v_ret   boolean := false;
begin
  if v_chave is not null then
    select exists (
      select 1 from qs_leads p
       where new.phone is not null and p.phone is not null
         and qs_tel_chave(p.phone) = v_chave and p.id <> new.id
    ) into v_ret;
  end if;

  insert into qs_lead_entradas (lead_id, sdr_id, chegou_em, retorno)
  values (new.id, new.owner_id, coalesce(new.arrived_at, new.created_at, now()), coalesce(v_ret, false))
  on conflict (lead_id) do nothing;
  return new;
exception when others then
  -- Métrica nunca pode barrar a entrada de um lead.
  raise warning '[0094] entrada não registrada para %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists trg_qs_registrar_entrada on qs_leads;
create trigger trg_qs_registrar_entrada
  after insert on qs_leads
  for each row execute function qs_registrar_entrada();

-- Lead que nasceu SEM dono e ganhou um depois: o 1º dono é quem recebeu.
create or replace function qs_entrada_primeiro_dono()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if old.owner_id is null and new.owner_id is not null then
    update qs_lead_entradas set sdr_id = new.owner_id
     where lead_id = new.id and sdr_id is null;
  end if;
  return new;
exception when others then
  return new;
end;
$fn$;

drop trigger if exists trg_qs_entrada_primeiro_dono on qs_leads;
create trigger trg_qs_entrada_primeiro_dono
  after update of owner_id on qs_leads
  for each row execute function qs_entrada_primeiro_dono();

-- ── Backfill: o histórico inteiro, com o dono deduzido ──────────────────────
-- Quem recebeu = de quem saiu o 1º handover; sem handover, o dono atual.
with todos as materialized (
  select id, qs_tel_chave(phone) ch, coalesce(arrived_at, created_at) t from qs_leads
), primeiro as materialized (
  select ch, min(t) t0 from todos where ch is not null group by ch
), h as materialized (
  select distinct on (lead_id) lead_id, from_user_id
    from qs_handovers where from_user_id is not null
   order by lead_id, created_at
)
insert into qs_lead_entradas (lead_id, sdr_id, chegou_em, retorno, reconstruido)
select l.id, coalesce(h.from_user_id, l.owner_id), a.t, coalesce(p.t0 < a.t, false), true
  from qs_leads l
  join todos a on a.id = l.id
  left join primeiro p on p.ch = a.ch
  left join h on h.lead_id = l.id
on conflict (lead_id) do nothing;

-- ── Quem pode ver o monitor ─────────────────────────────────────────────────
-- Gestão e marketing no app; service_role pro endpoint do Dashboard.
create or replace function qs_pode_ver_monitor()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from qs_users
                  where id = auth.uid() and is_active and role in ('admin','gestor','marketing'));
$fn$;

-- ── O agregado do período ───────────────────────────────────────────────────
-- Datas no fuso de SP ("-03", não AT TIME ZONE em date: erra 6h).
-- Devolve jsonb (um valor só) pra não esbarrar no teto de 1000 do PostgREST.
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
  if not qs_pode_ver_monitor() then
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
    raise exception 'Sem permissão para o monitor de distribuição' using errcode = '42501';
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

revoke all on function qs_monitor_distribuicao(date, date) from public, anon;
revoke all on function qs_monitor_distribuicao_lista(date, date, uuid, text, boolean) from public, anon;
grant execute on function qs_monitor_distribuicao(date, date) to authenticated, service_role;
grant execute on function qs_monitor_distribuicao_lista(date, date, uuid, text, boolean) to authenticated, service_role;
