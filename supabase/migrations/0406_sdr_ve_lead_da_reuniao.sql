-- 0406 — SDR continua vendo o lead depois de marcar a reunião (Bruno, 18/11).
-- Quando a reunião é marcada o lead passa pro closer (owner_id = closer), e o SDR
-- perdia as anotações e as respostas do formulário da ficha. A leads_select já
-- liberava o lead por qs_meetings.owner_id; aqui o mesmo para notas e campos.

create or replace function public.qs_marcou_reuniao(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_meetings m
    where m.lead_id = p_lead and m.owner_id = auth.uid()
  );
$$;
revoke all on function public.qs_marcou_reuniao(uuid) from public, anon;
grant execute on function public.qs_marcou_reuniao(uuid) to authenticated;

drop policy if exists notes_select on public.qs_notes;
create policy notes_select on public.qs_notes for select using (
  (select qs_is_espectador()) or (select qs_is_manager()) or (select qs_is_closer())
  or exists (select 1 from qs_leads l where l.id = qs_notes.lead_id and l.owner_id = (select auth.uid()))
  or qs_marcou_reuniao(qs_notes.lead_id)
);

drop policy if exists lcv_select on public.qs_lead_custom_values;
create policy lcv_select on public.qs_lead_custom_values for select using (
  (select qs_is_manager()) or (select qs_is_closer())
  or exists (select 1 from qs_leads l where l.id = qs_lead_custom_values.lead_id and l.owner_id = (select auth.uid()))
  or qs_marcou_reuniao(qs_lead_custom_values.lead_id)
);
