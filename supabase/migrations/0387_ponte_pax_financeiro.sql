-- 0387_ponte_pax_financeiro.sql
-- -----------------------------------------------------------------------------
-- PONTE PÓS-VENDA (3/5) — BAIXA DO FINANCEIRO VISÍVEL NO OPS E NO REL (13/11/2026).
--
-- POR QUÊ: fin_parcelas não avisa ninguém; o "pago" do Operacional é digitado
-- (src/expedicoes/valores/PainelValores.tsx) e a ficha do Rel mostra o digitado
-- (src/rel/clientes/ExpedicoesDaFicha.tsx). Baixa no Financeiro não aparecia.
--
-- O QUE FAZ: view v_pax_financeiro (security_invoker — cada um só vê o que já
-- podia ver em passageiros, fin_planos e fin_parcelas), uma linha por passageiro
-- que tem plano no Financeiro:
--   ligado_por 'venda'  → fin_planos.venda_id = passageiros.venda_id (vendas do QS);
--   ligado_por 'viagem' → plano da viagem do Rel ligada à expedição do cliente
--                         (mesma regra do exp_valores_financeiro da 0220).
-- Soma recebido (pago), a receber, vencido (a receber com vencimento < hoje),
-- quantidade de parcelas pagas/abertas/vencidas, próximo vencimento e quantos
-- passageiros dividem o plano (pax_no_plano > 1 = venda conjunta: o recebido é
-- do plano todo, não dá pra atribuir a uma pessoa).
-- NADA é gravado: o campo digitado do Ops continua existindo (vira reserva
-- quando não há plano) — a tela diz de onde veio o número.
--
-- O front funciona sem esta migration (cai no exp_valores_financeiro / no digitado).
--
-- COMO CONFERIR:
--   select * from v_pax_financeiro limit 20;
--   -- dê baixa numa parcela (Contas a receber) e veja o recebido do passageiro mudar.
--
-- COMO VOLTAR:
--   drop view if exists v_pax_financeiro;
-- -----------------------------------------------------------------------------

create or replace view v_pax_financeiro with (security_invoker = true) as
with lig as (
  select p.id as passageiro_id, p.expedicao_id, p.cliente_id, p.venda_id, fp.id as plano_id, fp.valor_total,
         'venda'::text as ligado_por, 1 as prio
    from passageiros p
    join fin_planos fp on fp.venda_id = p.venda_id
   where p.venda_id is not null
  union all
  select p.id, p.expedicao_id, p.cliente_id, p.venda_id, fp.id, fp.valor_total, 'viagem'::text, 2
    from passageiros p
    join rel_viagens v on v.expedicoes_id = p.expedicao_id and v.mesclada_em_id is null
    join fin_planos fp on fp.viagem_id = v.id
   where p.cliente_id is not null
     and (fp.cliente_id = p.cliente_id
          or exists (select 1 from rel_viagem_passageiros rvp where rvp.viagem_id = v.id and rvp.cliente_id = p.cliente_id))
), um as (
  select distinct on (passageiro_id) * from lig order by passageiro_id, prio, valor_total desc nulls last
), somas as (
  select pa.plano_id,
         coalesce(sum(coalesce(pa.pago_valor, pa.valor)) filter (where pa.status = 'pago'), 0) as recebido,
         coalesce(sum(pa.valor) filter (where pa.status = 'a_receber'), 0) as a_receber,
         coalesce(sum(pa.valor) filter (where pa.status = 'a_receber'
                                          and pa.vencimento < (now() at time zone 'America/Sao_Paulo')::date), 0) as vencido,
         count(*) filter (where pa.status = 'pago')::int as parcelas_pagas,
         count(*) filter (where pa.status = 'a_receber')::int as parcelas_abertas,
         count(*) filter (where pa.status = 'a_receber'
                            and pa.vencimento < (now() at time zone 'America/Sao_Paulo')::date)::int as parcelas_vencidas,
         min(pa.vencimento) filter (where pa.status = 'a_receber') as proximo_vencimento,
         max(pa.pago_em) as ultima_baixa_em
    from fin_parcelas pa
   where pa.plano_id in (select plano_id from um)
   group by pa.plano_id
), contagem as (
  select plano_id, count(*)::int as pax_no_plano from um group by plano_id
)
select um.passageiro_id, um.expedicao_id, um.cliente_id, um.venda_id, um.plano_id, um.ligado_por,
       um.valor_total as plano_total,
       coalesce(s.recebido, 0) as recebido, coalesce(s.a_receber, 0) as a_receber, coalesce(s.vencido, 0) as vencido,
       coalesce(s.parcelas_pagas, 0) as parcelas_pagas, coalesce(s.parcelas_abertas, 0) as parcelas_abertas,
       coalesce(s.parcelas_vencidas, 0) as parcelas_vencidas, s.proximo_vencimento, s.ultima_baixa_em,
       c.pax_no_plano
  from um
  left join somas s on s.plano_id = um.plano_id
  join contagem c on c.plano_id = um.plano_id;

comment on view v_pax_financeiro is
  '0387 ponte: o que o Financeiro já recebeu/tem a receber por passageiro (plano da venda ou da viagem). security_invoker.';

revoke all on v_pax_financeiro from anon, public;
grant select on v_pax_financeiro to authenticated;
