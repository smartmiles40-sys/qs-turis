-- 0053_gloria_ia.sql
-- ---------------------------------------------------------------------------
-- ⚠️ COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) → SQL Editor → New
--    query → cole este arquivo INTEIRO → Run. Pode rodar mais de uma vez.
--
-- O QUE É ISTO
--
-- A base da Glória, a atendente de IA que fala com o lead no WhatsApp antes do
-- SDR. Ela mora no n8n (workflow `gloria-atendimento`), mas o CÉREBRO DELA É
-- ESTE BANCO — o mesmo do QS, de propósito: quem responde precisa enxergar a
-- mesma conversa que o SDR enxerga, senão os dois falam com a pessoa ao mesmo
-- tempo dizendo coisas diferentes.
--
-- O que entra aqui:
--
--   gloria_documents        o conteúdo do site picado em pedaços + embedding.
--                           É daqui que sai roteiro, data e valor. Sem isto a
--                           IA inventa preço — o pior erro possível.
--   gloria_chat_memory      o histórico curto da conversa (o n8n escreve).
--   qs_gloria_sessoes       o INTERRUPTOR por lead: a IA está ligada nesta
--                           conversa? já qualificou? o que ela já sabe?
--   qs_gloria_log           tudo que ela mandou e todo evento (auditoria).
--
-- E três funções que o n8n chama:
--
--   qs_gloria_contexto()    "posso responder este lead agora?" — devolve num
--                           JSON só a resposta e tudo que ela precisa saber.
--   qs_gloria_salvar()      grava as respostas de qualificação.
--   qs_gloria_pausar()      desliga a IA nesta conversa (transferiu, ou humano
--                           assumiu).
--
-- AS TRÊS TRAVAS (o motivo de a lógica morar no banco, e não no n8n)
--
-- 1. A IA nasce DESLIGADA. `qs_settings.gloria_ativa` = false. Ligar é um
--    UPDATE, não um deploy. E `gloria_leads_piloto` deixa ligar só para uma
--    lista de telefones enquanto você testa com gente de verdade.
-- 2. Humano respondeu, IA cala a boca. O gatilho abaixo pausa a sessão no
--    instante em que sai uma mensagem NOSSA que não foi ela. Não depende de
--    ninguém lembrar de desligar nada.
-- 3. Nunca responde duas vezes. Se já saiu qualquer mensagem nossa DEPOIS da
--    fala do lead, `qs_gloria_contexto` devolve pode_responder = false. É o
--    que segura a corrida de quando o lead manda três mensagens seguidas e o
--    webhook dispara três execuções.
-- ---------------------------------------------------------------------------

-- ── (0) pgvector ────────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── (1) Base de conhecimento (RAG) ──────────────────────────────────────────
-- Prefixo `gloria_` de propósito: esta tabela não é do CRM, é da IA. Misturar
-- com as qs_* faria a próxima pessoa procurar lead aqui dentro.
create table if not exists gloria_documents (
  id         bigserial primary key,
  content    text,
  metadata   jsonb not null default '{}'::jsonb,
  embedding  vector(1536),
  created_at timestamptz not null default now()
);

-- 1536 = text-embedding-3-small (o modelo que o workflow usa). Trocar de
-- modelo obriga a recriar a coluna E reindexar tudo: dimensão diferente não
-- compara com o que já está gravado.

-- Índice de similaridade. HNSW é melhor, mas só existe no pgvector >= 0.5 — se
-- este projeto estiver numa versão antiga, cai no ivfflat em vez de derrubar a
-- migration inteira.
do $ix$
begin
  begin
    create index if not exists idx_gloria_documents_embedding
      on gloria_documents using hnsw (embedding vector_cosine_ops);
  exception when others then
    create index if not exists idx_gloria_documents_embedding
      on gloria_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
  end;
end
$ix$;

create index if not exists idx_gloria_documents_metadata
  on gloria_documents using gin (metadata);

-- A busca que o n8n chama. A assinatura é a que o nó "Supabase Vector Store"
-- espera (query_embedding, match_count, filter) — mudar a ordem quebra o nó.
create or replace function match_gloria_documents(
  query_embedding vector(1536),
  match_count     int   default 5,
  filter          jsonb default '{}'::jsonb
)
returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable
set search_path = public
as $fn$
  select d.id, d.content, d.metadata,
         1 - (d.embedding <=> query_embedding) as similarity
  from gloria_documents d
  where d.metadata @> coalesce(filter, '{}'::jsonb)
    and d.embedding is not null
  order by d.embedding <=> query_embedding
  -- coalesce: o nó às vezes manda match_count nulo, e `limit null` traria a
  -- base inteira pro prompt (caro, e responde pior).
  limit greatest(coalesce(match_count, 5), 1);
$fn$;

-- ── (2) Memória da conversa (o n8n escreve, ninguém mais) ───────────────────
-- Colunas exatamente como o nó "Postgres Chat Memory" cria. Criamos aqui só
-- para poder ligar RLS e índice antes da primeira mensagem.
create table if not exists gloria_chat_memory (
  id         serial primary key,
  session_id varchar not null,
  message    jsonb not null
);
create index if not exists idx_gloria_chat_memory_sessao
  on gloria_chat_memory(session_id, id desc);

-- ── (3) O interruptor por lead ──────────────────────────────────────────────
create table if not exists qs_gloria_sessoes (
  lead_id                uuid primary key references qs_leads(id) on delete cascade,
  ativa                  boolean not null default true,
  motivo                 text,            -- por que foi pausada
  etapa                  text not null default 'abertura'
                         check (etapa in ('abertura','qualificando','qualificada','transferida')),
  temperatura            text check (temperatura in ('Quente','Morno','Frio')),
  -- As 5 perguntas oficiais. Ficam aqui, não no Bitrix: o Bitrix é destino, não
  -- fonte. Se ele estiver fora do ar, a qualificação não pode se perder.
  resposta_data          text,
  resposta_investimento  text,
  resposta_decisao       text,
  perfil_viajante        text,
  como_pretende_viajar   text,
  resumo                 text,
  respondidas            int  not null default 0,
  -- Até onde da conversa a IA já leu. NÃO é "quando ela respondeu": é o
  -- horário da última mensagem do lead que entrou no prompt.
  --
  -- Existe por causa de uma mensagem que se perdia: o lead escreve enquanto a
  -- IA está pensando (são 10 a 40 segundos). Aquela mensagem chegou tarde
  -- demais pra entrar na resposta que está saindo, e a execução dela para
  -- sozinha, porque já respondemos depois. Sem esta coluna ninguém nunca mais
  -- olharia pra ela — a próxima rodada só pega o que veio depois da NOSSA
  -- resposta. Com ela, a mensagem fica pendente e entra na resposta seguinte.
  respondida_ate         timestamptz,
  qualificada_em         timestamptz,
  transferida_em         timestamptz,
  pausada_em             timestamptz,
  criada_em              timestamptz not null default now(),
  atualizada_em          timestamptz not null default now()
);
create index if not exists idx_qs_gloria_sessoes_ativa
  on qs_gloria_sessoes(ativa, atualizada_em desc);

-- Se a tabela já existia de uma colagem anterior, o `create table if not
-- exists` acima não acrescenta coluna nenhuma — e o resto do arquivo depende
-- desta aqui.
alter table qs_gloria_sessoes add column if not exists respondida_ate timestamptz;

-- A coluna aqui chama `atualizada_em`; o gatilho padrão do QS mexe em
-- `updated_at`. Em vez de renomear (e destoar do resto), um gatilho próprio.
create or replace function qs_gloria_touch()
returns trigger language plpgsql as $tc$
begin new.atualizada_em := now(); return new; end;
$tc$;

drop trigger if exists trg_qs_gloria_sessoes_touch on qs_gloria_sessoes;
create trigger trg_qs_gloria_sessoes_touch before update on qs_gloria_sessoes
  for each row execute function qs_gloria_touch();

-- ── (4) Log ─────────────────────────────────────────────────────────────────
create table if not exists qs_gloria_log (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid references qs_leads(id) on delete cascade,
  direcao   text not null check (direcao in ('in','out','evento','erro')),
  conteudo  text,
  motivo    text,
  payload   jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_qs_gloria_log_lead on qs_gloria_log(lead_id, criado_em desc);

-- ── (5) Chaves de configuração ──────────────────────────────────────────────
-- DESLIGADA por padrão. Ligar depois de testar:
--   update qs_settings set value = 'true'::jsonb where key = 'gloria_ativa';
insert into qs_settings(key, value) values
  ('gloria_ativa', 'false'::jsonb),
  -- Modo piloto: lista VAZIA = a IA vale para todo lead (respeitando a chave
  -- acima). Com telefones dentro, só eles são atendidos por ela — é assim que
  -- se testa com gente de verdade sem arriscar a base inteira.
  --   update qs_settings set value = '["5562999990001"]'::jsonb
  --    where key = 'gloria_leads_piloto';
  ('gloria_leads_piloto', '[]'::jsonb)
on conflict (key) do nothing;

-- ── (6) "Posso responder este lead agora?" ──────────────────────────────────
-- Uma chamada só, um JSON só. Tudo que decide se a IA fala mora AQUI, não no
-- n8n: assim a regra vale igual para qualquer coisa que venha a chamar a
-- Glória depois (outro workflow, um botão no QS, um teste manual).
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

  -- Cria a sessão na primeira mensagem. `on conflict do nothing` porque duas
  -- execuções simultâneas (o lead mandou 3 mensagens) chegam aqui juntas.
  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;
  select * into v_ses from qs_gloria_sessoes where lead_id = p_lead;

  select coalesce(nullif(value #>> '{}', ''), 'false')::boolean into v_global
    from qs_settings where key = 'gloria_ativa';
  select coalesce(value, '[]'::jsonb) into v_piloto
    from qs_settings where key = 'gloria_leads_piloto';

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
  end if;

  -- Janela de 24h da Meta: quem manda é o can_reply que o Chatwoot informa.
  select can_reply into v_janela from qs_wa_threads where lead_id = p_lead;
  v_janela := coalesce(v_janela, true);

  select max(sent_at) into v_ult_saida   from qs_wa_messages where lead_id = p_lead and direction = 'out';
  select max(sent_at) into v_ult_entrada from qs_wa_messages where lead_id = p_lead and direction = 'in';

  -- O CORTE: tudo que o lead escreveu depois disto ainda não foi respondido.
  --
  -- Primeira rodada desta sessão (respondida_ate nulo): não fazemos ideia do
  -- que já foi tratado, então o corte é a nossa última resposta — e no máximo
  -- 2 horas atrás. Sem esse teto, ligar a IA faria ela responder de uma vez a
  -- conversa de três semanas atrás como se fosse tudo novidade.
  --
  -- Das próximas em diante manda o respondida_ate, que é o que a IA REALMENTE
  -- leu. É o que segura a mensagem que chegou enquanto ela pensava: nossa
  -- última resposta é mais nova que essa mensagem, mas a IA não a leu, então
  -- ela continua pendente em vez de sumir.
  v_corte := case
    when v_ses.respondida_ate is null then greatest(v_ult_saida, now() - interval '2 hours')
    else v_ses.respondida_ate
  end;

  -- É isto que resolve o "oi" + "quero saber da Islândia" + "quanto custa?" em
  -- três balões: a IA lê os três de uma vez e responde uma vez só.
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

  -- A expedição vem da Fonte do card ("[Islândia] - Tráfego" → Islândia).
  v_expedicao := substring(coalesce(v_lead.segment, '') from '\[([^\]]+)\]');

  return jsonb_build_object(
    'ok', true,
    -- A conta que o n8n obedece sem pensar:
    'pode_responder',
      v_ativa
      and coalesce(v_pendentes, '') <> ''
      -- esta mensagem já entrou numa resposta que saiu → outra execução cuidou
      and (p_sent_at is null or v_corte is null or v_corte < p_sent_at)
      -- chegou mensagem mais nova → quem responde é a execução dela, não esta
      and (p_sent_at is null or v_ult_entrada is null or v_ult_entrada <= p_sent_at),
    'motivo', coalesce(v_motivo,
      case when coalesce(v_pendentes, '') = '' then 'sem_mensagem_pendente'
           when p_sent_at is not null and v_corte is not null and v_corte >= p_sent_at then 'ja_respondido'
           when p_sent_at is not null and v_ult_entrada is not null and v_ult_entrada > p_sent_at then 'chegou_mensagem_mais_nova'
           else 'ok' end),
    'ia_ativa', v_ativa,
    'janela_aberta', v_janela,
    'mensagens', coalesce(v_pendentes, ''),
    -- O n8n devolve isto pro QS junto com a resposta, e o QS grava em
    -- respondida_ate. É assim que a conversa não repete nem perde pedaço.
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

-- ── (7) Gravar a qualificação ───────────────────────────────────────────────
-- Só sobrescreve o que veio preenchido: a IA chama esta função a cada resposta
-- nova e manda só o campo que acabou de descobrir. Sem o coalesce, a segunda
-- chamada apagaria a primeira.
--
-- UM PARÂMETRO POR CAMPO, e não um JSON só. Parece mais feio e é de propósito:
-- quando o modelo monta o JSON, uma aspa dentro da resposta do lead ("acho que
-- em julho, mas depende do 'meu chefe'") quebra o corpo inteiro e a chamada
-- volta como erro. Com um campo por parâmetro, quem monta o JSON é o n8n.
create or replace function qs_gloria_salvar(
  p_lead                 uuid,
  p_resposta_data        text default null,
  p_resposta_investimento text default null,
  p_resposta_decisao     text default null,
  p_perfil_viajante      text default null,
  p_como_pretende_viajar text default null,
  p_temperatura          text default null,
  p_resumo               text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $sv$
declare v_ses qs_gloria_sessoes%rowtype; v_n int;
begin
  if not exists (select 1 from qs_leads where id = p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente');
  end if;
  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;

  update qs_gloria_sessoes s set
    resposta_data         = coalesce(nullif(trim(p_resposta_data), ''),         s.resposta_data),
    resposta_investimento = coalesce(nullif(trim(p_resposta_investimento), ''), s.resposta_investimento),
    resposta_decisao      = coalesce(nullif(trim(p_resposta_decisao), ''),      s.resposta_decisao),
    perfil_viajante       = coalesce(nullif(trim(p_perfil_viajante), ''),       s.perfil_viajante),
    como_pretende_viajar  = coalesce(nullif(trim(p_como_pretende_viajar), ''),  s.como_pretende_viajar),
    -- Temperatura fora das três palavras é ignorada em silêncio: o modelo
    -- escreve "morno(a)" ou "quente!" com uma frequência que surpreende, e o
    -- CHECK da coluna derrubaria a gravação inteira por causa disso.
    temperatura           = coalesce(
                              case when p_temperatura in ('Quente','Morno','Frio')
                                   then p_temperatura end, s.temperatura),
    resumo                = coalesce(nullif(trim(p_resumo), ''), s.resumo)
  where s.lead_id = p_lead
  returning * into v_ses;

  v_n := (case when v_ses.resposta_data         is not null then 1 else 0 end)
       + (case when v_ses.resposta_investimento is not null then 1 else 0 end)
       + (case when v_ses.resposta_decisao      is not null then 1 else 0 end)
       + (case when v_ses.perfil_viajante       is not null then 1 else 0 end)
       + (case when v_ses.como_pretende_viajar  is not null then 1 else 0 end);

  update qs_gloria_sessoes set
    respondidas = v_n,
    etapa = case when etapa = 'transferida' then 'transferida'
                 when v_n >= 5 then 'qualificada'
                 when v_n > 0  then 'qualificando'
                 else 'abertura' end,
    qualificada_em = case when v_n >= 5 and qualificada_em is null then now() else qualificada_em end
  where lead_id = p_lead
  returning * into v_ses;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo, payload)
  values (p_lead, 'evento', 'qualificação atualizada', 'salvar_qualificacao',
          jsonb_strip_nulls(jsonb_build_object(
            'resposta_data', p_resposta_data,
            'resposta_investimento', p_resposta_investimento,
            'resposta_decisao', p_resposta_decisao,
            'perfil_viajante', p_perfil_viajante,
            'como_pretende_viajar', p_como_pretende_viajar,
            'temperatura', p_temperatura,
            'resumo', p_resumo)));

  return jsonb_build_object(
    'ok', true,
    'respondidas', v_ses.respondidas,
    'faltam', greatest(5 - v_ses.respondidas, 0),
    'etapa', v_ses.etapa,
    'temperatura', v_ses.temperatura
  );
end;
$sv$;

-- ── (8) Desligar a IA nesta conversa ────────────────────────────────────────
create or replace function qs_gloria_pausar(
  p_lead        uuid,
  p_motivo      text,
  p_resumo      text default null,
  p_transferida boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $pz$
begin
  if not exists (select 1 from qs_leads where id = p_lead) then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente');
  end if;
  insert into qs_gloria_sessoes(lead_id) values (p_lead) on conflict (lead_id) do nothing;

  update qs_gloria_sessoes set
    ativa  = false,
    motivo = coalesce(nullif(trim(p_motivo), ''), 'pausada'),
    resumo = coalesce(nullif(trim(p_resumo), ''), resumo),
    pausada_em = now(),
    etapa = case when p_transferida then 'transferida' else etapa end,
    transferida_em = case when p_transferida then now() else transferida_em end
  where lead_id = p_lead;

  insert into qs_gloria_log(lead_id, direcao, conteudo, motivo)
  values (p_lead, 'evento', coalesce(p_resumo, 'IA pausada'), p_motivo);

  return jsonb_build_object('ok', true, 'lead_id', p_lead, 'motivo', p_motivo);
end;
$pz$;

-- ── (9) Humano respondeu → a IA cala a boca ─────────────────────────────────
-- Sem isto, o SDR entra na conversa para ajudar e a IA continua respondendo por
-- cima dele. O cliente vê duas vozes e o SDR perde a mão da conversa.
--
-- Como reconhecemos a mensagem da PRÓPRIA Glória: ela grava cada balão em
-- qs_gloria_log antes de o Chatwoot devolver a mensagem pelo webhook. Se o
-- texto que está entrando bate com algo que ela mandou nos últimos 10 minutos,
-- é o eco dela mesma — e eco não é humano assumindo.
--
-- AFTER INSERT só: `message_updated` (o recibo ✓✓) chega como UPDATE e
-- desligaria a IA por causa de um visto.
create or replace function qs_gloria_humano_assumiu()
returns trigger
language plpgsql security definer
set search_path = public
as $hm$
begin
  if new.direction <> 'out' then return new; end if;
  if not exists (select 1 from qs_gloria_sessoes where lead_id = new.lead_id and ativa) then
    return new;
  end if;
  if coalesce(new.sender_name, '') = 'Glória (IA)' then return new; end if;
  if exists (
    select 1 from qs_gloria_log l
     where l.lead_id = new.lead_id and l.direcao = 'out'
       and l.criado_em > now() - interval '10 minutes'
       and left(coalesce(l.conteudo, ''), 120) = left(coalesce(new.content, ''), 120)
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

-- ── (10) RLS ────────────────────────────────────────────────────────────────
-- Regra: quem enxerga o lead enxerga a IA dele. A memória da conversa NÃO ganha
-- policy nenhuma — service_role (n8n e as rotas do QS) passa por cima da RLS, e
-- ninguém precisa ler isso pelo navegador.
alter table gloria_chat_memory enable row level security;
alter table gloria_documents   enable row level security;
alter table qs_gloria_sessoes  enable row level security;
alter table qs_gloria_log      enable row level security;

drop policy if exists gloria_sessoes_read on qs_gloria_sessoes;
create policy gloria_sessoes_read on qs_gloria_sessoes for select to authenticated
  using (qs_owns_lead(lead_id));

-- Escrita pela tela: para poder DESLIGAR a IA num lead (o botão que o SDR vai
-- querer ter). Ligar de volta continua sendo coisa de gestão, pelo SQL.
drop policy if exists gloria_sessoes_write on qs_gloria_sessoes;
create policy gloria_sessoes_write on qs_gloria_sessoes for update to authenticated
  using (qs_owns_lead(lead_id)) with check (qs_owns_lead(lead_id));

drop policy if exists gloria_log_read on qs_gloria_log;
create policy gloria_log_read on qs_gloria_log for select to authenticated
  using (lead_id is null or qs_owns_lead(lead_id));

-- Conteúdo do site: qualquer pessoa logada pode conferir o que a IA sabe.
drop policy if exists gloria_documents_read on gloria_documents;
create policy gloria_documents_read on gloria_documents for select to authenticated
  using (true);

-- ── (11) Conferência ────────────────────────────────────────────────────────
-- select qs_gloria_contexto('<uuid-de-um-lead>');
--   → pode_responder deve vir FALSE, com motivo 'ia_desligada_no_qs_settings',
--     enquanto você não ligar a chave. É o comportamento certo.
