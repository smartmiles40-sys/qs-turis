-- 0229 — Menu por papel (CX / CS / Hunter): que painéis cada papel vê no menu
-- ESCRITA em 30/10/2026. NÃO APLICADA. Idempotente (pode rodar de novo).
-- -----------------------------------------------------------------------------
-- Bruno, 30/10: "o menu de cada pessoa mostra só os painéis do cargo dela, pra
-- quem está começando não se perder". Gestão e supervisão continuam vendo tudo,
-- e o gestor muda o mapa pela tela Time e cargos, sem código.
--
--   • qs_menu_setor: chave liga/desliga por setor. NASCE DESLIGADA: aplicar a
--     migration não muda o menu de ninguém; a gestora liga depois de ver a
--     pré-visualização "o menu dela fica assim".
--   • qs_menu_papel: itens do menu de cada papel (ids das telas: 'atendimento',
--     'grupos', 'campanhas'…). Sem linha = o padrão do código
--     (src/rel/equipe/menuPorPapel.ts, MENU_PADRAO).
--   • Escrita só pelas RPCs (admin ou gestor(a) do setor), mesma regra de
--     qs_sol_definir_papeis (0222).
--
-- Isto ESCONDE item de menu; não é trava de acesso. A tela continua abrindo
-- pelo link e pela grade "Outros painéis" (regra 3 da spec: ninguém perde acesso).
-- Depende da 0222 (papéis 'cx','cs','hunter').
-- -----------------------------------------------------------------------------

create table if not exists qs_menu_setor (
  setor          text primary key check (setor in ('comercial','relacionamento','financeiro','operacional')),
  por_papel      boolean not null default false,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references qs_users(id) on delete set null
);
insert into qs_menu_setor (setor, por_papel) values ('relacionamento', false)
on conflict (setor) do nothing;

create table if not exists qs_menu_papel (
  setor          text not null check (setor in ('comercial','relacionamento','financeiro','operacional')),
  papel          text not null check (papel in ('cx','cs','hunter')),
  itens          text[] not null default '{}',
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references qs_users(id) on delete set null,
  primary key (setor, papel)
);

alter table qs_menu_setor enable row level security;
alter table qs_menu_papel enable row level security;

drop policy if exists qs_menu_setor_ler on qs_menu_setor;
create policy qs_menu_setor_ler on qs_menu_setor for select to authenticated using (true);
drop policy if exists qs_menu_papel_ler on qs_menu_papel;
create policy qs_menu_papel_ler on qs_menu_papel for select to authenticated using (true);

-- Barreira do app do cliente (0210), como nas tabelas da 0222.
drop policy if exists app_cliente_barreira on qs_menu_setor;
create policy app_cliente_barreira on qs_menu_setor as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists app_cliente_barreira on qs_menu_papel;
create policy app_cliente_barreira on qs_menu_papel as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));

-- Quem pode mudar: admin, ou gestor(a) ativo(a) do setor.
create or replace function qs_menu_pode_gerir(p_setor text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users g
     where g.id = auth.uid() and g.is_active
       and (g.role = 'admin' or (g.role = 'gestor' and p_setor = any(coalesce(g.setores, '{}'))))
  );
$$;
revoke all on function qs_menu_pode_gerir(text) from public, anon;
grant execute on function qs_menu_pode_gerir(text) to authenticated;

-- Itens de um papel. p_itens null = apaga a linha (volta ao padrão do código).
create or replace function qs_menu_definir_papel(p_setor text, p_papel text, p_itens text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not qs_menu_pode_gerir(p_setor) then raise exception 'Só a gestão do setor muda o menu.'; end if;
  if p_papel not in ('cx','cs','hunter') then raise exception 'Papel inválido.'; end if;
  if p_itens is null then
    delete from qs_menu_papel where setor = p_setor and papel = p_papel;
    return;
  end if;
  insert into qs_menu_papel (setor, papel, itens, atualizado_em, atualizado_por)
  values (p_setor, p_papel, p_itens, now(), auth.uid())
  on conflict (setor, papel) do update
     set itens = excluded.itens, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function qs_menu_definir_papel(text, text, text[]) from public, anon;
grant execute on function qs_menu_definir_papel(text, text, text[]) to authenticated;

create or replace function qs_menu_ligar_por_papel(p_setor text, p_ligado boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not qs_menu_pode_gerir(p_setor) then raise exception 'Só a gestão do setor liga o menu por papel.'; end if;
  insert into qs_menu_setor (setor, por_papel, atualizado_em, atualizado_por)
  values (p_setor, coalesce(p_ligado, false), now(), auth.uid())
  on conflict (setor) do update
     set por_papel = excluded.por_papel, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function qs_menu_ligar_por_papel(text, boolean) from public, anon;
grant execute on function qs_menu_ligar_por_papel(text, boolean) to authenticated;

-- ROLLBACK (à mão; o front volta sozinho pro menu completo):
-- drop function if exists qs_menu_ligar_por_papel(text, boolean);
-- drop function if exists qs_menu_definir_papel(text, text, text[]);
-- drop function if exists qs_menu_pode_gerir(text);
-- drop table if exists qs_menu_papel;
-- drop table if exists qs_menu_setor;
-- (ou, só pra desligar: update qs_menu_setor set por_papel = false;)
