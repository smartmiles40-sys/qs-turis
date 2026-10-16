-- 0144_rel_grupo_mensagens_whatsapp.sql
-- -----------------------------------------------------------------------------
-- GRUPOS "IGUAL AO WHATSAPP" (16/10/2026, Bruno: "conseguir fazer as mesmas
-- coisas que no WhatsApp da Meta"). O que a mensagem de grupo passa a guardar:
--   reacoes      — [{ de, nome, emoji }] (de = jid de quem reagiu; 'eu' = o número)
--   responde_a   — msg_id da mensagem citada  · citado_texto/citado_autor: prévia
--   mencoes      — quem foi marcado com @ (jids)
--   editada_em / apagada_em — editada ou apagada para todos
-- Escreve: api/rel-grupos.js (webhook e envio). Lê: Relacionamento.
-- -----------------------------------------------------------------------------

alter table rel_wa_grupo_mensagens add column if not exists reacoes      jsonb not null default '[]'::jsonb;
alter table rel_wa_grupo_mensagens add column if not exists responde_a   text;
alter table rel_wa_grupo_mensagens add column if not exists citado_texto text;
alter table rel_wa_grupo_mensagens add column if not exists citado_autor text;
alter table rel_wa_grupo_mensagens add column if not exists mencoes      text[] not null default '{}';
alter table rel_wa_grupo_mensagens add column if not exists editada_em   timestamptz;
alter table rel_wa_grupo_mensagens add column if not exists apagada_em   timestamptz;

-- key.participant original (pode ser @lid): a Evolution precisa dele pra reagir, citar e apagar
alter table rel_wa_grupo_mensagens add column if not exists autor_participante text;
