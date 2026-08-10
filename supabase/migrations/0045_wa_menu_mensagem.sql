-- =============================================================================
-- 0045 — WHATSAPP: RECIBO DE ENTREGA, APAGAR, RESPONDER E "MARCAR NÃO LIDA"
-- -----------------------------------------------------------------------------
-- Pedido do Bruno em 10/08: o atendimento tem que parecer WhatsApp — menu do
-- botão direito na mensagem, apagar, marcar conversa como não lida. Três dados
-- que o Chatwoot JÁ mandava e o QS jogava fora entram aqui:
--
-- 1) STATUS (✓ enviada, ✓✓ entregue, ✓✓ lida, ✗ falhou). Hoje o atendente manda
--    e não sabe se chegou. Vira crítico com o número oficial da Meta: mensagem
--    fora da janela de 24h é RECUSADA, e sem esta coluna a recusa é invisível —
--    a bolha fica na tela como se tivesse ido.
--
-- 2) APAGADA. Hoje, cliente apaga a mensagem e ela continua na tela do QS.
--    Guardamos `deleted_at` em vez de dar DELETE: a bolha vira "mensagem
--    apagada" (como no WhatsApp) e o histórico não ganha um buraco sem
--    explicação.
--
-- 3) RESPONDER CITANDO. Guardamos o id da mensagem citada MAIS um trecho dela
--    (`reply_preview`). O trecho é redundante de propósito: a citada pode ser
--    anterior ao que o QS importou, e sem ele a citação apareceria vazia.
--
-- Nada aqui é obrigatório pro que já existe: toda coluna é anulável e o código
-- tem caminho de volta pra quando esta migration ainda não foi aplicada.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Rodar ANTES do deploy do código que usa isto.
-- =============================================================================

-- ── (1) Colunas novas na mensagem ───────────────────────────────────────────
-- status: valor CRU do Chatwoot (sent/delivered/read/failed). Guardar o termo
-- original evita uma tabela de tradução que erra em silêncio quando o Chatwoot
-- inventa um estado novo.
alter table qs_wa_messages add column if not exists status text;
alter table qs_wa_messages add column if not exists deleted_at timestamptz;
alter table qs_wa_messages add column if not exists deleted_by uuid references qs_users(id);
alter table qs_wa_messages add column if not exists reply_to_source_id text;
alter table qs_wa_messages add column if not exists reply_preview text;

-- ── (2) Marcar a conversa como NÃO LIDA ─────────────────────────────────────
-- O contrário de qs_wa_mark_read (0024). Serve pra "deixo pra depois e não
-- quero esquecer" — o uso real do recurso no WhatsApp.
--
-- Grava 1, não incrementa: o número é um lembrete visual, e somar a cada clique
-- mostraria "7 não lidas" numa conversa que a pessoa marcou sete vezes.
-- Só marca se houver conversa; sem isso, um lead sem thread criaria linha órfã.
create or replace function qs_wa_mark_unread(p_lead uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not qs_owns_lead(p_lead) then
    raise exception 'sem permissão para este lead';
  end if;
  update qs_wa_threads set unread = greatest(unread, 1) where lead_id = p_lead;
end $$;

grant execute on function qs_wa_mark_unread(uuid) to authenticated;

-- ── (3) Status da mensagem (chamado pelo webhook) ───────────────────────────
-- Casado por cw_message_id, que é a chave que o Chatwoot manda no
-- message_updated. Devolve true quando achou a linha — assim o webhook
-- consegue distinguir "atualizei" de "essa mensagem eu nem tenho".
create or replace function qs_wa_set_status(p_msg bigint, p_status text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_rows int := 0;
begin
  if p_msg is null or coalesce(p_status, '') = '' then
    return false;
  end if;

  update qs_wa_messages
     set status = p_status
   where cw_message_id = p_msg
     -- Nunca deixa o status ANDAR PRA TRÁS. O Chatwoot reenvia eventos fora de
     -- ordem, e sem esta guarda um "delivered" atrasado apagaria o "read" que
     -- já tinha chegado — o atendente veria a mensagem "desler".
     and coalesce(array_position(array['failed','sent','delivered','read'], qs_wa_messages.status), 0)
         <= coalesce(array_position(array['failed','sent','delivered','read'], p_status), 0);

  get diagnostics v_rows = row_count;       -- ROW_COUNT é int, não boolean
  return v_rows > 0;
end $$;

revoke execute on function qs_wa_set_status(bigint, text) from public;
grant  execute on function qs_wa_set_status(bigint, text) to service_role;

-- ── (4) Apagar uma mensagem ─────────────────────────────────────────────────
-- Chamado pelo servidor (/api/wa-react com acao=apagar), que antes confirma no
-- WhatsApp. Recebe o autor porque roda com service_role: aqui não há auth.uid().
create or replace function qs_wa_apagar(p_msg uuid, p_user uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_rows int := 0;
begin
  update qs_wa_messages
     set deleted_at = now(),
         deleted_by = p_user,
         -- O conteúdo some de verdade: apagada que continua legível no banco
         -- não está apagada. As reações vão junto (não fazem sentido sem texto).
         content = null,
         attachments = '[]'::jsonb,
         reactions = '[]'::jsonb
   where id = p_msg and deleted_at is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  -- A prévia da lista também precisa esquecer o texto, senão a mensagem apagada
  -- continua legível na lista de conversas — que é onde ela mais aparece.
  update qs_wa_threads t
     set last_message = 'Mensagem apagada'
    from qs_wa_messages m
   where m.id = p_msg
     and t.lead_id = m.lead_id
     and t.last_at <= m.sent_at;

  return true;
end $$;

revoke execute on function qs_wa_apagar(uuid, uuid) from public;
grant  execute on function qs_wa_apagar(uuid, uuid) to service_role;

-- ── (5) Ingestão passa a aceitar status e citação ───────────────────────────
-- Mesma função de sempre, com três parâmetros novos no fim (todos opcionais,
-- pra assinatura antiga continuar funcionando durante o deploy).
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
  p_source      text default null,
  p_status      text default null,
  p_reply_to    text default null,
  p_reply_prev  text default null
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
                              content, attachments, sender_name, sent_at, source_id,
                              status, reply_to_source_id, reply_preview)
  values (p_lead, p_conv, p_msg, p_direction, p_content,
          coalesce(p_attachments, '[]'::jsonb), p_sender, v_at, nullif(p_source, ''),
          nullif(p_status, ''), nullif(p_reply_to, ''), nullif(p_reply_prev, ''))
  on conflict (cw_message_id) where cw_message_id is not null do nothing;

  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  -- Mensagem já existia mas sem source_id (gravada antes da 0041, ou o webhook
  -- não trouxe): completa agora. É o que liga o histórico às reações.
  if not v_new and p_source is not null and p_source <> '' then
    update qs_wa_messages
       set source_id = p_source
     where cw_message_id = p_msg and source_id is null;
  end if;

  -- O status chega quase sempre DEPOIS da mensagem (evento message_updated), e
  -- às vezes fora de ordem — por isso reusa a mesma guarda de qs_wa_set_status.
  if not v_new and coalesce(p_status, '') <> '' then
    perform qs_wa_set_status(p_msg, p_status);
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

revoke execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int, text, text, text, text) from public;
grant  execute on function qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int, text, text, text, text) to service_role;

-- A assinatura de 12 parâmetros (0041) sai de cena — senão o PostgREST fica com
-- duas candidatas e recusa a chamada por ambiguidade.
drop function if exists qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, int, text);

notify pgrst, 'reload schema';

-- ── Como conferir ───────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_name = 'qs_wa_messages'
--     and column_name in ('status','deleted_at','reply_to_source_id','reply_preview');
--   → 4 linhas
-- select proname from pg_proc where proname in ('qs_wa_mark_unread','qs_wa_apagar','qs_wa_set_status');
--   → 3 linhas

-- ── Rollback de emergência ──────────────────────────────────────────────────
-- drop function if exists qs_wa_mark_unread(uuid);
-- drop function if exists qs_wa_apagar(uuid, uuid);
-- drop function if exists qs_wa_set_status(bigint, text);
-- (as colunas podem ficar: são anuláveis e ninguém quebra sem elas)
