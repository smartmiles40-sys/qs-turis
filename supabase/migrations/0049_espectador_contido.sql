-- =============================================================================
-- 0049 — O ESPECTADOR (papel marketing) DEIXA DE ENXERGAR SEGREDO
-- -----------------------------------------------------------------------------
-- O loop da 0036 criou `<tabela>_select_espectador using (qs_is_espectador())`
-- em TODA tabela qs_* com RLS — sem exceção. Policies permissivas somam com OR,
-- então essa leitura geral ATROPELA duas restrições que existiam de propósito:
--
--   • qs_sip_lines (0013): SELECT era "só o próprio SDR ou gestor", porque a
--     coluna `password` guarda a senha SIP em TEXTO PURO. Em produção há 5
--     linhas com senha real. Com a 0036, um usuário 'marketing' leria a
--     credencial de telefonia de cada SDR com um GET.
--
--   • qs_settings (0011): a leitura tinha denylist `key not in
--     ('chatapp_token','sip_password')`. A policy do espectador veio sem
--     filtro de key — e `chatapp_token` EXISTE em produção (64 chars).
--
-- Hoje NENHUM usuário tem role='marketing' (conferido em 13/08), então o furo
-- é latente — mas o papel existe exatamente pra ser dado a alguém de campanha,
-- e no dia em que for criado a pessoa lê os dois segredos sem deixar rastro.
--
-- O CONSERTO:
--   1. qs_sip_lines: DROP da policy do espectador. Espectador não liga —
--      não há por que ele ler linha SIP nenhuma, com ou sem senha.
--   2. qs_settings: recria a policy do espectador com a MESMA denylist da
--      0011. Ele segue lendo o resto do config (rótulos de caixa, horário de
--      trabalho etc.), que é o que os dashboards dele precisam.
--
-- ⚠️ REGRA PRA PRÓXIMA VEZ (fica registrado aqui e no comentário da 0036): o
--    loop "cria policy de leitura em toda tabela" NÃO pode ser reaplicado
--    cegamente — toda tabela com restrição POR LINHA (dono) ou POR VALOR
--    (denylist de chave) precisa entrar na lista de exceções.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Só mexe em policy — nenhum dado é tocado.
-- =============================================================================

-- ── (1) Senha SIP fora do alcance ───────────────────────────────────────────
drop policy if exists qs_sip_lines_select_espectador on qs_sip_lines;

-- ── (2) qs_settings com a denylist de volta ─────────────────────────────────
drop policy if exists qs_settings_select_espectador on qs_settings;
do $$
begin
  create policy qs_settings_select_espectador on qs_settings
    for select to authenticated
    using (qs_is_espectador() and key not in ('chatapp_token', 'sip_password'));
exception
  when duplicate_object then null;
end $$;

-- ── CONFERÊNCIA (leitura, não altera nada) ──────────────────────────────────
-- As policies de espectador que restam nas duas tabelas:
--   select tablename, policyname, qual
--     from pg_policies
--    where tablename in ('qs_sip_lines', 'qs_settings')
--    order by tablename, policyname;
-- Esperado: NENHUMA *_select_espectador em qs_sip_lines; em qs_settings, a
-- qs_settings_select_espectador com o `key not in (...)` no qual.
