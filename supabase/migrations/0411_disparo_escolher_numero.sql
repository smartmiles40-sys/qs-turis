-- 0411 (23/11/2026) — DISPARO DO RELACIONAMENTO: ESCOLHER O NÚMERO QUE MANDA.
--
-- Pedido do Bruno: em cada disparo escolher se sai pelo número do
-- Relacionamento, de um SDR (Hugo, Mariana, Yanca…) ou do Marketing. Pelos
-- números dos SDRs SÓ template aprovado (o disparo simples já é só template; a
-- resposta automática em texto ao tocar no botão fica desligada nesses números).
-- Quem usa: só o time do Relacionamento (a tela continua no portal do Rel).
--
--   1. qs_disparo_campanhas.phone_number_id — o número escolhido (null = o do Rel,
--      como era antes). A fila (qs_disparo_envios.phone_number_id) copia dele.
--   2. rel_wa_modelos passa a guardar os modelos de VÁRIAS WABAs (cada SDR tem a
--      dele): a chave única vira (waba_id, nome, idioma).
--   3. índice por wamid em qs_disparo_envios (recibo/clique vindos do webhook
--      dos números dos SDRs acham o envio por ele).

alter table qs_disparo_campanhas add column if not exists phone_number_id text;

update rel_wa_modelos set waba_id = '' where waba_id is null;
alter table rel_wa_modelos alter column waba_id set default '';
alter table rel_wa_modelos alter column waba_id set not null;
alter table rel_wa_modelos drop constraint if exists rel_wa_modelos_nome_idioma_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rel_wa_modelos_waba_nome_idioma_key') then
    alter table rel_wa_modelos add constraint rel_wa_modelos_waba_nome_idioma_key unique (waba_id, nome, idioma);
  end if;
end $$;

create index if not exists qs_disparo_envios_wamid_idx on qs_disparo_envios (wamid) where wamid is not null;

-- Conferir:
--   select phone_number_id, count(*) from qs_disparo_campanhas where setor='relacionamento' group by 1;
--   select waba_id, count(*) from rel_wa_modelos group by 1;
-- Desfazer:
--   alter table qs_disparo_campanhas drop column if exists phone_number_id;
--   alter table rel_wa_modelos drop constraint if exists rel_wa_modelos_waba_nome_idioma_key;
--   alter table rel_wa_modelos add constraint rel_wa_modelos_nome_idioma_key unique (nome, idioma); -- só se não houver nome repetido entre WABAs
