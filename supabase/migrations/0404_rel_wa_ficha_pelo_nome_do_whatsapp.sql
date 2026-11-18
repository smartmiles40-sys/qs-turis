-- supabase/migrations/0404_rel_wa_ficha_pelo_nome_do_whatsapp.sql
-- -----------------------------------------------------------------------------
-- CONVERSA LIGADA À FICHA ERRADA (Bruno, 18/11/2026)
--   "Maria Tais → Eduardo Regis", "Lara → Deise Moreira": o Rel mandou mensagem
--   chamando a pessoa errada. Causa: quando duas fichas têm o mesmo número
--   (mãe e filha, casal), rel_cliente_do_telefone pegava a que tinha o número
--   escrito IGUAL (558599941003 = Daíse) e ignorava a do nono dígito
--   (5585999941003 = Lara) — e nunca olhava o nome que a Meta manda
--   (contacts[].profile.name → rel_wa_conversas.nome_contato = "Lara Moreira").
--
-- 1. rel_cliente_do_telefone(p_telefone, p_nome): junta exato + nono dígito e,
--    se o 1º nome do WhatsApp bate com UMA das fichas, fica com ela. Sem nome
--    ou sem bater: a regra antiga (exato primeiro, titular, senão null).
-- 2. rel_wa_ingest passa o p_nome (troca só a chamada, via functiondef).
-- 3. Conserta a conversa da Lara (558599941003 → ficha da Lara).
-- -----------------------------------------------------------------------------

create or replace function public.rel_nome_primeiro(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(lower(translate(split_part(btrim(regexp_replace(coalesce(p, ''), '[^[:alpha:] ]', ' ', 'g')), ' ', 1),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '')
$$;

create or replace function public.rel_cliente_do_telefone(p_telefone text, p_nome text)
returns uuid language sql stable set search_path to 'public' as $function$
  with exato as (
    select id, titular_id, nome, 0 as ordem from rel_clientes
     where telefone = p_telefone and mesclado_em_id is null and arquivado_em is null
  ), chave as (
    select id, titular_id, nome, 1 as ordem from rel_clientes
     where rel_fone_chave(telefone) = rel_fone_chave(p_telefone) and mesclado_em_id is null and arquivado_em is null
       and id not in (select id from exato)
  ), todos as (select * from exato union all select * from chave),
  pn as (select rel_nome_primeiro(p_nome) as n),
  -- o 1º nome do WhatsApp aparece como palavra inteira no nome da ficha
  bate as (
    select t.id from todos t, pn
     where length(pn.n) >= 3
       and (' ' || lower(translate(regexp_replace(t.nome, '[^[:alpha:] ]', ' ', 'g'),
              'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')) || ' ')
           like '% ' || pn.n || ' %'
  )
  select case
    when (select count(*) from bate) = 1 then (select id from bate)
    else public.rel_cliente_do_telefone(p_telefone)
  end;
$function$;

-- 2. rel_wa_ingest: a ficha escolhida também olha o nome do WhatsApp.
do $$
declare d text := pg_get_functiondef('public.rel_wa_ingest(text,text,text,text,text,text,text,jsonb,timestamptz,uuid,text,text,text)'::regprocedure);
begin
  if position('rel_cliente_do_telefone(fone)' in d) = 0 then
    raise notice '0404: rel_wa_ingest já não chama rel_cliente_do_telefone(fone) — nada trocado';
  else
    execute replace(d, 'rel_cliente_do_telefone(fone)', 'rel_cliente_do_telefone(fone, p_nome)');
  end if;
end $$;

-- 3. Lara (WhatsApp "Lara Moreira") estava ligada à ficha da mãe (Daíse).
update rel_wa_conversas
   set cliente_id = '59b720b2-d272-4544-8e28-893db442513d'
 where telefone = '558599941003'
   and cliente_id = 'cc95b06f-327d-4191-9288-370631db7770';
