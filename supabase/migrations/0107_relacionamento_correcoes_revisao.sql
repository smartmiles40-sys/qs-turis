-- 0107_relacionamento_correcoes_revisao.sql
-- -----------------------------------------------------------------------------
-- Correções da revisão de 13/10/2026 sobre a 0106 (já aplicada):
--   1. Editar um chamado JÁ resolvido não muda mais a data em que foi resolvido.
--   2. Juntar fichas não trava quando as duas têm pesquisa da mesma viagem.
--   3. Meta com casa decimal não derruba mais a view dos KPIs.
--   4. Índice de contato só conta contato DE VERDADE: mensagem do cliente,
--      resposta de uma pessoa do time (automação não conta) ou contato
--      registrado à mão. Mexer no chamado (arrastar, checklist) não conta.
--   5. "Hoje" é o dia de São Paulo (o banco roda em UTC: depois das 21h o
--      current_date já era amanhã).
--   6. Histórico do chamado não pode ser forjado pela tela: ela só insere NOTA,
--      sempre em nome de quem está logado.
-- -----------------------------------------------------------------------------

-- ── 5. O "hoje" do time ──────────────────────────────────────────────────────
create or replace function rel_hoje()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
grant execute on function rel_hoje() to authenticated;

-- Views antigas que usavam current_date passam a usar rel_hoje(), sem
-- reescrever o corpo delas à mão (mantém o security_invoker de cada uma).
do $$
declare
  v text;
  corpo text;
  opcoes text;
begin
  foreach v in array array['rel_viagens_v', 'rel_alertas'] loop
    if to_regclass(v) is null then continue; end if;
    corpo := pg_get_viewdef(v::regclass);
    if corpo !~* 'current_date' then continue; end if;
    select coalesce(' with (' || array_to_string(reloptions, ', ') || ')', '')
      into opcoes from pg_class where oid = v::regclass;
    execute format('create or replace view %I%s as %s', v, opcoes,
                   regexp_replace(corpo, 'CURRENT_DATE', 'rel_hoje()', 'gi'));
  end loop;
end $$;


-- ── 1. Data de resolução do chamado ──────────────────────────────────────────
create or replace function rel_chamados_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into rel_chamado_eventos (chamado_id, tipo, texto, para_status, autor_id)
    values (new.id, 'criado', new.assunto, new.status, coalesce(auth.uid(), new.criado_por));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into rel_chamado_eventos (chamado_id, tipo, de_status, para_status, texto)
    values (new.id, case when new.status = 'resolvido' then 'resolvido' else 'status' end,
            old.status, new.status, case when new.status = 'resolvido' then new.resolucao end);
  end if;
  if new.proximo_passo is distinct from old.proximo_passo and coalesce(new.proximo_passo, '') <> '' then
    insert into rel_chamado_eventos (chamado_id, tipo, texto) values (new.id, 'proximo_passo', new.proximo_passo);
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into rel_chamado_eventos (chamado_id, tipo, texto)
    values (new.id, 'responsavel', (select name from qs_users where id = new.responsavel_id));
  end if;
  if new.checklist is distinct from old.checklist then
    insert into rel_chamado_eventos (chamado_id, tipo, texto)
    values (new.id, 'checklist',
            (select count(*) filter (where (i->>'feito')::boolean) || ' de ' || count(*) || ' feitas'
               from jsonb_array_elements(coalesce(new.checklist, '[]'::jsonb)) i));
  end if;
  -- A data de resolução é do BANCO, não da tela:
  if new.status = 'resolvido' and old.status = 'resolvido' then
    new.resolvido_em := old.resolvido_em;          -- só editou: mantém a data original
  elsif new.status = 'resolvido' then
    new.resolvido_em := now();                     -- acabou de resolver
  else
    new.resolvido_em := null;                      -- reabriu
  end if;
  return new;
end;
$$;

-- Marcar um item do checklist sem sobrescrever o que outra pessoa marcou
-- (a tela mandava a lista inteira e o último a gravar apagava o outro).
create or replace function rel_chamado_checklist(p_chamado uuid, p_acao text, p_indice int default null,
                                                 p_texto text default null, p_feito boolean default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  lista jsonb;
begin
  select coalesce(checklist, '[]'::jsonb) into lista from rel_chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if p_acao = 'adicionar' then
    if coalesce(trim(p_texto), '') = '' then raise exception 'Escreva a tarefa.'; end if;
    lista := lista || jsonb_build_array(jsonb_build_object('texto', trim(p_texto), 'feito', false));
  elsif p_acao = 'marcar' then
    if p_indice is null or p_indice < 0 or p_indice >= jsonb_array_length(lista) then raise exception 'Tarefa não encontrada.'; end if;
    lista := jsonb_set(lista, array[p_indice::text, 'feito'], to_jsonb(coalesce(p_feito, true)));
  elsif p_acao = 'remover' then
    if p_indice is null or p_indice < 0 or p_indice >= jsonb_array_length(lista) then raise exception 'Tarefa não encontrada.'; end if;
    lista := lista - p_indice;
  else
    raise exception 'Ação inválida.';
  end if;
  update rel_chamados set checklist = lista where id = p_chamado;
  return lista;
end;
$$;
grant execute on function rel_chamado_checklist(uuid, text, int, text, boolean) to authenticated;


-- ── 6. Histórico do chamado: a tela só escreve nota, em nome de quem está logado
drop policy if exists rel_chamado_eventos_criar on rel_chamado_eventos;
create policy rel_chamado_eventos_criar on rel_chamado_eventos for insert to authenticated
  with check (rel_tem_acesso() and tipo = 'nota' and autor_id = auth.uid());


-- ── 2. Juntar fichas com pesquisa da mesma viagem ────────────────────────────
create or replace function rel_juntar_repontar(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rel_viagem_passageiros p
   where p.cliente_id = p_remover
     and exists (select 1 from rel_viagem_passageiros q where q.viagem_id = p.viagem_id and q.cliente_id = p_manter);

  -- pesquisa: uma por viagem × cliente. Fica a RESPONDIDA; empate, a da ficha que fica.
  delete from rel_pesquisas pm
   using rel_pesquisas pr
   where pm.cliente_id = p_manter and pr.cliente_id = p_remover and pm.viagem_id = pr.viagem_id
     and pm.respondida_em is null and pr.respondida_em is not null;
  delete from rel_pesquisas pr
   where pr.cliente_id = p_remover
     and exists (select 1 from rel_pesquisas pm where pm.viagem_id = pr.viagem_id and pm.cliente_id = p_manter);

  update rel_viagem_passageiros set cliente_id = p_manter where cliente_id = p_remover;
  update rel_viagens       set cliente_id = p_manter where cliente_id = p_remover;
  update rel_wa_conversas  set cliente_id = p_manter where cliente_id = p_remover;
  update rel_chamados      set cliente_id = p_manter where cliente_id = p_remover;
  update rel_documentos    set cliente_id = p_manter where cliente_id = p_remover;
  update rel_doc_pedidos   set cliente_id = p_manter where cliente_id = p_remover;
  update rel_envios        set cliente_id = p_manter where cliente_id = p_remover;
  update rel_pesquisas     set cliente_id = p_manter where cliente_id = p_remover;
  update rel_recompras     set cliente_id = p_manter where cliente_id = p_remover;
  update rel_contatos      set cliente_id = p_manter where cliente_id = p_remover;
end;
$$;
revoke all on function rel_juntar_repontar(uuid, uuid) from public, anon, authenticated;


-- ── 3 + 4 + 5. Métricas do cliente ───────────────────────────────────────────
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
         count(distinct id)                                                        as viagens_compradas,
         count(distinct id) filter (where coalesce(data_retorno, data_embarque) < (select d from hoje)) as viagens_realizadas,
         count(distinct id) filter (where tipo = 'expedicao')                      as expedicoes,
         count(distinct id) filter (where tipo = 'pacote')                         as pacotes,
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
       cardinality(faltando) = 0 as cadastro_completo
  from cat;

grant select on rel_cliente_metricas to authenticated;
