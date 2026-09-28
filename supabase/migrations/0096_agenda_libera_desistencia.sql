-- =============================================================================
-- 0096 — AGENDA: SÓ OCUPA O HORÁRIO A REUNIÃO QUE VAI ACONTECER (ou aconteceu)
-- -----------------------------------------------------------------------------
-- Bruno, 28/09/2026: "os SDRs fazem um agendamento e cancelam depois, mas o
-- horário na agenda fica bloqueado".
--
-- A trava do banco (0027, qs_meetings_closer_no_overlap) só liberava o horário
-- em 'cancelada' e 'reagendada'. Quando o cliente desiste ANTES da reunião, o
-- SDR registra 'desistencia' — e o horário continuava preso: a grade mostrava
-- livre (ela só olhava 'agendada') e o INSERT era recusado. Medido em 28/09:
-- 3 horários futuros presos assim (Talita 18h30 e 19h30, Bruno Matheus 15h).
--
-- Regra única, igual no banco, no servidor (api/_agenda.js) e na tela
-- (closerAgenda.ts, STATUS_QUE_OCUPA): ocupa o horário só
--   agendada · confirmada · realizada.
-- Desistência, no-show, arquivada, cancelada e reagendada LIBERAM.
--
-- Recriar com um filtro MAIS estreito não gera conflito novo: o conjunto de
-- linhas vigiadas só diminui.
-- =============================================================================

alter table qs_meetings drop constraint if exists qs_meetings_closer_no_overlap;

alter table qs_meetings
  add constraint qs_meetings_closer_no_overlap
  exclude using gist (
    closer_id with =,
    tstzrange(scheduled_at, ends_at, '[)') with &&
  )
  where (
    closer_id is not null
    and ends_at is not null
    and status = any (array['agendada', 'confirmada', 'realizada'])
  );
