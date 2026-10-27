-- NOITE DA TROCA · rodar no QS DEPOIS de 05_noite_depois.sql + 02_fks.sql.
-- (preparado 27/10/2026, NÃO rodado) — par do noite-guardar-vinculos.sql.

-- 1) Devolve a ligação passageiro → ficha (só onde a recópia deixou vazio e a ficha ainda existe).
--    Desliga só o gatilho do cadastro único durante a volta, pra não reconciliar campo por campo.
alter table passageiros disable trigger cad_passageiro_upd;
update passageiros p
   set cliente_id = b.cliente_id
  from _noite_pax_cliente b
 where p.id = b.passageiro_id
   and p.cliente_id is null
   and exists (select 1 from rel_clientes c where c.id = b.cliente_id);
alter table passageiros enable trigger cad_passageiro_upd;

-- 2) Devolve as divergências ainda abertas cujos passageiros voltaram.
insert into cad_divergencias
select d.* from _noite_cad_divergencias d
 where exists (select 1 from passageiros p where p.id = d.passageiro_id)
on conflict do nothing;

-- 3) Passageiros NOVOS (entraram no antigo depois de 23/10) ou que perderam a ficha:
--    liga pelo mesmo caminho da 0172b (acha por CPF/passaporte/…; cria ficha se não achar).
do $$
declare r record; n int := 0;
begin
  for r in select id from passageiros where cliente_id is null order by created_at loop
    perform cad_ligar_passageiro(r.id, true);
    n := n + 1;
  end loop;
  raise notice 'Passageiros religados pela regra da 0172b: %', n;
end $$;

-- 4) Conferência: esperado ≈ todos ligados menos líder/lead/cancelado (em 23/10: 922 de 930).
select count(*) as passageiros,
       count(*) filter (where cliente_id is not null) as com_ficha,
       (select count(*) from cad_divergencias) as divergencias
  from passageiros;

-- 5) Só depois de conferir (no dia seguinte):
-- drop table _noite_pax_cliente; drop table _noite_cad_divergencias;
