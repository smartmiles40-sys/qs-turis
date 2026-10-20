-- 0149_central_solicitacoes.sql
-- -----------------------------------------------------------------------------
-- CENTRAL DE SOLICITAÇÕES (Bruno, 20/10/2026): "tem solicitações que o
-- relacionamento pede para o operações e se perde quando vai pra eles! Precisamos
-- de uma central que organiza as demandas e solicitações de cada setor".
--
-- Um lugar só pros 4 setores (Comercial, Relacionamento, Financeiro, Operações).
-- Cada pedido entre setores vira um cartão com DONO, PRAZO e HISTÓRICO:
--
--   nova ──aceitar──▶ em_andamento ⇄ aguardando (cliente/fornecedor/quem pediu)
--     │                    │
--     └──recusar           └──concluir (escreve o que foi feito)──▶ concluida
--                                                                     │
--                               quem pediu: confirmar ✔ ou reabrir ↺ ─┘
--
-- Regras que o Bruno aprovou:
--   • ninguém aceitou em 2 HORAS ÚTEIS (rel_config.horario) → acende pro gestor;
--   • prazo automático pelo TIPO (em horas úteis; a maioria é cotação);
--   • só conclui escrevendo o que foi feito; quem pediu confirma ou reabre.
--
-- Os fin_atendimentos (cliente mandado ao Financeiro) e os rel_chamados
-- (protocolo do cliente) CONTINUAM — são atendimento AO CLIENTE. A central é
-- pedido de setor pra setor.
--
-- Escrita só por RPC (security definer); as tabelas são só leitura.
-- -----------------------------------------------------------------------------

-- ── Quem é de qual setor ───────────────────────────────────────────────────
create or replace function qs_do_setor(p_setor text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or p_setor = any(setores))
  );
$$;
-- Gestor do setor (ou admin): vê o "sem dono" acender e edita tipos/prazos.
create or replace function qs_gestor_do_setor(p_setor text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users
     where id = auth.uid() and is_active
       and (role = 'admin' or (role = 'gestor' and p_setor = any(setores)))
  );
$$;
grant execute on function qs_do_setor(text), qs_gestor_do_setor(text) to authenticated;

-- Soma N minutos ÚTEIS a partir de um instante (o contrário de rel_minutos_uteis).
create or replace function qs_somar_minutos_uteis(p_de timestamptz, p_minutos int)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  cfg   jsonb;
  dias  int[];
  folga date[];
  ini   time;
  fim   time;
  tz    constant text := 'America/Sao_Paulo';
  d     date;
  a     timestamptz;
  b     timestamptz;
  falta numeric := greatest(coalesce(p_minutos, 0), 0);
  livre numeric;
  voltas int := 0;
begin
  if p_de is null then return null; end if;
  select valor into cfg from rel_config where chave = 'horario';
  dias  := coalesce((select array_agg(x::int) from jsonb_array_elements_text(cfg -> 'dias') x), array[1,2,3,4,5]);
  folga := coalesce((select array_agg(x::date) from jsonb_array_elements_text(cfg -> 'feriados') x
                      where x ~ '^\d{4}-\d{2}-\d{2}$'), '{}');
  ini   := coalesce((cfg ->> 'inicio')::time, '09:00');
  fim   := coalesce((cfg ->> 'fim')::time, '18:00');
  d := (p_de at time zone tz)::date;
  loop
    voltas := voltas + 1;
    if voltas > 400 then return p_de + make_interval(mins => p_minutos); end if;
    if extract(isodow from d)::int = any(dias) and not (d = any(folga)) then
      a := greatest(p_de, (d + ini) at time zone tz);
      b := (d + fim) at time zone tz;
      if b > a then
        livre := extract(epoch from (b - a)) / 60;
        if falta <= livre then return a + make_interval(secs => falta * 60); end if;
        falta := falta - livre;
      end if;
    end if;
    d := d + 1;
  end loop;
end;
$$;

-- ── Tipos de pedido (por setor que RECEBE) e o prazo de cada um ────────────
create table if not exists qs_solicitacao_tipos (
  id            text primary key,
  setor         text not null check (setor in ('comercial','relacionamento','financeiro','operacional')),
  rotulo        text not null,
  prazo_horas   int  not null default 8 check (prazo_horas between 1 and 400),  -- horas ÚTEIS
  ordem         int  not null default 100,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into qs_solicitacao_tipos (id, setor, rotulo, prazo_horas, ordem) values
  -- Operações (a maioria é cotação — Bruno 20/10)
  ('ops_cotacao',      'operacional', 'Cotação',                          8,  10),
  ('ops_emissao',      'operacional', 'Emissão (aéreo, hotel, seguro…)',  4,  20),
  ('ops_alteracao',    'operacional', 'Alteração / remarcação',           8,  30),
  ('ops_cancelamento', 'operacional', 'Cancelamento / reembolso',        16,  40),
  ('ops_documentos',   'operacional', 'Voucher / documentos da viagem',   8,  50),
  ('ops_fornecedor',   'operacional', 'Falar com fornecedor',             8,  60),
  ('ops_outro',        'operacional', 'Outro',                            8, 999),
  -- Relacionamento
  ('rel_contato',      'relacionamento', 'Falar com o cliente',           4,  10),
  ('rel_documentos',   'relacionamento', 'Pegar documentos / dados do cliente', 8, 20),
  ('rel_pos_venda',    'relacionamento', 'Pós-venda / reclamação',        8,  30),
  ('rel_outro',        'relacionamento', 'Outro',                         8, 999),
  -- Comercial
  ('com_cotacao',      'comercial', 'Nova venda / cotação para o cliente', 8, 10),
  ('com_indicacao',    'comercial', 'Indicação / cliente quer comprar de novo', 4, 20),
  ('com_proposta',     'comercial', 'Ajustar proposta / valores',     8,  30),
  ('com_outro',        'comercial', 'Outro',                          8, 999),
  -- Financeiro
  ('fin_cobranca',     'financeiro', 'Cobrança / pagamento do cliente', 8, 10),
  ('fin_fornecedor',   'financeiro', 'Pagar fornecedor',                8, 20),
  ('fin_reembolso',    'financeiro', 'Reembolso / estorno',            16, 30),
  ('fin_nota',         'financeiro', 'Nota fiscal / recibo',           16, 40),
  ('fin_outro',        'financeiro', 'Outro',                           8, 999)
on conflict (id) do nothing;

alter table qs_solicitacao_tipos enable row level security;
drop policy if exists qs_sol_tipos_ler on qs_solicitacao_tipos;
drop policy if exists qs_sol_tipos_mudar on qs_solicitacao_tipos;
create policy qs_sol_tipos_ler on qs_solicitacao_tipos for select to authenticated
  using (exists (select 1 from qs_users where id = auth.uid() and is_active));
create policy qs_sol_tipos_mudar on qs_solicitacao_tipos for all to authenticated
  using (qs_gestor_do_setor(setor)) with check (qs_gestor_do_setor(setor));
revoke all on qs_solicitacao_tipos from anon;
grant select, insert, update on qs_solicitacao_tipos to authenticated;

-- ── As solicitações ────────────────────────────────────────────────────────
create table if not exists qs_solicitacoes (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,
  de_setor        text not null check (de_setor in ('comercial','relacionamento','financeiro','operacional')),
  para_setor      text not null check (para_setor in ('comercial','relacionamento','financeiro','operacional')),
  tipo_id         text references qs_solicitacao_tipos(id) on delete set null,
  titulo          text not null,
  descricao       text not null default '',
  prioridade      text not null default 'normal' check (prioridade in ('normal','alta','urgente')),
  status          text not null default 'nova'
                  check (status in ('nova','em_andamento','aguardando','concluida','recusada','cancelada')),
  aguardando_quem text check (aguardando_quem in ('cliente','fornecedor','solicitante','outro_setor')),
  prazo           timestamptz,
  -- Do que se trata (snapshot do nome: Operações e Comercial não leem as fichas)
  cliente_id      uuid references rel_clientes(id) on delete set null,
  viagem_id       uuid references rel_viagens(id) on delete set null,
  lead_id         uuid references qs_leads(id) on delete set null,
  conversa_id     uuid references rel_wa_conversas(id) on delete set null,
  sobre_nome      text,           -- "Maria Souza · Islândia G1"
  -- Pessoas
  criado_por      uuid references qs_users(id) on delete set null,
  responsavel_id  uuid references qs_users(id) on delete set null,
  -- Tempos
  criado_em       timestamptz not null default now(),
  aceito_em       timestamptz,
  concluido_em    timestamptz,
  confirmado_em   timestamptz,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid,
  resolucao       text,
  reaberturas     int not null default 0,
  check (de_setor <> para_setor)
);
create index if not exists qs_sol_para_idx on qs_solicitacoes (para_setor, status, criado_em);
create index if not exists qs_sol_de_idx on qs_solicitacoes (de_setor, status, criado_em);
create index if not exists qs_sol_criador_idx on qs_solicitacoes (criado_por, status);
create index if not exists qs_sol_resp_idx on qs_solicitacoes (responsavel_id, status);
create index if not exists qs_sol_cliente_idx on qs_solicitacoes (cliente_id);
create index if not exists qs_sol_viagem_idx on qs_solicitacoes (viagem_id);
create index if not exists qs_sol_lead_idx on qs_solicitacoes (lead_id);

create table if not exists qs_solicitacao_eventos (
  id             bigint generated always as identity primary key,
  solicitacao_id uuid not null references qs_solicitacoes(id) on delete cascade,
  tipo           text not null check (tipo in ('criada','aceita','passada','status','comentario','prazo','concluida','confirmada','reaberta','recusada','cancelada')),
  de             text,
  para           text,
  texto          text,
  autor_id       uuid default auth.uid(),
  autor_nome     text,
  criado_em      timestamptz not null default now()
);
create index if not exists qs_sol_ev_idx on qs_solicitacao_eventos (solicitacao_id, criado_em);

-- Quando cada pessoa abriu a solicitação pela última vez (bolinha de "novidade").
create table if not exists qs_solicitacao_vistos (
  solicitacao_id uuid not null references qs_solicitacoes(id) on delete cascade,
  user_id        uuid not null references qs_users(id) on delete cascade,
  visto_em       timestamptz not null default now(),
  primary key (solicitacao_id, user_id)
);

-- Quem enxerga: os dois setores envolvidos, quem pediu, o responsável e admin.
create or replace function qs_ve_solicitacao(p_de text, p_para text, p_criador uuid, p_resp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_criador = auth.uid() or p_resp = auth.uid() or qs_do_setor(p_de) or qs_do_setor(p_para);
$$;
grant execute on function qs_ve_solicitacao(text, text, uuid, uuid) to authenticated;

alter table qs_solicitacoes enable row level security;
alter table qs_solicitacao_eventos enable row level security;
alter table qs_solicitacao_vistos enable row level security;
drop policy if exists qs_sol_ler on qs_solicitacoes;
create policy qs_sol_ler on qs_solicitacoes for select to authenticated
  using (qs_ve_solicitacao(de_setor, para_setor, criado_por, responsavel_id));
drop policy if exists qs_sol_ev_ler on qs_solicitacao_eventos;
create policy qs_sol_ev_ler on qs_solicitacao_eventos for select to authenticated using (
  exists (select 1 from qs_solicitacoes s where s.id = solicitacao_id and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id))
);
drop policy if exists qs_sol_vistos_meus on qs_solicitacao_vistos;
create policy qs_sol_vistos_meus on qs_solicitacao_vistos for select to authenticated using (user_id = auth.uid());
revoke all on qs_solicitacoes, qs_solicitacao_eventos, qs_solicitacao_vistos from anon, authenticated;
grant select on qs_solicitacoes, qs_solicitacao_eventos, qs_solicitacao_vistos to authenticated;

create or replace function qs_eu_nome() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from qs_users where id = auth.uid()), 'Sistema');
$$;

-- ── Leitura pronta pra tela (nomes + sinais) ───────────────────────────────
create or replace view qs_solicitacoes_v with (security_invoker = true) as
select s.*,
       t.rotulo                         as tipo_rotulo,
       uc.name                          as criado_por_nome,
       ur.name                          as responsavel_nome,
       s.status in ('nova','em_andamento','aguardando')                       as aberta,
       (s.status in ('nova','em_andamento','aguardando') and s.prazo is not null and s.prazo < now()) as vencida,
       -- 2 horas úteis sem ninguém aceitar → acende pro gestor
       (s.status = 'nova' and rel_minutos_uteis(s.criado_em, now()) >= 120)  as sem_dono_atrasada,
       -- teve mudança feita por outra pessoa depois que EU abri
       (s.atualizado_por is distinct from auth.uid()
          and s.atualizado_em > coalesce(v.visto_em, '-infinity'::timestamptz)) as novidade
  from qs_solicitacoes s
  left join qs_solicitacao_tipos t on t.id = s.tipo_id
  left join qs_users uc on uc.id = s.criado_por
  left join qs_users ur on ur.id = s.responsavel_id
  left join qs_solicitacao_vistos v on v.solicitacao_id = s.id and v.user_id = auth.uid();
grant select on qs_solicitacoes_v to authenticated;

-- ── Criar ──────────────────────────────────────────────────────────────────
create or replace function qs_sol_criar(
  p_de text, p_para text, p_tipo text, p_titulo text, p_descricao text,
  p_prioridade text default 'normal', p_prazo timestamptz default null,
  p_cliente uuid default null, p_viagem uuid default null, p_lead uuid default null, p_conversa uuid default null,
  p_sobre text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_horas int; v_prazo timestamptz; v_sobre text := nullif(trim(coalesce(p_sobre, '')), '');
begin
  if not qs_do_setor(p_de) then raise exception 'Você não é desse setor.'; end if;
  if p_de = p_para then raise exception 'Escolha outro setor (o pedido é pra outro setor).'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  select prazo_horas into v_horas from qs_solicitacao_tipos where id = p_tipo and setor = p_para and ativo;
  if v_horas is null then raise exception 'Tipo de pedido inválido pra esse setor.'; end if;
  v_prazo := coalesce(p_prazo, qs_somar_minutos_uteis(now(), v_horas * 60));
  -- Completa o "sobre" pelo que veio (nome do cliente / viagem / lead).
  if v_sobre is null and p_viagem is not null then
    select nullif(concat_ws(' · ', cl.nome, nullif(coalesce(nullif(v.expedicao, ''), nullif(v.titulo, ''), v.destino), '')), '')
      into v_sobre from rel_viagens v left join rel_clientes cl on cl.id = v.cliente_id where v.id = p_viagem;
    p_cliente := coalesce(p_cliente, (select cliente_id from rel_viagens where id = p_viagem));
  end if;
  if v_sobre is null and p_cliente is not null then select nome into v_sobre from rel_clientes where id = p_cliente; end if;
  if v_sobre is null and p_lead is not null then
    select coalesce(full_name, trim(concat_ws(' ', first_name, last_name))) into v_sobre from qs_leads where id = p_lead;
  end if;
  if v_sobre is null and p_conversa is not null then
    select coalesce(cl.nome, c.nome_contato, c.telefone), coalesce(p_cliente, c.cliente_id) into v_sobre, p_cliente
      from rel_wa_conversas c left join rel_clientes cl on cl.id = c.cliente_id where c.id = p_conversa;
  end if;

  insert into qs_solicitacoes (de_setor, para_setor, tipo_id, titulo, descricao, prioridade, prazo,
                               cliente_id, viagem_id, lead_id, conversa_id, sobre_nome, criado_por, atualizado_por)
  values (p_de, p_para, p_tipo, trim(p_titulo), coalesce(trim(p_descricao), ''), coalesce(p_prioridade, 'normal'), v_prazo,
          p_cliente, p_viagem, p_lead, p_conversa, v_sobre, auth.uid(), auth.uid())
  returning id into v_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
    values (v_id, 'criada', p_para, nullif(trim(coalesce(p_descricao, '')), ''), qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (v_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
  return v_id;
end $$;
grant execute on function qs_sol_criar(text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, text) to authenticated;

-- ── Mexer: aceitar, passar, aguardar, retomar, concluir, recusar, confirmar,
--    reabrir, cancelar, comentar, prazo ────────────────────────────────────
create or replace function qs_sol_acao(p_id uuid, p_acao text, p_texto text default null, p_extra text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s qs_solicitacoes;
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
  v_eu text := qs_eu_nome();
  recebe boolean;
  pediu boolean;
  v_user uuid;
  v_nome text;
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  recebe := qs_do_setor(s.para_setor);
  pediu  := s.criado_por = auth.uid() or qs_do_setor(s.de_setor);
  if not (recebe or pediu or s.responsavel_id = auth.uid()) then raise exception 'Sem acesso a essa solicitação.'; end if;

  if p_acao = 'comentar' then
    if v_texto is null then raise exception 'Escreva o comentário.'; end if;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome) values (p_id, 'comentario', v_texto, v_eu);

  elsif p_acao = 'aceitar' then
    if not recebe then raise exception 'Só quem é do setor que recebeu aceita.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    update qs_solicitacoes set responsavel_id = auth.uid(), aceito_em = coalesce(aceito_em, now()),
           status = case when status = 'nova' then 'em_andamento' else status end where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, autor_nome) values (p_id, 'aceita', v_eu, v_eu);

  elsif p_acao = 'passar' then
    if not recebe then raise exception 'Só quem é do setor que recebeu passa pra outra pessoa.'; end if;
    v_user := nullif(p_extra, '')::uuid;
    select name into v_nome from qs_users where id = v_user and is_active and (role = 'admin' or s.para_setor = any(setores));
    if v_nome is null then raise exception 'Essa pessoa não é do setor.'; end if;
    update qs_solicitacoes set responsavel_id = v_user, aceito_em = coalesce(aceito_em, now()),
           status = case when status = 'nova' then 'em_andamento' else status end where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome) values (p_id, 'passada', v_nome, v_texto, v_eu);

  elsif p_acao = 'aguardar' then
    if not recebe then raise exception 'Só quem recebeu muda o andamento.'; end if;
    if s.status not in ('em_andamento','aguardando','nova') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if p_extra not in ('cliente','fornecedor','solicitante','outro_setor') then raise exception 'Diga quem você está aguardando.'; end if;
    update qs_solicitacoes set status = 'aguardando', aguardando_quem = p_extra,
           responsavel_id = coalesce(responsavel_id, auth.uid()), aceito_em = coalesce(aceito_em, now()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome) values (p_id, 'status', s.status, 'aguardando:' || p_extra, v_texto, v_eu);

  elsif p_acao = 'retomar' then
    if not recebe then raise exception 'Só quem recebeu muda o andamento.'; end if;
    if s.status <> 'aguardando' then raise exception 'Não está aguardando.'; end if;
    update qs_solicitacoes set status = 'em_andamento', aguardando_quem = null where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome) values (p_id, 'status', 'aguardando', 'em_andamento', v_texto, v_eu);

  elsif p_acao = 'concluir' then
    if not recebe then raise exception 'Só quem recebeu conclui.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if v_texto is null then raise exception 'Escreva o que foi feito — quem pediu precisa saber.'; end if;
    update qs_solicitacoes set status = 'concluida', aguardando_quem = null, resolucao = v_texto, concluido_em = now(),
           confirmado_em = null, responsavel_id = coalesce(responsavel_id, auth.uid()), aceito_em = coalesce(aceito_em, now()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'concluida', s.status, v_texto, v_eu);

  elsif p_acao = 'recusar' then
    if not recebe then raise exception 'Só quem recebeu recusa.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if v_texto is null then raise exception 'Diga por que não dá pra fazer.'; end if;
    update qs_solicitacoes set status = 'recusada', aguardando_quem = null, resolucao = v_texto, concluido_em = now(),
           responsavel_id = coalesce(responsavel_id, auth.uid()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'recusada', s.status, v_texto, v_eu);

  elsif p_acao = 'confirmar' then
    if not pediu then raise exception 'Só quem pediu confirma.'; end if;
    if s.status <> 'concluida' then raise exception 'Ainda não foi concluída.'; end if;
    update qs_solicitacoes set confirmado_em = now() where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome) values (p_id, 'confirmada', v_texto, v_eu);

  elsif p_acao = 'reabrir' then
    if not pediu then raise exception 'Só quem pediu reabre.'; end if;
    if s.status not in ('concluida','recusada') then raise exception 'Não está fechada.'; end if;
    if v_texto is null then raise exception 'Diga o que ainda falta.'; end if;
    update qs_solicitacoes set status = case when responsavel_id is null then 'nova' else 'em_andamento' end,
           concluido_em = null, confirmado_em = null, reaberturas = reaberturas + 1 where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'reaberta', s.status, v_texto, v_eu);

  elsif p_acao = 'cancelar' then
    if not pediu then raise exception 'Só quem pediu cancela.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Já está fechada.'; end if;
    update qs_solicitacoes set status = 'cancelada', aguardando_quem = null, concluido_em = now(), resolucao = coalesce(v_texto, resolucao) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'cancelada', s.status, v_texto, v_eu);

  elsif p_acao = 'prazo' then
    if not (recebe or pediu) then raise exception 'Sem acesso.'; end if;
    if nullif(p_extra, '') is null then raise exception 'Escolha o novo prazo.'; end if;
    update qs_solicitacoes set prazo = p_extra::timestamptz where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome)
      values (p_id, 'prazo', s.prazo::text, p_extra, v_texto, v_eu);

  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;

  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = p_id;
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;
grant execute on function qs_sol_acao(uuid, text, text, text) to authenticated;

-- Abriu a solicitação: apaga a bolinha de novidade pra mim.
create or replace function qs_sol_visto(p_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into qs_solicitacao_vistos (solicitacao_id, user_id)
  select p_id, auth.uid() where exists (select 1 from qs_users where id = auth.uid() and is_active)
  on conflict (solicitacao_id, user_id) do update set visto_em = now();
$$;
grant execute on function qs_sol_visto(uuid) to authenticated;

-- Bolinhas do menu de cada área.
create or replace function qs_sol_contagem(p_setor text) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    -- chegou pro meu setor e ninguém aceitou
    'novas',      count(*) filter (where para_setor = p_setor and status = 'nova'),
    -- (pro gestor) sem dono há 2h úteis ou vencidas no setor
    'atrasadas',  count(*) filter (where para_setor = p_setor and (sem_dono_atrasada or vencida)),
    -- comigo e abertas
    'comigo',     count(*) filter (where responsavel_id = auth.uid() and aberta),
    -- o que EU pedi e mudou (inclui "concluída, confirme")
    'novidades',  count(*) filter (where criado_por = auth.uid() and novidade and not (status = 'cancelada'))
  )
  from qs_solicitacoes_v
  where para_setor = p_setor or criado_por = auth.uid() or responsavel_id = auth.uid();
$$;
grant execute on function qs_sol_contagem(text) to authenticated;
