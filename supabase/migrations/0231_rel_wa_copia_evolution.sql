-- 0231_rel_wa_copia_evolution.sql
-- NÃO APLICADA (30/10/2026) — escrita na branch v2-wa, aguarda o ok do Bruno.
--
-- WHATSAPP DO RELACIONAMENTO: a Evolution vira CÓPIA DE RESERVA do 1:1.
--
-- O que aconteceu em 29/10/2026: a Meta entregou no /api/wa-calls quatro mensagens
-- de clientes (Felipe 13:34:37/38 UTC; Rafael 13:34:52 — respondendo NO PRIVADO a
-- mensagem do grupo "Expedição Tailândia - G1 2026" —; Rafael 13:52:18). O banco
-- não respondeu em 10 s ("PostgREST não respondeu em 10000ms"), a gravação falhou
-- calada, a Meta recebeu 200 e não reenviou. As 4 só existiam na Evolution, que
-- jogava fora tudo que não é grupo.
--
-- O código novo (api/_relGruposPrivado.js) grava a cópia da Evolution com wamid
-- "evo:<id do WhatsApp>". O MESMO id está dentro do wamid da Meta (protobuf em
-- base64, termina em 0x18 <tam> <id> 0x00) — é por ele que as duas cópias se acham.
-- O código já funciona SEM esta migration (deduplica no JS). Esta migration:
--   1) rel_wa_chave(wamid) → o id do WhatsApp (+ índice): achar a cópia é 1 consulta;
--   2) rel_wa_ingest deduplica pela chave com TRAVA (pg_advisory_xact_lock): se a
--      Meta e a Evolution chegarem no mesmo segundo, não vira bolha repetida. Se a
--      linha que já existe é a da Evolution e chegou a da Meta, a Meta "assume"
--      (wamid oficial, status, autor do QS);
--   3) rel_wa_mensagens.via ('aparelho') e .grupo_citado (jsonb: jid, nome, msg_id,
--      autor, texto) — o selo "veio pelo aparelho" e "respondendo no privado ao grupo X";
--   4) conversa SEM NÚMERO: quem chega só como @lid, sem telefone resolvível, entra
--      numa conversa "lid:<código>" (sem SLA) pra nada se perder. O rel-wa recusa
--      responder a ela (não há telefone; e pela Evolution nunca sai pra pessoa).
--
-- O corpo de rel_wa_ingest é IGUAL ao vigente (0145) fora os blocos marcados "0231".
-- Idempotente: pode rodar de novo.
-- ---------------------------------------------------------------------------

-- ── 1) a chave ───────────────────────────────────────────────────────────────
create or replace function public.rel_wa_chave(p_wamid text)
returns text
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  s   text;
  b   bytea;
  n   int;
  l   int;
  r   text;
begin
  if p_wamid like 'evo:%' then return nullif(substr(p_wamid, 5), ''); end if;
  if p_wamid not like 'wamid.%' then return null; end if;
  s := substr(p_wamid, 7);
  s := rpad(s, ((length(s) + 3) / 4) * 4, '=');
  begin
    b := decode(s, 'base64');
  exception when others then
    return null;
  end;
  n := length(b);
  if n < 12 or get_byte(b, n - 1) <> 0 then return null; end if;
  for l in 8..64 loop
    exit when n - 3 - l < 0;
    if get_byte(b, n - 2 - l) = l and get_byte(b, n - 3 - l) = 24 then
      r := convert_from(substring(b from n - l for l), 'SQL_ASCII');
      if r ~ '^[0-9A-Za-z]+$' then return r; end if;
    end if;
  end loop;
  return null;
end;
$$;

create index if not exists rel_wa_mensagens_chave_idx
  on public.rel_wa_mensagens (public.rel_wa_chave(wamid));

-- ── 3) selo + grupo citado ───────────────────────────────────────────────────
alter table public.rel_wa_mensagens
  add column if not exists via text,
  add column if not exists grupo_citado jsonb;

comment on column public.rel_wa_mensagens.via is
  '0231: ''aparelho'' = gravada pela cópia da Evolution (o wamid começa com evo: enquanto a Meta não entregar a dela).';
comment on column public.rel_wa_mensagens.grupo_citado is
  '0231: a mensagem responde NO PRIVADO a uma mensagem de grupo: {jid, nome, msg_id, autor, texto}.';

-- ── 4) conversa sem número ("lid:<código>") ──────────────────────────────────
alter table public.rel_wa_conversas drop constraint if exists rel_wa_conversas_telefone_check;
alter table public.rel_wa_conversas add constraint rel_wa_conversas_telefone_check
  check (telefone ~ '^\d{8,15}$' or telefone ~ '^lid:\d{6,24}$');

-- ── 2) rel_wa_ingest com dedupe pela chave ───────────────────────────────────
create or replace function public.rel_wa_ingest(p_phone_id text, p_telefone text, p_nome text, p_wamid text, p_direcao text, p_origem text, p_texto text, p_anexos jsonb DEFAULT '[]'::jsonb, p_enviada_em timestamp with time zone DEFAULT now(), p_autor uuid DEFAULT NULL::uuid, p_autor_nome text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_resp text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- 0231: "lid:<código>" (sem telefone) passa como está; o resto vira só dígitos
  sem_numero boolean := coalesce(p_telefone, '') ~ '^lid:\d{6,24}$';
  fone  text := case when coalesce(p_telefone, '') ~ '^lid:\d{6,24}$' then p_telefone
                     else regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') end;
  conv  rel_wa_conversas;
  nova  boolean;
  meta  int;
  -- 0231
  v_chave text;
  ja    rel_wa_mensagens;
begin
  if fone = '' or coalesce(p_wamid, '') = '' then return jsonb_build_object('ok', false); end if;

  -- 0231: a mesma mensagem pode chegar pela Meta (wamid.…) e pela Evolution (evo:…).
  v_chave := rel_wa_chave(p_wamid);
  if v_chave is not null then
    perform pg_advisory_xact_lock(hashtextextended('rel_wa_chave:' || v_chave, 0));
    select * into ja from rel_wa_mensagens
     where rel_wa_chave(wamid) = v_chave and wamid <> p_wamid
     limit 1;
    if found then
      if ja.wamid like 'evo:%' and p_wamid like 'wamid.%' then
        update rel_wa_mensagens set
          wamid         = p_wamid,
          status        = coalesce(p_status, status),
          origem        = case when p_origem in ('qs', 'automatica') then p_origem else origem end,
          autor_id      = coalesce(p_autor, autor_id),
          autor_nome    = case when p_origem in ('qs', 'automatica') then coalesce(p_autor_nome, autor_nome) else autor_nome end,
          respondendo_a = coalesce(respondendo_a, p_resp),
          anexos        = case when jsonb_array_length(coalesce(anexos, '[]'::jsonb)) = 0 then coalesce(p_anexos, '[]'::jsonb) else anexos end
         where id = ja.id;
      end if;
      return jsonb_build_object('ok', true, 'nova', false, 'conversa', ja.conversa_id, 'duplicada', true);
    end if;
  end if;

  insert into rel_wa_conversas (phone_number_id, telefone, nome_contato, cliente_id, estado, sem_sla, sem_sla_motivo, sem_sla_em)
  values (p_phone_id, fone, nullif(p_nome, ''),
          case when sem_numero then null else rel_cliente_do_telefone(fone) end,
          case when p_direcao = 'in' then 'aberta' else 'aguardando_cliente' end,
          sem_numero or length(fone) > 15,
          case when sem_numero then 'sem número identificado' when length(fone) > 15 then 'grupo' end,
          case when sem_numero or length(fone) > 15 then now() end)
  on conflict (phone_number_id, telefone) do update
     set nome_contato = coalesce(nullif(excluded.nome_contato, ''), rel_wa_conversas.nome_contato),
         cliente_id   = coalesce(rel_wa_conversas.cliente_id, excluded.cliente_id)
  returning * into conv;

  insert into rel_wa_mensagens (conversa_id, wamid, direcao, origem, texto, anexos, autor_id, autor_nome, status, respondendo_a, enviada_em)
  values (conv.id, p_wamid, p_direcao, p_origem, coalesce(p_texto, ''), coalesce(p_anexos, '[]'),
          p_autor, p_autor_nome, p_status, p_resp, coalesce(p_enviada_em, now()))
  on conflict (wamid) do nothing;
  nova := found;
  if not nova then return jsonb_build_object('ok', true, 'nova', false, 'conversa', conv.id); end if;

  if p_origem = 'historico' then
    update rel_wa_conversas set
      ultima_entrada_em = case when p_direcao = 'in' then greatest(ultima_entrada_em, p_enviada_em) else ultima_entrada_em end,
      ultima_saida_em   = case when p_direcao = 'out' then greatest(ultima_saida_em, p_enviada_em) else ultima_saida_em end,
      atualizado_em     = greatest(atualizado_em, p_enviada_em)
     where id = conv.id;
    return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
  end if;

  if p_direcao = 'in' then
    -- 0145: a nota da pesquisa não reabre a conversa nem liga o relógio.
    if rel_wa_atend_mensagem(conv.id, 'in', p_origem, p_autor, coalesce(p_enviada_em, now()), p_texto) = 'csat' then
      update rel_wa_conversas set
        ultima_entrada_em = p_enviada_em,
        ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
        atualizado_em     = now()
       where id = conv.id;
      return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id, 'csat', true);
    end if;
    update rel_wa_conversas set
      estado            = 'aberta',
      aguardando_desde  = case when sem_sla then null else coalesce(aguardando_desde, p_enviada_em) end,
      ultima_entrada_em = p_enviada_em,
      ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      nao_lidas         = nao_lidas + 1,
      atualizado_em     = now()
     where id = conv.id;
  else
    if conv.aguardando_desde is not null and p_origem <> 'automatica' and not conv.sem_sla then
      select coalesce((valor ->> 'resposta_min')::int, 30) into meta from rel_config where chave = 'sla';
      insert into rel_wa_sla (conversa_id, atendente_id, esperou_desde, respondido_em, minutos_uteis, meta_min)
      values (conv.id, coalesce(p_autor, conv.atendente_id), conv.aguardando_desde, p_enviada_em,
              rel_minutos_uteis(conv.aguardando_desde, p_enviada_em), coalesce(meta, 30));
    end if;
    perform rel_wa_atend_mensagem(conv.id, 'out', p_origem, p_autor, coalesce(p_enviada_em, now()), p_texto);
    update rel_wa_conversas set
      estado           = case when p_origem = 'automatica' then estado else 'aguardando_cliente' end,
      aguardando_desde = case when p_origem = 'automatica' then aguardando_desde else null end,
      nao_lidas        = case when p_origem = 'automatica' then nao_lidas else 0 end,
      atendente_id     = coalesce(atendente_id, p_autor),
      ultima_saida_em  = p_enviada_em,
      ultima_mensagem  = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      auto_resposta_em = case when p_origem = 'automatica' then now() else auto_resposta_em end,
      atualizado_em    = now()
     where id = conv.id;
  end if;
  return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
end;
$function$;

revoke all on function public.rel_wa_ingest(text, text, text, text, text, text, text, jsonb, timestamptz, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rel_wa_chave(text) from public, anon;

-- ---------------------------------------------------------------------------
-- ROLLBACK (rodar à mão, nesta ordem). Antes: conferir que não há conversa
-- "lid:" (select count(*) from rel_wa_conversas where telefone like 'lid:%') —
-- se houver, decidir o que fazer com elas, senão a trava antiga não volta.
--
--   -- volta o rel_wa_ingest da 0145 (copiar o create or replace de
--   -- supabase/migrations/0145_rel_atendimentos.sql, bloco "rel_wa_ingest").
--   alter table public.rel_wa_conversas drop constraint if exists rel_wa_conversas_telefone_check;
--   alter table public.rel_wa_conversas add constraint rel_wa_conversas_telefone_check check (telefone ~ '^\d{8,15}$');
--   drop index if exists public.rel_wa_mensagens_chave_idx;
--   alter table public.rel_wa_mensagens drop column if exists grupo_citado, drop column if exists via;
--   drop function if exists public.rel_wa_chave(text);
-- ---------------------------------------------------------------------------
