-- supabase/migrations/0350_venda_subir_completa.sql
-- -----------------------------------------------------------------------------
-- VENDA DIGITADA UMA VEZ SÓ (Bruno, 09/11/2026): "tudo digitado UMA vez só no
-- QS e reaproveitado". O front do Subir venda (src/venda/SubirVenda.tsx +
-- vendaRegras.ts) já manda, por viajante da expedição: CPF, e-mail, nascimento,
-- vínculo com o comprador (cônjuge, filho…), valor, aéreo, quarto e com quem
-- divide. Esta migration faz o banco guardar isso e devolver ao reabrir:
--
--   A) exp_vagas_para_venda() passa a devolver expedicoes.preco_sem_aereo_brl
--      (0220). O closer não lê `expedicoes` (RLS exp_tem_acesso), então sem isto
--      a tela dele não consegue sugerir o preço "só terrestre" do Operacional.
--      Muda o retorno → drop + create + re-grant (mesmos grants da vigente:
--      authenticated e service_role; anon/public sem acesso).
--
--   B) venda_subir(p) — partindo da definição VIGENTE em produção (09/11, igual
--      à 0214), só estas mudanças:
--      B1) o acompanhante é resolvido com o nascimento também
--          (venda_cliente_resolver já sabe completar nascimento — só no vazio);
--      B2) vínculo com o comprador vira cad_acompanhantes (o mesmo da ficha,
--          0213): atualiza o vínculo se o par já existe (nos dois sentidos, com
--          cad_vinculo_inverso), senão cria. O índice único
--          cad_acompanhantes_par_uq (least/greatest) segura duplicata;
--      B3) passageiros.data_nascimento nasce da ficha (insert) e é completado
--          se vazio (update);
--      B4) qs_venda_itens.passageiros (json) deixa de perder detalhe: com linhas
--          em `passageiros`, o json leva comprador, telefone, CPF, e-mail,
--          nascimento, vínculo, valor contratado/pago, aéreo, quarto,
--          quarto_par_id e com quem divide (o front restaura por aqui — o closer
--          não lê `passageiros`). SEM linhas (ex.: espelho do sistema antigo
--          ligado — ops_config.exp_espelho, o gatilho aa_exp_venda_pax_segurar
--          desvia o insert pra exp_venda_pax_pendentes), o json que o front
--          mandou FICA (antes virava '[]' e a lista de quem viaja sumia).
--
--   Flag qs.venda_itens_rpc: a vigente já liga ('on') antes de qualquer escrita
--   em qs_venda_itens/passageiros feita pela própria venda_subir (no caminho do
--   closer, logo depois da closer_venda_itens_salvar, que liga e desliga a dela)
--   e desliga no fim. A 0338 (gatilho em passageiros que respeita a flag) é
--   atendida sem mudança; mantido como está.
--
-- Não chama Bitrix. Não muda permissão (mesmas checagens da vigente).
--
-- Volta:
--   1) exp_vagas_para_venda: drop function exp_vagas_para_venda(); e recriar a
--      da 0214 (supabase/migrations/0214_subir_venda.sql, bloco
--      "create or replace function exp_vagas_para_venda()" — idêntica à vigente
--      em 09/11) + revoke all ... from public, anon; grant execute ... to
--      authenticated, service_role;
--   2) venda_subir: rodar de novo o bloco "create or replace function
--      venda_subir(p jsonb)" da 0214 (idêntico à vigente em 09/11; conferido
--      com pg_get_functiondef). Os vínculos criados em cad_acompanhantes e as
--      datas de nascimento gravadas ficam (são dados corretos da ficha).
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Vagas pra venda + preço sem aéreo
-- ═════════════════════════════════════════════════════════════════════════════
drop function if exists exp_vagas_para_venda();
create function exp_vagas_para_venda()
returns table (
  id uuid, codigo text, nome text, destino text, data_embarque date, data_retorno date,
  status text, preco_venda_brl numeric, preco_sem_aereo_brl numeric, pax_planejados int, ocupados int, vagas int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then
    raise exception 'sem-permissao';
  end if;
  return query
    select e.id, e.codigo, e.nome, e.destino, e.data_embarque, e.data_retorno, e.status::text,
           e.preco_venda_brl, e.preco_sem_aereo_brl,
           coalesce(e.pax_planejados, 0), o.n, greatest(coalesce(e.pax_planejados, 0) - o.n, 0)
      from expedicoes e
      cross join lateral (select exp_ocupados(e.id) as n) o
     where coalesce(e.tipo, 'expedicao') = 'expedicao'
       and e.status::text in ('Planejamento','Vendas Abertas','Em andamento')
       and (e.data_embarque is null or e.data_embarque >= (now() at time zone 'America/Sao_Paulo')::date)
     order by e.data_embarque nulls last, e.codigo;
end;
$$;
revoke all on function exp_vagas_para_venda() from public, anon;
grant execute on function exp_vagas_para_venda() to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) venda_subir — vigente + B1..B4 (marcados no corpo)
-- ═════════════════════════════════════════════════════════════════════════════
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
begin
  if v_origem not in ('closer','rel','ops') then raise exception 'origem-invalida'; end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then raise exception 'itens-invalidos'; end if;
  if jsonb_typeof(v_viaj) <> 'array' then v_viaj := '[]'::jsonb; end if;

  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif v_origem = 'closer' then
    raise exception 'negocio-obrigatorio';
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
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

  if v_neg is not null then select id into v_venda from qs_vendas where negocio_id = v_neg; end if;
  if v_venda is null then
    insert into qs_vendas (origem, negocio_id, viagem_id, cliente_id, valor_total, pagamento, condicao_especial, condicao_obs, observacoes)
    values (v_origem, v_neg, v_viagem, v_cli, v_total, v_pag, v_cesp, v_cobs, nullif(trim(coalesce(p ->> 'observacoes', '')), ''))
    returning id into v_venda;
  else
    update qs_vendas set cliente_id = v_cli, viagem_id = coalesce(v_viagem, viagem_id), valor_total = v_total,
           pagamento = v_pag, condicao_especial = v_cesp, condicao_obs = v_cobs,
           observacoes = nullif(trim(coalesce(p ->> 'observacoes', '')), ''), atualizado_em = now()
     where id = v_venda;
  end if;

  if v_neg is not null then
    perform closer_venda_itens_salvar(v_neg, v_itens);
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
      insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, venda_id, tipo, nome, data_inicio, data_fim, dados,
                                  passageiros, valor, custo, fornecedor, ordem, criado_por)
      values (null, v_viagem, v_cli, v_venda, it ->> 'tipo', left(trim(it ->> 'nome'), 300),
              nullif(it ->> 'data_inicio', '')::date, nullif(it ->> 'data_fim', '')::date,
              case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
              case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else '[]'::jsonb end,
              nullif(it ->> 'valor', '')::numeric, nullif(it ->> 'custo', '')::numeric,
              nullif(trim(coalesce(it ->> 'fornecedor', '')), ''), i, auth.uid());
    end loop;
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
        -- 0350 B1: + nascimento (o resolver só completa o que a ficha não tem)
        v_pcli := venda_cliente_resolver(jsonb_build_object('id', vj ->> 'cliente_id', 'nome', vj ->> 'nome',
                    'telefone', vj ->> 'telefone', 'email', vj ->> 'email', 'cpf', vj ->> 'cpf',
                    'nascimento', vj ->> 'nascimento'));
        -- 0350 B2: vínculo com o comprador → cad_acompanhantes (o mesmo da ficha)
        v_vin := nullif(trim(coalesce(vj ->> 'vinculo', '')), '');
        if v_vin in ('conjuge','filho','pai_mae','irmao','amigo','outro') and v_pcli is not null and v_pcli <> v_cli then
          update cad_acompanhantes set vinculo = v_vin
           where cliente_id = v_cli and acompanhante_id = v_pcli and vinculo <> v_vin;
          update cad_acompanhantes set vinculo = cad_vinculo_inverso(v_vin)
           where cliente_id = v_pcli and acompanhante_id = v_cli and vinculo <> cad_vinculo_inverso(v_vin);
          insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo)
          values (v_cli, v_pcli, v_vin)
          on conflict do nothing;   -- cad_acompanhantes_par_uq: o par (em qualquer sentido) já existe
        end if;
      end if;
      v_nomes := v_nomes || jsonb_build_object(vj ->> 'chave', v_pcli);
      if not exists (select 1 from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado') then
        v_novos := v_novos + 1;
      end if;
    end loop;
    v_vagas := greatest(coalesce(e.pax_planejados, 0) - exp_ocupados(v_exp), 0);
    if v_novos > v_vagas then
      raise exception 'sem-vaga:%:%', e.codigo, v_vagas;
    end if;

    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      select id into v_pax from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado'
       order by created_at limit 1;
      if v_pax is null then
        insert into passageiros (expedicao_id, cliente_id, nome_completo, tipo, status_reserva, telefone, email, cpf,
                                 data_nascimento,   -- 0350 B3
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
          -- 0350 B3: completa o nascimento pela ficha (nunca sobrescreve)
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
      if nullif(vj ->> 'divide_com_chave', '') is not null and v_mapa ? (vj ->> 'divide_com_chave') then
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

    -- 0350 B4: o item guarda quem viaja COM os detalhes (o front restaura daqui;
    -- o closer não lê `passageiros`). Sem linhas (espelho desviou o insert),
    -- mantém o json que o front mandou em vez de zerar.
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

  perform set_config('qs.venda_itens_rpc', 'off', true);
  return jsonb_build_object('ok', true, 'venda_id', v_venda, 'cliente_id', v_cli,
                            'itens', jsonb_array_length(v_itens), 'passageiros', v_npax, 'total', v_total);
end;
$$;
revoke all on function venda_subir(jsonb) from public, anon;
grant execute on function venda_subir(jsonb) to authenticated;
