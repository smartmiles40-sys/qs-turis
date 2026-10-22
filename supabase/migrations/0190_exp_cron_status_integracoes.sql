-- 0190_exp_cron_status_integracoes.sql
-- Expedições: o que faltava pro QS assumir as rotinas do portal antigo
-- (sistema-expedicoes → app/api/expedicoes/atualizar-status e o botão
-- "Atualizar do Bitrix"). Só ADIÇÕES: duas funções, nenhuma tabela/coluna mexida.
--
-- 1) exp_pode_editar(): a mesma regra das telas (tem acesso às Expedições e não
--    é só-leitura). A rota /api/expedicoes pergunta isso com o token de quem
--    clicou antes de chamar o n8n.
-- 2) exp_atualizar_status(): o cron diário (00:00 de Brasília) que avança o
--    status pela data — Planejamento/Vendas Abertas → Em andamento quando já
--    embarcou; qualquer não-terminal → Concluída quando já voltou. Igual ao
--    antigo, mas com o "hoje" no fuso de Brasília (o antigo usava UTC) e numa
--    tacada só. Só o servidor (service_role) chama — ninguém da tela.

create or replace function public.exp_pode_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exp_tem_acesso() and not is_readonly();
$$;

revoke all on function public.exp_pode_editar() from public, anon;
grant execute on function public.exp_pode_editar() to authenticated, service_role;

create or replace function public.exp_atualizar_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n_andamento integer;
  n_concluidas integer;
begin
  -- Só o servidor (cron da Vercel com service_role). Usuário logado não chama.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só a rotina automática pode atualizar os status.';
  end if;

  update expedicoes
     set status = 'Em andamento'
   where status in ('Planejamento', 'Vendas Abertas')
     and data_embarque <= hoje
     and data_retorno >= hoje;
  get diagnostics n_andamento = row_count;

  update expedicoes
     set status = 'Concluída'
   where status not in ('Cancelada', 'Concluída')
     and data_retorno < hoje;
  get diagnostics n_concluidas = row_count;

  return jsonb_build_object('hoje', hoje, 'em_andamento', n_andamento, 'concluidas', n_concluidas);
end $$;

revoke all on function public.exp_atualizar_status() from public, anon, authenticated;
grant execute on function public.exp_atualizar_status() to service_role;
