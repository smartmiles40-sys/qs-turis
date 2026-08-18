-- 0052_closer_le_o_lead.sql
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ACONTECENDO
--
-- A 0050 deu ao closer o direito de ver e responder QUALQUER conversa de
-- WhatsApp (qs_wa_threads / qs_wa_messages passam por qs_owns_lead, que ganhou
-- o ramo qs_is_closer()). Mas as tabelas de CONTEXTO ficaram na regra da 0007,
-- escrita quando só existiam SDR e gestor:
--
--   using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
--
-- Resultado medido em 18/08: o closer abre a aba de WhatsApp, a conversa
-- aparece — e o cliente não. A lista mostra linha após linha só com a palavra
-- "Lead", sem nome, sem telefone, porque o embed de qs_leads volta vazio. Foi
-- exatamente a reclamação dos especialistas ("não aparecem os leads que eu
-- estava falando no ChatApp"): os leads ESTÃO lá, a RLS é que os apagava da
-- tela. O mesmo vale pro card da agenda sem informação — as notas do SDR
-- existiam no banco o tempo todo.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Acrescenta qs_is_closer() às políticas de LEITURA de lead, nota, tarefa,
-- reunião e valores de campo custom. Só SELECT: escrever continua exigindo ser
-- dono ou gestão, então o closer não pode reatribuir nem apagar o lead de
-- ninguém. Nada é removido de quem já tinha acesso.
--
-- POR QUE ABRIR POR PAPEL, E NÃO SÓ "OS LEADS DAS MINHAS REUNIÕES"
--
-- Decisão do Bruno em 18/08 ("abre por papel mesmo, os closers precisam
-- responder hoje"): um cliente escreve antes de a reunião existir, e quem
-- está online atende. Amarrar a leitura à reunião recriaria o mesmo buraco no
-- dia seguinte. São 2 pessoas, ambas com acesso a tudo no Bitrix.
--
-- PARA REVERTER: rode de novo a 0007 (ela faz drop/create das mesmas
-- políticas, com os mesmos nomes, sem o ramo do closer).
-- ---------------------------------------------------------------------------

-- Lead: sem isto, o closer vê a conversa sem saber de quem ela é.
drop policy if exists leads_select on qs_leads;
create policy leads_select on qs_leads for select to authenticated
  using (qs_is_manager() or qs_is_closer() or owner_id = auth.uid() or owner_id is null);

-- Tarefas: é onde nasce a cobrança "registre o desfecho da reunião". Sem
-- leitura, a cobrança existe no banco e nunca chega na tela de quem deve agir.
drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks for select to authenticated
  using (qs_is_manager() or qs_is_closer() or owner_id = auth.uid() or owner_id is null);

-- Reuniões: o closer já enxergava as próprias por owner_id em alguns casos,
-- mas quem agenda é o SDR — o dono da linha é ELE, não o especialista.
drop policy if exists meetings_select on qs_meetings;
create policy meetings_select on qs_meetings for select to authenticated
  using (qs_is_manager() or qs_is_closer() or owner_id = auth.uid() or owner_id is null);

-- Notas: o resumo do que o SDR conversou. É o que evita perguntar duas vezes.
drop policy if exists notes_select on qs_notes;
create policy notes_select on qs_notes for select to authenticated
  using (
    qs_is_manager()
    or qs_is_closer()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- Campos personalizados do lead (orçamento, destino, quantas pessoas…).
drop policy if exists lcv_select on qs_lead_custom_values;
create policy lcv_select on qs_lead_custom_values for select to authenticated
  using (
    qs_is_manager()
    or qs_is_closer()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- CONFERÊNCIA (logado como Bruno Matheus ou Talita, no SQL editor):
--   select qs_is_closer();                                  -- true
--   select count(*) from qs_leads;                          -- passa de dezenas para milhares
--   select count(*) from qs_notes;                          -- > 0
--   select count(*) from qs_tasks where status = 'pendente';-- inclui as cobranças de desfecho
