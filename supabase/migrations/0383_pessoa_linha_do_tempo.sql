-- 0383_pessoa_linha_do_tempo.sql
-- -----------------------------------------------------------------------------
-- VISÃO CRUZADA, PASSO 4: A LINHA DO TEMPO UNIFICADA DA PESSOA (13/11/2026).
--
-- PORQUÊ
--   A linha do tempo da ficha do Rel (src/rel/clientes/ficha/dados.ts) só junta
--   o que a ficha já carrega: auditoria da ficha, contatos do Rel, solicitações,
--   "lead chegou", vendas. Tudo que o Comercial fez com a pessoa fica de fora.
--   Esta RPC junta, PELOS LEADS DA PESSOA (pessoa_leads, 0380):
--     wa        WhatsApp do SDR — UMA linha por lead por dia (contagem + prévia
--               de 140 caracteres da última mensagem). Nunca a conversa inteira.
--     ligacao   qs_call_logs (atendida/não, duração). Sem o número.
--     nota      qs_notes (corpo cortado em 300).
--     tarefa    qs_tasks concluídas (canal + resultado).
--     reuniao   qs_meetings (data, status, closer).
--     sol_evento   qs_solicitacao_eventos das solicitações da pessoa/leads/
--                  negócios — filtradas por qs_ve_solicitacao (a mesma regra da
--                  RLS de qs_solicitacoes: quem não vê o pedido não vê o evento).
--     negocio_evento   qs_closer_negocio_eventos dos negócios dos leads.
--   + o que a ficha já mostra, pra quem usar a RPC sozinha:
--     lead (chegou), venda (rel_viagens), solicitacao (criada), contato
--     (rel_contatos), chamado (rel_chamados).
--   O front da ficha do Rel junta só os tipos que ele ainda não tem (ver
--   src/clientes/visaoCruzada.ts) — nada aparece duas vezes.
--
--   Respeito à RLS vigente:
--     • Acesso: pessoa_pode_ver (0380).
--     • WhatsApp do SDR: só Rel, Financeiro, gestor comercial e closer — o Ops
--       NÃO recebe essas linhas (mesma linha da 0173: WhatsApp não vai pro Ops).
--     • contato/chamado do Rel: só quem tem rel_tem_acesso (rel_chamados_ler).
--     • Telefone/e-mail nunca saem.
--
-- COMO CONFERIR
--   select * from public.pessoa_linha_do_tempo('<cliente uuid>', 50);
--   -- ordem: mais novo primeiro; p_limite entre 1 e 500 (padrão 200).
--
-- COMO VOLTAR
--   drop function if exists public.pessoa_linha_do_tempo(uuid, int);
--   (a ficha volta à linha do tempo antiga — o front trata a função ausente.)
-- -----------------------------------------------------------------------------

create or replace function public.pessoa_linha_do_tempo(p_cliente uuid, p_limite int default 200)
returns table (id text, em timestamptz, tipo text, titulo text, sub text, setor text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_leads uuid[];
  v_negocios uuid[];
  v_ve_wa boolean;
  v_ve_rel boolean;
  v_lim int := least(greatest(coalesce(p_limite, 200), 1), 500);
begin
  if auth.uid() is null or not public.pessoa_pode_ver(p_cliente) then
    raise exception 'Sem acesso a esta pessoa.' using errcode = '42501';
  end if;
  v_ve_rel := rel_tem_acesso();
  v_ve_wa := v_ve_rel or fin_tem_acesso() or qs_is_manager() or qs_is_closer();

  select coalesce(array_agg(x), '{}') into v_leads from public.pessoa_leads(p_cliente) x;
  select coalesce(array_agg(n.id), '{}') into v_negocios from qs_closer_negocios n where n.lead_id = any (v_leads);

  return query
  with u as (select q.id, q.name from qs_users q),
  linhas as (
    -- lead chegou
    select 'lead:' || l.id::text as id, coalesce(l.arrived_at, l.created_at) as em, 'lead'::text as tipo,
           'Lead chegou no Comercial'::text as titulo,
           nullif(concat_ws(' · ', l.source, nullif(concat_ws(' / ', l.utm_source, l.utm_campaign), ''),
                            (select 'com ' || split_part(u.name, ' ', 1) from u where u.id = l.owner_id)), '') as sub,
           'comercial'::text as setor
      from qs_leads l where l.id = any (v_leads)

    union all
    -- WhatsApp do SDR: uma linha por lead por dia
    select 'wa:' || w.lead_id::text || ':' || w.dia::text, w.ultima, 'wa',
           'WhatsApp com o Comercial: ' || w.n || case when w.n = 1 then ' mensagem' else ' mensagens' end
             || case when w.n_cli > 0 then ' (' || w.n_cli || ' do cliente)' else '' end,
           w.previa, 'comercial'
      from (
        select m.lead_id, (m.sent_at at time zone 'America/Sao_Paulo')::date as dia, max(m.sent_at) as ultima,
               count(*) as n, count(*) filter (where m.direction = 'in') as n_cli,
               left((array_agg(coalesce(nullif(m.content, ''), nullif(m.transcricao, ''), '[anexo]') order by m.sent_at desc))[1], 140) as previa
          from qs_wa_messages m
         where v_ve_wa and m.lead_id = any (v_leads) and m.deleted_at is null and m.sent_at is not null
         group by m.lead_id, (m.sent_at at time zone 'America/Sao_Paulo')::date
      ) w

    union all
    -- ligações
    select 'lig:' || c.id::text, c.created_at, 'ligacao',
           case when c.answered then 'Ligação do Comercial atendida'
                  || case when c.duration_sec > 0 then ' · ' || greatest(1, round(c.duration_sec / 60.0))::int || ' min' else '' end
                else 'Ligação do Comercial sem resposta' end,
           (select u.name from u where u.id = c.owner_id), 'comercial'
      from qs_call_logs c where c.lead_id = any (v_leads)

    union all
    -- notas
    select 'nota:' || n.id::text, n.created_at, 'nota', 'Nota do Comercial',
           nullif(concat_ws(' · ', left(n.body, 300), (select u.name from u where u.id = n.author_id)), ''), 'comercial'
      from qs_notes n where n.lead_id = any (v_leads)

    union all
    -- tarefas concluídas
    select 'tar:' || t.id::text, t.completed_at, 'tarefa',
           'Atividade concluída: ' || replace(t.channel_type, '_', ' '),
           nullif(concat_ws(' · ', t.contact_result, left(t.notes, 160), (select u.name from u where u.id = t.owner_id)), ''), 'comercial'
      from qs_tasks t where t.lead_id = any (v_leads) and t.status = 'concluida' and t.completed_at is not null

    union all
    -- reuniões
    select 'reu:' || m.id::text, m.scheduled_at, 'reuniao',
           'Reunião ' || coalesce(m.status, ''),
           nullif(concat_ws(' · ', m.title, nullif(btrim(coalesce(m.meeting_owner, '')), ''), nullif(m.desistencia_motivo, '')), ''), 'comercial'
      from qs_meetings m where m.lead_id = any (v_leads) and m.scheduled_at is not null

    union all
    -- eventos das solicitações (só as que a pessoa logada enxerga)
    select 'sev:' || e.id::text, e.criado_em, 'sol_evento',
           'Solicitação #' || s.numero || ': ' || replace(e.tipo, '_', ' ')
             || case when e.para is not null then ' → ' || e.para else '' end,
           nullif(concat_ws(' · ', left(e.texto, 200), e.autor_nome), ''), s.para_setor
      from qs_solicitacao_eventos e
      join qs_solicitacoes s on s.id = e.solicitacao_id
     where e.tipo <> 'criada'   -- a criação já vem na linha "solicitacao" abaixo
       and (s.cliente_id = p_cliente or s.lead_id = any (v_leads) or s.closer_negocio_id = any (v_negocios))
       and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id)

    union all
    -- solicitação criada (a ficha já mostra; aqui pra quem usar a RPC sozinha)
    select 'sol:' || s.id::text, s.criado_em, 'solicitacao',
           'Solicitação #' || s.numero || ': ' || coalesce(s.titulo, ''), s.de_setor || ' → ' || s.para_setor, s.para_setor
      from qs_solicitacoes s
     where (s.cliente_id = p_cliente or s.lead_id = any (v_leads) or s.closer_negocio_id = any (v_negocios))
       and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id)

    union all
    -- eventos do negócio do closer
    select 'nev:' || e.id::text, e.criado_em, 'negocio_evento',
           case when e.para_etapa is not null then 'Negócio: ' || coalesce(e.de_etapa, '—') || ' → ' || e.para_etapa
                else 'Negócio: ' || replace(e.tipo, '_', ' ') end,
           nullif(concat_ws(' · ', left(e.texto, 200), (select u.name from u where u.id = e.autor_id)), ''), 'comercial'
      from qs_closer_negocio_eventos e where e.negocio_id = any (v_negocios)

    union all
    -- vendas (rel_viagens como comprador)
    select 'venda:' || v.id::text, coalesce(v.data_venda::timestamptz, v.criado_em), 'venda', 'Venda: ' || v.titulo,
           case when v.data_embarque is not null then 'embarca ' || to_char(v.data_embarque, 'DD/MM/YYYY') end, 'financeiro'
      from rel_viagens v where v.cliente_id = p_cliente and v.mesclada_em_id is null

    union all
    -- contatos do Rel (só Rel)
    select 'cont:' || k.id::text, k.feito_em, 'contato', 'Contato por ' || k.canal,
           nullif(concat_ws(' · ', left(k.resumo, 200), (select u.name from u where u.id = k.autor_id)), ''), 'relacionamento'
      from rel_contatos k where v_ve_rel and k.cliente_id = p_cliente

    union all
    -- chamados do Rel (só Rel)
    select 'cham:' || ch.id::text, ch.criado_em, 'chamado', 'Chamado #' || ch.numero || ': ' || ch.assunto,
           ch.status, 'relacionamento'
      from rel_chamados ch where v_ve_rel and ch.cliente_id = p_cliente
  )
  select x.id, x.em, x.tipo, x.titulo, x.sub, x.setor
    from linhas x
   where x.em is not null
   order by x.em desc
   limit v_lim;
end $$;

comment on function public.pessoa_linha_do_tempo(uuid, int) is
  'Linha do tempo unificada da pessoa (Comercial + Rel + solicitações + negócio). WhatsApp do SDR só resumo e nunca pro Ops. 0383.';

revoke all on function public.pessoa_linha_do_tempo(uuid, int) from public, anon;
grant execute on function public.pessoa_linha_do_tempo(uuid, int) to authenticated;
