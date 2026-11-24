-- 0417 — ROTINA DO RELACIONAMENTO: etapas por EXPEDIÇÃO (24/11/2026).
-- Bruno: "uma rotina igual dos SDRs para o relacionamento, onde elas têm que seguir a
-- cadência pra fazer check-in, revisar as coisas da expedição etc."
-- A esteira dos pacotes vive em rel_viagem_etapas (uma linha por viagem × etapa). A
-- expedição é UM grupo com dezenas de viagens (uma por pessoa), então a etapa é do GRUPO:
-- uma linha por expedição × etapa. Mesmo formato e mesmas regras de acesso.

create table if not exists rel_expedicao_etapas (
  expedicao_id    uuid not null references expedicoes(id) on delete cascade,
  etapa           text not null,
  concluida_em    timestamptz,
  concluida_por   uuid,
  checklist       jsonb not null default '[]'::jsonb,
  houve_alteracao boolean,
  alteracao       text,
  obs             text,
  atualizado_em   timestamptz not null default now(),
  primary key (expedicao_id, etapa)
);

alter table rel_expedicao_etapas enable row level security;

drop policy if exists app_cliente_barreira on rel_expedicao_etapas;
create policy app_cliente_barreira on rel_expedicao_etapas as restrictive for all
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists rel_exp_etapas_ler on rel_expedicao_etapas;
create policy rel_exp_etapas_ler on rel_expedicao_etapas for select using ((select rel_tem_acesso()));
drop policy if exists rel_exp_etapas_gravar on rel_expedicao_etapas;
create policy rel_exp_etapas_gravar on rel_expedicao_etapas for insert with check ((select rel_tem_acesso()));
drop policy if exists rel_exp_etapas_mudar on rel_expedicao_etapas;
create policy rel_exp_etapas_mudar on rel_expedicao_etapas for update using ((select rel_tem_acesso())) with check ((select rel_tem_acesso()));
drop policy if exists rel_exp_etapas_apagar on rel_expedicao_etapas;
create policy rel_exp_etapas_apagar on rel_expedicao_etapas for delete using ((select rel_tem_acesso()));

grant select, insert, update, delete on rel_expedicao_etapas to authenticated;
