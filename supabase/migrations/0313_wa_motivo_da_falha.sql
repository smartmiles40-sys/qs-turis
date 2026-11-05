-- 0313 — WhatsApp: o MOTIVO de cada mensagem que a Meta não entregou (05/11/2026)
--
-- 42 falhas no Comercial e 6 no Rel em 7 dias, nenhuma refeita: a tela dizia
-- sempre "fora da janela de 24h" e o código de verdade (131049, 131026…) era
-- jogado fora. Agora o webhook grava a frase pronta (api/_waFalhas.js) e a bolha
-- mostra. Funções separadas das de status, pra nada que já roda mudar.

alter table public.qs_wa_messages   add column if not exists erro text;
alter table public.rel_wa_mensagens add column if not exists erro text;

create or replace function public.qs_wa_status_erro(p_source text, p_erro text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(p_source, '') = '' then return false; end if;
  update qs_wa_messages set erro = left(p_erro, 500)
   where source_id in (p_source, 'WAID:' || p_source);
  return found;
end $$;

create or replace function public.rel_wa_status_erro(p_wamid text, p_erro text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(p_wamid, '') = '' then return false; end if;
  update rel_wa_mensagens set erro = left(p_erro, 500) where wamid = p_wamid;
  return found;
end $$;

-- Só o servidor (service_role) chama — fecha pra anon/authenticated, como manda a revisão de segurança de 04/11.
revoke all on function public.qs_wa_status_erro(text, text) from public, anon, authenticated;
revoke all on function public.rel_wa_status_erro(text, text) from public, anon, authenticated;
grant execute on function public.qs_wa_status_erro(text, text) to service_role;
grant execute on function public.rel_wa_status_erro(text, text) to service_role;
