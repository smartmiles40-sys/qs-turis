-- 0318_exp_novas_vendas.sql
-- -----------------------------------------------------------------------------
-- Fila "Novas vendas" + retomada da sync automática Bitrix → passageiros (05/11/2026).
-- Porta do sistema antigo (685d5f8 / a0a7eb5). DEPENDE DA 0317, que cria
-- passageiros.nova_venda e expedicoes.bitrix_stage_id (aplique a 0317 antes).
--
-- 1) passageiros.nova_venda_em: QUANDO a pessoa entrou na fila. No antigo a tela
--    usava created_at — errado pro avulso que é ANEXADO à expedição (b1c8258): a
--    linha é antiga, mas a venda é de hoje. Um trigger carimba sozinho quando
--    nova_venda vira true (vale pra sync do QS, pro espelho e pra edição à mão).
-- 2) exp_bitrix_sync_rodadas: uma linha por dia × modo (seco/gravando) da sync
--    automática (api/_expBitrixSync.js). Guarda as expedições já feitas (retomada:
--    o cron roda 12:00, 12:15 e 12:30 UTC e continua de onde parou) e o resumo /
--    prévia do que foi (ou seria, no modo seco) feito. Só o servidor escreve.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'passageiros' and column_name = 'nova_venda') then
    raise exception 'Falta passageiros.nova_venda: aplique a 0317 antes da 0318.';
  end if;
end $$;

-- 1) Quando entrou na fila ------------------------------------------------------
alter table public.passageiros add column if not exists nova_venda_em timestamptz;

comment on column public.passageiros.nova_venda_em is
  'Quando a pessoa entrou na fila Novas vendas (nova_venda virou true). Carimbado pelo trigger trg_passageiros_nova_venda_em (0318).';

create or replace function public._exp_trg_nova_venda_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.nova_venda is true then
    if tg_op = 'INSERT' then
      new.nova_venda_em := coalesce(new.nova_venda_em, now());
    elsif old.nova_venda is distinct from true then
      new.nova_venda_em := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_passageiros_nova_venda_em on public.passageiros;
create trigger trg_passageiros_nova_venda_em
  before insert or update of nova_venda on public.passageiros
  for each row execute function public._exp_trg_nova_venda_em();

-- Quem já está na fila: usa a data de criação (melhor palpite).
update public.passageiros set nova_venda_em = created_at
 where nova_venda is true and nova_venda_em is null;

create index if not exists idx_passageiros_nova_venda_em
  on public.passageiros (nova_venda_em desc) where nova_venda;

-- 2) Rodadas da sync automática ------------------------------------------------
create table if not exists public.exp_bitrix_sync_rodadas (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null,
  modo          text not null check (modo in ('seco', 'gravando')),
  iniciado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  terminado_em  timestamptz,
  feitas        uuid[] not null default '{}',
  resumo        jsonb not null default '{}'::jsonb,
  unique (dia, modo)
);

comment on table public.exp_bitrix_sync_rodadas is
  'Sync automática Bitrix → passageiros (cron 12:00 UTC): expedições feitas no dia (retomada) e o resumo/prévia por expedição. Escrita só pela service role (api/_expBitrixSync.js).';

alter table public.exp_bitrix_sync_rodadas enable row level security;

drop policy if exists exp_bitrix_sync_rodadas_ler on public.exp_bitrix_sync_rodadas;
create policy exp_bitrix_sync_rodadas_ler on public.exp_bitrix_sync_rodadas
  for select to authenticated using ((select public.exp_tem_acesso()));

revoke all on public.exp_bitrix_sync_rodadas from anon;
revoke insert, update, delete on public.exp_bitrix_sync_rodadas from authenticated;
grant select on public.exp_bitrix_sync_rodadas to authenticated;
