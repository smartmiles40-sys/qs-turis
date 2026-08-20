-- 0056_linhas_do_time.sql
-- =============================================================================
-- AS LINHAS DO TIME — cada papel fala pelo SEU número, dentro do QS.
--
-- POR QUE EXISTE (Bruno, 20/08/2026). O QS tinha UM número padrão
-- (CHATWOOT_DEFAULT_INBOX_ID) e todo mundo escrevia por ele. Isso funciona
-- enquanto só a SDR fala. Quebra na virada pro closer: a SDR prospecta pelo
-- número comercial, o lead é transferido — e o closer, que precisa continuar a
-- conversa, só tem o CELULAR DELE. O cliente passa a receber mensagem de um
-- número pessoal que o QS não vê: não entra no histórico, não conta atividade,
-- não sobrevive à saída do funcionário, e o cliente fica com dois interlocutores
-- sem saber que são a mesma empresa.
--
-- A estrutura tem duas metades. A configuração (qual número é de quem) mora em
-- `qs_settings.wa_caixas` — é config, muda de vez em quando e o gestor edita na
-- tela, não num deploy. O que vem aqui é a metade que precisa do banco:
-- **saber por qual número cada mensagem passou.**
--
-- Sem esta coluna, com duas linhas ativas no mesmo lead a conversa vira uma
-- salada: a bolha do 1935 e a do número oficial ficam idênticas na tela, e
-- ninguém consegue responder "o cliente respondeu pra quem?".
--
-- Aditiva e idempotente. A assinatura do qs_wa_ingest NÃO muda: `p_inbox` já
-- era parâmetro dela (só era usado na thread e ignorado na mensagem), então
-- nenhuma rota precisa ser atualizada junto e a degradação em degraus do
-- _wa.js continua valendo exatamente como está.
-- =============================================================================

alter table qs_wa_messages add column if not exists cw_inbox_id integer;

comment on column qs_wa_messages.cw_inbox_id is
  'Por qual dos NOSSOS números esta mensagem passou (id da caixa no Chatwoot). '
  'Preenchido no ingest a partir da 0056; nulo em mensagem antiga cuja conversa '
  'já não é a que a thread aponta. Serve pro selo "saiu pelo 1935" na bolha.';

-- ── Backfill sem chute ──────────────────────────────────────────────────────
-- Só preenche onde dá pra AFIRMAR: a mensagem pertence à conversa que a thread
-- daquele lead aponta, e essa conversa tem caixa conhecida. Mensagem de uma
-- conversa antiga (o lead mudou de número em algum momento) fica nula de
-- propósito — nulo vira "sem selo" na tela, que é honesto; herdar a caixa da
-- thread carimbaria o número errado numa conversa que saiu por outro.
update qs_wa_messages m
   set cw_inbox_id = t.cw_inbox_id
  from qs_wa_threads t
 where t.lead_id = m.lead_id
   and t.cw_inbox_id is not null
   and m.cw_conversation_id is not null
   and m.cw_conversation_id = t.cw_conversation_id
   and m.cw_inbox_id is null;

-- ── O ingest passa a carimbar a caixa na própria mensagem ───────────────────
-- Cópia fiel da versão vigente (0045 + 0047), com UMA diferença: cw_inbox_id
-- entra no insert. Recriada por inteiro porque `create or replace` exige o
-- corpo completo — comparar com a definição anterior antes de aplicar é o
-- procedimento se esta migration for reaplicada depois de outra mexer no RPC.
create or replace function public.qs_wa_ingest(
  p_lead uuid, p_conv bigint, p_msg bigint, p_direction text, p_content text,
  p_attachments jsonb default '[]'::jsonb, p_sender text default null,
  p_sent_at timestamptz default now(), p_contact bigint default null,
  p_can_reply boolean default null, p_inbox integer default null,
  p_source text default null, p_status text default null,
  p_reply_to text default null, p_reply_prev text default null
) returns boolean
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rows int := 0;
  v_new  boolean := false;
  v_at   timestamptz := coalesce(p_sent_at, now());
begin
  insert into qs_wa_messages (lead_id, cw_conversation_id, cw_message_id, direction,
                              content, attachments, sender_name, sent_at, source_id,
                              status, reply_to_source_id, reply_preview, cw_inbox_id)
  values (p_lead, p_conv, p_msg, p_direction, p_content,
          coalesce(p_attachments, '[]'::jsonb), p_sender, v_at, nullif(p_source, ''),
          nullif(p_status, ''), nullif(p_reply_to, ''), nullif(p_reply_prev, ''), p_inbox)
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

  -- Mesma ideia pra caixa: mensagem gravada antes da 0056 ganha o selo na
  -- primeira vez que o webhook passar por ela de novo.
  if not v_new and p_inbox is not null then
    update qs_wa_messages
       set cw_inbox_id = p_inbox
     where cw_message_id = p_msg and cw_inbox_id is null;
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
end $function$;

-- =============================================================================
-- A configuração das linhas fica em qs_settings.wa_caixas, no formato:
--
--   {
--     "porPapel":   { "sdr": 3, "closer": 4 },            -- papel  → id da caixa
--     "porUsuario": { "<uuid do usuário>": 4 },            -- exceção, vence o papel
--     "instancias": { "4": "Comercial - Closers (1935)" }  -- caixa → instância Evolution
--   }
--
-- AUSENTE = COMPORTAMENTO DE HOJE. O servidor devolve "sem linha" e cada rota
-- cai no CHATWOOT_DEFAULT_INBOX_ID de sempre. É de propósito: o front sobe pela
-- Vercel antes de alguém configurar, e um mapa pela metade não pode desviar a
-- mensagem de ninguém. Quem preenche é Configurações → Atendimento → Linhas.
--
-- Conferência depois de aplicar:
--   select count(*) filter (where cw_inbox_id is not null) as com_selo,
--          count(*) as total from qs_wa_messages;
--   select cw_inbox_id, count(*) from qs_wa_messages group by 1 order by 2 desc;
-- =============================================================================
