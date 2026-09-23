-- 0092 — cada número conectado pelo painel ganha a sua "caixa" (cw_inbox_id,
-- a marca que a entrada da Meta grava em cada mensagem). A janela de 24h da
-- Meta é POR NÚMERO: sem marca própria, cliente que escreveu pro número banido
-- (caixa 3) pareceria ter a janela aberta no número novo. Marcas a partir de
-- 100 pra nunca colidir com as caixas antigas do Chatwoot (1..~10).
-- (Aplicada pelo MCP em 23/09/2026.)
create or replace function qs_meta_marcar_caixa(p_phone text)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v int;
begin
  select cw_inbox_id into v from qs_wa_numeros_meta where phone_number_id = p_phone;
  if v is not null then return v; end if;
  perform pg_advisory_xact_lock(hashtext('qs_meta_marcar_caixa'));
  select greatest(100, coalesce(max(cw_inbox_id), 0) + 1) into v from qs_wa_numeros_meta;
  update qs_wa_numeros_meta set cw_inbox_id = v where phone_number_id = p_phone;
  return v;
end;
$fn$;
revoke all on function qs_meta_marcar_caixa(text) from public, anon, authenticated;
grant execute on function qs_meta_marcar_caixa(text) to service_role;
