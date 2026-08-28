-- 0065_gloria_catalogo_no_contexto.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- Depende da 0053 e 0060.
--
-- -- O QUE ACONTECEU, COM HORA -----------------------------------------------
--
-- 27/08, 17:13 - qualificando um lead da Islandia, a Gloria perguntou:
--   "E ja chegaram a conversar sobre quando pretendem viajar ? Qual epoca do
--    ano faz mais sentido pra voces ?"
--
-- A expedicao tem UMA saida: 13 a 23/02/2027. O cliente respondeu "janeiro",
-- ela so entao consultou a base, revelou fevereiro, ele tentou "novembro", e
-- ela teve que recusar duas vezes na mesma conversa. Sobrou um card com
-- resposta_data = "Prefere viajar em novembro" - um mes que nao existe no
-- produto - que o especialista leria antes da reuniao.
--
-- -- POR QUE O PROMPT SOZINHO NAO RESOLVE --------------------------------------
--
-- A regra ja estava escrita: "O jeito da casa de checar prazo e orcamento e
-- perguntar antes se a pessoa ja sabe. Voce ja esta ciente sobre a data ?".
-- Ela ignorou. Foi falha de ADERENCIA, nao de regra faltando - a mesma familia
-- do episodio da Africa do Sul, onde a regra tambem existia e tambem foi
-- ignorada.
--
-- Regra que o modelo pode esquecer nao e trava. A causa mecanica aqui e que ela
-- perguntou sobre data ANTES de ter a data em maos: precisava lembrar de
-- consultar a base, e nao lembrou. Enquanto a data depender de uma consulta que
-- ela pode pular, o erro volta.
--
-- -- O CONSERTO ---------------------------------------------------------------
--
-- O catalogo passa a viajar DENTRO do contexto, em todo turno. Ela nunca mais
-- precisa buscar uma data: a data ja esta na mao quando ela abre a boca.
-- Perguntar sem saber deixa de ser possivel.
--
-- -- POR QUE NAO CRIEI UMA TABELA DE CATALOGO ----------------------------------
--
-- Seria uma SEGUNDA fonte de verdade sobre datas, ao lado da que ja existe, e
-- as duas divergiriam no primeiro remarcamento - exatamente o defeito que a
-- regra da janela de 24h ja tem hoje (mora no banco e no n8n).
--
-- A fonte de verdade ja existe e ja e mantida: o documento 'agencia' na
-- gloria_documents, sincronizado do site pelo workflow gloria-base-conhecimento.
-- Ele lista as saidas abertas E as esgotadas, que e exatamente o que ela precisa
-- saber. Entao o contexto so BUSCA esse documento e entrega verbatim.
--
-- Verbatim, sem parsear: parser de texto quebra calado quando o site muda de
-- formato, e um catalogo que quebra calado e pior que catalogo nenhum. O modelo
-- le a lista como ela e.
--
-- Se o documento sumir, 'catalogo' volta vazio e ela cai no comportamento de
-- hoje (consultar a base). Nada quebra.
-- ---------------------------------------------------------------------------

-- ATENCAO: os DEFAULTS da assinatura sao obrigatorios. Sem eles o Postgres
-- recusa o replace ("cannot remove parameter defaults from existing function"),
-- e se fossem removidos a forca toda chamada com menos de 4 argumentos quebraria.
create or replace function public.qs_gloria_contexto(
  p_lead    uuid,
  p_sent_at timestamptz default null,
  p_modo    text        default 'resposta',
  p_passo   integer     default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $ctx$
declare
  v_lead        qs_leads%rowtype;
  v_ses         qs_gloria_sessoes%rowtype;
  v_global      boolean;
  v_piloto      jsonb;
  v_so_nova     boolean;
  v_so_pipeline boolean;
  v_no_pipeline boolean;
  v_fone        text;
  v_ativa       boolean;
  v_motivo      text := null;
  v_janela      boolean;
  v_ult_saida   timestamptz;
  v_ult_entrada timestamptz;
  v_pendentes   text;
  v_pend_ate    timestamptz;
  v_corte       timestamptz;
  v_expedicao   text;
  v_toque       jsonb := null;
  v_conversa    text := null;
  v_catalogo    text := null;
  v_passo       qs_gloria_passos%rowtype;
  v_pode        boolean;
begin
  p_modo := coalesce(nullif(trim(p_modo), ''), 'resposta');

  select * into v_lead from qs_leads where id = p_lead;
  if not found then
    return jsonb_build_object('ok', false, 'pode_responder', false, 'motivo', 'lead_inexistente');
  end if;

  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;
  select * into v_ses from qs_gloria_sessoes where lead_id = p_lead;

  select coalesce(nullif(value #>> '{}', ''), 'false')::boolean into v_global
    from qs_settings where key = 'gloria_ativa';
  select coalesce(value, '[]'::jsonb) into v_piloto
    from qs_settings where key = 'gloria_leads_piloto';
  select coalesce(nullif(value #>> '{}', ''), 'true')::boolean into v_so_nova
    from qs_settings where key = 'gloria_so_conversa_nova';
  select coalesce(nullif(value #>> '{}', ''), 'true')::boolean into v_so_pipeline
    from qs_settings where key = 'gloria_so_pipeline';

  select (c.execution_mode = 'ia') into v_no_pipeline
    from qs_cadences c where c.id = v_lead.cadence_id;
  v_no_pipeline := coalesce(v_no_pipeline, false);

  v_fone  := regexp_replace(coalesce(v_lead.phone, ''), '\D', '', 'g');
  v_ativa := coalesce(v_global, false);

  if not v_ativa then
    v_motivo := 'ia_desligada_no_qs_settings';
  elsif coalesce(v_so_pipeline, true) and not v_no_pipeline then
    -- A trava do sandbox. Lead que não está no pipeline da IA não é dela.
    v_ativa := false; v_motivo := 'fora_do_pipeline_da_ia';
  elsif coalesce(jsonb_array_length(v_piloto), 0) > 0
        and not (v_piloto ? v_lead.id::text)
        and not (v_piloto ? v_fone) then
    v_ativa := false; v_motivo := 'fora_do_piloto';
  elsif not coalesce(v_ses.ativa, true) then
    v_ativa := false; v_motivo := coalesce(v_ses.motivo, 'sessao_pausada');
  elsif v_lead.status in ('ganho', 'perdido') then
    v_ativa := false; v_motivo := 'lead_' || v_lead.status;
  elsif coalesce(v_so_nova, true)
        and v_ses.respondida_ate is null
        and p_modo = 'resposta'
        and exists (
          select 1 from qs_wa_messages m
           where m.lead_id = p_lead
             and m.direction = 'out'
             and coalesce(m.sender_name, '') <> 'Glória (IA)'
        ) then
    v_ativa := false; v_motivo := 'conversa_ja_tem_humano';
  end if;

  select can_reply into v_janela from qs_wa_threads where lead_id = p_lead;
  v_janela := coalesce(v_janela, true);

  select max(sent_at) into v_ult_saida   from qs_wa_messages where lead_id = p_lead and direction = 'out';
  select max(sent_at) into v_ult_entrada from qs_wa_messages where lead_id = p_lead and direction = 'in';

  v_corte := case
    when v_ses.respondida_ate is null then greatest(v_ult_saida, now() - interval '2 hours')
    else v_ses.respondida_ate
  end;

  select string_agg(t.content, E'\n' order by t.sent_at), max(t.sent_at)
    into v_pendentes, v_pend_ate
    from (
      select content, sent_at
        from qs_wa_messages
       where lead_id = p_lead and direction = 'in'
         and coalesce(content, '') <> ''
         and (v_corte is null or sent_at > v_corte)
       order by sent_at desc
       limit 10
    ) t;

  v_expedicao := substring(coalesce(v_lead.segment, '') from '\[([^\]]+)\]');

  -- ── O CATÁLOGO VIAJA JUNTO ────────────────────────────────────────────────
  -- Mesma fonte que o RAG já mantém. Só busca e entrega inteiro; ver cabeçalho.
  select content into v_catalogo
    from gloria_documents
   where metadata->>'slug' = 'agencia'
     and content ilike '%vagas abertas%'
   order by id desc
   limit 1;

  if p_modo = 'toque' then
    select * into v_passo from qs_gloria_passos
     where ativo and ordem = coalesce(nullif(p_passo, 0), coalesce(v_ses.toques, 0) + 1)
       and (cadencia_id is null or cadencia_id = v_lead.cadence_id)
     order by cadencia_id nulls last limit 1;

    v_pode := v_ativa
      and v_passo.id is not null
      and v_ult_entrada is not null
      and (v_ult_saida is null or v_ult_saida > v_ult_entrada)
      and (v_passo.tipo <> 'texto_ia' or now() - v_ult_entrada < interval '24 hours');

    if v_pode is not true and v_motivo is null then
      v_motivo := case
        when v_passo.id is null then 'cadencia_esgotada'
        when v_ult_entrada is null then 'lead_nunca_falou'
        when v_ult_saida is null or v_ult_saida <= v_ult_entrada then 'a_bola_esta_com_a_gente'
        else 'fora_da_janela_24h' end;
    end if;

    select string_agg(
             case when t.direction = 'in' then 'Cliente: ' else 'Você: ' end || t.content,
             E'\n' order by t.sent_at)
      into v_conversa
      from (
        select direction, content, sent_at
          from qs_wa_messages
         where lead_id = p_lead and coalesce(content, '') <> ''
         order by sent_at desc
         limit 6
      ) t;

    if v_passo.id is not null then
      v_toque := jsonb_build_object(
        'passo', v_passo.ordem,
        'tipo', v_passo.tipo,
        'instrucao', v_passo.instrucao,
        'template_nome', v_passo.template_nome,
        'silencio_min', case when v_ult_entrada is null then null
                             else floor(extract(epoch from (now() - v_ult_entrada)) / 60)::int end,
        'toques_ja_dados', coalesce(v_ses.toques, 0)
      );
    end if;
  else
    v_pode := v_ativa
      and coalesce(v_pendentes, '') <> ''
      and (p_sent_at is null or v_corte is null or v_corte < p_sent_at)
      and (p_sent_at is null or v_ult_entrada is null or v_ult_entrada <= p_sent_at);

    if v_pode and coalesce(v_ses.toques, 0) > 0 then
      update qs_gloria_sessoes set toques = 0 where lead_id = p_lead;
      v_ses.toques := 0;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'pode_responder', coalesce(v_pode, false),
    'motivo', coalesce(v_motivo,
      case when p_modo = 'toque' then 'ok'
           when coalesce(v_pendentes, '') = '' then 'sem_mensagem_pendente'
           when p_sent_at is not null and v_corte is not null and v_corte >= p_sent_at then 'ja_respondido'
           when p_sent_at is not null and v_ult_entrada is not null and v_ult_entrada > p_sent_at then 'chegou_mensagem_mais_nova'
           else 'ok' end),
    'ia_ativa', v_ativa,
    'no_pipeline', v_no_pipeline,
    'janela_aberta', v_janela,
    'mensagens', coalesce(v_pendentes, ''),
    'pendentes_ate', v_pend_ate,
    'toque', v_toque,
    'conversa', coalesce(v_conversa, ''),
    'catalogo', coalesce(v_catalogo, ''),
    'lead', jsonb_build_object(
      'id', v_lead.id,
      'nome', coalesce(
                nullif(trim(coalesce(v_lead.first_name,
                                     split_part(coalesce(v_lead.full_name, ''), ' ', 1))), ''),
                'tudo bem'),
      'nome_completo', v_lead.full_name,
      'telefone', v_fone,
      'expedicao', coalesce(nullif(v_expedicao, ''), 'nao informada'),
      'fonte', v_lead.segment,
      'bitrix_id', v_lead.bitrix_id,
      'owner_id', v_lead.owner_id,
      'status', v_lead.status
    ),
    'sessao', jsonb_build_object(
      'etapa', v_ses.etapa,
      'temperatura', v_ses.temperatura,
      'respondidas', v_ses.respondidas,
      'toques', coalesce(v_ses.toques, 0),
      'resposta_data', v_ses.resposta_data,
      'resposta_investimento', v_ses.resposta_investimento,
      'resposta_decisao', v_ses.resposta_decisao,
      'perfil_viajante', v_ses.perfil_viajante,
      'como_pretende_viajar', v_ses.como_pretende_viajar
    )
  );
end;
$ctx$;

grant execute on function public.qs_gloria_contexto(uuid, timestamptz, text, integer)
  to authenticated, service_role;
