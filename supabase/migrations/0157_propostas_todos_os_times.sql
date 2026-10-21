-- 0157_propostas_todos_os_times.sql
-- -----------------------------------------------------------------------------
-- PROPOSTAS PRA TODOS OS TIMES (Bruno, 21/10/2026): "no final é para todos os
-- times terem como fazer essa cotação — Comercial, Relacionamento e Operações".
-- Decisões dele:
--   · cada time vê as SUAS (admin vê todas); quem pediu a cotação por uma
--     solicitação também vê a proposta que o outro time montou;
--   · custo/lucro/fornecedor: todos os times veem e preenchem;
--   · "quero gerar um link que fica PRESO NA SOLICITAÇÃO e a pessoa precisa
--     ABRIR para conseguir enviar" — tudo amarrado no QS (Bitrix fica pra depois).
--
-- Fluxo quando um time pede a cotação pra outro (ex.: Comercial → Operações):
--
--   rascunho ──(quem monta: "Pronta")──▶ pronta ──(quem pediu ABRE)──▶ pode enviar
--      ▲                                   │                              │
--      └────────("Pedir ajuste")───────────┘                    enviada ◀─┘
--
--   · "pronta" ainda NÃO abre pro cliente (api/proposta.js dá 404);
--   · só quem ABRIU a versão atual envia (aberta_por = quem clica "Enviar");
--     se quem monta salvar de novo, a abertura zera e precisa abrir outra vez;
--   · cada passo vira comentário na solicitação (acende a bolinha do outro lado);
--   · o link mostra o nome/WhatsApp de quem ENVIOU (é quem fala com o cliente).
--
-- Proposta do próprio time (sem solicitação, ou pedido do mesmo setor) segue
-- como na 0156: rascunho → enviada direto.
-- -----------------------------------------------------------------------------

alter table qs_propostas drop constraint if exists qs_propostas_status_check;
alter table qs_propostas add constraint qs_propostas_status_check
  check (status in ('rascunho','pronta','enviada','aprovada','recusada','cancelada'));

alter table qs_propostas
  add column if not exists pronta_em   timestamptz,                                       -- quem monta liberou pra quem pediu
  add column if not exists aberta_por  uuid references qs_users(id) on delete set null,   -- quem pediu abriu ESTA versão
  add column if not exists aberta_em   timestamptz,
  add column if not exists enviada_por uuid references qs_users(id) on delete set null;   -- quem mandou ao cliente
create index if not exists qs_propostas_setor_idx on qs_propostas (setor, atualizado_em desc);
create index if not exists qs_propostas_enviou_idx on qs_propostas (enviada_por, aprovada_em);

-- ── Quem enxerga a proposta ────────────────────────────────────────────────
-- o time dela (setor), quem montou, quem enviou, admin — e quem enxerga a
-- solicitação de onde ela veio (quem pediu + os dois setores).
create or replace function qs_ve_proposta(p_setor text, p_sol uuid, p_criador uuid, p_enviou uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_criador = auth.uid() or p_enviou = auth.uid() or qs_do_setor(p_setor)
      or (p_sol is not null and exists (
            select 1 from qs_solicitacoes s
             where s.id = p_sol and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id)));
$$;
grant execute on function qs_ve_proposta(text, uuid, uuid, uuid) to authenticated;

drop policy if exists qs_propostas_ler on qs_propostas;
drop policy if exists qs_prop_opcoes_ler on qs_proposta_opcoes;
drop policy if exists qs_prop_itens_ler on qs_proposta_itens;
create policy qs_propostas_ler on qs_propostas for select to authenticated
  using (qs_ve_proposta(setor, solicitacao_id, criado_por, enviada_por));
create policy qs_prop_opcoes_ler on qs_proposta_opcoes for select to authenticated
  using (exists (select 1 from qs_propostas p where p.id = proposta_id));   -- herda a regra da proposta
create policy qs_prop_itens_ler on qs_proposta_itens for select to authenticated
  using (exists (select 1 from qs_propostas p where p.id = proposta_id));

-- ── Leitura pronta pra lista: de qual solicitação/time veio ─────────────────
create or replace view qs_propostas_v with (security_invoker = true) as
select p.id, p.numero, p.setor, p.status, p.titulo, p.destino, p.cliente_nome, p.data_ida, p.atualizado_em,
       p.criado_por, p.enviada_por, p.vista_em, p.visualizacoes, p.aprovada_em, p.aprovacao_vista_em,
       p.solicitacao_id, p.pronta_em, p.aberta_em, p.cliente_id, p.viagem_id, p.lead_id,
       s.numero   as sol_numero,
       s.de_setor as sol_de_setor,
       -- precisa passar por quem pediu (pedido de OUTRO time)
       (s.id is not null and s.de_setor <> p.setor) as de_outro_time
  from qs_propostas p
  left join qs_solicitacoes s on s.id = p.solicitacao_id;
revoke all on qs_propostas_v from anon;
grant select on qs_propostas_v to authenticated;

-- ── Comentário na solicitação (acende a bolinha de quem está do outro lado) ─
create or replace function qs_proposta_avisar_sol(p_sol uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_sol is null then return; end if;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome) values (p_sol, 'comentario', p_texto, qs_eu_nome());
  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = p_sol;
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_sol, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;
revoke all on function qs_proposta_avisar_sol(uuid, text) from public, anon, authenticated;

-- ── Salvar: só quem MONTA (o time da proposta ou quem criou) ────────────────
create or replace function qs_proposta_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v      qs_propostas;
  v_set  text := coalesce(nullif(p ->> 'setor', ''), 'operacional');
  o      jsonb;
  i      jsonb;
  v_oid  uuid;
  v_oids uuid[] := '{}';
  v_iids uuid[] := '{}';
  v_iid  uuid;
  n_o    int := 0;
  n_i    int;
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  if jsonb_array_length(coalesce(p -> 'opcoes', '[]'::jsonb)) = 0 then raise exception 'proposta-sem-opcao'; end if;

  if v_id is null then
    if not qs_do_setor(v_set) then raise exception 'sem-acesso'; end if;
    insert into qs_propostas (setor) values (v_set) returning id into v_id;
  else
    select * into v from qs_propostas where id = v_id for update;
    if v.id is null then raise exception 'proposta-nao-encontrada'; end if;
    if not (qs_do_setor(v.setor) or v.criado_por = auth.uid()) then raise exception 'so-quem-monta'; end if;
    if v.status = 'cancelada' then raise exception 'proposta-cancelada'; end if;
  end if;

  update qs_propostas set
    titulo          = left(coalesce(p ->> 'titulo', ''), 200),
    destino         = nullif(left(p ->> 'destino', 200), ''),
    data_ida        = nullif(p ->> 'data_ida', '')::date,
    data_volta      = nullif(p ->> 'data_volta', '')::date,
    adultos         = coalesce((p ->> 'adultos')::int, 1),
    criancas        = coalesce((p ->> 'criancas')::int, 0),
    bebes           = coalesce((p ->> 'bebes')::int, 0),
    apresentacao    = left(coalesce(p ->> 'apresentacao', ''), 4000),
    observacoes     = left(coalesce(p ->> 'observacoes', ''), 8000),
    esconder_precos = coalesce((p ->> 'esconder_precos')::boolean, false),
    capa_url        = nullif(p ->> 'capa_url', ''),
    solicitacao_id  = nullif(p ->> 'solicitacao_id', '')::uuid,
    cliente_id      = nullif(p ->> 'cliente_id', '')::uuid,
    viagem_id       = nullif(p ->> 'viagem_id', '')::uuid,
    lead_id         = nullif(p ->> 'lead_id', '')::uuid,
    cliente_nome    = nullif(left(p ->> 'cliente_nome', 160), ''),
    -- mudou depois que quem pediu abriu: precisa abrir de novo pra enviar
    aberta_por      = null,
    aberta_em       = null,
    atualizado_em   = now()
  where id = v_id;

  for o in select * from jsonb_array_elements(p -> 'opcoes') loop
    v_oid := nullif(o ->> 'id', '')::uuid;
    if v_oid is not null and not exists (select 1 from qs_proposta_opcoes where id = v_oid and proposta_id = v_id) then v_oid := null; end if;
    if v_oid is null then
      insert into qs_proposta_opcoes (proposta_id) values (v_id) returning id into v_oid;
    end if;
    update qs_proposta_opcoes set
      ordem       = n_o,
      titulo      = left(coalesce(o ->> 'titulo', ''), 120),
      descricao   = left(coalesce(o ->> 'descricao', ''), 2000),
      recomendada = coalesce((o ->> 'recomendada')::boolean, false),
      desconto    = greatest(coalesce((o ->> 'desconto')::numeric, 0), 0),
      pagamentos  = case when jsonb_typeof(o -> 'pagamentos') = 'array' then o -> 'pagamentos' else '[]'::jsonb end
    where id = v_oid;
    v_oids := v_oids || v_oid;
    n_o := n_o + 1;

    n_i := 0;
    for i in select * from jsonb_array_elements(coalesce(o -> 'itens', '[]'::jsonb)) loop
      v_iid := nullif(i ->> 'id', '')::uuid;
      if v_iid is not null and not exists (select 1 from qs_proposta_itens where id = v_iid and proposta_id = v_id) then v_iid := null; end if;
      if v_iid is null then
        insert into qs_proposta_itens (opcao_id, proposta_id, tipo) values (v_oid, v_id, coalesce(nullif(i ->> 'tipo', ''), 'outro')) returning id into v_iid;
      end if;
      update qs_proposta_itens set
        opcao_id    = v_oid,
        ordem       = n_i,
        tipo        = coalesce(nullif(i ->> 'tipo', ''), 'outro'),
        nome        = left(coalesce(i ->> 'nome', ''), 200),
        descricao   = left(coalesce(i ->> 'descricao', ''), 4000),
        data_inicio = nullif(i ->> 'data_inicio', '')::date,
        data_fim    = nullif(i ->> 'data_fim', '')::date,
        quantidade  = greatest(coalesce((i ->> 'quantidade')::int, 1), 1),
        valor_total = coalesce((i ->> 'valor_total')::numeric, 0),
        custo       = (i ->> 'custo')::numeric,
        lucro       = (i ->> 'lucro')::numeric,
        fornecedor  = nullif(left(i ->> 'fornecedor', 160), ''),
        incluso     = coalesce((i ->> 'incluso')::boolean, false),
        detalhes    = case when jsonb_typeof(i -> 'detalhes') = 'object' then i -> 'detalhes' else '{}'::jsonb end
      where id = v_iid;
      v_iids := v_iids || v_iid;
      n_i := n_i + 1;
    end loop;
  end loop;

  delete from qs_proposta_itens where proposta_id = v_id and not (id = any(v_iids));
  delete from qs_proposta_opcoes where proposta_id = v_id and not (id = any(v_oids));
  return v_id;
end;
$$;

-- ── Andamento ──────────────────────────────────────────────────────────────
--   quem MONTA:  pronta · rascunho · cancelada · enviada (só proposta do próprio time)
--   quem PEDIU:  aberta (abriu a versão atual) · ajuste (volta pra rascunho, com o
--                que mudar) · enviada (só depois de abrir)
--   os dois:     recusada · aprovada (fora do link) · visto (aviso de aprovação)
drop function if exists qs_proposta_status(uuid, text, uuid);
create or replace function qs_proposta_status(p_id uuid, p_acao text, p_opcao uuid default null, p_texto text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v      qs_propostas;
  s      qs_solicitacoes;
  monta  boolean;
  pede   boolean;
  outro  boolean;       -- pedido de outro time: passa por quem pediu
  v_txt  text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  select * into v from qs_propostas where id = p_id for update;
  if v.id is null then raise exception 'proposta-nao-encontrada'; end if;
  if v.solicitacao_id is not null then select * into s from qs_solicitacoes where id = v.solicitacao_id; end if;
  monta := qs_do_setor(v.setor) or v.criado_por = auth.uid();
  pede  := s.id is not null and (s.criado_por = auth.uid() or qs_do_setor(s.de_setor));
  outro := s.id is not null and s.de_setor <> v.setor;
  if not (monta or pede or v.enviada_por = auth.uid()) then raise exception 'sem-acesso'; end if;

  if p_acao = 'pronta' then
    if not monta then raise exception 'so-quem-monta'; end if;
    if not outro then raise exception 'acao-invalida'; end if;
    if v.status <> 'rascunho' then raise exception 'acao-invalida'; end if;
    update qs_propostas set status = 'pronta', pronta_em = now(), aberta_por = null, aberta_em = null, atualizado_em = now() where id = p_id;
    perform qs_proposta_avisar_sol(s.id, format('📄 Proposta nº %s pronta. Abra pra conferir e enviar ao cliente.', v.numero));

  elsif p_acao = 'aberta' then
    if not pede then return; end if;
    update qs_propostas set aberta_por = auth.uid(), aberta_em = now() where id = p_id and status = 'pronta';

  elsif p_acao = 'ajuste' then
    if not pede then raise exception 'sem-acesso'; end if;
    if v.status <> 'pronta' then raise exception 'acao-invalida'; end if;
    if v_txt is null then raise exception 'diga-o-ajuste'; end if;
    update qs_propostas set status = 'rascunho', pronta_em = null, aberta_por = null, aberta_em = null, atualizado_em = now() where id = p_id;
    perform qs_proposta_avisar_sol(s.id, format('✏️ Pediu ajuste na proposta nº %s: %s', v.numero, left(v_txt, 2000)));

  elsif p_acao = 'enviada' then
    if v.status in ('enviada', 'aprovada', 'recusada') then return; end if;   -- já foi: só reabre o link
    if outro then
      if not pede then raise exception 'quem-envia-e-quem-pediu'; end if;
      if v.status <> 'pronta' then raise exception 'ainda-nao-pronta'; end if;
      if v.aberta_por is distinct from auth.uid() then raise exception 'abra-antes'; end if;
    else
      if not monta then raise exception 'sem-acesso'; end if;
      if v.status <> 'rascunho' then raise exception 'acao-invalida'; end if;
    end if;
    update qs_propostas set status = 'enviada', enviada_em = coalesce(enviada_em, now()), enviada_por = auth.uid(), atualizado_em = now() where id = p_id;
    if s.id is not null then perform qs_proposta_avisar_sol(s.id, format('📤 Enviou a proposta nº %s ao cliente.', v.numero)); end if;

  elsif p_acao in ('cancelada', 'rascunho') then
    if not monta then raise exception 'so-quem-monta'; end if;
    update qs_propostas set status = p_acao, atualizado_em = now(), pronta_em = null, aberta_por = null, aberta_em = null,
           aprovada_opcao_id = case when p_acao = 'rascunho' then null else aprovada_opcao_id end,
           aprovada_em = case when p_acao = 'rascunho' then null else aprovada_em end
     where id = p_id;

  elsif p_acao = 'recusada' then
    update qs_propostas set status = 'recusada', atualizado_em = now() where id = p_id;
    if s.id is not null then perform qs_proposta_avisar_sol(s.id, format('❌ Cliente recusou a proposta nº %s.', v.numero)); end if;

  elsif p_acao = 'aprovada' then
    if not exists (select 1 from qs_proposta_opcoes where id = p_opcao and proposta_id = p_id) then raise exception 'opcao-invalida'; end if;
    update qs_propostas set status = 'aprovada', aprovada_opcao_id = p_opcao, aprovada_em = now(),
           aprovada_nome = null, aprovacao_vista_em = now(), atualizado_em = now() where id = p_id;
    if s.id is not null then perform qs_proposta_avisar_sol(s.id, format('✅ Cliente aprovou a proposta nº %s (marcado pelo time).', v.numero)); end if;

  elsif p_acao = 'visto' then
    update qs_propostas set aprovacao_vista_em = now()
     where id = p_id and aprovada_em is not null and (criado_por = auth.uid() or enviada_por = auth.uid());
  else
    raise exception 'acao-invalida';
  end if;
end;
$$;

-- Duplicar: também só quem monta (a cópia nasce rascunho, sem envio).
create or replace function qs_proposta_duplicar(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_novo uuid;
  o record;
  v_oid uuid;
begin
  if not qs_pode_propostas() then raise exception 'sem-acesso'; end if;
  if not exists (select 1 from qs_propostas where id = p_id and (qs_do_setor(setor) or criado_por = auth.uid())) then raise exception 'so-quem-monta'; end if;
  insert into qs_propostas (setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
                            observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome)
  select setor, titulo, destino, data_ida, data_volta, adultos, criancas, bebes, apresentacao,
         observacoes, esconder_precos, moeda, capa_url, solicitacao_id, cliente_id, viagem_id, lead_id, cliente_nome
    from qs_propostas where id = p_id
  returning id into v_novo;
  for o in select * from qs_proposta_opcoes where proposta_id = p_id order by ordem loop
    insert into qs_proposta_opcoes (proposta_id, ordem, titulo, descricao, recomendada, desconto, pagamentos)
    values (v_novo, o.ordem, o.titulo, o.descricao, o.recomendada, o.desconto, o.pagamentos) returning id into v_oid;
    insert into qs_proposta_itens (opcao_id, proposta_id, ordem, tipo, nome, descricao, data_inicio, data_fim, quantidade,
                                   valor_total, custo, lucro, fornecedor, incluso, detalhes)
    select v_oid, v_novo, ordem, tipo, nome, descricao, data_inicio, data_fim, quantidade,
           valor_total, custo, lucro, fornecedor, incluso, detalhes
      from qs_proposta_itens where opcao_id = o.id;
  end loop;
  return v_novo;
end;
$$;

revoke all on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid, text), qs_proposta_duplicar(uuid) from public, anon;
grant execute on function qs_proposta_salvar(jsonb), qs_proposta_status(uuid, text, uuid, text), qs_proposta_duplicar(uuid) to authenticated;
