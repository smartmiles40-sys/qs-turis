-- 0206 — Cronômetro da cotação de aéreo do SDR (Bruno, 27/10/2026)
--
-- Cotação de aéreo saiu da META. Agora é um REGISTRO de tempo: o SDR aperta
-- "Cotando aéreo" no card do lead e "Terminei" quando acaba. Serve pra mostrar
-- no Desempenho quantas cotações cada um fez e quanto tempo isso tomou.
--
-- Uma linha por cotação. terminado_em nulo = em andamento (no máximo uma por
-- pessoa, garantido pelo índice parcial). O SDR só vê e mexe nas dele; gestor
-- e admin veem todas.

create table if not exists qs_aereo_cotacoes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references qs_leads(id) on delete set null,
  owner_id     uuid not null default auth.uid() references qs_users(id) on delete cascade,
  iniciado_em  timestamptz not null default now(),
  terminado_em timestamptz,
  created_at   timestamptz not null default now(),
  constraint qs_aereo_cotacoes_fim_depois check (terminado_em is null or terminado_em >= iniciado_em)
);

create unique index if not exists qs_aereo_cotacoes_uma_aberta
  on qs_aereo_cotacoes (owner_id) where terminado_em is null;
create index if not exists qs_aereo_cotacoes_owner_inicio
  on qs_aereo_cotacoes (owner_id, iniciado_em desc);

alter table qs_aereo_cotacoes enable row level security;

drop policy if exists qs_aereo_cotacoes_ler on qs_aereo_cotacoes;
create policy qs_aereo_cotacoes_ler on qs_aereo_cotacoes
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select qs_is_manager()));

drop policy if exists qs_aereo_cotacoes_criar on qs_aereo_cotacoes;
create policy qs_aereo_cotacoes_criar on qs_aereo_cotacoes
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists qs_aereo_cotacoes_terminar on qs_aereo_cotacoes;
create policy qs_aereo_cotacoes_terminar on qs_aereo_cotacoes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists qs_aereo_cotacoes_apagar on qs_aereo_cotacoes;
create policy qs_aereo_cotacoes_apagar on qs_aereo_cotacoes
  for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on qs_aereo_cotacoes from anon, public;
grant select, insert, update, delete on qs_aereo_cotacoes to authenticated;
