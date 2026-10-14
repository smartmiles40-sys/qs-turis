-- 0129_financeiro_travas.sql
-- -----------------------------------------------------------------------------
-- (Aplicada no banco em 4 partes: 0129a_telefone, 0129b_enviar, 0129c_ligar_mudar, 0129d_policies_fixar.)
-- Travas do Financeiro (revisão de 14/10/2026 da 0127):
--   • Ninguém do Financeiro "puxa" conversa do Relacionamento por conta própria:
--     só o Relacionamento (ou admin) passa a conversa. O Financeiro só liga ao
--     atendimento uma conversa que NASCEU desse atendimento (sem mensagem antes).
--   • fin_enviar: só quem tem a área usa ficha/conversa; lead só quem enxerga o
--     lead; origem tem que ser uma área da pessoa; marketing não envia.
--   • Etiquetas/listas/SLA: o Financeiro só enxerga/mexe nas conversas dele.
--   • Resolver/cancelar o último atendimento devolve a conversa ao Rel.
--   • Fixar mensagem vale pra quem vê a conversa.
--   • Telefone normalizado (55 + com/sem nono dígito) pra não abrir dois.
-- -----------------------------------------------------------------------------

-- ── Telefone ───────────────────────────────────────────────────────────────
create or replace function fin_fone(p text) returns text language sql immutable as $$
  select case
    when d is null or d = '' then null
    when length(d) in (10, 11) then '55' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;
-- O mesmo celular BR com e sem o nono dígito.
create or replace function fin_fones(p text) returns text[] language sql immutable as $$
  select case
    when f ~ '^55\d{2}9\d{8}$' then array[f, substr(f, 1, 4) || substr(f, 6)]
    when f ~ '^55\d{2}[6-9]\d{7}$' then array[f, substr(f, 1, 4) || '9' || substr(f, 5)]
    when f is null then array[]::text[]
    else array[f] end
  from (select fin_fone(p) as f) x;
$$;

-- ── Enviar ao Financeiro ───────────────────────────────────────────────────
create or replace function fin_enviar(
  p_origem text, p_motivo text, p_descricao text,
  p_cliente uuid default null, p_lead uuid default null, p_conversa uuid default null,
  p_nome text default null, p_telefone text default null, p_prioridade text default 'normal'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_nome text := coalesce(nullif(trim(p_nome), ''), ''); v_fone text := fin_fone(p_telefone);
  eu qs_users;
  v_admin boolean;
begin
  select * into eu from qs_users where id = auth.uid() and is_active;
  if eu.id is null then raise exception 'Sem acesso.'; end if;
  if eu.role = 'marketing' then raise exception 'Seu perfil não envia ao Financeiro.'; end if;
  v_admin := eu.role = 'admin';
  -- A origem é uma área da pessoa (admin manda de qualquer uma).
  if p_origem not in ('comercial','relacionamento','operacional','financeiro') then raise exception 'Origem inválida.'; end if;
  if not v_admin and not (p_origem = any(coalesce(eu.setores, array['comercial']))) then
    raise exception 'Você não é da área %.', p_origem;
  end if;
  -- Ficha e conversa: só quem tem a área. Lead: só quem enxerga o lead.
  if p_cliente is not null and not (rel_tem_acesso() or fin_tem_acesso()) then raise exception 'Sem acesso à ficha.'; end if;
  if p_conversa is not null and not rel_tem_acesso() then raise exception 'Só o Relacionamento passa a conversa ao Financeiro.'; end if;
  if p_lead is not null and not (v_admin or eu.role = 'gestor'
       or exists (select 1 from qs_leads where id = p_lead and owner_id = auth.uid())) then
    raise exception 'Esse lead não é seu.';
  end if;
  if p_cliente is null and p_lead is null and p_conversa is null and v_fone is null then
    raise exception 'Diga quem é o cliente (ficha, lead, conversa ou telefone).';
  end if;
  if p_cliente is not null then
    select coalesce(nullif(v_nome, ''), nome), coalesce(v_fone, fin_fone(telefone)) into v_nome, v_fone from rel_clientes where id = p_cliente;
  end if;
  if p_lead is not null then
    select coalesce(nullif(v_nome, ''), full_name, trim(concat_ws(' ', first_name, last_name))), coalesce(v_fone, fin_fone(phone)) into v_nome, v_fone from qs_leads where id = p_lead;
  end if;
  if p_conversa is not null then
    select coalesce(nullif(v_nome, ''), coalesce(cl.nome, c.nome_contato, c.telefone)), coalesce(v_fone, fin_fone(c.telefone)), coalesce(p_cliente, c.cliente_id)
      into v_nome, v_fone, p_cliente
      from rel_wa_conversas c left join rel_clientes cl on cl.id = c.cliente_id where c.id = p_conversa;
  end if;
  select id into v_id from fin_atendimentos
   where status not in ('resolvido','cancelado')
     and ((p_cliente is not null and cliente_id = p_cliente) or (p_lead is not null and lead_id = p_lead)
          or (p_conversa is not null and conversa_id = p_conversa) or (v_fone is not null and telefone = any(fin_fones(v_fone))))
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

-- ── Ligar conversa: só a que nasceu do atendimento ─────────────────────────
create or replace function fin_ligar_conversa(p_id uuid, p_conversa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a fin_atendimentos; c rel_wa_conversas;
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro.'; end if;
  select * into a from fin_atendimentos where id = p_id for update;
  if a.id is null or a.status in ('resolvido','cancelado') then raise exception 'Atendimento fechado ou inexistente.'; end if;
  select * into c from rel_wa_conversas where id = p_conversa for update;
  if c.id is null then raise exception 'Conversa não encontrada.'; end if;
  if c.setor <> 'financeiro' and not rel_tem_acesso() then
    -- Só a conversa que NASCEU agora, com o telefone do atendimento.
    if not (c.telefone = any(fin_fones(a.telefone))) then raise exception 'Essa conversa não é desse cliente.'; end if;
    if exists (select 1 from rel_wa_mensagens m where m.conversa_id = c.id and m.enviada_em < a.criado_em) then
      raise exception 'Esse cliente já conversa com o Relacionamento — peça pra eles enviarem a conversa ao Financeiro.';
    end if;
  end if;
  update fin_atendimentos set conversa_id = p_conversa, atualizado_em = now() where id = p_id;
  update rel_wa_conversas set setor = 'financeiro', setor_desde = now(), atendente_id = auth.uid() where id = p_conversa;
  insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome) values (p_id, 'conversa', 'Conversa do WhatsApp ligada', fin_eu());
end $$;

-- ── Resolver/cancelar o último devolve a conversa ──────────────────────────
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
    -- Fechou o último atendimento da conversa → ela volta pro Relacionamento.
    if p_status in ('resolvido','cancelado') and a.conversa_id is not null
       and not exists (select 1 from fin_atendimentos x where x.conversa_id = a.conversa_id and x.id <> p_id and x.status not in ('resolvido','cancelado')) then
      update rel_wa_conversas set setor = 'relacionamento', setor_desde = now(), atendente_id = null where id = a.conversa_id and setor = 'financeiro';
      if found then
        insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome) values (p_id, 'devolvido', 'Conversa voltou ao Relacionamento', fin_eu());
      end if;
    end if;
  end if;
  if nullif(trim(coalesce(p_nota, '')), '') is not null then
    insert into fin_atendimento_eventos (atendimento_id, tipo, texto, autor_nome) values (p_id, 'nota', trim(p_nota), fin_eu());
    update fin_atendimentos set atualizado_em = now() where id = p_id;
  end if;
end $$;

-- ── Etiquetas / listas / SLA: só das conversas que a pessoa vê ─────────────
create or replace function wa_ve_conversa_id(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rel_wa_conversas c where c.id = p and wa_ve_conversa(c.setor));
$$;
grant execute on function wa_ve_conversa_id(uuid) to authenticated;

drop policy if exists rel_wa_conversa_etiquetas_tudo on rel_wa_conversa_etiquetas;
create policy rel_wa_conversa_etiquetas_tudo on rel_wa_conversa_etiquetas for all to authenticated
  using (wa_ve_conversa_id(conversa_id)) with check (wa_ve_conversa_id(conversa_id));
drop policy if exists rel_wa_lista_conversas_tudo on rel_wa_lista_conversas;
create policy rel_wa_lista_conversas_tudo on rel_wa_lista_conversas for all to authenticated
  using (wa_ve_conversa_id(conversa_id)) with check (wa_ve_conversa_id(conversa_id));
drop policy if exists rel_wa_sla_ler on rel_wa_sla;
create policy rel_wa_sla_ler on rel_wa_sla for select to authenticated
  using (rel_tem_acesso() or (fin_tem_acesso() and wa_ve_conversa_id(conversa_id)));
drop policy if exists rel_wa_cu_tudo on rel_wa_conversa_usuario;
create policy rel_wa_cu_tudo on rel_wa_conversa_usuario for all to authenticated
  using (user_id = auth.uid() and wa_ve_conversa_id(conversa_id)) with check (user_id = auth.uid() and wa_ve_conversa_id(conversa_id));

-- ── Fixar mensagem: quem vê a conversa ─────────────────────────────────────
create or replace function rel_wa_fixar_mensagem(p_msg uuid, p_fixar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  select conversa_id into v_conv from rel_wa_mensagens where id = p_msg;
  if v_conv is null then raise exception 'Mensagem não encontrada.'; end if;
  if not wa_ve_conversa_id(v_conv) then raise exception 'Sem acesso a essa conversa.'; end if;
  if p_fixar then
    update rel_wa_mensagens set fixada_em = now(), fixada_por = auth.uid() where id = p_msg;
    update rel_wa_mensagens set fixada_em = null, fixada_por = null
     where id in (select id from rel_wa_mensagens where conversa_id = v_conv and fixada_em is not null
                   order by fixada_em desc offset 3);
  else
    update rel_wa_mensagens set fixada_em = null, fixada_por = null where id = p_msg;
  end if;
end $$;
