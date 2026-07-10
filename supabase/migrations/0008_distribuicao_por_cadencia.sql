-- 0008_distribuicao_por_cadencia.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- DISTRIBUIÇÃO POR CADÊNCIA (pedido do Bruno):
--   • Lead entra → vai pra um SDR ATRIBUÍDO ÀQUELA CADÊNCIA (round-robin, carga
--     igual DENTRO da cadência). Fallback: cadência sem SDR → global por carga.
--   • Atômico: dois leads entrando ao mesmo tempo NUNCA caem no mesmo SDR
--     (advisory lock por cadência serializa a escolha).
--   • Nunca 2 SDRs no mesmo lead: lead tem 1 dono; e lead SEM dono deixa de ser
--     visível a todos os SDRs (só o gestor vê) — fecha o vazamento da 0007.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. As rotas /api (service_role) não são afetadas pela RLS.
--    Requer a 0007 já aplicada (usa qs_is_manager()).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (1) Gatilho de atribuição: por cadência, com fallback global ─────────────
create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
as $$
declare chosen uuid;
begin
  -- Respeita um dono já definido explicitamente (ex.: transferência manual).
  if new.owner_id is not null then
    return new;
  end if;

  -- ── Caso 1: cadência COM SDRs atribuídos → round-robin POR CADÊNCIA ──
  if new.cadence_id is not null then
    -- Serializa as atribuições DESTA cadência: enquanto um lead escolhe o SDR,
    -- outro concorrente espera — então a contagem é sempre fresca e não duplica.
    perform pg_advisory_xact_lock(hashtext('qs_assign_' || new.cadence_id::text));

    select co.user_id into chosen
    from qs_cadence_owners co
    join qs_users u on u.id = co.user_id
    -- carga DENTRO desta cadência (equilibra a cadência entre os SDRs dela)
    left join (
      select owner_id, count(*) c from qs_leads
      where cadence_id = new.cadence_id
        and status in ('nao_iniciado','em_prospeccao') and owner_id is not null
      group by owner_id
    ) lc on lc.owner_id = co.user_id
    -- desempate: carga global (não afoga um SDR que já está cheio em outra cadência)
    left join (
      select owner_id, count(*) c from qs_leads
      where status in ('nao_iniciado','em_prospeccao') and owner_id is not null
      group by owner_id
    ) lg on lg.owner_id = co.user_id
    where co.cadence_id = new.cadence_id
      and u.role = 'sdr' and u.is_active = true
    order by coalesce(lc.c,0) asc, coalesce(lg.c,0) asc, u.created_at asc
    limit 1;

    if chosen is not null then
      new.owner_id := chosen;
      return new;
    end if;
    -- Cadência sem nenhum SDR ativo atribuído → cai no fallback global abaixo.
  end if;

  -- ── Caso 2 (fallback): global por menor carga entre todos os SDRs ──
  perform pg_advisory_xact_lock(hashtext('qs_assign_global'));
  select u.id into chosen
  from qs_users u
  left join (
    select owner_id, count(*) c from qs_leads
    where status in ('nao_iniciado','em_prospeccao') and owner_id is not null
    group by owner_id
  ) l on l.owner_id = u.id
  where u.role = 'sdr' and u.is_active = true
  order by coalesce(l.c,0) asc, u.created_at asc
  limit 1;

  if chosen is not null then
    new.owner_id := chosen;
  end if;
  return new;
end;
$$;

-- (o trigger trg_qs_assign_owner da 0003 continua válido — só a função mudou)
drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();

-- ── (2) Fecha o vazamento: lead SEM dono NÃO é visível a todos os SDRs ───────
-- (antes: "owner_id is null" deixava órfão visível a qualquer autenticado →
--  na vitrine do realtime, 2 SDRs veriam o mesmo. Agora: órfão só o gestor vê.)

drop policy if exists leads_select on qs_leads;
create policy leads_select on qs_leads for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

drop policy if exists tasks_select on qs_tasks;
create policy tasks_select on qs_tasks for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

drop policy if exists meetings_select on qs_meetings;
create policy meetings_select on qs_meetings for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

drop policy if exists wam_select on qs_whatsapp_messages;
create policy wam_select on qs_whatsapp_messages for select to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- Notas e valores custom: seguem o dono do LEAD (sem o "or l.owner_id is null").
drop policy if exists notes_select on qs_notes;
create policy notes_select on qs_notes for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );

drop policy if exists lcv_select on qs_lead_custom_values;
create policy lcv_select on qs_lead_custom_values for select to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id and l.owner_id = auth.uid())
  );

-- As policies de UPDATE/INSERT/DELETE da 0007 (que tinham "or owner_id is null")
-- também são apertadas, senão um SDR poderia editar/pegar órfão sem ser via a
-- vitrine atômica (que virá no realtime).
drop policy if exists leads_update on qs_leads;
create policy leads_update on qs_leads for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);

drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);

drop policy if exists meetings_update on qs_meetings;
create policy meetings_update on qs_meetings for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);
