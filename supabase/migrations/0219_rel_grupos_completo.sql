-- 0219_rel_grupos_completo.sql
-- -----------------------------------------------------------------------------
-- GRUPOS DO RELACIONAMENTO "IGUAL AO WHATSAPP NORMAL" (28/10/2026).
-- Bruno: "deixar o WhatsApp do relacionamento para grupos igual ao WhatsApp
-- deles normal, dando todas as funcionalidades!"
--
-- A regra de sempre continua: a ligação da Evolution (instância
-- relacionamento-grupos-4183) SÓ fala com GRUPO. Nada aqui manda pra pessoa.
--
-- O que entra:
--   1. rel_wa_grupos ganha foto, "o número é admin?", ajustes do grupo, quando
--      as informações foram lidas pela última vez (rodízio do cron), fixar no
--      topo da lista e o VÍNCULO com a expedição / viagem.
--   2. rel_wa_grupo_mensagens ganha o status de envio (✓ / ✓✓ / azul) e a
--      marca de "encaminhada".
--   3. rel_wa_grupo_agendadas: fila de mensagens agendadas pro grupo (avisos de
--      embarque). O cron /api/rel-grupos?cron=1 manda — e SÓ manda se a env
--      REL_GRUPOS_AGENDADAS=1 estiver ligada na Vercel (decisão do Bruno).
--
-- Escrita: só o servidor (api/rel-grupos.js, service_role). Leitura: quem tem
-- acesso ao Relacionamento (rel_tem_acesso), igual às outras tabelas de grupo.
-- Idempotente: pode rodar de novo sem estrago.
-- -----------------------------------------------------------------------------

-- ── 1. Grupo: foto, admin, ajustes, rodízio, fixado, vínculo ────────────────
alter table rel_wa_grupos add column if not exists foto_url          text;
-- o número do Relacionamento é admin do grupo? (só admin adiciona/remove gente,
-- troca nome/descrição/foto e gera link de convite)
alter table rel_wa_grupos add column if not exists eu_admin          boolean not null default false;
-- "Só admins enviam mensagens" (announce) e "Só admins editam os dados" (restrict)
alter table rel_wa_grupos add column if not exists so_admins_enviam  boolean;
alter table rel_wa_grupos add column if not exists so_admins_editam  boolean;
-- última vez que o cron leu as informações do grupo (o rodízio pega o mais antigo)
alter table rel_wa_grupos add column if not exists info_em           timestamptz;
-- fixado no topo da lista do QS (vale pro time todo)
alter table rel_wa_grupos add column if not exists fixado_em         timestamptz;
-- vínculo com a viagem: a expedição (grupo da turma) ou a viagem do cliente
-- (grupo de família / lua de mel). Os dois podem ficar vazios.
alter table rel_wa_grupos add column if not exists expedicao_id      uuid references expedicoes(id)  on delete set null;
alter table rel_wa_grupos add column if not exists viagem_id         uuid references rel_viagens(id) on delete set null;
alter table rel_wa_grupos add column if not exists vinculo_por       uuid references qs_users(id)    on delete set null;
alter table rel_wa_grupos add column if not exists vinculo_em        timestamptz;

create index if not exists rel_wa_grupos_expedicao_idx on rel_wa_grupos (expedicao_id) where expedicao_id is not null;
create index if not exists rel_wa_grupos_viagem_idx    on rel_wa_grupos (viagem_id)    where viagem_id    is not null;
create index if not exists rel_wa_grupos_info_idx      on rel_wa_grupos (info_em nulls first) where saiu_em is null;

-- ── 2. Mensagem: status de envio e "encaminhada" ────────────────────────────
-- enviada (✓) · entregue (✓✓) · lida (✓✓ azul) · erro (!). Só faz sentido nas
-- mensagens do próprio número; chega pelo evento MESSAGES_UPDATE da Evolution.
alter table rel_wa_grupo_mensagens add column if not exists status      text;
alter table rel_wa_grupo_mensagens add column if not exists encaminhada boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rel_wa_grupo_msgs_status_ck') then
    alter table rel_wa_grupo_mensagens add constraint rel_wa_grupo_msgs_status_ck
      check (status is null or status in ('enviada', 'entregue', 'lida', 'erro'));
  end if;
end $$;

-- ── 3. Mensagens agendadas ──────────────────────────────────────────────────
create table if not exists rel_wa_grupo_agendadas (
  id          uuid primary key default gen_random_uuid(),
  grupo_jid   text not null references rel_wa_grupos(jid) on delete cascade,
  texto       text not null default '',
  -- arquivo opcional (já no bucket wa-midia/rel-envio/), vai como mídia com o texto de legenda
  anexo_url   text,
  anexo_nome  text,
  anexo_mime  text,
  -- @todos: avisa todo mundo do grupo (menção escondida, igual ao WhatsApp)
  mencionar_todos boolean not null default false,
  enviar_em   timestamptz not null,
  status      text not null default 'pendente'
              check (status in ('pendente', 'enviando', 'enviada', 'erro', 'cancelada')),
  erro        text,
  tentativas  int not null default 0,
  msg_id      text,
  -- a assinatura "*Nome:*" sai com o nome de quem agendou
  criado_por  uuid references qs_users(id) on delete set null,
  assinatura  text,
  criado_em   timestamptz not null default now(),
  enviada_em  timestamptz,
  cancelada_por uuid references qs_users(id) on delete set null
);
create index if not exists rel_wa_grupo_agendadas_fila_idx on rel_wa_grupo_agendadas (enviar_em) where status = 'pendente';
create index if not exists rel_wa_grupo_agendadas_grupo_idx on rel_wa_grupo_agendadas (grupo_jid, enviar_em desc);

alter table rel_wa_grupo_agendadas enable row level security;
revoke all on rel_wa_grupo_agendadas from anon, authenticated;
grant select on rel_wa_grupo_agendadas to authenticated;
drop policy if exists rel_wa_grupo_agendadas_ler on rel_wa_grupo_agendadas;
create policy rel_wa_grupo_agendadas_ler on rel_wa_grupo_agendadas
  for select to authenticated using (rel_tem_acesso());

/**
 * O cron pega as agendadas vencidas (no máximo p_limite) e marca "enviando"
 * numa transação só — duas rodadas ao mesmo tempo nunca pegam a mesma.
 * Uma que ficou "enviando" por mais de 10 min (função caiu no meio) NÃO é
 * reenviada (podia duplicar no grupo): vira "erro" pra alguém conferir.
 */
create or replace function rel_wa_grupo_agendadas_pegar(p_limite int default 10)
returns setof rel_wa_grupo_agendadas
language plpgsql security definer set search_path = public as $$
begin
  update rel_wa_grupo_agendadas
     set status = 'erro', erro = 'Não confirmou o envio — confira no grupo antes de mandar de novo.'
   where status = 'enviando' and enviar_em < now() - interval '10 minutes';

  return query
  with fila as (
    select a.id from rel_wa_grupo_agendadas a
     where a.status = 'pendente' and a.enviar_em <= now()
     order by a.enviar_em
     limit greatest(1, least(coalesce(p_limite, 10), 50))
     for update skip locked
  )
  update rel_wa_grupo_agendadas a
     set status = 'enviando', tentativas = a.tentativas + 1
    from fila
   where a.id = fila.id
  returning a.*;
end $$;
revoke all on function rel_wa_grupo_agendadas_pegar(int) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- ROLLBACK (rodar à mão, nesta ordem, se precisar desfazer):
--   drop function if exists rel_wa_grupo_agendadas_pegar(int);
--   drop table if exists rel_wa_grupo_agendadas;
--   alter table rel_wa_grupo_mensagens drop constraint if exists rel_wa_grupo_msgs_status_ck;
--   alter table rel_wa_grupo_mensagens drop column if exists status, drop column if exists encaminhada;
--   drop index if exists rel_wa_grupos_expedicao_idx, rel_wa_grupos_viagem_idx, rel_wa_grupos_info_idx;
--   alter table rel_wa_grupos
--     drop column if exists foto_url, drop column if exists eu_admin,
--     drop column if exists so_admins_enviam, drop column if exists so_admins_editam,
--     drop column if exists info_em, drop column if exists fixado_em,
--     drop column if exists expedicao_id, drop column if exists viagem_id,
--     drop column if exists vinculo_por, drop column if exists vinculo_em;
-- -----------------------------------------------------------------------------
