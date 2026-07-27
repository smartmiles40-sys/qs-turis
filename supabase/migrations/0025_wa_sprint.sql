-- 0025_wa_sprint.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint do atendimento de WhatsApp (pedido do Bruno, 27/07): abas por situação,
-- tag do número, conversa fixada, "esperando resposta há X" e o fluxo do
-- agendamento (lead vai pro closer, mas o SDR continua junto).
--
-- ⚠️ Depende da 0024. Cole inteiro no SQL Editor do Supabase e rode 1x.
--    Idempotente: rodar 2x não quebra.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (1) Quem passou o lead adiante continua enxergando a conversa ───────────
-- O fluxo combinado: o SDR agenda → o lead passa pro closer → mas o SDR precisa
-- seguir falando com o cliente "pra qualquer imprevisto". Sem isto, no instante
-- em que o handover troca o dono do lead, a conversa sumiria da tela do SDR.
-- Note que isto NÃO abre nada pros outros SDRs: só pra quem fez a passagem.
create or replace function qs_owns_lead(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select qs_is_manager()
    or exists (
      select 1 from qs_leads l
      where l.id = p_lead and (l.owner_id = auth.uid() or l.owner_id is null)
    )
    or exists (
      select 1 from qs_handovers h
      where h.lead_id = p_lead and h.from_user_id = auth.uid()
    );
$$;

-- ── (2) Colunas novas na linha da conversa ──────────────────────────────────
alter table qs_wa_threads add column if not exists cw_inbox_id    int;
-- Separar as duas pontas permite responder "faz quanto tempo que ele falou e a
-- gente não respondeu?" sem varrer a tabela de mensagens a cada render.
alter table qs_wa_threads add column if not exists last_in_at     timestamptz;
alter table qs_wa_threads add column if not exists last_out_at    timestamptz;
-- Marca que o histórico completo já foi puxado do Chatwoot (botão "baixar tudo").
alter table qs_wa_threads add column if not exists history_synced boolean not null default false;

create index if not exists idx_qs_wa_threads_inbox on qs_wa_threads(cw_inbox_id);

-- ── (3) Conversas fixadas (por usuário, não por conversa) ───────────────────
-- Tabela separada de propósito: fixar é preferência de QUEM olha. Um booleano na
-- thread faria o gestor desafixar a conversa do SDR sem querer.
create table if not exists qs_wa_pins (
  user_id    uuid not null references qs_users(id) on delete cascade,
  lead_id    uuid not null references qs_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);

alter table qs_wa_pins enable row level security;

drop policy if exists wa_pins_all on qs_wa_pins;
create policy wa_pins_all on qs_wa_pins for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on qs_wa_pins to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'qs_wa_pins'
  ) then
    alter publication supabase_realtime add table qs_wa_pins;
  end if;
end $$;

alter table qs_wa_pins replica identity full;

-- ── (4) Ingestão: passa a gravar a caixa e os dois "últimos" ────────────────
create or replace function qs_wa_ingest(
  p_lead        uuid,
  p_conv        bigint,
  p_msg         bigint,
  p_direction   text,
  p_content     text,
  p_attachments jsonb default '[]'::jsonb,
  p_sender      text default null,
  p_sent_at     timestamptz default now(),
  p_contact     bigint default null,
  p_can_reply   boolean default null,
  p_inbox       int default null
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows int := 0;
  v_new  boolean := false;
  v_at   timestamptz := coalesce(p_sent_at, now());
begin
  insert into qs_wa_messages (lead_id, cw_conversation_id, cw_message_id, direction,
                              content, attachments, sender_name, sent_at)
  values (p_lead, p_conv, p_msg, p_direction, p_content,
          coalesce(p_attachments, '[]'::jsonb), p_sender, v_at)
  on conflict (cw_message_id) where cw_message_id is not null do nothing;

  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  insert into qs_wa_threads (lead_id, cw_conversation_id, cw_contact_id, cw_inbox_id,
                             last_message, last_direction, last_at, unread, can_reply,
                             last_in_at, last_out_at)
  values (p_lead, p_conv, p_contact, p_inbox, left(coalesce(p_content, ''), 500),
          p_direction, v_at,
          case when v_new and p_direction = 'in' then 1 else 0 end, p_can_reply,
          case when p_direction = 'in'  then v_at end,
          case when p_direction = 'out' then v_at end)
  on conflict (lead_id) do update set
    cw_conversation_id = coalesce(excluded.cw_conversation_id, qs_wa_threads.cw_conversation_id),
    cw_contact_id      = coalesce(excluded.cw_contact_id, qs_wa_threads.cw_contact_id),
    cw_inbox_id        = coalesce(excluded.cw_inbox_id, qs_wa_threads.cw_inbox_id),
    can_reply          = coalesce(excluded.can_reply, qs_wa_threads.can_reply),
    last_message   = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_message else qs_wa_threads.last_message end,
    last_direction = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_direction else qs_wa_threads.last_direction end,
    last_at        = greatest(coalesce(qs_wa_threads.last_at, excluded.last_at), excluded.last_at),
    last_in_at     = greatest(qs_wa_threads.last_in_at,  excluded.last_in_at),
    last_out_at    = greatest(qs_wa_threads.last_out_at, excluded.last_out_at),
    unread         = qs_wa_threads.unread + excluded.unread;

  return v_new;
end $$;

revoke execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int) from public;
grant  execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int) to service_role;

-- A versão de 10 argumentos (0024) fica órfã e confunde o PostgREST na hora de
-- resolver a chamada; derruba.
drop function if exists qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean);

-- ── (5) Preencher last_in_at / last_out_at do que já existe ─────────────────
-- Sem isto, toda conversa antiga apareceria como "nunca respondida".
update qs_wa_threads t set
  last_in_at  = coalesce(t.last_in_at,  (select max(m.sent_at) from qs_wa_messages m
                                          where m.lead_id = t.lead_id and m.direction = 'in')),
  last_out_at = coalesce(t.last_out_at, (select max(m.sent_at) from qs_wa_messages m
                                          where m.lead_id = t.lead_id and m.direction = 'out'))
where t.last_in_at is null or t.last_out_at is null;

-- ── (6) Fixar/desafixar (checa a posse antes) ───────────────────────────────
create or replace function qs_wa_toggle_pin(p_lead uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_rows int := 0;
begin
  if not qs_owns_lead(p_lead) then
    raise exception 'sem permissão para este lead';
  end if;

  delete from qs_wa_pins where user_id = auth.uid() and lead_id = p_lead;
  get diagnostics v_rows = row_count;      -- ROW_COUNT é int, não boolean

  if v_rows > 0 then return false; end if; -- estava fixada → desafixou
  insert into qs_wa_pins (user_id, lead_id) values (auth.uid(), p_lead);
  return true;                            -- agora está fixada
end $$;

grant execute on function qs_wa_toggle_pin(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── Rollback de emergência ──────────────────────────────────────────────────
-- drop function if exists qs_wa_toggle_pin(uuid);
-- drop table if exists qs_wa_pins;
-- alter table qs_wa_threads drop column if exists cw_inbox_id, drop column if exists last_in_at,
--   drop column if exists last_out_at, drop column if exists history_synced;
