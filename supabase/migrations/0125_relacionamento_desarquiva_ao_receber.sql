-- 0125_relacionamento_desarquiva_ao_receber.sql
-- -----------------------------------------------------------------------------
-- Igual ao WhatsApp (14/10/2026): conversa arquivada volta pra lista quando o
-- CLIENTE escreve de novo — senão ela ficaria escondida em "Arquivadas" com o
-- prazo de resposta correndo. Vale pra todo mundo que tinha arquivado.
-- Silenciada continua silenciada (é outra escolha).
-- -----------------------------------------------------------------------------
create or replace function rel_wa_desarquivar_ao_receber() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direcao = 'in' and new.origem = 'cliente' then
    update rel_wa_conversa_usuario
       set arquivada = false, atualizado_em = now()
     where conversa_id = new.conversa_id and arquivada;
  end if;
  return new;
end $$;
revoke all on function rel_wa_desarquivar_ao_receber() from public, anon, authenticated;

drop trigger if exists rel_wa_desarquivar_ao_receber on rel_wa_mensagens;
create trigger rel_wa_desarquivar_ao_receber after insert on rel_wa_mensagens
  for each row execute function rel_wa_desarquivar_ao_receber();
