-- 0369_venda_iata_no_banco.sql
-- -----------------------------------------------------------------------------
-- PEQUENOS DA REVISÃO 12/11/2026.
--
-- 1) IATA NO BANCO: a tela (src/venda/iata.ts › problemasDoAereo) já barra o
--    Consolidar com aéreo sem código IATA; o banco não barrava (outra tela/RPC
--    direta passava). Agora venda_consolidar devolve a MESMA falta em PT-BR
--    (não é exceção: entra na lista "faltas" que a tela já mostra e leva ao
--    passo Detalhes). Regra (igual à tela): item 'aereo', ou 'pacote'/'outro'
--    com dados.aereo_incluso = sim/true → dados.trechos (array; texto JSON
--    também é lido) precisa ter ao menos 1 trecho não em branco, e cada trecho
--    com origem_codigo e destino_codigo de 3 letras, diferentes. Código de 3
--    letras fora da lista de aeroportos continua só AVISO na tela (não barra).
--    Dados atuais (SELECT de 12/11): nenhum item aéreo/pacote/outro em
--    qs_venda_itens → nenhuma venda existente muda de situação.
--    Só o Consolidar é barrado (Salvar e Reservar seguem como na tela).
--    venda_consolidar: partida = versão VIGENTE (md5 do corpo = 0357), só com o
--    bloco marcado "0369" a mais.
--
-- 2) fin_com_vendas_resolver: função de GATILHO (fin_com_vendas) que estava
--    executável por anon/public. Ninguém chama por RPC (grep em src/ e api/:
--    só o CREATE TRIGGER da 0327). Gatilho não precisa de EXECUTE pra disparar
--    → revogado de public/anon/authenticated sem efeito no uso.
--
-- Idempotente. Volta: rodar de novo a venda_consolidar da 0357;
--   drop function if exists _venda_aereo_faltas(jsonb, text);
--   grant execute on function fin_com_vendas_resolver() to public;
-- -----------------------------------------------------------------------------

-- O que falta no aéreo de UM item (vazio = ok). Espelho de problemasDoAereo (iata.ts).
create or replace function _venda_aereo_faltas(p_dados jsonb, p_rotulo text)
returns text[] language plpgsql immutable set search_path = public as $$
declare
  ts  jsonb := p_dados -> 'trechos';
  t   jsonb;
  f   text[] := '{}';
  k   int := 0;
  o   text;
  d   text;
  rot text := coalesce(nullif(trim(p_rotulo), ''), 'Aéreo');
begin
  if jsonb_typeof(ts) = 'string' then
    begin ts := (ts #>> '{}')::jsonb; exception when others then ts := null; end;
  end if;
  if jsonb_typeof(ts) is distinct from 'array' then ts := '[]'::jsonb; end if;
  for t in select x from jsonb_array_elements(ts) x loop
    if jsonb_typeof(t) <> 'object' then continue; end if;
    o := upper(trim(coalesce(t ->> 'origem_codigo', '')));
    d := upper(trim(coalesce(t ->> 'destino_codigo', '')));
    -- trecho em branco (ninguém começou a preencher) não conta
    if o = '' and d = '' and trim(coalesce(t ->> 'origem_texto', '')) = '' and trim(coalesce(t ->> 'destino_texto', '')) = ''
       and trim(coalesce(t ->> 'data', '')) = '' and trim(coalesce(t ->> 'numero', '')) = '' and trim(coalesce(t ->> 'companhia', '')) = '' then
      continue;
    end if;
    k := k + 1;
    if o !~ '^[A-Z]{3}$' or d !~ '^[A-Z]{3}$' then
      f := f || (rot || ': trecho ' || k || ' sem código IATA de '
                 || case when o !~ '^[A-Z]{3}$' and d !~ '^[A-Z]{3}$' then 'origem e destino'
                         when o !~ '^[A-Z]{3}$' then 'origem' else 'destino' end || '.');
    elsif o = d then
      f := f || (rot || ': trecho ' || k || ' com origem e destino iguais (' || o || ').');
    end if;
  end loop;
  if k = 0 then
    f := f || (rot || ': coloque os trechos do voo (origem e destino com o código IATA do aeroporto).');
  end if;
  return f;
end $$;
revoke all on function _venda_aereo_faltas(jsonb, text) from public, anon, authenticated;

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
    -- 0369: aéreo (ou pacote/outro com "Inclui aéreo") só consolida com código IATA (mesma regra de src/venda/iata.ts).
    if r.tipo = 'aereo' or (r.tipo in ('pacote','outro') and lower(coalesce(r.dados ->> 'aereo_incluso', '')) in ('sim','true')) then
      f := f || _venda_aereo_faltas(r.dados, case when r.tipo = 'aereo' then v_nome else v_nome || ' — aéreo' end);
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

-- 2) gatilho fora do alcance do anon
revoke all on function fin_com_vendas_resolver() from public, anon, authenticated;

-- Conferência depois de aplicar (só leitura):
--   select _venda_aereo_faltas('{"trechos":[{"origem_codigo":"GRU","destino_texto":"Europa"}]}', 'Aéreo');
--   select proacl from pg_proc where proname = 'fin_com_vendas_resolver';
