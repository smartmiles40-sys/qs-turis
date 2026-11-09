-- supabase/dashboard/20261109_qs_comissoes_negocios_v2.sql
-- -----------------------------------------------------------------------------
-- APLICAR NO SUPABASE DO DASHBOARD (pkdcglrzbjvcedlizqqv), não no do QS.
--
-- COMISSÕES v2 (09/11/2026, regras do PDF; QS 0328): a função passa a devolver
-- também `data_quando_agendou` (bônus diário de agendamentos do SDR) e `custo`
-- (lucro = total − custo, se um dia vier preenchido), e inclui os cards que só
-- foram AGENDADOS no período (sem venda nem R.R ainda).
--
-- Mudou o formato da saída → drop + create. Mesmo segredo de antes
-- (integracao_segredos 'qs_comissoes'). Só lê; nada do Dashboard muda.
-- Volta: rodar de novo o 20261106_qs_comissoes_negocios.sql (drop antes).
-- -----------------------------------------------------------------------------

drop function if exists qs_comissoes_negocios(text, date);

create function qs_comissoes_negocios(p_segredo text, p_desde date)
returns table (
  bitrix_id text, nome text, pipeline text, fase text, tipo_venda text, nome_expedicao text,
  total numeric, data_venda date, sdr text, responsavel_reuniao text, vendedor text,
  data_reuniao_realizada date, no_show boolean, reuniao_realizada boolean, atualizado_no_bitrix timestamptz,
  data_quando_agendou date, custo numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_segredo is null or not exists (
    select 1 from integracao_segredos s where s.nome = 'qs_comissoes' and s.valor = p_segredo
  ) then
    raise exception 'segredo inválido' using errcode = '42501';
  end if;

  return query
  select n.bitrix_id, coalesce(nullif(n.nome, ''), n.nome_deal), n.pipeline, n.fase, n.tipo_venda, n.nome_expedicao,
         n.total, n.data_venda, n.sdr, n.responsavel_reuniao, n.vendedor,
         n.data_reuniao_realizada, n.no_show, n.reuniao_realizada, n.updated_at,
         n.data_quando_agendou, n.custo
    from negocios n
   where lower(coalesce(n.pipeline, '')) in ('comercial 1 - se tu for eu vou', 'comercial')
     and n.bitrix_id is not null
     and (n.data_venda >= p_desde or n.data_reuniao_realizada >= p_desde
          or n.data_quando_agendou >= p_desde or n.updated_at >= p_desde::timestamptz);
end $$;

revoke all on function qs_comissoes_negocios(text, date) from public;
grant execute on function qs_comissoes_negocios(text, date) to anon, authenticated;
