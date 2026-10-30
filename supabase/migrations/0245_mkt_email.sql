-- =============================================================================
-- 0245 — MARKETING · E-MAIL MARKETING (Resend, nativo, "tipo ActiveCampaign")
-- -----------------------------------------------------------------------------
-- 30/10/2026. Frente "e-mail" da Área de Marketing.
-- Idempotente (pode rodar 2x). ADITIVA: só cria tabelas/funções/gatilhos novos
-- (prefixo mkt_email_ / mkt_seg / mkt_segmentos / mkt_score) e acrescenta
-- gatilhos AFTER nas tabelas da 0242 — nenhuma coluna existente muda.
-- Rollback comentado no fim.
--
-- DEPENDE DA 0242 (frente Disparos): mkt_contatos, mkt_listas,
-- mkt_lista_contatos e mkt_contato_eventos. Usa, não recria.
--
-- O que tem aqui:
--   1) quem acessa (admin, papel marketing, gestor com setor marketing)
--   2) configuração única + segredos no Vault (chave do Resend, segredo do
--      webhook e a chave HMAC dos links — esta última gerada AQUI, sozinha)
--   3) modelos, segmentos, campanhas, fila por destinatário (envios), cliques,
--      lista de supressão (descadastro/bounce/spam)
--   4) segmentos: regras JSON (E/OU, aninhadas até 3 níveis) → SQL com
--      format(%L) e lista FECHADA de campos/operadores; o que não entende,
--      RECUSA (filtro não entendido nunca vira "todo mundo")
--   5) score: pesos editáveis, janela de 90 dias, recálculo diário (cron)
--   6) automações simples: gatilho (entrou na lista / ganhou tag / formulário)
--      → sequência de e-mails com esperas
--   7) RPCs do motor (só service_role) e métricas (quem tem acesso)
--
-- PAPEL MARKETING: o gatilho qs_bloqueia_espectador (0036/0126) só existe nas
-- tabelas qs_*. As mkt_* têm RLS PRÓPRIA: quem tem acesso escreve em modelos,
-- segmentos, automações e campanhas em RASCUNHO; status de envio, fila,
-- configuração e segredos só pelo servidor (api/mkt-email.js, service_role).
-- Nada daqui abre leitura/escrita de tabela qs_*.
-- =============================================================================

do $$ begin
  if to_regclass('public.mkt_contatos') is null
     or to_regclass('public.mkt_listas') is null
     or to_regclass('public.mkt_lista_contatos') is null
     or to_regclass('public.mkt_contato_eventos') is null then
    raise exception '0245 precisa da 0242 (mkt_contatos, mkt_listas, mkt_lista_contatos, mkt_contato_eventos) aplicada antes';
  end if;
end $$;

-- ── 1) Quem acessa ──────────────────────────────────────────────────────────
create or replace function public.mkt_email_tem_acesso()
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Integração 30/10: uma regra só pra área toda (mkt_tem_acesso, 0240 —
  -- admin, papel marketing ou quem tem o setor Marketing).
  select public.mkt_tem_acesso();
$$;
revoke all on function public.mkt_email_tem_acesso() from public, anon;
grant execute on function public.mkt_email_tem_acesso() to authenticated, service_role;

-- Servidor (service_role) OU pessoa com acesso. Usada nas RPCs que a tela chama.
create or replace function public.mkt_email_pode()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or public.mkt_email_tem_acesso();
$$;
revoke all on function public.mkt_email_pode() from public, anon;
grant execute on function public.mkt_email_pode() to authenticated, service_role;

-- Número tolerante: texto que não é número vira NULL (não derruba o segmento).
create or replace function public.mkt_num(p text)
returns numeric
language plpgsql immutable
as $$
begin
  if p is null or p !~ '^\s*-?\d+(\.\d+)?\s*$' then return null; end if;
  return p::numeric;
end;
$$;

-- ── 2) Configuração única ───────────────────────────────────────────────────
create table if not exists public.mkt_email_config (
  id                   smallint primary key default 1 check (id = 1),
  remetente_nome       text not null default 'Se Tu For, Eu Vou! Viagens',
  remetente_email      text,
  responder_para       text,
  rodape_texto         text default 'Você recebe este e-mail porque se cadastrou com a Se Tu For, Eu Vou! Viagens.',
  rodape_endereco      text default 'Se Tu For, Eu Vou! Viagens · CNPJ 53.545.815/0001-12 · Av. Dr. Chucri Zaidan, 1550 — Morumbi, São Paulo — SP, 04711-130',
  dominio              text,
  dominio_id           text,
  dominio_status       text,
  dominio_registros    jsonb,
  webhook_id           text,
  resend_conectado_em  timestamptz,
  por_segundo          int not null default 4 check (por_segundo between 1 and 50),
  score_pesos          jsonb not null default
    '{"email_abriu":1,"email_clicou":3,"formulario":5,"whatsapp_respondeu":3,"email_descadastrou":-10}'::jsonb,
  score_janela_dias    int not null default 90 check (score_janela_dias between 7 and 365),
  score_recalculado_em timestamptz,
  atualizado_em        timestamptz not null default now()
);
insert into public.mkt_email_config (id) values (1) on conflict (id) do nothing;

-- Segredos no Vault (criptografados). Nome fechado em lista.
create or replace function public.mkt_email_segredo(p_nome text)
returns text
language plpgsql stable security definer set search_path = public, vault, pg_temp
as $$
begin
  if p_nome not in ('resend_api_key', 'resend_webhook_secret', 'hmac') then
    raise exception 'segredo-desconhecido' using errcode = '22023';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'mkt_email_' || p_nome limit 1);
end;
$$;

create or replace function public.mkt_email_guardar_segredo(p_nome text, p_valor text)
returns void
language plpgsql security definer set search_path = public, vault, pg_temp
as $$
declare v_id uuid; v_nome text := 'mkt_email_' || p_nome;
begin
  if p_nome not in ('resend_api_key', 'resend_webhook_secret') then
    raise exception 'segredo-desconhecido' using errcode = '22023';
  end if;
  if coalesce(p_valor, '') = '' then raise exception 'segredo-vazio' using errcode = '22023'; end if;
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    perform vault.create_secret(p_valor, v_nome, 'E-mail marketing (0245)');
  else
    perform vault.update_secret(v_id, p_valor, v_nome);
  end if;
end;
$$;

create or replace function public.mkt_email_apagar_segredo(p_nome text)
returns void
language plpgsql security definer set search_path = public, vault, pg_temp
as $$
begin
  if p_nome not in ('resend_api_key', 'resend_webhook_secret') then
    raise exception 'segredo-desconhecido' using errcode = '22023';
  end if;
  delete from vault.secrets where name = 'mkt_email_' || p_nome;
end;
$$;

revoke all on function public.mkt_email_segredo(text) from public, anon, authenticated;
revoke all on function public.mkt_email_guardar_segredo(text, text) from public, anon, authenticated;
revoke all on function public.mkt_email_apagar_segredo(text) from public, anon, authenticated;
grant execute on function public.mkt_email_segredo(text) to service_role;
grant execute on function public.mkt_email_guardar_segredo(text, text) to service_role;
grant execute on function public.mkt_email_apagar_segredo(text) to service_role;

-- A chave HMAC dos links de clique nasce aqui, uma vez. NUNCA trocar: todo link
-- de e-mail já enviado foi assinado com ela (trocar = cliques antigos dão 400).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'mkt_email_hmac') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'mkt_email_hmac',
      'E-mail marketing: assinatura dos links de clique (NÃO trocar — quebra links já enviados)');
  end if;
end $$;

-- ── 3) Tabelas ──────────────────────────────────────────────────────────────
create table if not exists public.mkt_email_modelos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) between 1 and 120),
  assunto       text,
  preheader     text,
  blocos        jsonb not null default '[]'::jsonb check (jsonb_typeof(blocos) = 'array'),
  html          text not null default '',
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.mkt_segmentos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) between 1 and 120),
  descricao     text,
  regras        jsonb not null default '{"combinar":"todas","condicoes":[]}'::jsonb,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.mkt_email_campanhas (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (length(trim(nome)) between 1 and 160),
  status           text not null default 'rascunho'
                   check (status in ('rascunho', 'agendada', 'enviando', 'pausada', 'enviada', 'cancelada', 'erro')),
  -- {listas: uuid[], segmento_id: uuid|null, tags: text[]} — vazio = NINGUÉM (nunca "todos")
  publico          jsonb not null default '{"listas":[],"segmento_id":null,"tags":[]}'::jsonb
                   check (jsonb_typeof(publico) = 'object'),
  remetente_nome   text,
  remetente_email  text,
  responder_para   text,
  assunto          text,
  preheader        text,
  blocos           jsonb not null default '[]'::jsonb check (jsonb_typeof(blocos) = 'array'),
  html             text not null default '',
  modelo_id        uuid references public.mkt_email_modelos(id) on delete set null,
  agendada_para    timestamptz,
  iniciada_em      timestamptz,
  concluida_em     timestamptz,
  total            int not null default 0,
  erro             text,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists mkt_email_campanhas_agendadas_idx
  on public.mkt_email_campanhas (agendada_para) where status = 'agendada';

create table if not exists public.mkt_email_automacoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 1 and 120),
  ativo          boolean not null default false,
  gatilho_tipo   text not null check (gatilho_tipo in ('lista', 'tag', 'formulario')),
  -- lista: id da lista; tag: a tag; formulario: o nome do formulário (NULL = qualquer um)
  gatilho_valor  text,
  -- [{tipo:'email', modelo_id}, {tipo:'esperar', minutos}]
  passos         jsonb not null default '[]'::jsonb,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check (gatilho_tipo = 'formulario' or coalesce(gatilho_valor, '') <> '')
);

create table if not exists public.mkt_email_auto_execucoes (
  id            uuid primary key default gen_random_uuid(),
  automacao_id  uuid not null references public.mkt_email_automacoes(id) on delete cascade,
  contato_id    uuid not null references public.mkt_contatos(id) on delete cascade,
  passo         int not null default 0,
  proximo_em    timestamptz not null default now(),
  status        text not null default 'ativa' check (status in ('ativa', 'concluida', 'cancelada', 'erro')),
  erro          text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- uma pessoa passa UMA vez por automação (não recomeça se sair e voltar da lista)
  unique (automacao_id, contato_id)
);
create index if not exists mkt_email_auto_exec_fila_idx
  on public.mkt_email_auto_execucoes (proximo_em) where status = 'ativa';

-- A fila: uma linha por destinatário. É o estado — dá KPI, retomada e "quem não recebeu".
create table if not exists public.mkt_email_envios (
  id               uuid primary key default gen_random_uuid(),
  campanha_id      uuid references public.mkt_email_campanhas(id) on delete cascade,
  execucao_id      uuid references public.mkt_email_auto_execucoes(id) on delete cascade,
  automacao_id     uuid references public.mkt_email_automacoes(id) on delete set null,
  passo            int,
  modelo_id        uuid references public.mkt_email_modelos(id) on delete set null,
  contato_id       uuid references public.mkt_contatos(id) on delete set null,
  email            text not null,
  nome             text,
  token            text not null unique,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'enviando', 'enviado', 'falha', 'pulado', 'cancelado')),
  tentativas       int not null default 0,
  provider_id      text,
  erro             text,
  enviado_em       timestamptz,
  entregue_em      timestamptz,
  aberto_em        timestamptz,
  aberturas        int not null default 0,
  clicado_em       timestamptz,
  cliques          int not null default 0,
  descadastrou_em  timestamptz,
  bounce_em        timestamptz,
  spam_em          timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (campanha_id is not null or execucao_id is not null)
);
-- Sem predicado e sobre a coluna crua: o ON CONFLICT do PostgREST só resolve assim.
create unique index if not exists mkt_email_envios_campanha_email_uq on public.mkt_email_envios (campanha_id, email);
create unique index if not exists mkt_email_envios_execucao_passo_uq on public.mkt_email_envios (execucao_id, passo);
create index if not exists mkt_email_envios_pendentes_idx on public.mkt_email_envios (criado_em) where status = 'pendente';
create index if not exists mkt_email_envios_enviando_idx on public.mkt_email_envios (atualizado_em) where status = 'enviando';
create index if not exists mkt_email_envios_provider_idx on public.mkt_email_envios (provider_id) where provider_id is not null;
create index if not exists mkt_email_envios_contato_idx on public.mkt_email_envios (contato_id);

create table if not exists public.mkt_email_cliques (
  id         bigserial primary key,
  envio_id   uuid not null references public.mkt_email_envios(id) on delete cascade,
  url        text not null,
  criado_em  timestamptz not null default now()
);
create index if not exists mkt_email_cliques_envio_idx on public.mkt_email_cliques (envio_id);

-- Supressão por E-MAIL (não por contato): vale mesmo se o contato for apagado e
-- importado de novo. Quem está aqui NUNCA entra numa fila.
create table if not exists public.mkt_email_supressao (
  email      text primary key check (email = lower(trim(email))),
  motivo     text not null check (motivo in ('descadastro', 'bounce', 'spam', 'manual')),
  detalhe    text,
  criado_em  timestamptz not null default now()
);

-- atualizado_em sozinho
create or replace function public.mkt_email_tocar() returns trigger
language plpgsql as $$
begin new.atualizado_em := now(); return new; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['mkt_email_config', 'mkt_email_modelos', 'mkt_segmentos', 'mkt_email_campanhas',
                           'mkt_email_automacoes', 'mkt_email_auto_execucoes', 'mkt_email_envios'] loop
    execute format('drop trigger if exists trg_%s_tocar on public.%I', t, t);
    execute format('create trigger trg_%s_tocar before update on public.%I for each row execute function public.mkt_email_tocar()', t, t);
  end loop;
end $$;

-- ── 4) Segmentos: regras → SQL seguro ───────────────────────────────────────
-- Uma condição: {campo, op, valor?, chave?}. Tudo que vem do usuário entra por
-- format(%L) (literal citado) ou por cast estrito (::uuid, ::int). Campo e
-- operador são CASE fechado: o resto levanta exceção. Alias do contato: c.
create or replace function public.mkt_seg_condicao_sql(p jsonb)
returns text
language plpgsql immutable
as $$
declare
  campo text := p->>'campo';
  op    text := p->>'op';
  v     text := p->>'valor';
  k     text := p->>'chave';
  col   text;
  dias  text;
  janela_col text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'segmento: condição inválida' using errcode = '22023'; end if;

  -- operadores que pedem número de dias
  if op in ('ultimos_dias', 'nao_ultimos_dias', 'mais_de_dias') then
    if v is null or v !~ '^\d{1,5}$' then raise exception 'segmento: dias inválido' using errcode = '22023'; end if;
    dias := format('make_interval(days => %s)', v::int);
  end if;

  case campo
  when 'tag' then
    if coalesce(v, '') = '' or length(v) > 200 then raise exception 'segmento: tag vazia' using errcode = '22023'; end if;
    case op
      when 'tem'     then return format('%L = any(coalesce(c.tags, ''{}''))', v);
      when 'nao_tem' then return format('not (%L = any(coalesce(c.tags, ''{}'')))', v);
      else null;
    end case;

  when 'lista' then
    perform coalesce(v, 'x')::uuid;  -- cast estrito: vazio ou não-uuid → erro
    case op
      when 'esta'     then return format('exists (select 1 from public.mkt_lista_contatos lc where lc.contato_id = c.id and lc.lista_id = %L::uuid)', v);
      when 'nao_esta' then return format('not exists (select 1 from public.mkt_lista_contatos lc where lc.contato_id = c.id and lc.lista_id = %L::uuid)', v);
      else null;
    end case;

  when 'nome', 'email', 'telefone', 'origem', 'campo' then
    if campo = 'campo' then
      if k is null or k !~ '^[a-z0-9_]{1,60}$' then raise exception 'segmento: campo personalizado inválido' using errcode = '22023'; end if;
      col := format('(c.campos ->> %L)', k);
    else
      col := format('c.%I', campo);  -- campo já veio de lista fechada
    end if;
    if op in ('contem', 'nao_contem', 'igual', 'diferente', 'maior', 'menor')
       and (v is null or v = '' or length(v) > 200) then
      raise exception 'segmento: valor vazio' using errcode = '22023';
    end if;
    case op
      when 'contem'     then return format('coalesce(%s, '''') ilike %L', col, '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%');
      when 'nao_contem' then return format('coalesce(%s, '''') not ilike %L', col, '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%');
      when 'igual'      then return format('lower(coalesce(%s, '''')) = lower(%L)', col, v);
      when 'diferente'  then return format('lower(coalesce(%s, '''')) <> lower(%L)', col, v);
      when 'preenchido' then return format('coalesce(%s, '''') <> ''''', col);
      when 'vazio'      then return format('coalesce(%s, '''') = ''''', col);
      when 'maior' then
        if campo <> 'campo' or v !~ '^-?\d+(\.\d+)?$' then raise exception 'segmento: número inválido' using errcode = '22023'; end if;
        return format('public.mkt_num(%s) > %L::numeric', col, v);
      when 'menor' then
        if campo <> 'campo' or v !~ '^-?\d+(\.\d+)?$' then raise exception 'segmento: número inválido' using errcode = '22023'; end if;
        return format('public.mkt_num(%s) < %L::numeric', col, v);
      else null;
    end case;

  when 'score' then
    if v is null or v !~ '^-?\d{1,6}$' then raise exception 'segmento: pontuação inválida' using errcode = '22023'; end if;
    case op
      when 'maior_igual' then return format('coalesce(c.score, 0) >= %s', v::int);
      when 'menor'       then return format('coalesce(c.score, 0) < %s', v::int);
      else null;
    end case;

  when 'criado' then
    case op
      when 'ultimos_dias' then return format('c.criado_em >= now() - %s', dias);
      when 'mais_de_dias' then return format('c.criado_em < now() - %s', dias);
      when 'depois_de', 'antes_de' then
        -- Data do dia em São Paulo: "AAAA-MM-DD 00:00-03" (nunca date AT TIME ZONE, que erra 6h).
        if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'segmento: data inválida' using errcode = '22023'; end if;
        perform v::date;
        if op = 'depois_de' then
          return format('c.criado_em >= %L::timestamptz', v || ' 00:00:00-03');
        end if;
        return format('c.criado_em < %L::timestamptz', v || ' 00:00:00-03');
      else null;
    end case;

  when 'abriu_email', 'clicou_email' then
    janela_col := case campo when 'abriu_email' then 'aberto_em' else 'clicado_em' end;
    case op
      when 'ultimos_dias' then
        return format('exists (select 1 from public.mkt_email_envios e where e.contato_id = c.id and e.%I >= now() - %s)', janela_col, dias);
      when 'nao_ultimos_dias' then
        return format('not exists (select 1 from public.mkt_email_envios e where e.contato_id = c.id and e.%I >= now() - %s)', janela_col, dias);
      when 'nunca' then
        return format('not exists (select 1 from public.mkt_email_envios e where e.contato_id = c.id and e.%I is not null)', janela_col);
      when 'campanha' then
        perform coalesce(v, 'x')::uuid;
        return format('exists (select 1 from public.mkt_email_envios e where e.contato_id = c.id and e.campanha_id = %L::uuid and e.%I is not null)', v, janela_col);
      when 'nao_campanha' then
        perform coalesce(v, 'x')::uuid;
        return format('exists (select 1 from public.mkt_email_envios e where e.contato_id = c.id and e.campanha_id = %L::uuid and e.status = ''enviado'' and e.%I is null)', v, janela_col);
      else null;
    end case;

  else null;
  end case;

  raise exception 'segmento: regra desconhecida (%/%)', coalesce(campo, '?'), coalesce(op, '?') using errcode = '22023';
end;
$$;

-- Um grupo: {combinar: 'todas'|'qualquer', condicoes: [condição | grupo]}.
-- Raiz vazia = NINGUÉM ('false'). Grupo interno vazio = recusa.
create or replace function public.mkt_seg_sql(p jsonb, p_nivel int default 0)
returns text
language plpgsql immutable
as $$
declare
  juntar text;
  item   jsonb;
  partes text[] := '{}';
begin
  if p_nivel > 3 then raise exception 'segmento: no máximo 3 níveis de grupo' using errcode = '22023'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'condicoes') <> 'array' then
    raise exception 'segmento: regras inválidas' using errcode = '22023';
  end if;
  juntar := case p->>'combinar' when 'todas' then ' and ' when 'qualquer' then ' or ' end;
  if juntar is null then raise exception 'segmento: combinar deve ser todas ou qualquer' using errcode = '22023'; end if;
  if jsonb_array_length(p->'condicoes') > 30 then raise exception 'segmento: no máximo 30 condições por grupo' using errcode = '22023'; end if;
  if jsonb_array_length(p->'condicoes') = 0 then
    if p_nivel = 0 then return 'false'; end if;
    raise exception 'segmento: grupo vazio' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p->'condicoes') loop
    if jsonb_typeof(item) = 'object' and item ? 'condicoes' then
      partes := partes || ('(' || public.mkt_seg_sql(item, p_nivel + 1) || ')');
    else
      partes := partes || ('(' || public.mkt_seg_condicao_sql(item) || ')');
    end if;
  end loop;
  return array_to_string(partes, juntar);
end;
$$;

-- O banco recusa segmento que não entende NA HORA DE SALVAR (não só na hora de enviar).
do $$ begin
  alter table public.mkt_segmentos add constraint mkt_segmentos_regras_validas_chk
    check (public.mkt_seg_sql(regras) is not null);
exception when duplicate_object then null; end $$;

create or replace function public.mkt_segmento_ids(p_regras jsonb)
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.mkt_email_pode() then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query execute 'select c.id from public.mkt_contatos c where ' || public.mkt_seg_sql(p_regras);
end;
$$;
revoke all on function public.mkt_segmento_ids(jsonb) from public, anon, authenticated;
grant execute on function public.mkt_segmento_ids(jsonb) to service_role;

-- Prévia para a tela: quantos casam + amostra (nome/e-mail) de até 10.
create or replace function public.mkt_segmento_previa(p_regras jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare n int; amostra jsonb; sqlw text;
begin
  if not public.mkt_email_pode() then raise exception 'sem acesso' using errcode = '42501'; end if;
  sqlw := public.mkt_seg_sql(p_regras);
  execute 'select count(*) from public.mkt_contatos c where ' || sqlw into n;
  execute 'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (select c.nome, c.email, c.score from public.mkt_contatos c where '
          || sqlw || ' order by c.criado_em desc limit 10) x' into amostra;
  return jsonb_build_object('total', n, 'amostra', amostra);
end;
$$;
revoke all on function public.mkt_segmento_previa(jsonb) from public, anon;
grant execute on function public.mkt_segmento_previa(jsonb) to authenticated, service_role;

-- ── Público de uma campanha (listas ∩ tags ∩ segmento, menos supressão) ─────
-- Vazio = ninguém. Segmento apagado = ERRO (nunca cai para "todos").
create or replace function public.mkt_email_publico_sql(p_publico jsonb)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  listas uuid[];
  tags   text[];
  seg    uuid;
  regras jsonb;
  w      text[] := array[
    'c.email is not null', 'c.email <> ''''', 'c.optout_email_em is null',
    'not exists (select 1 from public.mkt_email_supressao s where s.email = lower(c.email))'];
begin
  if jsonb_typeof(p_publico) <> 'object' then raise exception 'público inválido' using errcode = '22023'; end if;
  select coalesce(array_agg(x::uuid), '{}') into listas
    from jsonb_array_elements_text(coalesce(p_publico->'listas', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into tags
    from jsonb_array_elements_text(coalesce(p_publico->'tags', '[]'::jsonb)) x where x <> '';
  seg := nullif(p_publico->>'segmento_id', '')::uuid;

  if cardinality(listas) = 0 and cardinality(tags) = 0 and seg is null then
    raise exception 'público vazio: escolha lista, tag ou segmento' using errcode = '22023';
  end if;
  if cardinality(listas) > 0 then
    w := w || format('exists (select 1 from public.mkt_lista_contatos lc where lc.contato_id = c.id and lc.lista_id = any(%L::uuid[]))', listas);
  end if;
  if cardinality(tags) > 0 then
    w := w || format('coalesce(c.tags, ''{}'') && %L::text[]', tags);
  end if;
  if seg is not null then
    select s.regras into regras from public.mkt_segmentos s where s.id = seg;
    if regras is null then raise exception 'o segmento desta campanha foi apagado' using errcode = '22023'; end if;
    w := w || ('(' || public.mkt_seg_sql(regras) || ')');
  end if;
  return array_to_string(w, ' and ');
end;
$$;
revoke all on function public.mkt_email_publico_sql(jsonb) from public, anon, authenticated;
grant execute on function public.mkt_email_publico_sql(jsonb) to service_role;

create or replace function public.mkt_email_publico_previa(p_publico jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare n int; w text;
begin
  if not public.mkt_email_pode() then raise exception 'sem acesso' using errcode = '42501'; end if;
  w := public.mkt_email_publico_sql(p_publico);
  execute 'select count(distinct lower(c.email)) from public.mkt_contatos c where ' || w into n;
  return jsonb_build_object('total', n);
end;
$$;
revoke all on function public.mkt_email_publico_previa(jsonb) from public, anon;
grant execute on function public.mkt_email_publico_previa(jsonb) to authenticated, service_role;

-- Monta a fila de UMA campanha (status 'enviando'). Mesma pessoa em 2 listas = 1 e-mail.
create or replace function public.mkt_email_montar_fila(p_campanha uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare camp public.mkt_email_campanhas; w text; n int;
begin
  select * into camp from public.mkt_email_campanhas where id = p_campanha for update;
  if camp.id is null then raise exception 'campanha não encontrada' using errcode = '22023'; end if;
  if camp.status <> 'enviando' then return 0; end if;
  w := public.mkt_email_publico_sql(camp.publico);
  execute format(
    'insert into public.mkt_email_envios (campanha_id, contato_id, email, nome, token)
     select distinct on (lower(c.email)) %L::uuid, c.id, lower(trim(c.email)), c.nome,
            replace(gen_random_uuid()::text, ''-'', '''') || replace(gen_random_uuid()::text, ''-'', '''')
       from public.mkt_contatos c where %s
      order by lower(c.email), c.criado_em
     on conflict (campanha_id, email) do nothing', camp.id, w);
  get diagnostics n = row_count;
  update public.mkt_email_campanhas
     set total = (select count(*) from public.mkt_email_envios where campanha_id = camp.id),
         iniciada_em = coalesce(iniciada_em, now())
   where id = camp.id;
  return n;
end;
$$;
revoke all on function public.mkt_email_montar_fila(uuid) from public, anon, authenticated;
grant execute on function public.mkt_email_montar_fila(uuid) to service_role;

-- Reivindica um lote da fila (for update skip locked: 2 crons simultâneos não mandam em dobro).
-- Só sai o que é de campanha 'enviando' ou de automação ativa — pausar segura a fila.
create or replace function public.mkt_email_reivindicar(p_limite int default 20)
returns setof public.mkt_email_envios
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with alvo as (
    select e.id
      from public.mkt_email_envios e
      left join public.mkt_email_campanhas c on c.id = e.campanha_id
      left join public.mkt_email_auto_execucoes x on x.id = e.execucao_id
     where e.status = 'pendente'
       and ((e.campanha_id is not null and c.status = 'enviando')
            or (e.campanha_id is null and x.status in ('ativa', 'concluida')))
     order by e.criado_em
     limit greatest(1, least(p_limite, 100))
     for update of e skip locked
  )
  update public.mkt_email_envios e
     set status = 'enviando', tentativas = e.tentativas + 1
    from alvo where e.id = alvo.id
  returning e.*;
end;
$$;
revoke all on function public.mkt_email_reivindicar(int) from public, anon, authenticated;
grant execute on function public.mkt_email_reivindicar(int) to service_role;

-- ── 5) Score ────────────────────────────────────────────────────────────────
create or replace function public.mkt_score_peso(p_tipo text)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(public.mkt_num(score_pesos ->> p_tipo), 0)::int from public.mkt_email_config where id = 1;
$$;

-- Recalcula (um contato ou a base toda): soma dos pesos dos eventos na janela.
-- Sem a passada diária a nota só subiria ("engajado" viraria "algum dia engajou").
create or replace function public.mkt_score_recalcular(p_contato uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare cfg public.mkt_email_config; n int;
begin
  if not public.mkt_email_pode() then raise exception 'sem acesso' using errcode = '42501'; end if;
  select * into cfg from public.mkt_email_config where id = 1;
  update public.mkt_contatos c
     set score = x.s
    from (
      select c2.id,
             greatest(0, least(100000, coalesce(sum(coalesce(public.mkt_num(cfg.score_pesos ->> e.tipo), 0)), 0)))::int as s
        from public.mkt_contatos c2
        left join public.mkt_contato_eventos e
          on e.contato_id = c2.id and e.criado_em >= now() - make_interval(days => cfg.score_janela_dias)
       where p_contato is null or c2.id = p_contato
       group by c2.id
    ) x
   where c.id = x.id and c.score is distinct from x.s;
  get diagnostics n = row_count;
  if p_contato is null then
    update public.mkt_email_config set score_recalculado_em = now() where id = 1;
  end if;
  return n;
end;
$$;
revoke all on function public.mkt_score_recalcular(uuid) from public, anon;
grant execute on function public.mkt_score_recalcular(uuid) to authenticated, service_role;

-- ── Registro de abertura / clique / descadastro / webhook ───────────────────
-- Chamado pelas rotas públicas (service_role). Primeira abertura/clique vira
-- evento do contato (alimenta score e segmentos) e soma o peso na hora.
create or replace function public.mkt_email_registrar(p_token text, p_tipo text, p_url text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare env public.mkt_email_envios; primeira_abertura boolean; primeiro_clique boolean;
begin
  if p_tipo not in ('abriu', 'clicou', 'descadastrou') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  select * into env from public.mkt_email_envios where token = p_token;
  if env.id is null then return false; end if;

  if p_tipo = 'abriu' then
    primeira_abertura := env.aberto_em is null;
    update public.mkt_email_envios
       set aberturas = aberturas + 1, aberto_em = coalesce(aberto_em, now())
     where id = env.id;
    if primeira_abertura and env.contato_id is not null then
      insert into public.mkt_contato_eventos (contato_id, tipo, dados)
      values (env.contato_id, 'email_abriu', jsonb_build_object('envio_id', env.id, 'campanha_id', env.campanha_id, 'automacao_id', env.automacao_id));
      update public.mkt_contatos set score = coalesce(score, 0) + public.mkt_score_peso('email_abriu') where id = env.contato_id;
    end if;

  elsif p_tipo = 'clicou' then
    primeiro_clique := env.clicado_em is null;
    primeira_abertura := env.aberto_em is null;  -- clicar prova que abriu (pixel bloqueado)
    update public.mkt_email_envios
       set cliques = cliques + 1, clicado_em = coalesce(clicado_em, now()),
           aberto_em = coalesce(aberto_em, now()), aberturas = greatest(aberturas, 1)
     where id = env.id;
    insert into public.mkt_email_cliques (envio_id, url) values (env.id, left(coalesce(p_url, ''), 2000));
    if env.contato_id is not null then
      if primeira_abertura then
        insert into public.mkt_contato_eventos (contato_id, tipo, dados)
        values (env.contato_id, 'email_abriu', jsonb_build_object('envio_id', env.id, 'campanha_id', env.campanha_id));
        update public.mkt_contatos set score = coalesce(score, 0) + public.mkt_score_peso('email_abriu') where id = env.contato_id;
      end if;
      if primeiro_clique then
        insert into public.mkt_contato_eventos (contato_id, tipo, dados)
        values (env.contato_id, 'email_clicou', jsonb_build_object('envio_id', env.id, 'campanha_id', env.campanha_id, 'url', left(coalesce(p_url, ''), 500)));
        update public.mkt_contatos set score = coalesce(score, 0) + public.mkt_score_peso('email_clicou') where id = env.contato_id;
      end if;
    end if;

  else -- descadastrou
    update public.mkt_email_envios set descadastrou_em = coalesce(descadastrou_em, now()) where id = env.id;
    insert into public.mkt_email_supressao (email, motivo) values (lower(trim(env.email)), 'descadastro')
      on conflict (email) do nothing;
    if env.contato_id is not null then
      update public.mkt_contatos set optout_email_em = coalesce(optout_email_em, now()) where id = env.contato_id;
      if env.descadastrou_em is null then
        insert into public.mkt_contato_eventos (contato_id, tipo, dados)
        values (env.contato_id, 'email_descadastrou', jsonb_build_object('envio_id', env.id, 'campanha_id', env.campanha_id));
      end if;
      update public.mkt_email_auto_execucoes set status = 'cancelada', erro = 'descadastrou'
       where contato_id = env.contato_id and status = 'ativa';
      -- o que ainda estava na fila para essa pessoa (campanha ou automação) não sai mais
      update public.mkt_email_envios set status = 'cancelado', erro = 'descadastrou'
       where contato_id = env.contato_id and status = 'pendente';
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.mkt_email_registrar(text, text, text) from public, anon, authenticated;
grant execute on function public.mkt_email_registrar(text, text, text) to service_role;

-- Webhook do Resend: entregue / bounce / spam. Bounce e spam entram na supressão.
create or replace function public.mkt_email_webhook(p_provider_id text, p_tipo text, p_detalhe text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare env public.mkt_email_envios;
begin
  if p_tipo not in ('entregue', 'bounce', 'spam') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  select * into env from public.mkt_email_envios where provider_id = p_provider_id limit 1;
  if env.id is null then return false; end if;
  if p_tipo = 'entregue' then
    update public.mkt_email_envios set entregue_em = coalesce(entregue_em, now()) where id = env.id;
    return true;
  end if;
  if p_tipo = 'bounce' then
    update public.mkt_email_envios set bounce_em = coalesce(bounce_em, now()), erro = left(p_detalhe, 500) where id = env.id;
  else
    update public.mkt_email_envios set spam_em = coalesce(spam_em, now()) where id = env.id;
    if env.contato_id is not null then
      update public.mkt_contatos set optout_email_em = coalesce(optout_email_em, now()) where id = env.contato_id;
    end if;
  end if;
  insert into public.mkt_email_supressao (email, motivo, detalhe)
  values (lower(trim(env.email)), p_tipo, left(p_detalhe, 500))
  on conflict (email) do nothing;
  if env.contato_id is not null then
    insert into public.mkt_contato_eventos (contato_id, tipo, dados)
    values (env.contato_id, 'email_' || p_tipo, jsonb_build_object('envio_id', env.id, 'campanha_id', env.campanha_id));
    update public.mkt_email_auto_execucoes set status = 'cancelada', erro = p_tipo
     where contato_id = env.contato_id and status = 'ativa';
    update public.mkt_email_envios set status = 'cancelado', erro = p_tipo
     where contato_id = env.contato_id and status = 'pendente';
  end if;
  return true;
end;
$$;
revoke all on function public.mkt_email_webhook(text, text, text) from public, anon, authenticated;
grant execute on function public.mkt_email_webhook(text, text, text) to service_role;

-- ── 6) Automações: gatilhos nas tabelas da 0242 ─────────────────────────────
-- Valida a sequência na hora de salvar: 1–20 passos; email com modelo_id uuid;
-- esperar entre 1 minuto e 90 dias.
create or replace function public.mkt_email_passos_ok(p jsonb)
returns boolean
language plpgsql immutable
as $$
declare item jsonb;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 20 then return false; end if;
  for item in select value from jsonb_array_elements(p) loop
    if item->>'tipo' = 'email' then
      if coalesce(item->>'modelo_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    elsif item->>'tipo' = 'esperar' then
      if coalesce(item->>'minutos', '') !~ '^\d{1,6}$' or (item->>'minutos')::int not between 1 and 129600 then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;
do $$ begin
  alter table public.mkt_email_automacoes add constraint mkt_email_automacoes_passos_chk
    check (public.mkt_email_passos_ok(passos));
exception when duplicate_object then null; end $$;

create or replace function public.mkt_email_auto_entrar(p_contato uuid, p_tipo text, p_valor text)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  insert into public.mkt_email_auto_execucoes (automacao_id, contato_id, passo, proximo_em)
  select a.id, p_contato, 0, now()
    from public.mkt_email_automacoes a
    join public.mkt_contatos c on c.id = p_contato
   where a.ativo
     and a.gatilho_tipo = p_tipo
     and (a.gatilho_valor is null or a.gatilho_valor = p_valor)
     and coalesce(c.email, '') <> ''
     and c.optout_email_em is null
     and jsonb_array_length(a.passos) > 0
  on conflict (automacao_id, contato_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mkt_email_auto_entrar(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mkt_email_auto_entrar(uuid, text, text) to service_role;

-- Os gatilhos NUNCA derrubam a escrita das outras frentes: erro vira aviso.
create or replace function public.mkt_email_trg_lista() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.mkt_email_auto_entrar(new.contato_id, 'lista', new.lista_id::text);
  exception when others then raise warning '[mkt_email] gatilho lista: %', sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.mkt_email_trg_tags() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; antigas text[] := '{}';
begin
  begin
    if tg_op = 'UPDATE' then antigas := coalesce(old.tags, '{}'); end if;
    for t in select unnest(coalesce(new.tags, '{}')) except select unnest(antigas) loop
      perform public.mkt_email_auto_entrar(new.id, 'tag', t);
    end loop;
  exception when others then raise warning '[mkt_email] gatilho tag: %', sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.mkt_email_trg_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'formulario' then
    begin
      perform public.mkt_email_auto_entrar(new.contato_id, 'formulario', coalesce(new.dados ->> 'formulario', ''));
    exception when others then raise warning '[mkt_email] gatilho formulário: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_mkt_email_auto_lista on public.mkt_lista_contatos;
create trigger trg_mkt_email_auto_lista after insert on public.mkt_lista_contatos
  for each row execute function public.mkt_email_trg_lista();

drop trigger if exists trg_mkt_email_auto_tags_ins on public.mkt_contatos;
create trigger trg_mkt_email_auto_tags_ins after insert on public.mkt_contatos
  for each row when (coalesce(cardinality(new.tags), 0) > 0) execute function public.mkt_email_trg_tags();
drop trigger if exists trg_mkt_email_auto_tags_upd on public.mkt_contatos;
create trigger trg_mkt_email_auto_tags_upd after update of tags on public.mkt_contatos
  for each row when (new.tags is distinct from old.tags) execute function public.mkt_email_trg_tags();

drop trigger if exists trg_mkt_email_auto_evento on public.mkt_contato_eventos;
create trigger trg_mkt_email_auto_evento after insert on public.mkt_contato_eventos
  for each row when (new.tipo = 'formulario') execute function public.mkt_email_trg_evento();

-- ── 7) Métricas por campanha (tela de relatórios) ───────────────────────────
create or replace function public.mkt_email_metricas(p_campanha uuid default null)
returns table (
  campanha_id uuid, total int, enviados int, falhas int, pendentes int, entregues int,
  abriram int, clicaram int, descadastros int, bounces int, spam int
)
language sql stable security definer set search_path = public
as $$
  select e.campanha_id,
         count(*)::int,
         count(*) filter (where e.status = 'enviado')::int,
         count(*) filter (where e.status = 'falha')::int,
         count(*) filter (where e.status in ('pendente', 'enviando'))::int,
         count(e.entregue_em)::int,
         count(e.aberto_em)::int,
         count(e.clicado_em)::int,
         count(e.descadastrou_em)::int,
         count(e.bounce_em)::int,
         count(e.spam_em)::int
    from public.mkt_email_envios e
   where public.mkt_email_pode()
     and e.campanha_id is not null
     and (p_campanha is null or e.campanha_id = p_campanha)
   group by e.campanha_id;
$$;
revoke all on function public.mkt_email_metricas(uuid) from public, anon;
grant execute on function public.mkt_email_metricas(uuid) to authenticated, service_role;

create or replace function public.mkt_email_links(p_campanha uuid)
returns table (url text, cliques int, pessoas int)
language sql stable security definer set search_path = public
as $$
  select k.url, count(*)::int, count(distinct k.envio_id)::int
    from public.mkt_email_cliques k
    join public.mkt_email_envios e on e.id = k.envio_id
   where public.mkt_email_pode() and e.campanha_id = p_campanha
   group by k.url
   order by 2 desc
   limit 50;
$$;
revoke all on function public.mkt_email_links(uuid) from public, anon;
grant execute on function public.mkt_email_links(uuid) to authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.mkt_email_config          enable row level security;
alter table public.mkt_email_modelos         enable row level security;
alter table public.mkt_segmentos             enable row level security;
alter table public.mkt_email_campanhas       enable row level security;
alter table public.mkt_email_automacoes      enable row level security;
alter table public.mkt_email_auto_execucoes  enable row level security;
alter table public.mkt_email_envios          enable row level security;
alter table public.mkt_email_cliques         enable row level security;
alter table public.mkt_email_supressao       enable row level security;

-- Leitura: quem tem acesso (nenhuma tabela aqui guarda segredo — eles estão no Vault).
do $$
declare t text;
begin
  foreach t in array array['mkt_email_config', 'mkt_email_modelos', 'mkt_segmentos', 'mkt_email_campanhas',
                           'mkt_email_automacoes', 'mkt_email_auto_execucoes', 'mkt_email_envios',
                           'mkt_email_cliques', 'mkt_email_supressao'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.mkt_email_tem_acesso())', t || '_ler', t);
  end loop;
end $$;

-- Escrita direta: modelos, segmentos, automações (o banco valida regras/passos por CHECK).
do $$
declare t text;
begin
  foreach t in array array['mkt_email_modelos', 'mkt_segmentos', 'mkt_email_automacoes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_escrever', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.mkt_email_tem_acesso()) with check (public.mkt_email_tem_acesso())', t || '_escrever', t);
  end loop;
end $$;

-- Campanhas: a tela cria/edita/apaga só RASCUNHO. Agendar, pausar, cancelar = servidor.
drop policy if exists mkt_email_campanhas_inserir on public.mkt_email_campanhas;
create policy mkt_email_campanhas_inserir on public.mkt_email_campanhas for insert to authenticated
  with check (public.mkt_email_tem_acesso() and status = 'rascunho');
drop policy if exists mkt_email_campanhas_editar on public.mkt_email_campanhas;
create policy mkt_email_campanhas_editar on public.mkt_email_campanhas for update to authenticated
  using (public.mkt_email_tem_acesso() and status = 'rascunho')
  with check (public.mkt_email_tem_acesso() and status = 'rascunho');
drop policy if exists mkt_email_campanhas_apagar on public.mkt_email_campanhas;
create policy mkt_email_campanhas_apagar on public.mkt_email_campanhas for delete to authenticated
  using (public.mkt_email_tem_acesso() and status in ('rascunho', 'cancelada', 'erro'));

-- config, envios, cliques, supressão, execuções: sem policy de escrita → só service_role.
revoke all on public.mkt_email_config, public.mkt_email_envios, public.mkt_email_cliques,
              public.mkt_email_supressao, public.mkt_email_auto_execucoes from anon;
revoke all on public.mkt_email_modelos, public.mkt_segmentos, public.mkt_email_campanhas,
              public.mkt_email_automacoes from anon;

-- =============================================================================
-- CONFERÊNCIA (depois de aplicar):
--   select public.mkt_seg_sql('{"combinar":"todas","condicoes":[{"campo":"tag","op":"tem","valor":"x''; drop table y; --"}]}');
--     → '''x''''; drop table y; --'' = any(...)' (literal citado, inofensivo)
--   select public.mkt_seg_sql('{"combinar":"todas","condicoes":[{"campo":"senha","op":"igual","valor":"1"}]}');
--     → ERRO "segmento: regra desconhecida"
--   select count(*) from vault.secrets where name = 'mkt_email_hmac';   -- 1
--   -- logado como anon: select * from mkt_email_envios → 0 linhas / sem permissão
-- =============================================================================

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────────
-- drop trigger if exists trg_mkt_email_auto_lista on public.mkt_lista_contatos;
-- drop trigger if exists trg_mkt_email_auto_tags_ins on public.mkt_contatos;
-- drop trigger if exists trg_mkt_email_auto_tags_upd on public.mkt_contatos;
-- drop trigger if exists trg_mkt_email_auto_evento on public.mkt_contato_eventos;
-- drop function if exists public.mkt_email_trg_lista(), public.mkt_email_trg_tags(), public.mkt_email_trg_evento();
-- drop function if exists public.mkt_email_auto_entrar(uuid, text, text);
-- drop function if exists public.mkt_email_links(uuid), public.mkt_email_metricas(uuid);
-- drop function if exists public.mkt_email_webhook(text, text, text), public.mkt_email_registrar(text, text, text);
-- drop function if exists public.mkt_score_recalcular(uuid), public.mkt_score_peso(text);
-- drop function if exists public.mkt_email_reivindicar(int), public.mkt_email_montar_fila(uuid);
-- drop function if exists public.mkt_email_publico_previa(jsonb), public.mkt_email_publico_sql(jsonb);
-- drop function if exists public.mkt_segmento_previa(jsonb), public.mkt_segmento_ids(jsonb);
-- drop table if exists public.mkt_email_cliques, public.mkt_email_envios, public.mkt_email_auto_execucoes,
--   public.mkt_email_automacoes, public.mkt_email_campanhas, public.mkt_segmentos, public.mkt_email_modelos,
--   public.mkt_email_supressao, public.mkt_email_config;      -- APAGA histórico de envios e a supressão
-- drop function if exists public.mkt_email_passos_ok(jsonb), public.mkt_seg_sql(jsonb, int),
--   public.mkt_seg_condicao_sql(jsonb), public.mkt_email_tocar(), public.mkt_num(text);
-- drop function if exists public.mkt_email_segredo(text), public.mkt_email_guardar_segredo(text, text),
--   public.mkt_email_apagar_segredo(text), public.mkt_email_pode(), public.mkt_email_tem_acesso();
-- delete from vault.secrets where name like 'mkt_email\_%';  -- ⚠️ links de clique já enviados param de funcionar
-- (mkt_contatos.score e optout_email_em ficam como estão; os eventos email_* em mkt_contato_eventos também)
