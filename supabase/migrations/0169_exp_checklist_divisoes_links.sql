-- 0169 — Expedições no QS: abas Checklist, Divisões e Links (21/10/2026).
-- Só funções novas (nada de coluna, nada de dado). Todas security invoker:
-- quem chama precisa passar nas policies da 0160 (exp_tem_acesso + not is_readonly).
--
-- 1) exp_gerar_checklist: gera o checklist padrão de uma expedição numa tacada só
--    (no app antigo eram 2 inserts soltos; se o 2º falhava ficavam só os pais).
-- 2) exp_checklist_mover_etapa: troca a fase de um processo e leva as subtarefas junto.
-- 3) exp_reordenar_checklist / exp_reordenar_links / exp_reordenar_grupos: grava a
--    ordem do arrastar-e-soltar de uma vez.
-- 4) exp_ativar_divisao / exp_remover_divisao: liga/desliga a divisão G1/G2 (só admin,
--    igual ao antigo). CORRIGE o bug do antigo: "Remover divisão" apagava TODOS os grupos
--    da expedição (inclusive os de voo do portal). Aqui só G1 e G2 saem, e só os
--    passageiros que estavam neles ficam sem grupo.

create or replace function public.exp_gerar_checklist(p_expedicao uuid, p_itens jsonb)
returns integer language plpgsql set search_path to 'public' as $function$
declare n integer;
begin
  if not exists (select 1 from expedicoes where id = p_expedicao) then
    raise exception 'Expedição não encontrada';
  end if;
  if exists (select 1 from checklist_itens where expedicao_id = p_expedicao) then
    raise exception 'Esta expedição já tem checklist. Apague os itens antes de regerar.';
  end if;
  insert into checklist_itens (id, expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, parent_id, ordem)
  select (i->>'id')::uuid, p_expedicao, (i->>'etapa')::etapa_checklist, i->>'tarefa', nullif(i->>'responsavel_id', '')::uuid,
         'Pendente', nullif(i->>'prazo', '')::date, (i->>'prioridade')::prioridade, nullif(i->>'parent_id', '')::uuid,
         coalesce((i->>'ordem')::int, 0)
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as x(i, pos)
   order by (i->>'parent_id') is not null, pos;   -- pais antes dos filhos (FK parent_id)
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.exp_checklist_mover_etapa(p_id uuid, p_etapa text)
returns void language plpgsql set search_path to 'public' as $function$
declare v_exp uuid; v_ordem int;
begin
  select expedicao_id into v_exp from checklist_itens where id = p_id and parent_id is null;
  if v_exp is null then raise exception 'Processo não encontrado'; end if;
  select coalesce(max(ordem), 0) + 1 into v_ordem
    from checklist_itens where expedicao_id = v_exp and parent_id is null and etapa = p_etapa::etapa_checklist and id <> p_id;
  update checklist_itens set etapa = p_etapa::etapa_checklist, ordem = v_ordem where id = p_id;
  update checklist_itens set etapa = p_etapa::etapa_checklist where parent_id = p_id;
end $function$;

create or replace function public.exp_reordenar_checklist(p_ids uuid[])
returns void language sql set search_path to 'public' as $function$
  update checklist_itens c set ordem = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where c.id = o.id;
$function$;

create or replace function public.exp_reordenar_links(p_ids uuid[])
returns void language sql set search_path to 'public' as $function$
  update links_expedicao l set ordem = o.pos - 1
    from unnest(p_ids) with ordinality as o(id, pos)
   where l.id = o.id;
$function$;

create or replace function public.exp_reordenar_grupos(p_ids uuid[])
returns void language sql set search_path to 'public' as $function$
  update grupos_expedicao g set ordem = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where g.id = o.id;
$function$;

create or replace function public.exp_ativar_divisao(p_expedicao uuid)
returns void language plpgsql set search_path to 'public' as $function$
begin
  if not exp_eh_admin() then raise exception 'Só o admin liga ou desliga a divisão G1/G2.'; end if;
  insert into grupos_expedicao (expedicao_id, nome, pax_planejados, ordem)
  values (p_expedicao, 'G1', 0, 1), (p_expedicao, 'G2', 0, 2)
  on conflict (expedicao_id, nome) do nothing;
end $function$;

create or replace function public.exp_remover_divisao(p_expedicao uuid)
returns integer language plpgsql set search_path to 'public' as $function$
declare v_ids uuid[]; n integer;
begin
  if not exp_eh_admin() then raise exception 'Só o admin liga ou desliga a divisão G1/G2.'; end if;
  select array_agg(id) into v_ids from grupos_expedicao where expedicao_id = p_expedicao and nome in ('G1', 'G2');
  if v_ids is null then return 0; end if;
  update passageiros set grupo_id = null where expedicao_id = p_expedicao and grupo_id = any(v_ids);
  get diagnostics n = row_count;
  delete from grupos_expedicao where id = any(v_ids);   -- só G1/G2; os outros grupos ficam
  return n;
end $function$;

revoke execute on function public.exp_gerar_checklist(uuid, jsonb), public.exp_checklist_mover_etapa(uuid, text),
  public.exp_reordenar_checklist(uuid[]), public.exp_reordenar_links(uuid[]), public.exp_reordenar_grupos(uuid[]),
  public.exp_ativar_divisao(uuid), public.exp_remover_divisao(uuid) from public, anon;
grant execute on function public.exp_gerar_checklist(uuid, jsonb), public.exp_checklist_mover_etapa(uuid, text),
  public.exp_reordenar_checklist(uuid[]), public.exp_reordenar_links(uuid[]), public.exp_reordenar_grupos(uuid[]),
  public.exp_ativar_divisao(uuid), public.exp_remover_divisao(uuid) to authenticated;
