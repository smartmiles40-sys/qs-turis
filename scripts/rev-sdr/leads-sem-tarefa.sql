-- scripts/rev-sdr/leads-sem-tarefa.sql
-- -----------------------------------------------------------------------------
-- LEADS ABERTOS PARADOS NA "CADÊNCIA SDR" SEM NENHUMA TAREFA (revisão SDR, 12/11/2026)
-- NÃO FOI EXECUTADO. Cada opção é uma transação que termina em ROLLBACK:
-- escolha UMA, troque o ROLLBACK por COMMIT e rode só ela.
--
-- O alvo: lead aberto (nao_iniciado/em_prospeccao) na "Cadência SDR", sem
-- tarefa pendente/atrasada. A Cadência SDR redireciona para "Resgate — Base
-- Fria", que está CONGELADA; o motor faz o lead esperar — e, esperando, ele
-- não aparece na fila de ninguém.
-- Contagem em 12/11/2026: 181 (Yanca 87, Mariana 85, Victor 9).
--
-- O código novo (api/cadencia-sweep.js) já resolve isso sozinho e devagar:
-- 1 tarefa de revisão por lead, no máximo 5 por SDR por dia, só em horário
-- comercial → os 181 voltam à fila em ~18 dias úteis. As opções abaixo são para
-- quando o Bruno decidir um destino diferente (ou quiser tudo de uma vez).
--
-- Carga atual (12/11): Yanca 1.645 tarefas abertas (1.421 vencidas),
-- Mariana 882 (658), Victor 228 (12).
-- -----------------------------------------------------------------------------

-- ── 0. SIMULAÇÃO (só leitura): quem é o alvo, por SDR ───────────────────────
with alvo as (
  select l.id, l.owner_id
    from public.qs_leads l
    join public.qs_cadences c on c.id = l.cadence_id
   where c.name = 'Cadência SDR'
     and l.status in ('nao_iniciado', 'em_prospeccao')
     and not exists (select 1 from public.qs_tasks t
                      where t.lead_id = l.id and t.status in ('pendente', 'atrasada'))
)
select coalesce(u.name, '(sem dono)') as sdr, count(*) as leads
  from alvo a left join public.qs_users u on u.id = a.owner_id
 group by 1 order by 2 desc;


-- ── OPÇÃO A — TAREFA DE REVISÃO PARA TODOS, AGORA ───────────────────────────
-- 1 tarefa "Cadência terminou — decidir o próximo passo" por lead (181 linhas
-- em qs_tasks + 181 notas). Mesmo formato que o código novo cria, com a nota
-- revisar-fim-cadencia, então o código não duplica depois.
-- Custo: +87 na fila da Yanca e +85 na da Mariana no mesmo dia.
begin;

create temp table _alvo on commit drop as
select l.id, l.owner_id, l.cadence_id
  from public.qs_leads l
  join public.qs_cadences c on c.id = l.cadence_id
 where c.name = 'Cadência SDR'
   and l.status in ('nao_iniciado', 'em_prospeccao')
   and l.owner_id is not null
   and not exists (select 1 from public.qs_tasks t
                    where t.lead_id = l.id and t.status in ('pendente', 'atrasada'))
   and not exists (select 1 from public.qs_notes n
                    where n.lead_id = l.id and n.tags @> array['revisar-fim-cadencia']);

insert into public.qs_tasks (lead_id, cadence_id, owner_id, channel_type, priority, scheduled_at, status, is_extra, notes, tags)
select id, cadence_id, owner_id, 'pesquisa', 'media', now(), 'pendente', true,
       'Cadência terminou — decidir o próximo passo. O plano da "Cadência SDR" acabou sem desfecho e a cadência "Resgate — Base Fria" está pausada, então o lead não foi redirecionado. Reinicie uma cadência, agende, marque como perdido ou devolva à carteira.',
       array['cadencia', 'revisar-fim-cadencia']
  from _alvo;

insert into public.qs_notes (lead_id, author_id, body, tags)
select id, null,
       '⏸️ Fim da cadência "Cadência SDR" sem desfecho — a cadência "Resgate — Base Fria" está pausada. Criada uma tarefa de revisão para o SDR decidir o próximo passo.',
       array['cadencia', 'revisar-fim-cadencia']
  from _alvo;

select count(*) as leads_afetados from _alvo;
rollback;  -- ← COMMIT para gravar


-- ── OPÇÃO B — DEVOLVER À CARTEIRA DO SDR (sem tarefa) ───────────────────────
-- Mesmo efeito do "fim de cadência sem regra": registra o telefone na carteira
-- de quem trabalhou e grava a nota 🏁. O lead continua aberto, sem tarefa, e
-- é reiniciado pela Carteira quando o SDR quiser. 181 notas; a carteira só
-- ganha quem ainda não está nela (on conflict do nothing).
-- Atenção: com a nota fim-cadencia o código novo ainda cria a tarefa de
-- revisão (a nota não é a mesma). Para impedir, rode também a nota
-- revisar-fim-cadencia (linha comentada abaixo) ou desligue com ?revisar_dia=0.
begin;

create temp table _alvo on commit drop as
select l.id, l.owner_id, l.phone
  from public.qs_leads l
  join public.qs_cadences c on c.id = l.cadence_id
 where c.name = 'Cadência SDR'
   and l.status in ('nao_iniciado', 'em_prospeccao')
   and not exists (select 1 from public.qs_tasks t
                    where t.lead_id = l.id and t.status in ('pendente', 'atrasada'))
   and not exists (select 1 from public.qs_notes n
                    where n.lead_id = l.id and n.tags @> array['fim-cadencia']);

select public.qs_carteira_registrar(phone, owner_id, 'fim-cadencia')
  from _alvo where phone is not null and owner_id is not null;

insert into public.qs_notes (lead_id, author_id, body, tags)
select id, null,
       '🏁 Fim da cadência "Cadência SDR" sem desfecho — todas as atividades do plano foram concluídas. O lead voltou pra carteira do SDR e pode ser reiniciado por lá.',
       array['cadencia', 'fim-cadencia']   -- , 'revisar-fim-cadencia'  ← descomente para o código não criar revisão depois
  from _alvo;

select count(*) as leads_afetados from _alvo;
rollback;  -- ← COMMIT para gravar


-- ── OPÇÃO C — MARCAR COMO PERDIDO ("Fim de cadência") ───────────────────────
-- 181 leads viram "perdido" com o motivo "Fim de cadência".
-- ATENÇÃO: por SQL a perda NÃO vai para o Bitrix (o espelho é feito pelo
-- código). Se o Bitrix tiver que refletir, prefira descongelar uma cadência
-- com perda automática ou marcar pela tela. Só use esta se o Bitrix não
-- importar para esses cards.
begin;

create temp table _alvo on commit drop as
select l.id
  from public.qs_leads l
  join public.qs_cadences c on c.id = l.cadence_id
 where c.name = 'Cadência SDR'
   and l.status in ('nao_iniciado', 'em_prospeccao')
   and not exists (select 1 from public.qs_tasks t
                    where t.lead_id = l.id and t.status in ('pendente', 'atrasada'));

update public.qs_leads l
   set status = 'perdido',
       loss_reason_id = (select id from public.qs_loss_reasons where label = 'Fim de cadência' limit 1)
  from _alvo a
 where l.id = a.id
   and l.status in ('nao_iniciado', 'em_prospeccao');

insert into public.qs_notes (lead_id, author_id, body, tags)
select id, null, '⛔ Perda em lote (12/11/2026): fim da "Cadência SDR" sem desfecho e destino "Resgate — Base Fria" congelado.',
       array['cadencia', 'perda-automatica']
  from _alvo;

select count(*) as leads_afetados from _alvo;
rollback;  -- ← COMMIT para gravar


-- ── OPÇÃO D — DESCONGELAR "Resgate — Base Fria" (sem SQL aqui) ──────────────
-- É um clique na tela de Cadências. Efeito: na meia hora seguinte o motor
-- redireciona os 181 (50 por rodada, ~2 h) e cria o plano da Resgate para
-- cada um: 5 atividades × 181 = ~905 tarefas novas (Yanca ~435, Mariana ~425).
-- E o motor volta a varrer os 754 leads abertos que já estão na Resgate
-- (perda automática de 14 dias para quem terminou o plano). É a opção de
-- maior carga.
