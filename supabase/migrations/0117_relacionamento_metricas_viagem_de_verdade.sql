-- 0117_relacionamento_metricas_viagem_de_verdade.sql
-- -----------------------------------------------------------------------------
-- A contagem de viagens por cliente contava TODA venda do Bitrix como viagem:
-- seguro, passagem aérea e hotel avulsos (622 vendas) inflavam as categorias
-- (cliente com 23 "viagens"). Agora: viagem = expedição ou pacote, e a mesma
-- viagem vendida em dois lugares (Bitrix + sistema de Expedições, mesmo tipo e
-- embarque) conta uma vez. O resto vira compras_avulsas (soma no LTV).
-- compras_avulsas entra no FIM da view (create or replace exige colunas novas no fim).
-- -----------------------------------------------------------------------------
create or replace view rel_cliente_metricas
with (security_invoker = true) as
with hoje as (select rel_hoje() as d),
viagens_do_cliente as (
  select v.id, v.tipo, v.valor, v.data_embarque, v.data_retorno, v.cliente_id as titular, x.cliente_id
    from rel_viagens v
    join lateral (
      select v.cliente_id union select p.cliente_id from rel_viagem_passageiros p where p.viagem_id = v.id
    ) x on x.cliente_id is not null
   where v.status = 'ativa'
),
agg as (
  -- VIAGEM = expedição ou pacote. A mesma viagem vendida em dois lugares (mesmo
  -- tipo + mesmo embarque) conta UMA vez. Aéreo/hotel/seguro avulsos são
  -- "compras avulsas": somam no valor (LTV), não contam como viagem. (0117)
  select cliente_id,
         count(distinct case when tipo in ('expedicao', 'pacote') then tipo || coalesce(data_embarque::text, id::text) end) as viagens_compradas,
         count(distinct case when tipo in ('expedicao', 'pacote') and coalesce(data_retorno, data_embarque) < (select d from hoje)
                             then tipo || coalesce(data_embarque::text, id::text) end) as viagens_realizadas,
         count(distinct case when tipo = 'expedicao' then coalesce(data_embarque::text, id::text) end) as expedicoes,
         count(distinct case when tipo = 'pacote' then coalesce(data_embarque::text, id::text) end)    as pacotes,
         count(distinct id) filter (where tipo not in ('expedicao', 'pacote'))  as compras_avulsas,
         coalesce(sum(valor) filter (where titular = cliente_id), 0)               as valor_total,
         min(data_embarque)                                                        as primeira_viagem,
         max(data_embarque)                                                        as ultima_viagem,
         max(data_retorno) filter (where data_retorno < (select d from hoje))      as ultimo_retorno,
         min(data_embarque) filter (where data_embarque >= (select d from hoje))   as proximo_embarque
    from viagens_do_cliente
   group by cliente_id
),
contato as (
  -- contato de verdade: o cliente escreveu, uma PESSOA do time respondeu,
  -- ou alguém registrou o contato à mão. Disparo automático não conta.
  select c.id as cliente_id,
         greatest(
           (select max(m.enviada_em)
              from rel_wa_conversas w
              join rel_wa_mensagens m on m.conversa_id = w.id
             where w.cliente_id = c.id
               and (m.direcao = 'in' or coalesce(m.origem, '') <> 'automatica')),
           (select max(ct.feito_em) from rel_contatos ct where ct.cliente_id = c.id and ct.feito_em <= now())
         ) as ultimo_contato_em
    from rel_clientes c
),
cfg as (
  select coalesce((select valor from rel_config where chave = 'categorias'), '{}'::jsonb) as cat,
         coalesce((select valor from rel_config where chave = 'contato_meta_dias'), '{}'::jsonb) as meta,
         coalesce((select valor from rel_config where chave = 'cadastro_obrigatorio'), '[]'::jsonb) as obrig
),
base as (
  select c.id, c.nome, c.titular_id, c.criado_em,
         coalesce(a.viagens_compradas, 0)  as viagens_compradas,
         coalesce(a.viagens_realizadas, 0) as viagens_realizadas,
         coalesce(a.expedicoes, 0)         as expedicoes,
         coalesce(a.pacotes, 0)            as pacotes,
         coalesce(a.compras_avulsas, 0)    as compras_avulsas,
         coalesce(a.valor_total, 0)        as valor_total,
         a.primeira_viagem, a.ultima_viagem, a.ultimo_retorno, a.proximo_embarque,
         ct.ultimo_contato_em,
         array_remove(array[
           case when cfg.obrig ? 'cpf'                 and c.cpf is null                 then 'cpf' end,
           case when cfg.obrig ? 'nascimento'          and c.nascimento is null          then 'nascimento' end,
           case when cfg.obrig ? 'telefone'            and c.telefone is null            then 'telefone' end,
           case when cfg.obrig ? 'email'               and c.email is null               then 'email' end,
           case when cfg.obrig ? 'passaporte'          and c.passaporte is null          then 'passaporte' end,
           case when cfg.obrig ? 'passaporte_validade' and c.passaporte_validade is null then 'passaporte_validade' end,
           case when cfg.obrig ? 'doc_passaporte' and not exists (
                  select 1 from rel_documentos d where d.cliente_id = c.id and d.tipo = 'passaporte' and d.status <> 'recusado')
                then 'doc_passaporte' end
         ], null) as faltando,
         cfg.cat, cfg.meta
    from rel_clientes c
    cross join cfg
    left join agg a on a.cliente_id = c.id
    left join contato ct on ct.cliente_id = c.id
   where c.mesclado_em_id is null
),
conta as (
  select b.*,
         case when (b.cat->>'contar') = 'realizadas' then b.viagens_realizadas else b.viagens_compradas end as viagens_conta
    from base b
),
cat as (
  -- maior nível que o cliente alcança; cliente sem nenhuma viagem fica sem categoria.
  -- Números da config passam por round(numeric): "45.5" não derruba mais a view.
  select k.*,
         (select n->>'id'
            from jsonb_array_elements(coalesce(k.cat->'niveis', '[]'::jsonb)) with ordinality as e(n, ord)
           where k.viagens_compradas > 0
             and case coalesce(k.cat->>'criterio', 'viagens')
                   when 'valor' then k.valor_total >= coalesce((n->>'min_valor')::numeric, 0)
                   when 'viagens_ou_valor' then k.viagens_conta >= coalesce(round((n->>'min_viagens')::numeric), 0)
                                          or (coalesce((n->>'min_valor')::numeric, 0) > 0
                                              and k.valor_total >= (n->>'min_valor')::numeric)
                   else k.viagens_conta >= coalesce(round((n->>'min_viagens')::numeric), 0)
                 end
           order by ord desc
           limit 1) as categoria
    from conta k
)
select id, nome, titular_id, criado_em,
       viagens_compradas, viagens_realizadas, expedicoes, pacotes, valor_total,
       primeira_viagem, ultima_viagem, ultimo_retorno, proximo_embarque,
       ultimo_contato_em,
       case when ultimo_contato_em is null then null
            else greatest(0, (select d from hoje) - (ultimo_contato_em at time zone 'America/Sao_Paulo')::date) end as dias_sem_contato,
       coalesce(categoria, 'sem_categoria') as categoria,
       coalesce(round((meta->>coalesce(categoria, 'sem_categoria'))::numeric)::int, 90) as meta_contato_dias,
       faltando,
       cardinality(faltando) = 0 as cadastro_completo,
       compras_avulsas
  from cat;

grant select on rel_cliente_metricas to authenticated;
