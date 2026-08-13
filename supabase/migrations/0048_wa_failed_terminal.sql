-- =============================================================================
-- 0048 — O RECIBO "FALHOU" PASSA A SER ALCANÇÁVEL
-- -----------------------------------------------------------------------------
-- MEDIDO em 13/08: 36 mensagens enviadas paradas em status 'sent' há mais de
-- 3 dias, e o ⚠ "falhou" da tela NUNCA apareceu pra nenhuma mensagem enviada
-- pelo QS. Não era o Chatwoot deixando de avisar — era a nossa guarda.
--
-- A régua anti-regressão da 0045 lista os status como
--     ['failed','sent','delivered','read']
-- com 'failed' na posição 1, a MENOR. Toda mensagem enviada pelo QS nasce
-- 'sent' (posição 2). Quando o Chatwoot manda "essa falhou", a guarda pergunta
-- "2 <= 1?" — falso — e joga o aviso fora. As únicas 'failed' do banco entraram
-- quando o status ainda era NULL (coalesce → 0 <= 1), a única porta que a
-- régua deixava.
--
-- A consequência prática é a pior possível pro atendimento: recusa de envio
-- (fora da janela de 24h no número oficial, número bloqueado, mensagem velha)
-- fica IGUAL a uma mensagem entregue. O atendente cobra resposta de uma
-- mensagem que nunca chegou.
--
-- O CONSERTO: 'failed' vira estado TERMINAL, fora da régua monotônica.
--   • Chegou "failed"? Aplica SEMPRE (falha é informação, nunca regressão) —
--     exceto sobre 'read': ler é prova de entrega, e um failed atrasado/fora
--     de ordem não pode "desler" a mensagem.
--   • Entre os demais, a régua continua a mesma: sent → delivered → read,
--     nunca para trás.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente (create or replace). Não altera nenhum dado existente.
-- =============================================================================

create or replace function qs_wa_set_status(p_msg bigint, p_status text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_rows int := 0;
begin
  if p_msg is null or coalesce(p_status, '') = '' then
    return false;
  end if;

  update qs_wa_messages
     set status = p_status
   where cw_message_id = p_msg
     and (
       -- Falha é terminal: entra por cima de sent/delivered/NULL. Só não
       -- sobrescreve 'read' — mensagem lida foi entregue, o failed é ruído.
       (p_status = 'failed' and coalesce(qs_wa_messages.status, '') <> 'read')
       or
       -- O caminho feliz segue monotônico: nunca anda pra trás (o Chatwoot
       -- reenvia eventos fora de ordem; sem isto um "delivered" atrasado
       -- apagaria o "read" e o atendente veria a mensagem "desler").
       (p_status <> 'failed'
        and coalesce(array_position(array['sent','delivered','read'], qs_wa_messages.status), 0)
            <= coalesce(array_position(array['sent','delivered','read'], p_status), 0))
     );

  get diagnostics v_rows = row_count;       -- ROW_COUNT é int, não boolean
  return v_rows > 0;
end $$;

revoke execute on function qs_wa_set_status(bigint, text) from public;
grant  execute on function qs_wa_set_status(bigint, text) to service_role;

-- ── CONFERÊNCIA (leitura, não altera nada) ──────────────────────────────────
-- Enviadas paradas em 'sent' há mais de 3 dias (candidatas a failed represado;
-- o status delas só corrige quando o Chatwoot reenviar o evento — o conserto
-- vale DAQUI PRA FRENTE):
--   select count(*) from qs_wa_messages
--    where direction = 'out' and status = 'sent'
--      and created_at < now() - interval '3 days';
