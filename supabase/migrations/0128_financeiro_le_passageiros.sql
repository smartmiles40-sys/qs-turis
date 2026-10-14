-- 0128_financeiro_le_passageiros.sql
-- O Financeiro vê as viagens do cliente no detalhe do atendimento (0127); a
-- busca passa pelos passageiros. Só LEITURA — quem mexe continua sendo o Rel.
drop policy if exists rel_viagem_passageiros_ler on rel_viagem_passageiros;
create policy rel_viagem_passageiros_ler on rel_viagem_passageiros for select to authenticated
  using (rel_tem_acesso() or fin_tem_acesso());
