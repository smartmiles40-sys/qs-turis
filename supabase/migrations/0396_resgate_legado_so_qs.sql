-- 0396_resgate_legado_so_qs.sql
-- -----------------------------------------------------------------------------
-- Resgate antigo também fica SÓ NO QS (16/11/2026).
--
-- Decisão do Bruno em 12/11: "o resgate só deve reiniciar no QS e não no
-- Bitrix". O commit 55aa626 criou o estado `so_qs` (0362), mas só para os cards
-- de resgate criados DAÍ PRA FRENTE. Os antigos (27/07 a 22/10, cadência
-- "Resgate — Base Fria", sem bitrix_id) continuaram com estado nulo/pendente e
-- por isso:
--   • apareciam como "lead sem card no Bitrix" no alerta da gestão (142 dos 153
--     abertos sem card em 16/11 eram desses);
--   • a rotina de nova tentativa, se fosse ligada, abriria ~140 negócios NOVOS
--     no Bitrix — a simulação de 16/11 mostrou que em 118 casos a pessoa JÁ tem
--     card (o lead original, de onde o resgate foi copiado).
--
-- Só dados. Não mexe em lead com bitrix_id (o gatilho 0362 manteria 'ok' de
-- qualquer jeito) nem em quem já está so_qs. Idempotente.
-- -----------------------------------------------------------------------------

update public.qs_leads l
   set bitrix_card_status   = 'so_qs',
       bitrix_card_erro     = null,
       bitrix_card_proxima  = null,
       bitrix_card_trava    = null
  from public.qs_cadences c
 where c.id = l.cadence_id
   and c.name = 'Resgate — Base Fria'
   and nullif(btrim(coalesce(l.bitrix_id, '')), '') is null
   and l.bitrix_card_status is distinct from 'so_qs';
