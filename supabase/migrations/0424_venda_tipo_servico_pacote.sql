-- 0424_venda_tipo_servico_pacote.sql
-- -----------------------------------------------------------------------------
-- TIPO DE SERVIÇO DA VIAGEM (revisão do Subir venda, 26/11/2026).
--
-- Problema: sem expedição, venda_consolidar escolhia o serviço da viagem pelo
-- item MAIS CARO (order by valor desc limit 1, vindo da 0369). Venda de pacote
-- montado (aéreo R$ 8 mil + hotel R$ 5 mil) virava "aéreo"; e com item incluso
-- valendo 0 (0425) a escolha ficava ainda mais aleatória.
--
-- Regra nova (na ordem):
--   1) tem item 'expedicao'                          → expedicao (igual a antes)
--   2) tem item 'pacote'                             → pacote
--   3) tem 'aereo' + algum de hospedagem / passeio / transfer / trem / carro /
--      cruzeiro                                      → pacote
--   4) senão                                         → o do item mais caro (igual a antes)
-- seguro / visto / concierge / outro sozinhos NÃO transformam aéreo em pacote.
--
-- Valores aceitos no destino (conferido 26/11):
--   · com cartão → vai como ficha.servico pro closer_consolidar, que aceita
--     expedicao, pacote, aereo, hospedagem, passeio, cruzeiro, seguro, concierge,
--     conta_liminar, outro e converte em rel_viagens.tipo;
--   · sem cartão → rel_viagens.tipo (check: expedicao, pacote, aereo, hospedagem,
--     outro) pelo case que já existe, e servico_manual (check aceita pacote).
--   'pacote' passa nos três. O destino (v_dest) continua o nome do item mais caro.
--
-- Remendo na definição VIGENTE (pg_get_functiondef ao aplicar); trecho que não
-- estiver lá exatamente 1 vez PARA a migration. Idempotente (marca "0424").
--
-- Volta: pg_get_functiondef('venda_consolidar(uuid)'::regprocedure), apagar o
-- bloco "-- 0424" e executar.
-- -----------------------------------------------------------------------------

create or replace function pg_temp.qs_remendar(p_fn regprocedure, p_marca text, p_trocas text[])
returns void language plpgsql as $f$
declare
  d    text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  de   text;
  para text;
  n    int;
begin
  if position(p_marca in d) > 0 then
    raise notice '% já tem a marca % — nada a fazer.', p_fn, p_marca;
    return;
  end if;
  for k in 1 .. coalesce(array_length(p_trocas, 1), 0) / 2 loop
    de   := replace(p_trocas[2 * k - 1], E'\r\n', E'\n');
    para := replace(p_trocas[2 * k], E'\r\n', E'\n');
    n := (length(d) - length(replace(d, de, ''))) / length(de);
    if n <> 1 then
      raise exception '%: o trecho % aparece % vez(es) na versão vigente (esperado 1) — a função mudou; revise a migration %.', p_fn, k, n, p_marca;
    end if;
    d := replace(d, de, para);
  end loop;
  if position(p_marca in d) = 0 then raise exception '%: a marca % não entrou.', p_fn, p_marca; end if;
  execute d;
end $f$;

select pg_temp.qs_remendar('venda_consolidar(uuid)'::regprocedure, '0424', array[
$a$    v_dest := coalesce(nullif(trim(n.ficha ->> 'destino'), ''), v_msg);$a$,
$b$    -- 0424: pacote ganha do item mais caro ('pacote' na venda, ou aéreo + hospedagem/passeio/transfer/trem/carro/cruzeiro).
    v_serv := coalesce((
      select case when bool_or(i.tipo = 'pacote') then 'pacote'
                  when bool_or(i.tipo = 'aereo')
                       and bool_or(i.tipo in ('hospedagem','passeio','transfer','trem','carro','cruzeiro')) then 'pacote' end
        from qs_venda_itens i
       where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado'), v_serv);
    v_dest := coalesce(nullif(trim(n.ficha ->> 'destino'), ''), v_msg);$b$
]);
