-- 0409_rel_fluxos.sql
-- -----------------------------------------------------------------------------
-- CRIADOR DE FLUXOS DO RELACIONAMENTO "igual ao ManyChat" (19/11/2026).
--
-- O MESMO editor de fluxos do Marketing (src/mkt/automacoes/EditorFluxo.tsx,
-- blocos ligados por setas) agora também no Relacionamento, rodando pelo número
-- do Rel, nos clientes do Rel (rel_clientes) e nas etiquetas da 0408.
-- Tabelas PRÓPRIAS (não mistura com mkt_fluxos: outra RLS, outro número):
--
--   rel_fluxos            o fluxo (grafo jsonb no MESMO formato do Marketing)
--   rel_fluxo_disparos    "disparar este fluxo pra um público" (agora/agendado)
--   rel_fluxo_execucoes   onde cada cliente está no fluxo (o que aguenta esperar
--                         dias por um clique ou por um "Aguardar 2 dias")
--   rel_fluxo_eventos     cada passo (entrou/enviou/saída/erro) — os números
--                         que aparecem em cima de cada bloco no editor
--
-- Quem anda pelo fluxo: api/_relFluxoMotor.js (cron /api/disparos?rel=1 e o
-- webhook do número do Rel). Tela lê com rel_tem_acesso(); só o servidor
-- escreve execuções/eventos/disparos.
--
-- Depende da 0408 (rel_cliente_etiquetas, qs_disparo_publico_rel novo).
-- -----------------------------------------------------------------------------

-- ── 1. O fluxo ───────────────────────────────────────────────────────────────
create table if not exists rel_fluxos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (length(trim(nome)) between 1 and 120),
  descricao        text,
  status           text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado')),
  grafo            jsonb not null default '{"nos":[],"ligacoes":[]}',
  pasta            text,
  execucoes_total  int not null default 0,
  concluidas_total int not null default 0,
  criado_por       uuid references qs_users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create or replace function rel_fluxos_touch() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists trg_rel_fluxos_touch on rel_fluxos;
create trigger trg_rel_fluxos_touch before update on rel_fluxos for each row execute function rel_fluxos_touch();

alter table rel_fluxos enable row level security;
drop policy if exists rel_fluxos_ler on rel_fluxos;
create policy rel_fluxos_ler on rel_fluxos for select to authenticated using (rel_tem_acesso());
drop policy if exists rel_fluxos_criar on rel_fluxos;
create policy rel_fluxos_criar on rel_fluxos for insert to authenticated with check (rel_tem_acesso());
drop policy if exists rel_fluxos_mudar on rel_fluxos;
create policy rel_fluxos_mudar on rel_fluxos for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
drop policy if exists rel_fluxos_apagar on rel_fluxos;
create policy rel_fluxos_apagar on rel_fluxos for delete to authenticated using (rel_tem_acesso());
grant select, insert, update, delete on rel_fluxos to authenticated;
revoke all on rel_fluxos from anon;

-- ── 2. Disparar o fluxo pra um público ───────────────────────────────────────
create table if not exists rel_fluxo_disparos (
  id            uuid primary key default gen_random_uuid(),
  fluxo_id      uuid not null references rel_fluxos(id) on delete cascade,
  publico       jsonb not null default '{}',
  status        text not null default 'agendado' check (status in ('agendado', 'rodando', 'concluido', 'cancelado')),
  agendado_para timestamptz not null default now(),
  total         int not null default 0,
  excluidos     jsonb not null default '[]',
  criado_por    uuid references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  iniciado_em   timestamptz,
  concluido_em  timestamptz
);
create index if not exists rel_fluxo_disparos_fluxo_idx on rel_fluxo_disparos (fluxo_id, criado_em desc);
create index if not exists rel_fluxo_disparos_agendado_idx on rel_fluxo_disparos (agendado_para) where status = 'agendado';

-- ── 3. Onde cada cliente está ────────────────────────────────────────────────
create table if not exists rel_fluxo_execucoes (
  id           uuid primary key default gen_random_uuid(),
  fluxo_id     uuid not null references rel_fluxos(id) on delete cascade,
  disparo_id   uuid references rel_fluxo_disparos(id) on delete set null,
  cliente_id   uuid references rel_clientes(id) on delete set null,
  conversa_id  uuid references rel_wa_conversas(id) on delete set null,
  telefone     text not null,
  nome         text,
  viagem_id    uuid,
  no_atual     text,
  estado       text not null default 'rodando'
               check (estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo', 'concluida', 'cancelada', 'erro')),
  acordar_em   timestamptz,
  aguardando   jsonb,
  travada_ate  timestamptz,
  passos       int not null default 0,
  teste        boolean not null default false,
  erro         text,
  iniciada_em  timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  concluida_em timestamptz
);
-- Um cliente entra UMA vez em cada disparo.
create unique index if not exists rel_fluxo_execucoes_disparo_uidx on rel_fluxo_execucoes (disparo_id, telefone);  -- disparo nulo (teste) não colide
create index if not exists rel_fluxo_execucoes_acordar_idx on rel_fluxo_execucoes (acordar_em) where estado in ('aguardando_tempo', 'aguardando_resposta');
create index if not exists rel_fluxo_execucoes_tel_idx on rel_fluxo_execucoes (telefone) where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo');
create index if not exists rel_fluxo_execucoes_fluxo_idx on rel_fluxo_execucoes (fluxo_id, iniciada_em desc);

-- ── 4. Cada passo ────────────────────────────────────────────────────────────
create table if not exists rel_fluxo_eventos (
  id          bigserial primary key,
  fluxo_id    uuid not null references rel_fluxos(id) on delete cascade,
  execucao_id uuid references rel_fluxo_execucoes(id) on delete cascade,
  no_id       text,
  tipo        text not null,          -- entrou | enviou | enviou_modelo | saida | acao | erro
  saida       text,
  detalhe     text,
  simulado    boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index if not exists rel_fluxo_eventos_fluxo_idx on rel_fluxo_eventos (fluxo_id, no_id, tipo);
create index if not exists rel_fluxo_eventos_modelo_idx on rel_fluxo_eventos (criado_em) where tipo = 'enviou_modelo';

do $$
declare t text;
begin
  foreach t in array array['rel_fluxo_disparos', 'rel_fluxo_execucoes', 'rel_fluxo_eventos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select to authenticated using (rel_tem_acesso())', t || '_ler', t);
    execute format('grant select on %I to authenticated', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- ── 5. Funções do motor (só o servidor) ──────────────────────────────────────

-- Pega as execuções que chegou a hora (fim de "Aguardar", prazo de resposta,
-- início de disparo), travando 2 min pra duas rodadas não pegarem a mesma.
create or replace function rel_fluxo_reivindicar(p_limite int)
returns setof rel_fluxo_execucoes
language sql security definer set search_path = public as $$
  update rel_fluxo_execucoes x
     set travada_ate = now() + interval '2 minutes'
   where x.id in (
     select e.id from rel_fluxo_execucoes e
      where e.estado in ('aguardando_tempo', 'aguardando_resposta')
        and e.acordar_em is not null and e.acordar_em <= now()
        and (e.travada_ate is null or e.travada_ate < now())
      order by e.acordar_em
      limit greatest(1, least(p_limite, 500))
      for update skip locked)
  returning x.*;
$$;
revoke all on function rel_fluxo_reivindicar(int) from public, anon, authenticated;

-- Quantos MODELOS os fluxos mandaram desde `p_desde` (entra no teto do dia do número).
create or replace function rel_fluxo_contar_modelos(p_desde timestamptz, p_simulado boolean)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from rel_fluxo_eventos where tipo = 'enviou_modelo' and criado_em >= p_desde and simulado = p_simulado;
$$;
revoke all on function rel_fluxo_contar_modelos(timestamptz, boolean) from public, anon, authenticated;

create or replace function rel_fluxo_contar(p_fluxo uuid, p_concluiu boolean)
returns void language sql security definer set search_path = public as $$
  update rel_fluxos set execucoes_total = execucoes_total + case when p_concluiu then 0 else 1 end,
                        concluidas_total = concluidas_total + case when p_concluiu then 1 else 0 end
   where id = p_fluxo;
$$;
revoke all on function rel_fluxo_contar(uuid, boolean) from public, anon, authenticated;

-- Os números de cada bloco (mesmo formato da mkt_auto_estatisticas — o editor é o mesmo).
create or replace function rel_fluxo_estatisticas(p_fluxo uuid)
returns table (no_id text, tipo text, saida text, total bigint)
language sql stable security definer set search_path = public as $$
  select e.no_id, e.tipo, coalesce(e.saida, ''), count(*)
    from rel_fluxo_eventos e
   where e.fluxo_id = p_fluxo and rel_tem_acesso()
   group by 1, 2, 3;
$$;
revoke all on function rel_fluxo_estatisticas(uuid) from public, anon;
grant execute on function rel_fluxo_estatisticas(uuid) to authenticated;

-- Andamento de cada disparo: quantos em cada estado.
create or replace function rel_fluxo_disparo_resumo(p_fluxo uuid)
returns table (disparo_id uuid, estado text, total bigint)
language sql stable security definer set search_path = public as $$
  select x.disparo_id, x.estado, count(*)
    from rel_fluxo_execucoes x
   where x.fluxo_id = p_fluxo and x.disparo_id is not null and rel_tem_acesso()
   group by 1, 2;
$$;
revoke all on function rel_fluxo_disparo_resumo(uuid) from public, anon;
grant execute on function rel_fluxo_disparo_resumo(uuid) to authenticated;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   select count(*) from rel_fluxos;                         -- 0
--   select * from rel_fluxo_estatisticas(gen_random_uuid());  -- vazio, sem erro
--
-- ── Volta (rollback) ────────────────────────────────────────────────────────
--   drop function if exists rel_fluxo_disparo_resumo(uuid), rel_fluxo_estatisticas(uuid),
--     rel_fluxo_contar(uuid, boolean), rel_fluxo_contar_modelos(timestamptz, boolean), rel_fluxo_reivindicar(int);
--   drop table if exists rel_fluxo_eventos, rel_fluxo_execucoes, rel_fluxo_disparos, rel_fluxos;
--   drop function if exists rel_fluxos_touch();
