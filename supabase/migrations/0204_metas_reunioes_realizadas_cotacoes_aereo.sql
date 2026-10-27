-- 0204 — Metas novas do SDR (Bruno, 26/10/2026)
--
-- O supervisor passa a cadastrar no QS (Análises e metas) duas metas que não
-- existiam:
--   • reunioes_realizadas — reuniões do SDR que aconteceram (status realizada);
--   • cotacoes_aereo      — cotações de aéreo feitas pelo SDR (o SDR não faz
--                           pacote, só aéreo).
-- A meta "reunioes" que já existia continua sendo a de reuniões AGENDADAS.
-- Só amplia a lista de tipos aceitos; nenhum dado é alterado.

alter table qs_goals drop constraint if exists qs_goals_type_check;
alter table qs_goals add constraint qs_goals_type_check
  check (type = any (array['ganhos', 'leads_finalizados', 'atividades', 'conversao', 'reunioes',
                           'reunioes_realizadas', 'cotacoes_aereo']));
