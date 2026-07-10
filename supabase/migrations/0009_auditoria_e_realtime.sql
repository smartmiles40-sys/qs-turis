-- 0009_auditoria_e_realtime.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- (A) TRILHA DE AUDITORIA (P0 da auditoria executiva): registra QUEM alterou/
--     excluiu O QUÊ nas tabelas-chave. "Quem perdeu esse cliente?" passa a ter
--     resposta. Barato agora, impossível de reconstruir depois.
-- (B) REALTIME: coloca qs_tasks e qs_leads na publicação do Supabase Realtime —
--     é o que faz a fila atualizar NA HORA (sem esperar o poll de 60s).
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Requer a 0007 (usa qs_is_manager()).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (A1) Tabela de auditoria ─────────────────────────────────────────────────
create table if not exists qs_audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     uuid,
  action     text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_id   uuid,             -- auth.uid(); null = integração (service_role)
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_qs_audit_table_row on qs_audit_log (table_name, row_id);
create index if not exists idx_qs_audit_created on qs_audit_log (created_at desc);

-- Só gestor lê; ninguém escreve direto (só o trigger, que é security definer).
alter table qs_audit_log enable row level security;
drop policy if exists audit_select on qs_audit_log;
create policy audit_select on qs_audit_log for select to authenticated
  using (qs_is_manager());

-- ── (A2) Função de trigger (genérica) ────────────────────────────────────────
create or replace function qs_audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into qs_audit_log (table_name, row_id, action, actor_id, new_data)
    values (tg_table_name, new.id, 'INSERT', auth.uid(), to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Só registra se algo mudou de verdade (evita ruído de updates vazios).
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into qs_audit_log (table_name, row_id, action, actor_id, old_data, new_data)
      values (tg_table_name, new.id, 'UPDATE', auth.uid(), to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    insert into qs_audit_log (table_name, row_id, action, actor_id, old_data)
    values (tg_table_name, old.id, 'DELETE', auth.uid(), to_jsonb(old));
    return old;
  end if;
end;
$$;

-- ── (A3) Liga o trigger nas tabelas-chave ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'qs_leads','qs_tasks','qs_meetings','qs_notes','qs_goals',
    'qs_users','qs_cadences','qs_cadence_owners'
  ] loop
    execute format('drop trigger if exists trg_audit_%s on %I', t, t);
    execute format(
      'create trigger trg_audit_%s after insert or update or delete on %I
         for each row execute function qs_audit_trigger()', t, t);
  end loop;
end $$;

-- ── (B) Realtime: publica as tabelas da fila ─────────────────────────────────
-- (defensivo: só adiciona se ainda não estiver na publicação)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'qs_tasks'
  ) then
    alter publication supabase_realtime add table qs_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'qs_leads'
  ) then
    alter publication supabase_realtime add table qs_leads;
  end if;
end $$;

-- Realtime de UPDATE/DELETE precisa da imagem completa da linha:
alter table qs_tasks replica identity full;
alter table qs_leads replica identity full;
