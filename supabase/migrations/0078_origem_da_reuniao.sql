-- =============================================================================
-- 0078 — DE ONDE VEIO A REUNIÃO (coluna própria)
-- -----------------------------------------------------------------------------
-- APLICADA EM 08/09/2026 pelo MCP do Supabase. Fica versionada pra história.
--
-- O QS tem uma convenção clara, medida em 20 dias e 153 reuniões:
--   owner_id     = o SDR QUE AGENDOU
--   closer_id    = o especialista que vai atender
--   scheduled_by = o NOME do SDR que agendou
--
-- O autoagendamento não seguia isso: gravava o closer em owner_id e a string
-- "Autoagendamento (site)" em scheduled_by. Duas consequências:
--   1. o SDR não via a reunião em lugar nenhum (a Agenda e o sino filtram por
--      owner_id) e não era creditado por ela;
--   2. o "Quem fez o agendamento?" do Bitrix não casava com ninguém, porque o
--      casamento lá é pelo NOME da pessoa — e "Autoagendamento (site)" não é
--      nome de ninguém.
--
-- Agora `scheduled_by` volta a ser o nome do SDR, como em toda reunião do QS —
-- e a origem, que antes morava lá, ganha coluna própria. Sem esta coluna,
-- alinhar o scheduled_by faria a métrica do autoagendamento sumir junto.
--
-- Valores: 'autoagendamento' | 'gloria' | null (= marcada pelo time, na tela).
-- ⚠️ Idempotente.
-- =============================================================================

alter table qs_meetings add column if not exists origem text;

comment on column qs_meetings.origem is
  'De onde veio a reuniao: autoagendamento | gloria | null (marcada pelo time). '
  'O scheduled_by segue sendo o NOME de quem agendou, como em toda reuniao do QS.';

update qs_meetings set origem = 'autoagendamento'
 where origem is null and scheduled_by = 'Autoagendamento (site)';

update qs_meetings set origem = 'gloria'
 where origem is null and scheduled_by = 'Glória (IA)';

create index if not exists qs_meetings_origem_idx
  on qs_meetings (origem, scheduled_at desc) where origem is not null;

-- CONFERÊNCIA
--   select origem, count(*) from qs_meetings group by 1;
--   -- quantas o autoagendamento trouxe, por SDR creditado:
--   select u.name, count(*) from qs_meetings m
--     join qs_users u on u.id = m.owner_id
--    where m.origem = 'autoagendamento' group by 1 order by 2 desc;
