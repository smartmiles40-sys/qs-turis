-- 0180_closer_contrato.sql
-- -----------------------------------------------------------------------------
-- CONTRATO DE DENTRO DO CARTÃO DO CLOSER, 100% EM CÓDIGO (Bruno, 22/10/2026:
-- "eu não quero que seja nada via n8n, eu quero que tudo seja via código").
--
-- O QS faz sozinho, no servidor (api/closer.js + api/_contrato.js), o que o
-- n8n fazia: copia o template do Google Docs → troca as {{tags}} → PDF →
-- arquiva no Drive → cria o documento no ZapSign (cliente + assinante fixo da
-- agência). O ZapSign avisa o QS pelo webhook (enviado → visualizado →
-- assinado / recusado) e o cartão anda sozinho.
--
-- AQUI NO BANCO:
--   qs_contratos           → cada ENVIO (quem, quando, os campos que foram no
--                            contrato, ids/links do Drive e do ZapSign, status).
--   qs_contrato_config     → o que NÃO é segredo e a gestão muda pela tela:
--                            templates, pasta do Drive, assinante da agência.
--   qs_contrato_google     → o REFRESH TOKEN da conta Google conectada. Só o
--                            service_role lê (sem policy, sem grant). Nunca vai
--                            pro navegador.
--   qs_contrato_webhooks   → o que o ZapSign mandou (idempotência + auditoria).
--                            Só o service_role.
--   contrato_registrar_status() → ÚNICO caminho que muda o status: só anda pra
--                            frente e carimba qs_closer_negocios.status_contrato
--                            (o gatilho da 0174 move o cartão).
--   contrato_manual()      → MODO MANUAL (sem Google/ZapSign configurados ou
--                            quando o closer mandou por fora): cola o link,
--                            marca assinado, cola o link do PDF.
--
-- Depende da 0174 (qs_closer_negocios). Nada aqui é exposto pra anon.
-- -----------------------------------------------------------------------------

-- ── 1) O cartão aceita "visualizado" (o cliente abriu o link do ZapSign) ────
alter table qs_closer_negocios drop constraint if exists qs_closer_negocios_status_contrato_check;
alter table qs_closer_negocios add constraint qs_closer_negocios_status_contrato_check
  check (status_contrato in ('enviado','visualizado','assinado','recusado','cancelado'));

-- O cartão anda pelos FATOS: "visualizado" conta como contrato enviado.
-- (Mesma função da 0174; só muda a linha do contrato.)
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
  elsif n.status_contrato in ('enviado','visualizado') and closer_etapa_ordem(fato) < 4 then fato := 'contrato_enviado'; end if;

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

-- Histórico do cartão ganha o tipo 'contrato' (e 'pagamento', usado na 0181).
alter table qs_closer_negocio_eventos drop constraint if exists qs_closer_negocio_eventos_tipo_check;
alter table qs_closer_negocio_eventos add constraint qs_closer_negocio_eventos_tipo_check
  check (tipo in ('criado','movido','automatico','editado','perdido','consolidado','bitrix','nota','contrato','pagamento'));

-- ── 2) Cada envio de contrato ───────────────────────────────────────────────
create table if not exists qs_contratos (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references qs_closer_negocios(id) on delete cascade,
  lead_id            uuid references qs_leads(id) on delete set null,
  tipo               text not null default 'pacote' check (tipo in ('pacote','expedicao')),
  -- automatico = o QS gerou e mandou pro ZapSign; manual = o closer mandou por fora
  modo               text not null default 'automatico' check (modo in ('automatico','manual')),
  status             text not null default 'gerando'
                     check (status in ('gerando','enviado','visualizado','assinado','recusado','cancelado','erro')),
  erro               text,
  campos             jsonb not null default '{}'::jsonb,   -- o que foi pro contrato (nome, CPF, valor…)
  bitrix_deal_id     text,
  -- Google Drive
  drive_pdf_id       text,
  drive_pdf_url      text,
  -- ZapSign
  zapsign_token      text,
  zapsign_open_id    text,
  link_assinatura    text,   -- o link do CLIENTE assinar (no manual: o que o closer colou)
  pdf_assinado_url   text,   -- cópia do PDF assinado no Drive (ou o link que o closer colou)
  visualizacoes      int not null default 0,
  -- Tempos e pessoas
  enviado_por        uuid references qs_users(id) on delete set null,
  criado_em          timestamptz not null default now(),
  enviado_em         timestamptz,
  visualizado_em     timestamptz,
  assinado_em        timestamptz,
  recusado_em        timestamptz,
  cancelado_em       timestamptz,
  atualizado_em      timestamptz not null default now()
);
create unique index if not exists qs_contratos_zapsign_token on qs_contratos (zapsign_token) where zapsign_token is not null;
create index if not exists qs_contratos_negocio on qs_contratos (negocio_id, criado_em desc);
-- Trava contra clique duplo: um contrato "gerando" por cartão de cada vez.
create unique index if not exists qs_contratos_um_gerando on qs_contratos (negocio_id) where status = 'gerando';

create or replace function qs_contratos_toca() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists trg_qs_contratos_toca on qs_contratos;
create trigger trg_qs_contratos_toca before update on qs_contratos
  for each row execute function qs_contratos_toca();

alter table qs_contratos enable row level security;
drop policy if exists qs_contratos_ler on qs_contratos;
create policy qs_contratos_ler on qs_contratos for select to authenticated
  using (exists (select 1 from qs_closer_negocios n where n.id = negocio_id and (n.closer_id = auth.uid() or qs_is_manager())));
revoke all on qs_contratos from anon;
revoke insert, update, delete on qs_contratos from authenticated;
grant select on qs_contratos to authenticated;

-- ── 3) Configuração que NÃO é segredo (a gestão muda pela tela) ─────────────
create table if not exists qs_contrato_config (
  chave          text primary key,
  valor          jsonb not null default '{}'::jsonb,
  atualizado_por uuid references qs_users(id) on delete set null,
  atualizado_em  timestamptz not null default now()
);
-- Os mesmos valores que estavam cravados no Code node do n8n.
insert into qs_contrato_config (chave, valor) values ('geral', jsonb_build_object(
  'template_pacote',    '1vRh_zQHh-Q2rD8g0FsGIHRxAwqwtPY7X',
  'template_expedicao', '1FbKqTW5ysiFbKQI_9eM0xDPJ123Zz0UG',
  'pasta_contratos',    '14sJB-IOUEBjcyq0R6JxF5ZO1AaY0exQ8',
  'assinante_nome',     'Luís Antonio Caetano',
  'assinante_email',    'contato@setuforeuvou.com',
  'assinante_telefone', '5585987660748'
)) on conflict (chave) do nothing;

alter table qs_contrato_config enable row level security;
drop policy if exists qs_contrato_config_ler on qs_contrato_config;
create policy qs_contrato_config_ler on qs_contrato_config for select to authenticated
  using (qs_is_manager() or qs_is_closer());
revoke all on qs_contrato_config from anon;
revoke insert, update, delete on qs_contrato_config from authenticated;
grant select on qs_contrato_config to authenticated;

create or replace function contrato_config_salvar(p_valor jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
  txt text;
begin
  if not qs_is_manager() then raise exception 'sem-permissao'; end if;
  if p_valor is null or jsonb_typeof(p_valor) <> 'object' then raise exception 'config-invalida'; end if;
  -- Só as chaves conhecidas; IDs do Google têm só letras, números, - e _.
  foreach k in array array['template_pacote','template_expedicao','pasta_contratos'] loop
    txt := nullif(trim(coalesce(p_valor ->> k, '')), '');
    if txt is not null and txt !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'id-google-invalido:%', k; end if;
    v := v || jsonb_build_object(k, txt);
  end loop;
  txt := nullif(trim(coalesce(p_valor ->> 'assinante_email', '')), '');
  if txt is not null and txt !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email-invalido'; end if;
  v := v || jsonb_build_object(
    'assinante_nome', nullif(trim(coalesce(p_valor ->> 'assinante_nome', '')), ''),
    'assinante_email', lower(txt),
    'assinante_telefone', nullif(regexp_replace(coalesce(p_valor ->> 'assinante_telefone', ''), '\D', '', 'g'), ''));
  insert into qs_contrato_config (chave, valor, atualizado_por, atualizado_em) values ('geral', v, auth.uid(), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();
end;
$$;
revoke all on function contrato_config_salvar(jsonb) from public, anon;
grant execute on function contrato_config_salvar(jsonb) to authenticated;

-- ── 4) A conta Google conectada (SEGREDO: só o service_role) ────────────────
create table if not exists qs_contrato_google (
  id             smallint primary key default 1 check (id = 1),
  refresh_token  text not null,
  email          text,
  escopos        text,
  conectado_por  uuid references qs_users(id) on delete set null,
  conectado_em   timestamptz not null default now(),
  ultimo_erro    text,
  ultimo_erro_em timestamptz
);
alter table qs_contrato_google enable row level security;
-- Sem policy de propósito: nem authenticated nem anon leem ou escrevem.
revoke all on qs_contrato_google from public, anon, authenticated;

-- ── 5) O que o ZapSign mandou (idempotência) — só o service_role ───────────
create table if not exists qs_contrato_webhooks (
  id            bigint generated always as identity primary key,
  chave         text not null unique,        -- sha256 do corpo
  zapsign_token text,
  evento        text,
  payload       jsonb,
  resultado     text,
  recebido_em   timestamptz not null default now()
);
create index if not exists qs_contrato_webhooks_token on qs_contrato_webhooks (zapsign_token, recebido_em desc);
alter table qs_contrato_webhooks enable row level security;
revoke all on qs_contrato_webhooks from public, anon, authenticated;

-- ── 6) O ÚNICO caminho que muda o status do contrato ───────────────────────
-- Só anda pra frente: gerando → enviado → visualizado → assinado.
-- recusado/cancelado/erro fecham o envio (assinado nunca volta).
-- Chamado pelo servidor (service_role) e pelo contrato_manual().
create or replace function contrato_status_ordem(p text) returns int
language sql immutable set search_path = public as $$
  select case p when 'gerando' then 0 when 'erro' then 0 when 'enviado' then 1 when 'visualizado' then 2
                when 'assinado' then 4 when 'recusado' then 3 when 'cancelado' then 3 else -1 end;
$$;

create or replace function contrato_registrar_status(p_contrato uuid, p_status text, p_extra jsonb default '{}'::jsonb, p_autor uuid default null)
returns text language plpgsql security definer set search_path = public as $$
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
     or (c.status in ('recusado','cancelado') and p_status <> 'assinado')
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
      status_contrato = p_status,
      contrato_assinado_em = case when p_status = 'assinado' then coalesce(nullif(v_extra ->> 'quando', '')::timestamptz, now()) else contrato_assinado_em end
     where id = c.negocio_id and status_contrato is distinct from p_status;
  end if;
  return p_status;
end;
$$;
-- Só o servidor (service_role) chama direto; o closer passa pelo contrato_manual().
revoke all on function contrato_registrar_status(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function contrato_registrar_status(uuid, text, jsonb, uuid) to service_role;

-- ── 7) MODO MANUAL (o closer, sem depender do Google/ZapSign) ───────────────
--   'enviado'  → cria um envio manual com o link colado (p_link obrigatório)
--   'assinado' → marca o envio atual como assinado (p_link = link do PDF assinado, opcional)
--   'cancelar' → cancela o envio atual (p_link = motivo)
create or replace function contrato_manual(p_negocio uuid, p_acao text, p_link text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n     qs_closer_negocios;
  c     qs_contratos;
  v_id  uuid;
  v_link text := nullif(trim(coalesce(p_link, '')), '');
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;

  select * into c from qs_contratos
   where negocio_id = n.id and status not in ('erro','cancelado','gerando')
   order by criado_em desc limit 1;

  if p_acao = 'enviado' then
    if v_link is null or v_link !~* '^https?://' then raise exception 'link-invalido'; end if;
    if c.id is not null and c.status = 'assinado' then raise exception 'contrato-ja-assinado'; end if;
    -- O envio anterior em aberto vira cancelado (o novo manda).
    if c.id is not null then
      perform contrato_registrar_status(c.id, 'cancelado', jsonb_build_object('motivo', 'Substituído por um envio manual.'), auth.uid());
    end if;
    insert into qs_contratos (negocio_id, lead_id, modo, status, link_assinatura, enviado_por, campos)
    values (n.id, n.lead_id, 'manual', 'gerando', v_link, auth.uid(), '{}'::jsonb)
    returning id into v_id;
    perform contrato_registrar_status(v_id, 'enviado', '{}'::jsonb, auth.uid());
    return v_id;

  elsif p_acao = 'assinado' then
    if v_link is not null and v_link !~* '^https?://' then raise exception 'link-invalido'; end if;
    if c.id is null then
      -- Assinou por fora sem envio registrado: registra um envio manual já assinado.
      insert into qs_contratos (negocio_id, lead_id, modo, status, enviado_por)
      values (n.id, n.lead_id, 'manual', 'gerando', auth.uid()) returning id into v_id;
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
    -- Sem contrato vivo, o cartão fica sem status de contrato (não volta de etapa sozinho).
    update qs_closer_negocios set status_contrato = 'cancelado' where id = n.id;
    return c.id;
  end if;
  raise exception 'acao-invalida';
end;
$$;
revoke all on function contrato_manual(uuid, text, text) from public, anon;
grant execute on function contrato_manual(uuid, text, text) to authenticated;
