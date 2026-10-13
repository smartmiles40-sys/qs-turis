-- 0109_relacionamento_bitrix_dados_completos.sql
-- -----------------------------------------------------------------------------
-- "Carregar a base é TODOS os dados que temos no Bitrix" (Bruno, 13/10/2026).
-- Além das colunas que o QS usa, cada viagem guarda a cópia de TODOS os campos
-- preenchidos do negócio, e cada ficha a do contato — com o nome do campo e o
-- texto da opção (não o ID). É espelho: a importação sobrescreve.
-- -----------------------------------------------------------------------------
alter table rel_viagens  add column if not exists bitrix_dados jsonb;
alter table rel_viagens  add column if not exists bitrix_lido_em timestamptz;
alter table rel_clientes add column if not exists bitrix_dados jsonb;
alter table rel_clientes add column if not exists bitrix_lido_em timestamptz;
