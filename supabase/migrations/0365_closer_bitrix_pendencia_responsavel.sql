-- supabase/migrations/0365_closer_bitrix_pendencia_responsavel.sql
-- -----------------------------------------------------------------------------
-- CARTÃO DO CLOSER × BITRIX — revisão de 12/11/2026 ("QS = ferramenta, Bitrix =
-- banco de dados. Falha = pendência visível + nova tentativa.")
--
-- 1) PENDENTE DESDE: qs_closer_negocios.bitrix_pendente_em — quando o cartão
--    passou a esperar o Bitrix (pendente/erro). A tela mostra "pendente desde …"
--    e o alarme (api/qs-alertas.js) conta os parados há mais de 6 h.
--    Gatilho próprio (o trg_qs_closer_negocios_bitrix só olha a etapa).
-- 2) TROCA DE RESPONSÁVEL (closer_negocio_trocar_closer, 0334) agora também:
--    • passa a REUNIÃO aberta (agendada/confirmada) do cartão pro closer novo —
--      antes o gatilho da reunião (qs_meetings_cria_negocio) devolvia o cartão
--      pro closer antigo na próxima mudança da reunião;
--    • marca closer_trocado_em e deixa o cartão 'pendente' → o espelho manda o
--      ASSIGNED_BY_ID novo pro Bitrix (api/_closerEspelho.js, responsavelPendente).
-- 3) qs_meetings_cria_negocio:
--    • só mexe no closer do cartão quando a REUNIÃO mudou de closer (ou é outra
--      reunião / reunião nova). Mudar só o status não devolve mais o cartão pro
--      closer antigo;
--    • REUNIÃO CANCELADA sem outra marcada: o cartão que estava em "Aguardando
--      reunião"/"Reagendamento" por causa dela vai pra "Reagendamento" com a
--      próxima ação "reagendar ou marcar perdido" vencendo agora. Antes ficava
--      preso (12 cartões em 12/11). O Bitrix acompanha (coluna "Reagendamento").
--    O resto da função é a versão de produção lida em 12/11 (0205 + ajustes).
-- 4) Os 12 cartões que JÁ estão presos: SQL no fim, COMENTADO (não roda sozinho).
--
-- Idempotente (add column if not exists / create or replace / drop trigger if exists).
-- Volta: drop trigger trg_qs_closer_negocios_bitrix_desde; drop function
-- qs_closer_negocios_bitrix_desde(); recriar closer_negocio_trocar_closer da 0334
-- e qs_meetings_cria_negocio da versão anterior; as colunas novas podem ficar.
-- -----------------------------------------------------------------------------

alter table public.qs_closer_negocios add column if not exists bitrix_pendente_em timestamptz;
alter table public.qs_closer_negocios add column if not exists closer_trocado_em timestamptz;

comment on column public.qs_closer_negocios.bitrix_pendente_em is
  '0365: desde quando o cartão espera o Bitrix (bitrix_status pendente/erro). null = em dia.';
comment on column public.qs_closer_negocios.closer_trocado_em is
  '0365: última troca de responsável; o espelho manda ASSIGNED_BY_ID se for depois do último envio.';

-- 1) "pendente desde" -----------------------------------------------------------
create or replace function public.qs_closer_negocios_bitrix_desde()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.bitrix_status in ('pendente', 'erro') then
    -- pendente → erro (ou erro → pendente) mantém a data de quando começou a esperar.
    if tg_op = 'INSERT' or old.bitrix_status is null or old.bitrix_status not in ('pendente', 'erro')
       or new.bitrix_pendente_em is null then
      new.bitrix_pendente_em := coalesce(case when tg_op = 'UPDATE' and old.bitrix_status in ('pendente', 'erro') then old.bitrix_pendente_em end, now());
    end if;
  else
    new.bitrix_pendente_em := null;
  end if;
  return new;
end $$;

-- Nome depois de trg_qs_closer_negocios_bitrix (ordem alfabética): vê o status já decidido por ele.
drop trigger if exists trg_qs_closer_negocios_bitrix_desde on public.qs_closer_negocios;
create trigger trg_qs_closer_negocios_bitrix_desde
  before insert or update of etapa, bitrix_status on public.qs_closer_negocios
  for each row execute function public.qs_closer_negocios_bitrix_desde();

-- Quem já está esperando: a melhor estimativa é a última mudança de etapa.
update public.qs_closer_negocios
   set bitrix_pendente_em = coalesce(etapa_em, atualizado_em, criado_em)
 where bitrix_status in ('pendente', 'erro') and bitrix_pendente_em is null;

-- 2) trocar o responsável ------------------------------------------------------
create or replace function public.closer_negocio_trocar_closer(p_negocio uuid, p_closer uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  n qs_closer_negocios;
  de_nome text; para_nome text;
  tem_bitrix boolean;
  reunioes int := 0;
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found then raise exception 'negocio-nao-encontrado'; end if;
  -- Gestor/admin passa qualquer um; o closer só o dele.
  if not (qs_is_manager() or n.closer_id = auth.uid()) then raise exception 'sem-permissao'; end if;
  select name into para_nome from qs_users where id = p_closer and is_active and role in ('closer', 'gestor', 'admin');
  if para_nome is null then raise exception 'closer-invalido'; end if;
  if n.closer_id = p_closer then return; end if;
  select name into de_nome from qs_users where id = n.closer_id;
  select exists (select 1 from qs_leads l where l.id = n.lead_id and nullif(trim(l.bitrix_id), '') is not null) into tem_bitrix;

  update qs_closer_negocios set
    closer_id = p_closer,
    closer_trocado_em = now(),
    -- 0365: o dono do card no Bitrix muda no próximo envio (cron ou "Enviar agora").
    bitrix_status = case when tem_bitrix and arquivado_em is null then 'pendente' else bitrix_status end,
    bitrix_erro = case when tem_bitrix and arquivado_em is null then null else bitrix_erro end
   where id = p_negocio;
  -- O lead acompanha quando estava com o closer antigo (não mexe se está com um SDR).
  update qs_leads set owner_id = p_closer where id = n.lead_id and (owner_id = n.closer_id or owner_id is null);
  -- 0365: a reunião ABERTA do cartão vai junto (senão o gatilho da reunião devolve o
  -- cartão pro closer antigo). Reunião com desfecho fica como está (histórico/comissão).
  update qs_meetings set closer_id = p_closer
   where lead_id = n.lead_id and status in ('agendada', 'confirmada') and closer_id is not distinct from n.closer_id;
  get diagnostics reunioes = row_count;

  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (p_negocio, 'nota',
          'Responsável: ' || coalesce(de_nome, 'ninguém') || ' → ' || para_nome
            || case when reunioes > 0 then ' (a reunião marcada também passou)' else '' end
            || coalesce(' · ' || nullif(trim(coalesce(p_motivo, '')), ''), ''),
          auth.uid());
end $$;
revoke all on function public.closer_negocio_trocar_closer(uuid, uuid, text) from public, anon;
grant execute on function public.closer_negocio_trocar_closer(uuid, uuid, text) to authenticated;

-- 3) o gatilho da reunião -------------------------------------------------------
create or replace function public.qs_meetings_cria_negocio()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  n       qs_closer_negocios;
  alvo    text;
  texto   text;
  v_closer uuid;
begin
  if new.closer_id is null or new.lead_id is null then return new; end if;

  -- 0365: reunião CANCELADA (era agendada/confirmada) e nenhuma outra marcada pro
  -- lead → o cartão que esperava por ELA vai pra Reagendamento, com a próxima ação
  -- vencendo agora. Nada de perdido automático: o closer decide.
  if tg_op = 'UPDATE' and new.status = 'cancelada' then
    if old.status in ('agendada', 'confirmada') then
      begin
        select * into n from qs_closer_negocios
         where lead_id = new.lead_id and meeting_id = new.id and arquivado_em is null
           and etapa in ('aguardando_reuniao', 'reagendamento')
         for update;
        if found and not exists (
          select 1 from qs_meetings m
           where m.lead_id = new.lead_id and m.id <> new.id and m.status in ('agendada', 'confirmada')
        ) then
          update qs_closer_negocios set
            etapa = 'reagendamento',
            proxima_acao = 'Reunião cancelada: reagendar com o cliente ou marcar como perdido',
            proxima_acao_em = now()
           where id = n.id;
          insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
          values (n.id, 'automatico', n.etapa, 'reagendamento',
                  'A reunião foi cancelada e não há outra marcada: o cartão foi para Reagendamento.', auth.uid());
        end if;
      exception when others then
        raise warning '[0365] cartão do closer não atualizado (reunião cancelada %): %', new.id, sqlerrm;
      end;
    end if;
    return new;
  end if;

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
    if n.etapa not in ('aguardando_reuniao','reagendamento','no_show') then return new; end if;
    -- 0365: o closer do cartão só segue o da reunião quando a reunião MUDOU de closer,
    -- é outra reunião ou é nova. Só o status mudou → o cartão fica com quem está
    -- (a troca de responsável pelo cartão não é desfeita).
    v_closer := case
      when tg_op = 'INSERT' or n.meeting_id is distinct from new.id or new.closer_id is distinct from old.closer_id
        then coalesce(new.closer_id, n.closer_id)
      else n.closer_id end;
    if alvo = n.etapa and n.meeting_id is not distinct from new.id and n.closer_id is not distinct from v_closer then
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
      closer_id = v_closer,
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
$function$;

-- 4) OS CARTÕES QUE JÁ ESTÃO PRESOS (12 em 12/11) — NÃO RODA SOZINHO.
-- Conferir primeiro (só leitura):
--
--   select n.id, n.etapa, n.bitrix_status, m.status as reuniao, m.updated_at
--     from qs_closer_negocios n join qs_meetings m on m.id = n.meeting_id
--    where n.arquivado_em is null and m.status = 'cancelada'
--      and n.etapa in ('aguardando_reuniao', 'reagendamento')
--      and not exists (select 1 from qs_meetings m2 where m2.lead_id = n.lead_id
--                        and m2.id <> m.id and m2.status in ('agendada', 'confirmada'));
--
-- Corrigir (mesma regra do gatilho; os que estavam em "Aguardando reunião" ficam
-- 'pendente' pro Bitrix e vão pra coluna "Reagendamento" no próximo envio):
--
--   with presos as (
--     select n.id, n.etapa
--       from qs_closer_negocios n join qs_meetings m on m.id = n.meeting_id
--      where n.arquivado_em is null and m.status = 'cancelada'
--        and n.etapa in ('aguardando_reuniao', 'reagendamento')
--        and not exists (select 1 from qs_meetings m2 where m2.lead_id = n.lead_id
--                          and m2.id <> m.id and m2.status in ('agendada', 'confirmada'))
--   ), mudou as (
--     update qs_closer_negocios c set
--       etapa = 'reagendamento',
--       proxima_acao = 'Reunião cancelada: reagendar com o cliente ou marcar como perdido',
--       proxima_acao_em = now()
--      from presos p where c.id = p.id
--     returning c.id, p.etapa as de
--   )
--   insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto)
--   select id, 'automatico', de, 'reagendamento',
--          'Correção 0365: a reunião deste cartão foi cancelada e não há outra marcada — o cartão foi para Reagendamento.'
--     from mudou;
