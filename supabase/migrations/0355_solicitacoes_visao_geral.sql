-- supabase/migrations/0355_solicitacoes_visao_geral.sql
-- -----------------------------------------------------------------------------
-- VISÃO GERAL DA CENTRAL DE SOLICITAÇÕES (Bruno, 10/11/2026)
--   "eu preciso que a Tainara tenha a visão de todas as solicitações dos
--    setores, pq ela não está conseguindo visualizar"
--
-- Antes: qs_ve_solicitacao só liberava quem pediu, o responsável, quem é do
-- setor de origem/destino (qs_do_setor) e o chefe na hierarquia (0336). A
-- Tainara é gestora só do Relacionamento → via só o que passa pelo Rel.
--
-- Agora: quem está na lista qs_settings.solicitacoes_visao_geral ({"ids":[…]})
-- LÊ as solicitações de todos os setores (pedido, conversa, anexos, eventos).
-- É só VER: aceitar/concluir/mudar continua com as regras de cada setor.
-- Pôr ou tirar alguém = editar a lista, sem deploy.
-- -----------------------------------------------------------------------------

create or replace function public.qs_ve_todas_solicitacoes()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users u
     where u.id = auth.uid() and u.is_active
       and (u.role = 'admin' or exists (
         select 1 from qs_settings s
          where s.key = 'solicitacoes_visao_geral'
            and (s.value -> 'ids') ? u.id::text))
  );
$$;
revoke all on function public.qs_ve_todas_solicitacoes() from public, anon;
grant execute on function public.qs_ve_todas_solicitacoes() to authenticated;

-- Mesma regra de antes + a visão geral (as policies de pedido, eventos,
-- seguidores e anexos já passam por esta função).
create or replace function public.qs_ve_solicitacao(p_de text, p_para text, p_criador uuid, p_resp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_criador = auth.uid() or p_resp = auth.uid() or qs_do_setor(p_de) or qs_do_setor(p_para)
      or qs_eh_do_meu_time(p_criador) or qs_eh_do_meu_time(p_resp)
      or qs_ve_todas_solicitacoes();
$$;

-- A Tainara (gestora do Relacionamento) entra na lista.
insert into qs_settings (key, value)
values ('solicitacoes_visao_geral', jsonb_build_object('ids', jsonb_build_array('85f5647d-6e80-428e-9b94-a59eb0abc632')))
on conflict (key) do update
  set value = jsonb_set(coalesce(qs_settings.value, '{}'::jsonb), '{ids}',
        (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
           from jsonb_array_elements_text(coalesce(qs_settings.value -> 'ids', '[]'::jsonb) || '["85f5647d-6e80-428e-9b94-a59eb0abc632"]'::jsonb) x));
