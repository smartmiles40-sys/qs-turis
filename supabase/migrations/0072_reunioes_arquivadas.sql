-- 0072_reunioes_arquivadas.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- O QUE E ISTO -----------------------------------------------------------
--
-- ZERAR A COBRANCA DE DESFECHO E COMECAR DO ZERO (Bruno, 01/09).
--
-- Havia 124 reunioes `agendada` e 5 `confirmada` cuja data ja passou e que
-- nunca receberam desfecho — a mais antiga de 03/08. Elas nasceram antes de a
-- cobranca existir e viraram um paredao: o closer abre a agenda, ve um mes de
-- divida que ele nao vai reconstituir de memoria, e para de olhar a tela. Fila
-- que ninguem consegue zerar deixa de ser fila e vira ruido.
--
-- -- POR QUE UM STATUS NOVO, E NAO 'cancelada' --------------------------------
--
-- 'cancelada' AFIRMA uma coisa que nao aconteceu: a maioria dessas reunioes
-- provavelmente ocorreu, so nao foi registrada. Usar 'cancelada' derrubaria a
-- taxa de reuniao realizada do periodo; usar 'realizada' inflaria. As duas
-- mentem, so que para lados diferentes.
--
-- `arquivada` nao afirma nada sobre o que aconteceu — afirma que NAO SABEMOS.
-- Que e exatamente a verdade, e a unica coisa que os indicadores podem fazer
-- com ela e o certo: ignorar.
--
-- -- REVERSIVEL ---------------------------------------------------------------
--
-- Nada e apagado. O status anterior fica escrito no proprio campo de anotacoes,
-- entao da pra desfazer uma linha (ou todas) com um UPDATE — a consulta esta no
-- rodape. E o arquivamento so pega o que ja passou: reuniao futura nao e tocada.
-- ---------------------------------------------------------------------------


-- -- (1) O STATUS NOVO ---------------------------------------------------------
--
-- O CHECK e recriado com o valor a mais. Precisa ser dropado pelo nome, e o
-- nome varia conforme como a tabela nasceu — por isso a busca no catalogo em
-- vez de um `drop constraint qs_meetings_status_check` cru, que quebraria em
-- qualquer instalacao onde a constraint tenha outro nome.
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
    check (status in ('agendada','confirmada','realizada','no_show','reagendada','cancelada','arquivada'));
end $$;

comment on column public.qs_meetings.status is
  'agendada | confirmada | realizada | no_show | reagendada | cancelada | arquivada. '
  '"arquivada" (0072) = passou e ninguem registrou o desfecho; NAO conta em indicador nenhum, '
  'nem como realizada nem como perdida. Nao e desfecho: e a ausencia dele, dita em voz alta.';


-- -- (2) ARQUIVAR O QUE JA PASSOU ----------------------------------------------
--
-- So `agendada`/`confirmada` (as que ainda cobravam desfecho) e so no PASSADO.
-- `realizada`, `no_show`, `cancelada` e `reagendada` ja tem desfecho e ficam
-- como estao. O `where status <> 'arquivada'` deixa o arquivo idempotente e
-- impede que rodar de novo empilhe o carimbo nas anotacoes.
update qs_meetings
   set status = 'arquivada',
       notes = coalesce(nullif(trim(notes), '') || E'\n\n', '')
               || '[arquivada em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
               || ' — passou sem desfecho registrado; status anterior: ' || status || ']',
       updated_at = now()
 where status in ('agendada', 'confirmada')
   and scheduled_at < now();


-- -- (3) TIRAR A COBRANCA DA FILA ----------------------------------------------
--
-- A reuniao arquivada nao pode continuar gerando tarefa: a atividade de
-- CONFIRMACAO e a de DESFECHO ficam amarradas a reuniao pela tag `meeting:<id>`
-- (ver src/lib/qs/meetings.ts). Arquivar a reuniao e deixar a tarefa aberta
-- seria trocar um paredao por outro — o closer continuaria vendo a divida, so
-- que agora no Painel em vez da Agenda.
--
-- `ignorada` (e nao `concluida`): ninguem executou nada, e marcar como feito
-- mentiria no indicador de atividade da mesma forma que 'cancelada' mentiria no
-- de reuniao.
update qs_tasks t
   set status = 'ignorada',
       skip_reason = 'reunião arquivada em 01/09 (sem desfecho registrado)'
  from qs_meetings m
 where m.status = 'arquivada'
   and t.status in ('pendente', 'atrasada')
   and t.tags @> array['meeting:' || m.id::text];


-- -- CONFERENCIA DEPOIS DE COLAR ----------------------------------------------
--
-- Quantas foram arquivadas, e o que sobrou cobrando desfecho:
--   select status, count(*) filter (where scheduled_at < now()) as passadas,
--          count(*) filter (where scheduled_at >= now()) as futuras
--     from qs_meetings group by status order by 1;
--
-- A fila do closer deve estar limpa (esperado: 0):
--   select count(*) from qs_meetings
--    where status in ('agendada','confirmada') and scheduled_at < now();
--
-- PRA DESFAZER (devolve o status que estava escrito na anotacao):
--   update qs_meetings
--      set status = substring(notes from 'status anterior: ([a-z_]+)\]'),
--          notes  = regexp_replace(notes, E'\\n*\\[arquivada em [^\\]]+\\]', '')
--    where status = 'arquivada'
--      and notes ~ 'status anterior: [a-z_]+\]';
