-- 0154_rel_conferir_voos.sql
-- -----------------------------------------------------------------------------
-- CONFERIR VOOS (20/10/2026). Bruno: "tem voos que estão com toda certeza
-- errados, como esse do Vinicius [Turquia & Grécia jun/2027 com voos de
-- mar/2026] e outros que são expedições — quero corrigir e dar como concluído".
--
-- • rel_voos_a_conferir(): a fila. Viagem ativa (não concluída) com voo que
--   não bate com as datas da venda:
--     fora   — voo a mais de 10 dias antes do embarque / 60 depois da volta
--              (outra viagem: card antigo do Pós-Venda, outra edição);
--     ida    — o 1º voo não sai entre 2 dias antes e 1 depois do embarque;
--     volta  — o último voo não chega entre 1 dia antes e 2 depois da volta.
--   Sai da fila quando alguém confere (rel_voos_conferir) — e volta sozinha se
--   entrar voo novo depois da conferência.
-- • rel_voo_descartar(trecho): apaga o voo errado e LEMBRA (rel_trechos_descartados)
--   pra sincronização do Bitrix não trazer de novo.
-- -----------------------------------------------------------------------------

alter table rel_viagens
  add column if not exists voos_conferidos_em timestamptz,
  add column if not exists voos_conferidos_por uuid references qs_users(id) on delete set null;

create table if not exists rel_trechos_descartados (
  viagem_id     uuid not null references rel_viagens(id) on delete cascade,
  ref_externa   text not null,
  resumo        text,
  descartado_em timestamptz not null default now(),
  descartado_por uuid references qs_users(id) on delete set null,
  primary key (viagem_id, ref_externa)
);
alter table rel_trechos_descartados enable row level security;
drop policy if exists rel_trechos_descartados_ler on rel_trechos_descartados;
create policy rel_trechos_descartados_ler on rel_trechos_descartados for select using (rel_tem_acesso());

-- ── a fila ──────────────────────────────────────────────────────────────────
create or replace function rel_voos_a_conferir(p_viagem uuid default null)
returns table (viagem_id uuid, motivos text[], ida_voo date, volta_voo date)
language sql stable security definer set search_path = public as $$
  with v as (
    select v.id, v.data_embarque, coalesce(v.data_retorno, v.data_embarque) data_retorno, v.voos_conferidos_em
      from rel_viagens v
     where v.status = 'ativa' and v.mesclada_em_id is null and v.data_embarque is not null
       and coalesce(v.data_retorno, v.data_embarque) >= current_date - 3
       and (p_viagem is null or v.id = p_viagem)
  ), t as (
    select t.viagem_id, t.fonte, t.criado_em,
           -- fuso gravado como '+09:00': soma o intervalo (at time zone '+09:00' inverteria o sinal)
           ((t.partida_em at time zone 'UTC') + coalesce(nullif(t.partida_fuso, '')::interval, interval '-3 hours'))::date ida,
           ((coalesce(t.chegada_em, t.partida_em) at time zone 'UTC') + coalesce(coalesce(nullif(t.chegada_fuso, ''), nullif(t.partida_fuso, ''))::interval, interval '-3 hours'))::date chega,
           bool_or(t.fonte is distinct from 'bitrix') over (partition by t.viagem_id) tem_real
      from rel_viagem_trechos t join v on v.id = t.viagem_id
     where t.tipo in ('voo_internacional', 'voo_interno')
  ), r as (
    select v.id, v.voos_conferidos_em,
           bool_or(t.ida < v.data_embarque - 10 or t.ida > v.data_retorno + 60) fora,
           -- ida/volta pelos voos que valem (o genérico do Bitrix só quando não há real; sem os de fora)
           min(t.ida)   filter (where (t.fonte is distinct from 'bitrix' or not t.tem_real) and t.ida between v.data_embarque - 10 and v.data_retorno + 60) ida_voo,
           max(t.chega) filter (where (t.fonte is distinct from 'bitrix' or not t.tem_real) and t.ida between v.data_embarque - 10 and v.data_retorno + 60) volta_voo,
           max(t.criado_em) ultimo_voo_criado,
           v.data_embarque, v.data_retorno
      from v join t on t.viagem_id = v.id
     group by v.id, v.voos_conferidos_em, v.data_embarque, v.data_retorno
  )
  select r.id, array_remove(array[
           case when r.fora then 'fora' end,
           case when r.ida_voo is not null and r.ida_voo not between r.data_embarque - 2 and r.data_embarque + 1 then 'ida' end,
           case when r.volta_voo is not null and r.volta_voo not between r.data_retorno - 1 and r.data_retorno + 2 then 'volta' end
         ], null), r.ida_voo, r.volta_voo
    from r
   where (r.voos_conferidos_em is null or r.ultimo_voo_criado > r.voos_conferidos_em)
     and (r.fora
          or (r.ida_voo is not null and r.ida_voo not between r.data_embarque - 2 and r.data_embarque + 1)
          or (r.volta_voo is not null and r.volta_voo not between r.data_retorno - 1 and r.data_retorno + 2));
$$;

create or replace function rel_voos_a_conferir_contagem()
returns integer language sql stable security definer set search_path = public as $$
  select case when rel_tem_acesso() then (select count(*)::int from rel_voos_a_conferir(null)) else 0 end;
$$;

-- ── conferir (dar como concluído) ───────────────────────────────────────────
create or replace function rel_voos_conferir(p_viagem uuid, p_desfazer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  update rel_viagens
     set voos_conferidos_em = case when p_desfazer then null else now() end,
         voos_conferidos_por = case when p_desfazer then null else auth.uid() end
   where id = p_viagem;
end;
$$;

-- ── descartar um voo errado (e não deixar voltar) ───────────────────────────
create or replace function rel_voo_descartar(p_trecho uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t rel_viagem_trechos;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  select * into t from rel_viagem_trechos where id = p_trecho;
  if not found then return; end if;
  if t.ref_externa is not null then
    insert into rel_trechos_descartados (viagem_id, ref_externa, resumo, descartado_por)
    values (t.viagem_id, t.ref_externa,
            left(concat_ws(' · ', t.tipo, to_char(t.partida_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), nullif(concat_ws('→', t.origem, t.destino), '')), 300),
            auth.uid())
    on conflict do nothing;
  end if;
  delete from rel_viagem_trechos where id = p_trecho;
end;
$$;

revoke all on function rel_voos_a_conferir(uuid) from public, anon, authenticated;
revoke all on function rel_voos_a_conferir_contagem() from public, anon;
revoke all on function rel_voos_conferir(uuid, boolean) from public, anon;
revoke all on function rel_voo_descartar(uuid) from public, anon;
grant execute on function rel_voos_a_conferir_contagem() to authenticated;
grant execute on function rel_voos_conferir(uuid, boolean) to authenticated;
grant execute on function rel_voo_descartar(uuid) to authenticated;

-- a fila pra tela (com o que a lista precisa), só pra quem é do Relacionamento
create or replace function rel_voos_a_conferir_lista()
returns table (viagem_id uuid, motivos text[], ida_voo date, volta_voo date)
language sql stable security definer set search_path = public as $$
  select * from rel_voos_a_conferir(null) where rel_tem_acesso();
$$;
revoke all on function rel_voos_a_conferir_lista() from public, anon;
grant execute on function rel_voos_a_conferir_lista() to authenticated;

-- ── a sincronização do Pós-Venda respeita o que foi descartado ──────────────
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
       and not exists (
             select 1 from rel_trechos_descartados z
              where z.viagem_id = u.viagem_id and z.ref_externa = 'bx-pv:' || u.k || ':' || u.dia::text)
    on conflict (viagem_id, ref_externa) do nothing
    returning 1
  )
  select count(*) into n from novos;
  return n;
end;
$$;
revoke all on function rel_trechos_do_posvenda(uuid) from public, anon, authenticated;
grant execute on function rel_trechos_do_posvenda(uuid) to service_role;

-- ── (0154c) ajustar as datas da venda pelos voos — e travar ──────────────────
-- Expedição vinculada à turma errada (ex.: venda Tailândia 13/11–28/11 com
-- voos 17/11–02/12): as datas da venda passam a ser as dos voos e ficam
-- TRAVADAS — a sincronização do Bitrix não volta com as antigas.
alter table rel_viagens add column if not exists datas_travadas boolean not null default false;

create or replace function rel_viagem_datas_pelos_voos(p_viagem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare q record;
begin
  if not (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens')) then raise exception 'Sem permissão pra editar viagens.'; end if;
  select * into q from rel_voos_a_conferir(p_viagem);
  if q.ida_voo is null then raise exception 'Não achei voos que valham pra tirar as datas.'; end if;
  update rel_viagens
     set data_embarque = q.ida_voo, data_retorno = coalesce(q.volta_voo, data_retorno), datas_travadas = true,
         voos_conferidos_em = now(), voos_conferidos_por = auth.uid()
   where id = p_viagem;
end;
$$;
revoke all on function rel_viagem_datas_pelos_voos(uuid) from public, anon;
grant execute on function rel_viagem_datas_pelos_voos(uuid) to authenticated;

drop function if exists rel_voos_a_conferir_lista();
create or replace function rel_voos_a_conferir_lista(p_viagem uuid default null)
returns table (viagem_id uuid, motivos text[], ida_voo date, volta_voo date)
language sql stable security definer set search_path = public as $$
  select * from rel_voos_a_conferir(p_viagem) where rel_tem_acesso();
$$;
revoke all on function rel_voos_a_conferir_lista(uuid) from public, anon;
grant execute on function rel_voos_a_conferir_lista(uuid) to authenticated;
