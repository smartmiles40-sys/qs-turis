-- 0384_negocio_parcelas.sql
-- -----------------------------------------------------------------------------
-- VISÃO CRUZADA, PASSO 5: AS PARCELAS REAIS NO CARTÃO DO CLOSER (13/11/2026).
--
-- PORQUÊ
--   O bloco Pagamento do closer (src/closer/PagamentoBloco.tsx) mostra um status
--   MANUAL (link enviado / pago) e, no máximo, "X de Y parcelas pagas" — e só
--   acha o plano por fin_planos.negocio_id, lido com a RLS de fin_planos
--   (fin_planos_ler: Financeiro, gestor ou fin_planos.closer_id = eu). Dois furos:
--     • o plano pode estar ligado à VENDA (qs_vendas.negocio_id) ou à VIAGEM
--       consolidada (qs_closer_negocios.viagem_id), não ao negócio;
--     • se o negócio trocou de closer, fin_planos.closer_id continua o antigo e
--       o closer novo não vê nada.
--   Esta RPC devolve as parcelas reais (pagas / vencidas / a receber) do plano do
--   negócio, achado por qualquer um dos três caminhos, pra quem pode ver o
--   NEGÓCIO (mesma regra de qs_closer_negocios_ler: o closer dele ou gestor) ou
--   o Financeiro. Só leitura. A baixa continua pelo caminho de sempre
--   (pagamentoPago → parcelas de fin_planos.negocio_id), sem mudança.
--
-- COMO CONFERIR
--   select * from public.negocio_parcelas('<negocio uuid>');
--   -- vazio = negócio sem plano no Financeiro → o cartão mostra o status manual.
--
-- COMO VOLTAR
--   drop function if exists public.negocio_parcelas(uuid);
--   (o cartão volta a ler fin_planos direto, como antes.)
-- -----------------------------------------------------------------------------

create or replace function public.negocio_parcelas(p_negocio uuid)
returns table (
  id uuid, plano_id uuid, numero int, valor numeric, vencimento date, forma text,
  status text, pago_em date, pago_valor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare n qs_closer_negocios;
begin
  select * into n from qs_closer_negocios where qs_closer_negocios.id = p_negocio;
  if not found then return; end if;
  if auth.uid() is null or not (n.closer_id = auth.uid() or qs_is_manager() or fin_tem_acesso()) then
    raise exception 'Sem acesso a este negócio.' using errcode = '42501';
  end if;

  return query
  select pa.id, pa.plano_id, pa.numero, pa.valor, pa.vencimento, pa.forma, pa.status, pa.pago_em, pa.pago_valor
    from fin_parcelas pa
   where pa.plano_id in (
           select pl.id from fin_planos pl
            where pl.negocio_id = n.id
               or pl.venda_id in (select v.id from qs_vendas v where v.negocio_id = n.id)
               or (n.viagem_id is not null and pl.viagem_id = n.viagem_id)
         )
   order by pa.vencimento, pa.numero;
end $$;

comment on function public.negocio_parcelas(uuid) is
  'Parcelas reais (fin_parcelas) do plano do negócio do closer — por negocio_id, venda ou viagem consolidada. Só leitura. 0384.';

revoke all on function public.negocio_parcelas(uuid) from public, anon;
grant execute on function public.negocio_parcelas(uuid) to authenticated;
