-- 0208 — Relacionamento: COMPONENTES da viagem + FAXINA segura (27/10/2026)
-- =============================================================================
-- DEPENDE DA 0207 (frente Venda: tabela qs_venda_itens). Aplicar a 0207 ANTES.
-- Contrato: docs/CONTRATO-VENDA-ITENS.md.
--
-- Bruno (27/10): "ajustar todas as viagens antes de subir qualquer coisa, já
-- adaptado pra receber as novas vendas, com um modelo pra aéreo, pacote,
-- seguro etc. … visualização fácil e rápida, sem ficar consultando nada".
--
-- O que esta migration faz (nada roda sozinho; aplicar NÃO muda nenhuma viagem):
--
--   A) COMPONENTES — a viagem passa a ser "a soma dos itens":
--      rel_viagem_componentes (view) = itens da venda (qs_venda_itens, 0207)
--        + trechos que já existem (rel_viagem_trechos: voo, hotel, transfer…)
--        + a expedição ligada (expedicoes).
--      rel_item_atualizar / rel_item_avulso — o Rel grava SÓ o que o contrato
--        deixa: status (vendido/emitido/cancelado), dados (localizador, voucher…)
--        e viagem_id; e lança item avulso (negocio_id null) quando a venda não
--        passou pelo QS.
--      rel_viagem_pagamento — o resumo do plano de pagamento (fin_*, 0175) que o
--        Rel não lê direto: total, pago, em aberto, atrasado. Sem valores de
--        parcela por parcela.
--
--   B) FAXINA — ferramentas pra arrumar as 1.854 viagens, sempre com histórico:
--      rel_sugerir_servico(viagem)       → o que provavelmente foi vendido + a regra
--      rel_faxina_classificar_v          → fila "Classificar" com a sugestão
--      rel_classificar_pelas_sugestoes   → aplica as sugestões (usa rel_classificar_viagens)
--      rel_faxina_repetidas_v            → pares "mesma pessoa, ida a ≤3 dias"
--      rel_marcar_repetidas              → põe a marca "CONFERIR: possível viagem
--                                          repetida" (a tela Conferir repetidas já existe, 0134a)
--      rel_faxina_componentes_v          → seguro/hotel/passeio vendido à parte
--                                          pra mesma viagem (mesma pessoa, ±3 dias)
--      rel_anexar_como_componente        → vira item da viagem principal e a venda
--                                          solta é ARQUIVADA (dá pra desfazer)
--      rel_datas_pelos_voos_lote         → "Sem data" que já tem voo: datas pelos voos
--      rel_distribuir_donos              → dá dono em lote, equilibrando a carga
--      rel_faxina_resumo                 → os números de cada fila (uma linha)
--
-- Quem pode: tudo exige rel_tem_acesso() + qs_pode('relacionamento.editar_viagens');
-- o que mexe em várias viagens de uma vez ou arquiva é só da gestão
-- (rel_pode_configurar), como na 0184.
-- =============================================================================

do $$
begin
  if to_regclass('public.qs_venda_itens') is null then
    raise exception '0208 depende da 0207 (tabela qs_venda_itens, frente Venda). Aplique a 0207 antes.';
  end if;
end $$;

-- ── 0) histórico: novos tipos de evento ─────────────────────────────────────
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.rel_viagem_eventos'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table rel_viagem_eventos drop constraint %I', c);
  end loop;
end $$;
alter table rel_viagem_eventos add constraint rel_viagem_eventos_tipo_check
  check (tipo in ('dono', 'servico', 'arquivada', 'desarquivada', 'componente', 'repetida', 'datas', 'item'));

-- ── 1) de/para de tipos (catálogo é o TIPOS de src/propostas/lib.ts) ─────────
-- trecho (0106) → tipo de item
create or replace function rel_tipo_do_trecho(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p in ('voo_internacional', 'voo_interno') then 'aereo'
    when p in ('hospedagem', 'trem', 'transfer', 'passeio') then p
    else 'outro' end
$$;

-- serviço da viagem (0148) → tipo de item
create or replace function rel_tipo_do_servico(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p in ('aereo', 'pacote', 'hospedagem', 'passeio', 'seguro', 'cruzeiro', 'expedicao', 'concierge') then p
    else 'outro' end
$$;

-- ── 2) A viagem como soma de componentes ────────────────────────────────────
-- security_invoker: cada linha respeita as RLS da tabela de origem (qs_venda_itens
-- pela 0207, trechos/expedições pelas de sempre). O custo NÃO entra (é interno).
create or replace view rel_viagem_componentes with (security_invoker = true) as
  select 'venda'::text                     as fonte,
         i.id,
         i.viagem_id,
         i.tipo,
         i.nome,
         i.data_inicio,
         i.data_fim,
         i.status,
         i.dados,
         i.passageiros,
         i.fornecedor,
         i.valor,
         i.negocio_id,
         i.ordem,
         i.atualizado_em
    from qs_venda_itens i
   where i.viagem_id is not null
  union all
  select 'trecho',
         t.id,
         t.viagem_id,
         rel_tipo_do_trecho(t.tipo),
         coalesce(nullif(trim(t.descricao), ''),
                  nullif(concat_ws(' → ', nullif(coalesce(t.origem_codigo, t.origem), ''), nullif(coalesce(t.destino_codigo, t.destino), '')), ''),
                  t.tipo),
         (t.partida_em at time zone 'America/Sao_Paulo')::date,
         (t.chegada_em at time zone 'America/Sao_Paulo')::date,
         null::text,
         jsonb_strip_nulls(jsonb_build_object(
           'trecho_tipo', t.tipo, 'origem', t.origem, 'destino', t.destino,
           'origem_codigo', t.origem_codigo, 'destino_codigo', t.destino_codigo,
           'partida_em', t.partida_em, 'chegada_em', t.chegada_em,
           'partida_fuso', t.partida_fuso, 'chegada_fuso', t.chegada_fuso,
           'companhia', t.companhia, 'numero', t.numero, 'localizador', t.localizador,
           'classe', t.classe, 'bagagem', t.bagagem, 'assento', t.assento,
           'numero_bilhete', t.numero_bilhete, 'ponto_encontro', t.ponto_encontro,
           'contato', t.contato, 'endereco', t.endereco, 'observacoes', t.observacoes,
           'documento_id', t.documento_id, 'checkin_feito_em', t.checkin_feito_em,
           'fonte', t.fonte)),
         coalesce(to_jsonb(t.passageiros), '[]'::jsonb),
         null::text,
         null::numeric,
         null::uuid,
         0,
         t.criado_em
    from rel_viagem_trechos t
  union all
  select 'expedicao',
         e.id,
         v.id,
         'expedicao',
         e.nome,
         e.data_embarque,
         e.data_retorno,
         null::text,
         jsonb_strip_nulls(jsonb_build_object('expedicoes_id', e.id, 'codigo', e.codigo, 'tipo', e.tipo, 'status', e.status)),
         '[]'::jsonb,
         null::text,
         null::numeric,
         null::uuid,
         -1,
         e.updated_at
    from rel_viagens v
    join expedicoes e on e.id = v.expedicoes_id;

comment on view rel_viagem_componentes is
  '0208: tudo o que a viagem tem, por tipo — itens da venda (qs_venda_itens), trechos (rel_viagem_trechos) e a expedição ligada. fonte = venda | trecho | expedicao.';
grant select on rel_viagem_componentes to authenticated;
revoke all on rel_viagem_componentes from anon;

-- ── 3) O Rel mexe nos itens (só o que o contrato deixa) ─────────────────────
-- Muda status, completa dados (merge: chave com null apaga) e/ou liga a outra viagem.
create or replace function rel_item_atualizar(p_id uuid, p_status text default null, p_dados jsonb default null, p_viagem_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_item qs_venda_itens%rowtype;
begin
  if v_eu is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão para editar os itens da viagem.';
  end if;
  if p_status is not null and p_status not in ('vendido', 'emitido', 'cancelado') then
    raise exception 'Situação inválida (vendido, emitido ou cancelado).';
  end if;
  if p_dados is not null and jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Dados do item em formato inválido.';
  end if;
  select * into v_item from qs_venda_itens where id = p_id for update;
  if not found then raise exception 'Item não encontrado.'; end if;
  if p_viagem_id is not null and not exists (select 1 from rel_viagens where id = p_viagem_id) then
    raise exception 'Viagem não encontrada.';
  end if;

  update qs_venda_itens
     set status        = coalesce(p_status, status),
         dados         = case when p_dados is null then dados else jsonb_strip_nulls(coalesce(dados, '{}'::jsonb) || p_dados) end,
         viagem_id     = coalesce(p_viagem_id, viagem_id),
         atualizado_em = now()
   where id = p_id;

  if coalesce(p_viagem_id, v_item.viagem_id) is not null then
    insert into rel_viagem_eventos (viagem_id, tipo, de, para, motivo, por)
    values (coalesce(p_viagem_id, v_item.viagem_id), 'item', v_item.status, coalesce(p_status, v_item.status),
            left(v_item.nome, 200), v_eu);
  end if;
end $$;

-- Item avulso lançado pelo Rel (venda que não passou pelo QS, ou que chegou do Bitrix sem itens).
create or replace function rel_item_avulso(
  p_viagem uuid, p_tipo text, p_nome text,
  p_inicio date default null, p_fim date default null,
  p_dados jsonb default '{}'::jsonb, p_fornecedor text default null, p_status text default 'vendido'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_cliente uuid;
  v_id uuid;
begin
  if v_eu is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão para lançar itens na viagem.';
  end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Dê um nome ao item.'; end if;
  if p_status not in ('vendido', 'emitido', 'cancelado') then raise exception 'Situação inválida.'; end if;
  if p_fim is not null and p_inicio is not null and p_fim < p_inicio then raise exception 'A data final não pode ser antes da inicial.'; end if;
  select cliente_id into v_cliente from rel_viagens where id = p_viagem;
  if not found then raise exception 'Viagem não encontrada.'; end if;

  -- o check de tipo é o da 0207 (catálogo TIPOS): tipo errado dá erro lá
  insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, tipo, nome, data_inicio, data_fim, dados, fornecedor, status, criado_por)
  values (null, p_viagem, v_cliente, p_tipo, trim(p_nome), p_inicio, p_fim,
          jsonb_strip_nulls(coalesce(p_dados, '{}'::jsonb)), nullif(trim(coalesce(p_fornecedor, '')), ''), p_status, v_eu)
  returning id into v_id;

  insert into rel_viagem_eventos (viagem_id, tipo, para, motivo, por)
  values (p_viagem, 'item', p_status, left('Item lançado pelo Relacionamento: ' || trim(p_nome), 200), v_eu);
  return v_id;
end $$;

-- ── 4) Pagamento: só o resumo ───────────────────────────────────────────────
create or replace function rel_viagem_pagamento(p_viagem uuid)
returns table (planos integer, total numeric, pago numeric, em_aberto numeric, atrasado numeric,
               parcelas_atrasadas integer, proximo_vencimento date)
language sql stable security definer set search_path = public as $$
  with p as (select id, valor_total from fin_planos where viagem_id = p_viagem and rel_tem_acesso()),
       x as (select fp.* from fin_parcelas fp join p on p.id = fp.plano_id)
  select (select count(*) from p)::integer,
         coalesce((select sum(valor_total) from p), 0),
         coalesce((select sum(coalesce(pago_valor, valor)) from x where status = 'pago'), 0),
         coalesce((select sum(valor) from x where status = 'a_receber'), 0),
         coalesce((select sum(valor) from x where status = 'a_receber' and vencimento < rel_hoje()), 0),
         (select count(*) from x where status = 'a_receber' and vencimento < rel_hoje())::integer,
         (select min(vencimento) from x where status = 'a_receber' and vencimento >= rel_hoje())
$$;

-- ── 5) FAXINA: sugerir o serviço ────────────────────────────────────────────
-- Regras, na ordem (a primeira que bate ganha). Medidas em 27/10 nas 198 ativas
-- "para classificar" (scripts/rel-faxina/diagnostico.sql):
--   R1 alta  "Venda realizada - Tipo" diz o serviço e o "Tipo de venda" diz "Outros"
--   R2 alta  Bitrix "Tipo de Viagem" = Expedição
--   R3 média o NOME do card (ou a "Observação") diz: "Exp …", pacote/lua de mel,
--            cruzeiro, seguro, passeio/Civitatis/ingresso/tour/transfer, hotel, aéreo/passagem
--   R4 média os trechos que já existem: voo + hotel = pacote; só voo = aéreo;
--            só hotel = hotel; só passeio/transfer = passeio
-- Sem regra → o time olha (cotações de Operações, "Japão", "Tailândia"…).
create or replace function rel_sugerir_servico(p_viagem uuid)
returns table (servico text, regra text, confianca text)
language sql stable set search_path = public as $$
  with v as (
    select r.id, r.titulo, r.bitrix_dados bd,
           lower(coalesce(r.titulo, '') || ' ' || coalesce(r.bitrix_dados->>'Observação [UF_CRM_1747076085383]', '')) txt,
           lower(coalesce(r.bitrix_dados->>'Venda realizada - Tipo [UF_CRM_1746631919796]', '')) vr,
           exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo like 'voo%') tem_voo,
           exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo = 'hospedagem') tem_hotel,
           exists (select 1 from rel_viagem_trechos t where t.viagem_id = r.id and t.tipo in ('passeio', 'transfer')) tem_passeio
      from rel_viagens r where r.id = p_viagem
  ), s as (
    select case
      when vr not in ('', 'outros') and rel_servico_auto(null, jsonb_build_object('Tipo de venda [UF_CRM_1743296167520]', vr)) is not null
        then array[rel_servico_auto(null, jsonb_build_object('Tipo de venda [UF_CRM_1743296167520]', vr)), 'Bitrix: "Venda realizada - Tipo" = ' || vr, 'alta']
      when bd->>'Tipo de Viagem: [UF_CRM_1761744284046]' ilike '%expedi%'
        then array['expedicao', 'Bitrix: "Tipo de Viagem" = Expedição', 'alta']
      when txt ~ '\mexp(\.|edi[cç][aã]o)?\M'               then array['expedicao', 'o nome diz "Exp"', 'media']
      when txt ~ '(pacote|circuito|lua de mel)'            then array['pacote', 'o nome diz pacote / lua de mel', 'media']
      when txt ~ 'cruzeiro'                                then array['cruzeiro', 'o nome diz cruzeiro', 'media']
      when txt ~ 'seguro'                                  then array['seguro', 'o nome diz seguro', 'media']
      when txt ~ '(civitatis|passeio|ingresso|\mtour\M|transfer)' then array['passeio', 'o nome/observação fala de passeio', 'media']
      when txt ~ '(hotel|hosped|airbnb)'                   then array['hospedagem', 'o nome fala de hotel', 'media']
      when txt ~ '(a[eé]reo|passage|bilhete)'              then array['aereo', 'o nome fala de passagem', 'media']
      when tem_voo and tem_hotel                           then array['pacote', 'já tem voo e hotel cadastrados', 'media']
      when tem_voo                                         then array['aereo', 'só tem voos cadastrados', 'media']
      when tem_hotel                                       then array['hospedagem', 'só tem hotel cadastrado', 'media']
      when tem_passeio                                     then array['passeio', 'só tem passeio/transfer cadastrado', 'media']
    end a from v
  )
  select a[1], a[2], a[3] from s where a is not null
$$;

create or replace view rel_faxina_classificar_v with (security_invoker = true) as
  select v.id, v.titulo, v.cliente_nome, v.data_embarque, v.fase, v.bitrix_deal_id,
         s.servico as sugestao, s.regra, s.confianca
    from rel_viagens_v v
    left join lateral rel_sugerir_servico(v.id) s on true
   where v.status = 'ativa' and v.acompanhamento = 'classificar';
grant select on rel_faxina_classificar_v to authenticated;
revoke all on rel_faxina_classificar_v from anon;

-- Aplica as sugestões (das marcadas, ou de todas da fila) com confiança mínima.
-- Cada viagem passa pelo rel_classificar_viagens da 0184 (permissão + histórico).
create or replace function rel_classificar_pelas_sugestoes(p_ids uuid[] default null, p_confianca text default 'alta')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  if auth.uid() is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão para classificar viagens.';
  end if;
  if p_confianca not in ('alta', 'media') then raise exception 'Confiança: alta ou media.'; end if;
  if p_ids is null and not rel_pode_configurar() then
    raise exception 'Aplicar em toda a fila é só para a gestão — marque as viagens.';
  end if;
  for r in
    select f.sugestao, array_agg(f.id) ids
      from rel_faxina_classificar_v f
     where f.sugestao is not null
       and (p_ids is null or f.id = any(p_ids))
       and (f.confianca = 'alta' or p_confianca = 'media')
     group by f.sugestao
  loop
    v_n := v_n + rel_classificar_viagens(r.ids, r.sugestao);
  end loop;
  return v_n;
end $$;

-- ── 6) FAXINA: repetidas ────────────────────────────────────────────────────
-- Mesma pessoa, as duas ativas, ida a ≤3 dias, mesmo nível de acompanhamento
-- (ou uma "para classificar"). Fica de fora: expedição ligada ao sistema de
-- Expedições (é a mesma pessoa vinda do Bitrix e de Expedições, de propósito) e
-- par em que uma já foi conferida.
create or replace view rel_faxina_repetidas_v with (security_invoker = true) as
  with a as (
    select v.id, v.cliente_id, v.cliente_nome, v.titulo, v.data_embarque, v.acompanhamento, v.fase, v.bitrix_deal_id, v.criado_em,
           r.expedicoes_id, r.repetida_conferida_em, r.observacoes
      from rel_viagens_v v join rel_viagens r using (id)
     where v.status = 'ativa' and r.mesclada_em_id is null and v.cliente_id is not null and v.data_embarque is not null
  )
  select x.id as viagem_a, y.id as viagem_b, x.cliente_nome,
         x.titulo as titulo_a, y.titulo as titulo_b, x.data_embarque as ida_a, y.data_embarque as ida_b,
         x.bitrix_deal_id as deal_a, y.bitrix_deal_id as deal_b,
         -- a mais nova é a que recebe a marca
         case when y.criado_em >= x.criado_em then y.id else x.id end as marcar,
         (x.fase in ('antes', 'em_viagem') or y.fase in ('antes', 'em_viagem')) as futura,
         (coalesce(x.observacoes, '') || coalesce(y.observacoes, '')) ilike '%CONFERIR: possível viagem repetida%' as ja_marcada
    from a x join a y on x.cliente_id = y.cliente_id and x.id < y.id
   where abs(x.data_embarque - y.data_embarque) <= 3
     and x.expedicoes_id is null and y.expedicoes_id is null
     and x.repetida_conferida_em is null and y.repetida_conferida_em is null
     and (x.acompanhamento = y.acompanhamento or 'classificar' in (x.acompanhamento, y.acompanhamento));
grant select on rel_faxina_repetidas_v to authenticated;
revoke all on rel_faxina_repetidas_v from anon;

-- Põe a marca nas viagens (a tela "Conferir repetidas" mostra e a gestora decide).
create or replace function rel_marcar_repetidas(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_n integer;
begin
  if v_eu is null or not rel_pode_configurar() then
    raise exception 'Marcar repetidas em lote é só para a gestão do Relacionamento.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'No máximo 500 viagens por vez.'; end if;
  with mudou as (
    update rel_viagens r
       set observacoes = concat_ws(E'\n', 'CONFERIR: possível viagem repetida (faxina 0208: mesma pessoa, ida a até 3 dias de outra venda)', rel_sem_marca_repetida(r.observacoes)),
           atualizado_em = now()
     where r.id = any(p_ids) and r.status = 'ativa' and r.mesclada_em_id is null
       and coalesce(r.observacoes, '') not ilike '%CONFERIR: possível viagem repetida%'
    returning r.id
  ), ev as (
    insert into rel_viagem_eventos (viagem_id, tipo, para, por)
    select m.id, 'repetida', 'conferir', v_eu from mudou m returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;

-- ── 7) FAXINA: venda solta que é componente de outra viagem ────────────────
-- Seguro, hotel, passeio (ou "para classificar") da MESMA pessoa com ida a ≤3 dias
-- de um pacote/aéreo/cruzeiro/expedição: é parte da mesma viagem.
create or replace view rel_faxina_componentes_v with (security_invoker = true) as
  with a as (
    select v.id, v.cliente_id, v.cliente_nome, v.titulo, v.data_embarque, v.data_retorno, v.acompanhamento, v.servico, v.fase, v.valor, v.bitrix_deal_id
      from rel_viagens_v v join rel_viagens r using (id)
     where v.status = 'ativa' and r.mesclada_em_id is null and v.cliente_id is not null and v.data_embarque is not null
  )
  select s.id as avulsa_id, p.id as principal_id, s.cliente_nome,
         s.titulo as avulsa_titulo, coalesce(s.servico, 'classificar') as avulsa_servico, s.data_embarque as avulsa_ida, s.bitrix_deal_id as avulsa_deal,
         p.titulo as principal_titulo, p.servico as principal_servico, p.data_embarque as principal_ida, p.bitrix_deal_id as principal_deal,
         (p.fase in ('antes', 'em_viagem')) as futura
    from a s join a p on p.cliente_id = s.cliente_id and p.id <> s.id
   where s.acompanhamento in ('nenhum', 'leve', 'classificar')
     and p.acompanhamento in ('completo', 'expedicao')
     and abs(p.data_embarque - s.data_embarque) <= 3;
grant select on rel_faxina_componentes_v to authenticated;
revoke all on rel_faxina_componentes_v from anon;

-- A venda solta vira ITEM da viagem principal e sai das filas (arquivada com
-- motivo; desfazer = rel_desarquivar_viagens + marcar o item como cancelado).
create or replace function rel_anexar_como_componente(p_principal uuid, p_avulsa uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  s record;
  p record;
  v_item uuid;
  v_lote uuid := gen_random_uuid();
begin
  if v_eu is null or not rel_pode_configurar() then
    raise exception 'Juntar vendas numa viagem é só para a gestão do Relacionamento.';
  end if;
  if p_principal = p_avulsa then raise exception 'Escolha duas viagens diferentes.'; end if;
  select v.*, coalesce(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) servico into s
    from rel_viagens v where v.id = p_avulsa and v.status = 'ativa' for update;
  if not found then raise exception 'A venda solta não está ativa.'; end if;
  select v.* into p from rel_viagens v where v.id = p_principal and v.status = 'ativa';
  if not found then raise exception 'A viagem principal não está ativa.'; end if;

  insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, tipo, nome, data_inicio, data_fim, dados, valor, status, criado_por)
  -- negocio_id fica null (item lançado pelo Rel): se a venda solta tiver negócio do closer, ele vai em dados,
  -- pra não colidir com os itens que a frente Venda gera pro mesmo negócio
  values (null, p_principal, coalesce(s.cliente_id, p.cliente_id), rel_tipo_do_servico(s.servico),
          s.titulo, s.data_embarque, s.data_retorno,
          jsonb_strip_nulls(jsonb_build_object('origem', 'faxina_0208', 'viagem_origem_id', s.id, 'bitrix_deal_id', s.bitrix_deal_id, 'negocio_id', s.closer_negocio_id)),
          s.valor, 'vendido', v_eu)
  returning id into v_item;

  update rel_viagens set status = 'arquivada', arquivado_em = now(), arquivado_por = v_eu,
         arquivado_motivo = left('Virou componente da viagem "' || p.titulo || '"', 300), arquivado_lote = v_lote, atualizado_em = now()
   where id = p_avulsa;

  insert into rel_viagem_eventos (viagem_id, tipo, de, para, motivo, lote, por) values
    (p_avulsa, 'arquivada', 'ativa', 'arquivada', left('Virou componente da viagem "' || p.titulo || '"', 300), v_lote, v_eu),
    (p_principal, 'componente', s.id::text, v_item::text, left('Recebeu "' || s.titulo || '" como componente', 300), v_lote, v_eu);
  return v_item;
end $$;

-- ── 8) FAXINA: "Sem data" que já tem voo ────────────────────────────────────
-- Usa a função da 0154 (datas = voos que valem; trava as datas contra o Bitrix).
-- Pula a que não tem voo que valha, sem parar o lote.
create or replace function rel_datas_pelos_voos_lote(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if auth.uid() is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão pra editar viagens.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 200 then raise exception 'No máximo 200 viagens por vez.'; end if;
  foreach v_id in array p_ids loop
    begin
      perform rel_viagem_datas_pelos_voos(v_id);
      insert into rel_viagem_eventos (viagem_id, tipo, para, motivo, por)
      values (v_id, 'datas', 'pelos voos', 'Datas preenchidas pelos voos (faxina)', auth.uid());
      v_n := v_n + 1;
    exception when others then
      null; -- sem voo que valha: fica na fila
    end;
  end loop;
  return v_n;
end $$;

-- ── 9) FAXINA: dono em lote, equilibrado ────────────────────────────────────
-- Vai da que embarca primeiro pra última; cada uma vai pra quem tem MENOS viagens
-- ativas (a acontecer) naquele momento. Mesmo cliente + mesma ida = mesma pessoa.
create or replace function rel_distribuir_donos(p_ids uuid[], p_pessoas uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  r record;
  v_quem uuid;
  v_carga jsonb := '{}'::jsonb;
  v_par jsonb := '{}'::jsonb;
  v_chave text;
  v_n integer := 0;
  v_p uuid;
begin
  if v_eu is null or not rel_pode_configurar() then
    raise exception 'Distribuir viagens é só para a gestão do Relacionamento.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or coalesce(array_length(p_pessoas, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'No máximo 500 viagens por vez.'; end if;
  foreach v_p in array p_pessoas loop
    if not exists (select 1 from qs_users u where u.id = v_p and u.is_active
                   and (u.role in ('admin', 'relacionamento') or 'relacionamento' = any(u.setores))) then
      raise exception 'Uma das pessoas escolhidas não é do Relacionamento.';
    end if;
    v_carga := v_carga || jsonb_build_object(v_p::text,
      (select count(*) from rel_viagens_v x where x.responsavel_id = v_p and x.status = 'ativa' and x.fase in ('antes', 'em_viagem')));
  end loop;

  for r in
    select v.id, v.cliente_id, v.data_embarque from rel_viagens v
     where v.id = any(p_ids) and v.status = 'ativa' and v.responsavel_id is null
     order by v.data_embarque nulls last, v.id
  loop
    v_chave := coalesce(r.cliente_id::text, r.id::text) || '|' || coalesce(r.data_embarque::text, '');
    v_quem := (v_par->>v_chave)::uuid;
    if v_quem is null then
      select k::uuid into v_quem from jsonb_each_text(v_carga) e(k, n) order by n::int, k limit 1;
      v_par := v_par || jsonb_build_object(v_chave, v_quem);
    end if;
    v_n := v_n + rel_atribuir_viagens(array[r.id], v_quem);
    v_carga := jsonb_set(v_carga, array[v_quem::text], to_jsonb((v_carga->>v_quem::text)::int + 1));
  end loop;
  return v_n;
end $$;

-- ── 10) Os números de cada fila (uma linha só) ──────────────────────────────
create or replace view rel_faxina_resumo with (security_invoker = true) as
  select
    count(*) filter (where status = 'ativa')                                                          as ativas,
    count(*) filter (where status = 'ativa' and fase in ('antes', 'em_viagem') and acompanhamento in ('completo', 'leve') and responsavel_id is null) as sem_dono,
    count(*) filter (where status = 'ativa' and acompanhamento = 'classificar')                        as classificar,
    count(*) filter (where status = 'ativa' and acompanhamento = 'classificar' and fase in ('antes', 'em_viagem')) as classificar_futuras,
    -- mesma fila da Lista "Sem data": sem data GRAVADA e com acompanhamento (a fase pode vir dos voos)
    count(*) filter (where status = 'ativa' and data_embarque is null and acompanhamento in ('expedicao', 'completo', 'leve')) as sem_data,
    count(*) filter (where status = 'ativa' and data_embarque is null and acompanhamento in ('expedicao', 'completo', 'leve') and coalesce(voos_total, 0) > 0) as sem_data_com_voo,
    count(*) filter (where status = 'ativa' and cliente_id is null)                                    as sem_cliente,
    count(*) filter (where status = 'ativa' and observacoes ilike '%CONFERIR: possível viagem repetida%') as repetidas_marcadas,
    (select count(*) from rel_faxina_classificar_v where sugestao is not null)                         as classificar_com_sugestao,
    (select count(*) from rel_faxina_repetidas_v where not ja_marcada)                                 as repetidas_candidatas,
    (select count(*) from rel_faxina_componentes_v)                                                    as componentes_soltos
  from rel_viagens_v;
grant select on rel_faxina_resumo to authenticated;
revoke all on rel_faxina_resumo from anon;

-- ── permissões das funções ──────────────────────────────────────────────────
revoke all on function rel_item_atualizar(uuid, text, jsonb, uuid) from public, anon;
revoke all on function rel_item_avulso(uuid, text, text, date, date, jsonb, text, text) from public, anon;
revoke all on function rel_viagem_pagamento(uuid) from public, anon;
revoke all on function rel_sugerir_servico(uuid) from public, anon;
revoke all on function rel_classificar_pelas_sugestoes(uuid[], text) from public, anon;
revoke all on function rel_marcar_repetidas(uuid[]) from public, anon;
revoke all on function rel_anexar_como_componente(uuid, uuid) from public, anon;
revoke all on function rel_datas_pelos_voos_lote(uuid[]) from public, anon;
revoke all on function rel_distribuir_donos(uuid[], uuid[]) from public, anon;
grant execute on function rel_item_atualizar(uuid, text, jsonb, uuid) to authenticated;
grant execute on function rel_item_avulso(uuid, text, text, date, date, jsonb, text, text) to authenticated;
grant execute on function rel_viagem_pagamento(uuid) to authenticated;
grant execute on function rel_sugerir_servico(uuid) to authenticated;
grant execute on function rel_classificar_pelas_sugestoes(uuid[], text) to authenticated;
grant execute on function rel_marcar_repetidas(uuid[]) to authenticated;
grant execute on function rel_anexar_como_componente(uuid, uuid) to authenticated;
grant execute on function rel_datas_pelos_voos_lote(uuid[]) to authenticated;
grant execute on function rel_distribuir_donos(uuid[], uuid[]) to authenticated;

notify pgrst, 'reload schema';
