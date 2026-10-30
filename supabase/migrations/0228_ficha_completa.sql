-- 0228_ficha_completa.sql
-- NÃO APLICADA (30/10/2026). Só arquivo — aplicar só com o ok do Bruno.
-- Idempotente (pode rodar 2x). Rollback comentado no fim.
--
-- Pedido do Bruno (30/10): "a ficha tem que ter TUDO que o cliente já passou, pra
-- numa próxima viagem a gente não pedir de novo" + "TODOS os contratos emitidos".
-- Inventário completo em docs/INVENTARIO-FICHA.md.
--
-- O que esta migration faz:
--  1) rel_clientes.perfil (jsonb) — os dados de viagem que hoje só existem POR IDA
--     (passageiros): contato de emergência, saúde (mesmo formato de passageiros.saude),
--     alimentação, camiseta, profissão, Instagram, preferências de voo, países visitados.
--     Fica na própria ficha → herda as policies de rel_clientes (Rel/Ops/Fin leem,
--     Rel/Ops editam) e a AUDITORIA que já existe (trigger rel_audita → rel_auditoria,
--     que o Ops também lê pra tabela rel_clientes). Nada de tabela nova.
--     Sem backfill: o front mostra o valor da ida mais recente quando o perfil está vazio
--     ("veio da inscrição de <expedição>"), e o "Usar este" grava no perfil.
--  2) cad_salvar_perfil(p, campos) — salva CAMPO A CAMPO (só as chaves enviadas;
--     "" ou null apaga a chave). Checa cad_pode_editar (0213). Leva contato de
--     emergência, alimentação e saúde também pras idas que ainda não voltaram
--     (passageiros), porque as telas do Ops/Líder leem de lá.
--  3) cad_contratos_do_cliente(p) — TODOS os contratos da pessoa, de qualquer
--     origem, numa leitura só (qs_contratos é só closer/gestor pela RLS da 0180;
--     o Rel e o Ops precisam ver na ficha). Junta:
--       a) qs_contratos (ZapSign automático e manual/PDF) ligados por negócio do
--          closer → viagem da pessoa, por lead → pessoa, ou pelo CPF que foi no contrato;
--       b) status de contrato no cartão do closer (qs_closer_negocios) sem envio
--          registrado em qs_contratos.
--     Os outros contratos (arquivo PDF em rel_documentos, "contrato assinado" na ida
--     da expedição) o front lê direto — as policies atuais já deixam.
--
-- Não mexe em: laudos (outro agente: cad_laudos_medicos), receitas (0223, já
-- aplicada — as colunas de passageiros continuam a fonte), policies de storage.

-- ── 1. Perfil de viagem na ficha ─────────────────────────────────────────────
alter table public.rel_clientes
  add column if not exists perfil jsonb not null default '{}'::jsonb;
comment on column public.rel_clientes.perfil is
  '0228: dados de viagem da PESSOA (não da ida): contato_emergencia_nome/fone/vinculo, saude {mesmas chaves de passageiros.saude}, '
  'restricoes_alimentares, camiseta, profissao, instagram, pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, '
  'paises_visitados, obs_viagem. Gravado por cad_salvar_perfil (campo a campo, auditado em rel_auditoria).';

-- chaves aceitas (o front usa a mesma lista: src/rel/clientes/ficha/fontes.ts → CAMPOS_PERFIL)
create or replace function public.cad_campos_perfil()
returns text[] language sql immutable as $$
  select array[
    'contato_emergencia_nome', 'contato_emergencia_fone', 'contato_emergencia_vinculo',
    'restricoes_alimentares', 'camiseta', 'profissao', 'instagram',
    'pref_marcar_assento', 'pref_upgrade_classe', 'ja_viajou_internacional', 'paises_visitados',
    'obs_viagem', 'saude'
  ]::text[];
$$;

-- chaves de saúde aceitas (iguais a src/expedicoes/lib/database.ts → SaudePassageiro)
create or replace function public.cad_campos_saude()
returns text[] language sql immutable as $$
  select array[
    'problema_saude', 'problema_saude_qual', 'medicamento_diario', 'medicamento_diario_qual', 'medicamento_refrigeracao',
    'alergia_medicamento', 'alergia_medicamento_qual', 'anafilaxia_emergencia', 'alergia_alimentar', 'alergia_alimentar_qual',
    'restricao_alimentar', 'restricao_alimentar_qual', 'limitacao_fisica', 'limitacao_fisica_qual', 'cirurgia_importante',
    'cirurgia_qual', 'gravidez', 'gravidez_semanas', 'enjoo_transporte', 'medo_altura', 'ronca_cpap', 'ronca_cpap_qual',
    'vacina_febre_amarela', 'vacina_febre_amarela_arquivo_id'
  ]::text[];
$$;

-- ── 2. Salvar campo a campo ─────────────────────────────────────────────────
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

-- ── 3. Todos os contratos da pessoa ─────────────────────────────────────────
create or replace function public.cad_contratos_do_cliente(p uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid := cad_ficha_viva(p);
  meu_cpf text;
  out jsonb;
begin
  if not (rel_tem_acesso() or ops_tem_acesso() or fin_tem_acesso() or qs_is_manager()) then
    raise exception 'Sem permissão pra ver os contratos.' using errcode = '42501';
  end if;
  if v is null then return '[]'::jsonb; end if;
  select nullif(regexp_replace(coalesce(cpf, ''), '\D', '', 'g'), '') into meu_cpf from rel_clientes where id = v;

  with viagens as (
    select id, closer_negocio_id, titulo from rel_viagens where cliente_id = v
  ), negocios as (
    select distinct on (n.id) n.id, n.status_contrato, n.contrato_enviado_em, n.contrato_assinado_em, n.criado_em, vg.titulo
      from qs_closer_negocios n
      left join viagens vg on vg.id = n.viagem_id or vg.closer_negocio_id = n.id
     where n.viagem_id in (select id from viagens)
        or n.id in (select closer_negocio_id from viagens where closer_negocio_id is not null)
        or n.lead_id in (select l.id from qs_leads l where l.cliente_id = v)
  ), contratos as (
    select k.*
      from qs_contratos k
     where k.negocio_id in (select id from negocios)
        or k.lead_id in (select l.id from qs_leads l where l.cliente_id = v)
        or (meu_cpf is not null and regexp_replace(coalesce(k.campos->>'cpf', ''), '\D', '', 'g') = meu_cpf)
  )
  select coalesce(jsonb_agg(x order by x->>'em' desc), '[]'::jsonb) into out from (
    select jsonb_build_object(
      'origem', 'qs_contratos', 'id', k.id, 'tipo', k.tipo, 'modo', k.modo, 'status', k.status, 'erro', k.erro,
      'titulo', coalesce(nullif(k.campos->>'expedicao', ''), nullif(k.campos->>'destino', ''), (select titulo from negocios n where n.id = k.negocio_id limit 1)),
      'valor', nullif(k.campos->>'valor_total', ''),
      'em', coalesce(k.assinado_em, k.enviado_em, k.criado_em),
      'criado_em', k.criado_em, 'enviado_em', k.enviado_em, 'visualizado_em', k.visualizado_em, 'assinado_em', k.assinado_em,
      'recusado_em', k.recusado_em, 'cancelado_em', k.cancelado_em,
      'link_assinatura', k.link_assinatura, 'pdf_assinado_url', k.pdf_assinado_url, 'drive_pdf_url', k.drive_pdf_url,
      'negocio_id', k.negocio_id, 'enviado_por', (select u.name from qs_users u where u.id = k.enviado_por)
    ) x from contratos k
    union all
    select jsonb_build_object(
      'origem', 'negocio', 'id', n.id, 'tipo', null, 'modo', null, 'status', n.status_contrato, 'erro', null,
      'titulo', n.titulo, 'valor', null,
      'em', coalesce(n.contrato_assinado_em, n.contrato_enviado_em, n.criado_em),
      'criado_em', n.criado_em, 'enviado_em', n.contrato_enviado_em, 'assinado_em', n.contrato_assinado_em,
      'negocio_id', n.id
    )
      from negocios n
     where n.status_contrato is not null
       and not exists (select 1 from contratos k where k.negocio_id = n.id)
  ) t;
  return out;
end;
$$;
revoke all on function public.cad_contratos_do_cliente(uuid) from public, anon;
grant execute on function public.cad_contratos_do_cliente(uuid) to authenticated;

-- ── Conferência depois de aplicar (só leitura) ──────────────────────────────
-- select count(*) from rel_clientes where perfil <> '{}'::jsonb;          -- 0 logo depois (sem backfill)
-- select cad_contratos_do_cliente('<id de uma ficha>');                    -- [] enquanto qs_contratos estiver vazia
-- select proname from pg_proc where proname in ('cad_salvar_perfil','cad_contratos_do_cliente','cad_campos_perfil','cad_campos_saude');

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────────
-- drop function if exists public.cad_contratos_do_cliente(uuid);
-- drop function if exists public.cad_salvar_perfil(uuid, jsonb);
-- drop function if exists public.cad_campos_saude();
-- drop function if exists public.cad_campos_perfil();
-- alter table public.rel_clientes drop column if exists perfil;   -- apaga o que foi preenchido no perfil (rel_auditoria guarda o histórico)
