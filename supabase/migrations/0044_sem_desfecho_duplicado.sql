-- =============================================================================
-- 0044 — UMA COBRANÇA DE DESFECHO POR REUNIÃO, GARANTIDA PELO BANCO
-- -----------------------------------------------------------------------------
-- MEDIDO em 07/08: 458 tarefas de desfecho ABERTAS para 40 reuniões. 418 eram
-- cópias — uma reunião chegou a ter 27. As de confirmação, no mesmo período:
-- 30 para 30 reuniões, nenhuma repetida.
--
-- POR QUE só o desfecho: a de confirmação nasce UMA vez (quando a reunião é
-- criada). A de desfecho também é tentada pelo `sweepOutcomeTasks`, que roda a
-- cada abertura da Agenda procurando reunião vencida sem resposta. O
-- `ensureOutcomeTask` tem uma checagem de "já existe?" antes de inserir — mas
-- ela roda no navegador, sob RLS, e o resultado dela era usado sem conferir
-- erro. Qualquer leitura vazia (recusa da RLS, falha de rede) virava INSERT.
--
-- A lição: idempotência que depende de um SELECT do cliente não é idempotência.
-- Quem tem que garantir isso é o banco.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci).
--    Não apaga nada: as cópias viram 'ignorada' e continuam no histórico.
-- =============================================================================

-- ── (1) Qual reunião a tarefa cobra ─────────────────────────────────────────
-- As tarefas carregam a reunião numa tag `meeting:<uuid>`. Para indexar por ela
-- é preciso extraí-la com uma função IMMUTABLE — subconsulta não vale em índice.
create or replace function public.qs_meeting_tag(p_tags text[])
returns text
language sql
immutable
as $$
  select t from unnest(coalesce(p_tags, '{}')) t where t like 'meeting:%' limit 1
$$;

-- ── (2) Fecha as cópias que já existem ──────────────────────────────────────
-- Mantém a MAIS ANTIGA de cada (lead, reunião, tipo) e encerra o resto como
-- ignorada — sai da fila do SDR e continua auditável.
with ranqueadas as (
  select id,
         row_number() over (
           partition by lead_id,
                        public.qs_meeting_tag(tags),
                        (case when 'desfecho' = any(tags) then 'desfecho' else 'confirmar' end)
           order by created_at asc, id asc
         ) as posicao
    from public.qs_tasks
   where status in ('pendente', 'atrasada')
     and public.qs_meeting_tag(tags) is not null
     and ('desfecho' = any(tags) or 'confirmar' = any(tags))
)
update public.qs_tasks t
   set status = 'ignorada',
       skip_reason = 'cópia automática encerrada pela 0044'
  from ranqueadas r
 where t.id = r.id
   and r.posicao > 1;

-- ── (3) O banco passa a recusar a segunda ───────────────────────────────────
-- Parcial de propósito: vale só enquanto a tarefa está ABERTA. Reunião
-- reagendada gera uma tag nova, então continua ganhando a cobrança dela.
create unique index if not exists uq_qs_tasks_cobranca_reuniao
  on public.qs_tasks (
    lead_id,
    public.qs_meeting_tag(tags),
    (case when 'desfecho' = any(tags) then 'desfecho' else 'confirmar' end)
  )
  where status in ('pendente', 'atrasada')
    and public.qs_meeting_tag(tags) is not null
    and ('desfecho' = any(tags) or 'confirmar' = any(tags));

-- ── Como conferir ───────────────────────────────────────────────────────────
-- select count(*) from qs_tasks
--  where status in ('pendente','atrasada') and 'desfecho' = any(tags);
--   → deve cair de 458 para ~40 (uma por reunião vencida)
