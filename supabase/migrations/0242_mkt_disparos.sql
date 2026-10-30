-- =============================================================================
-- 0242 — MARKETING: BASE DE CONTATOS + DISPAROS EM MASSA (30/10/2026)
-- =============================================================================
-- Pedido do Bruno: trazer o SendFlow pra dentro do QS, pra não precisar aprovar
-- OUTRA API. O Marketing dispara pelo app/WABA da Meta que o QS já tem, por um
-- número NOVO só dele dentro da WABA do QS (qs_settings.mkt_disparo_numero —
-- vazio = não envia).
--
-- UM MOTOR SÓ: o mesmo da 0217 (api/disparos.js + api/_disparo.js). Esta
-- migration só ACRESCENTA:
--   1. mkt_disparos_pode()          — quem é do Marketing (admin, papel marketing,
--                                     gestor com setor marketing)
--   2. mkt_contatos / mkt_listas / mkt_lista_contatos / mkt_contato_eventos
--                                   — a base (CONTRATO usado pelas frentes de
--                                     e-mail 0245 e automações 0244: não renomear)
--   3. o setor 'marketing' e o estado 'agendada' nas campanhas da 0217, mais
--      agendada_para / recorrencia_id / sequencia_id / sequencia_passo, e
--      contato_id / inscricao_id nos envios
--   4. mkt_disparo_publico(jsonb)   — público da base de contatos (só servidor)
--      mkt_disparo_bloqueios(int)   — quem disse PARAR ao Marketing ou recebeu há pouco
--   5. mkt_importar_contatos(...)   — importação do CSV com dedupe (tela)
--   6. recorrências e sequências (mkt_disparo_recorrencias, mkt_disparo_sequencias,
--      _passos, _inscricoes)
--   7. RLS: o Marketing LÊ e ESCREVE as tabelas mkt_*; campanhas/fila só leitura
--      (escrever é pela rota, service_role) — igual a 0217.
--
-- O papel `marketing` continua SÓ LEITURA nas tabelas qs_* (gatilho da
-- 0036/0126): nada aqui mexe nisso. As mkt_* não começam com qs_, ficam fora
-- do gatilho, e têm RLS própria.
--
-- O que muda em função/policy EXISTENTE (aditivo):
--   • qs_disparo_campanhas: CHECK de setor e de status ganham um valor cada;
--   • policies de leitura da 0217 ganham um "OU marketing lê as do marketing".
--   Comercial e Relacionamento continuam exatamente como estavam.
--
-- Idempotente: pode rodar de novo sem estrago.
-- =============================================================================

-- ── 1. Quem é do Marketing ──────────────────────────────────────────────────
create or replace function mkt_disparos_pode()
returns boolean language sql stable security definer set search_path = public as $$
  -- Integração 30/10: uma regra só pra área toda (mkt_tem_acesso, 0240 —
  -- admin, papel marketing ou quem tem o setor Marketing).
  select public.mkt_tem_acesso();
$$;
revoke all on function mkt_disparos_pode() from public, anon;
grant execute on function mkt_disparos_pode() to authenticated;

-- ── 2. Base de contatos (CONTRATO) ──────────────────────────────────────────
-- telefone: só dígitos com DDI (55…); email: minúsculo. A NORMALIZAÇÃO mora no
-- código (src/mkt/disparos/regras.ts e api/_mktRegras.js). Os índices únicos são
-- SEM predicado e sobre a coluna CRUA (unique simples) — é o único jeito de o
-- ON CONFLICT do PostgREST funcionar (pegadinha do SendFlow). Os CHECKs só
-- garantem que ninguém grave fora do formato.
create table if not exists mkt_contatos (
  id                  uuid primary key default gen_random_uuid(),
  nome                text,
  telefone            text unique,
  email               text unique,
  origem              text,
  tags                text[] not null default '{}',
  campos              jsonb not null default '{}',
  score               int not null default 0,
  optout_whatsapp_em  timestamptz,
  optout_email_em     timestamptz,
  lead_ref            text,
  rel_cliente_id      uuid null,
  criado_em           timestamptz default now(),
  atualizado_em       timestamptz default now(),
  constraint mkt_contatos_telefone_formato check (telefone is null or telefone ~ '^[0-9]{10,15}$'),
  -- (Sem exigir telefone OU e-mail: a frente de automações pode criar contato
  -- só do Instagram, com o @ em `campos`.)
  constraint mkt_contatos_email_formato    check (email is null or email = lower(btrim(email)))
);
create index if not exists mkt_contatos_tags_idx     on mkt_contatos using gin (tags);
create index if not exists mkt_contatos_criado_idx   on mkt_contatos (criado_em desc);
create index if not exists mkt_contatos_lead_ref_idx on mkt_contatos (lead_ref) where lead_ref is not null;
create index if not exists mkt_contatos_rel_idx      on mkt_contatos (rel_cliente_id) where rel_cliente_id is not null;
-- Comparação com e sem o 9º dígito (a Meta às vezes manda o wa_id sem ele):
-- DDI+DDD (4) + 8 finais. Usado pelo webhook do número do Marketing.
create index if not exists mkt_contatos_tel_chave_idx on mkt_contatos ((left(telefone, 4) || right(telefone, 8))) where telefone is not null;

create table if not exists mkt_listas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  descricao  text,
  criado_em  timestamptz default now()
);

create table if not exists mkt_lista_contatos (
  lista_id   uuid references mkt_listas on delete cascade,
  contato_id uuid references mkt_contatos on delete cascade,
  primary key (lista_id, contato_id)
);
create index if not exists mkt_lista_contatos_contato_idx on mkt_lista_contatos (contato_id);
alter table mkt_lista_contatos add column if not exists criado_em timestamptz default now();

-- Linha do tempo do contato. Tipos usados aqui: criado, importado, optout_whatsapp,
-- optin_whatsapp, optout_email, optin_email, entrou_lista, saiu_lista,
-- disparo_enviado, disparo_entregue, disparo_lido, disparo_erro, respondeu,
-- sequencia_entrou, sequencia_saiu. Outras frentes acrescentam os delas.
create table if not exists mkt_contato_eventos (
  id         bigserial primary key,
  contato_id uuid references mkt_contatos on delete cascade,
  tipo       text not null,
  dados      jsonb default '{}',
  criado_em  timestamptz default now()
);
create index if not exists mkt_contato_eventos_contato_idx on mkt_contato_eventos (contato_id, criado_em desc);
create index if not exists mkt_contato_eventos_tipo_idx    on mkt_contato_eventos (tipo, criado_em desc);

-- atualizado_em + eventos automáticos (valem pra tela, CSV e servidor).
create or replace function mkt_contatos_gatilho()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into mkt_contato_eventos (contato_id, tipo, dados)
    values (new.id, 'criado', jsonb_build_object('origem', new.origem));
    if new.optout_whatsapp_em is not null then
      insert into mkt_contato_eventos (contato_id, tipo, dados) values (new.id, 'optout_whatsapp', '{}');
    end if;
    return new;
  end if;
  new.atualizado_em := now();
  if new.optout_whatsapp_em is distinct from old.optout_whatsapp_em then
    insert into mkt_contato_eventos (contato_id, tipo, dados)
    values (new.id, case when new.optout_whatsapp_em is null then 'optin_whatsapp' else 'optout_whatsapp' end, '{}');
  end if;
  if new.optout_email_em is distinct from old.optout_email_em then
    insert into mkt_contato_eventos (contato_id, tipo, dados)
    values (new.id, case when new.optout_email_em is null then 'optin_email' else 'optout_email' end, '{}');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mkt_contatos_ins on mkt_contatos;
create trigger trg_mkt_contatos_ins after insert on mkt_contatos for each row execute function mkt_contatos_gatilho();
drop trigger if exists trg_mkt_contatos_upd on mkt_contatos;
create trigger trg_mkt_contatos_upd before update on mkt_contatos for each row execute function mkt_contatos_gatilho();

create or replace function mkt_lista_contatos_gatilho()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into mkt_contato_eventos (contato_id, tipo, dados)
    values (new.contato_id, 'entrou_lista', jsonb_build_object('lista_id', new.lista_id,
            'lista', (select nome from mkt_listas where id = new.lista_id)));
    return new;
  end if;
  -- Lista apagada inteira (cascade) não precisa de um evento por contato.
  if exists (select 1 from mkt_listas where id = old.lista_id) then
    insert into mkt_contato_eventos (contato_id, tipo, dados)
    values (old.contato_id, 'saiu_lista', jsonb_build_object('lista_id', old.lista_id,
            'lista', (select nome from mkt_listas where id = old.lista_id)));
  end if;
  return old;
end;
$$;
drop trigger if exists trg_mkt_lista_contatos on mkt_lista_contatos;
create trigger trg_mkt_lista_contatos after insert or delete on mkt_lista_contatos
  for each row execute function mkt_lista_contatos_gatilho();

-- ── 3. O motor da 0217 ganha o Marketing ────────────────────────────────────
alter table qs_disparo_campanhas drop constraint if exists qs_disparo_campanhas_setor_check;
alter table qs_disparo_campanhas add constraint qs_disparo_campanhas_setor_check
  check (setor in ('comercial', 'relacionamento', 'marketing'));
alter table qs_disparo_campanhas drop constraint if exists qs_disparo_campanhas_status_check;
alter table qs_disparo_campanhas add constraint qs_disparo_campanhas_status_check
  check (status in ('rascunho', 'agendada', 'enviando', 'pausada', 'cancelada', 'concluida'));

-- agendada_para: o cron monta a fila sozinho nessa hora (status 'agendada').
alter table qs_disparo_campanhas add column if not exists agendada_para   timestamptz;
alter table qs_disparo_campanhas add column if not exists recorrencia_id  uuid;
alter table qs_disparo_campanhas add column if not exists sequencia_id    uuid;
alter table qs_disparo_campanhas add column if not exists sequencia_passo int;
create index if not exists qs_disparo_campanhas_agendada_idx on qs_disparo_campanhas (agendada_para) where status = 'agendada';
create index if not exists qs_disparo_campanhas_seq_idx on qs_disparo_campanhas (sequencia_id, sequencia_passo) where sequencia_id is not null;

alter table qs_disparo_envios add column if not exists contato_id   uuid references mkt_contatos(id) on delete set null;
alter table qs_disparo_envios add column if not exists inscricao_id uuid;
create index if not exists qs_disparo_envios_contato_idx on qs_disparo_envios (contato_id, enviado_em) where contato_id is not null;
-- O webhook do número do Marketing acha o envio pelo telefone (resposta).
create index if not exists qs_disparo_envios_tel_chave_idx on qs_disparo_envios ((left(telefone, 4) || right(telefone, 8)), enviado_em)
  where enviado_em is not null;

alter policy qs_disparo_campanhas_ler on qs_disparo_campanhas
  using (qs_pode(setor || '.disparos') or (setor = 'marketing' and mkt_disparos_pode()));
alter policy qs_disparo_envios_ler on qs_disparo_envios
  using (
    sdr_id = auth.uid()
    or exists (select 1 from qs_disparo_campanhas c where c.id = campanha_id
                and (qs_pode(c.setor || '.disparos') or (c.setor = 'marketing' and mkt_disparos_pode())))
  );

-- ── 4. Público da base de contatos ──────────────────────────────────────────
-- p_publico (fonte 'contatos'):
--   {"listas":[uuid], "tags":["vip"], "tags_modo":"qualquer|todas", "sem_tags":["frio"],
--    "origens":["csv"], "criado_de":"2026-01-01", "criado_ate":"...", "score_min":0,
--    "intervalo_dias":7}
create or replace function mkt_disparo_publico(p_publico jsonb)
returns table (
  contato_id uuid, nome text, telefone text, campos jsonb, tags text[],
  optout boolean, disparo_recente boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  lst   uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_publico -> 'listas', '[]')) x);
  tgs   text[] := array(select lower(x) from jsonb_array_elements_text(coalesce(p_publico -> 'tags', '[]')) x);
  semt  text[] := array(select lower(x) from jsonb_array_elements_text(coalesce(p_publico -> 'sem_tags', '[]')) x);
  ori   text[] := array(select jsonb_array_elements_text(coalesce(p_publico -> 'origens', '[]')));
  todas boolean := coalesce(p_publico ->> 'tags_modo', '') = 'todas';
  de    timestamptz := case when nullif(p_publico ->> 'criado_de', '') is null then null
                            else ((p_publico ->> 'criado_de') || ' 00:00:00-03')::timestamptz end;
  ate   timestamptz := case when nullif(p_publico ->> 'criado_ate', '') is null then null
                            else ((p_publico ->> 'criado_ate') || ' 23:59:59-03')::timestamptz end;
  smin  int := nullif(p_publico ->> 'score_min', '')::int;
  dias  int := coalesce(nullif(p_publico ->> 'intervalo_dias', '')::int, 7);
begin
  return query
    select c.id, c.nome, c.telefone, c.campos, c.tags,
           (c.optout_whatsapp_em is not null),
           exists (select 1 from qs_disparo_envios e
                    where e.contato_id = c.id and not e.simulado
                      and e.enviado_em >= now() - make_interval(days => dias))
      from mkt_contatos c
     where c.telefone is not null
       and (cardinality(lst) = 0 or exists (select 1 from mkt_lista_contatos lc where lc.contato_id = c.id and lc.lista_id = any(lst)))
       and (cardinality(tgs) = 0 or (case when todas then c.tags @> tgs else c.tags && tgs end))
       and (cardinality(semt) = 0 or not (c.tags && semt))
       and (cardinality(ori) = 0 or c.origem = any(ori))
       and (de is null or c.criado_em >= de)
       and (ate is null or c.criado_em <= ate)
       and (smin is null or c.score >= smin)
     order by c.criado_em desc;
end;
$$;
revoke all on function mkt_disparo_publico(jsonb) from public, anon, authenticated;
grant execute on function mkt_disparo_publico(jsonb) to service_role;

-- Quem NÃO pode receber do Marketing, venha de que base vier (leads/clientes
-- também): disse PARAR ao número do Marketing, ou recebeu disparo do
-- Marketing nos últimos p_dias. O servidor compara pela chave DDD+8 finais.
create or replace function mkt_disparo_bloqueios(p_dias int)
returns table (telefone text, motivo text)
language sql stable security definer set search_path = public as $$
  select c.telefone, 'mkt_optout'::text from mkt_contatos c
   where c.telefone is not null and c.optout_whatsapp_em is not null
  union all
  select distinct e.telefone, 'mkt_recente'::text
    from qs_disparo_envios e join qs_disparo_campanhas k on k.id = e.campanha_id
   where k.setor = 'marketing' and not e.simulado
     and e.enviado_em >= now() - make_interval(days => greatest(coalesce(p_dias, 7), 0));
$$;
revoke all on function mkt_disparo_bloqueios(int) from public, anon, authenticated;
grant execute on function mkt_disparo_bloqueios(int) to service_role;

-- ── 5. Importação do CSV ────────────────────────────────────────────────────
-- A tela já manda normalizado (src/mkt/disparos/regras.ts); aqui confere de
-- novo e resolve o dedupe contra o banco:
--   • casa por telefone OU e-mail; os dois casam com fichas DIFERENTES = conflito
--     (não junta sozinho, conta e devolve a linha);
--   • ficha existente: completa o que está vazio (nome, telefone, e-mail),
--     une as tags, e os campos do arquivo atualizam os da ficha. Opt-out nunca
--     é desfeito por importação.
-- p_linhas: [{"nome","telefone","email","tags":[],"campos":{}}] (até 2000 por chamada)
create or replace function mkt_importar_contatos(p_linhas jsonb, p_lista uuid default null,
                                                 p_tags text[] default '{}', p_origem text default 'csv')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; tel text; mail text; nm text; tg text[]; cp jsonb;
  id_tel uuid; id_mail uuid; alvo uuid;
  novos int := 0; atual int := 0; ignor int := 0; confl int := 0;
  conflitos jsonb := '[]';
begin
  if not mkt_disparos_pode() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só o Marketing importa contatos.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 2000 then
    raise exception 'Mande até 2000 linhas por vez.';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    tel  := nullif(regexp_replace(coalesce(r ->> 'telefone', ''), '\D', '', 'g'), '');
    if tel is not null and tel !~ '^[0-9]{10,15}$' then tel := null; end if;
    mail := nullif(lower(btrim(coalesce(r ->> 'email', ''))), '');
    if mail is not null and mail !~ '^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$' then mail := null; end if;
    if tel is null and mail is null then ignor := ignor + 1; continue; end if;
    nm := nullif(btrim(coalesce(r ->> 'nome', '')), '');
    tg := array(select distinct lower(btrim(x)) from jsonb_array_elements_text(coalesce(r -> 'tags', '[]')) x where btrim(x) <> '')
          || coalesce(p_tags, '{}');
    cp := case when jsonb_typeof(r -> 'campos') = 'object' then r -> 'campos' else '{}' end;

    id_tel  := case when tel  is null then null else (select id from mkt_contatos where telefone = tel) end;
    id_mail := case when mail is null then null else (select id from mkt_contatos where email = mail) end;
    if id_tel is not null and id_mail is not null and id_tel <> id_mail then
      confl := confl + 1;
      if jsonb_array_length(conflitos) < 50 then
        conflitos := conflitos || jsonb_build_object('telefone', tel, 'email', mail);
      end if;
      continue;
    end if;
    alvo := coalesce(id_tel, id_mail);
    if alvo is null then
      insert into mkt_contatos (nome, telefone, email, origem, tags, campos)
      values (nm, tel, mail, coalesce(nullif(p_origem, ''), 'csv'),
              array(select distinct x from unnest(tg) x), cp)
      returning id into alvo;
      novos := novos + 1;
    else
      update mkt_contatos c set
        nome     = coalesce(c.nome, nm),
        telefone = coalesce(c.telefone, tel),
        email    = coalesce(c.email, mail),
        tags     = array(select distinct x from unnest(c.tags || tg) x),
        campos   = c.campos || cp
      where c.id = alvo;
      insert into mkt_contato_eventos (contato_id, tipo, dados)
      values (alvo, 'importado', jsonb_build_object('origem', p_origem));
      atual := atual + 1;
    end if;
    if p_lista is not null then
      insert into mkt_lista_contatos (lista_id, contato_id) values (p_lista, alvo) on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('novos', novos, 'atualizados', atual, 'ignorados', ignor, 'conflitos', confl, 'exemplos_conflito', conflitos);
end;
$$;
revoke all on function mkt_importar_contatos(jsonb, uuid, text[], text) from public, anon;
grant execute on function mkt_importar_contatos(jsonb, uuid, text[], text) to authenticated, service_role;

-- Tags em uso (filtro da tela) com a contagem.
create or replace function mkt_tags_em_uso()
returns table (tag text, n bigint) language sql stable security invoker set search_path = public as $$
  select t, count(*) from mkt_contatos, unnest(tags) t group by t order by count(*) desc, t;
$$;
revoke all on function mkt_tags_em_uso() from public, anon;
grant execute on function mkt_tags_em_uso() to authenticated;

-- ── 6. Recorrências e sequências ────────────────────────────────────────────
-- Recorrência = molde de campanha que o cron copia em cada ocorrência
-- (ex.: toda segunda às 09:00). Cada cópia é uma campanha 'agendada' normal.
create table if not exists mkt_disparo_recorrencias (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null check (length(trim(nome)) >= 2),
  modelo_nome        text not null,
  modelo_idioma      text not null default 'pt_BR',
  params             jsonb not null default '{}',
  publico            jsonb not null default '{}',
  dias_semana        int[] not null check (cardinality(dias_semana) > 0 and dias_semana <@ array[0,1,2,3,4,5,6]),
  hora               text not null check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ativa              boolean not null default true,
  proxima_em         timestamptz,
  ultima_em          timestamptz,
  ultima_campanha_id uuid references qs_disparo_campanhas(id) on delete set null,
  criado_por         uuid references qs_users(id) on delete set null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index if not exists mkt_disparo_recorrencias_prox_idx on mkt_disparo_recorrencias (proxima_em) where ativa;

-- Sequência = passos com dia (0, 3, 7…) e hora contados da ENTRADA de cada
-- pessoa. Entra pelo botão "Inscrever" (público na hora) ou sozinho, ao entrar
-- na lista-gatilho. Respondeu/PARAR = sai (parar_se_responder).
create table if not exists mkt_disparo_sequencias (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null check (length(trim(nome)) >= 2),
  descricao           text,
  ativa               boolean not null default false,
  parar_se_responder  boolean not null default true,
  lista_gatilho_id    uuid references mkt_listas(id) on delete set null,
  criado_por          uuid references qs_users(id) on delete set null,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists mkt_disparo_sequencia_passos (
  id            uuid primary key default gen_random_uuid(),
  sequencia_id  uuid not null references mkt_disparo_sequencias(id) on delete cascade,
  ordem         int not null check (ordem >= 1),
  dia_offset    int not null default 0 check (dia_offset between 0 and 365),
  hora          text not null default '10:00' check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  modelo_nome   text not null,
  modelo_idioma text not null default 'pt_BR',
  params        jsonb not null default '{}',
  unique (sequencia_id, ordem)
);

create table if not exists mkt_disparo_sequencia_inscricoes (
  id             uuid primary key default gen_random_uuid(),
  sequencia_id   uuid not null references mkt_disparo_sequencias(id) on delete cascade,
  contato_id     uuid references mkt_contatos(id) on delete set null,
  lead_id        uuid,
  cliente_id     uuid,
  viagem_id      uuid,
  telefone       text not null,
  nome           text,
  inicio_em      timestamptz not null default now(),
  proximo_passo  int not null default 1,
  proximo_em     timestamptz,
  status         text not null default 'ativa' check (status in ('ativa', 'concluida', 'saiu')),
  motivo         text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (sequencia_id, telefone)
);
create index if not exists mkt_seq_insc_vez_idx on mkt_disparo_sequencia_inscricoes (proximo_em) where status = 'ativa';
create index if not exists mkt_seq_insc_tel_idx on mkt_disparo_sequencia_inscricoes ((left(telefone, 4) || right(telefone, 8))) where status = 'ativa';

-- ── 7. Configuração ─────────────────────────────────────────────────────────
-- mkt_disparo_numero: {"phone_number_id": "...", "numero": "+55…", "rotulo": "Marketing"}
-- Vazio = o Marketing NÃO envia (a tela avisa). Quem preenche é o admin, na tela.
insert into qs_settings (key, value) values ('mkt_disparo_numero', '{}'::jsonb)
on conflict (key) do nothing;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
alter table mkt_contatos                     enable row level security;
alter table mkt_listas                       enable row level security;
alter table mkt_lista_contatos               enable row level security;
alter table mkt_contato_eventos              enable row level security;
alter table mkt_disparo_recorrencias         enable row level security;
alter table mkt_disparo_sequencias           enable row level security;
alter table mkt_disparo_sequencia_passos     enable row level security;
alter table mkt_disparo_sequencia_inscricoes enable row level security;

-- Base: o Marketing lê e escreve tudo.
do $$
declare t text;
begin
  foreach t in array array['mkt_contatos', 'mkt_listas', 'mkt_lista_contatos'] loop
    execute format('drop policy if exists %I on %I', t || '_mkt', t);
    execute format('create policy %I on %I for all to authenticated using (mkt_disparos_pode()) with check (mkt_disparos_pode())', t || '_mkt', t);
  end loop;
end $$;
grant select, insert, update, delete on mkt_contatos, mkt_listas, mkt_lista_contatos to authenticated;

-- Linha do tempo: lê e acrescenta nota; não edita nem apaga história.
drop policy if exists mkt_contato_eventos_ler on mkt_contato_eventos;
create policy mkt_contato_eventos_ler on mkt_contato_eventos for select to authenticated using (mkt_disparos_pode());
drop policy if exists mkt_contato_eventos_criar on mkt_contato_eventos;
create policy mkt_contato_eventos_criar on mkt_contato_eventos for insert to authenticated with check (mkt_disparos_pode());
grant select, insert on mkt_contato_eventos to authenticated;
grant usage, select on sequence mkt_contato_eventos_id_seq to authenticated;
revoke update, delete on mkt_contato_eventos from authenticated;

-- Recorrências e sequências: só leitura na tela; escrever é pela rota
-- (confere modelo aprovado, calcula a próxima data).
do $$
declare t text;
begin
  foreach t in array array['mkt_disparo_recorrencias', 'mkt_disparo_sequencias', 'mkt_disparo_sequencia_passos', 'mkt_disparo_sequencia_inscricoes'] loop
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('create policy %I on %I for select to authenticated using (mkt_disparos_pode())', t || '_ler', t);
    execute format('grant select on %I to authenticated', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
  end loop;
end $$;

revoke all on mkt_contatos, mkt_listas, mkt_lista_contatos, mkt_contato_eventos,
  mkt_disparo_recorrencias, mkt_disparo_sequencias, mkt_disparo_sequencia_passos,
  mkt_disparo_sequencia_inscricoes from anon;

-- =============================================================================
-- CONFERÊNCIA (depois de aplicar):
--   select mkt_disparos_pode();                         -- logado como marketing = true
--   select * from mkt_disparo_publico('{}'::jsonb) limit 1;   -- como service_role
--   insert into mkt_contatos (telefone) values ('11999');     -- deve FALHAR (formato)
--   (o banco de produção é o único: conferir DENTRO de begin; … rollback;)
--
-- ROLLBACK (rodar na mão, nesta ordem):
--   delete from qs_disparo_campanhas where setor = 'marketing';
--   alter policy qs_disparo_envios_ler on qs_disparo_envios using (
--     sdr_id = auth.uid() or exists (select 1 from qs_disparo_campanhas c where c.id = campanha_id and qs_pode(c.setor || '.disparos')));
--   alter policy qs_disparo_campanhas_ler on qs_disparo_campanhas using (qs_pode(setor || '.disparos'));
--   update qs_disparo_campanhas set status = 'rascunho' where status = 'agendada';
--   alter table qs_disparo_campanhas drop constraint qs_disparo_campanhas_status_check;
--   alter table qs_disparo_campanhas add constraint qs_disparo_campanhas_status_check
--     check (status in ('rascunho', 'enviando', 'pausada', 'cancelada', 'concluida'));
--   alter table qs_disparo_campanhas drop constraint qs_disparo_campanhas_setor_check;
--   alter table qs_disparo_campanhas add constraint qs_disparo_campanhas_setor_check
--     check (setor in ('comercial', 'relacionamento'));
--   alter table qs_disparo_envios drop column if exists contato_id, drop column if exists inscricao_id;
--   drop index if exists qs_disparo_envios_tel_chave_idx;
--   alter table qs_disparo_campanhas drop column if exists agendada_para, drop column if exists recorrencia_id,
--     drop column if exists sequencia_id, drop column if exists sequencia_passo;
--   drop table if exists mkt_disparo_sequencia_inscricoes, mkt_disparo_sequencia_passos,
--     mkt_disparo_sequencias, mkt_disparo_recorrencias;
--   drop function if exists mkt_tags_em_uso();
--   drop function if exists mkt_importar_contatos(jsonb, uuid, text[], text);
--   drop function if exists mkt_disparo_bloqueios(int);
--   drop function if exists mkt_disparo_publico(jsonb);
--   drop table if exists mkt_contato_eventos, mkt_lista_contatos, mkt_listas, mkt_contatos;
--   drop function if exists mkt_lista_contatos_gatilho();
--   drop function if exists mkt_contatos_gatilho();
--   drop function if exists mkt_disparos_pode();
--   delete from qs_settings where key = 'mkt_disparo_numero';
--   ⚠ As frentes de e-mail (0245) e automações (0244) dependem de mkt_contatos:
--     desfazer as delas ANTES desta.
-- =============================================================================
