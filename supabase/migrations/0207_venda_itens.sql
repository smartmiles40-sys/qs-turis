-- 0207_venda_itens.sql
-- -----------------------------------------------------------------------------
-- VENDA POR ITENS + PRÉ-VENDA (Bruno, 27/10/2026)
--
-- "Temos que condicionar como vai subir as vendas, e criar todas as variáveis
--  coletando quando for cada tipo de venda: Aéreo, pacote, seguro, expedição…
--  Temos que ter um modo pra clicar na venda e já subir no dashboard que foi
--  venda, antes de consolidar realmente a venda."
--
-- Contrato comum (docs/CONTRATO-VENDA-ITENS.md):
--   Venda (Comercial) → itens por tipo → Viagem (Rel) → App da viagem (cliente)
-- O catálogo de tipos é src/propostas/lib.ts (TIPOS). Aqui só a tabela.
--
-- 1) qs_venda_itens — o que foi vendido, item por item (aéreo, pacote, seguro,
--    expedição…). O closer preenche uma vez no "Registrar venda"; o Rel e o
--    app do cliente leem e escrevem status/dados/viagem_id (emissão,
--    localizador, voucher).
--
-- 2) PRÉ-VENDA no cartão do closer (qs_closer_negocios.pre_venda_*). Um clique
--    ("Marcar como venda") e o negócio do Bitrix vai pra coluna de venda do
--    funil ("Em Emissão / Pix Expedição", UC_70BW8E no Comercial 1) com o
--    "Tipo de venda" e o valor — é essa coluna que o Dashboard conta como
--    venda (data_venda carimbada na chegada; ver o Dashboard,
--    20260921_venda_por_coluna_comercial1.sql). A ETAPA do cartão no QS não
--    muda: quem leva pra "Aguardando emissão" continua sendo a ficha de
--    fechamento (closer_consolidar). O api/closer.js, enquanto houver
--    pré-venda e a ficha não foi feita, manda o Bitrix pra coluna de venda em
--    vez da etapa do cartão.
--    A consolidação depois NÃO reconta: o Bitrix já está na coluna.
--
-- Escrita do closer: SEMPRE por RPC (closer_venda_itens_salvar, closer_pre_venda),
-- que conferem closer_pode_mexer — padrão da 0174/0176/0205.
-- NADA aqui chama o Bitrix: é o servidor (api/closer.js, acao=pre-venda / cron).
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. qs_venda_itens
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists qs_venda_itens (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid references qs_closer_negocios(id) on delete cascade,
  viagem_id     uuid references rel_viagens(id) on delete set null,
  cliente_id    uuid references rel_clientes(id) on delete set null,
  tipo          text not null check (tipo in (
                  'aereo','hospedagem','transfer','trem','passeio','seguro','carro','cruzeiro','visto',
                  'pacote','expedicao','concierge','outro')),
  nome          text not null check (nullif(trim(nome), '') is not null),
  data_inicio   date,
  data_fim      date,
  dados         jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  passageiros   jsonb not null default '[]'::jsonb check (jsonb_typeof(passageiros) = 'array'),
  valor         numeric(12,2) check (valor is null or valor >= 0),
  custo         numeric(12,2) check (custo is null or custo >= 0),
  fornecedor    text,
  status        text not null default 'vendido' check (status in ('vendido','emitido','cancelado')),
  ordem         int not null default 0,
  criado_por    uuid references qs_users(id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint qs_venda_itens_datas check (data_inicio is null or data_fim is null or data_fim >= data_inicio)
);
comment on table qs_venda_itens is
  'Itens da venda por tipo (catálogo: src/propostas/lib.ts TIPOS). Closer grava por RPC; Rel/app escrevem status, dados e viagem_id. Ver docs/CONTRATO-VENDA-ITENS.md.';

create index if not exists qs_venda_itens_negocio on qs_venda_itens (negocio_id, ordem) where negocio_id is not null;
create index if not exists qs_venda_itens_viagem  on qs_venda_itens (viagem_id, ordem) where viagem_id is not null;
create index if not exists qs_venda_itens_cliente on qs_venda_itens (cliente_id) where cliente_id is not null;

-- ── atualizado_em + quem não é dono só mexe em status/dados/viagem_id ──────
create or replace function qs_venda_itens_toca() returns trigger
language plpgsql set search_path = public as $$
declare
  v_closer uuid;
begin
  new.atualizado_em := now();
  -- RPCs security definer e o servidor (service_role) passam direto.
  if current_setting('qs.venda_itens_rpc', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if old.negocio_id is not null then
    select closer_id into v_closer from qs_closer_negocios where id = old.negocio_id;
  end if;
  -- Dono do negócio / gestão: tudo. Rel, Ops, app: só a parte da emissão.
  if (old.negocio_id is not null and closer_pode_mexer(v_closer)) or qs_is_manager() then
    return new;
  end if;
  if old.negocio_id is null and rel_tem_acesso() then
    return new;  -- item avulso lançado pelo Rel: é do Rel
  end if;
  if (new.negocio_id, new.cliente_id, new.tipo, new.nome, new.data_inicio, new.data_fim, new.passageiros,
      new.valor, new.custo, new.fornecedor, new.ordem, new.criado_por, new.criado_em)
     is distinct from
     (old.negocio_id, old.cliente_id, old.tipo, old.nome, old.data_inicio, old.data_fim, old.passageiros,
      old.valor, old.custo, old.fornecedor, old.ordem, old.criado_por, old.criado_em) then
    raise exception 'so-status-dados-viagem';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_venda_itens_toca on qs_venda_itens;
create trigger trg_qs_venda_itens_toca before update on qs_venda_itens
  for each row execute function qs_venda_itens_toca();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Leem: Relacionamento, Financeiro, Operações, gestão/admin e o closer dono.
-- SDR não vê. O cliente (app) entra na 0210.
alter table qs_venda_itens enable row level security;

drop policy if exists qs_venda_itens_ler on qs_venda_itens;
create policy qs_venda_itens_ler on qs_venda_itens for select to authenticated
  using (
    (select qs_is_manager()) or (select rel_tem_acesso()) or (select fin_tem_acesso()) or (select ops_tem_acesso())
    or exists (select 1 from qs_closer_negocios n where n.id = negocio_id and n.closer_id = (select auth.uid()))
  );

-- Escrevem: closer dono do negócio e gestão/admin (o front usa a RPC, a regra
-- vale pra quem chamar a tabela direto). O Rel lança item avulso (sem negócio).
drop policy if exists qs_venda_itens_inserir on qs_venda_itens;
create policy qs_venda_itens_inserir on qs_venda_itens for insert to authenticated
  with check (
    (select qs_is_manager())
    or (negocio_id is not null and exists (select 1 from qs_closer_negocios n where n.id = negocio_id and closer_pode_mexer(n.closer_id)))
    or (negocio_id is null and (select rel_tem_acesso()))
  );

-- Atualizar: os mesmos + Rel/Ops (o gatilho só deixa status, dados e viagem_id).
drop policy if exists qs_venda_itens_atualizar on qs_venda_itens;
create policy qs_venda_itens_atualizar on qs_venda_itens for update to authenticated
  using (
    (select qs_is_manager()) or (select rel_tem_acesso()) or (select ops_tem_acesso())
    or exists (select 1 from qs_closer_negocios n where n.id = negocio_id and closer_pode_mexer(n.closer_id))
  )
  with check (
    (select qs_is_manager()) or (select rel_tem_acesso()) or (select ops_tem_acesso())
    or exists (select 1 from qs_closer_negocios n where n.id = negocio_id and closer_pode_mexer(n.closer_id))
  );

drop policy if exists qs_venda_itens_apagar on qs_venda_itens;
create policy qs_venda_itens_apagar on qs_venda_itens for delete to authenticated
  using (
    (select qs_is_manager())
    or (negocio_id is not null and status = 'vendido'
        and exists (select 1 from qs_closer_negocios n where n.id = negocio_id and closer_pode_mexer(n.closer_id)))
    or (negocio_id is null and (select rel_tem_acesso()))
  );

revoke all on qs_venda_itens from anon;
grant select, insert, update, delete on qs_venda_itens to authenticated;
grant all on qs_venda_itens to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Pré-venda no cartão do closer
-- ═════════════════════════════════════════════════════════════════════════════
alter table qs_closer_negocios add column if not exists pre_venda_em          timestamptz;
alter table qs_closer_negocios add column if not exists pre_venda_por         uuid references qs_users(id) on delete set null;
alter table qs_closer_negocios add column if not exists pre_venda_valor       numeric(12,2);
-- Tipo do item principal (catálogo TIPOS) e o id do "Tipo de venda" do Bitrix
-- (UF_CRM_1743296167520, enum = string). O mapa tipo → id fica no front
-- (tipoVendaBitrix em src/propostas/lib.ts); aqui só confere o formato.
alter table qs_closer_negocios add column if not exists pre_venda_tipo        text;
alter table qs_closer_negocios add column if not exists pre_venda_tipo_bitrix text;
-- O resumo da ficha vai pra timeline do Bitrix uma vez por consolidação
-- (antes era deduzido de bitrix_etapa — com a pré-venda o Bitrix já está na
-- coluna de venda quando a ficha chega).
alter table qs_closer_negocios add column if not exists bitrix_resumo_em      timestamptz;

alter table qs_closer_negocios drop constraint if exists qs_closer_negocios_pre_venda_tipo_bitrix;
alter table qs_closer_negocios add constraint qs_closer_negocios_pre_venda_tipo_bitrix
  check (pre_venda_tipo_bitrix is null or pre_venda_tipo_bitrix ~ '^\d{1,6}$');

-- Quem já passou pela ficha antes desta migration: o resumo já foi pro Bitrix.
update qs_closer_negocios set bitrix_resumo_em = coalesce(bitrix_enviado_em, consolidada_em)
 where consolidada_em is not null and bitrix_resumo_em is null and bitrix_status = 'ok';

-- Pré-venda em aberto (o selo no quadro / relatório).
create index if not exists qs_closer_negocios_pre_venda on qs_closer_negocios (pre_venda_em)
  where pre_venda_em is not null and consolidada_em is null;

-- Evento novo no histórico do cartão.
alter table qs_closer_negocio_eventos drop constraint if exists qs_closer_negocio_eventos_tipo_check;
alter table qs_closer_negocio_eventos add constraint qs_closer_negocio_eventos_tipo_check
  check (tipo in ('criado','movido','automatico','editado','perdido','consolidado','bitrix','nota','contrato','pagamento','pre_venda','itens'));

-- ── Perdeu com pré-venda aberta: a pré-venda cai junto ─────────────────────
-- (O Bitrix vai pra coluna de perdido pelo espelho normal da etapa.)
create or replace function qs_closer_negocios_pre_venda_cai() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.etapa in ('perdido','venda_cancelada') and old.etapa is distinct from new.etapa
     and new.pre_venda_em is not null and new.consolidada_em is null then
    new.pre_venda_em := null;
    new.pre_venda_por := null;
    new.pre_venda_valor := null;
    new.pre_venda_tipo := null;
    new.pre_venda_tipo_bitrix := null;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (new.id, 'pre_venda', 'Pré-venda desfeita: o cartão foi para ' || new.etapa || '.', auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_closer_negocios_pre_venda_cai on qs_closer_negocios;
create trigger trg_qs_closer_negocios_pre_venda_cai before update of etapa on qs_closer_negocios
  for each row execute function qs_closer_negocios_pre_venda_cai();

-- ── A viagem nasceu (ficha consolidada): os itens ganham viagem e cliente ──
create or replace function qs_closer_negocios_itens_na_viagem() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid;
begin
  if new.viagem_id is null then return new; end if;
  select cliente_id into v_cliente from rel_viagens where id = new.viagem_id;
  perform set_config('qs.venda_itens_rpc', 'on', true);
  update qs_venda_itens set
    viagem_id  = new.viagem_id,
    cliente_id = coalesce(cliente_id, v_cliente)
   where negocio_id = new.id
     and (viagem_id is distinct from new.viagem_id or (cliente_id is null and v_cliente is not null));
  perform set_config('qs.venda_itens_rpc', 'off', true);
  return new;
end;
$$;
drop trigger if exists trg_qs_closer_negocios_itens_na_viagem on qs_closer_negocios;
create trigger trg_qs_closer_negocios_itens_na_viagem after insert or update of viagem_id on qs_closer_negocios
  for each row execute function qs_closer_negocios_itens_na_viagem();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RPCs do closer
-- ═════════════════════════════════════════════════════════════════════════════

-- Salva os itens da venda de UM cartão (a lista inteira, na ordem da tela).
-- p_itens: [{ id?, tipo, nome, data_inicio, data_fim, dados, passageiros,
--             valor, custo, fornecedor }]
--   • com id → atualiza (dados: o que o closer mandou vence, chaves que o Rel
--     gravou e a tela não conhece ficam — ex.: voucher);
--   • sem id → cria;
--   • item que sumiu da lista → apaga, se ainda está "vendido". Emitido não
--     se apaga por aqui (raise item-ja-emitido).
create or replace function closer_venda_itens_salvar(p_negocio uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  n       qs_closer_negocios;
  it      jsonb;
  v_id    uuid;
  v_ids   uuid[] := '{}';
  v_tipo  text;
  v_nome  text;
  v_ini   date;
  v_fim   date;
  v_cli   uuid;
  i       int := 0;
begin
  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa in ('perdido','venda_cancelada') then raise exception 'negocio-perdido'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'itens-invalidos'; end if;
  if n.viagem_id is not null then select cliente_id into v_cli from rel_viagens where id = n.viagem_id; end if;

  perform set_config('qs.venda_itens_rpc', 'on', true);

  for it in select * from jsonb_array_elements(p_itens) loop
    i := i + 1;
    v_tipo := nullif(trim(it ->> 'tipo'), '');
    if v_tipo is null or v_tipo not in ('aereo','hospedagem','transfer','trem','passeio','seguro','carro','cruzeiro','visto',
                                        'pacote','expedicao','concierge','outro') then
      raise exception 'tipo-invalido';
    end if;
    v_nome := nullif(trim(it ->> 'nome'), '');
    if v_nome is null then raise exception 'item-sem-nome'; end if;
    v_ini := nullif(it ->> 'data_inicio', '')::date;
    v_fim := nullif(it ->> 'data_fim', '')::date;
    if v_ini is not null and v_fim is not null and v_fim < v_ini then raise exception 'volta-antes-da-ida'; end if;
    if coalesce(nullif(it ->> 'valor', '')::numeric, 0) < 0 then raise exception 'valor-invalido'; end if;

    v_id := nullif(it ->> 'id', '')::uuid;
    if v_id is not null and not exists (select 1 from qs_venda_itens where id = v_id and negocio_id = n.id) then
      v_id := null;  -- id de outro negócio: vira item novo
    end if;

    if v_id is null then
      insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, tipo, nome, data_inicio, data_fim, dados, passageiros,
                                  valor, custo, fornecedor, ordem, criado_por)
      values (n.id, n.viagem_id, v_cli, v_tipo, left(v_nome, 300), v_ini, v_fim,
              case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
              case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else '[]'::jsonb end,
              nullif(it ->> 'valor', '')::numeric, nullif(it ->> 'custo', '')::numeric,
              nullif(trim(it ->> 'fornecedor'), ''), i, auth.uid())
      returning id into v_id;
    else
      update qs_venda_itens set
        tipo = v_tipo, nome = left(v_nome, 300), data_inicio = v_ini, data_fim = v_fim,
        dados = dados || case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
        passageiros = case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else passageiros end,
        valor = nullif(it ->> 'valor', '')::numeric, custo = nullif(it ->> 'custo', '')::numeric,
        fornecedor = nullif(trim(it ->> 'fornecedor'), ''), ordem = i
       where id = v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  if exists (select 1 from qs_venda_itens where negocio_id = n.id and not (id = any(v_ids)) and status <> 'vendido') then
    raise exception 'item-ja-emitido';
  end if;
  delete from qs_venda_itens where negocio_id = n.id and not (id = any(v_ids));

  perform set_config('qs.venda_itens_rpc', 'off', true);

  -- O valor previsto do cartão acompanha a soma (enquanto não há ficha).
  if n.consolidada_em is null then
    update qs_closer_negocios set valor_previsto = coalesce(nullif((select sum(valor) from qs_venda_itens where negocio_id = n.id), 0), valor_previsto)
     where id = n.id;
  end if;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (n.id, 'itens', 'Venda registrada: ' || i || ' item(ns), ' ||
          to_char(coalesce((select sum(valor) from qs_venda_itens where negocio_id = n.id), 0), 'FM999G999G990D00') || '.', auth.uid());
  return i;
end;
$$;
revoke all on function closer_venda_itens_salvar(uuid, jsonb) from public, anon;
grant execute on function closer_venda_itens_salvar(uuid, jsonb) to authenticated;

-- Pré-venda: p_acao 'marcar' | 'desfazer'.
--   marcar: tipo e valor vêm dos itens (o principal = o de maior valor) ou do
--   que a tela mandou (p_tipo / p_tipo_bitrix / p_valor) quando ainda não há
--   item. Fica "pendente" pro Bitrix: o servidor move logo em seguida
--   (api/closer.js acao=pre-venda) e o cron reenvia se falhar.
--   desfazer: volta o Bitrix pra coluna da etapa atual do cartão.
create or replace function closer_pre_venda(p_negocio uuid, p_acao text,
  p_tipo text default null, p_tipo_bitrix text default null, p_valor numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n        qs_closer_negocios;
  v_bitrix boolean;
  v_valor  numeric;
  v_tipo   text;
  v_tb     text := nullif(trim(coalesce(p_tipo_bitrix, '')), '');
begin
  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.arquivado_em is not null then raise exception 'cartao-no-arquivo'; end if;
  v_bitrix := exists (select 1 from qs_leads l where l.id = n.lead_id and nullif(trim(l.bitrix_id), '') is not null);

  if p_acao = 'marcar' then
    if n.etapa in ('perdido','venda_cancelada') then raise exception 'negocio-perdido'; end if;
    if n.consolidada_em is not null then raise exception 'venda-ja-consolidada'; end if;
    if n.pre_venda_em is not null then
      return jsonb_build_object('ok', true, 'ja_estava', true, 'bitrix', v_bitrix);
    end if;
    v_valor := coalesce(nullif(p_valor, 0), nullif((select sum(valor) from qs_venda_itens where negocio_id = n.id), 0), nullif(n.valor_previsto, 0));
    if v_valor is null or v_valor <= 0 then raise exception 'valor-total-obrigatorio'; end if;
    v_tipo := coalesce(nullif(trim(coalesce(p_tipo, '')), ''),
                       (select tipo from qs_venda_itens where negocio_id = n.id order by coalesce(valor, 0) desc, ordem limit 1));
    if v_tipo is null then raise exception 'tipo-obrigatorio'; end if;
    if v_tb is not null and v_tb !~ '^\d{1,6}$' then raise exception 'tipo-invalido'; end if;

    update qs_closer_negocios set
      pre_venda_em = now(), pre_venda_por = auth.uid(), pre_venda_valor = v_valor,
      pre_venda_tipo = v_tipo, pre_venda_tipo_bitrix = v_tb,
      valor_previsto = coalesce(valor_previsto, v_valor),
      bitrix_status = case when v_bitrix then 'pendente' else 'sem_card' end,
      bitrix_erro = null
     where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pre_venda', 'Marcado como venda (pré-venda): ' || to_char(v_valor, 'FM999G999G990D00') ||
            '. Sobe pro Dashboard pelo Bitrix; a ficha de fechamento consolida depois.', auth.uid());
    return jsonb_build_object('ok', true, 'bitrix', v_bitrix, 'valor', v_valor, 'tipo', v_tipo);

  elsif p_acao = 'desfazer' then
    if n.pre_venda_em is null then return jsonb_build_object('ok', true, 'ja_estava', true, 'bitrix', v_bitrix); end if;
    if n.consolidada_em is not null then raise exception 'venda-ja-consolidada'; end if;
    update qs_closer_negocios set
      pre_venda_em = null, pre_venda_por = null, pre_venda_valor = null, pre_venda_tipo = null, pre_venda_tipo_bitrix = null,
      bitrix_status = case when v_bitrix then 'pendente' else 'sem_card' end,
      bitrix_erro = null
     where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pre_venda', 'Pré-venda desfeita: o negócio volta pra coluna da etapa atual no Bitrix.', auth.uid());
    return jsonb_build_object('ok', true, 'bitrix', v_bitrix);
  end if;
  raise exception 'acao-invalida';
end;
$$;
revoke all on function closer_pre_venda(uuid, text, text, text, numeric) from public, anon;
grant execute on function closer_pre_venda(uuid, text, text, text, numeric) to authenticated;
