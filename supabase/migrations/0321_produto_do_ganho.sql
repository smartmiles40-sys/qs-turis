-- 0321 — Produto no desfecho do SDR + rota (reunião × cotação) + Cotações (06/11/2026)
-- -----------------------------------------------------------------------------
-- Spec "QS · Desempenho SDR + Produto + Cotações de aéreo", Fase 1 (dados).
-- Hoje os SDRs também fazem aéreo, e aéreo normalmente não tem reunião: tem
-- COTAÇÃO entregue. Então o desfecho do SDR passa a ter PRODUTO obrigatório:
--   expedicao | pacote | outros → rota REUNIAO (agendamento com closer, como hoje)
--   aereo                       → rota COTACAO (sem reunião; o SDR cota ou repassa)
-- A regra produto → rota mora em produto_rota (dá pra mover pacote pra cotação
-- sem deploy).
--
-- Adaptações ao QS (o spec fala em "agendamentos" e "expedicoes.valor_base"):
--   · agendamentos = qs_meetings.
--   · expedicoes já existe (Operacional, espelhado do sistema antigo): o valor é
--     expedicoes.preco_venda_brl — não cria tabela nem coluna nova (o espelho
--     sobrescreveria).
--   · Responsável "closer" na cotação = qualquer pessoa diferente do SDR que
--     originou (a agenda dos closers tem gestores também).
-- -----------------------------------------------------------------------------

-- 1. Enums ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'produto_tipo') then
    create type public.produto_tipo as enum ('expedicao', 'aereo', 'pacote', 'outros');
  end if;
  if not exists (select 1 from pg_type where typname = 'rota_tipo') then
    create type public.rota_tipo as enum ('reuniao', 'cotacao');
  end if;
  if not exists (select 1 from pg_type where typname = 'desfecho_sdr') then
    create type public.desfecho_sdr as enum ('agendou', 'ganhou');
  end if;
  if not exists (select 1 from pg_type where typname = 'cotacao_status') then
    create type public.cotacao_status as enum ('solicitada', 'em_cotacao', 'entregue', 'aprovada', 'perdida');
  end if;
  if not exists (select 1 from pg_type where typname = 'cotacao_canal') then
    create type public.cotacao_canal as enum ('whatsapp', 'email', 'ligacao');
  end if;
  if not exists (select 1 from pg_type where typname = 'cotacao_motivo_perda') then
    create type public.cotacao_motivo_perda as enum ('preco', 'datas', 'desistiu', 'comprou_fora', 'sem_retorno', 'outro');
  end if;
end $$;

-- 2. Regra produto → rota ------------------------------------------------------
create table if not exists public.produto_rota (
  produto public.produto_tipo primary key,
  rota    public.rota_tipo not null
);
insert into public.produto_rota values
  ('expedicao', 'reuniao'), ('pacote', 'reuniao'), ('outros', 'reuniao'), ('aereo', 'cotacao')
on conflict (produto) do nothing;

alter table public.produto_rota enable row level security;
drop policy if exists produto_rota_ler on public.produto_rota;
create policy produto_rota_ler on public.produto_rota for select to authenticated using (true);
drop policy if exists produto_rota_gestao on public.produto_rota;
create policy produto_rota_gestao on public.produto_rota for all to authenticated
  using ((select qs_is_manager())) with check ((select qs_is_manager()));
revoke all on public.produto_rota from anon, public;
grant select, insert, update, delete on public.produto_rota to authenticated;

-- 3. Produto na reunião (qs_meetings) -------------------------------------------
-- Backfill (spec 3.3): o histórico vira 'outros' MARCADO como inferido, pra não
-- poluir a métrica — as telas avisam quando o período inclui esses registros.
-- Feito pelo DEFAULT da coluna nova (o Postgres preenche as linhas existentes
-- sem reescrevê-las): um UPDATE em massa mudaria o updated_at de todas as
-- reuniões, e o dashboard-sync (que pagina por updated_at) reenviaria tudo,
-- além de uma linha de auditoria por reunião. Depois os defaults trocam pros
-- de produção (produto sem default; inferido = false).
alter table public.qs_meetings add column if not exists produto          public.produto_tipo not null default 'outros';
alter table public.qs_meetings add column if not exists produto_inferido boolean not null default true;
alter table public.qs_meetings alter column produto drop default;
alter table public.qs_meetings alter column produto_inferido set default false;
alter table public.qs_meetings add column if not exists desfecho_sdr     public.desfecho_sdr;
alter table public.qs_meetings add column if not exists expedicao_id     uuid;
alter table public.qs_meetings add column if not exists desfecho_em      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qs_meetings_expedicao_fk') then
    alter table public.qs_meetings add constraint qs_meetings_expedicao_fk
      foreign key (expedicao_id) references public.expedicoes(id) on delete set null;
  end if;
end $$;

-- Quem grava reunião sem dizer o produto (closer marcando retomada, registro
-- retroativo, integrações) não quebra: vira 'outros' inferido, igual ao histórico.
create or replace function public._qs_meetings_produto_padrao()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.produto is null then
    new.produto := 'outros';
    new.produto_inferido := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_qs_meetings_produto_padrao on public.qs_meetings;
create trigger trg_qs_meetings_produto_padrao before insert on public.qs_meetings
  for each row execute function public._qs_meetings_produto_padrao();

comment on column public.qs_meetings.produto is 'Produto do desfecho do SDR (0321). Rota em produto_rota.';
comment on column public.qs_meetings.produto_inferido is 'true = produto não foi escolhido por ninguém (histórico ou gravação sem produto) — 0321.';
comment on column public.qs_meetings.desfecho_sdr is 'agendou = reunião nascida do desfecho do SDR (0321).';

create index if not exists idx_qs_meetings_produto on public.qs_meetings (owner_id, created_at, produto);

-- 4. Cotações ------------------------------------------------------------------
create table if not exists public.cotacoes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.qs_leads(id) on delete cascade,
  negocio_bitrix_id text,
  produto public.produto_tipo not null default 'aereo',
  sdr_id uuid not null,              -- quem originou
  responsavel_id uuid not null,      -- quem cota: o próprio SDR ou um closer
  repassada_closer boolean not null default false,
  status public.cotacao_status not null default 'solicitada',
  origem text, destino text,
  data_ida date, data_volta date,
  adultos int default 1, criancas int default 0, bebes int default 0,
  bagagem text, flexibilidade_datas text,
  orcamento_cliente numeric, observacoes text,
  valor_cotado numeric, valor_emitido numeric,
  canal_entrega public.cotacao_canal,
  motivo_perda public.cotacao_motivo_perda,
  solicitada_em timestamptz not null default now(),
  iniciada_em timestamptz, entregue_em timestamptz,
  validade_ate timestamptz, decidida_em timestamptz,
  fup_criado_em timestamptz,          -- FUP de cotação vencida já criado (cron)
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists idx_cotacoes_responsavel on public.cotacoes (responsavel_id, status);
create index if not exists idx_cotacoes_sdr on public.cotacoes (sdr_id, solicitada_em);
create index if not exists idx_cotacoes_lead on public.cotacoes (lead_id);

-- Regras de etapa (spec 3.5).
create or replace function public._cotacoes_regras()
returns trigger language plpgsql set search_path = public as $$
begin
  new.repassada_closer := new.responsavel_id is distinct from new.sdr_id;
  new.updated_at := now();

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'em_cotacao' then
      new.iniciada_em := coalesce(new.iniciada_em, now());
    elsif new.status = 'entregue' then
      if new.valor_cotado is null or new.canal_entrega is null then
        raise exception 'Pra marcar como entregue, informe o valor cotado e por onde foi entregue.'
          using errcode = 'check_violation';
      end if;
      new.iniciada_em := coalesce(new.iniciada_em, now());
      new.entregue_em := coalesce(new.entregue_em, now());
    elsif new.status = 'aprovada' then
      if new.valor_emitido is null then
        raise exception 'Pra aprovar, informe o valor emitido.' using errcode = 'check_violation';
      end if;
      new.decidida_em := coalesce(new.decidida_em, now());
    elsif new.status = 'perdida' then
      if new.motivo_perda is null then
        raise exception 'Pra marcar como perdida, informe o motivo.' using errcode = 'check_violation';
      end if;
      new.decidida_em := coalesce(new.decidida_em, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_cotacoes_regras on public.cotacoes;
create trigger trg_cotacoes_regras before insert or update on public.cotacoes
  for each row execute function public._cotacoes_regras();

alter table public.cotacoes enable row level security;

drop policy if exists cotacoes_ler on public.cotacoes;
create policy cotacoes_ler on public.cotacoes for select to authenticated
  using (sdr_id = (select auth.uid()) or responsavel_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists cotacoes_criar on public.cotacoes;
create policy cotacoes_criar on public.cotacoes for insert to authenticated
  with check (sdr_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists cotacoes_editar on public.cotacoes;
create policy cotacoes_editar on public.cotacoes for update to authenticated
  using (sdr_id = (select auth.uid()) or responsavel_id = (select auth.uid()) or (select qs_is_manager()))
  with check (sdr_id = (select auth.uid()) or responsavel_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists cotacoes_apagar on public.cotacoes;
create policy cotacoes_apagar on public.cotacoes for delete to authenticated
  using ((select qs_is_manager()));

revoke all on public.cotacoes from anon, public;
grant select, insert, update, delete on public.cotacoes to authenticated;

-- FUP de cotação vencida (spec 3.5): entregue/em aberto com validade passada e
-- sem decisão → atividade pro responsável. Roda no cron horário
-- (api/oportunidade-futura.js) — uma vez por cotação (fup_criado_em).
create or replace function public.cotacoes_fup_vencidas(p_teto int default 50)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select c.* from cotacoes c
     where c.validade_ate is not null and c.validade_ate < now()
       and c.status in ('solicitada', 'em_cotacao', 'entregue')
       and c.fup_criado_em is null
     order by c.validade_ate
     limit p_teto
     for update skip locked
  loop
    insert into qs_tasks (lead_id, owner_id, channel_type, status, priority, scheduled_at, is_extra, tags, notes)
    values (r.lead_id, r.responsavel_id, 'whatsapp', 'pendente', 'alta', now(), true,
            array['re_contato', 'cotacao-vencida'],
            format('✈️ Cotação vencida sem resposta — %s%s. Retome com o cliente (aprovou? perdeu?).',
                   coalesce(r.origem || ' → ', ''), coalesce(r.destino, 'aéreo')));
    update cotacoes set fup_criado_em = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.cotacoes_fup_vencidas(int) from public, anon, authenticated;
grant execute on function public.cotacoes_fup_vencidas(int) to service_role;

-- 5. Expedições à venda (seletor do SDR) ---------------------------------------
-- Security definer: o SDR não lê expedicoes (RLS do Operacional). Só sai
-- nome/código/data/status.
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

-- 6. Reagendar leva o produto junto ----------------------------------------------
-- qs_reagendar_reuniao (0033) lista as colunas uma a uma: sem isto a remarcada
-- nascia sem produto (o gatilho a marcaria como 'outros' inferido). Também não
-- copiava `tipo` (0054) nem `temperatura_sdr` (0311) — uma RETOMADA remarcada
-- virava "primeira" e passava a contar como reunião. Corpo igual ao vigente +
-- as colunas novas.
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
    tipo, temperatura_sdr, produto, produto_inferido, expedicao_id, desfecho_sdr, desfecho_em
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
    v_antiga.tipo, v_antiga.temperatura_sdr, v_antiga.produto, v_antiga.produto_inferido,
    v_antiga.expedicao_id, v_antiga.desfecho_sdr, v_antiga.desfecho_em
  )
  returning * into v_nova;

  return v_nova;
end;
$function$;
