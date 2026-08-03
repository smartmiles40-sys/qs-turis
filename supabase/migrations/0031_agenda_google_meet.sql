-- =============================================================================
-- 0031 — Vínculo da reunião com o evento no Google Calendar
-- =============================================================================
-- Quando o SDR marca "Ganho / Agendou", o QS passa a criar o evento no Google
-- Calendar com link do Google Meet e convidar closer + cliente. Pra poder
-- ATUALIZAR ou CANCELAR esse evento depois (remarcar, cancelar reunião), o QS
-- precisa guardar QUAL evento é — senão cada remarcação viraria um evento novo e
-- a agenda do closer encheria de fantasmas.
--
-- calendar_event_id  — id do evento no Google (o `id` da API do Calendar)
-- calendar_html_link — link pra abrir o evento na agenda (útil no suporte)
-- calendar_error     — última falha de sincronização, pra tela poder explicar
--                      "a reunião foi criada mas o convite não saiu" em vez de
--                      mentir que está tudo certo
--
-- Idempotente: pode rodar mais de uma vez.
-- Depende da 0027 (closer_id) e da 0030 (status/SAL).
-- =============================================================================

alter table qs_meetings add column if not exists calendar_event_id  text;
alter table qs_meetings add column if not exists calendar_html_link text;
alter table qs_meetings add column if not exists calendar_error     text;

-- Busca por evento (webhook do Google avisando mudança/cancelamento vindo de fora).
create index if not exists qs_meetings_calendar_event_idx
  on qs_meetings (calendar_event_id)
  where calendar_event_id is not null;

comment on column qs_meetings.calendar_event_id  is 'ID do evento no Google Calendar (criado no Ganho/Agendou).';
comment on column qs_meetings.calendar_html_link is 'Link do evento na agenda do Google.';
comment on column qs_meetings.calendar_error     is 'Última falha ao sincronizar com o Google Calendar (null = ok).';
