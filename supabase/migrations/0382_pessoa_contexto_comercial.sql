-- 0382_pessoa_contexto_comercial.sql
-- -----------------------------------------------------------------------------
-- VISÃO CRUZADA, PASSO 3: O QUE O COMERCIAL VIVEU COM A PESSOA, NA FICHA DO
-- REL E NA GAVETA DO OPS (13/11/2026).
--
-- PORQUÊ
--   Quem atende no pós-venda não sabe por onde a pessoa chegou, o que respondeu
--   no formulário da LP, o que o SDR anotou, nem por que ela desistiu da última
--   vez. Conferido na RLS vigente:
--     • qs_meetings / qs_meeting_transcricoes → qualquer usuário ATIVO lê
--       (meetings_select = true + ativo_qs_meetings). O front reaproveita o
--       <ReunioesDoCliente> direto, sem RPC.
--     • qs_leads → Rel/Ops NÃO leem (leads_select: gestor, closer, dono, dono da
--       reunião). Sem os ids dos leads, a ficha não acha as reuniões.
--     • qs_lead_form_answers → SÓ a barreira restritiva, nenhuma policy de
--       leitura: ninguém lê pelo navegador (o /api/lead-formulario lê com a
--       service role e só libera pra quem pode falar com o lead — Rel/Ops tomam
--       403).
--     • qs_notes → Rel/Ops não leem (notes_select: gestor, closer, dono do lead).
--   Então: RPC SECURITY DEFINER que checa o setor (Rel, Ops, Financeiro ou
--   gestor comercial) e devolve SÓ o necessário, por lead da pessoa:
--     id, nome, status, fonte, chegou_em, dono (nome), UTMs, motivo de perda do
--     lead, respostas do formulário (cache qs_lead_form_answers), últimas 5
--     notas (corpo cortado em 600 caracteres) e o negócio do closer (etapa,
--     closer, motivo de perda).
--   Nada de telefone, e-mail ou WhatsApp (0173: WhatsApp não vai pro Ops).
--
-- COMO CONFERIR
--   select public.pessoa_contexto_comercial('<cliente uuid>');
--   -- SDR comum recebe "Sem acesso" (ele já vê tudo isso na ficha do lead).
--
-- COMO VOLTAR
--   drop function if exists public.pessoa_contexto_comercial(uuid);
--   (o bloco "Do Comercial" some da ficha/gaveta — o front trata a ausência.)
-- -----------------------------------------------------------------------------

create or replace function public.pessoa_contexto_comercial(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_leads uuid[];
  v jsonb;
begin
  if auth.uid() is null or not (rel_tem_acesso() or ops_tem_acesso() or fin_tem_acesso() or qs_is_manager()) then
    raise exception 'Sem acesso ao contexto do Comercial.' using errcode = '42501';
  end if;
  if not exists (select 1 from rel_clientes where id = p_cliente) then return null; end if;

  select coalesce(array_agg(x), '{}') into v_leads from public.pessoa_leads(p_cliente) x;

  select jsonb_build_object(
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'nome', coalesce(nullif(l.full_name, ''), btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''))),
        'status', l.status,
        'fonte', l.source,
        'chegou_em', coalesce(l.arrived_at, l.created_at),
        'dono', (select u.name from qs_users u where u.id = l.owner_id),
        'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
        'utm_content', l.utm_content, 'utm_term', l.utm_term,
        'motivo_perda', (select lr.label from qs_loss_reasons lr where lr.id = l.loss_reason_id),
        'respostas', coalesce((select case when jsonb_typeof(fa.answers) = 'array' then fa.answers end
                                 from qs_lead_form_answers fa where fa.lead_id = l.id limit 1), '[]'::jsonb),
        'notas', coalesce((
          select jsonb_agg(jsonb_build_object('id', n.id, 'texto', left(n.body, 600), 'criado_em', n.created_at,
                                              'autor', (select u.name from qs_users u where u.id = n.author_id))
                           order by n.created_at desc)
            from (select * from qs_notes n where n.lead_id = l.id order by n.created_at desc limit 5) n), '[]'::jsonb),
        'negocio', (
          select jsonb_build_object('id', ng.id, 'etapa', ng.etapa, 'motivo_perda', ng.motivo_perda,
                                    'closer', (select u.name from qs_users u where u.id = ng.closer_id),
                                    'atualizado_em', ng.atualizado_em)
            from qs_closer_negocios ng where ng.lead_id = l.id order by ng.atualizado_em desc limit 1)
      ) order by coalesce(l.arrived_at, l.created_at) desc)
      from qs_leads l where l.id = any (v_leads)), '[]'::jsonb)
  ) into v;
  return v;
end $$;

comment on function public.pessoa_contexto_comercial(uuid) is
  'Contexto do Comercial pra ficha do Rel/gaveta do Ops: leads da pessoa com origem/UTM, respostas do formulário, notas, negócio e motivo de perda. 0382.';

revoke all on function public.pessoa_contexto_comercial(uuid) from public, anon;
grant execute on function public.pessoa_contexto_comercial(uuid) to authenticated;
