-- 0039_transferencia_entre_sdrs.sql
-- ---------------------------------------------------------------------------
-- O SDR não conseguia passar lead pra outro SDR.
--
--   new row violates row-level security policy for table "qs_leads"
--
-- "new row violates" é sempre a cláusula WITH CHECK. A policy de UPDATE em
-- qs_leads exigia que a linha RESULTANTE continuasse sendo do próprio usuário —
-- e transferir é, por definição, deixar de ser dono. Então editar o lead
-- funcionava e só a transferência quebrava, o que fazia o erro parecer aleatório.
--
-- Reproduzido em 05/08 com dois SDRs temporários, sob RLS:
--   trocar o dono (A → B) ....... 403  42501
--   registrar o handover ........ 201
--   reatribuir as tarefas ....... 204
--   renomear o próprio lead ..... 204
--
-- Ou seja: as OUTRAS duas escritas da transferência já passavam. Só faltava
-- esta, e sem ela o lead ficava com as tarefas do novo dono e a posse do antigo.
--
-- Detalhe importante: TODAS as versões versionadas desta policy (0007, 0008,
-- 0014, 0022 e o APLICAR-ISOLAMENTO-SDR) já usam `with check (true)`. O banco
-- estava com uma versão mais antiga do que o repositório — sinal de que uma
-- dessas migrations nunca foi colada. Esta aqui é idempotente e fecha o assunto.
--
-- Por que não `with check (true)` seco: aproveitando a correção, o novo dono
-- passa a precisar ser um usuário ATIVO. Isso impede dois acidentes que o
-- `true` deixava passar — mandar o lead pra um id inexistente (some da fila de
-- todo mundo) ou pra alguém desativado (fila de um ex-funcionário).
-- ---------------------------------------------------------------------------

begin;

drop policy if exists leads_update on qs_leads;

create policy leads_update on qs_leads for update to authenticated
  -- QUEM pode mexer: gestor, o dono, ou lead sem dono (órfão a distribuir).
  using (
    qs_is_manager()
    or owner_id = auth.uid()
    or owner_id is null
  )
  -- COMO pode ficar: gestor faz o que quiser; os demais podem entregar o lead
  -- a qualquer usuário ATIVO (é a transferência) ou manter como está.
  with check (
    qs_is_manager()
    or owner_id = auth.uid()
    or exists (
      select 1 from qs_users u
       where u.id = qs_leads.owner_id
         and u.is_active
    )
  );

commit;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
-- Depois de rodar, isto tem que devolver a policy com o WITH CHECK novo:
--
--   select polname,
--          pg_get_expr(polqual,      polrelid) as usando,
--          pg_get_expr(polwithcheck, polrelid) as checando
--     from pg_policy
--    where polrelid = 'qs_leads'::regclass and polname = 'leads_update';
--
-- E o teste de verdade é na tela: um SDR abre um lead dele e transfere pra
-- outro SDR. Tem que sumir da fila dele e aparecer na do colega, com as
-- atividades pendentes junto.
