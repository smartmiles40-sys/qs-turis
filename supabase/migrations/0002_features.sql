-- =============================================================================
-- 0002 — Funcionalidades: número WhatsApp por SDR + (opcional) RLS por login.
-- Rode no SQL Editor do projeto que JÁ tem o 0001 aplicado.
-- =============================================================================

-- (A) Número de WhatsApp por SDR ("1 número por SDR").
alter table qs_users add column if not exists whatsapp_number text;

-- -----------------------------------------------------------------------------
-- (B) OPCIONAL — porém RECOMENDADO (LGPD/segurança).
-- Fecha o acesso ANÔNIMO: depois deste bloco, a chave anônima sozinha (sem
-- login) NÃO lê nem grava mais os dados — só usuários autenticados via Supabase
-- Auth. O app já faz login por Supabase Auth, então continua funcionando normal.
--
-- (Enquanto você não rodar este bloco, o sistema segue funcionando com o acesso
--  permissivo do 0001. Rode quando quiser blindar os dados dos leads.)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'qs_users','qs_loss_reasons','qs_cadences','qs_cadence_days','qs_cadence_activities',
    'qs_cadence_owners','qs_leads','qs_tasks','qs_meetings','qs_goals','qs_notes',
    'qs_channel_config','qs_custom_fields','qs_lead_custom_values','qs_handovers',
    'qs_products','qs_contacts','qs_whatsapp_messages'
  ] loop
    execute format('drop policy if exists %I on %I', 'app_all_' || t, t);          -- remove o permissivo do 0001
    execute format('drop policy if exists %I on %I', 'app_auth_' || t, t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', 'app_auth_' || t, t);
  end loop;
end $$;
