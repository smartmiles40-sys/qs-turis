-- 0420 — ROTINA DO RELACIONAMENTO: andamento das tarefas de vários dias (25/11/2026).
-- Bruno: "diferente dos SDRs, tem tarefas que vão durar mais de um dia, então temos que
-- pensar em uma lógica que funcione para todos de uma forma fácil de entender e de sempre
-- seguir a cadência". Ok dado em 25/11 ("pode seguir e criar a tabela, fila única do time").
--
-- A fila continua CALCULADA (src/rel/lib/rotina.ts). Esta tabela só guarda os TOQUES que o
-- time deu numa atividade que ainda não terminou: "falei com o cliente, aguardando —
-- retomar em X". Uma linha por toque (histórico de tentativas). A atividade é identificada
-- pela mesma chave da fila (e:<viagem>:<etapa>, x:<expedição>:<etapa>, c:/cx:<trecho>,
-- m:<item>, s:<solicitação>). O toque mais recente com retomar_em no futuro tira a tarefa
-- do dia até essa data — ou até o prazo chegar, o que vier antes.

create table if not exists rel_rotina_andamento (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null,
  tipo        text not null,
  retomar_em  date,
  nota        text,
  user_id     uuid,
  criado_em   timestamptz not null default now()
);

create index if not exists rel_rotina_andamento_chave_idx on rel_rotina_andamento (chave, criado_em desc);
create index if not exists rel_rotina_andamento_criado_idx on rel_rotina_andamento (criado_em desc);

alter table rel_rotina_andamento enable row level security;

drop policy if exists app_cliente_barreira on rel_rotina_andamento;
create policy app_cliente_barreira on rel_rotina_andamento as restrictive for all
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists rel_rotina_andamento_ler on rel_rotina_andamento;
create policy rel_rotina_andamento_ler on rel_rotina_andamento for select using ((select rel_tem_acesso()));
drop policy if exists rel_rotina_andamento_gravar on rel_rotina_andamento;
create policy rel_rotina_andamento_gravar on rel_rotina_andamento for insert with check ((select rel_tem_acesso()));
drop policy if exists rel_rotina_andamento_apagar on rel_rotina_andamento;
create policy rel_rotina_andamento_apagar on rel_rotina_andamento for delete using ((select rel_tem_acesso()));

grant select, insert, delete on rel_rotina_andamento to authenticated;
