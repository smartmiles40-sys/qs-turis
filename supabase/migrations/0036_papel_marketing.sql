-- =============================================================================
-- 0036 — Papel "marketing": vê tudo, não executa nada
-- =============================================================================
-- Espectador. Marketing precisa enxergar o funil inteiro pra medir campanha, mas
-- não pode concluir atividade, mexer em lead, agendar nem apagar coisa alguma.
--
-- POR QUE ISTO É UMA MIGRATION, e não só um `if` na tela: esconder o botão não
-- impede nada. Todo usuário logado fala com o PostgREST com o próprio token —
-- basta o DevTools pra mandar um PATCH. Se a regra não estiver no banco, ela não
-- existe. A tela some com o botão por educação; o banco é quem recusa.
--
-- DUAS PEÇAS, de propósito separadas:
--   1. LER  — uma policy de SELECT a mais por tabela. Policies permissivas são
--             somadas (OR), então isto libera a leitura sem tocar em NENHUMA
--             policy existente: zero risco de estragar o que já funciona.
--   2. ESCREVER — um gatilho que recusa INSERT/UPDATE/DELETE. Um só, em todas as
--             tabelas. Não depende de eu ter lembrado de ajustar 81 policies, e
--             continua valendo pra policy nova que alguém criar amanhã.
--
-- Idempotente.
-- =============================================================================

-- ── (1) O papel passa a existir ─────────────────────────────────────────────
do $$
declare c text;
begin
  select con.conname into c
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
   where rel.relname = 'qs_users'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%role%'
     and pg_get_constraintdef(con.oid) ilike '%gestor%';
  if c is not null then
    execute format('alter table qs_users drop constraint %I', c);
  end if;
end $$;

alter table qs_users
  add constraint qs_users_role_check
  check (role in ('admin', 'gestor', 'sdr', 'closer', 'marketing'));

-- ── (2) Quem é espectador ───────────────────────────────────────────────────
create or replace function qs_is_espectador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and role = 'marketing' and is_active
  );
$$;

grant execute on function qs_is_espectador() to authenticated;

-- ── (3) LER: uma policy de SELECT a mais em cada tabela qs_* ────────────────
-- Permissivas se somam. Não mexo em nada do que existe.
do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relname like 'qs\_%'
       and c.relrowsecurity           -- só onde RLS está ligada
     order by c.relname
  loop
    execute format(
      'drop policy if exists %I on %I',
      t || '_select_espectador', t
    );
    execute format(
      'create policy %I on %I for select to authenticated using (qs_is_espectador())',
      t || '_select_espectador', t
    );
    n := n + 1;
  end loop;
  raise notice '[0036] leitura liberada para marketing em % tabelas', n;
end $$;

-- ── (4) ESCREVER: o gatilho que recusa ──────────────────────────────────────
-- Mensagem em português e código 42501 (insufficient_privilege) — o front mostra
-- o texto direto pro usuário em vez de um erro de Postgres cru.
create or replace function qs_bloqueia_espectador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if qs_is_espectador() then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and c.relname like 'qs\_%'
     order by c.relname
  loop
    execute format('drop trigger if exists trg_%s_espectador on %I', t, t);
    execute format(
      'create trigger trg_%s_espectador before insert or update or delete on %I
       for each row execute function qs_bloqueia_espectador()', t, t
    );
    n := n + 1;
  end loop;
  raise notice '[0036] escrita bloqueada para marketing em % tabelas', n;
end $$;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
-- Depois de criar um usuário de marketing, logue com ele e tente:
--   select count(*) from qs_leads;      -- deve VER tudo
--   update qs_leads set full_name = 'x' where id = (select id from qs_leads limit 1);
--   -- deve falhar com "Perfil Marketing é somente leitura"
