-- 0071_closer_ve_historico_completo.sql
-- ---------------------------------------------------------------------------
-- Fecha as duas últimas portas do histórico para o papel CLOSER.
--
-- A 0050 abriu a conversa e a 0052 abriu lead/nota/tarefa, mas duas tabelas
-- ficaram para trás e ninguém notou: o closer recebe o lead no fim do funil e
-- via a conversa inteira SEM as ligações que o SDR fez antes dele e SEM os
-- recibos de envio (inclusive os "falhou"). Metade do histórico, portanto.
--
-- Como sempre: partir da policy VIGENTE (lida do banco em 01/09/2026), nunca
-- da versão original — as duas já tinham sido reescritas depois da 0007.
-- ---------------------------------------------------------------------------

-- ── Ligações ────────────────────────────────────────────────────────────────
-- Vigente: qs_is_manager() OR owner_id = auth.uid() OR owner_id IS NULL
drop policy if exists call_logs_select on qs_call_logs;
create policy call_logs_select on qs_call_logs
  for select
  using (
    qs_is_manager()
    or qs_is_closer()
    or owner_id = auth.uid()
    or owner_id is null
  );

-- ── Log de envios de WhatsApp (recibos, "aberto no dock", falhas) ───────────
-- Vigente: qs_is_manager() OR owner_id = auth.uid()
drop policy if exists wam_select on qs_whatsapp_messages;
create policy wam_select on qs_whatsapp_messages
  for select
  using (
    qs_is_manager()
    or qs_is_closer()
    or owner_id = auth.uid()
  );
