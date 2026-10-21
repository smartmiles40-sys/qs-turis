-- 0156_propostas.sql
-- -----------------------------------------------------------------------------
-- PROPOSTAS (Bruno, 21/10/2026): "Operações quer montar a PROPOSTA dentro do QS
-- (com a formatação da agência pra mandar ao cliente) e depois CONFERIR a
-- emissão contra a proposta".
--
--   proposta ─┬─ opção 1 ─┬─ item (aéreo, hospedagem, transfer…)
--             │           └─ item …
--             └─ opção 2 …      (várias opções; o cliente escolhe UMA)
--
-- Decisões do Bruno (21/10): link + PDF com a marca da agência; todos os tipos
-- de serviço; várias opções; SEM validade (só "valores sujeitos a
-- confirmação"); o cliente clica "Quero esta opção" no link → registra e avisa
-- quem montou.
--
-- Referência estudada: CRM AgentePro (tipos de serviço e campos de cada um,
-- pagamento por opção, custo/lucro internos). Lá as opções não existem e o
-- cliente não aprova pelo link — aqui sim.
--
-- O cliente abre /proposta/<token> SEM login: quem lê pro cliente é o servidor
-- (api/proposta.js, service role) e devolve só o que vai pra tela — nunca
-- custo, lucro nem fornecedor.
-- -----------------------------------------------------------------------------

-- Quem pode montar/ver propostas: qualquer pessoa ativa de um setor (Operações
-- monta; Comercial, Relacionamento e Financeiro acompanham).
create or replace function qs_pode_propostas() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or coalesce(cardinality(setores), 0) > 0)
  );
$$;
grant execute on function qs_pode_propostas() to authenticated;

create table if not exists qs_propostas (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,
  token            text not null unique default rel_token(),  -- 64 hex (mesmo gerador dos documentos/pesquisa)
  setor            text not null default 'operacional'
                   check (setor in ('comercial','relacionamento','financeiro','operacional')),
  status           text not null default 'rascunho'
                   check (status in ('rascunho','enviada','aprovada','recusada','cancelada')),
  titulo           text not null default '',          -- o que o cliente vê no topo ("Japão em família")
  destino          text,
  data_ida         date,
  data_volta       date,
  adultos          int  not null default 1 check (adultos between 0 and 99),
  criancas         int  not null default 0 check (criancas between 0 and 99),
  bebes            int  not null default 0 check (bebes between 0 and 99),
  apresentacao     text not null default '',          -- texto de abertura pro cliente
  observacoes      text not null default '',          -- o que inclui / não inclui, condições
  esconder_precos  boolean not null default false,    -- só o total da opção, sem preço por item
  moeda            text not null default 'BRL',
  capa_url         text,
  -- De onde veio / do que se trata (snapshot do nome, como na central)
  solicitacao_id   uuid references qs_solicitacoes(id) on delete set null,
  cliente_id       uuid references rel_clientes(id) on delete set null,
  viagem_id        uuid references rel_viagens(id) on delete set null,
  lead_id          uuid references qs_leads(id) on delete set null,
  cliente_nome     text,                              -- "Maria Souza" (aparece pro cliente)
  -- Pessoas e tempos
  criado_por       uuid references qs_users(id) on delete set null default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  enviada_em       timestamptz,
  vista_em         timestamptz,                       -- 1ª vez que o CLIENTE abriu
  vista_ultima_em  timestamptz,
  visualizacoes    int not null default 0,
  aprovada_opcao_id uuid,
  aprovada_em      timestamptz,
  aprovada_nome    text,                              -- nome que o cliente digitou ao aprovar
  aprovacao_vista_em timestamptz                      -- quem montou já viu o aviso
);
create index if not exists qs_propostas_status_idx on qs_propostas (status, atualizado_em desc);
create index if not exists qs_propostas_sol_idx on qs_propostas (solicitacao_id);
create index if not exists qs_propostas_cliente_idx on qs_propostas (cliente_id);
create index if not exists qs_propostas_criador_idx on qs_propostas (criado_por, aprovada_em);

create table if not exists qs_proposta_opcoes (
  id           uuid primary key default gen_random_uuid(),
  proposta_id  uuid not null references qs_propostas(id) on delete cascade,
  ordem        int  not null default 0,
  titulo       text not null default '',
  descricao    text not null default '',
  recomendada  boolean not null default false,
  desconto     numeric(14,2) not null default 0 check (desconto >= 0),
  -- Formas de pagamento ALTERNATIVAS (até 4): [{forma, condicao: avista|parcelado|entrada,
  --   parcelas, entrada, juros, obs}] — o cliente escolhe uma, nunca se somam.
  pagamentos   jsonb not null default '[]'::jsonb
);
create index if not exists qs_prop_opcoes_idx on qs_proposta_opcoes (proposta_id, ordem);

create table if not exists qs_proposta_itens (
  id           uuid primary key default gen_random_uuid(),
  opcao_id     uuid not null references qs_proposta_opcoes(id) on delete cascade,
  proposta_id  uuid not null references qs_propostas(id) on delete cascade,
  ordem        int  not null default 0,
  tipo         text not null check (tipo in ('aereo','hospedagem','transfer','trem','passeio','seguro','carro','cruzeiro','visto','pacote','outro')),
  nome         text not null default '',
  descricao    text not null default '',
  data_inicio  date,
  data_fim     date,
  quantidade   int  not null default 1 check (quantidade between 1 and 999),
  valor_total  numeric(14,2) not null default 0,       -- preço de VENDA (o cliente vê, se não esconder)
  custo        numeric(14,2),                          -- interno
  lucro        numeric(14,2),                          -- interno
  fornecedor   text,                                   -- interno
  incluso      boolean not null default false,         -- aparece "incluso" no lugar do valor
  detalhes     jsonb not null default '{}'::jsonb      -- campos do tipo (voo, quarto, regime…)
);
create index if not exists qs_prop_itens_idx on qs_proposta_itens (opcao_id, ordem);
create index if not exists qs_prop_itens_prop_idx on qs_proposta_itens (proposta_id);

do $$ begin
  alter table qs_propostas add constraint qs_propostas_opcao_fk
    foreign key (aprovada_opcao_id) references qs_proposta_opcoes(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── RLS: time lê; grava só por RPC (qs_proposta_salvar / qs_proposta_status) ──
alter table qs_propostas enable row level security;
alter table qs_proposta_opcoes enable row level security;
alter table qs_proposta_itens enable row level security;
drop policy if exists qs_propostas_ler on qs_propostas;
drop policy if exists qs_prop_opcoes_ler on qs_proposta_opcoes;
drop policy if exists qs_prop_itens_ler on qs_proposta_itens;
create policy qs_propostas_ler on qs_propostas for select to authenticated using (qs_pode_propostas());
create policy qs_prop_opcoes_ler on qs_proposta_opcoes for select to authenticated using (qs_pode_propostas());
create policy qs_prop_itens_ler on qs_proposta_itens for select to authenticated using (qs_pode_propostas());
revoke all on qs_propostas, qs_proposta_opcoes, qs_proposta_itens from anon;
grant select on qs_propostas, qs_proposta_opcoes, qs_proposta_itens to authenticated;

-- ── Salvar tudo de uma vez (cabeçalho + opções + itens) ────────────────────
-- p = { id?, setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes,
--       apresentacao, observacoes, esconder_precos, capa_url, solicitacao_id, cliente_id,
--       viagem_id, lead_id, cliente_nome,
--       opcoes: [{ id?, titulo, descricao, recomendada, desconto, pagamentos,
--                  itens: [{ id?, tipo, nome, descricao, data_inicio, data_fim, quantidade,
--                            valor_total, custo, lucro, fornecedor, incluso, detalhes }] }] }
-- Opções/itens que sumiram do JSON são apagados. Devolve o id da proposta.
create or replace function qs_proposta_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v_st   text;
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
    insert into qs_propostas (setor) values (coalesce(nullif(p ->> 'setor', ''), 'operacional')) returning id into v_id;
  else
    select status into v_st from qs_propostas where id = v_id for update;
    if v_st is null then raise exception 'proposta-nao-encontrada'; end if;
    if v_st = 'cancelada' then raise exception 'proposta-cancelada'; end if;
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

-- ── Mudar o andamento: enviada · recusada · cancelada · rascunho · aprovada (pelo time)
--    'visto' = quem montou viu o aviso de aprovação.
create or replace function qs_proposta_status(p_id uuid, p_acao text, p_opcao uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  if p_acao = 'enviada' then
    update qs_propostas set status = case when status = 'rascunho' then 'enviada' else status end,
           enviada_em = coalesce(enviada_em, now()), atualizado_em = now() where id = p_id;
  elsif p_acao in ('recusada', 'cancelada', 'rascunho') then
    update qs_propostas set status = p_acao, atualizado_em = now(),
           aprovada_opcao_id = case when p_acao = 'rascunho' then null else aprovada_opcao_id end,
           aprovada_em = case when p_acao = 'rascunho' then null else aprovada_em end
     where id = p_id;
  elsif p_acao = 'aprovada' then
    if not exists (select 1 from qs_proposta_opcoes where id = p_opcao and proposta_id = p_id) then raise exception 'opcao-invalida'; end if;
    update qs_propostas set status = 'aprovada', aprovada_opcao_id = p_opcao, aprovada_em = now(),
           aprovada_nome = null, aprovacao_vista_em = now(), atualizado_em = now() where id = p_id;
  elsif p_acao = 'visto' then
    update qs_propostas set aprovacao_vista_em = now() where id = p_id and aprovada_em is not null;
  else
    raise exception 'acao-invalida';
  end if;
end;
$$;

-- Duplicar a proposta inteira (nova versão pro mesmo cliente).
create or replace function qs_proposta_duplicar(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_novo uuid;
  o record;
  v_oid uuid;
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  insert into qs_propostas (setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
                            observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome)
  select setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
         observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome
    from qs_propostas where id = p_id
  returning id into v_novo;
  if v_novo is null then raise exception 'proposta-nao-encontrada'; end if;
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

revoke all on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid), qs_proposta_duplicar(uuid) from public, anon;
grant execute on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid), qs_proposta_duplicar(uuid) to authenticated;
