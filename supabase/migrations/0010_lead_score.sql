-- 0010_lead_score.sql
-- -----------------------------------------------------------------------------
-- Lead Score REAL: o QS deixa de inventar a temperatura (antes começava em 50 e
-- somava +30 pra lead novo → TODO lead virava "Quente"). Agora a temperatura é
-- só o REFLEXO do rótulo que vem do Bitrix (campo Temperatura/Fonte de score).
--
-- Guardamos o rótulo cru vindo do Bitrix ("Quente"/"Morno"/"Frio", "hot"/etc.);
-- a normalização pra quente|morno|frio acontece na aplicação (src/lib/leadScore.ts).
-- Sem rótulo do Bitrix → coluna NULL → o card NÃO mostra chip de temperatura
-- (nada de "Quente" falso).
-- -----------------------------------------------------------------------------

alter table qs_leads
  add column if not exists lead_score text;

comment on column qs_leads.lead_score is
  'Temperatura do lead vinda do Bitrix (rótulo cru: Quente/Morno/Frio). NULL = sem score.';
