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
