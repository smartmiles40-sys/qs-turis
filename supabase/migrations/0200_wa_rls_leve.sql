-- 0200_wa_rls_leve.sql
-- -----------------------------------------------------------------------------
-- WHATSAPP MAIS LEVE PRA SDR (22/10/2026).
--
-- MEDIDO (como SDR, Mariana, no banco de produção, ensaio em DO + RAISE):
--   • select lead_id from qs_wa_threads limit 1000 ....... 934 ms  → 8,9 ms
--   • qs_wa_threads inteira (1.502 visíveis) ............ 1.154 ms → 6,4 ms
--   • qs_wa_messages inteira (14.275 visíveis) .......... 7.868 ms → 19,6 ms
--   Conjunto de linhas visíveis IDÊNTICO (diferença 0) pra 2 SDRs, em threads,
--   mensagens e ligações.
--
-- CAUSA: as regras chamam qs_owns_lead(lead_id) — função com argumento da
-- linha, então roda UMA VEZ POR LINHA (2 EXISTS + 2 consultas em qs_users a
-- cada linha). O índice qs_handovers(lead_id, from_user_id) só tirou ~25%.
--
-- O QUE MUDA: a regra passa a perguntar "o lead está na MINHA lista?" — a
-- lista sai uma vez por consulta (qs_leads_meus(), hashed subplan) e os
-- papéis (gestor/especialista) viram initPlan (SELECT f()).
--
-- QUEM VÊ O QUÊ NÃO MUDA. qs_owns_lead(p) é, hoje (lido do banco, 22/10):
--     qs_is_manager() or qs_is_closer()
--     or exists (lead p com owner_id = auth.uid() or owner_id is null)
--     or exists (handover do lead p com from_user_id = auth.uid())
-- qs_leads_meus() devolve exatamente os leads dos dois EXISTS e é SECURITY
-- DEFINER como qs_owns_lead (não depende da RLS de qs_leads/qs_handovers).
-- Lead nulo: qs_owns_lead(null) = gestor ou especialista; "null in (...)" não
-- passa — sobra gestor/especialista, igual.
--
-- Só as regras de LEITURA são trocadas (as de escrita rodam numa linha só).
-- qs_owns_lead continua existindo (escritas, ho_insert, gloria_sessoes_write).
--
-- SEGURANÇA: o bloco de conferência no começo aborta tudo se alguma regra não
-- estiver mais como foi lida em 22/10 (alguém mexeu → revisar antes).
-- Cada ALTER POLICY pega trava exclusiva rápida na tabela: lock_timeout 5s
-- (se a tabela estiver ocupada, falha em vez de enfileirar o WhatsApp).
-- -----------------------------------------------------------------------------

-- 1) A lista de leads "meus" — mesma regra dos dois EXISTS de qs_owns_lead.
create or replace function public.qs_leads_meus()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id from qs_leads l where l.owner_id = auth.uid() or l.owner_id is null
  union
  select h.lead_id from qs_handovers h where h.from_user_id = auth.uid()
$$;

comment on function public.qs_leads_meus() is
  'Leads que o usuário logado "possui" para a RLS (dono, lead sem dono ou que ele passou adiante). Mesma regra dos EXISTS de qs_owns_lead, mas calculada uma vez por consulta (0200).';

revoke all on function public.qs_leads_meus() from public, anon;
grant execute on function public.qs_leads_meus() to authenticated, service_role;

-- 2) Conferência: as regras ainda estão como foram lidas?
do $$
declare
  esperado constant jsonb := jsonb_build_object(
    'qs_wa_threads.wa_threads_select',            '(qs_owns_lead(lead_id) OR (linha_user_id = ( SELECT auth.uid() AS uid)))',
    'qs_wa_messages.wa_messages_select',          '(( SELECT qs_is_espectador() AS qs_is_espectador) OR ((linha_user_id IS NULL) AND qs_owns_lead(lead_id)) OR (linha_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT qs_is_manager() AS qs_is_manager) OR ( SELECT qs_is_closer() AS qs_is_closer))',
    'qs_wa_calls.wa_calls_leitura',               '((lead_id IS NULL) OR qs_owns_lead(lead_id))',
    'qs_call_permissions.call_perm_leitura',      '((lead_id IS NULL) OR qs_owns_lead(lead_id))',
    'qs_gloria_log.gloria_log_read',              '((lead_id IS NULL) OR qs_owns_lead(lead_id))',
    'qs_gloria_sessoes.gloria_sessoes_read',      'qs_owns_lead(lead_id)',
    'qs_primeiro_contato.primeiro_contato_leitura','qs_owns_lead(lead_id)'
  );
  k text; atual text;
begin
  for k in select jsonb_object_keys(esperado) loop
    select qual into atual from pg_policies
     where schemaname = 'public' and tablename = split_part(k, '.', 1) and policyname = split_part(k, '.', 2);
    if atual is distinct from esperado->>k then
      raise exception '[0200] a regra % mudou desde 22/10 (agora: %). Revisar antes de aplicar.', k, coalesce(atual, '<não existe>');
    end if;
  end loop;
end $$;

-- 3) As regras de leitura, set-based. Uma trava de cada vez.
set lock_timeout = '5s';
alter policy wa_threads_select on public.qs_wa_threads using (
  (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
  or linha_user_id = (select auth.uid())
);

set lock_timeout = '5s';
alter policy wa_messages_select on public.qs_wa_messages using (
  (select qs_is_espectador())
  or (linha_user_id is null and lead_id in (select qs_leads_meus()))
  or linha_user_id = (select auth.uid())
  or (select qs_is_manager()) or (select qs_is_closer())
);

set lock_timeout = '5s';
alter policy wa_calls_leitura on public.qs_wa_calls using (
  lead_id is null
  or (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
);

set lock_timeout = '5s';
alter policy call_perm_leitura on public.qs_call_permissions using (
  lead_id is null
  or (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
);

set lock_timeout = '5s';
alter policy gloria_log_read on public.qs_gloria_log using (
  lead_id is null
  or (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
);

set lock_timeout = '5s';
alter policy gloria_sessoes_read on public.qs_gloria_sessoes using (
  (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
);

set lock_timeout = '5s';
alter policy primeiro_contato_leitura on public.qs_primeiro_contato using (
  (select qs_is_manager()) or (select qs_is_closer())
  or lead_id in (select qs_leads_meus())
);

reset lock_timeout;

-- Pra desfazer: ALTER POLICY de volta com os textos do bloco 2 (conferência).
