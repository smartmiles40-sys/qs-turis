-- =============================================================================
-- 0038 — Registro das mensagens de WhatsApp que o QS NÃO conseguiu vincular
-- =============================================================================
-- O webhook do Chatwoot responde 200 e segue a vida quando não consegue tratar
-- a mensagem: telefone ausente, caixa que não é WhatsApp, ou — o caso que mais
-- acontece — nenhum lead com aquele número. É proposital (webhook que devolve
-- erro entra em retentativa eterna e entope a fila do Chatwoot), mas o efeito
-- colateral é grave: a mensagem some sem deixar rastro em lugar nenhum.
--
-- Foi assim que "mensagens não estão chegando" ficou invisível por semanas: não
-- havia onde olhar. Agora há.
--
-- Dois usos, e o segundo é o mais interessante:
--   1. diagnóstico — "sumiu mensagem?" vira uma consulta, não um palpite;
--   2. COMERCIAL — a lista de quem está falando com a agência e NÃO está no CRM.
--      Cada linha com motivo 'sem-lead-correspondente' é um contato real que
--      chegou pelo WhatsApp e ninguém cadastrou.
--
-- LGPD: guarda telefone e motivo. NÃO guarda o conteúdo da mensagem.
-- Idempotente.
-- =============================================================================

create table if not exists qs_wa_descartadas (
  id          bigint generated always as identity primary key,
  motivo      text not null,          -- sem-lead-correspondente | sem-telefone | inbox-fora-do-whatsapp | erro
  phone       text,                   -- só dígitos, como veio
  inbox_id    bigint,
  cw_message_id bigint,
  detalhe     text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_qs_wa_descartadas_data on qs_wa_descartadas (created_at desc);
create index if not exists idx_qs_wa_descartadas_motivo on qs_wa_descartadas (motivo, created_at desc);

-- Mesma mensagem repetida pelo Chatwoot não vira duas linhas.
create unique index if not exists uq_qs_wa_descartadas_cw
  on qs_wa_descartadas (cw_message_id) where cw_message_id is not null;

alter table qs_wa_descartadas enable row level security;

-- Só a gestão lê: é diagnóstico e prospecção, não fila de trabalho do SDR.
do $$
begin
  create policy qs_wa_descartadas_leitura on qs_wa_descartadas
    for select using (qs_is_manager());
exception
  when duplicate_object then null;
end $$;

comment on table qs_wa_descartadas is
  'Mensagens de WhatsApp que chegaram no webhook e não puderam ser vinculadas a um lead. Sem conteúdo (LGPD).';

-- ── CONSULTAS ÚTEIS ────────────────────────────────────────────────────────
-- Sumiu mensagem hoje? Por quê?
--
--   select motivo, count(*) from qs_wa_descartadas
--    where created_at > now() - interval '1 day' group by 1 order by 2 desc;
--
-- Quem falou com a gente e não está no CRM (oportunidade de cadastro):
--
--   select phone, count(*) as mensagens, max(created_at) as ultima
--     from qs_wa_descartadas
--    where motivo = 'sem-lead-correspondente'
--      and created_at > now() - interval '30 days'
--    group by phone order by ultima desc;
