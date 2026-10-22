-- 0196_avisos.sql
-- -----------------------------------------------------------------------------
-- AVISOS NA TELA (Bruno, 22/10/2026): "um widget pra notificar toda
-- atualização — um bip na tela; toda vez que a pessoa tiver uma nova
-- solicitação aparece na tela do computador dela; ícone bem pequeno que a
-- pessoa arrasta pela tela".
--
-- O QUE TEM AQUI
--   • qs_avisos: UMA linha por aviso, de UMA pessoa. Cada um só lê os seus.
--   • Gatilhos da Central de Solicitações (nova, passou pra você, concluída,
--     recusada, precisa de ajuste, reaberta, cancelada, comentário).
--   • qs_avisos_tempo(): o que depende do RELÓGIO (prazo vencendo/estourado,
--     reunião em ~10 min, etapas da Esteira que vencem hoje, resumo das
--     tarefas atrasadas do SDR às 9h). Roda pelo cron /api/avisos a cada 5 min.
--   • qs_avisos_limpar(): apaga lidos com mais de 30 dias (e não lidos com mais
--     de 90 dias).
--
-- REGRAS
--   • Nunca avisar 2x a mesma coisa: chave única por (user_id, chave).
--   • Nunca avisar quem fez a ação (auth.uid()).
--   • Pedido novo SEM DONO avisa quem é do setor de destino (qs_users.setores)
--     MENOS os admins — admin tem os 4 setores e viraria spam. Se o setor não
--     tiver ninguém além de admin, aí sim avisa os admins.
--   • Gatilho NUNCA derruba a ação principal: qualquer erro vira só warning.
--   • Desempenho (0195): regra de acesso com (select auth.uid()); o front
--     escuta Realtime FILTRADO por user_id e conta com 1 consulta no índice.
--
-- Idempotente (pode rodar de novo).
-- -----------------------------------------------------------------------------

-- ── 1. Tabela ───────────────────────────────────────────────────────────────
create table if not exists qs_avisos (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references qs_users(id) on delete cascade,
  -- 'solicitacao' | 'prazo' | 'reuniao' | 'esteira' | 'tarefas'
  tipo       text not null,
  -- área do QS onde o aviso abre (pra trocar de área ao clicar)
  area       text check (area in ('comercial', 'relacionamento', 'financeiro', 'operacional')),
  titulo     text not null,
  texto      text,
  -- rota do app: '#rel/solicitacoes/<id>', '#closer/agenda', '#comercial/lead/<id>'…
  link       text,
  origem     text,
  origem_id  text,
  chave      text not null,
  criado_em  timestamptz not null default now(),
  lido_em    timestamptz,
  constraint qs_avisos_chave_unica unique (user_id, chave)
);

create index if not exists qs_avisos_user_lido_idx on qs_avisos (user_id, lido_em, criado_em desc);
-- limpeza do cron
create index if not exists qs_avisos_lidos_idx on qs_avisos (lido_em) where lido_em is not null;

alter table qs_avisos enable row level security;

drop policy if exists qs_avisos_ler_os_meus on qs_avisos;
create policy qs_avisos_ler_os_meus on qs_avisos
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Sem policy de insert/update/delete: aviso nasce pelos gatilhos e o "lido"
-- passa pela RPC qs_avisos_marcar_lidos.

revoke all on qs_avisos from anon, public;
revoke insert, update, delete, truncate on qs_avisos from authenticated;
grant select on qs_avisos to authenticated;

-- Quando cada rotina "uma vez por dia" rodou pela última vez (Esteira, tarefas).
create table if not exists qs_avisos_rotina (
  nome        text primary key,
  ultimo_dia  date not null
);
alter table qs_avisos_rotina enable row level security;
revoke all on qs_avisos_rotina from anon, public, authenticated;

-- ── 2. Realtime ─────────────────────────────────────────────────────────────
-- (defensivo, como a 0009: só adiciona se ainda não estiver na publicação)
-- Replica identity PADRÃO basta: o front só escuta INSERT e UPDATE filtrados
-- por user_id, e nesses eventos a linha nova vai inteira. (FULL só faria falta
-- pra DELETE, que a tela não usa — e deixaria cada UPDATE mais pesado no WAL.)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'qs_avisos') then
    alter publication supabase_realtime add table qs_avisos;
  end if;
end $$;
alter table qs_avisos replica identity default;

-- ── 3. Peças internas ───────────────────────────────────────────────────────

-- Grava UM aviso (ignora repetido pela chave; ignora usuário inativo/inexistente).
create or replace function qs_aviso_criar(
  p_user uuid, p_tipo text, p_area text, p_titulo text, p_texto text, p_link text,
  p_origem text, p_origem_id text, p_chave text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_chave is null then return; end if;
  if not exists (select 1 from qs_users where id = p_user and is_active) then return; end if;
  insert into qs_avisos (user_id, tipo, area, titulo, texto, link, origem, origem_id, chave)
  values (p_user, p_tipo, p_area, left(p_titulo, 200), left(p_texto, 400), p_link, p_origem, p_origem_id, p_chave)
  on conflict (user_id, chave) do nothing;
end $$;

-- Quem RECEBE pedidos de um setor: ativos com o setor em qs_users.setores, sem
-- os admins (que têm todos os setores). Setor sem ninguém além de admin → admins.
create or replace function qs_avisos_recebedores(p_setor text)
returns setof uuid
language sql stable security definer set search_path = public as $$
  with gente as (
    select id, role from qs_users
     where is_active and p_setor = any(coalesce(setores, '{}'))
  )
  select id from gente where role <> 'admin'
  union all
  select id from gente where role = 'admin' and not exists (select 1 from gente where role <> 'admin');
$$;

-- Rota da Central pra uma pessoa: o Comercial do closer é a Área do Closer.
create or replace function qs_avisos_link_sol(p_setor text, p_user uuid, p_sol uuid)
returns text
language sql stable security definer set search_path = public as $$
  select '#' || case p_setor
      when 'relacionamento' then 'rel'
      when 'financeiro' then 'fin'
      when 'operacional' then 'ops'
      else case when (select role from qs_users where id = p_user) = 'closer' then 'closer' else 'comercial' end
    end || '/solicitacoes/' || p_sol::text;
$$;

create or replace function qs_avisos_nome_setor(p_setor text)
returns text language sql immutable set search_path = public as $$
  select case p_setor when 'comercial' then 'Comercial' when 'relacionamento' then 'Relacionamento'
                      when 'financeiro' then 'Financeiro' when 'operacional' then 'Operações' else coalesce(p_setor, '') end;
$$;

revoke execute on function qs_aviso_criar(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function qs_avisos_recebedores(text) from public, anon, authenticated;
revoke execute on function qs_avisos_link_sol(text, uuid, uuid) from public, anon, authenticated;

-- ── 4. Gatilhos da Central de Solicitações ──────────────────────────────────

-- 4a. Pedido NOVO → quem recebe pedidos do setor de destino (menos quem criou).
create or replace function qs_avisos_sol_nova()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  v_titulo text;
  v_texto text;
begin
  begin
    v_titulo := case when new.prioridade = 'urgente' then 'URGENTE · ' when new.prioridade = 'alta' then 'Alta · ' else '' end
             || 'Nova solicitação #' || new.numero || case when new.de_setor = 'operacional' then ' de ' else ' do ' end || qs_avisos_nome_setor(new.de_setor);
    v_texto := new.titulo || coalesce(' — ' || new.sobre_nome, '');
    for u in select * from qs_avisos_recebedores(new.para_setor) loop
      continue when u = new.criado_por;
      perform qs_aviso_criar(u, 'solicitacao', new.para_setor, v_titulo, v_texto,
        qs_avisos_link_sol(new.para_setor, u, new.id), 'qs_solicitacoes', new.id::text, 'sol_nova:' || new.id);
    end loop;
  exception when others then
    raise warning '[qs_avisos] pedido novo %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_qs_avisos_sol_nova on qs_solicitacoes;
create trigger trg_qs_avisos_sol_nova after insert on qs_solicitacoes
  for each row execute function qs_avisos_sol_nova();

-- 4b. Mudou dono / andamento → avisa o outro lado.
create or replace function qs_avisos_sol_mudou()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
  n text := '#' || new.numero;
  sobre text := new.titulo || coalesce(' — ' || new.sobre_nome, '');
  t text := extract(epoch from clock_timestamp())::bigint::text;
  cotacao boolean;
  u uuid;
begin
  begin
    -- Passou pra alguém (que não fui eu mesmo pegando)
    if new.responsavel_id is distinct from old.responsavel_id and new.responsavel_id is not null
       and new.responsavel_id is distinct from eu then
      perform qs_aviso_criar(new.responsavel_id, 'solicitacao', new.para_setor,
        'Solicitação ' || n || ' passou pra você', sobre,
        qs_avisos_link_sol(new.para_setor, new.responsavel_id, new.id), 'qs_solicitacoes', new.id::text,
        'sol_resp:' || new.id || ':' || new.responsavel_id || ':' || t);
    end if;

    if new.status is distinct from old.status or new.aguardando_quem is distinct from old.aguardando_quem then
      select (formulario = 'cotacao') into cotacao from qs_solicitacao_tipos where id = new.tipo_id;

      -- → quem PEDIU
      if new.criado_por is not null and new.criado_por is distinct from eu then
        if new.status = 'concluida' and old.status is distinct from 'concluida' then
          perform qs_aviso_criar(new.criado_por, 'solicitacao', new.de_setor,
            case when coalesce(cotacao, false) then 'Cotação ' || n || ' entregue — dê o desfecho' else 'Solicitação ' || n || ' concluída' end,
            coalesce(left(new.resolucao, 200), sobre),
            qs_avisos_link_sol(new.de_setor, new.criado_por, new.id), 'qs_solicitacoes', new.id::text,
            'sol_st:' || new.id || ':concluida:' || t);
        elsif new.status = 'recusada' and old.status is distinct from 'recusada' then
          perform qs_aviso_criar(new.criado_por, 'solicitacao', new.de_setor,
            'Solicitação ' || n || ' recusada', coalesce(left(new.resolucao, 200), sobre),
            qs_avisos_link_sol(new.de_setor, new.criado_por, new.id), 'qs_solicitacoes', new.id::text,
            'sol_st:' || new.id || ':recusada:' || t);
        elsif new.status = 'aguardando' and new.aguardando_quem = 'solicitante'
              and not (old.status = 'aguardando' and old.aguardando_quem = 'solicitante') then
          perform qs_aviso_criar(new.criado_por, 'solicitacao', new.de_setor,
            'Solicitação ' || n || ' precisa de ajuste seu', sobre,
            qs_avisos_link_sol(new.de_setor, new.criado_por, new.id), 'qs_solicitacoes', new.id::text,
            'sol_st:' || new.id || ':ajuste:' || t);
        elsif old.status = 'nova' and new.status = 'em_andamento' and new.responsavel_id is not null then
          perform qs_aviso_criar(new.criado_por, 'solicitacao', new.de_setor,
            'Pegaram sua solicitação ' || n,
            coalesce((select name from qs_users where id = new.responsavel_id), 'Alguém') || ' está cuidando: ' || sobre,
            qs_avisos_link_sol(new.de_setor, new.criado_por, new.id), 'qs_solicitacoes', new.id::text,
            'sol_st:' || new.id || ':aceita:' || t);
        end if;
      end if;

      -- → quem RECEBEU (dono; sem dono = o setor)
      if (old.status in ('concluida', 'recusada') and new.status in ('nova', 'em_andamento', 'aguardando'))
         or (old.status = 'aguardando' and old.aguardando_quem = 'solicitante' and new.status = 'nova')
         or (new.status = 'cancelada' and old.status is distinct from 'cancelada') then
        for u in
          select new.responsavel_id where new.responsavel_id is not null
          union all
          select r from qs_avisos_recebedores(new.para_setor) r
           where new.responsavel_id is null and new.status <> 'cancelada'
        loop
          continue when u is not distinct from eu or u = new.criado_por;
          perform qs_aviso_criar(u, 'solicitacao', new.para_setor,
            case when new.status = 'cancelada' then 'Solicitação ' || n || ' cancelada por quem pediu'
                 when old.status in ('concluida', 'recusada') then 'Solicitação ' || n || ' reaberta'
                 else 'Solicitação ' || n || ' ajustada — pode seguir' end,
            sobre, qs_avisos_link_sol(new.para_setor, u, new.id), 'qs_solicitacoes', new.id::text,
            'sol_st:' || new.id || ':' || new.status || ':' || t);
        end loop;
      end if;
    end if;
  exception when others then
    raise warning '[qs_avisos] solicitação %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_qs_avisos_sol_mudou on qs_solicitacoes;
create trigger trg_qs_avisos_sol_mudou after update of status, responsavel_id, aguardando_quem on qs_solicitacoes
  for each row
  when (old.status is distinct from new.status
        or old.responsavel_id is distinct from new.responsavel_id
        or old.aguardando_quem is distinct from new.aguardando_quem)
  execute function qs_avisos_sol_mudou();

-- 4c. Comentário → o outro lado (quem pediu e o dono, menos quem escreveu).
create or replace function qs_avisos_sol_evento()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s qs_solicitacoes;
  autor uuid := coalesce(new.autor_id, auth.uid());
begin
  begin
    select * into s from qs_solicitacoes where id = new.solicitacao_id;
    if s.id is null then return null; end if;
    if s.criado_por is not null and s.criado_por is distinct from autor then
      perform qs_aviso_criar(s.criado_por, 'solicitacao', s.de_setor,
        'Comentário na solicitação #' || s.numero,
        coalesce(new.autor_nome, 'Alguém') || ': ' || left(coalesce(new.texto, ''), 200),
        qs_avisos_link_sol(s.de_setor, s.criado_por, s.id), 'qs_solicitacao_eventos', new.id::text, 'sol_evt:' || new.id);
    end if;
    if s.responsavel_id is not null and s.responsavel_id is distinct from autor and s.responsavel_id is distinct from s.criado_por then
      perform qs_aviso_criar(s.responsavel_id, 'solicitacao', s.para_setor,
        'Comentário na solicitação #' || s.numero,
        coalesce(new.autor_nome, 'Alguém') || ': ' || left(coalesce(new.texto, ''), 200),
        qs_avisos_link_sol(s.para_setor, s.responsavel_id, s.id), 'qs_solicitacao_eventos', new.id::text, 'sol_evt:' || new.id);
    end if;
  exception when others then
    raise warning '[qs_avisos] evento %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_qs_avisos_sol_evento on qs_solicitacao_eventos;
create trigger trg_qs_avisos_sol_evento after insert on qs_solicitacao_eventos
  for each row when (new.tipo = 'comentario')
  execute function qs_avisos_sol_evento();

revoke execute on function qs_avisos_sol_nova() from public, anon, authenticated;
revoke execute on function qs_avisos_sol_mudou() from public, anon, authenticated;
revoke execute on function qs_avisos_sol_evento() from public, anon, authenticated;

-- ── 5. RPC do front: marcar como lido ───────────────────────────────────────
create or replace function qs_avisos_marcar_lidos(p_ids bigint[] default null, p_todos boolean default false)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
  n integer;
begin
  if eu is null then raise exception 'Entre no QS de novo.'; end if;
  update qs_avisos set lido_em = now()
   where user_id = eu and lido_em is null
     and (coalesce(p_todos, false) or id = any(coalesce(p_ids, '{}')));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function qs_avisos_marcar_lidos(bigint[], boolean) from public, anon;
grant execute on function qs_avisos_marcar_lidos(bigint[], boolean) to authenticated;

-- ── 6. O que depende do relógio (cron /api/avisos, a cada 5 min) ────────────
create or replace function qs_avisos_tempo()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  u uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  hora int := extract(hour from (now() at time zone 'America/Sao_Paulo'))::int;
  inicio_hoje timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  c_prazo int := 0; c_venceu int := 0; c_reuniao int := 0; c_esteira int := 0; c_tarefas int := 0;
begin
  -- Só o servidor (service_role) roda isto.
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão.';
  end if;

  -- 6a. Solicitação vencendo (faltam até 30 min) e estourada (nas últimas 2h).
  for r in
    select s.id, s.numero, s.titulo, s.sobre_nome, s.para_setor, s.responsavel_id, s.prazo,
           (s.prazo <= now()) venceu
      from qs_solicitacoes s
     where s.status in ('nova', 'em_andamento', 'aguardando')
       and s.prazo > now() - interval '2 hours' and s.prazo <= now() + interval '30 minutes'
  loop
    begin
      for u in
        select r.responsavel_id where r.responsavel_id is not null
        union all
        select x from qs_avisos_recebedores(r.para_setor) x where r.responsavel_id is null
      loop
        perform qs_aviso_criar(u, 'prazo', r.para_setor,
          case when r.venceu then 'Prazo estourado: solicitação #' || r.numero
               else 'Prazo vence em ' || greatest(1, ceil(extract(epoch from (r.prazo - now())) / 60))::int || ' min: solicitação #' || r.numero end,
          r.titulo || coalesce(' — ' || r.sobre_nome, ''),
          qs_avisos_link_sol(r.para_setor, u, r.id), 'qs_solicitacoes', r.id::text,
          (case when r.venceu then 'sol_venceu:' else 'sol_prazo30:' end) || r.id || ':' || extract(epoch from r.prazo)::bigint);
        if r.venceu then c_venceu := c_venceu + 1; else c_prazo := c_prazo + 1; end if;
      end loop;
    exception when others then raise warning '[qs_avisos] prazo %: %', r.id, sqlerrm;
    end;
  end loop;

  -- 6b. Reunião começando em ~10 min (janela de 12 min pro cron de 5 em 5 não pular).
  for r in
    select m.id, m.lead_id, m.scheduled_at, m.owner_id, m.closer_id,
           coalesce(nullif(m.lead_name, ''), nullif(m.title, ''), 'Reunião') nome
      from qs_meetings m
     where m.status in ('agendada', 'confirmada')
       and m.scheduled_at > now() and m.scheduled_at <= now() + interval '12 minutes'
  loop
    begin
      for u in select distinct x from unnest(array[r.owner_id, r.closer_id]) x where x is not null loop
        perform qs_aviso_criar(u, 'reuniao', 'comercial',
          'Reunião em ' || greatest(1, ceil(extract(epoch from (r.scheduled_at - now())) / 60))::int || ' min',
          r.nome || ' às ' || to_char(r.scheduled_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
          case when (select role from qs_users where id = u) = 'closer' then '#closer/agenda'
               when r.lead_id is not null then '#comercial/lead/' || r.lead_id
               else '#comercial/minha-agenda' end,
          'qs_meetings', r.id::text, 'reuniao:' || r.id || ':' || extract(epoch from r.scheduled_at)::bigint);
        c_reuniao := c_reuniao + 1;
      end loop;
    exception when others then raise warning '[qs_avisos] reunião %: %', r.id, sqlerrm;
    end;
  end loop;

  -- 6c. Esteira do Relacionamento: UM aviso por pessoa por dia (a partir das 8h),
  --     contando as etapas ATUAIS das viagens dela que vencem HOJE. Mesmas
  --     janelas de rel_esteira_atrasadas() / src/rel/lib/etapas.ts.
  if hora >= 8 and not exists (select 1 from qs_avisos_rotina where nome = 'esteira' and ultimo_dia >= hoje) then
    begin
      for r in
        with v as (
          select id, responsavel_id resp, data_venda venda, data_embarque ida, coalesce(data_retorno, data_embarque) volta,
                 coalesce(data_venda, data_embarque) base, acompanhamento acomp
            from rel_viagens_v
           where status = 'ativa' and acompanhamento in ('completo', 'leve') and data_embarque is not null
             and responsavel_id is not null
             and (fase in ('antes', 'em_viagem') or (fase = 'concluida' and data_retorno >= hoje - 10))
        ), e as (
          select v.id, v.resp, x.ordem, x.prazo,
            case
              when exists (select 1 from rel_viagem_etapas re where re.viagem_id = v.id and re.etapa = x.etapa and re.concluida_em is not null) then 'feita'
              when not (x.aplica and (v.acomp = 'completo' or x.etapa in ('revisao', 'd3'))) then 'nao_se_aplica'
              when x.prazo < date '2026-10-16' then 'zerada'
              when x.abre > hoje then 'aguardando'
              when x.prazo < hoje then 'atrasada'
              else 'a_fazer'
            end situacao
          from v cross join lateral (values
            (1, 'passagem',  v.base,     v.base + 2,  v.venda is not null and v.venda >= date '2026-10-16'),
            (2, 'revisao',   v.base,     v.base + 5,  v.venda is not null),
            (3, 'd30',       v.ida - 30, v.ida - 28,  v.venda is null or v.venda <= v.ida - 30),
            (4, 'd7',        v.ida - 7,  v.ida - 5,   v.venda is null or v.venda <= v.ida - 7),
            (5, 'd3',        v.ida - 3,  v.ida - 2,   true),
            (6, 'checkin',   v.ida - 2,  v.ida,       true),
            (7, 'em_viagem', v.ida,      v.volta,     true),
            (8, 'retorno',   v.volta,    v.volta + 3, true)
          ) x(ordem, etapa, abre, prazo, aplica)
        ), atual as (
          select distinct on (id) id, resp, prazo, situacao
            from e where situacao not in ('feita', 'nao_se_aplica', 'zerada')
           order by id, ordem
        )
        select resp, count(*) filter (where situacao = 'a_fazer' and prazo = hoje) vencem,
                     count(*) filter (where situacao = 'atrasada') atrasadas
          from atual group by resp
      loop
        continue when r.vencem = 0;
        perform qs_aviso_criar(r.resp, 'esteira', 'relacionamento',
          case when r.vencem = 1 then '1 etapa da Esteira vence hoje' else r.vencem || ' etapas da Esteira vencem hoje' end,
          case when r.atrasadas > 0 then 'E ' || r.atrasadas || ' já atrasada' || case when r.atrasadas > 1 then 's' else '' end || '. Abra "Minhas atividades".'
               else 'Abra "Minhas atividades" pra ver quais.' end,
          '#rel/esteira', 'rel_viagem_etapas', null, 'esteira:' || hoje);
        c_esteira := c_esteira + 1;
      end loop;
      insert into qs_avisos_rotina (nome, ultimo_dia) values ('esteira', hoje)
        on conflict (nome) do update set ultimo_dia = excluded.ultimo_dia;
    exception when others then raise warning '[qs_avisos] esteira: %', sqlerrm;
    end;
  end if;

  -- 6d. SDR: UM resumo por dia às 9h ("você tem N tarefas atrasadas") — nunca
  --     tarefa por tarefa (são centenas).
  if hora >= 9 and not exists (select 1 from qs_avisos_rotina where nome = 'tarefas' and ultimo_dia >= hoje) then
    begin
      for r in
        select t.owner_id, count(*) n
          from qs_tasks t
          join qs_users q on q.id = t.owner_id and q.is_active and q.role = 'sdr'
          left join qs_leads l on l.id = t.lead_id
         where t.status in ('pendente', 'atrasada') and t.scheduled_at < inicio_hoje
           and coalesce(l.status, '') not in ('ganho', 'perdido')
         group by t.owner_id
      loop
        perform qs_aviso_criar(r.owner_id, 'tarefas', 'comercial',
          case when r.n = 1 then 'Você tem 1 tarefa atrasada' else 'Você tem ' || r.n || ' tarefas atrasadas' end,
          'Comece o dia por elas no Painel.', '#comercial/painel', 'qs_tasks', null, 'tarefas:' || hoje);
        c_tarefas := c_tarefas + 1;
      end loop;
      insert into qs_avisos_rotina (nome, ultimo_dia) values ('tarefas', hoje)
        on conflict (nome) do update set ultimo_dia = excluded.ultimo_dia;
    exception when others then raise warning '[qs_avisos] tarefas: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object('prazo', c_prazo, 'venceu', c_venceu, 'reuniao', c_reuniao, 'esteira', c_esteira, 'tarefas', c_tarefas);
end $$;

-- ── 7. Limpeza (mesmo cron) ─────────────────────────────────────────────────
create or replace function qs_avisos_limpar()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Sem permissão.';
  end if;
  delete from qs_avisos
   where (lido_em is not null and lido_em < now() - interval '30 days')
      or (lido_em is null and criado_em < now() - interval '90 days');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function qs_avisos_tempo() from public, anon, authenticated;
revoke execute on function qs_avisos_limpar() from public, anon, authenticated;
grant execute on function qs_avisos_tempo() to service_role;
grant execute on function qs_avisos_limpar() to service_role;
