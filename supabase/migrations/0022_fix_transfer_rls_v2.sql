-- 0022_fix_transfer_rls_v2.sql
-- Reaplica (e blinda) o conserto da TRANSFERÊNCIA de lead entre SDRs.
--
-- Sintoma (voltou 2026-07-22): ao transferir de um SDR pra outro:
--   "new row violates row-level security policy for table qs_leads"
--
-- Causa: a policy de UPDATE do qs_leads/qs_tasks no banco AO VIVO está SEM
-- `with check (true)`. Sem WITH CHECK explícito, o Postgres usa como default a
-- expressão do USING (que exige `owner_id = auth.uid()`). Ao reatribuir pra OUTRO
-- SDR, o novo owner_id ≠ quem edita → o WITH CHECK barra → erro. (TODOS os
-- arquivos de migration já trazem `with check (true)`; foi o banco que divergiu —
-- versão antiga da policy sobreviveu, ou a 0014 não chegou a ser aplicada.)
--
-- Correção: WITH CHECK (true) = quem PODE editar a linha (dono OU gestor, pelo
-- USING) pode reatribuí-la. O isolamento continua no USING (SDR só mexe no que é
-- dele; gestor/admin em tudo). A mesma regra vale pra qs_tasks (a transferência
-- move as tarefas abertas junto).
--
-- Idempotente. Rode o arquivo INTEIRO no SQL Editor do projeto eabfjomrnucymduqnbci
-- (Supabase → SQL Editor → New query → cole tudo → Run). Role até o fim.

-- ── (0) ANTES: fotografe o estado atual ──────────────────────────────────────
-- Nas linhas de cmd = UPDATE, o with_check TEM de virar "true" depois do fix.
select 'ANTES' as quando, tablename, policyname, cmd, permissive,
       qual as using_expr, with_check
from pg_policies
where schemaname = 'public' and tablename in ('qs_leads', 'qs_tasks')
order by tablename, cmd, policyname;

-- ── (1) Helpers (garante que existem; SECURITY DEFINER evita recursão de RLS) ──
create or replace function qs_is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and role in ('admin','gestor') and is_active
  );
$$;

-- ── (2) Recria as policies de UPDATE com WITH CHECK (true) ────────────────────
drop policy if exists leads_update on qs_leads;
create policy leads_update on qs_leads for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true);

drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true);

-- ── (3) Rede de segurança: remove QUALQUER OUTRA policy de UPDATE/ALL nessas
--        tabelas cujo check trave a troca de owner_id (versão antiga, ou criada
--        à mão pela UI do Supabase). NÃO toca nas restritivas de perfil ativo
--        (ativo_*, cujo check é qs_is_active_user() — sem owner_id). ────────────
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('qs_leads', 'qs_tasks')
      and cmd in ('UPDATE', 'ALL')
      and policyname not in ('leads_update', 'tasks_update')
      and ( coalesce(with_check, '') ilike '%owner_id%'
            or (permissive = 'RESTRICTIVE' and coalesce(qual, '') ilike '%owner_id%') )
  loop
    execute format('drop policy if exists %I on %I', p.policyname, p.tablename);
    raise notice 'Removida policy antiga que travava a transferencia: % em %', p.policyname, p.tablename;
  end loop;
end $$;

-- ── (4) DEPOIS: confirme. As linhas UPDATE devem mostrar with_check = true ────
select 'DEPOIS' as quando, tablename, policyname, cmd, permissive, with_check
from pg_policies
where schemaname = 'public' and tablename in ('qs_leads', 'qs_tasks') and cmd = 'UPDATE'
order by tablename, policyname;
