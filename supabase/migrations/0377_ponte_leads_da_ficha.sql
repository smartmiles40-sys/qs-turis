-- 0377_ponte_leads_da_ficha.sql
-- -----------------------------------------------------------------------------
-- PONTE PESSOA (2/4): UMA FONTE SÓ PRA "OS LEADS DESTA PESSOA" (13/11/2026).
--
-- POR QUÊ
--   Cada função de ficha achava os leads de um jeito:
--     • rel_ligacoes_do_cliente (0151) — só por telefone/e-mail (ignorava o
--       cliente_id que o vendedor ligou à mão);
--     • cad_contratos_do_cliente (0228) — só por qs_leads.cliente_id (que até a
--       0376 estava preenchido em 1 lead: os contratos dos outros sumiam);
--     • qs_sol_cliente_do_lead — só pelos 8 últimos dígitos do telefone.
--   Agora todas usam cad_leads_da_ficha(ficha):
--     1. qs_leads.cliente_id = a ficha (ou uma ficha mesclada nela)  → 'cadastro'
--     2. FALLBACK, só pra lead SEM cliente_id: mesmo telefone
--        (rel_fone_chave) → 'telefone', ou mesmo e-mail → 'e-mail'.
--   Lead ligado à mão a OUTRA ficha não aparece mais aqui só por dividir o
--   telefone (casal com o mesmo número): a ligação explícita manda.
--
-- O QUE MUDA NAS TELAS
--   • Ficha do Rel → "Ligações": a lista de leads passa a incluir os ligados
--     por cadastro; o rótulo ganha o valor "cadastro" ("pelo cadastro").
--   • Ficha → Contratos: passam a aparecer os contratos dos leads que casam
--     por telefone/e-mail (antes só os de lead com cliente_id).
--   Com ou sem esta migration o front funciona (mesmo formato de retorno).
--
-- COMO CONFERIR
--   select * from cad_leads_da_ficha('<uuid da ficha>');
--   select rel_ligacoes_do_cliente('<uuid>')->'leads';      -- como Rel
--   select jsonb_array_length(cad_contratos_do_cliente('<uuid>'));
--
-- COMO VOLTAR
--   Recriar rel_ligacoes_do_cliente (0151), cad_contratos_do_cliente (0228) e
--   qs_sol_cliente_do_lead nas versões anteriores (pg_get_functiondef de antes
--   está no git: as versões abaixo só trocam o trecho dos leads), e então
--   drop function cad_leads_da_ficha(uuid).
-- Idempotente.
-- -----------------------------------------------------------------------------

create or replace function public.cad_leads_da_ficha(p uuid)
returns table (lead_id uuid, por text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with f as (
    select c.id, c.telefone, c.email,
           case when length(rel_fone_chave(c.telefone)) >= 10 then rel_fone_chave(c.telefone) end as fone
      from rel_clientes c where c.id = cad_ficha_viva(p)
  ), ids as (
    select id from f
    union
    select m.id from rel_clientes m, f where m.mesclado_em_id is not null and cad_ficha_viva(m.id) = f.id
  )
  select l.id, 'cadastro'::text from qs_leads l where l.cliente_id in (select id from ids)
  union all
  select l.id, case when f.fone is not null and rel_fone_chave(l.phone) = f.fone then 'telefone' else 'e-mail' end
    from qs_leads l, f
   where l.cliente_id is null
     and ((f.fone is not null and l.phone is not null
           and qs_tel_chave(l.phone) = qs_tel_chave(f.telefone) and rel_fone_chave(l.phone) = f.fone)
       or (f.email is not null and l.email is not null and lower(btrim(l.email)) = f.email));
$fn$;

comment on function public.cad_leads_da_ficha(uuid) is
  'Leads da pessoa: cliente_id = ficha (ou mesclada nela) → cadastro; sem cliente_id, por telefone/e-mail. Fonte única (0377).';

revoke all on function public.cad_leads_da_ficha(uuid) from public, anon, authenticated;

-- ── rel_ligacoes_do_cliente: vigente em 13/11, só o bloco 'leads' mudou ──────
create or replace function public.rel_ligacoes_do_cliente(p_cliente uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare c rel_clientes; v jsonb;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  select * into c from rel_clientes where id = p_cliente;
  if not found then return null; end if;

  select jsonb_build_object(
    'leads', (select coalesce(jsonb_agg(x order by x->>'criado_em'), '[]'::jsonb) from (
       select distinct on (l.id) jsonb_build_object('id', l.id, 'nome', coalesce(nullif(l.full_name, ''), btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''))),
              'status', l.status, 'fonte', l.source, 'criado_em', coalesce(l.arrived_at, l.created_at), 'fechado_em', l.closed_at,
              'dono', (select u.name from qs_users u where u.id = l.owner_id),
              'por', case when exists (select 1 from rel_viagens v where v.cliente_id = c.id and v.bitrix_deal_id = l.bitrix_id) then 'venda'
                          else coalesce((select d.por from cad_leads_da_ficha(c.id) d where d.lead_id = l.id limit 1), 'telefone') end) x
         from qs_leads l
        where (l.bitrix_id is not null and exists (select 1 from rel_viagens v where v.cliente_id = c.id and v.bitrix_deal_id = l.bitrix_id))
           or l.id in (select d.lead_id from cad_leads_da_ficha(c.id) d)
        limit 10) t),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object('jid', g.jid, 'nome', g.nome, 'ultima_msg_em', g.ultima_msg_em) order by g.ultima_msg_em desc nulls last), '[]'::jsonb)
                 from rel_wa_grupos g
                where g.saiu_em is null and c.telefone is not null
                  and exists (select 1 from rel_wa_grupo_participantes p where p.grupo_jid = g.jid and rel_fone_chave(p.telefone) = rel_fone_chave(c.telefone))),
    'financeiro', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero, 'motivo', f.motivo, 'status', f.status, 'criado_em', f.criado_em) order by f.criado_em desc), '[]'::jsonb)
                     from fin_atendimentos f where f.cliente_id = c.id),
    'passageiro_em', (select count(*) from rel_viagem_passageiros p join rel_viagens v on v.id = p.viagem_id
                       where p.cliente_id = c.id and v.mesclada_em_id is null and v.cliente_id is distinct from c.id),
    'comprador_em', (select count(*) from rel_viagens v where v.cliente_id = c.id and v.mesclada_em_id is null),
    'conversas', (select count(*) from rel_wa_conversas w where w.cliente_id = c.id),
    'cruzamentos', (select coalesce(jsonb_agg(jsonb_build_object('campo', x.campo, 'fonte', x.fonte, 'em', x.em) order by x.em desc), '[]'::jsonb)
                      from rel_cruzamentos x where x.tabela = 'rel_clientes' and x.registro_id = c.id and x.desfeito_em is null)
  ) into v;
  return v;
end $function$;

-- ── cad_contratos_do_cliente: vigente em 13/11, leads via cad_leads_da_ficha ─
create or replace function public.cad_contratos_do_cliente(p uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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

  with meus_leads as (
    select lead_id from cad_leads_da_ficha(v)
  ), viagens as (
    select id, closer_negocio_id, titulo from rel_viagens where cliente_id = v
  ), negocios as (
    select distinct on (n.id) n.id, n.status_contrato, n.contrato_enviado_em, n.contrato_assinado_em, n.criado_em, vg.titulo
      from qs_closer_negocios n
      left join viagens vg on vg.id = n.viagem_id or vg.closer_negocio_id = n.id
     where n.viagem_id in (select id from viagens)
        or n.id in (select closer_negocio_id from viagens where closer_negocio_id is not null)
        or n.lead_id in (select lead_id from meus_leads)
  ), contratos as (
    select k.*
      from qs_contratos k
     where k.negocio_id in (select id from negocios)
        or k.lead_id in (select lead_id from meus_leads)
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
$function$;

-- ── qs_sol_cliente_do_lead: o cliente_id do lead manda; telefone é fallback ──
-- Vigente em 13/11 = só os 8 últimos dígitos. O fallback continua idêntico.
create or replace function public.qs_sol_cliente_do_lead(p_lead uuid)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare f text; r uuid; n int; lig uuid;
begin
  select cliente_id, right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) into lig, f from qs_leads where id = p_lead;
  if lig is not null then return cad_ficha_viva(lig); end if;
  if f is null or length(f) < 8 then return null; end if;
  select min(c.id::text)::uuid, count(*) into r, n from rel_clientes c
   where c.mesclado_em_id is null and right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) = f;
  return case when n = 1 then r end;
end $function$;
