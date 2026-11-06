-- supabase/dashboard/20261106_qs_comissoes_negocios.sql
-- -----------------------------------------------------------------------------
-- APLICADO NO SUPABASE DO DASHBOARD (pkdcglrzbjvcedlizqqv), não no do QS.
-- Fica no repo do QS porque quem usa é o QS (api/fin-comissoes.js).
--
-- COMISSÕES (06/11/2026): o QS precisa dos cards comerciais do Bitrix (venda e
-- reunião realizada) pra montar a planilha de comissão de SDR e closer. A tabela
-- `negocios` só é legível por usuário LOGADO no Dashboard (RLS), e a service key
-- do Dashboard não pode ir pro QS. Então: uma função security definer que
-- devolve SÓ as colunas necessárias e só com o segredo compartilhado (o mesmo
-- esquema da qs_upsert_reunioes, 20261105_reunioes_qs.sql).
--
-- Só cria objeto novo: nada do Dashboard muda. O segredo NÃO fica aqui: é uma
-- linha em integracao_segredos (nome 'qs_comissoes') igual à env
-- DASHBOARD_COMISSOES_SECRET da Vercel do QS.
--
-- Mesmo filtro do Rank (useRankData.ts): só os pipelines comerciais.
-- Volta: drop function if exists qs_comissoes_negocios(text, date);
-- -----------------------------------------------------------------------------

create or replace function qs_comissoes_negocios(p_segredo text, p_desde date)
returns table (
  bitrix_id text, nome text, pipeline text, fase text, tipo_venda text, nome_expedicao text,
  total numeric, data_venda date, sdr text, responsavel_reuniao text, vendedor text,
  data_reuniao_realizada date, no_show boolean, reuniao_realizada boolean, atualizado_no_bitrix timestamptz
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
         n.data_reuniao_realizada, n.no_show, n.reuniao_realizada, n.updated_at
    from negocios n
   where lower(coalesce(n.pipeline, '')) in ('comercial 1 - se tu for eu vou', 'comercial')
     and n.bitrix_id is not null
     and (n.data_venda >= p_desde or n.data_reuniao_realizada >= p_desde or n.updated_at >= p_desde::timestamptz);
end $$;

revoke all on function qs_comissoes_negocios(text, date) from public;
grant execute on function qs_comissoes_negocios(text, date) to anon, authenticated;
