-- 0131_modelo_campos_rel_fin.sql
-- -----------------------------------------------------------------------------
-- O que é cada {{n}} dos modelos do número do Relacionamento (14/10/2026).
-- Além dos tipos da 0130, o valor pode ser um RÓTULO LIVRE — a tela de envio
-- mostra como está ("Assunto do contato") e exige o preenchimento.
-- -----------------------------------------------------------------------------
insert into qs_wa_modelo_campos (nome, campos) values
  ('fin_contato',            '{"1":"Primeiro nome do cliente","2":"Assunto do contato (ex.: a parcela de outubro da sua viagem)"}'),
  ('fin_pagamento_pendente', '{"1":"Primeiro nome do cliente","2":"O que está pendente (ex.: uma parcela em aberto)","3":"Destino da viagem (ex.: o Japão)"}'),
  ('rel_contato',            '{"1":"Primeiro nome do cliente","2":"Destino da viagem (ex.: o Japão)"}')
on conflict (nome) do update set campos = excluded.campos, atualizado_em = now();
