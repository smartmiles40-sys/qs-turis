-- 0380_pessoa_leads_acesso.sql
-- -----------------------------------------------------------------------------
-- VISÃO CRUZADA, PASSO 1: "QUEM É ESTA PESSOA" E "QUEM PODE OLHAR" (13/11/2026).
--
-- PORQUÊ
--   "Todos os setores se conversam": a ficha única é rel_clientes, mas cada
--   setor só enxerga o próprio pedaço. Pra cruzar (lead ↔ ficha) sem abrir a RLS
--   de ninguém, as próximas RPCs (0381–0384) são SECURITY DEFINER e precisam de
--   duas peças em comum, que moram aqui:
--
--   • lead_pessoa(lead)    → a ficha (rel_clientes) de um lead.
--       1º qs_leads.cliente_id (o gatilho da frente "pessoa" vai preencher;
--          ficha mesclada segue pra ficha que ficou);
--       2º enquanto vazio: o telefone (rel_cliente_do_telefone, a mesma regra do
--          resto do Rel: exato > chave; família com o mesmo número → o titular);
--       3º e-mail, só se casar com UMA ficha.
--   • pessoa_leads(ficha)  → os leads da pessoa: os ligados por cliente_id + os
--       SEM vínculo cujo lead_pessoa() cai nesta ficha + os do card do Bitrix de
--       uma viagem dela (mesma regra da rel_ligacoes_do_cliente, 0151).
--       Lead ligado EXPLICITAMENTE a outra ficha não entra (o vínculo manda).
--   • pessoa_pode_ver(ficha) / lead_pode_ver(lead) → espelham a RLS vigente:
--       ficha: Rel, Ops, Financeiro, gestor comercial, closer, ou o SDR dono de
--       um lead da pessoa (ou dono de reunião dela — igual à leads_select);
--       lead: igual à policy leads_select de qs_leads.
--
--   As quatro são internas: ninguém de fora chama (execute revogado). Só as RPCs
--   das próximas migrations, que rodam como dono, usam.
--
-- COMO CONFERIR
--   select public.lead_pessoa('<lead uuid>');
--   select * from public.pessoa_leads('<cliente uuid>');
--   -- os dois lados devem bater: todo lead de pessoa_leads(x) tem lead_pessoa = x
--   -- (exceto os casados pelo card do Bitrix da viagem).
--
-- COMO VOLTAR
--   drop function if exists public.pessoa_pode_ver(uuid);
--   drop function if exists public.lead_pode_ver(uuid);
--   drop function if exists public.pessoa_leads(uuid);
--   drop function if exists public.lead_pessoa(uuid);
--   drop function if exists public.pessoa_do_lead_dados(uuid, text, text);
--   (antes, derrube 0381–0384, que dependem destas.)
-- -----------------------------------------------------------------------------

-- A ficha a partir dos dados soltos de um lead (cliente_id, telefone, e-mail).
create or replace function public.pessoa_do_lead_dados(p_cliente_id uuid, p_phone text, p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(c.mesclado_em_id, c.id) from rel_clientes c where c.id = p_cliente_id),
    case when nullif(btrim(coalesce(p_phone, '')), '') is not null then rel_cliente_do_telefone(p_phone) end,
    (select case when count(*) = 1 then (array_agg(c.id))[1] end
       from rel_clientes c
      where nullif(btrim(coalesce(p_email, '')), '') is not null
        and lower(c.email) = lower(btrim(p_email))
        and c.mesclado_em_id is null
        and c.arquivado_em is null)
  );
$$;

create or replace function public.lead_pessoa(p_lead uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.pessoa_do_lead_dados(l.cliente_id, l.phone, l.email)
    from qs_leads l
   where l.id = p_lead;
$$;

create or replace function public.pessoa_leads(p_cliente uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select id, telefone, email from rel_clientes where id = p_cliente
  ), fichas as (
    -- a ficha + as que foram mescladas nela
    select id from rel_clientes where id = p_cliente or mesclado_em_id = p_cliente
  ), ligados as (
    select l.id from qs_leads l where l.cliente_id in (select id from fichas)
  ), candidatos as (
    select l.id, l.phone, l.email
      from qs_leads l, c
     where l.cliente_id is null and c.telefone is not null and l.phone is not null
       and qs_tel_chave(l.phone) = qs_tel_chave(c.telefone)        -- usa qs_leads_tel_chave_idx
    union
    select l.id, l.phone, l.email
      from qs_leads l, c
     where l.cliente_id is null and c.email is not null and l.email is not null
       and lower(l.email) = lower(c.email)
  ), do_bitrix as (
    select l.id
      from qs_leads l
      join rel_viagens v on v.bitrix_deal_id = l.bitrix_id
     where v.cliente_id = p_cliente and l.bitrix_id is not null and l.cliente_id is null
  )
  select id from ligados
  union
  select k.id from candidatos k where public.pessoa_do_lead_dados(null, k.phone, k.email) = p_cliente
  union
  select id from do_bitrix;
$$;

create or replace function public.lead_pode_ver(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    qs_is_manager() or qs_is_closer()
    or exists (
      select 1 from qs_leads l
       where l.id = p_lead
         and (l.owner_id = auth.uid()
              or exists (select 1 from qs_meetings m where m.lead_id = l.id and m.owner_id = auth.uid()))
    ), false);
$$;

create or replace function public.pessoa_pode_ver(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    rel_tem_acesso() or ops_tem_acesso() or fin_tem_acesso() or qs_is_manager() or qs_is_closer()
    or exists (
      select 1 from public.pessoa_leads(p_cliente) x(id)
        join qs_leads l on l.id = x.id
       where l.owner_id = auth.uid()
          or exists (select 1 from qs_meetings m where m.lead_id = l.id and m.owner_id = auth.uid())
    ), false);
$$;

comment on function public.lead_pessoa(uuid) is
  'Ficha (rel_clientes) de um lead: cliente_id > telefone (rel_cliente_do_telefone) > e-mail único. Interna (0380).';
comment on function public.pessoa_leads(uuid) is
  'Leads de uma ficha: cliente_id + sem vínculo casados por telefone/e-mail + card Bitrix da viagem. Interna (0380).';

-- Internas: só as RPCs SECURITY DEFINER das 0381–0384 chamam.
revoke all on function public.pessoa_do_lead_dados(uuid, text, text) from public, anon, authenticated;
revoke all on function public.lead_pessoa(uuid) from public, anon, authenticated;
revoke all on function public.pessoa_leads(uuid) from public, anon, authenticated;
revoke all on function public.lead_pode_ver(uuid) from public, anon, authenticated;
revoke all on function public.pessoa_pode_ver(uuid) from public, anon, authenticated;
