-- 0211_closer_pre_venda_atualiza_valor.sql  (27/10/2026 — frente Closer)
-- -----------------------------------------------------------------------------
-- "Nada manual" (Bruno): o closer registrou a venda (pré-venda, 0207) e depois
-- corrigiu um item. Na 0207, chamar closer_pre_venda('marcar') de novo não
-- fazia nada (ja_estava) — o Dashboard ficava com o valor antigo.
--
-- Agora, com a venda já marcada, 'marcar' ATUALIZA valor e tipo quando mudaram
-- e põe o cartão em 'pendente' (o servidor/cron leva o valor novo pro Bitrix).
-- Igual ao que estava: nada muda se valor e tipo forem os mesmos.
--
-- A tela (src/closer/RegistrarVenda.tsx) já chama assim; sem esta migration o
-- comportamento é o da 0207 (não quebra nada). NÃO APLICADA.
-- -----------------------------------------------------------------------------
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
    v_valor := coalesce(nullif(p_valor, 0), nullif((select sum(valor) from qs_venda_itens where negocio_id = n.id), 0), nullif(n.valor_previsto, 0));
    if v_valor is null or v_valor <= 0 then raise exception 'valor-total-obrigatorio'; end if;
    v_tipo := coalesce(nullif(trim(coalesce(p_tipo, '')), ''),
                       (select tipo from qs_venda_itens where negocio_id = n.id order by coalesce(valor, 0) desc, ordem limit 1));
    if v_tipo is null then raise exception 'tipo-obrigatorio'; end if;
    if v_tb is not null and v_tb !~ '^\d{1,6}$' then raise exception 'tipo-invalido'; end if;

    -- Já marcada: só atualiza se o valor ou o tipo mudou (0211).
    if n.pre_venda_em is not null then
      if n.pre_venda_valor is not distinct from v_valor
         and n.pre_venda_tipo is not distinct from v_tipo
         and (v_tb is null or n.pre_venda_tipo_bitrix is not distinct from v_tb) then
        return jsonb_build_object('ok', true, 'ja_estava', true, 'bitrix', v_bitrix);
      end if;
      update qs_closer_negocios set
        pre_venda_valor = v_valor, pre_venda_tipo = v_tipo,
        pre_venda_tipo_bitrix = coalesce(v_tb, pre_venda_tipo_bitrix),
        bitrix_status = case when v_bitrix then 'pendente' else 'sem_card' end,
        bitrix_erro = null
       where id = n.id;
      insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
      values (n.id, 'pre_venda', 'Venda atualizada: ' || to_char(v_valor, 'FM999G999G990D00') || '.', auth.uid());
      return jsonb_build_object('ok', true, 'ja_estava', true, 'atualizado', true, 'bitrix', v_bitrix, 'valor', v_valor, 'tipo', v_tipo);
    end if;

    update qs_closer_negocios set
      pre_venda_em = now(), pre_venda_por = auth.uid(), pre_venda_valor = v_valor,
      pre_venda_tipo = v_tipo, pre_venda_tipo_bitrix = v_tb,
      valor_previsto = coalesce(valor_previsto, v_valor),
      bitrix_status = case when v_bitrix then 'pendente' else 'sem_card' end,
      bitrix_erro = null
     where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
    values (n.id, 'pre_venda', 'Venda registrada: ' || to_char(v_valor, 'FM999G999G990D00') ||
            '. Já conta no Dashboard pelo Bitrix; o fechamento (pagamento e contrato) vem depois.', auth.uid());
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
    values (n.id, 'pre_venda', 'Venda registrada desfeita: o negócio volta pra coluna da etapa atual no Bitrix.', auth.uid());
    return jsonb_build_object('ok', true, 'bitrix', v_bitrix);
  end if;
  raise exception 'acao-invalida';
end;
$$;
revoke all on function closer_pre_venda(uuid, text, text, text, numeric) from public, anon;
grant execute on function closer_pre_venda(uuid, text, text, text, numeric) to authenticated;
