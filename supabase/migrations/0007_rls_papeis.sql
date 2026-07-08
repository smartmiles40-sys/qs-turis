-- 0007_rls_papeis.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- SEGURANÇA (P0 da auditoria): permissões por PAPEL e por DONO.
--
-- Antes: qualquer usuário logado lia e escrevia TODAS as tabelas (policies
-- "using (true)"). O "SDR só vê os seus leads" era só filtro de tela.
-- Depois: admin/gestor veem tudo; SDR/closer só o que é dele (ou sem dono).
--
-- ⚠️ COMO APLICAR: cole este arquivo inteiro no SQL Editor do Supabase
--    (projeto eabfjomrnucymduqnbci) e rode 1x, de preferência fora do horário
--    de uso. Idempotente: rodar 2x não quebra.
-- ⚠️ As rotas /api (service_role) NÃO são afetadas — service_role ignora RLS.
-- ⚠️ Rollback de emergência no fim do arquivo (comentado).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: o usuário logado é gestor/admin? ─────────────────────────────────
-- SECURITY DEFINER evita recursão de RLS ao consultar qs_users de dentro
-- de uma policy de qs_users.
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

-- ═══ (1) Derruba as policies antigas "libera geral" ══════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'qs_users','qs_leads','qs_loss_reasons','qs_notes','qs_tasks',
    'qs_cadences','qs_cadence_days','qs_cadence_activities','qs_cadence_owners',
    'qs_meetings','qs_goals','qs_channel_config','qs_custom_fields',
    'qs_lead_custom_values','qs_handovers','qs_whatsapp_messages','qs_products'
  ] loop
    execute format('drop policy if exists %I on %I', 'app_all_' || t, t);   -- 0001 (anon+auth)
    execute format('drop policy if exists %I on %I', 'app_auth_' || t, t);  -- 0002 (auth, using true)
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ═══ (2) Dados sensíveis: dono OU gestor ═════════════════════════════════════
-- Leads: SDR enxerga os dele + os sem dono (pra puxar da vitrine); gestor tudo.
drop policy if exists leads_select on qs_leads;
create policy leads_select on qs_leads for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null);
drop policy if exists leads_insert on qs_leads;
create policy leads_insert on qs_leads for insert to authenticated with check (true);
drop policy if exists leads_update on qs_leads;
create policy leads_update on qs_leads for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true); -- quem pode editar a linha pode reatribuí-la (transferência)
drop policy if exists leads_delete on qs_leads;
create policy leads_delete on qs_leads for delete to authenticated
  using (qs_is_manager());

-- Tarefas: mesmas regras dos leads.
drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null);
drop policy if exists tasks_insert on qs_tasks;
create policy tasks_insert on qs_tasks for insert to authenticated with check (true);
drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true);
drop policy if exists tasks_delete on qs_tasks;
create policy tasks_delete on qs_tasks for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- Reuniões
drop policy if exists meetings_select on qs_meetings;
create policy meetings_select on qs_meetings for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null);
drop policy if exists meetings_insert on qs_meetings;
create policy meetings_insert on qs_meetings for insert to authenticated with check (true);
drop policy if exists meetings_update on qs_meetings;
create policy meetings_update on qs_meetings for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null)
  with check (true);
drop policy if exists meetings_delete on qs_meetings;
create policy meetings_delete on qs_meetings for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- Notas: seguem o dono do LEAD (autor pode editar/apagar a própria nota).
drop policy if exists notes_select on qs_notes;
create policy notes_select on qs_notes for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );
drop policy if exists notes_insert on qs_notes;
create policy notes_insert on qs_notes for insert to authenticated with check (true);
drop policy if exists notes_update on qs_notes;
create policy notes_update on qs_notes for update to authenticated
  using (qs_is_manager() or author_id = auth.uid()) with check (true);
drop policy if exists notes_delete on qs_notes;
create policy notes_delete on qs_notes for delete to authenticated
  using (qs_is_manager() or author_id = auth.uid());

-- Valores de campos custom: seguem o dono do lead.
drop policy if exists lcv_select on qs_lead_custom_values;
create policy lcv_select on qs_lead_custom_values for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );
drop policy if exists lcv_write on qs_lead_custom_values;
create policy lcv_write on qs_lead_custom_values for all to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  ) with check (true);

-- Mensagens/ligações de WhatsApp: dono ou gestor.
drop policy if exists wam_select on qs_whatsapp_messages;
create policy wam_select on qs_whatsapp_messages for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid() or owner_id is null);
drop policy if exists wam_insert on qs_whatsapp_messages;
create policy wam_insert on qs_whatsapp_messages for insert to authenticated with check (true);

-- Handovers: quem participa (de/para) ou gestor.
drop policy if exists ho_select on qs_handovers;
create policy ho_select on qs_handovers for select to authenticated
  using (qs_is_manager() or from_user_id = auth.uid() or to_user_id = auth.uid());
drop policy if exists ho_insert on qs_handovers;
create policy ho_insert on qs_handovers for insert to authenticated with check (true);

-- ═══ (3) Perfis: todos leem (nomes/avatares); só gestor escreve ══════════════
drop policy if exists users_select on qs_users;
create policy users_select on qs_users for select to authenticated using (true);
drop policy if exists users_write on qs_users;
create policy users_write on qs_users for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());

-- ═══ (4) Metas: todos leem (placar); só gestor escreve ═══════════════════════
drop policy if exists goals_select on qs_goals;
create policy goals_select on qs_goals for select to authenticated using (true);
drop policy if exists goals_write on qs_goals;
create policy goals_write on qs_goals for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());

-- ═══ (5) Taxonomias/config: todos leem; escrita segue o uso real ═════════════
-- Cadências (e filhas): leitura geral; escrita liberada a autenticados por ora
-- (SDR monta cadência hoje). Endurecer pra gestor quando o processo fechar.
do $$
declare t text;
begin
  foreach t in array array['qs_cadences','qs_cadence_days','qs_cadence_activities','qs_cadence_owners'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_write', t);
  end loop;
end $$;

-- Motivos de perda: todos leem e podem criar (modal de Perdido); gestor edita/arquiva.
drop policy if exists lr_select on qs_loss_reasons;
create policy lr_select on qs_loss_reasons for select to authenticated using (true);
drop policy if exists lr_insert on qs_loss_reasons;
create policy lr_insert on qs_loss_reasons for insert to authenticated with check (true);
drop policy if exists lr_update on qs_loss_reasons;
create policy lr_update on qs_loss_reasons for update to authenticated
  using (qs_is_manager()) with check (qs_is_manager());
drop policy if exists lr_delete on qs_loss_reasons;
create policy lr_delete on qs_loss_reasons for delete to authenticated
  using (qs_is_manager());

-- Config de canais / campos custom / produtos: leitura geral, escrita gestor.
do $$
declare t text;
begin
  foreach t in array array['qs_channel_config','qs_custom_fields','qs_products'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (qs_is_manager()) with check (qs_is_manager())', t || '_write', t);
  end loop;
end $$;

-- (qs_settings mantém as policies próprias da 0005 — não mexemos.)

-- ═══ (6) Meta de REUNIÕES (novo tipo em qs_goals) ════════════════════════════
alter table qs_goals drop constraint if exists qs_goals_type_check;
alter table qs_goals add constraint qs_goals_type_check
  check (type in ('ganhos','leads_finalizados','atividades','conversao','reunioes'));

-- ═══ ROLLBACK DE EMERGÊNCIA (só se algo travar a operação) ═══════════════════
-- Descomente e rode para voltar ao comportamento antigo (todos os logados
-- acessam tudo) enquanto investigamos:
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'qs_users','qs_leads','qs_loss_reasons','qs_notes','qs_tasks',
--     'qs_cadences','qs_cadence_days','qs_cadence_activities','qs_cadence_owners',
--     'qs_meetings','qs_goals','qs_channel_config','qs_custom_fields',
--     'qs_lead_custom_values','qs_handovers','qs_whatsapp_messages','qs_products'
--   ] loop
--     execute format('create policy %I on %I for all to authenticated using (true) with check (true)', 'app_auth_' || t, t);
--   end loop;
-- end $$;
