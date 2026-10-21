-- 0168 — Rooming das Expedições dentro do QS (21/10/2026).
-- No app antigo (RoomingBoard + actions.ts) cada mexida no rooming eram vários
-- deletes/inserts soltos, a capacidade do quarto só era checada na tela, a "chave
-- do hotel" tinha 3 versões diferentes e a numeração dos quartos embaralhava
-- (lote inserido com o mesmo created_at → ordem pelo uuid aleatório).
-- Aqui: funções atômicas (uma transação cada), com a MESMA chave de hotel
-- (nome sem espaços sobrando + check-in + check-out + extensão), checagem de
-- capacidade/extensão no banco e numeração ESTÁVEL: número de quarto nunca muda
-- sozinho. Quarto novo (ou que chega de outro hotel) pega o próximo número do
-- hotel (maior + 1, na ordem determinística número → created_at → id); excluir
-- deixa o buraco. Fechar buracos (1..n) só pelo botão "Renumerar" do hotel, que
-- mantém a ordem de todo mundo.
-- security invoker: quem chama passa pelas policies da 0160 (exp_tem_acesso /
-- is_readonly). A checagem explícita no começo só dá uma mensagem clara.
-- Só ADITIVO: cria funções. Não mexe em coluna nem em dado existente.

-- Nome do hotel normalizado (trim + colapsa espaços; vazio = null).
create or replace function public.exp_rooming_hotel(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '')
$$;

-- Chave única do "trecho" (hotel): a mesma que a tela usa.
create or replace function public.exp_rooming_chave(p_hotel text, p_ci date, p_co date, p_ext uuid)
returns text language sql immutable set search_path to 'public' as $$
  select coalesce(public.exp_rooming_hotel(p_hotel), '') || '|' || coalesce(p_ci::text, '') || '|'
      || coalesce(p_co::text, '') || '|' || coalesce(p_ext::text, '')
$$;

create or replace function public.exp_rooming_capacidade(p_tipo text)
returns int language sql immutable set search_path to 'public' as $$
  select case p_tipo when 'Single' then 1 when 'Twin' then 2 when 'Duplo' then 2 when 'Triplo' then 3
                     when 'Compartilhado' then 4 when 'Líder' then 2 else 1 end
$$;

-- Pode escrever nas Expedições? (mensagem que o front traduz)
create or replace function public.exp_rooming_checar_escrita()
returns void language plpgsql stable set search_path to 'public' as $$
begin
  if not exp_tem_acesso() or is_readonly() then
    raise exception 'permission denied: perfil só de leitura nas Expedições';
  end if;
end $$;

-- Renumera (1..n) os quartos de UM hotel, mantendo a ordem atual. Só pelo botão.
create or replace function public.exp_rooming_renumerar_hotel(p_exp uuid, p_ids uuid[])
returns int language plpgsql set search_path to 'public' as $$
declare v_n int;
begin
  perform exp_rooming_checar_escrita();
  with ord as (
    select id, row_number() over (
             order by nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint nulls last, numero, created_at, id
           )::text as novo
      from quartos where expedicao_id = p_exp and id = any(p_ids)
  )
  update quartos q set numero = ord.novo from ord where q.id = ord.id and q.numero is distinct from ord.novo;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Move quartos para um hotel/datas/extensão (renomear, redatar, editar 1 quarto).
-- Os que chegam entram no FIM da numeração do destino. Se um passageiro passa a
-- ter 2 quartos no mesmo hotel, ele fica no quarto que JÁ era do destino.
create or replace function public.exp_rooming_mover(p_exp uuid, p_ids uuid[], p_hotel text, p_ci date, p_co date, p_ext uuid)
returns void language plpgsql set search_path to 'public' as $$
declare v_chave text := exp_rooming_chave(p_hotel, p_ci, p_co, p_ext); v_max bigint;
begin
  perform exp_rooming_checar_escrita();
  select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0) into v_max
    from quartos where expedicao_id = p_exp and not (id = any(p_ids))
     and exp_rooming_chave(hotel_cidade, check_in, check_out, extensao_id) = v_chave;
  with ord as (
    select id, row_number() over (order by nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint nulls last, numero, created_at, id) as pos
      from quartos where expedicao_id = p_exp and id = any(p_ids)
  )
  update quartos q set hotel_cidade = exp_rooming_hotel(p_hotel), check_in = p_ci, check_out = p_co, extensao_id = p_ext,
         numero = (v_max + ord.pos)::text
    from ord where q.id = ord.id;
  -- passageiro com outro quarto no mesmo hotel: sai do quarto que acabou de chegar
  delete from passageiro_quarto pq
   where pq.quarto_id = any(p_ids)
     and exists (select 1 from passageiro_quarto o join quartos q2 on q2.id = o.quarto_id
                  where o.passageiro_id = pq.passageiro_id and not (o.quarto_id = any(p_ids))
                    and q2.expedicao_id = p_exp
                    and exp_rooming_chave(q2.hotel_cidade, q2.check_in, q2.check_out, q2.extensao_id) = v_chave);
end $$;

-- Criar 1 ou vários quartos (Novo quarto / Criar quartos automáticos / Adicionar quarto).
create or replace function public.exp_rooming_criar_quartos(
  p_exp uuid, p_hotel text, p_ci date, p_co date, p_tipo text, p_qtd int, p_ext uuid default null, p_obs text default null)
returns int language plpgsql set search_path to 'public' as $$
declare v_chave text := exp_rooming_chave(p_hotel, p_ci, p_co, p_ext); v_max bigint;
begin
  perform exp_rooming_checar_escrita();
  if p_qtd is null or p_qtd < 1 then raise exception 'Mínimo 1 quarto.'; end if;
  if p_qtd > 100 then raise exception 'Máximo 100 quartos por vez.'; end if;
  if p_ci is not null and p_co is not null and p_co < p_ci then raise exception 'O check-out não pode ser antes do check-in.'; end if;
  select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0) into v_max
    from quartos where expedicao_id = p_exp and exp_rooming_chave(hotel_cidade, check_in, check_out, extensao_id) = v_chave;
  insert into quartos (expedicao_id, numero, tipo, hotel_cidade, check_in, check_out, status, observacoes, extensao_id)
  select p_exp, (v_max + g)::text, p_tipo::tipo_quarto, exp_rooming_hotel(p_hotel), p_ci, p_co, 'ativo', nullif(btrim(p_obs), ''), p_ext
    from generate_series(1, p_qtd) g;
  return p_qtd;
end $$;

-- Editar um quarto (tipo, hotel, datas, extensão, status, observações).
-- Muda de hotel → vai pro fim da numeração do novo hotel.
-- Tipo menor que a ocupação → erro. Status "cancelado" → libera os passageiros.
create or replace function public.exp_rooming_atualizar_quarto(
  p_quarto uuid, p_tipo text, p_hotel text, p_ci date, p_co date, p_ext uuid, p_status text, p_obs text)
returns void language plpgsql set search_path to 'public' as $$
declare q quartos; v_ocup int; v_cap int;
begin
  perform exp_rooming_checar_escrita();
  select * into q from quartos where id = p_quarto for update;
  if not found then raise exception 'Quarto não encontrado.'; end if;
  if p_ci is not null and p_co is not null and p_co < p_ci then raise exception 'O check-out não pode ser antes do check-in.'; end if;
  if lower(coalesce(p_status, '')) = 'cancelado' then
    delete from passageiro_quarto where quarto_id = p_quarto;
  else
    select count(*) into v_ocup from passageiro_quarto where quarto_id = p_quarto;
    v_cap := exp_rooming_capacidade(p_tipo);
    if v_ocup > v_cap then
      raise exception 'O quarto tem % pessoa(s) e um % comporta %. Tire alguém antes de trocar o tipo.', v_ocup, p_tipo, v_cap;
    end if;
  end if;
  update quartos set tipo = p_tipo::tipo_quarto, status = coalesce(nullif(btrim(p_status), ''), 'ativo'),
         observacoes = nullif(btrim(p_obs), '')
   where id = p_quarto;
  if exp_rooming_chave(q.hotel_cidade, q.check_in, q.check_out, q.extensao_id) <> exp_rooming_chave(p_hotel, p_ci, p_co, p_ext) then
    perform exp_rooming_mover(q.expedicao_id, array[p_quarto], p_hotel, p_ci, p_co, p_ext);
  elsif q.hotel_cidade is distinct from exp_rooming_hotel(p_hotel) then
    update quartos set hotel_cidade = exp_rooming_hotel(p_hotel) where id = p_quarto;
  end if;
end $$;

-- Renomear um hotel inteiro (todos os quartos do trecho).
create or replace function public.exp_rooming_renomear_hotel(p_exp uuid, p_ids uuid[], p_nome text)
returns void language plpgsql set search_path to 'public' as $$
declare q quartos;
begin
  perform exp_rooming_checar_escrita();
  if exp_rooming_hotel(p_nome) is null then raise exception 'Informe o nome do hotel.'; end if;
  select * into q from quartos where expedicao_id = p_exp and id = any(p_ids) limit 1;
  if not found then raise exception 'Nenhum quarto encontrado.'; end if;
  perform exp_rooming_mover(p_exp, p_ids, p_nome, q.check_in, q.check_out, q.extensao_id);
end $$;

-- Mudar check-in/check-out de um hotel inteiro.
create or replace function public.exp_rooming_redatar_hotel(p_exp uuid, p_ids uuid[], p_ci date, p_co date)
returns void language plpgsql set search_path to 'public' as $$
declare q quartos;
begin
  perform exp_rooming_checar_escrita();
  if p_ci is not null and p_co is not null and p_co < p_ci then raise exception 'O check-out não pode ser antes do check-in.'; end if;
  select * into q from quartos where expedicao_id = p_exp and id = any(p_ids) limit 1;
  if not found then raise exception 'Nenhum quarto encontrado.'; end if;
  perform exp_rooming_mover(p_exp, p_ids, q.hotel_cidade, p_ci, p_co, q.extensao_id);
end $$;

-- Excluir 1 quarto ou o hotel inteiro (com as alocações). Os outros números não mudam.
create or replace function public.exp_rooming_excluir_quartos(p_exp uuid, p_ids uuid[])
returns int language plpgsql set search_path to 'public' as $$
declare v_n int;
begin
  perform exp_rooming_checar_escrita();
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Nenhum quarto para excluir.'; end if;
  update passageiros set quarto_id = null where quarto_id = any(p_ids);   -- campo legado
  delete from passageiro_quarto where quarto_id = any(p_ids);
  delete from quartos where expedicao_id = p_exp and id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Alocar 1 passageiro (ou a conexão inteira) num quarto. Tira os mesmos
-- passageiros de outro quarto do MESMO hotel. Confere capacidade (contando quem
-- já está), extensão contratada, quarto cancelado e reserva cancelada.
create or replace function public.exp_rooming_alocar(p_pax uuid[], p_quarto uuid)
returns void language plpgsql set search_path to 'public' as $$
declare q quartos; v_chave text; v_cap int; v_fixos int; v_n int; v_nome text;
begin
  perform exp_rooming_checar_escrita();
  select * into q from quartos where id = p_quarto for update;
  if not found then raise exception 'Quarto não encontrado.'; end if;
  if lower(q.status) = 'cancelado' then raise exception 'Este quarto está cancelado. Reative-o antes de alocar.'; end if;
  select count(*) into v_n from passageiros where id = any(p_pax) and expedicao_id = q.expedicao_id and status_reserva::text <> 'Cancelado';
  if v_n <> coalesce(array_length(p_pax, 1), 0) or v_n = 0 then raise exception 'Passageiro inválido para esta expedição.'; end if;
  if q.extensao_id is not null then
    select p.nome_completo into v_nome from passageiros p
     where p.id = any(p_pax)
       and not exists (select 1 from passageiro_extensao pe where pe.passageiro_id = p.id and pe.extensao_id = q.extensao_id)
     limit 1;
    if v_nome is not null then raise exception '% não contratou a extensão deste hotel.', v_nome; end if;
  end if;
  v_cap := exp_rooming_capacidade(q.tipo::text);
  select count(*) into v_fixos from passageiro_quarto where quarto_id = p_quarto and not (passageiro_id = any(p_pax));
  if v_fixos + v_n > v_cap then
    if v_n > 1 then
      raise exception 'São % pessoas que viajam juntas e o quarto (%) comporta %. Use um quarto maior ou desfaça a conexão.', v_n, q.tipo, v_cap;
    else
      raise exception 'Quarto cheio: % comporta no máximo % pessoa(s).', q.tipo, v_cap;
    end if;
  end if;
  v_chave := exp_rooming_chave(q.hotel_cidade, q.check_in, q.check_out, q.extensao_id);
  delete from passageiro_quarto pq using quartos q2
   where q2.id = pq.quarto_id and pq.passageiro_id = any(p_pax) and q2.expedicao_id = q.expedicao_id
     and exp_rooming_chave(q2.hotel_cidade, q2.check_in, q2.check_out, q2.extensao_id) = v_chave;
  insert into passageiro_quarto (passageiro_id, quarto_id) select unnest(p_pax), p_quarto;
end $$;

-- Tirar passageiros do quarto em um hotel (arrastar pra "Sem quarto").
create or replace function public.exp_rooming_desalocar(p_pax uuid[], p_quartos uuid[])
returns void language plpgsql set search_path to 'public' as $$
begin
  perform exp_rooming_checar_escrita();
  delete from passageiro_quarto where passageiro_id = any(p_pax) and quarto_id = any(p_quartos);
end $$;

-- Duplicar quartos (com os mesmos passageiros) para outro hotel/datas.
-- Copia também a extensão. Entram no fim da numeração do destino. Quem já tem
-- quarto no hotel de destino continua onde está (não duplica).
create or replace function public.exp_rooming_duplicar(p_exp uuid, p_ids uuid[], p_hotel text, p_ci date, p_co date)
returns int language plpgsql set search_path to 'public' as $$
declare v_ext uuid; v_chave text; v_max bigint; v_n int;
begin
  perform exp_rooming_checar_escrita();
  if exp_rooming_hotel(p_hotel) is null then raise exception 'Informe o hotel de destino.'; end if;
  if p_ci is not null and p_co is not null and p_co < p_ci then raise exception 'O check-out não pode ser antes do check-in.'; end if;
  select extensao_id into v_ext from quartos where expedicao_id = p_exp and id = any(p_ids) limit 1;
  v_chave := exp_rooming_chave(p_hotel, p_ci, p_co, v_ext);
  select coalesce(max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), 0) into v_max
    from quartos where expedicao_id = p_exp and exp_rooming_chave(hotel_cidade, check_in, check_out, extensao_id) = v_chave;
  with src as (
    select q.id as origem, gen_random_uuid() as novo, q.tipo, q.status, q.observacoes, q.extensao_id,
           row_number() over (order by nullif(regexp_replace(q.numero, '\D', '', 'g'), '')::bigint nulls last, q.numero, q.created_at, q.id) as pos
      from quartos q where q.expedicao_id = p_exp and q.id = any(p_ids)
  ), ins as (
    insert into quartos (id, expedicao_id, numero, tipo, hotel_cidade, check_in, check_out, status, observacoes, extensao_id)
    select novo, p_exp, (v_max + pos)::text, tipo, exp_rooming_hotel(p_hotel), p_ci, p_co, status, observacoes, extensao_id from src
    returning id
  ), aloc as (
    insert into passageiro_quarto (passageiro_id, quarto_id)
    select distinct on (pq.passageiro_id) pq.passageiro_id, s.novo
      from passageiro_quarto pq join src s on s.origem = pq.quarto_id
     where not exists (select 1 from passageiro_quarto o join quartos q2 on q2.id = o.quarto_id
                        where o.passageiro_id = pq.passageiro_id and q2.expedicao_id = p_exp
                          and exp_rooming_chave(q2.hotel_cidade, q2.check_in, q2.check_out, q2.extensao_id) = v_chave)
     order by pq.passageiro_id, s.pos
    returning 1
  )
  select (select count(*) from ins) into v_n;
  return v_n;
end $$;

-- "Viajam juntas": tira p_remover da conexão (dissolve se sobrar 1) e depois
-- junta p_conectar numa conexão só (absorvendo as conexões que eles já tinham).
-- Serve pra Nova conexão, Editar conexão e Vincular acompanhante.
create or replace function public.exp_rooming_conexao(p_exp uuid, p_remover uuid[], p_conectar uuid[])
returns void language plpgsql set search_path to 'public' as $$
declare v_tok uuid; v_tokens uuid[]; v_n int;
begin
  perform exp_rooming_checar_escrita();
  if coalesce(array_length(p_remover, 1), 0) > 0 then
    select array_agg(distinct conexao_viagem_id) into v_tokens from passageiros
     where expedicao_id = p_exp and id = any(p_remover) and conexao_viagem_id is not null;
    update passageiros set conexao_viagem_id = null where expedicao_id = p_exp and id = any(p_remover) and conexao_viagem_id is not null;
    if v_tokens is not null then
      update passageiros p set conexao_viagem_id = null
       where p.expedicao_id = p_exp and p.conexao_viagem_id = any(v_tokens)
         and (select count(*) from passageiros o where o.expedicao_id = p_exp and o.conexao_viagem_id = p.conexao_viagem_id) < 2;
    end if;
  end if;
  if coalesce(array_length(p_conectar, 1), 0) > 0 then
    if array_length(p_conectar, 1) < 2 then raise exception 'Selecione ao menos 2 pessoas.'; end if;
    select count(*) into v_n from passageiros where expedicao_id = p_exp and id = any(p_conectar);
    if v_n < 2 then raise exception 'Passageiros inválidos.'; end if;
    select array_agg(distinct conexao_viagem_id) into v_tokens from passageiros
     where expedicao_id = p_exp and id = any(p_conectar) and conexao_viagem_id is not null;
    v_tok := case when coalesce(array_length(v_tokens, 1), 0) = 1 then v_tokens[1] else gen_random_uuid() end;
    update passageiros set conexao_viagem_id = v_tok
     where expedicao_id = p_exp
       and (id = any(p_conectar) or (v_tokens is not null and conexao_viagem_id = any(v_tokens)))
       and conexao_viagem_id is distinct from v_tok;
  end if;
end $$;

-- Desfazer uma conexão inteira (não mexe nas alocações de quarto).
create or replace function public.exp_rooming_desfazer_conexao(p_exp uuid, p_conexao uuid)
returns void language plpgsql set search_path to 'public' as $$
begin
  perform exp_rooming_checar_escrita();
  update passageiros set conexao_viagem_id = null where expedicao_id = p_exp and conexao_viagem_id = p_conexao;
end $$;

revoke execute on function
  public.exp_rooming_checar_escrita(), public.exp_rooming_renumerar_hotel(uuid, uuid[]),
  public.exp_rooming_mover(uuid, uuid[], text, date, date, uuid),
  public.exp_rooming_criar_quartos(uuid, text, date, date, text, int, uuid, text),
  public.exp_rooming_atualizar_quarto(uuid, text, text, date, date, uuid, text, text),
  public.exp_rooming_renomear_hotel(uuid, uuid[], text), public.exp_rooming_redatar_hotel(uuid, uuid[], date, date),
  public.exp_rooming_excluir_quartos(uuid, uuid[]), public.exp_rooming_alocar(uuid[], uuid),
  public.exp_rooming_desalocar(uuid[], uuid[]), public.exp_rooming_duplicar(uuid, uuid[], text, date, date),
  public.exp_rooming_conexao(uuid, uuid[], uuid[]), public.exp_rooming_desfazer_conexao(uuid, uuid)
  from public, anon;

grant execute on function
  public.exp_rooming_renumerar_hotel(uuid, uuid[]),
  public.exp_rooming_criar_quartos(uuid, text, date, date, text, int, uuid, text),
  public.exp_rooming_atualizar_quarto(uuid, text, text, date, date, uuid, text, text),
  public.exp_rooming_renomear_hotel(uuid, uuid[], text), public.exp_rooming_redatar_hotel(uuid, uuid[], date, date),
  public.exp_rooming_excluir_quartos(uuid, uuid[]), public.exp_rooming_alocar(uuid[], uuid),
  public.exp_rooming_desalocar(uuid[], uuid[]), public.exp_rooming_duplicar(uuid, uuid[], text, date, date),
  public.exp_rooming_conexao(uuid, uuid[], uuid[]), public.exp_rooming_desfazer_conexao(uuid, uuid)
  to authenticated;
-- auxiliares chamadas de dentro das funções acima (invoker → o usuário precisa de execute)
grant execute on function public.exp_rooming_checar_escrita(),
  public.exp_rooming_mover(uuid, uuid[], text, date, date, uuid) to authenticated;
