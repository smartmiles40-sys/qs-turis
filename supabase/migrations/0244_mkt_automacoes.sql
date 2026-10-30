-- 0244_mkt_automacoes.sql
-- NÃO APLICADA (30/10/2026). Só arquivo — aplicar só com o ok do Bruno.
-- ORDEM: depois da 0242 (obrigatória: usa mkt_contatos / mkt_contato_eventos,
--        que a frente de Disparos cria). A 0240/0241/0243 não são necessárias.
-- Idempotente (pode rodar 2x). Rollback comentado no fim.
--
-- AUTOMAÇÕES DO MARKETING, "igual ManyChat" (porte do SendFlow 0020 + 0025):
--
--   1. O número do Marketing passa a existir como SETOR em qs_wa_numeros_meta
--      ('marketing', ao lado de 'comercial' e 'relacionamento'). É o setor que
--      faz o webhook (api/_metaEntrada.js) desviar a mensagem pro motor do
--      Marketing. Número com setor comercial/relacionamento: NADA muda.
--   2. A conversa (mkt_wa_conversas + mkt_wa_mensagens): janela de 24 h, caixa
--      de entrada do Tráfego, "pausar o robô". Separada das do Comercial
--      (qs_wa_messages) e do Rel (rel_wa_*) de propósito: mensagem do número
--      do Marketing nunca vira lead nem conversa do pós-venda.
--   3. O fluxo (mkt_fluxos, grafo em jsonb), o gatilho (mkt_fluxo_gatilhos),
--      a execução (mkt_fluxo_execucoes: onde cada pessoa está — é o que aguenta
--      "espere 2 dias" sem processo parado) e os eventos por bloco (estatística).
--   4. Campos personalizados (mkt_campos) — o VALOR mora em mkt_contatos.campos.
--   5. Instagram (mkt_ig_*): comentário → resposta pública + DM, story, DM.
--      Nasce DESLIGADO (mkt_auto_config.instagram.ligado = false).
--
-- QUEM MEXE: o papel 'marketing' é só leitura nas tabelas qs_* (gatilho da
-- 0036/0126 — que só pega tabela que começa com qs_). Estas tabelas são mkt_*,
-- então o gatilho não as alcança; a regra aqui é a RLS própria abaixo
-- (mkt_auto_acesso): admin, marketing e gestor do Comercial. Nada do resto abre.
-- O que fala com a Meta (mandar, pausar, tags) passa pela rota /api/mkt-automacoes
-- (service_role); a tela escreve direto só fluxos, gatilhos, campos, config e
-- automações do Instagram.
-- =============================================================================

do $$
begin
  if to_regclass('public.mkt_contatos') is null then
    raise exception '0244: rode a 0242 (mkt_contatos) antes desta.';
  end if;
end $$;

-- ── 0. Quem acessa a área ───────────────────────────────────────────────────
create or replace function public.mkt_auto_acesso()
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
revoke all on function public.mkt_auto_acesso() from public, anon;
grant execute on function public.mkt_auto_acesso() to authenticated;

create or replace function public.mkt_auto_touch()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- ── 1. O setor 'marketing' no número da Meta ────────────────────────────────
alter table qs_wa_numeros_meta drop constraint if exists qs_wa_numeros_meta_setor_check;
alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_setor_check
  check (setor in ('comercial', 'relacionamento', 'marketing'));
-- (qs_wa_numeros_meta_setor_sem_dono continua: só o comercial tem dono.)

-- ── 2. Configuração ─────────────────────────────────────────────────────────
create table if not exists public.mkt_auto_config (
  chave          text primary key,
  valor          jsonb not null default '{}'::jsonb,
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);
insert into public.mkt_auto_config (chave, valor) values
  -- ligado=false desliga o robô inteiro do WhatsApp (as mensagens continuam
  -- sendo gravadas na caixa). pausa_manual_horas: responder à mão pausa o robô.
  ('robo', '{"ligado": true, "pausa_manual_horas": 12}'::jsonb),
  ('instagram', '{"ligado": false}'::jsonb)
on conflict (chave) do nothing;
drop trigger if exists trg_mkt_auto_config_touch on public.mkt_auto_config;
create trigger trg_mkt_auto_config_touch before update on public.mkt_auto_config
  for each row execute function public.mkt_auto_touch();

-- ── 3. Campos personalizados ────────────────────────────────────────────────
create table if not exists public.mkt_campos (
  id        uuid primary key default gen_random_uuid(),
  chave     text not null check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo    text not null,
  tipo      text not null default 'texto' check (tipo in ('texto', 'numero', 'data', 'sim_nao', 'email', 'telefone')),
  descricao text,
  criado_em timestamptz not null default now()
);
create unique index if not exists mkt_campos_chave_uidx on public.mkt_campos (chave);

-- ── 4. A conversa do número do Marketing ────────────────────────────────────
create table if not exists public.mkt_wa_conversas (
  id                    uuid primary key default gen_random_uuid(),
  phone_number_id       text not null,
  contato_id            uuid references public.mkt_contatos(id) on delete set null,
  -- O wa_id EXATAMENTE como a Meta manda (às vezes sem o nono dígito). É pra ele
  -- que se responde.
  wa_id                 text not null,
  nome_perfil           text,
  ultima_entrada_em     timestamptz,
  ultima_mensagem_em    timestamptz,
  ultima_previa         text,
  nao_lidas             integer not null default 0,
  automacao_pausada_ate timestamptz,
  precisa_humano_em     timestamptz,
  atendente_id          uuid references qs_users(id) on delete set null,
  status                text not null default 'aberta' check (status in ('aberta', 'fechada')),
  processando_ate       timestamptz,
  resposta_padrao_em    timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create unique index if not exists mkt_wa_conversas_uidx on public.mkt_wa_conversas (phone_number_id, wa_id);
create index if not exists mkt_wa_conversas_recentes_idx on public.mkt_wa_conversas (ultima_mensagem_em desc nulls last);
create index if not exists mkt_wa_conversas_contato_idx on public.mkt_wa_conversas (contato_id);
drop trigger if exists trg_mkt_wa_conversas_touch on public.mkt_wa_conversas;
create trigger trg_mkt_wa_conversas_touch before update on public.mkt_wa_conversas
  for each row execute function public.mkt_auto_touch();

create table if not exists public.mkt_wa_mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.mkt_wa_conversas(id) on delete cascade,
  direcao     text not null check (direcao in ('in', 'out')),
  tipo        text not null default 'texto',
  texto       text,
  payload     jsonb,
  -- Idempotência: a Meta REENVIA o mesmo evento; o índice único transforma a
  -- segunda entrega em conflito, e o motor não responde duas vezes.
  wamid       text,
  status      text check (status is null or status in ('enviado', 'entregue', 'lido', 'falha')),
  erro        text,
  origem      text check (origem is null or origem in ('cliente', 'fluxo', 'manual', 'teste', 'eco')),
  fluxo_id    uuid,
  no_id       text,
  autor_id    uuid references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create unique index if not exists mkt_wa_mensagens_wamid_uidx on public.mkt_wa_mensagens (wamid) where wamid is not null;
create index if not exists mkt_wa_mensagens_conversa_idx on public.mkt_wa_mensagens (conversa_id, criado_em desc);

-- ── 5. O fluxo, o gatilho, a execução, os eventos ───────────────────────────
create table if not exists public.mkt_fluxos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  descricao        text,
  status           text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado')),
  -- {"nos":[{"id","tipo","x","y","titulo","dados"}], "ligacoes":[{"id","de","saida","para"}]}
  grafo            jsonb not null default '{"nos":[],"ligacoes":[]}'::jsonb,
  pasta            text,
  execucoes_total  integer not null default 0,
  concluidas_total integer not null default 0,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
drop trigger if exists trg_mkt_fluxos_touch on public.mkt_fluxos;
create trigger trg_mkt_fluxos_touch before update on public.mkt_fluxos
  for each row execute function public.mkt_auto_touch();

create table if not exists public.mkt_fluxo_gatilhos (
  id         uuid primary key default gen_random_uuid(),
  fluxo_id   uuid not null references public.mkt_fluxos(id) on delete cascade,
  tipo       text not null check (tipo in (
    'palavra_chave',  -- {"palavras":["japão"],"modo":"contem|exata|comeca"}
    'boas_vindas',    -- a 1ª mensagem da pessoa pro número
    'padrao',         -- nada casou: {"intervalo_horas":24}
    'link_ref',       -- wa.me com [ref:codigo] / QR: {"codigo":"live-peru","texto":"..."}
    'anuncio',        -- clique-para-WhatsApp: {"ad_ids":[...]} (vazio = qualquer anúncio)
    'tag_adicionada', -- {"tag":"quente"}
    'webhook'         -- LP / n8n: {"token":"..."}  → POST /api/mkt-automacoes?lp=<token>
  )),
  config     jsonb not null default '{}'::jsonb,
  ativo      boolean not null default true,
  prioridade smallint not null default 0,
  disparos   integer not null default 0,
  criado_em  timestamptz not null default now()
);
create index if not exists mkt_fluxo_gatilhos_tipo_idx on public.mkt_fluxo_gatilhos (tipo) where ativo;
create index if not exists mkt_fluxo_gatilhos_fluxo_idx on public.mkt_fluxo_gatilhos (fluxo_id);
create unique index if not exists mkt_fluxo_gatilhos_ref_uidx
  on public.mkt_fluxo_gatilhos ((lower(config ->> 'codigo'))) where tipo = 'link_ref';
create unique index if not exists mkt_fluxo_gatilhos_token_uidx
  on public.mkt_fluxo_gatilhos ((config ->> 'token')) where tipo = 'webhook';

create table if not exists public.mkt_fluxo_execucoes (
  id           uuid primary key default gen_random_uuid(),
  fluxo_id     uuid not null references public.mkt_fluxos(id) on delete cascade,
  conversa_id  uuid not null references public.mkt_wa_conversas(id) on delete cascade,
  contato_id   uuid references public.mkt_contatos(id) on delete set null,
  gatilho_id   uuid references public.mkt_fluxo_gatilhos(id) on delete set null,
  no_atual     text,
  estado       text not null default 'rodando' check (estado in (
    'rodando', 'aguardando_resposta', 'aguardando_tempo', 'concluida', 'cancelada', 'erro')),
  acordar_em   timestamptz,
  aguardando   jsonb,
  passos       integer not null default 0,
  teste        boolean not null default false,
  erro         text,
  travada_ate  timestamptz,
  iniciada_em  timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  concluida_em timestamptz
);
create index if not exists mkt_fluxo_execucoes_acordar_idx
  on public.mkt_fluxo_execucoes (acordar_em) where estado in ('aguardando_tempo', 'aguardando_resposta');
create index if not exists mkt_fluxo_execucoes_conversa_idx
  on public.mkt_fluxo_execucoes (conversa_id) where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo');
create index if not exists mkt_fluxo_execucoes_fluxo_idx on public.mkt_fluxo_execucoes (fluxo_id, iniciada_em desc);

create table if not exists public.mkt_fluxo_eventos (
  id          bigserial primary key,
  fluxo_id    uuid not null references public.mkt_fluxos(id) on delete cascade,
  execucao_id uuid references public.mkt_fluxo_execucoes(id) on delete cascade,
  no_id       text not null,
  tipo        text not null check (tipo in ('entrou', 'enviou', 'saida', 'erro')),
  saida       text,
  detalhe     text,
  criado_em   timestamptz not null default now()
);
create index if not exists mkt_fluxo_eventos_fluxo_idx on public.mkt_fluxo_eventos (fluxo_id, no_id, tipo);

-- ── 6. Funções do motor (só service_role) ───────────────────────────────────

-- Entrada nova: abre a janela e soma a não lida SEM ler-somar-gravar na aplicação.
create or replace function public.mkt_wa_registrar_entrada(p_conversa uuid, p_quando timestamptz, p_previa text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_wa_conversas
     set ultima_entrada_em  = greatest(coalesce(ultima_entrada_em, p_quando), p_quando),
         ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, p_quando), p_quando),
         ultima_previa      = left(coalesce(p_previa, ''), 200),
         nao_lidas          = nao_lidas + 1,
         status             = 'aberta'
   where id = p_conversa;
$$;

-- Trava curta: "oi" + "japão" em sequência não abrem dois fluxos de boas-vindas.
create or replace function public.mkt_auto_tomar_conversa(p_conversa uuid, p_segundos int default 25)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  update public.mkt_wa_conversas
     set processando_ate = now() + make_interval(secs => greatest(1, least(p_segundos, 120)))
   where id = p_conversa and (processando_ate is null or processando_ate < now())
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function public.mkt_auto_soltar_conversa(p_conversa uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_wa_conversas set processando_ate = null where id = p_conversa;
$$;

-- O cron pega as execuções vencidas já travadas (skip locked: dois crons, lotes diferentes).
create or replace function public.mkt_auto_reivindicar(p_limite int)
returns setof public.mkt_fluxo_execucoes
language sql
security definer
set search_path = public
as $$
  update public.mkt_fluxo_execucoes x
     set travada_ate = now() + interval '2 minutes'
   where x.id in (
     select e.id from public.mkt_fluxo_execucoes e
      where e.estado in ('aguardando_tempo', 'aguardando_resposta')
        and e.acordar_em is not null and e.acordar_em <= now()
        and (e.travada_ate is null or e.travada_ate < now())
      order by e.acordar_em
      limit greatest(1, least(p_limite, 200))
      for update skip locked)
  returning x.*;
$$;

create or replace function public.mkt_auto_contar_disparo(p_gatilho uuid, p_fluxo uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_fluxo_gatilhos set disparos = disparos + 1 where id = p_gatilho;
  update public.mkt_fluxos set execucoes_total = execucoes_total + 1 where id = p_fluxo;
$$;

create or replace function public.mkt_auto_contar_conclusao(p_fluxo uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_fluxos set concluidas_total = concluidas_total + 1 where id = p_fluxo;
$$;

-- Os números em cima de cada bloco no editor, sem trazer as linhas pro navegador.
-- Pode ser chamada pela tela (quem não tem acesso recebe vazio).
create or replace function public.mkt_auto_estatisticas(p_fluxo uuid)
returns table (no_id text, tipo text, saida text, total bigint)
language sql
security definer
stable
set search_path = public
as $$
  select e.no_id, e.tipo, coalesce(e.saida, ''), count(*)
    from public.mkt_fluxo_eventos e
   where e.fluxo_id = p_fluxo and public.mkt_auto_acesso()
   group by 1, 2, 3;
$$;

-- ── 7. Instagram (desligado até o Bruno configurar) ─────────────────────────
create table if not exists public.mkt_ig_contas (
  id                  uuid primary key default gen_random_uuid(),
  ig_user_id          text not null unique,
  username            text,
  nome                text,
  segredo_id          uuid,          -- token no Vault; nunca volta pra tela
  token_expira_em     timestamptz,
  status              text not null default 'conectada' check (status in ('conectada', 'desconectada', 'erro')),
  ultima_entrada_em   timestamptz,
  ultimo_erro         text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
drop trigger if exists trg_mkt_ig_contas_touch on public.mkt_ig_contas;
create trigger trg_mkt_ig_contas_touch before update on public.mkt_ig_contas
  for each row execute function public.mkt_auto_touch();

create table if not exists public.mkt_ig_conversas (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references public.mkt_ig_contas(id) on delete cascade,
  igsid                 text not null,   -- o id da pessoa DENTRO desta conta
  username              text,
  nome                  text,
  tags                  text[] not null default '{}',
  ultima_entrada_em     timestamptz,
  ultima_mensagem_em    timestamptz,
  ultima_previa         text,
  nao_lidas             integer not null default 0,
  automacao_pausada_ate timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (conta_id, igsid)
);
create index if not exists mkt_ig_conversas_recentes_idx on public.mkt_ig_conversas (conta_id, ultima_mensagem_em desc);
drop trigger if exists trg_mkt_ig_conversas_touch on public.mkt_ig_conversas;
create trigger trg_mkt_ig_conversas_touch before update on public.mkt_ig_conversas
  for each row execute function public.mkt_auto_touch();

create table if not exists public.mkt_ig_automacoes (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  ativo            boolean not null default true,
  gatilho          text not null check (gatilho in ('comentario', 'dm_palavra', 'story_resposta', 'story_mencao', 'boas_vindas')),
  -- {"palavras":[],"qualquer_palavra":false,"posts":[],"respostas_publicas":[],"dm_texto":"","dm_botoes":[{"titulo","url"}],"tags":[]}
  config           jsonb not null default '{}'::jsonb,
  disparos         integer not null default 0,
  ultimo_disparo_em timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
drop trigger if exists trg_mkt_ig_automacoes_touch on public.mkt_ig_automacoes;
create trigger trg_mkt_ig_automacoes_touch before update on public.mkt_ig_automacoes
  for each row execute function public.mkt_auto_touch();

create table if not exists public.mkt_ig_mensagens (
  id           uuid primary key default gen_random_uuid(),
  conversa_id  uuid not null references public.mkt_ig_conversas(id) on delete cascade,
  direcao      text not null check (direcao in ('entrada', 'saida')),
  tipo         text not null default 'texto',
  texto        text,
  payload      jsonb not null default '{}'::jsonb,
  mid          text unique,        -- idempotência: a Meta reentrega
  status       text not null default 'ok' check (status in ('ok', 'falha')),
  erro         text,
  origem       text not null default 'cliente' check (origem in ('cliente', 'manual', 'automacao', 'eco')),
  automacao_id uuid references public.mkt_ig_automacoes(id) on delete set null,
  criado_em    timestamptz not null default now()
);
create index if not exists mkt_ig_mensagens_conversa_idx on public.mkt_ig_mensagens (conversa_id, criado_em);

create table if not exists public.mkt_ig_comentarios (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references public.mkt_ig_contas(id) on delete cascade,
  comment_id            text not null unique,   -- idempotência
  media_id              text,
  from_id               text,
  from_username         text,
  texto                 text,
  automacao_id          uuid references public.mkt_ig_automacoes(id) on delete set null,
  respondido_dm_em      timestamptz,
  respondido_publico_em timestamptz,
  erro                  text,
  criado_em             timestamptz not null default now()
);
create index if not exists mkt_ig_comentarios_conta_idx on public.mkt_ig_comentarios (conta_id, criado_em desc);

create or replace function public.mkt_ig_guardar_token(p_conta uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_seg uuid;
  v_nome text := 'qs_mkt_ig_' || p_conta::text;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'token inválido'; end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    v_seg := vault.create_secret(p_token, v_nome, 'Token do Instagram (Marketing/QS) da conta ' || p_conta::text);
  else
    perform vault.update_secret(v_seg, p_token, v_nome);
  end if;
  update public.mkt_ig_contas set segredo_id = v_seg where id = p_conta;
  return v_seg;
end;
$$;

create or replace function public.mkt_ig_token(p_ig_user_id text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $$
  select d.decrypted_secret
    from public.mkt_ig_contas c
    join vault.decrypted_secrets d on d.id = c.segredo_id
   where c.ig_user_id = p_ig_user_id
   limit 1;
$$;

create or replace function public.mkt_ig_contar_disparo(p_automacao uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_ig_automacoes set disparos = disparos + 1, ultimo_disparo_em = now() where id = p_automacao;
$$;

-- Só o servidor chama (tirar de public NÃO basta no Supabase: anon/authenticated também).
do $$
declare f text;
begin
  foreach f in array array[
    'public.mkt_wa_registrar_entrada(uuid, timestamptz, text)',
    'public.mkt_auto_tomar_conversa(uuid, int)',
    'public.mkt_auto_soltar_conversa(uuid)',
    'public.mkt_auto_reivindicar(int)',
    'public.mkt_auto_contar_disparo(uuid, uuid)',
    'public.mkt_auto_contar_conclusao(uuid)',
    'public.mkt_ig_guardar_token(uuid, text)',
    'public.mkt_ig_token(text)',
    'public.mkt_ig_contar_disparo(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.mkt_auto_estatisticas(uuid) from public, anon;
grant execute on function public.mkt_auto_estatisticas(uuid) to authenticated, service_role;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
-- (a) a tela EDITA: config, campos, fluxos, gatilhos, automações do Instagram.
do $$
declare t text;
begin
  foreach t in array array['mkt_auto_config', 'mkt_campos', 'mkt_fluxos', 'mkt_fluxo_gatilhos', 'mkt_ig_automacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_mkt_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.mkt_auto_acesso())', t || '_mkt_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_mkt_criar', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.mkt_auto_acesso())', t || '_mkt_criar', t);
    execute format('drop policy if exists %I on public.%I', t || '_mkt_mudar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.mkt_auto_acesso()) with check (public.mkt_auto_acesso())', t || '_mkt_mudar', t);
    execute format('drop policy if exists %I on public.%I', t || '_mkt_apagar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.mkt_auto_acesso())', t || '_mkt_apagar', t);
  end loop;
end $$;

-- (b) a tela só LÊ: conversas, mensagens, execuções, eventos e o Instagram.
-- Quem escreve é o servidor (service_role ignora RLS).
do $$
declare t text;
begin
  foreach t in array array['mkt_wa_conversas', 'mkt_wa_mensagens', 'mkt_fluxo_execucoes', 'mkt_fluxo_eventos',
                           'mkt_ig_contas', 'mkt_ig_conversas', 'mkt_ig_mensagens', 'mkt_ig_comentarios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_mkt_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.mkt_auto_acesso())', t || '_mkt_ler', t);
  end loop;
end $$;
-- segredo_id do Instagram não é o token (é o id no Vault), mas não precisa ir pra tela.
revoke select on public.mkt_ig_contas from authenticated;
grant select (id, ig_user_id, username, nome, token_expira_em, status, ultima_entrada_em, ultimo_erro, criado_em, atualizado_em)
  on public.mkt_ig_contas to authenticated;

-- ── CONFERÊNCIA (depois de aplicar) ─────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'qs_wa_numeros_meta_setor_check';
--     → deve listar comercial, relacionamento, marketing
--   select setor, count(*) from qs_wa_numeros_meta group by 1;   -- nada muda de setor
--   select * from mkt_auto_config;                                -- robo.ligado=true, instagram.ligado=false
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (rodar à mão, nesta ordem). Antes: o número do Marketing precisa
-- voltar a outro setor ou sair (select * from qs_wa_numeros_meta where
-- setor = 'marketing') — senão a trava antiga não volta.
--
--   drop table if exists public.mkt_ig_comentarios, public.mkt_ig_mensagens,
--     public.mkt_ig_automacoes, public.mkt_ig_conversas, public.mkt_ig_contas cascade;
--   delete from vault.secrets where name like 'qs_mkt_ig_%';
--   drop table if exists public.mkt_fluxo_eventos, public.mkt_fluxo_execucoes,
--     public.mkt_fluxo_gatilhos, public.mkt_fluxos, public.mkt_wa_mensagens,
--     public.mkt_wa_conversas, public.mkt_campos, public.mkt_auto_config cascade;
--   drop function if exists public.mkt_wa_registrar_entrada(uuid, timestamptz, text),
--     public.mkt_auto_tomar_conversa(uuid, int), public.mkt_auto_soltar_conversa(uuid),
--     public.mkt_auto_reivindicar(int), public.mkt_auto_contar_disparo(uuid, uuid),
--     public.mkt_auto_contar_conclusao(uuid), public.mkt_auto_estatisticas(uuid),
--     public.mkt_ig_guardar_token(uuid, text), public.mkt_ig_token(text),
--     public.mkt_ig_contar_disparo(uuid), public.mkt_auto_touch(), public.mkt_auto_acesso();
--   alter table qs_wa_numeros_meta drop constraint if exists qs_wa_numeros_meta_setor_check;
--   alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_setor_check
--     check (setor in ('comercial', 'relacionamento'));
-- ---------------------------------------------------------------------------
