-- =============================================================================
-- 0046 — APAGAR É SÓ NO WHATSAPP: O QS GUARDA A CONVERSA INTEIRA
-- -----------------------------------------------------------------------------
-- Correção de rumo pedida pelo Bruno em 10/08, logo depois da 0045.
--
-- A 0045 apagava dos DOIS lados: sumia do celular do cliente e limpava o texto
-- aqui também. Errado para um CRM. O QS é o ARQUIVO da conversa — é dele que
-- sai a auditoria de "o que foi combinado com esse cliente". Apagar é sobre o
-- aparelho do cliente, não sobre o nosso registro.
--
-- Então `deleted_at` muda de significado:
--   ANTES  = "o conteúdo foi embora"
--   AGORA  = "esta mensagem não está mais no WhatsApp do cliente"
--
-- O texto, os anexos e as reações FICAM. A tela mostra a mensagem normalmente,
-- com uma marca dizendo que o cliente não a vê mais — que é a informação que o
-- atendente precisa (ele não pode cobrar algo que o outro lado não enxerga).
--
-- Vale para os dois lados: quando o CLIENTE apaga, saber o que ele apagou é
-- justamente o que interessa a um time comercial.
--
-- Seguro de rodar: verificado antes de escrever esta migration que NENHUMA
-- mensagem tinha deleted_at preenchido (o recurso ainda não tinha sido usado),
-- então não há conteúdo perdido pela versão anterior para tentar recuperar.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. A 0045 já está aplicada — esta apenas substitui a função.
-- =============================================================================

create or replace function qs_wa_apagar(p_msg uuid, p_user uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_rows int := 0;
begin
  -- Só carimba. Nada de `content = null`: o histórico do QS não pode ter buraco.
  update qs_wa_messages
     set deleted_at = now(),
         deleted_by = p_user
   where id = p_msg and deleted_at is null;

  get diagnostics v_rows = row_count;       -- ROW_COUNT é int, não boolean
  return v_rows > 0;
end $$;

revoke execute on function qs_wa_apagar(uuid, uuid) from public;
grant  execute on function qs_wa_apagar(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

-- ── Como conferir ───────────────────────────────────────────────────────────
-- Apague uma mensagem pelo QS e confira que o texto CONTINUA no banco:
--   select content is not null as texto_preservado, deleted_at is not null as fora_do_whatsapp
--     from qs_wa_messages where deleted_at is not null order by sent_at desc limit 5;
--   → texto_preservado = true  e  fora_do_whatsapp = true
