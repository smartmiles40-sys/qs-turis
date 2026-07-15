-- 0014_fix_transfer_rls.sql
-- Conserta a TRANSFERÊNCIA de lead entre SDRs.
--
-- Sintoma: ao transferir, o Supabase devolvia
--   "new row violates row-level security policy for table qs_leads"
--
-- Causa: a policy de UPDATE do qs_leads no banco AO VIVO tinha um WITH CHECK
-- restritivo (do tipo `owner_id = auth.uid()`), que exige que o lead CONTINUE
-- com quem editou. Reatribuir pra outro SDR muda o owner_id -> viola o WITH
-- CHECK -> erro. (Os arquivos 0007/0008 já traziam `with check (true)`, mas o
-- banco ficou com uma versão antiga/restritiva.)
--
-- Correção: WITH CHECK (true) = quem PODE editar a linha (o dono OU o gestor,
-- pelo USING) pode reatribuí-la. O isolamento continua no USING: SDR só mexe no
-- que é dele; gestor/admin mexe em tudo. A transferência também troca o dono das
-- TAREFAS do lead, então a mesma correção vale pra qs_tasks.
--
-- Idempotente: rodar 2x não quebra.
--
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor ->
--    New query -> cole este arquivo INTEIRO -> Run. Role até o fim pra conferir.

-- Helper (garante que existe; SECURITY DEFINER evita recursão de RLS).
create or replace function qs_is_manager()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and role in ('admin','gestor') and is_active
  );
$$;

-- LEADS: dono ou gestor pode editar (USING); e pode reatribuir pra outro (CHECK true).
drop policy if exists leads_update on qs_leads;
create policy leads_update on qs_leads for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid())
  with check (true);

-- TAREFAS: mesma regra (a transferência move as tarefas abertas junto).
drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid())
  with check (true);

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Depois de rodar, o with_check das duas linhas tem que aparecer "true":
select tablename, policyname, cmd, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('qs_leads', 'qs_tasks')
  and cmd = 'UPDATE'
order by tablename;
