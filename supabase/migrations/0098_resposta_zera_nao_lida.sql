-- 0098 — Respondeu (pelo celular OU pelo QS), a conversa deixa de ser "não lida".
--
-- Bruno, 29/09/2026: "se eles responderem algo no WhatsApp deve desaparecer o
-- aguardando resposta dentro do QS". Com a Coexistence, o que o SDR manda pelo
-- app do celular chega como eco (smb_message_echoes) e entra por
-- qs_wa_ingest_meta com direction='out'. O "Esperando resposta" da lista já
-- olhava last_out_at >= last_in_at e sumia — mas o contador `unread` só zerava
-- quando alguém ABRIA a conversa no QS. Em 29/09, 125 das 179 conversas "não
-- lidas" dos números dos SDRs já tinham sido respondidas pelo celular.
--
-- Regra nova: mensagem que SAI, com horário igual ou depois da última que
-- ENTROU, zera o `unread`. Mensagem antiga que chega atrasada (histórico) não
-- zera nada. Marcar como não lida no QS continua funcionando até a próxima
-- resposta.

create or replace function public.qs_wa_ingest_meta(
  p_lead uuid, p_linha uuid, p_source text, p_direction text, p_content text,
  p_attachments jsonb default '[]'::jsonb, p_sender text default null::text,
  p_sent_at timestamp with time zone default now(), p_status text default null::text,
  p_reply_to text default null::text, p_reply_prev text default null::text,
  p_inbox integer default null::integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_at   timestamptz := coalesce(p_sent_at, now());
  v_id   uuid;
begin
  if coalesce(p_source, '') = '' then
    raise exception 'qs_wa_ingest_meta: source obrigatório';
  end if;
  select id into v_id from qs_wa_messages
   where source_id in (p_source, 'WAID:' || p_source)
   limit 1;
  if v_id is not null then
    update qs_wa_messages
       set attachments = case when attachments = '[]'::jsonb then coalesce(p_attachments, '[]'::jsonb) else attachments end,
           cw_inbox_id = coalesce(cw_inbox_id, p_inbox)
     where id = v_id;
    if coalesce(p_status, '') <> '' then
      perform qs_wa_status_meta(p_source, p_status);
    end if;
    return false;
  end if;
  insert into qs_wa_messages (lead_id, direction, content, attachments, sender_name, sent_at,
                              source_id, status, reply_to_source_id, reply_preview,
                              linha_user_id, cw_inbox_id)
  values (p_lead, p_direction, p_content, coalesce(p_attachments, '[]'::jsonb), p_sender, v_at,
          p_source, nullif(p_status, ''), nullif(p_reply_to, ''), nullif(p_reply_prev, ''),
          p_linha, p_inbox)
  on conflict do nothing;
  if not found then return false; end if;
  insert into qs_wa_threads (lead_id, linha_user_id, cw_inbox_id, last_message, last_direction,
                             last_at, unread, can_reply, last_in_at, last_out_at)
  values (p_lead, p_linha, p_inbox, left(coalesce(p_content, ''), 500), p_direction, v_at,
          case when p_direction = 'in' then 1 else 0 end,
          case when p_direction = 'in' then true else null end,
          case when p_direction = 'in'  then v_at end,
          case when p_direction = 'out' then v_at end)
  on conflict (lead_id) do update set
    linha_user_id  = coalesce(excluded.linha_user_id, qs_wa_threads.linha_user_id),
    cw_inbox_id    = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then coalesce(excluded.cw_inbox_id, qs_wa_threads.cw_inbox_id)
                          else qs_wa_threads.cw_inbox_id end,
    can_reply      = case when excluded.last_direction = 'in' then true else qs_wa_threads.can_reply end,
    last_message   = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_message else qs_wa_threads.last_message end,
    last_direction = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_direction else qs_wa_threads.last_direction end,
    last_at        = greatest(coalesce(qs_wa_threads.last_at, excluded.last_at), excluded.last_at),
    last_in_at     = greatest(qs_wa_threads.last_in_at,  excluded.last_in_at),
    last_out_at    = greatest(qs_wa_threads.last_out_at, excluded.last_out_at),
    -- 0098: resposta (do celular ou do QS) depois da última do cliente zera.
    unread         = case
                       when excluded.last_direction = 'out'
                        and excluded.last_at >= coalesce(qs_wa_threads.last_in_at, '-infinity'::timestamptz)
                       then 0
                       else qs_wa_threads.unread + excluded.unread
                     end;
  return true;
end $function$;

-- As que JÁ foram respondidas e seguem "não lidas" (125 em 29/09).
update qs_wa_threads
   set unread = 0
 where unread > 0
   and last_out_at is not null
   and last_out_at >= coalesce(last_in_at, '-infinity'::timestamptz);
