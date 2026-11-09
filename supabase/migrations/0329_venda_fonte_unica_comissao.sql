-- supabase/migrations/0329_venda_fonte_unica_comissao.sql
-- -----------------------------------------------------------------------------
-- O QS COMO FONTE ÚNICA DA VENDA (Bruno, 09/11/2026)
--   "Todo desfecho tem que ser feito por dentro do QS e todas as informações
--    que precisamos têm que estar vinculadas dentro do QS para ser contabilizadas."
--   "O operacional não tem que aprovar nenhuma venda... fica responsável por
--    sempre revisar todas as vendas mas não tem que aprovar nada."
--
-- A venda é a da 0214 (qs_vendas + qs_venda_itens, gravada pela venda_subir):
-- o closer registra escolhendo do que o Operacional cadastrou (expedição com
-- vaga e preço, ou item avulso), com valor e custo. Esta migration:
--
--   1) REVISÃO do Operacional (não é aprovação): qs_vendas.revisado_em/por/obs
--      + venda_marcar_revisada(venda, obs, desfazer). Nada trava sem revisão.
--   2) CUSTO na cotação de aéreo (cotacoes.custo_emitido): a cotação que a
--      própria SDR fez e o cliente aprovou é a venda de aéreo dela (10% do lucro).
--   3) COMISSÃO PELO QS: fin_com_fonte_qs(ini, fim) devolve, no formato da
--      conta (src/fin/comissoes/calculo.ts), só o que está no QS:
--        · itens das vendas do closer (tipo, expedição, valor, custo, cancelado)
--          — SDR = dona da reunião do negócio, closer = dono do negócio;
--        · reuniões realizadas (R.R) das SDRs;
--        · agendamentos originais das SDRs (bônus diário);
--        · cotações de aéreo aprovadas que a SDR fez (venda do próprio SDR).
--      O financeiro vê tudo; cada vendedor só as linhas dele.
--      fin_com_config 'fonte_qs_desde' = mês a partir do qual a comissão conta
--      pelo QS (antes disso, pelo espelho do Bitrix da 0327). Sem a chave: Bitrix.
--   4) ENQUANTO O OPERACIONAL ESTÁ EM VALIDAÇÃO (espelho do sistema antigo
--      ligado, 0317): a venda continua gravando venda e itens, mas o passageiro
--      que ela criaria/alteraria na expedição vai pra fila exp_venda_pax_pendentes
--      — senão o QS ficaria diferente do antigo (que ainda é a fonte) e o pax
--      apareceria duplicado quando viesse de lá. Na troca: exp_venda_pax_aplicar().
--
-- Só acrescenta. Volta: drop function fin_com_fonte_qs, venda_marcar_revisada,
-- exp_venda_pax_aplicar, _exp_venda_pax_segurar; drop trigger aa_exp_venda_pax_segurar
-- on passageiros; drop table exp_venda_pax_pendentes, fin_com_config; colunas novas.
-- -----------------------------------------------------------------------------

-- 1) Revisão do Operacional ----------------------------------------------------
alter table qs_vendas
  add column if not exists revisado_em  timestamptz,
  add column if not exists revisado_por uuid references qs_users(id) on delete set null,
  add column if not exists revisao_obs  text;

create or replace function venda_marcar_revisada(p_venda uuid, p_obs text default null, p_desfazer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  if p_desfazer then
    update qs_vendas set revisado_em = null, revisado_por = null, revisao_obs = null where id = p_venda;
  else
    update qs_vendas set revisado_em = now(), revisado_por = auth.uid(),
           revisao_obs = nullif(trim(coalesce(p_obs, '')), '') where id = p_venda;
  end if;
  if not found then raise exception 'venda-nao-encontrada'; end if;
end $$;
revoke all on function venda_marcar_revisada(uuid, text, boolean) from public, anon;
grant execute on function venda_marcar_revisada(uuid, text, boolean) to authenticated;

-- 2) Custo da cotação de aéreo -------------------------------------------------
alter table cotacoes add column if not exists custo_emitido numeric check (custo_emitido is null or custo_emitido >= 0);

-- 3) Comissão pelo QS ----------------------------------------------------------
create table if not exists fin_com_config (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
alter table fin_com_config enable row level security;
drop policy if exists fin_com_config_ler on fin_com_config;
create policy fin_com_config_ler on fin_com_config for select to authenticated using (true);
drop policy if exists fin_com_config_mudar on fin_com_config;
create policy fin_com_config_mudar on fin_com_config for all to authenticated
  using (fin_tem_acesso()) with check (fin_tem_acesso());
revoke all on fin_com_config from anon;
grant select, insert, update, delete on fin_com_config to authenticated;

create or replace function fin_com_tipo_rotulo(p_tipo text) returns text language sql immutable as $$
  select case p_tipo
    when 'expedicao' then 'Expedições'
    when 'pacote' then 'Pacotes de Viagens'
    when 'aereo' then 'Passagens aéreas'
    when 'hospedagem' then 'Hospedagem'
    when 'seguro' then 'Seguro Viagem'
    when 'passeio' then 'Passeios e transfers'
    when 'transfer' then 'Passeios e transfers'
    when 'trem' then 'Passeios e transfers'
    when 'carro' then 'Passeios e transfers'
    when 'cruzeiro' then 'Cruzeiro'
    when 'visto' then 'Visto'
    when 'concierge' then 'Concierge'
    else 'Outros' end;
$$;

-- Dia em Brasília de um timestamptz.
create or replace function fin_com_dia_br(t timestamptz) returns date language sql immutable as $$
  select (t at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function fin_com_fonte_qs(p_ini date, p_fim date)
returns table (
  bitrix_id text, origem text, nome text, pipeline text, fase text, tipo_venda text, nome_expedicao text,
  total numeric, custo numeric, data_venda date, sdr text, responsavel_reuniao text, data_reuniao_realizada date,
  no_show boolean, sdr_id uuid, closer_id uuid, data_quando_agendou date, venda_id uuid, lead_id uuid,
  revisado_em timestamptz
)
language sql stable security definer set search_path = public as $$
  with sdrs as (select id, name from qs_users where role = 'sdr'),
  linhas as (
    -- a) Itens das vendas do closer
    select 'qs:' || i.id::text as bitrix_id, 'venda'::text as origem,
           coalesce(c.nome, m.lead_name, i.nome) as nome, 'QS'::text as pipeline,
           case when i.status = 'cancelado' then 'Cancelamento' else 'Vendido' end as fase,
           fin_com_tipo_rotulo(i.tipo) as tipo_venda,
           coalesce(e.nome, case when i.tipo = 'expedicao' then i.nome end) as nome_expedicao,
           i.valor as total, i.custo as custo, fin_com_dia_br(v.criado_em) as data_venda,
           s.name as sdr, uc.name as responsavel_reuniao, null::date as data_reuniao_realizada, false as no_show,
           s.id as sdr_id, n.closer_id as closer_id, null::date as data_quando_agendou,
           v.id as venda_id, n.lead_id as lead_id, v.revisado_em as revisado_em
      from qs_venda_itens i
      join qs_vendas v on v.id = i.venda_id and v.origem = 'closer'
      join qs_closer_negocios n on n.id = v.negocio_id
      left join qs_meetings m on m.id = n.meeting_id
      left join sdrs s on s.id = m.owner_id
      left join qs_users uc on uc.id = n.closer_id
      left join rel_clientes c on c.id = v.cliente_id
      left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
     where fin_com_dia_br(v.criado_em) >= p_ini and fin_com_dia_br(v.criado_em) < p_fim
    union all
    -- b) Reuniões realizadas das SDRs
    select 'rr:' || m.id::text, 'reuniao', m.lead_name, 'QS', 'Reunião realizada', null, null,
           null, null, null, s.name, uc.name, fin_com_dia_br(m.realizada_em), false,
           s.id, m.closer_id, null, null, m.lead_id, null
      from qs_meetings m
      join sdrs s on s.id = m.owner_id
      left join qs_users uc on uc.id = m.closer_id
     where m.status = 'realizada' and m.realizada_em is not null
       and fin_com_dia_br(m.realizada_em) >= p_ini and fin_com_dia_br(m.realizada_em) < p_fim
    union all
    -- c) Agendamentos originais das SDRs (bônus diário)
    select 'ag:' || m.id::text, 'agendamento', m.lead_name, 'QS', 'Agendamento', null, null,
           null, null, null, s.name, null, null, false,
           s.id, null, fin_com_dia_br(m.created_at), null, m.lead_id, null
      from qs_meetings m
      join sdrs s on s.id = m.owner_id
     where m.reagendado_de is null and coalesce(m.status, '') <> 'arquivada'
       and fin_com_dia_br(m.created_at) >= p_ini and fin_com_dia_br(m.created_at) < p_fim
    union all
    -- d) Cotação de aéreo da própria SDR aprovada pelo cliente = venda de aéreo dela
    select 'cotv:' || ct.id::text, 'cotacao', coalesce(l.full_name, ct.destino), 'QS', 'Cotação aprovada', 'Passagens aéreas', null,
           ct.valor_emitido, ct.custo_emitido, fin_com_dia_br(ct.decidida_em), s.name, 'Não se aplica', null, false,
           s.id, null, null, null, ct.lead_id, null
      from cotacoes ct
      join sdrs s on s.id = ct.sdr_id
      left join qs_leads l on l.id = ct.lead_id
     where ct.status = 'aprovada' and not ct.repassada_closer and ct.decidida_em is not null and coalesce(ct.valor_emitido, 0) > 0
       and fin_com_dia_br(ct.decidida_em) >= p_ini and fin_com_dia_br(ct.decidida_em) < p_fim
  )
  select * from linhas x
   where fin_tem_acesso() or x.sdr_id = auth.uid() or x.closer_id = auth.uid();
$$;
revoke all on function fin_com_fonte_qs(date, date) from public, anon;
grant execute on function fin_com_fonte_qs(date, date) to authenticated;

-- 4) Passageiro da venda segurado enquanto o Operacional está em validação ------
create table if not exists exp_venda_pax_pendentes (
  id            uuid primary key default gen_random_uuid(),
  acao          text not null check (acao in ('insert', 'update')),
  passageiro_id uuid,                       -- update: a linha que a venda queria mudar
  venda_id      uuid,
  linha         jsonb not null,             -- o passageiro como a venda queria gravar
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  aplicado_em   timestamptz,
  erro          text
);
alter table exp_venda_pax_pendentes enable row level security;
drop policy if exists exp_venda_pax_pendentes_ler on exp_venda_pax_pendentes;
create policy exp_venda_pax_pendentes_ler on exp_venda_pax_pendentes for select to authenticated
  using (ops_tem_acesso() or qs_is_manager());
revoke all on exp_venda_pax_pendentes from anon;
grant select on exp_venda_pax_pendentes to authenticated;

create or replace function _exp_venda_pax_segurar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Só a gravação da venda (venda_subir liga qs.venda_itens_rpc), fora do próprio espelho,
  -- e só com o espelho ligado.
  if coalesce(current_setting('qs.venda_itens_rpc', true), '') <> 'on'
     or coalesce(current_setting('exp.espelho', true), '') = 'on'
     or not coalesce((select (valor ->> 'ligado')::boolean from ops_config where chave = 'exp_espelho'), false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into exp_venda_pax_pendentes (acao, venda_id, linha) values ('insert', new.venda_id, to_jsonb(new));
    return null;
  end if;
  insert into exp_venda_pax_pendentes (acao, passageiro_id, venda_id, linha) values ('update', old.id, new.venda_id, to_jsonb(new));
  return old;
end $$;

drop trigger if exists aa_exp_venda_pax_segurar on passageiros;
-- "aa_" = roda ANTES dos outros BEFORE triggers do passageiro (ordem alfabética), pra nada mexer em cadastro/requisitos de uma linha que não vai entrar.
create trigger aa_exp_venda_pax_segurar before insert or update on passageiros
  for each row execute function _exp_venda_pax_segurar();

-- Na troca (espelho desligado): aplica a fila em ordem. Insert = a linha inteira;
-- update = só as colunas que a venda mexe.
create or replace function exp_venda_pax_aplicar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r exp_venda_pax_pendentes; ok int := 0; falhou int := 0;
begin
  if not (ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  if coalesce((select (valor ->> 'ligado')::boolean from ops_config where chave = 'exp_espelho'), false) then
    raise exception 'espelho-ainda-ligado';
  end if;
  for r in select * from exp_venda_pax_pendentes where aplicado_em is null order by criado_em loop
    begin
      if r.acao = 'insert' then
        insert into passageiros select * from jsonb_populate_record(null::passageiros, r.linha);
      else
        update passageiros p set
          valor_contratado_brl = (r.linha ->> 'valor_contratado_brl')::numeric,
          valor_pago_brl = (r.linha ->> 'valor_pago_brl')::numeric,
          venda_id = (r.linha ->> 'venda_id')::uuid, venda_item_id = (r.linha ->> 'venda_item_id')::uuid,
          aereo_incluso = (r.linha ->> 'aereo_incluso')::boolean, quarto_desejado = r.linha ->> 'quarto_desejado',
          acompanhante_dividir_com = r.linha ->> 'acompanhante_dividir_com', quarto_par_id = (r.linha ->> 'quarto_par_id')::uuid,
          condicao_pagamento = r.linha ->> 'condicao_pagamento', condicao_obs = r.linha ->> 'condicao_obs',
          pagamento = r.linha -> 'pagamento'
         where p.id = r.passageiro_id;
      end if;
      update exp_venda_pax_pendentes set aplicado_em = now(), erro = null where id = r.id;
      ok := ok + 1;
    exception when others then
      update exp_venda_pax_pendentes set erro = left(sqlerrm, 300) where id = r.id;
      falhou := falhou + 1;
    end;
  end loop;
  return jsonb_build_object('aplicados', ok, 'falharam', falhou);
end $$;
revoke all on function exp_venda_pax_aplicar() from public, anon;
grant execute on function exp_venda_pax_aplicar() to authenticated;
