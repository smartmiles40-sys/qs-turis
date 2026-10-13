-- 0108_relacionamento_historico_bitrix.sql
-- -----------------------------------------------------------------------------
-- Histórico completo do Bitrix no Relacionamento (13/10/2026, pedido do Bruno):
-- além do Comercial 1, as vendas do Comercial 2 – Relacionamento e de
-- Operações viram viagem, desde o primeiro negócio.
--
-- O mesmo cliente pode ter a "mesma" viagem em dois funis (ex.: vendeu no
-- Comercial 1 e o card de Operações repete). Quando bate cliente + data de
-- embarque + destino/expedição, o negócio NÃO cria viagem nova: fica ligado à
-- que já existe em rel_viagem_deals, marcado pra conferência.
-- -----------------------------------------------------------------------------

alter table rel_viagens add column if not exists bitrix_funil text;   -- nome do funil do negócio principal

create table if not exists rel_viagem_deals (
  bitrix_deal_id text primary key,
  viagem_id      uuid not null references rel_viagens(id) on delete cascade,
  funil          text,
  motivo         text not null default 'mesma_viagem',  -- por que foi ligado em vez de criar
  conferido_em   timestamptz,                           -- o time confirmou que é a mesma viagem
  conferido_por  uuid references qs_users(id) on delete set null,
  criado_em      timestamptz not null default now()
);
create index if not exists rel_viagem_deals_viagem_idx on rel_viagem_deals (viagem_id);

alter table rel_viagem_deals enable row level security;
drop policy if exists rel_viagem_deals_ler   on rel_viagem_deals;
drop policy if exists rel_viagem_deals_mudar on rel_viagem_deals;
create policy rel_viagem_deals_ler   on rel_viagem_deals for select to authenticated using (rel_tem_acesso());
create policy rel_viagem_deals_mudar on rel_viagem_deals for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
revoke all on rel_viagem_deals from anon;
