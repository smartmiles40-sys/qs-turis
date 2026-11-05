-- 0317 — Espelho ao vivo: Sistema de Expedições ANTIGO → QS (05/11/2026)
-- -----------------------------------------------------------------------------
-- O app antigo (banco bnbpsuenlokhljrkvlke) continua sendo a FONTE enquanto o
-- time valida as telas do QS. A cada 5 min o cron /api/expedicoes?acao=espelho
-- lê o antigo (só GET) e aplica aqui. Esta migration prepara o QS pra isso:
--
--   1. As 2 colunas que o antigo tem e o QS não (expedicoes.bitrix_stage_id,
--      passageiros.nova_venda).
--   2. Estado do espelho: cursor por tabela, ids que vieram do antigo (só esses
--      podem ser apagados) e a fila de arquivos do Storage a copiar.
--   3. A flag "em validação" em ops_config (chave 'exp_espelho'): enquanto
--      valor.ligado = true, as telas de Expedições ficam só leitura com a faixa
--      "Em validação" e o cron trabalha. Desligar (na troca):
--        update ops_config set valor = valor || '{"ligado": false}' where chave = 'exp_espelho';
--      → o cron para na hora (mesmo com a env ligada) e as telas voltam a editar.
--   4. RPCs só do service_role: exp_espelho_aplicar / exp_espelho_apagar /
--      exp_espelho_mapa_usuarios / exp_espelho_registrar. A tela lê só
--      exp_espelho_status() (ligado + quando sincronizou).
--   5. Gatilhos: dentro das RPCs do espelho vale set_config('exp.espelho','on')
--      (só naquela transação). Os gatilhos que gerariam efeito colateral ganham
--      um WHEN que os pula nesse caso — sem reescrever o corpo de nenhuma função.
--
-- Gatilhos PULADOS durante o espelho (o dado já vem pronto do antigo):
--   · set_updated_at (26 tabelas)         → mantém o updated_at do antigo
--   · audit_change (custos, expedicoes, pagamentos, passageiro_requisitos,
--     passageiros)                        → a auditoria vem do audit_log do antigo
--   · _exp_trg_passageiro_requisitos      → NÃO instancia requisitos (0166): vêm do antigo
--   · _exp_trg_pax_requisitos_baixa       → não mexe em requisitos
--   · _exp_trg_pax_valores                → status_financeiro vem do antigo; sem "condição especial" barrando
--   · _exp_trg_pax_valores_log            → não enche exp_valor_historico com "sistema"
--   · _exp_trg_inscricao_auto             → NÃO aprova inscrição sozinho (criaria passageiro)
--   · _exp_trg_inscricao_receita          → apagar inscrição não marca receita no passageiro
-- Gatilhos que CONTINUAM rodando (de propósito):
--   · cad_trg_passageiro / _exp_trg_pax_cad_extras → cadastro único: passageiro novo
--     ganha a ficha (rel_clientes) como se tivesse nascido no QS. Só SQL local, sem
--     rede/Bitrix, e engolem os próprios erros.
--   · _cad_trg_laudo_pax_apagado → passageiro apagado não leva o laudo junto.
--   · _exp_ck_item_conclusao → só preenche concluido_por/em (colunas só do QS).
-- Nenhum gatilho dessas 34 tabelas chama rede, n8n ou Bitrix (conferido 05/11).
-- -----------------------------------------------------------------------------

-- 1. Colunas que só o antigo tinha -------------------------------------------
alter table public.expedicoes  add column if not exists bitrix_stage_id text;
alter table public.passageiros add column if not exists nova_venda boolean not null default false;

-- 2. Estado ------------------------------------------------------------------
-- Cursor por tabela. cursor_ts é o TEXTO que o PostgREST do antigo devolveu
-- (microssegundos intactos); cursor_id desempata linhas com o mesmo instante.
create table if not exists public.exp_espelho_estado (
  tabela          text primary key,
  cursor_ts       text,
  cursor_id       text,
  linhas_total    bigint not null default 0,
  ultima_leva_em  timestamptz,
  ultimo_erro     text,
  ultimo_erro_em  timestamptz
);

-- Ids que existem no QS PORQUE vieram do antigo. A limpeza de apagados só
-- apaga o que está aqui — linha criada direto no QS nunca é apagada pelo espelho.
create table if not exists public.exp_espelho_ids (
  tabela text not null,
  id     text not null,
  primary key (tabela, id)
);

-- Fila de arquivos do Storage (bucket arquivos-expedicoes, mesmo caminho nos 2 lados).
create table if not exists public.exp_espelho_storage (
  caminho     text primary key,
  bucket      text not null default 'arquivos-expedicoes',
  criado_em   timestamptz not null default now(),
  copiado_em  timestamptz,
  tentativas  int not null default 0,
  erro        text
);
create index if not exists exp_espelho_storage_pendentes
  on public.exp_espelho_storage (criado_em) where copiado_em is null;

alter table public.exp_espelho_estado  enable row level security;
alter table public.exp_espelho_ids     enable row level security;
alter table public.exp_espelho_storage enable row level security;
revoke all on public.exp_espelho_estado, public.exp_espelho_ids, public.exp_espelho_storage from anon, authenticated;

-- Semente dos "vindos do antigo": tudo que a cópia de 21/10 trouxe (a cópia
-- terminou ~20:40 UTC; o que nasceu no QS depois disso fica protegido).
do $$
declare t text; pk text;
begin
  foreach t in array array['fornecedores','requisitos_destino','compras_bitrix','acesso_senhas','expedicoes',
    'grupos_expedicao','extensoes','quartos','roteiro_dias','roteiro_lider_dias','passageiros','arquivos',
    'documentos','passageiro_quarto','passageiro_extensao','passageiro_requisitos','checklist_itens','custos',
    'pagamentos','expedicao_avisos','expedicao_info','expedicao_passeios','expedicao_voos','links_expedicao',
    'passeios_opcionais','passeio_opcional_compras','roteiro_dia_fotos','inscricoes_pendentes','acesso_links'] loop
    pk := case t when 'acesso_senhas' then 'cpf' else 'id' end;
    execute format('insert into public.exp_espelho_ids (tabela, id) select %L, %I::text from public.%I
                     where created_at < %L::timestamptz on conflict do nothing', t, pk, t, '2026-10-21 21:00:00+00');
  end loop;
end $$;

-- 3. Flag "em validação" -------------------------------------------------------
insert into public.ops_config (chave, valor, atualizado_em)
values ('exp_espelho', '{"ligado": true}'::jsonb, now())
on conflict (chave) do nothing;

-- 4. RPCs ----------------------------------------------------------------------
-- Tabelas do espelho (ordem: pais antes de filhos).
create or replace function public._exp_espelho_tabelas()
returns text[] language sql immutable as $$
  select array['usuarios','fornecedores','requisitos_destino','cambios','compras_bitrix','acesso_senhas',
    'expedicoes','grupos_expedicao','extensoes','quartos','roteiro_dias','roteiro_lider_dias','passageiros',
    'arquivos','documentos','passageiro_quarto','passageiro_extensao','passageiro_requisitos','checklist_itens',
    'custos','pagamentos','expedicao_avisos','expedicao_info','expedicao_passeios','expedicao_voos',
    'links_expedicao','passeios_opcionais','passeio_opcional_compras','roteiro_dia_fotos','inscricoes_pendentes',
    'inscricoes_decisoes','acesso_links','expedamigo_acessos','audit_log']
$$;

-- Tabelas em que o espelho pode APAGAR (logs só crescem; usuários e câmbios nunca somem pelo espelho).
create or replace function public._exp_espelho_apagaveis()
returns text[] language sql immutable as $$
  select array_remove(array_remove(array_remove(array_remove(array_remove(
    public._exp_espelho_tabelas(), 'usuarios'), 'cambios'), 'audit_log'), 'expedamigo_acessos'), 'inscricoes_decisoes')
$$;

create or replace function public._exp_espelho_pk(p_tabela text)
returns text language sql immutable as $$
  select case p_tabela when 'cambios' then 'moeda' when 'acesso_senhas' then 'cpf' else 'id' end
$$;

-- Upsert de um lote vindo do antigo. Só as colunas pedidas (p_colunas) que
-- existem no QS e não são geradas entram no insert/update — as colunas que só
-- o QS tem (cliente_id, venda_id, setor...) NUNCA são tocadas. Só atualiza a
-- linha que de fato mudou (where ... is distinct from ...), então reler a
-- sobreposição do cursor não gera escrita nem gatilho.
-- Também serve pra "completar" colunas adiadas: p_colunas = [chave, colunas].
create or replace function public.exp_espelho_aplicar(p_tabela text, p_linhas jsonb, p_colunas text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pk   text := _exp_espelho_pk(p_tabela);
  v_cols text[];
  v_lista text; v_set text; v_t text; v_x text; v_sql text;
  v_n int := 0; v_fila int := 0;
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

  select string_agg(quote_ident(c), ', ') into v_lista from unnest(v_cols) c;
  select string_agg(format('%1$I = excluded.%1$I', c), ', '),
         string_agg(format('t.%I', c), ', '),
         string_agg(format('excluded.%I', c), ', ')
    into v_set, v_t, v_x
    from unnest(v_cols) c where c <> v_pk;

  if v_set is null then
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
  return jsonb_build_object('aplicadas', v_n, 'arquivos_na_fila', v_fila);
end $$;

-- Apaga no QS o que sumiu do antigo. Só apaga id que veio do antigo
-- (exp_espelho_ids); cada linha em separado — se uma não puder sair (ex.: algo
-- só do QS aponta pra ela), as outras saem e ela volta em "falhas".
create or replace function public.exp_espelho_apagar(p_tabela text, p_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pk text := _exp_espelho_pk(p_tabela);
  v_id text; v_n int; v_apagadas int := 0; v_ignoradas int := 0;
  v_falhas jsonb := '[]'::jsonb;
begin
  if not (p_tabela = any (_exp_espelho_apagaveis())) then raise exception 'O espelho não apaga em %', p_tabela; end if;
  perform set_config('exp.espelho', 'on', true);
  foreach v_id in array coalesce(p_ids, '{}') loop
    if not exists (select 1 from exp_espelho_ids where tabela = p_tabela and id = v_id) then
      v_ignoradas := v_ignoradas + 1;
      continue;
    end if;
    begin
      execute format('delete from public.%I where %I::text = $1', p_tabela, v_pk) using v_id;
      get diagnostics v_n = row_count;
      delete from exp_espelho_ids where tabela = p_tabela and id = v_id;
      v_apagadas := v_apagadas + v_n;
    exception when others then
      v_falhas := v_falhas || jsonb_build_object('id', v_id, 'erro', sqlerrm);
    end;
  end loop;
  perform set_config('exp.espelho', 'off', true);
  return jsonb_build_object('apagadas', v_apagadas, 'ignoradas', v_ignoradas, 'falhas', v_falhas);
end $$;

-- Usuário do antigo → id no QS, pelo e-mail (mesma regra da cópia de 21/10):
-- primeiro o que já está em `usuarios` do QS, senão a conta de login do QS.
-- Sem nenhum dos dois, o espelho mantém o id do antigo.
create or replace function public.exp_espelho_mapa_usuarios(p_emails text[])
returns table (email text, id uuid)
language sql stable security definer set search_path = public as $$
  select lower(e),
         coalesce((select u.id from usuarios u where lower(u.email) = lower(e) order by u.created_at limit 1),
                  (select a.id from auth.users a where lower(a.email) = lower(e) order by a.created_at limit 1))
    from unnest(coalesce(p_emails, '{}')) e
$$;

-- O cron grava aqui como foi a rodada (merge no jsonb da flag).
create or replace function public.exp_espelho_registrar(p_info jsonb)
returns void language sql security definer set search_path = public as $$
  update ops_config set valor = coalesce(valor, '{}'::jsonb) || coalesce(p_info, '{}'::jsonb), atualizado_em = now()
   where chave = 'exp_espelho'
$$;

-- O que a tela lê: está em validação? quando foi a última sincronia completa?
create or replace function public.exp_espelho_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ligado', coalesce((select (valor ->> 'ligado')::boolean from ops_config where chave = 'exp_espelho'), false),
    'sincronizado_em', (select valor -> 'sincronizado_em' from ops_config where chave = 'exp_espelho'),
    'rodada_em', (select valor -> 'rodada_em' from ops_config where chave = 'exp_espelho'))
$$;

revoke all on function public.exp_espelho_aplicar(text, jsonb, text[]), public.exp_espelho_apagar(text, text[]),
  public.exp_espelho_mapa_usuarios(text[]), public.exp_espelho_registrar(jsonb)
  from public, anon, authenticated;
grant execute on function public.exp_espelho_aplicar(text, jsonb, text[]), public.exp_espelho_apagar(text, text[]),
  public.exp_espelho_mapa_usuarios(text[]), public.exp_espelho_registrar(jsonb)
  to service_role;
revoke all on function public.exp_espelho_status() from public, anon;
grant execute on function public.exp_espelho_status() to authenticated, service_role;

-- 5. Gatilhos: pular os de efeito colateral quando exp.espelho = 'on' -----------
-- Recria cada gatilho com o MESMO texto (pg_get_triggerdef) + um WHEN. O corpo
-- das funções não muda, então uma migration futura que reescreva a função não
-- perde a trava (só quem recriar o GATILHO precisa manter o WHEN).
do $$
declare
  r record;
  v_def text;
  v_guarda constant text := '(coalesce(current_setting(''exp.espelho'', true), '''') <> ''on'')';
begin
  for r in
    select t.oid, t.tgname, c.relname, p.proname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
       and c.relnamespace = 'public'::regnamespace
       and c.relname = any (public._exp_espelho_tabelas())
       and p.proname in ('set_updated_at', 'audit_change', '_exp_trg_passageiro_requisitos', '_exp_trg_pax_requisitos_baixa',
                         '_exp_trg_pax_valores', '_exp_trg_pax_valores_log', '_exp_trg_inscricao_auto', '_exp_trg_inscricao_receita')
  loop
    v_def := pg_get_triggerdef(r.oid);
    if position('exp.espelho' in v_def) > 0 then continue; end if;          -- já travado (rodou 2x)
    if position(' WHEN (' in v_def) > 0 then
      raise exception 'Gatilho % em % já tem WHEN — revisar à mão: %', r.tgname, r.relname, v_def;
    end if;
    if position(' FOR EACH ROW EXECUTE ' in v_def) = 0 then
      raise exception 'Formato inesperado do gatilho % em %: %', r.tgname, r.relname, v_def;
    end if;
    v_def := replace(v_def, ' FOR EACH ROW EXECUTE ', ' FOR EACH ROW WHEN ' || v_guarda || ' EXECUTE ');
    execute format('drop trigger %I on public.%I', r.tgname, r.relname);
    execute v_def;
  end loop;
end $$;
