-- =============================================================================
-- 0032 — Agenda: trava anti-choque correta + o que falta pro desfecho
-- =============================================================================
-- Vem do briefing "Agenda de reuniões no QS". O briefing propunha tabelas novas
-- (closers/disponibilidade/bloqueios/agendamentos); aqui o mesmo desenho é
-- aplicado sobre as que JÁ existem — qs_closer_config, qs_closer_availability,
-- qs_closer_blocks e qs_meetings. Tabela nova em paralelo criaria duas agendas
-- concorrentes: a reunião nascida no Painel (Ganho) não apareceria na agenda, e
-- o sync do Bitrix continuaria lendo a antiga.
--
-- Idempotente. Depende da 0027 (closer_id/ends_at), 0030 (status/SAL) e 0031
-- (calendar_event_id).
-- =============================================================================

-- ── (1) A TRAVA ANTI-CHOQUE ESTAVA FURADA ───────────────────────────────────
-- A da 0027 só valia pra `status = 'agendada'`. A 0030 criou o status
-- 'confirmada' — e reunião confirmada é a que MAIS ocupa horário (o cliente já
-- disse que vem). Do jeito que estava, bastava confirmar uma reunião para o
-- horário voltar a ser oferecido: overbooking silencioso, exatamente o que a
-- constraint existia para impedir.
--
-- Regra correta (a do briefing): ocupa horário tudo que não foi cancelado nem
-- reagendado. 'realizada' e 'no_show' também ficam de fora do slot livre porque
-- são passado — e permitir sobreposição com elas reescreveria o histórico.
do $$
begin
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
      and status not in ('cancelada', 'reagendada')
    );
  raise notice '[0032] trava anti-choque aplicada (agora cobre confirmada/realizada/no_show)';
exception
  when others then
    -- A base já tem sobreposição: a constraint não entra e a migration NÃO pode
    -- morrer por isso. A consulta no fim do arquivo lista o que resolver.
    raise warning '[0032] trava anti-choque NÃO aplicada (%). Rode a consulta do fim deste arquivo, resolva as sobreposições e reaplique.', sqlerrm;
end $$;

-- ── (2) Desfecho: o que o briefing pede e ainda não existe ──────────────────

-- QUANDO a reunião aconteceu. Diferente de updated_at (que muda a cada mexida)
-- e de scheduled_at (que é quando ela ESTAVA marcada). É a data que o Bitrix
-- carimba em "Data da Reunião Realizada" e a que ancora o SAL no mês certo.
alter table qs_meetings add column if not exists realizada_em timestamptz;

-- Por que o lead foi RECUSADO. Sem motivo, "recusado" vira um número que
-- ninguém sabe atacar. Lista fechada definida pelo comercial (qs_settings,
-- chave sal_motivos) — o texto fica aqui pra não travar em id de tabela nova.
alter table qs_meetings add column if not exists sal_motivo text;

-- De qual reunião esta veio, quando é remarcação. É o que separa REAGENDAMENTO
-- (aviso prévio) de NO-SHOW (sumiço) na hora de cobrar o SDR, e o que permite
-- contar quantas vezes o mesmo lead remarcou.
alter table qs_meetings add column if not exists reagendado_de uuid references qs_meetings(id);

-- Recusado SEM motivo é dado sujo por construção: o CHECK impede na origem.
-- Só vale daqui pra frente (linhas antigas não são tocadas).
do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_sal_motivo_check
    check (sal is distinct from 'recusado' or sal_motivo is not null)
    not valid;   -- `not valid`: não reprova o histórico, mas vale pra todo novo
  raise notice '[0032] CHECK de motivo do SAL aplicado';
exception
  when duplicate_object then raise notice '[0032] CHECK de motivo do SAL já existia';
end $$;

create index if not exists idx_qs_meetings_sem_desfecho
  on qs_meetings (ends_at)
  where status in ('agendada', 'confirmada');

create index if not exists idx_qs_meetings_reagendado_de
  on qs_meetings (reagendado_de)
  where reagendado_de is not null;

comment on column qs_meetings.realizada_em  is 'Quando a reunião de fato aconteceu (ancora o SAL no mês certo).';
comment on column qs_meetings.sal_motivo    is 'Motivo da recusa do lead pelo especialista. Obrigatório quando sal = recusado.';
comment on column qs_meetings.reagendado_de is 'Reunião que esta substitui (remarcação). Separa reagendamento de no-show.';

-- ── (3) Motivos de recusa — lista fechada, editável pelo gestor ─────────────
-- Vai pra qs_settings (que já existe e já é lida pelo app) em vez de virar mais
-- uma tabela. O comercial ainda vai fechar a lista; estes são um ponto de
-- partida plausível e podem ser trocados em Configurações sem migration.
insert into qs_settings (key, value)
values ('sal_motivos', '["Fora do perfil","Sem orçamento","Sem urgência (>6 meses)","Já comprou com concorrente","Dado incorreto / não era o decisor","Curioso — sem intenção real"]'::jsonb)
on conflict (key) do nothing;

-- ── CONSULTA DE CONFERÊNCIA ────────────────────────────────────────────────
-- Se o aviso do passo (1) aparecer, rode isto pra ver o que está sobreposto:
--
-- select a.id, b.id, a.closer_id, a.scheduled_at, a.ends_at, b.scheduled_at, b.ends_at
--   from qs_meetings a
--   join qs_meetings b
--     on a.closer_id = b.closer_id
--    and a.id < b.id
--    and tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)')
--  where a.closer_id is not null and a.ends_at is not null and b.ends_at is not null
--    and a.status not in ('cancelada','reagendada')
--    and b.status not in ('cancelada','reagendada')
--  order by a.closer_id, a.scheduled_at;
