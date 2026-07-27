-- 0026_wa_avatar.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Foto de perfil do WhatsApp na lista de conversas.
--
-- Uma coluna só. O front já tolera a ausência dela (a busca pede "*", então sem
-- a coluna o campo vem vazio e o avatar cai nas iniciais coloridas) — ou seja,
-- rodar isto é OPCIONAL e só acrescenta: nada quebra se você deixar pra depois.
--
-- Quem preenche é o /api/wa-sync, que roda toda vez que alguém abre uma
-- conversa. As fotos vão aparecendo conforme o time trabalha, sem varredura.
--
-- Nota: só ~1 em cada 3 contatos tem foto — o WhatsApp não entrega a imagem de
-- quem restringiu a privacidade. Para esses, as iniciais são o estado final,
-- não um "carregando".
--
-- ⚠️ Cole no SQL Editor do Supabase e rode 1x. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table qs_wa_threads add column if not exists avatar_url text;

notify pgrst, 'reload schema';

-- Rollback: alter table qs_wa_threads drop column if exists avatar_url;
