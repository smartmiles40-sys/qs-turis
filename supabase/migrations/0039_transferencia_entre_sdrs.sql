-- 0039_transferencia_entre_sdrs.sql
-- ---------------------------------------------------------------------------
-- O SDR não conseguia passar lead pra outro SDR:
--
--   new row violates row-level security policy for table "qs_leads"
--
-- "new row violates" é sempre a cláusula WITH CHECK. A policy de UPDATE em
-- qs_leads exigia que a linha RESULTANTE continuasse sendo do próprio usuário —
-- e transferir é, por definição, deixar de ser dono. Por isso EDITAR o lead
-- funcionava e só a transferência quebrava, o que fazia o erro parecer aleatório.
--
-- Reproduzido com dois SDRs temporários, sob RLS:
--   trocar o dono (A → B) ....... 403  42501
--   registrar o handover ........ 201
--   reatribuir as tarefas ....... 204
--   renomear o próprio lead ..... 204
--
-- As outras duas escritas da transferência já passavam. Sem esta, o lead
-- terminava com as tarefas do novo dono e a posse do antigo.
--
-- ⚠️ SEGUNDA VERSÃO. A primeira fazia o teste de "usuário ativo" com um
-- `exists (select 1 from qs_users where id = qs_leads.owner_id ...)` dentro do
-- WITH CHECK. Duas fragilidades num lugar só: referência à tabela alvo de dentro
-- de subconsulta, e — pior — a subconsulta roda sob o RLS de qs_users, então
-- bastava a policy de leitura mudar pra transferência voltar a ser recusada, com
-- a MESMA mensagem, sem nada indicando a causa.
--
-- Agora o teste mora numa função SECURITY DEFINER: uma linha, sem subconsulta
-- na policy e sem depender de quem enxerga quem.
-- ---------------------------------------------------------------------------

begin;

-- Quem pode RECEBER um lead: qualquer usuário ativo do QS.
-- SECURITY DEFINER de propósito — a checagem não pode depender do RLS de
-- qs_users, senão a policy passa a responder a uma regra que não é dela.
create or replace function qs_pode_receber_lead(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
     and exists (select 1 from qs_users u where u.id = p_user and u.is_active);
$$;

grant execute on function qs_pode_receber_lead(uuid) to authenticated;

drop policy if exists leads_update on qs_leads;

create policy leads_update on qs_leads for update to authenticated
  -- QUEM pode mexer na linha: gestor, o dono atual, ou lead órfão (a distribuir).
  using (
    qs_is_manager()
    or owner_id = auth.uid()
    or owner_id is null
  )
  -- COMO a linha pode FICAR. `owner_id` aqui é o da linha NOVA:
  --   • gestor faz o que quiser;
  --   • manter o lead consigo (edição comum);
  --   • entregar a qualquer usuário ATIVO — que é a transferência.
  -- O `qs_pode_receber_lead` barra os dois acidentes que um `with check (true)`
  -- deixava passar: mandar pra um id inexistente (o lead some da fila de todo
  -- mundo) e mandar pra alguém desativado (fila de ex-funcionário).
  with check (
    qs_is_manager()
    or owner_id = auth.uid()
    or qs_pode_receber_lead(owner_id)
  );

commit;

-- ── CONFERÊNCIA — rode isto DEPOIS, na mesma aba ───────────────────────────
-- Tem que devolver UMA linha, e a coluna `checando` precisa mencionar
-- qs_pode_receber_lead. Se vier vazio ou sem isso, a migration não entrou.
--
--   select polname                                   as policy,
--          pg_get_expr(polqual,      polrelid)       as usando,
--          pg_get_expr(polwithcheck, polrelid)       as checando
--     from pg_policy
--    where polrelid = 'qs_leads'::regclass
--      and polname  = 'leads_update';
