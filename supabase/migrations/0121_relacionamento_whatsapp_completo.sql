-- 0121_relacionamento_whatsapp_completo.sql
-- -----------------------------------------------------------------------------
-- WHATSAPP DO RELACIONAMENTO "IGUAL AO WHATSAPP" (Bruno, 14/10/2026).
--
--   1. Cada pessoa organiza a SUA lista: fixar, favoritar, arquivar, silenciar,
--      marcar como não lida (rel_wa_conversa_usuario — só a própria pessoa vê).
--   2. Etiquetas coloridas e listas ("grupos de conversas") do TIME.
--   3. Mensagem: reações (cliente e time), fixar no topo da conversa (time),
--      favoritar com estrela (cada um as suas).
--   4. Figurinhas do time (biblioteca compartilhada).
--   5. Bloco de notas PARTICULAR (rel_notas): só o dono lê — nem admin.
--   6. Respostas prontas com atalho (/atalho) e categoria; quem padroniza é a
--      gestora/admin (rel_pode_configurar). O time usa.
--   7. rel_wa_fila refeita com o que é da pessoa logada (security_invoker).
-- -----------------------------------------------------------------------------

-- ── 1. Preferências da pessoa por conversa ─────────────────────────────────
create table if not exists rel_wa_conversa_usuario (
  conversa_id      uuid not null references rel_wa_conversas(id) on delete cascade,
  user_id          uuid not null default auth.uid() references qs_users(id) on delete cascade,
  fixada_em        timestamptz,
  favorita         boolean not null default false,
  arquivada        boolean not null default false,
  silenciada       boolean not null default false,
  marcada_nao_lida boolean not null default false,
  atualizado_em    timestamptz not null default now(),
  primary key (conversa_id, user_id)
);
alter table rel_wa_conversa_usuario enable row level security;
drop policy if exists rel_wa_cu_tudo on rel_wa_conversa_usuario;
create policy rel_wa_cu_tudo on rel_wa_conversa_usuario for all to authenticated
  using (user_id = auth.uid() and rel_tem_acesso())
  with check (user_id = auth.uid() and rel_tem_acesso());
grant select, insert, update, delete on rel_wa_conversa_usuario to authenticated;

-- ── 2. Etiquetas e listas (do time) ────────────────────────────────────────
create table if not exists rel_wa_etiquetas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (length(trim(nome)) between 1 and 40),
  cor       text not null default '#00A884',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create unique index if not exists rel_wa_etiquetas_nome_uq on rel_wa_etiquetas (lower(trim(nome)));

create table if not exists rel_wa_conversa_etiquetas (
  conversa_id uuid not null references rel_wa_conversas(id) on delete cascade,
  etiqueta_id uuid not null references rel_wa_etiquetas(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (conversa_id, etiqueta_id)
);

create table if not exists rel_wa_listas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (length(trim(nome)) between 1 and 40),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create unique index if not exists rel_wa_listas_nome_uq on rel_wa_listas (lower(trim(nome)));

create table if not exists rel_wa_lista_conversas (
  lista_id    uuid not null references rel_wa_listas(id) on delete cascade,
  conversa_id uuid not null references rel_wa_conversas(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (lista_id, conversa_id)
);

do $$
declare t text;
begin
  foreach t in array array['rel_wa_etiquetas','rel_wa_conversa_etiquetas','rel_wa_listas','rel_wa_lista_conversas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tudo', t);
    execute format('create policy %I on %I for all to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso())', t || '_tudo', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ── 3. Mensagens: reações, fixar, favoritas ────────────────────────────────
alter table rel_wa_mensagens add column if not exists reacoes    jsonb not null default '[]'::jsonb;
alter table rel_wa_mensagens add column if not exists fixada_em  timestamptz;
alter table rel_wa_mensagens add column if not exists fixada_por uuid;

-- Reação (servidor): uma por autor; emoji vazio tira. p_de = 'cliente' | user id.
create or replace function rel_wa_reagir(p_wamid text, p_de text, p_nome text, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lista jsonb;
begin
  select id, reacoes into v_id, v_lista from rel_wa_mensagens where wamid = p_wamid limit 1;
  if v_id is null then return false; end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_lista
    from jsonb_array_elements(coalesce(v_lista, '[]'::jsonb)) r where r ->> 'de' is distinct from p_de;
  if coalesce(p_emoji, '') <> '' then
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('de', p_de, 'nome', p_nome, 'emoji', p_emoji, 'em', now()));
  end if;
  update rel_wa_mensagens set reacoes = v_lista where id = v_id;
  return true;
end $$;
revoke all on function rel_wa_reagir(text, text, text, text) from public, anon, authenticated;

-- Fixar no topo da conversa (o time vê). Até 3 por conversa, como no WhatsApp.
create or replace function rel_wa_fixar_mensagem(p_msg uuid, p_fixar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  select conversa_id into v_conv from rel_wa_mensagens where id = p_msg;
  if v_conv is null then raise exception 'Mensagem não encontrada.'; end if;
  if p_fixar then
    update rel_wa_mensagens set fixada_em = now(), fixada_por = auth.uid() where id = p_msg;
    -- Passou de 3: solta a mais antiga.
    update rel_wa_mensagens set fixada_em = null, fixada_por = null
     where id in (select id from rel_wa_mensagens where conversa_id = v_conv and fixada_em is not null
                   order by fixada_em desc offset 3);
  else
    update rel_wa_mensagens set fixada_em = null, fixada_por = null where id = p_msg;
  end if;
end $$;
grant execute on function rel_wa_fixar_mensagem(uuid, boolean) to authenticated;

create table if not exists rel_wa_mensagem_favoritas (
  mensagem_id uuid not null references rel_wa_mensagens(id) on delete cascade,
  user_id     uuid not null default auth.uid() references qs_users(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (mensagem_id, user_id)
);
alter table rel_wa_mensagem_favoritas enable row level security;
drop policy if exists rel_wa_mf_tudo on rel_wa_mensagem_favoritas;
create policy rel_wa_mf_tudo on rel_wa_mensagem_favoritas for all to authenticated
  using (user_id = auth.uid() and rel_tem_acesso()) with check (user_id = auth.uid() and rel_tem_acesso());
grant select, insert, delete on rel_wa_mensagem_favoritas to authenticated;

-- ── 4. Figurinhas do time ──────────────────────────────────────────────────
create table if not exists rel_wa_figurinhas (
  id         uuid primary key default gen_random_uuid(),
  url        text not null unique,
  animada    boolean not null default false,
  criado_por uuid default auth.uid(),
  criado_em  timestamptz not null default now()
);
alter table rel_wa_figurinhas enable row level security;
drop policy if exists rel_wa_fig_ler on rel_wa_figurinhas;
drop policy if exists rel_wa_fig_apagar on rel_wa_figurinhas;
create policy rel_wa_fig_ler on rel_wa_figurinhas for select to authenticated using (rel_tem_acesso());
create policy rel_wa_fig_apagar on rel_wa_figurinhas for delete to authenticated
  using (rel_tem_acesso() and (criado_por = auth.uid() or rel_pode_configurar()));
grant select, delete on rel_wa_figurinhas to authenticated;
-- Inserir é só pelo servidor (/api/rel-wa: converte e guarda o arquivo).

-- ── 5. Bloco de notas particular ───────────────────────────────────────────
create table if not exists rel_notas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references qs_users(id) on delete cascade,
  titulo        text not null default '',
  texto         text not null default '',
  cor           text,
  fixada        boolean not null default false,
  conversa_id   uuid references rel_wa_conversas(id) on delete set null,
  cliente_id    uuid references rel_clientes(id) on delete set null,
  mensagem_id   uuid references rel_wa_mensagens(id) on delete set null,
  -- Cópia da mensagem guardada (se a conversa sumir, a nota continua).
  mensagem      jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists rel_notas_user_idx on rel_notas (user_id, atualizado_em desc);
alter table rel_notas enable row level security;
drop policy if exists rel_notas_dono on rel_notas;
create policy rel_notas_dono on rel_notas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and rel_tem_acesso());
grant select, insert, update, delete on rel_notas to authenticated;

create or replace function rel_notas_tocar() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists rel_notas_tocar on rel_notas;
create trigger rel_notas_tocar before update on rel_notas for each row execute function rel_notas_tocar();

-- ── 6. Respostas prontas: atalho + categoria; a gestora padroniza ──────────
alter table rel_wa_respostas add column if not exists atalho    text;
alter table rel_wa_respostas add column if not exists categoria text;
create unique index if not exists rel_wa_respostas_atalho_uq on rel_wa_respostas (lower(atalho)) where atalho is not null and atalho <> '';
drop policy if exists rel_wa_resp_criar  on rel_wa_respostas;
drop policy if exists rel_wa_resp_mudar  on rel_wa_respostas;
drop policy if exists rel_wa_resp_apagar on rel_wa_respostas;
create policy rel_wa_resp_criar  on rel_wa_respostas for insert to authenticated with check (rel_pode_configurar());
create policy rel_wa_resp_mudar  on rel_wa_respostas for update to authenticated using (rel_pode_configurar()) with check (rel_pode_configurar());
create policy rel_wa_resp_apagar on rel_wa_respostas for delete to authenticated using (rel_pode_configurar());

-- ── 7. A fila com o que é da pessoa logada ─────────────────────────────────
drop view if exists rel_wa_fila;
create view rel_wa_fila with (security_invoker = true) as
select c.id, c.phone_number_id, c.telefone, c.nome_contato, c.cliente_id, c.atendente_id, c.estado,
       c.aguardando_desde, c.ultima_entrada_em, c.ultima_saida_em, c.ultima_mensagem, c.nao_lidas,
       c.auto_resposta_em, c.criado_em, c.atualizado_em, c.optout_em,
       c.sem_sla, c.sem_sla_motivo, c.sem_sla_por, c.sem_sla_em,
       cl.nome AS cliente_nome,
       u.name  AS atendente_nome,
       rel_minutos_uteis(c.aguardando_desde, now()) AS minutos_esperando,
       coalesce((select (valor ->> 'resposta_min')::int from rel_config where chave = 'sla'), 30) AS meta_min,
       (c.ultima_entrada_em is not null and c.ultima_entrada_em > now() - interval '24 hours') AS janela_aberta,
       cu.fixada_em,
       coalesce(cu.favorita, false)         AS favorita,
       coalesce(cu.arquivada, false)        AS arquivada,
       coalesce(cu.silenciada, false)       AS silenciada,
       coalesce(cu.marcada_nao_lida, false) AS marcada_nao_lida,
       coalesce((select array_agg(ce.etiqueta_id) from rel_wa_conversa_etiquetas ce where ce.conversa_id = c.id), '{}') AS etiquetas,
       coalesce((select array_agg(lc.lista_id) from rel_wa_lista_conversas lc where lc.conversa_id = c.id), '{}') AS listas
  from rel_wa_conversas c
  left join rel_clientes cl on cl.id = c.cliente_id
  left join qs_users u      on u.id  = c.atendente_id
  left join rel_wa_conversa_usuario cu on cu.conversa_id = c.id and cu.user_id = auth.uid();
grant select on rel_wa_fila to authenticated;
