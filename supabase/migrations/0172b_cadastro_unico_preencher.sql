-- 0172b — preenche o cadastro único com o que já existe (roda UMA vez, depois do ok do Bruno).
-- Liga cada passageiro à ficha (acha ou cria), completa o lado vazio e manda as
-- diferenças pra fila cad_divergencias. Pode rodar de novo sem duplicar.
do $$
declare r record;
begin
  for r in select id from passageiros order by created_at loop
    perform cad_ligar_passageiro(r.id, true);
  end loop;
end $$;
