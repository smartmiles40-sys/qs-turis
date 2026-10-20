-- 0148 — Relacionamento: o que a pessoa COMPROU × o que precisa de acompanhamento
-- (Bruno, 20/10/2026: "está constando +431 viagens e eu sei que não tem isso").
--
-- O painel somava como "pacote" tudo que não era expedição: passagem sem data,
-- seguro, concierge, conta liminar… Agora cada venda tem um SERVIÇO e, dele,
-- um nível de ACOMPANHAMENTO:
--   expedicao   → quadro das expedições (por saída)
--   completo    → pacote, aéreo, cruzeiro: Esteira inteira (aéreo tem a mesma revisão do pacote)
--   leve        → hospedagem, passeio/transfer: só Revisão + D-3
--   nenhum      → seguro, concierge, conta liminar, outro: fica só na ficha do cliente
--   classificar → o Bitrix não disse o que foi vendido (ou disse "Outros"): o time escolhe
--
-- O serviço vem do "Tipo de venda" do Bitrix (ou "Venda realizada - Tipo"); o
-- time pode corrigir (servico_manual), e a escolha dele sempre ganha.

alter table rel_viagens
  add column if not exists servico_manual text
    check (servico_manual in ('expedicao','pacote','aereo','hospedagem','passeio','cruzeiro','seguro','concierge','conta_liminar','outro')),
  add column if not exists servico_por uuid references qs_users(id) on delete set null,
  add column if not exists servico_em timestamptz;

create or replace function rel_servico_auto(p_tipo text, p_dados jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when p_tipo = 'expedicao' then 'expedicao'
    when p_tipo = 'pacote' then 'pacote'
    else (select case
      when t ~ 'expedi'            then 'expedicao'
      when t ~ 'pacote'            then 'pacote'
      when t ~ '(a[eé]re|passage)' then 'aereo'
      when t ~ '(hosped|hotel)'    then 'hospedagem'
      when t ~ '(passeio|transfer)' then 'passeio'
      when t ~ 'cruzeiro'          then 'cruzeiro'
      when t ~ 'seguro'            then 'seguro'
      when t ~ 'concierge'         then 'concierge'
      when t ~ 'liminar'           then 'conta_liminar'
      when t <> ''                 then null           -- "Outros": o time classifica
      when p_tipo = 'aereo'        then 'aereo'
      when p_tipo = 'hospedagem'   then 'hospedagem'
      else null end
      from (select lower(coalesce(
        nullif(p_dados->>'Tipo de venda [UF_CRM_1743296167520]', ''),
        nullif(p_dados->>'Venda realizada - Tipo [UF_CRM_1746631919796]', ''), '')) t) s)
  end
$$;

create or replace function rel_acompanhamento(p_servico text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_servico = 'expedicao' then 'expedicao'
    when p_servico in ('pacote','aereo','cruzeiro') then 'completo'
    when p_servico in ('hospedagem','passeio') then 'leve'
    when p_servico in ('seguro','concierge','conta_liminar','outro') then 'nenhum'
    else 'classificar'
  end
$$;

-- Mesma view, com 3 colunas novas no fim (create or replace só aceita acrescentar).
create or replace view rel_viagens_v with (security_invoker = true) as
 select v.id, v.titulo, v.destino, v.expedicao, v.tipo, v.data_venda, v.data_embarque, v.data_retorno,
    v.valor, v.qtd_passageiros, v.cliente_id, v.responsavel_id, v.bitrix_deal_id, v.status,
    v.observacoes, v.necessidades, v.origem, v.criado_em, v.atualizado_em,
    c.nome as cliente_nome, c.telefone as cliente_telefone, u.name as responsavel_nome,
    case
      when v.status = 'cancelada' then 'cancelada'
      when v.data_embarque is null then 'sem_data'
      when rel_hoje() < v.data_embarque then 'antes'
      when rel_hoje() <= coalesce(v.data_retorno, v.data_embarque) then 'em_viagem'
      else 'concluida'
    end as fase,
    (v.data_embarque - rel_hoje()) as dias_para_embarque,
    (select count(*) from rel_viagem_passageiros p where p.viagem_id = v.id)::integer as passageiros,
    (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id and t.feita_em is null and t.prazo < rel_hoje())::integer as tarefas_atrasadas,
    (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id and t.feita_em is null)::integer as tarefas_pendentes,
    (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id)::integer as tarefas_total,
    coalesce(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) as servico,
    rel_acompanhamento(coalesce(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados))) as acompanhamento,
    v.servico_manual
   from rel_viagens v
     left join rel_clientes c on c.id = v.cliente_id
     left join qs_users u on u.id = v.responsavel_id;

-- Esteira em SQL (alertas): espelha src/rel/lib/etapas.ts. Só completo/leve;
-- no leve só Revisão e D-3 se aplicam.
create or replace function rel_esteira_atrasadas()
 returns table(viagem_id uuid, etapa text, rotulo text, prazo date)
 language sql stable set search_path to 'public'
as $function$
  with v as (
    select id, data_venda venda, data_embarque ida, coalesce(data_retorno, data_embarque) volta,
           coalesce(data_venda, data_embarque) base, acompanhamento acomp
      from rel_viagens_v
     where status = 'ativa' and acompanhamento in ('completo', 'leve') and data_embarque is not null
       and (fase in ('antes', 'em_viagem') or (fase = 'concluida' and data_retorno >= rel_hoje() - 10))
  ), e as (
    select v.id, x.ordem, x.etapa, x.rotulo, x.abre, x.prazo,
      case
        when exists (select 1 from rel_viagem_etapas r where r.viagem_id = v.id and r.etapa = x.etapa and r.concluida_em is not null) then 'feita'
        when not (x.aplica and (v.acomp = 'completo' or x.etapa in ('revisao', 'd3'))) then 'nao_se_aplica'
        when x.prazo < date '2026-10-16' then 'zerada'          -- ZERADAS_ATE
        when x.abre > rel_hoje() then 'aguardando'
        when x.prazo < rel_hoje() then 'atrasada'
        else 'a_fazer'
      end situacao
    from v cross join lateral (values
      (1, 'passagem',  'Passagem de bastão', v.base,     v.base + 2,  v.venda is not null and v.venda >= date '2026-10-16'),
      (2, 'revisao',   'Revisão',            v.base,     v.base + 5,  v.venda is not null),
      (3, 'd30',       'D-30',               v.ida - 30, v.ida - 28,  v.venda is null or v.venda <= v.ida - 30),
      (4, 'd7',        'D-7',                v.ida - 7,  v.ida - 5,   v.venda is null or v.venda <= v.ida - 7),
      (5, 'd3',        'D-3',                v.ida - 3,  v.ida - 2,   true),
      (6, 'checkin',   'Check-in',           v.ida - 2,  v.ida,       true),
      (7, 'em_viagem', 'Em viagem',          v.ida,      v.volta,     true),
      (8, 'retorno',   'Retorno',            v.volta,    v.volta + 3, true)
    ) x(ordem, etapa, rotulo, abre, prazo, aplica)
  ), atual as (
    select distinct on (id) id, etapa, rotulo, prazo, situacao
      from e where situacao not in ('feita', 'nao_se_aplica', 'zerada')
     order by id, ordem
  )
  select id, etapa, rotulo, prazo from atual where situacao = 'atrasada';
$function$;
