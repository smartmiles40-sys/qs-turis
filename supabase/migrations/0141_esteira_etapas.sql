-- 0141_esteira_etapas.sql
-- -----------------------------------------------------------------------------
-- ESTEIRA DO RELACIONAMENTO (16/10/2026). O processo do time, etapa por etapa:
--   passagem (de bastão) → revisao → d30 → d7 → d3 → checkin → em_viagem → retorno
-- Cada etapa concluída fica registrada com o checklist marcado, quem fez,
-- quando e — nas checagens D-30/D-7/D-3 — se houve alteração na passagem/reserva.
-- A etapa "atual" de cada viagem é a primeira não concluída (calculada na tela).
-- -----------------------------------------------------------------------------

create table if not exists rel_viagem_etapas (
  viagem_id        uuid not null references rel_viagens(id) on delete cascade,
  etapa            text not null check (etapa in ('passagem', 'revisao', 'd30', 'd7', 'd3', 'checkin', 'em_viagem', 'retorno')),
  concluida_em     timestamptz,
  concluida_por    uuid references qs_users(id) on delete set null,
  checklist        jsonb not null default '[]'::jsonb,   -- [{ item, feito }]
  houve_alteracao  boolean,                               -- D-30/D-7/D-3: mudou algo na reserva?
  alteracao        text,
  obs              text,
  atualizado_em    timestamptz not null default now(),
  primary key (viagem_id, etapa)
);
create index if not exists rel_viagem_etapas_viagem_idx on rel_viagem_etapas (viagem_id);

alter table rel_viagem_etapas enable row level security;
revoke all on rel_viagem_etapas from anon;
grant select, insert, update, delete on rel_viagem_etapas to authenticated;
drop policy if exists rel_etapas_ler on rel_viagem_etapas;
drop policy if exists rel_etapas_gravar on rel_viagem_etapas;
drop policy if exists rel_etapas_mudar on rel_viagem_etapas;
drop policy if exists rel_etapas_apagar on rel_viagem_etapas;
create policy rel_etapas_ler    on rel_viagem_etapas for select to authenticated using (rel_tem_acesso());
create policy rel_etapas_gravar on rel_viagem_etapas for insert to authenticated with check (rel_tem_acesso());
create policy rel_etapas_mudar  on rel_viagem_etapas for update to authenticated using (rel_tem_acesso()) with check (rel_tem_acesso());
create policy rel_etapas_apagar on rel_viagem_etapas for delete to authenticated using (rel_tem_acesso());

-- A revisão já marcada à mão antes da esteira ("Marcar viagem como revisada") conta como etapa feita.
insert into rel_viagem_etapas (viagem_id, etapa, concluida_em, concluida_por, obs)
select id, 'revisao', revisado_em, revisado_por, coalesce(revisao_obs, 'Marcada como revisada antes da esteira')
  from rel_viagens where revisado_em is not null
on conflict do nothing;
