-- 0428_venda_cancelar_reserva_viagem.sql
-- -----------------------------------------------------------------------------
-- CANCELAR VENDA SÓ RESERVADA TAMBÉM CANCELA A VIAGEM QUE ELA CRIOU (26/11/2026).
--
-- Problema: _venda_cancelar_exec (0367) só cancela a viagem do Rel quando a venda
-- estava CONSOLIDADA. Mas venda só RESERVADA também gera viagem:
--   reservar → cartão em pré-venda → o espelho do closer põe o card do Bitrix na
--   coluna de venda ("Em emissão") → o sincronizador do Rel (api/rel-viagens.js,
--   importarDealCore) cria rel_viagens origem 'bitrix', bitrix_deal_id = card do
--   lead, closer_negocio_id NULO, consolidada_em NULO.
-- Prova no banco (26/11): venda 4eb996dc-… reservada 12/11 14:31 → viagem
-- c81e9523-… criada 12/11 15:00, origem bitrix, 2 passageiros (titular + card
-- filho 55821 da família da venda). Ao cancelar a venda o card sai da coluna de
-- venda (volta pra etapa do cartão) e o sincronizador nunca mais lê esse card
-- (só lê colunas de venda/cancelamento) → a viagem ficava ATIVA pra sempre.
--
-- Agora, venda NÃO consolidada com cartão: acha a viagem do card do lead e
-- cancela SÓ se ela nasceu desta venda e não tem mais nada pendurado:
--   · rel_viagens.bitrix_deal_id = qs_leads.bitrix_id do lead do cartão;
--   · origem 'bitrix', status 'ativa', não mesclada, consolidada_em nulo,
--     closer_negocio_id nulo ou = este cartão;
--   · criada DEPOIS da venda (criado_em >= qs_vendas.criado_em);
--   · se a venda já aponta uma viagem (viagem_id), tem que ser essa;
--   · nenhuma outra venda viva nela; nenhum plano no Financeiro; nenhum outro
--     negócio ligado (rel_viagem_deals); nenhuma viagem mesclada nela;
--     nenhum passageiro vindo de card do Bitrix que não seja desta venda
--     (titular ou qs_venda_pessoas.bitrix_deal_id).
-- Ao cancelar: status 'cancelada' + aviso em observacoes (o texto "Venda
-- cancelada" faz a ponte 0388 não mandar o aviso de "viagem cancelada no Rel"
-- de volta) + closer_negocio_id = este cartão, pra o sincronizador do Rel NÃO
-- reativar a viagem se o card ficar parado na coluna de venda (ele só reativa
-- viagem sem consolidada_em e sem closer_negocio_id — rel-viagens.js ~593).
-- Se o closer reabrir e consolidar, closer_consolidar acha a mesma viagem pelo
-- bitrix_deal_id e a põe 'ativa' de novo (como já fazia).
-- O retorno 'viagem_cancelada' e o evento do cartão já usam v_viag (0367).
--
-- Remendo na definição VIGENTE (pg_get_functiondef ao aplicar); trecho que não
-- estiver lá exatamente 1 vez PARA a migration. Idempotente (marca "0428").
--
-- Volta: pg_get_functiondef('_venda_cancelar_exec(uuid,text,boolean)'::regprocedure),
-- apagar a linha e o bloco "0428" e executar.
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

select pg_temp.qs_remendar('_venda_cancelar_exec(uuid,text,boolean)'::regprocedure, '0428', array[
-- variável
$a$  v_movido boolean := false;$a$,
$b$  v_movido boolean := false;
  v_rv     uuid;   -- 0428$b$,
-- bloco novo, logo antes do trecho do cartão (pre_venda / etapa)
$a$  if v.negocio_id is not null then
    select * into n from qs_closer_negocios where id = v.negocio_id;
    if n.pre_venda_em is not null$a$,
$b$  -- 0428: venda só RESERVADA também tem viagem (o Bitrix cria quando a reserva põe o card na coluna de venda).
  -- Cancela essa viagem quando ela nasceu desta venda e não tem nada mais pendurado.
  if v.estado <> 'consolidada' and v.negocio_id is not null then
    select rv.id into v_rv
      from qs_closer_negocios cn
      join qs_leads l on l.id = cn.lead_id and nullif(trim(l.bitrix_id), '') is not null
      join rel_viagens rv on rv.bitrix_deal_id = trim(l.bitrix_id)
     where cn.id = v.negocio_id
       and rv.mesclada_em_id is null and rv.status = 'ativa' and rv.origem = 'bitrix'
       and rv.consolidada_em is null
       and (rv.closer_negocio_id is null or rv.closer_negocio_id = v.negocio_id)
       and rv.criado_em >= v.criado_em
       and (v.viagem_id is null or v.viagem_id = rv.id)
       and not exists (select 1 from qs_vendas o
                        where o.id <> v.id and o.estado <> 'cancelada'
                          and (o.viagem_id = rv.id or o.negocio_id = v.negocio_id))
       and not exists (select 1 from fin_planos pl where pl.viagem_id = rv.id)
       and not exists (select 1 from rel_viagem_deals d where d.viagem_id = rv.id)
       and not exists (select 1 from rel_viagens m where m.mesclada_em_id = rv.id)
       and not exists (select 1 from rel_viagem_passageiros rp
                        where rp.viagem_id = rv.id and rp.bitrix_deal_id is not null
                          and rp.bitrix_deal_id <> trim(l.bitrix_id)
                          and not exists (select 1 from qs_venda_pessoas vp
                                           where vp.venda_id = v.id and vp.bitrix_deal_id = rp.bitrix_deal_id))
     order by rv.criado_em
     limit 1;
    if v_rv is not null then
      update rel_viagens set
        status = 'cancelada',
        closer_negocio_id = coalesce(closer_negocio_id, v.negocio_id),
        observacoes = concat_ws(E'\n', nullif(observacoes, ''),
          '[Aviso QS ' || v_hoje || '] Venda cancelada: ' || v_mot
          || '. A viagem tinha nascido da reserva (card do Bitrix na coluna de venda) — cancelada junto.')
       where id = v_rv;
      v_viag := true;
    end if;
  end if;

  if v.negocio_id is not null then
    select * into n from qs_closer_negocios where id = v.negocio_id;
    if n.pre_venda_em is not null$b$
]);
