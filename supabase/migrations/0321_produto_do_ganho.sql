-- 0321 — Produto no "Ganho / Agendou" (Bruno, 06/11/2026)
-- -----------------------------------------------------------------------------
-- O SDR escolhe o PRODUTO ao dar ganho: Aéreo · Pacote · Expedição · Outros.
-- Antes era só texto livre no título ("Expedição Itália", "Passagem aérea…") —
-- impossível medir a demanda que sai dos SDRs pros closers.
--
-- 1. qs_meetings.produto_tipo / expedicao_id: o produto da reunião agendada
--    (a expedição vem do Operacional — tabela expedicoes).
-- 2. qs_ganhos_sdr: ganho que o PRÓPRIO SDR faz, sem reunião (hoje: aéreo que
--    ele mesmo emite). Sem isso esse ganho não deixava rastro nenhum na métrica.
-- 3. qs_expedicoes_a_venda(): a lista de expedições que o SDR vê ao escolher
--    "Expedição". Security definer porque o SDR não lê expedicoes (RLS do
--    Operacional) — e aqui só sai o nome/código/data, nada de passageiro ou valor.
-- -----------------------------------------------------------------------------

-- 1. Produto da reunião -------------------------------------------------------
alter table public.qs_meetings add column if not exists produto_tipo text;
alter table public.qs_meetings add column if not exists expedicao_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qs_meetings_produto_tipo_ck') then
    alter table public.qs_meetings add constraint qs_meetings_produto_tipo_ck
      check (produto_tipo is null or produto_tipo in ('aereo', 'pacote', 'expedicao', 'outros'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qs_meetings_expedicao_fk') then
    alter table public.qs_meetings add constraint qs_meetings_expedicao_fk
      foreign key (expedicao_id) references public.expedicoes(id) on delete set null;
  end if;
end $$;

comment on column public.qs_meetings.produto_tipo is
  'Produto escolhido pelo SDR no agendamento (aereo/pacote/expedicao/outros) — 0321. Nulo = reunião anterior à 0321.';
comment on column public.qs_meetings.expedicao_id is
  'Expedição do Operacional quando produto_tipo = expedicao (0321).';

create index if not exists idx_qs_meetings_produto
  on public.qs_meetings (owner_id, created_at) where produto_tipo is not null;

-- 2. Ganho que o próprio SDR faz ----------------------------------------------
create table if not exists public.qs_ganhos_sdr (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.qs_leads(id) on delete cascade,
  owner_id     uuid not null default auth.uid(),
  produto_tipo text not null default 'aereo'
               check (produto_tipo in ('aereo', 'pacote', 'expedicao', 'outros')),
  descricao    text,
  created_at   timestamptz not null default now()
);

comment on table public.qs_ganhos_sdr is
  'Ganho que o próprio SDR faz, sem passar pro closer (ex.: aéreo que ele emite) — 0321. Entra na métrica Demanda por produto.';

create index if not exists idx_qs_ganhos_sdr_owner on public.qs_ganhos_sdr (owner_id, created_at);

alter table public.qs_ganhos_sdr enable row level security;

drop policy if exists qs_ganhos_sdr_ler on public.qs_ganhos_sdr;
create policy qs_ganhos_sdr_ler on public.qs_ganhos_sdr
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists qs_ganhos_sdr_criar on public.qs_ganhos_sdr;
create policy qs_ganhos_sdr_criar on public.qs_ganhos_sdr
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- Desfazer um clique errado (o próprio SDR, logo em seguida).
drop policy if exists qs_ganhos_sdr_apagar on public.qs_ganhos_sdr;
create policy qs_ganhos_sdr_apagar on public.qs_ganhos_sdr
  for delete to authenticated
  using (owner_id = (select auth.uid()) or (select qs_is_manager()));

revoke all on public.qs_ganhos_sdr from anon, public;
grant select, insert, delete on public.qs_ganhos_sdr to authenticated;

-- 3. Expedições à venda (pro seletor do SDR) ------------------------------------
create or replace function public.qs_expedicoes_a_venda()
returns table (id uuid, codigo text, nome text, destino text, data_embarque date, status text)
language sql stable security definer set search_path = public as $$
  select e.id, e.codigo, e.nome, e.destino, e.data_embarque, e.status::text
    from expedicoes e
   where coalesce(e.tipo, 'expedicao') = 'expedicao'
     and e.status::text in ('Vendas Abertas', 'Planejamento', 'Em andamento')
     and (e.data_embarque is null or e.data_embarque >= current_date)
   order by (e.status::text = 'Vendas Abertas') desc, e.data_embarque nulls last, e.nome
$$;

revoke all on function public.qs_expedicoes_a_venda() from public, anon;
grant execute on function public.qs_expedicoes_a_venda() to authenticated, service_role;

-- 4. Reagendar leva o produto junto ---------------------------------------------
-- qs_reagendar_reuniao (0033) cria a linha nova listando as colunas uma a uma:
-- sem isto a remarcada nascia SEM produto (e some da métrica por produto).
-- Aproveitado: ela também não copiava `tipo` (0054) nem `temperatura_sdr`
-- (0311) — uma RETOMADA remarcada virava "primeira" e passava a contar como
-- reunião no indicador. Corpo igual ao vigente + as 4 colunas.
create or replace function public.qs_reagendar_reuniao(
  p_meeting_id uuid, p_scheduled_at timestamptz, p_duration_min integer default null,
  p_closer_id uuid default null, p_closer_nome text default null, p_por text default null)
returns qs_meetings
language plpgsql
as $function$
declare
  v_antiga qs_meetings;
  v_nova   qs_meetings;
  v_dur    integer;
  v_rastro text;
begin
  select * into v_antiga from qs_meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'reunião % não encontrada (ou sem permissão)', p_meeting_id
      using errcode = 'no_data_found';
  end if;

  if v_antiga.status in ('cancelada', 'reagendada') then
    raise exception 'esta reunião já foi % — reagende a mais recente', v_antiga.status
      using errcode = 'invalid_parameter_value';
  end if;

  if v_antiga.status in ('realizada', 'no_show', 'desistencia') then
    raise exception 'esta reunião já tem desfecho — marque uma reunião nova (de retomada) em vez de reagendar'
      using errcode = 'invalid_parameter_value';
  end if;

  v_dur := coalesce(p_duration_min, v_antiga.duration_min, 60);

  update qs_meetings
     set status = 'reagendada',
         calendar_event_id = null,
         updated_at = now()
   where id = v_antiga.id;

  v_rastro := format('↻ Reagendada de %s para %s%s',
                     to_char(v_antiga.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                     to_char(p_scheduled_at        at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                     case when p_por is null then '' else ' por ' || p_por end);

  insert into qs_meetings (
    lead_id, owner_id, closer_id, title, scheduled_at, ends_at, duration_min,
    location, meeting_link, notes, status, lead_name, scheduled_by, meeting_owner,
    client_email, booking_date, calendar_event_id, calendar_html_link, reagendado_de,
    tipo, temperatura_sdr, produto_tipo, expedicao_id
  ) values (
    v_antiga.lead_id, v_antiga.owner_id, coalesce(p_closer_id, v_antiga.closer_id),
    v_antiga.title, p_scheduled_at, p_scheduled_at + make_interval(mins => v_dur), v_dur,
    v_antiga.location, v_antiga.meeting_link,
    case when v_antiga.notes is null or v_antiga.notes = '' then v_rastro
         else v_rastro || E'\n' || v_antiga.notes end,
    'agendada', v_antiga.lead_name, v_antiga.scheduled_by,
    coalesce(p_closer_nome, v_antiga.meeting_owner),
    v_antiga.client_email, v_antiga.booking_date,
    v_antiga.calendar_event_id, v_antiga.calendar_html_link, v_antiga.id,
    v_antiga.tipo, v_antiga.temperatura_sdr, v_antiga.produto_tipo, v_antiga.expedicao_id
  )
  returning * into v_nova;

  return v_nova;
end;
$function$;
