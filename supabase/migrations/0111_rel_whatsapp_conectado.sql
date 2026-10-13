-- 0111_rel_whatsapp_conectado.sql
-- O Relacionamento já tem número de WhatsApp conectado? (13/10/2026)
-- A tela usa pra mostrar o botão "Conectar WhatsApp" à vista enquanto não tem.
-- security definer: a tabela de números é do servidor; aqui só sai sim/não.
create or replace function rel_whatsapp_conectado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select rel_tem_acesso() and exists (
    select 1 from qs_wa_numeros_meta where setor = 'relacionamento' and status = 'conectado'
  )
$$;
revoke all on function rel_whatsapp_conectado() from public, anon;
grant execute on function rel_whatsapp_conectado() to authenticated;
