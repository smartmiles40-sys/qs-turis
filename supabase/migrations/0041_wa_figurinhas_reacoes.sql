-- =============================================================================
-- 0041 — WHATSAPP: FIGURINHAS SALVAS + REAÇÕES NAS MENSAGENS
-- -----------------------------------------------------------------------------
-- Duas features pedidas pelo Bruno em 06/08:
--
-- 1) FIGURINHAS como no WhatsApp: cada SDR tem a própria galeria (salva uma
--    figurinha que chegou na conversa, ou sobe uma imagem que vira figurinha)
--    e manda com um clique. A galeria mora em `qs_wa_figurinhas`.
--
-- 2) REAÇÕES: reagir a uma mensagem (👍❤️😂…) em vez de mandar um emoji solto
--    — e ver a reação que o LEAD deixou na mensagem do SDR. A reação vive na
--    própria mensagem (`qs_wa_messages.reactions`), como no WhatsApp.
--
-- A reação de verdade (a que aparece no celular do cliente) sai pela EVOLUTION
-- API (o Chatwoot não tem endpoint de reação). Pra casar a reação com a
-- mensagem certa, guardamos o `source_id` — o id da mensagem NO WHATSAPP, que o
-- Chatwoot repassa e a Evolution usa como chave.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Rodar ANTES de fazer o deploy do código que usa isto.
-- =============================================================================

-- ── (1) Mensagem ganha o id do WhatsApp e as reações ────────────────────────
alter table qs_wa_messages add column if not exists source_id text;
alter table qs_wa_messages add column if not exists reactions jsonb not null default '[]'::jsonb;

-- A reação do lead chega da Evolution só com o id do WhatsApp — este índice é
-- o que faz o casamento ser uma busca e não uma varredura.
create index if not exists idx_qs_wa_messages_source
  on qs_wa_messages(source_id) where source_id is not null;

-- ── (2) A galeria de figurinhas de cada SDR ─────────────────────────────────
-- `dado` guarda a figurinha de dois jeitos:
--   • data:image/webp;base64,...  → imagem que o SDR subiu (convertida no navegador)
--   • https://chat.setufor.../... → figurinha salva de uma conversa (URL do Chatwoot)
create table if not exists qs_wa_figurinhas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references qs_users(id) on delete cascade,
  dado       text not null,
  created_at timestamptz not null default now()
);

-- Salvar a mesma figurinha duas vezes não duplica. md5 porque índice btree não
-- aceita um data-url de 100 KB como chave.
create unique index if not exists uq_qs_wa_figurinhas
  on qs_wa_figurinhas(user_id, md5(dado));

alter table qs_wa_figurinhas enable row level security;

-- Galeria é PESSOAL: cada um vê, salva e apaga só a sua.
drop policy if exists wa_figurinhas_select on qs_wa_figurinhas;
create policy wa_figurinhas_select on qs_wa_figurinhas for select to authenticated
  using (user_id = auth.uid());

drop policy if exists wa_figurinhas_insert on qs_wa_figurinhas;
create policy wa_figurinhas_insert on qs_wa_figurinhas for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists wa_figurinhas_delete on qs_wa_figurinhas;
create policy wa_figurinhas_delete on qs_wa_figurinhas for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on qs_wa_figurinhas to authenticated;

-- ── (3) Reagir: troca atômica da reação de UM autor ─────────────────────────
-- Regra do WhatsApp: cada pessoa tem NO MÁXIMO uma reação por mensagem — reagir
-- de novo troca, reagir com '' remove. `p_autor` é 'lead' ou o uuid do usuário.
-- SECURITY DEFINER + service_role: quem chama é a rota /api (que já validou a
-- posse do lead); o navegador nunca escreve aqui direto.
create or replace function qs_wa_react(
  p_msg   uuid,
  p_autor text,
  p_nome  text,
  p_emoji text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_novo jsonb;
begin
  if char_length(coalesce(p_emoji, '')) > 16 then
    raise exception 'emoji invalido';
  end if;

  update qs_wa_messages m
     set reactions = (
       select coalesce(jsonb_agg(r), '[]'::jsonb)
         from jsonb_array_elements(coalesce(m.reactions, '[]'::jsonb)) r
        where r->>'autor' is distinct from p_autor
     ) || case
       when coalesce(p_emoji, '') = '' then '[]'::jsonb
       else jsonb_build_array(jsonb_build_object(
              'emoji', p_emoji, 'autor', p_autor, 'nome', p_nome))
     end
   where m.id = p_msg
   returning m.reactions into v_novo;

  return v_novo;   -- null = mensagem não existe
end $$;

revoke execute on function qs_wa_react(uuid, text, text, text) from public;
grant  execute on function qs_wa_react(uuid, text, text, text) to service_role;

-- ── (4) Reação que CHEGA da Evolution (webhook): casa pelo id do WhatsApp ───
-- Devolve o lead da mensagem (pra log) ou null se não achou.
create or replace function qs_wa_react_by_source(
  p_source text,
  p_autor  text,
  p_nome   text,
  p_emoji  text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_msg  uuid;
  v_lead uuid;
begin
  select id, lead_id into v_msg, v_lead
    from qs_wa_messages
   where source_id = p_source
   order by sent_at desc
   limit 1;

  if v_msg is null then return null; end if;
  perform qs_wa_react(v_msg, p_autor, p_nome, p_emoji);
  return v_lead;
end $$;

revoke execute on function qs_wa_react_by_source(text, text, text, text) from public;
grant  execute on function qs_wa_react_by_source(text, text, text, text) to service_role;

-- ── (5) Ingestão passa a guardar o source_id ────────────────────────────────
-- Mesmo corpo da 0025, com um parâmetro a mais (p_source). A versão antiga é
-- derrubada no fim — duas assinaturas confundem o PostgREST na hora de resolver.
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
  p_inbox       int default null,
  p_source      text default null
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
                              content, attachments, sender_name, sent_at, source_id)
  values (p_lead, p_conv, p_msg, p_direction, p_content,
          coalesce(p_attachments, '[]'::jsonb), p_sender, v_at, nullif(p_source, ''))
  on conflict (cw_message_id) where cw_message_id is not null do nothing;

  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  -- Mensagem já existia mas sem source_id (gravada antes desta migration, ou o
  -- webhook não trouxe): completa agora. É o que liga o histórico às reações.
  if not v_new and p_source is not null and p_source <> '' then
    update qs_wa_messages
       set source_id = p_source
     where cw_message_id = p_msg and source_id is null;
  end if;

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

revoke execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int, text) from public;
grant  execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int, text) to service_role;

drop function if exists qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int);

-- ── Como conferir ───────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_name = 'qs_wa_messages' and column_name in ('source_id','reactions');
-- select count(*) from qs_wa_figurinhas;   → 0 (vazia, mas existe)
