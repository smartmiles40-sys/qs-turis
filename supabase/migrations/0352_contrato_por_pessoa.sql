-- supabase/migrations/0352_contrato_por_pessoa.sql
-- -----------------------------------------------------------------------------
-- CONTRATO POR PESSOA (Fase 3 da família, Bruno 09/11/2026)
--   "Na hora de subir o contrato, escolher quem vai junto e enviar UM CONTRATO
--    PARA CADA PESSOA; o contrato de cada um mostra o valor daquela pessoa;
--    menor de idade: pai/mãe (responsável) assina pelo filho."
--
-- DEPENDE DA 0351 (qs_venda_pessoas). Roda depois dela. Sem nada de Bitrix.
--
--   1) qs_contratos ganha a PESSOA:
--        venda_pessoa_id      → qs_venda_pessoas.id (de quem é o contrato)
--        cliente_id           → rel_clientes da pessoa que VIAJA
--        assinante_cliente_id → rel_clientes de quem ASSINA (o próprio; menor = o responsável)
--      venda_pessoa_id NULO = o contrato do CARTÃO como sempre foi (compatível:
--      tudo que existe hoje continua igual). Com família, o contrato "do cartão"
--      (nulo) conta como o do COMPRADOR.
--   2) "Um gerando por vez" passa a ser por (cartão, pessoa) — a família inteira
--      pode ser gerada em sequência sem um travar o outro. "Um ativo" por
--      (cartão, pessoa) é regra do servidor (api/closer.js), como já era.
--   3) _contratos_por_pessoa(cartão): o contrato que VALE de cada pessoa ativa
--      da venda (o vivo mais recente; sem vivo, o mais recente de todos).
--   4) contrato_resumo_cartao(cartão): o status do CARTÃO vira RESUMO quando há
--      contrato por pessoa — algum enviado/aguardando → 'enviado' (ou
--      'visualizado' se todos os pendentes já abriram); nenhum pendente e algum
--      recusado → 'recusado'; todos assinados → 'assinado'; nada vivo →
--      'cancelado'. NULO = não há contrato por pessoa (regra antiga, intacta).
--      Mesmo valor que o servidor/tela calculam (resumoDosContratos em
--      api/_contratoFamilia.js — testado).
--   5) contrato_registrar_status: igual à vigente (0282, conferida no banco em
--      09/11 com pg_get_functiondef) + grava qs_venda_pessoas.contrato_id /
--      contrato_status + resumo no cartão quando há contrato por pessoa.
--      Quem lê status_contrato (closer_negocio_recalcular, gatilho da 0174,
--      0205, cad_contratos_do_cliente 0228, VendaResumo/NegocioPainel/
--      ContratoBloco) continua lendo um dos MESMOS 5 valores — o cartão só vai
--      pra "Contrato assinado" quando TODOS os contratos vivos estão assinados.
--   6) contrato_manual ganha p_venda_pessoa (default nulo = o de sempre).
--      Mesma assinatura chamada pela tela (p_negocio, p_acao, p_link) continua
--      funcionando — o PostgREST resolve pelo default.
--   7) qs_venda_pessoas.contrato_status aceita 'recusado'.
--
-- Volta:
--   drop function if exists contrato_manual(uuid, text, text, uuid);
--   → rodar de novo o bloco 7 (contrato_manual) da 0180;
--   → rodar de novo a 0282 (contrato_registrar_status);
--   drop function if exists contrato_resumo_cartao(uuid), _contratos_por_pessoa(uuid), _contrato_pessoas_sincronizar(uuid);
--   drop index if exists qs_contratos_um_gerando_pessoa;
--   create unique index qs_contratos_um_gerando on qs_contratos (negocio_id) where status = 'gerando';
--   (as colunas novas podem ficar; ou: alter table qs_contratos drop column venda_pessoa_id,
--    drop column cliente_id, drop column assinante_cliente_id;)
-- -----------------------------------------------------------------------------

-- ── 1) A pessoa no contrato ─────────────────────────────────────────────────
alter table qs_contratos add column if not exists venda_pessoa_id uuid references qs_venda_pessoas(id) on delete set null;
alter table qs_contratos add column if not exists cliente_id uuid references rel_clientes(id) on delete set null;
alter table qs_contratos add column if not exists assinante_cliente_id uuid references rel_clientes(id) on delete set null;
comment on column qs_contratos.venda_pessoa_id is
  '0352: de quem é o contrato (qs_venda_pessoas). Nulo = contrato do cartão (com família, conta como o do comprador).';
comment on column qs_contratos.assinante_cliente_id is
  '0352: quem assina no ZapSign (o próprio; menor de idade = o responsável).';
create index if not exists qs_contratos_pessoa on qs_contratos (venda_pessoa_id, criado_em desc) where venda_pessoa_id is not null;
create index if not exists qs_contratos_cliente on qs_contratos (cliente_id) where cliente_id is not null;

-- ── 2) Um "gerando" por (cartão, pessoa) ────────────────────────────────────
create unique index if not exists qs_contratos_um_gerando_pessoa
  on qs_contratos (negocio_id, coalesce(venda_pessoa_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'gerando';
drop index if exists qs_contratos_um_gerando;

-- ── 7) 'recusado' na situação da pessoa ─────────────────────────────────────
alter table qs_venda_pessoas drop constraint if exists qs_venda_pessoas_contrato_status_check;
alter table qs_venda_pessoas add constraint qs_venda_pessoas_contrato_status_check
  check (contrato_status is null or contrato_status in ('pendente','gerando','enviado','visualizado','assinado','recusado','cancelado','erro'));

-- ── 3) O contrato que vale de cada pessoa ───────────────────────────────────
-- Uma linha por pessoa ATIVA da venda do cartão que tem algum contrato.
-- O contrato "do cartão" (venda_pessoa_id nulo) conta como o do comprador.
create or replace function _contratos_por_pessoa(p_negocio uuid)
returns table (venda_pessoa_id uuid, contrato_id uuid, status text, enviado_em timestamptz, assinado_em timestamptz)
language sql stable security definer set search_path = public as $$
  with comp as (
    select vp.id
      from qs_vendas v
      join qs_venda_pessoas vp on vp.venda_id = v.id and vp.comprador and vp.removida_em is null
     where v.negocio_id = p_negocio
     limit 1
  ), k as (
    select coalesce(k.venda_pessoa_id, (select id from comp)) as pessoa, k.id, k.status, k.enviado_em, k.assinado_em, k.criado_em
      from qs_contratos k
     where k.negocio_id = p_negocio
  )
  select distinct on (k.pessoa) k.pessoa, k.id, k.status, k.enviado_em, k.assinado_em
    from k
    join qs_venda_pessoas vp on vp.id = k.pessoa and vp.removida_em is null
   order by k.pessoa, (k.status in ('gerando','enviado','visualizado','assinado','recusado')) desc, k.criado_em desc;
$$;
revoke all on function _contratos_por_pessoa(uuid) from public, anon, authenticated;

-- ── 4) O status do cartão = resumo dos contratos por pessoa ─────────────────
create or replace function contrato_resumo_cartao(p_negocio uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_pend int; v_viu int; v_rec int; v_ass int; v_fech int;
begin
  -- Sem nenhum contrato POR PESSOA no cartão: a regra antiga manda (nulo).
  if not exists (select 1 from qs_contratos where negocio_id = p_negocio and venda_pessoa_id is not null) then
    return null;
  end if;
  select count(*) filter (where x.status in ('enviado','visualizado')),
         count(*) filter (where x.status = 'visualizado'),
         count(*) filter (where x.status = 'recusado'),
         count(*) filter (where x.status = 'assinado'),
         count(*) filter (where x.status = 'cancelado')
    into v_pend, v_viu, v_rec, v_ass, v_fech
    from _contratos_por_pessoa(p_negocio) x;
  -- Só "gerando"/"erro" (nada saiu ainda): o cartão não muda.
  if v_pend + v_rec + v_ass + v_fech = 0 then return null; end if;
  if v_pend > 0 then return case when v_viu = v_pend then 'visualizado' else 'enviado' end; end if;
  if v_rec > 0 then return 'recusado'; end if;
  if v_ass > 0 then return 'assinado'; end if;
  return 'cancelado';
end $$;
revoke all on function contrato_resumo_cartao(uuid) from public, anon, authenticated;
grant execute on function contrato_resumo_cartao(uuid) to service_role;

-- Situação de cada pessoa (qs_venda_pessoas.contrato_id/contrato_status) + resumo no cartão.
create or replace function _contrato_pessoas_sincronizar(p_negocio uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_resumo text;
begin
  update qs_venda_pessoas vp set
    contrato_id = x.contrato_id,
    contrato_status = x.status,
    atualizado_em = now()
    from _contratos_por_pessoa(p_negocio) x
   where vp.id = x.venda_pessoa_id
     and (vp.contrato_id is distinct from x.contrato_id or vp.contrato_status is distinct from x.status);

  v_resumo := contrato_resumo_cartao(p_negocio);
  if v_resumo is not null then
    update qs_closer_negocios n set
      status_contrato      = v_resumo,
      contrato_enviado_em  = coalesce((select min(x.enviado_em) from _contratos_por_pessoa(p_negocio) x
                                        where x.status in ('enviado','visualizado','assinado','recusado')), n.contrato_enviado_em),
      contrato_assinado_em = case when v_resumo = 'assinado'
                                  then (select max(x.assinado_em) from _contratos_por_pessoa(p_negocio) x where x.status = 'assinado')
                                  else null end
     where n.id = p_negocio
       and (n.status_contrato is distinct from v_resumo
            or (v_resumo <> 'assinado' and n.contrato_assinado_em is not null)
            or (v_resumo = 'assinado' and n.contrato_assinado_em is null));
  end if;
  return v_resumo;
end $$;
revoke all on function _contrato_pessoas_sincronizar(uuid) from public, anon, authenticated;

-- ── 5) O ÚNICO caminho que muda status (0282 + pessoa) ──────────────────────
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
  v_nome   text;
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

  if p_status = 'erro' then
    -- 0352: a pessoa mostra o erro só se ela não tem outro contrato vivo.
    perform _contrato_pessoas_sincronizar(c.negocio_id);
    return p_status;
  end if;

  -- 0352: no contrato por pessoa o histórico diz de quem é.
  if c.venda_pessoa_id is not null then
    select rc.nome into v_nome from qs_venda_pessoas vp join rel_clientes rc on rc.id = vp.cliente_id where vp.id = c.venda_pessoa_id;
  end if;
  v_texto := case p_status
    when 'enviado'     then 'Contrato enviado' || case when c.modo = 'manual' then ' (por fora do QS).' else ' pelo ZapSign.' end
    when 'visualizado' then 'O cliente abriu o contrato.'
    when 'assinado'    then 'Contrato ASSINADO.'
    when 'recusado'    then 'O cliente RECUSOU o contrato.' || coalesce(' ' || nullif(v_extra ->> 'motivo', ''), '')
    when 'cancelado'   then 'Contrato cancelado.' || coalesce(' ' || nullif(v_extra ->> 'motivo', ''), '')
  end || coalesce(' (' || nullif(trim(v_nome), '') || ')', '');
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id) values (c.negocio_id, 'contrato', v_texto, p_autor);

  -- 0352: situação de cada pessoa + RESUMO no cartão quando há contrato por pessoa.
  if _contrato_pessoas_sincronizar(c.negocio_id) is not null then
    return p_status;
  end if;

  -- Regra antiga (contrato único do cartão): só o contrato MAIS RECENTE que não
  -- falhou manda no status do cartão (o gatilho da 0174 recalcula a etapa).
  if not exists (select 1 from qs_contratos x where x.negocio_id = c.negocio_id and x.criado_em > c.criado_em
                  and x.status not in ('erro','cancelado')) then
    select * into n from qs_closer_negocios where id = c.negocio_id for update;
    update qs_closer_negocios set
      status_contrato      = p_status,
      contrato_enviado_em  = case when p_status = 'enviado' then now() else contrato_enviado_em end,
      contrato_assinado_em = case when p_status = 'assinado' then coalesce(nullif(v_extra ->> 'quando', '')::timestamptz, now())
                                  when p_status = 'enviado' then null
                                  else contrato_assinado_em end
     where id = c.negocio_id and (status_contrato is distinct from p_status or p_status = 'enviado');
  end if;
  return p_status;
end;
$function$;
revoke all on function contrato_registrar_status(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function contrato_registrar_status(uuid, text, jsonb, uuid) to service_role;

-- ── 6) MODO MANUAL por pessoa ───────────────────────────────────────────────
-- p_venda_pessoa nulo = exatamente o de antes (contrato do cartão).
drop function if exists contrato_manual(uuid, text, text);
create or replace function contrato_manual(p_negocio uuid, p_acao text, p_link text default null, p_venda_pessoa uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n       qs_closer_negocios;
  c       qs_contratos;
  vp      qs_venda_pessoas;
  v_id    uuid;
  v_link  text := nullif(trim(coalesce(p_link, '')), '');
  v_comp  uuid;   -- qs_venda_pessoas.id do comprador
  v_ccli  uuid;   -- rel_clientes do comprador
  v_ass   uuid;   -- quem assina
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;

  if p_venda_pessoa is not null then
    select x.* into vp from qs_venda_pessoas x join qs_vendas v on v.id = x.venda_id
     where x.id = p_venda_pessoa and v.negocio_id = n.id and x.removida_em is null;
    if not found then raise exception 'pessoa-nao-esta-na-venda'; end if;
    select x.id, x.cliente_id into v_comp, v_ccli from qs_venda_pessoas x
     where x.venda_id = vp.venda_id and x.comprador and x.removida_em is null limit 1;
    v_ass := case when vp.menor then coalesce(vp.responsavel_cliente_id, case when vp.comprador then null else v_ccli end)
                  else vp.cliente_id end;
  end if;

  -- "gerando" esquecido há mais de 3 min = a função caiu: vira erro e libera.
  update qs_contratos set status = 'erro', erro = 'Tempo esgotado ao gerar.'
   where negocio_id = n.id and status = 'gerando' and criado_em < now() - interval '3 minutes';
  if p_acao in ('enviado','assinado') and exists (
       select 1 from qs_contratos k where k.negocio_id = n.id and k.status = 'gerando'
          and (p_venda_pessoa is null or k.venda_pessoa_id = p_venda_pessoa
               or (k.venda_pessoa_id is null and p_venda_pessoa = v_comp))) then
    raise exception 'contrato-sendo-gerado';
  end if;

  select k.* into c from qs_contratos k
   where k.negocio_id = n.id and k.status not in ('erro','cancelado','gerando')
     and (p_venda_pessoa is null or k.venda_pessoa_id = p_venda_pessoa
          or (k.venda_pessoa_id is null and p_venda_pessoa = v_comp))
   order by k.criado_em desc limit 1;

  if p_acao = 'enviado' then
    if v_link is null or v_link !~* '^https?://' then raise exception 'link-invalido'; end if;
    if c.id is not null and c.status = 'assinado' then raise exception 'contrato-ja-assinado'; end if;
    if c.id is not null then
      perform contrato_registrar_status(c.id, 'cancelado', jsonb_build_object('motivo', 'Substituído por um envio manual.'), auth.uid());
    end if;
    insert into qs_contratos (negocio_id, lead_id, modo, status, link_assinatura, enviado_por, campos, venda_pessoa_id, cliente_id, assinante_cliente_id)
    values (n.id, n.lead_id, 'manual', 'gerando', v_link, auth.uid(), '{}'::jsonb, p_venda_pessoa, vp.cliente_id, v_ass)
    returning id into v_id;
    perform contrato_registrar_status(v_id, 'enviado', '{}'::jsonb, auth.uid());
    return v_id;

  elsif p_acao = 'assinado' then
    if v_link is not null and v_link !~* '^https?://' then raise exception 'link-invalido'; end if;
    if c.id is null then
      insert into qs_contratos (negocio_id, lead_id, modo, status, enviado_por, venda_pessoa_id, cliente_id, assinante_cliente_id)
      values (n.id, n.lead_id, 'manual', 'gerando', auth.uid(), p_venda_pessoa, vp.cliente_id, v_ass) returning id into v_id;
      perform contrato_registrar_status(v_id, 'enviado', '{}'::jsonb, auth.uid());
    else
      v_id := c.id;
    end if;
    perform contrato_registrar_status(v_id, 'assinado', jsonb_build_object('pdf_assinado_url', v_link), auth.uid());
    return v_id;

  elsif p_acao = 'cancelar' then
    if c.id is null then raise exception 'sem-contrato'; end if;
    if c.status = 'assinado' then raise exception 'contrato-ja-assinado'; end if;
    perform contrato_registrar_status(c.id, 'cancelado', jsonb_build_object('motivo', v_link), auth.uid());
    -- Contrato do cartão (regra antiga): sem contrato vivo o cartão fica 'cancelado'.
    -- Por pessoa: o resumo já foi gravado pelo contrato_registrar_status.
    if p_venda_pessoa is null and contrato_resumo_cartao(n.id) is null then
      update qs_closer_negocios set status_contrato = 'cancelado' where id = n.id;
    end if;
    return c.id;
  end if;
  raise exception 'acao-invalida';
end;
$$;
revoke all on function contrato_manual(uuid, text, text, uuid) from public, anon;
grant execute on function contrato_manual(uuid, text, text, uuid) to authenticated;

-- ── Arrumação: contratos do cartão que já existem viram o "do comprador" na pasta ──
-- (só mexe em qs_venda_pessoas; o status do cartão não muda porque nenhum
--  contrato tem venda_pessoa_id ainda — a regra antiga continua mandando.)
do $$
declare r record;
begin
  for r in select distinct v.negocio_id from qs_vendas v join qs_contratos k on k.negocio_id = v.negocio_id where v.negocio_id is not null loop
    update qs_venda_pessoas vp set contrato_id = x.contrato_id, contrato_status = x.status, atualizado_em = now()
      from _contratos_por_pessoa(r.negocio_id) x
     where vp.id = x.venda_pessoa_id
       and x.status <> 'gerando'
       and (vp.contrato_id is distinct from x.contrato_id or vp.contrato_status is distinct from x.status);
  end loop;
end $$;
