-- 0243_mkt_grupos.sql
-- NÃO APLICADA (30/10/2026) — branch mkt-grupos, aguarda o ok do Bruno.
-- Idempotente (pode rodar 2x). ADITIVA: só cria objetos mkt_grupos_* (e um
-- bucket); não altera nenhuma tabela, função ou policy que já existe. Rollback
-- comentado no fim.
--
-- GRUPOS DO WHATSAPP DO MARKETING (área de Marketing do QS, frente "grupos").
-- A Meta não envia para grupo: grupo fica no CHIP do Marketing pela Evolution.
-- Regra do Bruno: grupo só por chip; massa para pessoa só pela API oficial.
--
-- TRAVA DE INSTÂNCIA (o Bruno: pela instância do Rel "de forma alguma deve sair
-- mensagem"). Mora em DUAS camadas, a mesma regra:
--   • JS: api/_mktGruposRegras.js motivoBloqueioInstancia(), chamada antes de
--     TODO fetch à Evolution (api/_mktGruposEvo.js evoMkt);
--   • banco (aqui): mkt_grupos_motivo_bloqueio() — gatilho em mkt_grupos_conexao
--     (não deixa gravar instância de outro setor), gatilho na fila (linha não vai
--     pra "enviando" por instância diferente/proibida) e a RPC que entrega a
--     próxima linha da fila (mkt_grupos_reivindicar) confere de novo.
-- Proibido: nome sem "marketing"/"mkt"; nome com outro setor (relacionamento,
-- comercial, closer, sdr, financeiro, operac…, "rel" como palavra); a lista
-- mkt_grupos_bloqueios (já vem com a instância e o número do Rel); qualquer
-- instância/número de SDR (qs_wa_linhas).
--
-- QUEM USA: admin, marketing e gestor com 'marketing' nas áreas
-- (mkt_grupos_tem_acesso). O papel marketing é só leitura nas tabelas qs_*
-- (gatilho da 0036/0126); estas tabelas NÃO são qs_* e têm RLS própria:
--   • ler: tudo;
--   • gravar pelo navegador: tags, vínculos de tag, cadências, recorrências e
--     campanhas (um gatilho impede o navegador de pôr campanha em
--     "enviando"/"concluída" ou de mexer no conteúdo depois da fila montada);
--   • fila, grupos, conexão e bloqueios: SÓ o servidor (service_role).
-- ---------------------------------------------------------------------------

-- ── 0) Quem tem acesso ──────────────────────────────────────────────────────
create or replace function public.mkt_grupos_tem_acesso()
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Integração 30/10: uma regra só pra área toda (mkt_tem_acesso, 0240 —
  -- admin, papel marketing ou quem tem o setor Marketing).
  select public.mkt_tem_acesso();
$$;
revoke all on function public.mkt_grupos_tem_acesso() from public, anon;
grant execute on function public.mkt_grupos_tem_acesso() to authenticated, service_role;

-- Lista de jids só de GRUPO (vazia vale). Usada nos CHECKs.
create or replace function public.mkt_grupos_so_grupos(p text[])
returns boolean language sql immutable set search_path = public
as $$ select coalesce(bool_and(x ~ '^[0-9]+(-[0-9]+)?@g\.us$'), true) from unnest(coalesce(p, '{}'::text[])) x $$;

-- ── 1) Bloqueios (instâncias e números de OUTROS setores) ───────────────────
create table if not exists public.mkt_grupos_bloqueios (
  valor     text primary key,          -- instância em minúsculas, ou número só com dígitos
  tipo      text not null check (tipo in ('instancia', 'numero')),
  motivo    text not null,
  criado_em timestamptz not null default now()
);
insert into public.mkt_grupos_bloqueios (valor, tipo, motivo) values
  ('relacionamento-grupos-4183', 'instancia', 'Relacionamento — grupos (0137). Por ela não sai NADA do Marketing.'),
  ('5511980124183', 'numero', 'Número do Relacionamento (+55 11 98012-4183).')
on conflict (valor) do nothing;

create or replace function public.mkt_grupos_sem_nono(p text)
returns text language sql immutable set search_path = public
as $$ select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(55\d{2})9(\d{8})$', '\1\2') $$;

-- null = liberada; texto = por que está bloqueada.
create or replace function public.mkt_grupos_motivo_bloqueio(p_instancia text, p_numero text default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  i text := lower(btrim(coalesce(p_instancia, '')));
  n text := public.mkt_grupos_sem_nono(p_numero);
begin
  if i = '' then return 'Nenhuma instância do Marketing configurada.'; end if;
  if i !~ '(marketing|mkt)' then
    return format('A instância "%s" não é do Marketing (o nome precisa ter "marketing" ou "mkt").', p_instancia);
  end if;
  if i ~ '(relacionamento|comercial|closer|sdr|financeiro|operac|(^|[^a-z])rel([^a-z]|$))' then
    return format('A instância "%s" tem nome de outro setor — envio bloqueado.', p_instancia);
  end if;
  if exists (select 1 from mkt_grupos_bloqueios where tipo = 'instancia' and lower(valor) = i) then
    return format('A instância "%s" é de outro setor — envio bloqueado.', p_instancia);
  end if;
  if exists (select 1 from qs_wa_linhas where lower(instancia) = i) then
    return format('A instância "%s" é de um SDR — envio bloqueado.', p_instancia);
  end if;
  if n <> '' and (
       exists (select 1 from mkt_grupos_bloqueios where tipo = 'numero' and public.mkt_grupos_sem_nono(valor) = n)
    or exists (select 1 from qs_wa_linhas where numero is not null and public.mkt_grupos_sem_nono(numero) = n)
  ) then
    return format('O número %s é de outro setor — envio bloqueado.', p_numero);
  end if;
  return null;
end;
$$;
revoke all on function public.mkt_grupos_motivo_bloqueio(text, text) from public, anon;
grant execute on function public.mkt_grupos_motivo_bloqueio(text, text) to authenticated, service_role;

-- ── 2) A conexão do chip do Marketing (uma linha só) ────────────────────────
create table if not exists public.mkt_grupos_conexao (
  id                smallint primary key default 1 check (id = 1),
  instancia         text not null,
  numero            text,
  estado            text not null default 'desconhecido',  -- open · close · connecting · desconhecido
  estado_em         timestamptz,
  conectado_em      timestamptz,
  -- interruptor da tela (só admin). O outro é MKT_GRUPOS_ENVIO=1 na Vercel. Os dois ligados = sai.
  envio_ligado      boolean not null default false,
  intervalo_min_seg integer not null default 20 check (intervalo_min_seg >= 5),
  intervalo_max_seg integer not null default 45,
  janela_inicio     text not null default '08:00' check (janela_inicio ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  janela_fim        text not null default '21:00' check (janela_fim ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  proximo_envio_em  timestamptz,
  configurado_por   uuid references public.qs_users(id) on delete set null,
  atualizado_em     timestamptz not null default now(),
  constraint mkt_grupos_conexao_intervalo check (intervalo_max_seg >= intervalo_min_seg)
);

create or replace function public.mkt_grupos_conexao_trava()
returns trigger language plpgsql security definer set search_path = public
as $$
declare m text;
begin
  m := public.mkt_grupos_motivo_bloqueio(new.instancia, new.numero);
  if m is not null then
    raise exception 'Trava do Marketing: %', m using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and lower(new.instancia) is distinct from lower(old.instancia) then
    new.envio_ligado := false;   -- trocou de instância: desliga o envio até alguém religar
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists trg_mkt_grupos_conexao_trava on public.mkt_grupos_conexao;
create trigger trg_mkt_grupos_conexao_trava before insert or update on public.mkt_grupos_conexao
  for each row execute function public.mkt_grupos_conexao_trava();

-- ── 3) Grupos do chip ───────────────────────────────────────────────────────
create table if not exists public.mkt_grupos (
  jid                 text primary key check (jid ~ '^[0-9]+(-[0-9]+)?@g\.us$'),
  nome                text,
  descricao           text,
  foto_url            text,
  participantes       integer,
  eu_admin            boolean,
  so_admins_enviam    boolean,
  so_admins_editam    boolean,
  dono                text,
  admins              jsonb not null default '[]'::jsonb,   -- [{id, telefone, admin}]
  participantes_lista jsonb,                                -- idem, lido em "Dados do grupo"
  link_convite        text,
  link_em             timestamptz,
  instancia           text,
  sincronizado_em     timestamptz,
  info_em             timestamptz,
  saiu_em             timestamptz,
  criado_em           timestamptz not null default now()
);
create index if not exists mkt_grupos_ativos_idx on public.mkt_grupos (nome) where saiu_em is null;

-- ── 4) Tags de grupo (com cor) ──────────────────────────────────────────────
create table if not exists public.mkt_grupos_tags (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) between 1 and 40),
  cor        text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_por uuid default auth.uid() references public.qs_users(id) on delete set null,
  criado_em  timestamptz not null default now()
);
create unique index if not exists mkt_grupos_tags_nome_uq on public.mkt_grupos_tags (lower(btrim(nome)));

create table if not exists public.mkt_grupos_tag_links (
  tag_id    uuid not null references public.mkt_grupos_tags(id) on delete cascade,
  grupo_jid text not null references public.mkt_grupos(jid) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (tag_id, grupo_jid)
);
create index if not exists mkt_grupos_tag_links_grupo_idx on public.mkt_grupos_tag_links (grupo_jid);

-- ── 5) Cadências (destino fixo + passos) e recorrências ─────────────────────
-- Cadência = um DESTINO (tags/grupos) + passos com data e hora; cada passo é uma
-- campanha com cadencia_id (igual ao SendFlow 0016). Ex.: aquecimento de uma live.
create table if not exists public.mkt_grupos_cadencias (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) > 0),
  descricao     text,
  tag_ids       uuid[] not null default '{}',
  grupo_jids    text[] not null default '{}' check (public.mkt_grupos_so_grupos(grupo_jids)),
  ativo         boolean not null default true,
  criado_por    uuid default auth.uid() references public.qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Recorrência = "toda seg/qua/sex às 19:00, de X a Y". O motor gera uma campanha
-- por ocorrência das próximas 24 h (índice único impede duplicar).
create table if not exists public.mkt_grupos_recorrencias (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (length(btrim(nome)) > 0),
  cadencia_id       uuid references public.mkt_grupos_cadencias(id) on delete cascade,
  dias_semana       smallint[] not null check (cardinality(dias_semana) between 1 and 7 and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  hora              text not null check (hora ~ '^([01]\d|2[0-3]):[0-5]\d$'),   -- hora de SP
  inicio            date,
  fim               date,
  tipo              text not null default 'texto' check (tipo in ('texto','imagem','video','documento','audio','enquete')),
  texto             text not null default '',
  midia_url         text,
  midia_nome        text,
  enquete_opcoes    text[],
  enquete_multipla  boolean not null default false,
  mencionar_todos   boolean not null default false,
  tag_ids           uuid[] not null default '{}',
  grupo_jids        text[] not null default '{}' check (public.mkt_grupos_so_grupos(grupo_jids)),
  intervalo_min_seg integer check (intervalo_min_seg is null or intervalo_min_seg >= 5),
  intervalo_max_seg integer,
  ativo             boolean not null default true,
  gerado_ate        timestamptz,   -- até onde o motor já gerou campanhas
  criado_por        uuid default auth.uid() references public.qs_users(id) on delete set null,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint mkt_grupos_rec_destino check (cardinality(tag_ids) > 0 or cardinality(grupo_jids) > 0),
  constraint mkt_grupos_rec_periodo check (fim is null or inicio is null or fim >= inicio)
);

-- ── 6) Campanhas para grupos ────────────────────────────────────────────────
create table if not exists public.mkt_grupos_campanhas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (length(btrim(nome)) > 0),
  tipo              text not null default 'texto' check (tipo in ('texto','imagem','video','documento','audio','enquete')),
  texto             text not null default '' check (length(texto) <= 4096),
  midia_url         text,
  midia_nome        text,
  enquete_opcoes    text[],
  enquete_multipla  boolean not null default false,
  mencionar_todos   boolean not null default false,
  tag_ids           uuid[] not null default '{}',
  grupo_jids        text[] not null default '{}' check (public.mkt_grupos_so_grupos(grupo_jids)),   -- só grupo, nunca pessoa
  enviar_em         timestamptz,
  intervalo_min_seg integer check (intervalo_min_seg is null or intervalo_min_seg >= 5),
  intervalo_max_seg integer,
  status            text not null default 'rascunho'
                    check (status in ('rascunho','agendada','enviando','pausada','concluida','cancelada','erro')),
  cadencia_id       uuid references public.mkt_grupos_cadencias(id) on delete set null,
  recorrencia_id    uuid references public.mkt_grupos_recorrencias(id) on delete set null,
  fanout_em         timestamptz,       -- quando a fila foi montada (depois disso o conteúdo não muda)
  total             integer not null default 0,
  enviados          integer not null default 0,
  falhas            integer not null default 0,
  avisos            text[] not null default '{}',
  erro              text,
  criado_por        uuid references public.qs_users(id) on delete set null,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  iniciado_em       timestamptz,
  concluido_em      timestamptz,
  constraint mkt_grupos_camp_texto   check (tipo <> 'texto' or length(btrim(texto)) > 0),
  constraint mkt_grupos_camp_midia   check (tipo not in ('imagem','video','documento','audio') or midia_url ~ '^https://'),
  constraint mkt_grupos_camp_enquete check (tipo <> 'enquete' or (length(btrim(texto)) > 0 and enquete_opcoes is not null and cardinality(enquete_opcoes) between 2 and 12))
);
-- SEM predicado: o PostgREST só resolve ON CONFLICT assim (lição do SendFlow). null ≠ null, então avulsas não colidem.
create unique index if not exists mkt_grupos_camp_ocorrencia_uq on public.mkt_grupos_campanhas (recorrencia_id, enviar_em);
create index if not exists mkt_grupos_camp_fila_idx on public.mkt_grupos_campanhas (status, enviar_em);
create index if not exists mkt_grupos_camp_cadencia_idx on public.mkt_grupos_campanhas (cadencia_id, enviar_em) where cadencia_id is not null;

-- O navegador pode criar/editar/agendar/pausar/cancelar. Montar fila, enviar e
-- concluir é só do servidor (auth.uid() nulo = service_role ou SQL).
create or replace function public.mkt_grupos_campanha_guarda()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.atualizado_em := now();
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.status not in ('rascunho', 'agendada') then
      raise exception 'Campanha nova nasce como rascunho ou agendada.' using errcode = '42501';
    end if;
    new.criado_por := auth.uid();
    new.fanout_em := null; new.total := 0; new.enviados := 0; new.falhas := 0;
    new.iniciado_em := null; new.concluido_em := null; new.erro := null; new.avisos := '{}';
    new.recorrencia_id := null;
  else
    if old.status in ('concluida', 'cancelada') then
      raise exception 'Campanha % não muda mais.', old.status using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('rascunho', 'agendada', 'pausada', 'cancelada') then
      raise exception 'Só o motor põe a campanha em "%".', new.status using errcode = '42501';
    end if;
    if old.fanout_em is not null and (
         new.tipo, new.texto, new.midia_url, new.enquete_opcoes, new.enquete_multipla, new.mencionar_todos, new.tag_ids, new.grupo_jids
       ) is distinct from (
         old.tipo, old.texto, old.midia_url, old.enquete_opcoes, old.enquete_multipla, old.mencionar_todos, old.tag_ids, old.grupo_jids
       ) then
      raise exception 'A fila desta campanha já foi montada: o conteúdo não muda. Cancele e crie outra.' using errcode = '42501';
    end if;
    if old.fanout_em is not null and new.status = 'rascunho' then
      raise exception 'Campanha já começou: pause ou cancele.' using errcode = '42501';
    end if;
    -- o navegador não mexe nos números do motor
    new.criado_por := old.criado_por; new.fanout_em := old.fanout_em; new.total := old.total;
    new.enviados := old.enviados; new.falhas := old.falhas; new.iniciado_em := old.iniciado_em;
    new.concluido_em := old.concluido_em; new.avisos := old.avisos; new.recorrencia_id := old.recorrencia_id;
    new.erro := old.erro;
  end if;
  if new.status = 'agendada' and new.enviar_em is null then
    raise exception 'Diga o dia e a hora do envio.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mkt_grupos_campanha_guarda on public.mkt_grupos_campanhas;
create trigger trg_mkt_grupos_campanha_guarda before insert or update on public.mkt_grupos_campanhas
  for each row execute function public.mkt_grupos_campanha_guarda();

-- ── 7) A FILA: uma linha por grupo destino (a fila é o estado) ──────────────
create table if not exists public.mkt_grupos_envios (
  id              bigserial primary key,
  campanha_id     uuid not null references public.mkt_grupos_campanhas(id) on delete cascade,
  grupo_jid       text not null check (grupo_jid ~ '^[0-9]+(-[0-9]+)?@g\.us$'),   -- SÓ grupo
  grupo_nome      text,
  status          text not null default 'pendente'
                  check (status in ('pendente','enviando','enviado','chegou','falha','cancelado','pulado')),
  tentativas      smallint not null default 0,
  instancia       text,            -- carimbo: por qual instância saiu
  msg_id          text,
  erro            text,
  reivindicado_em timestamptz,
  enviado_em      timestamptz,
  chegou_em       timestamptz,     -- a Evolution confirmou no grupo (não há "lido" por participante)
  criado_em       timestamptz not null default now(),
  constraint mkt_grupos_envios_uq unique (campanha_id, grupo_jid)
);
create index if not exists mkt_grupos_envios_pend_idx on public.mkt_grupos_envios (campanha_id, id) where status = 'pendente';
create index if not exists mkt_grupos_envios_msg_idx on public.mkt_grupos_envios (msg_id) where msg_id is not null;
create index if not exists mkt_grupos_envios_enviando_idx on public.mkt_grupos_envios (reivindicado_em) where status = 'enviando';

-- Nenhuma linha vai pra "enviando" por instância que não seja a do Marketing.
create or replace function public.mkt_grupos_envio_trava()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_inst text; v_num text; m text;
begin
  if new.status = 'enviando' and (tg_op = 'INSERT' or old.status is distinct from 'enviando') then
    select instancia, numero into v_inst, v_num from mkt_grupos_conexao where id = 1;
    if v_inst is null then
      raise exception 'Trava do Marketing: nenhuma instância configurada.' using errcode = '42501';
    end if;
    if new.instancia is null or lower(new.instancia) <> lower(v_inst) then
      raise exception 'Trava do Marketing: instância "%" não é a do Marketing.', new.instancia using errcode = '42501';
    end if;
    m := public.mkt_grupos_motivo_bloqueio(v_inst, v_num);
    if m is not null then raise exception 'Trava do Marketing: %', m using errcode = '42501'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mkt_grupos_envio_trava on public.mkt_grupos_envios;
create trigger trg_mkt_grupos_envio_trava before insert or update on public.mkt_grupos_envios
  for each row execute function public.mkt_grupos_envio_trava();

-- Cancelou a campanha: tira da fila quem ainda não recebeu.
create or replace function public.mkt_grupos_campanha_cancelada()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
    update mkt_grupos_envios set status = 'cancelado' where campanha_id = new.id and status = 'pendente';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_mkt_grupos_campanha_cancelada on public.mkt_grupos_campanhas;
create trigger trg_mkt_grupos_campanha_cancelada after update of status on public.mkt_grupos_campanhas
  for each row execute function public.mkt_grupos_campanha_cancelada();

-- A próxima linha da fila (lote), com trava. Só o servidor chama.
create or replace function public.mkt_grupos_reivindicar(p_instancia text, p_limite integer default 1)
returns setof public.mkt_grupos_envios
language plpgsql volatile security definer set search_path = public
as $$
declare v_inst text; v_num text; v_ligado boolean; m text;
begin
  select instancia, numero, envio_ligado into v_inst, v_num, v_ligado from mkt_grupos_conexao where id = 1;
  if v_inst is null then
    raise exception 'Trava do Marketing: nenhuma instância configurada.' using errcode = '42501';
  end if;
  if lower(v_inst) <> lower(btrim(coalesce(p_instancia, ''))) then
    raise exception 'Trava do Marketing: pediram a fila pela instância "%", que não é a do Marketing.', p_instancia using errcode = '42501';
  end if;
  m := public.mkt_grupos_motivo_bloqueio(v_inst, v_num);
  if m is not null then raise exception 'Trava do Marketing: %', m using errcode = '42501'; end if;
  if not v_ligado then return; end if;

  return query
  with alvo as (
    select e.id
      from mkt_grupos_envios e
      join mkt_grupos_campanhas k on k.id = e.campanha_id
     where e.status = 'pendente' and k.status = 'enviando' and k.enviar_em <= now()
     order by k.enviar_em, e.id
     limit greatest(1, least(coalesce(p_limite, 1), 20))
     for update of e skip locked
  )
  update mkt_grupos_envios e
     set status = 'enviando', tentativas = e.tentativas + 1, instancia = v_inst, reivindicado_em = now(), erro = null
    from alvo
   where e.id = alvo.id
  returning e.*;
end;
$$;
revoke all on function public.mkt_grupos_reivindicar(text, integer) from public, anon, authenticated;
grant execute on function public.mkt_grupos_reivindicar(text, integer) to service_role;
revoke all on function public.mkt_grupos_conexao_trava() from public, anon, authenticated;
revoke all on function public.mkt_grupos_envio_trava() from public, anon, authenticated;
revoke all on function public.mkt_grupos_campanha_guarda() from public, anon, authenticated;
revoke all on function public.mkt_grupos_campanha_cancelada() from public, anon, authenticated;

-- ── 8) RLS ──────────────────────────────────────────────────────────────────
alter table public.mkt_grupos_bloqueios    enable row level security;
alter table public.mkt_grupos_conexao      enable row level security;
alter table public.mkt_grupos              enable row level security;
alter table public.mkt_grupos_tags         enable row level security;
alter table public.mkt_grupos_tag_links    enable row level security;
alter table public.mkt_grupos_cadencias    enable row level security;
alter table public.mkt_grupos_recorrencias enable row level security;
alter table public.mkt_grupos_campanhas    enable row level security;
alter table public.mkt_grupos_envios       enable row level security;

revoke all on public.mkt_grupos_bloqueios, public.mkt_grupos_conexao, public.mkt_grupos,
  public.mkt_grupos_tags, public.mkt_grupos_tag_links, public.mkt_grupos_cadencias,
  public.mkt_grupos_recorrencias, public.mkt_grupos_campanhas, public.mkt_grupos_envios from anon;
revoke all on sequence public.mkt_grupos_envios_id_seq from anon, authenticated;

-- só leitura pelo navegador
revoke insert, update, delete, truncate on public.mkt_grupos_bloqueios, public.mkt_grupos_conexao,
  public.mkt_grupos, public.mkt_grupos_envios from authenticated;
grant select on public.mkt_grupos_bloqueios, public.mkt_grupos_conexao, public.mkt_grupos,
  public.mkt_grupos_envios to authenticated;
-- leitura e escrita pelo navegador (com RLS)
grant select, insert, update, delete on public.mkt_grupos_tags, public.mkt_grupos_tag_links,
  public.mkt_grupos_cadencias, public.mkt_grupos_recorrencias, public.mkt_grupos_campanhas to authenticated;

do $$
declare t text;
begin
  foreach t in array array['mkt_grupos_bloqueios','mkt_grupos_conexao','mkt_grupos','mkt_grupos_tags',
    'mkt_grupos_tag_links','mkt_grupos_cadencias','mkt_grupos_recorrencias','mkt_grupos_campanhas','mkt_grupos_envios']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.mkt_grupos_tem_acesso())', t || '_ler', t);
  end loop;
  foreach t in array array['mkt_grupos_tags','mkt_grupos_tag_links','mkt_grupos_cadencias','mkt_grupos_recorrencias','mkt_grupos_campanhas']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.mkt_grupos_tem_acesso())', t || '_inserir', t);
    execute format('drop policy if exists %I on public.%I', t || '_mudar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.mkt_grupos_tem_acesso()) with check (public.mkt_grupos_tem_acesso())', t || '_mudar', t);
  end loop;
  foreach t in array array['mkt_grupos_tags','mkt_grupos_tag_links','mkt_grupos_cadencias','mkt_grupos_recorrencias']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_apagar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.mkt_grupos_tem_acesso())', t || '_apagar', t);
  end loop;
end $$;
-- campanha só se apaga antes de a fila existir (depois: cancelar)
drop policy if exists mkt_grupos_campanhas_apagar on public.mkt_grupos_campanhas;
create policy mkt_grupos_campanhas_apagar on public.mkt_grupos_campanhas for delete to authenticated
  using (public.mkt_grupos_tem_acesso() and fanout_em is null and status in ('rascunho', 'agendada', 'pausada'));

-- ── 9) Arquivos das campanhas (público: a Evolution baixa pela URL) ─────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('mkt-grupos', 'mkt-grupos', true, 67108864)
on conflict (id) do nothing;
drop policy if exists mkt_grupos_arquivos_subir on storage.objects;
create policy mkt_grupos_arquivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mkt-grupos' and public.mkt_grupos_tem_acesso());

-- ── CONFERÊNCIA (depois de aplicar) ────────────────────────────────────────
--   select public.mkt_grupos_motivo_bloqueio('relacionamento-grupos-4183');   -- bloqueada
--   select public.mkt_grupos_motivo_bloqueio('marketing-rel');                -- bloqueada (palavra rel)
--   select public.mkt_grupos_motivo_bloqueio('numero-para-o-marketing--edmg0', '551153066577'); -- null
--   select public.mkt_grupos_motivo_bloqueio('marketing-x', '5511980124183'); -- bloqueada (número do Rel)
--   select public.mkt_grupos_motivo_bloqueio('marketing-x', '551180124183');  -- bloqueada (sem o 9)
--   insert into mkt_grupos_conexao (instancia) values ('relacionamento-grupos-4183');  -- ERRO 42501

-- ── ROLLBACK (comentado) ────────────────────────────────────────────────────
-- drop policy if exists mkt_grupos_arquivos_subir on storage.objects;
-- (bucket: esvaziar 'mkt-grupos' no painel e depois) delete from storage.buckets where id = 'mkt-grupos';
-- drop function if exists public.mkt_grupos_reivindicar(text, integer);
-- drop table if exists public.mkt_grupos_envios;
-- drop table if exists public.mkt_grupos_campanhas;
-- drop table if exists public.mkt_grupos_recorrencias;
-- drop table if exists public.mkt_grupos_cadencias;
-- drop table if exists public.mkt_grupos_tag_links;
-- drop table if exists public.mkt_grupos_tags;
-- drop table if exists public.mkt_grupos;
-- drop table if exists public.mkt_grupos_conexao;
-- drop table if exists public.mkt_grupos_bloqueios;
-- drop function if exists public.mkt_grupos_campanha_cancelada();
-- drop function if exists public.mkt_grupos_envio_trava();
-- drop function if exists public.mkt_grupos_campanha_guarda();
-- drop function if exists public.mkt_grupos_conexao_trava();
-- drop function if exists public.mkt_grupos_motivo_bloqueio(text, text);
-- drop function if exists public.mkt_grupos_sem_nono(text);
-- drop function if exists public.mkt_grupos_so_grupos(text[]);
-- drop function if exists public.mkt_grupos_tem_acesso();
