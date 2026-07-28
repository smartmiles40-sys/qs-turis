-- =============================================================================
-- 0028 — DISTRIBUIÇÃO UNIFORME (rodízio circular de verdade)
-- -----------------------------------------------------------------------------
-- POR QUE: até aqui (0003 → 0008) o lead ia pro SDR com MENOS LEADS EM ABERTO.
-- Parece justo, mas na prática premia quem trabalha: todo lead marcado como
-- perdido/ganho DERRUBA a contagem em aberto de quem marcou — e o próximo lead,
-- e o próximo, e o próximo vão todos pra ele até empatar de novo. Foi exatamente
-- o que aconteceu na base (28/07/2026): 29 leads SEGUIDOS pro mesmo SDR, e um
-- acumulado de 314 × 256 × 229 leads entre os três. Como quem está no sistema é
-- quem fecha lead, o efeito no dia a dia foi "quem entra primeiro leva tudo".
--
-- O QUE MUDA: rodízio circular puro. O lead vai pro PRÓXIMO SDR da fila, ponto.
-- Não olha carga, não olha quem está online, não olha quem está com o QS aberto.
-- Um lead pra cada, na ordem, sempre — 1/N pra cada SDR ativo, no automático.
--
-- O ponteiro do rodízio mora no banco (qs_assign_state), então ele sobrevive a
-- deploy, reinício e a leads que entram pelo n8n fora do horário.
--
-- Quem entra no rodízio: qs_users com role='sdr' e is_active=true. Tirar um SDR
-- do rodízio (férias, desligamento) = desativar em Configurações → Usuários.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. NÃO mexe em lead que já tem dono — só na distribuição dos novos.
-- =============================================================================

-- ── (1) O ponteiro do rodízio ───────────────────────────────────────────────
-- Uma linha por "fila": 'global' e, quando a cadência tem SDRs próprios,
-- 'cadencia:<uuid>'. last_owner_id = quem recebeu o último lead daquela fila.
create table if not exists qs_assign_state (
  scope         text primary key,
  last_owner_id uuid references qs_users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table qs_assign_state enable row level security;

-- Só gestor/admin enxerga (é informação de gestão). A escrita acontece dentro da
-- função abaixo, que é SECURITY DEFINER — nenhum usuário escreve aqui direto.
drop policy if exists assign_state_select on qs_assign_state;
create policy assign_state_select on qs_assign_state for select to authenticated
  using (qs_is_manager());

grant select on qs_assign_state to authenticated;

-- ── (2) A distribuição ──────────────────────────────────────────────────────
-- SECURITY DEFINER de propósito: a escolha tem que enxergar TODOS os SDRs e o
-- ponteiro independentemente de quem inseriu o lead. Sem isso, um lead criado na
-- mão por um SDR (que pela RLS só enxerga a própria carteira) calcularia o
-- rodízio com meia base — e a fila desandaria.
create or replace function qs_assign_lead_owner() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
  v_pool  uuid[];
  v_last  uuid;
  v_pos   int;
  v_n     int;
  chosen  uuid;
begin
  -- Dono explícito (transferência, handover, cadastro manual com responsável
  -- escolhido) manda mais que o rodízio.
  if new.owner_id is not null then
    return new;
  end if;

  -- Fila da CADÊNCIA, quando ela tem SDRs atribuídos (Cadências → Responsáveis).
  if new.cadence_id is not null then
    select array_agg(u.id order by u.created_at, u.id)
      into v_pool
      from qs_cadence_owners co
      join qs_users u on u.id = co.user_id
     where co.cadence_id = new.cadence_id
       and u.role = 'sdr'
       and u.is_active = true;
  end if;

  if v_pool is null or cardinality(v_pool) = 0 then
    -- Fila GLOBAL: todos os SDRs ativos.
    v_scope := 'global';
    select array_agg(u.id order by u.created_at, u.id)
      into v_pool
      from qs_users u
     where u.role = 'sdr' and u.is_active = true;
  else
    v_scope := 'cadencia:' || new.cadence_id::text;
  end if;

  -- Sem SDR ativo nenhum: lead nasce órfão (o gestor vê e distribui na mão).
  if v_pool is null or cardinality(v_pool) = 0 then
    return new;
  end if;
  v_n := cardinality(v_pool);

  -- Serializa ESTA fila: dois leads entrando no mesmo instante avançam o ponteiro
  -- um de cada vez — nunca caem no mesmo SDR nem pulam alguém.
  perform pg_advisory_xact_lock(hashtext('qs_assign_' || v_scope));

  select last_owner_id into v_last
    from qs_assign_state
   where scope = v_scope
     for update;

  v_pos := array_position(v_pool, v_last);

  if v_pos is null then
    -- Primeira volta da fila, ou o último dono saiu do rodízio (desativado /
    -- removido da cadência). Recomeça por QUEM RECEBEU MENOS leads no total —
    -- em vez de recomeçar sempre pelo primeiro da lista, que viciaria a fila.
    select p.id into chosen
      from unnest(v_pool) with ordinality as p(id, ord)
      left join (
        select owner_id, count(*) as c
          from qs_leads
         where owner_id is not null
         group by owner_id
      ) k on k.owner_id = p.id
     order by coalesce(k.c, 0) asc, p.ord asc
     limit 1;
  else
    -- O próximo da roda (o último volta pro fim da fila).
    chosen := v_pool[(v_pos % v_n) + 1];
  end if;

  new.owner_id := chosen;

  insert into qs_assign_state (scope, last_owner_id, updated_at)
       values (v_scope, chosen, now())
  on conflict (scope) do update
       set last_owner_id = excluded.last_owner_id,
           updated_at    = now();

  return new;
end;
$$;

-- O trigger da 0003 continua valendo — só a função mudou. Recriado por garantia.
drop trigger if exists trg_qs_assign_owner on qs_leads;
create trigger trg_qs_assign_owner
  before insert on qs_leads
  for each row execute function qs_assign_lead_owner();

-- ── (3) Como conferir o rodízio depois de aplicar ───────────────────────────
-- Ponteiro atual de cada fila:
--   select * from qs_assign_state;
-- Distribuição dos leads que entraram de hoje em diante (tem que ficar parelha):
--   select u.name, count(*)
--     from qs_leads l join qs_users u on u.id = l.owner_id
--    where l.created_at >= current_date
--    group by u.name order by 2 desc;
