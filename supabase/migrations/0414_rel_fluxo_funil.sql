-- 0414 (23/11/2026) — FUNIL DO FLUXO IGUAL AO MANYCHAT
-- Cada mensagem que um fluxo do Rel manda passa a guardar o wamid no evento
-- (enviou_modelo = template, enviou = bloco Mensagem). O recibo da Meta já
-- atualiza rel_wa_mensagens.status (rel_wa_status), então entregue/lida saem
-- do cruzamento pelo wamid. Clique no link do bloco Mensagem passa por
-- /l/f/<execução>/<bloco> e vira o evento `clicou_link`.

alter table rel_fluxo_eventos add column if not exists wamid text;
create index if not exists rel_fluxo_eventos_wamid_idx on rel_fluxo_eventos (wamid) where wamid is not null;
create index if not exists rel_fluxo_eventos_exec_idx on rel_fluxo_eventos (execucao_id, tipo);

-- Por bloco: enviadas → entregues → lidas → clicaram no link (+ falharam).
-- p_disparo nulo = tudo do fluxo (testes incluídos).
create or replace function rel_fluxo_funil_blocos(p_fluxo uuid, p_disparo uuid default null)
returns table (no_id text, enviadas bigint, entregues bigint, lidas bigint, falharam bigint, clicaram_link bigint)
language sql stable security definer set search_path = public as $$
  with ev as (
    select e.* from rel_fluxo_eventos e
      join rel_fluxo_execucoes x on x.id = e.execucao_id
     where e.fluxo_id = p_fluxo and e.simulado = false
       and (p_disparo is null or x.disparo_id = p_disparo)
       and rel_tem_acesso()
  ), env as (
    select ev.no_id, m.status from ev left join rel_wa_mensagens m on m.wamid = ev.wamid
     where ev.wamid is not null and ev.tipo in ('enviou_modelo', 'enviou')
  ), cl as (
    select ev.no_id, count(distinct ev.execucao_id) n from ev where ev.tipo = 'clicou_link' group by 1
  ), agg as (
    select env.no_id,
           count(*) enviadas,
           count(*) filter (where env.status in ('delivered', 'read')) entregues,
           count(*) filter (where env.status = 'read') lidas,
           count(*) filter (where env.status = 'failed') falharam
      from env group by 1
  )
  select coalesce(agg.no_id, cl.no_id), coalesce(agg.enviadas, 0), coalesce(agg.entregues, 0), coalesce(agg.lidas, 0),
         coalesce(agg.falharam, 0), coalesce(cl.n, 0)
    from agg full join cl on cl.no_id = agg.no_id;
$$;
revoke all on function rel_fluxo_funil_blocos(uuid, uuid) from public, anon;
grant execute on function rel_fluxo_funil_blocos(uuid, uuid) to authenticated;

-- Por disparo: o funil do 1º contato (o template) + quem clicou em qualquer
-- botão/link do fluxo + quem chegou ao fim.
create or replace function rel_fluxo_disparo_funil(p_fluxo uuid)
returns table (disparo_id uuid, pessoas bigint, enviadas bigint, entregues bigint, lidas bigint, falharam bigint, clicaram bigint, terminaram bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select id, disparo_id, estado from rel_fluxo_execucoes
     where fluxo_id = p_fluxo and disparo_id is not null and rel_tem_acesso()
  ), tpl as (
    -- O template de cada execução (o 1º que saiu de verdade).
    select distinct on (e.execucao_id) e.execucao_id, m.status
      from rel_fluxo_eventos e join x on x.id = e.execucao_id
      left join rel_wa_mensagens m on m.wamid = e.wamid
     where e.tipo = 'enviou_modelo' and e.simulado = false and e.wamid is not null
     order by e.execucao_id, e.id
  ), cli as (
    select distinct e.execucao_id from rel_fluxo_eventos e join x on x.id = e.execucao_id
     where e.simulado = false and (e.tipo = 'clicou_link' or (e.tipo = 'saida' and e.saida like 'botao%'))
  )
  select x.disparo_id,
         count(*),
         count(tpl.execucao_id),
         count(*) filter (where tpl.status in ('delivered', 'read')),
         count(*) filter (where tpl.status = 'read'),
         count(*) filter (where tpl.status = 'failed' or x.estado = 'erro'),
         count(cli.execucao_id),
         count(*) filter (where x.estado = 'concluida')
    from x left join tpl on tpl.execucao_id = x.id left join cli on cli.execucao_id = x.id
   group by x.disparo_id;
$$;
revoke all on function rel_fluxo_disparo_funil(uuid) from public, anon;
grant execute on function rel_fluxo_disparo_funil(uuid) to authenticated;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   select * from rel_fluxo_funil_blocos(gen_random_uuid());  -- vazio, sem erro
--   select * from rel_fluxo_disparo_funil(gen_random_uuid());  -- vazio, sem erro
-- ── Volta ───────────────────────────────────────────────────────────────────
--   drop function if exists rel_fluxo_disparo_funil(uuid), rel_fluxo_funil_blocos(uuid, uuid);
--   drop index if exists rel_fluxo_eventos_wamid_idx, rel_fluxo_eventos_exec_idx;
--   alter table rel_fluxo_eventos drop column if exists wamid;
