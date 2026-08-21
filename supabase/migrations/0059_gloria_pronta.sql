-- 0059_gloria_pronta.sql
-- ---------------------------------------------------------------------------
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New
--    query → cole este arquivo INTEIRO → Run. Pode rodar mais de uma vez.
--
-- Depende da 0053 (Glória) já estar aplicada.
--
-- O QUE É ISTO
--
-- Os três ajustes que faltavam para a Glória poder ser ligada com gente de
-- verdade do outro lado. Cada um nasceu de um jeito específico de dar errado:
--
-- (1) gloria_fontes — DE ONDE SAI O QUE ELA SABE
--     A 0053 assumia que a base de conhecimento viria do site: baixar cada LP
--     e guardar o texto. As LPs são React e o HTML que o servidor entrega é uma
--     casca vazia — medido em 21/08, as 11 páginas do sitemap devolvem ~40
--     caracteres cada, sem preço, sem data, sem roteiro. A carga marcaria todas
--     como "página curta demais" e a Glória atenderia sabendo nada.
--     Agora o conteúdo é escrito a partir dos DADOS das LPs
--     (scripts/gloria-fichas.mjs) e mora aqui, em texto que dá pra ler e
--     corrigir à mão. O n8n lê daqui e transforma em embedding.
--
-- (2) A IA não entra em conversa que já tem gente do time dentro
--     Sem isto, no minuto em que a chave for ligada, TODO cliente que responder
--     uma SDR ganha a Glória por cima — inclusive negociações em andamento. A
--     trava da 0053 ("humano respondeu, ela cala") só vale depois que a IA já
--     está naquela conversa; esta impede que ela comece.
--
-- (3) O eco dela mesma deixa de ser confundido com um humano
--     A resposta sai pro Chatwoot com "*Glória*" na primeira linha, mas o log
--     guarda o texto sem esse prefixo. Quando o webhook do Chatwoot devolvia a
--     mensagem antes de a nossa gravação acontecer, o gatilho comparava textos
--     diferentes, concluía "humano assumiu" e a IA se desligava sozinha no meio
--     da própria resposta — em silêncio, sem tarefa pra ninguém.
-- ---------------------------------------------------------------------------

-- ── (1) A fonte do que a Glória sabe ────────────────────────────────────────
-- Uma linha por SEÇÃO de uma página (resumo, investimento, incluso, roteiro,
-- FAQ...), e não uma por página inteira. O pedaço que a busca devolve chega
-- sozinho no prompt: uma seção fechada se explica, um pedaço cortado no meio
-- de uma página não diz nem de qual expedição está falando — e é assim que a
-- IA responde o preço da viagem errada com toda a confiança do mundo.
create table if not exists gloria_fontes (
  id            bigserial primary key,
  slug          text not null,              -- islandia, atacama, agencia...
  secao         text not null,              -- resumo, investimento, roteiro...
  titulo        text not null,
  url           text,                       -- a página oficial daquele conteúdo
  conteudo      text not null,
  ativo         boolean not null default true,
  atualizada_em timestamptz not null default now(),
  criada_em     timestamptz not null default now(),
  unique (slug, secao)
);

create index if not exists idx_gloria_fontes_ativo on gloria_fontes(ativo, slug);

-- Quem enxerga: qualquer pessoa logada pode CONFERIR o que a IA sabe (e é bom
-- que possa — é assim que um erro de preço é achado antes do cliente achar).
-- Escrita é do service_role: o script e o n8n, que passam por cima da RLS.
alter table gloria_fontes enable row level security;
drop policy if exists gloria_fontes_read on gloria_fontes;
create policy gloria_fontes_read on gloria_fontes for select to authenticated using (true);

-- ── (2) A IA não começa conversa que já tem gente do time dentro ────────────
--
-- ⚠️ A 0060 SUBSTITUI a `qs_gloria_contexto` que está logo abaixo (ela ganha
-- dois parâmetros: o modo e o passo da cadência). Se você rodar ESTE arquivo de
-- novo depois da 0060, rode a 0060 em seguida — senão sobram duas versões da
-- mesma função e toda chamada morre com "function is not unique".
insert into qs_settings(key, value) values ('gloria_so_conversa_nova', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function qs_gloria_contexto(
  p_lead    uuid,
  p_sent_at timestamptz default null
)
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
begin
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

  v_fone  := regexp_replace(coalesce(v_lead.phone, ''), '\D', '', 'g');
  v_ativa := coalesce(v_global, false);

  if not v_ativa then
    v_motivo := 'ia_desligada_no_qs_settings';
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
        and exists (
          select 1 from qs_wa_messages m
           where m.lead_id = p_lead
             and m.direction = 'out'
             and coalesce(m.sender_name, '') <> 'Glória (IA)'
        ) then
    -- Esta seria a PRIMEIRA fala da Glória neste lead, mas alguém do time já
    -- falou aqui antes. Conversa começada por gente termina com gente: a IA
    -- entrando no meio atropela quem estava negociando, e o cliente vê duas
    -- vozes com dois tons. Vale só para a primeira fala — depois que ela já
    -- está na conversa, quem manda é o gatilho da 0053.
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

  return jsonb_build_object(
    'ok', true,
    'pode_responder',
      v_ativa
      and coalesce(v_pendentes, '') <> ''
      and (p_sent_at is null or v_corte is null or v_corte < p_sent_at)
      and (p_sent_at is null or v_ult_entrada is null or v_ult_entrada <= p_sent_at),
    'motivo', coalesce(v_motivo,
      case when coalesce(v_pendentes, '') = '' then 'sem_mensagem_pendente'
           when p_sent_at is not null and v_corte is not null and v_corte >= p_sent_at then 'ja_respondido'
           when p_sent_at is not null and v_ult_entrada is not null and v_ult_entrada > p_sent_at then 'chegou_mensagem_mais_nova'
           else 'ok' end),
    'ia_ativa', v_ativa,
    'janela_aberta', v_janela,
    'mensagens', coalesce(v_pendentes, ''),
    'pendentes_ate', v_pend_ate,
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
      'resposta_data', v_ses.resposta_data,
      'resposta_investimento', v_ses.resposta_investimento,
      'resposta_decisao', v_ses.resposta_decisao,
      'perfil_viajante', v_ses.perfil_viajante,
      'como_pretende_viajar', v_ses.como_pretende_viajar
    )
  );
end;
$ctx$;

-- ── (3) O eco dela mesma não é "humano assumiu" ─────────────────────────────
-- Mesma função da 0053, com uma diferença: antes de comparar, tira a
-- assinatura "*Glória*" da primeira linha. O QS manda a mensagem assinada e
-- registra no log sem assinatura — comparar os dois crus fazia a IA se
-- desligar sozinha quando o webhook do Chatwoot chegava primeiro.
create or replace function qs_gloria_humano_assumiu()
returns trigger
language plpgsql security definer
set search_path = public
as $hm$
declare
  v_texto text;
begin
  if new.direction <> 'out' then return new; end if;
  if not exists (select 1 from qs_gloria_sessoes where lead_id = new.lead_id and ativa) then
    return new;
  end if;
  if coalesce(new.sender_name, '') = 'Glória (IA)' then return new; end if;

  -- "*Glória*\nOi Ana, ..." → "Oi Ana, ..."
  v_texto := regexp_replace(coalesce(new.content, ''), '^\*[^\n\*]+\*\s*\n+', '');

  if exists (
    select 1 from qs_gloria_log l
     where l.lead_id = new.lead_id and l.direcao = 'out'
       and l.criado_em > now() - interval '10 minutes'
       and left(coalesce(l.conteudo, ''), 120) = left(v_texto, 120)
  ) then
    return new;
  end if;

  update qs_gloria_sessoes
     set ativa = false, motivo = 'humano assumiu a conversa', pausada_em = now()
   where lead_id = new.lead_id;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo)
  values (new.lead_id, 'evento',
          coalesce(new.sender_name, 'alguém do time') || ' respondeu — IA desligada nesta conversa',
          'humano_assumiu');
  return new;
end;
$hm$;

drop trigger if exists trg_qs_gloria_humano on qs_wa_messages;
create trigger trg_qs_gloria_humano after insert on qs_wa_messages
  for each row execute function qs_gloria_humano_assumiu();

-- ── (4) Conferência ─────────────────────────────────────────────────────────
-- Depois de rodar isto, o painel da Glória em uma consulta só:
--
--   select
--     (select count(*) from gloria_fontes where ativo)                      as fichas,
--     (select count(*) from gloria_documents)                               as pedacos_com_embedding,
--     (select value #>> '{}' from qs_settings where key = 'gloria_ativa')   as ligada,
--     (select value::text  from qs_settings where key = 'gloria_leads_piloto') as piloto,
--     (select value #>> '{}' from qs_settings where key = 'gloria_so_conversa_nova') as so_conversa_nova;
--
-- fichas = 0  → rode: node scripts/gloria-fichas.mjs --apply
-- pedacos = 0 → rode o workflow "Glória — carregar a base de conhecimento"
