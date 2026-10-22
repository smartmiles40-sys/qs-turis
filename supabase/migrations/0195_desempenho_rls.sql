-- 0195_desempenho_rls.sql
-- -----------------------------------------------------------------------------
-- DESEMPENHO (Bruno, 22/10/2026: "ficou muito pesado, a navegação está pesada").
--
-- MEDIDO no pg_stat_statements (desde 28/09):
--   • qs_lead_note_counts (selo "📝 N obs." do Painel do SDR): 41.458 chamadas,
--     3,2 s em média, até 8 s — sozinha somou 37 horas de banco ocupado.
--   • qs_leads por dono: 41.950 chamadas, 427 ms; qs_wa_threads + lead: 2,2 s.
-- O Painel de cada SDR repete isso a cada 60 s e a cada tarefa concluída de
-- QUALQUER pessoa (realtime) — com o banco ocupado, TODA tela fica lenta.
--
-- CAUSA: as regras de acesso (RLS) chamam qs_is_manager(), auth.uid(),
-- rel_tem_acesso()... "soltas". O Postgres então roda a função UMA VEZ POR
-- LINHA (5 mil leads × 45 mil observações). Embrulhada em (SELECT f()), ela
-- vira "initPlan": roda UMA VEZ POR CONSULTA. É o aviso auth_rls_initplan do
-- Supabase (51 ocorrências) — e o mesmo vale pras nossas funções de papel.
--
-- O QUE MUDA: só a FORMA da regra. Quem vê o quê continua idêntico — as
-- funções embrulhadas são todas STABLE e sem argumento (dão o mesmo resultado
-- a consulta inteira). Funções com argumento da linha (ex.: closer_pode_mexer
-- (closer_id)) NÃO são tocadas.
--
-- Idempotente: regra já embrulhada não é embrulhada de novo.
-- -----------------------------------------------------------------------------

do $$
declare
  p        record;
  fns      text := '(?:auth\.uid|auth\.role|auth\.jwt|qs_is_manager|qs_is_closer|qs_is_espectador|qs_is_active_user'
                   '|rel_tem_acesso|rel_pode_configurar|fin_tem_acesso|fin_pode_configurar|ops_tem_acesso'
                   '|ops_pode_configurar|exp_tem_acesso|exp_eh_admin|is_readonly|wa_atende)\(\)';
  -- não embrulha o que já está dentro de "SELECT f()" e não pega pedaço de outro nome
  padrao   text;
  nova_q   text;
  nova_c   text;
  mudou    int := 0;
begin
  padrao := '(?<!SELECT )(?<![A-Za-z0-9_.])(' || fns || ')';
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    nova_q := case when p.qual is null then null else regexp_replace(p.qual, padrao, '(SELECT \1)', 'g') end;
    nova_c := case when p.with_check is null then null else regexp_replace(p.with_check, padrao, '(SELECT \1)', 'g') end;
    if nova_q is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, nova_q);
    end if;
    if nova_c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, nova_c);
    end if;
    if nova_q is distinct from p.qual or nova_c is distinct from p.with_check then mudou := mudou + 1; end if;
  end loop;
  raise notice '[0195] regras de acesso reescritas: %', mudou;
end $$;

-- A regra de leitura de qs_leads olha "o SDR tem reunião desse lead?" linha a
-- linha (EXISTS em qs_meetings por lead_id + owner_id): índice pra isso.
create index if not exists idx_qs_meetings_lead_owner on qs_meetings (lead_id, owner_id);

-- Fila do SDR: leads do dono, paginados por id (fetchQueueLeads).
create index if not exists idx_qs_leads_owner_id on qs_leads (owner_id, id);

-- Selo "📝 N obs." só dos leads que estão NA TELA (o Painel passa os ids),
-- em vez de agregar as 45 mil observações da base a cada minuto.
create or replace function qs_note_counts_por_leads(p_leads uuid[])
returns table (lead_id uuid, total int)
language sql stable security invoker set search_path = public as $$
  select n.lead_id, count(*)::int
    from qs_notes n
   where n.lead_id = any(p_leads)
   group by n.lead_id;
$$;
revoke all on function qs_note_counts_por_leads(uuid[]) from public, anon;
grant execute on function qs_note_counts_por_leads(uuid[]) to authenticated;
