-- 0210 — App do cliente: o viajante vê SÓ as viagens dele (leitura).
--
-- SÓ ESCRITA (27/10/2026). Não aplicar sem o ok do Bruno. Leia docs/APP-CLIENTE.md antes.
--
-- Duas formas de o app do cliente entrar, as duas cobertas aqui:
--   A) (fase 0/1, como é hoje) o app antigo confere CPF + senha em `acesso_senhas` no servidor
--      e chama as funções abaixo com a chave service_role, passando p_cliente.
--   B) (fase 2, opcional) o cliente tem login próprio no Supabase Auth do QS. O vínculo
--      auth.users ↔ rel_clientes fica em `app_cliente_acessos` e as funções descobrem o
--      cliente sozinhas (p_cliente é ignorado).
--
-- Regra de ouro: o cliente NUNCA lê tabela direto. Só por estas funções, que devolvem
-- campos escolhidos a dedo (sem custo, margem, observação interna, dados do Bitrix ou IA).
-- E, como muitas policies antigas do QS liberam `authenticated` com `true` (qs_meetings,
-- qs_users, qs_settings, cadências, inserts de leads/notas/tarefas…), a parte 4 põe uma
-- policy RESTRITIVA em todas as tabelas que barra quem é cliente. Equipe não muda nada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Vínculo login ↔ ficha do cliente
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists app_cliente_acessos (
  auth_user_id     uuid primary key references auth.users(id) on delete cascade,
  cliente_id       uuid not null unique references rel_clientes(id) on delete cascade,
  cpf              text,                       -- 11 dígitos, pra achar a ficha / conferir
  origem           text not null default 'convite'
                   check (origem in ('convite', 'acesso_senhas', 'manual')),
  criado_por       uuid references qs_users(id) default auth.uid(),
  criado_em        timestamptz not null default now(),
  ultimo_acesso_em timestamptz,
  bloqueado_em     timestamptz                 -- tira o acesso sem apagar o histórico
);
comment on table app_cliente_acessos is
  'App do cliente (0210): qual login do Supabase Auth é qual ficha (rel_clientes). Equipe nunca entra aqui.';

alter table app_cliente_acessos enable row level security;

drop policy if exists app_cliente_acessos_equipe_ler on app_cliente_acessos;
create policy app_cliente_acessos_equipe_ler on app_cliente_acessos
  for select to authenticated
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()));

drop policy if exists app_cliente_acessos_equipe_gravar on app_cliente_acessos;
create policy app_cliente_acessos_equipe_gravar on app_cliente_acessos
  for all to authenticated
  using ((select rel_tem_acesso()))
  with check ((select rel_tem_acesso()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quem é o cliente da sessão
-- ─────────────────────────────────────────────────────────────────────────────
-- Ficha do cliente logado. Quem tem linha em qs_users (equipe) NUNCA é tratado como cliente.
-- Ficha mesclada → segue pra ficha viva (cad_ficha_viva, da 0172).
create or replace function app_cliente_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select cad_ficha_viva(a.cliente_id)
    from app_cliente_acessos a
   where a.auth_user_id = auth.uid()
     and a.bloqueado_em is null
     and not exists (select 1 from qs_users q where q.id = auth.uid())
$$;

create or replace function app_eh_cliente()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from app_cliente_acessos a
     where a.auth_user_id = auth.uid()
       and not exists (select 1 from qs_users q where q.id = auth.uid())
  )
$$;

-- Cliente efetivo da chamada: login próprio (B) ou, só pro servidor (service_role), o p_cliente (A).
create or replace function app_cliente_efetivo(p_cliente uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case
    when coalesce(auth.role(), '') = 'service_role' then cad_ficha_viva(p_cliente)
    else app_cliente_id()
  end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O que o cliente pode ver
-- ─────────────────────────────────────────────────────────────────────────────
-- Viagens do cliente: comprador (rel_viagens.cliente_id), passageiro (rel_viagem_passageiros)
-- ou passageiro de expedição ligado à ficha (passageiros.cliente_id → expedicoes_id).
create or replace function app_cliente_viagem_ids(p_cliente uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select v.id
    from rel_viagens v
   where v.arquivado_em is null
     and v.mesclada_em_id is null
     and coalesce(v.status, 'ativa') <> 'cancelada'
     and p_cliente is not null
     and (
          v.cliente_id = p_cliente
       or exists (select 1 from rel_viagem_passageiros vp
                   where vp.viagem_id = v.id and vp.cliente_id = p_cliente)
       or (v.expedicoes_id is not null and exists (
             select 1 from passageiros p
              where p.expedicao_id = v.expedicoes_id
                and p.cliente_id = p_cliente
                and p.status_reserva::text = 'Confirmado'))
     )
$$;

-- Lista de viagens (tela inicial do app).
create or replace function app_cliente_minhas_viagens(p_cliente uuid default null)
returns table (
  id uuid, titulo text, destino text, tipo text,
  data_embarque date, data_retorno date, expedicao_id uuid,
  passageiros text[], fase text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare c uuid := app_cliente_efetivo(p_cliente);
begin
  if c is null then return; end if;
  return query
  select v.id, coalesce(v.titulo, v.destino), v.destino, v.tipo,
         v.data_embarque, v.data_retorno, v.expedicoes_id,
         array(select rc.nome from rel_viagem_passageiros vp join rel_clientes rc on rc.id = vp.cliente_id
                where vp.viagem_id = v.id order by rc.nome),
         case when v.data_retorno is not null and v.data_retorno < current_date then 'passada'
              when v.data_embarque is not null and v.data_embarque <= current_date then 'em_andamento'
              else 'proxima' end
    from rel_viagens v
   where v.id in (select app_cliente_viagem_ids(c))
   order by (v.data_retorno < current_date) nulls first, v.data_embarque nulls last;
end $$;

-- Detalhe de UMA viagem (tela "Minha viagem"), em JSON pronto pro app.
-- Itens da venda (qs_venda_itens, 0207) entram só se a tabela já existir; nunca custo/fornecedor/valor.
create or replace function app_cliente_viagem(p_viagem uuid, p_cliente uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  c uuid := app_cliente_efetivo(p_cliente);
  v rel_viagens;
  r jsonb;
  itens jsonb := '[]'::jsonb;
  expd jsonb := null;
begin
  if c is null or p_viagem not in (select app_cliente_viagem_ids(c)) then
    return null;  -- não é dele: devolve nada (sem dizer se a viagem existe)
  end if;
  select * into v from rel_viagens where id = p_viagem;

  if to_regclass('public.qs_venda_itens') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'tipo', i.tipo, 'nome', i.nome,
               'data_inicio', i.data_inicio, 'data_fim', i.data_fim,
               'status', i.status, 'dados', i.dados) order by i.data_inicio nulls last, i.ordem), '[]'::jsonb)
        from qs_venda_itens i
       where i.viagem_id = $1
         and i.status <> 'cancelado'
         and (i.cliente_id = $2
              or jsonb_array_length(coalesce(i.passageiros, '[]'::jsonb)) = 0
              or i.passageiros @> jsonb_build_array(jsonb_build_object('cliente_id', $2::text)))
    $q$ into itens using p_viagem, c;
  end if;

  if v.expedicoes_id is not null then
    select jsonb_build_object(
      'id', e.id, 'nome', e.nome, 'destino', e.destino,
      'data_embarque', e.data_embarque, 'data_retorno', e.data_retorno,
      'roteiro', (select coalesce(jsonb_agg(jsonb_build_object(
                    'dia', d.dia, 'data', d.data, 'titulo', d.titulo, 'descricao', d.descricao,
                    'cidade', d.cidade, 'refeicoes', d.refeicoes, 'hospedagem', d.hospedagem)
                    order by d.data nulls last, d.dia), '[]'::jsonb)
                  from roteiro_dias d where d.expedicao_id = e.id and d.extensao_id is null),
      'voos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'trecho', f.trecho, 'companhia', f.companhia, 'numero_voo', f.numero_voo,
                    'origem', f.origem, 'destino', f.destino, 'partida', f.partida,
                    'chegada', f.chegada, 'localizador', f.localizador) order by f.ordem), '[]'::jsonb)
                  from expedicao_voos f
                 where f.expedicao_id = e.id and f.extensao_id is null
                   and (f.passageiro_id is null or f.passageiro_id in
                        (select p.id from passageiros p where p.cliente_id = c))),
      'avisos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', a.tipo, 'titulo', a.titulo,
                    'conteudo', a.conteudo) order by a.ordem), '[]'::jsonb)
                  from expedicao_avisos a where a.expedicao_id = e.id),
      'info', (select coalesce(jsonb_agg(jsonb_build_object('titulo', x.titulo, 'conteudo', x.conteudo)
                    order by x.ordem), '[]'::jsonb)
                  from expedicao_info x where x.expedicao_id = e.id),
      'links', (select coalesce(jsonb_agg(jsonb_build_object('label', l.label, 'url', l.url)
                    order by l.ordem), '[]'::jsonb)
                  from links_expedicao l where l.expedicao_id = e.id)
    ) into expd
    from expedicoes e where e.id = v.expedicoes_id;
  end if;

  r := jsonb_build_object(
    'id', v.id,
    'titulo', coalesce(v.titulo, v.destino),
    'destino', v.destino,
    'tipo', v.tipo,
    'data_embarque', v.data_embarque,
    'data_retorno', v.data_retorno,
    'passageiros', (select coalesce(jsonb_agg(jsonb_build_object('nome', rc.nome, 'eu', rc.id = c)
                      order by rc.nome), '[]'::jsonb)
                      from rel_viagem_passageiros vp join rel_clientes rc on rc.id = vp.cliente_id
                     where vp.viagem_id = v.id),
    'trechos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'tipo', t.tipo, 'descricao', t.descricao,
                    'origem', t.origem, 'destino', t.destino,
                    'origem_codigo', t.origem_codigo, 'destino_codigo', t.destino_codigo,
                    'partida_em', t.partida_em, 'chegada_em', t.chegada_em,
                    'partida_fuso', t.partida_fuso, 'chegada_fuso', t.chegada_fuso,
                    'companhia', t.companhia, 'numero', t.numero, 'localizador', t.localizador,
                    'terminal_partida', t.terminal_partida, 'terminal_chegada', t.terminal_chegada,
                    'classe', t.classe, 'bagagem', t.bagagem, 'assento', t.assento,
                    'checkin_abre_em', t.checkin_abre_em,
                    'ponto_encontro', t.ponto_encontro, 'contato', t.contato, 'endereco', t.endereco,
                    'observacoes', t.observacoes,
                    'documento_id', t.documento_id)
                    order by t.partida_em nulls last), '[]'::jsonb)
                  from rel_viagem_trechos t where t.viagem_id = v.id),
    'documentos', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', d.id, 'tipo', d.tipo, 'descricao', d.descricao,
                    'arquivo_nome', d.arquivo_nome, 'mime', d.mime, 'validade', d.validade,
                    'meu', d.cliente_id = c)
                    order by d.tipo, d.enviado_em desc), '[]'::jsonb)
                  from rel_documentos d
                 where d.arquivo_path is not null
                   and coalesce(d.status, '') <> 'recusado'
                   and ((d.viagem_id = v.id and (d.cliente_id is null or d.cliente_id = c))
                        or (d.cliente_id = c and d.viagem_id is null
                            and d.tipo in ('passaporte', 'rg_cnh', 'vacina', 'foto')))),
    'itens', itens,
    'expedicao', expd
  );
  return r;
end $$;

-- Caminho do arquivo de um documento que o cliente pode baixar (o app gera a URL assinada).
create or replace function app_cliente_documento_path(p_documento uuid, p_cliente uuid default null)
returns text
language sql stable security definer set search_path = public
as $$
  with c as (select app_cliente_efetivo(p_cliente) id)
  select d.arquivo_path
    from rel_documentos d, c
   where d.id = p_documento
     and c.id is not null
     and coalesce(d.status, '') <> 'recusado'
     and (d.cliente_id = c.id
          or (d.cliente_id is null and d.viagem_id in (select app_cliente_viagem_ids(c.id))))
$$;

-- Marca o último acesso (só pro login próprio, B).
create or replace function app_cliente_registrar_acesso()
returns void
language sql volatile security definer set search_path = public
as $$
  update app_cliente_acessos set ultimo_acesso_em = now()
   where auth_user_id = auth.uid() and bloqueado_em is null
$$;

-- Permissões: nada pra anon. authenticated (cliente com login, B) e service_role (servidor, A).
revoke all on function app_cliente_id() from public, anon;
revoke all on function app_eh_cliente() from public, anon;
revoke all on function app_cliente_efetivo(uuid) from public, anon, authenticated;
revoke all on function app_cliente_viagem_ids(uuid) from public, anon, authenticated;
revoke all on function app_cliente_minhas_viagens(uuid) from public, anon;
revoke all on function app_cliente_viagem(uuid, uuid) from public, anon;
revoke all on function app_cliente_documento_path(uuid, uuid) from public, anon;
revoke all on function app_cliente_registrar_acesso() from public, anon;
grant execute on function app_cliente_id() to authenticated, service_role;
grant execute on function app_eh_cliente() to authenticated, service_role;
grant execute on function app_cliente_efetivo(uuid) to service_role;
grant execute on function app_cliente_viagem_ids(uuid) to service_role;
grant execute on function app_cliente_minhas_viagens(uuid) to authenticated, service_role;
grant execute on function app_cliente_viagem(uuid, uuid) to authenticated, service_role;
grant execute on function app_cliente_documento_path(uuid, uuid) to authenticated, service_role;
grant execute on function app_cliente_registrar_acesso() to authenticated;
-- Obs.: app_cliente_efetivo e app_cliente_viagem_ids são chamadas DENTRO das funções
-- security definer (rodam como dono), então não precisam de grant pra authenticated.

-- Arquivos: cliente com login próprio (B) baixa só o que app_cliente_documento_path libera.
-- A checagem fica numa função security definer porque a barreira (parte 4) impede o
-- cliente de ler rel_documentos direto — um subselect na policy voltaria sempre vazio.
create or replace function app_cliente_pode_baixar(p_path text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from rel_documentos d
     where d.arquivo_path = p_path
       and app_cliente_documento_path(d.id) is not null
  )
$$;
revoke all on function app_cliente_pode_baixar(text) from public, anon;
grant execute on function app_cliente_pode_baixar(text) to authenticated;

drop policy if exists app_cliente_docs_ler on storage.objects;
create policy app_cliente_docs_ler on storage.objects
  for select to authenticated
  using (
    bucket_id = 'rel-documentos'
    and (select app_eh_cliente())
    and app_cliente_pode_baixar(name)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Barreira: cliente com login (B) não lê nem grava NENHUMA tabela direto
-- ─────────────────────────────────────────────────────────────────────────────
-- Policy RESTRITIVA (entra em AND com as que já existem): pra equipe é sempre verdadeira,
-- então nada muda pro time. Pra quem é cliente, fecha tudo — inclusive as policies antigas
-- com `true` (qs_meetings, qs_users, qs_settings, qs_cadence_*, inserts de qs_leads/qs_notes/
-- qs_tasks/qs_whatsapp_messages, gloria_*, bitrix_fields…). Tabelas criadas DEPOIS desta
-- migration não ganham a barreira sozinhas: rodar este bloco de novo ou copiar a policy.
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists app_cliente_barreira on public.%I', t.relname);
    execute format(
      'create policy app_cliente_barreira on public.%I as restrictive for all to authenticated
         using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()))',
      t.relname);
  end loop;
end $$;

-- app_cliente_acessos: o cliente lê a própria linha (pra o app saber que está ligado).
-- A barreira acima também pegou esta tabela; por isso a leitura do cliente é feita
-- pela função app_cliente_id(), não por select direto.

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (rodar à mão se precisar desfazer):
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies where schemaname='public' and policyname='app_cliente_barreira'
--   loop execute format('drop policy app_cliente_barreira on public.%I', t.tablename); end loop; end $$;
-- drop policy if exists app_cliente_docs_ler on storage.objects;
-- drop function if exists app_cliente_pode_baixar(text), app_cliente_registrar_acesso(), app_cliente_documento_path(uuid, uuid),
--   app_cliente_viagem(uuid, uuid), app_cliente_minhas_viagens(uuid), app_cliente_viagem_ids(uuid),
--   app_cliente_efetivo(uuid), app_eh_cliente(), app_cliente_id();
-- drop table if exists app_cliente_acessos;
