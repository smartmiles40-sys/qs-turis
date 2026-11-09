-- supabase/migrations/0335_fechar_funcoes_anon.sql
-- -----------------------------------------------------------------------------
-- SEGURANÇA (auditoria 09/11/2026): 11 funções que GRAVAM estavam executáveis
-- pela chave pública (anon) — dava pra apagar/injetar mensagem de WhatsApp,
-- mexer na Glória e na carteira sem login.
--
-- Quem chama hoje (conferido no código):
--   /api (service role, não depende de anon): qs_wa_apagar, qs_wa_ingest, qs_wa_react,
--     qs_carteira_registrar, qs_gloria_salvar/pausar/contexto.
--   navegador LOGADO (authenticated): qs_wa_mark_read/unread, rel_gerar_jornada,
--     qs_carteira_registrar (motor de cadência do navegador).
--   ninguém: qs_wa_set_status.
-- Então: tira de public/anon; authenticated mantém só o que o navegador usa.
--
-- Views SECURITY DEFINER (advisor ERROR): passam a respeitar a RLS de quem lê.
--   v_opcoes_por_alias só é lida pelo /api (service role) e pelo front logado;
--   qs_carteira_orfas não é lida por código nenhum.
--
-- Volta: grant execute on function <sig> to anon; alter view ... reset (security_invoker).
-- -----------------------------------------------------------------------------

-- 1) Só servidor (service role)
revoke execute on function public.qs_wa_apagar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, integer, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.qs_wa_react(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.qs_wa_set_status(bigint, text) from public, anon, authenticated;
revoke execute on function public.qs_gloria_salvar(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.qs_gloria_pausar(uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.qs_gloria_contexto(uuid, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.qs_wa_apagar(uuid, uuid) to service_role;
grant execute on function public.qs_wa_ingest(uuid, bigint, bigint, text, text, jsonb, text, timestamptz, bigint, boolean, integer, text, text, text, text) to service_role;
grant execute on function public.qs_wa_react(uuid, text, text, text) to service_role;
grant execute on function public.qs_wa_set_status(bigint, text) to service_role;
grant execute on function public.qs_gloria_salvar(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.qs_gloria_pausar(uuid, text, text, boolean) to service_role;
grant execute on function public.qs_gloria_contexto(uuid, timestamptz, text, integer) to service_role;

-- 2) Navegador logado + servidor (sem anon)
revoke execute on function public.qs_wa_mark_read(uuid) from public, anon;
revoke execute on function public.qs_wa_mark_unread(uuid) from public, anon;
revoke execute on function public.rel_gerar_jornada(uuid) from public, anon;
revoke execute on function public.qs_carteira_registrar(text, uuid, text) from public, anon;
grant execute on function public.qs_wa_mark_read(uuid) to authenticated, service_role;
grant execute on function public.qs_wa_mark_unread(uuid) to authenticated, service_role;
grant execute on function public.rel_gerar_jornada(uuid) to authenticated, service_role;
grant execute on function public.qs_carteira_registrar(text, uuid, text) to authenticated, service_role;

-- 3) Views respeitam a RLS de quem lê
alter view public.v_opcoes_por_alias set (security_invoker = true);
alter view public.qs_carteira_orfas set (security_invoker = true);
revoke all on public.qs_carteira_orfas from anon;
revoke all on public.v_opcoes_por_alias from anon;

-- Conferência (esperado: anon=false em todas):
-- select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') from pg_proc p
--  where p.proname in ('qs_wa_apagar','qs_wa_ingest','qs_wa_set_status','qs_wa_react','qs_wa_mark_read',
--   'qs_wa_mark_unread','qs_carteira_registrar','qs_gloria_salvar','qs_gloria_pausar','qs_gloria_contexto','rel_gerar_jornada');
