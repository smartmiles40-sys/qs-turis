-- =============================================================================
-- 0003 — Distribuição automática (round-robin por menor carga) ao inserir lead.
-- Útil quando os leads entram DIRETO no Supabase (ex.: n8n gravando em qs_leads),
-- sem passar pelo webhook /api/lead-inbound. Todo lead inserido SEM responsável
-- (owner_id nulo) é atribuído ao SDR ativo com menos leads em aberto.
--
-- Seguro: só age quando owner_id é nulo (não sobrescreve quem você já definiu),
-- e não mexe em tarefas (não conflita com a geração de tarefas do app/webhook).
-- =============================================================================

create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
as $$
declare chosen uuid;
begin
  if new.owner_id is null then
    select u.id into chosen
    from qs_users u
    left join (
      select owner_id, count(*) as c
      from qs_leads
      where status in ('nao_iniciado', 'em_prospeccao') and owner_id is not null
      group by owner_id
    ) l on l.owner_id = u.id
    where u.role = 'sdr' and u.is_active = true
    order by coalesce(l.c, 0) asc, u.created_at asc
    limit 1;

    if chosen is not null then
      new.owner_id := chosen;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();
