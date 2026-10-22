-- 0174_closer_pipeline.sql
-- -----------------------------------------------------------------------------
-- PIPELINE DO CLOSER (Bruno, 22/10/2026): "ligar SDR → Closer → Rel/Ops com a
-- MESMA informação". O closer ganha uma área própria e um kanban de verdade:
-- um CARTÃO por cliente (lead) que ele atendeu.
--
--   reuniao_feita → proposta_enviada → negociando → contrato_enviado →
--   contrato_assinado → pagamento_enviado → pago → consolidada   (+ perdido)
--
-- COMO O CARTÃO NASCE: reunião com closer marcada como REALIZADA (gatilho em
-- qs_meetings). As 225 reuniões realizadas que já existem viram cartão aqui
-- mesmo (backfill no fim do arquivo), na etapa "Reunião feita".
--
-- COMO O CARTÃO ANDA SOZINHO (só pra FRENTE, nunca volta sozinho):
--   • proposta do lead ENVIADA (qs_propostas) ............ → Proposta enviada
--   • proposta APROVADA pelo cliente no link .............. → Negociando
--   • status_contrato  = enviado / assinado ............... → Contrato enviado / assinado
--   • status_pagamento = enviado / parcial / pago ......... → Pagamento enviado / Pago
-- status_contrato e status_pagamento ficam PRONTOS aqui; quem preenche é a
-- frente do contrato (ZapSign) e do pagamento — por RPC ou service role.
-- O closer também move o cartão à mão (closer_negocio_mover).
-- "Venda consolidada" só pela ficha de fechamento (0176).
--
-- Quem vê: o closer, os cartões DELE; gestor do Comercial e admin, todos.
-- Escrita: só por RPC (security definer). As tabelas são só leitura.
-- -----------------------------------------------------------------------------

-- ── Ordem das etapas (pra "só anda pra frente") ─────────────────────────────
create or replace function closer_etapa_ordem(p text) returns int
language sql immutable set search_path = public as $$
  select case p
    when 'reuniao_feita' then 1 when 'proposta_enviada' then 2 when 'negociando' then 3
    when 'contrato_enviado' then 4 when 'contrato_assinado' then 5 when 'pagamento_enviado' then 6
    when 'pago' then 7 when 'consolidada' then 8 else 0 end;
$$;

-- ── O cartão ────────────────────────────────────────────────────────────────
create table if not exists qs_closer_negocios (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references qs_leads(id) on delete cascade,
  closer_id          uuid references qs_users(id) on delete set null,
  meeting_id         uuid references qs_meetings(id) on delete set null,
  etapa              text not null default 'reuniao_feita' check (etapa in (
                       'reuniao_feita','proposta_enviada','negociando','contrato_enviado',
                       'contrato_assinado','pagamento_enviado','pago','consolidada','perdido')),
  etapa_em           timestamptz not null default now(),
  valor_previsto     numeric(12,2),
  proxima_acao       text,
  proxima_acao_em    timestamptz,
  motivo_perda       text,
  -- Preenchidos pela frente do CONTRATO (ZapSign) e do PAGAMENTO:
  status_contrato    text check (status_contrato in ('enviado','assinado','recusado','cancelado')),
  contrato_enviado_em  timestamptz,
  contrato_assinado_em timestamptz,
  status_pagamento   text check (status_pagamento in ('enviado','parcial','pago','cancelado')),
  pagamento_enviado_em timestamptz,
  pago_em            timestamptz,
  -- A última proposta do cliente (enviada/aprovada) que mexeu no cartão.
  proposta_id        uuid references qs_propostas(id) on delete set null,
  -- Venda consolidada (0176)
  ficha              jsonb,
  viagem_id          uuid references rel_viagens(id) on delete set null,
  consolidada_em     timestamptz,
  consolidada_por    uuid references qs_users(id) on delete set null,
  -- Espelho no Bitrix (api/closer.js): pendente → ok | erro | sem_card
  bitrix_status      text check (bitrix_status in ('pendente','ok','erro','sem_card')),
  bitrix_erro        text,
  bitrix_enviado_em  timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint qs_closer_negocios_perda check (etapa <> 'perdido' or nullif(trim(motivo_perda), '') is not null)
);
-- Um cartão ABERTO por cliente. Perdido/consolidado libera um novo (recompra).
create unique index if not exists qs_closer_negocios_um_aberto
  on qs_closer_negocios (lead_id) where etapa not in ('consolidada','perdido');
create index if not exists qs_closer_negocios_closer on qs_closer_negocios (closer_id, etapa);
create index if not exists qs_closer_negocios_viagem on qs_closer_negocios (viagem_id) where viagem_id is not null;

-- Histórico do cartão (quem moveu, o que o sistema moveu sozinho, notas).
create table if not exists qs_closer_negocio_eventos (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references qs_closer_negocios(id) on delete cascade,
  tipo        text not null check (tipo in ('criado','movido','automatico','editado','perdido','consolidado','bitrix','nota')),
  de_etapa    text,
  para_etapa  text,
  texto       text,
  autor_id    uuid references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists qs_closer_negocio_eventos_neg on qs_closer_negocio_eventos (negocio_id, criado_em desc);

create or replace function qs_closer_negocios_toca() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if new.etapa is distinct from old.etapa then new.etapa_em := now(); end if;
  -- Carimba as datas que a frente do contrato/pagamento não mandou.
  if new.status_contrato is distinct from old.status_contrato then
    if new.status_contrato = 'enviado' and new.contrato_enviado_em is null then new.contrato_enviado_em := now(); end if;
    if new.status_contrato = 'assinado' and new.contrato_assinado_em is null then new.contrato_assinado_em := now(); end if;
  end if;
  if new.status_pagamento is distinct from old.status_pagamento then
    if new.status_pagamento in ('enviado','parcial') and new.pagamento_enviado_em is null then new.pagamento_enviado_em := now(); end if;
    if new.status_pagamento = 'pago' and new.pago_em is null then new.pago_em := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_closer_negocios_toca on qs_closer_negocios;
create trigger trg_qs_closer_negocios_toca before update on qs_closer_negocios
  for each row execute function qs_closer_negocios_toca();

-- ── Quem vê ────────────────────────────────────────────────────────────────
alter table qs_closer_negocios enable row level security;
alter table qs_closer_negocio_eventos enable row level security;

drop policy if exists qs_closer_negocios_ler on qs_closer_negocios;
create policy qs_closer_negocios_ler on qs_closer_negocios for select to authenticated
  using (closer_id = auth.uid() or qs_is_manager());
drop policy if exists qs_closer_negocio_eventos_ler on qs_closer_negocio_eventos;
create policy qs_closer_negocio_eventos_ler on qs_closer_negocio_eventos for select to authenticated
  using (exists (select 1 from qs_closer_negocios n where n.id = negocio_id and (n.closer_id = auth.uid() or qs_is_manager())));

revoke all on qs_closer_negocios, qs_closer_negocio_eventos from anon;
revoke insert, update, delete on qs_closer_negocios, qs_closer_negocio_eventos from authenticated;
grant select on qs_closer_negocios, qs_closer_negocio_eventos to authenticated;

-- ── Pode mexer neste cartão? (dono ou gestor/admin) ─────────────────────────
create or replace function closer_pode_mexer(p_closer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select qs_is_manager()
      or (p_closer = auth.uid() and exists (select 1 from qs_users where id = auth.uid() and is_active and role = 'closer'));
$$;
revoke all on function closer_pode_mexer(uuid) from public, anon;
grant execute on function closer_pode_mexer(uuid) to authenticated;

-- ── O cartão anda pelos FATOS (só pra frente) ───────────────────────────────
create or replace function closer_negocio_recalcular(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  n      qs_closer_negocios;
  fato   text := 'reuniao_feita';
  prop   uuid;
  st     text;
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found or n.etapa in ('consolidada','perdido') then return; end if;

  -- Propostas do cliente: ligadas direto ao lead OU à solicitação do lead.
  select p.id, p.status into prop, st
    from qs_propostas p
   where p.status in ('enviada','aprovada')
     and (p.lead_id = n.lead_id
          or p.solicitacao_id in (select s.id from qs_solicitacoes s where s.lead_id = n.lead_id))
   order by (p.status = 'aprovada') desc, coalesce(p.aprovada_em, p.enviada_em, p.atualizado_em) desc
   limit 1;
  if st = 'aprovada' then fato := 'negociando';
  elsif st = 'enviada' then fato := 'proposta_enviada'; end if;

  if n.status_contrato = 'assinado' then fato := 'contrato_assinado';
  elsif n.status_contrato = 'enviado' and closer_etapa_ordem(fato) < 4 then fato := 'contrato_enviado'; end if;

  if n.status_pagamento = 'pago' then fato := 'pago';
  elsif n.status_pagamento in ('enviado','parcial') and closer_etapa_ordem(fato) < 6 then fato := 'pagamento_enviado'; end if;

  if prop is not null and prop is distinct from n.proposta_id then
    update qs_closer_negocios set proposta_id = prop where id = n.id;
  end if;
  if closer_etapa_ordem(fato) > closer_etapa_ordem(n.etapa) then
    update qs_closer_negocios set etapa = fato where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto)
    values (n.id, 'automatico', n.etapa, fato, 'O cartão andou sozinho pelo que aconteceu no QS.');
  end if;
end;
$$;
revoke all on function closer_negocio_recalcular(uuid) from public, anon, authenticated;

-- ── Gatilho: reunião REALIZADA com closer → cartão ──────────────────────────
-- Nunca derruba o desfecho da reunião: qualquer erro aqui vira aviso no log.
create or replace function qs_meetings_cria_negocio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
begin
  if new.status = 'realizada' and new.closer_id is not null and new.lead_id is not null then
    begin
      insert into qs_closer_negocios (lead_id, closer_id, meeting_id, valor_previsto)
      values (new.lead_id, new.closer_id, new.id, nullif(new.venda_valor, 0))
      on conflict (lead_id) where etapa not in ('consolidada','perdido') do nothing
      returning id into nid;
      if nid is not null then
        insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, autor_id)
        values (nid, 'criado', 'reuniao_feita', 'Reunião realizada — o cartão entrou no pipeline.', auth.uid());
        perform closer_negocio_recalcular(nid);
      end if;
    exception when others then
      raise warning '[0174] cartão do closer não criado (reunião %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_meetings_cria_negocio on qs_meetings;
create trigger trg_qs_meetings_cria_negocio after insert or update of status, closer_id on qs_meetings
  for each row execute function qs_meetings_cria_negocio();

-- ── Gatilho: proposta enviada/aprovada → recalcula os cartões do cliente ────
create or replace function qs_propostas_move_negocio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.status in ('enviada','aprovada') then
    begin
      for r in
        select n.id from qs_closer_negocios n
         where n.etapa not in ('consolidada','perdido')
           and (n.lead_id = new.lead_id
                or n.lead_id = (select s.lead_id from qs_solicitacoes s where s.id = new.solicitacao_id))
      loop
        perform closer_negocio_recalcular(r.id);
      end loop;
    exception when others then
      raise warning '[0174] cartão do closer não recalculado (proposta %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_propostas_move_negocio on qs_propostas;
create trigger trg_qs_propostas_move_negocio after insert or update of status, lead_id, solicitacao_id on qs_propostas
  for each row execute function qs_propostas_move_negocio();

-- ── Gatilho: contrato/pagamento mudou → recalcula o próprio cartão ──────────
create or replace function qs_closer_negocios_fatos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform closer_negocio_recalcular(new.id);
  return new;
end;
$$;
drop trigger if exists trg_qs_closer_negocios_fatos on qs_closer_negocios;
create trigger trg_qs_closer_negocios_fatos after update of status_contrato, status_pagamento on qs_closer_negocios
  for each row when (old.status_contrato is distinct from new.status_contrato or old.status_pagamento is distinct from new.status_pagamento)
  execute function qs_closer_negocios_fatos();

-- ── RPCs da tela ───────────────────────────────────────────────────────────

-- Mover à mão. "consolidada" só pela ficha; "perdido" exige motivo.
create or replace function closer_negocio_mover(p_id uuid, p_etapa text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if p_etapa = 'consolidada' then raise exception 'use-a-ficha-de-fechamento'; end if;
  if n.etapa = 'consolidada' then raise exception 'venda-ja-consolidada'; end if;
  if closer_etapa_ordem(p_etapa) = 0 and p_etapa <> 'perdido' then raise exception 'etapa-invalida'; end if;
  if p_etapa = 'perdido' and nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'motivo-obrigatorio'; end if;
  if p_etapa = n.etapa then return; end if;

  update qs_closer_negocios
     set etapa = p_etapa,
         motivo_perda = case when p_etapa = 'perdido' then trim(p_motivo) else null end
   where id = p_id;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
  values (p_id, case when p_etapa = 'perdido' then 'perdido' else 'movido' end, n.etapa, p_etapa,
          case when p_etapa = 'perdido' then 'Motivo: ' || trim(p_motivo) else nullif(trim(coalesce(p_motivo, '')), '') end,
          auth.uid());
end;
$$;

-- Valor previsto e próxima ação.
create or replace function closer_negocio_salvar(p_id uuid, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  update qs_closer_negocios set
    valor_previsto  = case when p_dados ? 'valor_previsto' then nullif(p_dados ->> 'valor_previsto', '')::numeric else valor_previsto end,
    proxima_acao    = case when p_dados ? 'proxima_acao' then nullif(trim(p_dados ->> 'proxima_acao'), '') else proxima_acao end,
    proxima_acao_em = case when p_dados ? 'proxima_acao_em' then nullif(p_dados ->> 'proxima_acao_em', '')::timestamptz else proxima_acao_em end
   where id = p_id;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (p_id, 'editado', coalesce(nullif(trim(p_dados ->> 'proxima_acao'), ''), 'Valor/próxima ação atualizados.'), auth.uid());
end;
$$;

-- Abrir um cartão à mão (cliente que fechou sem reunião registrada).
create or replace function closer_negocio_abrir(p_lead uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
  eu  qs_users;
begin
  select * into eu from qs_users where id = auth.uid() and is_active;
  if not found or not (eu.role in ('closer') or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  select id into nid from qs_closer_negocios where lead_id = p_lead and etapa not in ('consolidada','perdido');
  if nid is not null then return nid; end if;
  insert into qs_closer_negocios (lead_id, closer_id) values (p_lead, auth.uid()) returning id into nid;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, autor_id)
  values (nid, 'criado', 'reuniao_feita', 'Cartão aberto à mão.', auth.uid());
  perform closer_negocio_recalcular(nid);
  return nid;
end;
$$;

-- Nota livre no histórico.
create or replace function closer_negocio_nota(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
begin
  select * into n from qs_closer_negocios where id = p_id;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if nullif(trim(coalesce(p_texto, '')), '') is null then return; end if;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id) values (p_id, 'nota', trim(p_texto), auth.uid());
end;
$$;

revoke all on function closer_negocio_mover(uuid, text, text), closer_negocio_salvar(uuid, jsonb),
  closer_negocio_abrir(uuid), closer_negocio_nota(uuid, text) from public, anon;
grant execute on function closer_negocio_mover(uuid, text, text), closer_negocio_salvar(uuid, jsonb),
  closer_negocio_abrir(uuid), closer_negocio_nota(uuid, text) to authenticated;

-- Funções de gatilho não são chamáveis por ninguém de fora.
revoke all on function qs_meetings_cria_negocio(), qs_propostas_move_negocio(), qs_closer_negocios_fatos() from public, anon, authenticated;

-- ── Backfill: um cartão por cliente com reunião realizada ───────────────────
-- Fica com o closer da reunião realizada mais recente.
insert into qs_closer_negocios (lead_id, closer_id, meeting_id, valor_previsto, criado_em, etapa_em)
select distinct on (m.lead_id) m.lead_id, m.closer_id, m.id, nullif(m.venda_valor, 0),
       coalesce(m.realizada_em, m.scheduled_at), coalesce(m.realizada_em, m.scheduled_at)
  from qs_meetings m
 where m.status = 'realizada' and m.closer_id is not null and m.lead_id is not null
   and not exists (select 1 from qs_closer_negocios n where n.lead_id = m.lead_id)
 order by m.lead_id, coalesce(m.realizada_em, m.scheduled_at) desc
on conflict do nothing;

insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, criado_em)
select n.id, 'criado', 'reuniao_feita', 'Cartão criado pela 0174 a partir da reunião realizada.', n.criado_em
  from qs_closer_negocios n
 where not exists (select 1 from qs_closer_negocio_eventos e where e.negocio_id = n.id);

do $$
declare r record;
begin
  for r in select id from qs_closer_negocios where etapa not in ('consolidada','perdido') loop
    perform closer_negocio_recalcular(r.id);
  end loop;
end $$;
