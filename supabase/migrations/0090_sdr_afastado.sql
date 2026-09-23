-- =============================================================================
-- 0090 — SDR AFASTADO POR X DIAS (atestado, folga, férias)
-- -----------------------------------------------------------------------------
-- Bruno, 23/09/2026: "quando alguém faltar, o supervisor desativa o número por
-- X dias — a pessoa deu atestado hoje, fica fora hoje — pra não perdermos lead".
--
-- Desativar o CHIP (0076) não serve pra isso: é definitivo (o chip vira
-- queimado) e só tira a pessoa do WhatsApp das LPs — os leads novos do QS
-- continuavam caindo nela. Afastamento é da PESSOA e tem data pra acabar:
--
--   qs_users.ausente_ate = último dia FORA (inclusive, no fuso de São Paulo).
--   No dia seguinte ela volta sozinha — ninguém precisa lembrar de reativar.
--
-- Enquanto afastada, ela sai de:
--   • o rodízio das LPs / botões de WhatsApp  (qs_sdrs_no_rodizio, reservar_sdr)
--   • o rodízio dos leads novos do QS         (qs_assign_lead_owner)
--   • a agenda da ligação de 5 min             (api/_ligacaoSdr.js lê a coluna)
-- Os leads que JÁ são dela continuam dela.
-- =============================================================================

alter table qs_users add column if not exists ausente_ate    date;
alter table qs_users add column if not exists ausente_motivo text;

comment on column qs_users.ausente_ate is
  'Último dia fora (inclusive, fuso SP). Nulo ou no passado = trabalhando. Ver 0090.';

-- "Hoje" é o dia de São Paulo, não o do servidor (UTC vira o dia às 21h).
create or replace function qs_sdr_ausente(p_sdr uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((
    select u.ausente_ate >= (now() at time zone 'America/Sao_Paulo')::date
      from qs_users u
     where u.id = p_sdr
  ), false);
$fn$;

-- ── Rodízio das LPs: quem está afastado não entra ───────────────────────────
create or replace function qs_sdrs_no_rodizio()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select array_agg(u.id order by u.created_at, u.id)
    from qs_users u
    join sdr_pool p on p.sdr_id = u.id and p.status = 'ativo'
   where u.role = 'sdr' and u.is_active = true
     and not qs_sdr_ausente(u.id);
$fn$;

-- ── reservar_sdr: ligação/bilhete/dono de alguém afastado vai pra roda ──────
-- (partindo da versão vigente, a da 0088; só muda a checagem do "reaproveitar")
create or replace function public.reservar_sdr(
  p_nome      text default null,
  p_telefone  text default null,
  p_email     text default null,
  p_origem    text default null,
  p_expedicao text default null,
  p_fila      text default 'forms'
)
returns table (reserva_id uuid, sdr_id uuid, sdr_nome text, numero text, reaproveitado boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tel   text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v_chave text := qs_tel_chave(p_telefone);
  v_fila  text := coalesce(nullif(btrim(lower(p_fila)), ''), 'forms');
  v_sdr   uuid;
  v_reap  boolean := false;
  v_num   text;
  v_nome  text;
  v_id    uuid;
begin
  if v_chave is null then
    raise exception 'telefone invalido' using errcode = '22023';
  end if;

  select g.sdr_id into v_sdr
    from qs_ligacoes_sdr g
    join qs_leads l on l.id = g.lead_id
   where qs_tel_chave(l.phone) = v_chave
     and g.sdr_id is not null
     and g.status = 'marcada'
     and g.created_at > now() - interval '24 hours'
   order by g.created_at desc
   limit 1;

  if v_sdr is null then
    select r.sdr_id into v_sdr
      from sdr_reservas r
     where r.chave = v_chave
       and r.sdr_id is not null
       and r.created_at > now() - interval '30 days'
     order by r.created_at desc
     limit 1;
  end if;

  if v_sdr is null then
    select l.owner_id into v_sdr
      from qs_leads l
     where qs_tel_chave(l.phone) = v_chave
       and l.owner_id is not null
       and l.created_at > now() - interval '30 days'
     order by l.created_at desc
     limit 1;
  end if;

  if v_sdr is not null then
    if exists (select 1 from sdr_pool p where p.sdr_id = v_sdr and p.status = 'ativo')
       and not qs_sdr_ausente(v_sdr) then
      v_reap := true;
    else
      v_sdr := null;
    end if;
  end if;

  if v_sdr is null then
    v_sdr := qs_proximo_sdr('fila:' || v_fila, qs_sdrs_no_rodizio());
  end if;

  if v_sdr is null then
    return;
  end if;

  select p.numero, coalesce(u.name, p.sdr_nome)
    into v_num, v_nome
    from sdr_pool p
    left join qs_users u on u.id = p.sdr_id
   where p.sdr_id = v_sdr and p.status = 'ativo'
   limit 1;

  insert into sdr_reservas (telefone, chave, sdr_id, numero, fila, origem, expedicao, nome)
       values (v_tel, v_chave, v_sdr, v_num, v_fila,
               nullif(btrim(coalesce(p_origem, '')), ''),
               nullif(btrim(coalesce(p_expedicao, '')), ''),
               nullif(btrim(coalesce(p_nome, '')), ''))
    returning sdr_reservas.id into v_id;

  reserva_id    := v_id;
  sdr_id        := v_sdr;
  sdr_nome      := v_nome;
  numero        := v_num;
  reaproveitado := v_reap;
  return next;
end;
$fn$;

revoke all on function public.reservar_sdr(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reservar_sdr(text, text, text, text, text, text) to service_role;

-- ── Leads novos do QS: afastado não recebe ──────────────────────────────────
-- (partindo da versão vigente). Se TODO MUNDO estiver afastado, ignora o
-- afastamento: lead sem dono é lead perdido, e isso é pior do que cair em quem
-- está fora — o supervisor redistribui depois.
create or replace function public.qs_assign_lead_owner() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_scope   text;
  v_pool    uuid[];
  v_todos   uuid[];
  v_chave   text;
  v_res_id  uuid;
  v_res_sdr uuid;
begin
  if new.owner_id is not null then
    return new;
  end if;

  v_chave := qs_tel_chave(new.phone);
  if v_chave is not null then
    select r.id, r.sdr_id into v_res_id, v_res_sdr
      from sdr_reservas r
     where r.chave = v_chave
       and r.sdr_id is not null
       and r.created_at > now() - interval '30 days'
     order by r.created_at desc
     limit 1;

    if v_res_sdr is not null and not qs_sdr_ausente(v_res_sdr) then
      new.owner_id := v_res_sdr;
      update sdr_reservas set lead_id = new.id where id = v_res_id and lead_id is null;
      return new;
    end if;
  end if;

  if new.cadence_id is not null then
    select array_agg(u.id order by u.created_at, u.id)
      into v_todos
      from qs_cadence_owners co
      join qs_users u on u.id = co.user_id
     where co.cadence_id = new.cadence_id
       and u.role = 'sdr'
       and u.is_active = true;
  end if;

  if v_todos is null or cardinality(v_todos) = 0 then
    v_scope := 'global';
    select array_agg(u.id order by u.created_at, u.id)
      into v_todos
      from qs_users u
     where u.role = 'sdr' and u.is_active = true;
  else
    v_scope := 'cadencia:' || new.cadence_id::text;
  end if;

  select array_agg(x order by o)
    into v_pool
    from unnest(v_todos) with ordinality as t(x, o)
   where not qs_sdr_ausente(x);

  if v_pool is null or cardinality(v_pool) = 0 then
    v_pool := v_todos;
  end if;

  new.owner_id := qs_proximo_sdr(v_scope, v_pool);
  return new;
end;
$fn$;

-- ── A escrita da tela (só via /api/sdr-pool, com service_role) ──────────────
-- p_ate nulo = volta agora.
create or replace function qs_afastar_sdr(p_sdr_id uuid, p_ate date, p_motivo text default null)
returns table (sdr_id uuid, ausente_ate date)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_ate is not null and p_ate < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data-no-passado' using errcode = '22023';
  end if;
  if p_ate is not null and p_ate > (now() at time zone 'America/Sao_Paulo')::date + 60 then
    raise exception 'data-longe-demais' using errcode = '22023';
  end if;

  update qs_users u
     set ausente_ate    = p_ate,
         ausente_motivo = case when p_ate is null then null
                               else nullif(btrim(coalesce(p_motivo, '')), '') end
   where u.id = p_sdr_id and u.role = 'sdr';
  if not found then
    raise exception 'sdr-inexistente' using errcode = '22023';
  end if;

  sdr_id := p_sdr_id;
  ausente_ate := p_ate;
  return next;
end;
$fn$;

revoke all on function qs_sdr_ausente(uuid) from public, anon, authenticated;
grant execute on function qs_sdr_ausente(uuid) to service_role;
revoke all on function qs_sdrs_no_rodizio() from public, anon, authenticated;
grant execute on function qs_sdrs_no_rodizio() to service_role;
revoke all on function qs_afastar_sdr(uuid, date, text) from public, anon, authenticated;
grant execute on function qs_afastar_sdr(uuid, date, text) to service_role;
