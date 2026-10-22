-- 0175_fin_contas_receber.sql
-- -----------------------------------------------------------------------------
-- CONTAS A RECEBER DO FINANCEIRO (22/10/2026). Pedido antigo do Financeiro
-- ("parcelas, vencimentos, baixa") que agora tem de onde vir: a FICHA DE
-- FECHAMENTO do closer (0176) grava o PLANO DE PAGAMENTO aqui.
--
--   fin_planos   → um por venda consolidada (cliente, total, observação)
--   fin_parcelas → entrada (numero 0) + parcelas (1..n): valor, vencimento,
--                  forma (pix/boleto/cartão/link…), recorrente, observação.
--
-- Status gravado: a_receber | pago | cancelado. "Atrasado" NÃO é gravado — é
-- a_receber com vencimento antes de hoje (mesma regra da "Atrasada" do QS:
-- derivada da data, nunca gravada, pra não ficar velha).
--
-- Quem vê: Financeiro (fin_tem_acesso), gestor do Comercial/admin e o closer
-- DONO da venda. Quem dá baixa: só o Financeiro (fin_parcela_baixa).
-- Escrita só por RPC.
-- -----------------------------------------------------------------------------

create table if not exists fin_planos (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid references qs_closer_negocios(id) on delete set null,
  viagem_id    uuid references rel_viagens(id) on delete set null,
  lead_id      uuid references qs_leads(id) on delete set null,
  cliente_id   uuid references rel_clientes(id) on delete set null,
  cliente_nome text,
  closer_id    uuid references qs_users(id) on delete set null,
  valor_total  numeric(12,2) not null check (valor_total > 0),
  observacao   text,
  criado_por   uuid references qs_users(id) on delete set null,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists fin_planos_um_por_negocio on fin_planos (negocio_id) where negocio_id is not null;
create index if not exists fin_planos_viagem on fin_planos (viagem_id);

create table if not exists fin_parcelas (
  id          uuid primary key default gen_random_uuid(),
  plano_id    uuid not null references fin_planos(id) on delete cascade,
  numero      int not null check (numero >= 0),           -- 0 = entrada
  valor       numeric(12,2) not null check (valor > 0),
  vencimento  date not null,
  forma       text not null default 'pix' check (forma in ('pix','boleto','cartao','link','transferencia','dinheiro','outro')),
  recorrente  boolean not null default false,
  observacao  text,
  status      text not null default 'a_receber' check (status in ('a_receber','pago','cancelado')),
  pago_em     date,
  pago_valor  numeric(12,2),
  pago_por    uuid references qs_users(id) on delete set null,
  baixa_obs   text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (plano_id, numero)
);
create index if not exists fin_parcelas_vencimento on fin_parcelas (status, vencimento);

alter table fin_planos enable row level security;
alter table fin_parcelas enable row level security;

drop policy if exists fin_planos_ler on fin_planos;
create policy fin_planos_ler on fin_planos for select to authenticated
  using (fin_tem_acesso() or qs_is_manager() or closer_id = auth.uid());
drop policy if exists fin_parcelas_ler on fin_parcelas;
create policy fin_parcelas_ler on fin_parcelas for select to authenticated
  using (exists (select 1 from fin_planos p where p.id = plano_id
                  and (fin_tem_acesso() or qs_is_manager() or p.closer_id = auth.uid())));

revoke all on fin_planos, fin_parcelas from anon;
revoke insert, update, delete on fin_planos, fin_parcelas from authenticated;
grant select on fin_planos, fin_parcelas to authenticated;

-- ── Baixa (marcar pago / desfazer / cancelar) — só o Financeiro ─────────────
create or replace function fin_parcela_baixa(p_id uuid, p_acao text, p_data date default null, p_valor numeric default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  pa fin_parcelas;
begin
  if not fin_tem_acesso() then raise exception 'sem-permissao'; end if;
  select * into pa from fin_parcelas where id = p_id for update;
  if not found then raise exception 'parcela-nao-encontrada'; end if;
  if p_acao = 'pago' then
    update fin_parcelas set status = 'pago', pago_em = coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date),
           pago_valor = coalesce(p_valor, pa.valor), pago_por = auth.uid(), baixa_obs = nullif(trim(coalesce(p_obs, '')), ''),
           atualizado_em = now()
     where id = p_id;
  elsif p_acao = 'desfazer' then
    update fin_parcelas set status = 'a_receber', pago_em = null, pago_valor = null, pago_por = null, baixa_obs = null, atualizado_em = now()
     where id = p_id;
  elsif p_acao = 'cancelar' then
    update fin_parcelas set status = 'cancelado', baixa_obs = nullif(trim(coalesce(p_obs, '')), ''), atualizado_em = now() where id = p_id;
  else
    raise exception 'acao-invalida';
  end if;
end;
$$;
revoke all on function fin_parcela_baixa(uuid, text, date, numeric, text) from public, anon;
grant execute on function fin_parcela_baixa(uuid, text, date, numeric, text) to authenticated;

-- ── A lista das contas a receber (com cliente e viagem, pra uma tela só) ────
create or replace view fin_contas_receber_v with (security_invoker = true) as
select pa.id, pa.plano_id, pa.numero, pa.valor, pa.vencimento, pa.forma, pa.recorrente, pa.observacao,
       pa.status, pa.pago_em, pa.pago_valor, pa.baixa_obs,
       case when pa.status = 'a_receber' and pa.vencimento < (now() at time zone 'America/Sao_Paulo')::date
            then 'atrasado' else pa.status end as situacao,
       pl.cliente_nome, pl.cliente_id, pl.viagem_id, pl.lead_id, pl.negocio_id, pl.valor_total,
       pl.observacao as plano_observacao, pl.closer_id,
       (select u.name from qs_users u where u.id = pl.closer_id) as closer_nome,
       (select count(*) from fin_parcelas x where x.plano_id = pa.plano_id and x.numero > 0) as total_parcelas
  from fin_parcelas pa
  join fin_planos pl on pl.id = pa.plano_id;
revoke all on fin_contas_receber_v from anon;
grant select on fin_contas_receber_v to authenticated;
