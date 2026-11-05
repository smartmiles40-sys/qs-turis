-- 0311_temperatura_sdr.sql
-- -----------------------------------------------------------------------------
-- TEMPERATURA DO SDR (05/11/2026, Bruno): "2 tipos de temperatura! Uma que vai
-- ser a normal e outra que o SDR vai colocar, assim o closer consegue entender
-- quais são as maiores prioridades para falar com aquele lead".
--
-- A normal continua em qs_leads.lead_score (vem do Bitrix). A do SDR é a leitura
-- de quem conversou com o cliente, e é OBRIGATÓRIA ao agendar a 1ª reunião.
--
--  * qs_leads.temperatura_sdr     → a atual (o SDR pode mudar depois, na ficha)
--  * qs_meetings.temperatura_sdr  → a foto do momento do agendamento. É ela que
--    entra nas métricas (conversão por temperatura do SDR) e no card da agenda
--    do closer, sem precisar ler o lead.
--
-- Só adiciona colunas (nullable). Nada de dado muda.
-- Volta:
--   alter table qs_meetings drop column if exists temperatura_sdr;
--   alter table qs_leads drop column if exists temperatura_sdr,
--     drop column if exists temperatura_sdr_em, drop column if exists temperatura_sdr_por;
-- -----------------------------------------------------------------------------

alter table qs_leads
  add column if not exists temperatura_sdr text
    check (temperatura_sdr in ('quente', 'morno', 'frio')),
  add column if not exists temperatura_sdr_em timestamptz,
  add column if not exists temperatura_sdr_por uuid references qs_users(id) on delete set null;

alter table qs_meetings
  add column if not exists temperatura_sdr text
    check (temperatura_sdr in ('quente', 'morno', 'frio'));

comment on column qs_leads.temperatura_sdr is
  'Temperatura dada pelo SDR (quente/morno/frio). A "normal" segue em lead_score (Bitrix).';
comment on column qs_meetings.temperatura_sdr is
  'Temperatura do SDR no momento do agendamento (foto; não muda se a do lead mudar).';

-- Reagendamento (qs_reagendar_reuniao, 0033) cria uma linha NOVA. Ela herda a
-- temperatura da reunião que substitui — senão o card do closer perdia o chip
-- a cada remarcação. Trigger em vez de mexer na função: a 0033 fica intacta.
create or replace function qs_meeting_herda_temperatura()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reagendado_de is not null and new.temperatura_sdr is null then
    select m.temperatura_sdr into new.temperatura_sdr
      from qs_meetings m where m.id = new.reagendado_de;
  end if;
  return new;
end $$;

drop trigger if exists trg_qs_meeting_herda_temperatura on qs_meetings;
create trigger trg_qs_meeting_herda_temperatura
  before insert on qs_meetings
  for each row execute function qs_meeting_herda_temperatura();

-- Volta (trigger):
--   drop trigger if exists trg_qs_meeting_herda_temperatura on qs_meetings;
--   drop function if exists qs_meeting_herda_temperatura();
