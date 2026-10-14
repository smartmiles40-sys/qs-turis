-- 0133_modelo_campos_fin_expedicao.sql
-- Versão do modelo de antecipação que serve pra TODAS as expedições (14/10/2026).
insert into qs_wa_modelo_campos (nome, campos) values
  ('fin_antecipacao_expedicao', '{"1":"Primeiro nome do cliente","2":"Destino da expedição, com artigo (ex.: o Japão e a China)","3":"Até quando você manda o link (dia + data, ex.: sexta-feira, 24/10)"}')
on conflict (nome) do update set campos = excluded.campos, atualizado_em = now();
