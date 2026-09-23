-- =============================================================================
-- 0088 — O DISTRIBUIDOR DAS LPs RESPEITA A LIGAÇÃO JÁ MARCADA
-- -----------------------------------------------------------------------------
-- Bruno, 23/09/2026: ligar o distribuidor da 0076 (LP -> WhatsApp do SDR da
-- vez). No tráfego, o formulário tem ANTES do WhatsApp a etapa "marque uma
-- ligação de 5 min com o SDR" (qs_ligacoes_sdr). Quem marcou com a Mariana tem
-- que cair no WhatsApp da Mariana — não no próximo da roda. Senão a pessoa
-- conversa com um SDR e recebe a ligação de outro.
--
-- Única mudança na reservar_sdr (partindo da versão VIGENTE no banco): antes do
-- bilhete e do dono do card, olha se esse telefone marcou ligação com SDR nas
-- últimas 24h. Achou -> é esse SDR (se ele tiver chip ativo).
-- =============================================================================

create or replace function public.reservar_sdr(
  p_nome      text default null,
  p_telefone  text default null,
  p_email     text default null,
  p_origem    text default null,
  p_expedicao text default null,
  p_fila      text default 'forms'
)
returns table (reserva_id uuid, sdr_id uuid, sdr_nome text, numero text, reaproveitado boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tel   text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v_chave text := qs_tel_chave(p_telefone);
  v_fila  text := coalesce(nullif(btrim(lower(p_fila)), ''), 'forms');
  v_sdr   uuid;
  v_reap  boolean := false;
  v_num   text;
  v_nome  text;
  v_id    uuid;
begin
  if v_chave is null then
    raise exception 'telefone invalido' using errcode = '22023';
  end if;

  -- (0) LIGAÇÃO MARCADA AGORA HÁ POUCO: o SDR da ligação é o do WhatsApp.
  select g.sdr_id into v_sdr
    from qs_ligacoes_sdr g
    join qs_leads l on l.id = g.lead_id
   where qs_tel_chave(l.phone) = v_chave
     and g.sdr_id is not null
     and g.status = 'marcada'
     and g.created_at > now() - interval '24 hours'
   order by g.created_at desc
   limit 1;

  -- (a) Lead recorrente: bilhete dos últimos 30 dias.
  if v_sdr is null then
    select r.sdr_id into v_sdr
      from sdr_reservas r
     where r.chave = v_chave
       and r.sdr_id is not null
       and r.created_at > now() - interval '30 days'
     order by r.created_at desc
     limit 1;
  end if;

  -- Sem bilhete? O dono do card (o rodízio do QS já decidiu).
  if v_sdr is null then
    select l.owner_id into v_sdr
      from qs_leads l
     where qs_tel_chave(l.phone) = v_chave
       and l.owner_id is not null
       and l.created_at > now() - interval '30 days'
     order by l.created_at desc
     limit 1;
  end if;

  if v_sdr is not null then
    if exists (select 1 from sdr_pool p where p.sdr_id = v_sdr and p.status = 'ativo') then
      v_reap := true;
    else
      v_sdr := null;
    end if;
  end if;

  -- (b) A roda.
  if v_sdr is null then
    v_sdr := qs_proximo_sdr('fila:' || v_fila, qs_sdrs_no_rodizio());
  end if;

  if v_sdr is null then
    return;
  end if;

  select p.numero, coalesce(u.name, p.sdr_nome)
    into v_num, v_nome
    from sdr_pool p
    left join qs_users u on u.id = p.sdr_id
   where p.sdr_id = v_sdr and p.status = 'ativo'
   limit 1;

  insert into sdr_reservas (telefone, chave, sdr_id, numero, fila, origem, expedicao, nome)
       values (v_tel, v_chave, v_sdr, v_num, v_fila,
               nullif(btrim(coalesce(p_origem, '')), ''),
               nullif(btrim(coalesce(p_expedicao, '')), ''),
               nullif(btrim(coalesce(p_nome, '')), ''))
    returning sdr_reservas.id into v_id;

  reserva_id    := v_id;
  sdr_id        := v_sdr;
  sdr_nome      := v_nome;
  numero        := v_num;
  reaproveitado := v_reap;
  return next;
end;
$fn$;

revoke all on function public.reservar_sdr(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reservar_sdr(text, text, text, text, text, text) to service_role;
