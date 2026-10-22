-- 0176_closer_venda_consolidada.sql
-- -----------------------------------------------------------------------------
-- VENDA CONSOLIDADA (Bruno, 22/10/2026): "QS manda, Bitrix espelha".
--
-- Diagnóstico do dia: 38 pacotes/aéreos embarcando em 120 dias, os 38 sem
-- responsável e 37 sem necessidades — a viagem nascia do sync do Bitrix sem
-- itens, sem pagamento, sem dono e sem preferências. A FICHA DE FECHAMENTO do
-- closer resolve na origem. Ao consolidar (closer_consolidar):
--
--   (a) cria OU atualiza a viagem em rel_viagens. A viagem é achada pelo
--       negócio do Bitrix do lead (qs_leads.bitrix_id = rel_viagens.bitrix_deal_id,
--       ou a ligação de rel_viagem_deals) — o mesmo id que o sync usa, então o
--       sync NÃO cria outra. A viagem ganha consolidada_em e, a partir daí, o
--       sync (api/rel-viagens.js) não sobrescreve os campos da venda.
--       Grava serviço (servico_manual), necessidades/preferências e o dono no
--       Relacionamento (vazio = fila "sem dono").
--   (b) grava o PLANO DE PAGAMENTO em fin_planos/fin_parcelas (0175).
--   (c) o espelho no Bitrix (valor + "Venda realizada") é do api/closer.js,
--       logo depois — aqui o cartão fica com bitrix_status = 'pendente'.
--   (d) o cartão vai para "Venda consolidada".
--
-- Formato da ficha (jsonb):
--   { servico, destino, data_ida, data_volta, qtd_passageiros,
--     passageiros: [{nome}], valor_total, proposta_id, opcao_id,
--     itens: [{tipo, nome, descricao, valor_total}],
--     plano: { entrada: {valor, vencimento, forma, observacao} | null,
--              parcelas: [{valor, vencimento, forma, recorrente, observacao}],
--              observacao_financeiro },
--     preferencias: { gostos, alergias, restricoes, ocasiao, outras },
--     rel_responsavel_id }
-- -----------------------------------------------------------------------------

alter table rel_viagens add column if not exists consolidada_em   timestamptz;
alter table rel_viagens add column if not exists consolidada_por  uuid references qs_users(id) on delete set null;
alter table rel_viagens add column if not exists closer_negocio_id uuid references qs_closer_negocios(id) on delete set null;

-- Viagem que nasce da ficha do closer (sem card do Bitrix pra puxar) = origem 'closer'.
alter table rel_viagens drop constraint if exists rel_viagens_origem_check;
alter table rel_viagens add constraint rel_viagens_origem_check
  check (origem = any (array['bitrix','manual','expedicoes','closer']));

-- ── Texto das preferências (vai pro campo "necessidades" da viagem) ─────────
create or replace function closer_texto_preferencias(p jsonb) returns text
language sql immutable set search_path = public as $$
  select nullif(concat_ws(E'\n',
    case when nullif(trim(p ->> 'gostos'), '') is not null then 'Gostos: ' || trim(p ->> 'gostos') end,
    case when nullif(trim(p ->> 'alergias'), '') is not null then 'Alergias: ' || trim(p ->> 'alergias') end,
    case when nullif(trim(p ->> 'restricoes'), '') is not null then 'Restrições: ' || trim(p ->> 'restricoes') end,
    case when nullif(trim(p ->> 'ocasiao'), '') is not null then 'Ocasião especial: ' || trim(p ->> 'ocasiao') end,
    case when nullif(trim(p ->> 'outras'), '') is not null then 'Outras: ' || trim(p ->> 'outras') end
  ), '');
$$;

-- ── CONSOLIDAR ─────────────────────────────────────────────────────────────
create or replace function closer_consolidar(p_negocio uuid, p_ficha jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n          qs_closer_negocios;
  l          qs_leads;
  v_servico  text := coalesce(nullif(p_ficha ->> 'servico', ''), 'pacote');
  v_tipo     text;
  v_total    numeric := nullif(p_ficha ->> 'valor_total', '')::numeric;
  v_ida      date := nullif(p_ficha ->> 'data_ida', '')::date;
  v_volta    date := nullif(p_ficha ->> 'data_volta', '')::date;
  v_destino  text := nullif(trim(p_ficha ->> 'destino'), '');
  v_pax      int := nullif(p_ficha ->> 'qtd_passageiros', '')::int;
  v_resp     uuid := nullif(p_ficha ->> 'rel_responsavel_id', '')::uuid;
  v_prefs    text := closer_texto_preferencias(coalesce(p_ficha -> 'preferencias', '{}'::jsonb));
  v_nome     text;
  v_fone     text;
  v_cliente  uuid;
  v_viagem   uuid;
  v_plano    uuid;
  v_soma     numeric := 0;
  v_hoje     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_bloco    text;
  v_nec      text;
  ent        jsonb;
  par        jsonb;
  i          int := 0;
  atual      rel_viagens;
begin
  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;
  select * into l from qs_leads where id = n.lead_id;

  -- ── Validação ──
  if v_servico not in ('expedicao','pacote','aereo','hospedagem','passeio','cruzeiro','seguro','concierge','conta_liminar','outro') then
    raise exception 'servico-invalido';
  end if;
  if v_total is null or v_total <= 0 then raise exception 'valor-total-obrigatorio'; end if;
  if v_ida is not null and v_volta is not null and v_volta < v_ida then raise exception 'volta-antes-da-ida'; end if;
  if v_resp is not null and not exists (
       select 1 from qs_users where id = v_resp and is_active
          and (role = 'admin' or 'relacionamento' = any(coalesce(setores, '{}')))) then
    raise exception 'responsavel-invalido';
  end if;
  ent := p_ficha -> 'plano' -> 'entrada';
  if ent is not null and jsonb_typeof(ent) = 'object' and coalesce(nullif(ent ->> 'valor', '')::numeric, 0) > 0 then
    if nullif(ent ->> 'vencimento', '') is null then raise exception 'entrada-sem-vencimento'; end if;
    v_soma := v_soma + (ent ->> 'valor')::numeric;
  else
    ent := null;
  end if;
  for par in select * from jsonb_array_elements(coalesce(p_ficha -> 'plano' -> 'parcelas', '[]'::jsonb)) loop
    if coalesce(nullif(par ->> 'valor', '')::numeric, 0) <= 0 then raise exception 'parcela-sem-valor'; end if;
    if nullif(par ->> 'vencimento', '') is null then raise exception 'parcela-sem-vencimento'; end if;
    v_soma := v_soma + (par ->> 'valor')::numeric;
  end loop;
  if v_soma = 0 then raise exception 'plano-vazio'; end if;
  if abs(v_soma - v_total) > 0.05 then raise exception 'plano-nao-bate:%', v_soma; end if;
  -- Já tem parcela paga? Aí o plano não se refaz por aqui.
  if exists (select 1 from fin_planos p join fin_parcelas x on x.plano_id = p.id
              where p.negocio_id = n.id and x.status = 'pago') then
    raise exception 'plano-ja-tem-pagamento';
  end if;

  v_tipo := case v_servico when 'expedicao' then 'expedicao' when 'pacote' then 'pacote'
                           when 'aereo' then 'aereo' when 'hospedagem' then 'hospedagem' else 'outro' end;
  v_nome := coalesce(nullif(trim(l.full_name), ''), nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Cliente');

  -- ── Cliente (ficha única do Relacionamento): telefone → e-mail → cria ──
  v_fone := regexp_replace(coalesce(l.phone, ''), '\D', '', 'g');
  if length(v_fone) in (10, 11) then v_fone := '55' || v_fone; end if;
  if v_fone <> '' then
    select id into v_cliente from rel_clientes
     where telefone = v_fone and mesclado_em_id is null and arquivado_em is null
     order by titular_id nulls first, criado_em limit 1;
  end if;
  if v_cliente is null and nullif(trim(l.email), '') is not null then
    select id into v_cliente from rel_clientes
     where email = lower(trim(l.email)) and mesclado_em_id is null and arquivado_em is null
     order by titular_id nulls first, criado_em limit 1;
  end if;
  if v_cliente is null then
    insert into rel_clientes (nome, telefone, email, criado_por)
    values (v_nome, nullif(v_fone, ''), nullif(trim(l.email), ''), auth.uid())
    returning id into v_cliente;
  end if;

  -- ── Viagem: a do cartão → a do negócio do Bitrix → a ligada → cria ──
  v_viagem := n.viagem_id;
  if v_viagem is null and nullif(trim(l.bitrix_id), '') is not null then
    select id into v_viagem from rel_viagens
     where bitrix_deal_id = trim(l.bitrix_id) and mesclada_em_id is null
     order by criado_em limit 1;
    if v_viagem is null then
      select d.viagem_id into v_viagem from rel_viagem_deals d where d.bitrix_deal_id = trim(l.bitrix_id) limit 1;
    end if;
  end if;
  -- Viagem mesclada em outra: segue pra principal.
  if v_viagem is not null then
    select * into atual from rel_viagens where id = v_viagem;
    if atual.mesclada_em_id is not null then
      v_viagem := atual.mesclada_em_id;
      select * into atual from rel_viagens where id = v_viagem;
    end if;
  end if;

  -- Necessidades: o bloco da ficha fica em cima; o que já existia (Bitrix/time) fica embaixo.
  v_bloco := case when v_prefs is not null then '[Ficha do closer]' || E'\n' || v_prefs || E'\n' || '[/Ficha do closer]' end;
  v_nec := atual.necessidades;
  if v_nec like '[Ficha do closer]%' then
    v_nec := nullif(trim(substr(v_nec, strpos(v_nec, '[/Ficha do closer]') + length('[/Ficha do closer]'))), '');
  end if;
  v_nec := nullif(concat_ws(E'\n\n', v_bloco, v_nec), '');

  if v_viagem is null then
    insert into rel_viagens (titulo, destino, tipo, data_venda, data_embarque, data_retorno, valor, qtd_passageiros,
                             cliente_id, responsavel_id, bitrix_deal_id, status, necessidades, origem,
                             servico_manual, servico_por, servico_em, consolidada_em, consolidada_por, closer_negocio_id)
    values (left(coalesce(v_destino, 'Venda — ' || v_nome), 200), v_destino, v_tipo, v_hoje, v_ida, v_volta, v_total, v_pax,
            v_cliente, v_resp, nullif(trim(l.bitrix_id), ''), 'ativa', v_nec, 'closer',
            v_servico, auth.uid(), now(), now(), auth.uid(), n.id)
    returning id into v_viagem;
  else
    update rel_viagens set
      destino         = coalesce(v_destino, destino),
      titulo          = case when v_destino is not null and (titulo is null or titulo ~ '— #\d+$' or titulo = destino) then left(v_destino, 200) else titulo end,
      tipo            = case when tipo = 'expedicao' then tipo else v_tipo end,
      data_venda      = coalesce(data_venda, v_hoje),
      data_embarque   = coalesce(v_ida, data_embarque),
      data_retorno    = coalesce(v_volta, data_retorno),
      valor           = v_total,
      qtd_passageiros = coalesce(v_pax, qtd_passageiros),
      cliente_id      = coalesce(cliente_id, v_cliente),
      responsavel_id  = coalesce(v_resp, responsavel_id),
      bitrix_deal_id  = coalesce(bitrix_deal_id, nullif(trim(l.bitrix_id), '')),
      status          = 'ativa',
      necessidades    = v_nec,
      servico_manual  = v_servico,
      servico_por     = auth.uid(),
      servico_em      = now(),
      consolidada_em  = now(),
      consolidada_por = auth.uid(),
      closer_negocio_id = n.id
     where id = v_viagem;
  end if;

  -- ── Plano de pagamento (Financeiro) ──
  select id into v_plano from fin_planos where negocio_id = n.id;
  if v_plano is null then
    insert into fin_planos (negocio_id, viagem_id, lead_id, cliente_id, cliente_nome, closer_id, valor_total, observacao, criado_por)
    values (n.id, v_viagem, n.lead_id, v_cliente, v_nome, n.closer_id, v_total,
            nullif(trim(p_ficha -> 'plano' ->> 'observacao_financeiro'), ''), auth.uid())
    returning id into v_plano;
  else
    update fin_planos set viagem_id = v_viagem, cliente_id = v_cliente, cliente_nome = v_nome, valor_total = v_total,
           observacao = nullif(trim(p_ficha -> 'plano' ->> 'observacao_financeiro'), ''), atualizado_em = now()
     where id = v_plano;
    delete from fin_parcelas where plano_id = v_plano;
  end if;
  if ent is not null then
    insert into fin_parcelas (plano_id, numero, valor, vencimento, forma, recorrente, observacao)
    values (v_plano, 0, (ent ->> 'valor')::numeric, (ent ->> 'vencimento')::date,
            coalesce(nullif(ent ->> 'forma', ''), 'pix'), false, nullif(trim(ent ->> 'observacao'), ''));
  end if;
  for par in select * from jsonb_array_elements(coalesce(p_ficha -> 'plano' -> 'parcelas', '[]'::jsonb)) loop
    i := i + 1;
    insert into fin_parcelas (plano_id, numero, valor, vencimento, forma, recorrente, observacao)
    values (v_plano, i, (par ->> 'valor')::numeric, (par ->> 'vencimento')::date,
            coalesce(nullif(par ->> 'forma', ''), 'pix'), coalesce((par ->> 'recorrente')::boolean, false),
            nullif(trim(par ->> 'observacao'), ''));
  end loop;

  -- ── O cartão ──
  update qs_closer_negocios set
    etapa = 'consolidada', ficha = p_ficha, viagem_id = v_viagem, valor_previsto = v_total,
    consolidada_em = now(), consolidada_por = auth.uid(),
    proposta_id = coalesce(nullif(p_ficha ->> 'proposta_id', '')::uuid, proposta_id),
    bitrix_status = case when nullif(trim(l.bitrix_id), '') is null then 'sem_card' else 'pendente' end,
    bitrix_erro = null
   where id = n.id;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
  values (n.id, 'consolidado', n.etapa, 'consolidada',
          'Venda consolidada: ' || to_char(v_total, 'FM999G999G990D00') || ' — viagem e plano de pagamento gravados.', auth.uid());

  return jsonb_build_object('viagem_id', v_viagem, 'plano_id', v_plano, 'cliente_id', v_cliente,
                            'bitrix_deal_id', nullif(trim(l.bitrix_id), ''));
end;
$$;
revoke all on function closer_consolidar(uuid, jsonb) from public, anon;
grant execute on function closer_consolidar(uuid, jsonb) to authenticated;

-- ── Ficha consolidada de UMA viagem (o card da viagem no Rel mostra isto) ───
-- Somente leitura. Vê: Relacionamento, Financeiro, Operações, gestor/admin e o
-- closer dono.
create or replace function closer_ficha_da_viagem(p_viagem uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  n   qs_closer_negocios;
  out jsonb;
begin
  select * into n from qs_closer_negocios
   where viagem_id = p_viagem and etapa = 'consolidada'
   order by consolidada_em desc nulls last limit 1;
  if not found then return null; end if;
  if not (rel_tem_acesso() or fin_tem_acesso() or qs_do_setor('operacional') or qs_is_manager() or n.closer_id = auth.uid()) then
    raise exception 'sem-permissao';
  end if;
  select jsonb_build_object(
    'negocio_id', n.id,
    'ficha', n.ficha,
    'consolidada_em', n.consolidada_em,
    'closer_nome', (select name from qs_users where id = n.closer_id),
    'consolidada_por_nome', (select name from qs_users where id = n.consolidada_por),
    'responsavel_nome', (select u.name from qs_users u where u.id = nullif(n.ficha ->> 'rel_responsavel_id', '')::uuid),
    'bitrix_status', n.bitrix_status,
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object('numero', x.numero, 'valor', x.valor, 'vencimento', x.vencimento,
                                          'forma', x.forma, 'recorrente', x.recorrente, 'status', x.status,
                                          'atrasada', x.status = 'a_receber' and x.vencimento < (now() at time zone 'America/Sao_Paulo')::date)
                       order by x.numero)
        from fin_planos p join fin_parcelas x on x.plano_id = p.id where p.negocio_id = n.id), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;
revoke all on function closer_ficha_da_viagem(uuid) from public, anon;
grant execute on function closer_ficha_da_viagem(uuid) to authenticated;

-- Lista de quem pode ser dono no Relacionamento (o closer não lê qs_users de outra área à toa).
create or replace function closer_responsaveis_rel()
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select u.id, u.name from qs_users u
   where u.is_active and u.role <> 'admin' and 'relacionamento' = any(coalesce(u.setores, '{}'))
     and (qs_is_manager() or qs_is_closer())
   order by u.name;
$$;
revoke all on function closer_responsaveis_rel() from public, anon;
grant execute on function closer_responsaveis_rel() to authenticated;
