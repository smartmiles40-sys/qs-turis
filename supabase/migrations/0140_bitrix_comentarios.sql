-- 0140_bitrix_comentarios.sql
-- -----------------------------------------------------------------------------
-- COMENTÁRIOS DO BITRIX NO QS (16/10/2026). Bruno: "de alguns clientes as
-- informações estão nos comentários". Importa os comentários da linha do tempo
-- de cada NEGÓCIO das viagens e de cada CONTATO das fichas
-- (crm.timeline.comment.list), pra IA e o time lerem junto com o resto.
--
-- Escreve: api/rel-bitrix-comentarios.js (cron). Lê: Relacionamento.
-- -----------------------------------------------------------------------------

create table if not exists rel_bitrix_comentarios (
  id            text primary key,                 -- id do comentário no Bitrix
  entidade      text not null check (entidade in ('deal', 'contact')),
  entidade_id   text not null,
  viagem_id     uuid references rel_viagens(id) on delete set null,
  cliente_id    uuid references rel_clientes(id) on delete set null,
  autor_id      text,
  criado_em     timestamptz,
  texto         text not null default '',
  arquivos      jsonb not null default '[]'::jsonb,
  importado_em  timestamptz not null default now()
);
create index if not exists rel_bitrix_coment_viagem_idx  on rel_bitrix_comentarios (viagem_id, criado_em);
create index if not exists rel_bitrix_coment_cliente_idx on rel_bitrix_comentarios (cliente_id, criado_em);

-- Fila: de qual negócio/contato já lemos os comentários (e quando).
create table if not exists rel_bitrix_comentarios_lidos (
  entidade     text not null,
  entidade_id  text not null,
  lido_em      timestamptz not null default now(),
  total        int not null default 0,
  erro         text,
  primary key (entidade, entidade_id)
);

alter table rel_bitrix_comentarios enable row level security;
alter table rel_bitrix_comentarios_lidos enable row level security;
revoke all on rel_bitrix_comentarios, rel_bitrix_comentarios_lidos from anon, authenticated;
grant select on rel_bitrix_comentarios to authenticated;
drop policy if exists rel_bitrix_coment_ler on rel_bitrix_comentarios;
create policy rel_bitrix_coment_ler on rel_bitrix_comentarios for select to authenticated using (rel_tem_acesso());
