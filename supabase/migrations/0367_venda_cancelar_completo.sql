-- 0367_venda_cancelar_completo.sql
-- -----------------------------------------------------------------------------
-- CANCELAR VENDA DE VERDADE (revisão 12/11/2026).
--
-- Antes: o venda_cancelar existia mas nenhuma tela chamava; mover o cartão
-- para Perdido/Venda cancelada NÃO cancelava a qs_vendas (vaga presa, comissão
-- contando, contas a receber em aberto).
--
-- Agora:
--   • _venda_cancelar_exec (interno, sem grant): o corpo do venda_cancelar da
--     0357 (passageiros cancelados + fila do espelho descartada, itens
--     cancelados, parcelas A RECEBER canceladas com aviso no plano) MAIS:
--       – a fila do espelho também descarta os 'update' pendentes da venda;
--       – venda CONSOLIDADA: a viagem do Rel ganha o aviso nas observações e,
--         se nasceu deste cartão (rel_viagens.closer_negocio_id) e não tem outra
--         venda/plano ligado, fica com status 'cancelada' (não apaga nada; o
--         gatilho da viagem só tira as tarefas ainda não feitas). Os trechos de
--         origem venda (0361) já ficam cancelados sozinhos pelo gatilho
--         trg_qs_vendas_trechos_rel (saem do próximo voo e dos Check-ins);
--       – venda CONSOLIDADA com p_mexer_cartao: o cartão vai para
--         'venda_cancelada' com o motivo — o gatilho do cartão marca o Bitrix
--         como 'pendente' e o cron/espelho leva o card para
--         "Cancelamento/Desistência" (filhos da família vão junto).
--     A comissão para de contar porque fin_com_fonte_qs só lê venda
--     'reservada'/'consolidada' (0358) — nada a mudar lá.
--   • venda_cancelar(p_venda, p_motivo): mesma assinatura, mesmas permissões
--     (closer dono do cartão / gestão; venda sem cartão: Rel/Ops/gestão).
--   • closer_negocio_mover: Perdido ou Venda cancelada com venda ativa no
--     cartão cancela a venda NA MESMA TRANSAÇÃO (decisão do Bruno: "Perdido
--     cancelando a venda junto"). Venda só em negociação e sem passageiro não é
--     tocada (não ocupa vaga nem conta comissão; o closer reabre se voltar).
--
-- Partida: versões VIGENTES no banco em 12/11 (md5 do corpo = 0357 para
-- venda_cancelar; closer_negocio_mover = 0205). Idempotente.
-- Volta: rodar de novo venda_cancelar da 0357 e closer_negocio_mover da 0205;
--   drop function if exists _venda_cancelar_exec(uuid, text, boolean);
-- -----------------------------------------------------------------------------

create or replace function _venda_cancelar_exec(p_venda uuid, p_motivo text, p_mexer_cartao boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v        qs_vendas;
  n        qs_closer_negocios;
  v_mot    text := nullif(trim(coalesce(p_motivo, '')), '');
  v_npax   int := 0;
  v_nfila  int := 0;
  v_nparc  int := 0;
  v_pago   boolean;
  v_viag   boolean := false;
  v_movido boolean := false;
  v_hoje   text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
begin
  if v_mot is null or length(v_mot) < 3 then raise exception 'motivo-obrigatorio'; end if;
  select * into v from qs_vendas where id = p_venda for update;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  if v.estado = 'cancelada' then return jsonb_build_object('ok', true, 'ja_estava', true, 'venda_id', v.id); end if;
  if v.negocio_id is not null then
    select * into n from qs_closer_negocios where id = v.negocio_id;
  end if;

  -- 1) Passageiros (vaga volta) — antes dos itens (a flag dos itens seguraria o cancelamento na fila).
  v_npax := _venda_pax_cancelar(v.id, null, null, 'Venda cancelada: ' || v_mot);
  -- 1b) O que ainda estava na fila do espelho desta venda (inclusive 'update') não entra mais.
  update exp_venda_pax_pendentes q set aplicado_em = now(), erro = left('Descartado pelo QS: venda cancelada — ' || v_mot, 300)
   where q.aplicado_em is null and q.venda_id = v.id;
  get diagnostics v_nfila = row_count;

  -- 2) Itens (total e comissão param de contar)
  perform set_config('qs.venda_itens_rpc', 'on', true);
  update qs_venda_itens set status = 'cancelado'
   where (venda_id = v.id or (v.negocio_id is not null and negocio_id = v.negocio_id)) and status <> 'cancelado';
  perform set_config('qs.venda_itens_rpc', 'off', true);

  -- 3) Financeiro: a receber vira cancelado; pago fica (aviso no plano). Nada é apagado.
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

  -- 4) Relacionamento: a viagem que nasceu da venda consolidada.
  if v.estado = 'consolidada' and v.viagem_id is not null then
    select (rv.status = 'ativa'
            and v.negocio_id is not null and rv.closer_negocio_id = v.negocio_id
            and not exists (select 1 from qs_vendas o where o.viagem_id = rv.id and o.id <> v.id and o.estado <> 'cancelada')
            and not exists (select 1 from fin_planos pl where pl.viagem_id = rv.id
                              and pl.venda_id is distinct from v.id and pl.negocio_id is distinct from v.negocio_id))
      into v_viag
      from rel_viagens rv where rv.id = v.viagem_id;
    update rel_viagens set
      observacoes = concat_ws(E'\n', nullif(observacoes, ''),
        '[Aviso QS ' || v_hoje || '] Venda cancelada: ' || v_mot || '.'
        || case when coalesce(v_viag, false) then ' Viagem cancelada junto.'
                else ' A viagem tem outras vendas/planos: confira o que fica.' end),
      status = case when coalesce(v_viag, false) then 'cancelada' else status end
     where id = v.viagem_id;
  end if;

  -- 5) Cartão
  if v.negocio_id is not null then
    select * into n from qs_closer_negocios where id = v.negocio_id;
    if n.pre_venda_em is not null and n.consolidada_em is null then
      update qs_closer_negocios set
        pre_venda_em = null, pre_venda_por = null, pre_venda_valor = null, pre_venda_tipo = null, pre_venda_tipo_bitrix = null,
        bitrix_status = case when exists (select 1 from qs_leads l where l.id = n.lead_id and nullif(trim(l.bitrix_id), '') is not null)
                             then 'pendente' else 'sem_card' end,
        bitrix_erro = null
       where id = n.id;
    end if;
    -- Venda fechada: o cartão vai para "Venda cancelada" (o gatilho marca o Bitrix como pendente).
    if p_mexer_cartao and n.consolidada_em is not null and n.etapa not in ('perdido', 'venda_cancelada') then
      update qs_closer_negocios set etapa = 'venda_cancelada', motivo_perda = v_mot, arquivado_em = null, arquivado_motivo = null
       where id = n.id;
      insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
      values (n.id, 'perdido', n.etapa, 'venda_cancelada', 'Motivo: ' || v_mot, auth.uid());
      v_movido := true;
    end if;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pre_venda', 'Venda cancelada: ' || v_mot || '. ' || v_npax || ' passageiro(s) cancelado(s) — a vaga volta.'
            || case when v_nparc > 0 then ' ' || v_nparc || ' parcela(s) a receber cancelada(s) no Financeiro.' else '' end
            || case when v_viag then ' Viagem do Relacionamento cancelada.' else '' end,
            auth.uid());
  end if;

  update qs_vendas set estado = 'cancelada', cancelada_em = now(), cancelada_motivo = v_mot, atualizado_em = now()
   where id = v.id;
  return jsonb_build_object('ok', true, 'venda_id', v.id, 'passageiros_cancelados', v_npax, 'fila_descartada', v_nfila,
                            'parcelas_canceladas', v_nparc, 'parcela_paga', v_pago, 'viagem_cancelada', coalesce(v_viag, false),
                            'cartao_movido', v_movido, 'estava', v.estado);
end $$;
revoke all on function _venda_cancelar_exec(uuid, text, boolean) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- venda_cancelar — a RPC da tela (botão "Cancelar venda")
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function venda_cancelar(p_venda uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n     qs_closer_negocios;
  v_neg uuid;
  v_mot text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_mot is null or length(v_mot) < 3 then raise exception 'motivo-obrigatorio'; end if;
  select negocio_id into v_neg from qs_vendas where id = p_venda;
  if not found then raise exception 'venda-nao-encontrada'; end if;
  -- Trava na mesma ordem da venda_subir/venda_consolidar (cartão → venda).
  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;
  return _venda_cancelar_exec(p_venda, v_mot, true);
end $$;
revoke all on function venda_cancelar(uuid, text) from public, anon;
grant execute on function venda_cancelar(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- closer_negocio_mover — Perdido / Venda cancelada cancelam a venda junto
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function closer_negocio_mover(p_id uuid, p_etapa text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n       qs_closer_negocios;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  r       record;
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if p_etapa not in ('aguardando_reuniao','reagendamento','em_cotacao','em_negociacao','no_show',
                     'oportunidade_futura','aguardando_emissao','venda_cancelada','perdido','venda_realizada') then
    raise exception 'etapa-invalida';
  end if;
  if p_etapa = n.etapa then return; end if;
  if p_etapa = 'aguardando_emissao' and n.consolidada_em is null then raise exception 'use-a-ficha-de-fechamento'; end if;
  if p_etapa in ('venda_realizada','venda_cancelada') and n.consolidada_em is null then raise exception 'consolide-antes'; end if;
  if p_etapa in ('perdido','venda_cancelada') and v_motivo is null then raise exception 'motivo-obrigatorio'; end if;
  begin
    update qs_closer_negocios
       set etapa = p_etapa,
           motivo_perda = case when p_etapa in ('perdido','venda_cancelada') then v_motivo else null end,
           arquivado_em = null, arquivado_motivo = null
     where id = p_id;
  exception when unique_violation then
    raise exception 'ja-tem-cartao-aberto';
  end;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
  values (p_id, case when p_etapa in ('perdido','venda_cancelada') then 'perdido' else 'movido' end, n.etapa, p_etapa,
          case when p_etapa in ('perdido','venda_cancelada') then 'Motivo: ' || v_motivo else v_motivo end,
          auth.uid());

  -- 0367: encerrou o cartão → a venda dele é cancelada junto (vaga volta, comissão sai,
  -- contas a receber canceladas, viagem do Rel sinalizada). Mesma transação.
  if p_etapa in ('perdido','venda_cancelada') then
    for r in select v.id from qs_vendas v
              where v.negocio_id = p_id and v.estado is distinct from 'cancelada'
                and (v.estado in ('reservada','consolidada')
                     or exists (select 1 from passageiros px where px.venda_id = v.id and px.status_reserva <> 'Cancelado')
                     or exists (select 1 from exp_venda_pax_pendentes q where q.venda_id = v.id and q.aplicado_em is null)) loop
      perform _venda_cancelar_exec(r.id,
        case when p_etapa = 'perdido' then 'cartão movido para Perdido — ' else 'cartão movido para Venda cancelada — ' end || v_motivo,
        false);
    end loop;
  end if;
end;
$$;
revoke all on function closer_negocio_mover(uuid, text, text) from public, anon;
grant execute on function closer_negocio_mover(uuid, text, text) to authenticated;

-- Conferência depois de aplicar (só leitura):
--   select proname, proacl from pg_proc where proname in ('_venda_cancelar_exec','venda_cancelar','closer_negocio_mover');
