-- 0015_task_history_visibility.sql
-- TRANSFERÊNCIA COM HISTÓRICO (decisão do Bruno, auditoria 2026-07-16).
--
-- Problema: ao transferir um lead, só as tarefas ABERTAS mudam de dono. As
-- concluídas ficam com o dono antigo e a RLS as esconde do novo SDR — o lead
-- "renasce" como Novo (com alerta de SEM CONTATO), mesmo com 4 tentativas feitas.
--
-- Solução: a VISIBILIDADE da tarefa segue o DONO DO LEAD (além do dono da
-- própria tarefa). Assim o novo SDR enxerga toda a jornada (histórico completo,
-- tentativa certa, sem "renascer" como novo), e o CRÉDITO do trabalho continua
-- de quem fez (owner_id da tarefa concluída não muda → placar/ranking intactos).
--
-- Idempotente: rodar 2x não quebra.
--
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New query
--    → cole este arquivo INTEIRO → Run.

drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks for select to authenticated
  using (
    qs_is_manager()
    or owner_id = auth.uid()
    -- histórico segue o lead: quem é dono do LEAD vê todas as tarefas dele
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
select policyname, cmd, qual::text from pg_policies
where schemaname = 'public' and tablename = 'qs_tasks' and cmd = 'SELECT';
