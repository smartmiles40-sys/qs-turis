-- =============================================================================
-- 0047 — QUEM ESCREVE E NÃO É LEAD PARA DE SUMIR
-- -----------------------------------------------------------------------------
-- MEDIDO EM 13/08, na base de produção:
--
--   312 mensagens registradas em qs_wa_descartadas desde 06/08
--   50 números REAIS com motivo `sem-lead-correspondente`
--
-- Cruzando esses 50 com o resto do mundo, são TRÊS histórias diferentes:
--
--   32 → o lead existe HOJE, e nasceu no MESMO MINUTO da mensagem. É uma
--        corrida: o cliente responde na hora em que o Bitrix cria o negócio, e
--        a mensagem bate no webhook segundos ANTES do lead existir no QS. Como
--        o descarte é definitivo, ela só volta se alguém abrir a conversa (aí o
--        wa-sync puxa o histórico do Chatwoot). Nos 32 a conversa acabou
--        entrando — mas por acaso, e não por desenho: ninguém foi avisado em
--        nenhum dos casos, e em 2 deles ela entrou num CARD DUPLICADO da mesma
--        pessoa (ver a nota sobre duplicados no fim deste arquivo).
--
--   13 → existem no Bitrix, mas não como lead do QS: cliente antigo do
--        Comercial, pós-venda, e três números do PRÓPRIO TIME. Não é gente pra
--        entrar na fila de prospecção sem alguém olhar.
--
--    5 → nunca falaram com a agência em lugar nenhum. Oportunidade pura, hoje
--        invisível.
--
-- A tabela já registrava tudo isso desde a 0038 — e NENHUMA tela do app lia.
-- Dado que ninguém olha não protege ninguém.
--
-- O QUE ESTA MIGRATION FAZ: dá à linha um ESTADO (pendente → resgatada /
-- virou_lead / ignorada) pra que ela possa ser uma fila de trabalho, e não um
-- log. Com isso o servidor resgata sozinho a mensagem da corrida quando o lead
-- nasce, e a gestão tria o resto numa tela.
--
-- NÃO guarda o conteúdo da mensagem — a decisão de LGPD da 0038 continua de pé.
-- A tela lê o texto do Chatwoot na hora de mostrar, e não o copia pra cá.
--
-- ⚠️ COLAR no SQL Editor do Supabase (projeto eabfjomrnucymduqnbci) e rodar 1x.
--    Idempotente. Aditiva: nenhuma coluna existente muda de tipo ou some.
-- =============================================================================

-- ── (1) A chave canônica do telefone, agora também no banco ─────────────────
-- O mesmo celular aparece escrito de quatro jeitos entre Bitrix, Chatwoot e
-- WhatsApp (com/sem +55, com/sem o nono dígito). Comparar string crua faz o
-- lead certo não casar com a conversa dele — foi assim que 57 leads ficaram
-- sem WhatsApp nenhum (ver 0037).
--
-- Esta função é o ESPELHO de `waKey()` em api/_wa.js. Mudou uma, muda a outra —
-- senão o backfill daqui e o resgate de lá passam a discordar sobre quem é
-- quem, e a divergência aparece como "mensagem que some às vezes".
create or replace function qs_wa_chave(raw text)
returns text
language plpgsql
immutable
as $$
declare
  d     text;
  ddd   text;
  resto text;
begin
  d := regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- Campo com DOIS números grudados (o Bitrix manda telefone como lista):
  -- fica com o primeiro plausível, que é o que o normalizador do app faz.
  if length(d) > 13 then d := left(d, 13); end if;

  if length(d) >= 12 and left(d, 2) = '55' then d := substr(d, 3); end if;

  if length(d) >= 10 then
    ddd   := left(d, 2);
    resto := substr(d, 3);
    if length(resto) = 9 and left(resto, 1) = '9' then resto := substr(resto, 2); end if;
    if length(resto) = 8 then return ddd || resto; end if;
  end if;

  -- Número de fora do Brasil (Portugal, Paraguai — clientes reais de uma
  -- agência de viagens). A regra brasileira não serve, mas a comparação
  -- continua valendo desde que a chave seja ESTÁVEL. O prefixo evita colisão
  -- com uma chave de DDD+8.
  d := regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g');
  if length(d) between 10 and 15 then return 'i:' || d; end if;

  return null;
end $$;

comment on function qs_wa_chave(text) is
  'DDD + 8 dígitos, sem o 55 e sem o nono. Espelho de waKey() em api/_wa.js — mudar as duas juntas.';

-- ── (2) O estado da linha ───────────────────────────────────────────────────
alter table qs_wa_descartadas
  add column if not exists situacao     text not null default 'pendente',
  add column if not exists lead_id      uuid references qs_leads(id) on delete set null,
  add column if not exists tratado_em   timestamptz,
  add column if not exists tratado_por  uuid references qs_users(id) on delete set null,
  add column if not exists contato_nome text;

comment on column qs_wa_descartadas.situacao is
  'pendente = ninguém olhou · resgatada = o lead apareceu e a conversa foi puxada · virou_lead = a triagem cadastrou · ignorada = não é oportunidade (colega, engano, robô)';
comment on column qs_wa_descartadas.contato_nome is
  'Nome como o WhatsApp/Chatwoot mostra. Ajuda a triagem a reconhecer quem é antes de criar lead.';

do $$
begin
  alter table qs_wa_descartadas
    add constraint qs_wa_descartadas_situacao_check
    check (situacao in ('pendente', 'resgatada', 'virou_lead', 'ignorada'));
exception
  when duplicate_object then null;
end $$;

-- A fila de triagem é sempre "pendente, mais recente primeiro".
create index if not exists idx_qs_wa_descartadas_situacao
  on qs_wa_descartadas (situacao, created_at desc);

-- O resgate procura por telefone. Sem isto ele varre a tabela a cada lead novo.
create index if not exists idx_qs_wa_descartadas_phone
  on qs_wa_descartadas (phone) where phone is not null;

-- ── (3) A gestão precisa PODER tratar, não só ler ───────────────────────────
-- A 0038 criou só o SELECT. Sem UPDATE, o botão "ignorar" da tela seria
-- recusado pela RLS — e falharia calado, que é o pior jeito de falhar.
do $$
begin
  create policy qs_wa_descartadas_tratamento on qs_wa_descartadas
    for update using (qs_is_manager()) with check (qs_is_manager());
exception
  when duplicate_object then null;
end $$;

-- ── (4) Backfill: fecha o que o tempo já resolveu ───────────────────────────
-- Os 32 da corrida têm lead HOJE. Deixá-los "pendente" encheria a triagem de
-- gente que já está na base — a tela nasceria com 32 falsos positivos e ninguém
-- confiaria nela na segunda vez que abrisse.
--
-- MAS "tem lead" NÃO é o mesmo que "a conversa chegou": um lead pode existir e
-- seguir mudo, se ninguém nunca abriu a conversa dele. Fechar esse caso como
-- "resgatada" enterraria justamente o que ainda pede ação. Por isso o carimbo
-- exige a CONVERSA, não o lead.
--
-- Na base de hoje isto não sobra nada (todos os 32 já têm mensagem), e é assim
-- que tem que ser: a regra existe pro caso futuro, não pra maquiar o presente.
update qs_wa_descartadas d
   set situacao   = 'resgatada',
       lead_id    = l.id,
       tratado_em = now()
  from qs_leads l
 where d.situacao = 'pendente'
   and d.motivo   = 'sem-lead-correspondente'
   and qs_wa_chave(d.phone) is not null
   and qs_wa_chave(l.phone) = qs_wa_chave(d.phone)
   and exists (select 1 from qs_wa_messages m where m.lead_id = l.id);

-- Lead existe, conversa não veio: continua PENDENTE, mas já apontando pro lead.
-- A triagem reconhece esta forma e oferece "trazer a conversa" em vez de
-- "criar lead" — criar outro lead pra quem já tem seria duplicar a pessoa.
update qs_wa_descartadas d
   set lead_id = l.id
  from qs_leads l
 where d.situacao = 'pendente'
   and d.lead_id is null
   and d.motivo   = 'sem-lead-correspondente'
   and qs_wa_chave(d.phone) is not null
   and qs_wa_chave(l.phone) = qs_wa_chave(d.phone);

-- Número curto demais pra ser telefone de gente. Em produção são 94 linhas de
-- "123456" — o teste de saúde de quem configurou o webhook. Marcar aqui evita
-- que a triagem abra pedindo pra tratar um número que não existe.
update qs_wa_descartadas
   set situacao = 'ignorada', tratado_em = now()
 where situacao = 'pendente'
   and (phone is null or length(regexp_replace(phone, '[^0-9]', '', 'g')) < 10);

-- ── ACHADO DE LADO: 68 PESSOAS COM CARD REPETIDO ───────────────────────────
-- Investigando os descartes, a chave canônica revelou outra coisa: 68 telefones
-- têm MAIS DE UM lead no QS (alguns três). E não é cosmético —
--
--   Herica Carvalho     → um card "ganho" e outro "perdido"
--   Andrea Bressan      → "nao_iniciado" num, "ganho" no outro
--   Rachel Paiva        → "perdido" num, "ganho" no outro
--
-- Quando isso acontece, a conversa de WhatsApp cai em UM dos cards e o SDR pode
-- estar trabalhando o outro — que aparece mudo. Foi o que houve com 2 dos 32.
--
-- Esta migration NÃO mexe nisso de propósito: juntar dois cards é decisão de
-- negócio (qual nome fica, qual dono, qual status vale, o que fazer com as
-- tarefas e o histórico de cada metade) e apagar lead em produção não é coisa
-- que um script deva decidir sozinho. Fica registrado aqui pra virar sprint.
--
-- A lista completa sai com:
--   select qs_wa_chave(phone) chave, count(*), string_agg(full_name || ' [' || status || ']', ' | ')
--     from qs_leads where qs_wa_chave(phone) is not null
--    group by 1 having count(*) > 1 order by 2 desc;

-- ── CONFERÊNCIA (rode e leia; nada aqui altera dado) ───────────────────────
-- select situacao, count(*) from qs_wa_descartadas group by 1 order by 2 desc;
--
-- Quem sobrou pra triagem, do mais recente pro mais antigo:
-- select phone, contato_nome, created_at
--   from qs_wa_descartadas
--  where situacao = 'pendente' and motivo = 'sem-lead-correspondente'
--  order by created_at desc;
