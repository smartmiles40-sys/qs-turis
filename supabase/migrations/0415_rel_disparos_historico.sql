-- 0415 (23/11/2026) — HISTÓRICO DOS DISPAROS IGUAL AO MANYCHAT
-- Pedido do Bruno (prints do ManyChat): tabela Tipo · Nome · Início · Enviado ·
-- Entregue (%) · Lido (%) · Clicado (%), e o fluxo com Enviado/Entregue/Clicado
-- em cada bloco — recortável por disparo (abrir o disparo mostra os números DELE).
-- Mesma conta do ManyChat: Entregue % = /enviado; Lido % e Clicado % = /entregue.

-- ── 1. Funil por bloco com recorte (disparo OU só os testes) ────────────────
drop function if exists rel_fluxo_funil_blocos(uuid, uuid);
create or replace function rel_fluxo_funil_blocos(p_fluxo uuid, p_disparo uuid default null, p_testes boolean default false)
returns table (no_id text, enviadas bigint, entregues bigint, lidas bigint, falharam bigint, clicaram_link bigint)
language sql stable security definer set search_path = public as $$
  with ev as (
    select e.* from rel_fluxo_eventos e
      join rel_fluxo_execucoes x on x.id = e.execucao_id
     where e.fluxo_id = p_fluxo and e.simulado = false
       and (p_disparo is null or x.disparo_id = p_disparo)
       and (not p_testes or x.teste)
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
revoke all on function rel_fluxo_funil_blocos(uuid, uuid, boolean) from public, anon;
grant execute on function rel_fluxo_funil_blocos(uuid, uuid, boolean) to authenticated;

-- ── 2. Entrou/saídas por bloco com o mesmo recorte (CTR de cada botão) ─────
create or replace function rel_fluxo_estatisticas_recorte(p_fluxo uuid, p_disparo uuid default null, p_testes boolean default false)
returns table (no_id text, tipo text, saida text, total bigint)
language sql stable security definer set search_path = public as $$
  select e.no_id, e.tipo, coalesce(e.saida, ''), count(*)
    from rel_fluxo_eventos e
    join rel_fluxo_execucoes x on x.id = e.execucao_id
   where e.fluxo_id = p_fluxo and rel_tem_acesso()
     and (p_disparo is null or x.disparo_id = p_disparo)
     and (not p_testes or x.teste)
   group by 1, 2, 3;
$$;
revoke all on function rel_fluxo_estatisticas_recorte(uuid, uuid, boolean) from public, anon;
grant execute on function rel_fluxo_estatisticas_recorte(uuid, uuid, boolean) to authenticated;

-- ── 3. O histórico ──────────────────────────────────────────────────────────
-- tipo: fluxo (disparo de um fluxo) | teste (o "Testar" do fluxo, agrupado por
-- minuto) | simples (disparo simples do Rel). id = o disparo/campanha (nulo no teste).
create or replace function rel_disparos_historico(p_limite int default 30)
returns table (tipo text, id uuid, nome text, fluxo_id uuid, inicio timestamptz, status text,
               pessoas bigint, enviadas bigint, entregues bigint, lidas bigint, clicaram bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select x.id, x.fluxo_id, x.disparo_id, x.iniciada_em,
           coalesce(x.disparo_id::text, 'teste:' || x.fluxo_id || ':' || to_char(date_trunc('minute', x.iniciada_em), 'YYYYMMDDHH24MI')) grupo
      from rel_fluxo_execucoes x
     where (x.disparo_id is not null or x.teste) and rel_tem_acesso()
  ), tpl as (
    select distinct on (e.execucao_id) e.execucao_id, m.status
      from rel_fluxo_eventos e join x on x.id = e.execucao_id
      left join rel_wa_mensagens m on m.wamid = e.wamid
     where e.tipo = 'enviou_modelo' and e.simulado = false and e.wamid is not null
     order by e.execucao_id, e.id
  ), cli as (
    select distinct e.execucao_id from rel_fluxo_eventos e join x on x.id = e.execucao_id
     where e.simulado = false and (e.tipo = 'clicou_link' or (e.tipo = 'saida' and e.saida like 'botao%'))
  ), fx as (
    select x.grupo, (min(x.fluxo_id::text))::uuid fluxo_id, (min(x.disparo_id::text))::uuid disparo_id, min(x.iniciada_em) inicio,
           count(*) pessoas, count(tpl.execucao_id) enviadas,
           count(*) filter (where tpl.status in ('delivered', 'read')) entregues,
           count(*) filter (where tpl.status = 'read') lidas,
           count(cli.execucao_id) clicaram
      from x left join tpl on tpl.execucao_id = x.id left join cli on cli.execucao_id = x.id
     group by x.grupo
  ), linhas as (
    -- disparos de fluxo (também os agendados, ainda sem ninguém)
    select 'fluxo'::text tipo, d.id, f.nome, d.fluxo_id, coalesce(d.iniciado_em, d.agendado_para) inicio, d.status,
           coalesce(fx.pessoas, 0) pessoas, coalesce(fx.enviadas, 0) enviadas, coalesce(fx.entregues, 0) entregues,
           coalesce(fx.lidas, 0) lidas, coalesce(fx.clicaram, 0) clicaram
      from rel_fluxo_disparos d join rel_fluxos f on f.id = d.fluxo_id
      left join fx on fx.disparo_id = d.id
     where rel_tem_acesso()
    union all
    -- testes do fluxo
    select 'teste', null, f.nome, fx.fluxo_id, fx.inicio, 'concluido', fx.pessoas, fx.enviadas, fx.entregues, fx.lidas, fx.clicaram
      from fx join rel_fluxos f on f.id = fx.fluxo_id
     where fx.disparo_id is null
    union all
    -- disparos simples do Rel
    select 'simples', c.id, c.nome, null, coalesce(c.iniciada_em, c.agendada_para, c.criado_em), c.status,
           count(e.id),
           count(e.id) filter (where e.status in ('enviado', 'entregue', 'lido', 'respondeu')),
           count(e.id) filter (where e.status in ('entregue', 'lido', 'respondeu') or e.entregue_em is not null),
           count(e.id) filter (where e.status in ('lido', 'respondeu') or e.lido_em is not null),
           count(e.id) filter (where e.clicou_em is not null)
      from qs_disparo_campanhas c
      left join qs_disparo_envios e on e.campanha_id = c.id and e.simulado = false
     where c.setor = 'relacionamento' and rel_tem_acesso()
     group by c.id
  )
  select * from linhas order by inicio desc nulls last limit greatest(1, least(p_limite, 200));
$$;
revoke all on function rel_disparos_historico(int) from public, anon;
grant execute on function rel_disparos_historico(int) to authenticated;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   select * from rel_disparos_historico(10);   -- como service: vazio (rel_tem_acesso), sem erro
-- ── Volta ───────────────────────────────────────────────────────────────────
--   drop function if exists rel_disparos_historico(int), rel_fluxo_estatisticas_recorte(uuid, uuid, boolean);
--   (rel_fluxo_funil_blocos: recriar a versão de 2 parâmetros da 0414)
