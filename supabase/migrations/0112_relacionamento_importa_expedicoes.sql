-- 0112_relacionamento_importa_expedicoes.sql
-- -----------------------------------------------------------------------------
-- Cruzamento com o SISTEMA DE EXPEDIÇÕES (outro Supabase, "Expedições") —
-- Bruno, 13/10/2026: lá está a contagem real de viagens de cada cliente, desde
-- 2023 (41 expedições, ~850 passageiros). scripts/importar-expedicoes.mjs lê de
-- lá e grava aqui; pode rodar quantas vezes quiser (não duplica).
--
--   • rel_viagens.origem ganha 'expedicoes' e a viagem guarda de qual
--     expedição veio (expedicoes_id).
--   • rel_expedicoes_vinculo: cada passageiro de lá → ficha + viagem daqui.
--   • rel_clientes.dados_expedicoes: o que só o sistema de Expedições sabe
--     (endereço, contato de emergência, saúde, preferências).
--   • rel_viagem_trechos.ref_externa: o voo de lá (não duplica ao reimportar).
-- -----------------------------------------------------------------------------
alter table rel_viagens drop constraint if exists rel_viagens_origem_check;
alter table rel_viagens add constraint rel_viagens_origem_check check (origem in ('bitrix', 'manual', 'expedicoes'));
alter table rel_viagens add column if not exists expedicoes_id uuid;
create index if not exists rel_viagens_expedicoes_idx on rel_viagens (expedicoes_id);
alter table rel_clientes add column if not exists dados_expedicoes jsonb;
alter table rel_viagem_trechos add column if not exists ref_externa text;
create unique index if not exists rel_viagem_trechos_ref_idx on rel_viagem_trechos (viagem_id, ref_externa);

create table if not exists rel_expedicoes_vinculo (
  passageiro_id  uuid primary key,          -- passageiros.id no sistema de Expedições
  expedicao_id   uuid not null,
  cliente_id     uuid references rel_clientes(id) on delete set null,
  viagem_id      uuid references rel_viagens(id) on delete set null,
  como           text,                      -- como achou a ficha (cpf, passaporte, telefone, nome, criada)
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists rel_expedicoes_vinculo_cliente_idx on rel_expedicoes_vinculo (cliente_id);
alter table rel_expedicoes_vinculo enable row level security;
drop policy if exists rel_expedicoes_vinculo_ler on rel_expedicoes_vinculo;
create policy rel_expedicoes_vinculo_ler on rel_expedicoes_vinculo for select to authenticated using (rel_tem_acesso());
revoke all on rel_expedicoes_vinculo from anon;
