-- 0017_bloqueio_usuario_desativado.sql
-- SPRINT 3 — itens A6 e A9 (gestão/sessão de usuários).
--
-- A9 (o grosso): usuário DESATIVADO com sessão viva continuava lendo e
-- gravando tudo — a desativação só barrava o PRÓXIMO login. O front agora
-- re-checa o is_active e desloga sozinho (QsAuthContext), mas isso é só
-- cliente: o token JWT continua válido e falaria com o banco por fora do app.
-- Aqui entra a trava REAL: uma policy RESTRITIVA em todas as tabelas qs_*
-- exige perfil ativo para qualquer acesso autenticado. Restritiva = soma às
-- policies existentes com AND; não afrouxa nada do que a 0007+ já fecha.
--
-- A6 (cinto e suspensório): impede no BANCO a autodesativação — o admin que
-- se desativasse ficava trancado pra fora (só se salvava editando o banco na
-- mão). O front (SettingsPage) e a rota /api/admin-user também bloqueiam.
--
-- Não afeta: service_role (rotas /api e n8n ignoram RLS) e anon (policies
-- são "to authenticated"). Idempotente: rodar 2x não quebra.
--
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New query
--    → cole este arquivo INTEIRO → Run.

-- ── Helper: o usuário logado tem perfil ATIVO? ───────────────────────────────
-- SECURITY DEFINER evita recursão de RLS ao consultar qs_users de dentro
-- de uma policy de qs_users (mesmo padrão do qs_is_manager da 0007).
create or replace function qs_is_active_user()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from qs_users
    where id = auth.uid() and is_active
  );
$$;

-- ── (1) A9: desativado perde acesso a TODAS as tabelas qs_* na hora ──────────
-- Loop dinâmico: pega qualquer tabela qs_* existente (inclusive as criadas
-- depois da 0007, ex.: qs_settings, qs_sip_lines), sem quebrar se faltar uma.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'qs\_%' escape '\'
  loop
    execute format('drop policy if exists %I on %I', 'ativo_' || t, t);
    execute format(
      'create policy %I on %I as restrictive for all to authenticated using (qs_is_active_user()) with check (qs_is_active_user())',
      'ativo_' || t, t
    );
  end loop;
end $$;

-- ── (2) A6: ninguém se desativa via update direto em qs_users ────────────────
-- Recria a users_write da 0007 com um WITH CHECK a mais: na PRÓPRIA linha,
-- is_active tem de continuar true. (O papel não é travado aqui porque o
-- gestor também escreve nesta tabela e o papel dele não é 'admin' — a trava
-- de rebaixar o próprio papel fica na UI + rota /api/admin-user.)
drop policy if exists users_write on qs_users;
create policy users_write on qs_users for all to authenticated
  using (qs_is_manager())
  with check (qs_is_manager() and (id <> auth.uid() or is_active));

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Deve listar uma policy "ativo_<tabela>" (RESTRICTIVE) por tabela qs_* e a
-- users_write nova em qs_users.
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public' and (policyname like 'ativo\_%' escape '\' or policyname = 'users_write')
order by tablename, policyname;
