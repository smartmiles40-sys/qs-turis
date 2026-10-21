-- 0159_prazo_por_prioridade.sql
-- -----------------------------------------------------------------------------
-- PRAZO POR PRIORIDADE (Bruno 21/10/2026): "a prioridade para conseguirmos ter
-- já estabelecido os prazos para cada tipo de urgência".
--
-- Cada tipo tem 3 prazos em horas úteis: prazo_horas (Normal), prazo_alta_horas
-- e prazo_urgente_horas. Começam em metade e um quarto do Normal; o gestor muda
-- em "Tipos e prazos". O prazo do pedido nasce da prioridade escolhida.
-- Quem pediu marcar "data certa" (prazo_manual) manda sobre a tabela.
-- Ao enviar ajustes (volta pra Nova solicitação), o prazo recomeça — o tempo
-- esperando quem pediu não conta contra quem recebe.
-- -----------------------------------------------------------------------------

alter table qs_solicitacao_tipos
  add column if not exists prazo_alta_horas int check (prazo_alta_horas between 1 and 400),
  add column if not exists prazo_urgente_horas int check (prazo_urgente_horas between 1 and 400);

update qs_solicitacao_tipos set
  prazo_alta_horas = coalesce(prazo_alta_horas, greatest(1, ceil(prazo_horas / 2.0)::int)),
  prazo_urgente_horas = coalesce(prazo_urgente_horas, greatest(1, ceil(prazo_horas / 4.0)::int));

alter table qs_solicitacoes add column if not exists prazo_manual boolean not null default false;

create or replace function qs_sol_horas(p_tipo text, p_prioridade text)
returns int language sql stable set search_path = public as $$
  select case coalesce(p_prioridade, 'normal')
           when 'urgente' then coalesce(prazo_urgente_horas, greatest(1, ceil(prazo_horas / 4.0)::int))
           when 'alta'    then coalesce(prazo_alta_horas, greatest(1, ceil(prazo_horas / 2.0)::int))
           else prazo_horas end
    from qs_solicitacao_tipos where id = p_tipo;
$$;

create or replace function qs_sol_criar(p_de text, p_para text, p_tipo text, p_titulo text, p_descricao text,
  p_prioridade text default 'normal', p_prazo timestamptz default null, p_cliente uuid default null, p_viagem uuid default null,
  p_lead uuid default null, p_conversa uuid default null, p_sobre text default null, p_formulario jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_horas int; v_form text; v_prazo timestamptz; v_sobre text := nullif(trim(coalesce(p_sobre, '')), '');
begin
  if not qs_do_setor(p_de) then raise exception 'Você não é desse setor.'; end if;
  if p_de = p_para then raise exception 'Escolha outro setor (o pedido é pra outro setor).'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  select formulario into v_form from qs_solicitacao_tipos where id = p_tipo and setor = p_para and ativo;
  if not found then raise exception 'Tipo de pedido inválido pra esse setor.'; end if;
  v_horas := qs_sol_horas(p_tipo, p_prioridade);
  if v_form = 'cotacao' and (p_formulario is null or jsonb_typeof(p_formulario) <> 'object') then
    raise exception 'Preencha o formulário da cotação.';
  end if;
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

  insert into qs_solicitacoes (de_setor, para_setor, tipo_id, titulo, descricao, prioridade, prazo, prazo_manual,
                               cliente_id, viagem_id, lead_id, conversa_id, sobre_nome, criado_por, atualizado_por, formulario)
  values (p_de, p_para, p_tipo, trim(p_titulo), coalesce(trim(p_descricao), ''), coalesce(p_prioridade, 'normal'), v_prazo, p_prazo is not null,
          p_cliente, p_viagem, p_lead, p_conversa, v_sobre, auth.uid(), auth.uid(), p_formulario)
  returning id into v_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
    values (v_id, 'criada', p_para, nullif(trim(coalesce(p_descricao, '')), ''), qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (v_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
  return v_id;
end $$;

create or replace function qs_sol_ajustar(p_id uuid, p_titulo text, p_descricao text, p_formulario jsonb, p_prioridade text, p_texto text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s qs_solicitacoes; v_texto text := nullif(trim(coalesce(p_texto, '')), ''); v_prio text;
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not (s.criado_por = auth.uid() or qs_do_setor(s.de_setor)) then raise exception 'Só quem pediu ajusta o pedido.'; end if;
  if not (s.status = 'aguardando' and s.aguardando_quem = 'solicitante') then raise exception 'Esse pedido não está aguardando ajuste.'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  v_prio := coalesce(p_prioridade, s.prioridade);
  update qs_solicitacoes set titulo = trim(p_titulo), descricao = coalesce(trim(p_descricao), ''),
         formulario = coalesce(p_formulario, formulario), prioridade = v_prio,
         prazo = case when prazo_manual then prazo else qs_somar_minutos_uteis(now(), qs_sol_horas(tipo_id, v_prio) * 60) end,
         status = 'nova', aguardando_quem = null, atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome)
    values (p_id, 'ajustada', 'aguardando:solicitante', 'nova', v_texto, qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;
