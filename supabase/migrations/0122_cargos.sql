-- 0122_cargos.sql
-- -----------------------------------------------------------------------------
-- CARGOS (Bruno, 14/10/2026: "um botão pra criar novos cargos, ainda mais
-- porque futuramente o financeiro vai dar o status das atividades no QS").
--
-- O PAPEL técnico (qs_users.role: admin/gestor/relacionamento/sdr…) continua
-- sendo o que libera acesso. O CARGO é o nome da função ("Pós-venda",
-- "Financeiro") e guarda uma lista de permissões pronta pro futuro — hoje
-- elas ainda NÃO travam nada.
--
-- Quem mexe: admin em qualquer cargo; gestor(a) do Relacionamento só nos
-- cargos dos setores relacionamento e financeiro. Atribuir cargo a uma pessoa
-- passa pelo /api/admin-user (que já trava a gestora no time dela).
-- -----------------------------------------------------------------------------

create table if not exists qs_cargos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(trim(nome)) between 2 and 60),
  setor      text not null check (setor in ('comercial', 'relacionamento', 'financeiro', 'operacional')),
  descricao  text,
  permissoes text[] not null default '{}',
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create unique index if not exists qs_cargos_nome_uq on qs_cargos (lower(trim(nome)));

alter table qs_users add column if not exists cargo_id uuid references qs_cargos(id) on delete set null;

-- Quem pode mexer num cargo deste setor?
create or replace function qs_pode_gerir_cargo(p_setor text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin'
            or (role = 'gestor' and 'relacionamento' = any(setores) and p_setor in ('relacionamento', 'financeiro')))
  );
$$;
grant execute on function qs_pode_gerir_cargo(text) to authenticated;

alter table qs_cargos enable row level security;
drop policy if exists qs_cargos_ler on qs_cargos;
drop policy if exists qs_cargos_criar on qs_cargos;
drop policy if exists qs_cargos_mudar on qs_cargos;
drop policy if exists qs_cargos_apagar on qs_cargos;
create policy qs_cargos_ler on qs_cargos for select to authenticated
  using (exists (select 1 from qs_users where id = auth.uid() and is_active));
create policy qs_cargos_criar on qs_cargos for insert to authenticated with check (qs_pode_gerir_cargo(setor));
create policy qs_cargos_mudar on qs_cargos for update to authenticated
  using (qs_pode_gerir_cargo(setor)) with check (qs_pode_gerir_cargo(setor));
create policy qs_cargos_apagar on qs_cargos for delete to authenticated using (qs_pode_gerir_cargo(setor));
grant select, insert, update, delete on qs_cargos to authenticated;

insert into qs_cargos (nome, setor, descricao) values
  ('Gestora de Relacionamento', 'relacionamento', 'Cuida do time e da configuração do pós-venda.'),
  ('Atendimento', 'relacionamento', 'Atende os clientes pelo WhatsApp e cuida das fichas.'),
  ('Pós-venda', 'relacionamento', 'Acompanha as viagens, documentos e pesquisas.'),
  ('Financeiro', 'financeiro', 'Vai dar o status financeiro das atividades (em breve).')
on conflict do nothing;
