-- =============================================================================
-- 0091 — PAINEL DE CONEXÃO DA CLOUD API (Cadastro Incorporado, "igual ManyChat")
-- -----------------------------------------------------------------------------
-- Bruno, 23/09/2026: conectar o WhatsApp clicando num botão, sem copiar token
-- nem id — e já preparado pra mais de um número (o oficial + os chips dos SDRs
-- no WhatsApp Business, pelo modo Coexistência).
--
-- Cada NÚMERO conectado é uma linha de qs_wa_numeros_meta (a tabela que a
-- entrada da Meta já usa pra saber de quem é o número — 0084). O TOKEN de cada
-- um vai pro Vault (criptografado); a tabela guarda só o id do segredo.
--
--   modo 'env'          → o número oficial de antes, com o token na Vercel
--   modo 'cloud'        → número conectado pelo botão, só na Cloud API
--   modo 'coexistencia' → WhatsApp Business do celular que também fala com o QS
-- =============================================================================

alter table qs_wa_numeros_meta add column if not exists waba_id        text;
alter table qs_wa_numeros_meta add column if not exists numero         text;
alter table qs_wa_numeros_meta add column if not exists nome_verificado text;
alter table qs_wa_numeros_meta add column if not exists modo           text not null default 'env';
alter table qs_wa_numeros_meta add column if not exists status         text not null default 'conectado';
alter table qs_wa_numeros_meta add column if not exists segredo_id     uuid;
alter table qs_wa_numeros_meta add column if not exists conectado_em   timestamptz;
alter table qs_wa_numeros_meta add column if not exists conectado_por  uuid;
alter table qs_wa_numeros_meta add column if not exists ultimo_erro    text;
alter table qs_wa_numeros_meta add column if not exists atualizado_em  timestamptz not null default now();

do $$ begin
  alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_modo_chk
    check (modo in ('env', 'cloud', 'coexistencia'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_status_chk
    check (status in ('conectado', 'desconectado', 'erro'));
exception when duplicate_object then null; end $$;

-- ── Guardar / trocar a conexão de um número (o token vai pro Vault) ────────
create or replace function qs_meta_guardar_conexao(
  p_phone   text,
  p_waba    text,
  p_numero  text,
  p_nome    text,
  p_modo    text,
  p_token   text,
  p_user    uuid default null,
  p_rotulo  text default null,
  p_por     uuid default null
) returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg  uuid;
  v_nome text := 'meta_token_' || p_phone;
begin
  if coalesce(p_phone, '') = '' or coalesce(p_token, '') = '' then
    raise exception 'dados-incompletos' using errcode = '22023';
  end if;

  select segredo_id into v_seg from qs_wa_numeros_meta where phone_number_id = p_phone;
  if v_seg is null then
    select id into v_seg from vault.secrets where name = v_nome;
  end if;
  if v_seg is null then
    v_seg := vault.create_secret(p_token, v_nome, 'Token da Cloud API do número ' || coalesce(p_numero, p_phone));
  else
    perform vault.update_secret(v_seg, p_token, v_nome);
  end if;

  insert into qs_wa_numeros_meta as n
    (phone_number_id, user_id, rotulo, waba_id, numero, nome_verificado, modo, status,
     segredo_id, conectado_em, conectado_por, ultimo_erro, atualizado_em)
  values
    (p_phone, p_user, coalesce(p_rotulo, p_nome, p_numero), p_waba, p_numero, p_nome, p_modo, 'conectado',
     v_seg, now(), p_por, null, now())
  on conflict (phone_number_id) do update set
    user_id = excluded.user_id,
    rotulo = coalesce(excluded.rotulo, n.rotulo),
    waba_id = excluded.waba_id,
    numero = coalesce(excluded.numero, n.numero),
    nome_verificado = coalesce(excluded.nome_verificado, n.nome_verificado),
    modo = excluded.modo,
    status = 'conectado',
    segredo_id = v_seg,
    conectado_em = now(),
    conectado_por = excluded.conectado_por,
    ultimo_erro = null,
    atualizado_em = now();
end;
$fn$;

-- ── O token de um número (só o servidor, com service_role, lê) ─────────────
create or replace function qs_meta_token(p_phone text)
returns text
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from qs_wa_numeros_meta n
    join vault.decrypted_secrets d on d.id = n.segredo_id
   where n.phone_number_id = p_phone
     and n.status = 'conectado'
   limit 1;
$fn$;

-- ── Desconectar: apaga o token e marca a linha ─────────────────────────────
create or replace function qs_meta_desconectar(p_phone text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare v_seg uuid;
begin
  select segredo_id into v_seg from qs_wa_numeros_meta where phone_number_id = p_phone;
  if v_seg is not null then
    delete from vault.secrets where id = v_seg;
  end if;
  update qs_wa_numeros_meta
     set status = 'desconectado', segredo_id = null, atualizado_em = now()
   where phone_number_id = p_phone;
end;
$fn$;

revoke all on function qs_meta_guardar_conexao(text, text, text, text, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function qs_meta_token(text) from public, anon, authenticated;
revoke all on function qs_meta_desconectar(text) from public, anon, authenticated;
grant execute on function qs_meta_guardar_conexao(text, text, text, text, text, text, uuid, text, uuid) to service_role;
grant execute on function qs_meta_token(text) to service_role;
grant execute on function qs_meta_desconectar(text) to service_role;
