-- =============================================================================
-- ESQUELETO MÍNIMO PRA TESTAR A PONTE PESSOA (0376–0379) LOCALMENTE.
-- -----------------------------------------------------------------------------
-- Só as colunas/funções que as 4 migrations encostam. As funções auxiliares
-- (cad_tel, rel_fone_chave, rel_cliente_do_telefone…) são CÓPIA da versão
-- vigente em produção em 13/11/2026 (pg_get_functiondef). As funções que as
-- migrations substituem entram aqui como casca vazia: a migration é quem dá o
-- corpo de verdade.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid $$;

create table qs_users (id uuid primary key default gen_random_uuid(), name text, role text not null,
  setores text[], is_active boolean not null default true);

create table rel_clientes (
  id uuid primary key default gen_random_uuid(), nome text not null, cpf text, passaporte text,
  passaporte_validade date, nascimento date, telefone text, email text, titular_id uuid, parentesco text,
  mesclado_em_id uuid, arquivado_em timestamptz, optout_em timestamptz,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), atualizado_por uuid,
  endereco_cep text, endereco_rua text, endereco_numero text, endereco_complemento text,
  endereco_bairro text, endereco_cidade text, endereco_estado text);

create table qs_leads (
  id uuid primary key default gen_random_uuid(), first_name text, last_name text, full_name text,
  phone text, email text, status text default 'novo', owner_id uuid, cliente_id uuid,
  optout_whatsapp_em timestamptz, optout_whatsapp_texto text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table expedicoes (id uuid primary key default gen_random_uuid(), data_embarque date, data_retorno date);

create table passageiros (
  id uuid primary key default gen_random_uuid(), cliente_id uuid, expedicao_id uuid, nome_completo text,
  cpf text, passaporte text, validade_passaporte date, data_nascimento date, email text, telefone text,
  acompanhante_nome text,
  endereco_cep text, endereco_rua text, endereco_numero text, endereco_complemento text,
  endereco_bairro text, endereco_cidade text, endereco_estado text);

create table cad_divergencias (
  id uuid primary key default gen_random_uuid(), cliente_id uuid not null references rel_clientes(id),
  passageiro_id uuid not null references passageiros(id), campo text not null, valor_ficha text, valor_expedicao text,
  ficha_sugerida uuid, criado_em timestamptz not null default now(), resolvido_em timestamptz, resolvido_por uuid, escolha text,
  constraint cad_divergencias_campo_check check (campo = any (array['pessoa','cpf','passaporte','passaporte_validade','nascimento','email','telefone'])));
create unique index cad_divergencias_aberta_idx on cad_divergencias (passageiro_id, campo) where resolvido_em is null;

create table rel_wa_conversas (id uuid primary key default gen_random_uuid(), phone_number_id text not null default 'x',
  telefone text not null, cliente_id uuid, optout_em timestamptz);

create table mkt_contatos (id uuid primary key default gen_random_uuid(), nome text, telefone text unique, email text unique,
  optout_whatsapp_em timestamptz, rel_cliente_id uuid, atualizado_em timestamptz default now());

-- ── auxiliares (cópia da produção) ──────────────────────────────────────────
create or replace function cad_dig(t text) returns text language sql immutable as
$f$ select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '') $f$;
create or replace function cad_txt(t text) returns text language sql immutable as
$f$ select nullif(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'), '') $f$;
create or replace function cad_email(t text) returns text language sql immutable as
$f$ select case when lower(trim(coalesce(t, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(trim(t)) end $f$;
create or replace function cad_tel(t text) returns text language sql immutable as $f$
  select case when d is null then null when length(d) in (10, 11) then '55' || d when length(d) between 12 and 15 then d end
    from (select cad_dig(t) d) x $f$;
create or replace function cad_nome(t text) returns text language sql immutable as $f$
  select nullif(trim(regexp_replace(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z ]+', ' ', 'g'), '\s+', ' ', 'g')), '') $f$;
create or replace function cad_cpf(t text) returns text language sql immutable as
$f$ select case when length(cad_dig(t)) = 11 and cad_dig(t) !~ '^(\d)\1{10}$' then cad_dig(t) end $f$;
create or replace function cad_cpf_fmt(t text) returns text language sql immutable as
$f$ select case when cad_cpf(t) is not null then regexp_replace(cad_cpf(t), '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') end $f$;
create or replace function cad_pass(t text) returns text language sql immutable as $f$
  select case when upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z0-9]{5,12}$'
              then upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')) end $f$;
create or replace function cad_cep(t text) returns text language sql immutable as
$f$ select case when length(cad_dig(t)) = 8 then substr(cad_dig(t), 1, 5) || '-' || substr(cad_dig(t), 6) else cad_txt(t) end $f$;
create or replace function cad_uf(t text) returns text language sql immutable as $f$ select upper(cad_txt(t)) $f$;
create or replace function cad_campos_endereco() returns text[] language sql immutable as
$f$ select array['endereco_cep', 'endereco_rua', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_estado'] $f$;
create or replace function cad__ida_vigente(p_exp uuid) returns boolean language sql stable security definer set search_path to 'public' as $f$
  select p_exp is null or not exists (select 1 from expedicoes e where e.id = p_exp
     and coalesce(e.data_retorno, e.data_embarque) is not null
     and coalesce(e.data_retorno, e.data_embarque) < (now() at time zone 'America/Sao_Paulo')::date) $f$;
create or replace function rel_fone_chave(p text) returns text language sql immutable parallel safe set search_path to 'public' as $f$
  select case when d ~ '^55\d{10,11}$' then substr(d, 1, 4) || right(d, 8)
              when d ~ '^\d{10,11}$' then '55' || substr(d, 1, 2) || right(d, 8)
              else nullif(d, '') end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x $f$;
create or replace function qs_tel_chave(p_tel text) returns text language sql immutable set search_path = pg_catalog as
$f$ select nullif(right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 8), '') $f$;
create index rel_clientes_fone_chave_idx on rel_clientes (rel_fone_chave(telefone)) where mesclado_em_id is null;
create index qs_leads_tel_chave_idx on qs_leads (qs_tel_chave(phone), created_at desc) where phone is not null;

create or replace function cad_ficha_viva(p uuid) returns uuid language plpgsql stable security definer set search_path to 'public' as $f$
declare v uuid := p; m uuid; i int := 0;
begin
  loop
    select mesclado_em_id into m from rel_clientes where id = v;
    exit when m is null or i > 10;
    v := m; i := i + 1;
  end loop;
  return v;
end $f$;

create or replace function rel_cliente_do_telefone(p_telefone text) returns uuid language sql stable set search_path to 'public' as $f$
  with exato as (select id, titular_id from rel_clientes where telefone = p_telefone and mesclado_em_id is null and arquivado_em is null),
  chave as (select id, titular_id from rel_clientes where rel_fone_chave(telefone) = rel_fone_chave(p_telefone) and mesclado_em_id is null and arquivado_em is null),
  c as (select * from exato union all select * from chave where not exists (select 1 from exato))
  select case when (select count(*) from c) = 1 then (select id from c)
              when (select count(*) from c where titular_id is null) = 1 then (select id from c where titular_id is null)
              else null end $f$;

create or replace function rel_clientes_normaliza() returns trigger language plpgsql as $f$
declare fone text;
begin
  new.nome := regexp_replace(trim(new.nome), '\s+', ' ', 'g');
  new.cpf := nullif(regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.passaporte := nullif(upper(regexp_replace(coalesce(new.passaporte, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  fone := regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g');
  if length(fone) in (10, 11) then fone := '55' || fone; end if;
  new.telefone := nullif(fone, '');
  if new.titular_id is null then new.parentesco := null; end if;
  if tg_op = 'UPDATE' then new.atualizado_em := now(); new.atualizado_por := coalesce(auth.uid(), new.atualizado_por); end if;
  return new;
end $f$;
create trigger trg_rel_clientes_normaliza before insert or update on rel_clientes for each row execute function rel_clientes_normaliza();

create or replace function rel_liga_conversas_do_cliente() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if new.telefone is not null and new.mesclado_em_id is null then
    update rel_wa_conversas set cliente_id = rel_cliente_do_telefone(telefone)
     where rel_fone_chave(telefone) = rel_fone_chave(new.telefone) and cliente_id is null;
  end if;
  if new.mesclado_em_id is not null then
    update rel_wa_conversas set cliente_id = new.mesclado_em_id where cliente_id = new.id;
  end if;
  return null;
end $f$;
create trigger trg_rel_liga_conversas after insert or update of telefone, mesclado_em_id on rel_clientes
  for each row execute function rel_liga_conversas_do_cliente();

create or replace function qs_set_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = now(); return new; end $f$;
create trigger trg_qs_leads_updated before update on qs_leads for each row execute function qs_set_updated_at();

-- stubs que a ponte chama mas não testa
create or replace function cad_ligar_passageiro(p_pax uuid, p_criar boolean) returns uuid language sql as $f$ select null::uuid $f$;
create or replace function cad_sincronizar_acompanhante(p_pax uuid) returns void language sql as $f$ select $f$;
create or replace function cad_mover_acompanhantes(p_de uuid, p_para uuid) returns void language sql as $f$ select $f$;

-- cascas: as migrations dão o corpo
create or replace function qs_bloqueia_espectador() returns trigger language plpgsql as $f$ begin return new; end $f$;
create trigger trg_qs_leads_espectador before insert or delete or update on qs_leads for each row execute function qs_bloqueia_espectador();
create or replace function cad_trg_ficha() returns trigger language plpgsql as $f$ begin return null; end $f$;
create or replace function cad_trg_passageiro() returns trigger language plpgsql as $f$ begin return null; end $f$;
create trigger cad_ficha_upd after update of cpf, passaporte, passaporte_validade, nascimento, email, telefone, mesclado_em_id
  on rel_clientes for each row execute function cad_trg_ficha();
create trigger cad_passageiro_ins after insert on passageiros for each row execute function cad_trg_passageiro();
create trigger cad_passageiro_upd after update of cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, cliente_id
  on passageiros for each row execute function cad_trg_passageiro();
