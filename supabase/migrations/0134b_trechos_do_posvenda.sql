-- 0134b_trechos_do_posvenda.sql
-- -----------------------------------------------------------------------------
-- VOOS DO FUNIL PÓS-VENDA (Bitrix, categoria 11) → trechos da viagem (14/10/2026).
--
-- O card do Pós-Venda não tem companhia nem nº do voo — só as DATAS (ida,
-- volta, voo interno), origem/destino e os localizadores. Cada data vira um
-- trecho com fonte 'bitrix' (horário a confirmar: partida 00:00 de Brasília;
-- a tela mostra só a data). Campos usados (pelo código do campo, não pelo rótulo):
--   UF_CRM_1746633380991 Data de Ida          UF_CRM_1746633410333 Data de Volta
--   UF_CRM_1746633273295 Origem               UF_CRM_1746633298495 Destino
--   UF_CRM_1746633344145 Localizadores
--   UF_CRM_1747075974553 Data de Ida - Voo Interno
--   UF_CRM_1747664509456 / UF_CRM_1754491752521 Data de volta do voo interno
--   UF_CRM_1747076055353 Origem - Voo Interno  UF_CRM_1747076040809 Destino - Voo Interno
--
-- Não duplica: ref_externa 'bx-pv:<tipo>:<dia>' (único por viagem) e pula o dia
-- em que a viagem JÁ tem trecho de outra fonte (±1 dia — o Expedições traz o
-- voo de verdade, com hora). Idempotente; só INSERE.
-- O sync (api/rel-viagens.js) chama com p_viagem depois de ler um card do Pós-Venda.
-- -----------------------------------------------------------------------------

create or replace function rel_bx_campo(b jsonb, cod text)
returns text language sql immutable as $$
  select nullif(trim(value), '') from jsonb_each_text(coalesce(b, '{}'::jsonb)) where key like '%[' || cod || ']' limit 1;
$$;

create or replace function rel_bx_dia(t text)
returns date language plpgsql immutable as $$
declare d date;
begin
  if t ~ '^\d{4}-\d{2}-\d{2}' then d := left(t, 10)::date;
  elsif t ~ '^\d{2}/\d{2}/\d{4}' then d := to_date(left(t, 10), 'DD/MM/YYYY');
  else return null;
  end if;
  if d < date '2020-01-01' or d > date '2035-12-31' then return null; end if;
  return d;
exception when others then return null;
end;
$$;

create or replace function rel_trechos_do_posvenda(p_viagem uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with fontes as (
    select d.viagem_id, d.bitrix_dados b from rel_viagem_deals d
     where d.funil ilike '%Pós Venda%' and (p_viagem is null or d.viagem_id = p_viagem)
    union all
    select v.id, v.bitrix_dados from rel_viagens v
     where v.bitrix_funil ilike '%Pós Venda%' and (p_viagem is null or v.id = p_viagem)
  ), c as (
    select f.viagem_id,
      rel_bx_campo(b, 'UF_CRM_1746633273295') origem,
      rel_bx_campo(b, 'UF_CRM_1746633298495') destino,
      rel_bx_dia(rel_bx_campo(b, 'UF_CRM_1746633380991')) ida,
      rel_bx_dia(rel_bx_campo(b, 'UF_CRM_1746633410333')) volta,
      rel_bx_campo(b, 'UF_CRM_1746633344145') loc,
      rel_bx_dia(rel_bx_campo(b, 'UF_CRM_1747075974553')) int_ida,
      rel_bx_dia(coalesce(rel_bx_campo(b, 'UF_CRM_1747664509456'), rel_bx_campo(b, 'UF_CRM_1754491752521'))) int_volta,
      rel_bx_campo(b, 'UF_CRM_1747076055353') int_origem,
      rel_bx_campo(b, 'UF_CRM_1747076040809') int_destino
    from fontes f
  ), t as (
    select viagem_id, 'ida' k, 'voo_internacional' tipo, ida dia, origem o, destino d, loc from c where ida is not null
    union all select viagem_id, 'volta', 'voo_internacional', volta, destino, origem, loc from c where volta is not null
    union all select viagem_id, 'interno-ida', 'voo_interno', int_ida, int_origem, int_destino, null from c where int_ida is not null
    union all select viagem_id, 'interno-volta', 'voo_interno', int_volta, int_destino, int_origem, null from c where int_volta is not null
  ), u as (
    select viagem_id, k, tipo, dia, max(o) o, max(d) d,
           nullif(string_agg(distinct loc, ' / '), '') loc
      from t group by viagem_id, k, tipo, dia
  ), novos as (
    insert into rel_viagem_trechos (viagem_id, tipo, descricao, origem, destino, partida_em, localizador, ref_externa, fonte, criado_por)
    select u.viagem_id, u.tipo,
           case u.k when 'ida' then 'Ida' when 'volta' then 'Volta' when 'interno-ida' then 'Voo interno (ida)' else 'Voo interno (volta)' end
             || ' — data do Pós-Venda (Bitrix), horário a confirmar',
           left(u.o, 200), left(u.d, 200),
           (u.dia::text || ' 00:00:00-03')::timestamptz,
           left(u.loc, 200),
           'bx-pv:' || u.k || ':' || u.dia::text, 'bitrix', null
      from u
      join rel_viagens v on v.id = u.viagem_id and v.status = 'ativa' and v.mesclada_em_id is null
     where not exists (
             select 1 from rel_viagem_trechos x
              where x.viagem_id = u.viagem_id
                and coalesce(x.ref_externa, '') not like 'bx-pv:%'
                and abs((x.partida_em at time zone 'America/Sao_Paulo')::date - u.dia) <= 1)
    on conflict (viagem_id, ref_externa) do nothing
    returning 1
  )
  select count(*) into n from novos;
  return n;
end;
$$;
revoke all on function rel_trechos_do_posvenda(uuid) from public, anon, authenticated;
grant execute on function rel_trechos_do_posvenda(uuid) to service_role;

-- (aplicado como 0134c) Campo com só ".", "-", "x", "0"… é lixo de formulário: vira vazio.
create or replace function rel_bx_campo(b jsonb, cod text)
returns text language sql immutable as $$
  select case when trim(value) ~ '^[[:punct:][:space:]xX0]*$' then null else trim(value) end
    from jsonb_each_text(coalesce(b, '{}'::jsonb)) where key like '%[' || cod || ']' limit 1;
$$;

-- Backfill (rodado em 14/10/2026): select rel_trechos_do_posvenda(null);
