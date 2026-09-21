-- 0084_mensagens_direto_da_meta.sql
-- -----------------------------------------------------------------------------
-- AS MENSAGENS DO NÚMERO OFICIAL ENTRAM DIRETO DA META (21/09/2026).
--
-- O achado: desde 01/09 o app `qs_call` assina o campo `messages` da WABA (pra
-- receber o "pode me ligar"), então a Meta entrega TODA mensagem do número
-- oficial no /api/wa-calls — centenas por dia. A rota descartava de propósito,
-- porque "quem cuida de conversa é o Chatwoot". Só que o caminho Chatwoot→QS
-- morreu em 02/09. Resultado: as respostas dos leads ao `bem_vindo` chegavam no
-- QS e iam pro lixo, e ninguém do time via.
--
-- Agora o /api/wa-calls grava. E é a MESMA porta pela qual vão entrar os números
-- dos SDRs quando a Coexistence for aprovada (campos smb_message_echoes e
-- history) — por isso a tabela de números abaixo já nasce com dono por SDR.
-- -----------------------------------------------------------------------------

-- ── De quem é cada número da Meta ───────────────────────────────────────────
-- user_id NULO = número compartilhado (o oficial de hoje): a conversa segue a
-- regra de sempre (dono do lead + gestão + closer).
-- user_id PREENCHIDO = número de um SDR (Coexistence): a mensagem ganha
-- linha_user_id e vale a regra da 0082 (só o dono do número + gestão + closer).
create table if not exists public.qs_wa_numeros_meta (
  phone_number_id  text primary key,
  user_id          uuid references public.qs_users(id) on delete set null,
  rotulo           text,
  -- caixa do Chatwoot equivalente, pra tela saber que é o número OFICIAL
  -- (janela de 24h, modelos). Só o número compartilhado usa.
  cw_inbox_id      integer,
  criado_em        timestamptz not null default now()
);
alter table public.qs_wa_numeros_meta enable row level security;
drop policy if exists qs_wa_numeros_meta_select on public.qs_wa_numeros_meta;
create policy qs_wa_numeros_meta_select on public.qs_wa_numeros_meta
  for select to authenticated using (qs_is_manager() or user_id = (select auth.uid()));
revoke insert, update, delete on public.qs_wa_numeros_meta from anon, authenticated;

-- ── Dedupe pelo id do WhatsApp (wamid) ─────────────────────────────────────
-- A Meta reentrega o mesmo evento em retentativa. Mensagem do Chatwoot tem
-- cw_message_id e do número de SDR tem linha_user_id — as duas já têm índice
-- próprio. Este cobre a que vem direto da Meta sem nenhum dos dois.
create unique index if not exists uq_qs_wa_messages_source_meta
  on public.qs_wa_messages (source_id)
  where cw_message_id is null and linha_user_id is null and source_id is not null;

-- ── Gravar uma mensagem que veio da Meta ───────────────────────────────────
create or replace function public.qs_wa_ingest_meta(
  p_lead        uuid,
  p_linha       uuid,
  p_source      text,
  p_direction   text,
  p_content     text,
  p_attachments jsonb default '[]'::jsonb,
  p_sender      text default null,
  p_sent_at     timestamptz default now(),
  p_status      text default null,
  p_reply_to    text default null,
  p_reply_prev  text default null,
  p_inbox       integer default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at   timestamptz := coalesce(p_sent_at, now());
  v_id   uuid;
begin
  if coalesce(p_source, '') = '' then
    raise exception 'qs_wa_ingest_meta: source obrigatório';
  end if;

  -- Já existe? (pode ter entrado pelo Chatwoot com o prefixo WAID:, ou ser
  -- retentativa da Meta). Só completa o que faltava.
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
    -- cliente acabou de escrever = janela de 24h aberta de novo
    can_reply      = case when excluded.last_direction = 'in' then true else qs_wa_threads.can_reply end,
    last_message   = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_message else qs_wa_threads.last_message end,
    last_direction = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.last_direction else qs_wa_threads.last_direction end,
    last_at        = greatest(coalesce(qs_wa_threads.last_at, excluded.last_at), excluded.last_at),
    last_in_at     = greatest(qs_wa_threads.last_in_at,  excluded.last_in_at),
    last_out_at    = greatest(qs_wa_threads.last_out_at, excluded.last_out_at),
    unread         = qs_wa_threads.unread + excluded.unread;
  return true;
end $$;

-- Recibo pelo wamid: ✓ → ✓✓ → azul, só pra frente. Falha sempre entra.
create or replace function public.qs_wa_status_meta(p_source text, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordem int := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3
                               when 'failed' then 9 else 0 end;
  v_rows int;
begin
  if v_ordem = 0 or coalesce(p_source, '') = '' then return false; end if;
  update qs_wa_messages
     set status = p_status
   where source_id in (p_source, 'WAID:' || p_source)
     and (case coalesce(status, '') when 'sent' then 1 when 'delivered' then 2 when 'read' then 3
                                    when 'failed' then 9 else 0 end) < v_ordem;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.qs_wa_ingest_meta(uuid, uuid, text, text, text, jsonb, text, timestamptz, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.qs_wa_status_meta(text, text) from public, anon, authenticated;
grant execute on function public.qs_wa_ingest_meta(uuid, uuid, text, text, text, jsonb, text, timestamptz, text, text, text, integer) to service_role;
grant execute on function public.qs_wa_status_meta(text, text) to service_role;

-- O número oficial de hoje (+55 11 4863-6051), compartilhado. A caixa 3 é a
-- dele no Chatwoot (é ela que a tela reconhece como "oficial").
insert into public.qs_wa_numeros_meta (phone_number_id, user_id, rotulo, cw_inbox_id)
values ('1126057943914647', null, 'Oficial +55 11 4863-6051', 3)
on conflict (phone_number_id) do nothing;
