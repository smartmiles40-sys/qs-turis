-- 0054_reuniao_de_retomada.sql
-- =============================================================================
-- REUNIÃO DE RETOMADA — a 2ª, 3ª, 4ª call do mesmo cliente.
--
-- POR QUE EXISTE (Bruno, 19/08/2026). Expedição vende em UMA call. Pacote não:
-- são 3 ou mais calls com o mesmo cliente até fechar. Como toda reunião com
-- desfecho "realizada" contava igual, o número de reuniões realizadas do mês
-- inflava sozinho — o closer que vende pacote aparecia com o triplo de reuniões
-- de quem vende expedição, sem ter atendido um cliente a mais. "Gera um stress
-- muito grande de contar várias reuniões realizada."
--
-- A retomada continua sendo uma reunião de verdade: ocupa a agenda do closer,
-- entra na trava de choque de horário, gera evento no Google e aparece na tela.
-- O que ela NÃO faz é contar como reunião realizada nos indicadores.
--
-- E ela também não pede SAL: SAL é a qualificação do lead, que se decide na
-- PRIMEIRA conversa. Sem essa regra, um "não é SAL" marcado por engano na 2ª
-- call de um pacote mandaria pra perdido um cliente que está em negociação.
--
-- Aditiva e idempotente: pode rodar duas vezes, não mexe em dado existente.
-- Toda reunião que já está no banco vira 'primeira', que é o que ela era.
-- =============================================================================

alter table qs_meetings add column if not exists tipo text not null default 'primeira';

do $$
begin
  alter table qs_meetings
    add constraint qs_meetings_tipo_check check (tipo in ('primeira','retomada'));
exception
  when duplicate_object then raise notice '[0054] CHECK de tipo já existia — ok';
end $$;

comment on column qs_meetings.tipo is
  'primeira = a call que qualifica o lead (conta como reunião realizada e pede SAL). '
  'retomada = continuação da negociação, típica de pacote (não conta no indicador '
  'de reuniões realizadas e não pede SAL). Migration 0054.';

-- O índice é parcial de propósito: retomada é a minoria das linhas, e todo
-- contador do app filtra por "tipo <> retomada" — é essa a busca que precisa
-- ser barata, não a varredura da coluna inteira.
create index if not exists idx_qs_meetings_retomada
  on qs_meetings(tipo) where tipo = 'retomada';

-- =============================================================================
-- Conferência depois de colar:
--   select tipo, status, count(*) from qs_meetings group by tipo, status order by 1,2;
-- Esperado logo após aplicar: tudo em 'primeira'.
-- =============================================================================
