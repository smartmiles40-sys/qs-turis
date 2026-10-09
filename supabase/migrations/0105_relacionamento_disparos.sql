-- =============================================================================
-- 0105 — RELACIONAMENTO, FASE 4: disparos (público e alvos das automações)
-- =============================================================================
-- 1. "PARAR" também na CONVERSA: o cliente pode pedir pra sair antes de ter
--    ficha. O disparo confere a ficha E as conversas com o mesmo telefone.
-- 2. rel_disparo_publico(publico)       → quem a campanha atinge
-- 3. rel_automacao_alvos(automacao, dia) → quem a automação atinge naquele dia
-- As duas são SÓ do servidor (o envio passa por /api/rel-disparos). Devolvem a
-- coluna `optout` em vez de esconder: o servidor registra "pulado" com motivo.
-- =============================================================================

alter table rel_wa_conversas add column if not exists optout_em timestamptz;

-- O cliente pediu pra não receber disparo? (na ficha ou em alguma conversa)
create or replace function rel_cliente_optout(p_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from rel_clientes where id = p_cliente and optout_em is not null)
      or exists (select 1 from rel_clientes c join rel_wa_conversas w on w.telefone = c.telefone
                  where c.id = p_cliente and w.optout_em is not null);
$$;
revoke all on function rel_cliente_optout(uuid) from public, anon, authenticated;

-- Público de uma campanha. `publico`:
--   {"tipo": "todos"}
--   {"tipo": "viagem", "expedicao"?, "destino"?, "embarque_de"?, "embarque_ate"?, "fase"?: "antes"|"em_viagem"|"concluida"}
--   {"tipo": "aniversariantes_mes", "mes"?: 1..12}
--   {"tipo": "clientes", "clientes": [uuid, ...]}
-- Sempre: ficha viva, um registro por cliente. Sem telefone também volta (o
-- servidor marca "pulado: sem telefone"); a prévia conta só quem recebe.
create or replace function rel_disparo_publico(p_publico jsonb)
returns table (cliente_id uuid, nome text, telefone text, viagem_id uuid, optout boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  tipo text := coalesce(p_publico ->> 'tipo', 'todos');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tipo = 'viagem' then
    return query
      select distinct on (c.id) c.id, c.nome, c.telefone, v.id, rel_cliente_optout(c.id)
        from rel_viagem_passageiros p
        join rel_viagens v on v.id = p.viagem_id
        join rel_clientes c on c.id = p.cliente_id
       where c.mesclado_em_id is null
         and v.status = 'ativa'
         and (nullif(p_publico ->> 'expedicao', '') is null or v.expedicao ilike '%' || (p_publico ->> 'expedicao') || '%')
         and (nullif(p_publico ->> 'destino', '') is null or v.destino ilike '%' || (p_publico ->> 'destino') || '%' or v.titulo ilike '%' || (p_publico ->> 'destino') || '%')
         and (nullif(p_publico ->> 'embarque_de', '') is null or v.data_embarque >= (p_publico ->> 'embarque_de')::date)
         and (nullif(p_publico ->> 'embarque_ate', '') is null or v.data_embarque <= (p_publico ->> 'embarque_ate')::date)
         and (nullif(p_publico ->> 'fase', '') is null
              or (p_publico ->> 'fase' = 'antes' and v.data_embarque > hoje)
              or (p_publico ->> 'fase' = 'em_viagem' and hoje between v.data_embarque and coalesce(v.data_retorno, v.data_embarque))
              or (p_publico ->> 'fase' = 'concluida' and coalesce(v.data_retorno, v.data_embarque) < hoje))
       order by c.id, v.data_embarque nulls last;
  elsif tipo = 'aniversariantes_mes' then
    return query
      select c.id, c.nome, c.telefone, null::uuid, rel_cliente_optout(c.id)
        from rel_clientes c
       where c.mesclado_em_id is null and c.nascimento is not null
         and extract(month from c.nascimento)::int = coalesce(nullif(p_publico ->> 'mes', '')::int, extract(month from hoje)::int);
  elsif tipo = 'clientes' then
    return query
      select c.id, c.nome, c.telefone, null::uuid, rel_cliente_optout(c.id)
        from rel_clientes c
       where c.mesclado_em_id is null
         and c.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_publico -> 'clientes', '[]')) x);
  else
    return query
      select c.id, c.nome, c.telefone, null::uuid, rel_cliente_optout(c.id)
        from rel_clientes c
       where c.mesclado_em_id is null;
  end if;
end;
$$;
revoke all on function rel_disparo_publico(jsonb) from public, anon, authenticated;

-- Quem uma automação atinge num dia (padrão: hoje em São Paulo).
create or replace function rel_automacao_alvos(p_automacao uuid, p_dia date default null)
returns table (cliente_id uuid, nome text, telefone text, viagem_id uuid, optout boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  a    rel_automacoes;
  hoje date := coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date);
  bis  boolean;
begin
  select * into a from rel_automacoes where id = p_automacao;
  if a.id is null then return; end if;

  if a.gatilho = 'aniversario' then
    -- Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.
    bis := extract(day from (make_date(extract(year from hoje)::int, 3, 1) - 1))::int = 29;
    return query
      select c.id, c.nome, c.telefone, null::uuid, rel_cliente_optout(c.id)
        from rel_clientes c
       where c.mesclado_em_id is null and c.nascimento is not null
         and (to_char(c.nascimento, 'MM-DD') = to_char(hoje, 'MM-DD')
              or (not bis and to_char(c.nascimento, 'MM-DD') = '02-29' and to_char(hoje, 'MM-DD') = '02-28'));
    return;
  end if;

  return query
    select c.id, c.nome, c.telefone, v.id, rel_cliente_optout(c.id)
      from rel_viagens v
      join rel_viagem_passageiros p on p.viagem_id = v.id
      join rel_clientes c on c.id = p.cliente_id
     where v.status = 'ativa' and c.mesclado_em_id is null
       and case a.gatilho
             when 'antes_embarque'     then v.data_embarque = hoje + a.dias
             when 'apos_retorno'       then coalesce(v.data_retorno, v.data_embarque) = hoje - a.dias
             when 'pos_venda'          then v.data_venda = hoje - a.dias
             when 'aniversario_viagem' then v.data_embarque = (hoje - interval '1 year')::date
             else false
           end;
end;
$$;
revoke all on function rel_automacao_alvos(uuid, date) from public, anon, authenticated;
