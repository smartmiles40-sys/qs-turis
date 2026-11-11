-- supabase/migrations/0356_venda_estado_pagamentos.sql
-- -----------------------------------------------------------------------------
-- SUBIR VENDA — SPRINT FINAL (11/11/2026), frente BANCO, parte 1: o MODELO.
-- Contrato comum: docs/SUBIR-VENDA-FINAL.md.
--
--   1) qs_vendas ganha o ESTADO da venda:
--        negociacao → (Reservar vaga) → reservada → (Consolidar) → consolidada
--        qualquer um → (Cancelar) → cancelada
--      + reservada_em / consolidada_em / cancelada_em / cancelada_motivo,
--      + obs_financeiro (observação livre pro Financeiro),
--      + rascunho (o estado inteiro da tela do Subir venda; a tela grava com debounce).
--      A venda NASCE em 'negociacao' quando o closer cadastra a família no cartão
--      (venda_familia_salvar, 0357) ou abre o Subir venda (venda_rascunho_salvar).
--      Uma venda por cartão continua (qs_vendas_negocio_unico).
--
--   2) qs_venda_pagamentos — o pagamento EM LINHAS (forma, valor, data, nº de
--      parcelas, obs). Soma das linhas = total da venda (conferido no Consolidar,
--      não no Salvar). Leitura = quem lê a venda (mesma RLS de qs_vendas, pela
--      subconsulta). Escrita só pelas RPCs (security definer) e service_role.
--
--   3) fin_planos.venda_id — o plano do Financeiro sabe de qual venda nasceu
--      (venda do Rel/Ops não tem cartão, e o plano dela é achado por aqui).
--
--   4) BACKFILL (só na 1ª vez que a coluna `estado` aparece — reaplicar não mexe
--      em nada): venda que já existia = foi registrada pelo fluxo antigo, que
--      ocupava vaga na hora → 'reservada' (reservada_em = pré-venda do cartão ou
--      criação); cartão com ficha consolidada → 'consolidada'. Em produção são
--      0 vendas em 11/11 — a regra existe pra ser idempotente e coerente.
--
-- Só acrescenta (nada de drop de coluna usada).
-- Volta:
--   drop table if exists qs_venda_pagamentos;
--   alter table fin_planos drop column if exists venda_id;
--   alter table qs_vendas drop constraint if exists qs_vendas_estado_check,
--     drop column if exists estado, drop column if exists reservada_em, drop column if exists consolidada_em,
--     drop column if exists cancelada_em, drop column if exists cancelada_motivo,
--     drop column if exists obs_financeiro, drop column if exists rascunho;
--   (antes, voltar venda_subir/fin_com_fonte_qs/_pax_valor_na_venda_trg das 0351/0329/0338.)
-- -----------------------------------------------------------------------------

-- ── 1) Estado da venda ──────────────────────────────────────────────────────
do $$
declare
  v_nova boolean := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'qs_vendas' and column_name = 'estado');
begin
  alter table qs_vendas add column if not exists estado           text not null default 'negociacao';
  alter table qs_vendas add column if not exists reservada_em     timestamptz;
  alter table qs_vendas add column if not exists consolidada_em   timestamptz;
  alter table qs_vendas add column if not exists cancelada_em     timestamptz;
  alter table qs_vendas add column if not exists cancelada_motivo text;
  alter table qs_vendas add column if not exists obs_financeiro   text;
  alter table qs_vendas add column if not exists rascunho         jsonb;

  -- Backfill só quando a coluna acabou de nascer (reaplicar a migration não
  -- "promove" venda nova em negociação).
  if v_nova then
    update qs_vendas v set
      estado         = case when n.consolidada_em is not null then 'consolidada' else 'reservada' end,
      reservada_em   = coalesce(n.pre_venda_em, n.consolidada_em, v.criado_em),
      consolidada_em = n.consolidada_em
      from qs_closer_negocios n
     where n.id = v.negocio_id;
    update qs_vendas set estado = 'reservada', reservada_em = criado_em
     where negocio_id is null and estado = 'negociacao';
  end if;
end $$;

alter table qs_vendas drop constraint if exists qs_vendas_estado_check;
alter table qs_vendas add constraint qs_vendas_estado_check
  check (estado in ('negociacao','reservada','consolidada','cancelada'));
alter table qs_vendas drop constraint if exists qs_vendas_rascunho_check;
alter table qs_vendas add constraint qs_vendas_rascunho_check
  check (rascunho is null or jsonb_typeof(rascunho) = 'object');

comment on column qs_vendas.estado is
  '0356: negociacao (cadastrando; NÃO ocupa vaga) → reservada (ocupa vaga, conta como venda, card em "Em emissão"; não expira) → consolidada (tudo preenchido; gerou viagem do Rel + contas a receber) | cancelada (passageiros cancelados, vaga volta).';
comment on column qs_vendas.rascunho is
  '0356: o estado inteiro da tela do Subir venda (a tela grava com debounce por venda_rascunho_salvar / venda_subir). Só a tela lê.';
comment on column qs_vendas.obs_financeiro is '0356: observação livre pro Financeiro (vai pro fin_planos.observacao no Consolidar).';

create index if not exists qs_vendas_estado on qs_vendas (estado, criado_em desc);

-- ── 2) Pagamento em linhas ──────────────────────────────────────────────────
create table if not exists qs_venda_pagamentos (
  id        uuid primary key default gen_random_uuid(),
  venda_id  uuid not null references qs_vendas(id) on delete cascade,
  ordem     int not null default 1,
  forma     text not null check (forma in ('pix','cartao','boleto','transferencia','dinheiro','link','outro')),
  valor     numeric(12,2) not null check (valor > 0),
  data      date,
  parcelas  int not null default 1 check (parcelas >= 1 and parcelas <= 48),
  obs       text,
  criado_em timestamptz not null default now()
);
comment on table qs_venda_pagamentos is
  '0356: pagamento da venda em linhas (forma, valor, data da 1ª, nº de parcelas, obs). Soma = qs_vendas.valor_total (conferido no venda_consolidar). Escrita só por venda_subir (security definer) / service_role.';
create index if not exists qs_venda_pagamentos_venda on qs_venda_pagamentos (venda_id, ordem);

alter table qs_venda_pagamentos enable row level security;
drop policy if exists qs_venda_pagamentos_ler on qs_venda_pagamentos;
-- Mesma visão de qs_vendas: a subconsulta roda com a RLS de qs_vendas (qs_vendas_ler).
create policy qs_venda_pagamentos_ler on qs_venda_pagamentos for select to authenticated
  using (exists (select 1 from qs_vendas v where v.id = venda_id));
revoke all on qs_venda_pagamentos from anon;
revoke insert, update, delete on qs_venda_pagamentos from authenticated;
grant select on qs_venda_pagamentos to authenticated;
grant all on qs_venda_pagamentos to service_role;

-- ── 3) O plano do Financeiro sabe de qual venda nasceu ──────────────────────
alter table fin_planos add column if not exists venda_id uuid references qs_vendas(id) on delete set null;
create unique index if not exists fin_planos_um_por_venda on fin_planos (venda_id) where venda_id is not null;
-- Plano que já existe de um cartão com venda: liga (idempotente).
update fin_planos p set venda_id = v.id
  from qs_vendas v
 where v.negocio_id = p.negocio_id and p.negocio_id is not null and p.venda_id is null
   and not exists (select 1 from fin_planos x where x.venda_id = v.id);
