-- =============================================================================
-- 0042 — CATÁLOGO DE CAMPOS DO BITRIX
-- -----------------------------------------------------------------------------
-- POR QUE: os workflows de Ganho e Reunião estavam desligados no n8n porque os
-- campos do funil estavam escritos como `PREENCHA_UF_*` dentro do fluxo. Toda
-- vez que alguém recriasse um campo no Bitrix, o workflow quebrava em silêncio.
--
-- O QUE MUDA: o n8n LÊ os campos do Bitrix todo dia e guarda aqui. O código
-- passa a falar por APELIDO (`resp_reuniao`), não por `UF_CRM_1712345678`.
-- Campo recriado no Bitrix vira um UPDATE de uma linha, e nada mais.
--
-- Estas tabelas são alimentadas SÓ pelo n8n (service_role). O app lê as opções
-- quando precisar montar um select.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente.
-- =============================================================================

-- ── (1) Os campos personalizados do negócio ─────────────────────────────────
create table if not exists public.bitrix_fields (
  field_name   text primary key,        -- UF_CRM_1712345678
  alias        text unique,             -- resp_reuniao — preenchido À MÃO, uma vez
  user_type_id text,                    -- enumeration | string | date | datetime | employee
  label        text,                    -- o rótulo que aparece no Bitrix
  mandatory    boolean default false,
  synced_at    timestamptz
);

comment on column public.bitrix_fields.alias is
  'Nome semântico usado nos workflows. O sync do Bitrix NUNCA sobrescreve esta coluna.';

-- ── (2) As opções das listas (é o option_id que o Bitrix aceita) ────────────
create table if not exists public.bitrix_field_options (
  field_name text   not null,
  option_id  bigint not null,
  value      text,                      -- o rótulo exibido
  sort       integer default 500,
  active     boolean default true,      -- false = sumiu do Bitrix no último sync
  synced_at  timestamptz,
  primary key (field_name, option_id)
);

create index if not exists idx_bitrix_options_field_active
  on public.bitrix_field_options (field_name, active);

-- ── (3) A visão que junta apelido + opções ──────────────────────────────────
create or replace view public.v_opcoes_por_alias as
  select f.alias,
         f.field_name,
         f.label as campo_label,
         o.option_id,
         o.value,
         o.sort
    from public.bitrix_fields f
    join public.bitrix_field_options o on o.field_name = f.field_name
   where f.alias is not null
     and o.active is true;

-- ── (4) RLS ─────────────────────────────────────────────────────────────────
-- Escrita: só o n8n, com service_role (que ignora RLS). Nenhuma policy de
-- insert/update aqui é proposital — o navegador não escreve neste catálogo.
alter table public.bitrix_fields        enable row level security;
alter table public.bitrix_field_options enable row level security;

drop policy if exists bitrix_fields_select on public.bitrix_fields;
create policy bitrix_fields_select on public.bitrix_fields
  for select to authenticated using (true);

drop policy if exists bitrix_options_select on public.bitrix_field_options;
create policy bitrix_options_select on public.bitrix_field_options
  for select to authenticated using (true);

grant select on public.bitrix_fields        to authenticated;
grant select on public.bitrix_field_options to authenticated;
grant select on public.v_opcoes_por_alias   to authenticated;

-- ── (5) DEPOIS do primeiro sync, aponte os apelidos ─────────────────────────
-- Veja o que o Bitrix tem:
--   select field_name, label, user_type_id from public.bitrix_fields order by label;
--
-- E então, trocando os UF_CRM_ pelos seus:
--   update public.bitrix_fields set alias = 'sdr_agendou'      where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'email_cliente'    where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'data_agendamento' where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'resp_reuniao'     where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'datahora_meet'    where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'produto_reuniao'  where field_name = 'UF_CRM_XXXXXXXXXX';
--
-- Opcionais — o workflow usa se existirem e ignora se não:
--   update public.bitrix_fields set alias = 'link_meet'        where field_name = 'UF_CRM_XXXXXXXXXX';
--   update public.bitrix_fields set alias = 'duracao_reuniao'  where field_name = 'UF_CRM_XXXXXXXXXX';
--
-- Conferir depois:
--   select alias, value, option_id from public.v_opcoes_por_alias order by alias, sort;
