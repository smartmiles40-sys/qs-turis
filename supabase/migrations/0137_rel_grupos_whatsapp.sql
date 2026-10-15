-- 0137_rel_grupos_whatsapp.sql
-- -----------------------------------------------------------------------------
-- GRUPOS DO WHATSAPP NO RELACIONAMENTO (15/10/2026).
--
-- O número do Relacionamento (+55 11 98012-4183) está na API oficial pelo COEX,
-- e a Meta não entrega grupos por ali. Os grupos chegam por uma SEGUNDA ligação,
-- pela Evolution (QR, instância "relacionamento-grupos-4183"), com uma regra
-- dura do Bruno: por essa ligação SÓ existem grupos — conversa com pessoa é
-- jogada fora na entrada e o envio só aceita endereço de grupo (@g.us).
--
-- Escrita: só o servidor (api/rel-grupos.js, service_role). Leitura: quem tem
-- acesso ao Relacionamento (rel_tem_acesso — o Financeiro NÃO vê os grupos).
-- -----------------------------------------------------------------------------

create table if not exists rel_wa_grupos (
  jid            text primary key check (jid ~ '^[0-9]+(-[0-9]+)?@g\.us$'),
  nome           text,
  descricao      text,
  participantes  int,
  ultima_msg_em  timestamptz,
  ultima_msg     text,
  -- O número saiu ou foi removido do grupo: some da lista, histórico fica.
  saiu_em        timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists rel_wa_grupo_mensagens (
  id           uuid primary key default gen_random_uuid(),
  grupo_jid    text not null references rel_wa_grupos(jid) on delete cascade,
  msg_id       text not null unique,
  de_mim       boolean not null default false,
  autor_jid    text,
  autor_nome   text,
  tipo         text not null default 'texto',
  texto        text not null default '',
  anexo_url    text,
  anexo_nome   text,
  -- Quem mandou pelo QS (null = veio do celular ou de outra pessoa).
  enviado_por  uuid references qs_users(id) on delete set null,
  criado_em    timestamptz not null default now()
);

create index if not exists rel_wa_grupo_msgs_grupo_idx
  on rel_wa_grupo_mensagens (grupo_jid, criado_em desc);
create index if not exists rel_wa_grupos_ultima_idx
  on rel_wa_grupos (ultima_msg_em desc nulls last);

alter table rel_wa_grupos enable row level security;
alter table rel_wa_grupo_mensagens enable row level security;

-- Ninguém escreve pelo navegador: tira o "grant all" padrão do Supabase.
revoke all on rel_wa_grupos, rel_wa_grupo_mensagens from anon, authenticated;
grant select on rel_wa_grupos, rel_wa_grupo_mensagens to authenticated;

drop policy if exists rel_wa_grupos_ler on rel_wa_grupos;
create policy rel_wa_grupos_ler on rel_wa_grupos
  for select to authenticated using (rel_tem_acesso());

drop policy if exists rel_wa_grupo_msgs_ler on rel_wa_grupo_mensagens;
create policy rel_wa_grupo_msgs_ler on rel_wa_grupo_mensagens
  for select to authenticated using (rel_tem_acesso());
