-- scripts/rev-sdr/limpar-desfecho-lixo.sql
-- -----------------------------------------------------------------------------
-- LIMPEZA DAS COBRANÇAS DE DESFECHO "CRIADAS E IGNORADAS" (revisão SDR, 12/11/2026)
-- NÃO FOI EXECUTADO. Rode só depois de publicar o front com o conserto do laço
-- (src/lib/qs/meetings.ts + migration 0370), senão o lixo volta a nascer.
--
-- O que é o lixo: tarefas com tag 'desfecho', status 'ignorada' e motivo
-- 'Reunião já passou — confirmação perdeu o objeto'. Esse motivo só existe no
-- sweepOutcomeTasks, que matava a própria cobrança que acabara de criar.
-- Nenhuma delas foi trabalhada (completed_at é nulo em todas — conferido).
-- Contagem em 12/11/2026: 30.084 linhas (405 reuniões, 361 leads), de 04/08 a
-- 12/11; só nos últimos 30 dias, 3.104.
--
-- Por que apagar (e não só deixar): elas não aparecem na fila (estão
-- ignoradas), mas inflam qualquer contagem de "atividades ignoradas" e o
-- histórico do lead. É seguro: a cobrança verdadeira, quando a reunião ainda
-- está sem desfecho, é recriada pelo sweepOutcomeTasks (agora ela sobrevive).
--
-- Efeito colateral: o gatilho trg_audit_qs_tasks grava 1 linha de auditoria
-- por tarefa apagada (~30 mil). Se isso incomodar, a alternativa é NÃO apagar
-- (o lixo já está ignorado e fora da fila) — o conserto do código basta.
--
-- MODO SIMULAÇÃO: rode só o bloco 1. MODO REAL: rode o bloco 2 inteiro; ele
-- termina em ROLLBACK — troque por COMMIT quando o número bater.
-- -----------------------------------------------------------------------------

-- ── 1. SIMULAÇÃO (só leitura) ───────────────────────────────────────────────
select count(*)                                  as linhas_a_apagar,
       count(distinct public.qs_meeting_tag(tags)) as reunioes,
       count(distinct lead_id)                   as leads,
       count(*) filter (where completed_at is not null) as trabalhadas_deve_ser_zero
  from public.qs_tasks
 where tags @> array['desfecho']
   and status = 'ignorada'
   and skip_reason = 'Reunião já passou — confirmação perdeu o objeto'
   and completed_at is null;

-- ── 2. EXECUÇÃO (transação; termina em ROLLBACK de propósito) ───────────────
begin;

delete from public.qs_tasks
 where tags @> array['desfecho']
   and status = 'ignorada'
   and skip_reason = 'Reunião já passou — confirmação perdeu o objeto'
   and completed_at is null;
-- O "DELETE n" que aparece aqui tem que bater com linhas_a_apagar do bloco 1.

rollback;  -- ← troque por COMMIT para gravar de verdade
