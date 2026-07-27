-- 0024_wa_atendimento.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ATENDIMENTO DE WHATSAPP NATIVO DENTRO DO QS
--
-- POR QUÊ (a decisão que originou isso):
--   O Chatwoot community NÃO sabe restringir um agente às conversas dele. Papéis
--   personalizados (a única trava nativa) são recurso ENTERPRISE — checado na
--   nossa instância em 2026-07-27: GET /api/v1/accounts/1/custom_roles = 404.
--   Na community, todo agente membro de uma caixa enxerga a CAIXA INTEIRA; a aba
--   "Minhas" é só um filtro de tela, não permissão.
--
--   O QS, por outro lado, já separa por dono no BANCO desde 0007_rls_papeis
--   ("SDR só vê os leads dele" é RLS, não filtro). Então trazemos a conversa pra
--   cá: cada mensagem vira linha amarrada a um LEAD, e quem enxerga a mensagem é
--   decidido pela mesma regra que decide quem enxerga o lead.
--
-- QUEM ESCREVE: só o service_role (as rotas /api). O navegador do SDR apenas LÊ
--   (e zera o contador de não lidas via RPC). O Chatwoot/Evolution continua sendo
--   o motor do WhatsApp — estas tabelas são a cópia que o QS sabe filtrar.
--
-- NÃO substitui qs_whatsapp_messages (log de disparos do ChatApp legado): aquela
--   é registro de tentativa de envio; esta é a CONVERSA (histórico dos 2 lados).
--
-- ⚠️ COMO APLICAR: cole este arquivo inteiro no SQL Editor do Supabase (projeto
--    eabfjomrnucymduqnbci) e rode 1x. Idempotente: rodar 2x não quebra.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: este lead é meu? ────────────────────────────────────────────────
-- Mesma regra do 0007 (dono, sem dono, ou gestor vê tudo), num lugar só pra não
-- repetir o EXISTS em cada policy. SECURITY DEFINER pra enxergar qs_leads sem
-- esbarrar na RLS do próprio qs_leads.
create or replace function qs_owns_lead(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select qs_is_manager() or exists (
    select 1 from qs_leads l
    where l.id = p_lead and (l.owner_id = auth.uid() or l.owner_id is null)
  );
$$;

-- ── Mensagens da conversa ───────────────────────────────────────────────────
create table if not exists qs_wa_messages (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references qs_leads(id) on delete cascade,
  cw_conversation_id bigint,
  cw_message_id      bigint,          -- id no Chatwoot: é a chave da idempotência
  direction          text not null check (direction in ('in','out')),
  content            text,
  attachments        jsonb not null default '[]'::jsonb,
  sender_name        text,            -- quem mandou (agente ou o próprio contato)
  sent_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- Webhook do Chatwoot repete evento; sem isto a conversa duplica.
create unique index if not exists uq_qs_wa_messages_cw
  on qs_wa_messages(cw_message_id) where cw_message_id is not null;
create index if not exists idx_qs_wa_messages_lead
  on qs_wa_messages(lead_id, sent_at desc);

-- ── Estado por lead (a linha da lista "Minhas conversas") ───────────────────
create table if not exists qs_wa_threads (
  lead_id            uuid primary key references qs_leads(id) on delete cascade,
  cw_conversation_id bigint,
  cw_contact_id      bigint,
  last_message       text,
  last_direction     text check (last_direction in ('in','out')),
  last_at            timestamptz,
  unread             int not null default 0,
  can_reply          boolean,         -- false = fora da janela de 24h do WhatsApp
  synced_at          timestamptz,     -- último backfill do histórico
  updated_at         timestamptz not null default now()
);

create index if not exists idx_qs_wa_threads_last on qs_wa_threads(last_at desc nulls last);
create index if not exists idx_qs_wa_threads_conv on qs_wa_threads(cw_conversation_id);

drop trigger if exists trg_qs_wa_threads_updated on qs_wa_threads;
create trigger trg_qs_wa_threads_updated before update on qs_wa_threads
  for each row execute function qs_set_updated_at();

-- ── RLS: enxerga a conversa quem enxerga o lead ─────────────────────────────
alter table qs_wa_messages enable row level security;
alter table qs_wa_threads  enable row level security;

drop policy if exists wa_messages_select on qs_wa_messages;
create policy wa_messages_select on qs_wa_messages for select to authenticated
  using (qs_owns_lead(lead_id));

drop policy if exists wa_threads_select on qs_wa_threads;
create policy wa_threads_select on qs_wa_threads for select to authenticated
  using (qs_owns_lead(lead_id));

-- Sem policy de INSERT/UPDATE/DELETE de propósito: o navegador não escreve aqui.
-- Quem grava é o service_role (rotas /api), que ignora RLS.

grant select on qs_wa_messages to authenticated;
grant select on qs_wa_threads  to authenticated;

-- ── Zerar não lidas (única escrita que o SDR faz, e por função) ─────────────
create or replace function qs_wa_mark_read(p_lead uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not qs_owns_lead(p_lead) then
    raise exception 'sem permissão para este lead';
  end if;
  update qs_wa_threads set unread = 0 where lead_id = p_lead;
end $$;

grant execute on function qs_wa_mark_read(uuid) to authenticated;

-- ── Ingestão de 1 mensagem (usada pelo webhook e pelo backfill) ─────────────
-- Faz tudo numa transação só: grava a mensagem (ignorando repetida), atualiza a
-- linha da lista e incrementa "não lidas" APENAS se a mensagem realmente entrou
-- e é de entrada. Feito em função (e não em 3 chamadas do PostgREST) porque o
-- webhook do Chatwoot reenvia evento e dispara chamadas em paralelo — somar +1
-- lendo e regravando pelo lado de fora perderia contagem.
-- Devolve true se a mensagem era nova, false se já existia.
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
  p_can_reply   boolean default null
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows int := 0;
  v_new  boolean := false;
begin
  insert into qs_wa_messages (lead_id, cw_conversation_id, cw_message_id, direction,
                              content, attachments, sender_name, sent_at)
  values (p_lead, p_conv, p_msg, p_direction, p_content,
          coalesce(p_attachments, '[]'::jsonb), p_sender, coalesce(p_sent_at, now()))
  on conflict (cw_message_id) where cw_message_id is not null do nothing;

  get diagnostics v_rows = row_count;   -- ROW_COUNT é int, não boolean
  v_new := v_rows > 0;

  insert into qs_wa_threads (lead_id, cw_conversation_id, cw_contact_id, last_message,
                             last_direction, last_at, unread, can_reply)
  values (p_lead, p_conv, p_contact, left(coalesce(p_content, ''), 500),
          p_direction, coalesce(p_sent_at, now()),
          case when v_new and p_direction = 'in' then 1 else 0 end, p_can_reply)
  on conflict (lead_id) do update set
    cw_conversation_id = coalesce(excluded.cw_conversation_id, qs_wa_threads.cw_conversation_id),
    cw_contact_id      = coalesce(excluded.cw_contact_id, qs_wa_threads.cw_contact_id),
    can_reply          = coalesce(excluded.can_reply, qs_wa_threads.can_reply),
    -- só reescreve a "última mensagem" se esta for mais nova que a que está lá
    last_message   = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_message else qs_wa_threads.last_message end,
    last_direction = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_direction else qs_wa_threads.last_direction end,
    last_at        = greatest(coalesce(qs_wa_threads.last_at, excluded.last_at), excluded.last_at),
    unread         = qs_wa_threads.unread + excluded.unread;

  return v_new;
end $$;

-- Só o servidor ingere: tira de todo mundo e devolve SÓ pro service_role (as
-- rotas /api). Atenção: no Postgres toda função nasce com EXECUTE pra PUBLIC, e
-- revogar de PUBLIC tira também do service_role — por isso o grant logo abaixo
-- é obrigatório, não decorativo.
revoke execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean) from public;
grant  execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean) to service_role;

-- ── Realtime: mensagem nova aparece na tela sem F5 ──────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'qs_wa_messages'
  ) then
    alter publication supabase_realtime add table qs_wa_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'qs_wa_threads'
  ) then
    alter publication supabase_realtime add table qs_wa_threads;
  end if;
end $$;

alter table qs_wa_messages replica identity full;
alter table qs_wa_threads  replica identity full;

-- Faz o PostgREST enxergar as tabelas/funções novas na hora (sem esperar o
-- recarregamento automático) — senão a 1ª chamada de /api/wa-* dá 404.
notify pgrst, 'reload schema';

-- ── Rollback de emergência (descomente e rode) ──────────────────────────────
-- drop function if exists qs_wa_mark_read(uuid);
-- drop table if exists qs_wa_messages;
-- drop table if exists qs_wa_threads;
-- drop function if exists qs_owns_lead(uuid);
