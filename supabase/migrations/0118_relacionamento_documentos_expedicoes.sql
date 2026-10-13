-- 0118_relacionamento_documentos_expedicoes.sql
-- Documentos vindos do sistema de Expedições (scripts/importar-documentos-expedicoes.mjs):
-- ref_externa = 'exp-arq:<id do arquivo lá>' — reimportar não duplica.
alter table rel_documentos add column if not exists ref_externa text;
create unique index if not exists rel_documentos_ref_externa_idx on rel_documentos (ref_externa);
