-- 0127_financeiro_atendimentos.sql
-- -----------------------------------------------------------------------------
-- FINANCEIRO, PRIMEIRO PASSO (Bruno, 14/10/2026): "conseguirmos enviar o
-- cliente pro financeiro e o financeiro falar diretamente com o cliente pra
-- resolver as dúvidas".
--
--   • fin_atendimentos: cada cliente mandado ao Financeiro (por Comercial,
--     Relacionamento ou Operações) vira um atendimento numerado com motivo e
--     STATUS (novo → em atendimento → aguardando cliente → resolvido). Quem
--     mandou acompanha o status.
--   • O Financeiro fala pelo MESMO número do Relacionamento (decisão do Bruno):
--     a conversa ganha `setor`. Com setor = 'financeiro' ela sai da fila do
--     Relacionamento e entra na do Financeiro; ao terminar, volta.
--   • Quem é só do Financeiro enxerga SÓ as conversas que estão com o
--     Financeiro (e as fichas/viagens dos clientes, pra conferir valores).
--
-- Tudo que muda atendimento/setor passa por RPC (security definer) — a tabela
-- não tem UPDATE direto.
-- -----------------------------------------------------------------------------

-- ── 1. A conversa tem dono de setor ────────────────────────────────────────
alter table rel_wa_conversas add column if not exists setor text not null default 'relacionamento';
alter table rel_wa_conversas drop constraint if exists rel_wa_conversas_setor_chk;
alter table rel_wa_conversas add constraint rel_wa_conversas_setor_chk check (setor in ('relacionamento', 'financeiro'));
alter table rel_wa_conversas add column if not exists setor_desde timestamptz;

-- Quem vê a conversa: o Relacionamento todo; o Financeiro só as dele.
create or replace function wa_ve_conversa(p_setor text) returns boolean
language sql stable security definer set search_path = public as $$
  select rel_tem_acesso() or (fin_tem_acesso() and p_setor = 'financeiro');
$$;
grant execute on function wa_ve_conversa(text) to authenticated;

-- As ferramentas do WhatsApp (etiquetas, listas, figurinhas, respostas, notas)
-- valem pras duas áreas que atendem pelo número.
create or replace function wa_atende() returns boolean
language sql stable security definer set search_path = public as $$
  select rel_tem_acesso() or fin_tem_acesso();
$$;
grant execute on function wa_atende() to authenticated;

drop policy if exists rel_wa_conv_ler on rel_wa_conversas;
drop policy if exists rel_wa_conv_mudar on rel_wa_conversas;
create policy rel_wa_conv_ler on rel_wa_conversas for select to authenticated using (wa_ve_conversa(setor));
create policy rel_wa_conv_mudar on rel_wa_conversas for update to authenticated using (wa_ve_conversa(setor)) with check (wa_ve_conversa(setor));

drop policy if exists rel_wa_msg_ler on rel_wa_mensagens;
create policy rel_wa_msg_ler on rel_wa_mensagens for select to authenticated using (
  rel_tem_acesso() or (fin_tem_acesso() and exists (select 1 from rel_wa_conversas c where c.id = conversa_id and c.setor = 'financeiro'))
);

drop policy if exists rel_wa_sla_ler on rel_wa_sla;
create policy rel_wa_sla_ler on rel_wa_sla for select to authenticated using (wa_atende());

do $$
declare t text;
begin
  foreach t in array array['rel_wa_etiquetas','rel_wa_conversa_etiquetas','rel_wa_listas','rel_wa_lista_conversas'] loop
    execute format('drop policy if exists %I on %I', t || '_tudo', t);
    execute format('create policy %I on %I for all to authenticated using (wa_atende()) with check (wa_atende())', t || '_tudo', t);
  end loop;
end $$;

drop policy if exists rel_wa_cu_tudo on rel_wa_conversa_usuario;
create policy rel_wa_cu_tudo on rel_wa_conversa_usuario for all to authenticated
  using (user_id = auth.uid() and wa_atende()) with check (user_id = auth.uid() and wa_atende());
drop policy if exists rel_wa_mf_tudo on rel_wa_mensagem_favoritas;
create policy rel_wa_mf_tudo on rel_wa_mensagem_favoritas for all to authenticated
  using (user_id = auth.uid() and wa_atende()) with check (user_id = auth.uid() and wa_atende());
drop policy if exists rel_wa_fig_ler on rel_wa_figurinhas;
drop policy if exists rel_wa_fig_apagar on rel_wa_figurinhas;
create policy rel_wa_fig_ler on rel_wa_figurinhas for select to authenticated using (wa_atende());
create policy rel_wa_fig_apagar on rel_wa_figurinhas for delete to authenticated
  using (wa_atende() and (criado_por = auth.uid() or rel_pode_configurar() or fin_pode_configurar()));

drop policy if exists rel_wa_resp_ler on rel_wa_respostas;
drop policy if exists rel_wa_resp_criar on rel_wa_respostas;
drop policy if exists rel_wa_resp_mudar on rel_wa_respostas;
drop policy if exists rel_wa_resp_apagar on rel_wa_respostas;
create policy rel_wa_resp_ler    on rel_wa_respostas for select to authenticated using (wa_atende());
create policy rel_wa_resp_criar  on rel_wa_respostas for insert to authenticated with check (rel_pode_configurar() or fin_pode_configurar());
create policy rel_wa_resp_mudar  on rel_wa_respostas for update to authenticated using (rel_pode_configurar() or fin_pode_configurar()) with check (rel_pode_configurar() or fin_pode_configurar());
create policy rel_wa_resp_apagar on rel_wa_respostas for delete to authenticated using (rel_pode_configurar() or fin_pode_configurar());

drop policy if exists rel_notas_dono on rel_notas;
create policy rel_notas_dono on rel_notas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and wa_atende());

-- O Financeiro LÊ fichas e viagens (confere valores, CPF pra nota). Não edita.
drop policy if exists rel_clientes_ler on rel_clientes;
create policy rel_clientes_ler on rel_clientes for select to authenticated using (rel_tem_acesso() or fin_tem_acesso());
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'rel_viagens'::regclass and polname = 'rel_viagens_ler') then
    execute 'drop policy rel_viagens_ler on rel_viagens';
    execute 'create policy rel_viagens_ler on rel_viagens for select to authenticated using (rel_tem_acesso() or fin_tem_acesso())';
  end if;
end $$;

-- ── 2. Os atendimentos do Financeiro ───────────────────────────────────────
create table if not exists fin_atendimentos (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity,
  cliente_id     uuid references rel_clientes(id) on delete set null,
  lead_id        uuid references qs_leads(id) on delete set null,
  conversa_id    uuid references rel_wa_conversas(id) on delete set null,
  nome           text not null default '',
  telefone       text,
  motivo         text not null default 'duvida'
                 check (motivo in ('duvida','cobranca','segunda_via','parcelamento','reembolso','nota_fiscal','cancelamento','outro')),
  descricao      text not null default '',
  origem         text not null check (origem in ('comercial','relacionamento','operacional','financeiro')),
  enviado_por    uuid references qs_users(id) on delete set null,
  responsavel_id uuid references qs_users(id) on delete set null,
  status         text not null default 'novo'
                 check (status in ('novo','em_atendimento','aguardando_cliente','resolvido','cancelado')),
  prioridade     text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  resolucao      text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  resolvido_em   timestamptz
);
create index if not exists fin_atend_status_idx on fin_atendimentos (status, criado_em);
create index if not exists fin_atend_cliente_idx on fin_atendimentos (cliente_id);
create index if not exists fin_atend_lead_idx on fin_atendimentos (lead_id);
create index if not exists fin_atend_conversa_idx on fin_atendimentos (conversa_id);

create table if not exists fin_atendimento_eventos (
  id             bigint generated always as identity primary key,
  atendimento_id uuid not null references fin_atendimentos(id) on delete cascade,
  tipo           text not null check (tipo in ('criado','status','responsavel','nota','conversa','devolvido')),
  de             text,
  para           text,
  texto          text,
  autor_id       uuid default auth.uid(),
  autor_nome     text,
  criado_em      timestamptz not null default now()
);
create index if not exists fin_atend_ev_idx on fin_atendimento_eventos (atendimento_id, criado_em);

-- Quem lê: o Financeiro, o Relacionamento (o cliente é o mesmo), gestores/admin
-- e quem mandou (o SDR acompanha o que mandou).
create or replace function fin_ve_atendimento(p_enviado_por uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select fin_tem_acesso() or rel_tem_acesso() or p_enviado_por = auth.uid()
      or exists (select 1 from qs_users where id = auth.uid() and is_active and role in ('admin','gestor'));
$$;
grant execute on function fin_ve_atendimento(uuid) to authenticated;

alter table fin_atendimentos enable row level security;
alter table fin_atendimento_eventos enable row level security;
drop policy if exists fin_atend_ler on fin_atendimentos;
create policy fin_atend_ler on fin_atendimentos for select to authenticated using (fin_ve_atendimento(enviado_por));
drop policy if exists fin_atend_ev_ler on fin_atendimento_eventos;
create policy fin_atend_ev_ler on fin_atendimento_eventos for select to authenticated using (
  exists (select 1 from fin_atendimentos a where a.id = atendimento_id and fin_ve_atendimento(a.enviado_por))
);
revoke all on fin_atendimentos, fin_atendimento_eventos from anon, authenticated;
grant select on fin_atendimentos, fin_atendimento_eventos to authenticated;

-- Nome de quem está logado (pros eventos).
create or replace function fin_eu() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from qs_users where id = auth.uid()), 'Sistema');
$$;

-- Enviar ao Financeiro. Qualquer usuário ativo (Comercial, Rel, Ops) manda.
-- Se vier a conversa, ela passa pro Financeiro na hora.
create or replace function fin_enviar(
  p_origem text, p_motivo text, p_descricao text,
  p_cliente uuid default null, p_lead uuid default null, p_conversa uuid default null,
  p_nome text default null, p_telefone text default null, p_prioridade text default 'normal'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nome text := coalesce(nullif(trim(p_nome), ''), ''); v_fone text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if not exists (select 1 from qs_users where id = auth.uid() and is_active) then raise exception 'Sem acesso.'; end if;
  if p_cliente is null and p_lead is null and p_conversa is null and v_fone is null then
    raise exception 'Diga quem é o cliente (ficha, lead, conversa ou telefone).';
  end if;
  -- Completa nome/telefone pelo que veio.
  if p_cliente is not null then
    select coalesce(nullif(v_nome, ''), nome), coalesce(v_fone, telefone) into v_nome, v_fone from rel_clientes where id = p_cliente;
  end if;
  if p_lead is not null then
    select coalesce(nullif(v_nome, ''), full_name, trim(concat_ws(' ', first_name, last_name))), coalesce(v_fone, regexp_replace(coalesce(phone, ''), '\D', '', 'g')) into v_nome, v_fone from qs_leads where id = p_lead;
  end if;
  if p_conversa is not null then
    select coalesce(nullif(v_nome, ''), coalesce(cl.nome, c.nome_contato, c.telefone)), coalesce(v_fone, c.telefone), coalesce(p_cliente, c.cliente_id)
      into v_nome, v_fone, p_cliente
      from rel_wa_conversas c left join rel_clientes cl on cl.id = c.cliente_id where c.id = p_conversa;
  end if;
  -- Já tem atendimento aberto pra esse cliente? Junta (não abre dois).
  select id into v_id from fin_atendimentos
   where status not in ('resolvido','cancelado')
     and ((p_cliente is not null and cliente_id = p_cliente) or (p_lead is not null and lead_id = p_lead)
          or (p_conversa is not null and conversa_id = p_conversa) or (v_fone is not null and telefone = v_fone))
   order by criado_em desc limit 1;
  if v_id is not null then
    insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome)
      values (v_id, 'nota', format('Enviado de novo (%s): %s', p_origem, coalesce(nullif(trim(p_descricao), ''), p_motivo)), fin_eu());
    update fin_atendimentos set atualizado_em = now(),
           conversa_id = coalesce(conversa_id, p_conversa), cliente_id = coalesce(cliente_id, p_cliente), lead_id = coalesce(lead_id, p_lead)
     where id = v_id;
  else
    insert into fin_atendimentos (cliente_id, lead_id, conversa_id, nome, telefone, motivo, descricao, origem, enviado_por, prioridade)
      values (p_cliente, p_lead, p_conversa, coalesce(v_nome, ''), v_fone, coalesce(p_motivo, 'duvida'), coalesce(p_descricao, ''), p_origem, auth.uid(), coalesce(p_prioridade, 'normal'))
      returning id into v_id;
    insert into fin_atendimento_eventos (atendimento_id, tipo, para, texto, autor_nome)
      values (v_id, 'criado', 'novo', nullif(trim(p_descricao), ''), fin_eu());
  end if;
  if p_conversa is not null then
    update rel_wa_conversas set setor = 'financeiro', setor_desde = now(), atendente_id = null where id = p_conversa and setor <> 'financeiro';
  end if;
  return v_id;
end $$;
grant execute on function fin_enviar(text, text, text, uuid, uuid, uuid, text, text, text) to authenticated;

-- Mudar status / assumir / anotar / ligar a conversa / devolver: só o Financeiro.
create or replace function fin_mudar(p_id uuid, p_status text default null, p_nota text default null, p_assumir boolean default false, p_resolucao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a fin_atendimentos;
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro muda o atendimento.'; end if;
  select * into a from fin_atendimentos where id = p_id for update;
  if a.id is null then raise exception 'Atendimento não encontrado.'; end if;
  if p_assumir and a.responsavel_id is distinct from auth.uid() then
    update fin_atendimentos set responsavel_id = auth.uid(), atualizado_em = now(),
           status = case when status = 'novo' then 'em_atendimento' else status end where id = p_id;
    insert into fin_atendimento_eventos (atendimento_id, tipo, para, autor_nome) values (p_id, 'responsavel', fin_eu(), fin_eu());
    if a.conversa_id is not null then update rel_wa_conversas set atendente_id = auth.uid() where id = a.conversa_id and setor = 'financeiro'; end if;
    select * into a from fin_atendimentos where id = p_id;
  end if;
  if p_status is not null and p_status <> a.status then
    if p_status not in ('novo','em_atendimento','aguardando_cliente','resolvido','cancelado') then raise exception 'Status inválido.'; end if;
    update fin_atendimentos set status = p_status, atualizado_em = now(),
           resolvido_em = case when p_status in ('resolvido','cancelado') then now() else null end,
           resolucao = coalesce(nullif(trim(p_resolucao), ''), resolucao),
           responsavel_id = coalesce(responsavel_id, auth.uid())
     where id = p_id;
    insert into fin_atendimento_eventos (atendimento_id, tipo, de, para, texto, autor_nome)
      values (p_id, 'status', a.status, p_status, nullif(trim(coalesce(p_resolucao, '')), ''), fin_eu());
  end if;
  if nullif(trim(coalesce(p_nota, '')), '') is not null then
    insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome) values (p_id, 'nota', trim(p_nota), fin_eu());
    update fin_atendimentos set atualizado_em = now() where id = p_id;
  end if;
end $$;
grant execute on function fin_mudar(uuid, text, text, boolean, text) to authenticated;

-- Liga a conversa ao atendimento (ex.: o Financeiro mandou o 1º modelo pra um
-- lead do Comercial e a conversa nasceu agora) e puxa ela pro Financeiro.
create or replace function fin_ligar_conversa(p_id uuid, p_conversa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro.'; end if;
  update fin_atendimentos set conversa_id = p_conversa, atualizado_em = now() where id = p_id;
  update rel_wa_conversas set setor = 'financeiro', setor_desde = now(), atendente_id = coalesce(atendente_id, auth.uid()) where id = p_conversa;
  insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome) values (p_id, 'conversa', 'Conversa do WhatsApp ligada', fin_eu());
end $$;
grant execute on function fin_ligar_conversa(uuid, uuid) to authenticated;

-- Devolve a conversa ao Relacionamento (o atendimento pode continuar aberto).
create or replace function fin_devolver_conversa(p_conversa uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_at uuid;
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro devolve.'; end if;
  update rel_wa_conversas set setor = 'relacionamento', setor_desde = now(), atendente_id = null where id = p_conversa and setor = 'financeiro';
  for v_at in select id from fin_atendimentos where conversa_id = p_conversa and status not in ('resolvido','cancelado') loop
    insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome)
      values (v_at, 'devolvido', coalesce(nullif(trim(p_nota), ''), 'Conversa devolvida ao Relacionamento'), fin_eu());
  end loop;
end $$;
grant execute on function fin_devolver_conversa(uuid, text) to authenticated;

-- ── 3. A fila com o setor ──────────────────────────────────────────────────
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
       coalesce((select array_agg(lc.lista_id) from rel_wa_lista_conversas lc where lc.conversa_id = c.id), '{}') AS listas,
       c.setor,
       c.setor_desde
  from rel_wa_conversas c
  left join rel_clientes cl on cl.id = c.cliente_id
  left join qs_users u      on u.id  = c.atendente_id
  left join rel_wa_conversa_usuario cu on cu.conversa_id = c.id and cu.user_id = auth.uid();
grant select on rel_wa_fila to authenticated;
