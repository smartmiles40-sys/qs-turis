-- 0282 — Contrato: carimbo de envio do cartão no REENVIO (03/11/2026)
-- -----------------------------------------------------------------------------
-- Revisão do contrato (03/11): quando o closer substitui um contrato enviado por
-- um novo, o cartão já estava em status_contrato = 'enviado'. A RPC só mexia no
-- cartão se o status MUDASSE, e o gatilho da 0174 só carimba
-- contrato_enviado_em quando está vazio — então o cartão ficava com a data do
-- PRIMEIRO envio, e o "contrato_assinado_em" de um contrato anterior não era
-- limpo ao reenviar.
--
-- Agora: o contrato MAIS RECENTE indo pra 'enviado' sempre carimba
-- contrato_enviado_em = agora e zera contrato_assinado_em. O resto é idêntico à
-- versão vigente (conferida no banco em 03/11 com pg_get_functiondef).
-- Só arquivo: aplicar com o ok do Bruno.
-- -----------------------------------------------------------------------------

create or replace function public.contrato_registrar_status(p_contrato uuid, p_status text, p_extra jsonb default '{}'::jsonb, p_autor uuid default null::uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c        qs_contratos;
  n        qs_closer_negocios;
  v_extra  jsonb := coalesce(p_extra, '{}'::jsonb);
  v_viu    int := nullif(v_extra ->> 'visualizacoes', '')::int;
  v_texto  text;
begin
  if p_status not in ('enviado','visualizado','assinado','recusado','cancelado','erro') then raise exception 'status-invalido'; end if;
  select * into c from qs_contratos where id = p_contrato for update;
  if not found then raise exception 'contrato-nao-encontrado'; end if;

  -- Links/contagem chegam mesmo sem mudar de status (ex.: o PDF assinado arquivado depois).
  update qs_contratos set
    pdf_assinado_url = coalesce(nullif(v_extra ->> 'pdf_assinado_url', ''), pdf_assinado_url),
    link_assinatura  = coalesce(nullif(v_extra ->> 'link_assinatura', ''), link_assinatura),
    visualizacoes    = greatest(visualizacoes, coalesce(v_viu, 0))
   where id = c.id;

  -- Já está no mesmo status ou o novo é "pra trás": nada muda (idempotente).
  if c.status = p_status
     or (c.status = 'assinado')
     or (c.status = 'cancelado' and p_status <> 'assinado')
     -- Recusado ainda pode ser cancelado pelo closer (fecha o envio de vez).
     or (c.status = 'recusado' and p_status not in ('assinado','cancelado'))
     or (p_status <> 'erro' and contrato_status_ordem(p_status) < contrato_status_ordem(c.status))
     or (p_status = 'erro' and c.status <> 'gerando') then
    return c.status;
  end if;

  update qs_contratos set
    status         = p_status,
    erro           = case when p_status = 'erro' then left(coalesce(v_extra ->> 'erro', 'Falhou.'), 1000) else null end,
    enviado_em     = case when p_status in ('enviado','visualizado','assinado') then coalesce(enviado_em, now()) else enviado_em end,
    visualizado_em = case when p_status in ('visualizado','assinado') then coalesce(visualizado_em, nullif(v_extra ->> 'quando', '')::timestamptz, now()) else visualizado_em end,
    assinado_em    = case when p_status = 'assinado' then coalesce(nullif(v_extra ->> 'quando', '')::timestamptz, now()) else assinado_em end,
    recusado_em    = case when p_status = 'recusado' then now() else recusado_em end,
    cancelado_em   = case when p_status = 'cancelado' then now() else cancelado_em end
   where id = c.id;

  if p_status = 'erro' then return p_status; end if;

  -- Histórico primeiro (fica antes do "o cartão andou sozinho" que o gatilho escreve).
  v_texto := case p_status
    when 'enviado'     then 'Contrato enviado' || case when c.modo = 'manual' then ' (por fora do QS).' else ' pelo ZapSign.' end
    when 'visualizado' then 'O cliente abriu o contrato.'
    when 'assinado'    then 'Contrato ASSINADO.'
    when 'recusado'    then 'O cliente RECUSOU o contrato.' || coalesce(' ' || nullif(v_extra ->> 'motivo', ''), '')
    when 'cancelado'   then 'Contrato cancelado.' || coalesce(' ' || nullif(v_extra ->> 'motivo', ''), '')
  end;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id) values (c.negocio_id, 'contrato', v_texto, p_autor);

  -- O cartão: só o contrato MAIS RECENTE que não falhou manda no status do cartão
  -- (o gatilho da 0174 recalcula a etapa quando status_contrato muda).
  if not exists (select 1 from qs_contratos x where x.negocio_id = c.negocio_id and x.criado_em > c.criado_em
                  and x.status not in ('erro','cancelado')) then
    select * into n from qs_closer_negocios where id = c.negocio_id for update;
    update qs_closer_negocios set
      status_contrato      = p_status,
      -- 0282: reenvio carimba a data nova e limpa a assinatura de um contrato anterior.
      contrato_enviado_em  = case when p_status = 'enviado' then now() else contrato_enviado_em end,
      contrato_assinado_em = case when p_status = 'assinado' then coalesce(nullif(v_extra ->> 'quando', '')::timestamptz, now())
                                  when p_status = 'enviado' then null
                                  else contrato_assinado_em end
     where id = c.negocio_id and (status_contrato is distinct from p_status or p_status = 'enviado');
  end if;
  return p_status;
end;
$function$;
