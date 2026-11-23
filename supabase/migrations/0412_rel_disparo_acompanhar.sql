-- 0412 (23/11/2026) — ACOMPANHAR OS DISPAROS DO RELACIONAMENTO.
--
-- O Bruno mandou teste e "não chegou" sem saber por quê (era a trava
-- REL_DISPARO_ENVIO faltando na Vercel — o erro sumia num aviso de 3 s).
--   1. rel_disparo_testes — cada "Mandar teste" (disparo ou fluxo): quem, pra
--      quem, por qual número, deu certo ou o MOTIVO do erro, e o wamid (o recibo
--      entregue/lido aparece depois).
--   2. rel_disparo_acompanhar(p_desde) — o funil por número (enviadas →
--      entregues → lidas → clicaram, erros, pulados, na fila, simulados).

create table if not exists rel_disparo_testes (
  id               uuid primary key default gen_random_uuid(),
  criado_em        timestamptz not null default now(),
  user_id          uuid,
  user_nome        text,
  origem           text not null default 'disparo',   -- 'disparo' | 'fluxo'
  telefone         text,
  phone_number_id  text,
  modelo_nome      text,
  ok               boolean not null default false,
  erro             text,
  wamid            text,
  status           text                               -- sent | delivered | read | failed
);
create index if not exists rel_disparo_testes_criado_idx on rel_disparo_testes (criado_em desc);
create index if not exists rel_disparo_testes_wamid_idx on rel_disparo_testes (wamid) where wamid is not null;

alter table rel_disparo_testes enable row level security;
drop policy if exists rel_disparo_testes_ler on rel_disparo_testes;
create policy rel_disparo_testes_ler on rel_disparo_testes for select to authenticated using (rel_tem_acesso());
grant select on rel_disparo_testes to authenticated;
revoke insert, update, delete on rel_disparo_testes from authenticated;
revoke all on rel_disparo_testes from anon;

create or replace function rel_disparo_acompanhar(p_desde timestamptz)
returns table (
  phone_number_id text, enviados int, entregues int, lidos int, clicaram int, responderam int,
  erros int, pulados int, na_fila int, simulados int
)
language sql stable security definer set search_path = public as $$
  select e.phone_number_id,
         count(*) filter (where not e.simulado and e.status in ('enviado','entregue','lido','respondeu'))::int,
         count(*) filter (where not e.simulado and (e.status in ('entregue','lido','respondeu') or e.entregue_em is not null))::int,
         count(*) filter (where not e.simulado and (e.status in ('lido','respondeu') or e.lido_em is not null))::int,
         count(*) filter (where not e.simulado and e.clicou_em is not null)::int,
         count(*) filter (where not e.simulado and e.respondeu_em is not null)::int,
         count(*) filter (where e.status = 'erro')::int,
         count(*) filter (where e.status = 'pulado')::int,
         count(*) filter (where e.status = 'pendente')::int,
         count(*) filter (where e.simulado)::int
    from qs_disparo_envios e
    join qs_disparo_campanhas c on c.id = e.campanha_id
   where c.setor = 'relacionamento'
     and coalesce(e.enviado_em, e.criado_em) >= p_desde
   group by e.phone_number_id;
$$;
revoke all on function rel_disparo_acompanhar(timestamptz) from public, anon, authenticated;

-- Desfazer: drop function if exists rel_disparo_acompanhar(timestamptz); drop table if exists rel_disparo_testes;
