-- 0342_mkt_grupos_link_inteligente.sql
-- NÃO APLICADA (09/11/2026) — branch mkt-grupos-sendflow, aguarda o ok do Bruno.
-- Idempotente (pode rodar 2x). ADITIVA: cria objetos mkt_grupos_link* e
-- mkt_grupos_membros_dia, e só ACRESCENTA uma coluna em mkt_grupos (contado_em).
-- Rollback comentado no fim. Depende da 0243 (mkt_grupos) e da 0240 (mkt_tem_acesso).
--
-- LINK INTELIGENTE DE GRUPO (o "link de lançamento" do SendFlow):
--   https://qs.setuforeuvouviagens.com.br/g/japao-2027
-- A pessoa clica e cai no convite do PRIMEIRO grupo da lista que ainda não
-- lotou. Todos lotados: página "grupos lotados" — ou, se configurado, o cron cria
-- o próximo grupo pela Evolution (nome numerado, descrição, foto, admins).
--
-- Quem lê o link público é o SERVIDOR (api/mkt-grupos-link.js, chave de serviço)
-- pela RPC mkt_grupos_link_escolher. Nada aqui é concedido a anon.
--
-- Contagem de "cheio": membros (última contagem pela Evolution) + PENDENTES
-- (cliques únicos mandados pro grupo desde a última contagem). Superestima de
-- propósito (nem todo clique entra): numa enxurrada o próximo grupo abre um pouco
-- antes; na contagem seguinte os pendentes zeram e o grupo volta a receber.
-- ---------------------------------------------------------------------------

-- ── 0) Coluna nova em mkt_grupos: quando os membros foram contados ──────────
alter table public.mkt_grupos add column if not exists contado_em timestamptz;

-- ── 1) O link (campanha de grupos) ─────────────────────────────────────────
create table if not exists public.mkt_grupos_links (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  nome               text not null check (length(btrim(nome)) between 1 and 80),
  ativo              boolean not null default true,
  capacidade         integer not null default 1000 check (capacidade between 1 and 5000),  -- máximo por grupo (o grupo pode ter o seu)
  -- o que acontece quando todos lotam
  ao_lotar           text not null default 'pagina' check (ao_lotar in ('pagina', 'criar_grupo')),
  mensagem_lotado    text check (mensagem_lotado is null or length(mensagem_lotado) <= 500),
  -- prévia do link no WhatsApp/Instagram (o que o robô de prévia mostra)
  titulo_publico     text check (titulo_publico is null or length(titulo_publico) <= 80),
  descricao_publica  text check (descricao_publica is null or length(descricao_publica) <= 200),
  -- modelo do grupo criado automaticamente (ao_lotar = 'criar_grupo')
  modelo_nome        text check (modelo_nome is null or length(modelo_nome) <= 100),  -- "Japão 2027 #{n}"
  modelo_descricao   text check (modelo_descricao is null or length(modelo_descricao) <= 2048),
  modelo_foto_url    text check (modelo_foto_url is null or modelo_foto_url ~ '^https://'),
  modelo_admins      text[] not null default '{}' check (coalesce(array_to_string(modelo_admins, ','), '') ~ '^([0-9]{10,15}(,[0-9]{10,15})*)?$'),
  modelo_so_admins_enviam boolean not null default true,
  modelo_so_admins_editam boolean not null default true,
  criar_ao_pct       integer not null default 90 check (criar_ao_pct between 50 and 100),  -- cria o próximo quando o último chega a X%
  limite_auto        integer not null default 10 check (limite_auto between 0 and 50),       -- teto de grupos criados sozinhos
  criados_auto       integer not null default 0,
  criando_em         timestamptz,   -- trava do cron enquanto cria (5 min)
  ultimo_erro        text,
  cliques            integer not null default 0,
  ultimo_clique_em   timestamptz,
  criado_por         uuid default auth.uid() references public.qs_users(id) on delete set null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint mkt_grupos_links_modelo check (ao_lotar <> 'criar_grupo' or (length(btrim(coalesce(modelo_nome, ''))) > 0 and cardinality(modelo_admins) > 0))
);
create unique index if not exists mkt_grupos_links_slug_uq on public.mkt_grupos_links (slug);

-- ── 2) Os grupos do link, em ordem ──────────────────────────────────────────
create table if not exists public.mkt_grupos_link_grupos (
  link_id     uuid not null references public.mkt_grupos_links(id) on delete cascade,
  grupo_jid   text not null references public.mkt_grupos(jid) on delete cascade,
  ordem       integer not null default 0,
  capacidade  integer check (capacidade is null or capacidade between 1 and 5000),  -- null = a do link
  ativo       boolean not null default true,
  criado_auto boolean not null default false,
  cliques     integer not null default 0,   -- todas as vezes que o link mandou pra cá
  pendentes   integer not null default 0,   -- cliques únicos desde a última contagem
  lotou_em    timestamptz,
  criado_em   timestamptz not null default now(),
  primary key (link_id, grupo_jid)
);
create index if not exists mkt_grupos_link_grupos_grupo_idx on public.mkt_grupos_link_grupos (grupo_jid);

-- ── 3) Cliques por dia (agregado: sem IP, sem dado de quem clicou) ──────────
-- grupo_jid '' = clique que encontrou tudo lotado.
create table if not exists public.mkt_grupos_link_dia (
  link_id   uuid not null references public.mkt_grupos_links(id) on delete cascade,
  dia       date not null,
  grupo_jid text not null default '',
  cliques   integer not null default 0,
  unicos    integer not null default 0,
  primary key (link_id, dia, grupo_jid)
);

-- ── 4) Entradas e saídas por grupo e dia (webhook GROUP_PARTICIPANTS_UPDATE) ─
create table if not exists public.mkt_grupos_membros_dia (
  grupo_jid text not null references public.mkt_grupos(jid) on delete cascade,
  dia       date not null,
  entradas  integer not null default 0,
  saidas    integer not null default 0,
  membros   integer,          -- última contagem do dia
  primary key (grupo_jid, dia)
);

-- ── 5) Guarda: o navegador configura, mas não mexe nos contadores ───────────
create or replace function public.mkt_grupos_link_guarda()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'mkt_grupos_links' then
    new.atualizado_em := now();
    if auth.uid() is null then return new; end if;   -- servidor (service_role) / SQL
    if tg_op = 'INSERT' then
      new.cliques := 0; new.ultimo_clique_em := null; new.criados_auto := 0;
      new.criando_em := null; new.ultimo_erro := null; new.criado_por := auth.uid();
    else
      new.cliques := old.cliques; new.ultimo_clique_em := old.ultimo_clique_em;
      new.criados_auto := old.criados_auto; new.criando_em := old.criando_em;
      new.ultimo_erro := old.ultimo_erro; new.criado_por := old.criado_por;
    end if;
  else  -- mkt_grupos_link_grupos
    if auth.uid() is null then return new; end if;
    if tg_op = 'INSERT' then
      new.cliques := 0; new.pendentes := 0; new.lotou_em := null; new.criado_auto := false;
    else
      new.cliques := old.cliques; new.pendentes := old.pendentes; new.lotou_em := old.lotou_em;
      new.criado_auto := old.criado_auto; new.link_id := old.link_id; new.grupo_jid := old.grupo_jid;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mkt_grupos_links_guarda on public.mkt_grupos_links;
create trigger trg_mkt_grupos_links_guarda before insert or update on public.mkt_grupos_links
  for each row execute function public.mkt_grupos_link_guarda();
drop trigger if exists trg_mkt_grupos_link_grupos_guarda on public.mkt_grupos_link_grupos;
create trigger trg_mkt_grupos_link_grupos_guarda before insert or update on public.mkt_grupos_link_grupos
  for each row execute function public.mkt_grupos_link_guarda();

-- ── 6) A escolha do grupo (o clique). SÓ o servidor chama. ──────────────────
-- p_modo: 'clique' (conta) · 'bot' (robô de prévia: só devolve o título, não conta)
-- p_ref : o grupo em que o MESMO navegador já caiu (cookie) — volta pra ele se ainda couber
-- Devolve jsonb: { status: ok|lotado|aguarde|pausado|nao_existe, convite?, ref?, titulo?, descricao?, mensagem? }
-- Nunca devolve o jid nem números: a rota pública só repassa o convite.
create or replace function public.mkt_grupos_link_escolher(p_slug text, p_modo text default 'clique', p_ref text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  l   public.mkt_grupos_links%rowtype;
  g   record;
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  unico boolean := true;
begin
  select * into l from mkt_grupos_links where slug = lower(btrim(coalesce(p_slug, ''))) limit 1;
  if not found then return jsonb_build_object('status', 'nao_existe'); end if;
  if p_modo = 'bot' then
    return jsonb_build_object('status', case when l.ativo then 'ok' else 'pausado' end,
      'titulo', coalesce(l.titulo_publico, l.nome), 'descricao', l.descricao_publica);
  end if;
  if not l.ativo then
    return jsonb_build_object('status', 'pausado', 'titulo', coalesce(l.titulo_publico, l.nome), 'mensagem', l.mensagem_lotado);
  end if;

  -- uma fila por link: cliques simultâneos não estouram a mesma vaga
  perform 1 from mkt_grupos_links where id = l.id for update;

  for g in
    select lg.grupo_jid, m.link_convite,
           coalesce(lg.capacidade, l.capacidade) as cap,
           coalesce(m.participantes, 0) as membros, lg.pendentes,
           left(encode(sha256(convert_to(lg.grupo_jid, 'UTF8')), 'hex'), 12) as ref
      from mkt_grupos_link_grupos lg
      join mkt_grupos m on m.jid = lg.grupo_jid
     where lg.link_id = l.id and lg.ativo and m.saiu_em is null
       and m.link_convite ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{10,40}$'
     order by (p_ref is not null and left(encode(sha256(convert_to(lg.grupo_jid, 'UTF8')), 'hex'), 12) = p_ref) desc,
              lg.ordem, lg.criado_em
  loop
    -- quem já clicou e volta pro mesmo grupo não conta de novo como pendente
    unico := not (p_ref is not null and g.ref = p_ref);
    if g.membros + g.pendentes + (case when unico then 1 else 0 end) <= g.cap then
      update mkt_grupos_link_grupos
         set cliques = cliques + 1, pendentes = pendentes + (case when unico then 1 else 0 end)
       where link_id = l.id and grupo_jid = g.grupo_jid;
      update mkt_grupos_links set cliques = cliques + 1, ultimo_clique_em = now() where id = l.id;
      insert into mkt_grupos_link_dia (link_id, dia, grupo_jid, cliques, unicos)
      values (l.id, v_dia, g.grupo_jid, 1, case when unico then 1 else 0 end)
      on conflict (link_id, dia, grupo_jid)
      do update set cliques = mkt_grupos_link_dia.cliques + 1, unicos = mkt_grupos_link_dia.unicos + excluded.unicos;
      return jsonb_build_object('status', 'ok', 'convite', g.link_convite, 'ref', g.ref);
    end if;
    -- este lotou (pela conta): anota a primeira vez
    update mkt_grupos_link_grupos set lotou_em = coalesce(lotou_em, now())
     where link_id = l.id and grupo_jid = g.grupo_jid;
  end loop;

  -- todos lotados
  update mkt_grupos_links set cliques = cliques + 1, ultimo_clique_em = now() where id = l.id;
  insert into mkt_grupos_link_dia (link_id, dia, grupo_jid, cliques, unicos) values (l.id, v_dia, '', 1, 1)
  on conflict (link_id, dia, grupo_jid) do update set cliques = mkt_grupos_link_dia.cliques + 1, unicos = mkt_grupos_link_dia.unicos + 1;
  return jsonb_build_object(
    'status', case when l.ao_lotar = 'criar_grupo' and l.criados_auto < l.limite_auto then 'aguarde' else 'lotado' end,
    'titulo', coalesce(l.titulo_publico, l.nome), 'mensagem', l.mensagem_lotado);
end;
$$;

-- ── 7) Contagem e entradas/saídas (o cron e o webhook). SÓ o servidor. ──────
-- Contagem nova: grava os membros, zera os pendentes e tira o "lotou" se voltou a caber.
create or replace function public.mkt_grupos_link_contagem(p_grupo text, p_membros integer)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_grupo !~ '^[0-9]+(-[0-9]+)?@g\.us$' or p_membros is null or p_membros < 0 then return; end if;
  update mkt_grupos set participantes = p_membros, contado_em = now() where jid = p_grupo;
  update mkt_grupos_link_grupos lg
     set pendentes = 0,
         lotou_em = case when p_membros < coalesce(lg.capacidade, l.capacidade) then null else coalesce(lg.lotou_em, now()) end
    from mkt_grupos_links l
   where l.id = lg.link_id and lg.grupo_jid = p_grupo;
  insert into mkt_grupos_membros_dia (grupo_jid, dia, membros) values (p_grupo, v_dia, p_membros)
  on conflict (grupo_jid, dia) do update set membros = excluded.membros;
end;
$$;

-- Webhook: N entraram / N saíram agora. Ajusta o número na hora (até a próxima contagem).
create or replace function public.mkt_grupos_membros_mov(p_grupo text, p_entradas integer, p_saidas integer)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_grupo !~ '^[0-9]+(-[0-9]+)?@g\.us$' then return; end if;
  if not exists (select 1 from mkt_grupos where jid = p_grupo) then return; end if;
  insert into mkt_grupos_membros_dia (grupo_jid, dia, entradas, saidas)
  values (p_grupo, v_dia, greatest(coalesce(p_entradas, 0), 0), greatest(coalesce(p_saidas, 0), 0))
  on conflict (grupo_jid, dia) do update
    set entradas = mkt_grupos_membros_dia.entradas + excluded.entradas,
        saidas   = mkt_grupos_membros_dia.saidas + excluded.saidas;
  update mkt_grupos
     set participantes = greatest(0, coalesce(participantes, 0) + greatest(coalesce(p_entradas, 0), 0) - greatest(coalesce(p_saidas, 0), 0))
   where jid = p_grupo and participantes is not null;
  -- quem entrou já está no número: sai dos pendentes
  update mkt_grupos_link_grupos set pendentes = greatest(0, pendentes - greatest(coalesce(p_entradas, 0), 0))
   where grupo_jid = p_grupo;
end;
$$;

revoke all on function public.mkt_grupos_link_escolher(text, text, text) from public, anon, authenticated;
grant execute on function public.mkt_grupos_link_escolher(text, text, text) to service_role;
revoke all on function public.mkt_grupos_link_contagem(text, integer) from public, anon, authenticated;
grant execute on function public.mkt_grupos_link_contagem(text, integer) to service_role;
revoke all on function public.mkt_grupos_membros_mov(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mkt_grupos_membros_mov(text, integer, integer) to service_role;
revoke all on function public.mkt_grupos_link_guarda() from public, anon, authenticated;

-- ── 8) RLS (padrão mkt_*: mkt_tem_acesso; nada pra anon) ────────────────────
alter table public.mkt_grupos_links       enable row level security;
alter table public.mkt_grupos_link_grupos enable row level security;
alter table public.mkt_grupos_link_dia    enable row level security;
alter table public.mkt_grupos_membros_dia enable row level security;

revoke all on public.mkt_grupos_links, public.mkt_grupos_link_grupos,
  public.mkt_grupos_link_dia, public.mkt_grupos_membros_dia from anon;
-- relatórios: só leitura pelo navegador
revoke insert, update, delete, truncate on public.mkt_grupos_link_dia, public.mkt_grupos_membros_dia from authenticated;
grant select on public.mkt_grupos_link_dia, public.mkt_grupos_membros_dia to authenticated;
-- configuração do link: o navegador grava (com RLS + a guarda dos contadores)
grant select, insert, update, delete on public.mkt_grupos_links, public.mkt_grupos_link_grupos to authenticated;

do $$
declare t text;
begin
  foreach t in array array['mkt_grupos_links','mkt_grupos_link_grupos','mkt_grupos_link_dia','mkt_grupos_membros_dia']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.mkt_tem_acesso())', t || '_ler', t);
  end loop;
  foreach t in array array['mkt_grupos_links','mkt_grupos_link_grupos']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.mkt_tem_acesso())', t || '_inserir', t);
    execute format('drop policy if exists %I on public.%I', t || '_mudar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.mkt_tem_acesso()) with check (public.mkt_tem_acesso())', t || '_mudar', t);
    execute format('drop policy if exists %I on public.%I', t || '_apagar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.mkt_tem_acesso())', t || '_apagar', t);
  end loop;
end $$;

-- ── CONFERÊNCIA (depois de aplicar) ────────────────────────────────────────
--   select has_function_privilege('anon', 'public.mkt_grupos_link_escolher(text,text,text)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.mkt_grupos_link_escolher(text,text,text)', 'execute'); -- false
--   select has_table_privilege('anon', 'public.mkt_grupos_links', 'select');                                     -- false
--   select public.mkt_grupos_link_escolher('nao-existe');                                                         -- {"status":"nao_existe"}

-- ── ROLLBACK (comentado) ────────────────────────────────────────────────────
-- drop function if exists public.mkt_grupos_membros_mov(text, integer, integer);
-- drop function if exists public.mkt_grupos_link_contagem(text, integer);
-- drop function if exists public.mkt_grupos_link_escolher(text, text, text);
-- drop table if exists public.mkt_grupos_membros_dia;
-- drop table if exists public.mkt_grupos_link_dia;
-- drop table if exists public.mkt_grupos_link_grupos;
-- drop table if exists public.mkt_grupos_links;
-- drop function if exists public.mkt_grupos_link_guarda();
-- alter table public.mkt_grupos drop column if exists contado_em;
