-- 0123_relacionamento_agenda.sql
-- -----------------------------------------------------------------------------
-- AGENDA DO RELACIONAMENTO (Bruno, 14/10/2026 — "Etapa 2"): cada pessoa tem a
-- sua agenda, e o time inteiro vê o PANORAMA (quem está ocupado, quando).
--
--   rel_agenda    a tabela. SELECT direto: só o dono ou a gestora/admin.
--   rel_agenda_v  o que a tela lê. Todo mundo do Rel vê a agenda de todos, mas
--                 compromisso PRIVADO de outra pessoa vira só "Ocupado" (sem
--                 título, descrição, cliente nem local). A view é do dono do
--                 banco (não security_invoker) justamente pra mostrar os
--                 horários dos outros — e filtra por rel_tem_acesso().
--   Escrever: o dono na própria agenda; gestora/admin em qualquer uma.
--
-- Horários são timestamptz (instante de verdade); a tela mostra em São Paulo.
-- -----------------------------------------------------------------------------

create table if not exists rel_agenda (
  id           uuid primary key default gen_random_uuid(),
  dono_id      uuid not null references qs_users(id) on delete cascade,
  titulo       text not null default '' check (length(titulo) <= 200),
  descricao    text,
  inicio       timestamptz not null,
  fim          timestamptz not null,
  dia_inteiro  boolean not null default false,
  tipo         text not null default 'reuniao'
               check (tipo in ('reuniao','ligacao','tarefa','visita','embarque','pessoal','outro')),
  privado      boolean not null default false,
  cliente_id   uuid references rel_clientes(id) on delete set null,
  viagem_id    uuid references rel_viagens(id) on delete set null,
  conversa_id  uuid references rel_wa_conversas(id) on delete set null,
  local        text,
  link         text,
  criado_por   uuid default auth.uid(),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint rel_agenda_fim_depois check (fim >= inicio)
);
create index if not exists rel_agenda_periodo_idx on rel_agenda (inicio, fim);
create index if not exists rel_agenda_dono_idx on rel_agenda (dono_id, inicio);

create or replace function rel_agenda_tocar() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists rel_agenda_tocar on rel_agenda;
create trigger rel_agenda_tocar before update on rel_agenda for each row execute function rel_agenda_tocar();

alter table rel_agenda enable row level security;
drop policy if exists rel_agenda_ler    on rel_agenda;
drop policy if exists rel_agenda_criar  on rel_agenda;
drop policy if exists rel_agenda_mudar  on rel_agenda;
drop policy if exists rel_agenda_apagar on rel_agenda;
create policy rel_agenda_ler on rel_agenda for select to authenticated
  using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar()));
create policy rel_agenda_criar on rel_agenda for insert to authenticated
  with check (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar()));
create policy rel_agenda_mudar on rel_agenda for update to authenticated
  using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar()))
  with check (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar()));
create policy rel_agenda_apagar on rel_agenda for delete to authenticated
  using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar()));
grant select, insert, update, delete on rel_agenda to authenticated;

-- O panorama: horários de todos, conteúdo do privado só pro dono (e gestora).
drop view if exists rel_agenda_v;
create view rel_agenda_v as
select a.id, a.dono_id, u.name as dono_nome,
       a.inicio, a.fim, a.dia_inteiro, a.tipo, a.privado,
       (a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar()) as mascarado,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then 'Ocupado' else a.titulo end as titulo,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.descricao end as descricao,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.cliente_id end as cliente_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else cl.nome end as cliente_nome,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.viagem_id end as viagem_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.conversa_id end as conversa_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.local end as local,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null else a.link end as link,
       a.criado_em, a.atualizado_em
  from rel_agenda a
  join qs_users u on u.id = a.dono_id
  left join rel_clientes cl on cl.id = a.cliente_id
 where rel_tem_acesso();
revoke all on rel_agenda_v from anon;
grant select on rel_agenda_v to authenticated;
