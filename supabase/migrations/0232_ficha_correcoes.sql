-- 0232_ficha_correcoes.sql
-- NÃO APLICADA (30/10/2026). Só arquivo — aplicar só com o ok do Bruno.
-- ORDEM: depois da 0228 (obrigatória: esta recria cad_salvar_perfil/cad_campos_perfil)
--        e da 0225 (o ajuste dos laudos só entra se cad_laudos_medicos existir).
-- Idempotente (pode rodar 2x). Rollback comentado no fim.
--
-- Correções da Ficha do Cliente a partir da revisão de 30/10 (2 revisores):
--  1) rel_cliente_anotar(p, texto) — a observação ACRESCENTA no banco (uma nota não
--     apaga mais a outra), com data (fuso SP) e autor; checa cad_pode_editar.
--  2) cad_gravar_campo — recriada a partir da definição VIGENTE no banco (0213):
--     passaporte e validade só vão pras idas que ainda não voltaram (retorno >= hoje
--     em SP, ou sem data). As idas passadas guardam o passaporte com que a pessoa
--     viajou. Data vazia ("") vira null em vez de quebrar no ::date.
--  3) cad_documentos_viagem — 2º passaporte, visto, seguro (apólice), vacinas com
--     data e "outro". RLS: lê quem lê rel_clientes (Rel/Ops/Fin), escreve SÓ pelas
--     RPCs (cad_pode_editar); anon fora. Auditada em rel_auditoria.
--  4) cad_campos_perfil + cad_salvar_perfil (0228) — novos campos do perfil:
--     nome_passaporte, sexo, nacionalidade, rg e milhas (lista [{programa, numero}]).
--  5) passageiros.saude_triagem_obs + exp_inscricao_aprovar — o comentário da
--     triagem de saúde (inscricoes_pendentes.comentario_saude) vai pro passageiro na
--     aprovação. A função é recriada A PARTIR DA DEFINIÇÃO VIGENTE (pg_get_functiondef)
--     só com o acréscimo — o DO abaixo recusa se não achar o ponto de inserção.
--  6) 0225: apagar um passageiro cujo laudo não tem cliente_id quebrava
--     (check cad_laudos_tem_dono + on delete set null). Antes do delete, o laudo herda
--     o cliente_id do passageiro; se nem assim tiver dono, sai junto com o passageiro.
--
-- Não mexe em: acesso LGPD de rel_clientes (decisão do Bruno), policies de storage.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'rel_clientes' and column_name = 'perfil') then
    raise exception '0232 precisa da 0228 (rel_clientes.perfil) aplicada antes.';
  end if;
end $$;

-- ── helper: a ida ainda vale pra trocar passaporte/validade? ────────────────
-- sem expedição, sem datas, ou volta (ou embarque, sem volta) de hoje em diante (SP)
create or replace function public.cad__ida_vigente(p_exp uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_exp is null or not exists (
    select 1 from expedicoes e
     where e.id = p_exp
       and coalesce(e.data_retorno, e.data_embarque) is not null
       and coalesce(e.data_retorno, e.data_embarque) < (now() at time zone 'America/Sao_Paulo')::date);
$$;
revoke all on function public.cad__ida_vigente(uuid) from public, anon;

-- ── 1. Observação que acrescenta ────────────────────────────────────────────
create or replace function public.rel_cliente_anotar(p uuid, p_texto text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := cad_ficha_viva(p);
  t text := left(btrim(coalesce(p_texto, '')), 4000);
  autor text;
  linha text;
  out text;
begin
  if v is null then raise exception 'Ficha não encontrada.' using errcode = 'P0002'; end if;
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  if t = '' then raise exception 'Observação vazia.' using errcode = '22023'; end if;
  select nullif(split_part(btrim(coalesce(u.name, '')), ' ', 1), '') into autor from qs_users u where u.id = auth.uid();
  linha := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ' · ' || coalesce(autor, 'Equipe') || ': ' || t;
  -- num UPDATE só: o que outra pessoa gravou no meio do caminho não se perde
  update rel_clientes
     set observacoes = case when nullif(btrim(coalesce(observacoes, '')), '') is null then linha
                            else btrim(observacoes) || E'\n\n' || linha end
   where id = v
  returning observacoes into out;
  return out;
end;
$$;
revoke all on function public.rel_cliente_anotar(uuid, text) from public, anon;
grant execute on function public.rel_cliente_anotar(uuid, text) to authenticated;

-- ── 2. cad_gravar_campo: passaporte só nas idas que não voltaram ────────────
-- Partiu de pg_get_functiondef('cad_gravar_campo') em 30/10 (corpo da 0213).
-- Mudou: passaporte/passaporte_validade com cad__ida_vigente; ''::date → null.
create or replace function public.cad_gravar_campo(p_cliente uuid, p_campo text, p_valor text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform set_config('cad.sync', 'on', true);
  if p_campo = 'cpf' then
    update rel_clientes set cpf = cad_cpf(p_valor) where id = p_cliente and cpf is distinct from cad_cpf(p_valor);
    update passageiros set cpf = cad_cpf_fmt(p_valor) where cliente_id = p_cliente and cad_cpf(cpf) is distinct from cad_cpf(p_valor);
  elsif p_campo = 'passaporte' then
    update rel_clientes set passaporte = cad_pass(p_valor) where id = p_cliente and passaporte is distinct from cad_pass(p_valor);
    -- 0232: as idas passadas guardam o passaporte com que a pessoa viajou
    update passageiros set passaporte = cad_pass(p_valor)
     where cliente_id = p_cliente and cad_pass(passaporte) is distinct from cad_pass(p_valor)
       and cad__ida_vigente(expedicao_id);
  elsif p_campo = 'passaporte_validade' then
    update rel_clientes set passaporte_validade = nullif(btrim(p_valor), '')::date where id = p_cliente and passaporte_validade is distinct from nullif(btrim(p_valor), '')::date;
    update passageiros set validade_passaporte = nullif(btrim(p_valor), '')::date
     where cliente_id = p_cliente and validade_passaporte is distinct from nullif(btrim(p_valor), '')::date
       and cad__ida_vigente(expedicao_id);
  elsif p_campo = 'nascimento' then
    update rel_clientes set nascimento = nullif(btrim(p_valor), '')::date where id = p_cliente and nascimento is distinct from nullif(btrim(p_valor), '')::date;
    update passageiros set data_nascimento = nullif(btrim(p_valor), '')::date where cliente_id = p_cliente and data_nascimento is distinct from nullif(btrim(p_valor), '')::date;
  elsif p_campo = 'email' then
    update rel_clientes set email = cad_email(p_valor) where id = p_cliente and lower(email) is distinct from cad_email(p_valor);
    update passageiros set email = cad_email(p_valor) where cliente_id = p_cliente and cad_email(email) is distinct from cad_email(p_valor);
  elsif p_campo = 'telefone' then
    update rel_clientes set telefone = cad_tel(p_valor) where id = p_cliente and telefone is distinct from cad_tel(p_valor);
    update passageiros set telefone = cad_tel(p_valor) where cliente_id = p_cliente and cad_tel(telefone) is distinct from cad_tel(p_valor);
  elsif p_campo = any(cad_campos_endereco()) then
    execute format('update rel_clientes set %1$I = $1 where id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
    execute format('update passageiros set %1$I = $1 where cliente_id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
  end if;
  perform set_config('cad.sync', 'off', true);
end $function$;

-- ── 3. Documentos de viagem (2º passaporte, visto, seguro, vacina, outro) ───
create table if not exists public.cad_documentos_viagem (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.rel_clientes(id) on delete cascade,
  tipo           text not null,
  numero         text,
  pais           text,
  emissao        date,
  validade       date,
  detalhe        text,          -- seguradora / nome da vacina / observação
  arquivo_path   text,          -- bucket rel-documentos
  rel_viagem_id  uuid references public.rel_viagens(id) on delete set null,
  expedicao_id   uuid references public.expedicoes(id) on delete set null,
  criado_por     uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid default auth.uid() references auth.users(id) on delete set null,
  atualizado_em  timestamptz not null default now(),
  constraint cad_docv_tipo check (tipo in ('passaporte', 'visto', 'seguro', 'vacina', 'outro')),
  constraint cad_docv_datas check (emissao is null or validade is null or emissao <= validade)
);
create index if not exists cad_docv_cliente_idx on public.cad_documentos_viagem (cliente_id, tipo);
comment on table public.cad_documentos_viagem is
  '0232: documentos de viagem da pessoa além do passaporte principal da ficha (2º passaporte, visto, apólice de seguro, vacinas com data, outro). Escrita só por cad_documento_viagem_salvar/apagar.';

alter table public.cad_documentos_viagem enable row level security;
revoke all on table public.cad_documentos_viagem from anon;
revoke insert, update, delete on table public.cad_documentos_viagem from authenticated;
grant select on table public.cad_documentos_viagem to authenticated;

drop policy if exists cad_docv_ler on public.cad_documentos_viagem;
create policy cad_docv_ler on public.cad_documentos_viagem
  for select to authenticated
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()) or (select fin_tem_acesso()));
drop policy if exists app_cliente_barreira on public.cad_documentos_viagem;
create policy app_cliente_barreira on public.cad_documentos_viagem
  as restrictive for all to authenticated
  using (not (select app_eh_cliente()));

drop trigger if exists trg_cad_docv_audita on public.cad_documentos_viagem;
create trigger trg_cad_docv_audita
  after insert or update or delete on public.cad_documentos_viagem
  for each row execute function public.rel_audita();

create or replace function public.cad__data(p text, rotulo text)
returns date
language plpgsql
stable
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(p, '')), '') is null then return null; end if;
  return btrim(p)::date;
exception when others then
  raise exception '%: data inválida.', rotulo using errcode = '22007';
end;
$$;

create or replace function public.cad_documento_viagem_salvar(p uuid, p_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := cad_ficha_viva(p);
  d jsonb := coalesce(p_doc, '{}'::jsonb);
  v_id uuid := nullif(d->>'id', '')::uuid;
  v_tipo text := lower(btrim(coalesce(d->>'tipo', '')));
  r cad_documentos_viagem%rowtype;
begin
  if v is null then raise exception 'Ficha não encontrada.' using errcode = 'P0002'; end if;
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  if not (v_tipo = any(array['passaporte', 'visto', 'seguro', 'vacina', 'outro'])) then
    raise exception 'Tipo de documento inválido.' using errcode = '22023';
  end if;
  if v_id is not null and not exists (select 1 from cad_documentos_viagem where id = v_id and cad_ficha_viva(cliente_id) = v) then
    raise exception 'Documento não encontrado nesta ficha.' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into cad_documentos_viagem (cliente_id, tipo, numero, pais, emissao, validade, detalhe, arquivo_path, rel_viagem_id, expedicao_id, criado_por, atualizado_por)
    values (v, v_tipo,
      nullif(left(btrim(coalesce(d->>'numero', '')), 60), ''), nullif(left(btrim(coalesce(d->>'pais', '')), 80), ''),
      cad__data(d->>'emissao', 'Emissão'), cad__data(d->>'validade', 'Validade'),
      nullif(left(btrim(coalesce(d->>'detalhe', '')), 500), ''), nullif(btrim(coalesce(d->>'arquivo_path', '')), ''),
      nullif(d->>'rel_viagem_id', '')::uuid, nullif(d->>'expedicao_id', '')::uuid, auth.uid(), auth.uid())
    returning * into r;
  else
    update cad_documentos_viagem set
      tipo = v_tipo,
      numero = nullif(left(btrim(coalesce(d->>'numero', '')), 60), ''),
      pais = nullif(left(btrim(coalesce(d->>'pais', '')), 80), ''),
      emissao = cad__data(d->>'emissao', 'Emissão'),
      validade = cad__data(d->>'validade', 'Validade'),
      detalhe = nullif(left(btrim(coalesce(d->>'detalhe', '')), 500), ''),
      arquivo_path = case when d ? 'arquivo_path' then nullif(btrim(coalesce(d->>'arquivo_path', '')), '') else arquivo_path end,
      rel_viagem_id = nullif(d->>'rel_viagem_id', '')::uuid,
      expedicao_id = nullif(d->>'expedicao_id', '')::uuid,
      atualizado_por = auth.uid(), atualizado_em = now()
    where id = v_id
    returning * into r;
  end if;
  return to_jsonb(r);
end;
$$;
revoke all on function public.cad_documento_viagem_salvar(uuid, jsonb) from public, anon;
grant execute on function public.cad_documento_viagem_salvar(uuid, jsonb) to authenticated;

create or replace function public.cad_documento_viagem_apagar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_cli uuid;
begin
  select cliente_id into v_cli from cad_documentos_viagem where id = p_id;
  if v_cli is null then raise exception 'Documento não encontrado.' using errcode = 'P0002'; end if;
  if not cad_pode_editar(v_cli) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  delete from cad_documentos_viagem where id = p_id;
end;
$$;
revoke all on function public.cad_documento_viagem_apagar(uuid) from public, anon;
grant execute on function public.cad_documento_viagem_apagar(uuid) to authenticated;

-- ── 4. Perfil: campos novos (nome no passaporte, sexo, nacionalidade, RG, milhas) ─
-- o front usa a mesma lista: src/rel/clientes/ficha/fontes.ts → CAMPOS_PERFIL
create or replace function public.cad_campos_perfil()
returns text[] language sql immutable as $$
  select array[
    'contato_emergencia_nome', 'contato_emergencia_fone', 'contato_emergencia_vinculo',
    'restricoes_alimentares', 'camiseta', 'profissao', 'instagram',
    'pref_marcar_assento', 'pref_upgrade_classe', 'ja_viajou_internacional', 'paises_visitados',
    'obs_viagem', 'saude',
    -- 0232
    'nome_passaporte', 'sexo', 'nacionalidade', 'rg', 'milhas'
  ]::text[];
$$;

-- Partiu de cad_salvar_perfil da 0228 (ainda não estava no banco em 30/10).
-- Mudou: 'milhas' é lista [{programa, numero}] (antes viraria texto).
create or replace function public.cad_salvar_perfil(p uuid, p_campos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := cad_ficha_viva(p);
  k text;
  ks text;
  val jsonb;
  atual jsonb;
  saude_atual jsonb;
  saude_nova jsonb;
  saude_poe jsonb := '{}'::jsonb;   -- só o que mudou agora (pras idas: mescla, nunca substitui)
  saude_tira text[] := '{}';
  milhas_nova jsonb;
  tira text[] := '{}';
  poe jsonb := '{}'::jsonb;
  guarda text := current_setting('cad.sync', true);
begin
  if v is null then raise exception 'Ficha não encontrada.' using errcode = 'P0002'; end if;
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_campos, '{}'::jsonb)) <> 'object' then raise exception 'Campos inválidos.' using errcode = '22023'; end if;

  select coalesce(perfil, '{}'::jsonb) into atual from rel_clientes where id = v for update;

  for k, val in select * from jsonb_each(coalesce(p_campos, '{}'::jsonb)) loop
    if not (k = any(cad_campos_perfil())) then
      raise exception 'Campo desconhecido: %', k using errcode = '22023';
    end if;
    if k = 'saude' then
      if jsonb_typeof(val) <> 'object' then raise exception 'Saúde: formato inválido.' using errcode = '22023'; end if;
      saude_atual := coalesce(atual->'saude', '{}'::jsonb);
      if jsonb_typeof(saude_atual) <> 'object' then saude_atual := '{}'::jsonb; end if;
      saude_nova := saude_atual;
      for ks in select jsonb_object_keys(val) loop
        if not (ks = any(cad_campos_saude())) then
          raise exception 'Campo de saúde desconhecido: %', ks using errcode = '22023';
        end if;
        if jsonb_typeof(val->ks) = 'null' or btrim(val->>ks) = '' then
          saude_nova := saude_nova - ks;
          saude_tira := saude_tira || ks;
        else
          saude_nova := saude_nova || jsonb_build_object(ks, left(btrim(val->>ks), 2000));
          saude_poe := saude_poe || jsonb_build_object(ks, left(btrim(val->>ks), 2000));
        end if;
      end loop;
      poe := poe || jsonb_build_object('saude', saude_nova);
    elsif k = 'milhas' then
      if jsonb_typeof(val) = 'null' then
        tira := tira || k;
      elsif jsonb_typeof(val) <> 'array' then
        raise exception 'Milhas: formato inválido (lista de programa + número).' using errcode = '22023';
      else
        select coalesce(jsonb_agg(jsonb_build_object(
                 'programa', left(btrim(coalesce(e->>'programa', '')), 80),
                 'numero', left(btrim(coalesce(e->>'numero', '')), 40))), '[]'::jsonb)
          into milhas_nova
          from jsonb_array_elements(val) e
         where jsonb_typeof(e) = 'object'
           and (btrim(coalesce(e->>'programa', '')) <> '' or btrim(coalesce(e->>'numero', '')) <> '');
        if jsonb_array_length(milhas_nova) = 0 then tira := tira || k;
        else poe := poe || jsonb_build_object(k, milhas_nova); end if;
      end if;
    elsif jsonb_typeof(val) = 'null' or (jsonb_typeof(val) = 'string' and btrim(val #>> '{}') = '') then
      tira := tira || k;
    elsif jsonb_typeof(val) = 'boolean' then
      poe := poe || jsonb_build_object(k, val);
    else
      poe := poe || jsonb_build_object(k, left(btrim(val #>> '{}'), 2000));
    end if;
  end loop;

  update rel_clientes
     set perfil = (coalesce(perfil, '{}'::jsonb) - tira) || poe
                  || jsonb_build_object('atualizado_em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                        'atualizado_por', auth.uid())
   where id = v;

  -- Leva pras idas que ainda não voltaram (o Ops, a Área do Líder e as Receitas leem de passageiros).
  if p_campos ?| array['contato_emergencia_nome', 'contato_emergencia_fone', 'contato_emergencia_vinculo', 'restricoes_alimentares', 'saude'] then
    perform set_config('cad.sync', 'on', true);
    update passageiros x
       set contato_emergencia_nome = case when p_campos ? 'contato_emergencia_nome' then nullif(btrim(p_campos->>'contato_emergencia_nome'), '') else x.contato_emergencia_nome end,
           contato_emergencia_fone = case when p_campos ? 'contato_emergencia_fone' then nullif(btrim(p_campos->>'contato_emergencia_fone'), '') else x.contato_emergencia_fone end,
           contato_emergencia_vinculo = case when p_campos ? 'contato_emergencia_vinculo' then nullif(btrim(p_campos->>'contato_emergencia_vinculo'), '') else x.contato_emergencia_vinculo end,
           restricoes_alimentares = case when p_campos ? 'restricoes_alimentares' then nullif(btrim(p_campos->>'restricoes_alimentares'), '') else x.restricoes_alimentares end,
           saude = case when p_campos ? 'saude' then (coalesce(x.saude, '{}'::jsonb) - saude_tira) || saude_poe else x.saude end
      from expedicoes e
     where x.cliente_id = v
       and e.id = x.expedicao_id
       and coalesce(x.status_reserva::text, '') <> 'Cancelado'
       and coalesce(e.data_retorno, e.data_embarque, current_date) >= (now() at time zone 'America/Sao_Paulo')::date;
    perform set_config('cad.sync', coalesce(guarda, 'off'), true);
  end if;

  return (select perfil from rel_clientes where id = v);
exception when others then
  perform set_config('cad.sync', coalesce(guarda, 'off'), true);
  raise;
end;
$$;
revoke all on function public.cad_salvar_perfil(uuid, jsonb) from public, anon;
grant execute on function public.cad_salvar_perfil(uuid, jsonb) to authenticated;

-- ── 5. Comentário da triagem de saúde vai pro passageiro ────────────────────
alter table public.passageiros add column if not exists saude_triagem_obs text;
comment on column public.passageiros.saude_triagem_obs is
  '0232: cópia de inscricoes_pendentes.comentario_saude (triagem de saúde da inscrição), gravada por exp_inscricao_aprovar.';

-- Recria exp_inscricao_aprovar A PARTIR DA DEFINIÇÃO VIGENTE, só acrescentando a cópia
-- antes de "update arquivos set passageiro_id = v_pax". Idempotente (já tem → não faz nada).
do $$
declare
  d text := pg_get_functiondef('public.exp_inscricao_aprovar(uuid, jsonb)'::regprocedure);
  marca constant text := E'  update arquivos set passageiro_id = v_pax';
  extra constant text :=
    E'  -- 0232: o comentário da triagem de saúde vai junto pro passageiro\n'
    || E'  if nullif(btrim(coalesce(pend.comentario_saude, '''')), '''') is not null then\n'
    || E'    update passageiros set saude_triagem_obs = left(btrim(pend.comentario_saude), 2000) where id = v_pax;\n'
    || E'  end if;\n\n';
begin
  if position('saude_triagem_obs' in d) > 0 then return; end if;
  if position(marca in d) = 0 then
    raise exception '0232: exp_inscricao_aprovar mudou no banco (não achei "update arquivos set passageiro_id = v_pax"). Revise antes de aplicar.';
  end if;
  execute replace(d, marca, extra || marca);
end $$;

-- ── 6. 0225: apagar passageiro com laudo sem cliente ────────────────────────
create or replace function public._cad_trg_laudo_pax_apagado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- o laudo fica com a ficha da pessoa; sem ficha nenhuma, sai junto (senão o check
  -- cad_laudos_tem_dono barra o "on delete set null" e o DELETE do passageiro falha)
  update cad_laudos_medicos set cliente_id = old.cliente_id
   where passageiro_id = old.id and cliente_id is null and old.cliente_id is not null;
  delete from cad_laudos_medicos where passageiro_id = old.id and cliente_id is null;
  return old;
end;
$$;

do $$
begin
  if to_regclass('public.cad_laudos_medicos') is null then
    raise notice '0232: cad_laudos_medicos não existe (0225 não aplicada) — o ajuste dos laudos ficou de fora. Rode a 0232 de novo depois da 0225.';
    return;
  end if;
  execute 'drop trigger if exists trg_cad_laudo_pax_apagado on public.passageiros';
  execute 'create trigger trg_cad_laudo_pax_apagado before delete on public.passageiros
           for each row execute function public._cad_trg_laudo_pax_apagado()';
end $$;

-- ── Conferência depois de aplicar (só leitura) ──────────────────────────────
-- select proname from pg_proc where proname in ('rel_cliente_anotar','cad_documento_viagem_salvar','cad_documento_viagem_apagar','cad__ida_vigente','cad__data');
-- select position('saude_triagem_obs' in pg_get_functiondef('exp_inscricao_aprovar'::regproc)) > 0;   -- true
-- select cad_campos_perfil();                                                                         -- 18 chaves
-- select tgname from pg_trigger where tgname in ('trg_cad_laudo_pax_apagado','trg_cad_docv_audita');

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────────
-- drop trigger if exists trg_cad_laudo_pax_apagado on public.passageiros;
-- drop function if exists public._cad_trg_laudo_pax_apagado();
-- do $$ declare d text := pg_get_functiondef('public.exp_inscricao_aprovar(uuid, jsonb)'::regprocedure); begin
--   d := regexp_replace(d, '  -- 0232: o comentário da triagem.*?end if;\n\n', '', 's');
--   execute d; end $$;
-- alter table public.passageiros drop column if exists saude_triagem_obs;
-- (cad_salvar_perfil / cad_campos_perfil: rodar de novo as seções 1 e 2 da 0228; os valores
--  gravados em nome_passaporte/sexo/nacionalidade/rg/milhas ficam no jsonb, sem uso)
-- drop function if exists public.cad_documento_viagem_apagar(uuid);
-- drop function if exists public.cad_documento_viagem_salvar(uuid, jsonb);
-- drop function if exists public.cad__data(text, text);
-- drop table if exists public.cad_documentos_viagem;     -- apaga os documentos (rel_auditoria guarda o histórico)
-- drop function if exists public.rel_cliente_anotar(uuid, text);
-- cad_gravar_campo da 0213 (vigente até 30/10) — volta a sobrescrever TODAS as idas:
-- create or replace function public.cad_gravar_campo(p_cliente uuid, p_campo text, p_valor text)
-- returns void language plpgsql security definer set search_path to 'public' as $function$
-- begin
--   perform set_config('cad.sync', 'on', true);
--   if p_campo = 'cpf' then
--     update rel_clientes set cpf = cad_cpf(p_valor) where id = p_cliente and cpf is distinct from cad_cpf(p_valor);
--     update passageiros set cpf = cad_cpf_fmt(p_valor) where cliente_id = p_cliente and cad_cpf(cpf) is distinct from cad_cpf(p_valor);
--   elsif p_campo = 'passaporte' then
--     update rel_clientes set passaporte = cad_pass(p_valor) where id = p_cliente and passaporte is distinct from cad_pass(p_valor);
--     update passageiros set passaporte = cad_pass(p_valor) where cliente_id = p_cliente and cad_pass(passaporte) is distinct from cad_pass(p_valor);
--   elsif p_campo = 'passaporte_validade' then
--     update rel_clientes set passaporte_validade = p_valor::date where id = p_cliente and passaporte_validade is distinct from p_valor::date;
--     update passageiros set validade_passaporte = p_valor::date where cliente_id = p_cliente and validade_passaporte is distinct from p_valor::date;
--   elsif p_campo = 'nascimento' then
--     update rel_clientes set nascimento = p_valor::date where id = p_cliente and nascimento is distinct from p_valor::date;
--     update passageiros set data_nascimento = p_valor::date where cliente_id = p_cliente and data_nascimento is distinct from p_valor::date;
--   elsif p_campo = 'email' then
--     update rel_clientes set email = cad_email(p_valor) where id = p_cliente and lower(email) is distinct from cad_email(p_valor);
--     update passageiros set email = cad_email(p_valor) where cliente_id = p_cliente and cad_email(email) is distinct from cad_email(p_valor);
--   elsif p_campo = 'telefone' then
--     update rel_clientes set telefone = cad_tel(p_valor) where id = p_cliente and telefone is distinct from cad_tel(p_valor);
--     update passageiros set telefone = cad_tel(p_valor) where cliente_id = p_cliente and cad_tel(telefone) is distinct from cad_tel(p_valor);
--   elsif p_campo = any(cad_campos_endereco()) then
--     execute format('update rel_clientes set %1$I = $1 where id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
--     execute format('update passageiros set %1$I = $1 where cliente_id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
--   end if;
--   perform set_config('cad.sync', 'off', true);
-- end $function$;
-- drop function if exists public.cad__ida_vigente(uuid);
