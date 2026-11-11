-- supabase/migrations/0358_valor_item_fonte_comissao_estado.sql
-- -----------------------------------------------------------------------------
-- SUBIR VENDA — SPRINT FINAL (11/11/2026), frente BANCO, parte 3: consertos.
-- Contrato comum: docs/SUBIR-VENDA-FINAL.md. DEPENDE DA 0356 (qs_vendas.estado).
--
--   1) _pax_valor_na_venda_trg (era da 0338): o Operacional mudar o valor de UM
--      passageiro reescrevia o valor do ITEM com a soma só de quem tinha valor
--      (R$ 20 mil → R$ 7 mil, e daí venda, cartão, ficha, viagem e Bitrix).
--      REGRA NOVA: o valor do ITEM é a fonte; pessoas são RATEIO.
--        • o viajante no json do item (qs_venda_itens.passageiros) recebe o valor
--          (a tela mostra o rateio) — o `valor` do item NÃO muda;
--        • a pessoa da venda (qs_venda_pessoas.valor) acompanha quando ela só está
--          em expedições (soma dos passageiros dela nesta venda); card filho no
--          Bitrix fica pendente pra levar o valor;
--        • o rateio não fecha (todos com valor e soma ≠ item, ou soma > item) →
--          PENDÊNCIA no histórico do cartão (quem decide é o closer/Ops no Subir venda).
--      O gatilho (trg_passageiros_valor_na_venda) é o mesmo da 0338 — só a função muda.
--
--   2) Comissão (fin_com_fonte_qs, da 0329): só conta venda com estado
--      'reservada' ou 'consolidada' (negociação não é venda; cancelada saiu).
--      A data da venda passa a ser a da RESERVA (coalesce(reservada_em,
--      consolidada_em, criado_em)) — com a 0356 a venda nasce em negociação dias
--      antes de virar venda. Mesmo retorno (create or replace sem mudar colunas).
--
--   3) ops_vendas_para_revisar (0351): só lista venda reservada/consolidada (a de
--      negociação é rascunho do closer) e devolve `estado`.
--      venda_familia (0351): devolve `estado` por venda.
--      As duas por troca pontual na definição VIGENTE (falha se o trecho mudou).
--
-- Volta: rodar de novo o bloco 3 (_pax_valor_na_venda_trg) da 0338, a fin_com_fonte_qs
--   da 0329 e os blocos C/D da 0351.
-- -----------------------------------------------------------------------------

-- ── 1) Valor do Operacional → rateio (o item não muda) ─────────────────────────
create or replace function _pax_valor_na_venda_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item qs_venda_itens;
  v_pax  jsonb;
  v_n    int;
  v_nval int;
  v_soma numeric;
  v_mud  int := 0;
begin
  -- Dentro da venda_subir quem manda é o item (o viajante recebe o valor dele).
  if coalesce(current_setting('qs.venda_itens_rpc', true), '') = 'on' then return null; end if;
  select * into v_item from qs_venda_itens where id = new.venda_item_id for update;
  if not found then return null; end if;

  -- a) O viajante do item guarda o valor dele (rateio). O valor do ITEM não muda.
  v_pax := case when jsonb_typeof(v_item.passageiros) = 'array' then (
    select coalesce(jsonb_agg(case when x ->> 'passageiro_id' = new.id::text
                                   then x || jsonb_build_object('valor_contratado', new.valor_contratado_brl)
                                   else x end order by o), '[]'::jsonb)
      from jsonb_array_elements(v_item.passageiros) with ordinality t(x, o)) else v_item.passageiros end;
  if v_pax is distinct from v_item.passageiros then
    perform set_config('qs.venda_itens_rpc', 'on', true);   -- passa no qs_venda_itens_toca
    update qs_venda_itens set passageiros = v_pax where id = v_item.id;
    perform set_config('qs.venda_itens_rpc', 'off', true);
  end if;

  -- b) A pessoa da venda acompanha (só quem está apenas em expedições desta venda).
  if new.venda_id is not null and new.cliente_id is not null then
    update qs_venda_pessoas vp set
      valor = s.total,
      bitrix_status = case when vp.comprador then vp.bitrix_status
                           when vp.bitrix_status in ('ok','erro') then 'pendente' else vp.bitrix_status end,
      atualizado_em = now()
      from (select sum(p.valor_contratado_brl) as total from passageiros p
             where p.venda_id = new.venda_id and p.cliente_id = new.cliente_id and p.status_reserva <> 'Cancelado') s
     where vp.venda_id = new.venda_id and vp.cliente_id = new.cliente_id and vp.removida_em is null
       and s.total is not null and vp.valor is distinct from s.total
       and not exists (select 1 from qs_venda_itens i
                        where i.venda_id = new.venda_id and i.tipo <> 'expedicao' and i.status <> 'cancelado'
                          and (cardinality(vp.itens) = 0 or i.ordem = any(vp.itens)));
    get diagnostics v_mud = row_count;
    if v_mud > 0 and v_item.negocio_id is not null then
      update qs_closer_negocios set bitrix_status = 'pendente', bitrix_erro = null
       where id = v_item.negocio_id and arquivado_em is null
         and exists (select 1 from qs_leads l where l.id = lead_id and nullif(trim(l.bitrix_id), '') is not null);
    end if;
  end if;

  -- c) Rateio não fecha → pendência no histórico do cartão (o valor da venda NÃO muda).
  select count(*), count(valor_contratado_brl), coalesce(sum(valor_contratado_brl), 0)
    into v_n, v_nval, v_soma
    from passageiros where venda_item_id = v_item.id and status_reserva <> 'Cancelado';
  if v_item.negocio_id is not null and coalesce(v_item.valor, 0) > 0
     and ((v_n > 0 and v_nval = v_n and abs(v_soma - v_item.valor) > 0.05) or v_soma > v_item.valor + 0.05) then
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (v_item.negocio_id, 'editado',
            'Pendência de rateio: o Operacional mudou o valor de ' || coalesce(nullif(trim(new.nome_completo), ''), 'um passageiro')
            || ' para ' || _brl_txt(new.valor_contratado_brl) || '. Os passageiros de "' || v_item.nome || '" somam '
            || _brl_txt(v_soma) || ' e o item vale ' || _brl_txt(v_item.valor)
            || '. O valor da venda NÃO mudou — se for o caso, ajuste o item no Subir venda.',
            auth.uid());
  end if;
  return null;
exception when others then
  perform set_config('qs.venda_itens_rpc', 'off', true);
  raise warning '0358 valor do passageiro % (rateio da venda): %', new.id, sqlerrm;
  return null;
end $$;
-- O gatilho continua o da 0338 (after update of valor_contratado_brl, fora do espelho).

-- ── 2) Comissão só de venda reservada/consolidada ─────────────────────────────
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
    -- a) Itens das vendas do closer — 0358: só venda reservada/consolidada; data = a da reserva
    select 'qs:' || i.id::text as bitrix_id, 'venda'::text as origem,
           coalesce(c.nome, m.lead_name, i.nome) as nome, 'QS'::text as pipeline,
           case when i.status = 'cancelado' then 'Cancelamento' else 'Vendido' end as fase,
           fin_com_tipo_rotulo(i.tipo) as tipo_venda,
           coalesce(e.nome, case when i.tipo = 'expedicao' then i.nome end) as nome_expedicao,
           i.valor as total, i.custo as custo,
           fin_com_dia_br(coalesce(v.reservada_em, v.consolidada_em, v.criado_em)) as data_venda,
           s.name as sdr, uc.name as responsavel_reuniao, null::date as data_reuniao_realizada, false as no_show,
           s.id as sdr_id, n.closer_id as closer_id, null::date as data_quando_agendou,
           v.id as venda_id, n.lead_id as lead_id, v.revisado_em as revisado_em
      from qs_venda_itens i
      join qs_vendas v on v.id = i.venda_id and v.origem = 'closer' and v.estado in ('reservada','consolidada')
      join qs_closer_negocios n on n.id = v.negocio_id
      left join qs_meetings m on m.id = n.meeting_id
      left join sdrs s on s.id = m.owner_id
      left join qs_users uc on uc.id = n.closer_id
      left join rel_clientes c on c.id = v.cliente_id
      left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
     where fin_com_dia_br(coalesce(v.reservada_em, v.consolidada_em, v.criado_em)) >= p_ini
       and fin_com_dia_br(coalesce(v.reservada_em, v.consolidada_em, v.criado_em)) < p_fim
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

-- ── 3) Lista do Ops e pasta da família: estado da venda ───────────────────────
do $$
declare
  def  text;
  novo text;
begin
  def := pg_get_functiondef('public.ops_vendas_para_revisar(boolean)'::regprocedure);
  if def not like '%''estado'', v.estado%' then
    novo := replace(def, $q$'espelho_ligado', v_espelho,$q$, $q$'espelho_ligado', v_espelho, 'estado', v.estado,$q$);
    novo := replace(novo, $q$where v.origem = 'closer'$q$, $q$where v.origem = 'closer' and v.estado in ('reservada','consolidada')$q$);
    if novo = def or novo not like '%v.estado in (''reservada'',''consolidada'')%' or novo not like '%''estado'', v.estado%' then
      raise exception '[0358] ops_vendas_para_revisar mudou — revisar à mão';
    end if;
    execute novo;
  end if;

  def := pg_get_functiondef('public.venda_familia(uuid[])'::regprocedure);
  if def not like '%''estado'', v.estado%' then
    novo := replace(def, $q$'negocio_id', v.negocio_id, 'venda_id', v.id,$q$, $q$'negocio_id', v.negocio_id, 'venda_id', v.id, 'estado', v.estado,$q$);
    if novo = def then raise exception '[0358] venda_familia mudou — revisar à mão'; end if;
    execute novo;
  end if;
end $$;
revoke all on function ops_vendas_para_revisar(boolean) from public, anon;
grant execute on function ops_vendas_para_revisar(boolean) to authenticated;
revoke all on function venda_familia(uuid[]) from public, anon;
grant execute on function venda_familia(uuid[]) to authenticated;
