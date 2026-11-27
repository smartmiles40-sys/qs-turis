-- 0431_ig_conta_do_sdr.sql
-- -----------------------------------------------------------------------------
-- CADA SDR COM O INSTAGRAM DO TRABALHO DELA (Bruno, 27/11/2026).
--
-- A 0430 amarrou as DMs do @ da agência ao lead. O Bruno corrigiu: não é a
-- conta do Marketing — cada SDR conecta o PRÓPRIO Instagram do trabalho, e as
-- DMs dessa conta são dela (como os números de WhatsApp por SDR).
--
--   mkt_ig_contas.dono_id   null = conta da agência (Marketing, como sempre)
--                           uuid = conta de uma SDR (conectada por ela)
--
-- Quem vê:
--   conta da SDR      → a dona e a gestão (qs_is_manager). O Marketing NÃO vê
--                       (antes mkt_auto_acesso via todas as contas).
--   conversa da SDR   → a dona e a gestão, mesmo sem lead amarrado (contato
--                       novo que chegou pela DM) + quem vê o lead (0430).
--   conta da agência  → Marketing, como antes (+ quem vê o lead, 0430).
-- Amarrar ao lead: na conta da SDR, o lead DELA com aquele @ vence.
--
-- Volta: recriar as 3 policies mkt_*_mkt_ler com só mkt_auto_acesso(), drop
-- das policies qs_ig_*_sdr, da função qs_ig_conta_minha e da coluna dono_id.
-- -----------------------------------------------------------------------------

alter table public.mkt_ig_contas
  add column if not exists dono_id uuid references public.qs_users(id) on delete set null;
create unique index if not exists mkt_ig_contas_dono_idx on public.mkt_ig_contas (dono_id) where dono_id is not null;

-- A conta é da SDR logada (ou ela é gestão olhando uma conta de SDR)?
create or replace function public.qs_ig_conta_minha(p_conta uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.mkt_ig_contas c
     where c.id = p_conta and c.dono_id is not null
       and (c.dono_id = auth.uid() or public.qs_is_manager())
  );
$$;
revoke all on function public.qs_ig_conta_minha(uuid) from public, anon;
grant execute on function public.qs_ig_conta_minha(uuid) to authenticated;

-- A conta é da agência? (o Marketing só enxerga essas)
create or replace function public.qs_ig_conta_da_agencia(p_conta uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.mkt_ig_contas c where c.id = p_conta and c.dono_id is null);
$$;
revoke all on function public.qs_ig_conta_da_agencia(uuid) from public, anon;
grant execute on function public.qs_ig_conta_da_agencia(uuid) to authenticated;

-- Marketing: só a conta da agência.
drop policy if exists mkt_ig_contas_mkt_ler on public.mkt_ig_contas;
create policy mkt_ig_contas_mkt_ler on public.mkt_ig_contas for select
  using (public.mkt_auto_acesso() and dono_id is null);
drop policy if exists mkt_ig_conversas_mkt_ler on public.mkt_ig_conversas;
create policy mkt_ig_conversas_mkt_ler on public.mkt_ig_conversas for select
  using (public.mkt_auto_acesso() and public.qs_ig_conta_da_agencia(conta_id));
drop policy if exists mkt_ig_mensagens_mkt_ler on public.mkt_ig_mensagens;
create policy mkt_ig_mensagens_mkt_ler on public.mkt_ig_mensagens for select
  using (public.mkt_auto_acesso() and exists (
    select 1 from public.mkt_ig_conversas c where c.id = mkt_ig_mensagens.conversa_id and public.qs_ig_conta_da_agencia(c.conta_id)));

-- SDR: a própria conta e as conversas dela.
drop policy if exists qs_ig_contas_sdr on public.mkt_ig_contas;
create policy qs_ig_contas_sdr on public.mkt_ig_contas for select to authenticated
  using (dono_id is not null and (dono_id = auth.uid() or public.qs_is_manager()));
drop policy if exists qs_ig_conversas_sdr on public.mkt_ig_conversas;
create policy qs_ig_conversas_sdr on public.mkt_ig_conversas for select to authenticated
  using (public.qs_ig_conta_minha(conta_id));
grant select on public.mkt_ig_contas to authenticated;

-- Amarrar ao lead: na conta da SDR, prefere o lead dela.
create or replace function public.qs_ig_lead_do_usuario(p_username text, p_dono uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select l.id from public.qs_leads l
   where p_username is not null and btrim(p_username) <> ''
     and lower(l.instagram) = lower(regexp_replace(btrim(p_username), '^@+', ''))
   order by (p_dono is not null and l.owner_id = p_dono) desc,
            coalesce(l.arrived_at, l.created_at) desc nulls last
   limit 1;
$$;
revoke all on function public.qs_ig_lead_do_usuario(text, uuid) from public, anon, authenticated;

create or replace function public.qs_ig_conversa_amarrar()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.lead_id is null and new.username is not null then
    new.lead_id := public.qs_ig_lead_do_usuario(new.username,
      (select c.dono_id from public.mkt_ig_contas c where c.id = new.conta_id));
  end if;
  return new;
end;
$$;

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

drop function if exists public.qs_ig_lead_do_usuario(text);
