-- 0082_whatsapp_do_sdr.sql
-- -----------------------------------------------------------------------------
-- CADA SDR CONECTA O PRÓPRIO WHATSAPP NO QS (Bruno, 21/09/2026).
--
-- Desde 03/09 cada SDR tem um chip da empresa e trabalha pelo WhatsApp Web —
-- fora do histórico, fora do indicador. Agora o SDR lê o QR DENTRO do QS e a
-- conversa volta pra cá. O transporte é a Evolution DIRETO (sem Chatwoot): foi
-- exatamente o caminho Chatwoot→QS que morreu em 02/09 sem ninguém ver.
--
-- A REGRA DE QUEM VÊ (pedido do Bruno): a mensagem é do NÚMERO. O dono do número
-- vê; admin, gestor e closer veem tudo. Outro SDR não vê — nem se o lead for
-- dele, nem se o lead estiver sem dono (a regra antiga, `qs_owns_lead`, deixava
-- lead sem dono visível pra todo SDR; ela continua valendo só pro histórico
-- antigo, que não tem número carimbado).
--
-- Nada muda sozinho ao aplicar: sem linha em qs_wa_linhas, nenhuma mensagem
-- ganha `linha_user_id` e tudo segue a regra de antes.
-- -----------------------------------------------------------------------------

-- ── A linha de cada SDR ─────────────────────────────────────────────────────
create table if not exists public.qs_wa_linhas (
  user_id        uuid primary key references public.qs_users(id) on delete cascade,
  -- nome da instância na Evolution. Único: é por ele que o webhook descobre
  -- de quem é a mensagem.
  instancia      text not null unique,
  numero         text,
  -- open = no ar · close = deslogado · connecting = esperando o QR
  status         text not null default 'close',
  status_em      timestamptz not null default now(),
  conectado_em   timestamptz,
  -- até onde o histórico do celular já foi puxado pro QS (null = nunca)
  historico_em   timestamptz,
  criado_em      timestamptz not null default now()
);

alter table public.qs_wa_linhas enable row level security;

drop policy if exists qs_wa_linhas_select on public.qs_wa_linhas;
create policy qs_wa_linhas_select on public.qs_wa_linhas
  for select to authenticated
  using (user_id = auth.uid() or qs_is_manager() or qs_is_closer());

-- Escrita só pelo servidor (service_role ignora RLS). O navegador nunca cria
-- nem troca instância: quem vê o QR de um número lê a conversa dele.
revoke insert, update, delete on public.qs_wa_linhas from anon, authenticated;

-- ── Cada mensagem carrega o número por onde passou ─────────────────────────
alter table public.qs_wa_messages add column if not exists linha_user_id uuid
  references public.qs_users(id) on delete set null;
alter table public.qs_wa_threads  add column if not exists linha_user_id uuid
  references public.qs_users(id) on delete set null;

-- Dedupe da Evolution: o id da mensagem no WhatsApp, por número. O QS grava a
-- mensagem na hora do envio e a Evolution devolve a mesma pelo webhook
-- segundos depois — sem este índice, toda mensagem enviada apareceria duas vezes.
create unique index if not exists uq_qs_wa_messages_linha_source
  on public.qs_wa_messages (linha_user_id, source_id)
  where linha_user_id is not null and source_id is not null;

create index if not exists idx_qs_wa_messages_linha
  on public.qs_wa_messages (linha_user_id, sent_at desc)
  where linha_user_id is not null;

-- Triagem: quem escreveu pro número do SDR e não virou lead.
alter table public.qs_wa_descartadas add column if not exists linha_user_id uuid
  references public.qs_users(id) on delete set null;
alter table public.qs_wa_descartadas add column if not exists source_id text;
create unique index if not exists uq_qs_wa_descartadas_source
  on public.qs_wa_descartadas (source_id) where source_id is not null;

-- ── Quem vê a mensagem ──────────────────────────────────────────────────────
-- Parte da policy VIGENTE (espectador OR qs_owns_lead) — ver
-- qs-closers-rls-migracao: nunca recriar a partir da 0007.
drop policy if exists wa_messages_select on public.qs_wa_messages;
create policy wa_messages_select on public.qs_wa_messages
  for select to authenticated
  using (
    (select qs_is_espectador())
    or (linha_user_id is null and qs_owns_lead(lead_id))
    or linha_user_id = (select auth.uid())
    or (select qs_is_manager())
    or (select qs_is_closer())
  );

-- A lista de conversas: além da regra de sempre, o dono do número enxerga a
-- conversa que passou por ele, mesmo que o lead tenha mudado de dono.
drop policy if exists wa_threads_select on public.qs_wa_threads;
create policy wa_threads_select on public.qs_wa_threads
  for select to authenticated
  using (qs_owns_lead(lead_id) or linha_user_id = (select auth.uid()));

-- O SDR vê a própria triagem (quem escreveu pro número DELE).
drop policy if exists qs_wa_descartadas_leitura on public.qs_wa_descartadas;
create policy qs_wa_descartadas_leitura on public.qs_wa_descartadas
  for select to authenticated
  using (qs_is_manager() or linha_user_id = (select auth.uid()));

-- ── Gravação de mensagem que chega pela Evolution ──────────────────────────
-- Irmã da qs_wa_ingest (que é do Chatwoot e deduplica por cw_message_id).
-- Aqui a chave é (número, id no WhatsApp). Devolve true quando a mensagem é nova.
create or replace function public.qs_wa_ingest_linha(
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
  p_reply_prev  text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
  v_new  boolean := false;
  v_at   timestamptz := coalesce(p_sent_at, now());
begin
  if p_linha is null or coalesce(p_source, '') = '' then
    raise exception 'qs_wa_ingest_linha: linha e source são obrigatórios';
  end if;

  insert into qs_wa_messages (lead_id, direction, content, attachments, sender_name,
                              sent_at, source_id, status, reply_to_source_id,
                              reply_preview, linha_user_id)
  values (p_lead, p_direction, p_content, coalesce(p_attachments, '[]'::jsonb),
          p_sender, v_at, p_source, nullif(p_status, ''), nullif(p_reply_to, ''),
          nullif(p_reply_prev, ''), p_linha)
  on conflict (linha_user_id, source_id)
    where linha_user_id is not null and source_id is not null
  do nothing;

  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  if not v_new then
    -- Eco de uma mensagem que o QS já gravou: só completa o que faltava.
    update qs_wa_messages
       set sender_name = coalesce(sender_name, p_sender),
           attachments = case when attachments = '[]'::jsonb then coalesce(p_attachments, '[]'::jsonb)
                              else attachments end
     where linha_user_id = p_linha and source_id = p_source;
    if coalesce(p_status, '') <> '' then
      perform qs_wa_status_linha(p_linha, p_source, p_status);
    end if;
    return false;
  end if;

  insert into qs_wa_threads (lead_id, linha_user_id, last_message, last_direction,
                             last_at, unread, can_reply, last_in_at, last_out_at)
  values (p_lead, p_linha, left(coalesce(p_content, ''), 500), p_direction, v_at,
          case when p_direction = 'in' then 1 else 0 end,
          -- número comum não tem janela de 24h: sempre dá pra responder
          true,
          case when p_direction = 'in'  then v_at end,
          case when p_direction = 'out' then v_at end)
  on conflict (lead_id) do update set
    linha_user_id  = case when qs_wa_threads.last_at is null or excluded.last_at >= qs_wa_threads.last_at
                          then excluded.linha_user_id else qs_wa_threads.linha_user_id end,
    can_reply      = true,
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

-- Recibo (✓ enviada → ✓✓ entregue → azul lida). Só avança, nunca volta: a
-- Evolution às vezes entrega o DELIVERY_ACK depois do READ.
create or replace function public.qs_wa_status_linha(p_linha uuid, p_source text, p_status text)
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
  if v_ordem = 0 then return false; end if;
  update qs_wa_messages
     set status = p_status
   where linha_user_id = p_linha and source_id = p_source
     and (case coalesce(status, '') when 'sent' then 1 when 'delivered' then 2 when 'read' then 3
                                    when 'failed' then 9 else 0 end) < v_ordem;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- Só o servidor chama. No Supabase, revogar de PUBLIC não basta: ele concede
-- EXECUTE direto a anon/authenticated (lição do SendFlow, 16/09).
revoke all on function public.qs_wa_ingest_linha(uuid, uuid, text, text, text, jsonb, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.qs_wa_status_linha(uuid, text, text) from public, anon, authenticated;
grant execute on function public.qs_wa_ingest_linha(uuid, uuid, text, text, text, jsonb, text, timestamptz, text, text, text) to service_role;
grant execute on function public.qs_wa_status_linha(uuid, text, text) to service_role;

-- ── Mídia recebida/enviada pelo número do SDR ──────────────────────────────
-- A Evolution entrega a mídia criptografada; o servidor baixa, guarda aqui e a
-- bolha aponta pra cá. Público como eram as URLs do Chatwoot, com caminho
-- aleatório (ninguém adivinha).
insert into storage.buckets (id, name, public)
values ('wa-midia', 'wa-midia', true)
on conflict (id) do nothing;

-- O SDR também TRATA a própria triagem (criar lead / ignorar), não só vê.
-- A policy de UPDATE da 0047 é só da gestão; esta soma a linha do SDR.
drop policy if exists qs_wa_descartadas_tratamento_linha on public.qs_wa_descartadas;
create policy qs_wa_descartadas_tratamento_linha on public.qs_wa_descartadas
  for update to authenticated
  using (linha_user_id = (select auth.uid()))
  with check (linha_user_id = (select auth.uid()));
