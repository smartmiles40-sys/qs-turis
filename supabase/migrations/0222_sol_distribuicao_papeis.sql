-- 0222 — Solicitações já chegam com dono (distribuição automática) + papéis do setor
-- -----------------------------------------------------------------------------
-- Bruno, 29/10/2026: "quando chega uma solicitação no QS hoje não vai pra
-- ninguém e acaba tendo que ser distribuída manualmente; quero que já venha com
-- uma divisão automática". E: separar o que cada pessoa do setor faz (CX, CS e
-- Hunter no Relacionamento) e quais demandas são de cada uma.
--
--   • qs_users.papeis: papéis da pessoa DENTRO do setor ('cx','cs','hunter').
--   • qs_solicitacao_tipos.papel: qual papel recebe aquele tipo (null = o setor todo).
--   • qs_sol_distribuicao: liga/desliga por setor (começa só no Relacionamento).
--   • Gatilho BEFORE INSERT: pedido sem dono num setor ligado → RODÍZIO SIMPLES
--     (decisão do Bruno) entre as pessoas ATIVAS do papel; ninguém no papel →
--     rodízio entre os GESTORES do setor (ex.: Hunter, que ainda não tem gente).
--     Admin nunca entra no rodízio. Status continua 'nova' (a pessoa aceita).
--   • O aviso de pedido novo vai só pra quem recebeu (antes ia pro setor todo).
--   • Mapa inicial (proposta aprovada pelo Bruno): CX = Falar com o cliente,
--     Pegar documentos/dados e Outro; CS = Pós-venda/reclamação; Hunter = tipo
--     novo "Oportunidade de venda pra base". Mariane = CX, Laura = CS.
-- -----------------------------------------------------------------------------

-- 1) Papéis -------------------------------------------------------------------
alter table qs_users add column if not exists papeis text[] not null default '{}';
alter table qs_users drop constraint if exists qs_users_papeis_check;
alter table qs_users add constraint qs_users_papeis_check
  check (papeis <@ array['cx','cs','hunter']::text[]);

alter table qs_solicitacao_tipos add column if not exists papel text;
alter table qs_solicitacao_tipos drop constraint if exists qs_solicitacao_tipos_papel_check;
alter table qs_solicitacao_tipos add constraint qs_solicitacao_tipos_papel_check
  check (papel is null or papel in ('cx','cs','hunter'));

-- 2) Liga/desliga por setor + ponteiro do rodízio ------------------------------
create table if not exists qs_sol_distribuicao (
  setor        text primary key check (setor in ('comercial','relacionamento','financeiro','operacional')),
  ativo        boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references qs_users(id)
);
insert into qs_sol_distribuicao (setor, ativo) values
  ('relacionamento', true), ('comercial', false), ('financeiro', false), ('operacional', false)
on conflict (setor) do nothing;

-- Último que recebeu por fila (setor + papel); o próximo é o seguinte na ordem.
create table if not exists qs_sol_rodizio (
  fila         text primary key,            -- 'relacionamento:cx', 'relacionamento:*'
  ultimo_id    uuid references qs_users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

alter table qs_sol_distribuicao enable row level security;
alter table qs_sol_rodizio enable row level security;
drop policy if exists qs_sol_distribuicao_ler on qs_sol_distribuicao;
create policy qs_sol_distribuicao_ler on qs_sol_distribuicao for select to authenticated using (true);
-- Escrita só pela RPC abaixo; o rodízio só pelo gatilho (security definer).

-- Barreira do app do cliente (0210) nas tabelas novas.
drop policy if exists app_cliente_barreira on qs_sol_distribuicao;
create policy app_cliente_barreira on qs_sol_distribuicao as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists app_cliente_barreira on qs_sol_rodizio;
create policy app_cliente_barreira on qs_sol_rodizio as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));

-- 3) Quem recebe: próximo do rodízio --------------------------------------------
create or replace function qs_sol_proximo(p_setor text, p_papel text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fila  text;
  v_lista uuid[];
  v_ult   uuid;
  v_pos   int;
  v_prox  uuid;
begin
  -- Pessoas do papel (ou do setor todo, se o tipo não tem papel). Sem admin/marketing.
  select array_agg(id order by name, id) into v_lista
    from qs_users
   where is_active and role not in ('admin','marketing')
     and p_setor = any(coalesce(setores, '{}'))
     and (p_papel is null or p_papel = any(papeis));
  v_fila := p_setor || ':' || coalesce(p_papel, '*');

  -- Ninguém no papel → gestores do setor.
  if coalesce(array_length(v_lista, 1), 0) = 0 and p_papel is not null then
    select array_agg(id order by name, id) into v_lista
      from qs_users
     where is_active and role = 'gestor' and p_setor = any(coalesce(setores, '{}'));
    v_fila := p_setor || ':' || p_papel || ':gestores';
  end if;
  if coalesce(array_length(v_lista, 1), 0) = 0 then return null; end if;

  insert into qs_sol_rodizio (fila) values (v_fila) on conflict (fila) do nothing;
  select ultimo_id into v_ult from qs_sol_rodizio where fila = v_fila for update;
  v_pos := array_position(v_lista, v_ult);
  v_prox := v_lista[case when v_pos is null or v_pos >= array_length(v_lista, 1) then 1 else v_pos + 1 end];
  update qs_sol_rodizio set ultimo_id = v_prox, atualizado_em = now() where fila = v_fila;
  return v_prox;
end $$;
revoke all on function qs_sol_proximo(text, text) from public, anon, authenticated;

-- 4) Gatilhos --------------------------------------------------------------------
create or replace function qs_sol_distribuir()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_papel text;
begin
  if new.responsavel_id is not null or new.status <> 'nova' then return new; end if;
  if not exists (select 1 from qs_sol_distribuicao where setor = new.para_setor and ativo) then return new; end if;
  select papel into v_papel from qs_solicitacao_tipos where id = new.tipo_id;
  new.responsavel_id := qs_sol_proximo(new.para_setor, v_papel);
  return new;
exception when others then
  -- A distribuição nunca impede o pedido de nascer: sem dono, o gestor vê.
  raise warning '[qs_sol_distribuir] %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_qs_sol_distribuir on qs_solicitacoes;
create trigger trg_qs_sol_distribuir before insert on qs_solicitacoes
  for each row execute function qs_sol_distribuir();

-- Histórico: "Distribuída automaticamente para Fulana".
create or replace function qs_sol_distribuida_evento()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel_id is not null and new.status = 'nova' then
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
    select new.id, 'passada', u.name, 'Distribuída automaticamente (rodízio).', 'QS'
      from qs_users u where u.id = new.responsavel_id;
  end if;
  return null;
exception when others then
  raise warning '[qs_sol_distribuida_evento] %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_qs_sol_distribuida_evento on qs_solicitacoes;
create trigger trg_qs_sol_distribuida_evento after insert on qs_solicitacoes
  for each row execute function qs_sol_distribuida_evento();

-- Aviso de pedido novo: com dono, só o dono recebe; sem dono, o setor todo (como antes).
create or replace function public.qs_avisos_sol_nova()
returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare
  u uuid;
  v_titulo text;
  v_texto text;
begin
  begin
    v_titulo := case when new.prioridade = 'urgente' then 'URGENTE · ' when new.prioridade = 'alta' then 'Alta · ' else '' end
             || 'Nova solicitação #' || new.numero || case when new.de_setor = 'operacional' then ' de ' else ' do ' end || qs_avisos_nome_setor(new.de_setor);
    v_texto := new.titulo || coalesce(' — ' || new.sobre_nome, '');
    for u in
      select new.responsavel_id where new.responsavel_id is not null
      union all
      select r from qs_avisos_recebedores(new.para_setor) r where new.responsavel_id is null
    loop
      continue when u = new.criado_por;
      perform qs_aviso_criar(u, 'solicitacao', new.para_setor, v_titulo, v_texto,
        qs_avisos_link_sol(new.para_setor, u, new.id), 'qs_solicitacoes', new.id::text, 'sol_nova:' || new.id);
    end loop;
  exception when others then
    raise warning '[qs_avisos] pedido novo %: %', new.id, sqlerrm;
  end;
  return null;
end $function$;

-- 5) Gestão: papéis da pessoa, papel do tipo, liga/desliga ----------------------
create or replace function qs_sol_definir_papeis(p_user uuid, p_papeis text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_setores text[];
begin
  select setores into v_setores from qs_users where id = p_user;
  if v_setores is null then raise exception 'Pessoa não encontrada.'; end if;
  if not exists (
    select 1 from qs_users g where g.id = auth.uid() and g.is_active
       and (g.role = 'admin' or (g.role = 'gestor' and g.setores && v_setores))
  ) then raise exception 'Só a gestão do setor muda os papéis.'; end if;
  update qs_users set papeis = coalesce(p_papeis, '{}') where id = p_user;
end $$;
revoke all on function qs_sol_definir_papeis(uuid, text[]) from public, anon;
grant execute on function qs_sol_definir_papeis(uuid, text[]) to authenticated;

create or replace function qs_sol_definir_distribuicao(p_setor text, p_ativo boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from qs_users g where g.id = auth.uid() and g.is_active
       and (g.role = 'admin' or (g.role = 'gestor' and p_setor = any(g.setores)))
  ) then raise exception 'Só a gestão do setor liga a distribuição.'; end if;
  update qs_sol_distribuicao set ativo = p_ativo, atualizado_em = now(), atualizado_por = auth.uid() where setor = p_setor;
end $$;
revoke all on function qs_sol_definir_distribuicao(text, boolean) from public, anon;
grant execute on function qs_sol_definir_distribuicao(text, boolean) to authenticated;
-- O papel do tipo é editado em "Tipos e prazos", pela mesma escrita que já edita os tipos.

-- 6) Mapa inicial do Relacionamento -----------------------------------------------
update qs_solicitacao_tipos set papel = 'cx'
 where setor = 'relacionamento' and rotulo in ('Falar com o cliente', 'Pegar documentos / dados do cliente', 'Outro');
update qs_solicitacao_tipos set papel = 'cs'
 where setor = 'relacionamento' and rotulo = 'Pós-venda / reclamação';
insert into qs_solicitacao_tipos (setor, rotulo, ordem, prazo_horas, prazo_alta_horas, prazo_urgente_horas, papel, ativo)
select 'relacionamento', 'Oportunidade de venda pra base', 40, 24, 8, 4, 'hunter', true
 where not exists (select 1 from qs_solicitacao_tipos where setor = 'relacionamento' and rotulo = 'Oportunidade de venda pra base');

update qs_users set papeis = array['cx'] where name = 'Mariane | Relacionamento';
update qs_users set papeis = array['cs'] where name = 'Laura de Assunção | Relacionamento';

-- ROLLBACK (à mão):
-- drop trigger if exists trg_qs_sol_distribuir on qs_solicitacoes;
-- drop trigger if exists trg_qs_sol_distribuida_evento on qs_solicitacoes;
-- update qs_sol_distribuicao set ativo = false;   -- (ou drop das tabelas/funções novas)
-- e recriar qs_avisos_sol_nova como na 0196.
