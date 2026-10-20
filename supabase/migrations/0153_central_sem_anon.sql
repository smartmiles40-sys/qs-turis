-- 0153_central_sem_anon.sql
-- Funções da Central (0149/0150) nascem com EXECUTE pra PUBLIC (padrão do
-- Postgres). As que checam o usuário já barravam o anônimo, mas qs_sol_sobre e
-- qs_sol_cliente_do_lead devolveriam nome/id de cliente a quem tivesse um uuid.
-- Fecha tudo pra anon; quem usa é authenticated.
do $$
declare f text;
begin
  foreach f in array array[
    'qs_do_setor(text)', 'qs_gestor_do_setor(text)', 'qs_somar_minutos_uteis(timestamptz, int)',
    'qs_ve_solicitacao(text, text, uuid, uuid)', 'qs_eu_nome()',
    'qs_sol_criar(text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, uuid, text)',
    'qs_sol_acao(uuid, text, text, text)', 'qs_sol_visto(uuid)', 'qs_sol_contagem(text)',
    'qs_sol_buscar_clientes(text)', 'qs_sol_vendas_do_cliente(uuid)', 'qs_sol_vincular(uuid, uuid, uuid)',
    'qs_sol_sobre(uuid, uuid)', 'qs_sol_cliente_do_lead(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- Helpers internos: nem o usuário logado chama direto.
revoke execute on function public.qs_sol_sobre(uuid, uuid), public.qs_sol_cliente_do_lead(uuid) from authenticated;
