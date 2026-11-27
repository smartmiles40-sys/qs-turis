-- 0429_responsaveis_rel_todos.sql
-- -----------------------------------------------------------------------------
-- LISTA "QUEM CUIDA NO RELACIONAMENTO" PRA QUEM SOBE VENDA (27/11/2026).
--
-- O Subir venda (src/venda/SubirVenda.tsx) ganhou o campo "Quem vai cuidar no
-- Relacionamento" (grava qs_vendas.rel_responsavel_id, 0423). A lista vem de
-- closer_responsaveis_rel(), que só respondia pra gestor ou closer — quem é do
-- Relacionamento ou do Operacional e abre o Subir venda via a lista VAZIA.
--
-- Agora: qualquer usuário ATIVO do QS recebe a lista (só id + nome de quem é do
-- Relacionamento; nada sensível). A trava de quem pode ser escolhido continua no
-- venda_subir (0423: usuário ativo do Relacionamento, senão 'responsavel-invalido').
--
-- Volta: recriar com "and (qs_is_manager() or qs_is_closer())" no where.
-- -----------------------------------------------------------------------------
create or replace function public.closer_responsaveis_rel()
returns table(id uuid, name text)
language sql stable security definer
set search_path to 'public'
as $function$
  select u.id, u.name from qs_users u
   where u.is_active and u.role <> 'admin' and 'relacionamento' = any(coalesce(u.setores, '{}'))
     and exists (select 1 from qs_users me where me.id = auth.uid() and me.is_active)
   order by u.name;
$function$;

revoke all on function public.closer_responsaveis_rel() from public, anon;
grant execute on function public.closer_responsaveis_rel() to authenticated;
