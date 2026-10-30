-- 0240_mkt_conteudo.sql
-- -----------------------------------------------------------------------------
-- ÁREA MARKETING + QUADRO DE CONTEÚDO + APROVAÇÃO (Bruno, 30/10/2026).
-- ESCRITA em 30/10/2026. NÃO APLICADA. Idempotente (pode rodar de novo).
--
-- "Um sistema pro pessoal do marketing, separando Orgânico e Tráfego; o Orgânico
--  pede aprovação de conteúdo (aprova ou volta); o Tráfego pede criativo/campanha
--  e reaproveita o que o Orgânico já fez; tudo num quadro estilo Trello."
--
-- O QUE MUDA EM PRODUÇÃO (só ACRESCENTA):
--   • setor novo 'marketing' (5ª porta do login). Quem tem: admin (todas), papel
--     'marketing' (ganha a porta, CONTINUA só leitura no Comercial), gestor que
--     marcar "Marketing" nas áreas, e quem o admin marcar "Também acessa: Marketing".
--   • qs_avisos aceita area = 'marketing' (o sino avisa "conteúdo pra aprovar").
--   • tabelas novas mkt_* com RLS PRÓPRIA. O gatilho de "só leitura" do papel
--     marketing (0036/0126, trg_<tabela>_espectador) só existe em tabelas qs_*
--     (laço `relname like 'qs\_%'` rodado uma vez na 0036) — as mkt_* ficam
--     fora dele de propósito, e esta migration NÃO mexe nesse gatilho.
--
-- PAPÉIS DENTRO DO MARKETING (mkt_equipe.papeis): 'organico', 'trafego',
-- 'gestor' (aprovador). Tabela própria em vez de qs_users.papeis porque:
--   (1) o gestor de Marketing sem o Comercial não grava em qs_users (gatilho
--       qs_bloqueia_espectador recusa); (2) o CHECK de qs_users.papeis é das
--       migrations do Rel/Saúde — não mexo no que é de outra área.
--
-- APROVADOR (mkt_eh_aprovador): admin; gestor com o setor Marketing; ou pessoa
-- do Marketing com o papel 'gestor' em mkt_equipe. Regra NO BANCO:
--   • card que está "Em aprovação" só sai pra "Aprovado" ou "Ajustes", e só pelo
--     aprovador;
--   • "Ajustes" vindo da aprovação só pela RPC mkt_devolver (comentário obrigatório);
--   • ninguém além do aprovador põe card em "Aprovado";
--   • "Publicado/Entregue" só recebe o que foi aprovado;
--   • rodada, status da aprovação e quem aprovou NÃO são editáveis pelo cliente
--     (o gatilho recalcula — PATCH pelo DevTools não adianta).
--
-- Funções que as outras frentes do Marketing (0241–0245) podem usar nas policies:
--   mkt_tem_acesso()  mkt_pode_gerir()  mkt_eh_aprovador(uuid)  mkt_papeis_de(uuid)
-- -----------------------------------------------------------------------------

-- ── 1) Setor 'marketing' ───────────────────────────────────────────────────
alter table qs_users drop constraint if exists qs_users_setores_check;
alter table qs_users add constraint qs_users_setores_check
  check (setores <@ array['comercial', 'relacionamento', 'financeiro', 'operacional', 'marketing'] and cardinality(setores) >= 1);

-- Mesma função vigente em 30/10 (0126), com duas linhas a mais: admin ganha o
-- Marketing e o papel 'marketing' ganha a porta do Marketing.
create or replace function qs_users_acerta_setores() returns trigger
language plpgsql as $$
begin
  if new.role = 'admin' then
    new.setores := array['comercial', 'relacionamento', 'financeiro', 'operacional', 'marketing'];
  elsif new.role in ('relacionamento', 'financeiro', 'operacional') then
    new.setores := array[new.role];
  elsif new.role = 'gestor' then
    if new.setores is null or cardinality(new.setores) = 0 then
      new.setores := array['comercial'];
    end if;
  else
    -- SDR, closer, marketing: sempre do Comercial (marketing segue só leitura lá).
    if new.setores is null or not ('comercial' = any(new.setores)) then
      new.setores := array_append(coalesce(new.setores, '{}'), 'comercial');
    end if;
    if new.role = 'marketing' and not ('marketing' = any(new.setores)) then
      new.setores := array_append(new.setores, 'marketing');
    end if;
  end if;
  return new;
end;
$$;

update qs_users set setores = array['comercial', 'relacionamento', 'financeiro', 'operacional', 'marketing']
 where role = 'admin' and not ('marketing' = any(coalesce(setores, '{}')));
update qs_users set setores = array_append(setores, 'marketing')
 where role = 'marketing' and not ('marketing' = any(coalesce(setores, '{}')));

-- O sino (0196) passa a aceitar avisos da área Marketing.
alter table qs_avisos drop constraint if exists qs_avisos_area_check;
alter table qs_avisos add constraint qs_avisos_area_check
  check (area = any (array['comercial', 'relacionamento', 'financeiro', 'operacional', 'marketing']));

-- ── 2) Acesso à área ───────────────────────────────────────────────────────
create or replace function mkt_tem_acesso() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role in ('admin', 'marketing') or 'marketing' = any(coalesce(setores, '{}')))
  );
$$;
revoke all on function mkt_tem_acesso() from public, anon;
grant execute on function mkt_tem_acesso() to authenticated;

-- ── 3) Tabelas ─────────────────────────────────────────────────────────────

-- Papéis de cada pessoa DENTRO do Marketing. Sem linha = sem papel definido
-- (vê e trabalha no quadro, não aprova).
create table if not exists mkt_equipe (
  user_id        uuid primary key references qs_users(id) on delete cascade,
  papeis         text[] not null default '{}' check (papeis <@ array['organico', 'trafego', 'gestor']::text[]),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references qs_users(id) on delete set null
);

-- Colunas do quadro, editáveis pelo gestor. `tipo` dá o SENTIDO da coluna pro
-- fluxo de aprovação (o nome é livre): só pode haver UMA de cada tipo especial.
create table if not exists mkt_colunas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) between 1 and 60),
  ordem         integer not null default 0,
  cor           text,
  tipo          text not null default 'livre'
                check (tipo in ('livre', 'entrada', 'aprovacao', 'ajustes', 'aprovado', 'publicado')),
  criado_em     timestamptz not null default now()
);
create unique index if not exists mkt_colunas_tipo_unico on mkt_colunas (tipo) where tipo <> 'livre';

create table if not exists mkt_cards (
  id               uuid primary key default gen_random_uuid(),
  titulo           text not null check (length(btrim(titulo)) between 1 and 200),
  descricao        text,
  tipo             text not null default 'reels'
                   check (tipo in ('reels', 'carrossel', 'story', 'video_longo', 'post', 'criativo_anuncio', 'campanha', 'outro')),
  origem           text not null default 'organico' check (origem in ('organico', 'trafego')),
  -- Pedido do Tráfego pro Orgânico (cai no quadro do Orgânico).
  eh_pedido        boolean not null default false,
  coluna_id        uuid not null references mkt_colunas(id) on delete restrict,
  ordem            double precision not null default 0,
  responsavel_id   uuid references qs_users(id) on delete set null,
  solicitante_id   uuid references qs_users(id) on delete set null,
  prazo            date,
  data_publicacao  date,
  expedicao_id     uuid references expedicoes(id) on delete set null,
  destino          text,
  tags             text[] not null default '{}',
  checklist        jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  link_publicacao  text,
  -- Reaproveitado de (Biblioteca → "Reaproveitar para tráfego").
  original_id      uuid references mkt_cards(id) on delete set null,
  -- Aprovação: SÓ o gatilho mexe nestes (ver mkt_cards_antes).
  rodada           integer not null default 0,
  status_aprovacao text not null default 'sem' check (status_aprovacao in ('sem', 'pendente', 'aprovado', 'devolvido')),
  aprovado_por     uuid references qs_users(id) on delete set null,
  aprovado_em      timestamptz,
  arquivado        boolean not null default false,
  criado_por       uuid references qs_users(id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists mkt_cards_coluna on mkt_cards (coluna_id, ordem) where not arquivado;
create index if not exists mkt_cards_publicacao on mkt_cards (data_publicacao) where data_publicacao is not null;
create index if not exists mkt_cards_biblioteca on mkt_cards (status_aprovacao) where status_aprovacao = 'aprovado';
create index if not exists mkt_cards_original on mkt_cards (original_id) where original_id is not null;

create table if not exists mkt_comentarios (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null references mkt_cards(id) on delete cascade,
  autor_id  uuid references qs_users(id) on delete set null,
  texto     text not null check (length(btrim(texto)) between 1 and 4000),
  -- 'devolucao' e 'aprovacao' só nascem pelas RPCs (policy de insert só deixa 'comentario').
  tipo      text not null default 'comentario' check (tipo in ('comentario', 'devolucao', 'aprovacao')),
  criado_em timestamptz not null default now()
);
create index if not exists mkt_comentarios_card on mkt_comentarios (card_id, criado_em);

-- Anexos: por enquanto link colado; a frente Drive (0241) entrega o seletor e
-- preenche drive_file_id/mime/thumb. Um anexo = um arquivo (do Drive ou link).
create table if not exists mkt_anexos (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references mkt_cards(id) on delete cascade,
  drive_file_id text,
  nome          text not null check (length(btrim(nome)) between 1 and 300),
  mime          text,
  url           text,
  thumb         text,
  criado_por    uuid references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  check (drive_file_id is not null or url is not null)
);
create index if not exists mkt_anexos_card on mkt_anexos (card_id);
create index if not exists mkt_anexos_drive on mkt_anexos (drive_file_id) where drive_file_id is not null;

-- Rodadas de aprovação: uma linha por envio. Só os gatilhos escrevem.
create table if not exists mkt_aprovacoes (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references mkt_cards(id) on delete cascade,
  rodada       integer not null,
  enviado_por  uuid references qs_users(id) on delete set null,
  enviado_em   timestamptz not null default now(),
  decisao      text check (decisao in ('aprovado', 'devolvido')),
  decidido_por uuid references qs_users(id) on delete set null,
  decidido_em  timestamptz,
  comentario   text,
  unique (card_id, rodada)
);

-- Histórico do card. Só os gatilhos escrevem.
create table if not exists mkt_historico (
  id        bigserial primary key,
  card_id   uuid not null references mkt_cards(id) on delete cascade,
  user_id   uuid references qs_users(id) on delete set null,
  acao      text not null,
  detalhe   text,
  criado_em timestamptz not null default now()
);
create index if not exists mkt_historico_card on mkt_historico (card_id, criado_em);

-- Colunas padrão (só se o quadro estiver vazio).
insert into mkt_colunas (nome, ordem, tipo)
select v.nome, v.ordem, v.tipo
  from (values
    ('Ideia / Pedido', 10, 'entrada'),
    ('Roteiro',        20, 'livre'),
    ('Gravação',       30, 'livre'),
    ('Edição',         40, 'livre'),
    ('Em aprovação',   50, 'aprovacao'),
    ('Ajustes',        60, 'ajustes'),
    ('Aprovado',       70, 'aprovado'),
    ('Publicado / Entregue', 80, 'publicado')
  ) as v(nome, ordem, tipo)
 where not exists (select 1 from mkt_colunas);

-- ── 4) Quem é quem ─────────────────────────────────────────────────────────
create or replace function mkt_papeis_de(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select papeis from mkt_equipe where user_id = p_user), '{}');
$$;

create or replace function mkt_eh_aprovador(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users u
     where u.id = p_user and u.is_active
       and (u.role = 'admin'
            or (u.role = 'gestor' and 'marketing' = any(coalesce(u.setores, '{}')))
            or ((u.role = 'marketing' or 'marketing' = any(coalesce(u.setores, '{}')))
                and exists (select 1 from mkt_equipe e where e.user_id = u.id and 'gestor' = any(e.papeis))))
  );
$$;

-- Quem configura (colunas, papéis) = quem aprova.
create or replace function mkt_pode_gerir() returns boolean
language sql stable security definer set search_path = public as $$
  select mkt_eh_aprovador(auth.uid());
$$;

revoke all on function mkt_papeis_de(uuid), mkt_eh_aprovador(uuid), mkt_pode_gerir() from public, anon;
grant execute on function mkt_papeis_de(uuid), mkt_eh_aprovador(uuid), mkt_pode_gerir() to authenticated;

-- Quem recebe o aviso "conteúdo pra aprovar": os gestores do Marketing; sem
-- nenhum, os admins (pra o pedido não morrer calado).
create or replace function mkt_aprovadores() returns setof uuid
language sql stable security definer set search_path = public as $$
  with g as (
    select u.id from qs_users u
     where u.is_active and u.role <> 'admin' and mkt_eh_aprovador(u.id)
  )
  select id from g
  union all
  select u.id from qs_users u
   where u.is_active and u.role = 'admin' and not exists (select 1 from g);
$$;
revoke all on function mkt_aprovadores() from public, anon;

-- Pessoas da área (pra escolher responsável e pra tela Equipe).
create or replace function mkt_pessoas()
returns table (id uuid, nome text, role text, papeis text[], aprovador boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.name, u.role, coalesce(e.papeis, '{}'), mkt_eh_aprovador(u.id)
    from qs_users u
    left join mkt_equipe e on e.user_id = u.id
   where mkt_tem_acesso()
     and u.is_active
     and (u.role in ('admin', 'marketing') or 'marketing' = any(coalesce(u.setores, '{}')))
   order by (u.role = 'admin'), u.name;
$$;
revoke all on function mkt_pessoas() from public, anon;
grant execute on function mkt_pessoas() to authenticated;

create or replace function mkt_definir_papeis(p_user uuid, p_papeis text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not mkt_pode_gerir() then
    raise exception 'Só o gestor de Marketing define os papéis.' using errcode = '42501';
  end if;
  if not exists (select 1 from qs_users where id = p_user and is_active
                   and (role in ('admin', 'marketing') or 'marketing' = any(coalesce(setores, '{}')))) then
    raise exception 'Essa pessoa não tem acesso ao Marketing (o admin libera em Configurações › Usuários).';
  end if;
  insert into mkt_equipe (user_id, papeis, atualizado_em, atualizado_por)
  values (p_user, coalesce(p_papeis, '{}'), now(), auth.uid())
  on conflict (user_id) do update
     set papeis = excluded.papeis, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function mkt_definir_papeis(uuid, text[]) from public, anon;
grant execute on function mkt_definir_papeis(uuid, text[]) to authenticated;

-- Expedições e pacotes pra ligar ao card (o Marketing não lê a tabela inteira).
create or replace function mkt_destinos()
returns table (id uuid, nome text, destino text, tipo text, data_embarque date)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, e.destino, e.tipo, e.data_embarque
    from expedicoes e
   where mkt_tem_acesso() and e.status::text <> 'Cancelada'
   order by e.data_embarque nulls last, e.nome;
$$;
revoke all on function mkt_destinos() from public, anon;
grant execute on function mkt_destinos() to authenticated;

-- ── 5) A regra da aprovação (gatilho ANTES) ────────────────────────────────
create or replace function mkt_cards_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t_old text;
  t_new text;
  servico boolean := auth.uid() is null;   -- SQL editor / service role
  aprov boolean := servico or mkt_eh_aprovador(auth.uid());
begin
  select tipo into t_new from mkt_colunas where id = new.coluna_id;

  if tg_op = 'INSERT' then
    new.rodada := 0;
    new.status_aprovacao := 'sem';
    new.aprovado_por := null;
    new.aprovado_em := null;
    new.criado_por := coalesce(auth.uid(), new.criado_por);
    new.criado_em := now();
    new.atualizado_em := now();
    if not servico and t_new in ('aprovacao', 'ajustes', 'aprovado', 'publicado') then
      raise exception 'Card novo começa numa coluna de trabalho; a aprovação vem depois.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Campos da aprovação: o cliente não escreve (vale o que o gatilho decidir).
  new.rodada := old.rodada;
  new.status_aprovacao := old.status_aprovacao;
  new.aprovado_por := old.aprovado_por;
  new.aprovado_em := old.aprovado_em;
  new.criado_por := old.criado_por;
  new.criado_em := old.criado_em;
  new.original_id := old.original_id;
  new.atualizado_em := now();

  if new.coluna_id is not distinct from old.coluna_id then return new; end if;
  select tipo into t_old from mkt_colunas where id = old.coluna_id;

  if t_old = 'aprovacao' then
    if not aprov then
      raise exception 'Está em aprovação: só o gestor de Marketing aprova ou devolve.' using errcode = '42501';
    end if;
    if t_new not in ('aprovado', 'ajustes') then
      raise exception 'Da aprovação o card só sai aprovado ou devolvido pra ajustes.' using errcode = '42501';
    end if;
  end if;

  if t_new = 'aprovacao' then
    new.rodada := old.rodada + 1;
    new.status_aprovacao := 'pendente';
  elsif t_new = 'aprovado' and t_old <> 'aprovado' then
    if not aprov then
      raise exception 'Só o gestor de Marketing aprova.' using errcode = '42501';
    end if;
    -- Aprovado direto (sem passar por "Em aprovação") também conta uma rodada.
    if t_old <> 'aprovacao' then new.rodada := old.rodada + 1; end if;
    new.status_aprovacao := 'aprovado';
    new.aprovado_por := auth.uid();
    new.aprovado_em := now();
  elsif t_new = 'ajustes' and t_old = 'aprovacao' then
    if coalesce(btrim(current_setting('mkt.devolucao', true)), '') = '' then
      raise exception 'Para devolver, use "Devolver com comentário" (o comentário é obrigatório).' using errcode = '42501';
    end if;
    new.status_aprovacao := 'devolvido';
  elsif t_new = 'publicado' then
    if old.status_aprovacao <> 'aprovado' and not aprov then
      raise exception 'Só vai pra Publicado / Entregue o que foi aprovado.' using errcode = '42501';
    end if;
  elsif t_old in ('aprovado', 'publicado') and t_new not in ('aprovado', 'publicado') then
    -- Reabriu um conteúdo aprovado pra mexer: a aprovação antiga deixa de valer.
    new.status_aprovacao := 'sem';
  end if;
  return new;
end $$;

drop trigger if exists trg_mkt_cards_antes on mkt_cards;
create trigger trg_mkt_cards_antes before insert or update on mkt_cards
  for each row execute function mkt_cards_antes();

-- ── 6) Histórico, rodadas e avisos (gatilho DEPOIS) ────────────────────────
create or replace function mkt_aviso(p_user uuid, p_titulo text, p_texto text, p_card uuid, p_chave text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  perform qs_aviso_criar(p_user, 'marketing', 'marketing', p_titulo, p_texto,
                         '#mkt/quadro/' || p_card::text, 'mkt_cards', p_card::text, p_chave);
end $$;
revoke all on function mkt_aviso(uuid, text, text, uuid, text) from public, anon, authenticated;

create or replace function mkt_cards_depois() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c_old text; c_new text; t_old text; t_new text;
  u uuid;
  obs text;
begin
  select nome, tipo into c_new, t_new from mkt_colunas where id = new.coluna_id;

  if tg_op = 'INSERT' then
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(),
            case when new.original_id is not null then 'reaproveitou' when new.eh_pedido then 'pediu' else 'criou' end,
            c_new);
    if new.eh_pedido then
      for u in
        select e.user_id from mkt_equipe e join qs_users q on q.id = e.user_id and q.is_active
         where 'organico' = any(e.papeis)
        union select * from mkt_aprovadores()
      loop
        perform mkt_aviso(u, 'Pedido do Tráfego: ' || new.titulo, new.descricao, new.id, 'mkt_pedido:' || new.id);
      end loop;
    end if;
    perform mkt_aviso(new.responsavel_id, 'Conteúdo pra você: ' || new.titulo, null, new.id, 'mkt_resp:' || new.id || ':' || new.responsavel_id);
    return new;
  end if;

  if new.coluna_id is distinct from old.coluna_id then
    select nome, tipo into c_old, t_old from mkt_colunas where id = old.coluna_id;
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(), 'moveu', coalesce(c_old, '?') || ' → ' || coalesce(c_new, '?'));

    if t_new = 'aprovacao' then
      insert into mkt_aprovacoes (card_id, rodada, enviado_por) values (new.id, new.rodada, auth.uid())
      on conflict (card_id, rodada) do nothing;
      for u in select * from mkt_aprovadores() loop
        perform mkt_aviso(u, 'Conteúdo pra aprovar: ' || new.titulo,
                          case when new.rodada > 1 then new.rodada || 'ª rodada' end,
                          new.id, 'mkt_aprov:' || new.id || ':' || new.rodada);
      end loop;
    elsif t_new = 'aprovado' and t_old <> 'aprovado' then
      obs := nullif(btrim(current_setting('mkt.aprovacao_obs', true)), '');
      insert into mkt_aprovacoes (card_id, rodada, enviado_por, decisao, decidido_por, decidido_em, comentario)
      values (new.id, new.rodada, auth.uid(), 'aprovado', auth.uid(), now(), obs)
      on conflict (card_id, rodada) do update
         set decisao = 'aprovado', decidido_por = auth.uid(), decidido_em = now(), comentario = excluded.comentario;
      for u in select distinct x from unnest(array[new.responsavel_id, new.criado_por, new.solicitante_id]) x where x is not null loop
        perform mkt_aviso(u, 'Aprovado: ' || new.titulo, obs, new.id, 'mkt_ok:' || new.id || ':' || new.rodada);
      end loop;
    elsif t_new = 'ajustes' and t_old = 'aprovacao' then
      obs := nullif(btrim(current_setting('mkt.devolucao', true)), '');
      update mkt_aprovacoes
         set decisao = 'devolvido', decidido_por = auth.uid(), decidido_em = now(), comentario = obs
       where card_id = new.id and rodada = new.rodada;
      for u in select distinct x from unnest(array[new.responsavel_id, new.criado_por]) x where x is not null loop
        perform mkt_aviso(u, 'Voltou pra ajustes: ' || new.titulo, obs, new.id, 'mkt_volta:' || new.id || ':' || new.rodada);
      end loop;
    end if;
  end if;

  if new.responsavel_id is distinct from old.responsavel_id then
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(), 'responsavel', (select name from qs_users where id = new.responsavel_id));
    perform mkt_aviso(new.responsavel_id, 'Conteúdo pra você: ' || new.titulo, null, new.id, 'mkt_resp:' || new.id || ':' || new.responsavel_id);
  end if;
  if new.prazo is distinct from old.prazo then
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(), 'prazo', coalesce(to_char(new.prazo, 'DD/MM/YYYY'), 'sem prazo'));
  end if;
  if new.data_publicacao is distinct from old.data_publicacao then
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(), 'publicacao', coalesce(to_char(new.data_publicacao, 'DD/MM/YYYY'), 'sem data'));
  end if;
  if new.arquivado is distinct from old.arquivado then
    insert into mkt_historico (card_id, user_id, acao, detalhe)
    values (new.id, auth.uid(), case when new.arquivado then 'arquivou' else 'desarquivou' end, null);
  end if;
  return new;
end $$;

drop trigger if exists trg_mkt_cards_depois on mkt_cards;
create trigger trg_mkt_cards_depois after insert or update on mkt_cards
  for each row execute function mkt_cards_depois();

create or replace function mkt_anexos_historico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into mkt_historico (card_id, user_id, acao, detalhe) values (new.card_id, auth.uid(), 'anexou', new.nome);
    return new;
  end if;
  -- card apagado em cascata: nada a registrar
  if exists (select 1 from mkt_cards where id = old.card_id) then
    insert into mkt_historico (card_id, user_id, acao, detalhe) values (old.card_id, auth.uid(), 'tirou_anexo', old.nome);
  end if;
  return old;
end $$;
drop trigger if exists trg_mkt_anexos_historico on mkt_anexos;
create trigger trg_mkt_anexos_historico after insert or delete on mkt_anexos
  for each row execute function mkt_anexos_historico();

-- Colunas especiais não somem (o fluxo de aprovação depende delas).
create or replace function mkt_colunas_protege() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo <> 'livre' then
      raise exception 'A coluna "%" faz parte da aprovação: dá pra renomear, não apagar.', old.nome;
    end if;
    return old;
  end if;
  if old.tipo <> 'livre' and new.tipo is distinct from old.tipo then
    raise exception 'A coluna "%" faz parte da aprovação: o papel dela não muda.', old.nome;
  end if;
  return new;
end $$;
drop trigger if exists trg_mkt_colunas_protege on mkt_colunas;
create trigger trg_mkt_colunas_protege before update or delete on mkt_colunas
  for each row execute function mkt_colunas_protege();

-- ── 7) RPCs do fluxo ───────────────────────────────────────────────────────
create or replace function mkt_topo_da_coluna(p_coluna uuid) returns double precision
language sql stable security definer set search_path = public as $$
  select coalesce(min(ordem), 1000) - 1 from mkt_cards where coluna_id = p_coluna and not arquivado;
$$;
revoke all on function mkt_topo_da_coluna(uuid) from public, anon;

create or replace function mkt_aprovar(p_card uuid, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare col uuid; obs text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  if not mkt_eh_aprovador(auth.uid()) then
    raise exception 'Só o gestor de Marketing aprova.' using errcode = '42501';
  end if;
  select id into col from mkt_colunas where tipo = 'aprovado';
  perform set_config('mkt.aprovacao_obs', coalesce(obs, ''), true);
  update mkt_cards set coluna_id = col, ordem = mkt_topo_da_coluna(col) where id = p_card;
  if not found then raise exception 'Card não encontrado.'; end if;
  if obs is not null then
    insert into mkt_comentarios (card_id, autor_id, texto, tipo) values (p_card, auth.uid(), obs, 'aprovacao');
  end if;
end $$;

create or replace function mkt_devolver(p_card uuid, p_comentario text) returns void
language plpgsql security definer set search_path = public as $$
declare col uuid; obs text := btrim(coalesce(p_comentario, ''));
begin
  if not mkt_eh_aprovador(auth.uid()) then
    raise exception 'Só o gestor de Marketing devolve.' using errcode = '42501';
  end if;
  if length(obs) < 3 then
    raise exception 'Escreva o que precisa ajustar (o comentário é obrigatório).';
  end if;
  if not exists (select 1 from mkt_cards c join mkt_colunas k on k.id = c.coluna_id where c.id = p_card and k.tipo = 'aprovacao') then
    raise exception 'Esse card não está em aprovação.';
  end if;
  select id into col from mkt_colunas where tipo = 'ajustes';
  perform set_config('mkt.devolucao', obs, true);
  update mkt_cards set coluna_id = col, ordem = mkt_topo_da_coluna(col) where id = p_card;
  insert into mkt_comentarios (card_id, autor_id, texto, tipo) values (p_card, auth.uid(), obs, 'devolucao');
end $$;

-- Biblioteca → "Reaproveitar para tráfego": card novo do Tráfego ligado ao
-- original, com os mesmos anexos (o arquivo é o mesmo; só o vínculo é novo).
create or replace function mkt_reaproveitar(p_card uuid, p_tipo text default 'criativo_anuncio', p_titulo text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare o mkt_cards; novo uuid; col uuid;
begin
  if not mkt_tem_acesso() then raise exception 'Sem acesso ao Marketing.' using errcode = '42501'; end if;
  select * into o from mkt_cards where id = p_card;
  if o.id is null then raise exception 'Conteúdo não encontrado.'; end if;
  if o.status_aprovacao <> 'aprovado' then raise exception 'Só dá pra reaproveitar conteúdo aprovado.'; end if;
  select id into col from mkt_colunas where tipo = 'entrada';
  insert into mkt_cards (titulo, descricao, tipo, origem, eh_pedido, coluna_id, ordem, responsavel_id, solicitante_id,
                         expedicao_id, destino, tags, original_id)
  values (coalesce(nullif(btrim(p_titulo), ''), left('Tráfego: ' || o.titulo, 200)),
          o.descricao, coalesce(p_tipo, 'criativo_anuncio'), 'trafego', false, col, mkt_topo_da_coluna(col),
          auth.uid(), auth.uid(), o.expedicao_id, o.destino, o.tags, o.id)
  returning id into novo;
  insert into mkt_anexos (card_id, drive_file_id, nome, mime, url, thumb, criado_por)
  select novo, drive_file_id, nome, mime, url, thumb, auth.uid() from mkt_anexos where card_id = o.id;
  return novo;
end $$;

revoke all on function mkt_aprovar(uuid, text), mkt_devolver(uuid, text), mkt_reaproveitar(uuid, text, text) from public, anon;
grant execute on function mkt_aprovar(uuid, text), mkt_devolver(uuid, text), mkt_reaproveitar(uuid, text, text) to authenticated;

-- ── 8) RLS ─────────────────────────────────────────────────────────────────
alter table mkt_equipe      enable row level security;
alter table mkt_colunas     enable row level security;
alter table mkt_cards       enable row level security;
alter table mkt_comentarios enable row level security;
alter table mkt_anexos      enable row level security;
alter table mkt_aprovacoes  enable row level security;
alter table mkt_historico   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mkt_equipe', 'mkt_colunas', 'mkt_cards', 'mkt_comentarios', 'mkt_anexos', 'mkt_aprovacoes', 'mkt_historico'] loop
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select to authenticated using (mkt_tem_acesso())', t || '_ler', t);
    -- Barreira do app do cliente (0210), como nas outras tabelas.
    execute format('drop policy if exists app_cliente_barreira on %I', t);
    execute format('create policy app_cliente_barreira on %I as restrictive for all to authenticated
                    using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()))', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- Colunas: só o gestor.
drop policy if exists mkt_colunas_gerir on mkt_colunas;
create policy mkt_colunas_gerir on mkt_colunas for all to authenticated
  using (mkt_pode_gerir()) with check (mkt_pode_gerir());

-- Cards: todo mundo da área cria e mexe (o gatilho segura a aprovação);
-- apagar só quem criou ou o gestor.
drop policy if exists mkt_cards_criar on mkt_cards;
create policy mkt_cards_criar on mkt_cards for insert to authenticated with check (mkt_tem_acesso());
drop policy if exists mkt_cards_mudar on mkt_cards;
create policy mkt_cards_mudar on mkt_cards for update to authenticated using (mkt_tem_acesso()) with check (mkt_tem_acesso());
drop policy if exists mkt_cards_apagar on mkt_cards;
create policy mkt_cards_apagar on mkt_cards for delete to authenticated
  using (mkt_tem_acesso() and (criado_por = auth.uid() or mkt_pode_gerir()));

-- Comentários: cada um escreve o seu, só do tipo 'comentario'.
drop policy if exists mkt_comentarios_criar on mkt_comentarios;
create policy mkt_comentarios_criar on mkt_comentarios for insert to authenticated
  with check (mkt_tem_acesso() and autor_id = auth.uid() and tipo = 'comentario');
drop policy if exists mkt_comentarios_mudar on mkt_comentarios;
create policy mkt_comentarios_mudar on mkt_comentarios for update to authenticated
  using (autor_id = auth.uid() and tipo = 'comentario') with check (autor_id = auth.uid() and tipo = 'comentario');
drop policy if exists mkt_comentarios_apagar on mkt_comentarios;
create policy mkt_comentarios_apagar on mkt_comentarios for delete to authenticated
  using ((autor_id = auth.uid() and tipo = 'comentario') or mkt_pode_gerir());

-- Anexos.
drop policy if exists mkt_anexos_criar on mkt_anexos;
create policy mkt_anexos_criar on mkt_anexos for insert to authenticated
  with check (mkt_tem_acesso() and criado_por = auth.uid());
drop policy if exists mkt_anexos_apagar on mkt_anexos;
create policy mkt_anexos_apagar on mkt_anexos for delete to authenticated
  using (mkt_tem_acesso() and (criado_por = auth.uid() or mkt_pode_gerir()));

-- mkt_equipe, mkt_aprovacoes, mkt_historico: só leitura pela API (escrita pelas
-- RPCs / gatilhos acima, que são security definer).
revoke insert, update, delete, truncate on mkt_equipe, mkt_aprovacoes, mkt_historico from authenticated;
grant select on mkt_equipe, mkt_aprovacoes, mkt_historico to authenticated;
grant select, insert, update, delete on mkt_colunas, mkt_cards, mkt_comentarios, mkt_anexos to authenticated;

-- ── CONFERÊNCIA (depois de aplicar) ────────────────────────────────────────
--   select nome, tipo from mkt_colunas order by ordem;            -- 8 colunas
--   select name, setores from qs_users where role in ('admin','marketing');  -- com 'marketing'
--   Logado como alguém do Marketing SEM papel gestor:
--     update mkt_cards set coluna_id = (select id from mkt_colunas where tipo='aprovado') where id = '<card>';
--     -- deve falhar: "Só o gestor de Marketing aprova."
--   Ainda logado como papel marketing: update qs_leads set full_name = 'x' ... -- continua recusado (0036)

-- ROLLBACK (à mão; nada fora das mkt_* depende disto):
-- drop function if exists mkt_reaproveitar(uuid, text, text), mkt_devolver(uuid, text), mkt_aprovar(uuid, text),
--   mkt_topo_da_coluna(uuid), mkt_destinos(), mkt_definir_papeis(uuid, text[]), mkt_pessoas(), mkt_aprovadores(),
--   mkt_aviso(uuid, text, text, uuid, text);
-- drop table if exists mkt_historico, mkt_aprovacoes, mkt_anexos, mkt_comentarios, mkt_cards, mkt_colunas, mkt_equipe cascade;
-- drop function if exists mkt_cards_antes(), mkt_cards_depois(), mkt_anexos_historico(), mkt_colunas_protege(),
--   mkt_pode_gerir(), mkt_eh_aprovador(uuid), mkt_papeis_de(uuid), mkt_tem_acesso();
-- delete from qs_avisos where area = 'marketing';
-- alter table qs_avisos drop constraint qs_avisos_area_check;
-- alter table qs_avisos add constraint qs_avisos_area_check check (area = any (array['comercial','relacionamento','financeiro','operacional']));
-- update qs_users set setores = array_remove(setores, 'marketing');
-- (recriar qs_users_acerta_setores como na 0126; depois:)
-- alter table qs_users drop constraint qs_users_setores_check;
-- alter table qs_users add constraint qs_users_setores_check
--   check (setores <@ array['comercial','relacionamento','financeiro','operacional'] and cardinality(setores) >= 1);
-- ATENÇÃO: as frentes 0241–0245 usam mkt_tem_acesso(); desfazer a 0240 exige desfazer elas antes.
