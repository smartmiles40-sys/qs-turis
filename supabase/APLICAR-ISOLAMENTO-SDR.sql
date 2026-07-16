-- =============================================================================
-- APLICAR-ISOLAMENTO-SDR.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- OBJETIVO (pedido do Bruno): NENHUM SDR pode ver o lead do outro. Cada SDR só
-- enxerga e trabalha os PRÓPRIOS leads; admin/gestor veem tudo.
--
-- POR QUE ESTE ARQUIVO EXISTE: o APLICAR-PENDENTES.sql (rodado em 2026-07-06)
-- deixou o RLS PERMISSIVO — política "using (true)", ou seja, qualquer usuário
-- logado lê TODOS os leads. As migrations 0007 (RLS por papéis) e 0008
-- (isolamento por dono) são o que de fato tranca o lead por dono, e vieram
-- DEPOIS, em arquivos separados. Se elas não foram aplicadas, os SDRs continuam
-- vendo o lead uns dos outros (via busca global, tela de cobertura, realtime).
--
-- ESTE ARQUIVO = 0007 + 0008 num só, idempotente. Rodar 2x não quebra.
--
-- ⚠️ COMO USAR (1 minuto):
--    1. https://supabase.com/dashboard  →  projeto do QS (eabfjomrnucymduqnbci)
--    2. SQL Editor  →  New query  →  cole este arquivo INTEIRO  →  Run
--    3. Role até o fim: os SELECTs de VERIFICAÇÃO mostram o estado final.
--       Em qs_leads deve haver as políticas leads_select/insert/update/delete
--       e o "using" do leads_select tem que ser  (qs_is_manager() OR owner_id = auth.uid()).
--
-- ⚠️ As rotas /api (service_role) NÃO são afetadas — service_role ignora RLS.
--    O app já loga por Supabase Auth, então segue funcionando normal.
-- =============================================================================


-- ═══════════════════════ DIAGNÓSTICO (ANTES) ═══════════════════════
-- Veja como está AGORA. Se aparecer uma policy com qual = 'true' em qs_leads,
-- é o vazamento: todo mundo lê tudo.
select 'ANTES' as quando, tablename, policyname, cmd, qual::text
from pg_policies
where schemaname = 'public' and tablename = 'qs_leads'
order by policyname;


-- ═══════════════════════ [0007] RLS POR PAPÉIS ═══════════════════════

-- Helper: o usuário logado é gestor/admin? (SECURITY DEFINER evita recursão de RLS)
create or replace function qs_is_manager()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and role in ('admin','gestor') and is_active
  );
$$;

-- (1) Derruba as policies antigas "libera geral" (0001/0002/APLICAR-PENDENTES)
do $$
declare t text;
begin
  foreach t in array array[
    'qs_users','qs_leads','qs_loss_reasons','qs_notes','qs_tasks',
    'qs_cadences','qs_cadence_days','qs_cadence_activities','qs_cadence_owners',
    'qs_meetings','qs_goals','qs_channel_config','qs_custom_fields',
    'qs_lead_custom_values','qs_handovers','qs_whatsapp_messages','qs_products'
  ] loop
    execute format('drop policy if exists %I on %I', 'app_all_' || t, t);
    execute format('drop policy if exists %I on %I', 'app_auth_' || t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- (2) Dados sensíveis: dono OU gestor.
-- (as policies de SELECT/UPDATE de leads/tasks/meetings são criadas, já apertadas,
--  no bloco [0008] abaixo — aqui só INSERT/DELETE e as tabelas satélite.)
drop policy if exists leads_insert on qs_leads;
create policy leads_insert on qs_leads for insert to authenticated with check (true);
drop policy if exists leads_delete on qs_leads;
create policy leads_delete on qs_leads for delete to authenticated
  using (qs_is_manager());

-- Tarefas
drop policy if exists tasks_insert on qs_tasks;
create policy tasks_insert on qs_tasks for insert to authenticated with check (true);
drop policy if exists tasks_delete on qs_tasks;
create policy tasks_delete on qs_tasks for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- Reuniões
drop policy if exists meetings_insert on qs_meetings;
create policy meetings_insert on qs_meetings for insert to authenticated with check (true);
drop policy if exists meetings_delete on qs_meetings;
create policy meetings_delete on qs_meetings for delete to authenticated
  using (qs_is_manager() or owner_id = auth.uid());

-- Notas (autor pode editar/apagar a própria; leitura segue o dono do lead — apertada na 0008)
drop policy if exists notes_insert on qs_notes;
create policy notes_insert on qs_notes for insert to authenticated with check (true);
drop policy if exists notes_update on qs_notes;
create policy notes_update on qs_notes for update to authenticated
  using (qs_is_manager() or author_id = auth.uid()) with check (true);
drop policy if exists notes_delete on qs_notes;
create policy notes_delete on qs_notes for delete to authenticated
  using (qs_is_manager() or author_id = auth.uid());

-- Valores de campos custom: escrita segue o dono do lead
drop policy if exists lcv_write on qs_lead_custom_values;
create policy lcv_write on qs_lead_custom_values for all to authenticated
  using (
    qs_is_manager()
    or exists (select 1 from qs_leads l where l.id = lead_id
               and (l.owner_id = auth.uid() or l.owner_id is null))
  ) with check (true);

-- Mensagens/ligações de WhatsApp
drop policy if exists wam_insert on qs_whatsapp_messages;
create policy wam_insert on qs_whatsapp_messages for insert to authenticated with check (true);

-- Handovers: quem participa (de/para) ou gestor
drop policy if exists ho_select on qs_handovers;
create policy ho_select on qs_handovers for select to authenticated
  using (qs_is_manager() or from_user_id = auth.uid() or to_user_id = auth.uid());
drop policy if exists ho_insert on qs_handovers;
create policy ho_insert on qs_handovers for insert to authenticated with check (true);

-- (3) Perfis: todos leem (nomes/avatares); só gestor escreve
drop policy if exists users_select on qs_users;
create policy users_select on qs_users for select to authenticated using (true);
drop policy if exists users_write on qs_users;
create policy users_write on qs_users for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());

-- (4) Metas: todos leem (placar); só gestor escreve
drop policy if exists goals_select on qs_goals;
create policy goals_select on qs_goals for select to authenticated using (true);
drop policy if exists goals_write on qs_goals;
create policy goals_write on qs_goals for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());

-- (5) Cadências (e filhas): leitura geral; escrita autenticada (SDR monta cadência hoje)
do $$
declare t text;
begin
  foreach t in array array['qs_cadences','qs_cadence_days','qs_cadence_activities','qs_cadence_owners'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_write', t);
  end loop;
end $$;

-- Motivos de perda: todos leem/criam; gestor edita/arquiva
drop policy if exists lr_select on qs_loss_reasons;
create policy lr_select on qs_loss_reasons for select to authenticated using (true);
drop policy if exists lr_insert on qs_loss_reasons;
create policy lr_insert on qs_loss_reasons for insert to authenticated with check (true);
drop policy if exists lr_update on qs_loss_reasons;
create policy lr_update on qs_loss_reasons for update to authenticated
  using (qs_is_manager()) with check (qs_is_manager());
drop policy if exists lr_delete on qs_loss_reasons;
create policy lr_delete on qs_loss_reasons for delete to authenticated
  using (qs_is_manager());

-- Config de canais / campos custom / produtos: leitura geral, escrita gestor
do $$
declare t text;
begin
  foreach t in array array['qs_channel_config','qs_custom_fields','qs_products'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (qs_is_manager()) with check (qs_is_manager())', t || '_write', t);
  end loop;
end $$;

-- Meta de REUNIÕES (novo tipo em qs_goals)
alter table qs_goals drop constraint if exists qs_goals_type_check;
alter table qs_goals add constraint qs_goals_type_check
  check (type in ('ganhos','leads_finalizados','atividades','conversao','reunioes'));


-- ═══════════════════════ [0008] ISOLAMENTO POR DONO ═══════════════════════
-- Aperta as leituras/escritas: SDR só o que é dele (SEM "or owner_id is null").
-- Lead órfão (sem dono) só o gestor vê — fecha o vazamento da vitrine.

-- (1) Gatilho de atribuição: por cadência (round-robin atômico), fallback global.
--     Garante que TODO lead entra com exatamente 1 dono — nunca 2 SDRs no mesmo.
create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
as $$
declare chosen uuid;
begin
  if new.owner_id is not null then
    return new;  -- respeita dono já definido (ex.: SDR criou o lead pra si)
  end if;

  -- Caso 1: cadência COM SDRs atribuídos → round-robin POR CADÊNCIA
  if new.cadence_id is not null then
    perform pg_advisory_xact_lock(hashtext('qs_assign_' || new.cadence_id::text));

    select co.user_id into chosen
    from qs_cadence_owners co
    join qs_users u on u.id = co.user_id
    left join (
      select owner_id, count(*) c from qs_leads
      where cadence_id = new.cadence_id
        and status in ('nao_iniciado','em_prospeccao') and owner_id is not null
      group by owner_id
    ) lc on lc.owner_id = co.user_id
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
  end if;

  -- Caso 2 (fallback): global por menor carga entre todos os SDRs
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

drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();

-- (2) SELECT: dono OU gestor. SEM "owner_id is null" → órfão só o gestor vê.
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

-- (3) UPDATE: dono OU gestor (aperta o "or owner_id is null" da 0007)
drop policy if exists leads_update on qs_leads;
create policy leads_update on qs_leads for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);

drop policy if exists tasks_update on qs_tasks;
create policy tasks_update on qs_tasks for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);

drop policy if exists meetings_update on qs_meetings;
create policy meetings_update on qs_meetings for update to authenticated
  using (qs_is_manager() or owner_id = auth.uid()) with check (true);


-- ═══════════════════════ VERIFICAÇÃO (DEPOIS) ═══════════════════════
-- (a) Políticas finais das tabelas sensíveis — confira o "using" do *_select.
select 'DEPOIS' as quando, tablename, policyname, cmd, qual::text
from pg_policies
where schemaname = 'public'
  and tablename in ('qs_leads','qs_tasks','qs_meetings','qs_notes',
                    'qs_whatsapp_messages','qs_lead_custom_values')
  and cmd = 'SELECT'
order by tablename, policyname;

-- (b) RLS ligado em todas as tabelas sensíveis? (rls_ligado = true em todas)
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('qs_leads','qs_tasks','qs_meetings','qs_notes','qs_whatsapp_messages',
   'qs_lead_custom_values','qs_handovers','qs_users')
order by c.relname;

-- (c) Saúde da posse: quantos leads ATIVOS estão sem dono? (ideal: 0; se > 0,
--     rode o backfill abaixo pra distribuir os órfãos entre os SDRs.)
select count(*) filter (where owner_id is null) as leads_ativos_sem_dono,
       count(*)                                 as leads_ativos_total
from qs_leads
where status in ('nao_iniciado','em_prospeccao');


-- ═══════════════════════ (OPCIONAL) BACKFILL DE ÓRFÃOS ═══════════════════════
-- Se o item (c) acima acusar leads ativos SEM dono (entraram antes do trigger),
-- descomente e rode UMA vez pra distribuí-los por round-robin entre os SDRs
-- ativos. Sem isso, esses órfãos ficam invisíveis pros SDRs (só o gestor vê).
--
-- with sdrs as (
--   select id, row_number() over (order by created_at) - 1 as rn,
--          count(*) over () as n
--   from qs_users where role = 'sdr' and is_active = true
-- ),
-- orfaos as (
--   select id, row_number() over (order by arrived_at) - 1 as rn
--   from qs_leads
--   where owner_id is null and status in ('nao_iniciado','em_prospeccao')
-- )
-- update qs_leads l set owner_id = s.id
-- from orfaos o join sdrs s on s.rn = (o.rn % s.n)
-- where l.id = o.id;
