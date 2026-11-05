-- 0314 — Gravação + transcrição do Google Meet chegam sozinhas no card (05/11/2026)
--
-- Até aqui a gravação era um link colado à mão (0215, qs_reuniao_gravacao) e 0
-- de 60 reuniões realizadas em 14 dias tinham. O cron /api/meet-gravacoes lê o
-- evento do Google Agenda da reunião (attachments: vídeo + Doc de transcrição /
-- Anotações do Gemini), baixa o texto do Doc e grava aqui.
--
-- POR QUE O TEXTO FICA NUMA TABELA À PARTE (e não numa coluna de qs_meetings):
--   • qs_meetings tem trg_audit_qs_meetings, que copia a LINHA INTEIRA (old e
--     new) no qs_audit_log a cada update — uma transcrição de 100 mil
--     caracteres viraria 200 mil no log a cada mexida na reunião;
--   • a Agenda, a ficha do lead e o card do closer leem qs_meetings com "*":
--     o texto iria junto em toda listagem (egress).
--   Em qs_meetings ficam só os metadados leves; o texto é lido sob demanda,
--   quando a pessoa abre "Transcrição" na tela.
--
-- Segurança (revisão 04/11): nenhuma função nova; a tabela nova só é ESCRITA
-- pelo servidor (service_role). Leitura por authenticated com a MESMA
-- visibilidade de qs_meetings (a policy consulta qs_meetings, então a RLS dela
-- vale aqui também). anon não lê nada.

-- ── 1. Metadados na reunião ──────────────────────────────────────────────────
alter table public.qs_meetings add column if not exists transcricao_url      text;
alter table public.qs_meetings add column if not exists transcricao_tipo     text;   -- 'transcricao' | 'gemini'
alter table public.qs_meetings add column if not exists transcricao_chars    integer; -- tamanho do texto guardado (0/null = só o link)
alter table public.qs_meetings add column if not exists gravacao_status      text;
alter table public.qs_meetings add column if not exists gravacao_buscada_em  timestamptz;
alter table public.qs_meetings add column if not exists gravacao_tentativas  integer not null default 0;
alter table public.qs_meetings add column if not exists gravacao_erro        text;
alter table public.qs_meetings add column if not exists bitrix_gravacao_em   timestamptz;

do $$ begin
  alter table public.qs_meetings add constraint qs_meetings_gravacao_status_chk
    check (gravacao_status is null or gravacao_status in ('pendente', 'achada', 'sem_gravacao', 'erro'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.qs_meetings add constraint qs_meetings_transcricao_tipo_chk
    check (transcricao_tipo is null or transcricao_tipo in ('transcricao', 'gemini'));
exception when duplicate_object then null; end $$;

comment on column public.qs_meetings.gravacao_status is
  '0314 — busca automática no Google: pendente (ainda tentando) | achada | sem_gravacao (desistiu após 48h) | erro (falta acesso etc.; tenta de novo).';
comment on column public.qs_meetings.gravacao_erro is
  '0314 — frase pro gestor: o que faltou (acesso ao Drive, escopo, evento sem anexo…).';
comment on column public.qs_meetings.bitrix_gravacao_em is
  '0314 — quando a gravação/transcrição foi comentada na timeline do negócio no Bitrix (MEET_GRAVACAO_BITRIX_LIGADO=1).';

-- O cron procura "realizada e ainda não achada" — índice parcial pequeno.
create index if not exists qs_meetings_gravacao_busca_idx
  on public.qs_meetings (scheduled_at)
  where status = 'realizada' and (gravacao_status is null or gravacao_status in ('pendente', 'erro'));

-- ── 2. O texto da transcrição ────────────────────────────────────────────────
create table if not exists public.qs_meeting_transcricoes (
  meeting_id     uuid primary key references public.qs_meetings(id) on delete cascade,
  texto          text not null,
  tipo           text not null default 'transcricao' check (tipo in ('transcricao', 'gemini')),
  drive_file_id  text,
  titulo         text,
  cortada        boolean not null default false,  -- passou do teto (200 mil caracteres)
  criada_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now()
);
comment on table public.qs_meeting_transcricoes is
  '0314 — texto da transcrição (ou Anotações do Gemini) da reunião do Meet. Escrita só pelo servidor (/api/meet-gravacoes).';

alter table public.qs_meeting_transcricoes enable row level security;

revoke all on table public.qs_meeting_transcricoes from public, anon, authenticated;
grant select on table public.qs_meeting_transcricoes to authenticated;
grant all on table public.qs_meeting_transcricoes to service_role;

drop policy if exists transcricoes_select on public.qs_meeting_transcricoes;
-- Vê a transcrição quem vê a reunião (a RLS de qs_meetings vale dentro do exists).
create policy transcricoes_select on public.qs_meeting_transcricoes
  for select to authenticated
  using (
    exists (select 1 from public.qs_meetings m where m.id = qs_meeting_transcricoes.meeting_id)
    and not (select app_eh_cliente())
  );

-- ── Conferência depois de aplicar ────────────────────────────────────────────
--   select gravacao_status, count(*) from qs_meetings where status = 'realizada' group by 1;
--   select meeting_id, tipo, length(texto), cortada from qs_meeting_transcricoes order by criada_em desc limit 10;
--   Testar a busca sem gravar nada:  GET /api/meet-gravacoes?seco=1   (Authorization: Bearer $CRON_SECRET)
