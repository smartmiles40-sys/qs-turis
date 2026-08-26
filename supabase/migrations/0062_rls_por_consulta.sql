-- 0062_rls_por_consulta.sql
-- ---------------------------------------------------------------------------
-- A FILA PAROU DE CARREGAR, E O CULPADO ERA A RLS RODANDO POR LINHA.
--
-- Sintoma (26/08, de manhã): "Não consegui carregar a fila. Confira sua
-- conexão". Medido do lado de fora, na mesma consulta trivial
-- (`select id from qs_tasks limit 1`):
--
--   pela chave ANON (o que o navegador faz)  ...... 38.453 ms
--   pela chave SERVICE_ROLE (que ignora RLS) ......  3.244 ms
--
-- Não era rede, não era o QS, não era deploy. Era a RLS.
--
-- O PORQUÊ. Uma policy que chama `auth.uid()` ou uma função `STABLE` direto na
-- expressão é reavaliada A CADA LINHA. `qs_tasks` tem 40.062 linhas hoje, e a
-- leitura passava por:
--
--   ativo_qs_tasks (restritiva) ...... qs_is_active_user()      → 40.062 vezes
--   qs_tasks_select_espectador ....... qs_is_espectador()       → 40.062 vezes
--   tasks_select ..................... qs_is_manager()          → 40.062 vezes
--                                      qs_is_closer()           → 40.062 vezes
--                                      auth.uid()               → 40.062 vezes
--                                      + subconsulta em qs_leads por linha
--
-- São duas policies PERMISSIVAS de SELECT na mesma tabela, e as duas são
-- avaliadas sempre (permissivas se somam com OR). Umas 200 mil chamadas de
-- função para devolver uma linha.
--
-- E PIORA SOZINHO. Entram ~120 leads por dia, e cada um vira tarefa. O dia em
-- que a conta estourou não foi um dia diferente dos outros: foi só a tabela
-- passando do tamanho que o banco aguentava fazer essa conta.
--
-- O CONSERTO. `(select f())` em vez de `f()`. O Postgres reconhece que a
-- subconsulta não depende da linha, resolve UMA VEZ (InitPlan) e reusa. As
-- cinco funções envolvidas são todas STABLE (conferido em pg_proc), então o
-- resultado é idêntico — muda quando é avaliado, não o que é avaliado.
--
-- E as duas policies de SELECT viram UMA, com OR entre as condições. Permissiva
-- + permissiva já era OR; escrever assim só evita percorrer a tabela duas vezes.
--
-- O QUE ESTE ARQUIVO NÃO MUDA: quem enxerga o quê. Nenhuma condição foi
-- afrouxada nem apertada. Compare com `select policyname, qual from pg_policies`
-- antes e depois — as expressões são as mesmas, só embrulhadas.
--
-- APLICADA EM 26/08, em TRÊS partes. A primeira tentativa, com tudo junto,
-- morreu em 'deadlock detected': a alteração precisa de AccessExclusiveLock na
-- tabela e havia leitura longa segurando AccessShareLock. A transação inteira
-- voltou atrás sozinha (nada ficou pela metade), e em pedaços menores, com
-- lock_timeout de 5s, passou. Se for recolar num banco carregado, cole tabela
-- por tabela — e espere entre uma e outra, porque cada DDL faz o PostgREST
-- recarregar o cache de schema e é isso que devolve PGRST002 enquanto ele não
-- consegue.
--
-- MEDIDO DEPOIS: 'select id from qs_tasks limit 1' pela chave anon saiu de
-- 38.453 ms (pico) / ~1.000 ms (melhor caso) para 206 a 466 ms, estável.
--
-- PARA REVERTER: as definições antigas estão no rodapé, comentadas.
-- ---------------------------------------------------------------------------

-- ── qs_tasks (40.062 linhas — é a fila) ────────────────────────────────────

drop policy if exists ativo_qs_tasks on qs_tasks;
create policy ativo_qs_tasks on qs_tasks
  as restrictive for all to authenticated
  using ((select qs_is_active_user()))
  with check ((select qs_is_active_user()));

-- As duas de SELECT viram uma só.
drop policy if exists qs_tasks_select_espectador on qs_tasks;
drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks
  for select to authenticated
  using (
    (select qs_is_espectador())
    or (select qs_is_manager())
    or (select qs_is_closer())
    or owner_id = (select auth.uid())
    -- Esta subconsulta é CORRELACIONADA de verdade (depende do lead_id da
    -- linha), então continua por linha. O `auth.uid()` de dentro dela, não.
    or exists (
      select 1 from qs_leads l
       where l.id = qs_tasks.lead_id
         and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks
  for update to authenticated
  using (
    (select qs_is_manager())
    or owner_id = (select auth.uid())
    or owner_id is null
  )
  with check (true);

drop policy if exists tasks_delete on qs_tasks;
create policy tasks_delete on qs_tasks
  for delete to authenticated
  using ((select qs_is_manager()) or owner_id = (select auth.uid()));

-- A chave estrangeira `cadence_id` não tinha índice. Toda vez que se olha as
-- tarefas de uma cadência (e o encerramento de cadência faz isso), varria as
-- 40 mil linhas.
create index if not exists idx_qs_tasks_cadence_id on qs_tasks(cadence_id);

-- ── qs_notes (18.330 linhas) ───────────────────────────────────────────────

drop policy if exists ativo_qs_notes on qs_notes;
create policy ativo_qs_notes on qs_notes
  as restrictive for all to authenticated
  using ((select qs_is_active_user()))
  with check ((select qs_is_active_user()));

drop policy if exists qs_notes_select_espectador on qs_notes;
drop policy if exists notes_select on qs_notes;
create policy notes_select on qs_notes
  for select to authenticated
  using (
    (select qs_is_espectador())
    or (select qs_is_manager())
    or (select qs_is_closer())
    or exists (
      select 1 from qs_leads l
       where l.id = qs_notes.lead_id
         and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists notes_update on qs_notes;
create policy notes_update on qs_notes
  for update to authenticated
  using ((select qs_is_manager()) or author_id = (select auth.uid()))
  with check (true);

drop policy if exists notes_delete on qs_notes;
create policy notes_delete on qs_notes
  for delete to authenticated
  using ((select qs_is_manager()) or author_id = (select auth.uid()));

-- ── qs_wa_messages (20.722 linhas — a conversa) ────────────────────────────
--
-- `qs_owns_lead(lead_id)` recebe a coluna da linha, então É correlacionada e
-- continua por linha: não dá pra hoistar sem mudar o significado. O que dá é
-- parar de varrer a tabela duas vezes, juntando as duas permissivas.

drop policy if exists qs_wa_messages_select_espectador on qs_wa_messages;
drop policy if exists wa_messages_select on qs_wa_messages;
create policy wa_messages_select on qs_wa_messages
  for select to authenticated
  using ((select qs_is_espectador()) or qs_owns_lead(lead_id));

-- ── Conferência depois de colar ────────────────────────────────────────────
--   select policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename in ('qs_tasks','qs_notes','qs_wa_messages')
--    order by tablename, cmd;
--
-- E o teste que importa, de fora, com a chave anon:
--   time curl -s "$SUPABASE_URL/rest/v1/qs_tasks?select=id&limit=1" -H "apikey: $ANON"
--   Antes: 38 s no pico, ~1 s no melhor caso. Esperado depois: dezenas de ms.

-- ---------------------------------------------------------------------------
-- COMO ERA ANTES (para reverter, se precisar):
--
-- ativo_qs_tasks:  using/check  qs_is_active_user()
-- qs_tasks_select_espectador (SELECT):  qs_is_espectador()
-- tasks_select (SELECT):
--   qs_is_manager() OR qs_is_closer() OR owner_id = auth.uid()
--   OR EXISTS (select 1 from qs_leads l where l.id = qs_tasks.lead_id and l.owner_id = auth.uid())
-- tasks_update (UPDATE):  qs_is_manager() OR owner_id = auth.uid() OR owner_id IS NULL  / check true
-- tasks_delete (DELETE):  qs_is_manager() OR owner_id = auth.uid()
--
-- ativo_qs_notes:  using/check  qs_is_active_user()
-- qs_notes_select_espectador (SELECT):  qs_is_espectador()
-- notes_select (SELECT):
--   qs_is_manager() OR qs_is_closer()
--   OR EXISTS (select 1 from qs_leads l where l.id = qs_notes.lead_id and l.owner_id = auth.uid())
-- notes_update (UPDATE):  qs_is_manager() OR author_id = auth.uid()  / check true
-- notes_delete (DELETE):  qs_is_manager() OR author_id = auth.uid()
--
-- qs_wa_messages_select_espectador (SELECT):  qs_is_espectador()
-- wa_messages_select (SELECT):  qs_owns_lead(lead_id)
-- ---------------------------------------------------------------------------
