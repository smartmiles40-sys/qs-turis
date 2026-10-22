-- 0197_solicitacao_de_quem_pediu.sql
-- -----------------------------------------------------------------------------
-- PEDIDO AMARRADO À PESSOA (Bruno, 22/10/2026): "as solicitações têm que ir
-- atreladas à pessoa que fez, pra facilitar o contato com quem fez e não com
-- qualquer pessoa".
--
-- Até aqui, "quem pediu" era a pessoa OU qualquer colega do setor dela
-- (pediu := criado_por = eu OR qs_do_setor(de_setor)). Agora:
--   • AGIR como quem pediu (confirmar, reabrir, cancelar, desfecho, ajustar o
--     pedido) = a própria pessoa OU o gestor desse setor / admin (pra cobrir
--     férias e quem saiu da empresa).
--   • Os colegas do setor continuam VENDO e COMENTANDO (o acesso não muda).
-- Os avisos de volta (0196) já vão só pra criado_por.
--
-- Como: reescreve a definição VIGENTE das duas funções trocando só a regra
-- (não copia a função inteira — evita reverter qualquer ajuste posterior). Se o
-- trecho esperado não estiver lá, para com erro em vez de aplicar pela metade.
-- -----------------------------------------------------------------------------

-- Quem pode agir como "quem pediu": a pessoa, ou admin / gestor do setor de origem.
create or replace function qs_sol_age_como_quem_pediu(p_criado_por uuid, p_de_setor text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_criado_por = auth.uid()
      or exists (select 1 from qs_users u
                  where u.id = auth.uid() and u.is_active
                    and (u.role = 'admin' or (u.role = 'gestor' and p_de_setor = any(u.setores))));
$$;
revoke all on function qs_sol_age_como_quem_pediu(uuid, text) from public, anon;
grant execute on function qs_sol_age_como_quem_pediu(uuid, text) to authenticated;

do $$
declare
  def text;
  novo text;
begin
  -- qs_sol_acao: "pediu" vira a pessoa/gestor; o acesso de leitura dos colegas fica.
  select pg_get_functiondef('public.qs_sol_acao(uuid, text, text, text)'::regprocedure) into def;
  novo := replace(def,
    'pediu  := s.criado_por = auth.uid() or qs_do_setor(s.de_setor);',
    'pediu  := qs_sol_age_como_quem_pediu(s.criado_por, s.de_setor);');
  novo := replace(novo,
    'if not (recebe or pediu or s.responsavel_id = auth.uid()) then',
    'if not (recebe or pediu or s.responsavel_id = auth.uid() or qs_do_setor(s.de_setor)) then');
  if novo = def or position('qs_sol_age_como_quem_pediu' in novo) = 0 or position('or qs_do_setor(s.de_setor)) then' in novo) = 0 then
    raise exception '[0197] qs_sol_acao não está como esperado — nada foi alterado.';
  end if;
  execute novo;

  -- qs_sol_ajustar: só quem pediu (ou o gestor) ajusta o pedido.
  select pg_get_functiondef('public.qs_sol_ajustar(uuid, text, text, jsonb, text, text)'::regprocedure) into def;
  novo := replace(def,
    'if not (s.criado_por = auth.uid() or qs_do_setor(s.de_setor)) then',
    'if not qs_sol_age_como_quem_pediu(s.criado_por, s.de_setor) then');
  if novo = def then
    raise exception '[0197] qs_sol_ajustar não está como esperado — nada foi alterado.';
  end if;
  execute novo;
end $$;
