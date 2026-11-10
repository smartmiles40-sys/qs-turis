-- supabase/migrations/0354_mkt_links_agendamento.sql
-- -----------------------------------------------------------------------------
-- LINKS DE AGENDAMENTO NO MARKETING (Bruno, 10/11/2026)
--   "todo mundo fica me pedindo para criar links de agendamentos com os SDRs e
--    Closers. O que eu quero é o pessoal do marketing conseguir criar esses
--    links e já deixar traqueado tudo"
--
-- O link continua sendo o /agendar/ de sempre (rodízio de closer ou ligação com
-- o SDR dono do lead). O que o Marketing ganha:
--   • mkt_links_agendamento: cada link criado (tipo, expedição, origem, UTMs) com
--     um CÓDIGO curto que vai na URL (&l=codigo);
--   • mkt_link_agendamento_usos: cada agendamento feito por um link — gravado
--     pelo /api/agendar (service role) quando a URL traz um código válido;
--   • mkt_links_agendamento_resumo(): agendados / realizadas / no-show por link.
-- As UTMs vão pro lead do QS (qs_leads.utm_*, 0265) e pro negócio do Bitrix
-- (campos padrão UTM_*) — isso é do api/agendar.js, não daqui.
-- -----------------------------------------------------------------------------

create table if not exists public.mkt_links_agendamento (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique check (codigo ~ '^[a-z0-9-]{3,60}$'),
  nome          text not null check (length(btrim(nome)) between 2 and 120),
  tipo          text not null check (tipo in ('closer', 'sdr', 'sdr-semana')),
  expedicao     text,
  origem        text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  dias          int check (dias is null or dias between 1 and 14),
  -- "colocar a data que vai ser feito, 2 dias úteis, 3 dias úteis para frente":
  -- até quantos dias úteis o link deixa marcar (vai na URL como ?uteis=N).
  dias_uteis    int not null default 3 check (dias_uteis between 1 and 3),
  tema_stfv     boolean not null default false,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  arquivado_em  timestamptz
);

create table if not exists public.mkt_link_agendamento_usos (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.mkt_links_agendamento(id) on delete cascade,
  lead_id     uuid,
  meeting_id  uuid,
  ligacao_id  uuid,
  tipo        text not null,
  quando      timestamptz,           -- horário marcado
  criado_em   timestamptz not null default now()
);
create index if not exists mkt_link_agendamento_usos_link on public.mkt_link_agendamento_usos (link_id, criado_em desc);

alter table public.mkt_links_agendamento     enable row level security;
alter table public.mkt_link_agendamento_usos enable row level security;

drop policy if exists mkt_links_agendamento_ler on public.mkt_links_agendamento;
create policy mkt_links_agendamento_ler on public.mkt_links_agendamento
  for select to authenticated using (public.mkt_tem_acesso());
drop policy if exists mkt_links_agendamento_inserir on public.mkt_links_agendamento;
create policy mkt_links_agendamento_inserir on public.mkt_links_agendamento
  for insert to authenticated with check (public.mkt_tem_acesso());
drop policy if exists mkt_links_agendamento_mudar on public.mkt_links_agendamento;
create policy mkt_links_agendamento_mudar on public.mkt_links_agendamento
  for update to authenticated using (public.mkt_tem_acesso()) with check (public.mkt_tem_acesso());

-- Usos: só leitura pela tela; quem grava é o servidor (service role).
drop policy if exists mkt_link_agendamento_usos_ler on public.mkt_link_agendamento_usos;
create policy mkt_link_agendamento_usos_ler on public.mkt_link_agendamento_usos
  for select to authenticated using (public.mkt_tem_acesso());

revoke all on public.mkt_links_agendamento, public.mkt_link_agendamento_usos from anon;
grant select, insert, update on public.mkt_links_agendamento to authenticated;
grant select on public.mkt_link_agendamento_usos to authenticated;

-- Resumo por link: quantos agendaram, e das reuniões com especialista quantas
-- aconteceram / deram no-show.
create or replace function public.mkt_links_agendamento_resumo()
returns table (link_id uuid, agendados int, ultimos_7d int, realizadas int, no_show int, ultimo_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mkt_tem_acesso() then raise exception 'sem-permissao'; end if;
  return query
    select u.link_id,
           count(*)::int,
           count(*) filter (where u.criado_em > now() - interval '7 days')::int,
           count(m.id) filter (where m.status = 'realizada')::int,
           count(m.id) filter (where m.status = 'no_show')::int,
           max(u.criado_em)
      from mkt_link_agendamento_usos u
      left join qs_meetings m on m.id = u.meeting_id
     group by u.link_id;
end;
$$;
revoke all on function public.mkt_links_agendamento_resumo() from public, anon;
grant execute on function public.mkt_links_agendamento_resumo() to authenticated;
