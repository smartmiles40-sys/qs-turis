-- =============================================================================
-- 0218 — RELACIONAMENTO QUE VENDE + AUTOMAÇÕES QUE FUNCIONAM (28/10/2026)
-- =============================================================================
-- Decisões do Bruno:
--   • "O botão recompra não deve existir para mandar para o SDR: o cliente fica
--     100% com o Relacionamento e não volta para o Comercial." → a recompra vira
--     OPORTUNIDADE no pipeline do próprio Rel (a rota api/rel-recompra responde
--     410; o histórico de rel_recompras fica como está).
--   • Pipeline de vendas do Rel, com "hunters" vendendo pra base:
--       Oportunidade → Contato feito → Proposta enviada → Negociação → Ganho / Perdido
--     Cartão ligado à pessoa (rel_clientes) e, se quiser, à viagem (rel_viagens).
--   • Metas: NÃO agora. Só os números prontos (rel_vendas_numeros) pra virar KPI.
--   • Automações (mensagens automáticas): canal WhatsApp oficial (modelo) OU
--     tarefa pro atendente mandar à mão; MODO SIMULAÇÃO por padrão (registra a
--     mensagem na fila, não envia).
--
-- O que tem aqui:
--   1. rel_oportunidades + rel_oportunidade_eventos (histórico automático)
--   2. rel_rotinas_config (1 linha): origens automáticas ligáveis + chave do
--      envio real das automações (nasce DESLIGADA)
--   3. Permissão de cargo 'relacionamento.hunter' (quem recebe as oportunidades
--      automáticas no rodízio)
--   4. rel_oportunidades_gerar(): cria as oportunidades das origens ligadas
--      (voltou de viagem / embarca sem seguro / aniversário) — cron diário
--   5. rel_oportunidades_lembretes(): "próxima ação" vencendo → sino do dono
--   6. rel_vendas_numeros(): ganhos, valor e conversão por pessoa (futuro KPI)
--   7. Automações: canal, texto da tarefa, corpo do modelo, fila com status
--      'simulado' e 'tarefa'; rel_envio_tarefa_feita()
--
-- Idempotente (pode rodar de novo). Rollback no fim, comentado.
-- =============================================================================


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. PIPELINE
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists rel_oportunidades (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references rel_clientes(id) on delete cascade,
  viagem_id       uuid references rel_viagens(id) on delete set null,
  titulo          text not null,
  etapa           text not null default 'oportunidade'
                    check (etapa in ('oportunidade', 'contato', 'proposta', 'negociacao', 'ganho', 'perdido')),
  dono_id         uuid references qs_users(id) on delete set null,
  -- mesmo catálogo das propostas (src/propostas/lib.ts → TIPOS)
  produto         text check (produto is null or produto in ('aereo', 'hospedagem', 'transfer', 'trem', 'passeio', 'seguro',
                    'carro', 'cruzeiro', 'visto', 'pacote', 'expedicao', 'concierge', 'outro')),
  valor_estimado  numeric(12, 2),
  valor_ganho     numeric(12, 2),
  -- de onde veio: à mão, da lista de recompra, ou das origens automáticas
  origem          text not null default 'manual'
                    check (origem in ('manual', 'recompra', 'volta_viagem', 'sem_seguro', 'aniversario', 'pesquisa')),
  -- trava das origens automáticas: a mesma oportunidade nunca nasce duas vezes
  -- ('volta:<viagem>', 'seguro:<viagem>', 'aniv:<cliente>:<ano>')
  origem_chave    text unique,
  proxima_acao    text,
  proxima_acao_em timestamptz,
  motivo_perda    text,
  proposta_id     uuid references qs_propostas(id) on delete set null,
  etapa_em        timestamptz not null default now(),
  ganho_em        timestamptz,
  perdido_em      timestamptz,
  criado_por      uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  -- perdeu? diga o motivo (vira o relatório "por que perdemos")
  constraint rel_oportunidades_perdido_tem_motivo check (etapa <> 'perdido' or nullif(btrim(motivo_perda), '') is not null)
);
create index if not exists rel_oportunidades_etapa_idx   on rel_oportunidades (etapa, dono_id);
create index if not exists rel_oportunidades_cliente_idx on rel_oportunidades (cliente_id);
create index if not exists rel_oportunidades_acao_idx    on rel_oportunidades (proxima_acao_em)
  where etapa not in ('ganho', 'perdido');

-- Histórico do cartão: o banco escreve sozinho (criada, etapa, dono, próxima
-- ação); nota é a pessoa que escreve.
create table if not exists rel_oportunidade_eventos (
  id              bigint generated always as identity primary key,
  oportunidade_id uuid not null references rel_oportunidades(id) on delete cascade,
  tipo            text not null check (tipo in ('criada', 'etapa', 'dono', 'acao', 'nota', 'proposta', 'valor')),
  texto           text,
  autor_id        uuid default auth.uid() references qs_users(id) on delete set null,
  criado_em       timestamptz not null default now()
);
create index if not exists rel_oportunidade_eventos_op_idx on rel_oportunidade_eventos (oportunidade_id, criado_em desc);

-- Datas automáticas (etapa_em, ganho_em, perdido_em, atualizado_em)
create or replace function rel_oportunidades_antes() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    new.etapa_em := now();
    new.ganho_em := case when new.etapa = 'ganho' then now() else null end;
    new.perdido_em := case when new.etapa = 'perdido' then now() else null end;
    if new.etapa <> 'perdido' then new.motivo_perda := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists rel_oportunidades_antes on rel_oportunidades;
create trigger rel_oportunidades_antes before insert or update on rel_oportunidades
  for each row execute function rel_oportunidades_antes();

-- Histórico automático
create or replace function rel_oportunidades_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rot jsonb := '{"oportunidade":"Oportunidade","contato":"Contato feito","proposta":"Proposta enviada","negociacao":"Negociação","ganho":"Ganho","perdido":"Perdido"}';
  nome_dono text;
begin
  if tg_op = 'INSERT' then
    insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
    values (new.id, 'criada',
            case new.origem when 'manual' then 'Criada à mão' when 'recompra' then 'Criada pela lista de recompra'
              when 'volta_viagem' then 'Criada sozinha: voltou de viagem e não tem a próxima'
              when 'sem_seguro' then 'Criada sozinha: embarca em breve sem seguro'
              when 'aniversario' then 'Criada sozinha: aniversário chegando'
              else 'Criada' end, auth.uid());
    -- criada à mão já com dono = outra pessoa → avisa essa pessoa
    if auth.uid() is not null and new.dono_id is not null and new.dono_id <> auth.uid() then
      perform qs_aviso_criar(new.dono_id, 'oportunidade', 'relacionamento', 'Oportunidade pra você',
        new.titulo, '#rel/vendas/' || new.id, 'rel_oportunidade', new.id::text, 'opp-dono:' || new.id || ':0');
    end if;
    return new;
  end if;
  if new.etapa is distinct from old.etapa then
    insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
    values (new.id, 'etapa', (rot ->> old.etapa) || ' → ' || (rot ->> new.etapa)
            || case when new.etapa = 'perdido' then ' (' || coalesce(new.motivo_perda, '') || ')' else '' end
            || case when new.etapa = 'ganho' and new.valor_ganho is not null then ' · R$ ' || to_char(new.valor_ganho, 'FM999G999G990D00') else '' end,
            auth.uid());
  end if;
  if new.dono_id is distinct from old.dono_id then
    select split_part(name, ' |', 1) into nome_dono from qs_users where id = new.dono_id;
    insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
    values (new.id, 'dono', coalesce('Passou para ' || nome_dono, 'Ficou sem dono'), auth.uid());
    -- aviso no sino de quem recebeu (não avisa quem pegou pra si mesmo)
    if new.dono_id is not null and new.dono_id is distinct from auth.uid() then
      perform qs_aviso_criar(new.dono_id, 'oportunidade', 'relacionamento', 'Oportunidade pra você',
        new.titulo, '#rel/vendas/' || new.id, 'rel_oportunidade', new.id::text, 'opp-dono:' || new.id || ':' || extract(epoch from now())::bigint);
    end if;
  end if;
  if new.proxima_acao is distinct from old.proxima_acao or new.proxima_acao_em is distinct from old.proxima_acao_em then
    if new.proxima_acao is not null or new.proxima_acao_em is not null then
      insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
      values (new.id, 'acao', 'Próxima ação: ' || coalesce(new.proxima_acao, '—')
              || coalesce(' em ' || to_char(new.proxima_acao_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), ''), auth.uid());
    end if;
  end if;
  if new.proposta_id is distinct from old.proposta_id and new.proposta_id is not null then
    insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
    values (new.id, 'proposta', 'Proposta Nº ' || coalesce((select numero::text from qs_propostas where id = new.proposta_id), '?') || ' ligada', auth.uid());
  end if;
  if new.valor_estimado is distinct from old.valor_estimado and new.valor_estimado is not null then
    insert into rel_oportunidade_eventos (oportunidade_id, tipo, texto, autor_id)
    values (new.id, 'valor', 'Valor estimado: R$ ' || to_char(new.valor_estimado, 'FM999G999G990D00'), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists rel_oportunidades_historico on rel_oportunidades;
create trigger rel_oportunidades_historico after insert or update on rel_oportunidades
  for each row execute function rel_oportunidades_historico();

-- RLS: quem é do Relacionamento lê, cria e mexe; apagar só a supervisão.
alter table rel_oportunidades enable row level security;
alter table rel_oportunidade_eventos enable row level security;
drop policy if exists rel_oportunidades_ler on rel_oportunidades;
drop policy if exists rel_oportunidades_criar on rel_oportunidades;
drop policy if exists rel_oportunidades_mudar on rel_oportunidades;
drop policy if exists rel_oportunidades_apagar on rel_oportunidades;
create policy rel_oportunidades_ler    on rel_oportunidades for select to authenticated using (rel_tem_acesso());
create policy rel_oportunidades_criar  on rel_oportunidades for insert to authenticated with check (rel_tem_acesso());
create policy rel_oportunidades_mudar  on rel_oportunidades for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
create policy rel_oportunidades_apagar on rel_oportunidades for delete to authenticated using (rel_pode_configurar());
drop policy if exists rel_oportunidade_eventos_ler on rel_oportunidade_eventos;
drop policy if exists rel_oportunidade_eventos_nota on rel_oportunidade_eventos;
create policy rel_oportunidade_eventos_ler  on rel_oportunidade_eventos for select to authenticated using (rel_tem_acesso());
-- a pessoa só escreve NOTA, em seu nome; o resto é o gatilho
create policy rel_oportunidade_eventos_nota on rel_oportunidade_eventos for insert to authenticated
  with check (rel_tem_acesso() and tipo = 'nota' and autor_id = auth.uid());
revoke all on rel_oportunidades, rel_oportunidade_eventos from anon;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. CONFIGURAÇÃO (uma linha)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists rel_rotinas_config (
  id                     boolean primary key default true check (id),
  -- origens automáticas de oportunidade; TODAS nascem desligadas
  --   volta_viagem.dias: voltou há pelo menos N dias e não tem a próxima marcada
  --   sem_seguro.dias:   embarca em até N dias sem seguro registrado
  --   aniversario.dias:  faz aniversário nos próximos N dias
  origens                jsonb not null default '{
    "volta_viagem": {"ligado": false, "dias": 30},
    "sem_seguro":   {"ligado": false, "dias": 60},
    "aniversario":  {"ligado": false, "dias": 15}
  }',
  -- teto por origem por dia (o primeiro dia ligado não despeja 200 cartões)
  limite_por_dia         integer not null default 30 check (limite_por_dia between 1 and 500),
  -- automações: FALSE = modo simulação (registra na fila, não envia). Mesmo
  -- TRUE, o servidor só envia com REL_AUTOMACOES_ENVIO_REAL=1 na Vercel.
  automacoes_envio_real  boolean not null default false,
  atualizado_em          timestamptz not null default now(),
  atualizado_por         uuid references qs_users(id) on delete set null
);
insert into rel_rotinas_config (id) values (true) on conflict (id) do nothing;
alter table rel_rotinas_config enable row level security;
drop policy if exists rel_rotinas_config_ler on rel_rotinas_config;
drop policy if exists rel_rotinas_config_mudar on rel_rotinas_config;
create policy rel_rotinas_config_ler   on rel_rotinas_config for select to authenticated using (rel_tem_acesso());
create policy rel_rotinas_config_mudar on rel_rotinas_config for update to authenticated using (rel_pode_configurar()) with check (rel_pode_configurar());
revoke all on rel_rotinas_config from anon;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. PAPEL "HUNTER" — permissão de cargo (0135)
-- ═════════════════════════════════════════════════════════════════════════════
-- Hunter = quem tem um cargo do Relacionamento com 'relacionamento.hunter'
-- marcado (ex.: cargo "Hunter"). Recebe as oportunidades automáticas no rodízio.
-- Admin/gestor NÃO entram no rodízio (qs_pode diria true pra tudo).
-- ATENÇÃO: recria qs_permissoes_padrao() com a lista VIGENTE + a chave nova.
create or replace function qs_permissoes_padrao()
returns table (chave text, padrao boolean)
language sql immutable set search_path = public as $$
  values
    ('relacionamento.modelos',             false),
    ('relacionamento.disparos',            true),
    ('relacionamento.juntar_clientes',     true),
    ('relacionamento.editar_viagens',      true),
    ('relacionamento.agenda_time',         false),
    ('relacionamento.kpis',                true),
    ('relacionamento.conferir_documentos', true),
    ('relacionamento.hunter',              false),
    ('financeiro.status_atividades',       true),
    ('financeiro.ver_valores',             true),
    ('financeiro.modelos',                 false)
$$;

create or replace function rel_hunters()
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select u.id, split_part(u.name, ' |', 1)
    from qs_users u
    join qs_cargos c on c.id = u.cargo_id and c.ativo
   where u.is_active and c.setor = 'relacionamento'
     and 'relacionamento.hunter' = any(c.permissoes)
     and (u.role = 'admin' or 'relacionamento' = any(coalesce(u.setores, '{}')))
   order by u.name;
$$;
revoke all on function rel_hunters() from public, anon;
grant execute on function rel_hunters() to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. ORIGENS AUTOMÁTICAS — cria as oportunidades do dia
-- ═════════════════════════════════════════════════════════════════════════════
-- p_simular = true → só CONTA quantas nasceriam (a tela mostra "prévia").
-- Quem chama: o cron (service_role) ou a supervisão do Rel.
-- Nunca cria pra quem já tem oportunidade ABERTA (mesmo produto, no seguro).
create or replace function rel_oportunidades_gerar(p_simular boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      rel_rotinas_config;
  hoje     date := (now() at time zone 'America/Sao_Paulo')::date;
  hunters  uuid[];
  n_h      int;
  giro     int;
  lim      int;
  d        int;
  r        record;
  c_volta  int := 0;
  c_seguro int := 0;
  c_aniv   int := 0;
  novo     uuid;
  -- quantas recebeu cada dono (1 aviso-resumo por pessoa)
  por_dono jsonb := '{}';
begin
  if auth.uid() is not null and not rel_pode_configurar() then
    raise exception 'sem-acesso';
  end if;
  select * into cfg from rel_rotinas_config where id;
  if cfg.id is null then return jsonb_build_object('erro', 'sem configuração'); end if;
  lim := cfg.limite_por_dia;
  select array_agg(h.id) into hunters from rel_hunters() h;
  n_h := coalesce(array_length(hunters, 1), 0);
  select count(*) into giro from rel_oportunidades where origem in ('volta_viagem', 'sem_seguro', 'aniversario');

  -- ── a) voltou de viagem há ≥ N dias (até ~13 meses) e não tem a próxima ──
  if coalesce((cfg.origens -> 'volta_viagem' ->> 'ligado')::boolean, false) then
    d := greatest(coalesce((cfg.origens -> 'volta_viagem' ->> 'dias')::int, 30), 1);
    for r in
      select x.* from (
        select distinct on (v.cliente_id) v.id as viagem_id, v.cliente_id, v.titulo,
               coalesce(v.data_retorno, v.data_embarque) as volta, v.servico
          from rel_viagens_v v
          join rel_clientes c on c.id = v.cliente_id
         where v.status = 'ativa' and v.acompanhamento <> 'nenhum'
           and c.mesclado_em_id is null
           and coalesce(v.data_retorno, v.data_embarque) < hoje
         order by v.cliente_id, coalesce(v.data_retorno, v.data_embarque) desc
      ) x
       where x.volta between hoje - 400 and hoje - d
         and not exists (select 1 from rel_viagem_passageiros p join rel_viagens f on f.id = p.viagem_id
                          where p.cliente_id = x.cliente_id and f.status = 'ativa' and f.data_embarque >= hoje)
         and not exists (select 1 from rel_oportunidades o where o.cliente_id = x.cliente_id and o.etapa not in ('ganho', 'perdido'))
         and not exists (select 1 from rel_oportunidades o where o.origem_chave = 'volta:' || x.viagem_id)
       order by x.volta desc
       limit lim
    loop
      c_volta := c_volta + 1;
      if not p_simular then
        insert into rel_oportunidades (cliente_id, viagem_id, titulo, origem, origem_chave, dono_id, proxima_acao, proxima_acao_em, criado_por)
        values (r.cliente_id, r.viagem_id, 'Próxima viagem (voltou de ' || r.titulo || ')', 'volta_viagem', 'volta:' || r.viagem_id,
                case when n_h > 0 then hunters[1 + (giro % n_h)] end,
                'Ligar e perguntar como foi a viagem e qual o próximo sonho', (hoje + 1 + time '10:00') at time zone 'America/Sao_Paulo', null)
        on conflict (origem_chave) do nothing returning id into novo;
        if novo is not null then giro := giro + 1; end if;
      end if;
    end loop;
  end if;

  -- ── b) embarca em até N dias sem seguro registrado ──
  -- "Seguro registrado" = uma venda de seguro (serviço 'seguro', 0148) de algum
  -- passageiro desta viagem com embarque perto, OU componente 'seguro' na viagem.
  if coalesce((cfg.origens -> 'sem_seguro' ->> 'ligado')::boolean, false) then
    d := greatest(coalesce((cfg.origens -> 'sem_seguro' ->> 'dias')::int, 60), 1);
    for r in
      select v.id as viagem_id, v.cliente_id, v.titulo, v.data_embarque
        from rel_viagens_v v
        join rel_clientes c on c.id = v.cliente_id
       where v.status = 'ativa' and v.acompanhamento in ('completo', 'leve', 'expedicao')
         and c.mesclado_em_id is null
         and v.data_embarque between hoje and hoje + d
         and not exists (select 1 from rel_viagem_componentes k where k.viagem_id = v.id and k.tipo = 'seguro')
         and not exists (
               select 1 from rel_viagem_passageiros p
                 join rel_viagem_passageiros p2 on p2.cliente_id = p.cliente_id and p2.viagem_id <> v.id
                 join rel_viagens_v s on s.id = p2.viagem_id
                where p.viagem_id = v.id and s.servico = 'seguro' and s.status = 'ativa'
                  and s.data_embarque between v.data_embarque - 30 and coalesce(v.data_retorno, v.data_embarque) + 5)
         and not exists (select 1 from rel_oportunidades o where o.cliente_id = v.cliente_id and o.produto = 'seguro' and o.etapa not in ('ganho', 'perdido'))
         and not exists (select 1 from rel_oportunidades o where o.origem_chave = 'seguro:' || v.id)
       order by v.data_embarque
       limit lim
    loop
      c_seguro := c_seguro + 1;
      if not p_simular then
        insert into rel_oportunidades (cliente_id, viagem_id, titulo, produto, origem, origem_chave, dono_id, proxima_acao, proxima_acao_em, criado_por)
        values (r.cliente_id, r.viagem_id, 'Seguro viagem — ' || r.titulo, 'seguro', 'sem_seguro', 'seguro:' || r.viagem_id,
                case when n_h > 0 then hunters[1 + (giro % n_h)] end,
                'Oferecer seguro viagem (embarque ' || to_char(r.data_embarque, 'DD/MM') || ')',
                (hoje + 1 + time '10:00') at time zone 'America/Sao_Paulo', null)
        on conflict (origem_chave) do nothing returning id into novo;
        if novo is not null then giro := giro + 1; end if;
      end if;
    end loop;
  end if;

  -- ── c) aniversário nos próximos N dias (quem já viajou com a gente) ──
  if coalesce((cfg.origens -> 'aniversario' ->> 'ligado')::boolean, false) then
    d := least(greatest(coalesce((cfg.origens -> 'aniversario' ->> 'dias')::int, 15), 0), 60);
    for r in
      select c.id as cliente_id, c.nome, c.nascimento
        from rel_clientes c
       where c.mesclado_em_id is null and c.nascimento is not null
         and exists (select 1 from rel_viagem_passageiros p where p.cliente_id = c.id)
         and exists (select 1 from generate_series(0, d) g(i)
                      where to_char(hoje + g.i, 'MM-DD') = to_char(c.nascimento, 'MM-DD')
                         or (to_char(c.nascimento, 'MM-DD') = '02-29' and to_char(hoje + g.i, 'MM-DD') = '02-28'))
         and not exists (select 1 from rel_oportunidades o where o.cliente_id = c.id and o.etapa not in ('ganho', 'perdido'))
         and not exists (select 1 from rel_oportunidades o where o.origem_chave = 'aniv:' || c.id || ':' || extract(year from hoje + d)::int)
       limit lim
    loop
      c_aniv := c_aniv + 1;
      if not p_simular then
        insert into rel_oportunidades (cliente_id, titulo, origem, origem_chave, dono_id, proxima_acao, proxima_acao_em, criado_por)
        values (r.cliente_id, 'Aniversário de ' || split_part(r.nome, ' ', 1) || ' (' || to_char(r.nascimento, 'DD/MM') || ')',
                'aniversario', 'aniv:' || r.cliente_id || ':' || extract(year from hoje + d)::int,
                case when n_h > 0 then hunters[1 + (giro % n_h)] end,
                'Parabenizar e lembrar de uma viagem de presente', (hoje + 1 + time '10:00') at time zone 'America/Sao_Paulo', null)
        on conflict (origem_chave) do nothing returning id into novo;
        if novo is not null then giro := giro + 1; end if;
      end if;
    end loop;
  end if;

  -- Um aviso-resumo por hunter por dia (os cartões automáticos nascem sem
  -- "passou pra você" individual: criado_por null e sem UPDATE de dono).
  if not p_simular and n_h > 0 then
    for r in
      select dono_id, count(*) n from rel_oportunidades
       where origem in ('volta_viagem', 'sem_seguro', 'aniversario') and criado_em::date = now()::date and dono_id is not null
       group by dono_id
    loop
      perform qs_aviso_criar(r.dono_id, 'oportunidade', 'relacionamento',
        r.n || ' oportunidade' || case when r.n > 1 then 's' else '' end || ' nova' || case when r.n > 1 then 's' else '' end || ' no pipeline',
        'Clientes da base pra você vender hoje.', '#rel/vendas', 'rel_oportunidades', null, 'opp-dia:' || hoje);
    end loop;
  end if;

  return jsonb_build_object('volta_viagem', c_volta, 'sem_seguro', c_seguro, 'aniversario', c_aniv,
                            'hunters', n_h, 'simulado', p_simular);
end $$;
revoke all on function rel_oportunidades_gerar(boolean) from public, anon;
grant execute on function rel_oportunidades_gerar(boolean) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. LEMBRETE DA PRÓXIMA AÇÃO → sino do dono (cron a cada hora)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function rel_oportunidades_lembretes()
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select o.id, o.dono_id, o.proxima_acao, o.proxima_acao_em, c.nome
      from rel_oportunidades o join rel_clientes c on c.id = o.cliente_id
     where o.etapa not in ('ganho', 'perdido') and o.dono_id is not null
       and o.proxima_acao_em is not null
       and o.proxima_acao_em <= now() + interval '1 hour'
       and o.proxima_acao_em >= now() - interval '2 days'
  loop
    perform qs_aviso_criar(r.dono_id, 'oportunidade', 'relacionamento',
      'Próxima ação: ' || r.nome, coalesce(r.proxima_acao, 'Retomar a oportunidade'),
      '#rel/vendas/' || r.id, 'rel_oportunidade', r.id::text,
      'opp-acao:' || r.id || ':' || extract(epoch from r.proxima_acao_em)::bigint);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function rel_oportunidades_lembretes() from public, anon, authenticated;
grant execute on function rel_oportunidades_lembretes() to service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. NÚMEROS DO PIPELINE (por pessoa) — base dos KPIs/metas que virão
-- ═════════════════════════════════════════════════════════════════════════════
-- Período = oportunidades CRIADAS no período (conversão de safra) + ganhos e
-- valor GANHO no período (pela data do ganho). Security invoker: vale a RLS.
create or replace function rel_vendas_numeros(p_de date, p_ate date)
returns table (dono_id uuid, dono_nome text, criadas bigint, abertas bigint, ganhas bigint, perdidas bigint,
               valor_ganho numeric, valor_aberto numeric, conversao numeric)
language sql stable set search_path = public as $$
  with o as (
    select * from rel_oportunidades
     where (criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
        or (ganho_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
        or etapa not in ('ganho', 'perdido')
  )
  select o.dono_id, coalesce(split_part(u.name, ' |', 1), 'Sem dono'),
         count(*) filter (where (o.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate),
         count(*) filter (where o.etapa not in ('ganho', 'perdido')),
         count(*) filter (where o.etapa = 'ganho' and (o.ganho_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate),
         count(*) filter (where o.etapa = 'perdido' and (o.perdido_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate),
         coalesce(sum(coalesce(o.valor_ganho, o.valor_estimado)) filter (where o.etapa = 'ganho' and (o.ganho_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate), 0),
         coalesce(sum(o.valor_estimado) filter (where o.etapa not in ('ganho', 'perdido')), 0),
         -- conversão = ganhas / (ganhas + perdidas) decididas no período
         case when count(*) filter (where o.etapa in ('ganho', 'perdido') and (coalesce(o.ganho_em, o.perdido_em) at time zone 'America/Sao_Paulo')::date between p_de and p_ate) = 0 then null
              else round(count(*) filter (where o.etapa = 'ganho' and (o.ganho_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate)::numeric
                   / count(*) filter (where o.etapa in ('ganho', 'perdido') and (coalesce(o.ganho_em, o.perdido_em) at time zone 'America/Sao_Paulo')::date between p_de and p_ate), 4) end
    from o left join qs_users u on u.id = o.dono_id
   group by o.dono_id, u.name
   order by 7 desc, 2;
$$;
revoke all on function rel_vendas_numeros(date, date) from public, anon;
grant execute on function rel_vendas_numeros(date, date) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. AUTOMAÇÕES: canal, tarefa, simulação
-- ═════════════════════════════════════════════════════════════════════════════
-- canal 'whatsapp' = modelo aprovado da Meta (modelo_nome/idioma/params);
-- canal 'tarefa'   = a mensagem pronta (texto, com {nome}, {destino}…) vira
--                    tarefa no sino de quem cuida da viagem (ou tarefa_para).
alter table rel_automacoes add column if not exists canal text not null default 'whatsapp';
alter table rel_automacoes drop constraint if exists rel_automacoes_canal_check;
alter table rel_automacoes add constraint rel_automacoes_canal_check check (canal in ('whatsapp', 'tarefa'));
alter table rel_automacoes add column if not exists texto text;
-- corpo do modelo guardado ao salvar: a simulação monta a prévia SEM ir à Meta
alter table rel_automacoes add column if not exists modelo_corpo text;
alter table rel_automacoes add column if not exists tarefa_para uuid references qs_users(id) on delete set null;

-- Fila: 'simulado' (modo simulação: registrado, NÃO enviado) e 'tarefa'
-- (esperando a atendente mandar à mão). O texto montado fica na linha.
alter table rel_envios drop constraint if exists rel_envios_status_check;
alter table rel_envios add constraint rel_envios_status_check
  check (status in ('pendente', 'enviado', 'falhou', 'pulado', 'simulado', 'tarefa'));
alter table rel_envios add column if not exists texto text;
alter table rel_envios add column if not exists responsavel_id uuid references qs_users(id) on delete set null;
alter table rel_envios add column if not exists feito_por uuid references qs_users(id) on delete set null;
create index if not exists rel_envios_automacao_idx on rel_envios (automacao_id, criado_em desc);

-- "Mandei": a atendente marca a tarefa como feita (a tela não escreve em rel_envios).
create or replace function rel_envio_tarefa_feita(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rel_tem_acesso() then raise exception 'sem-acesso'; end if;
  update rel_envios set status = 'enviado', enviado_em = now(), feito_por = auth.uid(),
         motivo = 'mandado à mão'
   where id = p_id and status = 'tarefa';
end $$;
revoke all on function rel_envio_tarefa_feita(uuid) from public, anon;
grant execute on function rel_envio_tarefa_feita(uuid) to authenticated;


-- =============================================================================
-- ROLLBACK (rodar à mão, nesta ordem, se precisar desfazer):
-- -----------------------------------------------------------------------------
-- drop function if exists rel_envio_tarefa_feita(uuid);
-- drop index if exists rel_envios_automacao_idx;
-- update rel_envios set status = 'pulado', motivo = coalesce(motivo, 'simulação') where status in ('simulado', 'tarefa');
-- alter table rel_envios drop constraint if exists rel_envios_status_check;
-- alter table rel_envios add constraint rel_envios_status_check check (status in ('pendente', 'enviado', 'falhou', 'pulado'));
-- alter table rel_envios drop column if exists texto, drop column if exists responsavel_id, drop column if exists feito_por;
-- delete from rel_automacoes where canal = 'tarefa';
-- alter table rel_automacoes drop constraint if exists rel_automacoes_canal_check;
-- alter table rel_automacoes drop column if exists canal, drop column if exists texto,
--   drop column if exists modelo_corpo, drop column if exists tarefa_para;
-- drop function if exists rel_vendas_numeros(date, date);
-- drop function if exists rel_oportunidades_lembretes();
-- drop function if exists rel_oportunidades_gerar(boolean);
-- drop function if exists rel_hunters();
-- (qs_permissoes_padrao: recriar sem a linha 'relacionamento.hunter')
-- drop table if exists rel_rotinas_config;
-- drop table if exists rel_oportunidade_eventos;
-- drop table if exists rel_oportunidades;
-- drop function if exists rel_oportunidades_historico();
-- drop function if exists rel_oportunidades_antes();
-- =============================================================================
