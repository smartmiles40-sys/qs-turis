-- 0106_relacionamento_kpis_kanban_trechos.sql
-- -----------------------------------------------------------------------------
-- Sprint do Relacionamento de 13/10/2026 (pedido do Bruno):
--   1. Chamado aberto de dentro da conversa + KANBAN no Atendimento
--      (evolução do protocolo, situação e "o que falta pra andar").
--   2. Clientes com 4 KPIs: categoria (bronze/silver/black/green), LTV médio,
--      índice de contato (dias sem falar, por categoria) e % de cadastro completo.
--   3. Ficha do cliente com arquivos/imagens e todas as viagens dele.
--   4. Viagens: mapa + painel de aeroporto (próximo embarque, próximo voo
--      interno, revisão da viagem) e calendário com embarques e check-ins,
--      sempre separando PACOTE de EXPEDIÇÃO.
--   5. Conferência dos documentos por IA (ChatGPT) — colunas de resultado.
--
-- Tudo aditivo. As regras das categorias e as metas de contato ficam em
-- rel_config (o time muda na tela, sem código).
-- -----------------------------------------------------------------------------


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. CHAMADOS: kanban + histórico do protocolo
-- ═════════════════════════════════════════════════════════════════════════════
alter table rel_chamados add column if not exists proximo_passo text;      -- "o que precisa pra dar andamento"
alter table rel_chamados add column if not exists aguardando_quem text      -- de quem depende agora
  check (aguardando_quem is null or aguardando_quem in ('time', 'cliente', 'fornecedor', 'financeiro', 'outro'));
alter table rel_chamados add column if not exists checklist jsonb not null default '[]'::jsonb; -- [{texto, feito}]
alter table rel_chamados add column if not exists categoria text;           -- assunto livre agrupável (documento, aéreo, pagamento...)
alter table rel_chamados add column if not exists ordem double precision;   -- posição dentro da coluna do kanban

create table if not exists rel_chamado_eventos (
  id           uuid primary key default gen_random_uuid(),
  chamado_id   uuid not null references rel_chamados(id) on delete cascade,
  tipo         text not null default 'nota' check (tipo in ('criado', 'status', 'nota', 'proximo_passo', 'responsavel', 'checklist', 'resolvido')),
  texto        text,
  de_status    text,
  para_status  text,
  autor_id     uuid default auth.uid(),
  criado_em    timestamptz not null default now()
);
create index if not exists rel_chamado_eventos_idx on rel_chamado_eventos (chamado_id, criado_em);

-- Toda mudança relevante do chamado vira linha do histórico sozinha
-- (a tela não precisa lembrar de gravar).
create or replace function rel_chamados_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into rel_chamado_eventos (chamado_id, tipo, texto, para_status, autor_id)
    values (new.id, 'criado', new.assunto, new.status, coalesce(auth.uid(), new.criado_por));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into rel_chamado_eventos (chamado_id, tipo, de_status, para_status, texto)
    values (new.id, case when new.status = 'resolvido' then 'resolvido' else 'status' end,
            old.status, new.status, case when new.status = 'resolvido' then new.resolucao end);
  end if;
  if new.proximo_passo is distinct from old.proximo_passo and coalesce(new.proximo_passo, '') <> '' then
    insert into rel_chamado_eventos (chamado_id, tipo, texto) values (new.id, 'proximo_passo', new.proximo_passo);
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into rel_chamado_eventos (chamado_id, tipo, texto)
    values (new.id, 'responsavel', (select name from qs_users where id = new.responsavel_id));
  end if;
  if new.status = 'resolvido' and old.status <> 'resolvido' and new.resolvido_em is null then
    new.resolvido_em := now();
  elsif new.status <> 'resolvido' then
    new.resolvido_em := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_rel_chamados_historico_ins on rel_chamados;
create trigger trg_rel_chamados_historico_ins after insert on rel_chamados
  for each row execute function rel_chamados_historico();
drop trigger if exists trg_rel_chamados_historico_upd on rel_chamados;
create trigger trg_rel_chamados_historico_upd before update on rel_chamados
  for each row execute function rel_chamados_historico();


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. CONTATOS registrados à mão (ligação, encontro, Instagram...)
--    O índice de contato usa o MAIS RECENTE entre: WhatsApp do Relacionamento,
--    chamado e este registro.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists rel_contatos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references rel_clientes(id) on delete cascade,
  canal       text not null default 'ligacao' check (canal in ('ligacao', 'whatsapp', 'email', 'presencial', 'instagram', 'outro')),
  resumo      text,
  feito_em    timestamptz not null default now(),
  autor_id    uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists rel_contatos_cliente_idx on rel_contatos (cliente_id, feito_em desc);


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. VIAGENS: revisão + trechos (voos, trens, transfers) com check-in
-- ═════════════════════════════════════════════════════════════════════════════
alter table rel_viagens add column if not exists revisado_em  timestamptz;
alter table rel_viagens add column if not exists revisado_por uuid references qs_users(id) on delete set null;
alter table rel_viagens add column if not exists revisao_obs  text;

create table if not exists rel_viagem_trechos (
  id               uuid primary key default gen_random_uuid(),
  viagem_id        uuid not null references rel_viagens(id) on delete cascade,
  tipo             text not null default 'voo_internacional'
                   check (tipo in ('voo_internacional', 'voo_interno', 'trem', 'transfer', 'hospedagem', 'passeio', 'outro')),
  descricao        text,
  origem           text,
  destino          text,
  partida_em       timestamptz not null,
  chegada_em       timestamptz,
  companhia        text,
  numero           text,           -- nº do voo / trem
  localizador      text,
  checkin_abre_em  timestamptz,    -- vazio = calcula (voo: 48h antes da partida)
  checkin_feito_em timestamptz,
  checkin_feito_por uuid references qs_users(id) on delete set null,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  check (chegada_em is null or chegada_em >= partida_em)
);
create index if not exists rel_viagem_trechos_idx on rel_viagem_trechos (partida_em);
create index if not exists rel_viagem_trechos_viagem_idx on rel_viagem_trechos (viagem_id, partida_em);

-- Check-in calculado: voo = 48h antes (padrão das cias), trem = 24h, resto não tem.
create or replace view rel_trechos_v
with (security_invoker = true) as
select t.*,
       coalesce(t.checkin_abre_em,
                case when t.tipo in ('voo_internacional', 'voo_interno') then t.partida_em - interval '48 hours'
                     when t.tipo = 'trem' then t.partida_em - interval '24 hours' end) as checkin_em,
       v.tipo as viagem_tipo, v.titulo as viagem_titulo, v.destino as viagem_destino,
       v.expedicao, v.status as viagem_status
  from rel_viagem_trechos t
  join rel_viagens v on v.id = t.viagem_id;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. DOCUMENTOS: imagens/arquivos livres na ficha + conferência por IA
-- ═════════════════════════════════════════════════════════════════════════════
alter table rel_documentos drop constraint if exists rel_documentos_tipo_check;
alter table rel_documentos add constraint rel_documentos_tipo_check
  check (tipo in ('passaporte', 'rg_cnh', 'visto', 'vacina', 'seguro', 'voucher', 'contrato', 'comprovante', 'foto', 'outro'));

alter table rel_documentos add column if not exists ia_status    text
  check (ia_status is null or ia_status in ('pendente', 'ok', 'divergente', 'ilegivel', 'erro'));
alter table rel_documentos add column if not exists ia_resultado jsonb;   -- {campos_lidos, divergencias[], resumo}
alter table rel_documentos add column if not exists ia_em        timestamptz;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. CONFIG: categorias, metas de contato e cadastro obrigatório
-- ═════════════════════════════════════════════════════════════════════════════
-- criterio: 'viagens' (só nº de viagens), 'valor' (só valor gasto) ou
--           'viagens_ou_valor' (sobe se bater QUALQUER um).
-- contar:   'compradas' (toda venda não cancelada) ou 'realizadas' (já voltou).
insert into rel_config (chave, valor) values
  ('categorias', '{
     "criterio": "viagens",
     "contar": "compradas",
     "niveis": [
       {"id": "bronze", "nome": "Bronze", "min_viagens": 1, "min_valor": 0,      "cor": "#B0743C"},
       {"id": "silver", "nome": "Silver", "min_viagens": 2, "min_valor": 30000,  "cor": "#9AA3AE"},
       {"id": "black",  "nome": "Black",  "min_viagens": 3, "min_valor": 60000,  "cor": "#1F2328"},
       {"id": "green",  "nome": "Green",  "min_viagens": 5, "min_valor": 100000, "cor": "#0E7C6A"}
     ]
   }'::jsonb),
  ('contato_meta_dias', '{"sem_categoria": 120, "bronze": 90, "silver": 60, "black": 45, "green": 30}'::jsonb),
  ('cadastro_obrigatorio', '["cpf", "nascimento", "telefone", "email", "passaporte", "passaporte_validade", "doc_passaporte"]'::jsonb)
on conflict (chave) do nothing;


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. MÉTRICAS POR CLIENTE (base dos 4 KPIs da aba Clientes)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view rel_cliente_metricas
with (security_invoker = true) as
with viagens_do_cliente as (
  -- o cliente "fez" a viagem se é o titular OU passageiro dela
  select v.id, v.tipo, v.valor, v.data_embarque, v.data_retorno, v.cliente_id as titular, x.cliente_id
    from rel_viagens v
    join lateral (
      select v.cliente_id union select p.cliente_id from rel_viagem_passageiros p where p.viagem_id = v.id
    ) x on x.cliente_id is not null
   where v.status = 'ativa'
),
agg as (
  select cliente_id,
         count(distinct id)                                                        as viagens_compradas,
         count(distinct id) filter (where coalesce(data_retorno, data_embarque) < current_date) as viagens_realizadas,
         count(distinct id) filter (where tipo = 'expedicao')                      as expedicoes,
         count(distinct id) filter (where tipo = 'pacote')                         as pacotes,
         coalesce(sum(valor) filter (where titular = cliente_id), 0)               as valor_total,
         min(data_embarque)                                                        as primeira_viagem,
         max(data_embarque)                                                        as ultima_viagem,
         max(data_retorno) filter (where data_retorno < current_date)              as ultimo_retorno,
         min(data_embarque) filter (where data_embarque >= current_date)           as proximo_embarque
    from viagens_do_cliente
   group by cliente_id
),
contato as (
  select c.id as cliente_id,
         greatest(
           (select max(greatest(w.ultima_saida_em, w.ultima_entrada_em)) from rel_wa_conversas w where w.cliente_id = c.id),
           (select max(ct.feito_em) from rel_contatos ct where ct.cliente_id = c.id),
           (select max(ch.atualizado_em) from rel_chamados ch where ch.cliente_id = c.id)
         ) as ultimo_contato_em
    from rel_clientes c
),
cfg as (
  select coalesce((select valor from rel_config where chave = 'categorias'), '{}'::jsonb) as cat,
         coalesce((select valor from rel_config where chave = 'contato_meta_dias'), '{}'::jsonb) as meta,
         coalesce((select valor from rel_config where chave = 'cadastro_obrigatorio'), '[]'::jsonb) as obrig
),
base as (
  select c.id, c.nome, c.titular_id, c.criado_em,
         coalesce(a.viagens_compradas, 0)  as viagens_compradas,
         coalesce(a.viagens_realizadas, 0) as viagens_realizadas,
         coalesce(a.expedicoes, 0)         as expedicoes,
         coalesce(a.pacotes, 0)            as pacotes,
         coalesce(a.valor_total, 0)        as valor_total,
         a.primeira_viagem, a.ultima_viagem, a.ultimo_retorno, a.proximo_embarque,
         ct.ultimo_contato_em,
         -- campos obrigatórios que faltam
         array_remove(array[
           case when cfg.obrig ? 'cpf'                 and c.cpf is null                 then 'cpf' end,
           case when cfg.obrig ? 'nascimento'          and c.nascimento is null          then 'nascimento' end,
           case when cfg.obrig ? 'telefone'            and c.telefone is null            then 'telefone' end,
           case when cfg.obrig ? 'email'               and c.email is null               then 'email' end,
           case when cfg.obrig ? 'passaporte'          and c.passaporte is null          then 'passaporte' end,
           case when cfg.obrig ? 'passaporte_validade' and c.passaporte_validade is null then 'passaporte_validade' end,
           case when cfg.obrig ? 'doc_passaporte' and not exists (
                  select 1 from rel_documentos d where d.cliente_id = c.id and d.tipo = 'passaporte' and d.status <> 'recusado')
                then 'doc_passaporte' end
         ], null) as faltando,
         cfg.cat, cfg.meta
    from rel_clientes c
    cross join cfg
    left join agg a on a.cliente_id = c.id
    left join contato ct on ct.cliente_id = c.id
   where c.mesclado_em_id is null
),
conta as (
  select b.*,
         case when (b.cat->>'contar') = 'realizadas' then b.viagens_realizadas else b.viagens_compradas end as viagens_conta
    from base b
),
cat as (
  -- maior nível que o cliente alcança; cliente sem nenhuma viagem fica sem categoria
  select k.*,
         (select n->>'id'
            from jsonb_array_elements(coalesce(k.cat->'niveis', '[]'::jsonb)) with ordinality as e(n, ord)
           where k.viagens_compradas > 0
             and case coalesce(k.cat->>'criterio', 'viagens')
                   when 'valor' then k.valor_total >= coalesce((n->>'min_valor')::numeric, 0)
                   when 'viagens_ou_valor' then k.viagens_conta >= coalesce((n->>'min_viagens')::int, 0)
                                          or (coalesce((n->>'min_valor')::numeric, 0) > 0
                                              and k.valor_total >= (n->>'min_valor')::numeric)
                   else k.viagens_conta >= coalesce((n->>'min_viagens')::int, 0)
                 end
           order by ord desc
           limit 1) as categoria
    from conta k
)
select id, nome, titular_id, criado_em,
       viagens_compradas, viagens_realizadas, expedicoes, pacotes, valor_total,
       primeira_viagem, ultima_viagem, ultimo_retorno, proximo_embarque,
       ultimo_contato_em,
       case when ultimo_contato_em is null then null
            else (current_date - (ultimo_contato_em at time zone 'America/Sao_Paulo')::date) end as dias_sem_contato,
       coalesce(categoria, 'sem_categoria') as categoria,
       coalesce((meta->>coalesce(categoria, 'sem_categoria'))::int, 90) as meta_contato_dias,
       faltando,
       cardinality(faltando) = 0 as cadastro_completo
  from cat;

grant select on rel_cliente_metricas, rel_trechos_v to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. JUNTAR CLIENTES: agora leva TUDO junto (viagens, docs, conversas...)
--    (a 0100 só juntava a ficha; as fases 2–5 criaram tabelas que apontam
--    pra rel_clientes e ficariam presas na ficha que sai.)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function rel_juntar_repontar(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- passageiro: se as duas fichas estão na mesma viagem, fica uma linha só
  delete from rel_viagem_passageiros p
   where p.cliente_id = p_remover
     and exists (select 1 from rel_viagem_passageiros q where q.viagem_id = p.viagem_id and q.cliente_id = p_manter);
  update rel_viagem_passageiros set cliente_id = p_manter where cliente_id = p_remover;
  update rel_viagens       set cliente_id = p_manter where cliente_id = p_remover;
  update rel_wa_conversas  set cliente_id = p_manter where cliente_id = p_remover;
  update rel_chamados      set cliente_id = p_manter where cliente_id = p_remover;
  update rel_documentos    set cliente_id = p_manter where cliente_id = p_remover;
  update rel_doc_pedidos   set cliente_id = p_manter where cliente_id = p_remover;
  update rel_envios        set cliente_id = p_manter where cliente_id = p_remover;
  update rel_pesquisas     set cliente_id = p_manter where cliente_id = p_remover;
  update rel_recompras     set cliente_id = p_manter where cliente_id = p_remover;
  update rel_contatos      set cliente_id = p_manter where cliente_id = p_remover;
end;
$$;
revoke all on function rel_juntar_repontar(uuid, uuid) from public, anon, authenticated;

-- Gatilho: quando uma ficha é marcada como juntada (mesclado_em_id preenchido),
-- tudo que era dela passa pra que fica. Não precisa mexer no rel_juntar_clientes.
create or replace function rel_clientes_ao_juntar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mesclado_em_id is not null and old.mesclado_em_id is null then
    perform rel_juntar_repontar(new.mesclado_em_id, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_rel_clientes_ao_juntar on rel_clientes;
create trigger trg_rel_clientes_ao_juntar after update of mesclado_em_id on rel_clientes
  for each row execute function rel_clientes_ao_juntar();

-- Fichas já juntadas antes desta migration: traz o que ficou preso.
do $$
declare r record;
begin
  for r in select id, mesclado_em_id from rel_clientes where mesclado_em_id is not null loop
    perform rel_juntar_repontar(r.mesclado_em_id, r.id);
  end loop;
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 8. RLS das tabelas novas (mesmo padrão da 0103)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['rel_chamado_eventos', 'rel_contatos', 'rel_viagem_trechos']
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
-- O histórico do chamado é escrito pelo gatilho; a tela só lê e adiciona nota.
drop policy if exists rel_chamado_eventos_mudar on rel_chamado_eventos;
drop policy if exists rel_chamado_eventos_apagar on rel_chamado_eventos;
