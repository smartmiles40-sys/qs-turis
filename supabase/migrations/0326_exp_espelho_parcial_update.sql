-- 0326_exp_espelho_parcial_update.sql
-- -----------------------------------------------------------------------------
-- 06/11: o espelho terminava toda rodada com 4 avisos. Era o 2º passo (colunas
-- "adiadas" que apontam pra arquivos/itens: foto e passaporte do passageiro,
-- voucher de hospedagem da expedição/extensão, item-pai do checklist). Ele manda
-- só id + essas colunas, e o INSERT … ON CONFLICT confere NOT NULL antes do
-- conflito → "null value in column nome_completo" → nada gravado. Resultado: 23
-- fotos, 26 passaportes e 2 vouchers que existem no antigo faltavam no QS.
-- Agora, lote parcial = UPDATE das linhas que já existem (o 1º passo já criou).
-- Resto da função igual à 0320.
-- -----------------------------------------------------------------------------
create or replace function public.exp_espelho_aplicar(p_tabela text, p_linhas jsonb, p_colunas text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pk   text := _exp_espelho_pk(p_tabela);
  v_cols text[];
  v_lista text; v_set text; v_t text; v_x text; v_sql text;
  v_n int := 0; v_fila int := 0; v_troca int := 0; v_k int;
  v_uq record; v_cond text;
  v_parcial boolean; v_upd text; v_n_cols text;
begin
  if not (p_tabela = any (_exp_espelho_tabelas())) then raise exception 'Tabela fora do espelho: %', p_tabela; end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'p_linhas tem que ser uma lista'; end if;
  if jsonb_array_length(p_linhas) = 0 then return jsonb_build_object('aplicadas', 0); end if;

  select array_agg(c.column_name::text order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_tabela
     and c.is_generated = 'NEVER' and c.column_name::text = any (p_colunas);
  if v_cols is null or not (v_pk = any (v_cols)) then
    raise exception 'Colunas inválidas pra % (a chave % é obrigatória)', p_tabela, v_pk;
  end if;

  perform set_config('exp.espelho', 'on', true);

  -- Recriadas no antigo: tira a versão velha (só a que veio do antigo, só em tabela sem filhos).
  if p_tabela = any (_exp_espelho_apagaveis())
     and not exists (select 1 from pg_constraint f where f.contype = 'f' and f.confrelid = ('public.' || p_tabela)::regclass) then
    for v_uq in
      select array_agg(a.attname::text order by k.ord) cols
        from pg_constraint u
        cross join lateral unnest(u.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = u.conrelid and a.attnum = k.attnum
       where u.contype = 'u' and u.conrelid = ('public.' || p_tabela)::regclass
       group by u.oid
    loop
      if not (v_uq.cols <@ v_cols) then continue; end if;
      select string_agg(format('t.%1$I is not distinct from n.%1$I', c), ' and ') into v_cond from unnest(v_uq.cols) c;
      execute format(
        'with n as (select * from jsonb_populate_recordset(null::public.%1$I, $1)),
              velhas as (
                select t.%2$I::text id from public.%1$I t join n on %3$s
                 where t.%2$I::text <> n.%2$I::text
                   and exists (select 1 from public.exp_espelho_ids e where e.tabela = %4$L and e.id = t.%2$I::text)),
              fora as (delete from public.%1$I t using velhas v where t.%2$I::text = v.id returning t.%2$I::text id)
         delete from public.exp_espelho_ids e using fora where e.tabela = %4$L and e.id = fora.id',
        p_tabela, v_pk, v_cond, p_tabela) using p_linhas;
      get diagnostics v_k = row_count;
      v_troca := v_troca + v_k;
    end loop;
  end if;

  select string_agg(quote_ident(c), ', ') into v_lista from unnest(v_cols) c;
  select string_agg(format('%1$I = excluded.%1$I', c), ', '),
         string_agg(format('t.%I', c), ', '),
         string_agg(format('excluded.%I', c), ', ')
    into v_set, v_t, v_x
    from unnest(v_cols) c where c <> v_pk;

  -- 0326: lote PARCIAL (2º passo do espelho: id + colunas adiadas). O upsert
  -- confere NOT NULL antes de ver o conflito e recusava a linha inteira
  -- ("null value in column nome_completo"), então foto/passaporte/voucher novos
  -- nunca chegavam. Faltando coluna obrigatória → UPDATE só das linhas que já existem.
  select exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_tabela
       and c.is_nullable = 'NO' and c.column_default is null and c.is_generated = 'NEVER'
       and c.is_identity = 'NO' and not (c.column_name::text = any (v_cols))
  ) into v_parcial;

  if v_parcial and v_set is not null then
    select string_agg(format('%1$I = n.%1$I', c), ', '), string_agg(format('n.%I', c), ', ')
      into v_upd, v_n_cols
      from unnest(v_cols) c where c <> v_pk;
    v_sql := format('update public.%1$I as t set %2$s from jsonb_populate_recordset(null::public.%1$I, $1) n
                     where t.%3$I = n.%3$I and (%4$s) is distinct from (%5$s)',
                    p_tabela, v_upd, v_pk, v_t, v_n_cols);
  elsif v_set is null then
    v_sql := format('insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)
                     on conflict (%3$I) do nothing', p_tabela, v_lista, v_pk);
  else
    v_sql := format('insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)
                     on conflict (%3$I) do update set %4$s where (%5$s) is distinct from (%6$s)',
                    p_tabela, v_lista, v_pk, v_set, v_t, v_x);
  end if;
  execute v_sql using p_linhas;
  get diagnostics v_n = row_count;

  if p_tabela = any (_exp_espelho_apagaveis()) then
    insert into exp_espelho_ids (tabela, id)
    select p_tabela, x ->> v_pk from jsonb_array_elements(p_linhas) x where x ->> v_pk is not null
    on conflict do nothing;
  end if;

  if p_tabela = 'arquivos' then
    insert into exp_espelho_storage (caminho)
    select distinct x ->> 'storage_path' from jsonb_array_elements(p_linhas) x
     where coalesce(x ->> 'storage_path', '') <> ''
       and not exists (select 1 from storage.objects o
                        where o.bucket_id = 'arquivos-expedicoes' and o.name = x ->> 'storage_path')
    on conflict (caminho) do nothing;
    get diagnostics v_fila = row_count;
  end if;

  perform set_config('exp.espelho', 'off', true);
  return jsonb_build_object('aplicadas', v_n, 'arquivos_na_fila', v_fila, 'recriadas_trocadas', v_troca);
end $$;

revoke all on function public.exp_espelho_aplicar(text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.exp_espelho_aplicar(text, jsonb, text[]) to service_role;
