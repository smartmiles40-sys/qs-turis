-- 0430_ig_conversa_do_lead.sql
-- -----------------------------------------------------------------------------
-- INSTAGRAM NA CONVERSA DO SDR (Bruno, 27/11/2026).
--
-- As DMs do @ da agência já entram no QS pelo webhook do Marketing
-- (/api/mkt-instagram → mkt_ig_conversas/mkt_ig_mensagens, 0244). Até aqui só
-- o Marketing via (mkt_auto_acesso). Agora cada conversa é amarrada ao LEAD
-- pelo @ (qs_leads.instagram, 0418) e quem enxerga o lead enxerga a conversa —
-- a SDR dona, o closer, a gestão (a mesma RLS do qs_leads, via EXISTS).
--
--   lead_id      → preenchido sozinho: na conversa nova/@ novo (trigger) e
--                  quando o @ do lead é cadastrado depois (trigger no qs_leads).
--   @ repetido   → vence o lead mais recente (o que está sendo trabalhado).
--
-- Responder continua pelo servidor (/api/sdr-instagram), que confere o acesso
-- ao lead e a janela de 24 h da Meta.
--
-- Volta: drop das 2 policies qs_*, dos 2 triggers e da coluna lead_id.
-- -----------------------------------------------------------------------------

alter table public.mkt_ig_conversas
  add column if not exists lead_id uuid references public.qs_leads(id) on delete set null;
create index if not exists mkt_ig_conversas_lead_idx on public.mkt_ig_conversas (lead_id) where lead_id is not null;
create index if not exists qs_leads_instagram_idx on public.qs_leads (lower(instagram)) where instagram is not null;

-- O lead daquele @ (mais recente). null = nenhum.
create or replace function public.qs_ig_lead_do_usuario(p_username text)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select l.id from public.qs_leads l
   where p_username is not null and btrim(p_username) <> ''
     and lower(l.instagram) = lower(regexp_replace(btrim(p_username), '^@+', ''))
   order by coalesce(l.arrived_at, l.created_at) desc nulls last
   limit 1;
$$;
revoke all on function public.qs_ig_lead_do_usuario(text) from public, anon, authenticated;

-- Conversa nova (ou @ que chegou depois): amarra ao lead se ainda não tem.
create or replace function public.qs_ig_conversa_amarrar()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.lead_id is null and new.username is not null then
    new.lead_id := public.qs_ig_lead_do_usuario(new.username);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_ig_conversa_amarrar on public.mkt_ig_conversas;
create trigger trg_qs_ig_conversa_amarrar before insert or update of username on public.mkt_ig_conversas
  for each row execute function public.qs_ig_conversa_amarrar();

-- @ cadastrado/corrigido no lead: a conversa solta daquele @ vem pra ele.
create or replace function public.qs_ig_lead_amarrar()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.instagram is not null and new.instagram is distinct from old.instagram then
    update public.mkt_ig_conversas c set lead_id = new.id
     where c.lead_id is null and lower(regexp_replace(c.username, '^@+', '')) = lower(new.instagram);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_ig_lead_amarrar on public.qs_leads;
create trigger trg_qs_ig_lead_amarrar after insert or update of instagram on public.qs_leads
  for each row execute function public.qs_ig_lead_amarrar();

-- Conversas que já existiam.
update public.mkt_ig_conversas c set lead_id = public.qs_ig_lead_do_usuario(c.username)
 where c.lead_id is null and c.username is not null;

-- Leitura: quem vê o lead vê a conversa (a RLS do qs_leads roda dentro do EXISTS).
drop policy if exists qs_ig_conversas_do_lead on public.mkt_ig_conversas;
create policy qs_ig_conversas_do_lead on public.mkt_ig_conversas for select to authenticated
  using (lead_id is not null and exists (select 1 from public.qs_leads l where l.id = mkt_ig_conversas.lead_id));

drop policy if exists qs_ig_mensagens_do_lead on public.mkt_ig_mensagens;
create policy qs_ig_mensagens_do_lead on public.mkt_ig_mensagens for select to authenticated
  using (exists (select 1 from public.mkt_ig_conversas c where c.id = mkt_ig_mensagens.conversa_id));

grant select on public.mkt_ig_conversas, public.mkt_ig_mensagens to authenticated;
