-- 0214_subir_venda.sql
-- -----------------------------------------------------------------------------
-- SUBIR VENDA — UMA tela pra Closer, Relacionamento e Operacional (Bruno, 28/10/2026)
--
-- "Lapidar a parte de subir as vendas dentro do QS; todos os setores têm que
--  se conversar; preenchimento rápido porém assertivo." / "Ops sobe venda, mas
--  sem pipeline, só subir a venda facilitando." / "Colocar o valor que cada
--  cliente pagou: venda sem aéreo é outro valor, e há condições especiais de
--  pagamento (ExpedAmigos)."
--
-- O que esta migration faz (NADA aqui chama o Bitrix — o closer continua
-- usando closer_pre_venda + api/closer.js acao=pre-venda, como na 0207):
--
--   1) qs_vendas — o "cabeçalho" da venda: quem comprou (rel_clientes), de
--      onde veio (closer/rel/ops), pagamento (forma, entrada, parcelas, datas),
--      condição especial (flag + texto, ex.: ExpedAmigo) e observações.
--      Itens (qs_venda_itens) e passageiros de expedição apontam pra ela.
--      Duas vendas ligadas (ex.: duas amigas que dividem o quarto e compraram
--      separadas) → ligada_venda_id.
--
--   2) passageiros ganha o que a venda sabe: venda_id, venda_item_id,
--      quarto_par_id (mesmo uuid = mesmo quarto; o Ops monta o rooming a partir
--      disso), quarto_desejado, aereo_incluso, condição especial e pagamento.
--      O rooming de verdade (quartos/passageiro_quarto, por hotel) continua do
--      Ops: na hora da venda ainda não há hotel/quarto numerado.
--
--   3) VAGAS: vagas = expedicoes.pax_planejados − pagantes ativos
--      (tipo 'Pagante' e status_reserva 'Pré-reserva' ou 'Confirmado').
--      Líder/Cortesia não ocupam vaga de venda (cortesia tem pax_cortesia).
--      'Lead' também não ocupa (é interesse, não reserva). Conferido no banco
--      em 28/10: é a conta que bate com as listas do Ops.
--      exp_vagas_para_venda() lista pra qualquer usuário ativo do QS (o closer
--      não tem acesso às tabelas de Expedições, só a isto).
--      exp_vagas_ajustar() — o Ops abre vaga (muda pax_planejados) COM motivo,
--      registrado em exp_vagas_ajustes.
--
--   4) venda_subir(p jsonb) — grava TUDO numa transação: pessoa(s) em
--      rel_clientes, cabeçalho em qs_vendas, itens em qs_venda_itens (closer:
--      pela closer_venda_itens_salvar da 0207, que confere o dono do cartão) e,
--      pra expedição, os passageiros (expedição, cliente, valor contratado e
--      pago, aéreo incluso, quarto e com quem divide). Sem vaga → erro
--      'sem-vaga' e nada é gravado.
--
-- Depende de: 0207 (qs_venda_itens, closer_venda_itens_salvar), 0172/0173
-- (passageiros.cliente_id), rel_tem_acesso/ops_tem_acesso/exp_tem_acesso.
-- Idempotente (if not exists / create or replace / drop ... if exists).
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. qs_vendas (cabeçalho)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists qs_vendas (
  id                 uuid primary key default gen_random_uuid(),
  origem             text not null check (origem in ('closer','rel','ops')),
  negocio_id         uuid references qs_closer_negocios(id) on delete set null,
  viagem_id          uuid references rel_viagens(id) on delete set null,
  cliente_id         uuid references rel_clientes(id) on delete set null,
  valor_total        numeric(12,2) check (valor_total is null or valor_total >= 0),
  -- { forma, condicao ('avista'|'parcelado'|'entrada'), entrada, entrada_data,
  --   parcelas, primeira_parcela, obs } — texto livre o bastante pro Financeiro ler.
  pagamento          jsonb not null default '{}'::jsonb check (jsonb_typeof(pagamento) = 'object'),
  condicao_especial  boolean not null default false,
  condicao_obs       text,
  observacoes        text,
  -- Outra venda ligada a esta (ex.: quem divide o quarto comprou separado).
  ligada_venda_id    uuid references qs_vendas(id) on delete set null,
  criado_por         uuid references qs_users(id) on delete set null default auth.uid(),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
comment on table qs_vendas is
  'Cabeçalho da venda (0214): quem comprou, origem (closer/rel/ops), pagamento e condição especial. Itens em qs_venda_itens.venda_id; passageiros de expedição em passageiros.venda_id. Escrita só pela RPC venda_subir.';

-- Um cartão do closer = uma venda (re-salvar atualiza a mesma).
create unique index if not exists qs_vendas_negocio_unico on qs_vendas (negocio_id) where negocio_id is not null;
create index if not exists qs_vendas_cliente on qs_vendas (cliente_id) where cliente_id is not null;
create index if not exists qs_vendas_viagem on qs_vendas (viagem_id) where viagem_id is not null;

alter table qs_vendas enable row level security;
drop policy if exists qs_vendas_ler on qs_vendas;
create policy qs_vendas_ler on qs_vendas for select to authenticated
  using (
    (select qs_is_manager()) or (select rel_tem_acesso()) or (select fin_tem_acesso()) or (select ops_tem_acesso())
    or criado_por = (select auth.uid())
    or exists (select 1 from qs_closer_negocios n where n.id = negocio_id and n.closer_id = (select auth.uid()))
  );
-- Sem policy de escrita: só a RPC (security definer) grava.
revoke all on qs_vendas from anon;
grant select on qs_vendas to authenticated;
grant all on qs_vendas to service_role;

alter table qs_venda_itens add column if not exists venda_id uuid references qs_vendas(id) on delete set null;
create index if not exists qs_venda_itens_venda on qs_venda_itens (venda_id) where venda_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. passageiros: o que a venda sabe
-- ═════════════════════════════════════════════════════════════════════════════
alter table passageiros add column if not exists venda_id              uuid references qs_vendas(id) on delete set null;
alter table passageiros add column if not exists venda_item_id         uuid references qs_venda_itens(id) on delete set null;
-- Mesmo quarto_par_id = dividem o quarto (o Ops monta o rooming a partir disso).
alter table passageiros add column if not exists quarto_par_id         uuid;
alter table passageiros add column if not exists quarto_desejado       text;
alter table passageiros add column if not exists aereo_incluso         boolean;
-- Condição do passageiro: UMA coluna só, a mesma da aba Valores do Ops (0220):
-- condicao_pagamento padrao|sem_aereo|expedamigo|especial + condicao_obs. Criada
-- aqui também porque a 0214 roda antes da 0220 (as duas usam "if not exists").
alter table passageiros add column if not exists condicao_pagamento text not null default 'padrao';
alter table passageiros add column if not exists condicao_obs       text;
alter table passageiros add column if not exists pagamento             jsonb;
create index if not exists passageiros_venda on passageiros (venda_id) where venda_id is not null;
create index if not exists passageiros_quarto_par on passageiros (quarto_par_id) where quarto_par_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Vagas
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists exp_vagas_ajustes (
  id            uuid primary key default gen_random_uuid(),
  expedicao_id  uuid not null references expedicoes(id) on delete cascade,
  de            int,
  para          int not null,
  motivo        text not null check (length(trim(motivo)) >= 3),
  por           uuid references qs_users(id) on delete set null default auth.uid(),
  em            timestamptz not null default now()
);
create index if not exists exp_vagas_ajustes_exp on exp_vagas_ajustes (expedicao_id, em desc);
alter table exp_vagas_ajustes enable row level security;
drop policy if exists exp_vagas_ajustes_ler on exp_vagas_ajustes;
create policy exp_vagas_ajustes_ler on exp_vagas_ajustes for select to authenticated
  using ((select exp_tem_acesso()) or (select qs_is_manager()));
revoke all on exp_vagas_ajustes from anon;
grant select on exp_vagas_ajustes to authenticated;
grant all on exp_vagas_ajustes to service_role;

-- Pagantes que ocupam vaga numa expedição.
create or replace function exp_ocupados(p_exp uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from passageiros
   where expedicao_id = p_exp and tipo = 'Pagante' and status_reserva in ('Pré-reserva','Confirmado');
$$;
revoke all on function exp_ocupados(uuid) from public, anon;
grant execute on function exp_ocupados(uuid) to authenticated;

-- Expedições à venda (Planejamento / Vendas Abertas / Em andamento, que ainda
-- não embarcaram), com as vagas. Mostra também as lotadas (vagas = 0): a tela
-- deixa ver e manda pedir vaga pro Ops, mas não deixa vender.
create or replace function exp_vagas_para_venda()
returns table (
  id uuid, codigo text, nome text, destino text, data_embarque date, data_retorno date,
  status text, preco_venda_brl numeric, pax_planejados int, ocupados int, vagas int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then
    raise exception 'sem-permissao';
  end if;
  return query
    select e.id, e.codigo, e.nome, e.destino, e.data_embarque, e.data_retorno, e.status::text, e.preco_venda_brl,
           coalesce(e.pax_planejados, 0), o.n, greatest(coalesce(e.pax_planejados, 0) - o.n, 0)
      from expedicoes e
      cross join lateral (select exp_ocupados(e.id) as n) o
     where coalesce(e.tipo, 'expedicao') = 'expedicao'
       and e.status::text in ('Planejamento','Vendas Abertas','Em andamento')
       and (e.data_embarque is null or e.data_embarque >= (now() at time zone 'America/Sao_Paulo')::date)
     order by e.data_embarque nulls last, e.codigo;
end;
$$;
revoke all on function exp_vagas_para_venda() from public, anon;
grant execute on function exp_vagas_para_venda() to authenticated;

-- Passageiros de uma expedição pra escolher "divide o quarto com" (só nome e
-- se já tem par — nada de documento: quem chama pode ser closer).
create or replace function exp_passageiros_para_quarto(p_exp uuid)
returns table (id uuid, nome text, quarto_desejado text, tem_par boolean, venda_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then
    raise exception 'sem-permissao';
  end if;
  return query
    select p.id, p.nome_completo, p.quarto_desejado,
           (p.quarto_par_id is not null and exists (select 1 from passageiros q
              where q.quarto_par_id = p.quarto_par_id and q.id <> p.id and q.status_reserva <> 'Cancelado')),
           p.venda_id
      from passageiros p
     where p.expedicao_id = p_exp and p.status_reserva <> 'Cancelado'
     order by p.nome_completo;
end;
$$;
revoke all on function exp_passageiros_para_quarto(uuid) from public, anon;
grant execute on function exp_passageiros_para_quarto(uuid) to authenticated;

-- O Ops abre (ou fecha) vaga: muda pax_planejados com motivo registrado.
create or replace function exp_vagas_ajustar(p_exp uuid, p_novo int, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e   expedicoes;
  occ int;
begin
  if not (ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then raise exception 'motivo-obrigatorio'; end if;
  if p_novo is null or p_novo < 0 or p_novo > 500 then raise exception 'vagas-invalidas'; end if;
  select * into e from expedicoes where id = p_exp for update;
  if not found then raise exception 'expedicao-nao-encontrada'; end if;
  occ := exp_ocupados(p_exp);
  if p_novo < occ then raise exception 'abaixo-dos-ocupados:%', occ; end if;
  if p_novo = coalesce(e.pax_planejados, 0) then
    return jsonb_build_object('ok', true, 'ja_estava', true, 'vagas', p_novo - occ);
  end if;
  update expedicoes set pax_planejados = p_novo where id = p_exp;
  insert into exp_vagas_ajustes (expedicao_id, de, para, motivo, por)
  values (p_exp, e.pax_planejados, p_novo, trim(p_motivo), auth.uid());
  return jsonb_build_object('ok', true, 'de', e.pax_planejados, 'para', p_novo, 'vagas', p_novo - occ);
end;
$$;
revoke all on function exp_vagas_ajustar(uuid, int, text) from public, anon;
grant execute on function exp_vagas_ajustar(uuid, int, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. venda_subir — grava tudo junto
-- ═════════════════════════════════════════════════════════════════════════════

-- Acha ou cria a pessoa (ficha única). Ordem: id → CPF → telefone → e-mail → cria.
-- Campos inválidos são ignorados (não derrubam a venda); o Rel completa depois.
-- TROCAR pela buscarOuCriarPessoa da frente "cadastro" quando ela tiver RPC.
create or replace function venda_cliente_resolver(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := nullif(p ->> 'id', '')::uuid;
  v_nome  text := nullif(regexp_replace(trim(coalesce(p ->> 'nome', '')), '\s+', ' ', 'g'), '');
  v_cpf   text := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '\D', '', 'g'), '');
  v_fone  text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
  v_mail  text := nullif(lower(trim(coalesce(p ->> 'email', ''))), '');
  v_pass  text := nullif(upper(regexp_replace(coalesce(p ->> 'passaporte', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_nasc  date;
  v_m     uuid;
begin
  begin v_nasc := nullif(p ->> 'nascimento', '')::date; exception when others then v_nasc := null; end;
  if length(v_fone) in (10, 11) then v_fone := '55' || v_fone; end if;
  if v_fone !~ '^\d{10,15}$' then v_fone := null; end if;
  if v_cpf is not null and v_cpf !~ '^\d{11}$' then v_cpf := null; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_mail := null; end if;
  if v_pass is not null and v_pass !~ '^[A-Z0-9]{5,12}$' then v_pass := null; end if;

  if v_id is not null then
    -- Ficha mesclada: segue pra ficha que ficou.
    select coalesce(mesclado_em_id, id) into v_m from rel_clientes where id = v_id;
    if v_m is not null then return v_m; end if;
  end if;
  if v_cpf is not null then
    select id into v_id from rel_clientes where cpf = v_cpf and mesclado_em_id is null and arquivado_em is null
     order by titular_id nulls first, criado_em limit 1;
  end if;
  if v_id is null and v_fone is not null then
    v_id := rel_cliente_do_telefone(v_fone);
  end if;
  if v_id is null and v_mail is not null then
    select id into v_id from rel_clientes where email = v_mail and mesclado_em_id is null and arquivado_em is null
     order by titular_id nulls first, criado_em limit 1;
  end if;
  if v_id is not null then
    -- Completa só o que a ficha não tem (nunca sobrescreve).
    update rel_clientes set
      cpf = coalesce(cpf, v_cpf), telefone = coalesce(telefone, v_fone), email = coalesce(email, v_mail),
      passaporte = coalesce(passaporte, v_pass), nascimento = coalesce(nascimento, v_nasc)
     where id = v_id
       and (cpf is null and v_cpf is not null or telefone is null and v_fone is not null or email is null and v_mail is not null
            or passaporte is null and v_pass is not null or nascimento is null and v_nasc is not null)
       and not exists (select 1 from rel_clientes o where o.id <> v_id and o.cpf = v_cpf and v_cpf is not null);
    return v_id;
  end if;
  if v_nome is null or length(v_nome) < 2 then raise exception 'pessoa-sem-nome'; end if;
  insert into rel_clientes (nome, cpf, telefone, email, passaporte, nascimento, criado_por)
  values (v_nome, v_cpf, v_fone, v_mail, v_pass, v_nasc, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function venda_cliente_resolver(jsonb) from public, anon, authenticated;

-- p (jsonb):
-- {
--   origem: 'closer'|'rel'|'ops',
--   negocio_id?: uuid,          -- closer (obrigatório pro closer)
--   viagem_id?: uuid,           -- rel, quando sobe a venda de dentro da viagem
--   cliente: { id?, nome, telefone?, email?, cpf?, nascimento?, passaporte? },
--   itens: [{ id?, tipo, nome, data_inicio, data_fim, dados, valor, custo, fornecedor }],
--   viajantes: [{                -- só pra item de expedição
--     chave, item (índice 1-based do item de expedição em itens),
--     comprador (bool: é o cliente acima), cliente_id?, nome, telefone?, email?, cpf?,
--     valor_contratado, valor_pago, aereo_incluso (bool), quarto_desejado,
--     divide_com_chave?  (outro viajante DESTA venda),
--     divide_com_passageiro_id? (passageiro que já está na expedição — liga as vendas),
--     divide_com_nome?   (só o nome, quando a outra pessoa ainda não comprou)
--   }],
--   pagamento: { forma, condicao, entrada, entrada_data, parcelas, primeira_parcela, obs },
--   condicao_especial: bool, condicao_obs: text, observacoes: text
-- }
-- Devolve { ok, venda_id, cliente_id, itens, passageiros, total }.
create or replace function venda_subir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_origem  text := coalesce(nullif(p ->> 'origem', ''), 'rel');
  v_neg     uuid := nullif(p ->> 'negocio_id', '')::uuid;
  v_viagem  uuid := nullif(p ->> 'viagem_id', '')::uuid;
  n         qs_closer_negocios;
  v_cli     uuid;
  v_venda   uuid;
  v_itens   jsonb := coalesce(p -> 'itens', '[]'::jsonb);
  v_viaj    jsonb := coalesce(p -> 'viajantes', '[]'::jsonb);
  v_pag     jsonb := case when jsonb_typeof(p -> 'pagamento') = 'object' then p -> 'pagamento' else '{}'::jsonb end;
  v_cesp    boolean := coalesce((p ->> 'condicao_especial')::boolean, false);
  v_cobs    text := nullif(trim(coalesce(p ->> 'condicao_obs', '')), '');
  v_total   numeric;
  it        jsonb;
  vj        jsonb;
  i         int := 0;
  v_item_id uuid;
  v_exp     uuid;
  e         expedicoes;
  v_vagas   int;
  v_novos   int;
  v_pcli    uuid;
  v_pax     uuid;
  v_mapa    jsonb := '{}'::jsonb;   -- chave do viajante → passageiro id
  v_npax    int := 0;
  v_par     uuid;
  v_outro   passageiros;
  v_nomes   jsonb;
begin
  if v_origem not in ('closer','rel','ops') then raise exception 'origem-invalida'; end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then raise exception 'itens-invalidos'; end if;
  if jsonb_typeof(v_viaj) <> 'array' then v_viaj := '[]'::jsonb; end if;

  -- ── Quem pode ──
  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif v_origem = 'closer' then
    raise exception 'negocio-obrigatorio';
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;

  select coalesce(sum(nullif(x ->> 'valor', '')::numeric), 0) into v_total from jsonb_array_elements(v_itens) x;
  if v_total <= 0 then raise exception 'valor-total-obrigatorio'; end if;

  -- ── Quem comprou ──
  if v_viagem is not null and nullif(p #>> '{cliente,id}', '') is null and nullif(p #>> '{cliente,nome}', '') is null then
    select cliente_id into v_cli from rel_viagens where id = v_viagem;
  end if;
  if v_cli is null then
    if jsonb_typeof(p -> 'cliente') <> 'object' then raise exception 'pessoa-sem-nome'; end if;
    v_cli := venda_cliente_resolver(p -> 'cliente');
  end if;
  if v_viagem is null and v_neg is not null then v_viagem := n.viagem_id; end if;

  -- ── Cabeçalho ──
  if v_neg is not null then select id into v_venda from qs_vendas where negocio_id = v_neg; end if;
  if v_venda is null then
    insert into qs_vendas (origem, negocio_id, viagem_id, cliente_id, valor_total, pagamento, condicao_especial, condicao_obs, observacoes)
    values (v_origem, v_neg, v_viagem, v_cli, v_total, v_pag, v_cesp, v_cobs, nullif(trim(coalesce(p ->> 'observacoes', '')), ''))
    returning id into v_venda;
  else
    update qs_vendas set cliente_id = v_cli, viagem_id = coalesce(v_viagem, viagem_id), valor_total = v_total,
           pagamento = v_pag, condicao_especial = v_cesp, condicao_obs = v_cobs,
           observacoes = nullif(trim(coalesce(p ->> 'observacoes', '')), ''), atualizado_em = now()
     where id = v_venda;
  end if;

  -- ── Itens ──
  if v_neg is not null then
    -- Closer: a regra da 0207 (dono do cartão, item emitido não sai, valor previsto acompanha).
    perform closer_venda_itens_salvar(v_neg, v_itens);
    perform set_config('qs.venda_itens_rpc', 'on', true);
    update qs_venda_itens set venda_id = v_venda, cliente_id = coalesce(cliente_id, v_cli)
     where negocio_id = v_neg;
  else
    perform set_config('qs.venda_itens_rpc', 'on', true);
    for it in select * from jsonb_array_elements(v_itens) loop
      i := i + 1;
      if nullif(trim(it ->> 'nome'), '') is null then raise exception 'item-sem-nome'; end if;
      if nullif(it ->> 'data_inicio', '') is not null and nullif(it ->> 'data_fim', '') is not null
         and (it ->> 'data_fim')::date < (it ->> 'data_inicio')::date then raise exception 'volta-antes-da-ida'; end if;
      if coalesce(nullif(it ->> 'valor', '')::numeric, 0) < 0 then raise exception 'valor-invalido'; end if;
      insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, venda_id, tipo, nome, data_inicio, data_fim, dados,
                                  passageiros, valor, custo, fornecedor, ordem, criado_por)
      values (null, v_viagem, v_cli, v_venda, it ->> 'tipo', left(trim(it ->> 'nome'), 300),
              nullif(it ->> 'data_inicio', '')::date, nullif(it ->> 'data_fim', '')::date,
              case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
              case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else '[]'::jsonb end,
              nullif(it ->> 'valor', '')::numeric, nullif(it ->> 'custo', '')::numeric,
              nullif(trim(coalesce(it ->> 'fornecedor', '')), ''), i, auth.uid());
    end loop;
  end if;

  -- ── Expedição: vaga + passageiros ──
  i := 0;
  for it in select * from jsonb_array_elements(v_itens) loop
    i := i + 1;
    continue when it ->> 'tipo' <> 'expedicao';
    v_exp := nullif(it #>> '{dados,expedicao_id}', '')::uuid;
    if v_exp is null then raise exception 'expedicao-obrigatoria'; end if;
    select * into e from expedicoes where id = v_exp for update;   -- trava: duas vendas ao mesmo tempo não furam a vaga
    if not found then raise exception 'expedicao-nao-encontrada'; end if;
    if v_neg is not null then
      select id into v_item_id from qs_venda_itens where negocio_id = v_neg and ordem = i;
    else
      select id into v_item_id from qs_venda_itens where venda_id = v_venda and ordem = i;
    end if;

    -- Sem viajante na lista: vai só o comprador, com o valor do item.
    if not exists (select 1 from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i) then
      v_viaj := v_viaj || jsonb_build_array(jsonb_build_object('chave', 'comprador-' || i, 'item', i, 'comprador', true,
                  'valor_contratado', it ->> 'valor', 'valor_pago', 0));
    end if;

    -- Resolve as pessoas antes, pra contar quem é NOVO na expedição.
    v_novos := 0;
    v_nomes := '{}'::jsonb;
    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      if nullif(vj ->> 'chave', '') is null then raise exception 'viajante-sem-chave'; end if;
      if coalesce((vj ->> 'comprador')::boolean, false) then v_pcli := v_cli;
      else v_pcli := venda_cliente_resolver(jsonb_build_object('id', vj ->> 'cliente_id', 'nome', vj ->> 'nome',
                       'telefone', vj ->> 'telefone', 'email', vj ->> 'email', 'cpf', vj ->> 'cpf'));
      end if;
      v_nomes := v_nomes || jsonb_build_object(vj ->> 'chave', v_pcli);
      if not exists (select 1 from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado') then
        v_novos := v_novos + 1;
      end if;
    end loop;
    v_vagas := greatest(coalesce(e.pax_planejados, 0) - exp_ocupados(v_exp), 0);
    if v_novos > v_vagas then
      raise exception 'sem-vaga:%:%', e.codigo, v_vagas;
    end if;

    -- Grava (ou atualiza, se a pessoa já está na expedição).
    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      select id into v_pax from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado'
       order by created_at limit 1;
      if v_pax is null then
        insert into passageiros (expedicao_id, cliente_id, nome_completo, tipo, status_reserva, telefone, email, cpf,
                                 valor_contratado_brl, valor_pago_brl, inscricao_origem, venda_id, venda_item_id,
                                 aereo_incluso, quarto_desejado, acompanhante_dividir_com, condicao_pagamento,
                                 condicao_obs, pagamento, observacoes)
        select v_exp, c.id, c.nome, 'Pagante'::tipo_passageiro, 'Pré-reserva'::status_reserva, c.telefone, c.email, c.cpf,
               nullif(vj ->> 'valor_contratado', '')::numeric, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0),
               'QS — venda (' || v_origem || ')', v_venda, v_item_id,
               (vj ->> 'aereo_incluso')::boolean, nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''),
               nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''),
               case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
               case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, v_pag,
               nullif(trim(coalesce(p ->> 'observacoes', '')), '')
          from rel_clientes c where c.id = v_pcli
        returning id into v_pax;
      else
        update passageiros set
          valor_contratado_brl = coalesce(nullif(vj ->> 'valor_contratado', '')::numeric, valor_contratado_brl),
          valor_pago_brl = greatest(valor_pago_brl, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0)),
          venda_id = v_venda, venda_item_id = v_item_id,
          aereo_incluso = coalesce((vj ->> 'aereo_incluso')::boolean, aereo_incluso),
          quarto_desejado = coalesce(nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''), quarto_desejado),
          acompanhante_dividir_com = coalesce(nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''), acompanhante_dividir_com),
          condicao_pagamento = case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
          condicao_obs = case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, pagamento = v_pag
         where id = v_pax;
      end if;
      v_mapa := v_mapa || jsonb_build_object(vj ->> 'chave', v_pax);
      v_npax := v_npax + 1;
    end loop;

    -- Quarto: quem divide com quem.
    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pax := (v_mapa ->> (vj ->> 'chave'))::uuid;
      continue when v_pax is null;
      if nullif(vj ->> 'divide_com_chave', '') is not null and v_mapa ? (vj ->> 'divide_com_chave') then
        -- Os dois nesta venda: mesmo par.
        select coalesce(a.quarto_par_id, b.quarto_par_id, gen_random_uuid()) into v_par
          from passageiros a, passageiros b where a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid;
        update passageiros set quarto_par_id = v_par
         where id in (v_pax, (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
        update passageiros a set acompanhante_dividir_com = b.nome_completo
          from passageiros b
         where (a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid)
            or (b.id = v_pax and a.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
      elsif nullif(vj ->> 'divide_com_passageiro_id', '') is not null then
        -- Divide com quem já comprou: o quarto nasce montado e as vendas ficam ligadas.
        select * into v_outro from passageiros
         where id = (vj ->> 'divide_com_passageiro_id')::uuid and expedicao_id = v_exp and status_reserva <> 'Cancelado';
        if not found then raise exception 'par-de-quarto-invalido'; end if;
        v_par := coalesce(v_outro.quarto_par_id, gen_random_uuid());
        update passageiros set quarto_par_id = v_par where id in (v_pax, v_outro.id);
        update passageiros set acompanhante_dividir_com = v_outro.nome_completo where id = v_pax;
        update passageiros set acompanhante_dividir_com = (select nome_completo from passageiros where id = v_pax) where id = v_outro.id;
        if v_outro.venda_id is not null and v_outro.venda_id <> v_venda then
          update qs_vendas set ligada_venda_id = v_outro.venda_id where id = v_venda and ligada_venda_id is null;
          update qs_vendas set ligada_venda_id = v_venda where id = v_outro.venda_id and ligada_venda_id is null;
        end if;
      end if;
    end loop;

    -- O item da expedição guarda quem viaja (o Rel e o app leem daqui).
    update qs_venda_itens set passageiros = (
      select coalesce(jsonb_agg(jsonb_build_object('cliente_id', px.cliente_id, 'nome', px.nome_completo, 'passageiro_id', px.id)), '[]'::jsonb)
        from passageiros px where px.venda_item_id = v_item_id and px.status_reserva <> 'Cancelado')
     where id = v_item_id;
  end loop;

  perform set_config('qs.venda_itens_rpc', 'off', true);
  return jsonb_build_object('ok', true, 'venda_id', v_venda, 'cliente_id', v_cli,
                            'itens', jsonb_array_length(v_itens), 'passageiros', v_npax, 'total', v_total);
end;
$$;
revoke all on function venda_subir(jsonb) from public, anon;
grant execute on function venda_subir(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- ROLLBACK (manual, se precisar):
-- drop function if exists venda_subir(jsonb);
-- drop function if exists venda_cliente_resolver(jsonb);
-- drop function if exists exp_vagas_ajustar(uuid, int, text);
-- drop function if exists exp_passageiros_para_quarto(uuid);
-- drop function if exists exp_vagas_para_venda();
-- drop function if exists exp_ocupados(uuid);
-- drop table if exists exp_vagas_ajustes;
-- alter table passageiros drop column if exists venda_id, drop column if exists venda_item_id,
--   drop column if exists quarto_par_id, drop column if exists quarto_desejado, drop column if exists aereo_incluso,
--   drop column if exists condicao_pagamento, drop column if exists condicao_obs, drop column if exists pagamento;
-- alter table qs_venda_itens drop column if exists venda_id;
-- drop table if exists qs_vendas;
-- -----------------------------------------------------------------------------
