-- 0055_sdr_ve_o_lead_que_agendou.sql
-- =============================================================================
-- O SDR continua enxergando o lead que ELE agendou.
--
-- O QUE ACONTECIA (relatado pelo Victor Hugo em 19/08/2026, provado no banco).
-- Ele agenda uma reunião → o lead é transferido pro closer → e no mesmo segundo
-- ele PERDE o acesso de leitura ao lead, porque a `leads_select` só deixa
-- passar gestor, closer ou dono. A reunião continua visível (a policy de
-- reuniões é aberta), mas o lead some. Medido na sessão dele:
--
--     vê a reunião da Ina .... SIM
--     vê o LEAD da Ina ....... NÃO
--     reuniões dele nos últimos 10 dias com o lead invisível .... 19
--
-- Da cadeira dele isso é indistinguível de "o agendamento não foi registrado" —
-- e foi exatamente essa a reclamação. Um SDR que não consegue reabrir o lead
-- que acabou de converter também não consegue conferir o que combinou com o
-- cliente, nem responder ao closer quando ele pergunta.
--
-- A REGRA NOVA: quem marcou a reunião continua vendo o lead dela.
-- Não é um furo no isolamento — é o mesmo princípio que já vale pro closer
-- (0052): quem trabalha o lead, lê o lead. O SDR não ganha nada além disso;
-- escrita, tarefa e nota seguem governadas pelas policies delas.
--
-- PARTINDO DA POLICY VIGENTE (não da 0007): hoje `leads_select` é
--     qs_is_manager() OR qs_is_closer() OR owner_id = auth.uid()
-- e a linha nova é aditiva — ninguém perde acesso.
-- =============================================================================

-- O índice vem ANTES da policy de propósito: sem ele, cada linha de qs_leads
-- avaliada dispara uma varredura em qs_meetings. Com 1.700 leads e 26 mil
-- tarefas, a lista de leads ficaria lenta pra todo mundo.
create index if not exists idx_qs_meetings_owner_lead
  on qs_meetings(owner_id, lead_id);

drop policy if exists leads_select on qs_leads;

create policy leads_select on qs_leads
for select using (
  qs_is_manager()
  or qs_is_closer()
  or owner_id = auth.uid()
  -- NOVO (0055): quem agendou a reunião continua enxergando o lead, mesmo
  -- depois de o atendimento passar pro especialista.
  or exists (
    select 1 from qs_meetings m
     where m.lead_id = qs_leads.id
       and m.owner_id = auth.uid()
  )
);

-- =============================================================================
-- Conferência depois de aplicar (simulando a sessão do SDR):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid do SDR>","role":"authenticated"}';
--   select count(*) from qs_leads;   -- tem que subir
--   rollback;
-- =============================================================================
