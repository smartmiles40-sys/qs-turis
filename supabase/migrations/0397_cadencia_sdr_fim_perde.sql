-- 0397_cadencia_sdr_fim_perde.sql
-- -----------------------------------------------------------------------------
-- Fim da "Cadência SDR" = perdido "Fim de cadência" (Bruno, 16/11/2026).
--
-- A Cadência SDR redirecionava pra "Resgate — Base Fria", que está CONGELADA.
-- Com destino congelado o motor (api/cadencia-sweep.js) faz o lead ESPERAR:
-- 215 leads em prospecção terminaram as ~16 tentativas e ficaram sem nenhuma
-- tarefa (a revisão de 12/11 dava 1 tarefa por lead, 5/SDR/dia, e depois de
-- concluída o lead voltava a ficar parado).
--
-- Decisão do Bruno (16/11): perder por fim de cadência. Sem redirecionamento e
-- com auto_loss_days = 1, o motor perde quem NÃO tem mais tarefa pendente
-- (lead no meio do plano não é tocado), grava o motivo "Fim de cadência" e
-- move o card pra Perdido no Bitrix. Ritmo: 50 por rodada, a cada 30 min.
--
-- Desfazer: voltar redirect_cadence_id pro id da "Resgate — Base Fria" e
-- auto_loss_days pra null.
-- -----------------------------------------------------------------------------

update public.qs_cadences
   set redirect_cadence_id = null,
       auto_loss_days      = 1
 where name = 'Cadência SDR';
