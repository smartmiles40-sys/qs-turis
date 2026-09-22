-- 0085_desfecho_confiavel.sql
-- -----------------------------------------------------------------------------
-- O DESFECHO TEM QUE CHEGAR NO BITRIX — E A GENTE TEM QUE SABER SE CHEGOU (22/09/2026).
--
-- A revisão de 22/09 cruzou 112 desfechos (desde 01/09) com os 104 cards:
--   • 27 desfechos lançados por SDR foram recusados pelo /api/bitrix-sync e
--     ninguém soube — o envio automático não deixava rastro nenhum no QS;
--   • a desistência nunca chegou à coluna "Cancelamento/Desistência" (12 de 12),
--     e o campo "motivo da desistência" do card nunca foi preenchido;
--   • 3 reuniões com desfecho foram REAGENDADAS depois, e o desfecho ficou
--     preso na linha antiga (status 'reagendada', SAL e valor escondidos).
--
-- Esta migration:
--   1. `desistencia_motivo` — o motivo que o closer informa (vai pro card);
--   2. `desfecho_erro` — o último erro do envio do desfecho. Com
--      `desfecho_enviado_em` (0079) forma o estado: enviado / falhou / pendente;
--   3. `qs_reagendar_reuniao` recusa reunião que já tem desfecho.
-- -----------------------------------------------------------------------------

alter table public.qs_meetings add column if not exists desistencia_motivo text;
alter table public.qs_meetings add column if not exists desfecho_erro text;

comment on column public.qs_meetings.desistencia_motivo is
  'Motivo informado pelo closer ao registrar a desistência. Vai pro campo "motivo da desistência" do card (0085).';
comment on column public.qs_meetings.desfecho_erro is
  'Último erro ao enviar o desfecho pro Bitrix. Nulo + desfecho_enviado_em preenchido = chegou (0085).';

-- ── Reagendar só reunião que ainda não aconteceu ────────────────────────────
-- Igual à 0033, com UMA trava a mais: realizada / no-show / desistência já têm
-- desfecho. Reagendar uma delas escondia o desfecho na linha antiga (virava
-- 'reagendada') e zerava o realizada_em. O próximo encontro com esse cliente é
-- uma reunião NOVA (de retomada), não a mesma reunião em outro horário.
create or replace function public.qs_reagendar_reuniao(
  p_meeting_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min integer default null,
  p_closer_id uuid default null,
  p_closer_nome text default null,
  p_por text default null
)
returns qs_meetings
language plpgsql
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

  if v_antiga.status in ('realizada', 'no_show', 'desistencia') then
    raise exception 'esta reunião já tem desfecho — marque uma reunião nova (de retomada) em vez de reagendar'
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
