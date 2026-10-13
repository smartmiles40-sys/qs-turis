-- 0110_relacionamento_pos_venda_bilhetes.sql
-- -----------------------------------------------------------------------------
-- Bruno (13/10/2026): "todo mundo tem que estar em Processo Pós Venda — Viagem;
-- puxe os bilhetes dos voos que estão dentro do card de cada cliente".
--
--   • Documento tipo 'bilhete' (passagem / e-ticket).
--   • Cada arquivo anexado num card do Bitrix vira UMA linha em
--     rel_bitrix_arquivos (fila): a importação enfileira, e cada rodada baixa
--     alguns, sobe no bucket privado e cria o rel_documentos. Nunca baixa o
--     mesmo arquivo duas vezes (file_id do Bitrix é a chave).
--   • O card do Pós-Venda normalmente é a MESMA viagem do card de venda: fica
--     ligado em rel_viagem_deals, que agora guarda também a cópia dos campos
--     dele (bitrix_dados) — é onde estão os voos.
-- -----------------------------------------------------------------------------

alter table rel_documentos drop constraint if exists rel_documentos_tipo_check;
alter table rel_documentos add constraint rel_documentos_tipo_check
  check (tipo in ('passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro', 'voucher', 'bilhete', 'contrato', 'comprovante', 'foto', 'outro'));
alter table rel_documentos add column if not exists bitrix_arquivo_id text;
-- índice cheio (não parcial): o upsert on_conflict=bitrix_arquivo_id precisa dele; nulos não colidem.
create unique index if not exists rel_documentos_bitrix_arquivo_idx on rel_documentos (bitrix_arquivo_id);

alter table rel_viagem_deals add column if not exists bitrix_dados jsonb;
alter table rel_viagem_deals add column if not exists bitrix_lido_em timestamptz;

create table if not exists rel_bitrix_arquivos (
  file_id       text primary key,                 -- id do arquivo no Bitrix
  deal_id       text not null,
  campo         text not null,                    -- UF_CRM_... do card
  rotulo        text,                             -- nome do campo ("Bilhete aéreo")
  tipo          text not null default 'outro',    -- tipo do rel_documentos que vai virar
  viagem_id     uuid references rel_viagens(id) on delete cascade,
  cliente_id    uuid references rel_clientes(id) on delete cascade,
  status        text not null default 'pendente' check (status in ('pendente', 'ok', 'erro', 'ignorado')),
  erro          text,
  tentativas    integer not null default 0,
  documento_id  uuid references rel_documentos(id) on delete set null,
  criado_em     timestamptz not null default now(),
  baixado_em    timestamptz
);
create index if not exists rel_bitrix_arquivos_fila_idx on rel_bitrix_arquivos (status, criado_em);

alter table rel_bitrix_arquivos enable row level security;
drop policy if exists rel_bitrix_arquivos_ler on rel_bitrix_arquivos;
create policy rel_bitrix_arquivos_ler on rel_bitrix_arquivos for select to authenticated using (rel_tem_acesso());
revoke all on rel_bitrix_arquivos from anon;
