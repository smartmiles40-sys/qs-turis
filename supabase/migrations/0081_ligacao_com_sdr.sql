-- 0081_ligacao_com_sdr.sql
-- -----------------------------------------------------------------------------
-- LIGAÇÃO MARCADA COM O SDR (Bruno, 16/09/2026).
--
-- Depois da live, quem não assistiu (ou viu metade) recebe a gravação junto com
-- um segundo formulário. Nele a pessoa não marca com o closer: marca uma
-- LIGAÇÃO RÁPIDA (5 min) com o SDR dono do lead, que qualifica antes de passar
-- pro especialista. Motivo medido: das 63 reuniões que o próprio cliente marcou
-- desde 08/09, 30 eram de gente que não assistiu ou viu só metade.
--
-- POR QUE UMA TABELA NOVA E NÃO `qs_meetings`. Reunião no QS é do closer: conta
-- no indicador, vai pro Google, move card no Bitrix, pede SAL. A ligação do SDR
-- não é nada disso — é uma atividade extra na fila dele. Mas precisa da MESMA
-- trava que a reunião tem: dois clientes na mesma meia hora do mesmo SDR. Essa
-- trava só existe de verdade no banco (EXCLUDE), então a ligação ganha uma linha
-- própria com a constraint, e a atividade na fila aponta pra ela.
--
-- A LINHA SE SOLTA SOZINHA. O SDR pode adiar, concluir, ignorar ou excluir a
-- atividade pela tela — e a tela não conhece esta tabela. Se a linha ficasse
-- 'marcada', aquele horário seguiria ocupado pra sempre (o horário-fantasma que
-- já aconteceu com as reuniões em 08/09). O gatilho no fim deste arquivo solta a
-- reserva no instante em que a atividade deixa de ser "ligar nesse horário".
-- -----------------------------------------------------------------------------

create extension if not exists btree_gist;

create table if not exists public.qs_ligacoes_sdr (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.qs_leads(id) on delete cascade,
  sdr_id      uuid not null references public.qs_users(id) on delete cascade,
  task_id     uuid references public.qs_tasks(id) on delete set null,
  inicio      timestamptz not null,
  fim         timestamptz not null,
  -- marcada   = ocupa a agenda do SDR
  -- feita     = a atividade foi concluída (histórico, não ocupa mais)
  -- liberada  = a atividade foi adiada, ignorada ou excluída
  status      text not null default 'marcada',
  expedicao   text,
  origem_lp   text,
  observacao  text,
  created_at  timestamptz not null default now(),
  constraint qs_ligacoes_sdr_status_check check (status in ('marcada', 'feita', 'liberada')),
  constraint qs_ligacoes_sdr_periodo_check check (fim > inicio),
  constraint qs_ligacoes_sdr_no_overlap exclude using gist (
    sdr_id with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status = 'marcada')
);

create index if not exists qs_ligacoes_sdr_inicio_idx on public.qs_ligacoes_sdr (inicio) where status = 'marcada';
create index if not exists qs_ligacoes_sdr_lead_idx on public.qs_ligacoes_sdr (lead_id);
create index if not exists qs_ligacoes_sdr_task_idx on public.qs_ligacoes_sdr (task_id);

-- Só o servidor (service_role) lê e escreve. A tela do SDR trabalha pela
-- atividade em qs_tasks, que já tem a RLS dela; esta tabela é a reserva.
alter table public.qs_ligacoes_sdr enable row level security;

-- ── A reserva acompanha a atividade ─────────────────────────────────────────
create or replace function public.qs_ligacao_sdr_segue_tarefa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update qs_ligacoes_sdr set status = 'liberada'
     where task_id = old.id and status = 'marcada';
    return old;
  end if;

  if new.status = 'concluida' then
    update qs_ligacoes_sdr set status = 'feita'
     where task_id = new.id and status = 'marcada';
  elsif new.status = 'ignorada'
     or new.scheduled_at is distinct from old.scheduled_at
     or new.owner_id is distinct from old.owner_id then
    -- Adiou, trocou de dono ou encerrou sem ligar: o horário volta pra grade.
    update qs_ligacoes_sdr set status = 'liberada'
     where task_id = new.id and status = 'marcada';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_ligacao_sdr_segue_tarefa on public.qs_tasks;
create trigger trg_qs_ligacao_sdr_segue_tarefa
  after update of status, scheduled_at, owner_id or delete on public.qs_tasks
  for each row execute function public.qs_ligacao_sdr_segue_tarefa();

-- ── Configuração sem deploy ─────────────────────────────────────────────────
-- Horário comercial pedido pelo Bruno: 10h às 19h, de 30 em 30 minutos, com a
-- última ligação começando às 18h30.
insert into public.qs_settings (key, value)
values ('agendamento_sdr', jsonb_build_object(
  'ativo', true,
  'janela', jsonb_build_object('primeira', '10:00', 'ultima', '18:30'),
  'passoMin', 30,
  'duracaoMin', 5,
  'dias', jsonb_build_array(1, 2, 3, 4, 5),
  'antecedenciaMin', 60,
  'diasAFrente', 7
))
on conflict (key) do nothing;
