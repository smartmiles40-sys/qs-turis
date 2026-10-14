-- 0132_modelo_campos_fin_giovana.sql
-- O que é cada {{n}} do modelo de antecipação da parcela (Japão e China), 14/10/2026.
insert into qs_wa_modelo_campos (nome, campos) values
  ('fin_antecipacao_japao_china', '{"1":"Primeiro nome do cliente","2":"Até quando você manda o link (dia + data, ex.: sexta-feira, 24/10)"}')
on conflict (nome) do update set campos = excluded.campos, atualizado_em = now();
