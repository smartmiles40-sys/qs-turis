-- =============================================================================
-- 0103 — RELACIONAMENTO, FASES 3, 4 e 5
-- =============================================================================
--   FASE 3 — Jornada da viagem + documentos
--     rel_viagens (nasce da venda no Bitrix), passageiros, jornada (tarefas com
--     prazo calculado pela venda/embarque/retorno), documentos (bucket privado)
--     e o LINK de documentos que o cliente abre sem login. Chamados com prazo.
--   FASE 4 — Disparos
--     campanhas manuais e automações (aniversário, antes do embarque, depois do
--     retorno...) — SÓ com modelo aprovado pela Meta. Quem pede pra parar
--     (optout) nunca recebe.
--   FASE 5 — Pós-viagem e recompra
--     pesquisa (nota 0–10, link sem login) e oportunidade nova pro Comercial.
--   + rel_alertas: o painel do que precisa de atenção (passaporte, tarefas
--     atrasadas, documentos parados, chamados vencidos, aniversários).
-- =============================================================================


-- ── Token aleatório para links públicos (64 hex) ────────────────────────────
create or replace function rel_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;


-- ── Cliente: pediu para não receber ─────────────────────────────────────────
alter table rel_clientes add column if not exists optout_em timestamptz;


-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 3
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists rel_viagens (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null check (length(trim(titulo)) >= 2),
  destino         text,
  expedicao       text,                 -- nome da expedição (agrupa o grupo)
  tipo            text not null default 'outro' check (tipo in ('expedicao', 'pacote', 'aereo', 'hospedagem', 'outro')),
  data_venda      date,
  data_embarque   date,
  data_retorno    date,
  valor           numeric(12, 2),
  qtd_passageiros integer,
  cliente_id      uuid references rel_clientes(id) on delete set null,   -- quem comprou
  responsavel_id  uuid references qs_users(id) on delete set null,      -- quem cuida no Relacionamento
  bitrix_deal_id  text,
  status          text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  observacoes     text,                 -- o que o Comercial deixou pro Relacionamento
  necessidades    text,                 -- necessidade especial / restrição
  origem          text not null default 'manual' check (origem in ('bitrix', 'manual')),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (data_retorno is null or data_embarque is null or data_retorno >= data_embarque)
);
create unique index if not exists rel_viagens_bitrix_uq on rel_viagens (bitrix_deal_id) where bitrix_deal_id is not null;
create index if not exists rel_viagens_embarque_idx on rel_viagens (data_embarque);
create index if not exists rel_viagens_cliente_idx on rel_viagens (cliente_id);

-- Quem viaja. O comprador também entra aqui (fica fácil listar "todos do grupo").
create table if not exists rel_viagem_passageiros (
  id             uuid primary key default gen_random_uuid(),
  viagem_id      uuid not null references rel_viagens(id) on delete cascade,
  cliente_id     uuid not null references rel_clientes(id) on delete cascade,
  bitrix_deal_id text,                   -- o card do acompanhante (ID pai) no Bitrix
  criado_em      timestamptz not null default now(),
  unique (viagem_id, cliente_id)
);
create unique index if not exists rel_viagem_pass_bitrix_uq on rel_viagem_passageiros (bitrix_deal_id) where bitrix_deal_id is not null;
create index if not exists rel_viagem_pass_cliente_idx on rel_viagem_passageiros (cliente_id);

-- A JORNADA: tarefas do Relacionamento com prazo relativo à venda, ao
-- embarque ou ao retorno. O modelo fica em rel_config.jornada (editável).
create table if not exists rel_viagem_tarefas (
  id          uuid primary key default gen_random_uuid(),
  viagem_id   uuid not null references rel_viagens(id) on delete cascade,
  titulo      text not null,
  descricao   text,
  referencia  text not null default 'manual' check (referencia in ('venda', 'embarque', 'retorno', 'manual')),
  dias        integer,
  prazo       date,
  ordem       integer not null default 0,
  feita_em    timestamptz,
  feita_por   uuid references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists rel_viagem_tarefas_viagem_idx on rel_viagem_tarefas (viagem_id, ordem);
create index if not exists rel_viagem_tarefas_prazo_idx on rel_viagem_tarefas (prazo) where feita_em is null;

insert into rel_config (chave, valor) values ('jornada', '[
  {"titulo": "Dar as boas-vindas ao cliente", "descricao": "Primeiro contato do Relacionamento: apresentar-se e explicar os próximos passos.", "referencia": "venda", "dias": 1},
  {"titulo": "Conferir dados e pedir os documentos", "descricao": "Gerar o link de documentos e mandar pro cliente.", "referencia": "venda", "dias": 3},
  {"titulo": "Conferir passaporte, visto e vacinas", "descricao": "Passaporte precisa valer 6 meses depois da volta.", "referencia": "embarque", "dias": -90},
  {"titulo": "Oferecer seguro viagem", "referencia": "embarque", "dias": -60},
  {"titulo": "Enviar informações finais da viagem", "descricao": "Roteiro, voos, hotéis, contatos de emergência.", "referencia": "embarque", "dias": -15},
  {"titulo": "Mensagem de boa viagem", "referencia": "embarque", "dias": -1},
  {"titulo": "Perguntar como está a viagem", "referencia": "embarque", "dias": 3},
  {"titulo": "Dar as boas-vindas de volta e mandar a pesquisa", "referencia": "retorno", "dias": 2},
  {"titulo": "Conversa de recompra / indicação", "referencia": "retorno", "dias": 30}
]'::jsonb) on conflict (chave) do nothing;

-- Data de referência + dias → prazo.
create or replace function rel_prazo_da_tarefa(v rel_viagens, referencia text, dias int)
returns date language sql immutable as $$
  select case referencia
    when 'venda'    then coalesce(v.data_venda, v.criado_em::date) + coalesce(dias, 0)
    when 'embarque' then v.data_embarque + coalesce(dias, 0)
    when 'retorno'  then coalesce(v.data_retorno, v.data_embarque) + coalesce(dias, 0)
    else null end;
$$;

-- Cria (ou refaz) a jornada da viagem a partir do modelo. Tarefas FEITAS e
-- tarefas manuais ficam como estão; as automáticas pendentes são refeitas
-- (é o que acontece quando muda a data de embarque).
create or replace function rel_gerar_jornada(p_viagem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v    rel_viagens;
  item jsonb;
  i    int := 0;
begin
  select * into v from rel_viagens where id = p_viagem;
  if v.id is null or v.status = 'cancelada' then return; end if;
  delete from rel_viagem_tarefas where viagem_id = p_viagem and referencia <> 'manual' and feita_em is null;
  for item in select * from jsonb_array_elements(coalesce((select valor from rel_config where chave = 'jornada'), '[]'))
  loop
    i := i + 1;
    if exists (select 1 from rel_viagem_tarefas where viagem_id = p_viagem and titulo = item ->> 'titulo') then continue; end if;
    insert into rel_viagem_tarefas (viagem_id, titulo, descricao, referencia, dias, prazo, ordem)
    values (p_viagem, item ->> 'titulo', item ->> 'descricao', coalesce(item ->> 'referencia', 'venda'),
            (item ->> 'dias')::int,
            rel_prazo_da_tarefa(v, coalesce(item ->> 'referencia', 'venda'), (item ->> 'dias')::int), i);
  end loop;
end;
$$;
grant execute on function rel_gerar_jornada(uuid) to authenticated;

create or replace function rel_viagens_gatilho()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.data_venda is distinct from old.data_venda
     or new.data_embarque is distinct from old.data_embarque
     or new.data_retorno is distinct from old.data_retorno
     or (new.status = 'ativa' and old.status = 'cancelada') then
    perform rel_gerar_jornada(new.id);
  end if;
  -- Cancelou: as tarefas pendentes deixam de valer.
  if tg_op = 'UPDATE' and new.status = 'cancelada' and old.status <> 'cancelada' then
    delete from rel_viagem_tarefas where viagem_id = new.id and feita_em is null;
  end if;
  -- O comprador também é passageiro.
  if new.cliente_id is not null then
    insert into rel_viagem_passageiros (viagem_id, cliente_id) values (new.id, new.cliente_id)
    on conflict (viagem_id, cliente_id) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_rel_viagens on rel_viagens;
create trigger trg_rel_viagens after insert or update on rel_viagens
  for each row execute function rel_viagens_gatilho();

create or replace function rel_toca_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end;
$$;
drop trigger if exists trg_rel_viagens_toca on rel_viagens;
create trigger trg_rel_viagens_toca before update on rel_viagens
  for each row execute function rel_toca_atualizado_em();

-- Viagem com o que a tela precisa: fase, dias até embarcar, contadores.
create or replace view rel_viagens_v
with (security_invoker = true) as
select v.*,
       c.nome as cliente_nome,
       c.telefone as cliente_telefone,
       u.name as responsavel_nome,
       case
         when v.status = 'cancelada' then 'cancelada'
         when v.data_embarque is null then 'sem_data'
         when current_date < v.data_embarque then 'antes'
         when current_date <= coalesce(v.data_retorno, v.data_embarque) then 'em_viagem'
         else 'concluida'
       end as fase,
       (v.data_embarque - current_date) as dias_para_embarque,
       (select count(*) from rel_viagem_passageiros p where p.viagem_id = v.id)::int as passageiros,
       (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id and t.feita_em is null and t.prazo < current_date)::int as tarefas_atrasadas,
       (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id and t.feita_em is null)::int as tarefas_pendentes,
       (select count(*) from rel_viagem_tarefas t where t.viagem_id = v.id)::int as tarefas_total
  from rel_viagens v
  left join rel_clientes c on c.id = v.cliente_id
  left join qs_users u on u.id = v.responsavel_id;

-- Documentos. O arquivo fica no bucket PRIVADO `rel-documentos`; a tela abre
-- por link assinado (expira). Nunca URL pública: é passaporte de cliente.
create table if not exists rel_documentos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references rel_clientes(id) on delete cascade,
  viagem_id     uuid references rel_viagens(id) on delete set null,
  pedido_id     uuid,                    -- de qual link veio (se veio)
  tipo          text not null default 'outro' check (tipo in ('passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro', 'voucher', 'contrato', 'comprovante', 'outro')),
  descricao     text,
  arquivo_path  text not null,           -- caminho dentro do bucket
  arquivo_nome  text,
  mime          text,
  tamanho       integer,
  validade      date,
  status        text not null default 'recebido' check (status in ('recebido', 'aprovado', 'recusado')),
  motivo_recusa text,
  enviado_por   text not null default 'time' check (enviado_por in ('cliente', 'time')),
  enviado_em    timestamptz not null default now(),
  revisado_por  uuid references qs_users(id) on delete set null,
  revisado_em   timestamptz
);
create index if not exists rel_documentos_cliente_idx on rel_documentos (cliente_id);
create index if not exists rel_documentos_viagem_idx on rel_documentos (viagem_id);

-- O LINK de documentos: o cliente abre /documentos/<token>, sem login, e
-- manda os arquivos pedidos. Vale 30 dias.
create table if not exists rel_doc_pedidos (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default rel_token(),
  cliente_id   uuid not null references rel_clientes(id) on delete cascade,
  viagem_id    uuid references rel_viagens(id) on delete set null,
  tipos        text[] not null default array['passaporte'],
  mensagem     text,
  expira_em    timestamptz not null default now() + interval '30 days',
  criado_por   uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em    timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists rel_doc_pedidos_cliente_idx on rel_doc_pedidos (cliente_id);
alter table rel_documentos drop constraint if exists rel_documentos_pedido_fk;
alter table rel_documentos add constraint rel_documentos_pedido_fk
  foreign key (pedido_id) references rel_doc_pedidos(id) on delete set null;

-- Chamados: um pedido do cliente que não se resolve na hora (trocar voo,
-- segunda via, reclamação). Tem prazo e dono.
create table if not exists rel_chamados (
  id             uuid primary key default gen_random_uuid(),
  numero         bigserial unique,
  cliente_id     uuid references rel_clientes(id) on delete set null,
  viagem_id      uuid references rel_viagens(id) on delete set null,
  conversa_id    uuid references rel_wa_conversas(id) on delete set null,
  assunto        text not null check (length(trim(assunto)) >= 3),
  descricao      text,
  prioridade     text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  prazo          timestamptz,
  status         text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'aguardando', 'resolvido')),
  responsavel_id uuid references qs_users(id) on delete set null,
  criado_por     uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  resolvido_em   timestamptz,
  resolucao      text
);
create index if not exists rel_chamados_status_idx on rel_chamados (status, prazo);
drop trigger if exists trg_rel_chamados_toca on rel_chamados;
create trigger trg_rel_chamados_toca before update on rel_chamados
  for each row execute function rel_toca_atualizado_em();


-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 4 — DISPAROS
-- ═════════════════════════════════════════════════════════════════════════════
-- `params`: como preencher cada variável do modelo. Ex.:
--   {"1": {"fonte": "nome"}, "2": {"fonte": "destino"}, "3": {"fonte": "texto", "valor": "R$ 500"}}
-- Fontes: nome | destino | data_embarque | link_documentos | link_pesquisa | texto
-- `publico` (campanha): {"tipo": "todos" | "viagem" | "aniversariantes_mes" | "clientes",
--   "expedicao"?, "destino"?, "embarque_de"?, "embarque_ate"?, "fase"?, "clientes"?: [ids]}

create table if not exists rel_campanhas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) >= 2),
  modelo_nome   text not null,
  modelo_idioma text not null default 'pt_BR',
  params        jsonb not null default '{}',
  publico       jsonb not null default '{"tipo": "todos"}',
  status        text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'pausada', 'concluida')),
  total         integer not null default 0,
  enviados      integer not null default 0,
  falhas        integer not null default 0,
  pulados       integer not null default 0,
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  iniciada_em   timestamptz,
  concluida_em  timestamptz
);

create table if not exists rel_automacoes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  -- aniversario: no dia do aniversário (dias = 0)
  -- antes_embarque: X dias antes do embarque · apos_retorno: X dias depois da volta
  -- pos_venda: X dias depois da venda · aniversario_viagem: 1 ano depois do embarque
  gatilho       text not null check (gatilho in ('aniversario', 'antes_embarque', 'apos_retorno', 'pos_venda', 'aniversario_viagem')),
  dias          integer not null default 0 check (dias between 0 and 365),
  modelo_nome   text not null,
  modelo_idioma text not null default 'pt_BR',
  params        jsonb not null default '{}',
  ativo         boolean not null default false,
  ultima_execucao timestamptz,
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now()
);

-- Cada mensagem de disparo (campanha OU automação). `chave` impede mandar a
-- mesma coisa duas vezes (ex.: "aut:<id>:<cliente>:<viagem>:<data>").
create table if not exists rel_envios (
  id           uuid primary key default gen_random_uuid(),
  campanha_id  uuid references rel_campanhas(id) on delete cascade,
  automacao_id uuid references rel_automacoes(id) on delete cascade,
  cliente_id   uuid references rel_clientes(id) on delete set null,
  viagem_id    uuid references rel_viagens(id) on delete set null,
  telefone     text,
  chave        text unique,
  status       text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'pulado')),
  motivo       text,
  wamid        text,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz
);
create index if not exists rel_envios_campanha_idx on rel_envios (campanha_id, status);
create index if not exists rel_envios_cliente_idx on rel_envios (cliente_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 5 — PÓS-VIAGEM E RECOMPRA
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists rel_pesquisas (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique default rel_token(),
  viagem_id     uuid references rel_viagens(id) on delete set null,
  cliente_id    uuid not null references rel_clientes(id) on delete cascade,
  nota          integer check (nota between 0 and 10),       -- "de 0 a 10, quanto recomendaria?"
  comentario    text,
  melhor_parte  text,
  proximo_destino text,                                       -- "pra onde quer ir na próxima?" → recompra
  criado_por    uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  respondida_em timestamptz,
  unique (viagem_id, cliente_id)
);

-- Oportunidade nova pro Comercial (o lead nasce em qs_leads pelo servidor).
create table if not exists rel_recompras (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references rel_clientes(id) on delete cascade,
  viagem_id   uuid references rel_viagens(id) on delete set null,
  lead_id     uuid,
  interesse   text,
  criado_por  uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists rel_recompras_cliente_idx on rel_recompras (cliente_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- ALERTAS — o que precisa de atenção, numa lista só
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view rel_alertas
with (security_invoker = true) as
-- Passaporte vence antes de 6 meses depois da volta (regra da maioria dos países).
select 'passaporte'::text as tipo, 'alta'::text as gravidade,
       c.id as cliente_id, v.id as viagem_id,
       c.nome || ': passaporte vence em ' || to_char(c.passaporte_validade, 'DD/MM/YYYY') as titulo,
       'Viagem ' || v.titulo || ' volta em ' || to_char(coalesce(v.data_retorno, v.data_embarque), 'DD/MM/YYYY') || '. O passaporte precisa valer 6 meses além disso.' as detalhe,
       v.data_embarque as data
  from rel_viagens v
  join rel_viagem_passageiros p on p.viagem_id = v.id
  join rel_clientes c on c.id = p.cliente_id
 where v.status = 'ativa' and v.data_embarque >= current_date
   and c.passaporte_validade is not null
   and c.passaporte_validade < coalesce(v.data_retorno, v.data_embarque) + interval '6 months'
union all
-- Expedição internacional sem passaporte cadastrado, embarcando em até 6 meses.
select 'sem_passaporte', 'media', c.id, v.id,
       c.nome || ': sem passaporte na ficha',
       'Embarca em ' || to_char(v.data_embarque, 'DD/MM/YYYY') || ' (' || v.titulo || ').',
       v.data_embarque
  from rel_viagens v
  join rel_viagem_passageiros p on p.viagem_id = v.id
  join rel_clientes c on c.id = p.cliente_id
 where v.status = 'ativa' and v.tipo = 'expedicao'
   and v.data_embarque between current_date and current_date + 180
   and c.passaporte is null
union all
-- Tarefa da jornada atrasada.
select 'tarefa', case when t.prazo < current_date - 7 then 'alta' else 'media' end, v.cliente_id, v.id,
       t.titulo, v.titulo || ' · prazo ' || to_char(t.prazo, 'DD/MM'), t.prazo
  from rel_viagem_tarefas t join rel_viagens v on v.id = t.viagem_id
 where t.feita_em is null and t.prazo < current_date and v.status = 'ativa'
union all
-- Link de documentos mandado há mais de 7 dias e ainda sem nada.
select 'documentos', 'media', d.cliente_id, d.viagem_id,
       c.nome || ': documentos pedidos e não enviados',
       'Link criado em ' || to_char(d.criado_em, 'DD/MM') || '.', d.criado_em::date
  from rel_doc_pedidos d join rel_clientes c on c.id = d.cliente_id
 where d.concluido_em is null and d.criado_em < now() - interval '7 days' and d.expira_em > now()
   and not exists (select 1 from rel_documentos x where x.pedido_id = d.id)
union all
-- Chamado vencido.
select 'chamado', case when ch.prioridade in ('alta', 'urgente') then 'alta' else 'media' end, ch.cliente_id, ch.viagem_id,
       'Chamado #' || ch.numero || ': ' || ch.assunto, 'Prazo era ' || to_char(ch.prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.', ch.prazo::date
  from rel_chamados ch
 where ch.status <> 'resolvido' and ch.prazo < now()
union all
-- Aniversário nos próximos 7 dias (datas que vendem).
select 'aniversario', 'baixa', c.id, null::uuid,
       c.nome || ' faz aniversário em ' || to_char(c.nascimento, 'DD/MM'),
       'Boa hora pra uma mensagem.', make_date(extract(year from current_date)::int, extract(month from c.nascimento)::int,
         case when to_char(c.nascimento, 'MM-DD') = '02-29' then 28 else extract(day from c.nascimento)::int end)
  from rel_clientes c
 where c.mesclado_em_id is null and c.nascimento is not null
   and (to_char(c.nascimento, 'MM-DD') between to_char(current_date, 'MM-DD') and to_char(current_date + 7, 'MM-DD')
        or (to_char(current_date + 7, 'MM-DD') < to_char(current_date, 'MM-DD')
            and (to_char(c.nascimento, 'MM-DD') >= to_char(current_date, 'MM-DD') or to_char(c.nascimento, 'MM-DD') <= to_char(current_date + 7, 'MM-DD'))))
union all
-- Embarca nos próximos 7 dias.
select 'embarque', 'baixa', v.cliente_id, v.id,
       v.titulo || ' embarca em ' || to_char(v.data_embarque, 'DD/MM'),
       (select count(*) from rel_viagem_passageiros p where p.viagem_id = v.id) || ' passageiro(s).', v.data_embarque
  from rel_viagens v
 where v.status = 'ativa' and v.data_embarque between current_date and current_date + 7;


-- ═════════════════════════════════════════════════════════════════════════════
-- RLS
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['rel_viagens', 'rel_viagem_passageiros', 'rel_viagem_tarefas', 'rel_documentos',
                           'rel_doc_pedidos', 'rel_chamados', 'rel_campanhas', 'rel_automacoes', 'rel_envios',
                           'rel_pesquisas', 'rel_recompras']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('drop policy if exists %I on %I', t || '_criar', t);
    execute format('drop policy if exists %I on %I', t || '_mudar', t);
    execute format('drop policy if exists %I on %I', t || '_apagar', t);
    execute format('create policy %I on %I for select to authenticated using (rel_tem_acesso())', t || '_ler', t);
    execute format('create policy %I on %I for insert to authenticated with check (rel_tem_acesso())', t || '_criar', t);
    execute format('create policy %I on %I for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso())', t || '_mudar', t);
    execute format('create policy %I on %I for delete to authenticated using (rel_tem_acesso())', t || '_apagar', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- Envio de disparo é do servidor: a tela só LÊ os envios.
drop policy if exists rel_envios_criar on rel_envios;
drop policy if exists rel_envios_mudar on rel_envios;
drop policy if exists rel_envios_apagar on rel_envios;
-- Resposta da pesquisa só chega pelo servidor (link público); o time só lê/cria o convite.
drop policy if exists rel_pesquisas_mudar on rel_pesquisas;
-- Recompra nasce pelo servidor (ele cria o lead no Comercial).
drop policy if exists rel_recompras_criar on rel_recompras;
drop policy if exists rel_recompras_mudar on rel_recompras;

grant select on rel_viagens_v, rel_alertas to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- STORAGE: bucket privado dos documentos
-- ═════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('rel-documentos', 'rel-documentos', false, 20971520)
on conflict (id) do update set public = false;

drop policy if exists rel_docs_ler on storage.objects;
drop policy if exists rel_docs_subir on storage.objects;
drop policy if exists rel_docs_apagar on storage.objects;
create policy rel_docs_ler on storage.objects for select to authenticated
  using (bucket_id = 'rel-documentos' and rel_tem_acesso());
create policy rel_docs_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'rel-documentos' and rel_tem_acesso());
create policy rel_docs_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'rel-documentos' and rel_tem_acesso());
