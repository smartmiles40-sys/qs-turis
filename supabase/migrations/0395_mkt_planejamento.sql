-- 0395 — Marketing: PLANEJAMENTO DE CONTEÚDO (agência + interno), supervisores
--        por time, perfis/redes e o PORTAL DA AGÊNCIA (13/11/2026)
-- -----------------------------------------------------------------------------
-- Bruno (13/11): "a agência manda cronograma mensal/semanal em PDF sem dizer em
-- qual rede vai, sem data e sem horário — isso gera estresse no alinhamento.
-- Quero que o que eles mandam seja passado pro portal, revisado por IA e, se
-- faltar informação, volte pra eles". Cada conteúdo precisa de: título, formato,
-- referência, resumo de como adaptar pra marca, onde vai ser postado (perfil),
-- data e horário. Supervisores de cada área deixam obs. A agência diz se é
-- SEMANAL ou MENSAL. Aprovado → produção (link do Canva por conteúdo, com
-- aprovação). O time interno faz o mesmo dentro do QS, SEMANAL ou DIÁRIO,
-- dizendo em qual perfil (Instagram STFV / Jacque…) vai.
--
-- DECISÕES (conversa de 13/11):
--   • Agência = login PRÓPRIO, fora do Supabase Auth. Motivo (auditado no banco
--     vivo em 13/11): várias policies liberam QUALQUER `authenticated`
--     (qs_meetings SELECT true, qs_users SELECT true, qs_leads/qs_notes/qs_tasks/
--     qs_whatsapp_messages INSERT true…). Um usuário Supabase da agência leria e
--     escreveria nisso pela API. Então a agência NÃO é usuário do QS: tem conta
--     em mkt_agencia_contas (senha com bcrypt), sessão opaca em
--     mkt_agencia_sessoes (só o sha256 do token fica no banco) e TUDO passa pela
--     rota api/mkt-agencia.js com service_role, que só toca planejamento e os
--     cards de produção dela. As tabelas da agência não têm policy nenhuma.
--   • Supervisores por time: papéis novos sup_organico / sup_trafego em
--     mkt_equipe. Quem aprova/devolve o PLANEJAMENTO = supervisor do time do
--     planejamento, gestor de Marketing ou admin (mkt_eh_supervisor). O fluxo
--     dos CARDS continua como a 0266 deixou (todo o time aprova).
--   • Dar papel de gestor/supervisor passa a exigir gestor/admin (antes qualquer
--     pessoa do Marketing podia se promover: mkt_pode_gerir = todo o time, 0266).
--   • Perfis (onde posta): tabela editável; nasce com Instagram STFV/Jacque,
--     TikTok STFV/Jacque, LinkedIn STFV, YouTube STFV.
--   • Aprovado → cada conteúdo vira card no Quadro (coluna de entrada), com data,
--     horário e perfis; o da agência fica marcado (da_agencia) pra ela mandar o
--     link de produção pelo portal.
--
-- Aditiva. Rollback no fim.
-- -----------------------------------------------------------------------------

-- ── 1) Papéis: supervisores ────────────────────────────────────────────────
alter table mkt_equipe drop constraint if exists mkt_equipe_papeis_check;
alter table mkt_equipe add constraint mkt_equipe_papeis_check
  check (papeis <@ array['organico', 'trafego', 'gestor', 'sup_organico', 'sup_trafego']::text[]);

-- Gestor de Marketing = admin, gestor (papel do QS) com a área Marketing, ou papel 'gestor' em mkt_equipe.
create or replace function public.mkt_eh_gestor(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users u
     where u.id = p_user and u.is_active
       and (u.role = 'admin'
            or (u.role = 'gestor' and 'marketing' = any(coalesce(u.setores, '{}')))
            or exists (select 1 from mkt_equipe e where e.user_id = u.id and 'gestor' = any(e.papeis)))
  );
$$;

-- Supervisor do time (organico | trafego): gestor ou papel sup_<time>.
create or replace function public.mkt_eh_supervisor(p_user uuid, p_time text) returns boolean
language sql stable security definer set search_path = public as $$
  select mkt_eh_gestor(p_user) or exists (
    select 1 from qs_users u join mkt_equipe e on e.user_id = u.id
     where u.id = p_user and u.is_active
       and (u.role in ('admin', 'marketing') or 'marketing' = any(coalesce(u.setores, '{}')))
       and ('sup_' || p_time) = any(e.papeis)
  );
$$;
revoke all on function mkt_eh_gestor(uuid), mkt_eh_supervisor(uuid, text) from public, anon;
grant execute on function mkt_eh_gestor(uuid), mkt_eh_supervisor(uuid, text) to authenticated;

-- Definir papéis: igual à 0240, mas gestor/supervisor só quem é gestor dá ou tira.
create or replace function public.mkt_definir_papeis(p_user uuid, p_papeis text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  antes text[] := coalesce((select papeis from mkt_equipe where user_id = p_user), '{}');
  depois text[] := coalesce(p_papeis, '{}');
  altos text[] := array['gestor', 'sup_organico', 'sup_trafego'];
  mexe_alto boolean;
begin
  if not mkt_pode_gerir() then
    raise exception 'Só o gestor de Marketing define os papéis.' using errcode = '42501';
  end if;
  if not exists (select 1 from qs_users where id = p_user and is_active
                   and (role in ('admin', 'marketing') or 'marketing' = any(coalesce(setores, '{}')))) then
    raise exception 'Essa pessoa não tem acesso ao Marketing (o admin libera em Configurações › Usuários).';
  end if;
  mexe_alto := exists (
    select 1 from unnest(altos) a
     where (a = any(antes)) is distinct from (a = any(depois))
  );
  if mexe_alto and not mkt_eh_gestor(auth.uid()) then
    raise exception 'Só o gestor de Marketing (ou admin) dá ou tira os papéis de Gestor e Supervisor.' using errcode = '42501';
  end if;
  insert into mkt_equipe (user_id, papeis, atualizado_em, atualizado_por)
  values (p_user, depois, now(), auth.uid())
  on conflict (user_id) do update
     set papeis = excluded.papeis, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke all on function mkt_definir_papeis(uuid, text[]) from public, anon;
grant execute on function mkt_definir_papeis(uuid, text[]) to authenticated;

-- ── 2) Perfis / redes (onde o conteúdo é postado) ──────────────────────────
create table if not exists mkt_perfis (
  id        uuid primary key default gen_random_uuid(),
  rede      text not null check (rede in ('instagram', 'tiktok', 'linkedin', 'youtube', 'facebook', 'outra')),
  dono      text not null check (dono in ('stfv', 'jacque')),
  nome      text not null unique check (length(btrim(nome)) between 1 and 60),
  usuario   text check (usuario is null or length(usuario) <= 80),
  ativo     boolean not null default true,
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);
alter table mkt_perfis enable row level security;
drop policy if exists mkt_perfis_ler on mkt_perfis;
create policy mkt_perfis_ler on mkt_perfis for select to authenticated using ((select mkt_tem_acesso()));
drop policy if exists mkt_perfis_gerir on mkt_perfis;
create policy mkt_perfis_gerir on mkt_perfis for all to authenticated
  using ((select mkt_eh_gestor(auth.uid()))) with check ((select mkt_eh_gestor(auth.uid())));

insert into mkt_perfis (rede, dono, nome, ordem) values
  ('instagram', 'stfv',   'Instagram STFV',   10),
  ('instagram', 'jacque', 'Instagram Jacque', 20),
  ('tiktok',    'stfv',   'TikTok STFV',      30),
  ('tiktok',    'jacque', 'TikTok Jacque',    40),
  ('linkedin',  'stfv',   'LinkedIn STFV',    50),
  ('youtube',   'stfv',   'YouTube STFV',     60)
on conflict (nome) do nothing;

-- ── 3) Contas e sessões da AGÊNCIA (sem policy: só service_role) ───────────
create table if not exists mkt_agencia_contas (
  id             uuid primary key default gen_random_uuid(),
  agencia        text not null check (length(btrim(agencia)) between 1 and 80),
  nome           text not null check (length(btrim(nome)) between 1 and 80),
  email          text not null unique check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  senha_hash     text not null,
  ativo          boolean not null default true,
  tentativas     integer not null default 0,
  bloqueada_ate  timestamptz,
  ultimo_acesso  timestamptz,
  criado_por     uuid references qs_users(id) on delete set null,
  criado_em      timestamptz not null default now()
);
alter table mkt_agencia_contas enable row level security;

create table if not exists mkt_agencia_sessoes (
  token_hash text primary key,
  conta_id   uuid not null references mkt_agencia_contas(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null
);
create index if not exists mkt_agencia_sessoes_conta on mkt_agencia_sessoes (conta_id);
alter table mkt_agencia_sessoes enable row level security;

-- Admin/gestor: lista as contas (sem o hash).
create or replace function public.mkt_agencia_listar()
returns table (id uuid, agencia text, nome text, email text, ativo boolean, ultimo_acesso timestamptz, bloqueada_ate timestamptz, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not mkt_eh_gestor(auth.uid()) then
    raise exception 'Só o gestor de Marketing (ou admin) vê as contas da agência.' using errcode = '42501';
  end if;
  return query select c.id, c.agencia, c.nome, c.email, c.ativo, c.ultimo_acesso, c.bloqueada_ate, c.criado_em
                 from mkt_agencia_contas c order by c.agencia, c.nome;
end $$;

-- Admin/gestor: cria (p_id null) ou edita; senha só quando vier (>= 10 caracteres).
-- Desativar ou trocar a senha derruba as sessões abertas.
create or replace function public.mkt_agencia_salvar(
  p_id uuid, p_agencia text, p_nome text, p_email text, p_senha text, p_ativo boolean
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := p_id;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_senha text := coalesce(p_senha, '');
begin
  if not mkt_eh_gestor(auth.uid()) then
    raise exception 'Só o gestor de Marketing (ou admin) cadastra a agência.' using errcode = '42501';
  end if;
  if v_senha <> '' and length(v_senha) < 10 then
    raise exception 'A senha precisa de pelo menos 10 caracteres.';
  end if;
  if v_id is null then
    if v_senha = '' then raise exception 'Defina uma senha para a conta nova.'; end if;
    insert into mkt_agencia_contas (agencia, nome, email, senha_hash, ativo, criado_por)
    values (btrim(p_agencia), btrim(p_nome), v_email, crypt(v_senha, gen_salt('bf', 10)), coalesce(p_ativo, true), auth.uid())
    returning id into v_id;
  else
    update mkt_agencia_contas
       set agencia = btrim(p_agencia), nome = btrim(p_nome), email = v_email,
           ativo = coalesce(p_ativo, ativo),
           senha_hash = case when v_senha <> '' then crypt(v_senha, gen_salt('bf', 10)) else senha_hash end,
           tentativas = case when v_senha <> '' then 0 else tentativas end,
           bloqueada_ate = case when v_senha <> '' then null else bloqueada_ate end
     where id = v_id;
    if not found then raise exception 'Conta não encontrada.'; end if;
    if v_senha <> '' or coalesce(p_ativo, true) = false then
      delete from mkt_agencia_sessoes where conta_id = v_id;
    end if;
  end if;
  return v_id;
end $$;
revoke all on function mkt_agencia_listar(), mkt_agencia_salvar(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function mkt_agencia_listar(), mkt_agencia_salvar(uuid, text, text, text, text, boolean) to authenticated;

-- SÓ SERVICE_ROLE (a rota api/mkt-agencia.js): login com trava de tentativas.
-- 5 erros seguidos = 15 min bloqueada. Devolve o token UMA vez (o banco guarda o sha256).
create or replace function public.mkt_agencia_login(p_email text, p_senha text)
returns table (token text, conta_id uuid, nome text, agencia text, erro text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  c mkt_agencia_contas;
  t text;
begin
  select * into c from mkt_agencia_contas where email = lower(btrim(coalesce(p_email, '')));
  if not found or not c.ativo then
    -- Mesmo custo de um bcrypt de verdade (não revela se o e-mail existe pelo tempo).
    perform crypt(coalesce(p_senha, ''), gen_salt('bf', 10));
    return query select null::text, null::uuid, null::text, null::text, 'E-mail ou senha inválidos.'::text; return;
  end if;
  if c.bloqueada_ate is not null and c.bloqueada_ate > now() then
    return query select null::text, null::uuid, null::text, null::text,
      ('Muitas tentativas. Tente de novo depois das ' || to_char(c.bloqueada_ate at time zone 'America/Sao_Paulo', 'HH24:MI') || '.')::text;
    return;
  end if;
  if c.senha_hash <> crypt(coalesce(p_senha, ''), c.senha_hash) then
    update mkt_agencia_contas
       set tentativas = tentativas + 1,
           bloqueada_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = c.id;
    return query select null::text, null::uuid, null::text, null::text, 'E-mail ou senha inválidos.'::text; return;
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into mkt_agencia_sessoes (token_hash, conta_id, expira_em)
  values (encode(digest(t, 'sha256'), 'hex'), c.id, now() + interval '12 hours');
  update mkt_agencia_contas set tentativas = 0, bloqueada_ate = null, ultimo_acesso = now() where id = c.id;
  delete from mkt_agencia_sessoes where expira_em < now();
  return query select t, c.id, c.nome, c.agencia, null::text;
end $$;

create or replace function public.mkt_agencia_sessao(p_token text)
returns table (conta_id uuid, nome text, agencia text, email text)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.nome, c.agencia, c.email
    from mkt_agencia_sessoes s join mkt_agencia_contas c on c.id = s.conta_id
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expira_em > now() and c.ativo;
$$;

create or replace function public.mkt_agencia_sair(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from mkt_agencia_sessoes where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;
revoke all on function mkt_agencia_login(text, text), mkt_agencia_sessao(text), mkt_agencia_sair(text) from public, anon, authenticated;
grant execute on function mkt_agencia_login(text, text), mkt_agencia_sessao(text), mkt_agencia_sair(text) to service_role;

-- ── 4) Planejamentos, itens e obs ──────────────────────────────────────────
create table if not exists mkt_planejamentos (
  id               uuid primary key default gen_random_uuid(),
  origem           text not null check (origem in ('agencia', 'interno')),
  periodicidade    text not null check (periodicidade in ('mensal', 'semanal', 'diario')),
  time             text not null default 'organico' check (time in ('organico', 'trafego')),
  titulo           text not null check (length(btrim(titulo)) between 1 and 200),
  periodo_inicio   date not null,
  periodo_fim      date not null,
  status           text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'devolvido', 'aprovado', 'cancelado')),
  rodada           integer not null default 0,
  documento_nome   text,
  documento_path   text,
  documento_link   text,
  ia_revisao       jsonb,
  agencia_conta_id uuid references mkt_agencia_contas(id) on delete set null,
  criado_por       uuid references qs_users(id) on delete set null,
  enviado_em       timestamptz,
  decidido_por     uuid references qs_users(id) on delete set null,
  decidido_em      timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (periodo_fim >= periodo_inicio),
  check (periodo_fim - periodo_inicio <= 62),
  -- Agência: semanal ou mensal. Interno: semanal ou diário.
  check ((origem = 'agencia' and periodicidade in ('mensal', 'semanal'))
      or (origem = 'interno' and periodicidade in ('semanal', 'diario')))
);
create index if not exists mkt_planejamentos_status on mkt_planejamentos (status, periodo_inicio desc);

create table if not exists mkt_planejamento_itens (
  id              uuid primary key default gen_random_uuid(),
  planejamento_id uuid not null references mkt_planejamentos(id) on delete cascade,
  ordem           integer not null default 0,
  titulo          text not null default '' check (length(titulo) <= 200),
  formato         text check (formato in ('reels', 'carrossel', 'estatico', 'story', 'video_longo', 'outro')),
  referencias     text[] not null default '{}',
  adaptacao       text check (adaptacao is null or length(adaptacao) <= 4000),
  perfil_ids      uuid[] not null default '{}',
  data_postagem   date,
  horario         time,
  card_id         uuid references mkt_cards(id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists mkt_planejamento_itens_plan on mkt_planejamento_itens (planejamento_id, ordem);

create table if not exists mkt_planejamento_obs (
  id              uuid primary key default gen_random_uuid(),
  planejamento_id uuid not null references mkt_planejamentos(id) on delete cascade,
  item_id         uuid references mkt_planejamento_itens(id) on delete cascade,
  autor_id        uuid references qs_users(id) on delete set null,
  autor_agencia   uuid references mkt_agencia_contas(id) on delete set null,
  time            text check (time in ('organico', 'trafego')),
  texto           text not null check (length(btrim(texto)) between 1 and 4000),
  rodada          integer not null default 0,
  resolvida       boolean not null default false,
  criado_em       timestamptz not null default now(),
  check (autor_id is not null or autor_agencia is not null)
);
create index if not exists mkt_planejamento_obs_plan on mkt_planejamento_obs (planejamento_id, criado_em);

-- ── 5) Cards: o que o planejamento leva pra produção ───────────────────────
alter table mkt_cards add column if not exists horario time;
alter table mkt_cards add column if not exists perfil_ids uuid[] not null default '{}';
alter table mkt_cards add column if not exists planejamento_item_id uuid references mkt_planejamento_itens(id) on delete set null;
alter table mkt_cards add column if not exists da_agencia boolean not null default false;
alter table mkt_cards add column if not exists link_producao text check (link_producao is null or link_producao ~ '^https://');
alter table mkt_comentarios add column if not exists autor_agencia uuid references mkt_agencia_contas(id) on delete set null;

-- ── 6) Regras do planejamento ──────────────────────────────────────────────
-- O que falta num item (a MESMA regra de src/mkt/planejamento/regras.ts e
-- api/_mktPlanRegras.js; o teste confere as três).
create or replace function public.mkt_plan_item_faltas(i mkt_planejamento_itens, p mkt_planejamentos) returns text[]
language sql stable set search_path = public as $$
  select array_remove(array[
    case when length(btrim(coalesce(i.titulo, ''))) < 3 then 'titulo' end,
    case when i.formato is null then 'formato' end,
    case when not exists (select 1 from unnest(i.referencias) r where r ~* '^https?://\S+$') then 'referencia' end,
    case when length(btrim(coalesce(i.adaptacao, ''))) < 20 then 'adaptacao' end,
    case when cardinality(i.perfil_ids) = 0
           or exists (select 1 from unnest(i.perfil_ids) x where not exists (select 1 from mkt_perfis f where f.id = x and f.ativo))
         then 'perfil' end,
    case when i.data_postagem is null then 'data'
         when i.data_postagem < p.periodo_inicio or i.data_postagem > p.periodo_fim then 'data_fora' end,
    case when i.horario is null then 'horario' end
  ], null);
$$;
revoke all on function mkt_plan_item_faltas(mkt_planejamento_itens, mkt_planejamentos) from public, anon;
grant execute on function mkt_plan_item_faltas(mkt_planejamento_itens, mkt_planejamentos) to authenticated, service_role;

-- O que falta no planejamento inteiro: [{item_id, ordem, titulo, faltas[]}] (+ "sem_itens").
create or replace function public.mkt_plan_faltas(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select * from mkt_planejamentos where id = p_id),
  f as (
    select i.id, i.ordem, i.titulo, mkt_plan_item_faltas(i, p) as faltas
      from mkt_planejamento_itens i, p
     where i.planejamento_id = p_id
  )
  select case
    when not exists (select 1 from f) then jsonb_build_array(jsonb_build_object('item_id', null, 'faltas', jsonb_build_array('sem_itens')))
    else coalesce((select jsonb_agg(jsonb_build_object('item_id', id, 'ordem', ordem, 'titulo', titulo, 'faltas', to_jsonb(faltas)) order by ordem)
                     from f where cardinality(faltas) > 0), '[]'::jsonb)
  end;
$$;
revoke all on function mkt_plan_faltas(uuid) from public, anon;
grant execute on function mkt_plan_faltas(uuid) to authenticated, service_role;

-- Quem mexe no planejamento pela tela (o da agência só pela rota, com service_role).
create or replace function public.mkt_plan_editavel(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mkt_planejamentos
                  where id = p_id and origem = 'interno' and status in ('rascunho', 'devolvido'))
     and mkt_tem_acesso();
$$;
revoke all on function mkt_plan_editavel(uuid) from public, anon;
grant execute on function mkt_plan_editavel(uuid) to authenticated;

-- Gatilho: status/rodada/decisão só mudam pelas funções abaixo (ou service_role).
create or replace function public.mkt_planejamentos_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();
  if auth.uid() is null or coalesce(current_setting('mkt.plan_rpc', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'rascunho'; new.rodada := 0; new.origem := 'interno';
    new.criado_por := auth.uid(); new.agencia_conta_id := null; new.ia_revisao := null;
    new.enviado_em := null; new.decidido_por := null; new.decidido_em := null;
    new.criado_em := now();
    return new;
  end if;
  new.status := old.status; new.rodada := old.rodada; new.origem := old.origem;
  new.criado_por := old.criado_por; new.agencia_conta_id := old.agencia_conta_id;
  new.ia_revisao := old.ia_revisao; new.enviado_em := old.enviado_em;
  new.decidido_por := old.decidido_por; new.decidido_em := old.decidido_em; new.criado_em := old.criado_em;
  new.documento_path := old.documento_path;
  return new;
end $$;
drop trigger if exists trg_mkt_planejamentos_antes on mkt_planejamentos;
create trigger trg_mkt_planejamentos_antes before insert or update on mkt_planejamentos
  for each row execute function mkt_planejamentos_antes();

create or replace function public.mkt_plan_itens_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em := now();
  if tg_op = 'UPDATE' and (auth.uid() is not null and coalesce(current_setting('mkt.plan_rpc', true), '') <> '1') then
    new.card_id := old.card_id;
    new.planejamento_id := old.planejamento_id;
  elsif tg_op = 'INSERT' and auth.uid() is not null and coalesce(current_setting('mkt.plan_rpc', true), '') <> '1' then
    new.card_id := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_mkt_plan_itens_antes on mkt_planejamento_itens;
create trigger trg_mkt_plan_itens_antes before insert or update on mkt_planejamento_itens
  for each row execute function mkt_plan_itens_antes();

-- Aviso pros supervisores do time (e gestores).
create or replace function public.mkt_plan_avisar(p_id uuid, p_titulo text, p_texto text, p_chave text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; tm text;
begin
  select time into tm from mkt_planejamentos where id = p_id;
  for u in
    select q.id from qs_users q where q.is_active and mkt_eh_supervisor(q.id, tm)
  loop
    perform qs_aviso_criar(u, 'marketing', 'marketing', p_titulo, p_texto,
                           '#mkt/planejamentos/' || p_id::text, 'mkt_planejamentos', p_id::text, p_chave || ':' || u::text);
  end loop;
end $$;
revoke all on function mkt_plan_avisar(uuid, text, text, text) from public, anon, authenticated;

-- ENVIAR pra aprovação. Interno: quem tem acesso ao Marketing. Agência: só a
-- rota (service_role), que manda junto a revisão da IA. Nada vai incompleto.
create or replace function public.mkt_plan_enviar(p_id uuid, p_ia jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p mkt_planejamentos; faltas jsonb; servico boolean := auth.uid() is null;
begin
  select * into p from mkt_planejamentos where id = p_id for update;
  if not found then raise exception 'Planejamento não encontrado.'; end if;
  if not servico then
    if not mkt_tem_acesso() then raise exception 'Sem acesso ao Marketing.' using errcode = '42501'; end if;
    if p.origem <> 'interno' then raise exception 'O planejamento da agência é enviado pelo portal da agência.' using errcode = '42501'; end if;
  end if;
  if p.status not in ('rascunho', 'devolvido') then
    raise exception 'Esse planejamento já foi enviado (situação: %).', p.status;
  end if;
  faltas := mkt_plan_faltas(p_id);
  if jsonb_array_length(faltas) > 0 then
    return jsonb_build_object('ok', false, 'faltas', faltas);
  end if;
  perform set_config('mkt.plan_rpc', '1', true);
  update mkt_planejamentos
     set status = 'enviado', rodada = rodada + 1, enviado_em = now(),
         ia_revisao = coalesce(p_ia, ia_revisao), decidido_por = null, decidido_em = null
   where id = p_id;
  -- Obs da rodada anterior que ninguém marcou: ficam como resolvidas ao reenviar.
  update mkt_planejamento_obs set resolvida = true where planejamento_id = p_id and rodada <= p.rodada and not resolvida;
  perform mkt_plan_avisar(p_id,
    case when p.origem = 'agencia' then 'Planejamento da agência para revisar' else 'Planejamento para revisar' end,
    p.titulo, 'mkt_plan_enviado:' || p_id::text || ':' || (p.rodada + 1)::text);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function mkt_plan_enviar(uuid, jsonb) from public, anon;
grant execute on function mkt_plan_enviar(uuid, jsonb) to authenticated, service_role;

-- Obs do supervisor (num item ou no planejamento todo).
create or replace function public.mkt_plan_obs(p_plan uuid, p_item uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p mkt_planejamentos; v uuid; tm text;
begin
  select * into p from mkt_planejamentos where id = p_plan;
  if not found then raise exception 'Planejamento não encontrado.'; end if;
  tm := case when mkt_eh_supervisor(auth.uid(), p.time) then p.time
             when mkt_eh_supervisor(auth.uid(), case p.time when 'organico' then 'trafego' else 'organico' end)
               then case p.time when 'organico' then 'trafego' else 'organico' end end;
  if tm is null then
    raise exception 'Só os supervisores (ou o gestor) deixam obs no planejamento.' using errcode = '42501';
  end if;
  if p_item is not null and not exists (select 1 from mkt_planejamento_itens where id = p_item and planejamento_id = p_plan) then
    raise exception 'Esse conteúdo não é desse planejamento.';
  end if;
  insert into mkt_planejamento_obs (planejamento_id, item_id, autor_id, time, texto, rodada)
  values (p_plan, p_item, auth.uid(), tm, btrim(p_texto), p.rodada)
  returning id into v;
  return v;
end $$;
revoke all on function mkt_plan_obs(uuid, uuid, text) from public, anon;
grant execute on function mkt_plan_obs(uuid, uuid, text) to authenticated;

-- Formato do planejamento → tipo do card.
create or replace function public.mkt_plan_tipo_card(f text) returns text
language sql immutable as $$
  select case f when 'reels' then 'reels' when 'carrossel' then 'carrossel' when 'estatico' then 'post'
                when 'story' then 'story' when 'video_longo' then 'video_longo' else 'outro' end;
$$;

-- APROVAR ou DEVOLVER. Só supervisor do time do planejamento (ou gestor/admin).
-- Aprovar cria um card por conteúdo na coluna de entrada do Quadro.
create or replace function public.mkt_plan_decidir(p_id uuid, p_decisao text, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p mkt_planejamentos; i mkt_planejamento_itens; col uuid; novo uuid; n integer := 0;
  obs text := nullif(btrim(coalesce(p_obs, '')), '');
  refs text;
begin
  select * into p from mkt_planejamentos where id = p_id for update;
  if not found then raise exception 'Planejamento não encontrado.'; end if;
  if not mkt_eh_supervisor(auth.uid(), p.time) then
    raise exception 'Só o supervisor do % (ou o gestor de Marketing) aprova ou devolve.',
      case p.time when 'organico' then 'Orgânico' else 'Tráfego' end using errcode = '42501';
  end if;
  if p.status <> 'enviado' then
    raise exception 'Só dá pra decidir um planejamento enviado (situação: %).', p.status;
  end if;
  if p_decisao not in ('aprovado', 'devolvido') then raise exception 'Decisão inválida.'; end if;

  perform set_config('mkt.plan_rpc', '1', true);
  if obs is not null then
    insert into mkt_planejamento_obs (planejamento_id, autor_id, time, texto, rodada)
    values (p_id, auth.uid(), p.time, obs, p.rodada);
  end if;

  if p_decisao = 'devolvido' then
    if obs is null and not exists (select 1 from mkt_planejamento_obs where planejamento_id = p_id and rodada = p.rodada and not resolvida and autor_id is not null) then
      raise exception 'Para devolver, deixe pelo menos uma obs do que precisa mudar.';
    end if;
    update mkt_planejamentos set status = 'devolvido', decidido_por = auth.uid(), decidido_em = now() where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'devolvido');
  end if;

  if jsonb_array_length(mkt_plan_faltas(p_id)) > 0 then
    raise exception 'Tem conteúdo incompleto — devolva para completar.';
  end if;
  select id into col from mkt_colunas where tipo = 'entrada';
  for i in select * from mkt_planejamento_itens where planejamento_id = p_id and card_id is null order by ordem loop
    select string_agg(r, E'\n') into refs from unnest(i.referencias) r;
    insert into mkt_cards (titulo, descricao, tipo, origem, coluna_id, ordem, data_publicacao, horario, perfil_ids,
                           planejamento_item_id, da_agencia, checklist, tags)
    values (left(btrim(i.titulo), 200),
            btrim(coalesce(i.adaptacao, '')) || case when refs is not null then E'\n\nReferências:\n' || refs else '' end,
            mkt_plan_tipo_card(i.formato), p.time, col, mkt_topo_da_coluna(col) - n, i.data_postagem, i.horario, i.perfil_ids,
            i.id, p.origem = 'agencia', '[]'::jsonb, '{}')
    returning id into novo;
    update mkt_planejamento_itens set card_id = novo where id = i.id;
    n := n + 1;
  end loop;
  update mkt_planejamentos set status = 'aprovado', decidido_por = auth.uid(), decidido_em = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'aprovado', 'cards', n);
end $$;
revoke all on function mkt_plan_decidir(uuid, text, text) from public, anon;
grant execute on function mkt_plan_decidir(uuid, text, text) to authenticated;

-- ── 7) RLS (time interno). A agência NÃO tem policy: entra só pela rota. ────
alter table mkt_planejamentos enable row level security;
alter table mkt_planejamento_itens enable row level security;
alter table mkt_planejamento_obs enable row level security;

drop policy if exists mkt_plan_ler on mkt_planejamentos;
create policy mkt_plan_ler on mkt_planejamentos for select to authenticated using ((select mkt_tem_acesso()));
drop policy if exists mkt_plan_criar on mkt_planejamentos;
create policy mkt_plan_criar on mkt_planejamentos for insert to authenticated
  with check ((select mkt_tem_acesso()) and origem = 'interno');
drop policy if exists mkt_plan_editar on mkt_planejamentos;
create policy mkt_plan_editar on mkt_planejamentos for update to authenticated
  using (mkt_plan_editavel(id)) with check ((select mkt_tem_acesso()) and origem = 'interno');
drop policy if exists mkt_plan_apagar on mkt_planejamentos;
create policy mkt_plan_apagar on mkt_planejamentos for delete to authenticated
  using (origem = 'interno' and status = 'rascunho' and (criado_por = auth.uid() or (select mkt_eh_gestor(auth.uid()))));

drop policy if exists mkt_plan_itens_ler on mkt_planejamento_itens;
create policy mkt_plan_itens_ler on mkt_planejamento_itens for select to authenticated using ((select mkt_tem_acesso()));
drop policy if exists mkt_plan_itens_mexer on mkt_planejamento_itens;
create policy mkt_plan_itens_mexer on mkt_planejamento_itens for all to authenticated
  using (mkt_plan_editavel(planejamento_id)) with check (mkt_plan_editavel(planejamento_id));

drop policy if exists mkt_plan_obs_ler on mkt_planejamento_obs;
create policy mkt_plan_obs_ler on mkt_planejamento_obs for select to authenticated using ((select mkt_tem_acesso()));
drop policy if exists mkt_plan_obs_resolver on mkt_planejamento_obs;
create policy mkt_plan_obs_resolver on mkt_planejamento_obs for update to authenticated
  using ((select mkt_tem_acesso())) with check ((select mkt_tem_acesso()));
drop policy if exists mkt_plan_obs_apagar on mkt_planejamento_obs;
create policy mkt_plan_obs_apagar on mkt_planejamento_obs for delete to authenticated using (autor_id = auth.uid());

-- Obs: o texto e o autor não mudam depois de escritos (só "resolvida").
create or replace function public.mkt_plan_obs_antes() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    new.texto := old.texto; new.autor_id := old.autor_id; new.autor_agencia := old.autor_agencia;
    new.planejamento_id := old.planejamento_id; new.item_id := old.item_id; new.time := old.time;
    new.rodada := old.rodada; new.criado_em := old.criado_em;
  end if;
  return new;
end $$;
drop trigger if exists trg_mkt_plan_obs_antes on mkt_planejamento_obs;
create trigger trg_mkt_plan_obs_antes before update on mkt_planejamento_obs
  for each row execute function mkt_plan_obs_antes();

-- ── 8) Storage: PDF que a agência mandou (privado; o time lê) ──────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mkt-planejamentos', 'mkt-planejamentos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists mkt_planejamentos_pdf_ler on storage.objects;
create policy mkt_planejamentos_pdf_ler on storage.objects for select to authenticated
  using (bucket_id = 'mkt-planejamentos' and (select mkt_tem_acesso()));

-- -----------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura):
--   select nome, rede, dono from mkt_perfis order by ordem;              -- 6
--   select has_function_privilege('authenticated', 'mkt_agencia_login(text,text)', 'execute');  -- false
--   select has_function_privilege('anon', 'mkt_agencia_sessao(text)', 'execute');              -- false
--   select count(*) from pg_policies where tablename in ('mkt_agencia_contas','mkt_agencia_sessoes'); -- 0
-- ROLLBACK (manual):
--   drop table if exists mkt_planejamento_obs, mkt_planejamento_itens, mkt_planejamentos cascade;
--   alter table mkt_cards drop column if exists horario, drop column if exists perfil_ids,
--     drop column if exists planejamento_item_id, drop column if exists da_agencia, drop column if exists link_producao;
--   alter table mkt_comentarios drop column if exists autor_agencia;
--   drop table if exists mkt_agencia_sessoes, mkt_agencia_contas, mkt_perfis cascade;
--   (e voltar mkt_equipe_papeis_check e mkt_definir_papeis da 0240)
-- -----------------------------------------------------------------------------
