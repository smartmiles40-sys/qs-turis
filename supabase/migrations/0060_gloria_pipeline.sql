-- 0060_gloria_pipeline.sql
-- ---------------------------------------------------------------------------
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New
--    query → cole este arquivo INTEIRO → Run. Pode rodar mais de uma vez.
--
-- Depende da 0053 e da 0059.
--
-- O QUE É ISTO
--
-- Duas coisas que andam juntas: o PIPELINE da Glória e a CADÊNCIA dela.
--
-- O PIPELINE é uma cadência de verdade do QS (`qs_cadences`), com
-- `execution_mode = 'ia'` — a coluna existe desde a 0001 e nunca tinha sido
-- usada. Um lead pertence ao atendimento por IA quando a cadência dele é essa.
-- Isso resolve três problemas de uma vez:
--
--   1. VIRA O SANDBOX. Enquanto você testa, só quem você colocar no pipeline é
--      atendido pela IA. Melhor que a lista de telefones do modo piloto, porque
--      é visível na tela, tem entrada e saída registradas, e o lead de teste
--      fica separado da operação real.
--   2. NÃO SUJA A FILA DO SDR. A cadência de IA nasce SEM dias e SEM atividades,
--      de propósito: nenhuma tarefa de humano é criada, então esses leads não
--      entram na fila do dia, não contam na métrica de toques e não empurram o
--      rodízio.
--   3. DÁ O ACOMPANHAMENTO. Com todo mundo na mesma cadência, dá para olhar o
--      funil da IA sozinho: quantos entraram, quantos responderam, quantos
--      qualificaram, quantos voltaram pro time e por quê.
--
-- A CADÊNCIA são os toques que ELA dá quando o lead some no meio da conversa.
-- Hoje a Glória só fala quando o lead fala: se ele para de responder depois de
-- "quanto custa?", a conversa morre ali e ninguém fica sabendo.
--
-- OS TRÊS TOQUES CABEM DENTRO DE 24 HORAS, E ISSO NÃO É ESCOLHA DE ESTILO.
-- Pelo número oficial, texto livre só é entregue se o cliente falou nas últimas
-- 24h; fora disso a Meta só aceita template aprovado — e template é decisão
-- comercial, não de IA. Então: +3h, +8h e +20h depois da última mensagem DELE.
-- Passou disso sem resposta, a conversa volta pro time com nota e tarefa.
-- (A tabela de passos já aceita `tipo = 'template'` para quando você quiser
-- estender a cadência para os dias seguintes.)
-- ---------------------------------------------------------------------------

-- ── (1) A cadência que representa o pipeline ────────────────────────────────
-- Sem dias e sem atividades DE PROPÓSITO: é o que garante que nenhum lead da
-- IA gere tarefa na fila de um humano.
insert into qs_cadences (name, description, acquisition_channel, objective,
                         execution_mode, priority, status, distribution_mode, offday_policy)
select 'Atendimento IA',
       'Pipeline da Glória. Quem está aqui é atendido pela IA: ela responde, qualifica e devolve pro time. Sem dias e sem atividades de propósito — nenhuma tarefa de SDR nasce daqui.',
       'levantada_de_mao', 'agendar_reuniao',
       'ia', 'media', 'disponivel', 'desabilitado', 'iniciar_imediato'
where not exists (select 1 from qs_cadences where execution_mode = 'ia');

-- ── (2) Os passos da cadência da IA ─────────────────────────────────────────
create table if not exists qs_gloria_passos (
  id             serial primary key,
  cadencia_id    uuid references qs_cadences(id) on delete cascade,  -- null = vale para qualquer cadência de IA
  ordem          int  not null,
  -- Minutos de SILÊNCIO do lead. Contados da última mensagem DELE, não do
  -- toque anterior: se ele responde e some de novo, a régua recomeça.
  atraso_min     int  not null,
  tipo           text not null default 'texto_ia' check (tipo in ('texto_ia','template')),
  -- O que ela deve tentar fazer neste toque. Vai pro prompt como instrução, não
  -- como texto pronto: mensagem decorada em cima de uma conversa real soa
  -- decorada, e o lead responde de acordo.
  instrucao      text not null,
  template_nome   text,
  template_idioma text default 'pt_BR',
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (cadencia_id, ordem)
);

insert into qs_gloria_passos (cadencia_id, ordem, atraso_min, tipo, instrucao)
select * from (values
  (null::uuid, 1, 180,  'texto_ia',
   'Primeiro toque, o lead sumiu há cerca de 3 horas. Retome exatamente de onde a conversa parou, com uma mensagem curta e leve. Se ficou uma pergunta sua no ar, repita ela de outro jeito. Não cobre resposta e não peça desculpa por incomodar.'),
  (null::uuid, 2, 480,  'texto_ia',
   'Segundo toque, o lead sumiu há cerca de 8 horas. Traga UMA informação nova e concreta da expedição de interesse (algo do roteiro, do que está incluso ou da experiência) que ajude a decisão, e termine com uma pergunta simples de sim ou não.'),
  (null::uuid, 3, 1200, 'texto_ia',
   'Terceiro e último toque, quase um dia de silêncio. Encerre com elegância: diga que fica à disposição, ofereça falar com um especialista do time quando ele quiser, e deixe claro que ele pode responder a qualquer momento. Não faça pergunta nova.')
) v
where not exists (select 1 from qs_gloria_passos);

alter table qs_gloria_passos enable row level security;
drop policy if exists gloria_passos_read on qs_gloria_passos;
create policy gloria_passos_read on qs_gloria_passos for select to authenticated using (true);

-- ── (3) O que a sessão precisa saber para tocar ─────────────────────────────
alter table qs_gloria_sessoes add column if not exists toques          int not null default 0;
alter table qs_gloria_sessoes add column if not exists ultimo_toque_em timestamptz;
alter table qs_gloria_sessoes add column if not exists entrou_em       timestamptz;

-- ── (4) Chaves de configuração ──────────────────────────────────────────────
insert into qs_settings(key, value) values
  -- A trava do sandbox: a IA só age em lead que está no pipeline dela.
  ('gloria_so_pipeline', 'true'::jsonb),
  -- Janela de horário dos toques (hora cheia, fuso de São Paulo). Quem escreveu
  -- às 23h não pode receber o toque de +3h às 2 da manhã.
  ('gloria_toque_inicio', '8'::jsonb),
  ('gloria_toque_fim',    '21'::jsonb)
on conflict (key) do nothing;

-- ── (5) "Posso responder?" agora entende dois modos ─────────────────────────
-- modo 'resposta' — o lead falou, ela responde (o de sempre).
-- modo 'toque'    — ninguém falou, ela puxa a conversa de volta (a cadência).
--
-- O DROP é obrigatório: acrescentar um parâmetro com valor padrão cria uma
-- SEGUNDA função com o mesmo nome, e aí toda chamada com dois argumentos morre
-- com "function is not unique".
drop function if exists qs_gloria_contexto(uuid, timestamptz);

create or replace function qs_gloria_contexto(
  p_lead    uuid,
  p_sent_at timestamptz default null,
  p_modo    text default 'resposta',
  -- Qual passo da cadência está sendo executado. Vem de quem chamou (o QS já
  -- carimbou o toque antes de mandar escrever, então contar toques+1 aqui
  -- daria o passo SEGUINTE — a IA executaria a instrução errada).
  p_passo   int  default null
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

  if p_modo = 'toque' then
    -- No toque não há mensagem nova para responder: o que autoriza é a bola
    -- estar com o lead (a última fala é NOSSA) e a janela de 24h ainda aberta.
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

    -- O fim da conversa vai junto: no toque não há mensagem pendente, e a
    -- memória do n8n vive na RAM (reiniciou, sumiu). Sem isto o follow-up sai
    -- genérico em cima de uma conversa que tinha assunto.
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

    -- O lead voltou a falar: a régua da cadência recomeça do zero. Sem isto,
    -- quem some, volta e some de novo já entraria direto no último toque.
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

-- A conta em si, separada para a janela de horário acima poder reaproveitá-la.
--
-- O PASSO DEVIDO É O MAIS ADIANTADO QUE JÁ VENCEU, e não o próximo da lista.
-- Parece detalhe e não é: o lead que some às 22h só pode ser tocado às 8h da
-- manhã, com 10 horas de silêncio. Pegando "o próximo", ele receberia o toque
-- de "+3h" — com a instrução errada — e ainda ficaria com dois toques
-- enfileirados no mesmo dia. Pegando o mais adiantado, ele recebe UM toque, o
-- certo para o tempo que passou.
create or replace function qs_gloria_fila_bruta()
returns table (
  lead_id uuid, nome text, telefone text, acao text,
  passo int, tipo text, instrucao text, silencio_min int, motivo text
)
language sql stable security definer
set search_path = public
as $bruta$
  with vivos as (
    select
      s.lead_id, s.toques, s.ultimo_toque_em, l.phone, l.first_name, l.full_name, l.cadence_id,
      (select max(m.sent_at) from qs_wa_messages m where m.lead_id = s.lead_id and m.direction = 'in')  as ult_in,
      (select max(m.sent_at) from qs_wa_messages m where m.lead_id = s.lead_id and m.direction = 'out') as ult_out
    from qs_gloria_sessoes s
    join qs_leads l    on l.id = s.lead_id
    join qs_cadences c on c.id = l.cadence_id and c.execution_mode = 'ia'
    where s.ativa
      and s.etapa <> 'transferida'
      and l.status not in ('ganho', 'perdido')
  ),
  -- A bola precisa estar com o LEAD: a última fala é nossa e ele não respondeu.
  parados as (
    select v.*, floor(extract(epoch from (now() - v.ult_in)) / 60)::int as silencio
      from vivos v
     where v.ult_in is not null
       and v.ult_out is not null
       and v.ult_out > v.ult_in
  )
  select
    p.lead_id,
    coalesce(nullif(trim(p.first_name), ''),
             nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'lead') as nome,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') as telefone,
    case when devido.id is not null and p.silencio < 24 * 60 then 'tocar' else 'devolver' end as acao,
    devido.ordem     as passo,
    devido.tipo      as tipo,
    devido.instrucao as instrucao,
    p.silencio       as silencio_min,
    case
      when devido.id is not null and p.silencio < 24 * 60 then 'toque_' || devido.ordem::text
      when p.silencio >= 24 * 60                          then 'janela_de_24h_fechou'
      else 'cadencia_esgotada'
    end as motivo
  from parados p
  -- O passo mais adiantado que já venceu e que ainda não foi dado.
  left join lateral (
    select x.id, x.ordem, x.tipo, x.instrucao
      from qs_gloria_passos x
     where x.ativo
       and x.ordem > coalesce(p.toques, 0)
       and x.atraso_min <= p.silencio
       and (x.cadencia_id is null or x.cadencia_id = p.cadence_id)
     order by x.ordem desc
     limit 1
  ) devido on true
  -- Ainda resta algum passo pela frente? (mesmo que não tenha vencido)
  left join lateral (
    select 1 as tem
      from qs_gloria_passos x
     where x.ativo
       and x.ordem > coalesce(p.toques, 0)
       and (x.cadencia_id is null or x.cadencia_id = p.cadence_id)
     limit 1
  ) resta on true
  where
    -- TOCAR: venceu um passo, a janela está aberta e não tocamos agora há pouco.
    (
      devido.id is not null
      and p.silencio < 24 * 60
      and (p.ultimo_toque_em is null or p.ultimo_toque_em < now() - interval '30 minutes')
    )
    -- DEVOLVER: a janela de 24h fechou com a bola com ele, ou a cadência acabou.
    or p.silencio >= 24 * 60
    or (resta.tem is null and p.silencio >= 60)
  order by p.silencio desc;
$bruta$;

-- ── (6) Quem está devendo um toque agora ────────────────────────────────────
-- Uma consulta só, respondendo duas perguntas: quem eu toco, e quem eu devolvo
-- pro time. Quem chama é o QS (api/gloria-toques.js), que roda de carona no
-- tráfego — sem agendador externo, porque agendador externo já morreu calado
-- por dois dias nesta casa (o vigia, em 17/08).
create or replace function qs_gloria_fila_de_toques(p_limite int default 20)
returns table (
  lead_id      uuid,
  nome         text,
  telefone     text,
  acao         text,     -- 'tocar' | 'devolver'
  passo        int,
  tipo         text,
  instrucao    text,
  silencio_min int,
  motivo       text
)
language plpgsql volatile security definer
set search_path = public
as $fila$
declare
  v_ligada boolean;
  v_ini    int;
  v_fim    int;
  v_hora   int;
begin
  select coalesce(nullif(value #>> '{}', ''), 'false')::boolean into v_ligada
    from qs_settings where key = 'gloria_ativa';
  if not coalesce(v_ligada, false) then return; end if;

  select coalesce((value #>> '{}')::int, 8)  into v_ini from qs_settings where key = 'gloria_toque_inicio';
  select coalesce((value #>> '{}')::int, 21) into v_fim from qs_settings where key = 'gloria_toque_fim';
  v_hora := extract(hour from timezone('America/Sao_Paulo', now()))::int;

  -- Fora da janela de horário ninguém é tocado. Quem venceu continua vencido e
  -- é tocado quando abrir — a menos que a janela de 24h feche antes, e aí ele
  -- entra como 'devolver', que é o certo: quem some de noite vira trabalho de
  -- gente pela manhã.
  if v_hora < coalesce(v_ini, 8) or v_hora >= coalesce(v_fim, 21) then
    return query
    select f.lead_id, f.nome, f.telefone, f.acao, f.passo, f.tipo, f.instrucao, f.silencio_min, f.motivo
      from qs_gloria_fila_bruta() f
     where f.acao = 'devolver'
     limit greatest(coalesce(p_limite, 20), 1);
    return;
  end if;

  return query
  select f.lead_id, f.nome, f.telefone, f.acao, f.passo, f.tipo, f.instrucao, f.silencio_min, f.motivo
    from qs_gloria_fila_bruta() f
   limit greatest(coalesce(p_limite, 20), 1);
end;
$fila$;

-- ── (7) Carimbar o toque ────────────────────────────────────────────────────
-- Chamado pelo QS ANTES de mandar o n8n escrever. É de propósito: se o carimbo
-- viesse depois do envio, uma falha no meio faria a fila tentar o mesmo lead a
-- cada rodada, para sempre. Perder um toque é chato; martelar o mesmo lead de
-- 10 em 10 minutos é o tipo de erro que o cliente vê.
create or replace function qs_gloria_marcar_toque(p_lead uuid, p_passo int)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $mt$
declare v_toques int;
begin
  update qs_gloria_sessoes
     set toques = greatest(coalesce(toques, 0) + 1, coalesce(p_passo, 1)),
         ultimo_toque_em = now()
   where lead_id = p_lead
  returning toques into v_toques;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo, payload)
  values (p_lead, 'evento', 'toque ' || coalesce(p_passo, v_toques)::text || ' da cadência da IA',
          'cadencia_ia', jsonb_build_object('passo', p_passo));

  return jsonb_build_object('ok', true, 'toques', v_toques);
end;
$mt$;

-- ── (8) Entrar e sair do pipeline ───────────────────────────────────────────
-- Entrar é uma decisão explícita (um botão, um webhook), então ela PODE encerrar
-- as atividades pendentes do plano humano — é exatamente o que se está pedindo
-- ao mover o lead. O que ela não faz é atropelar reunião marcada nem lead ganho.
create or replace function qs_gloria_entrar_no_pipeline(p_lead uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $ep$
declare
  v_lead    qs_leads%rowtype;
  v_cad     uuid;
  v_fechou  int := 0;
begin
  -- Quem chama pela tela é uma pessoa logada: vale a mesma regra de sempre —
  -- quem enxerga o lead pode mexer nele. Chamada por dentro (service_role, as
  -- rotas do QS) não tem auth.uid() e passa direto.
  if auth.uid() is not null and not qs_owns_lead(p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lead from qs_leads where id = p_lead;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente'); end if;
  if v_lead.status = 'ganho' then return jsonb_build_object('ok', false, 'motivo', 'lead_ganho'); end if;

  if exists (select 1 from qs_meetings
              where lead_id = p_lead and status in ('agendada')
                and scheduled_at >= now()) then
    return jsonb_build_object('ok', false, 'motivo', 'tem_reuniao_marcada');
  end if;

  select id into v_cad from qs_cadences where execution_mode = 'ia' and status <> 'congelada'
   order by created_at asc limit 1;
  if v_cad is null then return jsonb_build_object('ok', false, 'motivo', 'sem_cadencia_de_ia'); end if;

  update qs_tasks
     set status = 'ignorada',
         skip_reason = 'Lead entrou no atendimento por IA'
   where lead_id = p_lead and status in ('pendente', 'atrasada');
  get diagnostics v_fechou = row_count;

  update qs_leads
     set cadence_id = v_cad,
         cadence_started_at = now(),
         status = case when status = 'nao_iniciado' then 'em_prospeccao' else status end
   where id = p_lead;

  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;
  update qs_gloria_sessoes
     set ativa = true, motivo = null, pausada_em = null,
         toques = 0, ultimo_toque_em = null,
         entrou_em = coalesce(entrou_em, now())
   where lead_id = p_lead;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo, payload)
  values (p_lead, 'evento', 'entrou no pipeline de atendimento por IA', 'entrou_no_pipeline',
          jsonb_build_object('tarefas_encerradas', v_fechou));

  return jsonb_build_object('ok', true, 'lead_id', p_lead, 'cadencia_id', v_cad, 'tarefas_encerradas', v_fechou);
end;
$ep$;

-- Sair é só devolver o lead pra uma cadência humana (ou nenhuma). NÃO cria
-- tarefa: quem faz isso é a rota gloria-transferir, que já sabe escrever a nota
-- com o resumo e a qualificação.
create or replace function qs_gloria_tirar_do_pipeline(p_lead uuid, p_cadencia uuid default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $sp$
begin
  -- Quem chama pela tela é uma pessoa logada: vale a mesma regra de sempre —
  -- quem enxerga o lead pode mexer nele. Chamada por dentro (service_role, as
  -- rotas do QS) não tem auth.uid() e passa direto.
  if auth.uid() is not null and not qs_owns_lead(p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update qs_leads
     set cadence_id = p_cadencia,
         cadence_started_at = case when p_cadencia is null then cadence_started_at else now() end
   where id = p_lead;

  update qs_gloria_sessoes
     set ativa = false,
         motivo = coalesce(motivo, 'saiu_do_pipeline'),
         pausada_em = coalesce(pausada_em, now())
   where lead_id = p_lead;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo)
  values (p_lead, 'evento', 'saiu do pipeline de atendimento por IA', 'saiu_do_pipeline');

  return jsonb_build_object('ok', true, 'lead_id', p_lead);
end;
$sp$;

-- ── (9) O funil, do jeito que a tela lê ─────────────────────────────────────
-- `security_invoker` para a RLS continuar valendo: quem enxerga o lead enxerga
-- a linha dele aqui, e ninguém enxerga mais do que já enxergava.
drop view if exists qs_gloria_pipeline;
create view qs_gloria_pipeline
with (security_invoker = true) as
select
  s.lead_id,
  l.full_name,
  coalesce(nullif(trim(l.first_name), ''),
           nullif(split_part(coalesce(l.full_name, ''), ' ', 1), ''), 'lead') as nome,
  l.phone,
  l.segment                                                    as fonte,
  substring(coalesce(l.segment, '') from '\[([^\]]+)\]')       as expedicao,
  l.owner_id,
  u.name                                                       as dono,
  (c.execution_mode = 'ia')                                    as no_pipeline,
  c.name                                                       as cadencia,
  s.ativa, s.etapa, s.motivo, s.temperatura, s.respondidas, s.toques,
  s.resumo, s.ultimo_toque_em, s.entrou_em, s.criada_em, s.atualizada_em,
  s.qualificada_em, s.transferida_em,
  m.ult_in, m.ult_out,
  greatest(m.ult_in, m.ult_out)                                as ultima_mensagem,
  floor(extract(epoch from (now() - greatest(m.ult_in, m.ult_out))) / 60)::int as parado_min,
  -- A coluna do quadro. É derivada, nunca gravada: estado guardado em dois
  -- lugares é estado que diverge.
  case
    -- O motivo vem ANTES da etapa: quem termina a cadência sem resposta também
    -- é marcado como transferida (a nota e a tarefa nascem igual), e olhando só
    -- a etapa a coluna "Sem resposta" ficaria eternamente vazia.
    when s.motivo = 'sem_resposta'                     then 'sem_resposta'
    when s.etapa = 'transferida'                       then 'transferida'
    when not s.ativa                                   then 'com_o_time'
    when s.etapa = 'qualificada'                       then 'qualificada'
    when coalesce(s.toques, 0) > 0
         and m.ult_out is not null
         and (m.ult_in is null or m.ult_out > m.ult_in) then 'em_follow_up'
    when coalesce(s.respondidas, 0) > 0                then 'qualificando'
    else 'nova'
  end as coluna
from qs_gloria_sessoes s
join qs_leads l    on l.id = s.lead_id
left join qs_cadences c on c.id = l.cadence_id
left join qs_users u    on u.id = l.owner_id
left join lateral (
  select
    max(sent_at) filter (where direction = 'in')  as ult_in,
    max(sent_at) filter (where direction = 'out') as ult_out
  from qs_wa_messages where lead_id = s.lead_id
) m on true;


-- ── (10) Quem pode chamar o quê ─────────────────────────────────────────────
-- A fila e o carimbo do toque são coisa de servidor: quem chama é o QS com a
-- chave de serviço. Deixá-los abertos ao navegador seria dar a qualquer pessoa
-- logada o poder de disparar mensagem pro cliente.
revoke execute on function qs_gloria_fila_de_toques(int)      from public, anon, authenticated;
revoke execute on function qs_gloria_fila_bruta()             from public, anon, authenticated;
revoke execute on function qs_gloria_marcar_toque(uuid, int)  from public, anon, authenticated;
grant  execute on function qs_gloria_fila_de_toques(int)      to service_role;
grant  execute on function qs_gloria_fila_bruta()             to service_role;
grant  execute on function qs_gloria_marcar_toque(uuid, int)  to service_role;

-- Estas duas SÃO da tela (o botão "colocar no pipeline"), e por isso carregam
-- a checagem de posse lá dentro.
grant  execute on function qs_gloria_entrar_no_pipeline(uuid)        to authenticated, service_role;
grant  execute on function qs_gloria_tirar_do_pipeline(uuid, uuid)   to authenticated, service_role;

-- ── (11) Conferência ────────────────────────────────────────────────────────
--
--   -- o funil da IA, agora:
--   select coluna, count(*) from qs_gloria_pipeline where no_pipeline group by 1 order by 2 desc;
--
--   -- quem está devendo um toque neste instante:
--   select * from qs_gloria_fila_de_toques(20);
--
--   -- colocar um lead de teste no pipeline:
--   select qs_gloria_entrar_no_pipeline('<uuid-do-lead>');
--
--   -- os passos da cadência:
--   select ordem, atraso_min, tipo, left(instrucao, 60) from qs_gloria_passos order by ordem;
