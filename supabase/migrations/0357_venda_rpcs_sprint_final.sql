-- supabase/migrations/0357_venda_rpcs_sprint_final.sql
-- -----------------------------------------------------------------------------
-- SUBIR VENDA — SPRINT FINAL (11/11/2026), frente BANCO, parte 2: as RPCs.
-- Contrato comum: docs/SUBIR-VENDA-FINAL.md. DEPENDE DA 0356 (estado,
-- qs_venda_pagamentos, fin_planos.venda_id) e da 0351/0352 (qs_venda_pessoas).
--
-- Versões de partida (a MAIS RECENTE de cada função, conferida no banco em 11/11
-- pelo md5 do corpo): venda_subir = 0351; closer_venda_itens_salvar = 0207;
-- closer_consolidar = 0176 + troca da 0205 (não é redefinida aqui — é CHAMADA).
--
--   Ajudantes (internos, sem grant):
--     _venda_pax_cancelar ......... "quem sai = passageiro cancelado" (vaga volta).
--                                   Cancela DIRETO em passageiros (fora da fila do
--                                   espelho — a fila não sabe cancelar) e descarta da
--                                   fila exp_venda_pax_pendentes o insert de quem saiu.
--     _venda_cliente_completar .... completa CPF/nascimento/telefone/e-mail da ficha
--                                   (nunca sobrescreve) — o resolver não completa
--                                   quando já vem cliente_id.
--     _venda_do_negocio_garantir .. a venda do cartão nasce em 'negociacao'.
--     _closer_venda_itens_gravar .. o corpo da closer_venda_itens_salvar SEM a
--                                   conferência de dono (a pública confere e chama;
--                                   a venda_subir usa direto pra Ops/Rel revisarem
--                                   venda reservada/consolidada).
--     _venda_pagamentos_parcelas .. linhas de pagamento → parcelas do Financeiro
--                                   (linha com N parcelas = N parcelas mensais).
--     _venda_txt_data/_venda_txt_valor .. leitura segura dos campos do contrato.
--
--   RPCs (security definer, grant só authenticated):
--     venda_familia_salvar(p jsonb)      — família no cartão, ainda em negociação.
--     venda_rascunho_salvar(p jsonb)     — rascunho da tela (NOVA, fora do contrato
--                                          original: a tela precisa gravar o rascunho
--                                          e qs_vendas não tem policy de escrita).
--     venda_subir(p jsonb)               — + acao salvar|reservar, pagamentos,
--                                          obs_financeiro, rascunho; quem sai = cancelado.
--     venda_consolidar(p_venda uuid)     — faltas em PT-BR ou consolida (viagem + contas a receber).
--     venda_cancelar(p_venda uuid, p_motivo text)
--     venda_blocos(p_venda uuid)
--     venda_do_contrato(p_negocio uuid)
--
-- Não chama Bitrix (quem fala com o Bitrix é o api/closer.js).
-- Volta: rodar de novo a venda_subir da 0351 e a closer_venda_itens_salvar da 0207;
--   drop function if exists venda_familia_salvar(jsonb), venda_rascunho_salvar(jsonb),
--     venda_consolidar(uuid), venda_cancelar(uuid, text), venda_blocos(uuid), venda_do_contrato(uuid),
--     _venda_pax_cancelar(uuid, text[], uuid[], text), _venda_cliente_completar(uuid, jsonb),
--     _venda_do_negocio_garantir(uuid), _closer_venda_itens_gravar(uuid, jsonb),
--     _venda_pagamentos_parcelas(uuid), _venda_txt_data(text), _venda_txt_valor(text);
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- Ajudantes
-- ═════════════════════════════════════════════════════════════════════════════

-- Quem sai = passageiro cancelado (a vaga volta).
--   p_clientes não nulo → cancela os passageiros DESTA venda dessas pessoas;
--   senão p_manter não nulo → cancela os desta venda cujo 'expedicao:cliente' não está na lista;
--   os dois nulos → cancela todos os desta venda (venda cancelada).
-- Roda com qs.venda_itens_rpc = off: o cancelamento entra direto em passageiros
-- (o gatilho da fila do espelho só segura gravação feita com a flag ligada — e a
-- fila só sabe aplicar valor/quarto, não status). O insert de quem saiu que ainda
-- estava na fila é descartado (aplicado_em + erro 'Descartado pelo QS').
create or replace function _venda_pax_cancelar(p_venda uuid, p_manter text[], p_clientes uuid[], p_motivo text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_flag text := coalesce(current_setting('qs.venda_itens_rpc', true), '');
  v_hoje text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
  v_mot  text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Saiu da venda.');
  v_n    int := 0;
begin
  if p_venda is null then return 0; end if;
  perform set_config('qs.venda_itens_rpc', 'off', true);

  update passageiros p set
    status_reserva = 'Cancelado'::status_reserva,
    observacoes = concat_ws(E'\n', nullif(p.observacoes, ''), '[QS ' || v_hoje || '] ' || v_mot)
   where p.venda_id = p_venda and p.status_reserva <> 'Cancelado'
     and case when p_clientes is not null then coalesce(p.cliente_id = any(p_clientes), false)
              when p_manter is not null then not coalesce((p.expedicao_id::text || ':' || coalesce(p.cliente_id::text, '')) = any(p_manter), false)
              else true end;
  get diagnostics v_n = row_count;

  update exp_venda_pax_pendentes q set
    aplicado_em = now(),
    erro = left('Descartado pelo QS: ' || v_mot, 300)
   where q.aplicado_em is null and q.acao = 'insert' and q.venda_id = p_venda
     and case when p_clientes is not null then coalesce(nullif(q.linha ->> 'cliente_id', '')::uuid = any(p_clientes), false)
              when p_manter is not null then not coalesce(((q.linha ->> 'expedicao_id') || ':' || coalesce(q.linha ->> 'cliente_id', '')) = any(p_manter), false)
              else true end;

  perform set_config('qs.venda_itens_rpc', case when v_flag = 'on' then 'on' else 'off' end, true);
  return v_n;
end $$;
revoke all on function _venda_pax_cancelar(uuid, text[], uuid[], text) from public, anon, authenticated;

-- Completa a ficha (rel_clientes) com o que veio da tela — nunca sobrescreve.
create or replace function _venda_cliente_completar(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cpf  text := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '\D', '', 'g'), '');
  v_fone text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
  v_mail text := nullif(lower(trim(coalesce(p ->> 'email', ''))), '');
  v_nasc date;
begin
  if p_id is null or p is null or jsonb_typeof(p) <> 'object' then return; end if;
  begin v_nasc := nullif(p ->> 'nascimento', '')::date; exception when others then v_nasc := null; end;
  if length(v_fone) in (10, 11) then v_fone := '55' || v_fone; end if;
  if v_fone !~ '^\d{10,15}$' then v_fone := null; end if;
  if v_cpf is not null and v_cpf !~ '^\d{11}$' then v_cpf := null; end if;
  if v_cpf is not null and exists (select 1 from rel_clientes o where o.id <> p_id and o.cpf = v_cpf) then v_cpf := null; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_mail := null; end if;
  update rel_clientes set
    cpf = coalesce(cpf, v_cpf), telefone = coalesce(telefone, v_fone),
    email = coalesce(email, v_mail), nascimento = coalesce(nascimento, v_nasc)
   where id = p_id
     and (cpf is null and v_cpf is not null or telefone is null and v_fone is not null
          or email is null and v_mail is not null or nascimento is null and v_nasc is not null);
end $$;
revoke all on function _venda_cliente_completar(uuid, jsonb) from public, anon, authenticated;

-- A venda do cartão (nasce em 'negociacao'). Quem chama já conferiu a permissão.
-- Comprador: o da viagem do cartão → a ficha ligada ao lead → acha/cria pelo lead.
create or replace function _venda_do_negocio_garantir(p_negocio uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n       qs_closer_negocios;
  l       qs_leads;
  v_venda uuid;
  v_cli   uuid;
begin
  select id into v_venda from qs_vendas where negocio_id = p_negocio;
  if v_venda is not null then return v_venda; end if;
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  select * into l from qs_leads where id = n.lead_id;
  if n.viagem_id is not null then select cliente_id into v_cli from rel_viagens where id = n.viagem_id; end if;
  if v_cli is null and l.cliente_id is not null then
    select coalesce(mesclado_em_id, id) into v_cli from rel_clientes where id = l.cliente_id;
  end if;
  if v_cli is null and l.id is not null then
    begin
      v_cli := venda_cliente_resolver(jsonb_build_object(
                 'nome', coalesce(nullif(trim(l.full_name), ''), nullif(trim(concat_ws(' ', l.first_name, l.last_name)), '')),
                 'telefone', l.phone, 'email', l.email));
    exception when others then v_cli := null;   -- lead sem nome/contato: a tela manda o comprador
    end;
  end if;
  insert into qs_vendas (origem, negocio_id, viagem_id, cliente_id, estado)
  values ('closer', p_negocio, n.viagem_id, v_cli, 'negociacao')
  on conflict (negocio_id) where negocio_id is not null do nothing
  returning id into v_venda;
  if v_venda is null then select id into v_venda from qs_vendas where negocio_id = p_negocio; end if;
  return v_venda;
end $$;
revoke all on function _venda_do_negocio_garantir(uuid) from public, anon, authenticated;

-- O corpo da closer_venda_itens_salvar (0207) sem a conferência de dono.
create or replace function _closer_venda_itens_gravar(p_negocio uuid, p_itens jsonb)
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
revoke all on function _closer_venda_itens_gravar(uuid, jsonb) from public, anon, authenticated;

-- A pública: igual à 0207 (confere o dono e grava).
create or replace function closer_venda_itens_salvar(p_negocio uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_closer uuid;
begin
  select closer_id into v_closer from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(v_closer) then raise exception 'sem-permissao'; end if;
  return _closer_venda_itens_gravar(p_negocio, p_itens);
end;
$$;
revoke all on function closer_venda_itens_salvar(uuid, jsonb) from public, anon;
grant execute on function closer_venda_itens_salvar(uuid, jsonb) to authenticated;

-- Linhas de pagamento → parcelas do Financeiro (formato da ficha do closer_consolidar):
-- linha com N parcelas = N parcelas mensais a partir da data (centavos: a última leva a sobra).
create or replace function _venda_pagamentos_parcelas(p_venda uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'valor', (case when k = pg.parcelas then pg.c - (pg.c / pg.parcelas) * (pg.parcelas - 1)
                          else pg.c / pg.parcelas end)::numeric / 100,
           'vencimento', to_char((pg.data + make_interval(months => k - 1))::date, 'YYYY-MM-DD'),
           'forma', pg.forma,
           'recorrente', pg.forma = 'cartao',
           'observacao', nullif(concat_ws(' · ', nullif(trim(coalesce(pg.obs, '')), ''),
                                          case when pg.parcelas > 1 then 'Parcela ' || k || '/' || pg.parcelas end), ''))
         order by pg.ordem, pg.criado_em, k), '[]'::jsonb)
    from (select x.*, round(x.valor * 100)::bigint as c from qs_venda_pagamentos x where x.venda_id = p_venda) pg
    cross join lateral generate_series(1, pg.parcelas) k;
$$;
revoke all on function _venda_pagamentos_parcelas(uuid) from public, anon, authenticated;

-- 'dd/mm/aaaa' ou 'aaaa-mm-dd' → date (inválida = null).
create or replace function _venda_txt_data(t text) returns date
language plpgsql immutable set search_path = public as $$
begin
  t := trim(coalesce(t, ''));
  if t ~ '^\d{2}/\d{2}/\d{4}$' then return to_date(t, 'DD/MM/YYYY'); end if;
  if t ~ '^\d{4}-\d{2}-\d{2}' then return left(t, 10)::date; end if;
  return null;
exception when others then return null;
end $$;
revoke all on function _venda_txt_data(text) from public, anon, authenticated;

-- 'R$ 15.000,00' / '15.000,00' / '15000.00' → numeric (inválido = null).
create or replace function _venda_txt_valor(t text) returns numeric
language plpgsql immutable set search_path = public as $$
begin
  t := trim(coalesce(t, ''));
  if t = '' then return null; end if;
  if t like '%,%' then
    return nullif(replace(regexp_replace(t, '[^0-9,]', '', 'g'), ',', '.'), '')::numeric;
  end if;
  return nullif(regexp_replace(t, '[^0-9.]', '', 'g'), '')::numeric;
exception when others then return null;
end $$;
revoke all on function _venda_txt_valor(text) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_familia_salvar — "Quem vai" no cartão, ainda em negociação
-- ═════════════════════════════════════════════════════════════════════════════
-- p: { negocio_id, pessoas: [{ chave, nome, vinculo, cpf, nascimento, email, telefone,
--                               pessoa_id?, cliente_id?, valor?, removida?, comprador? }] }
-- A lista é a família INTEIRA (a tela manda só os ACOMPANHANTES — o titular a RPC
-- põe sozinha): quem não vem (ou vem com removida:true) sai da
-- venda (removida_em; card filho no Bitrix = 'removida') e o passageiro dela é
-- cancelado (vaga volta). pessoa_id (de qs_venda_pessoas) identifica quem já
-- estava. O comprador (titular) sempre fica; se a tela não o
-- mandar, ele é mantido como está. Valor e itens de cada pessoa que a tela não
-- mandar ficam como estavam (o Subir venda é quem distribui por item).
-- Retorno: { ok, venda_id, estado, pessoas:int, ids:[{chave, pessoa_id, cliente_id, comprador}], removidas:int }
create or replace function venda_familia_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_neg    uuid := nullif(p ->> 'negocio_id', '')::uuid;
  v_pes    jsonb := case when jsonb_typeof(p -> 'pessoas') = 'array' then p -> 'pessoas' end;
  n        qs_closer_negocios;
  v        qs_vendas;
  v_cli    uuid;
  pe       jsonb;
  v_pcli   uuid;
  v_ant    qs_venda_pessoas;
  v_viaj   jsonb := '[]'::jsonb;
  v_val    numeric;
  v_it     int;
  v_prim   boolean;
  v_comp   boolean;
  v_tem_c  boolean := false;
  v_vin    text;
  v_antes  uuid[];
  v_depois uuid[];
  v_sairam uuid[] := '{}';
  v_ref    date;
  v_mud    int;
begin
  if v_neg is null then raise exception 'negocio-obrigatorio'; end if;
  if v_pes is null then raise exception 'pessoas-invalidas'; end if;
  if jsonb_array_length(v_pes) > 60 then raise exception 'pessoas-demais'; end if;

  select * into n from qs_closer_negocios where id = v_neg for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa in ('perdido','venda_cancelada') then raise exception 'negocio-perdido'; end if;

  perform _venda_do_negocio_garantir(v_neg);
  select * into v from qs_vendas where negocio_id = v_neg for update;
  if v.estado = 'cancelada' then raise exception 'venda-cancelada'; end if;
  v_cli := v.cliente_id;

  -- pessoa_id (linha de qs_venda_pessoas desta venda) → cliente_id/comprador, quando a tela mandar.
  select coalesce(jsonb_agg(case
           when jsonb_typeof(x) = 'object' and nullif(x ->> 'pessoa_id', '') is not null and vp.id is not null
             then x || jsonb_build_object('cliente_id', coalesce(nullif(x ->> 'cliente_id', ''), vp.cliente_id::text),
                                          'comprador', coalesce((x ->> 'comprador')::boolean, false) or vp.comprador,
                                          'chave', coalesce(nullif(x ->> 'chave', ''), vp.chave))
           else x end order by o), '[]'::jsonb)
    into v_pes
    from jsonb_array_elements(v_pes) with ordinality t(x, o)
    left join qs_venda_pessoas vp on vp.venda_id = v.id
          and vp.id::text = case when jsonb_typeof(x) = 'object' then x ->> 'pessoa_id' end;

  -- Venda sem comprador ainda (lead sem nome/contato): o comprador da tela vira o titular.
  if v_cli is null then
    select x into pe from jsonb_array_elements(v_pes) x
     where coalesce((x ->> 'comprador')::boolean, false) and not coalesce((x ->> 'removida')::boolean, false) limit 1;
    if pe is not null then
      v_cli := venda_cliente_resolver(jsonb_build_object('id', pe ->> 'cliente_id', 'nome', pe ->> 'nome',
                 'telefone', pe ->> 'telefone', 'email', pe ->> 'email', 'cpf', pe ->> 'cpf', 'nascimento', pe ->> 'nascimento'));
    end if;
    if v_cli is null then raise exception 'comprador-sem-ficha'; end if;
    update qs_vendas set cliente_id = v_cli, atualizado_em = now() where id = v.id;
  end if;

  -- Quem já está na venda (só com nome/chave) é reconhecido — não duplica ficha.
  v_pes := _venda_viajantes_com_ficha(v.id, v_pes);
  select coalesce(array_agg(cliente_id), '{}') into v_antes
    from qs_venda_pessoas where venda_id = v.id and removida_em is null;

  for pe in select * from jsonb_array_elements(v_pes) loop
    continue when jsonb_typeof(pe) <> 'object';
    continue when coalesce((pe ->> 'removida')::boolean, false);
    if coalesce((pe ->> 'comprador')::boolean, false) then
      v_pcli := v_cli;
    else
      continue when nullif(trim(coalesce(pe ->> 'nome', '')), '') is null and nullif(pe ->> 'cliente_id', '') is null;
      v_pcli := venda_cliente_resolver(jsonb_build_object('id', pe ->> 'cliente_id', 'nome', pe ->> 'nome',
                  'telefone', pe ->> 'telefone', 'email', pe ->> 'email', 'cpf', pe ->> 'cpf', 'nascimento', pe ->> 'nascimento'));
    end if;
    continue when v_pcli is null;
    perform _venda_cliente_completar(v_pcli, pe);
    v_comp := v_pcli = v_cli;
    if v_comp then v_tem_c := true; end if;
    v_vin := nullif(trim(coalesce(pe ->> 'vinculo', '')), '');
    if v_vin is not null and v_vin not in ('conjuge','filho','pai_mae','irmao','amigo','outro') then
      raise exception 'vinculo-invalido';
    end if;
    v_ant := null;
    select * into v_ant from qs_venda_pessoas where venda_id = v.id and cliente_id = v_pcli;
    v_val := case when nullif(pe ->> 'valor', '') is not null then (pe ->> 'valor')::numeric else v_ant.valor end;
    if v_val is not null and v_val < 0 then raise exception 'valor-invalido'; end if;
    -- Uma linha por item em que a pessoa já estava (o sincronizar junta e soma); o valor vai só na 1ª.
    v_prim := true;
    for v_it in select unnest(case when cardinality(coalesce(v_ant.itens, '{}'::int[])) = 0 then array[null::int] else v_ant.itens end) loop
      v_viaj := v_viaj || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'chave', coalesce(nullif(pe ->> 'chave', ''), v_ant.chave),
        'comprador', v_comp,
        'cliente_id', v_pcli,
        'nome', pe ->> 'nome',
        'vinculo', case when v_comp then null else coalesce(v_vin, v_ant.vinculo) end,
        'item', v_it,
        'valor_contratado', case when v_prim then v_val end)));
      v_prim := false;
    end loop;
  end loop;

  -- O comprador não veio na lista: fica como está (valor/itens dele preservados).
  if not v_tem_c then
    v_ant := null;
    select * into v_ant from qs_venda_pessoas where venda_id = v.id and cliente_id = v_cli;
    v_prim := true;
    for v_it in select unnest(case when cardinality(coalesce(v_ant.itens, '{}'::int[])) = 0 then array[null::int] else v_ant.itens end) loop
      v_viaj := v_viaj || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'chave', v_ant.chave, 'comprador', true, 'cliente_id', v_cli, 'item', v_it,
        'valor_contratado', case when v_prim then v_ant.valor end)));
      v_prim := false;
    end loop;
  end if;

  select coalesce(min(i.data_inicio), (now() at time zone 'America/Sao_Paulo')::date) into v_ref
    from qs_venda_itens i where (i.venda_id = v.id or i.negocio_id = v_neg) and i.status <> 'cancelado';
  v_mud := _venda_pessoas_sincronizar(v.id, v_cli, v_viaj, '{}'::jsonb, '{}'::jsonb, v_ref);

  -- Quem saiu: passageiro cancelado (vaga volta) e some do json dos itens (a tela restaura de lá).
  select coalesce(array_agg(cliente_id), '{}') into v_depois
    from qs_venda_pessoas where venda_id = v.id and removida_em is null;
  select coalesce(array_agg(x), '{}') into v_sairam from unnest(v_antes) x where not (x = any(v_depois));
  if cardinality(v_sairam) > 0 then
    perform _venda_pax_cancelar(v.id, null, v_sairam, 'Saiu da venda (família do cartão).');
    perform set_config('qs.venda_itens_rpc', 'on', true);
    update qs_venda_itens i set passageiros = (
        select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
          from jsonb_array_elements(i.passageiros) with ordinality t(x, o)
         where not coalesce(nullif(x ->> 'cliente_id', '')::uuid = any(v_sairam), false))
     where (i.venda_id = v.id or i.negocio_id = v_neg) and jsonb_typeof(i.passageiros) = 'array'
       and exists (select 1 from jsonb_array_elements(i.passageiros) x
                    where coalesce(nullif(x ->> 'cliente_id', '')::uuid = any(v_sairam), false));
    perform set_config('qs.venda_itens_rpc', 'off', true);
  end if;

  -- Mudou alguém → o espelho do cartão leva os cards filhos pro Bitrix (a tela chama o espelhar logo depois; o cron cobre).
  if v_mud > 0 then
    update qs_closer_negocios set bitrix_status = 'pendente', bitrix_erro = null
     where id = v_neg and arquivado_em is null
       and exists (select 1 from qs_leads l where l.id = lead_id and nullif(trim(l.bitrix_id), '') is not null);
  end if;

  return jsonb_build_object('ok', true, 'venda_id', v.id, 'estado', v.estado,
    'pessoas', (select count(*) from qs_venda_pessoas where venda_id = v.id and removida_em is null),
    'ids', coalesce((select jsonb_agg(jsonb_build_object('chave', vp.chave, 'pessoa_id', vp.id,
                                                         'cliente_id', vp.cliente_id, 'comprador', vp.comprador)
                                      order by vp.comprador desc, vp.criado_em)
                       from qs_venda_pessoas vp where vp.venda_id = v.id and vp.removida_em is null), '[]'::jsonb),
    'removidas', cardinality(v_sairam));
end $$;
revoke all on function venda_familia_salvar(jsonb) from public, anon;
grant execute on function venda_familia_salvar(jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_rascunho_salvar — o rascunho da tela (debounce ~1,5 s)
-- ═════════════════════════════════════════════════════════════════════════════
-- p: { negocio_id? | venda_id?, rascunho: {...} }. Cartão sem venda → a venda nasce
-- em 'negociacao'. Não mexe em atualizado_em (a lista do Ops ordena por ele).
-- Retorno: { ok, venda_id, estado }
create or replace function venda_rascunho_salvar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_neg   uuid := nullif(p ->> 'negocio_id', '')::uuid;
  v_id    uuid := nullif(p ->> 'venda_id', '')::uuid;
  v_r     jsonb := p -> 'rascunho';
  n       qs_closer_negocios;
  v       qs_vendas;
begin
  if v_r is null or jsonb_typeof(v_r) <> 'object' then raise exception 'rascunho-invalido'; end if;
  if pg_column_size(v_r) > 1000000 then raise exception 'rascunho-grande-demais'; end if;
  if v_neg is null and v_id is not null then select negocio_id into v_neg from qs_vendas where id = v_id; end if;

  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    select * into v from qs_vendas where negocio_id = v_neg for update;
    if not (closer_pode_mexer(n.closer_id)
            or (coalesce(v.estado in ('reservada','consolidada'), false) and (rel_tem_acesso() or ops_tem_acesso()))) then
      raise exception 'sem-permissao';
    end if;
    if v.id is null then
      perform _venda_do_negocio_garantir(v_neg);
      select * into v from qs_vendas where negocio_id = v_neg for update;
    end if;
  elsif v_id is not null then
    select * into v from qs_vendas where id = v_id for update;
    if not found then raise exception 'venda-nao-encontrada'; end if;
    if not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  else
    raise exception 'negocio-obrigatorio';
  end if;

  update qs_vendas set rascunho = v_r where id = v.id;
  return jsonb_build_object('ok', true, 'venda_id', v.id, 'estado', v.estado);
end $$;
revoke all on function venda_rascunho_salvar(jsonb) from public, anon;
grant execute on function venda_rascunho_salvar(jsonb) to authenticated;

-- Forma curta pedida pela Tela: rpc('venda_rascunho_salvar', { p_negocio, p_rascunho }).
-- (PostgREST escolhe a sobrecarga pelos NOMES dos argumentos: { p } ou { p_negocio, p_rascunho }.)
create or replace function venda_rascunho_salvar(p_negocio uuid, p_rascunho jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select venda_rascunho_salvar(jsonb_build_object('negocio_id', p_negocio, 'rascunho', p_rascunho));
$$;
revoke all on function venda_rascunho_salvar(uuid, jsonb) from public, anon;
grant execute on function venda_rascunho_salvar(uuid, jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_subir — ARQUIVO 0351 + sprint final (marcado "0357" no corpo)
-- ═════════════════════════════════════════════════════════════════════════════
-- Novos em p: acao 'salvar' | 'reservar' (SEM acao = 'reservar' — compatível com a
-- tela antiga, que registrar = ocupar vaga); pagamentos [{forma, valor, data,
-- parcelas, obs, ordem?}] (substitui as linhas; ausente = mantém; o `pagamento`
-- jsonb antigo continua aceito); obs_financeiro; rascunho; venda_id (re-salvar a
-- MESMA venda — Rel/Ops sem cartão: itens casados por id, os que saíram somem). Regras:
--   • 'salvar' em venda em negociação NÃO ocupa vaga (não cria passageiro; o item
--     guarda os viajantes no json que a tela mandou; a pasta da família é gravada).
--   • 'reservar' (ou venda já reservada/consolidada) → estado 'reservada' (consolidada
--     continua consolidada), cria/atualiza passageiros. Vagas: só conta quem AINDA
--     não está ativo na expedição (os desta venda não contam de novo).
--   • Quem sai (pessoa/item removido) = passageiro desta venda cancelado (vaga volta).
--   • Venda consolidada aceita edição sem erro (não volta de estado). Ops/Rel podem
--     editar venda reservada/consolidada do closer (revisão).
--   • Venda cancelada: o closer dono reabre (volta pra 'negociacao'); Ops/Rel não.
-- Retorno: igual à 0351 + estado, acao, cancelados.
create or replace function venda_subir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_origem  text := coalesce(nullif(p ->> 'origem', ''), 'rel');
  v_neg     uuid := nullif(p ->> 'negocio_id', '')::uuid;
  v_viagem  uuid := nullif(p ->> 'viagem_id', '')::uuid;
  n         qs_closer_negocios;
  v_cli     uuid;
  v_venda   uuid;
  v_itens   jsonb := coalesce(p -> 'itens', '[]'::jsonb);
  v_viaj    jsonb := coalesce(p -> 'viajantes', '[]'::jsonb);
  v_pag     jsonb := case when jsonb_typeof(p -> 'pagamento') = 'object' then p -> 'pagamento' else '{}'::jsonb end;
  v_cesp    boolean := coalesce((p ->> 'condicao_especial')::boolean, false);
  v_cobs    text := nullif(trim(coalesce(p ->> 'condicao_obs', '')), '');
  v_total   numeric;
  it        jsonb;
  vj        jsonb;
  i         int := 0;
  v_item_id uuid;
  v_exp     uuid;
  e         expedicoes;
  v_vagas   int;
  v_novos   int;
  v_pcli    uuid;
  v_pax     uuid;
  v_mapa    jsonb := '{}'::jsonb;
  v_npax    int := 0;
  v_par     uuid;
  v_outro   passageiros;
  v_nomes   jsonb;
  v_vin     text;   -- 0350 B2
  v_chaves  jsonb := '{}'::jsonb;   -- 0351
  v_ref     date;                   -- 0351
  v_famerr  text;                   -- 0351
  v_mud     int := 0;
  -- 0357
  v_acao    text := coalesce(nullif(p ->> 'acao', ''), 'reservar');
  vv        qs_vendas;
  v_closer  boolean := false;
  v_estado  text;
  v_ocupa   boolean;
  v_keep    text[] := '{}';
  v_pags    jsonb := case when jsonb_typeof(p -> 'pagamentos') = 'array' then p -> 'pagamentos' end;
  v_pags_a  jsonb;
  v_pags_d  jsonb;
  pg        jsonb;
  k         int := 0;
  v_ncanc   int := 0;
  v_vid     uuid := nullif(p ->> 'venda_id', '')::uuid;
  v_ids     uuid[] := '{}';
begin
  if v_origem not in ('closer','rel','ops') then raise exception 'origem-invalida'; end if;
  if v_acao not in ('salvar','reservar') then raise exception 'acao-invalida'; end if;   -- 0357
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then raise exception 'itens-invalidos'; end if;
  if jsonb_typeof(v_viaj) <> 'array' then v_viaj := '[]'::jsonb; end if;

  -- 0357: venda_id = re-salvar a MESMA venda (Rel/Ops sem cartão; com cartão vale o cartão dela).
  if v_vid is not null then
    select * into vv from qs_vendas where id = v_vid for update;
    if not found then raise exception 'venda-nao-encontrada'; end if;
    if vv.negocio_id is not null then
      if v_neg is null then v_neg := vv.negocio_id;
      elsif v_neg <> vv.negocio_id then raise exception 'venda-de-outro-cartao';
      end if;
    elsif v_neg is not null then
      raise exception 'venda-de-outro-cartao';
    end if;
    if v_viagem is null then v_viagem := vv.viagem_id; end if;
  end if;

  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    -- 0357: a venda do cartão (trava junto) e quem pode mexer
    select * into vv from qs_vendas where negocio_id = v_neg for update;
    v_closer := closer_pode_mexer(n.closer_id);
    if not (v_closer or (coalesce(vv.estado in ('reservada','consolidada'), false) and (rel_tem_acesso() or ops_tem_acesso()))) then
      raise exception 'sem-permissao';
    end if;
  elsif v_origem = 'closer' then
    raise exception 'negocio-obrigatorio';
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;

  -- 0357: pagamento em linhas — confere antes de gravar qualquer coisa
  if v_pags is not null then
    if jsonb_array_length(v_pags) > 30 then raise exception 'pagamentos-demais'; end if;
    for pg in select * from jsonb_array_elements(v_pags) loop
      k := k + 1;
      if jsonb_typeof(pg) <> 'object' then raise exception 'pagamento-invalido:%', k; end if;
      if coalesce(pg ->> 'forma', '') not in ('pix','cartao','boleto','transferencia','dinheiro','link','outro') then
        raise exception 'pagamento-forma-invalida:%', k;
      end if;
      if coalesce(nullif(pg ->> 'valor', '')::numeric, 0) <= 0 then raise exception 'pagamento-sem-valor:%', k; end if;
      if coalesce(nullif(pg ->> 'parcelas', '')::int, 1) not between 1 and 48 then raise exception 'pagamento-parcelas-invalidas:%', k; end if;
      perform nullif(pg ->> 'data', '')::date;   -- data inválida derruba aqui
    end loop;
  end if;

  select coalesce(sum(nullif(x ->> 'valor', '')::numeric), 0) into v_total from jsonb_array_elements(v_itens) x;
  if v_total <= 0 then raise exception 'valor-total-obrigatorio'; end if;

  if v_viagem is not null and nullif(p #>> '{cliente,id}', '') is null and nullif(p #>> '{cliente,nome}', '') is null then
    select cliente_id into v_cli from rel_viagens where id = v_viagem;
  end if;
  if v_cli is null then
    if jsonb_typeof(p -> 'cliente') <> 'object' then raise exception 'pessoa-sem-nome'; end if;
    v_cli := venda_cliente_resolver(p -> 'cliente');
  end if;
  if v_viagem is null and v_neg is not null then v_viagem := n.viagem_id; end if;

  -- 0357: estado
  if vv.estado = 'cancelada' then
    if not v_closer then raise exception 'venda-cancelada'; end if;
    -- O closer reabre: os itens cancelados junto com a venda voltam (os que vieram na lista) ou saem.
    perform set_config('qs.venda_itens_rpc', 'on', true);
    delete from qs_venda_itens where negocio_id = v_neg and status = 'cancelado'
       and not (id::text in (select x ->> 'id' from jsonb_array_elements(v_itens) x where nullif(x ->> 'id', '') is not null));
    update qs_venda_itens set status = 'vendido' where negocio_id = v_neg and status = 'cancelado';
    perform set_config('qs.venda_itens_rpc', 'off', true);
    update qs_vendas set estado = 'negociacao', cancelada_em = null, cancelada_motivo = null, reservada_em = null
     where id = vv.id;
    vv.estado := 'negociacao';
  end if;
  v_estado := coalesce(vv.estado, 'negociacao');
  if v_acao = 'reservar' and v_estado = 'negociacao' then v_estado := 'reservada'; end if;
  v_ocupa := v_estado in ('reservada','consolidada');

  v_venda := vv.id;
  if v_venda is null then
    insert into qs_vendas (origem, negocio_id, viagem_id, cliente_id, valor_total, pagamento, condicao_especial, condicao_obs, observacoes,
                           estado, reservada_em, obs_financeiro, rascunho)
    values (v_origem, v_neg, v_viagem, v_cli, v_total, v_pag, v_cesp, v_cobs, nullif(trim(coalesce(p ->> 'observacoes', '')), ''),
            v_estado, case when v_ocupa then now() end, nullif(trim(coalesce(p ->> 'obs_financeiro', '')), ''),
            case when jsonb_typeof(p -> 'rascunho') = 'object' then p -> 'rascunho' end)
    returning id into v_venda;
  else
    update qs_vendas set cliente_id = v_cli, viagem_id = coalesce(v_viagem, viagem_id), valor_total = v_total,
           pagamento = case when p ? 'pagamento' then v_pag else pagamento end,
           condicao_especial = v_cesp, condicao_obs = v_cobs,
           observacoes = nullif(trim(coalesce(p ->> 'observacoes', '')), ''),
           obs_financeiro = case when p ? 'obs_financeiro' then nullif(trim(coalesce(p ->> 'obs_financeiro', '')), '') else obs_financeiro end,
           rascunho = case when jsonb_typeof(p -> 'rascunho') = 'object' then p -> 'rascunho' else rascunho end,
           estado = v_estado,
           reservada_em = case when v_ocupa then coalesce(reservada_em, now()) else reservada_em end,
           atualizado_em = now()
     where id = v_venda;
  end if;

  -- 0357: linhas de pagamento (substitui; ausente = mantém)
  if v_pags is not null then
    select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor, 'data', data, 'parcelas', parcelas, 'obs', obs) order by ordem), '[]'::jsonb)
      into v_pags_a from qs_venda_pagamentos where venda_id = v_venda;
    delete from qs_venda_pagamentos where venda_id = v_venda;
    insert into qs_venda_pagamentos (venda_id, ordem, forma, valor, data, parcelas, obs)
    select v_venda, coalesce(nullif(x ->> 'ordem', '')::int, o::int), x ->> 'forma', round((x ->> 'valor')::numeric, 2), nullif(x ->> 'data', '')::date,
           coalesce(nullif(x ->> 'parcelas', '')::int, 1), nullif(trim(coalesce(x ->> 'obs', '')), '')
      from jsonb_array_elements(v_pags) with ordinality t(x, o);
    select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor, 'data', data, 'parcelas', parcelas, 'obs', obs) order by ordem), '[]'::jsonb)
      into v_pags_d from qs_venda_pagamentos where venda_id = v_venda;
    if v_estado = 'consolidada' and v_neg is not null and v_pags_a is distinct from v_pags_d then
      insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
      values (v_neg, 'editado',
              'O pagamento da venda mudou depois de consolidada. As contas a receber do Financeiro não se refazem sozinhas — clique em "Consolidar venda" de novo (só refaz se nenhuma parcela foi paga).',
              auth.uid());
    end if;
  end if;

  -- 0351 C1: quem já está nesta venda (só com nome) é reconhecido — não duplica ficha ao reabrir.
  v_viaj := _venda_viajantes_com_ficha(v_venda, v_viaj);

  if v_neg is not null then
    perform _closer_venda_itens_gravar(v_neg, v_itens);   -- 0357: a permissão já foi conferida acima
    perform set_config('qs.venda_itens_rpc', 'on', true);
    update qs_venda_itens set venda_id = v_venda, cliente_id = coalesce(cliente_id, v_cli)
     where negocio_id = v_neg;
  else
    perform set_config('qs.venda_itens_rpc', 'on', true);
    for it in select * from jsonb_array_elements(v_itens) loop
      i := i + 1;
      if nullif(trim(it ->> 'nome'), '') is null then raise exception 'item-sem-nome'; end if;
      if nullif(it ->> 'data_inicio', '') is not null and nullif(it ->> 'data_fim', '') is not null
         and (it ->> 'data_fim')::date < (it ->> 'data_inicio')::date then raise exception 'volta-antes-da-ida'; end if;
      if coalesce(nullif(it ->> 'valor', '')::numeric, 0) < 0 then raise exception 'valor-invalido'; end if;
      -- 0357: re-salvar (venda_id) → o item com o mesmo id é atualizado; os demais nascem.
      v_item_id := nullif(it ->> 'id', '')::uuid;
      if v_item_id is not null and not exists (select 1 from qs_venda_itens where id = v_item_id and venda_id = v_venda and negocio_id is null) then
        v_item_id := null;
      end if;
      if v_item_id is null then
        insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, venda_id, tipo, nome, data_inicio, data_fim, dados,
                                    passageiros, valor, custo, fornecedor, ordem, criado_por)
        values (null, v_viagem, v_cli, v_venda, it ->> 'tipo', left(trim(it ->> 'nome'), 300),
                nullif(it ->> 'data_inicio', '')::date, nullif(it ->> 'data_fim', '')::date,
                case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
                case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else '[]'::jsonb end,
                nullif(it ->> 'valor', '')::numeric, nullif(it ->> 'custo', '')::numeric,
                nullif(trim(coalesce(it ->> 'fornecedor', '')), ''), i, auth.uid())
        returning id into v_item_id;
      else
        update qs_venda_itens set tipo = it ->> 'tipo', nome = left(trim(it ->> 'nome'), 300),
               data_inicio = nullif(it ->> 'data_inicio', '')::date, data_fim = nullif(it ->> 'data_fim', '')::date,
               dados = dados || case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
               passageiros = case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else passageiros end,
               valor = nullif(it ->> 'valor', '')::numeric, custo = nullif(it ->> 'custo', '')::numeric,
               fornecedor = nullif(trim(coalesce(it ->> 'fornecedor', '')), ''), ordem = i,
               viagem_id = coalesce(v_viagem, viagem_id), cliente_id = coalesce(cliente_id, v_cli)
         where id = v_item_id;
      end if;
      v_ids := v_ids || v_item_id;
    end loop;
    -- Item que saiu da lista: some (emitido não pode sair); o passageiro dele é cancelado mais abaixo.
    if exists (select 1 from qs_venda_itens where venda_id = v_venda and negocio_id is null and not (id = any(v_ids)) and status = 'emitido') then
      raise exception 'item-ja-emitido';
    end if;
    delete from qs_venda_itens where venda_id = v_venda and negocio_id is null and not (id = any(v_ids));
  end if;

  i := 0;
  for it in select * from jsonb_array_elements(v_itens) loop
    i := i + 1;
    continue when it ->> 'tipo' <> 'expedicao';
    v_exp := nullif(it #>> '{dados,expedicao_id}', '')::uuid;
    if v_exp is null then raise exception 'expedicao-obrigatoria'; end if;
    select * into e from expedicoes where id = v_exp for update;
    if not found then raise exception 'expedicao-nao-encontrada'; end if;
    if v_neg is not null then
      select id into v_item_id from qs_venda_itens where negocio_id = v_neg and ordem = i;
    else
      select id into v_item_id from qs_venda_itens where venda_id = v_venda and ordem = i;
    end if;

    if not exists (select 1 from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i) then
      v_viaj := v_viaj || jsonb_build_array(jsonb_build_object('chave', 'comprador-' || i, 'item', i, 'comprador', true,
                  'valor_contratado', it ->> 'valor', 'valor_pago', 0));
    end if;

    v_novos := 0;
    v_nomes := '{}'::jsonb;
    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      if nullif(vj ->> 'chave', '') is null then raise exception 'viajante-sem-chave'; end if;
      if coalesce((vj ->> 'comprador')::boolean, false) then v_pcli := v_cli;
      else
        v_pcli := venda_cliente_resolver(jsonb_build_object('id', vj ->> 'cliente_id', 'nome', vj ->> 'nome',
                    'telefone', vj ->> 'telefone', 'email', vj ->> 'email', 'cpf', vj ->> 'cpf',
                    'nascimento', vj ->> 'nascimento'));
        v_vin := nullif(trim(coalesce(vj ->> 'vinculo', '')), '');
        if v_vin in ('conjuge','filho','pai_mae','irmao','amigo','outro') and v_pcli is not null and v_pcli <> v_cli then
          update cad_acompanhantes set vinculo = v_vin
           where cliente_id = v_cli and acompanhante_id = v_pcli and vinculo <> v_vin;
          update cad_acompanhantes set vinculo = cad_vinculo_inverso(v_vin)
           where cliente_id = v_pcli and acompanhante_id = v_cli and vinculo <> cad_vinculo_inverso(v_vin);
          insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo)
          values (v_cli, v_pcli, v_vin)
          on conflict do nothing;
        end if;
      end if;
      v_nomes := v_nomes || jsonb_build_object(vj ->> 'chave', v_pcli);
      v_chaves := v_chaves || jsonb_build_object(vj ->> 'chave', v_pcli);   -- 0351
      if v_ocupa then   -- 0357
        v_keep := v_keep || (v_exp::text || ':' || v_pcli::text);
        -- Só conta quem AINDA não está ativo na expedição (nem na fila do espelho):
        -- quem já é desta venda não ocupa a vaga de novo.
        if not exists (select 1 from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado')
           and not exists (select 1 from exp_venda_pax_pendentes q
                            where q.aplicado_em is null and q.acao = 'insert'
                              and q.linha ->> 'expedicao_id' = v_exp::text and q.linha ->> 'cliente_id' = v_pcli::text) then
          v_novos := v_novos + 1;
        end if;
      end if;
    end loop;

    -- 0357: em negociação ('salvar') não ocupa vaga — sem passageiro; o item guarda o json da tela.
    continue when not v_ocupa;

    v_vagas := greatest(coalesce(e.pax_planejados, 0) - exp_ocupados(v_exp), 0);
    if v_novos > v_vagas then
      raise exception 'sem-vaga:%:%', e.codigo, v_vagas;
    end if;

    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      v_pax := null;
      select id into v_pax from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado'
       order by created_at limit 1;
      if v_pax is null and exists (select 1 from exp_venda_pax_pendentes q
                                    where q.aplicado_em is null and q.acao = 'insert'
                                      and q.linha ->> 'expedicao_id' = v_exp::text and q.linha ->> 'cliente_id' = v_pcli::text) then
        null;   -- 0357: já está na fila do espelho (Operacional em validação) — não duplica
      elsif v_pax is null then
        insert into passageiros (expedicao_id, cliente_id, nome_completo, tipo, status_reserva, telefone, email, cpf,
                                 data_nascimento,
                                 valor_contratado_brl, valor_pago_brl, inscricao_origem, venda_id, venda_item_id,
                                 aereo_incluso, quarto_desejado, acompanhante_dividir_com, condicao_pagamento,
                                 condicao_obs, pagamento, observacoes)
        select v_exp, c.id, c.nome, 'Pagante'::tipo_passageiro, 'Pré-reserva'::status_reserva, c.telefone, c.email, c.cpf,
               c.nascimento,
               nullif(vj ->> 'valor_contratado', '')::numeric, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0),
               'QS — venda (' || v_origem || ')', v_venda, v_item_id,
               (vj ->> 'aereo_incluso')::boolean, nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''),
               nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''),
               case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
               case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, v_pag,
               nullif(trim(coalesce(p ->> 'observacoes', '')), '')
          from rel_clientes c where c.id = v_pcli
        returning id into v_pax;
      else
        update passageiros set
          valor_contratado_brl = coalesce(nullif(vj ->> 'valor_contratado', '')::numeric, valor_contratado_brl),
          valor_pago_brl = greatest(valor_pago_brl, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0)),
          venda_id = v_venda, venda_item_id = v_item_id,
          aereo_incluso = coalesce((vj ->> 'aereo_incluso')::boolean, aereo_incluso),
          quarto_desejado = coalesce(nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''), quarto_desejado),
          acompanhante_dividir_com = coalesce(nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''), acompanhante_dividir_com),
          data_nascimento = coalesce(data_nascimento, (select c.nascimento from rel_clientes c where c.id = v_pcli)),
          condicao_pagamento = case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
          condicao_obs = case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, pagamento = v_pag
         where id = v_pax;
      end if;
      v_mapa := v_mapa || jsonb_build_object(vj ->> 'chave', v_pax);
      v_npax := v_npax + 1;
    end loop;

    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pax := (v_mapa ->> (vj ->> 'chave'))::uuid;
      continue when v_pax is null;
      if nullif(vj ->> 'divide_com_chave', '') is not null and nullif(v_mapa ->> (vj ->> 'divide_com_chave'), '') is not null then
        select coalesce(a.quarto_par_id, b.quarto_par_id, gen_random_uuid()) into v_par
          from passageiros a, passageiros b where a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid;
        update passageiros set quarto_par_id = v_par
         where id in (v_pax, (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
        update passageiros a set acompanhante_dividir_com = b.nome_completo
          from passageiros b
         where (a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid)
            or (b.id = v_pax and a.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
      elsif nullif(vj ->> 'divide_com_passageiro_id', '') is not null then
        select * into v_outro from passageiros
         where id = (vj ->> 'divide_com_passageiro_id')::uuid and expedicao_id = v_exp and status_reserva <> 'Cancelado';
        if not found then raise exception 'par-de-quarto-invalido'; end if;
        v_par := coalesce(v_outro.quarto_par_id, gen_random_uuid());
        update passageiros set quarto_par_id = v_par where id in (v_pax, v_outro.id);
        update passageiros set acompanhante_dividir_com = v_outro.nome_completo where id = v_pax;
        update passageiros set acompanhante_dividir_com = (select nome_completo from passageiros where id = v_pax) where id = v_outro.id;
        if v_outro.venda_id is not null and v_outro.venda_id <> v_venda then
          update qs_vendas set ligada_venda_id = v_outro.venda_id where id = v_venda and ligada_venda_id is null;
          update qs_vendas set ligada_venda_id = v_venda where id = v_outro.venda_id and ligada_venda_id is null;
        end if;
      end if;
    end loop;

    -- 0350 B4: o item guarda quem viaja COM os detalhes.
    if exists (select 1 from passageiros px where px.venda_item_id = v_item_id and px.status_reserva <> 'Cancelado') then
      update qs_venda_itens set passageiros = (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'cliente_id', px.cliente_id, 'nome', px.nome_completo, 'passageiro_id', px.id,
                 'comprador', coalesce(px.cliente_id = v_cli, false),
                 'telefone', px.telefone, 'cpf', px.cpf, 'email', px.email, 'nascimento', px.data_nascimento,
                 'valor_contratado', px.valor_contratado_brl, 'valor_pago', px.valor_pago_brl,
                 'aereo_incluso', px.aereo_incluso, 'quarto_desejado', px.quarto_desejado,
                 'quarto_par_id', px.quarto_par_id, 'divide_nome', px.acompanhante_dividir_com,
                 'vinculo', (select a.vinculo from cad_acompanhantes_de(v_cli) a where a.acompanhante_id = px.cliente_id limit 1))
               order by coalesce(px.cliente_id = v_cli, false) desc, px.created_at), '[]'::jsonb)
          from passageiros px where px.venda_item_id = v_item_id and px.status_reserva <> 'Cancelado')
       where id = v_item_id;
    end if;
  end loop;

  -- 0357: quem saiu (pessoa ou item de expedição removido) = passageiro desta venda cancelado.
  if v_ocupa then
    v_ncanc := _venda_pax_cancelar(v_venda, v_keep, null, 'Saiu da venda (Subir venda).');
    -- Itens: o json das expedições acompanha (quem foi cancelado some).
    if v_ncanc > 0 then
      update qs_venda_itens i set passageiros = (
          select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
            from jsonb_array_elements(i.passageiros) with ordinality t(x, o)
           where nullif(x ->> 'passageiro_id', '') is null
              or exists (select 1 from passageiros px where px.id = (x ->> 'passageiro_id')::uuid and px.status_reserva <> 'Cancelado'))
       where i.venda_id = v_venda and i.tipo = 'expedicao' and jsonb_typeof(i.passageiros) = 'array';
    end if;
  end if;

  -- 0351 C3: a PASTA da família (qs_venda_pessoas) — todos os itens, não só expedição.
  select min(nullif(x ->> 'data_inicio', '')::date) into v_ref from jsonb_array_elements(v_itens) x;
  v_ref := coalesce(v_ref, (now() at time zone 'America/Sao_Paulo')::date);
  begin
    v_mud := _venda_pessoas_sincronizar(v_venda, v_cli, v_viaj, v_chaves, v_mapa, v_ref);
    if v_mud > 0 and v_neg is not null then
      update qs_closer_negocios set bitrix_status = 'pendente', bitrix_erro = null
       where id = v_neg and arquivado_em is null
         and exists (select 1 from qs_leads l where l.id = lead_id and nullif(trim(l.bitrix_id), '') is not null)
         and exists (select 1 from qs_venda_pessoas vp where vp.venda_id = v_venda and not vp.comprador);
    end if;
  exception when others then
    v_famerr := sqlerrm;
    raise warning '0351 família da venda %: %', v_venda, sqlerrm;
  end;

  perform set_config('qs.venda_itens_rpc', 'off', true);
  return jsonb_build_object('ok', true, 'venda_id', v_venda, 'cliente_id', v_cli,
                            'itens', jsonb_array_length(v_itens), 'passageiros', v_npax, 'total', v_total,
                            'pessoas', (select count(*) from qs_venda_pessoas where venda_id = v_venda and removida_em is null),
                            'familia_erro', v_famerr,
                            'estado', v_estado, 'acao', v_acao, 'cancelados', v_ncanc);   -- 0357
end;
$$;
revoke all on function venda_subir(jsonb) from public, anon;
grant execute on function venda_subir(jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_consolidar — confere tudo; se ok, gera viagem do Rel + contas a receber
-- ═════════════════════════════════════════════════════════════════════════════
-- Venda do cartão: monta a ficha a partir da venda e CHAMA closer_consolidar
-- (mesma viagem/rel_viagens, mesmo fin_planos/fin_parcelas, cartão em "Aguardando
-- emissão", consolidada_em, Bitrix pendente). Venda do Rel/Ops (sem cartão):
-- viagem da venda (ou cria) + plano ligado por fin_planos.venda_id.
-- Retorno: { ok:true, venda_id, viagem_id, plano_id, parcelas, avisos:[] } | { ok:false, faltas:[], avisos:[] }
create or replace function venda_consolidar(p_venda uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v        qs_vendas;
  n        qs_closer_negocios;
  v_neg    uuid;
  r        record;
  f        text[] := '{}';
  av       text[] := '{}';
  v_nome   text;
  v_msg    text;
  v_itens  numeric;
  v_nit    int;
  v_npag   int;
  v_soma   numeric;
  v_npes   int;
  v_comv   int;
  v_rat    numeric;
  v_pago   boolean;
  v_parc   jsonb;
  v_ficha  jsonb;
  v_res    jsonb;
  v_viagem uuid;
  v_plano  uuid;
  v_serv   text;
  v_dest   text;
  v_ida    date;
  v_volta  date;
  v_cnome  text;
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Trava na mesma ordem da venda_subir (cartão → venda).
  select negocio_id into v_neg from qs_vendas where id = p_venda;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;
  select * into v from qs_vendas where id = p_venda for update;

  if v.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'faltas', jsonb_build_array('A venda está cancelada — não dá pra consolidar.'), 'avisos', '[]'::jsonb);
  end if;
  select nome into v_cnome from rel_clientes where id = v.cliente_id;

  -- ── Quem comprou ──
  select count(*) into v_npes from qs_venda_pessoas where venda_id = v.id and removida_em is null;
  if v.cliente_id is null or v_npes = 0 then f := f || 'Quem comprou: falta cadastrar quem vai na viagem'::text; end if;
  for r in select vp.comprador, vp.vinculo, rc.nome, rc.cpf, rc.nascimento, rc.telefone, rc.email
             from qs_venda_pessoas vp join rel_clientes rc on rc.id = vp.cliente_id
            where vp.venda_id = v.id and vp.removida_em is null
            order by vp.comprador desc, vp.criado_em loop
    v_nome := coalesce(nullif(trim(r.nome), ''), 'Pessoa sem nome');
    if not r.comprador and r.vinculo is null then f := f || (v_nome || ': falta o vínculo'); end if;
    if r.cpf is null then f := f || (v_nome || ': falta o CPF'); end if;
    if r.nascimento is null then f := f || (v_nome || ': falta a data de nascimento'); end if;
    if r.comprador and r.telefone is null and r.email is null then f := f || (v_nome || ': falta telefone ou e-mail'); end if;
  end loop;

  -- ── O que vendeu + detalhes ──
  select count(*), coalesce(sum(valor), 0) into v_nit, v_itens
    from qs_venda_itens i
   where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado';
  if v_nit = 0 then f := f || 'O que vendeu: nenhum item'::text;
  elsif v_itens <= 0 then f := f || 'O que vendeu: falta o valor dos itens'::text;
  end if;
  for r in select i.id, i.tipo, i.nome, i.ordem, i.valor, i.data_inicio, i.dados, e.nome as exp_nome, e.id as exp_id
             from qs_venda_itens i
             left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
            where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado'
            order by i.ordem loop
    v_nome := coalesce(nullif(trim(r.nome), ''), 'Item ' || r.ordem);
    if coalesce(r.valor, 0) <= 0 then f := f || (v_nome || ': falta o valor'); end if;
    if r.tipo = 'expedicao' then
      if r.exp_id is null then
        f := f || (v_nome || ': falta escolher a expedição');
      else
        select string_agg(rc.nome, ', ' order by rc.nome) into v_msg
          from qs_venda_pessoas vp join rel_clientes rc on rc.id = vp.cliente_id
         where vp.venda_id = v.id and vp.removida_em is null
           and (cardinality(vp.itens) = 0 or r.ordem = any(vp.itens))
           and not exists (select 1 from passageiros px where px.cliente_id = vp.cliente_id and px.expedicao_id = r.exp_id
                              and px.status_reserva <> 'Cancelado')
           and not exists (select 1 from exp_venda_pax_pendentes q where q.aplicado_em is null and q.acao = 'insert'
                              and q.linha ->> 'expedicao_id' = r.exp_id::text and q.linha ->> 'cliente_id' = vp.cliente_id::text);
        if v_msg is not null then
          f := f || (coalesce(r.exp_nome, v_nome) || ': sem vaga reservada para ' || v_msg || ' — clique em "Reservar vaga"');
        end if;
      end if;
    elsif r.tipo not in ('visto','concierge','outro','seguro') and r.data_inicio is null then
      f := f || (v_nome || ': falta a data');
    end if;
  end loop;

  -- ── Pagamento ──
  select count(*), coalesce(sum(valor), 0) into v_npag, v_soma from qs_venda_pagamentos where venda_id = v.id;
  if v_npag = 0 then
    f := f || 'Pagamento: nenhuma linha de pagamento'::text;
  else
    if v_itens > 0 and abs(v_soma - v_itens) > 0.05 then
      f := f || ('Pagamento: soma ' || _brl_txt(v_soma) || ' ≠ total ' || _brl_txt(v_itens));
    end if;
    for r in select ordem, data, valor, parcelas from qs_venda_pagamentos where venda_id = v.id order by ordem loop
      if r.data is null then f := f || ('Pagamento ' || r.ordem || ': falta a data'); end if;
      if round(r.valor * 100) < r.parcelas then f := f || ('Pagamento ' || r.ordem || ': parcelas demais para o valor'); end if;
    end loop;
  end if;

  -- ── Financeiro: parcela já paga → o plano não se refaz por aqui ──
  v_pago := exists (select 1 from fin_planos pl join fin_parcelas x on x.plano_id = pl.id
                     where (pl.venda_id = v.id or (v.negocio_id is not null and pl.negocio_id = v.negocio_id))
                       and x.status = 'pago');
  if v_pago and v.estado <> 'consolidada' then
    f := f || 'Financeiro: já tem parcela paga no plano deste cartão — as contas a receber não se refazem por aqui; combine o ajuste com o Financeiro.'::text;
  end if;

  -- ── Rateio (aviso, não bloqueia: o valor da venda é o dos itens) ──
  select count(valor), coalesce(sum(valor), 0) into v_comv, v_rat
    from qs_venda_pessoas where venda_id = v.id and removida_em is null;
  if v_comv > 0 and v_itens > 0
     and ((v_comv = v_npes and abs(v_rat - v_itens) > 0.05) or v_rat > v_itens + 0.05) then
    av := av || ('Rateio: as pessoas somam ' || _brl_txt(v_rat) || ' e a venda é ' || _brl_txt(v_itens)
                 || ' — o valor da venda não muda; confira o valor de cada pessoa.');
  end if;

  if cardinality(f) > 0 then
    return jsonb_build_object('ok', false, 'faltas', to_jsonb(f), 'avisos', to_jsonb(av));
  end if;

  -- Já consolidada com parcela paga: nada se refaz (a edição da venda já foi gravada).
  if v_pago then
    av := av || 'Financeiro: já tem parcela paga — as contas a receber não foram refeitas. Combine o ajuste com o Financeiro.'::text;
    return jsonb_build_object('ok', true, 'ja_estava', true, 'venda_id', v.id, 'viagem_id', v.viagem_id, 'avisos', to_jsonb(av));
  end if;

  -- ── Monta e grava ──
  v_parc := _venda_pagamentos_parcelas(v.id);
  select case when bool_or(i.tipo = 'expedicao') then 'expedicao' end,
         least(min(i.data_inicio), min(e.data_embarque)), greatest(max(i.data_fim), max(e.data_retorno)),
         (array_agg(e.nome order by i.ordem) filter (where e.nome is not null))[1]
    into v_serv, v_ida, v_volta, v_dest
    from qs_venda_itens i
    left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
   where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado';
  if v_serv is null then
    select case when i.tipo in ('pacote','aereo','hospedagem','passeio','cruzeiro','seguro','concierge') then i.tipo
                when i.tipo in ('transfer','trem','carro') then 'passeio' else 'outro' end,
           i.nome
      into v_serv, v_msg
      from qs_venda_itens i
     where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado'
     order by coalesce(i.valor, 0) desc, i.ordem limit 1;
    v_dest := coalesce(nullif(trim(n.ficha ->> 'destino'), ''), v_msg);
  end if;

  if v.negocio_id is not null then
    v_ficha := coalesce(case when jsonb_typeof(n.ficha) = 'object' then n.ficha end, '{}'::jsonb) || jsonb_build_object(
      'servico', v_serv, 'destino', v_dest, 'data_ida', v_ida, 'data_volta', v_volta, 'qtd_passageiros', v_npes,
      'passageiros', coalesce((select jsonb_agg(jsonb_build_object('nome', rc.nome) order by vp.comprador desc, vp.criado_em)
                                 from qs_venda_pessoas vp join rel_clientes rc on rc.id = vp.cliente_id
                                where vp.venda_id = v.id and vp.removida_em is null), '[]'::jsonb),
      'valor_total', v_itens,
      'itens', coalesce((select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'nome', i.nome, 'descricao', '', 'valor_total', coalesce(i.valor, 0)) order by i.ordem)
                           from qs_venda_itens i where i.negocio_id = v.negocio_id and i.status <> 'cancelado'), '[]'::jsonb),
      'de_itens_da_venda', true,
      'venda_id', v.id,
      'plano', jsonb_build_object('entrada', null, 'parcelas', v_parc, 'observacao_financeiro', v.obs_financeiro));
    begin
      v_res := closer_consolidar(v.negocio_id, v_ficha);
    exception when others then
      v_msg := sqlerrm;
      return jsonb_build_object('ok', false, 'avisos', to_jsonb(av), 'faltas', jsonb_build_array(case
        when v_msg like 'negocio-perdido%' then 'O cartão está em Perdido/Venda cancelada — reabra o cartão antes de consolidar.'
        when v_msg like 'responsavel-invalido%' then 'O responsável no Relacionamento escolhido na ficha não vale mais — troque na ficha.'
        when v_msg like 'plano-ja-tem-pagamento%' then 'Financeiro: já tem parcela paga — combine o ajuste com o Financeiro.'
        when v_msg like 'plano-nao-bate%' then 'Pagamento: a soma das parcelas não bate com o total.'
        when v_msg like 'sem-permissao%' then 'Só o closer dono do cartão (ou a gestão) consolida esta venda.'
        else 'Não deu pra consolidar: ' || v_msg end));
    end;
    v_viagem := nullif(v_res ->> 'viagem_id', '')::uuid;
    v_plano := nullif(v_res ->> 'plano_id', '')::uuid;
    -- A ficha do cliente é a da VENDA (o closer_consolidar acha pelo telefone/e-mail do lead).
    update fin_planos set venda_id = v.id,
           cliente_id = coalesce(v.cliente_id, cliente_id), cliente_nome = coalesce(v_cnome, cliente_nome)
     where id = v_plano;
    if v.cliente_id is not null then
      update rel_viagens set cliente_id = v.cliente_id
       where id = v_viagem and cliente_id is distinct from v.cliente_id
         and (cliente_id is null or cliente_id = nullif(v_res ->> 'cliente_id', '')::uuid);
    end if;
  else
    -- Venda do Rel/Ops (sem cartão).
    v_viagem := v.viagem_id;
    if v_viagem is not null then
      select coalesce(mesclada_em_id, id) into v_viagem from rel_viagens where id = v_viagem;
    end if;
    if v_viagem is null then
      insert into rel_viagens (titulo, destino, tipo, data_venda, data_embarque, data_retorno, valor, qtd_passageiros,
                               cliente_id, status, origem, servico_manual, servico_por, servico_em, consolidada_em, consolidada_por)
      values (left(coalesce(v_dest, 'Venda — ' || coalesce(v_cnome, 'Cliente')), 200), v_dest,
              case when v_serv in ('expedicao','pacote','aereo','hospedagem') then v_serv else 'outro' end,
              v_hoje, v_ida, v_volta, v_itens, v_npes, v.cliente_id, 'ativa', 'manual',
              v_serv, auth.uid(), now(), now(), auth.uid())
      returning id into v_viagem;
    else
      -- A viagem de uma venda do Rel pode ser um extra numa viagem que já tinha valor: não mexe no valor (0338).
      update rel_viagens set consolidada_em = coalesce(consolidada_em, now()), consolidada_por = coalesce(consolidada_por, auth.uid())
       where id = v_viagem;
    end if;
    select id into v_plano from fin_planos where venda_id = v.id;
    if v_plano is null then
      insert into fin_planos (viagem_id, cliente_id, cliente_nome, valor_total, observacao, criado_por, venda_id)
      values (v_viagem, v.cliente_id, v_cnome, v_itens, v.obs_financeiro, auth.uid(), v.id)
      returning id into v_plano;
    else
      update fin_planos set viagem_id = v_viagem, cliente_id = v.cliente_id, cliente_nome = v_cnome, valor_total = v_itens,
             observacao = v.obs_financeiro, atualizado_em = now()
       where id = v_plano;
      delete from fin_parcelas where plano_id = v_plano;
    end if;
    insert into fin_parcelas (plano_id, numero, valor, vencimento, forma, recorrente, observacao)
    select v_plano, o::int, (x ->> 'valor')::numeric, (x ->> 'vencimento')::date, x ->> 'forma',
           coalesce((x ->> 'recorrente')::boolean, false), x ->> 'observacao'
      from jsonb_array_elements(v_parc) with ordinality t(x, o);
    perform set_config('qs.venda_itens_rpc', 'on', true);
    update qs_venda_itens set viagem_id = v_viagem where venda_id = v.id and viagem_id is distinct from v_viagem;
    perform set_config('qs.venda_itens_rpc', 'off', true);
  end if;

  update qs_vendas set estado = 'consolidada', consolidada_em = coalesce(consolidada_em, now()),
         reservada_em = coalesce(reservada_em, now()), viagem_id = coalesce(v_viagem, viagem_id),
         valor_total = v_itens, atualizado_em = now()
   where id = v.id;

  return jsonb_build_object('ok', true, 'venda_id', v.id, 'viagem_id', v_viagem, 'plano_id', v_plano,
                            'parcelas', jsonb_array_length(v_parc), 'avisos', to_jsonb(av));
end $$;
revoke all on function venda_consolidar(uuid) from public, anon;
grant execute on function venda_consolidar(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_cancelar — venda desfeita: passageiros cancelados (vaga volta)
-- ═════════════════════════════════════════════════════════════════════════════
-- Também: itens viram 'cancelado' (total/comissão param de contar); pré-venda
-- aberta no cartão cai (o Bitrix volta pra etapa do cartão pelo espelho);
-- parcelas A RECEBER do Financeiro viram 'cancelado' (paga fica — aviso no plano).
-- NÃO move a etapa do cartão (o closer usa "Venda cancelada"/"Perdido" com motivo)
-- e NÃO cancela a viagem do Rel. O closer dono reabre pelo venda_subir.
-- Retorno: { ok, venda_id, passageiros_cancelados, parcelas_canceladas } | { ok, ja_estava }
create or replace function venda_cancelar(p_venda uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v       qs_vendas;
  n       qs_closer_negocios;
  v_neg   uuid;
  v_mot   text := nullif(trim(coalesce(p_motivo, '')), '');
  v_npax  int := 0;
  v_nparc int := 0;
  v_pago  boolean;
  v_hoje  text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
begin
  if v_mot is null or length(v_mot) < 3 then raise exception 'motivo-obrigatorio'; end if;
  select negocio_id into v_neg from qs_vendas where id = p_venda;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;
  select * into v from qs_vendas where id = p_venda for update;
  if v.estado = 'cancelada' then return jsonb_build_object('ok', true, 'ja_estava', true, 'venda_id', v.id); end if;

  -- 1) Passageiros (vaga volta) — antes dos itens (a flag dos itens seguraria o cancelamento na fila).
  v_npax := _venda_pax_cancelar(v.id, null, null, 'Venda cancelada: ' || v_mot);

  -- 2) Itens
  perform set_config('qs.venda_itens_rpc', 'on', true);
  update qs_venda_itens set status = 'cancelado'
   where (venda_id = v.id or (v.negocio_id is not null and negocio_id = v.negocio_id)) and status <> 'cancelado';
  perform set_config('qs.venda_itens_rpc', 'off', true);

  -- 3) Financeiro
  v_pago := exists (select 1 from fin_planos pl join fin_parcelas x on x.plano_id = pl.id
                     where (pl.venda_id = v.id or (v.negocio_id is not null and pl.negocio_id = v.negocio_id)) and x.status = 'pago');
  update fin_parcelas x set status = 'cancelado', baixa_obs = left('Venda cancelada no QS: ' || v_mot, 500), atualizado_em = now()
    from fin_planos pl
   where pl.id = x.plano_id and (pl.venda_id = v.id or (v.negocio_id is not null and pl.negocio_id = v.negocio_id))
     and x.status = 'a_receber';
  get diagnostics v_nparc = row_count;
  update fin_planos set
    observacao = concat_ws(E'\n', nullif(observacao, ''),
      '[Aviso QS ' || v_hoje || '] Venda cancelada: ' || v_mot || '. Parcelas a receber canceladas'
      || case when v_pago then '; há parcela PAGA — combinar o reembolso com o closer.' else '.' end),
    atualizado_em = now()
   where venda_id = v.id or (v.negocio_id is not null and negocio_id = v.negocio_id);

  -- 4) Cartão: pré-venda aberta cai + histórico
  if v.negocio_id is not null then
    if n.pre_venda_em is not null and n.consolidada_em is null then
      update qs_closer_negocios set
        pre_venda_em = null, pre_venda_por = null, pre_venda_valor = null, pre_venda_tipo = null, pre_venda_tipo_bitrix = null,
        bitrix_status = case when exists (select 1 from qs_leads l where l.id = n.lead_id and nullif(trim(l.bitrix_id), '') is not null)
                             then 'pendente' else 'sem_card' end,
        bitrix_erro = null
       where id = n.id;
    end if;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pre_venda', 'Venda cancelada: ' || v_mot || '. ' || v_npax || ' passageiro(s) cancelado(s) — a vaga volta.'
            || case when v_nparc > 0 then ' ' || v_nparc || ' parcela(s) a receber cancelada(s) no Financeiro.' else '' end,
            auth.uid());
  end if;

  update qs_vendas set estado = 'cancelada', cancelada_em = now(), cancelada_motivo = v_mot, atualizado_em = now()
   where id = v.id;
  return jsonb_build_object('ok', true, 'venda_id', v.id, 'passageiros_cancelados', v_npax, 'parcelas_canceladas', v_nparc);
end $$;
revoke all on function venda_cancelar(uuid, text) from public, anon;
grant execute on function venda_cancelar(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_blocos — Marketing / SDR / Closer / Pós-venda (preenchidos do lead/negócio)
-- ═════════════════════════════════════════════════════════════════════════════
-- { marketing:{origem, utm_source, utm_medium, utm_campaign, utm_content, utm_term, lp, lead_id, lead_criado_em},
--   sdr:{id, nome, agendou_em, reuniao_em, realizada_em}, closer:{id, nome}, pos_venda:{id, nome} }
-- Bloco sem dado = null. `lp` é sempre null hoje (o lead não guarda a página — só UTMs).
-- agendou_em = criação do agendamento ORIGINAL (segue a cadeia de reagendamentos).
-- Venda sem cartão: o lead mais recente da ficha do comprador.
create or replace function venda_blocos(p_venda uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v       qs_vendas;
  n       qs_closer_negocios;
  l       qs_leads;
  m       qs_meetings;
  v_ag    timestamptz;
  v_resp  uuid;
begin
  select * into v from qs_vendas where id = p_venda;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  if v.negocio_id is not null then select * into n from qs_closer_negocios where id = v.negocio_id; end if;
  -- Mesma visão da policy de qs_vendas.
  if not (qs_is_manager() or rel_tem_acesso() or fin_tem_acesso() or ops_tem_acesso()
          or coalesce(v.criado_por = auth.uid(), false) or coalesce(n.closer_id = auth.uid(), false)) then
    raise exception 'sem-permissao';
  end if;

  if n.lead_id is not null then
    select * into l from qs_leads where id = n.lead_id;
  elsif v.cliente_id is not null then
    select * into l from qs_leads where cliente_id = v.cliente_id order by created_at desc limit 1;
  end if;

  if n.meeting_id is not null then select * into m from qs_meetings where id = n.meeting_id; end if;
  if m.id is null and l.id is not null then
    select q.* into m from qs_meetings q join qs_users u on u.id = q.owner_id and u.role = 'sdr'
     where q.lead_id = l.id order by q.created_at desc limit 1;
  end if;
  if m.id is not null then
    with recursive c as (
      select id, reagendado_de, created_at, 1 as nivel from qs_meetings where id = m.id
      union all
      select q.id, q.reagendado_de, q.created_at, c.nivel + 1 from qs_meetings q join c on q.id = c.reagendado_de where c.nivel < 50
    ) select min(created_at) into v_ag from c;
  end if;

  select responsavel_id into v_resp from rel_viagens where id = coalesce(v.viagem_id, n.viagem_id);
  if v_resp is null and jsonb_typeof(n.ficha) = 'object' then
    begin v_resp := nullif(n.ficha ->> 'rel_responsavel_id', '')::uuid; exception when others then v_resp := null; end;
  end if;

  return jsonb_build_object(
    'marketing', case when l.id is null then null else jsonb_build_object(
        'origem', l.source, 'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
        'utm_content', l.utm_content, 'utm_term', l.utm_term, 'lp', null, 'lead_id', l.id, 'lead_criado_em', l.created_at) end,
    'sdr', case when m.id is null or m.owner_id is null then null else jsonb_build_object(
        'id', m.owner_id, 'nome', (select name from qs_users where id = m.owner_id),
        'agendou_em', v_ag, 'reuniao_em', m.scheduled_at, 'realizada_em', m.realizada_em) end,
    'closer', case when n.closer_id is null then null else jsonb_build_object(
        'id', n.closer_id, 'nome', (select name from qs_users where id = n.closer_id)) end,
    'pos_venda', case when v_resp is null then null else jsonb_build_object(
        'id', v_resp, 'nome', (select name from qs_users where id = v_resp)) end);
end $$;
revoke all on function venda_blocos(uuid) from public, anon;
grant execute on function venda_blocos(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_do_contrato — pré-preenche o Subir venda com os contratos já enviados
-- ═════════════════════════════════════════════════════════════════════════════
-- Contratos do cartão em enviado/visualizado/assinado; uma pessoa por ficha (o
-- assinado vence, senão o mais recente). Contrato do cartão (sem pessoa) = o comprador.
-- { negocio_id, contratos:int, tipo:'expedicao'|'pacote'|null, servico:'expedicao'|'aereo'|'pacote'|null,
--   expedicao_id, expedicao_nome, valor,
--   pessoas:[{cliente_id, comprador, nome, cpf, nascimento(aaaa-mm-dd), email, telefone, vinculo, valor, contrato_id, status}] }
-- Dados da pessoa: a ficha (rel_clientes) vence; sem ficha, o que foi no contrato.
-- `servico` = 'aereo' quando o contrato de pacote só inclui aéreo (heurística pelo texto de "inclusos").
create or replace function venda_do_contrato(p_negocio uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  n        qs_closer_negocios;
  v_comp   uuid;
  v_tipo   text;
  v_campos jsonb;
  v_expn   text;
  v_exp    uuid;
  v_serv   text;
  v_pes    jsonb;
  v_valor  numeric;
  v_qtd    int;
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not (closer_pode_mexer(n.closer_id) or rel_tem_acesso() or ops_tem_acesso()) then raise exception 'sem-permissao'; end if;

  select coalesce(
           (select vp.cliente_id from qs_vendas v join qs_venda_pessoas vp on vp.venda_id = v.id and vp.comprador and vp.removida_em is null
             where v.negocio_id = n.id limit 1),
           (select cliente_id from qs_vendas where negocio_id = n.id),
           (select cliente_id from qs_leads where id = n.lead_id))
    into v_comp;

  select c.tipo, c.campos into v_tipo, v_campos
    from qs_contratos c
   where c.negocio_id = n.id and c.status in ('enviado','visualizado','assinado')
   order by (c.status = 'assinado') desc, c.criado_em desc limit 1;

  if v_tipo is not null then
    v_expn := nullif(trim(coalesce(v_campos ->> 'expedicao', '')), '');
    if v_tipo = 'expedicao' and v_expn is not null then
      select id into v_exp from expedicoes
       where lower(trim(nome)) = lower(v_expn) or lower(trim(codigo)) = lower(v_expn)
       order by data_embarque desc nulls last limit 1;
    end if;
    v_serv := case when v_tipo = 'expedicao' then 'expedicao'
                   when lower(trim(coalesce(v_campos ->> 'inclusos', ''))) ~ '^(a[ée]reo|passage[mn])'
                        and coalesce(v_campos ->> 'inclusos', '') !~ E'\n' then 'aereo'
                   else 'pacote' end;
  end if;

  with base as (
    select c.id, c.status, c.criado_em, c.campos, c.venda_pessoa_id,
           coalesce(c.cliente_id, vp.cliente_id, case when c.venda_pessoa_id is null then v_comp end) as cli,
           vp.vinculo,
           coalesce(vp.comprador, c.venda_pessoa_id is null) as comprador
      from qs_contratos c
      left join qs_venda_pessoas vp on vp.id = c.venda_pessoa_id
     where c.negocio_id = n.id and c.status in ('enviado','visualizado','assinado')
  ), um as (
    select distinct on (coalesce(b.cli::text, lower(trim(coalesce(b.campos ->> 'nome', ''))))) b.*
      from base b
     order by coalesce(b.cli::text, lower(trim(coalesce(b.campos ->> 'nome', '')))), (b.status = 'assinado') desc, b.criado_em desc
  )
  select count(*),
         sum(_venda_txt_valor(um.campos ->> 'valor_total')),
         coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', um.cli,
           'comprador', um.comprador or coalesce(um.cli = v_comp, false),
           'nome', coalesce(rc.nome, nullif(trim(um.campos ->> 'nome'), '')),
           'cpf', coalesce(rc.cpf, nullif(regexp_replace(coalesce(um.campos ->> 'cpf', ''), '\D', '', 'g'), '')),
           'nascimento', coalesce(rc.nascimento, _venda_txt_data(um.campos ->> 'nascimento')),
           'email', coalesce(rc.email, nullif(lower(trim(um.campos ->> 'email')), '')),
           'telefone', coalesce(rc.telefone, nullif(regexp_replace(coalesce(um.campos ->> 'telefone', ''), '\D', '', 'g'), '')),
           'vinculo', case when um.comprador or coalesce(um.cli = v_comp, false) then null
                           else coalesce(um.vinculo, (select a.vinculo from cad_acompanhantes_de(v_comp) a where a.acompanhante_id = um.cli limit 1)) end,
           'valor', _venda_txt_valor(um.campos ->> 'valor_total'),
           'contrato_id', um.id, 'status', um.status)
           order by (um.comprador or coalesce(um.cli = v_comp, false)) desc, um.criado_em), '[]'::jsonb)
    into v_qtd, v_valor, v_pes
    from um left join rel_clientes rc on rc.id = um.cli;

  return jsonb_build_object('negocio_id', n.id, 'contratos', coalesce(v_qtd, 0),
                            'tipo', v_tipo, 'servico', v_serv, 'expedicao_id', v_exp,
                            'expedicao_nome', case when v_tipo = 'expedicao' then coalesce((select nome from expedicoes where id = v_exp), v_expn) end,
                            'valor', v_valor, 'pessoas', coalesce(v_pes, '[]'::jsonb));
end $$;
revoke all on function venda_do_contrato(uuid) from public, anon;
grant execute on function venda_do_contrato(uuid) to authenticated;
