-- 0312 — Relacionamento: o mesmo cliente com e sem o nono dígito vira UMA conversa (05/11/2026)
--
-- O QS manda pro número da ficha (55 31 9 9113-3653) e a Meta devolve a resposta
-- do cliente pelo wa_id dele (55 31 9113-3653, sem o 9). O rel_wa_ingest
-- abria uma conversa pra cada grafia: a resposta do cliente ficava numa conversa
-- e o que o time mandou, em outra (2 casos em 05/11).
--
-- Agora: telefone de celular BR (55 + DDD + 8/9 dígitos) procura primeiro a
-- conversa que já existe em QUALQUER das duas grafias e usa ela — a mais ativa,
-- se houver as duas. As 2 conversas duplicadas de hoje têm as mensagens movidas
-- pra conversa onde o cliente realmente escreve (a outra fica vazia, nada é apagado).

create or replace function public.rel_wa_variante_br(p text)
returns text language sql immutable as $$
  select case
    when p ~ '^55\d{2}9\d{8}$'     then substr(p, 1, 4) || substr(p, 6)
    when p ~ '^55\d{2}[6-9]\d{7}$' then substr(p, 1, 4) || '9' || substr(p, 5)
  end;
$$;

CREATE OR REPLACE FUNCTION public.rel_wa_ingest(p_phone_id text, p_telefone text, p_nome text, p_wamid text, p_direcao text, p_origem text, p_texto text, p_anexos jsonb DEFAULT '[]'::jsonb, p_enviada_em timestamp with time zone DEFAULT now(), p_autor uuid DEFAULT NULL::uuid, p_autor_nome text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_resp text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sem_numero boolean := coalesce(p_telefone, '') ~ '^lid:\d{6,24}$';
  fone  text := case when coalesce(p_telefone, '') ~ '^lid:\d{6,24}$' then p_telefone
                     else regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') end;
  alt   text;
  ja_fone text;
  conv  rel_wa_conversas;
  nova  boolean;
  meta  int;
  v_chave text;
  ja    rel_wa_mensagens;
begin
  if fone = '' or coalesce(p_wamid, '') = '' then return jsonb_build_object('ok', false); end if;

  -- 0312: com ou sem o nono dígito = a mesma conversa
  if not sem_numero then
    alt := rel_wa_variante_br(fone);
    if alt is not null then
      perform pg_advisory_xact_lock(hashtextextended('rel_wa_fone:' || p_phone_id || ':' || least(fone, alt), 0));
      select telefone into ja_fone from rel_wa_conversas
       where phone_number_id = p_phone_id and telefone in (fone, alt)
       order by greatest(coalesce(ultima_entrada_em, '-infinity'), coalesce(ultima_saida_em, '-infinity')) desc, telefone = fone desc
       limit 1;
      if ja_fone is not null then fone := ja_fone; end if;
    end if;
  end if;

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

-- As duplicadas que já existem: as mensagens da conversa menos ativa vão pra mais ativa.
with pares as (
  select a.id as id_a, b.id as id_b,
         greatest(coalesce(a.ultima_entrada_em, '-infinity'), coalesce(a.ultima_saida_em, '-infinity')) as ativ_a,
         greatest(coalesce(b.ultima_entrada_em, '-infinity'), coalesce(b.ultima_saida_em, '-infinity')) as ativ_b,
         (select count(*) from rel_wa_mensagens where conversa_id = a.id) as n_a,
         (select count(*) from rel_wa_mensagens where conversa_id = b.id) as n_b
    from rel_wa_conversas a
    join rel_wa_conversas b
      on b.phone_number_id = a.phone_number_id
     and a.telefone ~ '^55\d{2}9\d{8}$'
     and b.telefone = rel_wa_variante_br(a.telefone)
)
select case when n_a > n_b or (n_a = n_b and ativ_a >= ativ_b) then id_b else id_a end as de,
       case when n_a > n_b or (n_a = n_b and ativ_a >= ativ_b) then id_a else id_b end as para
  into temp rel_0312_mover
  from pares;

update rel_wa_mensagens m set conversa_id = v.para
  from rel_0312_mover v where m.conversa_id = v.de;

-- a que ficou com tudo herda as datas; a vazia perde as dela (pra nunca mais ser
-- escolhida como "a mais ativa" pelo rel_wa_ingest)
update rel_wa_conversas c set
  ultima_entrada_em = greatest(c.ultima_entrada_em, d.ultima_entrada_em),
  ultima_saida_em   = greatest(c.ultima_saida_em, d.ultima_saida_em),
  cliente_id        = coalesce(c.cliente_id, d.cliente_id),
  nome_contato      = coalesce(c.nome_contato, d.nome_contato),
  atualizado_em     = now()
  from rel_0312_mover v join rel_wa_conversas d on d.id = v.de
 where c.id = v.para;

update rel_wa_conversas c set
  ultima_entrada_em = null, ultima_saida_em = null, aguardando_desde = null, nao_lidas = 0,
  ultima_mensagem = '↪ mensagens movidas para a conversa com a outra grafia do número (0312)'
  from rel_0312_mover v where c.id = v.de;

drop table rel_0312_mover;
