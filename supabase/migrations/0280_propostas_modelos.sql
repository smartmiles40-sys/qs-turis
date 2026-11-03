-- 0280_propostas_modelos.sql
-- -----------------------------------------------------------------------------
-- PROPOSTAS NOS 3 MODELOS-PADRÃO (Bruno, 03/11/2026): "as propostas de TODOS
-- os tipos de solicitação padronizadas neste formato" — pacote personalizado,
-- serviços (passeios, gestão…) e seguro viagem (os 3 PDFs-padrão).
--
--   · modelo   — 'pacote' | 'servicos' | 'seguro'; NULO = proposta antiga, que
--                continua abrindo no formato de antes (nada muda pra ela);
--   · conteudo — os textos de cada seção do modelo (jsonb, ver
--                src/propostas/modelos.ts). conteudo.opcoes_extra guarda o que o
--                cartão/plano tem a mais que a opção, na ordem das opções.
--
-- qs_proposta_salvar e qs_proposta_duplicar passam a gravar/copiar os dois.
-- O resto (opções, itens, aprovação pelo link) é o mesmo da 0156/0157.
-- Só ARQUIVO — aplicar com o ok do Bruno. Sem ela o QS segue funcionando, mas
-- o modelo e os textos não salvam (o editor avisa).
-- -----------------------------------------------------------------------------

alter table qs_propostas
  add column if not exists modelo   text,
  add column if not exists conteudo jsonb not null default '{}'::jsonb;
alter table qs_propostas drop constraint if exists qs_propostas_modelo_check;
alter table qs_propostas add constraint qs_propostas_modelo_check
  check (modelo is null or modelo in ('pacote','servicos','seguro'));

-- a lista (qs_propostas_v) ganha o modelo no fim (create or replace só acrescenta)
create or replace view qs_propostas_v with (security_invoker = true) as
select p.id, p.numero, p.setor, p.status, p.titulo, p.destino, p.cliente_nome, p.data_ida, p.atualizado_em,
       p.criado_por, p.enviada_por, p.vista_em, p.visualizacoes, p.aprovada_em, p.aprovacao_vista_em,
       p.solicitacao_id, p.pronta_em, p.aberta_em, p.cliente_id, p.viagem_id, p.lead_id,
       s.numero   as sol_numero,
       s.de_setor as sol_de_setor,
       (s.id is not null and s.de_setor <> p.setor) as de_outro_time,
       p.modelo
  from qs_propostas p
  left join qs_solicitacoes s on s.id = p.solicitacao_id;
revoke all on qs_propostas_v from anon;
grant select on qs_propostas_v to authenticated;

-- ── Salvar (igual à 0157 + modelo/conteudo) ─────────────────────────────────
create or replace function qs_proposta_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v      qs_propostas;
  v_set  text := coalesce(nullif(p ->> 'setor', ''), 'operacional');
  o      jsonb;
  i      jsonb;
  v_oid  uuid;
  v_oids uuid[] := '{}';
  v_iids uuid[] := '{}';
  v_iid  uuid;
  n_o    int := 0;
  n_i    int;
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  if jsonb_array_length(coalesce(p -> 'opcoes', '[]'::jsonb)) = 0 then raise exception 'proposta-sem-opcao'; end if;

  if v_id is null then
    if not qs_do_setor(v_set) then raise exception 'sem-acesso'; end if;
    insert into qs_propostas (setor) values (v_set) returning id into v_id;
  else
    select * into v from qs_propostas where id = v_id for update;
    if v.id is null then raise exception 'proposta-nao-encontrada'; end if;
    if not (qs_do_setor(v.setor) or v.criado_por = auth.uid()) then raise exception 'so-quem-monta'; end if;
    if v.status = 'cancelada' then raise exception 'proposta-cancelada'; end if;
  end if;

  update qs_propostas set
    titulo          = left(coalesce(p ->> 'titulo', ''), 200),
    destino         = nullif(left(p ->> 'destino', 200), ''),
    data_ida        = nullif(p ->> 'data_ida', '')::date,
    data_volta      = nullif(p ->> 'data_volta', '')::date,
    adultos         = coalesce((p ->> 'adultos')::int, 1),
    criancas        = coalesce((p ->> 'criancas')::int, 0),
    bebes           = coalesce((p ->> 'bebes')::int, 0),
    apresentacao    = left(coalesce(p ->> 'apresentacao', ''), 4000),
    observacoes     = left(coalesce(p ->> 'observacoes', ''), 8000),
    esconder_precos = coalesce((p ->> 'esconder_precos')::boolean, false),
    capa_url        = nullif(p ->> 'capa_url', ''),
    solicitacao_id  = nullif(p ->> 'solicitacao_id', '')::uuid,
    cliente_id      = nullif(p ->> 'cliente_id', '')::uuid,
    viagem_id       = nullif(p ->> 'viagem_id', '')::uuid,
    lead_id         = nullif(p ->> 'lead_id', '')::uuid,
    cliente_nome    = nullif(left(p ->> 'cliente_nome', 160), ''),
    -- 0280: modelo-padrão + textos (modelo inválido vira nulo = formato antigo)
    modelo          = case when p ->> 'modelo' in ('pacote','servicos','seguro') then p ->> 'modelo' end,
    conteudo        = case when jsonb_typeof(p -> 'conteudo') = 'object' then p -> 'conteudo' else '{}'::jsonb end,
    -- mudou depois que quem pediu abriu: precisa abrir de novo pra enviar
    aberta_por      = null,
    aberta_em       = null,
    atualizado_em   = now()
  where id = v_id;

  for o in select * from jsonb_array_elements(p -> 'opcoes') loop
    v_oid := nullif(o ->> 'id', '')::uuid;
    if v_oid is not null and not exists (select 1 from qs_proposta_opcoes where id = v_oid and proposta_id = v_id) then v_oid := null; end if;
    if v_oid is null then
      insert into qs_proposta_opcoes (proposta_id) values (v_id) returning id into v_oid;
    end if;
    update qs_proposta_opcoes set
      ordem       = n_o,
      titulo      = left(coalesce(o ->> 'titulo', ''), 120),
      descricao   = left(coalesce(o ->> 'descricao', ''), 2000),
      recomendada = coalesce((o ->> 'recomendada')::boolean, false),
      desconto    = greatest(coalesce((o ->> 'desconto')::numeric, 0), 0),
      pagamentos  = case when jsonb_typeof(o -> 'pagamentos') = 'array' then o -> 'pagamentos' else '[]'::jsonb end
    where id = v_oid;
    v_oids := v_oids || v_oid;
    n_o := n_o + 1;

    n_i := 0;
    for i in select * from jsonb_array_elements(coalesce(o -> 'itens', '[]'::jsonb)) loop
      v_iid := nullif(i ->> 'id', '')::uuid;
      if v_iid is not null and not exists (select 1 from qs_proposta_itens where id = v_iid and proposta_id = v_id) then v_iid := null; end if;
      if v_iid is null then
        insert into qs_proposta_itens (opcao_id, proposta_id, tipo) values (v_oid, v_id, coalesce(nullif(i ->> 'tipo', ''), 'outro')) returning id into v_iid;
      end if;
      update qs_proposta_itens set
        opcao_id    = v_oid,
        ordem       = n_i,
        tipo        = coalesce(nullif(i ->> 'tipo', ''), 'outro'),
        nome        = left(coalesce(i ->> 'nome', ''), 200),
        descricao   = left(coalesce(i ->> 'descricao', ''), 4000),
        data_inicio = nullif(i ->> 'data_inicio', '')::date,
        data_fim    = nullif(i ->> 'data_fim', '')::date,
        quantidade  = greatest(coalesce((i ->> 'quantidade')::int, 1), 1),
        valor_total = coalesce((i ->> 'valor_total')::numeric, 0),
        custo       = (i ->> 'custo')::numeric,
        lucro       = (i ->> 'lucro')::numeric,
        fornecedor  = nullif(left(i ->> 'fornecedor', 160), ''),
        incluso     = coalesce((i ->> 'incluso')::boolean, false),
        detalhes    = case when jsonb_typeof(i -> 'detalhes') = 'object' then i -> 'detalhes' else '{}'::jsonb end
      where id = v_iid;
      v_iids := v_iids || v_iid;
      n_i := n_i + 1;
    end loop;
  end loop;

  delete from qs_proposta_itens where proposta_id = v_id and not (id = any(v_iids));
  delete from qs_proposta_opcoes where proposta_id = v_id and not (id = any(v_oids));
  return v_id;
end;
$$;

-- ── Duplicar (igual à 0157 + modelo/conteudo) ───────────────────────────────
create or replace function qs_proposta_duplicar(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_novo uuid;
  o record;
  v_oid uuid;
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  if not exists (select 1 from qs_propostas where id = p_id and (qs_do_setor(setor) or criado_por = auth.uid())) then raise exception 'so-quem-monta'; end if;
  insert into qs_propostas (setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
                            observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome, modelo, conteudo)
  select setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
         observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome, modelo, conteudo
    from qs_propostas where id = p_id
  returning id into v_novo;
  for o in select * from qs_proposta_opcoes where proposta_id = p_id order by ordem loop
    insert into qs_proposta_opcoes (proposta_id, ordem, titulo, descricao, recomendada, desconto, pagamentos)
    values (v_novo, o.ordem, o.titulo, o.descricao, o.recomendada, o.desconto, o.pagamentos) returning id into v_oid;
    insert into qs_proposta_itens (opcao_id, proposta_id, ordem, tipo, nome, descricao, data_inicio, data_fim, quantidade,
                                   valor_total, custo, lucro, fornecedor, incluso, detalhes)
    select v_oid, v_novo, ordem, tipo, nome, descricao, data_inicio, data_fim, quantidade,
           valor_total, custo, lucro, fornecedor, incluso, detalhes
      from qs_proposta_itens where opcao_id = o.id;
  end loop;
  return v_novo;
end;
$$;

revoke all on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid, text), qs_proposta_duplicar(uuid) from public, anon;
grant execute on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid, text), qs_proposta_duplicar(uuid) to authenticated;
