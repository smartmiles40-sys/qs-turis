-- 0021_qs_contacts_rls.sql
-- Fecha o buraco de isolamento por dono na tabela qs_contacts.
--
-- Contexto: o 0007 (RLS por papéis, "P0 da auditoria") travou por dono todas as
-- tabelas de dado do lead — MENOS qs_contacts, que ficou esquecida com a policy
-- permissiva `app_auth_qs_contacts` do 0002 (`for all using(true)`). Enquanto o
-- CRUD de contatos ficou dormente isso não incomodava; a Sprint 4 (LeadDetailPage)
-- LIGOU a leitura/escrita de contatos (telefone, e-mail, WhatsApp, LinkedIn — PII),
-- então agora qualquer usuário autenticado consegue ler/alterar/apagar os contatos
-- dos leads de QUALQUER colega. Espelha a RLS de qs_notes/qs_lead_custom_values:
-- escopo pelo dono do LEAD (join em qs_leads), gestor/admin veem tudo.
--
-- Requer: 0007 (função qs_is_manager()). Idempotente.

-- RLS já foi habilitada em qs_contacts no 0001; garante mesmo assim.
alter table qs_contacts enable row level security;

-- Remove as policies permissivas herdadas (0001 anon+auth, 0002 auth using true).
drop policy if exists app_all_qs_contacts on qs_contacts;
drop policy if exists app_auth_qs_contacts on qs_contacts;

-- SELECT: gestor/admin tudo; senão só os contatos de leads do próprio dono
-- (ou de leads sem dono, coerente com qs_leads/qs_notes).
drop policy if exists contacts_select on qs_contacts;
create policy contacts_select on qs_contacts for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- INSERT: só pode criar contato num lead que você enxerga (mesmo escopo).
drop policy if exists contacts_insert on qs_contacts;
create policy contacts_insert on qs_contacts for insert to authenticated
  with check (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- UPDATE: mesmo escopo no using e no check (não deixa "mover" contato pra lead alheio).
drop policy if exists contacts_update on qs_contacts;
create policy contacts_update on qs_contacts for update to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  )
  with check (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );

-- DELETE: mesmo escopo.
drop policy if exists contacts_delete on qs_contacts;
create policy contacts_delete on qs_contacts for delete to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  );
