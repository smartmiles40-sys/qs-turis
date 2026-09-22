-- supabase/migrations/0087_optout_do_whatsapp.sql
-- "PARAR": quando o lead pede para não receber mais.
--
-- POR QUE ISTO ENTRA AGORA, e não é firula de conformidade:
--
-- A qualidade do número na Meta (verde/amarelo/vermelho) é calculada a partir de
-- quantas pessoas BLOQUEIAM e DENUNCIAM. E quem denuncia é, quase sempre, quem
-- pediu para parar e continuou recebendo. A qualidade, por sua vez, é quem define
-- o teto diário de mensagens do número — ou seja: ignorar um "PARAR" hoje custa
-- volume de disparo daqui a duas semanas, e a conta chega sem etiqueta.
--
-- O QS já manda template automático de primeiro contato
-- (`qs_settings.primeiro_contato_auto.ativo = true`). Era o caminho mais direto
-- para insistir com quem já tinha pedido para sair.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO:
--
-- Não mexe no `status` do lead, não o tira da cadência e não o marca como
-- perdido. Isso é decisão comercial do Bruno, não consequência técnica de uma
-- palavra numa mensagem — e um lead sumindo da fila do SDR sozinho seria pior do
-- que o problema que estamos resolvendo. Aqui só se REGISTRA o pedido e se
-- bloqueia o envio AUTOMÁTICO. O SDR continua vendo o lead e continua podendo
-- falar com ele à mão, que é como uma pessoa desfaz um mal-entendido.

alter table public.qs_leads add column if not exists optout_whatsapp_em timestamptz;
-- A frase exata que a pessoa escreveu. Serve para duas coisas: provar numa
-- auditoria da Meta que o pedido foi respeitado, e deixar o SDR ver que o
-- "PARAR" foi na verdade um "parar de me ligar de madrugada".
alter table public.qs_leads add column if not exists optout_whatsapp_texto text;

create index if not exists qs_leads_optout_whatsapp_idx
  on public.qs_leads (optout_whatsapp_em) where optout_whatsapp_em is not null;

/**
 * Registra o pedido de saída. Idempotente: quem já pediu não tem o carimbo
 * reescrito — o que vale é a PRIMEIRA vez, que é a data que uma auditoria pede.
 */
create or replace function public.qs_wa_optout(p_lead uuid, p_texto text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer := 0;
begin
  update public.qs_leads
     set optout_whatsapp_em = now(),
         optout_whatsapp_texto = left(coalesce(p_texto, ''), 300)
   where id = p_lead
     and optout_whatsapp_em is null;

  -- `row_count` é inteiro; devolver booleano é o que o chamador quer saber
  -- ("foi AGORA que a pessoa pediu?"), para não registrar a mesma nota duas vezes.
  get diagnostics n = row_count;
  return n > 0;
end;
$fn$;

revoke all on function public.qs_wa_optout(uuid, text) from public;
revoke all on function public.qs_wa_optout(uuid, text) from anon, authenticated;
grant execute on function public.qs_wa_optout(uuid, text) to service_role;
