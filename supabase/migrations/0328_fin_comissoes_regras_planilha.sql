-- supabase/migrations/0328_fin_comissoes_regras_planilha.sql
-- -----------------------------------------------------------------------------
-- COMISSÕES, REGRAS DE VERDADE (Bruno, 09/11/2026 — PDF "Comissão por tipo de
-- produto · SDR e Closer", vigente em outubro/2026). A 0327 tinha um modelo
-- simples (fixo por R.R, fixo por expedição, % de aéreo e de pacote). O PDF pede:
--
--   SDR (venda originada)
--     Expedição Ásia/Europa/Egito (= qualquer outra) R$ 50 · Peru R$ 25 · Amazônia R$ 15
--     Pacote R$ 20 · Passagem/hospedagem/seguro/outros R$ 8
--     Aéreo vendido pelo próprio SDR: 10% do LUCRO
--     Cotação de aéreo (proposta) R$ 8
--   SDR (R.R): a faixa do mês vale pra TODAS as R.R do mês
--     até 40 → R$ 8 · 41–59 → R$ 12 · 60–89 → R$ 16 · 90+ → R$ 20
--   SDR (bônus diário de agendamentos): 6 no dia → R$ 20 · 10 no dia → R$ 40
--   Closer
--     Expedição R$ 500 · Peru R$ 250 · Amazônia R$ 150
--     Pacotes, aéreo e demais: % do LUCRO (Talita 11%, Bruno 10%)
--
-- O Bitrix NÃO traz custo (outubro: 0 de 73 vendas com custo) → o lucro é
-- digitado pelo Financeiro por card (fin_com_lucros). Se um dia o custo vier do
-- Bitrix (fin_com_vendas.custo > 0), lucro = total − custo; o digitado ganha.
--
-- Só ACRESCENTA: as colunas antigas de fin_com_regras (valor_rr, valor_expedicao,
-- pct_aereo, pct_pacote) ficam, sem uso, pra tela antiga não quebrar até o deploy.
-- Volta: drop table fin_com_lucros; drop function fin_com_cotacoes(date, date);
--        alter table fin_com_regras drop column valor_exp_geral, … (as novas).
-- -----------------------------------------------------------------------------

-- 1) Regras: os campos do PDF -------------------------------------------------
alter table fin_com_regras
  add column if not exists valor_exp_geral    numeric check (valor_exp_geral >= 0),
  add column if not exists valor_exp_peru     numeric check (valor_exp_peru >= 0),
  add column if not exists valor_exp_amazonia numeric check (valor_exp_amazonia >= 0),
  add column if not exists valor_pacote       numeric check (valor_pacote >= 0),
  add column if not exists valor_outros       numeric check (valor_outros >= 0),
  add column if not exists pct_lucro          numeric check (pct_lucro >= 0 and pct_lucro <= 100),
  add column if not exists valor_cotacao      numeric check (valor_cotacao >= 0),
  -- [{"de": 0, "valor": 8}, {"de": 41, "valor": 12}, …] — "de" = a partir de quantas R.R no mês
  add column if not exists faixas_rr          jsonb,
  -- [{"min": 6, "valor": 20}, {"min": 10, "valor": 40}] — vale a maior faixa batida no dia
  add column if not exists bonus_dia          jsonb,
  -- Exceção de uma pessoa que NÃO entra na comissão (ex.: supervisor). As vendas dela somem da conta.
  add column if not exists sem_comissao       boolean not null default false;

comment on column fin_com_regras.valor_rr is 'SEM USO desde a 0328 (faixas_rr).';
comment on column fin_com_regras.valor_expedicao is 'SEM USO desde a 0328 (valor_exp_*).';
comment on column fin_com_regras.pct_aereo is 'SEM USO desde a 0328 (pct_lucro / valor_outros).';
comment on column fin_com_regras.pct_pacote is 'SEM USO desde a 0328 (valor_pacote / pct_lucro).';

-- 2) Cards: data em que o SDR agendou (bônus diário) e custo (se vier) ----------
alter table fin_com_vendas
  add column if not exists data_quando_agendou date,
  add column if not exists custo numeric;
create index if not exists idx_fin_com_vendas_agendou on fin_com_vendas (data_quando_agendou);

-- 3) Lucro digitado pelo Financeiro (1 por card; o histórico fica no obs/quem) --
create table if not exists fin_com_lucros (
  bitrix_id     text primary key,
  lucro         numeric not null check (lucro >= 0),
  obs           text,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
alter table fin_com_lucros enable row level security;

drop policy if exists fin_com_lucros_ler on fin_com_lucros;
create policy fin_com_lucros_ler on fin_com_lucros for select to authenticated
  using (fin_tem_acesso() or exists (
    select 1 from fin_com_vendas v
     where v.bitrix_id = fin_com_lucros.bitrix_id and (v.sdr_id = auth.uid() or v.closer_id = auth.uid())));
drop policy if exists fin_com_lucros_mudar on fin_com_lucros;
create policy fin_com_lucros_mudar on fin_com_lucros for all to authenticated
  using (fin_tem_acesso()) with check (fin_tem_acesso());

create or replace function fin_com_lucros_carimbo() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end $$;
drop trigger if exists trg_fin_com_lucros_carimbo on fin_com_lucros;
create trigger trg_fin_com_lucros_carimbo before insert or update on fin_com_lucros
  for each row execute function fin_com_lucros_carimbo();

revoke all on fin_com_lucros from anon;
grant select, insert, update, delete on fin_com_lucros to authenticated;

-- 4) Cotações de aéreo entregues (R$ por proposta) ------------------------------
-- A tabela cotacoes (0321) só deixa o SDR/responsável/gestor ler; o Financeiro
-- não está lá. Esta função devolve só o necessário: o Financeiro vê todas, o
-- SDR só as dele. Conta a cotação que o PRÓPRIO SDR fez (não repassada ao
-- closer) e que foi entregue no período (entregue_em).
create or replace function fin_com_cotacoes(p_ini date, p_fim date)
returns table (id uuid, sdr_id uuid, destino text, status text, entregue_em timestamptz, negocio_bitrix_id text)
language sql stable security definer set search_path = public as $$
  select c.id, c.sdr_id, c.destino, c.status::text, c.entregue_em, c.negocio_bitrix_id
    from cotacoes c
   where c.entregue_em >= (p_ini::timestamp at time zone 'America/Sao_Paulo')
     and c.entregue_em <  (p_fim::timestamp at time zone 'America/Sao_Paulo')
     and not c.repassada_closer
     and (fin_tem_acesso() or c.sdr_id = auth.uid());
$$;
revoke all on function fin_com_cotacoes(date, date) from public, anon;
grant execute on function fin_com_cotacoes(date, date) to authenticated;

-- 5) As regras do PDF (vigentes desde 01/10/2026) -------------------------------
insert into fin_com_regras (papel, pessoa_id, vigente_desde, valor_exp_geral, valor_exp_peru, valor_exp_amazonia,
                            valor_pacote, valor_outros, pct_lucro, valor_cotacao, faixas_rr, bonus_dia, obs, criado_por)
values
  ('sdr', null, '2026-10-01', 50, 25, 15, 20, 8, 10, 8,
   '[{"de":0,"valor":8},{"de":41,"valor":12},{"de":60,"valor":16},{"de":90,"valor":20}]'::jsonb,
   '[{"min":6,"valor":20},{"min":10,"valor":40}]'::jsonb,
   'PDF "Comissão por tipo de produto" (outubro/2026, atualizado 06/11)', null),
  ('closer', null, '2026-10-01', 500, 250, 150, null, null, 10, null, null, null,
   'PDF "Comissão por tipo de produto" (outubro/2026) — % do Bruno Matheus como geral', null)
on conflict do nothing;

insert into fin_com_regras (papel, pessoa_id, vigente_desde, pct_lucro, obs, criado_por)
select 'closer', u.id, '2026-10-01', 11, 'PDF: Talita 11% do lucro', null
  from qs_users u where u.name = 'Talita Carvalho' and u.role = 'closer'
on conflict do nothing;

-- John Italo é supervisor: não entra na conta (Bruno, 09/11).
insert into fin_com_regras (papel, pessoa_id, vigente_desde, sem_comissao, obs, criado_por)
select p.papel, u.id, '2026-10-01', true, 'Supervisor: não entra na comissão (Bruno, 09/11)', null
  from qs_users u cross join (values ('sdr'), ('closer')) p(papel)
 where u.name = 'John Italo' and u.is_active
on conflict do nothing;
