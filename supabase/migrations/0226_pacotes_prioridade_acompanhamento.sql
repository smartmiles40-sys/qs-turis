-- 0226_pacotes_prioridade_acompanhamento.sql
-- ESCRITA em 30/10/2026 (V2). NÃO APLICADA. O front degrada sem ela (o painel avisa
-- "falta aplicar a 0226" e os selos somem).
--
-- Pedido do Bruno: "Nos pacotes, preciso SELECIONAR os que são PRIORIDADE (quem
-- investiu um valor a mais, influenciador viajando, grupos grandes) e ter
-- acompanhamento DIÁRIO, igual pro Relacionamento e pra Operações."
--
-- Modelo:
--   rel_prioridades            um ACOMPANHAMENTO prioritário (um pacote ou um GRUPO).
--                              Motivos + quem marcou/quando + responsável no Rel e em Ops.
--   rel_prioridade_viagens     as viagens (rel_viagens) do acompanhamento. Um grupo vem
--                              do Bitrix como vários negócios (ex.: 18 negócios da
--                              família Sobreira, Madri/Barcelona 29/10–08/11); aqui viram UM.
--                              Uma viagem está em no máximo UM acompanhamento (unique).
--   rel_prioridade_checks      o "check do dia": quem acompanhou, ok/problema, nota.
--                              Vários por dia (Rel e Ops), histórico por dia.
--   rel_prioridade_alteracoes  alterações a fazer (descrição, responsável, feito sim/não).
--   rel_prioridades_config     N do "grupo grande" e o valor que sugere "VIP" (só sugestão;
--                              quem marca é sempre uma pessoa).
--
-- Quem mexe: qualquer pessoa do Relacionamento OU de Operações (rel_tem_acesso() /
-- ops_tem_acesso()). A config: quem configura o Rel ou Ops.
-- Idempotente (if not exists / drop policy if exists / on conflict do nothing).

-- ── 1) acompanhamento prioritário ───────────────────────────────────────────
create table if not exists public.rel_prioridades (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  motivos          text[] not null default '{}',
  motivo_outro     text,
  observacoes      text,
  resp_rel_id      uuid references public.qs_users(id) on delete set null,
  resp_ops_id      uuid references public.qs_users(id) on delete set null,
  ativo            boolean not null default true,
  marcado_por      uuid references auth.users(id) on delete set null default auth.uid(),
  marcado_em       timestamptz not null default now(),
  desmarcado_por   uuid references auth.users(id) on delete set null,
  desmarcado_em    timestamptz,
  atualizado_em    timestamptz not null default now(),
  constraint rel_prioridades_motivos_ok check (motivos <@ array['vip','influenciador','grupo_grande','outro']::text[]),
  constraint rel_prioridades_nome_ok check (length(btrim(nome)) between 1 and 200)
);
create index if not exists rel_prioridades_ativo_idx on public.rel_prioridades (ativo);

create table if not exists public.rel_prioridade_viagens (
  prioridade_id uuid not null references public.rel_prioridades(id) on delete cascade,
  viagem_id     uuid not null references public.rel_viagens(id) on delete cascade,
  incluido_por  uuid references auth.users(id) on delete set null default auth.uid(),
  incluido_em   timestamptz not null default now(),
  primary key (prioridade_id, viagem_id),
  constraint rel_prioridade_viagens_uma unique (viagem_id)
);

create table if not exists public.rel_prioridade_checks (
  id            uuid primary key default gen_random_uuid(),
  prioridade_id uuid not null references public.rel_prioridades(id) on delete cascade,
  -- "hoje" do time (São Paulo), igual ao rel_hoje()
  dia           date not null default (now() at time zone 'America/Sao_Paulo')::date,
  situacao      text not null check (situacao in ('ok','problema')),
  nota          text check (nota is null or length(nota) <= 2000),
  setor         text check (setor is null or setor in ('relacionamento','operacional')),
  feito_por     uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists rel_prioridade_checks_dia_idx on public.rel_prioridade_checks (prioridade_id, dia desc);

create table if not exists public.rel_prioridade_alteracoes (
  id             uuid primary key default gen_random_uuid(),
  prioridade_id  uuid not null references public.rel_prioridades(id) on delete cascade,
  viagem_id      uuid references public.rel_viagens(id) on delete set null,
  descricao      text not null check (length(btrim(descricao)) between 1 and 2000),
  responsavel_id uuid references public.qs_users(id) on delete set null,
  prazo          date,
  feita_em       timestamptz,
  feita_por      uuid references auth.users(id) on delete set null,
  criado_por     uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists rel_prioridade_alteracoes_idx on public.rel_prioridade_alteracoes (prioridade_id, feita_em);

create table if not exists public.rel_prioridades_config (
  id             int primary key default 1 check (id = 1),
  grupo_minimo   int not null default 6 check (grupo_minimo between 2 and 200),
  valor_vip      numeric not null default 50000 check (valor_vip >= 0),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz not null default now()
);
insert into public.rel_prioridades_config (id) values (1) on conflict (id) do nothing;

-- atualizado_em sozinho
create or replace function public._rel_prioridades_tocar()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end; $$;
drop trigger if exists rel_prioridades_tocar on public.rel_prioridades;
create trigger rel_prioridades_tocar before update on public.rel_prioridades
  for each row execute function public._rel_prioridades_tocar();

-- ── 2) RLS: Rel OU Ops, as duas áreas iguais ────────────────────────────────
alter table public.rel_prioridades           enable row level security;
alter table public.rel_prioridade_viagens    enable row level security;
alter table public.rel_prioridade_checks     enable row level security;
alter table public.rel_prioridade_alteracoes enable row level security;
alter table public.rel_prioridades_config    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rel_prioridades','rel_prioridade_viagens','rel_prioridade_checks','rel_prioridade_alteracoes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rel_ops', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select rel_tem_acesso()) or (select ops_tem_acesso())) with check ((select rel_tem_acesso()) or (select ops_tem_acesso()))',
      t || '_rel_ops', t);
    execute format('drop policy if exists app_cliente_barreira on public.%I', t);
    execute format(
      'create policy app_cliente_barreira on public.%I as restrictive for all to authenticated using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()))', t);
  end loop;
end $$;

drop policy if exists rel_prioridades_config_ler on public.rel_prioridades_config;
create policy rel_prioridades_config_ler on public.rel_prioridades_config for select to authenticated
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()));
drop policy if exists rel_prioridades_config_mudar on public.rel_prioridades_config;
create policy rel_prioridades_config_mudar on public.rel_prioridades_config for update to authenticated
  using ((select rel_pode_configurar()) or (select ops_pode_configurar()))
  with check ((select rel_pode_configurar()) or (select ops_pode_configurar()));
drop policy if exists app_cliente_barreira on public.rel_prioridades_config;
create policy app_cliente_barreira on public.rel_prioridades_config as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));

grant select, insert, update, delete on public.rel_prioridades, public.rel_prioridade_viagens,
  public.rel_prioridade_checks, public.rel_prioridade_alteracoes to authenticated;
grant select, update on public.rel_prioridades_config to authenticated;
revoke all on public.rel_prioridades, public.rel_prioridade_viagens, public.rel_prioridade_checks,
  public.rel_prioridade_alteracoes, public.rel_prioridades_config from anon;

-- ── 3) ao vivo: Rel e Ops veem o check um do outro na hora ──────────────────
do $$
declare t text;
begin
  foreach t in array array['rel_prioridades','rel_prioridade_viagens','rel_prioridade_checks','rel_prioridade_alteracoes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── ROLLBACK (rodar à mão, se precisar desfazer) ────────────────────────────
-- do $$ declare t text; begin
--   foreach t in array array['rel_prioridades','rel_prioridade_viagens','rel_prioridade_checks','rel_prioridade_alteracoes'] loop
--     if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
--       execute format('alter publication supabase_realtime drop table public.%I', t);
--     end if;
--   end loop; end $$;
-- drop table if exists public.rel_prioridade_alteracoes;
-- drop table if exists public.rel_prioridade_checks;
-- drop table if exists public.rel_prioridade_viagens;
-- drop table if exists public.rel_prioridades;
-- drop table if exists public.rel_prioridades_config;
-- drop function if exists public._rel_prioridades_tocar();
