-- 0130_modelo_campos.sql
-- -----------------------------------------------------------------------------
-- (Aplicada no banco em 2 partes: 0130a_modelo_campos_tabela + 0130b_modelo_campos_seed.)
-- O QUE É CADA VARIÁVEL de um modelo da Meta (14/10/2026). A Meta só conhece
-- {{1}}, {{2}}…; aqui o QS guarda que {{2}} é o destino, {{3}} o especialista…
-- e no envio o SDR recebe o modelo JÁ PREENCHIDO (sempre editável).
-- Tipos: nome_lead, nome_sdr, destino, especialista, reuniao_dia, reuniao_hora, livre.
-- O nome do modelo é o mesmo nas contas de todos os SDRs (cada um tem a sua WABA).
-- -----------------------------------------------------------------------------
create table if not exists qs_wa_modelo_campos (
  nome          text primary key,
  campos        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table qs_wa_modelo_campos enable row level security;
drop policy if exists qs_wa_modelo_campos_ler on qs_wa_modelo_campos;
drop policy if exists qs_wa_modelo_campos_escrever on qs_wa_modelo_campos;
create policy qs_wa_modelo_campos_ler on qs_wa_modelo_campos for select to authenticated
  using (exists (select 1 from qs_users where id = auth.uid() and is_active));
create policy qs_wa_modelo_campos_escrever on qs_wa_modelo_campos for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());
grant select, insert, update, delete on qs_wa_modelo_campos to authenticated;

insert into qs_wa_modelo_campos (nome, campos) values
  ('d1_t2_pos_ligacao',    '{"1":"nome_lead","2":"destino"}'),
  ('d2_t6_horario',        '{"1":"nome_lead"}'),
  ('d4_t9_roteiro',        '{"1":"nome_lead","2":"destino"}'),
  ('d8_t11_prova_social',  '{"1":"nome_lead","2":"destino"}'),
  ('d8_t11_vagas',         '{"1":"nome_lead","2":"destino","3":"livre","4":"livre"}'),
  ('d10_t12_encerramento', '{"1":"nome_lead","2":"destino"}'),
  ('reuniao_link',         '{"1":"nome_lead","2":"destino","3":"especialista","4":"reuniao_dia","5":"reuniao_hora"}'),
  ('reuniao_confirmacao',  '{"1":"nome_lead","2":"destino","3":"reuniao_hora","4":"especialista"}'),
  ('reuniao_no_show',      '{"1":"nome_lead","2":"reuniao_hora","3":"especialista"}')
on conflict (nome) do update set campos = excluded.campos, atualizado_em = now();
