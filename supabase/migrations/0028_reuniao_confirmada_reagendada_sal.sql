-- =============================================================================
-- 0028 — Status de reunião "confirmada" e "reagendada" + o campo SAL
-- =============================================================================
-- A agenda por especialista (tela Reuniões → Agenda) trabalha com o mesmo
-- vocabulário do Bitrix, que tem dois estados a mais do que o QS tinha:
--
--   confirmada  — o cliente respondeu que vem (ainda vai acontecer)
--   reagendada  — saiu do horário e voltou pra fila (não aconteceu)
--
-- E com o desfecho vem o SAL (Sales Accepted Lead): terminada a reunião, o
-- especialista diz se ACEITOU ou RECUSOU o lead. É o dado que fecha o funil —
-- sem ele "reunião realizada" não distingue lead bom de lead ruim.
--
-- Idempotente: pode rodar mais de uma vez.
-- Depende da 0027 (closer_id / ends_at / trava anti-choque).
-- =============================================================================

-- ── (1) status: 4 valores → 6 ───────────────────────────────────────────────
-- O CHECK nasceu inline na 0001, então o nome é o padrão do Postgres. Removemos
-- por descoberta (pg_constraint) em vez de chutar o nome — assim funciona mesmo
-- se alguém já tiver recriado a constraint com outro nome.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'qs_meetings'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%status%'
       and pg_get_constraintdef(con.oid) ilike '%agendada%'
  loop
    execute format('alter table qs_meetings drop constraint %I', c.conname);
    raise notice '[0028] CHECK de status removido: %', c.conname;
  end loop;
end $$;

alter table qs_meetings
  add constraint qs_meetings_status_check
  check (status in ('agendada','confirmada','realizada','no_show','reagendada','cancelada'));

-- ── (2) SAL — Sales Accepted Lead ───────────────────────────────────────────
alter table qs_meetings add column if not exists sal text;

do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_sal_check check (sal is null or sal in ('aceito','recusado'));
exception
  when duplicate_object then raise notice '[0028] CHECK de sal já existia — ok';
end $$;

comment on column qs_meetings.sal is
  'Sales Accepted Lead: o especialista aceitou (aceito) ou recusou (recusado) o lead na reunião. Nulo = ainda não avaliado.';

-- Quem avaliou e quando — sem isso "aceito" é um dado órfão, não dá pra auditar.
alter table qs_meetings add column if not exists sal_at timestamptz;
alter table qs_meetings add column if not exists sal_by uuid references qs_users(id) on delete set null;

create index if not exists idx_qs_meetings_sal on qs_meetings(sal) where sal is not null;

-- ── (3) A trava anti-choque precisa contar "confirmada" ─────────────────────
-- A 0027 impede duas reuniões do mesmo closer no mesmo horário, mas só olhava
-- status = 'agendada'. Sem este ajuste, confirmar uma reunião LIBERARIA o
-- horário dela pra outra pessoa agendar por cima — exatamente o contrário do
-- que "confirmada" significa.
do $$
begin
  alter table qs_meetings drop constraint if exists qs_meetings_closer_no_overlap;
  alter table qs_meetings
    add constraint qs_meetings_closer_no_overlap
    exclude using gist (
      closer_id with =,
      tstzrange(scheduled_at, ends_at, '[)') with &&
    )
    where (closer_id is not null and ends_at is not null and status in ('agendada','confirmada'));
exception
  when others then
    raise warning '[0028] trava anti-choque NÃO reaplicada (%). Provável sobreposição já existente entre reuniões agendadas/confirmadas do mesmo especialista — resolva e rode de novo.', sqlerrm;
end $$;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- select status, count(*) from qs_meetings group by status order by 2 desc;
-- select sal, count(*) from qs_meetings group by sal;
