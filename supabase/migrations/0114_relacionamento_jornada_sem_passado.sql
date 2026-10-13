-- 0114_relacionamento_jornada_sem_passado.sql
-- -----------------------------------------------------------------------------
-- 4.166 ALERTAS FALSOS (varredura de 13/10/2026). O histórico do Bitrix trouxe
-- viagens antigas e vendas de meses atrás; a jornada (9 tarefas por viagem)
-- nasceu pra elas com prazos JÁ VENCIDOS — 3.224 tarefas "atrasadas" de viagens
-- que já aconteceram e 1.167 de vendas antigas.
--
-- Regra nova: tarefa cujo prazo já passou NO MOMENTO em que a viagem entra no
-- QS não é atraso — nasce "pulada" (dada como feita, com o motivo). Atraso de
-- verdade é só o que vence DEPOIS que a viagem já está aqui.
-- -----------------------------------------------------------------------------

alter table rel_viagem_tarefas add column if not exists pulada        boolean not null default false;
alter table rel_viagem_tarefas add column if not exists pulada_motivo text;

create or replace function rel_gerar_jornada(p_viagem uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v     rel_viagens;
  item  jsonb;
  i     int := 0;
  prazo date;
begin
  select * into v from rel_viagens where id = p_viagem;
  if v.id is null or v.status = 'cancelada' then return; end if;
  delete from rel_viagem_tarefas where viagem_id = p_viagem and referencia <> 'manual' and feita_em is null;
  for item in select * from jsonb_array_elements(coalesce((select valor from rel_config where chave = 'jornada'), '[]'))
  loop
    i := i + 1;
    if exists (select 1 from rel_viagem_tarefas where viagem_id = p_viagem and titulo = item ->> 'titulo') then continue; end if;
    prazo := rel_prazo_da_tarefa(v, coalesce(item ->> 'referencia', 'venda'), (item ->> 'dias')::int);
    insert into rel_viagem_tarefas (viagem_id, titulo, descricao, referencia, dias, prazo, ordem, feita_em, pulada, pulada_motivo)
    values (p_viagem, item ->> 'titulo', item ->> 'descricao', coalesce(item ->> 'referencia', 'venda'),
            (item ->> 'dias')::int, prazo, i,
            case when prazo < rel_hoje() then now() end,
            prazo < rel_hoje(),
            case when prazo < rel_hoje() then 'O prazo já tinha passado quando a viagem entrou no QS.' end);
  end loop;
end;
$function$;

-- Limpa o que já nasceu errado:
--   (a) viagem que já terminou → tudo que está aberto fica como pulado;
--   (b) tarefa criada com o prazo já vencido → pulada.
update rel_viagem_tarefas t
   set feita_em = now(), pulada = true,
       pulada_motivo = 'Viagem já tinha acontecido quando entrou no QS.'
  from rel_viagens v
 where v.id = t.viagem_id and t.feita_em is null
   and coalesce(v.data_retorno, v.data_embarque) < (t.criado_em at time zone 'America/Sao_Paulo')::date;

update rel_viagem_tarefas
   set feita_em = now(), pulada = true,
       pulada_motivo = 'O prazo já tinha passado quando a viagem entrou no QS.'
 where feita_em is null and prazo < (criado_em at time zone 'America/Sao_Paulo')::date;
