-- 0184 — Relacionamento: DONO da viagem, filas em lote e PREFERÊNCIAS do cliente
-- (22/10/2026, "finalizar o Rel pra o time usar de verdade").
--
-- O que estava medido: 38 pacotes/aéreos embarcando em 120 dias, TODOS sem
-- responsável; ZERO etapas da Esteira concluídas desde 16/10; 37 sem nenhuma
-- necessidade anotada; 195 vendas "classificar"; 424 sem data de embarque.
-- O time conversa no WhatsApp mas não opera a viagem no sistema.
--
-- Esta migration dá as ferramentas:
--   1) rel_viagem_eventos — o histórico do que o time decidiu na viagem
--      (quem virou dono, serviço escolhido, arquivada/desarquivada). Só se
--      escreve pelas funções abaixo; o time lê.
--   2) rel_atribuir_viagens(ids, pessoa) — "Assumir" / "Atribuir a…".
--      Uma viagem: qualquer um do Rel que edita viagens. Várias (lote): gestor(a).
--   3) rel_classificar_viagens(ids, servico) — a fila Classificar em lote.
--   4) rel_arquivar_viagens(ids, motivo) → lote; rel_desarquivar_viagens(lote | ids)
--      — a fila "Sem data" em lote, com motivo e DESFAZER (gestor/a).
--   5) rel_viagens.preferencias (jsonb): gostos, alergias, restrições, ocasião
--      especial… e o alerta "faltam preferências" pra quem embarca em até 30 dias.
--
-- Nada aqui mexe em dados existentes: só acrescenta colunas, tabela, funções e
-- uma linha nova na view de alertas. Rodar a migration NÃO arquiva nem atribui nada.

-- ── 1) colunas novas ────────────────────────────────────────────────────────
alter table rel_viagens
  add column if not exists preferencias jsonb not null default '{}'::jsonb,
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por uuid references qs_users(id) on delete set null,
  add column if not exists arquivado_motivo text,
  add column if not exists arquivado_lote uuid;

create index if not exists rel_viagens_arquivado_lote_idx on rel_viagens (arquivado_lote) where arquivado_lote is not null;
create index if not exists rel_viagens_responsavel_idx on rel_viagens (responsavel_id) where status = 'ativa';

comment on column rel_viagens.preferencias is
  '0184: {gostos, alergias, restricoes, ocasiao, ocasiao_data, outros, nada_a_registrar, por, em} — preenchido no card da viagem';

-- ── 2) histórico ────────────────────────────────────────────────────────────
create table if not exists rel_viagem_eventos (
  id bigint generated always as identity primary key,
  viagem_id uuid not null references rel_viagens(id) on delete cascade,
  tipo text not null check (tipo in ('dono', 'servico', 'arquivada', 'desarquivada')),
  de text,
  para text,
  motivo text,
  lote uuid,
  por uuid references qs_users(id) on delete set null,
  em timestamptz not null default now()
);
create index if not exists rel_viagem_eventos_viagem_idx on rel_viagem_eventos (viagem_id, em desc);

alter table rel_viagem_eventos enable row level security;
drop policy if exists rel_viagem_eventos_ler on rel_viagem_eventos;
create policy rel_viagem_eventos_ler on rel_viagem_eventos for select to authenticated using (rel_tem_acesso());
-- sem policy de escrita: só as funções SECURITY DEFINER abaixo gravam
revoke all on rel_viagem_eventos from anon, public;
grant select on rel_viagem_eventos to authenticated;

-- ── 3) dono da viagem ───────────────────────────────────────────────────────
create or replace function rel_atribuir_viagens(p_ids uuid[], p_responsavel uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_n integer;
begin
  if v_eu is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão para mudar o responsável das viagens.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'No máximo 500 viagens por vez.'; end if;
  -- várias de uma vez é coisa da gestão; uma por vez ("Assumir", "Atribuir a…") qualquer um do time
  if array_length(p_ids, 1) > 1 and not rel_pode_configurar() then
    raise exception 'Atribuir em lote é só para a gestão do Relacionamento.';
  end if;
  if p_responsavel is not null and not exists (
    select 1 from qs_users u where u.id = p_responsavel and u.is_active
       and (u.role in ('admin', 'relacionamento') or 'relacionamento' = any(u.setores))
  ) then
    raise exception 'Essa pessoa não é do Relacionamento.';
  end if;

  with alvo as (
    select v.id, v.responsavel_id as antes from rel_viagens v
     where v.id = any(p_ids) and v.responsavel_id is distinct from p_responsavel
     for update
  ), mudou as (
    update rel_viagens v set responsavel_id = p_responsavel, atualizado_em = now()
      from alvo where v.id = alvo.id
    returning v.id, alvo.antes
  ), ev as (
    insert into rel_viagem_eventos (viagem_id, tipo, de, para, por)
    select m.id, 'dono', m.antes::text, p_responsavel::text, v_eu from mudou m
    returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;

-- ── 4) fila Classificar em lote ─────────────────────────────────────────────
create or replace function rel_classificar_viagens(p_ids uuid[], p_servico text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_n integer;
begin
  if v_eu is null or not rel_tem_acesso() or not qs_pode('relacionamento.editar_viagens') then
    raise exception 'Sem permissão para classificar viagens.';
  end if;
  if p_servico is not null and p_servico not in ('expedicao','pacote','aereo','hospedagem','passeio','cruzeiro','seguro','concierge','conta_liminar','outro') then
    raise exception 'Serviço inválido.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'No máximo 500 viagens por vez.'; end if;

  with alvo as (
    select v.id, coalesce(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)) as antes
      from rel_viagens v where v.id = any(p_ids) for update
  ), mudou as (
    update rel_viagens v set servico_manual = p_servico,
           servico_por = case when p_servico is null then null else v_eu end,
           servico_em  = case when p_servico is null then null else now() end,
           atualizado_em = now()
      from alvo where v.id = alvo.id
    returning v.id, alvo.antes
  ), ev as (
    insert into rel_viagem_eventos (viagem_id, tipo, de, para, por)
    select m.id, 'servico', m.antes, p_servico, v_eu from mudou m
    returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;

-- ── 5) fila Sem data: arquivar em lote, com motivo e desfazer ──────────────
create or replace function rel_arquivar_viagens(p_ids uuid[], p_motivo text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_lote uuid := gen_random_uuid();
  v_n integer;
begin
  if v_eu is null or not rel_pode_configurar() then
    raise exception 'Arquivar viagens é só para a gestão do Relacionamento.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo do arquivamento.'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return null; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'No máximo 500 viagens por vez.'; end if;

  with mudou as (
    update rel_viagens v set status = 'arquivada', arquivado_em = now(), arquivado_por = v_eu,
           arquivado_motivo = trim(p_motivo), arquivado_lote = v_lote, atualizado_em = now()
     where v.id = any(p_ids) and v.status = 'ativa'
    returning v.id
  ), ev as (
    insert into rel_viagem_eventos (viagem_id, tipo, de, para, motivo, lote, por)
    select m.id, 'arquivada', 'ativa', 'arquivada', trim(p_motivo), v_lote, v_eu from mudou m
    returning 1
  )
  select count(*) into v_n from ev;
  return case when v_n > 0 then v_lote else null end;
end $$;

-- Desfaz um lote inteiro (p_lote) ou viagens soltas (p_ids). Só volta o que
-- ainda está arquivada — se o Bitrix cancelou nesse meio-tempo, fica cancelada.
create or replace function rel_desarquivar_viagens(p_lote uuid default null, p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_eu uuid := auth.uid();
  v_n integer;
begin
  if v_eu is null or not rel_pode_configurar() then
    raise exception 'Desarquivar viagens é só para a gestão do Relacionamento.';
  end if;
  if p_lote is null and coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;

  with mudou as (
    update rel_viagens v set status = 'ativa', arquivado_em = null, arquivado_por = null,
           arquivado_motivo = null, arquivado_lote = null, atualizado_em = now()
     where v.status = 'arquivada'
       and ((p_lote is not null and v.arquivado_lote = p_lote) or (p_ids is not null and v.id = any(p_ids)))
    returning v.id
  ), ev as (
    insert into rel_viagem_eventos (viagem_id, tipo, de, para, lote, por)
    select m.id, 'desarquivada', 'arquivada', 'ativa', p_lote, v_eu from mudou m
    returning 1
  )
  select count(*) into v_n from ev;
  return v_n;
end $$;

revoke all on function rel_atribuir_viagens(uuid[], uuid) from public, anon;
revoke all on function rel_classificar_viagens(uuid[], text) from public, anon;
revoke all on function rel_arquivar_viagens(uuid[], text) from public, anon;
revoke all on function rel_desarquivar_viagens(uuid, uuid[]) from public, anon;
grant execute on function rel_atribuir_viagens(uuid[], uuid) to authenticated;
grant execute on function rel_classificar_viagens(uuid[], text) to authenticated;
grant execute on function rel_arquivar_viagens(uuid[], text) to authenticated;
grant execute on function rel_desarquivar_viagens(uuid, uuid[]) to authenticated;

-- ── 6) preferências: vazio? ─────────────────────────────────────────────────
-- Vazio = nenhum dos campos de texto preenchido, sem "nada a registrar" e sem a
-- "necessidade especial" antiga (texto livre que vem do Bitrix).
create or replace function rel_preferencias_vazias(p jsonb, p_necessidades text)
returns boolean language sql immutable set search_path = public as $$
  -- compara como jsonb (sem ::boolean): um valor torto gravado pela tela não derruba a view de alertas inteira
  select coalesce(p->'nada_a_registrar' = 'true'::jsonb, false) is false
     and length(trim(coalesce(p_necessidades, ''))) = 0
     and length(trim(concat(p->>'gostos', p->>'alergias', p->>'restricoes', p->>'ocasiao', p->>'outros'))) = 0
$$;

-- ── 7) alerta "faltam preferências" (embarca em até 30 dias) ───────────────
-- Mesma view de 0146 + uma linha nova no fim (create or replace só acrescenta).
create or replace view rel_alertas with (security_invoker = true) as
 SELECT 'passaporte'::text AS tipo,
    'alta'::text AS gravidade,
    c.id AS cliente_id,
    v.id AS viagem_id,
    ((c.nome || ': passaporte vence em '::text) || to_char((c.passaporte_validade)::timestamp with time zone, 'DD/MM/YYYY'::text)) AS titulo,
    (((('Viagem '::text || v.titulo) || ' volta em '::text) || to_char((COALESCE(v.data_retorno, v.data_embarque))::timestamp with time zone, 'DD/MM/YYYY'::text)) || '. O passaporte precisa valer 6 meses além disso.'::text) AS detalhe,
    v.data_embarque AS data
   FROM ((rel_viagens v
     JOIN rel_viagem_passageiros p ON ((p.viagem_id = v.id)))
     JOIN rel_clientes c ON ((c.id = p.cliente_id)))
  WHERE ((v.status = 'ativa'::text) AND (v.data_embarque >= rel_hoje()) AND (c.arquivado_em IS NULL) AND (c.passaporte_validade IS NOT NULL) AND (c.passaporte_validade < (COALESCE(v.data_retorno, v.data_embarque) + '6 mons'::interval)))
UNION ALL
 SELECT 'sem_passaporte'::text AS tipo,
    'media'::text AS gravidade,
    c.id AS cliente_id,
    v.id AS viagem_id,
    (c.nome || ': sem passaporte na ficha'::text) AS titulo,
    (((('Embarca em '::text || to_char((v.data_embarque)::timestamp with time zone, 'DD/MM/YYYY'::text)) || ' ('::text) || v.titulo) || ').'::text) AS detalhe,
    v.data_embarque AS data
   FROM ((rel_viagens v
     JOIN rel_viagem_passageiros p ON ((p.viagem_id = v.id)))
     JOIN rel_clientes c ON ((c.id = p.cliente_id)))
  WHERE ((v.status = 'ativa'::text) AND (v.tipo = 'expedicao'::text) AND ((v.data_embarque >= rel_hoje()) AND (v.data_embarque <= (rel_hoje() + 180))) AND (c.passaporte IS NULL) AND (c.arquivado_em IS NULL))
UNION ALL
 SELECT 'tarefa'::text AS tipo,
    'alta'::text AS gravidade,
    v.cliente_id,
    v.id AS viagem_id,
    (('Esteira: '::text || a.rotulo) || ' atrasada'::text) AS titulo,
    ((v.titulo || ' · prazo '::text) || to_char((a.prazo)::timestamp with time zone, 'DD/MM'::text)) AS detalhe,
    a.prazo AS data
   FROM (rel_esteira_atrasadas() a(viagem_id, etapa, rotulo, prazo)
     JOIN rel_viagens v ON ((v.id = a.viagem_id)))
UNION ALL
 SELECT 'documentos'::text AS tipo,
    'media'::text AS gravidade,
    d.cliente_id,
    d.viagem_id,
    (c.nome || ': documentos pedidos e não enviados'::text) AS titulo,
    (('Link criado em '::text || to_char(d.criado_em, 'DD/MM'::text)) || '.'::text) AS detalhe,
    (d.criado_em)::date AS data
   FROM (rel_doc_pedidos d
     JOIN rel_clientes c ON ((c.id = d.cliente_id)))
  WHERE ((d.concluido_em IS NULL) AND (d.criado_em < (now() - '7 days'::interval)) AND (d.expira_em > now()) AND (NOT (EXISTS ( SELECT 1
           FROM rel_documentos x
          WHERE (x.pedido_id = d.id)))))
UNION ALL
 SELECT 'chamado'::text AS tipo,
        CASE
            WHEN (ch.prioridade = ANY (ARRAY['alta'::text, 'urgente'::text])) THEN 'alta'::text
            ELSE 'media'::text
        END AS gravidade,
    ch.cliente_id,
    ch.viagem_id,
    ((('Chamado #'::text || ch.numero) || ': '::text) || ch.assunto) AS titulo,
    (('Prazo era '::text || to_char((ch.prazo AT TIME ZONE 'America/Sao_Paulo'::text), 'DD/MM HH24:MI'::text)) || '.'::text) AS detalhe,
    (ch.prazo)::date AS data
   FROM rel_chamados ch
  WHERE ((ch.status <> 'resolvido'::text) AND (ch.prazo < now()))
UNION ALL
 SELECT 'aniversario'::text AS tipo,
    'baixa'::text AS gravidade,
    c.id AS cliente_id,
    NULL::uuid AS viagem_id,
    ((c.nome || ' faz aniversário em '::text) || to_char((c.nascimento)::timestamp with time zone, 'DD/MM'::text)) AS titulo,
    'Boa hora pra uma mensagem.'::text AS detalhe,
    make_date((EXTRACT(year FROM rel_hoje()))::integer, (EXTRACT(month FROM c.nascimento))::integer,
        CASE
            WHEN (to_char((c.nascimento)::timestamp with time zone, 'MM-DD'::text) = '02-29'::text) THEN 28
            ELSE (EXTRACT(day FROM c.nascimento))::integer
        END) AS data
   FROM rel_clientes c
  WHERE ((c.mesclado_em_id IS NULL) AND (c.arquivado_em IS NULL) AND (c.nascimento IS NOT NULL) AND (((to_char((c.nascimento)::timestamp with time zone, 'MM-DD'::text) >= to_char((rel_hoje())::timestamp with time zone, 'MM-DD'::text)) AND (to_char((c.nascimento)::timestamp with time zone, 'MM-DD'::text) <= to_char(((rel_hoje() + 7))::timestamp with time zone, 'MM-DD'::text))) OR ((to_char(((rel_hoje() + 7))::timestamp with time zone, 'MM-DD'::text) < to_char((rel_hoje())::timestamp with time zone, 'MM-DD'::text)) AND ((to_char((c.nascimento)::timestamp with time zone, 'MM-DD'::text) >= to_char((rel_hoje())::timestamp with time zone, 'MM-DD'::text)) OR (to_char((c.nascimento)::timestamp with time zone, 'MM-DD'::text) <= to_char(((rel_hoje() + 7))::timestamp with time zone, 'MM-DD'::text))))))
UNION ALL
 SELECT 'embarque'::text AS tipo,
    'baixa'::text AS gravidade,
    v.cliente_id,
    v.id AS viagem_id,
    ((v.titulo || ' embarca em '::text) || to_char((v.data_embarque)::timestamp with time zone, 'DD/MM'::text)) AS titulo,
    (( SELECT count(*) AS count
           FROM rel_viagem_passageiros p
          WHERE (p.viagem_id = v.id)) || ' passageiro(s).'::text) AS detalhe,
    v.data_embarque AS data
   FROM rel_viagens v
  WHERE ((v.status = 'ativa'::text) AND ((v.data_embarque >= rel_hoje()) AND (v.data_embarque <= (rel_hoje() + 7))))
UNION ALL
 -- 0184: pacote/aéreo/hotel que embarca em até 30 dias sem nada anotado sobre a pessoa
 SELECT 'preferencias'::text AS tipo,
    CASE WHEN (v.data_embarque <= (rel_hoje() + 7)) THEN 'alta'::text ELSE 'media'::text END AS gravidade,
    v.cliente_id,
    v.id AS viagem_id,
    (COALESCE(c.nome, v.titulo) || ': faltam as preferências'::text) AS titulo,
    (('Embarca em '::text || to_char((v.data_embarque)::timestamp with time zone, 'DD/MM'::text)) || '. Gostos, alergias, restrições, ocasião especial — ou marque "nada a registrar".'::text) AS detalhe,
    v.data_embarque AS data
   FROM (rel_viagens v
     LEFT JOIN rel_clientes c ON ((c.id = v.cliente_id)))
  WHERE ((v.status = 'ativa'::text) AND ((v.data_embarque >= rel_hoje()) AND (v.data_embarque <= (rel_hoje() + 30)))
    AND (rel_acompanhamento(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados))) = ANY (ARRAY['completo'::text, 'leve'::text]))
    AND rel_preferencias_vazias(v.preferencias, v.necessidades));
