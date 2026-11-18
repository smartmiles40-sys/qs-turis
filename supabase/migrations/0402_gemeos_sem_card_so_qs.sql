-- supabase/migrations/0402_gemeos_sem_card_so_qs.sql
-- -----------------------------------------------------------------------------
-- 18/11/2026 — antes de ligar LEADS_BITRIX_RETENTATIVA_LIGADA.
-- A simulação (/api/leads-sem-card?acao=simular&consultar=1) mostrou 11 leads na
-- fila; 7 são GÊMEOS: o mesmo telefone de outro lead do QS que já tem o negócio
-- no Bitrix. Ligada, a rotina criaria 7 negócios duplicados. Marca esses 7 como
-- so_qs (fica só no QS) com o motivo em bitrix_card_erro apontando o gêmeo.
-- Conferido telefone a telefone (últimos 8 dígitos iguais). Idempotente.
-- -----------------------------------------------------------------------------

with p(lid, deal) as (values
  ('abdd60ec-6f96-4ee7-821d-155fae96a7c8', '43559'),
  ('7735ae1d-c0e6-485e-9ad5-c30636e84a33', '43959'),
  ('b023eeb5-7add-4904-8661-f12617f38242', '43611'),
  ('fc4c34c7-44c7-4c0a-b5ba-72118d6e789e', '53005'),
  ('ec841f18-4aa0-44ac-92ce-3a56a83f2992', '54145'),
  ('8ec1686e-110e-45a6-b671-edc59eeaab68', '56135'),
  ('08cda324-58a0-4259-b513-e9323c887799', '56197'))
update qs_leads a
   set bitrix_card_status = 'so_qs',
       bitrix_card_proxima = null,
       bitrix_card_erro = 'gêmeo de "' || t.full_name || '" (lead ' || t.id || '), que já tem o negócio ' || p.deal || ' no Bitrix — 0402, 18/11'
  from p
  join qs_leads t on t.bitrix_id::text = p.deal
 where a.id = p.lid::uuid
   and t.id <> a.id
   and a.bitrix_id is null
   and right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 8) = right(regexp_replace(coalesce(t.phone, ''), '\D', '', 'g'), 8)
   and a.bitrix_card_status is distinct from 'so_qs';
