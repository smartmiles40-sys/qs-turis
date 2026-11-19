-- 0407 — Indicações da Black (Bruno, 18/11/2026).
--
-- Campanha: disparo pra base (~1500 clientes) com um formulário onde a cliente
-- (a INDICADORA) manda até 5 pessoas (os INDICADOS). Cada indicado vira um lead
-- próprio no QS + negócio no Bitrix, e entra no rodízio dos SDRs.
--
-- Se um indicado fechar venda, a indicadora ganha uma mala com mimos. Por isso
-- a relação indicadora → indicado precisa morar num lugar que não se perde:
-- esta tabela (uma linha por indicado). O lead e o card do Bitrix também levam
-- a informação escrita (nota no QS + comentário no negócio), mas é daqui que se
-- tira o relatório de "quem ganha presente".
--
-- Só o servidor escreve (rota pública /api/lead-site, com service_role).
-- Gestão lê pelo app (qs_is_manager).

create table if not exists public.qs_indicacoes (
  id               uuid primary key default gen_random_uuid(),
  campanha         text not null default 'black-2026',
  indicadora_nome  text not null,
  indicadora_tel   text not null,
  indicado_nome    text not null,
  indicado_tel     text not null,
  lead_id          uuid references public.qs_leads(id) on delete set null,
  -- true = o telefone já tinha card nas últimas 24h (ex.: duas indicadoras
  -- mandaram a mesma pessoa no mesmo dia). O crédito do presente vai pra
  -- indicação MAIS ANTIGA daquele telefone.
  lead_ja_existia  boolean not null default false,
  envio_id         uuid not null,              -- agrupa os indicados de um mesmo envio do formulário
  presente_status  text not null default 'pendente'
                   check (presente_status in ('pendente','enviar','enviado','nao_se_aplica')),
  presente_obs     text,
  created_at       timestamptz not null default now()
);

create index if not exists qs_indicacoes_lead_idx       on public.qs_indicacoes (lead_id);
create index if not exists qs_indicacoes_indicadora_idx on public.qs_indicacoes (indicadora_tel);
create index if not exists qs_indicacoes_indicado_idx   on public.qs_indicacoes (indicado_tel);
create index if not exists qs_indicacoes_campanha_idx   on public.qs_indicacoes (campanha, created_at desc);

alter table public.qs_indicacoes enable row level security;
revoke all on public.qs_indicacoes from public, anon;
grant select, update on public.qs_indicacoes to authenticated;

drop policy if exists indicacoes_select on public.qs_indicacoes;
create policy indicacoes_select on public.qs_indicacoes for select
  using ((select qs_is_manager()));

drop policy if exists indicacoes_update on public.qs_indicacoes;
create policy indicacoes_update on public.qs_indicacoes for update
  using ((select qs_is_manager())) with check ((select qs_is_manager()));
