-- supabase/migrations/0334_closer_trocar_responsavel.sql
-- -----------------------------------------------------------------------------
-- TROCAR O RESPONSÁVEL DO CARTÃO DO CLOSER (Bruno, 09/11/2026)
--   "como mudar o responsável do card de uma forma mais fácil! Assim fica bem
--    mais fácil dos responsáveis gerirem os leads na posse das pessoas"
--
-- Caso que motivou: o Fabrício (venda do Bruno Matheus, 16/09) foi trazido do
-- Bitrix pela conta Master em 06/11. O cartão ficou com o Master e, quando o
-- Bruno Matheus tentou trazer de novo (3x em 09/11), a closer_negocio_trazer
-- devolvia o MESMO cartão sem mudar o dono: ele nunca via o cliente.
--
-- 1) closer_negocio_trocar_closer(negocio, closer, motivo): o gestor comercial
--    (ou admin) passa qualquer cartão; o closer passa o PRÓPRIO cartão pra um
--    colega. O lead acompanha se estava com o closer antigo. Fica no histórico.
-- 2) closer_negocio_trazer: se o cartão aberto está com quem NÃO é closer ativo
--    (Master/admin, gestor, desligado), passa pra quem está trazendo.
--    Se está com outro closer ativo, continua com ele (a tela avisa com quem está).
-- Volta: drop function closer_negocio_trocar_closer; recriar a trazer da 0181.
-- -----------------------------------------------------------------------------

create or replace function closer_negocio_trocar_closer(p_negocio uuid, p_closer uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
  de_nome text; para_nome text;
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  -- Gestor/admin passa qualquer um; o closer só o dele.
  if not (qs_is_manager() or n.closer_id = auth.uid()) then raise exception 'sem-permissao'; end if;
  select name into para_nome from qs_users where id = p_closer and is_active and role in ('closer', 'gestor', 'admin');
  if para_nome is null then raise exception 'closer-invalido'; end if;
  if n.closer_id = p_closer then return; end if;
  select name into de_nome from qs_users where id = n.closer_id;

  update qs_closer_negocios set closer_id = p_closer where id = p_negocio;
  -- O lead acompanha quando estava com o closer antigo (não mexe se está com um SDR).
  update qs_leads set owner_id = p_closer where id = n.lead_id and (owner_id = n.closer_id or owner_id is null);

  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (p_negocio, 'nota',
          'Responsável: ' || coalesce(de_nome, 'ninguém') || ' → ' || para_nome
            || coalesce(' · ' || nullif(trim(coalesce(p_motivo, '')), ''), ''),
          auth.uid());
end $$;
revoke all on function closer_negocio_trocar_closer(uuid, uuid, text) from public, anon;
grant execute on function closer_negocio_trocar_closer(uuid, uuid, text) to authenticated;

create or replace function public.closer_negocio_trazer(p_lead uuid, p_closer uuid, p_texto text, p_valor numeric default null::numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  nid uuid;
  dono uuid;
  dono_closer boolean;
begin
  select id, closer_id into nid, dono from qs_closer_negocios
   where lead_id = p_lead and arquivado_em is null and not closer_etapa_final(etapa);
  if nid is not null then
    -- 0334: cartão parado com quem não é closer ativo (Master, gestor, desligado) → vai pra quem está trazendo.
    select exists (select 1 from qs_users where id = dono and is_active and role = 'closer') into dono_closer;
    if p_closer is not null and dono is distinct from p_closer and not coalesce(dono_closer, false) then
      update qs_closer_negocios set closer_id = p_closer where id = nid;
      update qs_leads set owner_id = p_closer where id = p_lead and (owner_id = dono or owner_id is null);
      insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
      values (nid, 'nota', 'Responsável: ' || coalesce((select name from qs_users where id = dono), 'ninguém') || ' → '
              || coalesce((select name from qs_users where id = p_closer), '?') || ' · trouxe do Bitrix', coalesce(auth.uid(), p_closer));
    end if;
    return nid;
  end if;
  select id into nid from qs_closer_negocios
   where lead_id = p_lead and arquivado_em is not null and not closer_etapa_final(etapa)
   order by criado_em desc limit 1;
  if nid is not null then
    update qs_closer_negocios set
      arquivado_em = null, arquivado_motivo = null,
      closer_id = coalesce(p_closer, closer_id),
      valor_previsto = coalesce(nullif(p_valor, 0), valor_previsto),
      etapa = case when etapa in ('aguardando_reuniao','reagendamento','no_show') then 'em_cotacao' else etapa end,
      bitrix_etapa = null
     where id = nid;
  else
    insert into qs_closer_negocios (lead_id, closer_id, etapa, valor_previsto)
    values (p_lead, p_closer, 'em_cotacao', nullif(p_valor, 0)) returning id into nid;
  end if;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, autor_id)
  values (nid, 'criado', (select etapa from qs_closer_negocios where id = nid), p_texto, coalesce(auth.uid(), p_closer));
  perform closer_negocio_recalcular(nid);
  return nid;
end;
$function$;
