-- supabase/migrations/0338_venda_fonte_unica_propaga.sql
-- -----------------------------------------------------------------------------
-- A VENDA É A FONTE ÚNICA DO VALOR (Bruno, 09/11/2026)
--   "Se o operacional coloca o valor da venda, tem que ficar salvo o valor em
--    tudo — isso é o mais importante."
--
-- Hoje o valor de uma venda do closer mora em 8 lugares: qs_venda_itens.valor,
-- qs_vendas.valor_total, qs_closer_negocios.pre_venda_valor / valor_previsto /
-- ficha.valor_total, rel_viagens.valor, fin_planos.valor_total e
-- passageiros.valor_contratado_brl. Só a 0207 acompanhava (valor_previsto, e só
-- ANTES de fechar). Esta migration faz o valor dos ITENS mandar em tudo:
--
--   1) _venda_propagar(negocio, venda): total = soma dos itens não cancelados.
--      Grava em qs_vendas.valor_total, valor_previsto, pre_venda_valor (se havia
--      pré-venda), ficha.valor_total (+ ficha.itens quando a ficha veio dos
--      itens), rel_viagens.valor (se a venda já foi fechada) e marca o cartão
--      bitrix_status = 'pendente' (o espelho manda o OPPORTUNITY novo — lê
--      ficha.valor_total primeiro, api/_closerBitrixPlano.js).
--      NUNCA mexe em fin_planos.valor_total nem em fin_parcelas: se há plano,
--      escreve um aviso na observação do plano (o Financeiro vê) e no histórico
--      do cartão. O plano só se refaz pelo "Corrigir fechamento" do closer (que
--      já recusa se houver parcela paga — closer_consolidar).
--      Total zero/vazio não propaga (nunca zera nada por tabela).
--   2) Gatilho em qs_venda_itens: CONSTRAINT TRIGGER deferido (roda no COMMIT,
--      depois da venda_subir / closer_venda_itens_salvar terminarem de gravar
--      todos os itens). É idempotente: a 1ª chamada grava, as outras não acham
--      diferença e não fazem nada (nem evento repetido).
--   3) Valor do Operacional → venda: quando passageiros.valor_contratado_brl muda
--      (exp_pax_salvar_valores, aba Valores, ou update direto) num passageiro
--      ligado a um item de venda (venda_item_id), o viajante do item recebe o
--      valor (qs_venda_itens.passageiros[].valor_contratado), o item vira a soma
--      dos viajantes ativos e daí o (2) leva pra venda, cartão, ficha, viagem e
--      Bitrix. Histórico do cartão: "Valor ajustado pelo Operacional: de X para Y".
--      Não roda dentro da própria venda_subir (qs.venda_itens_rpc = on — quem
--      manda ali é o item) nem no espelho do sistema antigo (exp.espelho = on).
--   4) Pagamento da venda mudou depois de fechada → evento no cartão (o plano
--      no Financeiro não se refaz sozinho).
--   5) ops_vendas_para_revisar(todas): a lista da tela "Vendas para revisar" do
--      Operacional (só leitura do que o closer registrou + viajantes). Revisar =
--      venda_marcar_revisada da 0329 (NÃO é aprovação; nada trava).
--
-- Sem laço: a propagação escreve em qs_vendas (o gatilho de lá só olha
-- `pagamento`), qs_closer_negocios (sem mexer em etapa/viagem_id, então os
-- gatilhos de lá não disparam nada de volta), rel_viagens (o gatilho de lá só
-- olha datas/status) e fin_planos.observacao. Nada volta pra qs_venda_itens
-- nem pra passageiros.
--
-- Volta:
--   drop trigger if exists zz_venda_itens_propagar on qs_venda_itens;
--   drop trigger if exists trg_passageiros_valor_na_venda on passageiros;
--   drop trigger if exists trg_qs_vendas_pagamento_mudou on qs_vendas;
--   drop function if exists _venda_itens_propagar_trg(), _pax_valor_na_venda_trg(),
--     _qs_vendas_pagamento_mudou_trg(), _venda_propagar(uuid, uuid), ops_vendas_para_revisar(boolean),
--     _brl_txt(numeric);
--   (os valores já propagados ficam como estão — são os da venda.)
-- -----------------------------------------------------------------------------

-- R$ 1.234,56 (independe do lc_numeric do banco).
create or replace function _brl_txt(v numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;

-- 1) A propagação -------------------------------------------------------------
create or replace function _venda_propagar(p_negocio uuid, p_venda uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n         qs_closer_negocios;
  v_total   numeric;
  v_antes   numeric;
  v_ficha   jsonb;
  v_bitrix  boolean;
  v_ops     boolean := coalesce(current_setting('qs.valor_pelo_ops', true), '') = 'on';
  v_plano   fin_planos;
  v_pago    boolean;
  v_hoje    text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
  v_txt     text;
begin
  -- Venda sem cartão (Relacionamento / Operacional): só o cabeçalho acompanha.
  -- A viagem dela NÃO recebe o total (pode ser um extra numa viagem que já tinha valor).
  if p_negocio is null then
    if p_venda is null then return; end if;
    select sum(valor) into v_total from qs_venda_itens where venda_id = p_venda and status <> 'cancelado';
    if coalesce(v_total, 0) > 0 then
      update qs_vendas set valor_total = v_total, atualizado_em = now()
       where id = p_venda and valor_total is distinct from v_total;
    end if;
    return;
  end if;

  select sum(valor) into v_total from qs_venda_itens where negocio_id = p_negocio and status <> 'cancelado';
  if coalesce(v_total, 0) <= 0 then return; end if;

  update qs_vendas set valor_total = v_total, atualizado_em = now()
   where negocio_id = p_negocio and valor_total is distinct from v_total;

  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then return; end if;

  -- O valor "de antes" que a pessoa via: o da ficha, senão o da pré-venda, senão o previsto.
  v_antes := coalesce(nullif(n.ficha ->> 'valor_total', '')::numeric, n.pre_venda_valor, n.valor_previsto);

  v_ficha := n.ficha;
  if v_ficha is not null and jsonb_typeof(v_ficha) = 'object'
     and nullif(v_ficha ->> 'valor_total', '')::numeric is distinct from v_total then
    v_ficha := jsonb_set(v_ficha, '{valor_total}', to_jsonb(v_total));
    if coalesce((v_ficha ->> 'de_itens_da_venda')::boolean, false) then
      v_ficha := jsonb_set(v_ficha, '{itens}', (
        select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'nome', nome, 'descricao', '', 'valor_total', coalesce(valor, 0)) order by ordem), '[]'::jsonb)
          from qs_venda_itens where negocio_id = p_negocio and status <> 'cancelado'));
    end if;
  end if;

  if v_ficha is not distinct from n.ficha
     and n.valor_previsto is not distinct from v_total
     and (n.pre_venda_em is null or n.pre_venda_valor is not distinct from v_total) then
    -- Cartão já em dia. A viagem pode ter ficado pra trás (fechada antes da 0338).
    if n.consolidada_em is not null and n.viagem_id is not null then
      update rel_viagens set valor = v_total where id = n.viagem_id and valor is distinct from v_total;
    end if;
    return;
  end if;

  v_bitrix := exists (select 1 from qs_leads l where l.id = n.lead_id and nullif(trim(l.bitrix_id), '') is not null);
  update qs_closer_negocios set
    valor_previsto  = v_total,
    pre_venda_valor = case when pre_venda_em is not null then v_total else pre_venda_valor end,
    ficha           = v_ficha,
    bitrix_status   = case when arquivado_em is not null then bitrix_status when v_bitrix then 'pendente' else 'sem_card' end,
    bitrix_erro     = case when arquivado_em is null then null else bitrix_erro end
   where id = n.id;

  if n.consolidada_em is not null and n.viagem_id is not null then
    update rel_viagens set valor = v_total where id = n.viagem_id and valor is distinct from v_total;
  end if;

  v_txt := case when v_ops then 'Valor ajustado pelo Operacional: de ' else 'Valor da venda atualizado: de ' end
           || _brl_txt(v_antes) || ' para ' || _brl_txt(v_total) || '.'
           || case when n.consolidada_em is not null then ' Ficha, viagem e Bitrix acompanham.' else ' O Bitrix acompanha.' end;

  -- Plano no Financeiro: não se refaz por aqui (nunca mexe em parcela).
  select * into v_plano from fin_planos where negocio_id = n.id;
  if found and v_plano.valor_total is distinct from v_total then
    v_pago := exists (select 1 from fin_parcelas where plano_id = v_plano.id and status = 'pago');
    update fin_planos set
      observacao = concat_ws(E'\n', nullif(observacao, ''),
        '[Aviso QS ' || v_hoje || '] A venda mudou para ' || _brl_txt(v_total) || ' e este plano soma '
        || _brl_txt(v_plano.valor_total) || '. O plano NÃO foi refeito: '
        || case when v_pago then 'já tem parcela paga — combine o ajuste com o closer.'
                else 'o closer refaz as parcelas em "Corrigir fechamento".' end),
      atualizado_em = now()
     where id = v_plano.id;
    v_txt := v_txt || ' O plano de pagamento no Financeiro continua em ' || _brl_txt(v_plano.valor_total)
             || case when v_pago then ' (já tem parcela paga — combine com o Financeiro).' else ' — refaça em "Corrigir fechamento".' end;
  end if;

  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (n.id, 'editado', v_txt, auth.uid());
end $$;
revoke all on function _venda_propagar(uuid, uuid) from public, anon, authenticated;

-- 2) Gatilho dos itens (no COMMIT) ------------------------------------------------
create or replace function _venda_itens_propagar_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform _venda_propagar(old.negocio_id, old.venda_id);
    elsif tg_op = 'INSERT' then
      perform _venda_propagar(new.negocio_id, new.venda_id);
    else
      if new.valor is not distinct from old.valor and new.status is not distinct from old.status
         and new.negocio_id is not distinct from old.negocio_id and new.venda_id is not distinct from old.venda_id then
        return null;
      end if;
      perform _venda_propagar(new.negocio_id, new.venda_id);
      if old.negocio_id is distinct from new.negocio_id or old.venda_id is distinct from new.venda_id then
        perform _venda_propagar(old.negocio_id, old.venda_id);
      end if;
    end if;
  exception when others then
    -- Nunca derruba a gravação da venda por causa da propagação.
    raise warning '0338 propagar venda (%): %', tg_op, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists zz_venda_itens_propagar on qs_venda_itens;
create constraint trigger zz_venda_itens_propagar
  after insert or update or delete on qs_venda_itens
  deferrable initially deferred
  for each row execute function _venda_itens_propagar_trg();

-- 3) Valor do Operacional → item da venda ---------------------------------------
create or replace function _pax_valor_na_venda_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item qs_venda_itens;
  v_soma numeric;
  v_pax  jsonb;
begin
  -- Dentro da venda_subir quem manda é o item (o viajante recebe o valor dele).
  if coalesce(current_setting('qs.venda_itens_rpc', true), '') = 'on' then return null; end if;
  select * into v_item from qs_venda_itens where id = new.venda_item_id for update;
  if not found then return null; end if;

  select sum(valor_contratado_brl) into v_soma
    from passageiros where venda_item_id = v_item.id and status_reserva <> 'Cancelado';

  v_pax := case when jsonb_typeof(v_item.passageiros) = 'array' then (
    select coalesce(jsonb_agg(case when x ->> 'passageiro_id' = new.id::text
                                   then x || jsonb_build_object('valor_contratado', new.valor_contratado_brl)
                                   else x end order by o), '[]'::jsonb)
      from jsonb_array_elements(v_item.passageiros) with ordinality t(x, o)) else v_item.passageiros end;

  perform set_config('qs.venda_itens_rpc', 'on', true);   -- passa no qs_venda_itens_toca
  perform set_config('qs.valor_pelo_ops', 'on', true);    -- o evento do cartão diz "pelo Operacional"
  update qs_venda_itens set
    passageiros = v_pax,
    valor = coalesce(nullif(v_soma, 0), valor)
   where id = v_item.id;
  perform set_config('qs.venda_itens_rpc', 'off', true);
  return null;
exception when others then
  perform set_config('qs.venda_itens_rpc', 'off', true);
  raise warning '0338 valor do passageiro % não chegou na venda: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_passageiros_valor_na_venda on passageiros;
create trigger trg_passageiros_valor_na_venda
  after update of valor_contratado_brl on passageiros
  for each row
  when (old.valor_contratado_brl is distinct from new.valor_contratado_brl
        and new.venda_item_id is not null
        and coalesce(current_setting('exp.espelho', true), '') <> 'on')
  execute function _pax_valor_na_venda_trg();

-- 4) Pagamento da venda mudou depois de fechada → aviso no cartão ---------------
create or replace function _qs_vendas_pagamento_mudou_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from fin_planos where negocio_id = new.negocio_id) then
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (new.negocio_id, 'editado',
            'A forma/condição de pagamento da venda mudou depois do fechamento. O plano no Financeiro não se refaz sozinho — confira em "Corrigir fechamento".',
            auth.uid());
  end if;
  return null;
exception when others then
  raise warning '0338 aviso de pagamento (venda %): %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_qs_vendas_pagamento_mudou on qs_vendas;
create trigger trg_qs_vendas_pagamento_mudou
  after update of pagamento, condicao_especial, condicao_obs on qs_vendas
  for each row
  when (new.negocio_id is not null
        and (old.pagamento is distinct from new.pagamento
             or old.condicao_especial is distinct from new.condicao_especial
             or old.condicao_obs is distinct from new.condicao_obs))
  execute function _qs_vendas_pagamento_mudou_trg();

-- 5) A lista "Vendas para revisar" do Operacional ------------------------------
-- p_todas = false: só as do closer ainda sem revisão. true: também as revisadas
-- nos últimos 30 dias (pra desfazer/consultar). Só leitura; revisar é a
-- venda_marcar_revisada (0329).
create or replace function ops_vendas_para_revisar(p_todas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.criado_em desc)
      from (
        select v.criado_em, jsonb_build_object(
          'id', v.id, 'origem', v.origem, 'criado_em', v.criado_em, 'atualizado_em', v.atualizado_em,
          'negocio_id', v.negocio_id, 'valor_total', v.valor_total, 'pagamento', v.pagamento,
          'condicao_especial', v.condicao_especial, 'condicao_obs', v.condicao_obs, 'observacoes', v.observacoes,
          'revisado_em', v.revisado_em, 'revisao_obs', v.revisao_obs, 'revisado_por_nome', ur.name,
          'closer_nome', uc.name, 'etapa', n.etapa, 'consolidada_em', n.consolidada_em,
          'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'nascimento', c.nascimento,
                                        'telefone', c.telefone, 'email', c.email),
          'itens', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'tipo', i.tipo, 'nome', i.nome, 'data_inicio', i.data_inicio, 'data_fim', i.data_fim,
                     'valor', i.valor, 'custo', i.custo, 'status', i.status, 'fornecedor', i.fornecedor,
                     'expedicao_id', nullif(i.dados ->> 'expedicao_id', ''),
                     'expedicao_tipo', e.tipo,
                     'expedicao_nome', coalesce(e.nome, i.dados ->> 'expedicao'),
                     'viajantes', case when i.tipo = 'expedicao' then coalesce(
                       -- já na expedição
                       (select jsonb_agg(jsonb_build_object(
                                 'passageiro_id', p.id, 'nome', p.nome_completo, 'cpf', p.cpf, 'nascimento', p.data_nascimento,
                                 'valor', p.valor_contratado_brl, 'pago', p.valor_pago_brl, 'aereo_incluso', p.aereo_incluso,
                                 'status', p.status_reserva, 'pendente', false) order by p.created_at)
                          from passageiros p where p.venda_item_id = i.id),
                       -- Operacional em validação (0329): ainda na fila, não entrou na expedição
                       (select jsonb_agg(jsonb_build_object(
                                 'passageiro_id', null, 'nome', q.linha ->> 'nome_completo', 'cpf', q.linha ->> 'cpf',
                                 'nascimento', q.linha ->> 'data_nascimento',
                                 'valor', nullif(q.linha ->> 'valor_contratado_brl', '')::numeric,
                                 'pago', nullif(q.linha ->> 'valor_pago_brl', '')::numeric,
                                 'aereo_incluso', (q.linha ->> 'aereo_incluso')::boolean,
                                 'status', 'Na fila (validação)', 'pendente', true) order by q.criado_em)
                          from exp_venda_pax_pendentes q
                         where q.aplicado_em is null and q.linha ->> 'venda_item_id' = i.id::text),
                       '[]'::jsonb)
                     else coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'passageiro_id', null, 'nome', coalesce(rc.nome, px ->> 'nome'), 'cpf', rc.cpf, 'nascimento', rc.nascimento,
                                'valor', null, 'pago', null, 'aereo_incluso', null, 'status', null, 'pendente', false) order by o)
                         from jsonb_array_elements(case when jsonb_typeof(i.passageiros) = 'array' then i.passageiros else '[]'::jsonb end)
                              with ordinality t(px, o)
                         left join rel_clientes rc on rc.id = nullif(px ->> 'cliente_id', '')::uuid), '[]'::jsonb)
                     end) order by i.ordem)
              from qs_venda_itens i
              left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
             where i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)), '[]'::jsonb)
        ) as j
          from qs_vendas v
          left join qs_closer_negocios n on n.id = v.negocio_id
          left join qs_users uc on uc.id = n.closer_id
          left join qs_users ur on ur.id = v.revisado_por
          left join rel_clientes c on c.id = v.cliente_id
         where v.origem = 'closer'
           and (v.revisado_em is null or (p_todas and v.revisado_em > now() - interval '30 days'))
         order by v.criado_em desc
         limit 300
      ) x), '[]'::jsonb);
end $$;
revoke all on function ops_vendas_para_revisar(boolean) from public, anon;
grant execute on function ops_vendas_para_revisar(boolean) to authenticated;
