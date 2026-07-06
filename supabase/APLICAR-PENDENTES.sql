-- =============================================================================
-- APLICAR-PENDENTES.sql — TUDO que falta aplicar no Supabase, num arquivo só.
-- (gerado 2026-07-06; junta as migrations 0002 → 0006, todas idempotentes)
--
-- COMO USAR (1 minuto):
--   1. https://supabase.com/dashboard → projeto do QS (eabfjomrnucymduqnbci)
--   2. SQL Editor → New query → cole este arquivo INTEIRO → Run
--   3. Deve terminar com "Success". Pode rodar de novo sem medo (idempotente):
--      já-aplicado é pulado e o backfill do Bitrix tem guarda de re-execução.
--
-- O que este arquivo liga:
--   0002  whatsapp_number por SDR + RLS (fecha acesso anônimo)
--   0003  round-robin automático no INSERT de lead sem dono
--   0004  canal "Ligação WhatsApp" (ligacao_whatsapp)
--   0005  tabela qs_settings (horário, equipe, webfone, SIP, token ChatApp)
--   0006  sincronização Bitrix (bitrix_id no lead, flags de sync, campos da reunião)
-- =============================================================================


-- ═══════════════════════ [0002_features.sql] ═══════════════════════
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

-- ═══════════════════════ [0003_auto_assign.sql] ═══════════════════════
-- =============================================================================
-- 0003 — Distribuição automática (round-robin por menor carga) ao inserir lead.
-- Útil quando os leads entram DIRETO no Supabase (ex.: n8n gravando em qs_leads),
-- sem passar pelo webhook /api/lead-inbound. Todo lead inserido SEM responsável
-- (owner_id nulo) é atribuído ao SDR ativo com menos leads em aberto.
--
-- Seguro: só age quando owner_id é nulo (não sobrescreve quem você já definiu),
-- e não mexe em tarefas (não conflita com a geração de tarefas do app/webhook).
-- =============================================================================

create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
as $$
declare chosen uuid;
begin
  if new.owner_id is null then
    select u.id into chosen
    from qs_users u
    left join (
      select owner_id, count(*) as c
      from qs_leads
      where status in ('nao_iniciado', 'em_prospeccao') and owner_id is not null
      group by owner_id
    ) l on l.owner_id = u.id
    where u.role = 'sdr' and u.is_active = true
    order by coalesce(l.c, 0) asc, u.created_at asc
    limit 1;

    if chosen is not null then
      new.owner_id := chosen;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();

-- ═══════════════════════ [0004_ligacao_whatsapp.sql] ═══════════════════════
-- 0004_ligacao_whatsapp.sql
-- Adiciona o canal 'ligacao_whatsapp' (Ligação WhatsApp) — separa a ligação
-- normal da ligação feita pelo WhatsApp. Roda no SQL Editor do Supabase.

-- 1) qs_tasks.channel_type
alter table qs_tasks drop constraint if exists qs_tasks_channel_type_check;
alter table qs_tasks add constraint qs_tasks_channel_type_check
  check (channel_type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 2) qs_cadence_activities.channel_type
alter table qs_cadence_activities drop constraint if exists qs_cadence_activities_channel_type_check;
alter table qs_cadence_activities add constraint qs_cadence_activities_channel_type_check
  check (channel_type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 3) qs_channel_config.type
alter table qs_channel_config drop constraint if exists qs_channel_config_type_check;
alter table qs_channel_config add constraint qs_channel_config_type_check
  check (type in ('pesquisa','email','ligacao','ligacao_whatsapp','whatsapp','linkedin','instagram','tiktok','youtube'));

-- 4) registra o canal na config (se a tabela estiver em uso)
insert into qs_channel_config (type, enabled, label)
  values ('ligacao_whatsapp', true, 'Ligação WhatsApp')
  on conflict (type) do nothing;

-- ═══════════════════════ [0005_settings.sql] ═══════════════════════
-- 0005_settings.sql
-- Tabela genérica de configurações da empresa (chave→valor JSON).
-- Usada pelo Horário de Trabalho (métricas de tempo só dentro do expediente).

create table if not exists qs_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table qs_settings enable row level security;

-- Leitura pra qualquer usuário autenticado; escrita idem (ajuste se quiser restringir a admin).
drop policy if exists "qs_settings read" on qs_settings;
create policy "qs_settings read" on qs_settings for select using (auth.role() = 'authenticated');

drop policy if exists "qs_settings write" on qs_settings;
create policy "qs_settings write" on qs_settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ═══════════════════════ [0006_bitrix_sync.sql] ═══════════════════════
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
