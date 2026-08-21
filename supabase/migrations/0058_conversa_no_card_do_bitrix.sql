-- 0058_conversa_no_card_do_bitrix.sql
-- =============================================================================
-- A CONVERSA DE WHATSAPP APARECE NO CARD DO BITRIX (Bruno, 20/08/2026).
--
-- O PEDIDO. "Queria salvar todas as mensagens que os SDRs mandam no WhatsApp
-- dentro do Bitrix, no card do cliente." Quem trabalha no Bitrix (Comercial,
-- gestão) hoje não vê nada do que foi conversado — abre o card e precisa pedir
-- print pra SDR.
--
-- POR QUE UM RESUMO POR DIA, E NÃO MENSAGEM POR MENSAGEM. Medido em 20/08 sobre
-- os últimos 14 dias: 287 mensagens enviadas + 127 recebidas POR DIA, em 738
-- leads. Uma chamada por mensagem seriam ~414 comentários/dia espalhados na
-- timeline — o card vira um mural ilegível e o histórico comercial (proposta,
-- reunião, valor) se perde no meio do "oi, tudo bem?". Agrupado por lead/dia
-- caem pra ~40-60 chamadas, e o card ganha um bloco que se lê de cima a baixo.
--
-- POR QUE UMA TABELA, E NÃO UMA COLUNA EM qs_wa_messages. O que precisa ser
-- idempotente é o PAR (lead, dia), não a mensagem: se o job rodar duas vezes na
-- mesma janela — e ele vai, porque é chamado por mais de uma perna, igual ao
-- vigia — o segundo tem que virar no-op. A UNIQUE abaixo é o que garante isso.
--
-- LGPD. A 0038 decidiu NÃO guardar conteúdo de mensagem em qs_wa_descartadas
-- (gente que não é lead). Aqui é o oposto e de propósito: só entra conversa de
-- quem JÁ É lead com card no Bitrix, e o dado vai pro CRM da própria agência —
-- mesmo titular, mesma finalidade comercial. Nada de terceiro atravessa.
-- =============================================================================

create table if not exists qs_wa_bitrix_digest (
  id            bigserial primary key,
  lead_id       uuid not null references qs_leads(id) on delete cascade,
  -- O dia em SÃO PAULO, não em UTC. Um "resumo de terça" que começa às 21h de
  -- segunda não é o resumo de terça pra ninguém do time.
  dia           date not null,
  bitrix_deal_id text,
  -- Quantas mensagens o resumo levou. Serve pra conferir depois se o card ficou
  -- com o mesmo tanto que o QS tem — a pergunta "sumiu mensagem?" de novo.
  mensagens     integer not null default 0,
  enviado_em    timestamptz not null default now(),
  erro          text,
  constraint qs_wa_bitrix_digest_unico unique (lead_id, dia)
);

-- A varredura do job é sempre "o que falta desta data?" — o índice é por dia.
create index if not exists qs_wa_bitrix_digest_dia_idx
  on qs_wa_bitrix_digest (dia desc);

-- Tabela de bastidor: nenhuma tela lê. Trancada no service_role, igual às
-- outras de infraestrutura (0038). Sem policy = sem acesso via anon/authenticated.
alter table qs_wa_bitrix_digest enable row level security;

comment on table qs_wa_bitrix_digest is
  'Controle de idempotência do resumo diário de WhatsApp enviado pro card do Bitrix (api/wa-bitrix-digest.js). Uma linha por lead por dia.';
