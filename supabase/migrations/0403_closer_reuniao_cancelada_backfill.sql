-- supabase/migrations/0403_closer_reuniao_cancelada_backfill.sql
-- -----------------------------------------------------------------------------
-- 18/11/2026 — revisão de 12/11: "cartões presos em reunião cancelada".
-- O gatilho qs_meetings_cria_negocio (0365) já manda pra Reagendamento quando a
-- reunião é cancelada e não há outra marcada — mas só dali pra frente. Os cartões
-- cancelados ANTES da 0365 ficaram em 'aguardando_reuniao' (10 em 18/11, reuniões
-- de 30/10 a 12/11). Aplica a mesma regra neles, com o mesmo evento. Idempotente.
-- -----------------------------------------------------------------------------

with alvo as (
  select n.id, n.etapa
    from qs_closer_negocios n
    join qs_meetings m on m.id = n.meeting_id
   where n.arquivado_em is null
     and n.etapa = 'aguardando_reuniao'
     and m.status = 'cancelada'
     and not exists (select 1 from qs_meetings o
                      where o.lead_id = n.lead_id and o.id <> m.id
                        and o.status in ('agendada', 'confirmada'))
),
mov as (
  update qs_closer_negocios n set
    etapa = 'reagendamento',
    proxima_acao = 'Reunião cancelada: reagendar com o cliente ou marcar como perdido',
    proxima_acao_em = now()
    from alvo where n.id = alvo.id
  returning n.id
)
insert into qs_closer_negocio_eventos (negocio_id, tipo, de_etapa, para_etapa, texto, autor_id)
select mov.id, 'automatico', 'aguardando_reuniao', 'reagendamento',
       'A reunião foi cancelada e não há outra marcada: o cartão foi para Reagendamento (acerto dos antigos, 0403).', null
  from mov;
