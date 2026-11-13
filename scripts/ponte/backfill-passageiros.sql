-- scripts/ponte/backfill-passageiros.sql
-- -----------------------------------------------------------------------------
-- BACKFILL (SIMULAÇÃO) — passageiros ativos de Expedições sem viagem no Rel (ponte 0386).
-- NÃO FOI EXECUTADO. Quem decide rodar de verdade é o Bruno.
--
-- PARTE A — só leitura, roda HOJE. Resultado em 13/11/2026:
--   Pagante/Cortesia Confirmado/Pré-reserva com ficha: 930 (571 passadas, 359 futuras)
--     já ligados certo: 760 (495 passadas, 265 futuras)
--     vínculo certo mas a pessoa não está em rel_viagem_passageiros: 9 (2 + 7)
--     sem viagem: 161 (74 passadas, 87 futuras), dos quais
--       casam com viagem do Bitrix do cliente (expedição/pacote, embarque ±7 dias,
--       ainda sem expedição ligada): 72 (15 passadas, 57 futuras) → LIGA, não cria;
--       viriam a ser CRIADAS (origem 'expedicoes'): 89 (59 passadas, 30 futuras).
--   Líderes (27) ficam de fora, como na importação. Passageiro sem ficha (cliente_id
--   nulo) espera o cadastro único ligar — o gatilho roda quando cliente_id chega.
--   Nenhum desses passageiros tem venda do QS (venda_id) hoje.
--
-- PARTE B — com 0385+0386 aplicadas: chama ponte_pax_para_rel em cada um DENTRO de
--   uma transação e termina em ROLLBACK (troque por COMMIT só depois de conferir).
--   Sugestão: rodar só as FUTURAS (filtro já está abaixo); as passadas viram
--   histórico de viagem concluída e podem esperar a decisão.
-- -----------------------------------------------------------------------------

-- ═════ PARTE A (só leitura) ═════
with p as (
  select pa.*, e.data_embarque > current_date fut, coalesce(g.data_embarque, e.data_embarque) emb
    from passageiros pa join expedicoes e on e.id = pa.expedicao_id
    left join grupos_expedicao g on g.id = pa.grupo_id
    left join rel_expedicoes_vinculo x on x.passageiro_id = pa.id
   where pa.cliente_id is not null and pa.status_reserva in ('Confirmado','Pré-reserva') and pa.tipo in ('Pagante','Cortesia')
     and not exists (select 1 from rel_viagens vg where vg.expedicoes_id = pa.expedicao_id and vg.mesclada_em_id is null and vg.status <> 'arquivada'
                       and (vg.cliente_id = pa.cliente_id or exists (select 1 from rel_viagem_passageiros rp where rp.viagem_id = vg.id and rp.cliente_id = pa.cliente_id)))
     and (x.viagem_id is null or x.expedicao_id <> pa.expedicao_id
          or not exists (select 1 from rel_viagens v where v.id = x.viagem_id and (v.expedicoes_id is null or v.expedicoes_id = pa.expedicao_id)))
)
select fut, count(*) sem_viagem,
       count(*) filter (where exists (select 1 from rel_viagens vg where vg.mesclada_em_id is null and vg.status = 'ativa' and vg.expedicoes_id is null
                                        and vg.tipo in ('expedicao','pacote') and abs(vg.data_embarque - p.emb) <= 7
                                        and (vg.cliente_id = p.cliente_id or exists (select 1 from rel_viagem_passageiros rp where rp.viagem_id = vg.id and rp.cliente_id = p.cliente_id)))) liga_bitrix_perto,
       count(*) filter (where p.venda_id is not null) com_venda_qs
  from p group by fut;

-- ═════ PARTE B (com 0385 + 0386 aplicadas) — SIMULAÇÃO: termina em ROLLBACK ═════
begin;
create temp table _bf_pax as
  select pa.id, ponte_pax_para_rel(pa.id) r
    from passageiros pa join expedicoes e on e.id = pa.expedicao_id
   where pa.cliente_id is not null and pa.status_reserva in ('Confirmado','Pré-reserva') and pa.tipo in ('Pagante','Cortesia')
     and e.data_embarque > current_date;          -- ← tire esta linha para incluir as passadas
select r ->> 'como' como, (r ->> 'criada')::boolean criada, (r ->> 'ligou')::boolean ligou, count(*)
  from _bf_pax group by 1, 2, 3 order by 4 desc;
rollback;   -- ← COMMIT só com o ok do Bruno
