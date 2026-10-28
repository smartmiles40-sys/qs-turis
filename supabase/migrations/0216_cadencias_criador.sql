-- 0216_cadencias_criador.sql
-- -----------------------------------------------------------------------------
-- Criador de cadências (28/10): três colunas novas, todas OPCIONAIS.
--
-- 1. qs_cadences.teto_entrada_dia
--    Limite de leads NOVOS por dia, por SDR, ao entrar na cadência. Em 24/10,
--    459 leads entraram de uma vez na fila de uma SDR ("Resgate — Base Fria") e
--    geraram 2.295 atividades no mesmo dia. Com o teto, o 1º dia do plano dos
--    leads que passarem do limite é empurrado pros próximos dias de execução
--    (espalhamento). NULL = sem teto (comportamento de antes).
--    Quem lê: createCadenceTasks (src/lib/qs/queries.ts) e a importação de CSV
--    (ImportarListaCsv.tsx), via src/lib/qs/cadenceTeto.ts. O lead que chega
--    pelo site (api/_leads.js) NÃO é segurado: lead quente não espera.
--
-- 2. qs_cadence_activities.step_kind
--    Tipo do passo, quando o canal sozinho não diz tudo. Hoje só um valor:
--      'whatsapp_modelo' → mensagem por MODELO aprovado da Meta (channel_type
--                          continua 'whatsapp'; a tarefa gerada é igual).
--    NULL = passo comum (o canal diz o que é). Não mexe no CHECK de
--    channel_type, então qs_tasks e o resto do app seguem iguais.
--    A frente de "disparo em massa" lê step_kind + template_name.
--
-- 3. qs_cadence_activities.template_name
--    Nome do modelo da Meta (ex.: 'retomada_expedicao') quando
--    step_kind = 'whatsapp_modelo'.
--
-- Idempotente (IF NOT EXISTS). O app funciona com ou sem esta migração: se as
-- colunas não existirem, o criador salva sem elas e avisa.
-- -----------------------------------------------------------------------------

alter table public.qs_cadences
  add column if not exists teto_entrada_dia integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qs_cadences_teto_entrada_dia_check'
  ) then
    alter table public.qs_cadences
      add constraint qs_cadences_teto_entrada_dia_check
      check (teto_entrada_dia is null or teto_entrada_dia between 1 and 1000);
  end if;
end $$;

comment on column public.qs_cadences.teto_entrada_dia is
  'Máximo de leads NOVOS por dia, por SDR, iniciando esta cadência. Excedente começa nos próximos dias de execução. NULL = sem teto.';

alter table public.qs_cadence_activities
  add column if not exists step_kind text,
  add column if not exists template_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qs_cadence_activities_step_kind_check'
  ) then
    alter table public.qs_cadence_activities
      add constraint qs_cadence_activities_step_kind_check
      check (step_kind is null or step_kind in ('whatsapp_modelo'));
  end if;
end $$;

comment on column public.qs_cadence_activities.step_kind is
  'Tipo do passo além do canal. NULL = comum; whatsapp_modelo = envio por modelo aprovado da Meta (template_name).';
comment on column public.qs_cadence_activities.template_name is
  'Nome do modelo da Meta usado quando step_kind = whatsapp_modelo.';

-- ── ROLLBACK (manual, se precisar) ──────────────────────────────────────────
-- alter table public.qs_cadence_activities drop constraint if exists qs_cadence_activities_step_kind_check;
-- alter table public.qs_cadence_activities drop column if exists template_name;
-- alter table public.qs_cadence_activities drop column if exists step_kind;
-- alter table public.qs_cadences drop constraint if exists qs_cadences_teto_entrada_dia_check;
-- alter table public.qs_cadences drop column if exists teto_entrada_dia;
