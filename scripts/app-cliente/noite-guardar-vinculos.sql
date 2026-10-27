-- NOITE DA TROCA · rodar no QS ANTES do 04_noite_antes.sql e do copiar-dados.mjs --limpar.
-- (preparado 27/10/2026, NÃO rodado)
--
-- Por quê: o `--limpar` apaga todas as linhas de `passageiros` e recopia do antigo.
--   • `passageiros.cliente_id` (ligação com a ficha, 0172/0172b) só existe no QS → volta NULL.
--   • `cad_divergencias` tem FK on delete cascade pra passageiros → as 107 divergências somem.
-- Este script guarda as duas coisas. O `noite-restaurar-vinculos.sql` devolve depois.
-- Os ids dos passageiros são os mesmos do antigo, então a devolução casa por id.

drop table if exists _noite_pax_cliente;
create table _noite_pax_cliente as
  select id as passageiro_id, cliente_id from passageiros where cliente_id is not null;

drop table if exists _noite_cad_divergencias;
create table _noite_cad_divergencias as
  select * from cad_divergencias;

-- trava: ninguém de fora lê essas cópias
alter table _noite_pax_cliente enable row level security;
alter table _noite_cad_divergencias enable row level security;

select (select count(*) from _noite_pax_cliente) as ligacoes_guardadas,   -- esperado ≈ 922
       (select count(*) from _noite_cad_divergencias) as divergencias_guardadas;  -- ≈ 107
