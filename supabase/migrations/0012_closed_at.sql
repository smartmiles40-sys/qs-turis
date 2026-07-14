-- 0012_closed_at.sql
-- Data REAL de fechamento do lead (ganho/perdido).
--
-- Problema: dashboard, ranking e metas usavam updated_at como "data do ganho".
-- Qualquer edição posterior no lead (corrigir e-mail, sync do n8n, reativar)
-- atualiza updated_at → um ganho de maio "reaparece" no período atual em todos
-- os gráficos. closed_at só muda na TRANSIÇÃO de status, então a métrica fica
-- estável pra sempre.

alter table qs_leads add column if not exists closed_at timestamptz;

-- Backfill: pra leads já fechados, updated_at é a melhor aproximação histórica.
update qs_leads
   set closed_at = updated_at
 where closed_at is null
   and status in ('ganho', 'perdido');

-- Grava closed_at na transição para ganho/perdido; limpa ao reativar.
create or replace function qs_set_closed_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('ganho', 'perdido') and new.closed_at is null then
      new.closed_at := now();
    end if;
    return new;
  end if;
  if new.status in ('ganho', 'perdido') and (old.status is distinct from new.status) then
    new.closed_at := now();
  elsif new.status not in ('ganho', 'perdido') and old.status in ('ganho', 'perdido') then
    new.closed_at := null; -- lead reativado volta pro funil sem data de fechamento
  end if;
  return new;
end $$;

drop trigger if exists trg_qs_leads_closed_at_upd on qs_leads;
create trigger trg_qs_leads_closed_at_upd
  before update of status on qs_leads
  for each row execute function qs_set_closed_at();

drop trigger if exists trg_qs_leads_closed_at_ins on qs_leads;
create trigger trg_qs_leads_closed_at_ins
  before insert on qs_leads
  for each row execute function qs_set_closed_at();

create index if not exists idx_qs_leads_closed_at on qs_leads (closed_at);
