-- 0162 — Expedições dentro do QS (Fase 2, 21/10/2026). JÁ APLICADA no banco.
-- 1) exp_criar_expedicao: cria a expedição + checklist padrão numa tacada só
--    (no app antigo eram 2 inserts soltos: se o 2º falhava, ficava expedição sem checklist).
-- 2) exp_reordenar: grava a ordem do arrastar-e-soltar da lista de uma vez.
-- 3) Realtime nas tabelas de expedições (telas atualizam sozinhas).
-- security invoker (padrão): quem chama precisa passar nas policies da 0160.

create or replace function public.exp_criar_expedicao(p_exp jsonb, p_itens jsonb default '[]'::jsonb)
returns uuid language plpgsql set search_path to 'public' as $function$
declare v_id uuid;
begin
  insert into expedicoes (codigo, nome, destino, data_embarque, data_retorno, responsavel_operacional_id, responsavel_comercial_id,
                          pax_planejados, preco_venda_brl, status, tipo)
  values (p_exp->>'codigo', p_exp->>'nome', p_exp->>'destino', (p_exp->>'data_embarque')::date, (p_exp->>'data_retorno')::date,
          nullif(p_exp->>'responsavel_operacional_id', '')::uuid, nullif(p_exp->>'responsavel_comercial_id', '')::uuid,
          coalesce((p_exp->>'pax_planejados')::int, 0), coalesce((p_exp->>'preco_venda_brl')::numeric, 0), 'Planejamento',
          coalesce(p_exp->>'tipo', 'expedicao'))
  returning id into v_id;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 0 then
    insert into checklist_itens (id, expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, parent_id, ordem)
    select (i->>'id')::uuid, v_id, (i->>'etapa')::etapa_checklist, i->>'tarefa', nullif(i->>'responsavel_id', '')::uuid,
           'Pendente', (i->>'prazo')::date, (i->>'prioridade')::prioridade, nullif(i->>'parent_id', '')::uuid, (i->>'ordem')::int
      from jsonb_array_elements(p_itens) i;
  end if;
  return v_id;
end $function$;

create or replace function public.exp_reordenar(p_ids uuid[])
returns void language sql set search_path to 'public' as $function$
  update expedicoes e set ordem = o.pos - 1
    from unnest(p_ids) with ordinality as o(id, pos)
   where e.id = o.id;
$function$;

grant execute on function public.exp_criar_expedicao(jsonb, jsonb) to authenticated;
grant execute on function public.exp_reordenar(uuid[]) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['arquivos','cambios','checklist_itens','custos','documentos','expedicao_avisos','expedicao_info',
    'expedicao_passeios','expedicao_voos','expedicoes','extensoes','fornecedores','grupos_expedicao','inscricoes_pendentes',
    'links_expedicao','pagamentos','passageiro_extensao','passageiro_quarto','passageiro_requisitos','passageiros',
    'passeios_opcionais','quartos','requisitos_destino','roteiro_dias','roteiro_lider_dias','usuarios'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
