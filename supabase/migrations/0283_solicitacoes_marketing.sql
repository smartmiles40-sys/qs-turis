-- 0283 — Central de Solicitações: o MARKETING entra (03/11/2026)
-- -----------------------------------------------------------------------------
-- Bruno (03/11): "Solicitações deve funcionar entre os setores". Até aqui o
-- banco só aceitava os 4 setores de atendimento (0149); o Marketing (0240)
-- ficava de fora: não pedia nem recebia pedido.
--
--   • de_setor / para_setor / tipos / distribuição aceitam 'marketing'
--   • 4 tipos de pedido pro Marketing (o gestor ajusta em "Tipos e prazos")
--   • aviso no sino: nome "Marketing" e link #mkt/solicitacoes/<id>
--   • quem recebe: no setor Marketing, o papel 'marketing' recebe (nos outros
--     setores continua de fora — a pessoa do Marketing que também está no
--     Comercial não leva aviso de cada pedido do Comercial)
--
-- O front só mostra o Marketing na Central quando existem tipos ativos dele
-- (= esta migration aplicada). Antes disso nada muda pra ninguém.
-- RLS: igual aos outros setores (qs_ve_solicitacao: quem pediu, o dono, e
-- quem é do setor de origem ou de destino). Só arquivo: aplicar com o ok do Bruno.
-- -----------------------------------------------------------------------------

alter table qs_solicitacoes drop constraint if exists qs_solicitacoes_de_setor_check;
alter table qs_solicitacoes add constraint qs_solicitacoes_de_setor_check
  check (de_setor = any (array['comercial','relacionamento','financeiro','operacional','marketing']));
alter table qs_solicitacoes drop constraint if exists qs_solicitacoes_para_setor_check;
alter table qs_solicitacoes add constraint qs_solicitacoes_para_setor_check
  check (para_setor = any (array['comercial','relacionamento','financeiro','operacional','marketing']));
alter table qs_solicitacao_tipos drop constraint if exists qs_solicitacao_tipos_setor_check;
alter table qs_solicitacao_tipos add constraint qs_solicitacao_tipos_setor_check
  check (setor = any (array['comercial','relacionamento','financeiro','operacional','marketing']));
alter table qs_sol_distribuicao drop constraint if exists qs_sol_distribuicao_setor_check;
alter table qs_sol_distribuicao add constraint qs_sol_distribuicao_setor_check
  check (setor = any (array['comercial','relacionamento','financeiro','operacional','marketing']));

insert into qs_solicitacao_tipos (id, setor, rotulo, prazo_horas, prazo_alta_horas, prazo_urgente_horas, ordem, ativo, grupo)
values
  ('mkt_arte',      'marketing', 'Arte / peça (post, story, banner)',         16, 8, 4, 10, true, null),
  ('mkt_conteudo',  'marketing', 'Conteúdo pra rede social',                  16, 8, 4, 20, true, null),
  ('mkt_campanha',  'marketing', 'Campanha / anúncio (tráfego)',              16, 8, 4, 30, true, null),
  ('mkt_outro',     'marketing', 'Outro',                                      8, 4, 2, 99, true, 'Outros')
on conflict (id) do nothing;

create or replace function public.qs_avisos_nome_setor(p_setor text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case p_setor when 'comercial' then 'Comercial' when 'relacionamento' then 'Relacionamento'
                      when 'financeiro' then 'Financeiro' when 'operacional' then 'Operações'
                      when 'marketing' then 'Marketing' else coalesce(p_setor, '') end;
$function$;

create or replace function public.qs_avisos_link_sol(p_setor text, p_user uuid, p_sol uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select '#' || case p_setor
      when 'relacionamento' then 'rel'
      when 'financeiro' then 'fin'
      when 'operacional' then 'ops'
      when 'marketing' then 'mkt'
      else case when (select role from qs_users where id = p_user) = 'closer' then 'closer' else 'comercial' end
    end || '/solicitacoes/' || p_sol::text;
$function$;

create or replace function public.qs_avisos_recebedores(p_setor text)
 returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  with gente as (
    select id, role from qs_users
     where is_active and p_setor = any(coalesce(setores, '{}'))
       and (role <> 'marketing' or p_setor = 'marketing')
  )
  select id from gente where role <> 'admin'
  union all
  select id from gente where role = 'admin' and not exists (select 1 from gente where role <> 'admin');
$function$;
