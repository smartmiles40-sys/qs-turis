-- 0150_solicitacao_cliente_venda.sql
-- -----------------------------------------------------------------------------
-- CENTRAL: TODO PEDIDO AMARRADO AO CLIENTE E À VENDA (Bruno, 20/10/2026):
-- "devem ficar marcadas dentro da ficha daquele cliente, pois temos que ter o
-- controle de todas as funções que eles pedem" + "amarrar a qual venda é
-- aquela solicitação (se tiver)".
--
--   • qs_sol_buscar_clientes: qualquer setor acha o cliente pra amarrar o pedido
--     (Operações e Comercial NÃO leem rel_clientes — aqui volta só nome,
--     final do telefone e cidade/e-mail mascarado, o suficiente pra escolher);
--   • qs_sol_vendas_do_cliente: as vendas dele (comprador ou passageiro);
--   • qs_sol_acao('vincular'): amarra cliente/venda depois de criado;
--   • qs_sol_criar: pedido vindo do LEAD acha o cliente pelo telefone
--     (só quando bate com UM cliente).
-- -----------------------------------------------------------------------------

alter table qs_solicitacao_eventos drop constraint if exists qs_solicitacao_eventos_tipo_check;
alter table qs_solicitacao_eventos add constraint qs_solicitacao_eventos_tipo_check
  check (tipo in ('criada','aceita','passada','status','comentario','prazo','concluida','confirmada','reaberta','recusada','cancelada','vinculada'));

-- ── Achar o cliente ────────────────────────────────────────────────────────
create or replace function qs_sol_buscar_clientes(p_termo text)
returns table (id uuid, nome text, telefone_fim text, email_mascarado text, vendas int)
language plpgsql stable security definer set search_path = public as $$
declare t text := trim(coalesce(p_termo, '')); d text := regexp_replace(coalesce(p_termo, ''), '\D', '', 'g');
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then raise exception 'Sem acesso.'; end if;
  if length(t) < 2 then return; end if;
  return query
    select c.id, c.nome,
           nullif(right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 4), '') as telefone_fim,
           case when c.email like '%@%' then left(c.email, 2) || '•••@' || split_part(c.email, '@', 2) end as email_mascarado,
           (select count(*)::int from rel_viagens v where v.cliente_id = c.id) as vendas
      from rel_clientes c
     where c.mesclado_em_id is null and c.arquivado_em is null
       and ( (length(d) >= 4 and length(d) = length(regexp_replace(t, '[\s.\-/()+]', '', 'g'))
               and (regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') like '%' || d || '%' or regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') like '%' || d || '%'))
          or c.nome ilike '%' || t || '%'
          or c.email ilike '%' || t || '%')
     order by (c.nome ilike t || '%') desc, c.nome
     limit 15;
end $$;
grant execute on function qs_sol_buscar_clientes(text) to authenticated;

-- ── As vendas do cliente (comprador ou passageiro) ────────────────────────
create or replace function qs_sol_vendas_do_cliente(p_cliente uuid)
returns table (id uuid, titulo text, destino text, data_embarque date, servico text, fase text, status text, bitrix_deal_id text, comprador boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active) then raise exception 'Sem acesso.'; end if;
  return query
    select v.id, coalesce(nullif(v.expedicao, ''), v.titulo), v.destino, v.data_embarque, v.servico, v.fase, v.status, v.bitrix_deal_id::text,
           v.cliente_id = p_cliente
      from rel_viagens_v v
     where v.cliente_id = p_cliente
        or exists (select 1 from rel_viagem_passageiros p where p.viagem_id = v.id and p.cliente_id = p_cliente)
     order by (v.status = 'ativa' and v.fase in ('antes','em_viagem')) desc, v.data_embarque desc nulls last
     limit 40;
end $$;
grant execute on function qs_sol_vendas_do_cliente(uuid) to authenticated;

-- "Fulana · Islândia G1" a partir do que está amarrado.
create or replace function qs_sol_sobre(p_cliente uuid, p_viagem uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' · ',
           (select nome from rel_clientes where id = coalesce(p_cliente, (select cliente_id from rel_viagens where id = p_viagem))),
           (select nullif(coalesce(nullif(expedicao, ''), nullif(titulo, ''), destino), '') from rel_viagens where id = p_viagem)), '');
$$;

-- Cliente pelo telefone do lead — só se bater com exatamente UM cliente.
create or replace function qs_sol_cliente_do_lead(p_lead uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare f text; r uuid; n int;
begin
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) into f from qs_leads where id = p_lead;
  if f is null or length(f) < 8 then return null; end if;
  select min(c.id::text)::uuid, count(*) into r, n from rel_clientes c
   where c.mesclado_em_id is null and right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) = f;
  return case when n = 1 then r end;
end $$;

-- ── Criar: amarra o cliente do lead quando dá ─────────────────────────────
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

  if p_viagem is not null then p_cliente := coalesce(p_cliente, (select cliente_id from rel_viagens where id = p_viagem)); end if;
  if p_conversa is not null then p_cliente := coalesce(p_cliente, (select cliente_id from rel_wa_conversas where id = p_conversa)); end if;
  if p_lead is not null and p_cliente is null then p_cliente := qs_sol_cliente_do_lead(p_lead); end if;

  v_sobre := coalesce(v_sobre, qs_sol_sobre(p_cliente, p_viagem));
  if v_sobre is null and p_lead is not null then
    select coalesce(full_name, trim(concat_ws(' ', first_name, last_name))) into v_sobre from qs_leads where id = p_lead;
  end if;
  if v_sobre is null and p_conversa is not null then
    select coalesce(c.nome_contato, c.telefone) into v_sobre from rel_wa_conversas c where c.id = p_conversa;
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

-- ── Vincular depois (qualquer um dos dois setores) ─────────────────────────
-- p_viagem null = sem venda específica (só o cliente).
create or replace function qs_sol_vincular(p_id uuid, p_cliente uuid, p_viagem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s qs_solicitacoes; v_sobre text;
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not (qs_do_setor(s.para_setor) or qs_do_setor(s.de_setor) or s.criado_por = auth.uid() or s.responsavel_id = auth.uid()) then
    raise exception 'Sem acesso a essa solicitação.';
  end if;
  if p_viagem is not null then p_cliente := coalesce(p_cliente, (select cliente_id from rel_viagens where id = p_viagem)); end if;
  if p_cliente is null then raise exception 'Escolha o cliente.'; end if;
  v_sobre := qs_sol_sobre(p_cliente, p_viagem);
  update qs_solicitacoes set cliente_id = p_cliente, viagem_id = p_viagem, sobre_nome = coalesce(v_sobre, sobre_nome),
         atualizado_em = now(), atualizado_por = auth.uid() where id = p_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, autor_nome) values (p_id, 'vinculada', v_sobre, qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;
grant execute on function qs_sol_vincular(uuid, uuid, uuid) to authenticated;
