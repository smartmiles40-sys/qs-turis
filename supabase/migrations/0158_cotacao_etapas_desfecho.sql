-- 0158_cotacao_etapas_desfecho.sql
-- -----------------------------------------------------------------------------
-- COTAÇÃO PRO OPERAÇÕES com etapas, formulário e desfecho (Bruno 21/10/2026).
--
--   Nova solicitação (esperando aprovação)  → status 'nova'
--   Aguardando ajustes (falta info de quem pediu) → 'aguardando' + solicitante
--   Em cotação                              → 'em_andamento' (ou aguardando cliente/fornecedor)
--   Cotação entregue                        → 'concluida'
--
-- "Toda cotação que já foi finalizada deve ter um prazo para o solicitante dar
-- um desfecho, contando o motivo do pq não seguiu a frente" → desfecho_prazo
-- nasce ao entregar (desfecho_dias do tipo); quem pediu marca fechou /
-- ainda negociando (adia) / não seguiu + motivo.
--
-- O formulário (passageiro, viajantes, perfil, o que é pedido, pacote,
-- hospedagem, aéreo) fica em qs_solicitacoes.formulario (jsonb); título e
-- descrição continuam sendo gravados (texto gerado) pra busca e histórico.
-- -----------------------------------------------------------------------------

-- ── a) colunas ────────────────────────────────────────────────────────────────
alter table qs_solicitacao_tipos
  add column if not exists formulario text check (formulario in ('cotacao')),
  add column if not exists desfecho_dias int check (desfecho_dias between 1 and 90);

update qs_solicitacao_tipos set formulario = 'cotacao', desfecho_dias = 7 where id = 'ops_cotacao';

alter table qs_solicitacoes
  add column if not exists formulario jsonb,
  add column if not exists desfecho text check (desfecho in ('fechou', 'nao_seguiu')),
  add column if not exists desfecho_motivo text,
  add column if not exists desfecho_texto text,
  add column if not exists desfecho_em timestamptz,
  add column if not exists desfecho_por uuid references qs_users(id),
  add column if not exists desfecho_prazo timestamptz;

alter table qs_solicitacao_eventos drop constraint if exists qs_solicitacao_eventos_tipo_check;
alter table qs_solicitacao_eventos add constraint qs_solicitacao_eventos_tipo_check check (tipo = any (array[
  'criada','aceita','passada','status','comentario','prazo','concluida','confirmada','reaberta','recusada','cancelada','vinculada',
  'ajuste','ajustada','desfecho'
]));

-- Colunas novas no FIM (create or replace exige as antigas na mesma ordem).
create or replace view qs_solicitacoes_v with (security_invoker = true) as
 select s.id, s.numero, s.de_setor, s.para_setor, s.tipo_id, s.titulo, s.descricao, s.prioridade, s.status, s.aguardando_quem,
    s.prazo, s.cliente_id, s.viagem_id, s.lead_id, s.conversa_id, s.sobre_nome, s.criado_por, s.responsavel_id, s.criado_em,
    s.aceito_em, s.concluido_em, s.confirmado_em, s.atualizado_em, s.atualizado_por, s.resolucao, s.reaberturas,
    t.rotulo as tipo_rotulo,
    uc.name as criado_por_nome,
    ur.name as responsavel_nome,
    (s.status = any (array['nova','em_andamento','aguardando'])) as aberta,
    ((s.status = any (array['nova','em_andamento','aguardando'])) and s.prazo is not null and s.prazo < now()) as vencida,
    (s.status = 'nova' and rel_minutos_uteis(s.criado_em, now()) >= 120) as sem_dono_atrasada,
    (s.atualizado_por is distinct from auth.uid() and s.atualizado_em > coalesce(v.visto_em, '-infinity'::timestamptz)) as novidade,
    -- 0158
    (t.formulario = 'cotacao') as cotacao,
    s.formulario,
    s.desfecho, s.desfecho_motivo, s.desfecho_texto, s.desfecho_em, s.desfecho_prazo,
    ud.name as desfecho_por_nome,
    (s.status = 'concluida' and s.desfecho is null and s.desfecho_prazo is not null) as falta_desfecho,
    (s.status = 'concluida' and s.desfecho is null and s.desfecho_prazo is not null and s.desfecho_prazo < now()) as desfecho_atrasado
   from qs_solicitacoes s
     left join qs_solicitacao_tipos t on t.id = s.tipo_id
     left join qs_users uc on uc.id = s.criado_por
     left join qs_users ur on ur.id = s.responsavel_id
     left join qs_users ud on ud.id = s.desfecho_por
     left join qs_solicitacao_vistos v on v.solicitacao_id = s.id and v.user_id = auth.uid();

-- ── b) criar com formulário + quem pediu reenvia depois do ajuste ─────────────
drop function if exists qs_sol_criar(text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, text);
create or replace function qs_sol_criar(p_de text, p_para text, p_tipo text, p_titulo text, p_descricao text,
  p_prioridade text default 'normal', p_prazo timestamptz default null, p_cliente uuid default null, p_viagem uuid default null,
  p_lead uuid default null, p_conversa uuid default null, p_sobre text default null, p_formulario jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_horas int; v_form text; v_prazo timestamptz; v_sobre text := nullif(trim(coalesce(p_sobre, '')), '');
begin
  if not qs_do_setor(p_de) then raise exception 'Você não é desse setor.'; end if;
  if p_de = p_para then raise exception 'Escolha outro setor (o pedido é pra outro setor).'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  select prazo_horas, formulario into v_horas, v_form from qs_solicitacao_tipos where id = p_tipo and setor = p_para and ativo;
  if v_horas is null then raise exception 'Tipo de pedido inválido pra esse setor.'; end if;
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

  insert into qs_solicitacoes (de_setor, para_setor, tipo_id, titulo, descricao, prioridade, prazo,
                               cliente_id, viagem_id, lead_id, conversa_id, sobre_nome, criado_por, atualizado_por, formulario)
  values (p_de, p_para, p_tipo, trim(p_titulo), coalesce(trim(p_descricao), ''), coalesce(p_prioridade, 'normal'), v_prazo,
          p_cliente, p_viagem, p_lead, p_conversa, v_sobre, auth.uid(), auth.uid(), p_formulario)
  returning id into v_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
    values (v_id, 'criada', p_para, nullif(trim(coalesce(p_descricao, '')), ''), qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (v_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
  return v_id;
end $$;
revoke all on function qs_sol_criar(text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function qs_sol_criar(text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, text, jsonb) to authenticated;

-- Quem pediu corrige o pedido (formulário novo) e devolve pra aprovação.
create or replace function qs_sol_ajustar(p_id uuid, p_titulo text, p_descricao text, p_formulario jsonb, p_prioridade text, p_texto text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s qs_solicitacoes; v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not (s.criado_por = auth.uid() or qs_do_setor(s.de_setor)) then raise exception 'Só quem pediu ajusta o pedido.'; end if;
  if not (s.status = 'aguardando' and s.aguardando_quem = 'solicitante') then raise exception 'Esse pedido não está aguardando ajuste.'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  update qs_solicitacoes set titulo = trim(p_titulo), descricao = coalesce(trim(p_descricao), ''),
         formulario = coalesce(p_formulario, formulario), prioridade = coalesce(p_prioridade, prioridade),
         status = 'nova', aguardando_quem = null, atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome)
    values (p_id, 'ajustada', 'aguardando:solicitante', 'nova', v_texto, qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;
revoke all on function qs_sol_ajustar(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function qs_sol_ajustar(uuid, text, text, jsonb, text, text) to authenticated;

-- ── c) ações: + ajuste, + desfecho; concluir abre o prazo do desfecho ─────────
create or replace function qs_sol_acao(p_id uuid, p_acao text, p_texto text default null, p_extra text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s qs_solicitacoes;
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
  v_eu text := qs_eu_nome();
  recebe boolean;
  pediu boolean;
  v_user uuid;
  v_nome text;
  v_dias int;
  v_motivo text;
begin
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  recebe := qs_do_setor(s.para_setor);
  pediu  := s.criado_por = auth.uid() or qs_do_setor(s.de_setor);
  if not (recebe or pediu or s.responsavel_id = auth.uid()) then raise exception 'Sem acesso a essa solicitação.'; end if;
  select desfecho_dias into v_dias from qs_solicitacao_tipos where id = s.tipo_id;

  if p_acao = 'comentar' then
    if v_texto is null then raise exception 'Escreva o comentário.'; end if;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome) values (p_id, 'comentario', v_texto, v_eu);

  elsif p_acao = 'aceitar' then
    if not recebe then raise exception 'Só quem é do setor que recebeu aceita.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    update qs_solicitacoes set responsavel_id = auth.uid(), aceito_em = coalesce(aceito_em, now()),
           status = case when status = 'nova' then 'em_andamento' else status end where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, autor_nome) values (p_id, 'aceita', v_eu, v_eu);

  elsif p_acao = 'passar' then
    if not recebe then raise exception 'Só quem é do setor que recebeu passa pra outra pessoa.'; end if;
    v_user := nullif(p_extra, '')::uuid;
    select name into v_nome from qs_users where id = v_user and is_active and (role = 'admin' or s.para_setor = any(setores));
    if v_nome is null then raise exception 'Essa pessoa não é do setor.'; end if;
    update qs_solicitacoes set responsavel_id = v_user, aceito_em = coalesce(aceito_em, now()),
           status = case when status = 'nova' then 'em_andamento' else status end where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome) values (p_id, 'passada', v_nome, v_texto, v_eu);

  elsif p_acao = 'aguardar' then
    if not recebe then raise exception 'Só quem recebeu muda o andamento.'; end if;
    if s.status not in ('em_andamento','aguardando','nova') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if p_extra not in ('cliente','fornecedor','solicitante','outro_setor') then raise exception 'Diga quem você está aguardando.'; end if;
    update qs_solicitacoes set status = 'aguardando', aguardando_quem = p_extra,
           responsavel_id = coalesce(responsavel_id, auth.uid()), aceito_em = coalesce(aceito_em, now()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome) values (p_id, 'status', s.status, 'aguardando:' || p_extra, v_texto, v_eu);

  elsif p_acao = 'ajuste' then
    -- 0158: falta informação de quem pediu → "Aguardando ajustes"
    if not recebe then raise exception 'Só quem recebeu pede ajuste.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if v_texto is null then raise exception 'Diga o que está faltando.'; end if;
    update qs_solicitacoes set status = 'aguardando', aguardando_quem = 'solicitante',
           responsavel_id = coalesce(responsavel_id, auth.uid()), aceito_em = coalesce(aceito_em, now()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome) values (p_id, 'ajuste', s.status, 'aguardando:solicitante', v_texto, v_eu);

  elsif p_acao = 'retomar' then
    if not recebe then raise exception 'Só quem recebeu muda o andamento.'; end if;
    if s.status <> 'aguardando' then raise exception 'Não está aguardando.'; end if;
    update qs_solicitacoes set status = 'em_andamento', aguardando_quem = null where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome) values (p_id, 'status', 'aguardando', 'em_andamento', v_texto, v_eu);

  elsif p_acao = 'concluir' then
    if not recebe then raise exception 'Só quem recebeu conclui.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if v_texto is null then raise exception 'Escreva o que foi feito — quem pediu precisa saber.'; end if;
    update qs_solicitacoes set status = 'concluida', aguardando_quem = null, resolucao = v_texto, concluido_em = now(),
           confirmado_em = null, responsavel_id = coalesce(responsavel_id, auth.uid()), aceito_em = coalesce(aceito_em, now()),
           desfecho = null, desfecho_motivo = null, desfecho_texto = null, desfecho_em = null, desfecho_por = null,
           desfecho_prazo = case when v_dias is not null then now() + make_interval(days => v_dias) end
     where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'concluida', s.status, v_texto, v_eu);

  elsif p_acao = 'desfecho' then
    -- 0158: p_extra = 'fechou' | 'negociando' | 'nao_seguiu:<motivo>'
    if not pediu then raise exception 'Só quem pediu dá o desfecho.'; end if;
    if s.status <> 'concluida' then raise exception 'A cotação ainda não foi entregue.'; end if;
    if p_extra = 'fechou' then
      update qs_solicitacoes set desfecho = 'fechou', desfecho_motivo = null, desfecho_texto = v_texto, desfecho_em = now(),
             desfecho_por = auth.uid(), confirmado_em = coalesce(confirmado_em, now()) where id = p_id;
    elsif p_extra = 'negociando' then
      if s.desfecho is not null then raise exception 'Essa cotação já tem desfecho.'; end if;
      update qs_solicitacoes set desfecho_prazo = greatest(coalesce(desfecho_prazo, now()), now()) + make_interval(days => coalesce(v_dias, 7))
       where id = p_id;
    elsif p_extra like 'nao_seguiu:%' then
      v_motivo := nullif(split_part(p_extra, ':', 2), '');
      if v_motivo is null then raise exception 'Escolha o motivo de não ter seguido.'; end if;
      if v_motivo = 'outro' and v_texto is null then raise exception 'Conte o motivo.'; end if;
      update qs_solicitacoes set desfecho = 'nao_seguiu', desfecho_motivo = v_motivo, desfecho_texto = v_texto, desfecho_em = now(),
             desfecho_por = auth.uid(), confirmado_em = coalesce(confirmado_em, now()) where id = p_id;
    else
      raise exception 'Escolha o desfecho.';
    end if;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome) values (p_id, 'desfecho', p_extra, v_texto, v_eu);

  elsif p_acao = 'recusar' then
    if not recebe then raise exception 'Só quem recebeu recusa.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
    if v_texto is null then raise exception 'Diga por que não dá pra fazer.'; end if;
    update qs_solicitacoes set status = 'recusada', aguardando_quem = null, resolucao = v_texto, concluido_em = now(),
           responsavel_id = coalesce(responsavel_id, auth.uid()) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'recusada', s.status, v_texto, v_eu);

  elsif p_acao = 'confirmar' then
    if not pediu then raise exception 'Só quem pediu confirma.'; end if;
    if s.status <> 'concluida' then raise exception 'Ainda não foi concluída.'; end if;
    update qs_solicitacoes set confirmado_em = now() where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome) values (p_id, 'confirmada', v_texto, v_eu);

  elsif p_acao = 'reabrir' then
    if not pediu then raise exception 'Só quem pediu reabre.'; end if;
    if s.status not in ('concluida','recusada') then raise exception 'Não está fechada.'; end if;
    if v_texto is null then raise exception 'Diga o que ainda falta.'; end if;
    update qs_solicitacoes set status = case when responsavel_id is null then 'nova' else 'em_andamento' end,
           concluido_em = null, confirmado_em = null, reaberturas = reaberturas + 1,
           desfecho = null, desfecho_motivo = null, desfecho_texto = null, desfecho_em = null, desfecho_por = null, desfecho_prazo = null
     where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'reaberta', s.status, v_texto, v_eu);

  elsif p_acao = 'cancelar' then
    if not pediu then raise exception 'Só quem pediu cancela.'; end if;
    if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Já está fechada.'; end if;
    update qs_solicitacoes set status = 'cancelada', aguardando_quem = null, concluido_em = now(), resolucao = coalesce(v_texto, resolucao) where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, texto, autor_nome) values (p_id, 'cancelada', s.status, v_texto, v_eu);

  elsif p_acao = 'prazo' then
    if not (recebe or pediu) then raise exception 'Sem acesso.'; end if;
    if nullif(p_extra, '') is null then raise exception 'Escolha o novo prazo.'; end if;
    update qs_solicitacoes set prazo = p_extra::timestamptz where id = p_id;
    insert into qs_solicitacao_eventos (solicitacao_id, tipo, de, para, texto, autor_nome)
      values (p_id, 'prazo', s.prazo::text, p_extra, v_texto, v_eu);

  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;

  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = p_id;
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (p_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
end $$;

-- Bolinha: + ajustes que EU preciso fazer e desfechos meus que venceram.
create or replace function qs_sol_contagem(p_setor text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'novas',      count(*) filter (where para_setor = p_setor and status = 'nova'),
    'atrasadas',  count(*) filter (where para_setor = p_setor and (sem_dono_atrasada or vencida)),
    'comigo',     count(*) filter (where responsavel_id = auth.uid() and aberta),
    'novidades',  count(*) filter (where criado_por = auth.uid() and novidade and not (status = 'cancelada')),
    'ajustes',    count(*) filter (where criado_por = auth.uid() and status = 'aguardando' and aguardando_quem = 'solicitante'),
    'desfechos',  count(*) filter (where criado_por = auth.uid() and desfecho_atrasado)
  )
  from qs_solicitacoes_v
  where para_setor = p_setor or criado_por = auth.uid() or responsavel_id = auth.uid();
$$;
