-- scripts/rel-faxina/diagnostico.sql
-- -----------------------------------------------------------------------------
-- DIAGNÓSTICO DAS VIAGENS DO RELACIONAMENTO (faxina, 27/10/2026)
-- SÓ LEITURA: só SELECT. Pode rodar quantas vezes quiser no SQL Editor do
-- Supabase (ou pelo MCP) — os números mudam com o tempo; o relatório é
-- docs/REL-FAXINA-VIAGENS.md.
--
-- Funciona ANTES da 0208 (não usa nada dela). As regras aqui são as mesmas das
-- funções da 0208 — se mudar uma, mude a outra:
--   §3 = rel_sugerir_servico · §5 = rel_faxina_repetidas_v · §6 = rel_faxina_componentes_v
-- -----------------------------------------------------------------------------

-- §1 Panorama: status × fase × acompanhamento (com sem dono / sem cliente / sem data)
select status, fase, acompanhamento, count(*) as viagens,
       count(*) filter (where responsavel_id is null) as sem_dono,
       count(*) filter (where cliente_id is null)     as sem_cliente,
       count(*) filter (where data_embarque is null)  as sem_data
  from rel_viagens_v
 group by 1, 2, 3
 order by 1, 2, 3;

-- §2 Números-chave (uma linha)
with a as (
  select v.*, r.preferencias, r.expedicoes_id, r.mesclada_em_id
    from rel_viagens_v v join rel_viagens r using (id)
   where v.status = 'ativa'
)
select count(*)                                                                                    as ativas,
       count(*) filter (where acompanhamento = 'classificar')                                      as para_classificar,
       count(*) filter (where acompanhamento = 'classificar' and fase in ('antes', 'em_viagem'))   as para_classificar_futuras,
       count(*) filter (where data_embarque is null)                                               as sem_data,
       count(*) filter (where data_embarque is null and coalesce(voos_total, 0) > 0)               as sem_data_com_voo,
       count(*) filter (where data_embarque is null and (data_venda is null or data_venda < rel_hoje() - 365)) as sem_data_antiga_ou_sem_venda,
       count(*) filter (where cliente_id is null)                                                  as sem_cliente,
       count(*) filter (where observacoes ilike '%CONFERIR: possível viagem repetida%' and mesclada_em_id is null) as repetidas_marcadas,
       count(*) filter (where acompanhamento in ('completo', 'leve') and fase in ('antes', 'em_viagem')) as a_operar,
       count(*) filter (where acompanhamento in ('completo', 'leve') and fase in ('antes', 'em_viagem') and responsavel_id is null) as a_operar_sem_dono,
       count(*) filter (where acompanhamento in ('completo', 'leve') and fase in ('antes', 'em_viagem') and dias_para_embarque <= 120
                          and rel_preferencias_vazias(preferencias, necessidades))                 as a_operar_120d_sem_preferencias,
       count(*) filter (where acompanhamento = 'expedicao' and fase in ('antes', 'em_viagem'))     as expedicoes_futuras,
       (select count(*) from rel_viagem_etapas where concluida_em is not null)                     as etapas_da_esteira_feitas
  from a;

-- §3 "Para classificar": sugestão automática (mesmas regras de rel_sugerir_servico, 0208)
with c as (
  select r.id, r.titulo, r.bitrix_dados bd, v.fase, v.data_embarque,
         lower(coalesce(r.titulo, '') || ' ' || coalesce(r.bitrix_dados->>'Observação [UF_CRM_1747076085383]', '')) txt,
         lower(coalesce(r.bitrix_dados->>'Venda realizada - Tipo [UF_CRM_1746631919796]', '')) vr,
         exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo like 'voo%') tem_voo,
         exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo = 'hospedagem') tem_hotel,
         exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo in ('passeio', 'transfer')) tem_passeio
    from rel_viagens_v v join rel_viagens r using (id)
   where v.status = 'ativa' and v.acompanhamento = 'classificar'
), s as (
  select c.*, case
    when vr not in ('', 'outros') and rel_servico_auto(null, jsonb_build_object('Tipo de venda [UF_CRM_1743296167520]', vr)) is not null
      then array[rel_servico_auto(null, jsonb_build_object('Tipo de venda [UF_CRM_1743296167520]', vr)), 'R1 venda realizada', 'alta']
    when bd->>'Tipo de Viagem: [UF_CRM_1761744284046]' ilike '%expedi%' then array['expedicao', 'R2 tipo de viagem', 'alta']
    when txt ~ '\mexp(\.|edi[cç][aã]o)?\M'               then array['expedicao', 'R3 nome', 'media']
    when txt ~ '(pacote|circuito|lua de mel)'            then array['pacote', 'R3 nome', 'media']
    when txt ~ 'cruzeiro'                                then array['cruzeiro', 'R3 nome', 'media']
    when txt ~ 'seguro'                                  then array['seguro', 'R3 nome', 'media']
    when txt ~ '(civitatis|passeio|ingresso|\mtour\M|transfer)' then array['passeio', 'R3 nome', 'media']
    when txt ~ '(hotel|hosped|airbnb)'                   then array['hospedagem', 'R3 nome', 'media']
    when txt ~ '(a[eé]reo|passage|bilhete)'              then array['aereo', 'R3 nome', 'media']
    when tem_voo and tem_hotel                           then array['pacote', 'R4 trechos', 'media']
    when tem_voo                                         then array['aereo', 'R4 trechos', 'media']
    when tem_hotel                                       then array['hospedagem', 'R4 trechos', 'media']
    when tem_passeio                                     then array['passeio', 'R4 trechos', 'media']
  end a from c
)
select coalesce(a[2], 'sem regra (time)') as regra, coalesce(a[1], '—') as sugestao, coalesce(a[3], '—') as confianca,
       count(*) as viagens,
       count(*) filter (where fase in ('antes', 'em_viagem')) as futuras,
       count(*) filter (where fase = 'sem_data')               as sem_data,
       count(*) filter (where fase = 'concluida')              as ja_voltaram
  from s group by 1, 2, 3 order by 4 desc;

-- §4 "Sem data": o que dá pra resolver sozinho
select acompanhamento,
       count(*) as sem_data,
       count(*) filter (where coalesce(voos_total, 0) > 0)                               as tem_voo_datas_pelos_voos,
       count(*) filter (where data_venda is null or data_venda < rel_hoje() - 365)        as sugerida_arquivar,
       count(*) filter (where data_venda >= rel_hoje() - 365 and coalesce(voos_total, 0) = 0) as recente_sem_voo_time
  from rel_viagens_v
 where status = 'ativa' and data_embarque is null
 group by 1 order by 2 desc;

-- §5 Repetidas: pares novos (mesma pessoa, ida a ≤3 dias) — regra de rel_faxina_repetidas_v
with a as (
  select v.id, v.cliente_id, v.cliente_nome, v.titulo, v.data_embarque, v.acompanhamento, v.fase, v.bitrix_deal_id,
         r.expedicoes_id, r.repetida_conferida_em, r.observacoes
    from rel_viagens_v v join rel_viagens r using (id)
   where v.status = 'ativa' and r.mesclada_em_id is null and v.cliente_id is not null and v.data_embarque is not null
)
select x.cliente_nome, x.titulo as viagem_a, x.bitrix_deal_id as deal_a, y.titulo as viagem_b, y.bitrix_deal_id as deal_b,
       x.data_embarque as ida_a, y.data_embarque as ida_b, (x.fase in ('antes', 'em_viagem') or y.fase in ('antes', 'em_viagem')) as futura
  from a x join a y on x.cliente_id = y.cliente_id and x.id < y.id
 where abs(x.data_embarque - y.data_embarque) <= 3
   and x.expedicoes_id is null and y.expedicoes_id is null
   and x.repetida_conferida_em is null and y.repetida_conferida_em is null
   and (x.acompanhamento = y.acompanhamento or 'classificar' in (x.acompanhamento, y.acompanhamento))
 order by futura desc, x.data_embarque;

-- §6 Vendas soltas que são componente de outra viagem (seguro/hotel/passeio da mesma pessoa, ±3 dias)
with a as (
  select v.id, v.cliente_id, v.cliente_nome, v.titulo, v.data_embarque, v.acompanhamento, v.servico, v.fase, v.bitrix_deal_id
    from rel_viagens_v v join rel_viagens r using (id)
   where v.status = 'ativa' and r.mesclada_em_id is null and v.cliente_id is not null and v.data_embarque is not null
)
select s.cliente_nome, s.titulo as venda_solta, coalesce(s.servico, 'classificar') as servico_solta, s.bitrix_deal_id as deal_solta,
       p.titulo as viagem_principal, p.servico as servico_principal, p.bitrix_deal_id as deal_principal, p.data_embarque,
       p.fase in ('antes', 'em_viagem') as futura
  from a s join a p on p.cliente_id = s.cliente_id and p.id <> s.id
 where s.acompanhamento in ('nenhum', 'leve', 'classificar') and p.acompanhamento in ('completo', 'expedicao')
   and abs(p.data_embarque - s.data_embarque) <= 3
 order by futura desc, p.data_embarque;

-- §7 OLHO HUMANO — lista priorizada: o que embarca primeiro, com o que falta
with a as (
  select v.*, r.observacoes obs, r.preferencias
    from rel_viagens_v v join rel_viagens r using (id)
   where v.status = 'ativa' and r.mesclada_em_id is null
)
select data_embarque as ida, dias_para_embarque as dias, titulo, cliente_nome as cliente, coalesce(servico, '?') as servico,
       bitrix_deal_id as deal,
       concat_ws(', ',
         case when acompanhamento = 'classificar' then 'classificar' end,
         case when acompanhamento in ('completo', 'leve') and responsavel_id is null then 'sem dono' end,
         case when cliente_id is null then 'sem cliente' end,
         case when obs ilike '%CONFERIR: possível viagem repetida%' then 'repetida?' end,
         case when acompanhamento in ('completo', 'leve') and rel_preferencias_vazias(preferencias, necessidades) then 'sem preferências' end
       ) as falta
  from a
 where fase in ('antes', 'em_viagem') and acompanhamento <> 'expedicao'
   and (acompanhamento in ('classificar', 'completo', 'leve') or cliente_id is null or obs ilike '%CONFERIR: possível%')
 order by data_embarque nulls last
 limit 100;

-- §8 Sem cliente (as 22): o que o card do Bitrix tem pra achar a ficha
select v.id, v.titulo, v.fase, v.data_embarque, v.bitrix_deal_id, r.bitrix_funil,
       r.bitrix_dados->>'Contato [CONTACT_ID]' as contato_bitrix,
       r.bitrix_dados->>'Nome completo do Cliente (não colocar só ponto!) [UF_CRM_1761744211241]' as nome_no_card
  from rel_viagens_v v join rel_viagens r using (id)
 where v.status = 'ativa' and v.cliente_id is null
 order by v.data_embarque nulls last;

-- §9 Componentes que já existem por tipo (base da tela "Tudo da viagem")
select 'trecho' as fonte, t.tipo, count(*) as itens, count(distinct t.viagem_id) as viagens
  from rel_viagem_trechos t group by 2
union all
select 'expedicao', 'expedicao', count(*), count(*) from rel_viagens where expedicoes_id is not null
order by 3 desc;
