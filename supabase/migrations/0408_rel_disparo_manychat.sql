-- =============================================================================
-- 0408 — DISPARO DO RELACIONAMENTO "IGUAL AO MANYCHAT" (19/11/2026)
-- =============================================================================
-- Pedido do Bruno (19/11): disparo em massa pelo número do Relacionamento com o
-- que o ManyChat tem — envio pelo servidor, imagem/vídeo no topo, agendar,
-- público por etiquetas, funil (entregue → lido → respondeu → clicou),
-- "clicou no botão → manda a próxima mensagem", ritmo e teto por dia.
--
-- O motor é o OFICIAL do Marketing (0341) adaptado ao Rel
-- (api/_relDisparoOficial.js). O QUE TEM AQUI (tudo aditivo):
--   1. rel_wa_modelos — cópia dos modelos da WABA do número do Relacionamento
--      (o Marketing tem a dele em mkt_wa_modelos; WABAs diferentes).
--   2. rel_cliente_etiquetas — as etiquetas (tags) do cliente, em minúsculas.
--   3. rel_disparo_segmentos — públicos salvos ("segmentos" do ManyChat).
--   4. qs_disparo_envios: clicou_em + botao (clique no botão ou no link).
--   5. qs_disparo_publico_rel: + etiquetas, sem_etiquetas, aniversário do mês,
--      viagem marcada (embarque de/até), estado (UF) e clientes escolhidos.
--      Mesmas colunas de saída da 0217.
--   6. mkt_disparo_kpis: + 'clicaram' e 'botoes' (cliques por botão).
--   7. qs_settings: rel_disparo_simulacao (true) e rel_disparo_ritmo.
--
-- Idempotente.
-- =============================================================================

-- ── 1. Modelos da WABA do Relacionamento ────────────────────────────────────
create table if not exists rel_wa_modelos (
  id                 uuid primary key default gen_random_uuid(),
  meta_id            text,
  waba_id            text,
  nome               text not null,
  idioma             text not null default 'pt_BR',
  categoria          text,
  status             text,
  formato_parametros text not null default 'POSITIONAL',
  corpo              text not null default '',
  cabecalho_formato  text,
  cabecalho_texto    text,
  rodape             text,
  botoes             jsonb not null default '[]',
  componentes        jsonb not null default '[]',
  motivo             text,
  sincronizado_em    timestamptz not null default now(),
  unique (nome, idioma)
);
alter table rel_wa_modelos enable row level security;
drop policy if exists rel_wa_modelos_ler on rel_wa_modelos;
create policy rel_wa_modelos_ler on rel_wa_modelos for select to authenticated using (rel_tem_acesso());
grant select on rel_wa_modelos to authenticated;
revoke insert, update, delete on rel_wa_modelos from authenticated;
revoke all on rel_wa_modelos from anon;

-- ── 2. Etiquetas do cliente ─────────────────────────────────────────────────
-- `etiqueta` sempre em minúsculas e sem espaço sobrando (o servidor e a tela
-- normalizam; o check garante). `origem`: manual | importacao | botao | disparo.
create table if not exists rel_cliente_etiquetas (
  cliente_id  uuid not null references rel_clientes(id) on delete cascade,
  etiqueta    text not null check (etiqueta = lower(btrim(etiqueta)) and length(etiqueta) between 1 and 40),
  origem      text not null default 'manual',
  criado_por  uuid references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now(),
  primary key (cliente_id, etiqueta)
);
create index if not exists rel_cliente_etiquetas_etiqueta_idx on rel_cliente_etiquetas (etiqueta);
alter table rel_cliente_etiquetas enable row level security;
drop policy if exists rel_cliente_etiquetas_ler on rel_cliente_etiquetas;
create policy rel_cliente_etiquetas_ler on rel_cliente_etiquetas for select to authenticated using (rel_tem_acesso());
drop policy if exists rel_cliente_etiquetas_por on rel_cliente_etiquetas;
create policy rel_cliente_etiquetas_por on rel_cliente_etiquetas for insert to authenticated with check (rel_tem_acesso());
drop policy if exists rel_cliente_etiquetas_tirar on rel_cliente_etiquetas;
create policy rel_cliente_etiquetas_tirar on rel_cliente_etiquetas for delete to authenticated using (rel_tem_acesso());
grant select, insert, delete on rel_cliente_etiquetas to authenticated;
revoke all on rel_cliente_etiquetas from anon;

-- Contagem por etiqueta (a tela de Contatos). security invoker: vale a RLS.
create or replace function rel_etiquetas_contagem()
returns table (etiqueta text, n int)
language sql stable security invoker set search_path = public as $$
  select e.etiqueta, count(*)::int
    from rel_cliente_etiquetas e
    join rel_clientes c on c.id = e.cliente_id
   where c.mesclado_em_id is null and c.arquivado_em is null
   group by 1 order by 2 desc, 1;
$$;
revoke all on function rel_etiquetas_contagem() from public, anon;
grant execute on function rel_etiquetas_contagem() to authenticated;

-- ── 3. Públicos salvos ──────────────────────────────────────────────────────
create table if not exists rel_disparo_segmentos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) >= 2),
  publico     jsonb not null default '{}',
  criado_por  uuid references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
alter table rel_disparo_segmentos enable row level security;
drop policy if exists rel_disparo_segmentos_ler on rel_disparo_segmentos;
create policy rel_disparo_segmentos_ler on rel_disparo_segmentos for select to authenticated using (rel_tem_acesso());
drop policy if exists rel_disparo_segmentos_por on rel_disparo_segmentos;
create policy rel_disparo_segmentos_por on rel_disparo_segmentos for insert to authenticated with check (rel_tem_acesso());
drop policy if exists rel_disparo_segmentos_tirar on rel_disparo_segmentos;
create policy rel_disparo_segmentos_tirar on rel_disparo_segmentos for delete to authenticated using (rel_tem_acesso());
grant select, insert, delete on rel_disparo_segmentos to authenticated;
revoke all on rel_disparo_segmentos from anon;

-- ── 4. Clique ───────────────────────────────────────────────────────────────
alter table qs_disparo_envios add column if not exists clicou_em timestamptz;
alter table qs_disparo_envios add column if not exists botao     text;
create index if not exists qs_disparo_envios_wamid_idx on qs_disparo_envios (wamid) where wamid is not null;

-- ── 5. Público do Relacionamento ────────────────────────────────────────────
-- p_publico (todos opcionais):
--   expedicao, destino, retorno_de, retorno_ate, sem_viagem_futura, niveis[],
--   viajou ('sim'|'nao'|'')                                   ← os da 0217
--   etiquetas[] + etiquetas_modo ('qualquer'|'todas')          ← novos
--   sem_etiquetas[]
--   aniversario_mes (1–12)
--   embarque_de, embarque_ate  → tem viagem MARCADA embarcando nesse intervalo
--   estados[] (UF)
--   clientes[] (ids)           → só esses (os outros filtros ainda valem)
create or replace function qs_disparo_publico_rel(p_publico jsonb)
returns table (
  cliente_id uuid, nome text, telefone text, viagem_id uuid, destino text, n_viagens int,
  nivel text, tem_futura boolean, optout boolean, conversa_24h boolean, disparo_recente boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  exped   text := nullif(trim(p_publico ->> 'expedicao'), '');
  dest    text := nullif(trim(p_publico ->> 'destino'), '');
  r_de    date := nullif(p_publico ->> 'retorno_de', '')::date;
  r_ate   date := nullif(p_publico ->> 'retorno_ate', '')::date;
  e_de    date := nullif(p_publico ->> 'embarque_de', '')::date;
  e_ate   date := nullif(p_publico ->> 'embarque_ate', '')::date;
  sem_fut boolean := coalesce((p_publico ->> 'sem_viagem_futura')::boolean, false);
  niveis  text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'niveis', '[]')));
  viajou  text := coalesce(p_publico ->> 'viajou', '');
  tags    text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(p_publico -> 'etiquetas', '[]')) x where btrim(x) <> '');
  todas   boolean := coalesce(p_publico ->> 'etiquetas_modo', '') = 'todas';
  sem_tags text[] := array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(p_publico -> 'sem_etiquetas', '[]')) x where btrim(x) <> '');
  aniv    int := nullif(p_publico ->> 'aniversario_mes', '')::int;
  ufs     text[] := array(select upper(btrim(x)) from jsonb_array_elements_text(coalesce(p_publico -> 'estados', '[]')) x where btrim(x) <> '');
  ids     uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_publico -> 'clientes', '[]')) x);
  dias    int := coalesce(nullif(p_publico ->> 'intervalo_dias', '')::int, 7);
begin
  return query
  with vg as (
    select p.cliente_id, v.id as viagem_id, v.destino, v.titulo, v.expedicao, v.data_embarque,
           coalesce(v.data_retorno, v.data_embarque) as volta
      from rel_viagem_passageiros p
      join rel_viagens v on v.id = p.viagem_id
     where v.status = 'ativa' and v.mesclada_em_id is null and v.arquivado_em is null
  ),
  por_cliente as (
    select c.id, c.nome, c.telefone,
           (select count(distinct x.viagem_id)::int from vg x where x.cliente_id = c.id and x.volta < hoje) as n,
           exists (select 1 from vg x where x.cliente_id = c.id and x.data_embarque >= hoje) as futura,
           (select x.viagem_id from vg x
             where x.cliente_id = c.id and x.volta < hoje
               and (exped is null or x.expedicao ilike '%' || exped || '%')
               and (dest  is null or x.destino ilike '%' || dest || '%' or x.titulo ilike '%' || dest || '%')
               and (r_de  is null or x.volta >= r_de)
               and (r_ate is null or x.volta <= r_ate)
             order by x.volta desc limit 1) as viagem_ok,
           -- A viagem MARCADA que casa com o embarque (e destino, se veio).
           (select x.viagem_id from vg x
             where x.cliente_id = c.id and x.data_embarque >= hoje
               and (e_de  is null or x.data_embarque >= e_de)
               and (e_ate is null or x.data_embarque <= e_ate)
               and (dest  is null or x.destino ilike '%' || dest || '%' or x.titulo ilike '%' || dest || '%')
             order by x.data_embarque limit 1) as futura_ok
      from rel_clientes c
     where c.mesclado_em_id is null and c.arquivado_em is null
       and c.telefone is not null and length(regexp_replace(c.telefone, '\D', '', 'g')) >= 10
       and (cardinality(ids) = 0 or c.id = any(ids))
       and (aniv is null or (c.nascimento is not null and extract(month from c.nascimento)::int = aniv))
       and (cardinality(ufs) = 0 or upper(coalesce(c.endereco_estado, '')) = any(ufs))
       and (cardinality(tags) = 0 or (
              case when todas
                then (select count(distinct e.etiqueta) from rel_cliente_etiquetas e where e.cliente_id = c.id and e.etiqueta = any(tags)) = cardinality(tags)
                else exists (select 1 from rel_cliente_etiquetas e where e.cliente_id = c.id and e.etiqueta = any(tags))
              end))
       and (cardinality(sem_tags) = 0 or not exists (select 1 from rel_cliente_etiquetas e where e.cliente_id = c.id and e.etiqueta = any(sem_tags)))
  ),
  -- A viagem que vai pras variáveis ({{destino}}): com filtro de embarque, a
  -- marcada; senão a feita que casou (ou, sem nenhuma, a marcada).
  pcv as (
    select x.*, case when e_de is not null or e_ate is not null then x.futura_ok
                     else coalesce(x.viagem_ok, x.futura_ok) end as vg_id
      from por_cliente x
  )
  select pc.id, pc.nome, pc.telefone, pc.vg_id,
         (select coalesce(v.destino, v.titulo) from rel_viagens v where v.id = pc.vg_id),
         pc.n,
         case when pc.n >= 10 then 'Lenda' when pc.n >= 5 then 'Aventureiro' when pc.n >= 3 then 'Explorador'
              when pc.n >= 1 then 'Viajante' else 'Estreante' end,
         pc.futura,
         rel_cliente_optout(pc.id),
         exists (select 1 from rel_wa_conversas w
                  where left(w.telefone, 4) = left(regexp_replace(pc.telefone, '\D', '', 'g'), 4)
                    and right(w.telefone, 8) = right(regexp_replace(pc.telefone, '\D', '', 'g'), 8)
                    and w.ultima_entrada_em >= now() - interval '24 hours'),
         exists (select 1 from qs_disparo_envios e
                  where e.cliente_id = pc.id and e.enviado_em >= now() - make_interval(days => dias) and not e.simulado)
    from pcv pc
   where (not sem_fut or not pc.futura)
     -- Filtro de viagem FEITA (expedição/retorno) exige uma viagem feita que case.
     and ((exped is null and r_de is null and r_ate is null) or pc.viagem_ok is not null)
     -- Filtro de embarque exige uma viagem MARCADA que case.
     and ((e_de is null and e_ate is null) or pc.futura_ok is not null)
     -- Destino sozinho casa viagem feita OU marcada.
     and (dest is null or exped is not null or r_de is not null or r_ate is not null or e_de is not null or e_ate is not null
          or pc.viagem_ok is not null or pc.futura_ok is not null)
     and (viajou = '' or (viajou = 'sim' and pc.n > 0) or (viajou = 'nao' and pc.n = 0))
     and (cardinality(niveis) = 0 or
          (case when pc.n >= 10 then 'Lenda' when pc.n >= 5 then 'Aventureiro' when pc.n >= 3 then 'Explorador'
                when pc.n >= 1 then 'Viajante' else 'Estreante' end) = any(niveis))
   order by pc.n desc, pc.nome;
end;
$$;
revoke all on function qs_disparo_publico_rel(jsonb) from public, anon, authenticated;

-- ── 6. KPIs: + cliques ──────────────────────────────────────────────────────
create or replace function mkt_disparo_kpis(p_campanha uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',       count(*),
    'na_fila',     count(*) filter (where status = 'pendente'),
    'enviados',    count(*) filter (where status in ('enviado', 'entregue', 'lido', 'respondeu')),
    'entregues',   count(*) filter (where status in ('entregue', 'lido', 'respondeu')),
    'lidos',       count(*) filter (where status in ('lido', 'respondeu')),
    'responderam', count(*) filter (where status = 'respondeu'),
    'clicaram',    count(*) filter (where clicou_em is not null),
    'falharam',    count(*) filter (where status = 'erro'),
    'pulados',     count(*) filter (where status = 'pulado'),
    'cancelados',  count(*) filter (where status = 'cancelado'),
    'simulados',   count(*) filter (where simulado),
    'botoes',      coalesce((select jsonb_object_agg(b, n) from (
                      select botao as b, count(*) as n from qs_disparo_envios
                       where campanha_id = p_campanha and botao is not null group by 1) z), '{}'::jsonb),
    'cobraveis',   coalesce((select jsonb_object_agg(cat, n) from (
                      select coalesce(cobranca_categoria, 'marketing') as cat, count(*) as n
                        from qs_disparo_envios
                       where campanha_id = p_campanha and not simulado
                         and (cobravel is true or (cobravel is null and status in ('entregue', 'lido', 'respondeu')))
                       group by 1) x), '{}'::jsonb),
    'erros',       coalesce((select jsonb_object_agg(cod, n) from (
                      select coalesce(erro_codigo::text, 'sem código') as cod, count(*) as n
                        from qs_disparo_envios
                       where campanha_id = p_campanha and status = 'erro'
                       group by 1) y), '{}'::jsonb),
    'ultimo_envio', max(enviado_em)
  )
  from qs_disparo_envios where campanha_id = p_campanha;
$$;
revoke all on function mkt_disparo_kpis(uuid) from public, anon, authenticated;
grant execute on function mkt_disparo_kpis(uuid) to service_role;

-- ── 7. Configuração ─────────────────────────────────────────────────────────
-- rel_disparo_simulacao: true = a fila anda e o funil aparece, mas nada sai.
-- rel_disparo_ritmo: o número é o MESMO do atendimento — teto mais baixo que o
-- do Marketing e margem menor do tier (o limite é do portfólio, que divide com
-- os números dos SDRs).
insert into qs_settings (key, value) values ('rel_disparo_simulacao', 'true'::jsonb)
on conflict (key) do nothing;
insert into qs_settings (key, value) values ('rel_disparo_ritmo',
  '{"por_segundo": 3, "por_dia": 400, "margem_tier": 0.6, "inicio": "09:00", "fim": "19:00", "dias": [1,2,3,4,5,6], "tier_padrao": "TIER_250", "intervalo_dias": 7}'::jsonb)
on conflict (key) do nothing;

-- =============================================================================
-- CONFERÊNCIA:
--   select count(*) from rel_wa_modelos;                 -- 0 até sincronizar
--   select * from rel_etiquetas_contagem();              -- vazio
--   select count(*) from qs_disparo_publico_rel('{}');   -- ~= clientes com telefone
--   select key, value from qs_settings where key like 'rel_disparo_%';
-- ROLLBACK (na mão):
--   drop table if exists rel_disparo_segmentos, rel_cliente_etiquetas, rel_wa_modelos;
--   drop function if exists rel_etiquetas_contagem();
--   alter table qs_disparo_envios drop column if exists clicou_em, drop column if exists botao;
--   (qs_disparo_publico_rel e mkt_disparo_kpis: reaplicar as versões da 0217 e da 0341)
--   delete from qs_settings where key in ('rel_disparo_simulacao', 'rel_disparo_ritmo');
-- =============================================================================
