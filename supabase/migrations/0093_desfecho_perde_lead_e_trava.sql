-- 0093 — O desfecho da reunião que perde o lead, e a trava contra apagar desfecho.
-- -----------------------------------------------------------------------------
-- 1. "NÃO É SAL" E DESISTÊNCIA LANÇADOS PELO SDR NÃO PERDIAM O LEAD (25/09).
--    marcarLeadPerdido rodava com a sessão de quem clicou; quando o SDR que
--    agendou lança o desfecho, o lead já é do closer, leads_update exige
--    owner_id = auth.uid() e o UPDATE volta 0 linhas. 8 desistências e 6
--    "não é SAL" ficaram com o lead "ganho"/aberto. A permissão passa a ser a
--    da REUNIÃO (mesma de qs_encerrar_confirmacao): gestão, quem agendou ou o
--    especialista.
--
-- 2. PERDA SEM MOTIVO. SAL recusado, desistência e fim de cadência gravavam
--    perdido sem loss_reason_id (559 de 1.394 perdidos em setembro). Ganham
--    motivos próprios.
--
-- 3. "CANCELAR" APAGAVA DESFECHO. Reunião realizada/no-show/desistência podia
--    virar cancelada (10 casos). A 0085 só travou o reagendar. Agora o banco
--    recusa voltar de desfecho pra agendada/confirmada/cancelada/reagendada —
--    exceto gestão (conserto de lançamento errado). Trocar ENTRE desfechos
--    (no-show → realizada) segue livre: é correção legítima.
-- -----------------------------------------------------------------------------

insert into qs_loss_reasons (label, is_predefined, is_archived)
select v.label, true, false
from (values ('Não é SAL'), ('Desistência'), ('Fim de cadência')) as v(label)
where not exists (select 1 from qs_loss_reasons r where r.label = v.label);

create or replace function qs_perder_lead_da_reuniao(
  p_meeting uuid,
  p_motivo_perda text,
  p_motivo_tarefa text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead   uuid;
  v_dono   uuid;
  v_closer uuid;
  v_motivo uuid;
  v_n      integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida — entre de novo no QS.' using errcode = '42501';
  end if;

  select lead_id, owner_id, closer_id into v_lead, v_dono, v_closer
    from qs_meetings where id = p_meeting;
  if not found or v_lead is null then
    raise exception 'Reunião não encontrada.' using errcode = 'P0002';
  end if;

  if not (qs_is_manager() or v_dono = auth.uid() or v_closer = auth.uid()) then
    raise exception 'Esta reunião não é sua.' using errcode = '42501';
  end if;

  select id into v_motivo from qs_loss_reasons where label = p_motivo_perda limit 1;

  update qs_leads
     set status = 'perdido',
         loss_reason_id = coalesce(v_motivo, loss_reason_id)
   where id = v_lead;
  if not found then
    raise exception 'Lead da reunião não encontrado.' using errcode = 'P0002';
  end if;

  -- Todas as atividades abertas do lead, de qualquer dono: lead perdido que
  -- segue cobrando follow-up na fila de alguém é o furo mais antigo do time.
  update qs_tasks
     set status = 'ignorada', skip_reason = p_motivo_tarefa
   where lead_id = v_lead
     and status in ('pendente', 'atrasada');
  get diagnostics v_n = row_count;

  return v_n;
end;
$$;

revoke all on function qs_perder_lead_da_reuniao(uuid, text, text) from public, anon;
grant execute on function qs_perder_lead_da_reuniao(uuid, text, text) to authenticated;

create or replace function qs_meetings_trava_desfecho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('realizada', 'no_show', 'desistencia')
     and new.status in ('agendada', 'confirmada', 'cancelada', 'reagendada')
     and auth.uid() is not null          -- service_role / rotinas do servidor passam
     and not qs_is_manager() then
    raise exception 'Esta reunião já tem desfecho (%). Só a gestão pode desfazer.', old.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_meetings_trava_desfecho on qs_meetings;
create trigger trg_qs_meetings_trava_desfecho
  before update of status on qs_meetings
  for each row execute function qs_meetings_trava_desfecho();
