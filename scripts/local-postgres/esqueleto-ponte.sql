-- =============================================================================
-- ESQUELETO DA PONTE PÓS-VENDA (0385–0389) — só o que elas encostam.
-- Colunas copiadas do banco em 13/11/2026 (format_type). Funções e gatilhos que
-- já existem em produção e que a ponte usa/convive entram em versão vigente
-- (rel_trecho_respeita_correcao, _venda_itens_propagar_trg) ou simplificada
-- (rel_viagens_gatilho só garante o passageiro; jornada fica de fora).
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('teste.role', true), ''), 'authenticated') $$;

create type status_expedicao as enum ('Planejamento','Vendas Abertas','Em andamento','Concluída','Cancelada');
create type status_reserva as enum ('Lead','Pré-reserva','Confirmado','Cancelado');
create type tipo_passageiro as enum ('Pagante','Cortesia','Líder');

create table expedicao_voos (id uuid default gen_random_uuid() primary key, expedicao_id uuid, trecho text default 'Ida'::text, companhia text, numero_voo text, origem text, destino text, partida text, chegada text, localizador text, observacoes text, ordem integer default 0, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), arquivo_id uuid, extensao_id uuid, apenas_sem_extensao boolean default false, grupo_id uuid, passageiro_id uuid);
create table expedicoes (id uuid default gen_random_uuid() primary key, codigo text, nome text, destino text, data_embarque date, data_retorno date, responsavel_operacional_id uuid, responsavel_comercial_id uuid, dmc_principal_id uuid, status status_expedicao default 'Planejamento'::status_expedicao, pax_planejados integer default 0, pax_cortesia integer default 0, preco_venda_brl numeric(14,2) default 0, bitrix_pipeline_id text, observacoes text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), ordem integer, viagem_grupo text, grupo_rotulo text, hospedagem_voucher_arquivo_id uuid, tipo text default 'expedicao'::text, preco_sem_aereo_brl numeric(12,2), bitrix_stage_id text);
create table extensoes (id uuid default gen_random_uuid() primary key, expedicao_id uuid, nome text, descricao text, ordem integer default 0, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), hospedagem_voucher_arquivo_id uuid);
create table fin_parcelas (id uuid default gen_random_uuid() primary key, plano_id uuid, numero integer, valor numeric(12,2), vencimento date, forma text default 'pix'::text, recorrente boolean default false, observacao text, status text default 'a_receber'::text, pago_em date, pago_valor numeric(12,2), pago_por uuid, baixa_obs text, criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now());
create table fin_planos (id uuid default gen_random_uuid() primary key, negocio_id uuid, viagem_id uuid, lead_id uuid, cliente_id uuid, cliente_nome text, closer_id uuid, valor_total numeric(12,2), observacao text, criado_por uuid, criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now(), venda_id uuid);
create table grupos_expedicao (id uuid default gen_random_uuid() primary key, expedicao_id uuid, nome text, data_embarque date, data_retorno date, pax_planejados integer default 0, observacoes text, ordem integer default 0, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table passageiro_extensao (id uuid default gen_random_uuid() primary key, passageiro_id uuid, extensao_id uuid, created_at timestamp with time zone default now());
create table passageiros (id uuid default gen_random_uuid() primary key, expedicao_id uuid, bitrix_contact_id text, bitrix_deal_id text, nome_completo text, tipo tipo_passageiro default 'Pagante'::tipo_passageiro, cpf text, passaporte text, data_nascimento date, validade_passaporte date, email text, telefone text, status_reserva status_reserva default 'Lead'::status_reserva, voo_nacional_necessario boolean default false, companhia_aerea text, localizador text, quarto_id uuid, observacoes text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), grupo_id uuid, valor_contratado_brl numeric(14,2) default 0, valor_pago_brl numeric(14,2) default 0, status_financeiro text default 'Em aberto'::text, cliente_id uuid, venda_id uuid, venda_item_id uuid);
create table qs_closer_negocio_eventos (id uuid default gen_random_uuid() primary key, negocio_id uuid, tipo text check (tipo = any (array['criado','movido','automatico','editado','perdido','consolidado','bitrix','nota','contrato','pagamento','pre_venda','itens'])), de_etapa text, para_etapa text, texto text, autor_id uuid, criado_em timestamp with time zone default now());
create table qs_closer_negocios (id uuid default gen_random_uuid() primary key, lead_id uuid, closer_id uuid, etapa text default 'aguardando_reuniao'::text, valor_previsto numeric(12,2), ficha jsonb, viagem_id uuid, consolidada_em timestamp with time zone, consolidada_por uuid, bitrix_status text, bitrix_erro text, arquivado_em timestamp with time zone, pre_venda_em timestamp with time zone, pre_venda_valor numeric(12,2));
create table qs_leads (id uuid default gen_random_uuid() primary key, full_name text, bitrix_id text);
create table qs_users (id uuid default gen_random_uuid() primary key, name text, email text, role text default 'sdr'::text, is_active boolean default true);
create table qs_venda_itens (id uuid default gen_random_uuid() primary key, negocio_id uuid, viagem_id uuid, cliente_id uuid, tipo text, nome text, data_inicio date, data_fim date, dados jsonb default '{}'::jsonb, passageiros jsonb default '[]'::jsonb, valor numeric(12,2), custo numeric(12,2), fornecedor text, status text default 'vendido'::text, ordem integer default 0, criado_por uuid, criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now(), venda_id uuid);
create table qs_venda_pagamentos (id uuid default gen_random_uuid() primary key, venda_id uuid, ordem integer default 1, forma text, valor numeric(12,2), data date, parcelas integer default 1, obs text, criado_em timestamp with time zone default now());
create table qs_venda_pessoas (id uuid default gen_random_uuid() primary key, venda_id uuid, cliente_id uuid, comprador boolean default false, valor numeric(12,2), itens integer[] default '{}'::integer[], bitrix_status text default 'nao_se_aplica'::text, removida_em timestamp with time zone, criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now());
create table qs_vendas (id uuid default gen_random_uuid() primary key, origem text, negocio_id uuid, viagem_id uuid, cliente_id uuid, valor_total numeric(12,2), pagamento jsonb default '{}'::jsonb, condicao_especial boolean default false, condicao_obs text, observacoes text, criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now(), estado text default 'negociacao'::text, consolidada_em timestamp with time zone, obs_financeiro text);
create table rel_clientes (id uuid default gen_random_uuid() primary key, nome text, mesclado_em_id uuid, perfil jsonb default '{}'::jsonb);
create table rel_expedicoes_vinculo (passageiro_id uuid primary key, expedicao_id uuid not null, cliente_id uuid, viagem_id uuid, como text, criado_em timestamp with time zone not null default now(), atualizado_em timestamp with time zone not null default now());
create table rel_viagem_deals (bitrix_deal_id text, viagem_id uuid);
create table rel_viagem_eventos (id bigint generated always as identity primary key, viagem_id uuid not null, tipo text not null check (tipo = any (array['dono','servico','arquivada','desarquivada','componente','repetida','datas','item'])), de text, para text, motivo text, lote uuid, por uuid references qs_users(id), em timestamp with time zone not null default now());
create table rel_viagem_passageiros (id uuid default gen_random_uuid() primary key, viagem_id uuid not null, cliente_id uuid not null, bitrix_deal_id text, criado_em timestamp with time zone default now(), unique (viagem_id, cliente_id));
create table rel_viagem_trechos (id uuid default gen_random_uuid() primary key, viagem_id uuid, tipo text default 'voo_internacional'::text check (tipo = any (array['voo_internacional','voo_interno','trem','transfer','hospedagem','passeio','seguro','outro'])), descricao text, origem text, destino text, partida_em timestamp with time zone, chegada_em timestamp with time zone, companhia text, numero text, localizador text, checkin_feito_em timestamp with time zone, checkin_feito_por uuid, criado_em timestamp with time zone default now(), ref_externa text, fonte text default 'manual'::text check (fonte = any (array['manual','expedicoes','bitrix','ia','venda'])), origem_codigo text, destino_codigo text, partida_fuso text, chegada_fuso text, status_manual text check (status_manual is null or status_manual = any (array['voado','cancelado'])), status_manual_motivo text, status_manual_por uuid, status_manual_em timestamp with time zone, corrigido_em timestamp with time zone, corrigido_por uuid, venda_id uuid, venda_item_id uuid, check (chegada_em is null or chegada_em >= partida_em));
create unique index rel_viagem_trechos_ref_idx on rel_viagem_trechos (viagem_id, ref_externa);
create table rel_viagens (id uuid default gen_random_uuid() primary key, titulo text check (length(trim(titulo)) >= 2), destino text, expedicao text, tipo text default 'outro'::text check (tipo = any (array['expedicao','pacote','aereo','hospedagem','outro'])), data_venda date, data_embarque date, data_retorno date, valor numeric(12,2), qtd_passageiros integer, cliente_id uuid, bitrix_deal_id text, status text default 'ativa'::text check (status = any (array['ativa','cancelada','arquivada'])), observacoes text, necessidades text, origem text default 'manual'::text check (origem = any (array['bitrix','manual','expedicoes','closer'])), criado_em timestamp with time zone default now(), atualizado_em timestamp with time zone default now(), expedicoes_id uuid, mesclada_em_id uuid, datas_travadas boolean default false, consolidada_em timestamp with time zone, closer_negocio_id uuid, check (data_retorno is null or data_embarque is null or data_retorno >= data_embarque));
create unique index rel_viagens_bitrix_uq on rel_viagens (bitrix_deal_id) where bitrix_deal_id is not null;

create or replace function _brl_txt(v numeric) returns text language sql immutable as $$ select 'R$ ' || coalesce(to_char(v, 'FM999G999G990D00'), '—') $$;

-- vigente (0112/0200)
create or replace function rel_trecho_respeita_correcao() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('rel.correcao_manual', true), '') = '1' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.corrigido_em is null and old.status_manual is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if coalesce(auth.role(), '') <> 'service_role' then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then return null; end if;
  new.partida_em := old.partida_em; new.chegada_em := old.chegada_em; new.status_manual := old.status_manual;
  new.status_manual_motivo := old.status_manual_motivo; new.status_manual_em := old.status_manual_em;
  new.corrigido_em := old.corrigido_em;
  return new;
end $$;
create trigger rel_trecho_respeita_correcao_upd before update on rel_viagem_trechos for each row execute function rel_trecho_respeita_correcao();

-- simplificado (só a parte que importa: garante o passageiro dono)
create or replace function rel_viagens_gatilho() returns trigger language plpgsql as $$
begin
  if new.cliente_id is not null then
    insert into rel_viagem_passageiros (viagem_id, cliente_id) values (new.id, new.cliente_id) on conflict (viagem_id, cliente_id) do nothing;
  end if;
  return null;
end $$;
create trigger trg_rel_viagens after insert or update on rel_viagens for each row execute function rel_viagens_gatilho();

-- vigente (0338)
create or replace function _venda_itens_propagar_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'DELETE' then perform _venda_propagar(old.negocio_id, old.venda_id);
    elsif tg_op = 'INSERT' then perform _venda_propagar(new.negocio_id, new.venda_id);
    else
      if new.valor is not distinct from old.valor and new.status is not distinct from old.status
         and new.negocio_id is not distinct from old.negocio_id and new.venda_id is not distinct from old.venda_id then return null; end if;
      perform _venda_propagar(new.negocio_id, new.venda_id);
    end if;
  exception when others then raise warning '0338 propagar venda (%): %', tg_op, sqlerrm;
  end;
  return null;
end $$;
create constraint trigger zz_venda_itens_propagar after insert or delete or update on qs_venda_itens
  deferrable initially deferred for each row execute function _venda_itens_propagar_trg();
-- a 0388 recria; aqui só existe para o "drop trigger" achar algo
create or replace function _qs_vendas_pagamento_mudou_trg() returns trigger language plpgsql as $$ begin return null; end $$;
create or replace function _pax_valor_na_venda_trg() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger trg_passageiros_valor_na_venda after update of valor_contratado_brl on passageiros for each row
  when (old.valor_contratado_brl is distinct from new.valor_contratado_brl and new.venda_item_id is not null)
  execute function _pax_valor_na_venda_trg();
