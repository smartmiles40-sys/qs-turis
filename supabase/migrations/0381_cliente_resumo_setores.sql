-- 0381_cliente_resumo_setores.sql
-- -----------------------------------------------------------------------------
-- VISÃO CRUZADA, PASSO 2: O RESUMO DA PESSOA EM TODOS OS SETORES (13/11/2026).
--
-- PORQUÊ
--   O SDR e o closer não sabem que o lead já é cliente da casa (viagem marcada,
--   chamado aberto no Rel, recompra em andamento no Rel, parcela vencida no
--   Financeiro) — e o Rel/Ops não sabem o que o Comercial viveu com a pessoa.
--   Um resumo único por pessoa resolve os dois lados.
--
--   Por que RPC e não view security_invoker: a RLS vigente NÃO deixa o SDR ler
--   rel_viagens/rel_chamados/rel_oportunidades/fin_parcelas, nem o Rel ler
--   qs_leads/qs_closer_negocios. Uma view com security_invoker devolveria vazio
--   justamente pra quem precisa. Então: SECURITY DEFINER + checagem explícita
--   (pessoa_pode_ver / lead_pode_ver, 0380) + só AGREGADOS — nenhum telefone,
--   e-mail, documento ou conversa sai daqui (0173: WhatsApp do Rel não vai pro
--   Ops; aqui nem aparece).
--
--   • cliente_resumo_setores(ficha)        → pra quem está na ficha (Rel/Ops/Fin…)
--   • lead_resumo_setores(lead)            → pra ficha do lead (SDR) e o painel do
--       negócio (closer). Resolve a pessoa pelo lead (cliente_id; enquanto vazio,
--       telefone/e-mail) e TIRA da conta o que nasceu deste lead (a viagem e o
--       plano da venda que o closer está fechando agora não são "cliente da casa").
--
--   Conteúdo (jsonb):
--     viagens        {ativas, canceladas, realizadas, proximas[≤3]}  (rel_viagens
--                    como comprador ou passageiro; mescladas/arquivadas fora)
--     chamados       {abertos, lista[≤3]}  (rel_chamados não resolvidos)
--     oportunidades  {abertas, lista[≤3]}  (rel_oportunidades fora de ganho/perdido)
--     parcelas       {vencidas, vencidas_valor, abertas, abertas_valor, pagas}
--                    (fin_parcelas dos planos da pessoa: cliente_id, viagens dela,
--                    leads dela ou negócios dos leads dela)
--     negocios[≤5]   {id, lead_id, etapa, closer, motivo_perda, atualizado_em}
--     motivo_perda   negócio.motivo_perda > reunião.desistencia_motivo > motivo do lead
--     origem         source/UTM do PRIMEIRO lead da pessoa
--
-- COMO CONFERIR
--   -- logado como alguém do Rel (ou pelo SQL editor, que roda como dono):
--   select public.cliente_resumo_setores('<cliente uuid>');
--   select public.lead_resumo_setores('<lead uuid>');   -- null = lead sem ficha
--   -- SDR sem relação com a pessoa recebe erro "Sem acesso".
--
-- COMO VOLTAR
--   drop function if exists public.lead_resumo_setores(uuid);
--   drop function if exists public.cliente_resumo_setores(uuid);
--   drop function if exists public.pessoa_resumo_interno(uuid, uuid);
--   (o front volta a não mostrar a faixa — ele trata a função ausente.)
-- -----------------------------------------------------------------------------

create or replace function public.pessoa_resumo_interno(p_cliente uuid, p_lead_atual uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_leads uuid[];
  v_neg_atual uuid[];
  v jsonb;
begin
  if not exists (select 1 from rel_clientes where id = p_cliente) then return null; end if;

  select coalesce(array_agg(x), '{}') into v_leads from public.pessoa_leads(p_cliente) x;
  -- negócios do lead aberto agora: a venda dele não conta como "cliente da casa"
  select coalesce(array_agg(n.id), '{}') into v_neg_atual
    from qs_closer_negocios n where p_lead_atual is not null and n.lead_id = p_lead_atual;

  with viagens as (
    select v.*
      from rel_viagens v
     where v.mesclada_em_id is null and v.arquivado_em is null
       and (v.cliente_id = p_cliente
            or exists (select 1 from rel_viagem_passageiros p where p.viagem_id = v.id and p.cliente_id = p_cliente))
       and (v.closer_negocio_id is null or not (v.closer_negocio_id = any (v_neg_atual)))
  ), negocios as (
    select n.* from qs_closer_negocios n where n.lead_id = any (v_leads)
  ), planos as (
    select pl.id
      from fin_planos pl
     where (pl.cliente_id = p_cliente
            or pl.viagem_id in (select id from viagens)
            or pl.lead_id = any (v_leads)
            or pl.negocio_id in (select id from negocios))
       and (p_lead_atual is null or pl.lead_id is distinct from p_lead_atual)
       and (pl.negocio_id is null or not (pl.negocio_id = any (v_neg_atual)))
  ), parcelas as (
    select pa.* from fin_parcelas pa where pa.plano_id in (select id from planos) and pa.status <> 'cancelado'
  ), primeiro as (
    select l.* from qs_leads l where l.id = any (v_leads)
     order by coalesce(l.arrived_at, l.created_at) asc limit 1
  )
  select jsonb_build_object(
    'cliente_id', p_cliente,
    'leads', coalesce(array_length(v_leads, 1), 0),
    'viagens', jsonb_build_object(
      'ativas', (select count(*) from viagens where status = 'ativa' and (data_retorno is null or data_retorno >= v_hoje)),
      'realizadas', (select count(*) from viagens where status = 'ativa' and data_retorno < v_hoje),
      'canceladas', (select count(*) from viagens where status = 'cancelada'),
      'proximas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'destino', destino,
                                   'embarque', data_embarque, 'retorno', data_retorno) order by data_embarque), '[]'::jsonb)
                     from (select * from viagens where status = 'ativa' and data_embarque >= v_hoje
                            order by data_embarque limit 3) t)
    ),
    'chamados', jsonb_build_object(
      'abertos', (select count(*) from rel_chamados ch where ch.cliente_id = p_cliente and ch.status <> 'resolvido'),
      'lista', (select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'assunto', assunto, 'status', status,
                                'prioridade', prioridade, 'prazo', prazo) order by criado_em desc), '[]'::jsonb)
                  from (select * from rel_chamados ch where ch.cliente_id = p_cliente and ch.status <> 'resolvido'
                         order by ch.criado_em desc limit 3) t)
    ),
    'oportunidades', jsonb_build_object(
      'abertas', (select count(*) from rel_oportunidades o where o.cliente_id = p_cliente and o.etapa not in ('ganho', 'perdido')),
      'lista', (select coalesce(jsonb_agg(jsonb_build_object('titulo', titulo, 'etapa', etapa, 'produto', produto,
                                'dono', (select u.name from qs_users u where u.id = t.dono_id)) order by criado_em desc), '[]'::jsonb)
                  from (select * from rel_oportunidades o where o.cliente_id = p_cliente and o.etapa not in ('ganho', 'perdido')
                         order by o.criado_em desc limit 3) t)
    ),
    'parcelas', jsonb_build_object(
      'vencidas', (select count(*) from parcelas where status = 'a_receber' and vencimento < v_hoje),
      'vencidas_valor', (select coalesce(sum(valor), 0) from parcelas where status = 'a_receber' and vencimento < v_hoje),
      'abertas', (select count(*) from parcelas where status = 'a_receber' and vencimento >= v_hoje),
      'abertas_valor', (select coalesce(sum(valor), 0) from parcelas where status = 'a_receber' and vencimento >= v_hoje),
      'pagas', (select count(*) from parcelas where status = 'pago')
    ),
    'negocios', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'lead_id', lead_id, 'etapa', etapa,
                                 'closer', (select u.name from qs_users u where u.id = t.closer_id),
                                 'motivo_perda', motivo_perda, 'atualizado_em', atualizado_em) order by atualizado_em desc), '[]'::jsonb)
                   from (select * from negocios order by atualizado_em desc limit 5) t),
    'motivo_perda', coalesce(
      (select nullif(btrim(n.motivo_perda), '') from negocios n
        where nullif(btrim(n.motivo_perda), '') is not null order by n.atualizado_em desc limit 1),
      (select nullif(btrim(m.desistencia_motivo), '') from qs_meetings m
        where m.lead_id = any (v_leads) and nullif(btrim(m.desistencia_motivo), '') is not null
        order by m.scheduled_at desc limit 1),
      (select lr.label from qs_leads l join qs_loss_reasons lr on lr.id = l.loss_reason_id
        where l.id = any (v_leads) order by coalesce(l.closed_at, l.updated_at) desc nulls last limit 1)
    ),
    'origem', (select jsonb_build_object('lead_id', id, 'chegou_em', coalesce(arrived_at, created_at), 'fonte', source,
                      'utm_source', utm_source, 'utm_medium', utm_medium, 'utm_campaign', utm_campaign,
                      'utm_content', utm_content, 'utm_term', utm_term)
                 from primeiro)
  ) into v;
  return v;
end $$;

create or replace function public.cliente_resumo_setores(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.pessoa_pode_ver(p_cliente) then
    raise exception 'Sem acesso a esta pessoa.' using errcode = '42501';
  end if;
  return public.pessoa_resumo_interno(p_cliente, null);
end $$;

create or replace function public.lead_resumo_setores(p_lead uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_pessoa uuid;
begin
  if auth.uid() is null or not public.lead_pode_ver(p_lead) then
    raise exception 'Sem acesso a este lead.' using errcode = '42501';
  end if;
  v_pessoa := public.lead_pessoa(p_lead);
  if v_pessoa is null then return null; end if;
  return public.pessoa_resumo_interno(v_pessoa, p_lead);
end $$;

comment on function public.cliente_resumo_setores(uuid) is
  'Resumo da pessoa em todos os setores (viagens, chamados, oportunidades do Rel, parcelas, negócios, motivo de perda, origem). Só agregados. 0381.';
comment on function public.lead_resumo_setores(uuid) is
  'O mesmo resumo a partir de um lead (faixa "Cliente da casa" do SDR/closer); exclui a venda deste lead. 0381.';

revoke all on function public.pessoa_resumo_interno(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cliente_resumo_setores(uuid) from public, anon;
revoke all on function public.lead_resumo_setores(uuid) from public, anon;
grant execute on function public.cliente_resumo_setores(uuid) to authenticated;
grant execute on function public.lead_resumo_setores(uuid) to authenticated;
