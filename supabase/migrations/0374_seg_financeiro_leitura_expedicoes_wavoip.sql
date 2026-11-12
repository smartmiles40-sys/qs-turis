-- supabase/migrations/0374_seg_financeiro_leitura_expedicoes_wavoip.sql
-- -----------------------------------------------------------------------------
-- SEGURANÇA (revisão de 12/11/2026). Partindo do VIGENTE (pg_policies /
-- pg_get_functiondef lidos em 12/11). Idempotente.
--
-- 1) EXPEDIÇÕES: Financeiro passa a SÓ LER.
--    Hoje exp_tem_acesso() = (tem linha em `usuarios`) ou setor operacional ou
--    relacionamento ou FINANCEIRO, e ela é usada tanto no exp_ler (SELECT) quanto
--    no exp_escrever (ALL) de ~27 tabelas (expedicoes, passageiros, pagamentos,
--    custos, quartos, roteiro_*…). Ou seja: quem é só do Financeiro gravava em
--    passageiros/pagamentos direto pela API.
--    O que o Financeiro usa de verdade (conferido em src/fin/**): nenhuma escrita
--    direta nessas tabelas — só views (fin_contas_receber_v e fin_pagamentos_v,
--    security_invoker → precisam do exp_ler, que NÃO muda) e RPCs fin_* que são
--    SECURITY DEFINER (fin_parcela_baixa, fin_mudar, fin_enviar… → não passam
--    pela RLS). Quem é só do Financeiro cai no FinApp (App.tsx) e não abre o
--    módulo de Expedições (Ops/Rel). Em 12/11 nenhum usuário do Financeiro tem
--    linha em `usuarios`.
--    → exp_pode_escrever() = linha em `usuarios` com papel ≠ 'leitura', ou
--      setor operacional, ou relacionamento (admin passa pelo qs_do_setor).
--      Troca SÓ o USING/WITH CHECK das policies exp_escrever (e o exp_inserir do
--      audit_log); exp_ler continua com exp_tem_acesso().
--    Por que papel ≠ 'leitura': a policy exp_criar de `usuarios` deixa qualquer
--    um com exp_tem_acesso() criar a PRÓPRIA linha como 'leitura' — sem esse
--    filtro, o Financeiro se daria escrita de volta criando essa linha. Hoje a
--    única linha 'leitura' é de uma pessoa do Operacional (que já escreve pelo
--    setor), então nada muda pra ela.
--    NÃO mexe (fica como proposta): storage.objects exp_arquivos_* (usa
--    exp_tem_acesso() and not is_readonly(), e is_readonly() considera o
--    Financeiro editor) — mudar o bucket exige decidir junto com o is_readonly.
--
-- 2) wavoip_token legível por qualquer logado (policy "qs_settings read" só
--    escondia chatapp_token e sip_password). O Wavoip saiu em 01/09 (comentários
--    em TasksPanel.tsx ~2392/~3068) e nenhum código lê a chave (grep em src/,
--    api/, desktop/: zero). → entra na lista de chaves escondidas (nas duas
--    policies de leitura). O valor continua no banco: apagar e revogar o token no
--    painel do Wavoip fica pro Bruno (é dado, não estrutura).
--
-- Volta:
--   alter policy exp_escrever on <tabela> using ((select exp_tem_acesso())) with check ((select exp_tem_acesso()));
--   alter policy exp_inserir on audit_log with check ((select exp_tem_acesso()));
--   e recriar as duas policies de qs_settings sem 'wavoip_token'.
-- -----------------------------------------------------------------------------

create or replace function public.exp_pode_escrever()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from usuarios where id = auth.uid() and papel <> 'leitura')
      or qs_do_setor('operacional') or qs_do_setor('relacionamento');
$$;
revoke execute on function public.exp_pode_escrever() from public, anon;
grant execute on function public.exp_pode_escrever() to authenticated, service_role;

-- Toda policy exp_escrever (ALL) que hoje é exatamente exp_tem_acesso() passa a
-- exp_pode_escrever(). Laço pelo catálogo: pega as ~27 tabelas sem listar à mão
-- e não toca em policy que alguém já tenha customizado.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and policyname = 'exp_escrever'
       and cmd = 'ALL'
       and qual ~ '^\(\s*SELECT exp_tem_acesso\(\) AS exp_tem_acesso\)$'
  loop
    execute format(
      'alter policy %I on %I.%I using ((select public.exp_pode_escrever())) with check ((select public.exp_pode_escrever()))',
      r.policyname, r.schemaname, r.tablename);
  end loop;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'exp_inserir') then
    alter policy exp_inserir on public.audit_log with check ((select public.exp_pode_escrever()));
  end if;
end $$;

-- 2) wavoip_token fora da leitura do navegador
alter policy "qs_settings read" on public.qs_settings
  using (((select auth.role()) = 'authenticated') and (key <> all (array['chatapp_token', 'sip_password', 'wavoip_token'])));
alter policy qs_settings_select_espectador on public.qs_settings
  using ((select qs_is_espectador()) and (key <> all (array['chatapp_token', 'sip_password', 'wavoip_token'])));

-- Conferência:
-- select tablename, qual from pg_policies where policyname = 'exp_escrever' and qual not ilike '%exp_pode_escrever%';  -- esperado: 0 linhas
-- select qual from pg_policies where tablename = 'qs_settings' and cmd = 'SELECT';                                     -- com wavoip_token
