-- 0006_bitrix_sync.sql
-- =============================================================================
-- Fundação da sincronização QS -> Bitrix (feita pelo n8n via polling PostgREST).
-- Tudo é ADITIVO (só adiciona colunas/índices; não altera nem apaga dado).
--
-- O n8n vai varrer estas tabelas procurando o que ainda NÃO subiu pro Bitrix:
--   - qs_notes  : observações com a tag 'bitrix' que faltam virar comentário
--   - qs_leads  : leads que viraram ganho/perdido e precisam atualizar a etapa
--   - qs_meetings: reuniões novas que precisam virar atividade no Bitrix
--
-- BACKFILL: marcamos todo o HISTÓRICO como "já sincronizado" pra que a primeira
-- rodada do n8n NÃO inunde o Bitrix com dados antigos. Só o que acontecer daqui
-- pra frente é enviado.
-- =============================================================================

-- (0) Vínculo QS ↔ Bitrix (qs_leads.bitrix_id) ---------------------------------
--     ID do negócio (deal) no Bitrix. É por ele que o n8n sabe QUAL card mover
--     quando o lead vira perdido/ganho no QS, e é por ele que o inbound NÃO
--     duplica lead quando o mesmo negócio chega duas vezes.
alter table qs_leads add column if not exists bitrix_id text;
create unique index if not exists uq_qs_leads_bitrix_id
  on qs_leads (bitrix_id) where bitrix_id is not null;

-- (0b) Campos estruturados da reunião (qs_meetings) -----------------------------
--      O modal de Ganho preenche; o n8n usa pra preencher os campos do Bitrix
--      (o texto continua indo em notes, mas estruturado é mapeável).
alter table qs_meetings add column if not exists scheduled_by  text;   -- quem agendou (SDR)
alter table qs_meetings add column if not exists meeting_owner text;   -- responsável pela reunião
alter table qs_meetings add column if not exists client_email  text;   -- e-mail do cliente
alter table qs_meetings add column if not exists booking_date  date;   -- data em que foi agendado

-- (1) Observações (qs_notes) ---------------------------------------------------
alter table qs_notes add column if not exists bitrix_synced    boolean not null default false;
alter table qs_notes add column if not exists bitrix_synced_at timestamptz;
alter table qs_notes add column if not exists bitrix_error      text;

-- (2) Desfecho do lead (qs_leads) ---------------------------------------------
--     Guarda o último status (ganho/perdido) já espelhado no Bitrix. Quando o
--     status atual difere deste, o n8n atualiza a etapa do negócio e regrava aqui.
alter table qs_leads add column if not exists bitrix_status_synced text;

-- (3) Reuniões (qs_meetings) --------------------------------------------------
alter table qs_meetings add column if not exists bitrix_synced    boolean not null default false;
alter table qs_meetings add column if not exists bitrix_synced_at timestamptz;
alter table qs_meetings add column if not exists bitrix_error      text;

-- Backfill: histórico entra como "sincronizado" (não reenvia o passado) --------
-- Guarda de re-execução: só roda se NADA foi sincronizado ainda (primeira vez).
-- Assim, rodar este arquivo de novo no futuro NÃO engole pendências novas.
update qs_notes    set bitrix_synced = true
  where bitrix_synced = false
    and not exists (select 1 from qs_notes where bitrix_synced = true);
update qs_meetings set bitrix_synced = true
  where bitrix_synced = false
    and not exists (select 1 from qs_meetings where bitrix_synced = true);
update qs_leads    set bitrix_status_synced = status
  where status in ('ganho','perdido')
    and not exists (select 1 from qs_leads where bitrix_status_synced is not null);

-- Índices parciais pros polls do n8n (só o que está pendente) ------------------
create index if not exists idx_qs_notes_bitrix_pending
  on qs_notes (created_at) where bitrix_synced = false;
create index if not exists idx_qs_meetings_bitrix_pending
  on qs_meetings (created_at) where bitrix_synced = false;
