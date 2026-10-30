-- =============================================================================
-- 0241 — DRIVE DO MARKETING (índice local do Drive compartilhado "Marketing")
-- =============================================================================
-- Pedido do Bruno (30/10/2026): todos os vídeos e conteúdos gravados arquivados
-- e fáceis de achar, pro Orgânico e pro Tráfego, sem sair do QS.
--
-- Os ARQUIVOS moram no Google Drive compartilhado "Marketing" (o QS fala com ele
-- por uma conta de serviço — api/mkt-drive.js). Aqui fica só o ÍNDICE:
--   1. mkt_drive_arquivos — uma linha por arquivo/pasta do Drive: nome, tipo,
--      pasta, tamanho, duração, link + o que o Drive NÃO tem: tags do QS,
--      destino/expedição, observação e quem subiu pelo QS.
--   2. mkt_drive_estado   — onde a sincronização parou (pageToken da changes API).
--   3. mkt_drive_pode()   — quem é do Marketing (ou admin).
--   4. mkt_drive_buscar() — a busca da tela (nome, tipo, pasta com subpastas,
--      data, tags, destino, expedição), paginada com desempate pelo id.
--   5. mkt_drive_tags()   — as tags em uso (sugestões no campo de tag).
--
-- PERMISSÃO
--   • O papel `marketing` é "só leitura" pelo gatilho qs_bloqueia_espectador
--     (0036/0126) — mas esse gatilho só foi instalado nas tabelas qs_* (loop por
--     nome na 0036) e NÃO existe event trigger que o instale em tabela nova.
--     Então as tabelas mkt_* NÃO herdam o bloqueio: a regra delas é a RLS abaixo.
--   • Ler: Marketing (role = 'marketing' ou setor 'marketing') e admin.
--   • Escrever pelo navegador: só UPDATE das colunas do QS (tags, destino,
--     expedição, observação) — as colunas que espelham o Drive são do servidor.
--     Inserir/apagar linha: só o servidor (service_role), que é quem sincroniza.
--
-- ADITIVA: só cria coisa nova (2 tabelas, 3 funções, policies, índices).
-- Não altera nenhuma tabela/função existente. Idempotente.
-- =============================================================================

-- ── 3. Quem é do Marketing ───────────────────────────────────────────────────
-- Nome próprio (mkt_drive_*) pra não colidir com a função de acesso que a 0240
-- (área Marketing) venha a criar; a integração pode trocar por ela depois.
create or replace function public.mkt_drive_pode()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Integração 30/10: uma regra só pra área toda (mkt_tem_acesso, 0240 —
  -- admin, papel marketing ou quem tem o setor Marketing).
  select public.mkt_tem_acesso();
$$;
revoke all on function public.mkt_drive_pode() from public, anon;
grant execute on function public.mkt_drive_pode() to authenticated;

-- ── 1. O índice ──────────────────────────────────────────────────────────────
create table if not exists public.mkt_drive_arquivos (
  drive_file_id        text primary key,           -- id do Google Drive
  drive_id             text,                       -- id do Drive compartilhado
  nome                 text not null,
  mime_type            text not null,
  tipo                 text not null default 'outro'
                         check (tipo in ('pasta', 'video', 'imagem', 'audio', 'pdf', 'documento', 'outro')),
  pasta_id             text,                       -- pai no Drive (no Drive compartilhado é um só)
  tamanho              bigint,                     -- bytes (Docs do Google não têm)
  duracao_ms           bigint,                     -- vídeo, quando o Drive já processou
  largura              int,
  altura               int,
  tem_miniatura        boolean not null default false,
  web_view_link        text,
  icone_link           text,
  descricao_drive      text,
  na_lixeira           boolean not null default false,
  removido             boolean not null default false, -- apagado de vez no Drive (changes.removed)
  criado_no_drive      timestamptz,
  modificado_no_drive  timestamptz,
  modificado_por       text,
  sincronizado_em      timestamptz not null default now(),
  -- ↓ o que é do QS (o Drive não tem)
  tags                 text[] not null default '{}',
  destino              text,
  expedicao_id         uuid references public.expedicoes(id) on delete set null,
  observacao           text,
  subido_por           uuid references public.qs_users(id) on delete set null,
  subido_em            timestamptz,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  constraint mkt_drive_tags_max check (cardinality(tags) <= 20)
);

comment on table public.mkt_drive_arquivos is
  '0241 — índice do Drive compartilhado do Marketing. Espelho do Drive (servidor) + tags/destino do QS (tela).';

create index if not exists mkt_drive_arquivos_pasta_idx on public.mkt_drive_arquivos (pasta_id) where not na_lixeira and not removido;
create index if not exists mkt_drive_arquivos_tipo_idx  on public.mkt_drive_arquivos (tipo, modificado_no_drive desc);
create index if not exists mkt_drive_arquivos_tags_idx  on public.mkt_drive_arquivos using gin (tags);
create index if not exists mkt_drive_arquivos_exp_idx   on public.mkt_drive_arquivos (expedicao_id) where expedicao_id is not null;
create index if not exists mkt_drive_arquivos_nome_idx  on public.mkt_drive_arquivos (lower(nome) text_pattern_ops);

-- atualizado_em sozinho
create or replace function public.mkt_drive_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists trg_mkt_drive_arquivos_tocar on public.mkt_drive_arquivos;
create trigger trg_mkt_drive_arquivos_tocar before update on public.mkt_drive_arquivos
  for each row execute function public.mkt_drive_tocar();

-- O navegador só mexe nas colunas do QS. O resto é espelho do Drive: se alguém
-- autenticado (não o service_role) tentar mudar nome/pasta/lixeira por aqui,
-- o valor antigo volta — mudar no Drive é pelo api/mkt-drive.js.
create or replace function public.mkt_drive_so_colunas_do_qs()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Só o usuário logado no navegador (papel `authenticated` do PostgREST) é
  -- contido; service_role (sincronização) e postgres (SQL à mão) passam.
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.drive_file_id := old.drive_file_id;   new.drive_id := old.drive_id;
  new.nome := old.nome;                     new.mime_type := old.mime_type;
  new.tipo := old.tipo;                     new.pasta_id := old.pasta_id;
  new.tamanho := old.tamanho;               new.duracao_ms := old.duracao_ms;
  new.largura := old.largura;               new.altura := old.altura;
  new.tem_miniatura := old.tem_miniatura;   new.web_view_link := old.web_view_link;
  new.icone_link := old.icone_link;         new.descricao_drive := old.descricao_drive;
  new.na_lixeira := old.na_lixeira;         new.removido := old.removido;
  new.criado_no_drive := old.criado_no_drive;
  new.modificado_no_drive := old.modificado_no_drive;
  new.modificado_por := old.modificado_por; new.sincronizado_em := old.sincronizado_em;
  new.subido_por := old.subido_por;         new.subido_em := old.subido_em;
  new.criado_em := old.criado_em;
  return new;
end;
$$;
drop trigger if exists trg_mkt_drive_arquivos_colunas on public.mkt_drive_arquivos;
create trigger trg_mkt_drive_arquivos_colunas before update on public.mkt_drive_arquivos
  for each row execute function public.mkt_drive_so_colunas_do_qs();

alter table public.mkt_drive_arquivos enable row level security;

drop policy if exists mkt_drive_arquivos_ler on public.mkt_drive_arquivos;
create policy mkt_drive_arquivos_ler on public.mkt_drive_arquivos
  for select to authenticated using ((select public.mkt_drive_pode()));

drop policy if exists mkt_drive_arquivos_etiquetar on public.mkt_drive_arquivos;
create policy mkt_drive_arquivos_etiquetar on public.mkt_drive_arquivos
  for update to authenticated
  using ((select public.mkt_drive_pode()))
  with check ((select public.mkt_drive_pode()));
-- Sem policy de INSERT/DELETE: só o service_role (sincronização) cria/apaga linha.

revoke all on public.mkt_drive_arquivos from anon;
grant select, update on public.mkt_drive_arquivos to authenticated;

-- ── 2. Estado da sincronização ───────────────────────────────────────────────
create table if not exists public.mkt_drive_estado (
  id                 int primary key default 1 check (id = 1),
  drive_id           text,          -- se MKT_DRIVE_ID mudar, a varredura recomeça
  page_token         text,          -- changes.list: de onde continuar
  token_pendente     text,          -- startPageToken guardado durante a 1ª varredura
  varrendo           boolean not null default false,
  varredura_token    text,          -- files.list: página da 1ª varredura
  ultima_sync        timestamptz,
  ultimo_erro        text,
  arquivos_vistos    bigint not null default 0,
  atualizado_em      timestamptz not null default now()
);
comment on table public.mkt_drive_estado is '0241 — cursor da sincronização Drive → mkt_drive_arquivos (linha única).';

alter table public.mkt_drive_estado enable row level security;
drop policy if exists mkt_drive_estado_ler on public.mkt_drive_estado;
create policy mkt_drive_estado_ler on public.mkt_drive_estado
  for select to authenticated using ((select public.mkt_drive_pode()));
revoke all on public.mkt_drive_estado from anon;
grant select on public.mkt_drive_estado to authenticated;

-- ── 4. Busca ─────────────────────────────────────────────────────────────────
-- security invoker: a RLS de mkt_drive_arquivos vale (o servidor chama com
-- service_role; o navegador, se chamar, só vê se for do Marketing).
-- p_pasta inclui as subpastas (recursivo). Tags: precisa ter TODAS as pedidas.
create or replace function public.mkt_drive_buscar(
  p_texto      text    default null,
  p_tipo       text    default null,
  p_pasta      text    default null,
  p_desde      date    default null,
  p_ate        date    default null,
  p_tags       text[]  default null,
  p_destino    text    default null,
  p_expedicao  uuid    default null,
  p_limite     int     default 50,
  p_offset     int     default 0
)
returns setof public.mkt_drive_arquivos
language sql
stable
security invoker
set search_path = public
as $$
  with recursive sub(id) as (
    select p_pasta where p_pasta is not null
    union
    select a.drive_file_id
      from public.mkt_drive_arquivos a
      join sub on a.pasta_id = sub.id
     where a.tipo = 'pasta' and not a.na_lixeira and not a.removido
  )
  select a.*
    from public.mkt_drive_arquivos a
   where not a.na_lixeira and not a.removido
     and (p_texto is null or btrim(p_texto) = ''
          or a.nome ilike '%' || replace(replace(replace(btrim(p_texto), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or a.observacao ilike '%' || replace(replace(replace(btrim(p_texto), '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or exists (select 1 from unnest(a.tags) t where t = lower(btrim(p_texto))))
     and (p_tipo is null or p_tipo = '' or a.tipo = p_tipo)
     and (p_pasta is null or a.pasta_id in (select id from sub))
     and (p_desde is null or a.modificado_no_drive >= (p_desde::text || ' 00:00:00-03')::timestamptz)
     and (p_ate is null or a.modificado_no_drive < ((p_ate + 1)::text || ' 00:00:00-03')::timestamptz)
     and (p_tags is null or cardinality(p_tags) = 0 or a.tags @> p_tags)
     and (p_destino is null or p_destino = '' or a.destino ilike p_destino)
     and (p_expedicao is null or a.expedicao_id = p_expedicao)
   order by a.modificado_no_drive desc nulls last, a.drive_file_id
   limit least(greatest(coalesce(p_limite, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.mkt_drive_buscar(text, text, text, date, date, text[], text, uuid, int, int) from public, anon;
grant execute on function public.mkt_drive_buscar(text, text, text, date, date, text[], text, uuid, int, int) to authenticated;

-- ── 5. Tags em uso ───────────────────────────────────────────────────────────
create or replace function public.mkt_drive_tags()
returns table (tag text, quantos bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t, count(*)
    from public.mkt_drive_arquivos a, unnest(a.tags) t
   where not a.na_lixeira and not a.removido
   group by t
   order by count(*) desc, t
   limit 200;
$$;
revoke all on function public.mkt_drive_tags() from public, anon;
grant execute on function public.mkt_drive_tags() to authenticated;

-- ── CONFERÊNCIA (depois de aplicar) ──────────────────────────────────────────
--   select count(*) from mkt_drive_arquivos;                     -- 0 até a 1ª sincronização
--   select * from mkt_drive_estado;                              -- vazia até a 1ª sincronização
--   -- logado como alguém do Comercial (não Marketing): select count(*) from mkt_drive_arquivos; → 0
--   -- logado como Marketing: update mkt_drive_arquivos set tags='{teste}' where ...; → passa
--   --                        update mkt_drive_arquivos set nome='x' where ...;      → nome não muda

-- ---------------------------------------------------------------------------
-- ROLLBACK (rodar à mão, nesta ordem). Apaga o ÍNDICE e as tags do QS; os
-- arquivos no Google Drive NÃO são tocados.
--
--   drop function if exists public.mkt_drive_tags();
--   drop function if exists public.mkt_drive_buscar(text, text, text, date, date, text[], text, uuid, int, int);
--   drop table if exists public.mkt_drive_estado;
--   drop table if exists public.mkt_drive_arquivos;
--   drop function if exists public.mkt_drive_so_colunas_do_qs();
--   drop function if exists public.mkt_drive_tocar();
--   drop function if exists public.mkt_drive_pode();
-- ---------------------------------------------------------------------------
