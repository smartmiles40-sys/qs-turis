-- 0205_closer_pipeline_v2.sql
-- -----------------------------------------------------------------------------
-- PIPELINE DO CLOSER, VERSÃO 2 (Bruno, 26/10/2026): "tudo vai ser feito dentro
-- do QS e depois vai pro Bitrix". As colunas passam a ser as do processo
-- comercial (as mesmas do funil Comercial 1 do Bitrix):
--
--   Aguardando reunião · Reagendamento · Em cotação · Em negociação · No-show ·
--   Oportunidade futura · Aguardando emissão · Venda cancelada · Perdido ·
--   Venda realizada
--
-- COMO O CARTÃO NASCE: na reunião AGENDADA com closer (decisão do Bruno), em
-- "Aguardando reunião". Antes ele só nascia com a reunião realizada.
--
-- O CARTÃO ANDA SOZINHO PELA REUNIÃO — só enquanto está antes da reunião
-- (Aguardando reunião / Reagendamento / No-show):
--   • reagendou (a reunião nova tem reagendado_de) .... → Reagendamento
--   • no-show ......................................... → No-show
--   • realizada ....................................... → Em cotação
--   • desistência ..................................... → Perdido (com motivo)
-- E PELOS FATOS — só pra frente, de Em cotação pra Em negociação: proposta
-- enviada/aprovada, contrato enviado ou link de pagamento enviado.
-- A ficha de fechamento (closer_consolidar) leva pra "Aguardando emissão" (a
-- venda está fechada; falta emitir). "Venda realizada" é o closer quem marca
-- depois da emissão. Perdido e Venda cancelada pedem motivo.
--
-- OS 231 CARTÕES ANTIGOS: o Bruno decidiu começar só com os novos. Todos vão
-- pro ARQUIVO (arquivado_em) — nada é apagado. O closer traz de volta um
-- cliente que já existe no Bitrix pelo ID do negócio (api/closer.js,
-- acao=importar), e aí o cartão arquivado do mesmo cliente é reaproveitado.
--
-- BITRIX: toda mudança de etapa marca o cartão como "pendente" e o servidor
-- (api/closer.js) move o negócio no Bitrix pra coluna de mesmo nome.
-- -----------------------------------------------------------------------------

-- ── Colunas novas ───────────────────────────────────────────────────────────
alter table qs_closer_negocios add column if not exists arquivado_em timestamptz;
alter table qs_closer_negocios add column if not exists arquivado_motivo text;
-- A última etapa que o Bitrix confirmou (pra não reenviar o que já está lá).
alter table qs_closer_negocios add column if not exists bitrix_etapa text;

-- ── Etapas ─────────────────────────────────────────────────────────────────
alter table qs_closer_negocios drop constraint if exists qs_closer_negocios_etapa_check;
alter table qs_closer_negocios drop constraint if exists qs_closer_negocios_perda;
drop index if exists qs_closer_negocios_um_aberto;

-- Os cartões que existem hoje (todos de antes do pipeline novo) vão pro arquivo
-- numa etapa equivalente. O gatilho de "atualizado/etapa_em" não precisa rodar.
alter table qs_closer_negocios disable trigger trg_qs_closer_negocios_toca;
alter table qs_closer_negocios disable trigger trg_qs_closer_negocios_fatos;
update qs_closer_negocios set
  etapa = case etapa
    when 'reuniao_feita' then 'em_cotacao'
    when 'proposta_enviada' then 'em_negociacao'
    when 'negociando' then 'em_negociacao'
    when 'contrato_enviado' then 'em_negociacao'
    when 'contrato_assinado' then 'em_negociacao'
    when 'pagamento_enviado' then 'em_negociacao'
    when 'pago' then 'aguardando_emissao'
    when 'consolidada' then 'aguardando_emissao'
    else etapa end,
  arquivado_em = coalesce(arquivado_em, now()),
  arquivado_motivo = coalesce(arquivado_motivo, 'Pipeline novo (26/10/2026): o quadro começou só com os cartões novos.');
alter table qs_closer_negocios enable trigger trg_qs_closer_negocios_toca;
alter table qs_closer_negocios enable trigger trg_qs_closer_negocios_fatos;

alter table qs_closer_negocios alter column etapa set default 'aguardando_reuniao';
alter table qs_closer_negocios add constraint qs_closer_negocios_etapa_check check (etapa in (
  'aguardando_reuniao','reagendamento','em_cotacao','em_negociacao','no_show',
  'oportunidade_futura','aguardando_emissao','venda_cancelada','perdido','venda_realizada'));
alter table qs_closer_negocios add constraint qs_closer_negocios_perda
  check (etapa not in ('perdido','venda_cancelada') or nullif(trim(motivo_perda), '') is not null);

-- Um cartão ABERTO (e fora do arquivo) por cliente. Final libera um novo (recompra).
create unique index qs_closer_negocios_um_aberto on qs_closer_negocios (lead_id)
  where arquivado_em is null and etapa not in ('venda_realizada','venda_cancelada','perdido');
create index if not exists qs_closer_negocios_quadro on qs_closer_negocios (closer_id, etapa) where arquivado_em is null;
create index if not exists qs_closer_negocios_bitrix_pendente on qs_closer_negocios (bitrix_status) where bitrix_status = 'pendente';

create or replace function closer_etapa_final(p text) returns boolean
language sql immutable set search_path = public as $$
  select p in ('venda_realizada','venda_cancelada','perdido');
$$;

-- Ordem pra "só anda pra frente". As de antes da reunião valem o mesmo.
create or replace function closer_etapa_ordem(p text) returns int
language sql immutable set search_path = public as $$
  select case p
    when 'aguardando_reuniao' then 1 when 'reagendamento' then 1 when 'no_show' then 1
    when 'em_cotacao' then 2 when 'em_negociacao' then 3 when 'aguardando_emissao' then 4
    when 'venda_realizada' then 5 else 0 end;
$$;

-- ── Bitrix: mudou de etapa → pendente ───────────────────────────────────────
create or replace function qs_closer_negocios_bitrix_pendente() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    if exists (select 1 from qs_leads l where l.id = new.lead_id and nullif(trim(l.bitrix_id), '') is not null) then
      if new.arquivado_em is null and new.etapa is distinct from new.bitrix_etapa then
        new.bitrix_status := 'pendente';
        new.bitrix_erro := null;
      end if;
    else
      new.bitrix_status := 'sem_card';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qs_closer_negocios_bitrix on qs_closer_negocios;
create trigger trg_qs_closer_negocios_bitrix before insert or update of etapa on qs_closer_negocios
  for each row execute function qs_closer_negocios_bitrix_pendente();

-- ── O cartão anda pelos FATOS (Em cotação → Em negociação, só pra frente) ───
create or replace function closer_negocio_recalcular(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  n      qs_closer_negocios;
  fato   text := 'em_cotacao';
  prop   uuid;
  st     text;
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found or n.arquivado_em is not null then return; end if;

  select p.id, p.status into prop, st
    from qs_propostas p
   where p.status in ('enviada','aprovada')
     and (p.lead_id = n.lead_id
          or p.solicitacao_id in (select s.id from qs_solicitacoes s where s.lead_id = n.lead_id))
   order by (p.status = 'aprovada') desc, coalesce(p.aprovada_em, p.enviada_em, p.atualizado_em) desc
   limit 1;
  if prop is not null and prop is distinct from n.proposta_id then
    update qs_closer_negocios set proposta_id = prop where id = n.id;
  end if;

  -- Só mexe na etapa de quem está em Em cotação.
  if n.etapa <> 'em_cotacao' then return; end if;
  if st in ('enviada','aprovada')
     or n.status_contrato in ('enviado','visualizado','assinado')
     or n.status_pagamento in ('enviado','parcial','pago') then
    fato := 'em_negociacao';
  end if;
  if fato <> n.etapa then
    update qs_closer_negocios set etapa = fato where id = n.id;
    insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto)
    values (n.id, 'automatico', n.etapa, fato, 'O cartão andou sozinho: a cotação foi enviada ao cliente.');
  end if;
end;
$$;
revoke all on function closer_negocio_recalcular(uuid) from public, anon, authenticated;

-- ── Gatilho: a REUNIÃO move o cartão ────────────────────────────────────────
-- Nunca derruba a reunião: qualquer erro aqui vira aviso no log.
create or replace function qs_meetings_cria_negocio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n     qs_closer_negocios;
  alvo  text;
  texto text;
begin
  if new.closer_id is null or new.lead_id is null then return new; end if;
  alvo := case
    when new.status in ('agendada','confirmada') and new.reagendado_de is not null then 'reagendamento'
    when new.status in ('agendada','confirmada') then 'aguardando_reuniao'
    when new.status = 'no_show' then 'no_show'
    when new.status = 'realizada' then 'em_cotacao'
    when new.status = 'desistencia' then 'perdido'
    else null end;
  if alvo is null then return new; end if;

  begin
    select * into n from qs_closer_negocios
     where lead_id = new.lead_id and arquivado_em is null and not closer_etapa_final(etapa)
     for update;

    if not found then
      -- Desistência sem cartão aberto: não cria cartão só pra perder.
      if alvo = 'perdido' then return new; end if;
      insert into qs_closer_negocios (lead_id, closer_id, meeting_id, etapa, valor_previsto)
      values (new.lead_id, new.closer_id, new.id, alvo, nullif(new.venda_valor, 0))
      returning * into n;
      insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, autor_id)
      values (n.id, 'criado', alvo,
              case alvo when 'em_cotacao' then 'Reunião realizada — o cartão entrou no pipeline.'
                        else 'Reunião agendada — o cartão entrou no pipeline.' end, auth.uid());
      if alvo = 'em_cotacao' then perform closer_negocio_recalcular(n.id); end if;
      return new;
    end if;

    -- Cartão aberto: a reunião só manda enquanto ele está ANTES da reunião.
    if n.etapa not in ('aguardando_reuniao','reagendamento','no_show') then return new; end if;
    if alvo = n.etapa and n.meeting_id is not distinct from new.id and n.closer_id is not distinct from new.closer_id then
      return new;
    end if;

    texto := case alvo
      when 'reagendamento' then 'A reunião foi reagendada.'
      when 'aguardando_reuniao' then 'Reunião agendada.'
      when 'no_show' then 'O cliente não apareceu na reunião (no-show).'
      when 'em_cotacao' then 'Reunião realizada.'
      when 'perdido' then 'Desistência registrada na reunião.' end;
    update qs_closer_negocios set
      etapa = alvo,
      meeting_id = new.id,
      closer_id = coalesce(new.closer_id, closer_id),
      motivo_perda = case when alvo = 'perdido' then coalesce(nullif(trim(motivo_perda), ''), 'Desistência na reunião') else null end
     where id = n.id;
    if alvo <> n.etapa then
      insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
      values (n.id, 'automatico', n.etapa, alvo, texto, auth.uid());
    end if;
    if alvo = 'em_cotacao' then perform closer_negocio_recalcular(n.id); end if;
  exception when others then
    raise warning '[0205] cartão do closer não atualizado (reunião %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_qs_meetings_cria_negocio on qs_meetings;
create trigger trg_qs_meetings_cria_negocio after insert or update of status, closer_id on qs_meetings
  for each row execute function qs_meetings_cria_negocio();

-- ── Gatilho: proposta enviada/aprovada → recalcula os cartões do cliente ────
create or replace function qs_propostas_move_negocio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.status in ('enviada','aprovada') then
    begin
      for r in
        select n.id from qs_closer_negocios n
         where n.arquivado_em is null and not closer_etapa_final(n.etapa)
           and (n.lead_id = new.lead_id
                or n.lead_id = (select s.lead_id from qs_solicitacoes s where s.id = new.solicitacao_id))
      loop
        perform closer_negocio_recalcular(r.id);
      end loop;
    exception when others then
      raise warning '[0205] cartão do closer não recalculado (proposta %): %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- ── Mover à mão ────────────────────────────────────────────────────────────
--   • Aguardando emissão: só pela ficha de fechamento (ou volta de Venda realizada).
--   • Venda realizada / Venda cancelada: só venda que passou pela ficha.
--   • Perdido / Venda cancelada: motivo obrigatório.
create or replace function closer_negocio_mover(p_id uuid, p_etapa text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into n from qs_closer_negocios where id = p_id for update;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  if p_etapa not in ('aguardando_reuniao','reagendamento','em_cotacao','em_negociacao','no_show',
                     'oportunidade_futura','aguardando_emissao','venda_cancelada','perdido','venda_realizada') then
    raise exception 'etapa-invalida';
  end if;
  if p_etapa = n.etapa then return; end if;
  if p_etapa = 'aguardando_emissao' and n.consolidada_em is null then raise exception 'use-a-ficha-de-fechamento'; end if;
  if p_etapa in ('venda_realizada','venda_cancelada') and n.consolidada_em is null then raise exception 'consolide-antes'; end if;
  if p_etapa in ('perdido','venda_cancelada') and v_motivo is null then raise exception 'motivo-obrigatorio'; end if;

  begin
    update qs_closer_negocios
       set etapa = p_etapa,
           motivo_perda = case when p_etapa in ('perdido','venda_cancelada') then v_motivo else null end,
           arquivado_em = null, arquivado_motivo = null
     where id = p_id;
  exception when unique_violation then
    raise exception 'ja-tem-cartao-aberto';
  end;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
  values (p_id, case when p_etapa in ('perdido','venda_cancelada') then 'perdido' else 'movido' end, n.etapa, p_etapa,
          case when p_etapa in ('perdido','venda_cancelada') then 'Motivo: ' || v_motivo else v_motivo end,
          auth.uid());
end;
$$;

-- Abrir um cartão à mão (cliente sem reunião registrada): entra em Em cotação.
-- Se o cliente tem um cartão no ARQUIVO, ele volta (com o histórico).
create or replace function closer_negocio_abrir(p_lead uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
  eu  qs_users;
begin
  select * into eu from qs_users where id = auth.uid() and is_active;
  if not found or not (eu.role in ('closer') or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  select id into nid from qs_closer_negocios
   where lead_id = p_lead and arquivado_em is null and not closer_etapa_final(etapa);
  if nid is not null then return nid; end if;
  return closer_negocio_trazer(p_lead, auth.uid(), 'Cartão aberto à mão.');
end;
$$;

-- Traz o cliente pro quadro: desarquiva o cartão mais recente que estava aberto
-- ou cria um novo. Usada pelo "abrir à mão" e pela importação do Bitrix.
create or replace function closer_negocio_trazer(p_lead uuid, p_closer uuid, p_texto text, p_valor numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
begin
  select id into nid from qs_closer_negocios
   where lead_id = p_lead and arquivado_em is null and not closer_etapa_final(etapa);
  if nid is not null then return nid; end if;

  select id into nid from qs_closer_negocios
   where lead_id = p_lead and arquivado_em is not null and not closer_etapa_final(etapa)
   order by criado_em desc limit 1;
  if nid is not null then
    update qs_closer_negocios set
      arquivado_em = null, arquivado_motivo = null,
      closer_id = coalesce(p_closer, closer_id),
      valor_previsto = coalesce(nullif(p_valor, 0), valor_previsto),
      -- Volta numa etapa de trabalho: o que estava antes da reunião vira Em cotação.
      etapa = case when etapa in ('aguardando_reuniao','reagendamento','no_show') then 'em_cotacao' else etapa end,
      bitrix_etapa = null
     where id = nid;
  else
    insert into qs_closer_negocios (lead_id, closer_id, etapa, valor_previsto)
    values (p_lead, p_closer, 'em_cotacao', nullif(p_valor, 0)) returning id into nid;
  end if;
  insert into qs_closer_negocio_eventos (negocio_id, tipo, para_etapa, texto, autor_id)
  values (nid, 'criado', (select etapa from qs_closer_negocios where id = nid), p_texto, coalesce(auth.uid(), p_closer));
  perform closer_negocio_recalcular(nid);
  return nid;
end;
$$;

revoke all on function closer_negocio_mover(uuid, text, text), closer_negocio_abrir(uuid) from public, anon;
grant execute on function closer_negocio_mover(uuid, text, text), closer_negocio_abrir(uuid) to authenticated;
-- A importação do Bitrix chama pelo servidor (service role), depois de conferir quem pediu.
revoke all on function closer_negocio_trazer(uuid, uuid, text, numeric) from public, anon, authenticated;

-- ── Funções que olhavam 'consolidada' / só 'perdido' ────────────────────────
-- Partem da definição VIGENTE no banco (troca pontual; falha se o trecho mudou).
do $$
declare
  def text;
  novo text;
begin
  -- Ficha de fechamento: a venda fechada vai pra "Aguardando emissão".
  def := pg_get_functiondef('closer_consolidar(uuid, jsonb)'::regprocedure);
  novo := replace(def, $q$if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;$q$,
                       $q$if n.etapa in ('perdido','venda_cancelada') then raise exception 'negocio-perdido'; end if;$q$);
  novo := replace(novo, $q$etapa = 'consolidada', ficha = p_ficha,$q$,
                        $q$etapa = case when etapa = 'venda_realizada' then etapa else 'aguardando_emissao' end, ficha = p_ficha, arquivado_em = null, arquivado_motivo = null,$q$);
  novo := replace(novo, $q$values (n.id, 'consolidado', n.etapa, 'consolidada',$q$,
                        $q$values (n.id, 'consolidado', n.etapa, case when n.etapa = 'venda_realizada' then n.etapa else 'aguardando_emissao' end,$q$);
  if novo = def or novo like '%''consolidada''%' then raise exception '[0205] closer_consolidar mudou — revisar à mão'; end if;
  execute novo;

  -- Resumo da ficha na viagem: "consolidada" agora é ter passado pela ficha.
  def := pg_get_functiondef('closer_ficha_da_viagem(uuid)'::regprocedure);
  novo := replace(def, $q$where viagem_id = p_viagem and etapa = 'consolidada'$q$,
                       $q$where viagem_id = p_viagem and consolidada_em is not null$q$);
  if novo = def then raise exception '[0205] closer_ficha_da_viagem mudou — revisar à mão'; end if;
  execute novo;

  -- Pagamento: venda cancelada também não recebe.
  def := pg_get_functiondef('closer_pagamento(uuid, text, text, uuid, date, numeric, text)'::regprocedure);
  novo := replace(def, $q$if n.etapa = 'perdido' then raise exception 'negocio-perdido'; end if;$q$,
                       $q$if n.etapa in ('perdido','venda_cancelada') then raise exception 'negocio-perdido'; end if;$q$);
  if novo = def then raise exception '[0205] closer_pagamento mudou — revisar à mão'; end if;
  execute novo;
end;
$$;

grant execute on function closer_negocio_trazer(uuid, uuid, text, numeric) to service_role;
