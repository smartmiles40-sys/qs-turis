-- 0425_venda_item_incluso_zero.sql
-- -----------------------------------------------------------------------------
-- ITEM INCLUSO COM VALOR 0 (revisão do Subir venda, 26/11/2026).
--
-- Problema: a tela do Subir venda diz 'Item "incluso" pode ficar 0'
-- (src/venda/SubirVenda.tsx ~904), mas venda_consolidar barrava CADA item com
-- valor <= 0 ("<item>: falta o valor"). Pacote com transfer/seguro incluso
-- nunca consolidava.
--
-- Regra nova:
--   · o TOTAL da venda > 0 continua obrigatório (o "O que vendeu: falta o valor
--     dos itens" lá em cima não muda; venda_subir também segue exigindo total > 0);
--   · item individual pode ser 0 (negativo o banco já não deixa: check
--     qs_venda_itens.valor >= 0);
--   · item SEM valor (nulo) também passa, contado como 0 — mas vira AVISO
--     (lista "avisos", que não barra) pra ninguém esquecer valor sem querer;
--   · a exigência de DATA por tipo (e a de IATA do aéreo, 0369) fica igual.
-- closer_consolidar não olha valor por item (só total e parcelas) — nada a mudar lá.
--
-- Remendo na definição VIGENTE (pg_get_functiondef ao aplicar); trecho que não
-- estiver lá exatamente 1 vez PARA a migration. Idempotente (marca "0425").
--
-- Volta: pg_get_functiondef('venda_consolidar(uuid)'::regprocedure), trocar o
-- bloco "-- 0425" pela linha antiga
--   if coalesce(r.valor, 0) <= 0 then f := f || (v_nome || ': falta o valor'); end if;
-- e executar.
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

select pg_temp.qs_remendar('venda_consolidar(uuid)'::regprocedure, '0425', array[
$a$    if coalesce(r.valor, 0) <= 0 then f := f || (v_nome || ': falta o valor'); end if;$a$,
$b$    -- 0425: item incluso pode ficar 0 (o TOTAL > 0 segue obrigatório acima); sem valor conta como 0 e só avisa.
    if r.valor is null then av := av || (v_nome || ': sem valor — entrou como incluso (R$ 0). Confira se é isso.'); end if;$b$
]);
