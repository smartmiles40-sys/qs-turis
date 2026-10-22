-- 0181_closer_pagamento_manual.sql
-- -----------------------------------------------------------------------------
-- PAGAMENTO NO CARTÃO DO CLOSER — SÓ MANUAL / PELO FINANCEIRO (Bruno, 22/10/2026:
-- Pagar.me e Asaas NÃO agora; "crédito recorrente e pagamentos futuros quem
-- gera é o Financeiro").
--
--   • O closer cola o LINK de pagamento que mandou ao cliente → "Pagamento enviado".
--   • O closer marca PAGO à mão → "Pago". Se a venda já tem plano de pagamento
--     (fin_parcelas, 0175) e ele escolhe a parcela, a parcela recebe baixa junto.
--   • "Pedir link ao Financeiro" → cria uma solicitação na Central
--     (tipo novo fin_link_pagamento, com prazo) amarrada ao cliente e ao cartão.
--     Quando o Financeiro CONCLUI colando o link na resolução, o link aparece
--     sozinho no cartão do closer (gatilho abaixo).
--
-- Depende da 0174/0175 (cartão e plano) e da 0149/0158/0159 (Central).
-- -----------------------------------------------------------------------------

-- ── 1) O cartão guarda o link e o pedido ao Financeiro ─────────────────────
alter table qs_closer_negocios add column if not exists pagamento_link            text;
alter table qs_closer_negocios add column if not exists pagamento_link_em         timestamptz;
alter table qs_closer_negocios add column if not exists pagamento_link_origem     text check (pagamento_link_origem in ('closer','financeiro'));
alter table qs_closer_negocios add column if not exists pagamento_obs             text;
alter table qs_closer_negocios add column if not exists pagamento_solicitacao_id  uuid references qs_solicitacoes(id) on delete set null;

-- A solicitação sabe de qual cartão veio (pra devolver o link ao lugar certo).
alter table qs_solicitacoes add column if not exists closer_negocio_id uuid references qs_closer_negocios(id) on delete set null;
create index if not exists qs_sol_closer_negocio_idx on qs_solicitacoes (closer_negocio_id) where closer_negocio_id is not null;

-- ── 2) Tipo novo do Financeiro: "Gerar link de pagamento" ──────────────────
insert into qs_solicitacao_tipos (id, setor, rotulo, prazo_horas, prazo_alta_horas, prazo_urgente_horas, ordem)
values ('fin_link_pagamento', 'financeiro', 'Gerar link de pagamento (crédito recorrente / pagamento futuro)', 4, 2, 1, 5)
on conflict (id) do nothing;

-- ── 3) Pagamento à mão ─────────────────────────────────────────────────────
--   p_acao = 'link'    → p_link obrigatório; status_pagamento = enviado
--            'pago'    → status_pagamento = pago; p_parcela (opcional) recebe baixa
--                        com p_data / p_valor / p_obs
--            'limpar'  → tira o status de pagamento (marcou errado). Não desfaz
--                        baixa de parcela (isso é com o Financeiro).
create or replace function closer_pagamento(p_negocio uuid, p_acao text, p_link text default null,
  p_parcela uuid default null, p_data date default null, p_valor numeric default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n      qs_closer_negocios;
  pa     fin_parcelas;
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_obs  text := nullif(trim(coalesce(p_obs, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;

  if p_acao = 'link' then
    if v_link is null or v_link !~* '^https?://' then raise exception 'link-invalido'; end if;
    update qs_closer_negocios set
      pagamento_link = v_link,
      pagamento_link_em = now(),
      pagamento_link_origem = coalesce(case when v_link = n.pagamento_link then n.pagamento_link_origem end, 'closer'),
      pagamento_obs = coalesce(v_obs, pagamento_obs),
      status_pagamento = case when status_pagamento = 'pago' then status_pagamento else 'enviado' end
     where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pagamento', 'Link de pagamento enviado ao cliente: ' || v_link, auth.uid());

  elsif p_acao = 'pago' then
    if p_valor is not null and p_valor <= 0 then raise exception 'valor-invalido'; end if;
    if p_data is not null and p_data > v_hoje then raise exception 'data-no-futuro'; end if;
    if p_parcela is not null then
      select x.* into pa from fin_parcelas x join fin_planos p on p.id = x.plano_id
       where x.id = p_parcela and p.negocio_id = n.id for update of x;
      if not found then raise exception 'parcela-nao-e-desta-venda'; end if;
      if pa.status <> 'a_receber' then raise exception 'parcela-ja-baixada'; end if;
      update fin_parcelas set status = 'pago', pago_em = coalesce(p_data, v_hoje), pago_valor = coalesce(p_valor, pa.valor),
             pago_por = auth.uid(), baixa_obs = coalesce(v_obs, 'Baixa pelo closer no cartão.'), atualizado_em = now()
       where id = pa.id;
    end if;
    update qs_closer_negocios set
      status_pagamento = 'pago',
      -- Meio-dia no horário de Brasília: p_data::timestamptz seria meia-noite UTC
      -- (21h do dia ANTERIOR aqui) e a tela mostraria a data errada.
      pago_em = coalesce((p_data + time '12:00') at time zone 'America/Sao_Paulo', now()),
      pagamento_obs = coalesce(v_obs, pagamento_obs)
     where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pagamento',
            'Pagamento marcado como RECEBIDO' || coalesce(' em ' || to_char(p_data, 'DD/MM/YYYY'), '')
            || coalesce(' — ' || translate(to_char(p_valor, 'FM999,999,990.00'), ',.', '.,'), '')
            || case when pa.id is not null then case when pa.numero = 0 then ' (baixa na entrada)' else ' (baixa na parcela ' || pa.numero || ')' end else '' end
            || coalesce('. ' || v_obs, '.'), auth.uid());

  elsif p_acao = 'limpar' then
    update qs_closer_negocios set status_pagamento = null, pagamento_enviado_em = null, pago_em = null where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pagamento', 'Status do pagamento desfeito' || coalesce(': ' || v_obs, '.'), auth.uid());
  else
    raise exception 'acao-invalida';
  end if;
end;
$$;
revoke all on function closer_pagamento(uuid, text, text, uuid, date, numeric, text) from public, anon;
grant execute on function closer_pagamento(uuid, text, text, uuid, date, numeric, text) to authenticated;

-- ── 4) Pedir o link ao Financeiro (vira solicitação na Central) ────────────
--   p_modalidade: 'recorrente' (crédito recorrente) | 'futuro' (pagamento futuro) | 'outro'
create or replace function closer_pedir_link_pagamento(p_negocio uuid, p_modalidade text, p_valor numeric,
  p_parcelas int default null, p_vencimento date default null, p_obs text default null, p_prioridade text default 'normal')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n      qs_closer_negocios;
  l      qs_leads;
  v_sol  uuid;
  v_nome text;
  v_mod  text;
  v_desc text;
begin
  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;
  if p_modalidade not in ('recorrente','futuro','outro') then raise exception 'modalidade-invalida'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'valor-invalido'; end if;
  if p_parcelas is not null and (p_parcelas < 1 or p_parcelas > 48) then raise exception 'parcelas-invalidas'; end if;
  -- Já tem pedido aberto pra este cartão? Não duplica.
  if exists (select 1 from qs_solicitacoes s where s.closer_negocio_id = n.id and s.tipo_id = 'fin_link_pagamento'
              and s.status in ('nova','em_andamento','aguardando')) then
    raise exception 'pedido-ja-aberto';
  end if;

  select * into l from qs_leads where id = n.lead_id;
  v_nome := coalesce(nullif(trim(l.full_name), ''), nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Cliente');
  v_mod := case p_modalidade when 'recorrente' then 'Crédito recorrente' when 'futuro' then 'Pagamento futuro' else 'Link de pagamento' end;
  v_desc := concat_ws(E'\n',
    'Modalidade: ' || v_mod,
    'Valor: R$ ' || translate(to_char(p_valor, 'FM999,999,990.00'), ',.', '.,'),
    case when p_parcelas is not null then 'Parcelas: ' || p_parcelas end,
    case when p_vencimento is not null then '1º vencimento / cobrança: ' || to_char(p_vencimento, 'DD/MM/YYYY') end,
    case when nullif(trim(l.email), '') is not null then 'E-mail do cliente: ' || trim(l.email) end,
    case when nullif(trim(l.phone), '') is not null then 'Telefone: ' || trim(l.phone) end,
    case when nullif(trim(coalesce(p_obs, '')), '') is not null then 'Observação: ' || trim(p_obs) end,
    '',
    'Ao CONCLUIR, cole o link de pagamento na resolução — ele aparece sozinho no cartão do closer.');

  -- A Central confere se quem pede é do Comercial e calcula o prazo pela prioridade.
  v_sol := qs_sol_criar('comercial', 'financeiro', 'fin_link_pagamento',
                        v_mod || ' — ' || v_nome || ' — R$ ' || translate(to_char(p_valor, 'FM999,999,990.00'), ',.', '.,'),
                        v_desc, coalesce(nullif(p_prioridade, ''), 'normal'), null, null, n.viagem_id, n.lead_id, null, null, null);
  update qs_solicitacoes set closer_negocio_id = n.id where id = v_sol;
  update qs_closer_negocios set pagamento_solicitacao_id = v_sol where id = n.id;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (n.id, 'pagamento', 'Pedido de link ao Financeiro (' || v_mod || ', R$ ' || translate(to_char(p_valor, 'FM999,999,990.00'), ',.', '.,') || ').', auth.uid());
  return v_sol;
end;
$$;
revoke all on function closer_pedir_link_pagamento(uuid, text, numeric, int, date, text, text) from public, anon;
grant execute on function closer_pedir_link_pagamento(uuid, text, numeric, int, date, text, text) to authenticated;

-- ── 5) O Financeiro concluiu → o link aparece no cartão ─────────────────────
-- Pega o PRIMEIRO http(s):// da resolução. Sem link na resolução: só anota.
-- Nunca derruba a ação do Financeiro: erro aqui vira aviso no log.
create or replace function qs_solicitacoes_link_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_link text;
begin
  if new.status = 'concluida' and old.status is distinct from 'concluida'
     and new.closer_negocio_id is not null and new.tipo_id = 'fin_link_pagamento' then
    begin
      v_link := substring(coalesce(new.resolucao, '') from '(https?://[^\s<>"'']+)');
      v_link := rtrim(v_link, '.,;)');
      if v_link is not null then
        update qs_closer_negocios set pagamento_link = v_link, pagamento_link_em = now(), pagamento_link_origem = 'financeiro'
         where id = new.closer_negocio_id;
        insert into qs_closer_negocio_eventos (negocio_id, tipo, texto)
        values (new.closer_negocio_id, 'pagamento', 'O Financeiro gerou o link de pagamento (solicitação nº ' || new.numero || '): ' || v_link);
      else
        insert into qs_closer_negocio_eventos (negocio_id, tipo, texto)
        values (new.closer_negocio_id, 'pagamento', 'O Financeiro concluiu a solicitação nº ' || new.numero || ' sem link: ' || left(coalesce(new.resolucao, ''), 300));
      end if;
    exception when others then
      raise warning '[0181] link do Financeiro não chegou ao cartão (solicitação %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function qs_solicitacoes_link_pagamento() from public, anon, authenticated;
drop trigger if exists trg_qs_solicitacoes_link_pagamento on qs_solicitacoes;
create trigger trg_qs_solicitacoes_link_pagamento after update of status on qs_solicitacoes
  for each row execute function qs_solicitacoes_link_pagamento();
