-- 0388_ponte_venda_pos_consolidacao.sql
-- -----------------------------------------------------------------------------
-- PONTE PÓS-VENDA (4/5) — VENDA ALTERADA DEPOIS DE CONSOLIDADA (13/11/2026).
-- Depende da 0385 (_ponte_aviso_plano, _ponte_planos, _ponte_evento_viagem).
--
-- POR QUÊ (auditoria 13/11):
--   • _venda_propagar só avisava o plano procurando por negocio_id; venda sem
--     cartão (negocio_id nulo) nem avisava, e fin_planos.venda_id era ignorado;
--   • trg_qs_vendas_pagamento_mudou tinha WHEN negocio_id IS NOT NULL e também
--     procurava o plano só por negocio_id;
--   • datas, quantidade de passageiros e destino da viagem do Rel eram copiados
--     só na consolidação — mudar o item depois não chegava ao Rel;
--   • ninguém via a fila de planos que não batem mais com a venda;
--   • viagem cancelada no Rel não avisava a venda nem o plano (item 5);
--   • valor mudado no Ops (_pax_valor_na_venda_trg) não avisava o plano (item 7).
--
-- O QUE FAZ (só avisos e marcações — NADA de dinheiro muda sozinho; parcelas
-- NUNCA são refeitas automaticamente, com ou sem parcela paga):
--   1. _venda_viagem_recalcular(venda): venda CONSOLIDADA → a viagem do Rel
--      acompanha datas (menor início / maior fim dos itens, igual ao
--      venda_consolidar), qtd_passageiros (pessoas da venda) e destino (nome da
--      expedição do item). Viagem com datas_travadas não é tocada. Evento no
--      Histórico da viagem. Gatilhos em qs_venda_itens (datas/expedição/status)
--      e qs_venda_pessoas (entra/sai pessoa).
--   2. _venda_propagar (versão VIGENTE de 13/11 + ): plano achado por
--      negocio_id OU venda_id; venda sem cartão também avisa o plano e leva o
--      valor para a viagem consolidada; chama o recálculo do item 1.
--   3. Pagamento mudou (qs_vendas.pagamento/condição — agora com ou sem cartão —
--      e as linhas de qs_venda_pagamentos, checadas no fim da transação): aviso
--      no plano (por venda_id ou negocio_id) e evento no cartão.
--   4. fin_planos_divergentes_v (security_invoker): plano ≠ venda (valor),
--      parcelas ≠ plano, parcelas ≠ pagamentos da venda. O Financeiro vê a fila
--      em Contas a receber (src/fin/receber/PlanosDivergentes.tsx).
--   5. Viagem cancelada no Rel (status → 'cancelada' por gente): aviso na venda
--      (qs_vendas.observacoes), no cartão e no plano. Cancelamento que veio do
--      venda_cancelar ou da ponte de passageiros (0386) não duplica.
--   6. _pax_valor_na_venda_trg (versão VIGENTE da 0358 + ): também deixa
--      "[Aviso QS …]" no plano ligado (item 7).
--
-- Laços: o recálculo grava só rel_viagens (cujo gatilho não volta a vendas); o
-- aviso de viagem cancelada grava qs_vendas.observacoes sem mexer em
-- atualizado_em/estado/pagamento (os gatilhos de qs_vendas não reagem).
--
-- COMO CONFERIR:
--   select * from fin_planos_divergentes_v;
--   -- mude a data de um item de uma venda consolidada e veja a viagem:
--   select data_embarque, data_retorno, qtd_passageiros from rel_viagens where id = '<viagem>';
--   select * from rel_viagem_eventos where motivo like 'Ponte venda%' order by em desc;
--
-- COMO VOLTAR:
--   drop trigger if exists zz_ponte_venda_itens_viagem on qs_venda_itens;
--   drop trigger if exists zz_ponte_venda_pessoas_viagem on qs_venda_pessoas;
--   drop trigger if exists zz_ponte_venda_pagamentos on qs_venda_pagamentos;
--   drop trigger if exists zz_ponte_viagem_cancelada on rel_viagens;
--   drop view if exists fin_planos_divergentes_v;
--   rodar de novo _venda_propagar e _qs_vendas_pagamento_mudou_trg + o gatilho
--   trg_qs_vendas_pagamento_mudou (com WHEN new.negocio_id is not null) da 0338,
--   e _pax_valor_na_venda_trg da 0358.
-- -----------------------------------------------------------------------------

-- 1. Viagem do Rel acompanha a venda consolidada ----------------------------------
create or replace function _venda_viagem_recalcular(p_venda uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v       qs_vendas;
  rv      rel_viagens;
  v_ida   date;
  v_volta date;
  v_dest  text;
  v_npes  int;
  n_emb   date;
  n_ret   date;
  n_qtd   int;
  n_dest  text;
  v_mud   text[] := '{}';
begin
  if p_venda is null then return false; end if;
  select * into v from qs_vendas where id = p_venda;
  if not found or v.estado is distinct from 'consolidada' or v.viagem_id is null then return false; end if;
  select * into rv from rel_viagens where id = v.viagem_id;
  if found and rv.mesclada_em_id is not null then select * into rv from rel_viagens where id = rv.mesclada_em_id; end if;
  if rv.id is null or rv.status <> 'ativa' or coalesce(rv.datas_travadas, false) then return false; end if;

  -- mesma conta do venda_consolidar (0369)
  select least(min(i.data_inicio), min(e.data_embarque)), greatest(max(i.data_fim), max(e.data_retorno)),
         (array_agg(e.nome order by i.ordem) filter (where e.nome is not null))[1]
    into v_ida, v_volta, v_dest
    from qs_venda_itens i
    left join expedicoes e on e.id = case when (i.dados ->> 'expedicao_id') ~* '^[0-9a-f-]{36}$' then (i.dados ->> 'expedicao_id')::uuid end
   where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)) and i.status <> 'cancelado';
  select count(*) into v_npes from qs_venda_pessoas where venda_id = v.id and removida_em is null;

  n_emb := coalesce(v_ida, rv.data_embarque);
  n_ret := coalesce(v_volta, rv.data_retorno);
  if n_emb is not null and n_ret is not null and n_ret < n_emb then n_ret := rv.data_retorno; end if;
  if n_emb is not null and n_ret is not null and n_ret < n_emb then n_ret := null; end if;
  n_qtd := case when v_npes > 0 then v_npes else rv.qtd_passageiros end;
  n_dest := coalesce(v_dest, rv.destino);

  if n_emb is distinct from rv.data_embarque or n_ret is distinct from rv.data_retorno then v_mud := v_mud || 'datas'::text; end if;
  if n_qtd is distinct from rv.qtd_passageiros then v_mud := v_mud || 'passageiros'::text; end if;
  if n_dest is distinct from rv.destino then v_mud := v_mud || 'destino'::text; end if;
  if cardinality(v_mud) = 0 then return false; end if;

  update rel_viagens set data_embarque = n_emb, data_retorno = n_ret, qtd_passageiros = n_qtd, destino = n_dest where id = rv.id;

  if 'datas' = any (v_mud) then
    perform _ponte_evento_viagem(rv.id, 'datas',
      _ponte_data_txt(rv.data_embarque) || ' – ' || _ponte_data_txt(rv.data_retorno),
      _ponte_data_txt(n_emb) || ' – ' || _ponte_data_txt(n_ret),
      'Ponte venda: a venda consolidada mudou — datas acompanham os itens.');
  end if;
  if 'passageiros' = any (v_mud) or 'destino' = any (v_mud) then
    perform _ponte_evento_viagem(rv.id, 'item', null, null,
      'Ponte venda: a venda consolidada mudou — '
      || concat_ws('; ',
           case when 'passageiros' = any (v_mud) then 'passageiros ' || coalesce(rv.qtd_passageiros::text, '—') || ' → ' || n_qtd end,
           case when 'destino' = any (v_mud) then 'destino "' || coalesce(rv.destino, '—') || '" → "' || n_dest || '"' end) || '.');
  end if;
  return true;
exception when others then
  raise warning 'ponte: viagem da venda % não recalculou: %', p_venda, sqlerrm;
  return false;
end $$;

create or replace function _ponte_trg_venda_viagem()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_venda uuid; v_neg uuid;
begin
  if tg_table_name = 'qs_venda_itens' then
    if tg_op = 'UPDATE' and (new.data_inicio, new.data_fim, new.dados ->> 'expedicao_id', new.status, new.venda_id, new.negocio_id)
                            is not distinct from (old.data_inicio, old.data_fim, old.dados ->> 'expedicao_id', old.status, old.venda_id, old.negocio_id) then
      return null;
    end if;
    v_venda := case when tg_op = 'DELETE' then old.venda_id else new.venda_id end;
    v_neg := case when tg_op = 'DELETE' then old.negocio_id else new.negocio_id end;
    if v_venda is null and v_neg is not null then
      select id into v_venda from qs_vendas where negocio_id = v_neg and estado = 'consolidada' order by criado_em desc limit 1;
    end if;
  else
    if tg_op = 'UPDATE' and new.removida_em is not distinct from old.removida_em and new.venda_id is not distinct from old.venda_id then
      return null;
    end if;
    v_venda := case when tg_op = 'DELETE' then old.venda_id else new.venda_id end;
  end if;
  perform _venda_viagem_recalcular(v_venda);
  return null;
exception when others then
  raise warning 'ponte: % → viagem: %', tg_table_name, sqlerrm;
  return null;
end $$;

drop trigger if exists zz_ponte_venda_itens_viagem on qs_venda_itens;
create trigger zz_ponte_venda_itens_viagem after insert or update or delete on qs_venda_itens
  for each row execute function _ponte_trg_venda_viagem();
drop trigger if exists zz_ponte_venda_pessoas_viagem on qs_venda_pessoas;
create trigger zz_ponte_venda_pessoas_viagem after insert or update or delete on qs_venda_pessoas
  for each row execute function _ponte_trg_venda_viagem();

-- 2. _venda_propagar: plano por negocio_id OU venda_id; venda sem cartão também avisa ----
-- Partida: versão VIGENTE em 13/11 (pg_get_functiondef). Mudanças marcadas com "0388".
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
  v_txt     text;
  v_vid     uuid := p_venda;          -- 0388
  v_venda   qs_vendas;                -- 0388
begin
  if p_negocio is null then
    if p_venda is null then return; end if;
    select sum(valor) into v_total from qs_venda_itens where venda_id = p_venda and status <> 'cancelado';
    if coalesce(v_total, 0) > 0 then
      update qs_vendas set valor_total = v_total, atualizado_em = now()
       where id = p_venda and valor_total is distinct from v_total;
      -- 0388: venda sem cartão — a viagem consolidada e o plano (por venda_id) ficam sabendo
      select * into v_venda from qs_vendas where id = p_venda;
      if v_venda.estado = 'consolidada' and v_venda.viagem_id is not null then
        update rel_viagens set valor = v_total where id = v_venda.viagem_id and valor is distinct from v_total;
      end if;
      for v_plano in select * from fin_planos where venda_id = p_venda loop
        if v_plano.valor_total is distinct from v_total then
          v_pago := exists (select 1 from fin_parcelas where plano_id = v_plano.id and status = 'pago');
          perform _ponte_aviso_plano(v_plano.id,
            'A venda mudou para ' || _brl_txt(v_total) || ' e este plano soma ' || _brl_txt(v_plano.valor_total) || '. O plano NÃO foi refeito: '
            || case when v_pago then 'já tem parcela paga — combine o ajuste com quem vendeu.'
                    else 'refaça as parcelas pela venda (consolidar de novo) ou combine com quem vendeu.' end);
        end if;
      end loop;
    end if;
    perform _venda_viagem_recalcular(p_venda);   -- 0388
    return;
  end if;

  -- 0388: a venda do cartão (quando o item só tem negocio_id)
  if v_vid is null then
    select id into v_vid from qs_vendas where negocio_id = p_negocio and estado <> 'cancelada' order by criado_em desc limit 1;
  end if;

  select sum(valor) into v_total from qs_venda_itens where negocio_id = p_negocio and status <> 'cancelado';
  if coalesce(v_total, 0) <= 0 then return; end if;

  update qs_vendas set valor_total = v_total, atualizado_em = now()
   where negocio_id = p_negocio and valor_total is distinct from v_total;

  select * into n from qs_closer_negocios where id = p_negocio for update;
  if not found then return; end if;

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
    if n.consolidada_em is not null and n.viagem_id is not null then
      update rel_viagens set valor = v_total where id = n.viagem_id and valor is distinct from v_total;
    end if;
    perform _venda_viagem_recalcular(v_vid);   -- 0388
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

  -- 0388: o plano pode estar ligado só pela venda (fin_planos.venda_id)
  select * into v_plano from fin_planos
   where negocio_id = n.id or (v_vid is not null and venda_id = v_vid)
   order by (negocio_id = n.id) desc nulls last limit 1;
  if found and v_plano.valor_total is distinct from v_total then
    v_pago := exists (select 1 from fin_parcelas where plano_id = v_plano.id and status = 'pago');
    perform _ponte_aviso_plano(v_plano.id,
      'A venda mudou para ' || _brl_txt(v_total) || ' e este plano soma '
      || _brl_txt(v_plano.valor_total) || '. O plano NÃO foi refeito: '
      || case when v_pago then 'já tem parcela paga — combine o ajuste com o closer.'
              else 'o closer refaz as parcelas em "Corrigir fechamento".' end);
    v_txt := v_txt || ' O plano de pagamento no Financeiro continua em ' || _brl_txt(v_plano.valor_total)
             || case when v_pago then ' (já tem parcela paga — combine com o Financeiro).' else ' — refaça em "Corrigir fechamento".' end;
  end if;

  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (n.id, 'editado', v_txt, auth.uid());

  perform _venda_viagem_recalcular(v_vid);   -- 0388
end $$;

-- 3. Pagamento mudou depois do fechamento (com ou sem cartão) -----------------------
create or replace function _qs_vendas_pagamento_mudou_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pl uuid; v_tem boolean := false;
begin
  for v_pl in select * from _ponte_planos(new.id, new.negocio_id, null) loop
    v_tem := true;
    perform _ponte_aviso_plano(v_pl, 'A forma/condição de pagamento da venda mudou depois do fechamento. O plano NÃO foi refeito — confira se as parcelas ainda batem.');
  end loop;
  if v_tem and new.negocio_id is not null then
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (new.negocio_id, 'editado',
            'A forma/condição de pagamento da venda mudou depois do fechamento. O plano no Financeiro não se refaz sozinho — confira em "Corrigir fechamento".',
            auth.uid());
  end if;
  return null;
exception when others then
  raise warning '0388 aviso de pagamento (venda %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists trg_qs_vendas_pagamento_mudou on qs_vendas;
create trigger trg_qs_vendas_pagamento_mudou after update of pagamento, condicao_especial, condicao_obs on qs_vendas
  for each row when ((old.pagamento is distinct from new.pagamento) or (old.condicao_especial is distinct from new.condicao_especial)
                     or (old.condicao_obs is distinct from new.condicao_obs))
  execute function _qs_vendas_pagamento_mudou_trg();

-- Linhas de pagamento: checa no FIM da transação (o Subir venda costuma apagar e regravar
-- todas) e só avisa se as parcelas do plano deixaram de bater com os pagamentos.
create or replace function _ponte_trg_venda_pagamentos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v qs_vendas; v_pl fin_planos; v_pag numeric; v_par numeric; v_avisou boolean := false;
begin
  select * into v from qs_vendas where id = coalesce(new.venda_id, old.venda_id);
  if not found or v.estado is distinct from 'consolidada' then return null; end if;
  select coalesce(sum(valor), 0) into v_pag from qs_venda_pagamentos where venda_id = v.id;
  for v_pl in select * from fin_planos where venda_id = v.id or (v.negocio_id is not null and negocio_id = v.negocio_id) loop
    select coalesce(sum(valor), 0) into v_par from fin_parcelas where plano_id = v_pl.id and status <> 'cancelado';
    if abs(v_par - v_pag) > 0.05 then
      v_avisou := _ponte_aviso_plano(v_pl.id, 'Os pagamentos da venda mudaram depois do fechamento: somam ' || _brl_txt(v_pag)
                    || ' e as parcelas deste plano somam ' || _brl_txt(v_par) || '. O plano NÃO foi refeito.') or v_avisou;
    end if;
  end loop;
  if v_avisou and v.negocio_id is not null then
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (v.negocio_id, 'editado', 'Os pagamentos da venda mudaram depois do fechamento e não batem mais com o plano do Financeiro ('
            || _brl_txt(v_pag) || '). O plano não se refaz sozinho — confira em "Corrigir fechamento".', auth.uid());
  end if;
  return null;
exception when others then
  raise warning 'ponte: pagamentos da venda → plano: %', sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_venda_pagamentos on qs_venda_pagamentos;
create constraint trigger zz_ponte_venda_pagamentos after insert or update or delete on qs_venda_pagamentos
  deferrable initially deferred for each row execute function _ponte_trg_venda_pagamentos();

-- 4. Fila de planos que não batem mais com a venda ------------------------------------
create or replace view fin_planos_divergentes_v with (security_invoker = true) as
with base as (
  select pl.id as plano_id, pl.venda_id, pl.negocio_id, pl.viagem_id, pl.cliente_id, pl.cliente_nome, pl.closer_id,
         (select u.name from qs_users u where u.id = pl.closer_id) as closer_nome,
         pl.valor_total as plano_total, pl.atualizado_em, pl.observacao,
         q.id as venda_ligada_id, q.valor_total as venda_total, q.estado as venda_estado,
         coalesce(px.soma, 0) as soma_parcelas, coalesce(px.n, 0) as n_parcelas, coalesce(px.pagas, 0) as parcelas_pagas,
         coalesce(pg.soma, 0) as soma_pagamentos, coalesce(pg.n, 0) as n_pagamentos
    from fin_planos pl
    join lateral (
      select * from qs_vendas q
       where q.id = pl.venda_id or (pl.venda_id is null and pl.negocio_id is not null and q.negocio_id = pl.negocio_id)
       order by (q.id = pl.venda_id) desc nulls last, (q.estado <> 'cancelada') desc, q.criado_em desc
       limit 1) q on true
    left join lateral (
      select sum(x.valor) as soma, count(*)::int as n, count(*) filter (where x.status = 'pago')::int as pagas
        from fin_parcelas x where x.plano_id = pl.id and x.status <> 'cancelado') px on true
    left join lateral (
      select sum(g.valor) as soma, count(*)::int as n from qs_venda_pagamentos g where g.venda_id = q.id) pg on true
), m as (
  select b.*, array_remove(array[
           case when abs(coalesce(b.plano_total, 0) - coalesce(b.venda_total, 0)) > 0.05 then 'valor' end,
           case when b.n_parcelas > 0 and abs(b.soma_parcelas - coalesce(b.plano_total, 0)) > 0.05 then 'parcelas_x_plano' end,
           case when b.n_pagamentos > 0 and b.n_parcelas > 0 and abs(b.soma_parcelas - b.soma_pagamentos) > 0.05 then 'parcelas_x_pagamentos' end
         ], null) as motivos
    from base b
   where b.venda_estado is distinct from 'cancelada'
)
select m.*, (m.parcelas_pagas > 0) as tem_parcela_paga from m where cardinality(m.motivos) > 0;

comment on view fin_planos_divergentes_v is
  '0388 ponte: planos do Financeiro que não batem mais com a venda (valor, parcelas x plano, parcelas x pagamentos). Só leitura; nada é refeito sozinho.';
revoke all on fin_planos_divergentes_v from anon, public;
grant select on fin_planos_divergentes_v to authenticated;

-- 5. Viagem cancelada no Rel → venda, cartão e plano ficam sabendo ---------------------
create or replace function _ponte_trg_viagem_cancelada()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_txt   text;
  v_linha text;
  q       qs_vendas;
  v_pl    uuid;
  v_negs  uuid[] := '{}';
  v_n     int := 0;
begin
  if coalesce(current_setting('ponte.origem', true), '') = 'pax' then return null; end if;   -- 0386 já registrou
  -- venda_cancelar grava "[Aviso QS …] Venda cancelada" na mesma atualização e já avisou todo mundo
  if coalesce(new.observacoes, '') is distinct from coalesce(old.observacoes, '')
     and position('Venda cancelada' in coalesce(new.observacoes, '')) > 0
     and position('Venda cancelada' in coalesce(old.observacoes, '')) = 0 then
    return null;
  end if;

  v_txt := 'A viagem "' || coalesce(new.titulo, '') || '" foi CANCELADA no Relacionamento. A venda e as parcelas NÃO mudaram — '
           || 'se o cliente desistiu, cancele a venda pelo cartão e combine o reembolso com o Financeiro.';
  v_linha := '[Aviso QS ' || _ponte_hoje_txt() || '] ' || v_txt;

  for q in select * from qs_vendas
            where (viagem_id = new.id or (new.closer_negocio_id is not null and negocio_id = new.closer_negocio_id))
              and estado is distinct from 'cancelada' loop
    update qs_vendas set observacoes = concat_ws(E'\n', nullif(observacoes, ''), v_linha)
     where id = q.id and position(v_linha in coalesce(observacoes, '')) = 0;
    if q.negocio_id is not null then v_negs := v_negs || q.negocio_id; end if;
    for v_pl in select * from _ponte_planos(q.id, q.negocio_id, null) loop
      if _ponte_aviso_plano(v_pl, v_txt) then v_n := v_n + 1; end if;
    end loop;
  end loop;
  -- plano ligado só à viagem
  for v_pl in select id from fin_planos where viagem_id = new.id loop
    if _ponte_aviso_plano(v_pl, v_txt) then v_n := v_n + 1; end if;
  end loop;
  if new.closer_negocio_id is not null and not (new.closer_negocio_id = any (v_negs)) then v_negs := v_negs || new.closer_negocio_id; end if;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  select distinct ng, 'editado', v_txt, auth.uid() from unnest(v_negs) ng
   where exists (select 1 from qs_closer_negocios where id = ng);

  if cardinality(v_negs) > 0 or v_n > 0 then
    perform _ponte_evento_viagem(new.id, 'item', null, null,
      'Ponte venda: viagem cancelada — avisei ' || concat_ws(' e ',
        case when cardinality(v_negs) > 0 then 'o closer' end, case when v_n > 0 then 'o Financeiro' end) || ' (nada de dinheiro mudou).');
  end if;
  return null;
exception when others then
  raise warning 'ponte: viagem % cancelada → venda/plano: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists zz_ponte_viagem_cancelada on rel_viagens;
create trigger zz_ponte_viagem_cancelada after update of status on rel_viagens
  for each row when (new.status = 'cancelada' and old.status is distinct from 'cancelada')
  execute function _ponte_trg_viagem_cancelada();

-- 6. Valor mudado no Ops → também avisa o plano (item 7) ------------------------------
-- Partida: versão VIGENTE em 13/11 (corpo = 0358). Acréscimo marcado com "0388".
create or replace function _pax_valor_na_venda_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item qs_venda_itens;
  v_pax  jsonb;
  v_n    int;
  v_nval int;
  v_soma numeric;
  v_mud  int := 0;
  v_pl   uuid;   -- 0388
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

  -- d) 0388: o plano do Financeiro ligado fica sabendo (nada é refeito).
  for v_pl in select * from _ponte_planos(coalesce(new.venda_id, v_item.venda_id), v_item.negocio_id, null) loop
    perform _ponte_aviso_plano(v_pl,
      'O Operacional mudou o valor de ' || coalesce(nullif(trim(new.nome_completo), ''), 'um passageiro')
      || ' de ' || _brl_txt(old.valor_contratado_brl) || ' para ' || _brl_txt(new.valor_contratado_brl)
      || '. O plano NÃO foi refeito — confira com o closer.');
  end loop;
  return null;
exception when others then
  perform set_config('qs.venda_itens_rpc', 'off', true);
  raise warning '0358 valor do passageiro % (rateio da venda): %', new.id, sqlerrm;
  return null;
end $$;

revoke all on function _venda_viagem_recalcular(uuid) from public, anon, authenticated;
revoke all on function _ponte_trg_venda_viagem() from public, anon, authenticated;
revoke all on function _ponte_trg_venda_pagamentos() from public, anon, authenticated;
revoke all on function _ponte_trg_viagem_cancelada() from public, anon, authenticated;
