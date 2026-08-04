-- =============================================================================
-- 0034 — Liga os closers recém-cadastrados na agenda que já existe
-- =============================================================================
-- Cadastrar o usuário com papel `closer` é o primeiro passo, mas sozinho ele não
-- muda nada: as 68 reuniões que já existem continuam com o responsável em TEXTO
-- (`meeting_owner`), e sem vínculo elas ficam fora de tudo que importa —
--
--   • a AGENDA mostra DUAS colunas do mesmo especialista: uma "Bruno Matheus ·
--     Especialista" (vazia) e outra "Bruno Matheus · responsável (texto)" com as
--     reuniões de verdade;
--   • a TRAVA ANTI-CHOQUE (0032) não protege nenhuma delas — ela casa por
--     closer_id, e closer_id nulo nunca conflita com nada. Overbooking livre;
--   • o CONVITE do Google não tem pra quem ir: o e-mail vem do cadastro.
--
-- Esta migration faz o casamento por NOME EXATO e prepara o que a agenda precisa.
-- Idempotente: rodar de novo não duplica nem re-vincula o que já está certo.
-- Depende da 0032 (trava corrigida).
-- =============================================================================

-- ── (1) Vincula as reuniões cujo responsável em texto é um closer cadastrado ──
-- UMA POR VEZ, de propósito. Um UPDATE em lote morreria inteiro no primeiro
-- conflito: vincular reuniões que se sobrepõem faz a trava da 0032 recusar (e
-- sobreposição existe mesmo — foi tudo digitado à mão, sem trava nenhuma até
-- agora). Assim, o que dá pra vincular é vinculado, e o que colide fica de fora
-- e aparece no aviso pra resolver na mão.
do $$
declare
  r         record;
  ok        int := 0;
  colidiu   int := 0;
begin
  for r in
    select m.id, m.meeting_owner, u.id as closer_id, u.name
      from qs_meetings m
      join qs_users u
        on lower(btrim(u.name)) = lower(btrim(m.meeting_owner))
       and u.role = 'closer'
       and u.is_active
     where m.closer_id is null
       and m.meeting_owner is not null
     order by m.scheduled_at
  loop
    begin
      update qs_meetings
         set closer_id = r.closer_id,
             updated_at = now()
       where id = r.id;
      ok := ok + 1;
    exception
      when exclusion_violation then
        -- Duas reuniões do mesmo especialista no mesmo horário. A primeira
        -- ficou vinculada; esta continua como texto até alguém decidir qual vale.
        colidiu := colidiu + 1;
      when others then
        raise warning '[0034] reunião % não vinculada: %', r.id, sqlerrm;
    end;
  end loop;

  raise notice '[0034] reuniões vinculadas ao closer: % | deixadas de fora por choque de horário: %', ok, colidiu;
  if colidiu > 0 then
    raise notice '[0034] rode a consulta do fim do arquivo pra ver quais colidiram.';
  end if;
end $$;

-- ── (2) Configuração de agendamento de cada closer ──────────────────────────
-- Sem linha aqui a agenda usa os padrões do código. Criar a linha explícita é o
-- que permite ao gestor mexer em Configurações → Agenda dos Closers.
insert into qs_closer_config (closer_id, slot_minutes, buffer_minutes, min_notice_minutes, is_bookable)
select u.id, 60, 0, 120, true
  from qs_users u
 where u.role = 'closer'
   and u.is_active
   and not exists (select 1 from qs_closer_config c where c.closer_id = u.id);

-- ── (3) Janelas de atendimento ──────────────────────────────────────────────
-- Sem janela, o seletor de horários não tem NADA pra oferecer — o modal abre
-- vazio e parece quebrado. Em vez de inventar um horário, herda o EXPEDIENTE que
-- a operação já configurou em Configurações → Horário de Trabalho
-- (qs_settings.work_hours). É um ponto de partida real, e o gestor ajusta por
-- closer na tela Agenda dos Closers.
-- Só semeia quem não tem NENHUMA janela — quem já configurou não é tocado.
do $$
declare
  wh   jsonb;
  u    record;
  d    int;
  dia  jsonb;
  n    int := 0;
begin
  select value into wh from qs_settings where key = 'work_hours';

  if wh is null then
    raise notice '[0034] sem work_hours configurado — janelas não semeadas (configure em Agenda dos Closers).';
    return;
  end if;

  for u in
    select id, name from qs_users
     where role = 'closer' and is_active
       and not exists (select 1 from qs_closer_availability a where a.closer_id = qs_users.id)
  loop
    for d in 0..6 loop
      dia := wh -> d::text;
      if dia is not null and (dia ->> 'enabled')::boolean then
        insert into qs_closer_availability (closer_id, weekday, start_time, end_time)
        values (u.id, d, (dia ->> 'start')::time, (dia ->> 'end')::time);
        n := n + 1;
      end if;
    end loop;
    raise notice '[0034] janelas semeadas para %', u.name;
  end loop;

  raise notice '[0034] total de janelas criadas: %', n;
end $$;

-- ── CONFERÊNCIA ────────────────────────────────────────────────────────────
-- O que sobrou como texto (não casou com nenhum closer cadastrado):
--
-- select meeting_owner, count(*) filter (where scheduled_at > now()) as futuras, count(*) as total
--   from qs_meetings
--  where closer_id is null and meeting_owner is not null
--  group by 1 order by 3 desc;
--
-- Reuniões do mesmo closer que se sobrepõem (as que ficaram de fora do vínculo):
--
-- select a.id, b.id, a.meeting_owner, a.scheduled_at, b.scheduled_at
--   from qs_meetings a
--   join qs_meetings b
--     on lower(btrim(a.meeting_owner)) = lower(btrim(b.meeting_owner))
--    and a.id < b.id
--    and tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)')
--  where a.ends_at is not null and b.ends_at is not null
--    and a.status not in ('cancelada','reagendada')
--    and b.status not in ('cancelada','reagendada')
--  order by a.meeting_owner, a.scheduled_at;
