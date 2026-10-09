-- =============================================================================
-- 0101 — RELACIONAMENTO, FASE 2: WhatsApp do pós-venda + prazo de resposta (SLA)
-- =============================================================================
-- O Relacionamento atende pelo PRÓPRIO número de WhatsApp (conectado por
-- Coexistência, igual aos números do Comercial). A Meta entrega tudo num
-- endereço só (/api/wa-calls); o que diz para onde vai a mensagem é o SETOR do
-- número em qs_wa_numeros_meta:
--   comercial       → o caminho de sempre (lead, qs_wa_messages)
--   relacionamento  → aqui: rel_wa_conversas / rel_wa_mensagens, ligadas à
--                     ficha do cliente (rel_clientes) pelo telefone.
-- Mensagem do pós-venda NUNCA vira lead do Comercial.
--
-- SLA = quanto tempo o cliente ficou esperando resposta, contado em MINUTOS
-- ÚTEIS (só dentro do horário de atendimento configurado). Cada vez que o time
-- responde um cliente que esperava, fica um registro em rel_wa_sla — é dele
-- que sai o relatório.
-- =============================================================================


-- ── 1. O SETOR DO NÚMERO ────────────────────────────────────────────────────
alter table qs_wa_numeros_meta add column if not exists setor text not null default 'comercial';
alter table qs_wa_numeros_meta drop constraint if exists qs_wa_numeros_meta_setor_check;
alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_setor_check
  check (setor in ('comercial', 'relacionamento'));
-- Número do Relacionamento é do TIME, não de uma pessoa.
alter table qs_wa_numeros_meta drop constraint if exists qs_wa_numeros_meta_setor_sem_dono;
alter table qs_wa_numeros_meta add constraint qs_wa_numeros_meta_setor_sem_dono
  check (setor = 'comercial' or user_id is null);


-- ── 2. CONFIGURAÇÕES DO RELACIONAMENTO ──────────────────────────────────────
create table if not exists rel_config (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

insert into rel_config (chave, valor) values
  -- dias: 1 = segunda … 7 = domingo (ISO)
  ('horario', '{"dias": [1,2,3,4,5], "inicio": "09:00", "fim": "18:00"}'),
  ('sla', '{"resposta_min": 30}'),
  ('fora_horario', '{"ativo": false, "texto": "Oi! Recebemos sua mensagem 😊 Nosso time de Relacionamento atende de segunda a sexta, das 9h às 18h, e vai te responder assim que voltar."}')
on conflict (chave) do nothing;

-- Quem MUDA a configuração: admin, ou gestor com acesso ao Relacionamento.
create or replace function rel_pode_configurar()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or (role = 'gestor' and 'relacionamento' = any(setores)))
  );
$$;
grant execute on function rel_pode_configurar() to authenticated;


-- ── 3. MINUTOS ÚTEIS ────────────────────────────────────────────────────────
-- Quantos minutos entre `de` e `ate` caem dentro do horário de atendimento
-- (fuso de São Paulo). Cliente que escreveu sexta 19h e foi respondido segunda
-- 9h10 esperou 10 minutos úteis — não 62 horas.
create or replace function rel_minutos_uteis(de timestamptz, ate timestamptz)
returns integer
language plpgsql stable
set search_path = public
as $$
declare
  cfg   jsonb;
  dias  int[];
  ini   time;
  fim   time;
  tz    constant text := 'America/Sao_Paulo';
  d     date;
  ultimo date;
  a     timestamptz;
  b     timestamptz;
  total numeric := 0;
begin
  if de is null or ate is null or ate <= de then return 0; end if;
  select valor into cfg from rel_config where chave = 'horario';
  dias := coalesce((select array_agg(x::int) from jsonb_array_elements_text(cfg -> 'dias') x), array[1,2,3,4,5]);
  ini  := coalesce((cfg ->> 'inicio')::time, '09:00');
  fim  := coalesce((cfg ->> 'fim')::time, '18:00');
  d      := (de at time zone tz)::date;
  ultimo := least((ate at time zone tz)::date, d + 62);   -- teto: 2 meses
  while d <= ultimo loop
    if extract(isodow from d)::int = any(dias) then
      -- date + time = timestamp SEM fuso; "at time zone" o lê como hora de SP.
      a := greatest(de,  (d + ini) at time zone tz);
      b := least(ate,    (d + fim) at time zone tz);
      if b > a then total := total + extract(epoch from (b - a)) / 60; end if;
    end if;
    d := d + 1;
  end loop;
  return floor(total)::int;
end;
$$;
grant execute on function rel_minutos_uteis(timestamptz, timestamptz) to authenticated;

-- Agora está dentro do horário de atendimento?
create or replace function rel_dentro_do_horario(em timestamptz default now())
returns boolean
language sql stable
set search_path = public
as $$
  select rel_minutos_uteis(em, em + interval '1 minute') > 0;
$$;


-- ── 4. CONVERSAS E MENSAGENS ────────────────────────────────────────────────
-- Uma conversa = um telefone num número nosso (igual ao WhatsApp: um fio só).
-- O "estado" diz em que pé está:
--   aberta              o cliente escreveu e ninguém respondeu ainda
--   aguardando_cliente  o time respondeu; a bola está com o cliente
--   resolvida           o atendente encerrou (reabre sozinha se ele escrever)
create table if not exists rel_wa_conversas (
  id               uuid primary key default gen_random_uuid(),
  phone_number_id  text not null,                 -- o NOSSO número
  telefone         text not null check (telefone ~ '^\d{8,15}$'),  -- o do cliente
  nome_contato     text,                          -- o nome do perfil no WhatsApp
  cliente_id       uuid references rel_clientes(id) on delete set null,
  atendente_id     uuid references qs_users(id) on delete set null,
  estado           text not null default 'aberta' check (estado in ('aberta', 'aguardando_cliente', 'resolvida')),
  -- Desde quando o cliente espera resposta (null = ninguém esperando).
  aguardando_desde timestamptz,
  ultima_entrada_em timestamptz,                   -- última msg do cliente (janela de 24h)
  ultima_saida_em  timestamptz,
  ultima_mensagem  text,
  nao_lidas        integer not null default 0,
  auto_resposta_em timestamptz,                    -- última "fora do horário" enviada
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (phone_number_id, telefone)
);
create index if not exists rel_wa_conversas_estado_idx on rel_wa_conversas (estado, aguardando_desde);
create index if not exists rel_wa_conversas_cliente_idx on rel_wa_conversas (cliente_id);
create index if not exists rel_wa_conversas_recente_idx on rel_wa_conversas (atualizado_em desc);

create table if not exists rel_wa_mensagens (
  id            uuid primary key default gen_random_uuid(),
  conversa_id   uuid not null references rel_wa_conversas(id) on delete cascade,
  wamid         text not null unique,             -- id da Meta (recibos acham a bolha por ele)
  direcao       text not null check (direcao in ('in', 'out')),
  -- cliente | qs (enviada pela tela) | celular (pelo app do aparelho) | automatica | historico
  origem        text not null default 'cliente' check (origem in ('cliente', 'qs', 'celular', 'automatica', 'historico')),
  texto         text not null default '',
  anexos        jsonb not null default '[]',
  autor_id      uuid references qs_users(id) on delete set null,
  autor_nome    text,
  status        text check (status in ('sent', 'delivered', 'read', 'failed')),
  respondendo_a text,
  enviada_em    timestamptz not null default now()
);
create index if not exists rel_wa_mensagens_conversa_idx on rel_wa_mensagens (conversa_id, enviada_em);

-- Cada resposta a um cliente que ESPERAVA vira uma linha aqui: é o relatório de SLA.
create table if not exists rel_wa_sla (
  id             bigserial primary key,
  conversa_id    uuid not null references rel_wa_conversas(id) on delete cascade,
  atendente_id   uuid references qs_users(id) on delete set null,
  esperou_desde  timestamptz not null,
  respondido_em  timestamptz not null,
  minutos_uteis  integer not null,
  meta_min       integer not null,
  dentro_do_prazo boolean generated always as (minutos_uteis <= meta_min) stored
);
create index if not exists rel_wa_sla_em_idx on rel_wa_sla (respondido_em desc);

-- Respostas prontas do Relacionamento (separadas das do Comercial).
create table if not exists rel_wa_respostas (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null check (length(trim(titulo)) between 1 and 60),
  texto      text not null check (length(trim(texto)) between 1 and 4000),
  criado_por uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em  timestamptz not null default now()
);


-- ── 5. GRAVAÇÃO (só o servidor chama) ───────────────────────────────────────
-- A ficha de um telefone: só liga quando não há dúvida. Telefone de família
-- (mãe e filho no mesmo celular) liga no TITULAR; mais de um titular = não liga
-- (o atendente escolhe na tela).
create or replace function rel_cliente_do_telefone(p_telefone text)
returns uuid language sql stable set search_path = public as $$
  with c as (
    select id, titular_id from rel_clientes
     where telefone = p_telefone and mesclado_em_id is null
  )
  select case
    when (select count(*) from c) = 1 then (select id from c)
    when (select count(*) from c where titular_id is null) = 1 then (select id from c where titular_id is null)
    else null
  end;
$$;

create or replace function rel_wa_ingest(
  p_phone_id   text,
  p_telefone   text,
  p_nome       text,
  p_wamid      text,
  p_direcao    text,
  p_origem     text,
  p_texto      text,
  p_anexos     jsonb default '[]',
  p_enviada_em timestamptz default now(),
  p_autor      uuid default null,
  p_autor_nome text default null,
  p_status     text default null,
  p_resp       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fone  text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  conv  rel_wa_conversas;
  nova  boolean;
  meta  int;
begin
  if fone = '' or coalesce(p_wamid, '') = '' then return jsonb_build_object('ok', false); end if;

  insert into rel_wa_conversas (phone_number_id, telefone, nome_contato, cliente_id, estado)
  values (p_phone_id, fone, nullif(p_nome, ''), rel_cliente_do_telefone(fone),
          case when p_direcao = 'in' then 'aberta' else 'aguardando_cliente' end)
  on conflict (phone_number_id, telefone) do update
     set nome_contato = coalesce(nullif(excluded.nome_contato, ''), rel_wa_conversas.nome_contato),
         cliente_id   = coalesce(rel_wa_conversas.cliente_id, excluded.cliente_id)
  returning * into conv;

  insert into rel_wa_mensagens (conversa_id, wamid, direcao, origem, texto, anexos, autor_id, autor_nome, status, respondendo_a, enviada_em)
  values (conv.id, p_wamid, p_direcao, p_origem, coalesce(p_texto, ''), coalesce(p_anexos, '[]'),
          p_autor, p_autor_nome, p_status, p_resp, coalesce(p_enviada_em, now()))
  on conflict (wamid) do nothing;
  nova := found;
  if not nova then return jsonb_build_object('ok', true, 'nova', false, 'conversa', conv.id); end if;

  -- Histórico do celular: só guarda. Não mexe em fila, prazo nem não lidas.
  if p_origem = 'historico' then
    update rel_wa_conversas set
      ultima_entrada_em = case when p_direcao = 'in' then greatest(ultima_entrada_em, p_enviada_em) else ultima_entrada_em end,
      ultima_saida_em   = case when p_direcao = 'out' then greatest(ultima_saida_em, p_enviada_em) else ultima_saida_em end,
      atualizado_em     = greatest(atualizado_em, p_enviada_em)
     where id = conv.id;
    return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
  end if;

  if p_direcao = 'in' then
    update rel_wa_conversas set
      estado            = 'aberta',
      aguardando_desde  = coalesce(aguardando_desde, p_enviada_em),
      ultima_entrada_em = p_enviada_em,
      ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      nao_lidas         = nao_lidas + 1,
      atualizado_em     = now()
     where id = conv.id;
  else
    -- Resposta (pela tela OU pelo celular). Se alguém esperava, fecha o ciclo
    -- do prazo — mensagem automática NÃO conta como resposta.
    if conv.aguardando_desde is not null and p_origem <> 'automatica' then
      select coalesce((valor ->> 'resposta_min')::int, 30) into meta from rel_config where chave = 'sla';
      insert into rel_wa_sla (conversa_id, atendente_id, esperou_desde, respondido_em, minutos_uteis, meta_min)
      values (conv.id, coalesce(p_autor, conv.atendente_id), conv.aguardando_desde, p_enviada_em,
              rel_minutos_uteis(conv.aguardando_desde, p_enviada_em), coalesce(meta, 30));
    end if;
    update rel_wa_conversas set
      -- Quem escreve numa conversa resolvida está puxando assunto: ela volta.
      estado           = case when p_origem = 'automatica' then estado else 'aguardando_cliente' end,
      aguardando_desde = case when p_origem = 'automatica' then aguardando_desde else null end,
      nao_lidas        = case when p_origem = 'automatica' then nao_lidas else 0 end,
      atendente_id     = coalesce(atendente_id, p_autor),
      ultima_saida_em  = p_enviada_em,
      ultima_mensagem  = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      auto_resposta_em = case when p_origem = 'automatica' then now() else auto_resposta_em end,
      atualizado_em    = now()
     where id = conv.id;
  end if;
  return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
end;
$$;
revoke all on function rel_wa_ingest(text, text, text, text, text, text, text, jsonb, timestamptz, uuid, text, text, text) from public, anon, authenticated;

-- Recibo da Meta (✓ enviado, ✓✓ entregue, azul lido, ✗ falhou). Nunca volta atrás.
create or replace function rel_wa_status(p_wamid text, p_status text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ordem constant text[] := array['sent', 'delivered', 'read'];
begin
  update rel_wa_mensagens set status = p_status
   where wamid = p_wamid
     and (p_status = 'failed'
          or status is null
          or (status <> 'failed' and array_position(ordem, p_status) > coalesce(array_position(ordem, status), 0)));
  return found;
end;
$$;
revoke all on function rel_wa_status(text, text) from public, anon, authenticated;

-- Ficha criada ou com telefone novo: liga as conversas soltas daquele telefone.
create or replace function rel_liga_conversas_do_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.telefone is not null and new.mesclado_em_id is null then
    update rel_wa_conversas
       set cliente_id = rel_cliente_do_telefone(new.telefone)
     where telefone = new.telefone and cliente_id is null;
  end if;
  -- Ficha juntada a outra: as conversas vão junto.
  if new.mesclado_em_id is not null then
    update rel_wa_conversas set cliente_id = new.mesclado_em_id where cliente_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_rel_liga_conversas on rel_clientes;
create trigger trg_rel_liga_conversas
  after insert or update of telefone, mesclado_em_id on rel_clientes
  for each row execute function rel_liga_conversas_do_cliente();


-- ── 6. A FILA ───────────────────────────────────────────────────────────────
create or replace view rel_wa_fila
with (security_invoker = true) as
select c.*,
       cl.nome                                   as cliente_nome,
       u.name                                    as atendente_nome,
       rel_minutos_uteis(c.aguardando_desde, now()) as minutos_esperando,
       coalesce((select (valor ->> 'resposta_min')::int from rel_config where chave = 'sla'), 30) as meta_min,
       (c.ultima_entrada_em is not null and c.ultima_entrada_em > now() - interval '24 hours') as janela_aberta
  from rel_wa_conversas c
  left join rel_clientes cl on cl.id = c.cliente_id
  left join qs_users u      on u.id  = c.atendente_id;


-- ── 7. RLS ──────────────────────────────────────────────────────────────────
alter table rel_config       enable row level security;
alter table rel_wa_conversas enable row level security;
alter table rel_wa_mensagens enable row level security;
alter table rel_wa_sla       enable row level security;
alter table rel_wa_respostas enable row level security;

drop policy if exists rel_config_ler on rel_config;
drop policy if exists rel_config_mudar on rel_config;
create policy rel_config_ler   on rel_config for select to authenticated using (rel_tem_acesso());
create policy rel_config_mudar on rel_config for update to authenticated using (rel_pode_configurar()) with check (rel_pode_configurar());

-- Conversa: o time lê e mexe no estado (assumir, resolver, ligar à ficha, zerar
-- não lidas). Criar conversa e mensagem é só o servidor (webhook / envio).
drop policy if exists rel_wa_conv_ler on rel_wa_conversas;
drop policy if exists rel_wa_conv_mudar on rel_wa_conversas;
create policy rel_wa_conv_ler   on rel_wa_conversas for select to authenticated using (rel_tem_acesso());
create policy rel_wa_conv_mudar on rel_wa_conversas for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());

drop policy if exists rel_wa_msg_ler on rel_wa_mensagens;
create policy rel_wa_msg_ler on rel_wa_mensagens for select to authenticated using (rel_tem_acesso());

drop policy if exists rel_wa_sla_ler on rel_wa_sla;
create policy rel_wa_sla_ler on rel_wa_sla for select to authenticated using (rel_tem_acesso());

drop policy if exists rel_wa_resp_ler on rel_wa_respostas;
drop policy if exists rel_wa_resp_criar on rel_wa_respostas;
drop policy if exists rel_wa_resp_mudar on rel_wa_respostas;
drop policy if exists rel_wa_resp_apagar on rel_wa_respostas;
create policy rel_wa_resp_ler    on rel_wa_respostas for select to authenticated using (rel_tem_acesso());
create policy rel_wa_resp_criar  on rel_wa_respostas for insert to authenticated with check (rel_tem_acesso());
create policy rel_wa_resp_mudar  on rel_wa_respostas for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
create policy rel_wa_resp_apagar on rel_wa_respostas for delete to authenticated using (rel_tem_acesso());

grant select, update on rel_config to authenticated;
-- Só as colunas de ATENDIMENTO: telefone, número e horários são do servidor.
-- (Resolver sem responder — "obrigado!" — limpa o aguardando_desde sem gerar
-- registro de prazo.)
-- O Supabase dá ALL nas tabelas novas por padrão: sem este revoke, o grant de
-- coluna abaixo não restringiria nada.
revoke insert, update, delete on rel_wa_conversas from authenticated, anon;
grant select on rel_wa_conversas to authenticated;
grant update (cliente_id, atendente_id, estado, nao_lidas, aguardando_desde) on rel_wa_conversas to authenticated;
grant select on rel_wa_mensagens, rel_wa_sla, rel_wa_fila to authenticated;
grant select, insert, update, delete on rel_wa_respostas to authenticated;
