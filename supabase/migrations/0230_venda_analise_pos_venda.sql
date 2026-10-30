-- 0230_venda_analise_pos_venda.sql
-- -----------------------------------------------------------------------------
-- ANÁLISE PÓS-VENDA (Bruno, 30/10/2026) — NÃO APLICADA (só arquivo).
--
-- "Todo mundo que subir venda no QS (Closer, Rel, Ops) passa por uma análise
--  PÓS-VENDA: a IA pega o pacote apresentado ao cliente (a proposta) e cruza
--  com tudo o que foi EMITIDO, dá um EXTRATO do que falta emitir; se falta,
--  manda pro Relacionamento; e analisa o RISCO. Precisamos de um STATUS da
--  venda pra entender se falta alguma coisa ou se está tudo certo."
--
-- Quem calcula é o servidor (api/venda-analise.js + api/_vendaConferencia.js):
-- cruzamento determinístico + IA opcional. Esta migration só GUARDA:
--
--   1) qs_vendas ganha o STATUS da análise (analise_status / analise_em /
--      analise_resumo / analise_solicitacao_id).
--      Status: em_analise | tudo_emitido | faltam_emissoes | divergencia | risco_alto
--   2) qs_venda_analises — histórico: cada análise (extrato, riscos, se a IA
--      entrou, quem pediu). Reanalisar = nova linha.
--   3) Tipo de solicitação 'rel_emissoes_pendentes' ("Emissões pendentes")
--      no Relacionamento.
--   4) venda_analise_gravar(...) — SÓ service_role (o servidor): grava a
--      análise, atualiza o status e, se falta emitir ou diverge, ABRE a
--      solicitação pro Rel (uma por venda; reanálise comenta na mesma enquanto
--      estiver aberta). Venda lançada pelo PRÓPRIO Rel não abre solicitação
--      (a Central não aceita pedido do setor pra ele mesmo — check
--      de_setor <> para_setor): fica no painel "Vendas com pendência".
--   5) venda_item_marcar_emitido(item, localizador, obs) — Rel/Ops/gestão
--      corrigem: marcam um item da venda como emitido.
--   6) qs_vendas_analise_v — a lista do painel "Vendas com pendência".
--
-- Nada aqui manda mensagem pra fora: o aviso pro Rel é a solicitação interna
-- (os gatilhos da 0149/0222 distribuem e acendem a bolinha).
-- Depende de: 0149/0150/0158/0222 (Central), 0207 (qs_venda_itens), 0214 (qs_vendas).
-- Idempotente. Rollback comentado no fim.
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Status da análise na venda
-- ═════════════════════════════════════════════════════════════════════════════
alter table qs_vendas add column if not exists analise_status text;
alter table qs_vendas add column if not exists analise_em timestamptz;
-- { contagens:{ok,falta,divergente,extra,total}, risco_nivel, faltam[], divergencias[], riscos_altos[], resumo, inicio, fim, ia_usada }
alter table qs_vendas add column if not exists analise_resumo jsonb;
alter table qs_vendas add column if not exists analise_solicitacao_id uuid references qs_solicitacoes(id) on delete set null;
alter table qs_vendas drop constraint if exists qs_vendas_analise_status_check;
alter table qs_vendas add constraint qs_vendas_analise_status_check
  check (analise_status is null or analise_status in ('em_analise','tudo_emitido','faltam_emissoes','divergencia','risco_alto'));
create index if not exists qs_vendas_analise_status on qs_vendas (analise_status, criado_em desc) where analise_status is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Histórico das análises
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists qs_venda_analises (
  id            uuid primary key default gen_random_uuid(),
  venda_id      uuid not null references qs_vendas(id) on delete cascade,
  status        text not null check (status in ('em_analise','tudo_emitido','faltam_emissoes','divergencia','risco_alto')),
  base          text check (base in ('proposta','venda')),
  proposta_id   uuid references qs_propostas(id) on delete set null,
  contagens     jsonb not null default '{}'::jsonb,
  linhas        jsonb not null default '[]'::jsonb check (jsonb_typeof(linhas) = 'array'),
  riscos        jsonb not null default '[]'::jsonb check (jsonb_typeof(riscos) = 'array'),
  risco_nivel   text check (risco_nivel in ('baixo','medio','alto')),
  resumo        text,
  texto_ia      text,
  ia_usada      boolean not null default false,
  ia_modelo     text,
  ia_aviso      text,              -- "análise por IA indisponível" etc.
  motivo        text not null default 'subir_venda' check (motivo in ('subir_venda','reanalise','correcao')),
  solicitacao_id uuid references qs_solicitacoes(id) on delete set null,
  por           uuid references qs_users(id) on delete set null,
  em            timestamptz not null default now()
);
create index if not exists qs_venda_analises_venda on qs_venda_analises (venda_id, em desc);
comment on table qs_venda_analises is
  'Análise pós-venda (0230): extrato proposta × emitido + riscos, uma linha por análise. Escrita só por venda_analise_gravar (service_role).';

alter table qs_venda_analises enable row level security;
drop policy if exists qs_venda_analises_ler on qs_venda_analises;
create policy qs_venda_analises_ler on qs_venda_analises for select to authenticated
  using (exists (select 1 from qs_vendas v where v.id = venda_id));   -- herda a RLS de qs_vendas (0214)
drop policy if exists app_cliente_barreira on qs_venda_analises;
create policy app_cliente_barreira on qs_venda_analises as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
revoke all on qs_venda_analises from anon;
grant select on qs_venda_analises to authenticated;
grant all on qs_venda_analises to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Tipo "Emissões pendentes" no Relacionamento
-- ═════════════════════════════════════════════════════════════════════════════
-- papel null = o setor todo entra no rodízio da 0222 (decisão a confirmar: CX?).
insert into qs_solicitacao_tipos (id, setor, rotulo, prazo_horas, prazo_alta_horas, prazo_urgente_horas, ordem, ativo, formulario, grupo, papel)
values ('rel_emissoes_pendentes', 'relacionamento', 'Emissões pendentes (venda)', 8, 4, 2, 5, true, null, 'Emissões', null)
on conflict (id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Gravar a análise (servidor)
-- ═════════════════════════════════════════════════════════════════════════════
-- p_resultado = o JSON de api/venda-analise.js:
--   { status, base, proposta_id, contagens, linhas[], riscos[], risco_nivel, faltam[], divergencias[],
--     resumo, inicio, fim, texto_extrato, ia:{ usada, modelo, aviso, texto } }
create or replace function venda_analise_gravar(p_venda uuid, p_resultado jsonb, p_por uuid, p_motivo text default 'subir_venda')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        qs_vendas%rowtype;
  v_status text := p_resultado->>'status';
  v_falta  int  := coalesce((p_resultado->'contagens'->>'falta')::int, 0);
  v_div    int  := coalesce((p_resultado->'contagens'->>'divergente')::int, 0) + coalesce((p_resultado->'contagens'->>'extra')::int, 0);
  v_de     text;
  v_sol    uuid;
  v_sol_aberta boolean := false;
  v_nova   boolean := false;
  v_id     uuid;
  v_inicio date := nullif(p_resultado->>'inicio', '')::date;
  v_prio   text := 'normal';
  v_nome   text := coalesce((select name from qs_users where id = p_por), 'Análise pós-venda');
  v_texto  text := coalesce(nullif(p_resultado->>'texto_extrato', ''), p_resultado->>'resumo', '');
  v_cli    text;
  v_num    bigint;
begin
  if v_status is null or v_status not in ('em_analise','tudo_emitido','faltam_emissoes','divergencia','risco_alto') then
    raise exception 'analise-status-invalido';
  end if;
  select * into v from qs_vendas where id = p_venda for update;
  if not found then raise exception 'venda-nao-encontrada'; end if;

  -- Solicitação já aberta pra esta venda?
  if v.analise_solicitacao_id is not null then
    select id, status in ('nova','em_andamento','aguardando') into v_sol, v_sol_aberta
      from qs_solicitacoes where id = v.analise_solicitacao_id;
  end if;

  if (v_falta + v_div) > 0 then
    if coalesce(v_sol_aberta, false) then
      insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_id, autor_nome)
        values (v_sol, 'comentario', 'Reanálise pós-venda: ' || coalesce(p_resultado->>'resumo', '') || E'\n\n' || v_texto, p_por, v_nome);
      update qs_solicitacoes set atualizado_em = now(), descricao = v_texto where id = v_sol;
    elsif v.origem <> 'rel' then
      v_de := case v.origem when 'closer' then 'comercial' when 'ops' then 'operacional' end;
      if v_inicio is not null and v_inicio - current_date <= 15 then v_prio := 'urgente';
      elsif v_inicio is not null and v_inicio - current_date <= 45 then v_prio := 'alta'; end if;
      select nome into v_cli from rel_clientes where id = v.cliente_id;
      insert into qs_solicitacoes (de_setor, para_setor, tipo_id, titulo, descricao, prioridade, prazo, prazo_manual,
                                   cliente_id, viagem_id, sobre_nome, criado_por, atualizado_por, closer_negocio_id)
      values (v_de, 'relacionamento', 'rel_emissoes_pendentes',
              left(concat('Emissões pendentes — ', coalesce(v_cli, 'venda'),
                          case when v_falta > 0 then concat(' (', v_falta, ' por emitir)') else ' (divergência)' end), 200),
              v_texto, v_prio,
              qs_somar_minutos_uteis(now(), qs_sol_horas('rel_emissoes_pendentes', v_prio) * 60), false,
              v.cliente_id, v.viagem_id, qs_sol_sobre(v.cliente_id, v.viagem_id), p_por, p_por, v.negocio_id)
      returning id, numero into v_sol, v_num;
      insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_id, autor_nome)
        values (v_sol, 'criada', 'relacionamento', 'Aberta pela análise pós-venda.', p_por, v_nome);
      v_nova := true;
    else
      v_sol := null;  -- venda do próprio Rel: fica no painel
    end if;
  elsif coalesce(v_sol_aberta, false) then
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_id, autor_nome)
      values (v_sol, 'comentario', 'Reanálise pós-venda: tudo emitido ✓ — pode concluir este pedido.', p_por, v_nome);
    update qs_solicitacoes set atualizado_em = now() where id = v_sol;
  end if;

  insert into qs_venda_analises (venda_id, status, base, proposta_id, contagens, linhas, riscos, risco_nivel, resumo,
                                 texto_ia, ia_usada, ia_modelo, ia_aviso, motivo, solicitacao_id, por)
  values (p_venda, v_status, p_resultado->>'base', nullif(p_resultado->>'proposta_id', '')::uuid,
          coalesce(p_resultado->'contagens', '{}'::jsonb), coalesce(p_resultado->'linhas', '[]'::jsonb),
          coalesce(p_resultado->'riscos', '[]'::jsonb), p_resultado->>'risco_nivel', p_resultado->>'resumo',
          p_resultado->'ia'->>'texto', coalesce((p_resultado->'ia'->>'usada')::boolean, false),
          p_resultado->'ia'->>'modelo', p_resultado->'ia'->>'aviso',
          case when p_motivo in ('subir_venda','reanalise','correcao') then p_motivo else 'reanalise' end,
          v_sol, p_por)
  returning id into v_id;

  update qs_vendas set
    analise_status = v_status, analise_em = now(),
    analise_solicitacao_id = coalesce(v_sol, analise_solicitacao_id),
    analise_resumo = jsonb_build_object(
      'contagens', p_resultado->'contagens', 'risco_nivel', p_resultado->>'risco_nivel',
      'faltam', coalesce(p_resultado->'faltam', '[]'::jsonb), 'divergencias', coalesce(p_resultado->'divergencias', '[]'::jsonb),
      'riscos_altos', coalesce((select jsonb_agg(r->>'motivo') from jsonb_array_elements(coalesce(p_resultado->'riscos','[]'::jsonb)) r where r->>'nivel' = 'alto'), '[]'::jsonb),
      'resumo', p_resultado->>'resumo', 'inicio', p_resultado->>'inicio', 'fim', p_resultado->>'fim',
      'ia_usada', coalesce((p_resultado->'ia'->>'usada')::boolean, false)),
    atualizado_em = now()
  where id = p_venda;

  return jsonb_build_object('analise_id', v_id, 'status', v_status, 'solicitacao_id', v_sol,
                            'solicitacao_numero', coalesce(v_num, (select numero from qs_solicitacoes where id = v_sol)),
                            'solicitacao_nova', v_nova);
end;
$$;
revoke all on function venda_analise_gravar(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function venda_analise_gravar(uuid, jsonb, uuid, text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Corrigir: marcar item como emitido (Rel / Ops / gestão)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function venda_item_marcar_emitido(p_item uuid, p_localizador text, p_obs text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_venda uuid;
begin
  if not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  if nullif(trim(coalesce(p_localizador, '')), '') is null then raise exception 'localizador-obrigatorio'; end if;
  perform set_config('qs.venda_itens_rpc', 'on', true);
  update qs_venda_itens
     set status = 'emitido',
         dados = dados || jsonb_strip_nulls(jsonb_build_object(
           'localizador', upper(trim(p_localizador)), 'emitido_obs', nullif(trim(coalesce(p_obs, '')), ''),
           'emitido_por', auth.uid(), 'emitido_em', now()))
   where id = p_item and status <> 'cancelado'
   returning venda_id into v_venda;
  if not found then raise exception 'item-nao-encontrado'; end if;
  return jsonb_build_object('item_id', p_item, 'venda_id', v_venda);
end;
$$;
revoke all on function venda_item_marcar_emitido(uuid, text, text) from public, anon;
grant execute on function venda_item_marcar_emitido(uuid, text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Lista do painel "Vendas com pendência"
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view qs_vendas_analise_v with (security_invoker = true) as
select v.id, v.origem, v.negocio_id, v.viagem_id, v.cliente_id, v.valor_total, v.criado_em, v.criado_por,
       coalesce(v.analise_status, 'em_analise') as analise_status, v.analise_em, v.analise_resumo,
       v.analise_solicitacao_id,
       c.nome as cliente_nome,
       u.name as criado_por_nome,
       s.numero as solicitacao_numero, s.status as solicitacao_status,
       (select count(*) from qs_venda_itens i where i.venda_id = v.id)::int as itens
  from qs_vendas v
  left join rel_clientes c on c.id = v.cliente_id
  left join qs_users u on u.id = v.criado_por
  left join qs_solicitacoes s on s.id = v.analise_solicitacao_id;
grant select on qs_vendas_analise_v to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (rodar na mão, nesta ordem):
--   drop view if exists qs_vendas_analise_v;
--   drop function if exists venda_item_marcar_emitido(uuid, text, text);
--   drop function if exists venda_analise_gravar(uuid, jsonb, uuid, text);
--   delete from qs_solicitacao_tipos where id = 'rel_emissoes_pendentes'
--     and not exists (select 1 from qs_solicitacoes where tipo_id = 'rel_emissoes_pendentes');
--   drop table if exists qs_venda_analises;
--   alter table qs_vendas drop constraint if exists qs_vendas_analise_status_check;
--   drop index if exists qs_vendas_analise_status;
--   alter table qs_vendas drop column if exists analise_solicitacao_id,
--     drop column if exists analise_resumo, drop column if exists analise_em, drop column if exists analise_status;
-- ═════════════════════════════════════════════════════════════════════════════
