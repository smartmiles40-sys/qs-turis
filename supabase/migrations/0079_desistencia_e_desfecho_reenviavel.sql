-- 0079_desistencia_e_desfecho_reenviavel.sql
-- =============================================================================
-- DUAS COISAS QUE FALTAVAM NO DESFECHO DA REUNIAO (Bruno, 09/09/2026).
--
-- (1) DESISTENCIA E UM DESFECHO, NAO UM CANCELAMENTO
--
-- Ate aqui o closer tinha tres saidas: Realizada, No-show e Reagendar. Quando o
-- cliente simplesmente DESISTE — avisa que nao vai mais, some da negociacao — a
-- unica coisa que sobrava era "Cancelar reuniao", que no relatorio se mistura
-- com a reuniao que a propria operacao desmarcou. Sao coisas diferentes: uma e
-- lead que morreu, a outra e agenda que mudou. Sem separar, ninguem consegue
-- responder "quantos clientes desistiram este mes?".
--
-- `desistencia` NAO entra no show rate (realizadas / decididas): a reuniao nao
-- aconteceu e o cliente nao "furou" — ele desmarcou a compra. E balde proprio.
--
-- (2) O DESFECHO PRECISA PODER SER REENVIADO AO BITRIX
--
-- O valor e o tipo da venda eram perguntados ao closer e mandados DIRETO pro
-- Bitrix, sem passar pelo banco do QS. Quando o n8n ou o Bitrix estavam fora (e
-- em agosto ficaram, por dias), o numero que o closer digitou morria na tela: o
-- QS nao tinha como reenviar porque nunca soube dele.
--
-- Agora o desfecho fica gravado aqui. O QS continua sendo a fonte da verdade e o
-- Bitrix o espelho — que e a regra da casa —, e o botao "Enviar pro Bitrix" tem
-- o que enviar.
-- =============================================================================

-- -- (1) O STATUS -------------------------------------------------------------
-- Mesmo procedimento da 0072: a constraint e derrubada pelo nome REAL que ela
-- tem neste banco, nao pelo nome que a gente supoe que ela tenha.
do $$
declare nome text;
begin
  select conname into nome
    from pg_constraint
   where conrelid = 'public.qs_meetings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%'
   limit 1;

  if nome is not null then
    execute format('alter table public.qs_meetings drop constraint %I', nome);
  end if;

  alter table public.qs_meetings
    add constraint qs_meetings_status_check
    check (status in ('agendada','confirmada','realizada','no_show','reagendada','cancelada','arquivada','desistencia'));
end $$;

comment on column public.qs_meetings.status is
  'agendada | confirmada | realizada | no_show | reagendada | cancelada | arquivada | desistencia. '
  '"arquivada" (0072) = passou e ninguem registrou o desfecho; NAO conta em indicador nenhum. '
  '"desistencia" (0079) = o cliente desistiu; e desfecho de verdade (o lead vai pra perdido), '
  'mas fica FORA do show rate — a reuniao nao aconteceu e nao foi no-show.';


-- -- (2) O DESFECHO GRAVADO ---------------------------------------------------
alter table public.qs_meetings add column if not exists venda_valor        numeric(14,2);
alter table public.qs_meetings add column if not exists venda_tipo         text;
alter table public.qs_meetings add column if not exists desfecho_enviado_em timestamptz;

comment on column public.qs_meetings.venda_valor is
  'Valor informado pelo closer no desfecho (0079). Existe pro QS poder REENVIAR o '
  'desfecho ao Bitrix — antes ele so trafegava e se perdia quando o envio falhava.';
comment on column public.qs_meetings.venda_tipo is
  'Id do "Tipo de venda" do Bitrix (UF_CRM_1743296167520) escolhido no desfecho (0079).';
comment on column public.qs_meetings.desfecho_enviado_em is
  'Ultima vez que este desfecho foi aceito pelo /api/bitrix-sync (0079). Nulo = nunca '
  'confirmado; e o que o botao "Enviar pro Bitrix" mostra pro closer.';
