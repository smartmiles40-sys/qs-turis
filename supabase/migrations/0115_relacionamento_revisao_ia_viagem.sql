-- 0115_relacionamento_revisao_ia_viagem.sql
-- -----------------------------------------------------------------------------
-- REVISÃO DA VIAGEM PELA IA (Bruno, 13/10/2026): "a IA revisa aéreos, seguro
-- viagem etc., cruza os dados pra ver se é tudo a mesma viagem, e identifica o
-- que é voo interno, transfer..."
--   • rel_viagens.ia_revisao (jsonb): o que a IA leu de cada documento + as
--     divergências que o servidor achou ao cruzar; status ok/divergente/
--     incompleta/erro.
--   • rel_viagem_trechos.fonte: de onde veio o trecho (manual, expedicoes,
--     bitrix, ia) + confiança da IA + documento de origem.
-- -----------------------------------------------------------------------------
alter table rel_viagens add column if not exists ia_revisao        jsonb;
alter table rel_viagens add column if not exists ia_revisao_em     timestamptz;
alter table rel_viagens add column if not exists ia_revisao_status text
  check (ia_revisao_status is null or ia_revisao_status in ('ok', 'divergente', 'incompleta', 'erro'));
alter table rel_viagem_trechos add column if not exists fonte text not null default 'manual'
  check (fonte in ('manual', 'expedicoes', 'bitrix', 'ia'));
alter table rel_viagem_trechos add column if not exists ia_confianca numeric;
alter table rel_viagem_trechos add column if not exists documento_id uuid references rel_documentos(id) on delete set null;
update rel_viagem_trechos set fonte = 'expedicoes' where ref_externa like 'exp-voo:%' and fonte = 'manual';

-- a view usa t.*: recria pra trazer as colunas novas
drop view if exists rel_trechos_v;
create view rel_trechos_v
with (security_invoker = true) as
select t.*,
       coalesce(t.checkin_abre_em,
                case when t.tipo in ('voo_internacional', 'voo_interno') then t.partida_em - interval '48 hours'
                     when t.tipo = 'trem' then t.partida_em - interval '24 hours' end) as checkin_em,
       v.tipo as viagem_tipo, v.titulo as viagem_titulo, v.destino as viagem_destino,
       v.expedicao, v.status as viagem_status
  from rel_viagem_trechos t
  join rel_viagens v on v.id = t.viagem_id;
grant select on rel_trechos_v to authenticated;
revoke all on rel_trechos_v from anon;
