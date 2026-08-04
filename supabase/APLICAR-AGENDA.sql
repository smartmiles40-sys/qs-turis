-- =============================================================================
-- APLICAR-AGENDA.sql — cole ISTO no SQL Editor do Supabase, de uma vez só
-- =============================================================================
-- Junta as migrations 0031 a 0035 na ordem correta: campos do Google, trava
-- anti-choque, desfecho com SAL, reagendamento com histórico, ativação dos
-- closers e a limpeza do histórico inservível.
--
-- RODA COMO UMA TRANSAÇÃO SÓ. Se qualquer passo falhar, NADA é aplicado — você
-- corrige e cola de novo, sem banco pela metade.
--
-- DEPOIS DE RODAR, procure estes NOTICE na aba de mensagens:
--   [0032] trava anti-choque aplicada        → WARNING aqui = há sobreposição
--   [0034] reuniões vinculadas ao closer: N  → esperado ~68
--   [0034] total de janelas criadas: N       → esperado 10 (5 dias × 2 closers)
--   [0035] retiradas do funil: N             → esperado 88
--   [0035] reuniões ativas agora: N          → esperado 9
--
-- A 0035 RETIRA 88 reuniões da tabela ativa. Elas são COPIADAS antes para
-- qs_meetings_arquivo — nada é perdido, e a instrução de restaurar está no fim
-- da própria 0035. Para rodar SEM essa parte, apague o bloco do PASSO 5.
--
-- IDEMPOTENTE: rodar duas vezes não duplica nem apaga o que ficou.
-- Gerado a partir dos arquivos em supabase/migrations/ — edite lá, não aqui.
-- =============================================================================

begin;


-- ###########################################################################
-- PASSO 1/5 — Campos do Google Calendar na reunião
-- fonte: supabase/migrations/0031_agenda_google_meet.sql
-- ###########################################################################

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


-- ###########################################################################
-- PASSO 2/5 — Trava anti-overbooking corrigida + campos do desfecho
-- fonte: supabase/migrations/0032_agenda_desfecho.sql
-- ###########################################################################

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


-- ###########################################################################
-- PASSO 3/5 — Reagendar cria linha nova, numa transação só
-- fonte: supabase/migrations/0033_reagendar_atomico.sql
-- ###########################################################################

-- =============================================================================
-- 0033 — Reagendar cria linha NOVA, numa transação só
-- =============================================================================
-- Hoje remarcar move a própria linha: o histórico some. O briefing pede o
-- contrário — linha nova com `reagendado_de`, a antiga marcada `reagendada` —
-- porque é isso que separa REAGENDAMENTO (avisou antes) de NO-SHOW (sumiu) na
-- hora de cobrar o SDR, e o que permite contar quantas vezes o mesmo lead
-- remarcou (o teto de 3 que o comercial vai definir).
--
-- POR QUE UMA FUNÇÃO, e não dois comandos no front:
--
-- São dois passos que precisam valer juntos. E a ordem entre eles é uma
-- armadilha: a linha antiga OCUPA o horário dela (trava anti-choque da 0032),
-- então remarcar 14:00 → 14:30 do mesmo closer seria recusado por conflito com
-- ela mesma. Liberar a antiga primeiro resolve isso, mas se o insert seguinte
-- falhar (o horário novo é de outra reunião), a antiga já teria sido dada como
-- reagendada — e a reunião sumiria da agenda sem substituta.
--
-- Dentro de uma função, os dois passos são UMA transação: ou vale tudo, ou nada
-- muda. O erro 23P01 (exclusion violation) sobe pro front, que mostra "horário
-- ocupado" com a agenda intacta.
--
-- SECURITY INVOKER de propósito: a RLS continua valendo. Quem não pode mexer na
-- reunião não reagenda por aqui.
--
-- Idempotente. Depende da 0032 (reagendado_de + trava corrigida).
-- =============================================================================

create or replace function qs_reagendar_reuniao(
  p_meeting_id   uuid,
  p_scheduled_at timestamptz,
  p_duration_min integer default null,
  p_closer_id    uuid    default null,
  p_closer_nome  text    default null,
  p_por          text    default null
)
returns qs_meetings
language plpgsql
security invoker
as $$
declare
  v_antiga qs_meetings;
  v_nova   qs_meetings;
  v_dur    integer;
  v_rastro text;
begin
  select * into v_antiga from qs_meetings where id = p_meeting_id for update;
  if not found then
    raise exception 'reunião % não encontrada (ou sem permissão)', p_meeting_id
      using errcode = 'no_data_found';
  end if;

  if v_antiga.status in ('cancelada', 'reagendada') then
    raise exception 'esta reunião já foi % — reagende a mais recente', v_antiga.status
      using errcode = 'invalid_parameter_value';
  end if;

  v_dur := coalesce(p_duration_min, v_antiga.duration_min, 60);

  -- (1) Libera o horário antigo ANTES de inserir. Sem isto, remarcar para um
  --     horário que encosta no atual bate na trava contra a própria reunião.
  update qs_meetings
     set status = 'reagendada',
         -- O evento no Google passa a pertencer à linha nova; deixar o id aqui
         -- faria duas linhas apontarem pro mesmo evento e um cancelamento na
         -- antiga apagaria a reunião nova.
         calendar_event_id = null,
         updated_at = now()
   where id = v_antiga.id;

  v_rastro := format('↻ Reagendada de %s para %s%s',
                     to_char(v_antiga.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                     to_char(p_scheduled_at        at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                     case when p_por is null then '' else ' por ' || p_por end);

  -- (2) Linha nova, herdando o que identifica a reunião (inclusive o vínculo com
  --     o evento do Google, que será movido de horário, não recriado).
  insert into qs_meetings (
    lead_id, owner_id, closer_id, title, scheduled_at, ends_at, duration_min,
    location, meeting_link, notes, status, lead_name, scheduled_by, meeting_owner,
    client_email, booking_date, calendar_event_id, calendar_html_link, reagendado_de
  ) values (
    v_antiga.lead_id, v_antiga.owner_id, coalesce(p_closer_id, v_antiga.closer_id),
    v_antiga.title, p_scheduled_at, p_scheduled_at + make_interval(mins => v_dur), v_dur,
    v_antiga.location, v_antiga.meeting_link,
    case when v_antiga.notes is null or v_antiga.notes = '' then v_rastro
         else v_rastro || E'\n' || v_antiga.notes end,
    'agendada', v_antiga.lead_name, v_antiga.scheduled_by,
    coalesce(p_closer_nome, v_antiga.meeting_owner),
    v_antiga.client_email, v_antiga.booking_date,
    v_antiga.calendar_event_id, v_antiga.calendar_html_link, v_antiga.id
  )
  returning * into v_nova;

  return v_nova;
end;
$$;

comment on function qs_reagendar_reuniao is
  'Reagenda em UMA transação: marca a reunião como reagendada e cria a nova com reagendado_de. Erro 23P01 = horário ocupado (nada muda).';

-- O PostgREST só expõe o que tem permissão explícita.
grant execute on function qs_reagendar_reuniao(uuid, timestamptz, integer, uuid, text, text) to authenticated;

-- ── Reunião realizada: quando aconteceu ─────────────────────────────────────
-- Preenche `realizada_em` sozinho quando o status vira 'realizada', pra métrica
-- não depender de nenhuma tela lembrar de gravar. Se a tela mandar a data
-- explicitamente (registro retroativo), a dela vence.
create or replace function qs_meetings_marca_realizada()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'realizada' and new.realizada_em is null then
    new.realizada_em := coalesce(old.realizada_em, now());
  end if;
  -- Voltou atrás (corrigiu um clique errado): a data sai junto, senão fica um
  -- "realizada em" preso numa reunião que não foi realizada.
  if new.status <> 'realizada' and old.status = 'realizada' then
    new.realizada_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_meetings_realizada on qs_meetings;
create trigger trg_qs_meetings_realizada
  before update on qs_meetings
  for each row
  when (old.status is distinct from new.status)
  execute function qs_meetings_marca_realizada();


-- ###########################################################################
-- PASSO 4/5 — Liga os closers cadastrados às reuniões que já existem
-- fonte: supabase/migrations/0034_ativar_closers.sql
-- ###########################################################################

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


-- ###########################################################################
-- PASSO 5/5 — Tira do funil o histórico inservível (arquiva antes)
-- fonte: supabase/migrations/0035_recomeco_agenda.sql
-- ###########################################################################

-- =============================================================================
-- 0035 — Recomeço da agenda: tira do funil o histórico inservível
-- =============================================================================
-- Autorizada pelo Bruno em 04/08/2026. LEIA ANTES DE COLAR.
--
-- POR QUE. Das 98 reuniões do banco, 25 têm data IMPOSSÍVEL (anos 1110, 1424,
-- 2920, 5525, 6565…) e 30% caem fora de qualquer horário comercial (03:52,
-- 23:51). Foram digitadas à mão, sem trava nenhuma, e o resultado é que o funil
-- não fecha: reunião marcada para o ano 5525 é ETERNAMENTE futura — nunca vence,
-- nunca vira no-show, nunca entra no contador de "sem desfecho". Fica parada
-- como `agendada` para sempre. É por isso que o painel mostra 88 agendadas e
-- ZERO realizadas.
--
-- É o `dt_inicio_medicao` que o próprio briefing pede: registro anterior à
-- virada tem SAL nulo por AUSÊNCIA DE PROCESSO, não por recusa, e misturar os
-- dois faz a taxa de aceite histórica aparecer em 0% para sempre.
--
-- O QUE FICA ATIVO: reunião do mês corrente em diante, dentro de um ano — as 9
-- reais de Bruno Matheus e Talita Carvalho, entre 03 e 10/08/2026.
-- O QUE SAI DO FUNIL: 88 linhas.
--
-- COMO SAI, e esta é a parte importante: as linhas são COPIADAS para
-- `qs_meetings_arquivo` e depois removidas de `qs_meetings`. Nada é perdido — o
-- arquivo guarda a linha inteira, e o gatilho de auditoria (0009) registra cada
-- remoção por cima disso. A consulta de restauração está no fim do arquivo.
--
-- Idempotente: rodar de novo não mexe no que ficou nem duplica o arquivo.
-- Depende da 0032 (colunas novas) e da 0009 (auditoria).
-- =============================================================================

-- ── (1) O arquivo — a rede de segurança, criada ANTES de qualquer remoção ────
create table if not exists qs_meetings_arquivo (like qs_meetings including defaults);

alter table qs_meetings_arquivo add column if not exists arquivado_em  timestamptz not null default now();
alter table qs_meetings_arquivo add column if not exists arquivado_por text;

-- Se o arquivo foi criado numa execução ANTERIOR à 0031/0032, ele nasceu sem as
-- colunas novas — e aí o `insert ... select m.*` abaixo quebraria por diferença
-- de forma. Alinha antes, em vez de descobrir no meio da cópia.
alter table qs_meetings_arquivo add column if not exists sal_motivo         text;
alter table qs_meetings_arquivo add column if not exists realizada_em       timestamptz;
alter table qs_meetings_arquivo add column if not exists reagendado_de      uuid;
alter table qs_meetings_arquivo add column if not exists calendar_event_id  text;
alter table qs_meetings_arquivo add column if not exists calendar_html_link text;
alter table qs_meetings_arquivo add column if not exists calendar_error     text;

-- Histórico, não operação: só a gestão lê.
alter table qs_meetings_arquivo enable row level security;
do $$
begin
  create policy qs_meetings_arquivo_leitura on qs_meetings_arquivo
    for select using (qs_is_manager());
exception
  when duplicate_object then null;
end $$;

-- ── (2) A janela do que continua ativo ──────────────────────────────────────
-- Mês corrente em diante, até um ano à frente. O teto de um ano é o que barra o
-- lixo que "parece futuro": havia uma reunião em 23/01/2030 01:12 que passaria
-- por qualquer filtro de "é futura" e seguiria sujando a métrica.
create or replace function qs_meeting_no_periodo(p_quando timestamptz)
returns boolean
language sql
stable
as $$
  select p_quando >= date_trunc('month', now())
     and p_quando <  now() + interval '1 year';
$$;

do $$
declare
  n_arquivadas int;
  n_tarefas    int;
  n_removidas  int;
  colunas      text;   -- "a, b, c"
  colunas_m    text;   -- "m.a, m.b, m.c"
begin
  -- (a) COPIA primeiro. Se algo falhar daqui pra frente, o arquivo já existe.
  --
  -- A lista de colunas é montada na hora, pelo NOME, a partir do que as duas
  -- tabelas têm em comum. `select m.*` seria mais curto e traiçoeiro: ele casa
  -- por POSIÇÃO, e basta o arquivo ter sido criado numa execução anterior (com
  -- as colunas novas entrando no fim, em outra ordem) pra gravar cada valor na
  -- coluna errada — silenciosamente, quando os tipos batem. Em migration que
  -- apaga dado, não dá pra depender de ordem de coluna.
  select string_agg(quote_ident(c.column_name),        ', ' order by c.ordinal_position),
         string_agg('m.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into colunas, colunas_m
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = 'qs_meetings'
     and exists (
       select 1 from information_schema.columns a
        where a.table_schema = 'public'
          and a.table_name   = 'qs_meetings_arquivo'
          and a.column_name  = c.column_name
     );

  execute format(
    'insert into qs_meetings_arquivo (%s, arquivado_em, arquivado_por)
     select %s, now(), %L
       from qs_meetings m
      where not qs_meeting_no_periodo(m.scheduled_at)
        and not exists (select 1 from qs_meetings_arquivo a where a.id = m.id)',
    colunas, colunas_m, 'migration 0035'
  );
  get diagnostics n_arquivadas = row_count;

  -- (b) Encerra as tarefas de CONFIRMAÇÃO dessas reuniões. Sem isto sobram 25
  --     tarefas abertas na fila do SDR mandando confirmar reunião que não existe
  --     mais: ele abre, não entende, e não tem o que fazer.
  update qs_tasks t
     set status = 'ignorada',
         skip_reason = 'Reunião retirada do funil na limpeza da agenda (0035)'
   where t.status in ('pendente', 'atrasada')
     and exists (
       select 1
         from qs_meetings_arquivo a
        where t.tags @> array['meeting:' || a.id::text]
     );
  get diagnostics n_tarefas = row_count;

  -- (c) Só agora sai da tabela ativa.
  delete from qs_meetings m
   where not qs_meeting_no_periodo(m.scheduled_at);
  get diagnostics n_removidas = row_count;

  raise notice '[0035] arquivadas: % | tarefas encerradas: % | retiradas do funil: %',
    n_arquivadas, n_tarefas, n_removidas;
  raise notice '[0035] reuniões ativas agora: %', (select count(*) from qs_meetings);
end $$;

-- ── (3) Fecha a porta por onde o lixo entrou ────────────────────────────────
-- Limpar sem isto é varrer para debaixo do tapete: em um mês o banco volta a ter
-- reunião no ano 5525. Folga generosa de propósito (2020–2100) — a intenção é
-- barrar digitação absurda, não limitar o negócio.
do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_data_plausivel
    check (scheduled_at > timestamptz '2020-01-01' and scheduled_at < timestamptz '2100-01-01')
    not valid;   -- não reprova o que já existe; vale para todo novo INSERT/UPDATE
  raise notice '[0035] CHECK de data plausível aplicado';
exception
  when duplicate_object then raise notice '[0035] CHECK de data plausível já existia';
end $$;

-- ── COMO DESFAZER ──────────────────────────────────────────────────────────
-- Ver o que foi arquivado:
--
--   select id, scheduled_at, meeting_owner, lead_name, status
--     from qs_meetings_arquivo
--    order by scheduled_at;
--
-- Trazer UMA reunião de volta (o CHECK do passo 3 barra data absurda, então só
-- volta o que tem data plausível):
--
--   insert into qs_meetings
--   select a.id, a.lead_id, a.owner_id, a.closer_id, a.title, a.scheduled_at,
--          a.ends_at, a.duration_min, a.location, a.meeting_link, a.notes,
--          a.status, a.lead_name, a.scheduled_by, a.meeting_owner, a.client_email,
--          a.booking_date, a.created_at, a.updated_at
--     from qs_meetings_arquivo a
--    where a.id = 'COLE-O-UUID-AQUI';
--   -- (confira as colunas com \d qs_meetings antes; a lista acima é a da 0027)

commit;
