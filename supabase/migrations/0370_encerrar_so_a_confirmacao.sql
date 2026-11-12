-- 0370_encerrar_so_a_confirmacao.sql
-- -----------------------------------------------------------------------------
-- LAÇO DO DESFECHO (revisão SDR, 12/11/2026).
--
-- O sweepOutcomeTasks (src/lib/qs/meetings.ts), a cada abertura da Agenda,
-- (1) criava a cobrança de DESFECHO das reuniões vencidas e (2) chamava
-- qs_encerrar_confirmacao para matar a confirmação vencida. Só que esta função
-- ignorava TODA tarefa com a tag meeting:<id> — inclusive a de desfecho que
-- acabara de nascer. Na próxima abertura, cria de novo, ignora de novo:
-- 3.104 tarefas criadas e ignoradas em 30 dias (109 leads), e a cobrança de
-- desfecho nunca ficava de pé.
--
-- Agora há um terceiro parâmetro, p_so_confirmacao (padrão false = comportamento
-- de antes, para o desfecho final/cancelamento/exclusão, que de fato encerram
-- tudo da reunião). Com true, só a tarefa com a tag 'confirmar' é encerrada e a
-- de desfecho sobrevive.
--
-- A assinatura antiga (uuid, text) é REMOVIDA antes de criar a nova: com as
-- duas no banco, a chamada de 2 argumentos ficaria ambígua no PostgREST.
-- Chamadas de 2 argumentos continuam funcionando (o terceiro tem padrão).
-- O front novo também funciona sem esta migration (cai no update direto com o
-- mesmo filtro), então a ordem de publicação é livre.
--
-- Idempotente.
-- -----------------------------------------------------------------------------

drop function if exists public.qs_encerrar_confirmacao(uuid, text);

create or replace function public.qs_encerrar_confirmacao(
  p_meeting uuid,
  p_motivo text,
  p_so_confirmacao boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n      integer := 0;
  v_dono   uuid;
  v_closer uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida — entre de novo no QS.' using errcode = '42501';
  end if;

  select owner_id, closer_id into v_dono, v_closer from qs_meetings where id = p_meeting;
  if not found then
    raise exception 'Reunião não encontrada.' using errcode = 'P0002';
  end if;

  -- Mesma regra de quem pode lançar o desfecho (0027): gestão, quem agendou
  -- ou o especialista da reunião.
  if not (qs_is_manager() or v_dono = auth.uid() or v_closer = auth.uid()) then
    raise exception 'Esta reunião não é sua.' using errcode = '42501';
  end if;

  update qs_tasks
     set status = 'ignorada', skip_reason = p_motivo
   where tags @> array['meeting:' || p_meeting::text]
     and (not coalesce(p_so_confirmacao, false) or tags @> array['confirmar'])
     and status in ('pendente', 'atrasada');
  get diagnostics v_n = row_count;

  return v_n;
end;
$function$;

-- Integração 12/11: a função nova nasce com EXECUTE para public; fecha anon já aqui
-- (a 0373 fecha a mesma função, mas só conhecia a assinatura antiga de 2 parâmetros).
revoke execute on function public.qs_encerrar_confirmacao(uuid, text, boolean) from public, anon;
grant execute on function public.qs_encerrar_confirmacao(uuid, text, boolean) to authenticated, service_role;

-- ── Como conferir ───────────────────────────────────────────────────────────
-- select oid::regprocedure from pg_proc where proname = 'qs_encerrar_confirmacao';
--   → uma linha só: qs_encerrar_confirmacao(uuid,text,boolean)
-- Depois de uns dias com o front novo, isto deve ficar perto de zero:
-- select count(*) from qs_tasks
--  where tags @> array['desfecho'] and status = 'ignorada'
--    and skip_reason = 'Reunião já passou — confirmação perdeu o objeto'
--    and created_at > now() - interval '1 day';
