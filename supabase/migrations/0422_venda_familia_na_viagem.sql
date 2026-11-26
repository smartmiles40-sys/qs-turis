-- 0422_venda_familia_na_viagem.sql
-- -----------------------------------------------------------------------------
-- FAMÍLIA NO RELACIONAMENTO (revisão do Subir venda, 26/11/2026).
--
-- Problema: ao consolidar pelo Subir venda, só o TITULAR virava passageiro da
-- viagem do Rel (rel_viagens_gatilho põe só rel_viagens.cliente_id em
-- rel_viagem_passageiros). Cônjuge/filhos/amigos da venda (qs_venda_pessoas)
-- só chegavam se o card filho do Bitrix fosse importado pelo sincronizador do
-- Rel (api/rel-viagens.js) — ou seja, dependia do Bitrix.
--
-- Agora venda_consolidar, logo antes de marcar a venda como consolidada (vale
-- pros DOIS caminhos: com cartão de closer → closer_consolidar, e sem cartão →
-- viagem criada/achada aqui), grava CADA pessoa viva da venda
-- (qs_venda_pessoas, removida_em is null) em rel_viagem_passageiros da viagem.
--   · qs_venda_pessoas.cliente_id é NOT NULL (conferido 26/11): toda pessoa da
--     venda já tem ficha rel_clientes — quem cria é venda_cliente_resolver /
--     _venda_pessoas_sincronizar no venda_subir. Não precisa criar ficha aqui.
--   · Ficha mesclada (rel_clientes.mesclado_em_id) → entra a ficha principal.
--   · Sem duplicar: unique (viagem_id, cliente_id) + on conflict do nothing.
--   · bitrix_deal_id fica NULO de propósito: o índice único
--     rel_viagem_pass_bitrix_uq (bitrix_deal_id) derrubaria a consolidação se o
--     card filho já estivesse em outra viagem. Quando o sincronizador do Rel ler
--     o card filho, ele faz merge em (viagem_id, cliente_id) e preenche o id.
--   · Pessoa removida da venda depois NÃO é tirada da viagem (pode ter vindo do
--     Bitrix/do time) — o Rel tira na tela se for o caso.
-- Dados atuais: nenhuma venda consolidada em qs_vendas (26/11: 2 negociação,
-- 1 reservada de teste) → não precisa backfill.
--
-- COMO É FEITO: remendo na definição VIGENTE (pg_get_functiondef no momento de
-- aplicar), trocando só o trecho abaixo. Se o trecho não estiver lá exatamente
-- 1 vez, a migration PARA com erro (ninguém sobrescreve versão mais nova sem
-- ver). Idempotente: se a marca "0422" já estiver na função, não faz nada.
--
-- Volta: aplicar de novo a venda_consolidar sem o bloco "0422" — ou seja, rodar:
--   select pg_get_functiondef('venda_consolidar(uuid)'::regprocedure);
--   apagar o bloco marcado "-- 0422" e executar o resultado.
--   (as linhas já gravadas em rel_viagem_passageiros podem ficar.)
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

select pg_temp.qs_remendar('venda_consolidar(uuid)'::regprocedure, '0422', array[
$a$  update qs_vendas set estado = 'consolidada', consolidada_em = coalesce(consolidada_em, now()),$a$,
$b$  -- 0422: a família inteira da venda vira passageira da viagem do Rel (não só o titular).
  if v_viagem is not null then
    insert into rel_viagem_passageiros (viagem_id, cliente_id)
    select distinct v_viagem, coalesce(rc.mesclado_em_id, rc.id)
      from qs_venda_pessoas vp join rel_clientes rc on rc.id = vp.cliente_id
     where vp.venda_id = v.id and vp.removida_em is null
    on conflict (viagem_id, cliente_id) do nothing;
  end if;

  update qs_vendas set estado = 'consolidada', consolidada_em = coalesce(consolidada_em, now()),$b$
]);
