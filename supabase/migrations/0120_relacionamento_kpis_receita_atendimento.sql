-- 0120_relacionamento_kpis_receita_atendimento.sql
-- -----------------------------------------------------------------------------
-- KPIs novos do Relacionamento (Bruno, 13/10/2026):
--   1. rel_cliente_metricas ganha expedicoes_realizadas e pacotes_realizados
--      (no FIM — create or replace exige colunas novas no fim). O resto da view
--      é IGUAL à vigente (0117 + 0119: viagem = expedição/pacote; arquivados fora).
--   2. rel_kpi_atendimento(p_de, p_ate) → TME (tempo médio de espera) e TMA
--      (tempo médio de atendimento), geral e por atendente. security invoker:
--      respeita o RLS de quem chama (time do Relacionamento).
-- -----------------------------------------------------------------------------

-- ── 1. Métricas por cliente ─────────────────────────────────────────────────
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
         min(data_embarque) filter (where data_embarque >= (select d from hoje))   as proximo_embarque,
         -- 0120: realizadas por tipo (já voltou)
         count(distinct case when tipo = 'expedicao' and coalesce(data_retorno, data_embarque) < (select d from hoje)
                             then coalesce(data_embarque::text, id::text) end) as expedicoes_realizadas,
         count(distinct case when tipo = 'pacote' and coalesce(data_retorno, data_embarque) < (select d from hoje)
                             then coalesce(data_embarque::text, id::text) end) as pacotes_realizados
    from viagens_do_cliente
   group by cliente_id
),
contato as (
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
         cfg.cat, cfg.meta,
         coalesce(a.expedicoes_realizadas, 0) as expedicoes_realizadas,
         coalesce(a.pacotes_realizados, 0)    as pacotes_realizados
    from rel_clientes c
    cross join cfg
    left join agg a on a.cliente_id = c.id
    left join contato ct on ct.cliente_id = c.id
   where c.mesclado_em_id is null and c.arquivado_em is null
),
conta as (
  select b.*,
         case when (b.cat->>'contar') = 'realizadas' then b.viagens_realizadas else b.viagens_compradas end as viagens_conta
    from base b
),
cat as (
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
       compras_avulsas,
       expedicoes_realizadas,
       pacotes_realizados
  from cat;

grant select on rel_cliente_metricas to authenticated;


-- ── 2. TME e TMA ────────────────────────────────────────────────────────────
-- TME (tempo médio de espera): quanto o cliente esperou pela 1ª resposta —
--   rel_wa_sla.minutos_uteis (só conta horário de atendimento), só conversas
--   que contam no prazo (sem_sla = false).
-- TMA (tempo médio de atendimento): duração de cada "sessão" — mensagens da
--   mesma conversa com menos de 60 min entre uma e outra formam uma sessão; a
--   sessão vale se tem mensagem do cliente E resposta de uma pessoa (origem
--   qs = pela tela, celular = pelo app). Duração = da 1ª mensagem do cliente
--   até a última resposta nossa. Histórico do celular e automáticas ficam fora.
create or replace function rel_kpi_atendimento(p_de timestamptz, p_ate timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
espera as (
  select s.atendente_id, s.minutos_uteis::numeric as m
    from rel_wa_sla s
    join rel_wa_conversas c on c.id = s.conversa_id
   where not c.sem_sla and s.respondido_em >= p_de and s.respondido_em < p_ate
),
msgs as (
  select m.conversa_id, m.direcao, m.origem, m.autor_id, m.enviada_em,
         case when lag(m.enviada_em) over w is null
                or m.enviada_em - lag(m.enviada_em) over w > interval '60 minutes' then 1 else 0 end as nova
    from rel_wa_mensagens m
    join rel_wa_conversas c on c.id = m.conversa_id
   where not c.sem_sla
     and coalesce(m.origem, '') not in ('historico', 'automatica')
     and m.enviada_em >= p_de - interval '1 day' and m.enviada_em < p_ate
  window w as (partition by m.conversa_id order by m.enviada_em)
),
sessoes_raw as (
  select *, sum(nova) over (partition by conversa_id order by enviada_em rows unbounded preceding) as sessao
    from msgs
),
sessoes as (
  select conversa_id, sessao,
         min(enviada_em) filter (where direcao = 'in') as primeira_in,
         max(enviada_em) filter (where direcao = 'out' and origem in ('qs', 'celular')) as ultima_resp,
         (array_agg(autor_id order by enviada_em desc) filter (where direcao = 'out' and origem in ('qs', 'celular') and autor_id is not null))[1] as atendente_id
    from sessoes_raw
   group by conversa_id, sessao
),
atend as (
  select atendente_id, extract(epoch from (ultima_resp - primeira_in)) / 60.0 as m
    from sessoes
   where primeira_in is not null and ultima_resp is not null and ultima_resp > primeira_in
     and primeira_in >= p_de and primeira_in < p_ate
),
tme_por as (
  select e.atendente_id, count(*) n, round(avg(m), 1) media,
         round((percentile_cont(0.5) within group (order by m))::numeric, 1) mediana
    from espera e group by e.atendente_id
),
tma_por as (
  select a.atendente_id, count(*) n, round(avg(m), 1) media,
         round((percentile_cont(0.5) within group (order by m))::numeric, 1) mediana
    from atend a group by a.atendente_id
)
select jsonb_build_object(
  'tme', (select jsonb_build_object('n', count(*), 'media', round(avg(m), 1),
                                    'mediana', round((percentile_cont(0.5) within group (order by m))::numeric, 1)) from espera),
  'tma', (select jsonb_build_object('n', count(*), 'media', round(avg(m), 1),
                                    'mediana', round((percentile_cont(0.5) within group (order by m))::numeric, 1)) from atend),
  'por_atendente', coalesce((
     select jsonb_agg(jsonb_build_object(
              'atendente_id', coalesce(t1.atendente_id, t2.atendente_id),
              'nome', (select name from qs_users u where u.id = coalesce(t1.atendente_id, t2.atendente_id)),
              'tme_n', coalesce(t1.n, 0), 'tme_media', t1.media, 'tme_mediana', t1.mediana,
              'tma_n', coalesce(t2.n, 0), 'tma_media', t2.media, 'tma_mediana', t2.mediana))
       from tme_por t1 full join tma_por t2 on coalesce(t1.atendente_id::text, '') = coalesce(t2.atendente_id::text, '')), '[]'::jsonb)
);
$$;
grant execute on function rel_kpi_atendimento(timestamptz, timestamptz) to authenticated;
